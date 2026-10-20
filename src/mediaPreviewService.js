const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { runCommand, killProcessTree } = require('./processUtils');
const { PREVIEW_DIR } = require('./subtitleManager/subtitleManagerState');

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const HARDWARE_CACHE_TTL_MS = 10 * 60 * 1000;
const previews = new Map();
const hardwareCache = new Map();
let cleanupStarted = false;

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t', '.png': 'image/png'
};

const HARDWARE_PROFILES = Object.freeze({
  nvenc: { encoder: 'h264_nvenc', label: 'NVIDIA NVENC' },
  qsv: { encoder: 'h264_qsv', label: 'Intel Quick Sync' },
  vaapi: { encoder: 'h264_vaapi', label: 'VAAPI' },
  amf: { encoder: 'h264_amf', label: 'AMD AMF' },
  videotoolbox: { encoder: 'h264_videotoolbox', label: 'Apple VideoToolbox' }
});

async function ensureCleanPreviewDir() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await fsp.rm(PREVIEW_DIR, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(PREVIEW_DIR, { recursive: true });
}

function normalizeOptionalStreamIndex(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeHardwareMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'off', ...Object.keys(HARDWARE_PROFILES)].includes(mode) ? mode : 'auto';
}

function contentType(filePath) {
  return MIME_TYPES[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value || '').trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start == null && end == null) return null;
  if (start == null) {
    const suffix = Math.max(0, Number(end) || 0);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    end = end == null ? size - 1 : Math.min(size - 1, end);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return { invalid: true };
  return { start, end };
}

