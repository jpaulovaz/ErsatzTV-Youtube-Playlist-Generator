const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { runCommand } = require('./processUtils');
const { PREVIEW_DIR } = require('./subtitleManager/subtitleManagerState');

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const previews = new Map();
let cleanupStarted = false;

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t', '.png': 'image/png'
};

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
  await fsp.rm(PREVIEW_DIR, { recursive: true, force: true }).catch(() => {});
  cleanupStarted = false;
}

function resolvePreview(token, itemId) {
  purgeExpired();
  const entry = previews.get(String(token || ''));
  if (!entry || entry.itemId !== itemId) return null;
  return entry;
}

module.exports = { PREVIEW_TTL_MS, normalizeOptionalStreamIndex, streamFile, createCompatiblePreview, createAudioVisualization, resolvePreview, ensureCleanPreviewDir, clearAllPreviews, contentType, parseRange };