async function streamFile(req, res, filePath, options = {}) {
  const stats = await fsp.stat(filePath);
  if (!stats.isFile()) {
    const error = new Error('Midia local nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  const size = stats.size;
  const range = req.headers.range ? parseRange(req.headers.range, size) : null;
  const headers = {
    'Content-Type': options.contentType || contentType(filePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (range && range.invalid) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, { ...headers, 'Content-Length': length, 'Content-Range': `bytes ${range.start}-${range.end}/${size}` });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(filePath).pipe(res);
}

function purgeExpired() {
  const now = Date.now();
  for (const [token, entry] of previews) {
    if (entry.expiresAtMs > now) continue;
    previews.delete(token);
    fsp.rm(entry.filePath, { force: true }).catch(() => {});
  }
}

async function registerPreviewFile({ itemId, filePath, kind = 'media', metadata = {} }) {
  const token = path.basename(filePath).split('.')[0];
  const expiresAtMs = Date.now() + PREVIEW_TTL_MS;
  previews.set(token, { token, itemId, filePath, kind, metadata, expiresAtMs });
  return { token, kind, metadata, expiresAt: new Date(expiresAtMs).toISOString() };
}

function autoHardwareCandidates() {
  if (process.platform === 'darwin') return ['videotoolbox'];
  if (process.platform === 'win32') return ['nvenc', 'qsv', 'amf'];
  return ['nvenc', 'qsv', 'vaapi', 'amf'];
}

function hardwareSmokeArgs(mode, vaapiDevice) {
  const common = ['-hide_banner', '-loglevel', 'error'];
  const source = ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1', '-frames:v', '1'];
  if (mode === 'vaapi') {
    return [...common, '-vaapi_device', vaapiDevice, ...source, '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'];
  }
  if (mode === 'qsv') return [...common, ...source, '-vf', 'format=nv12', '-c:v', 'h264_qsv', '-f', 'null', '-'];
  if (mode === 'nvenc') return [...common, ...source, '-c:v', 'h264_nvenc', '-f', 'null', '-'];
  if (mode === 'amf') return [...common, ...source, '-c:v', 'h264_amf', '-f', 'null', '-'];
  if (mode === 'videotoolbox') return [...common, ...source, '-c:v', 'h264_videotoolbox', '-f', 'null', '-'];
  return [];
}

async function detectHardwareAcceleration(config, options = {}) {
  const requested = normalizeHardwareMode(config?.playback?.hardwareAcceleration);
  const ffmpegPath = String(config?.paths?.ffmpegPath || 'ffmpeg');
  const vaapiDevice = String(config?.playback?.vaapiDevice || '/dev/dri/renderD128');
  const cacheKey = `${ffmpegPath}|${requested}|${vaapiDevice}`;
  const cached = hardwareCache.get(cacheKey);
  if (!options.refresh && cached && Date.now() - cached.cachedAtMs < HARDWARE_CACHE_TTL_MS) return { ...cached.value };

  const base = {
    requested,
    available: false,
    selected: 'software',
    encoder: 'libx264',
    label: 'CPU (libx264)',
    fallback: false,
    reason: requested === 'off' ? 'A aceleracao por hardware esta desativada.' : 'Nenhum acelerador compativel foi validado.',
    attempted: [],
    testedAt: new Date().toISOString()
  };
  if (requested === 'off') {
    hardwareCache.set(cacheKey, { cachedAtMs: Date.now(), value: base });
    return { ...base };
  }

  const encoderList = await runCommand(ffmpegPath, ['-hide_banner', '-encoders'], { timeoutMs: 5000 }).catch((error) => ({ code: -1, stdout: '', stderr: error.message }));
  const advertised = `${encoderList.stdout || ''}\n${encoderList.stderr || ''}`;
  const candidates = requested === 'auto' ? autoHardwareCandidates() : [requested];
  for (const mode of candidates) {
    const profile = HARDWARE_PROFILES[mode];
    if (!profile) continue;
    if (!advertised.includes(profile.encoder)) {
      base.attempted.push({ mode, ok: false, reason: `${profile.encoder} nao aparece na build do FFmpeg.` });
      continue;
    }
    const smoke = await runCommand(ffmpegPath, hardwareSmokeArgs(mode, vaapiDevice), { timeoutMs: 5000 }).catch((error) => ({ code: -1, stderr: error.message }));
    if (smoke.code === 0 && !smoke.timedOut) {
      const value = {
        ...base,
        available: true,
        selected: mode,
        encoder: profile.encoder,
        label: profile.label,
        reason: requested === 'auto' ? `${profile.label} validado automaticamente.` : `${profile.label} validado.`,
        attempted: [...base.attempted, { mode, ok: true, reason: 'Teste de encode concluido.' }]
      };
      hardwareCache.set(cacheKey, { cachedAtMs: Date.now(), value });
      return { ...value };
    }
    const reason = String(smoke.stderr || '').trim().split('\n').slice(-2).join(' ').slice(0, 300) || 'Teste do encoder falhou.';
    base.attempted.push({ mode, ok: false, reason });
  }

  base.fallback = requested !== 'auto';
  if (requested !== 'auto') base.reason = `${HARDWARE_PROFILES[requested]?.label || requested} nao ficou disponivel; o aplicativo usara CPU.`;
  hardwareCache.set(cacheKey, { cachedAtMs: Date.now(), value: base });
  return { ...base };
}

function softwareVideoArgs() {
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
}

function hardwareVideoArgs(hardware, config) {
  const mode = hardware?.selected || 'software';
  if (mode === 'nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (mode === 'qsv') return ['-vf', 'format=nv12', '-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23'];
  if (mode === 'vaapi') return ['-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', '23'];
  if (mode === 'amf') return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'];
  if (mode === 'videotoolbox') return ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-b:v', '6000k', '-pix_fmt', 'yuv420p'];
  return softwareVideoArgs(config);
}

function buildLiveStreamArgs({ mediaPath, audioStreamIndex = null, startSeconds = 0, copyVideo = false, hardware = null, config = {} }) {
  const start = Math.max(0, Number(startSeconds) || 0);
  const selectedAudioStreamIndex = normalizeOptionalStreamIndex(audioStreamIndex);
  const audioMap = selectedAudioStreamIndex != null ? `0:${selectedAudioStreamIndex}?` : '0:a:0?';
  const args = ['-hide_banner', '-loglevel', 'warning'];
  const useCopy = copyVideo && start < 0.25;
  const preciseSeek = start >= 0.25;
  let fineSeek = 0;
  if (preciseSeek) {
    const fastSeek = Math.max(0, start - 5);
    fineSeek = start - fastSeek;
    if (fastSeek > 0) args.push('-ss', fastSeek.toFixed(3));
  }
  if (!useCopy && hardware?.selected === 'vaapi') args.push('-vaapi_device', String(config?.playback?.vaapiDevice || '/dev/dri/renderD128'));
  args.push('-i', mediaPath);
  if (fineSeek > 0) args.push('-ss', fineSeek.toFixed(3));
  args.push('-map', '0:v:0', '-map', audioMap, '-sn', '-dn', '-map_metadata', '-1');
  if (useCopy) args.push('-c:v', 'copy');
  else args.push(...hardwareVideoArgs(hardware, config));
  args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-max_muxing_queue_size', '2048', '-movflags', 'frag_keyframe+default_base_moof+omit_tfhd_offset', '-f', 'mp4', 'pipe:1');
  return { args, mode: useCopy ? 'audio-transcode-live' : (hardware?.selected && hardware.selected !== 'software' ? 'hardware-transcode-live' : 'software-transcode-live'), preciseSeek };
}

function liveHeaders(metadata) {
  return {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Accel-Buffering': 'no',
    'X-ErsatzTV-Playback-Mode': metadata.mode,
    'X-ErsatzTV-Hardware': metadata.hardware || 'software'
  };
}

function spawnLiveAttempt({ command, args, req, res, metadata }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let started = false;
    let finished = false;
    let stderr = '';

    const detachListeners = () => {
      req.off('aborted', abort);
      res.off('close', abort);
    };
    const abort = () => {
      if (finished) return;
      killProcessTree(child);
    };
    req.once('aborted', abort);
    res.once('close', abort);

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
    });
    child.on('error', (error) => {
      finished = true;
      detachListeners();
      reject(error);
    });
    child.stdout.once('data', (firstChunk) => {
      if (finished || req.aborted || res.destroyed) return;
      started = true;
      if (!res.headersSent) res.writeHead(200, liveHeaders(metadata));
      res.write(firstChunk);
      child.stdout.pipe(res);
    });
    child.on('close', (code, signal) => {
      finished = true;
      detachListeners();
      if (started) {
        if (!res.writableEnded && !res.destroyed) res.end();
        resolve({ started: true, code, signal, stderr });
        return;
      }
      resolve({ started: false, code, signal, stderr });
    });
  });
}

async function streamCompatibleMedia({ config, req, res, mediaPath, audioStreamIndex = null, startSeconds = 0, copyVideo = false }) {
  const start = Math.max(0, Number(startSeconds) || 0);
  const selectedAudioStreamIndex = normalizeOptionalStreamIndex(audioStreamIndex);
  const hardware = copyVideo && start < 0.25
    ? { selected: 'software', encoder: 'copy', label: 'Video original', available: false }
    : await detectHardwareAcceleration(config);
  let build = buildLiveStreamArgs({ mediaPath, audioStreamIndex: selectedAudioStreamIndex, startSeconds: start, copyVideo, hardware, config });

  if (req.method === 'HEAD') {
    res.writeHead(200, liveHeaders({ mode: build.mode, hardware: hardware.selected }));
    res.end();
    return { mode: build.mode, hardware };
  }

  let result = await spawnLiveAttempt({
    command: String(config?.paths?.ffmpegPath || 'ffmpeg'),
    args: build.args,
    req,
    res,
    metadata: { mode: build.mode, hardware: hardware.selected }
  });

  if (!result.started && hardware.selected !== 'software' && !req.aborted && !res.destroyed) {
    const fallback = { selected: 'software', encoder: 'libx264', label: 'CPU (libx264)', available: false, fallback: true };
    build = buildLiveStreamArgs({ mediaPath, audioStreamIndex: selectedAudioStreamIndex, startSeconds: start, copyVideo: false, hardware: fallback, config });
    result = await spawnLiveAttempt({
      command: String(config?.paths?.ffmpegPath || 'ffmpeg'),
      args: build.args,
      req,
      res,
      metadata: { mode: build.mode, hardware: 'software' }
    });
  }

  if (!result.started && !res.headersSent && !res.destroyed) {
    const message = String(result.stderr || '').trim().split('\n').slice(-5).join('\n').slice(0, 3000) || `ffmpeg terminou com codigo ${result.code}`;
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`Nao foi possivel iniciar a reproducao compativel.\n${message}`);
  }
  return { mode: build.mode, hardware, started: result.started };
}

async function createCompatiblePreview({ config, itemId, mediaPath, audioStreamIndex = null, copyVideo = false }) {
  await ensureCleanPreviewDir();
  purgeExpired();
  const token = crypto.randomUUID();
  const tempPath = path.join(PREVIEW_DIR, `${token}.tmp.mp4`);
  const finalPath = path.join(PREVIEW_DIR, `${token}.mp4`);
  const selectedAudioStreamIndex = normalizeOptionalStreamIndex(audioStreamIndex);
  const audioMap = selectedAudioStreamIndex != null ? `0:${selectedAudioStreamIndex}` : '0:a:0?';
  const base = ['-y', '-i', mediaPath, '-map', '0:v:0', '-map', audioMap, '-sn', '-dn'];
  const videoArgs = copyVideo
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  const args = [...base, ...videoArgs, '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', tempPath];
  let result = await runCommand(config.paths.ffmpegPath, args, { timeoutMs: 20 * 60 * 1000 });
  let mode = copyVideo ? 'audio-transcode' : 'full-transcode';
  if (result.code !== 0 && copyVideo) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    const fallbackArgs = [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', tempPath];
    result = await runCommand(config.paths.ffmpegPath, fallbackArgs, { timeoutMs: 20 * 60 * 1000 });
    mode = 'full-transcode';
  }
  if (result.code !== 0) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    const error = new Error(String(result.stderr || '').trim().slice(-3000) || `ffmpeg terminou com codigo ${result.code}`);
    error.statusCode = 502;
    throw error;
  }
  await fsp.rename(tempPath, finalPath);
  return registerPreviewFile({ itemId, filePath: finalPath, kind: 'media', metadata: { mode, audioStreamIndex: selectedAudioStreamIndex } });
}

async function createAudioVisualization({ config, itemId, mediaPath, audioStreamIndex = null, kind = 'waveform' }) {
  await ensureCleanPreviewDir();
  purgeExpired();
  const token = crypto.randomUUID();
  const safeKind = kind === 'spectrogram' ? 'spectrogram' : 'waveform';
  const tempPath = path.join(PREVIEW_DIR, `${token}.tmp.png`);
  const finalPath = path.join(PREVIEW_DIR, `${token}.png`);
  const selectedAudioStreamIndex = normalizeOptionalStreamIndex(audioStreamIndex);
  const stream = selectedAudioStreamIndex != null ? `[0:${selectedAudioStreamIndex}]` : '[0:a:0]';
  const filter = safeKind === 'spectrogram'
    ? `${stream}aformat=channel_layouts=mono,showspectrumpic=s=1600x320:legend=disabled:scale=log:color=intensity[v]`
    : `${stream}aformat=channel_layouts=mono,showwavespic=s=1600x180:split_channels=0:colors=white[v]`;
  const args = ['-y', '-i', mediaPath, '-filter_complex', filter, '-map', '[v]', '-frames:v', '1', tempPath];
  const result = await runCommand(config.paths.ffmpegPath, args, { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    const error = new Error(String(result.stderr || '').trim().slice(-3000) || `ffmpeg terminou com codigo ${result.code}`);
    error.statusCode = 502;
    throw error;
  }
  await fsp.rename(tempPath, finalPath);
  return registerPreviewFile({ itemId, filePath: finalPath, kind: safeKind, metadata: { audioStreamIndex: selectedAudioStreamIndex } });
}

async function clearAllPreviews() {
  previews.clear();
  hardwareCache.clear();
  await fsp.rm(PREVIEW_DIR, { recursive: true, force: true }).catch(() => {});
  cleanupStarted = false;
}

function resolvePreview(token, itemId) {
  purgeExpired();
  const entry = previews.get(String(token || ''));
  if (!entry || entry.itemId !== itemId) return null;
  return entry;
}

module.exports = {
  PREVIEW_TTL_MS,
  HARDWARE_CACHE_TTL_MS,
  normalizeOptionalStreamIndex,
  normalizeHardwareMode,
  streamFile,
  streamCompatibleMedia,
  createCompatiblePreview,
  createAudioVisualization,
  resolvePreview,
  ensureCleanPreviewDir,
  clearAllPreviews,
  contentType,
  parseRange,
  detectHardwareAcceleration,
  buildLiveStreamArgs,
  hardwareVideoArgs
};
