const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { runCommand } = require('../processUtils');
const { isPathInside, isDangerousBaseDir, pathExists } = require('../utils');
const logger = require('../logger');
const workspaceState = require('./subtitleWorkspaceState');
const scanner = require('./subtitleWorkspaceScanner');
const subtitleCore = require('../subtitleManager/subtitleCore');
const subtitleManagerState = require('../subtitleManager/subtitleManagerState');
const bazarrClient = require('../integrations/bazarrClient');
const mediaPreview = require('../mediaPreviewService');
const advanced = require('./subtitleWorkspaceAdvanced');

const scanJobs = new Map();
const MEDIA_PROBE_VERSION = 3;
const MEDIA_PROBE_FAILURE_RETRY_MS = 60 * 1000;
let mutationChain = Promise.resolve();

function nowIso() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function mutateState(mutator) {
  let result;
  mutationChain = mutationChain.catch(() => {}).then(async () => {
    const state = await workspaceState.load();
    result = await mutator(state);
    await workspaceState.save(state);
  });
  await mutationChain;
  return result;
}

function publicWorkspace(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.rootPath,
    recursive: workspace.recursive !== false,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    lastScanAt: workspace.lastScanAt,
    scanSummary: workspace.scanSummary || null,
    itemCount: Object.keys(workspace.items || {}).length
  };
}

async function validateRoot(rootPath) {
  const raw = String(rootPath || '').trim();
  if (!raw || !path.isAbsolute(raw)) {
    const error = new Error('Informe um caminho absoluto para a pasta de midia.');
    error.statusCode = 400;
    throw error;
  }
  const resolved = path.resolve(raw);
  const stats = await fs.lstat(resolved).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
    const error = new Error('A pasta informada nao existe, nao e um diretorio ou e um link simbolico.');
    error.statusCode = 400;
    throw error;
  }
  const real = await fs.realpath(resolved);
  if (path.resolve(real) !== resolved) {
    const error = new Error('Por seguranca, a raiz do Gerenciador de Legendas nao pode atravessar links simbolicos.');
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

async function listWorkspaces() {
  const state = await workspaceState.load();
  return Object.values(state.workspaces || {}).map(publicWorkspace).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

async function createWorkspace(payload = {}) {
  const rootPath = await validateRoot(payload.rootPath);
  if (isDangerousBaseDir(rootPath) && payload.confirmBroadPath !== true) {
    const error = new Error('Esta pasta parece muito ampla para uma varredura de midia. Confirme se deseja usa-la mesmo assim.');
    error.statusCode = 409;
    error.code = 'SUBTITLE_WORKSPACE_BROAD_PATH_CONFIRM_REQUIRED';
    throw error;
  }
  const name = String(payload.name || path.basename(rootPath)).trim().slice(0, 120) || path.basename(rootPath);
  const recursive = payload.recursive !== false;
  return mutateState(async (state) => {
    const duplicate = Object.values(state.workspaces).find((workspace) => path.resolve(workspace.rootPath) === rootPath);
    if (duplicate) {
      const error = new Error('Esta pasta ja esta cadastrada no Gerenciador de Legendas.');
      error.statusCode = 409;
      throw error;
    }
    const id = `workspace-${crypto.randomUUID()}`;
    const workspace = {
      id, name, rootPath, recursive,
      createdAt: nowIso(), updatedAt: nowIso(), lastScanAt: null, scanSummary: null, items: {}
    };
    state.workspaces[id] = workspace;
    return publicWorkspace(workspace);
  });
}

async function deleteWorkspace(workspaceId) {
  return mutateState(async (state) => {
    const id = String(workspaceId || '').trim();
    if (!state.workspaces[id]) {
      const error = new Error('Pasta cadastrada nao encontrada.');
      error.statusCode = 404;
      throw error;
    }
    delete state.workspaces[id];
    scanJobs.delete(id);
    return { id };
  });
}

function getScanStatus(workspaceId) {
  return scanJobs.get(String(workspaceId || '')) || { status: 'idle', progress: null, error: null };
}

async function startScan(workspaceId) {
  const id = String(workspaceId || '').trim();
  const current = scanJobs.get(id);
  if (current?.status === 'running') {
    const error = new Error('Ja existe uma varredura em andamento para esta pasta.');
    error.statusCode = 409;
    throw error;
  }
  const state = await workspaceState.load();
  const workspace = state.workspaces[id];
  if (!workspace) {
    const error = new Error('Pasta cadastrada nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  await validateRoot(workspace.rootPath);
  scanJobs.set(id, { status: 'running', startedAt: nowIso(), finishedAt: null, progress: { directoriesScanned: 0, filesSeen: 0, videosFound: 0 }, error: null });
  setImmediate(async () => {
    try {
      const result = await scanner.scanWorkspace({
        workspace: clone(workspace),
        onProgress: async (progress) => {
          const job = scanJobs.get(id);
          if (job?.status === 'running') scanJobs.set(id, { ...job, progress });
        }
      });
      await mutateState(async (latest) => {
        const target = latest.workspaces[id];
        if (!target) return;
        for (const [itemId, item] of Object.entries(result.items)) {
          const existing = target.items?.[itemId];
          if (existing) {
            item.reviewStatus = existing.reviewStatus === 'reviewed' ? 'reviewed' : 'unreviewed';
            item.reviewedAt = existing.reviewedAt || null;
            item.bazarr = existing.bazarr || item.bazarr || null;
          }
        }
        target.items = result.items;
        target.lastScanAt = nowIso();
        target.updatedAt = nowIso();
        target.scanSummary = { ...result.summary, reviewed: Object.values(result.items).filter((item) => item.reviewStatus === 'reviewed').length, unreviewed: Object.values(result.items).filter((item) => item.reviewStatus !== 'reviewed').length };
      });
      scanJobs.set(id, { status: 'completed', startedAt: scanJobs.get(id)?.startedAt || null, finishedAt: nowIso(), progress: result.summary, error: null });
    } catch (error) {
      scanJobs.set(id, { status: 'failed', startedAt: scanJobs.get(id)?.startedAt || null, finishedAt: nowIso(), progress: scanJobs.get(id)?.progress || null, error: error.message });
      await logger.error(`Varredura do Gerenciador de Legendas falhou: ${error.message}`);
    }
  });
  return getScanStatus(id);
}

function itemMatchesFilter(item, filter) {
  const sidecars = Array.isArray(item.sidecars) ? item.sidecars : [];
  if (filter === 'without-subtitles') return sidecars.length === 0;
  if (filter === 'editable') return sidecars.some((track) => track.editable);
  if (filter === 'multiple') return sidecars.length > 1;
  if (filter === 'readonly') return sidecars.some((track) => !track.editable);
  if (filter === 'reviewed') return item.reviewStatus === 'reviewed';
  if (filter === 'unreviewed') return item.reviewStatus !== 'reviewed';
  if (filter === 'bazarr-linked') return Boolean(item.bazarr?.match);
  if (filter === 'bazarr-unlinked') return !item.bazarr?.match;
  return true;
}

async function listItems(workspaceId, options = {}) {
  const state = await workspaceState.load();
  const workspace = state.workspaces[String(workspaceId || '')];
  if (!workspace) {
    const error = new Error('Pasta cadastrada nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  const query = String(options.query || '').trim().toLowerCase();
  const filter = String(options.filter || 'all');
  const language = String(options.language || 'all').trim().toLowerCase();
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(1, Math.min(250, Number(options.limit) || 100));
  let items = Object.values(workspace.items || {});
  items = items.filter((item) => itemMatchesFilter(item, filter));
  if (language !== 'all') items = items.filter((item) => (item.sidecars || []).some((track) => String(track.language || 'und').toLowerCase() === language));
  if (query) items = items.filter((item) => `${item.fileName} ${item.relativePath}`.toLowerCase().includes(query));
  items.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'pt-BR', { sensitivity: 'base' }));
  const total = items.length;
  const page = items.slice(offset, offset + limit).map((item) => ({ ...item, fullPath: undefined }));
  const languageCounts = {};
  for (const item of Object.values(workspace.items || {})) {
    for (const track of item.sidecars || []) languageCounts[track.language || 'und'] = (languageCounts[track.language || 'und'] || 0) + 1;
  }
  const all = Object.values(workspace.items || {});
  return {
    workspace: publicWorkspace(workspace),
    items: page,
    total, offset, limit, hasMore: offset + page.length < total,
    counts: {
      all: all.length,
      withoutSubtitles: all.filter((item) => (item.sidecars || []).length === 0).length,
      editable: all.filter((item) => (item.sidecars || []).some((track) => track.editable)).length,
      multiple: all.filter((item) => (item.sidecars || []).length > 1).length,
      readonly: all.filter((item) => (item.sidecars || []).some((track) => !track.editable)).length,
      reviewed: all.filter((item) => item.reviewStatus === 'reviewed').length,
      unreviewed: all.filter((item) => item.reviewStatus !== 'reviewed').length
    },
    languageCounts
  };
}

async function findWorkspaceItem(itemId) {
  const state = await workspaceState.load();
  const id = String(itemId || '').trim();
  for (const workspace of Object.values(state.workspaces || {})) {
    if (workspace.items?.[id]) return { state, workspace, item: workspace.items[id] };
  }
  const error = new Error('Arquivo nao encontrado no Gerenciador de Legendas.');
  error.statusCode = 404;
  throw error;
}

async function secureMediaPath(workspace, item) {
  const root = await validateRoot(workspace.rootPath);
  const candidate = path.resolve(root, item.relativePath);
  if (!isPathInside(root, candidate)) {
    const error = new Error('O arquivo solicitado esta fora da raiz cadastrada.');
    error.statusCode = 403;
    throw error;
  }
  const stats = await fs.lstat(candidate).catch(() => null);
  if (!stats || !stats.isFile() || stats.isSymbolicLink()) {
    const error = new Error('O arquivo de video nao esta mais disponivel. Atualize a varredura.');
    error.statusCode = 404;
    throw error;
  }
  const real = await fs.realpath(candidate);
  if (!isPathInside(root, real)) {
    const error = new Error('O arquivo resolve para fora da raiz cadastrada.');
    error.statusCode = 403;
    throw error;
  }
  return real;
}

function sidecarToDescriptor(sidecar) {
  return {
    trackId: sidecar.trackId || sidecar.fileName,
    language: sidecar.language || 'und',
    filePath: sidecar.filePath,
    fileName: sidecar.fileName,
    format: sidecar.format,
    flags: sidecar.flags || [],
    editable: sidecar.editable === true,
    sourceLabel: sidecar.editable ? `Arquivo local · ${String(sidecar.format || '').toUpperCase()}` : `Arquivo local · ${String(sidecar.format || '').toUpperCase()} · somente leitura`,
    selectable: sidecar.editable === true
  };
}

function parseRate(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '0/0') return null;
  if (raw.includes('/')) {
    const [a, b] = raw.split('/').map(Number);
    return Number.isFinite(a) && Number.isFinite(b) && b ? a / b : null;
  }
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function playbackAfterProbeFailure(mediaPath) {
  const ext = path.extname(String(mediaPath || '')).toLowerCase();
  if (['.mp4', '.m4v', '.webm'].includes(ext)) {
    return { mode: 'direct', reason: 'browser-first-after-probe-failure', copyVideoPossible: false, probeIncomplete: true };
  }
  return { mode: 'full-transcode', reason: 'probe-failed', copyVideoPossible: false, probeIncomplete: true };
}

function assessPlayback(mediaPath, videoStreams = [], audioStreams = []) {
  const ext = path.extname(String(mediaPath || '')).toLowerCase();
  const video = videoStreams[0] || null;
  const audio = audioStreams.find((entry) => entry.default) || audioStreams[0] || null;
  const videoCodec = String(video?.codec || '').toLowerCase();
  const audioCodec = String(audio?.codec || '').toLowerCase();
  const pixFmt = String(video?.pixFmt || '').toLowerCase();
  const profile = String(video?.profile || '').toLowerCase();
  const h264BrowserSafe = videoCodec === 'h264'
    && (!pixFmt || ['yuv420p', 'yuvj420p'].includes(pixFmt))
    && !/(high 10|high 4:2:2|high 4:4:4|cavlc 4:4:4)/i.test(profile);
  const directMp4 = ['.mp4', '.m4v'].includes(ext) && h264BrowserSafe && (!audio || ['aac', 'mp3'].includes(audioCodec));
  const directWebm = ext === '.webm' && ['vp8', 'vp9', 'av1'].includes(videoCodec) && (!audio || ['opus', 'vorbis'].includes(audioCodec));
  if (directMp4 || directWebm) return { mode: 'direct', reason: 'container-codecs-supported', copyVideoPossible: h264BrowserSafe };
  if (h264BrowserSafe) return { mode: 'audio-transcode', reason: ext === '.mkv' ? 'matroska-browser-compatibility' : 'audio-or-container-compatibility', copyVideoPossible: true };
  return { mode: 'full-transcode', reason: 'video-container-or-codec-compatibility', copyVideoPossible: false };
}

async function probeMedia(config, workspace, item, mediaPath) {
  const cached = item.probe;
  const cacheMatchesFile = cached
    && Number(cached.probeVersion) === MEDIA_PROBE_VERSION
    && Number(cached.mediaSizeBytes) === Number(item.sizeBytes)
    && Number(cached.mediaMtimeMs) === Number(item.mtimeMs);
  if (cacheMatchesFile && !cached.error) return cached;
  if (cacheMatchesFile && cached.error) {
    const probedAtMs = Date.parse(String(cached.probedAt || ''));
    if (Number.isFinite(probedAtMs) && Date.now() - probedAtMs < MEDIA_PROBE_FAILURE_RETRY_MS) return cached;
  }
  const command = String(config?.paths?.ffprobePath || 'ffprobe');
  const result = await runCommand(command, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mediaPath], { timeoutMs: 20000 });
  let probe;
  if (result.code !== 0 || result.timedOut) {
    probe = { probeVersion: MEDIA_PROBE_VERSION, mediaSizeBytes: item.sizeBytes, mediaMtimeMs: item.mtimeMs, durationSeconds: null, container: '', videoStreams: [], audioStreams: [], frameRate: null, playback: playbackAfterProbeFailure(mediaPath), embeddedTracks: [], error: (result.stderr || 'ffprobe falhou').trim().slice(0, 500), probedAt: nowIso() };
  } else {
    let parsed = {};
    try { parsed = JSON.parse(result.stdout || '{}'); } catch {}
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const videoStreams = streams.filter((stream) => stream.codec_type === 'video').map((stream, ordinal) => ({
      streamIndex: Number(stream.index), ordinal, codec: String(stream.codec_name || ''), profile: String(stream.profile || ''),
      pixFmt: String(stream.pix_fmt || ''), level: Number(stream.level) || null,
      width: Number(stream.width) || null, height: Number(stream.height) || null,
      frameRate: parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate),
      default: Boolean(stream.disposition?.default), title: String(stream.tags?.title || ''), language: String(stream.tags?.language || 'und')
    }));
    const audioStreams = streams.filter((stream) => stream.codec_type === 'audio').map((stream, ordinal) => ({
      streamIndex: Number(stream.index), ordinal, codec: String(stream.codec_name || ''), profile: String(stream.profile || ''),
      channels: Number(stream.channels) || null, channelLayout: String(stream.channel_layout || ''), sampleRate: Number(stream.sample_rate) || null,
      default: Boolean(stream.disposition?.default), title: String(stream.tags?.title || ''), language: String(stream.tags?.language || 'und')
    }));
    const embeddedTracks = streams
      .filter((stream) => stream.codec_type === 'subtitle')
      .map((stream) => ({
        trackId: `embedded:${stream.index}`,
        language: String(stream.tags?.language || 'und'),
        fileName: '',
        format: String(stream.codec_name || 'embedded'),
        flags: [stream.disposition?.forced ? 'forced' : '', stream.disposition?.hearing_impaired ? 'hi' : ''].filter(Boolean),
        editable: false,
        embedded: true,
        sourceLabel: `Embutida · ${String(stream.codec_name || 'legenda').toUpperCase()} · somente leitura`,
        selectable: false,
        metadata: { streamIndex: Number(stream.index), title: stream.tags?.title || '', codecLongName: String(stream.codec_long_name || '') }
      }));
    probe = {
      probeVersion: MEDIA_PROBE_VERSION,
      mediaSizeBytes: item.sizeBytes,
      mediaMtimeMs: item.mtimeMs,
      durationSeconds: Number(parsed.format?.duration) || null,
      container: String(parsed.format?.format_name || ''),
      videoStreams,
      audioStreams,
      frameRate: videoStreams[0]?.frameRate || null,
      playback: assessPlayback(mediaPath, videoStreams, audioStreams),
      embeddedTracks,
      error: null,
      probedAt: nowIso()
    };
  }
  await mutateState(async (state) => {
    const target = state.workspaces[workspace.id]?.items?.[item.id];
    if (target) target.probe = probe;
  });
  return probe;
}

async function refreshStoredSidecars(workspaceId, itemId, mediaPath) {
  const sidecars = await scanner.discoverSidecarsForMedia(mediaPath);
  const publicSidecars = sidecars.map(({ filePath, ...entry }) => entry);
  await mutateState(async (state) => {
    const target = state.workspaces[workspaceId]?.items?.[itemId];
    if (!target) return;
    target.sidecars = publicSidecars;
    target.lastSeenAt = nowIso();
    const values = Object.values(state.workspaces[workspaceId].items || {});
    state.workspaces[workspaceId].scanSummary = {
      ...(state.workspaces[workspaceId].scanSummary || {}),
      videosFound: values.length,
      withEditableSubtitles: values.filter((entry) => (entry.sidecars || []).some((track) => track.editable)).length,
      withoutExternalSubtitles: values.filter((entry) => (entry.sidecars || []).length === 0).length,
      withReadOnlySubtitles: values.filter((entry) => (entry.sidecars || []).some((track) => !track.editable)).length,
      reviewed: values.filter((entry) => entry.reviewStatus === 'reviewed').length,
      unreviewed: values.filter((entry) => entry.reviewStatus !== 'reviewed').length
    };
  });
  return sidecars;
}

async function buildContext(config, itemId) {
  const { workspace, item } = await findWorkspaceItem(itemId);
  const mediaPath = await secureMediaPath(workspace, item);
  const mediaDir = path.dirname(mediaPath);
  const mediaStem = path.parse(mediaPath).name;
  return {
    config,
    itemId: item.id,
    mediaPath,
    activeWritable: true,
    workspace,
    item,
    async listTrackDescriptors() {
      const sidecars = await scanner.discoverSidecarsForMedia(mediaPath);
      const probe = await probeMedia(config, workspace, item, mediaPath);
      return [...sidecars.map(sidecarToDescriptor), ...(probe.embeddedTracks || [])];
    },
    async resolveTrack(trackId, { allowMissing = false } = {}) {
      const id = String(trackId || '').trim();
      if (!id || path.basename(id) !== id || id.includes('/') || id.includes('\\')) {
        const error = new Error('Faixa de legenda invalida.');
        error.statusCode = 400;
        throw error;
      }
      const filePath = path.resolve(mediaDir, id);
      if (!isPathInside(mediaDir, filePath) || !isPathInside(workspace.rootPath, filePath)) {
        const error = new Error('A legenda solicitada esta fora da pasta autorizada.');
        error.statusCode = 403;
        throw error;
      }
      const identity = scanner.parseSidecarIdentity(mediaPath, filePath);
      if (!identity || identity.format !== 'srt') {
        const error = new Error('Apenas sidecars SRT associados a este video podem ser editados.');
        error.statusCode = 409;
        throw error;
      }
      if (!allowMissing) {
        const stats = await fs.lstat(filePath).catch(() => null);
        if (!stats || !stats.isFile() || stats.isSymbolicLink()) return null;
        const real = await fs.realpath(filePath);
        if (!isPathInside(workspace.rootPath, real)) {
          const error = new Error('A legenda resolve para fora da raiz cadastrada.');
          error.statusCode = 403;
          throw error;
        }
      }
      return { ...identity, filePath, editable: true, sourceLabel: 'Arquivo local · SRT' };
    },
    afterMutation: async () => refreshStoredSidecars(workspace.id, item.id, mediaPath)
  };
}

async function getItemStatus(config, itemId) {
  const context = await buildContext(config, itemId);
  const probe = await probeMedia(config, context.workspace, context.item, context.mediaPath);
  return subtitleCore.getStatus(context, {
    mediaProfile: 'external_workspace',
    providers: {},
    queryDefaults: { artist: '', track: context.item.fileName, album: '' },
    durationSeconds: probe.durationSeconds,
    mediaProbe: {
      container: probe.container || '',
      videoStreams: probe.videoStreams || [],
      audioStreams: probe.audioStreams || [],
      frameRate: probe.frameRate || null,
      playback: {
        ...(probe.playback || {}),
        liveCompatibilityStreaming: config?.playback?.liveCompatibilityStreaming !== false
      }
    },
    probeError: probe.error || null,
    workspace: publicWorkspace(context.workspace),
    reviewStatus: context.item.reviewStatus,
    bazarr: {
      configured: bazarrClient.configured(config.bazarr),
      matched: Boolean(context.item.bazarr?.match),
      match: context.item.bazarr?.match || null
    }
  });
}

async function previewLocal(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return subtitleCore.previewLocal(context, payload);
}

async function applyOffset(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return subtitleCore.applyOffset(context, payload);
}

async function replaceCues(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return subtitleCore.replaceCues(context, payload);
}

async function previewTimingTransform(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return subtitleCore.previewTimingTransform(context, payload);
}

async function applyTimingTransform(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return subtitleCore.applyTimingTransform(context, payload);
}

async function restoreHistory(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return subtitleCore.restoreHistory(context, payload);
}

async function deleteLocalSubtitle(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return subtitleCore.deleteLocalSubtitle(context, payload);
}

async function streamMedia(config, itemId, req, res, previewToken = '') {
  const context = await buildContext(config, itemId);
  return subtitleCore.streamMedia(context, req, res, previewToken);
}


async function streamCompatibleMedia(config, itemId, req, res, options = {}) {
  const context = await buildContext(config, itemId);
  const probe = await probeMedia(config, context.workspace, context.item, context.mediaPath);
  if (config?.playback?.liveCompatibilityStreaming === false) {
    const error = new Error('Streaming compativel em tempo real esta desativado nas Configuracoes.');
    error.statusCode = 409;
    throw error;
  }
  const requestedAudioIndex = mediaPreview.normalizeOptionalStreamIndex(options.audioStreamIndex);
  const validAudio = requestedAudioIndex == null
    ? null
    : (probe.audioStreams || []).find((stream) => Number(stream.streamIndex) === requestedAudioIndex);
  const defaultAudio = (probe.audioStreams || []).find((stream) => stream.default) || (probe.audioStreams || [])[0] || null;
  const audioStreamIndex = validAudio ? requestedAudioIndex : (defaultAudio ? Number(defaultAudio.streamIndex) : null);
  const duration = Number(probe.durationSeconds) || 0;
  const requestedStart = Math.max(0, Number(options.startSeconds) || 0);
  const startSeconds = duration > 0 ? Math.min(requestedStart, Math.max(0, duration - 0.05)) : requestedStart;
  return mediaPreview.streamCompatibleMedia({
    config,
    req,
    res,
    mediaPath: context.mediaPath,
    audioStreamIndex,
    startSeconds,
    copyVideo: Boolean(probe.playback?.copyVideoPossible)
  });
}

async function createCompatiblePreview(config, payload) {
  const itemId = typeof payload === 'string' ? payload : payload?.itemId;
  const context = await buildContext(config, itemId);
  const probe = await probeMedia(config, context.workspace, context.item, context.mediaPath);
  const audioStreamIndex = mediaPreview.normalizeOptionalStreamIndex(typeof payload === 'object' ? payload.audioStreamIndex : null);
  const copyVideoRequested = typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'copyVideo')
    ? payload.copyVideo === true
    : Boolean(probe.playback?.copyVideoPossible);
  const result = await mediaPreview.createCompatiblePreview({
    config, itemId: context.itemId, mediaPath: context.mediaPath,
    audioStreamIndex,
    copyVideo: copyVideoRequested
  });
  return { ...result, recommendedMode: probe.playback?.mode || null };
}

async function createVisualization(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return advanced.createVisualization(context, payload);
}

async function extractEmbeddedTrack(config, payload = {}) {
  const startedAt = Date.now();
  const itemId = String(payload.itemId || '');
  const trackId = String(payload.trackId || '');
  try {
    const context = await buildContext(config, itemId);
    await logger.info('Extracao de legenda iniciada no Gerenciador de Legendas.', {
      itemId,
      fileName: context.item?.fileName || path.basename(context.mediaPath),
      trackId,
      convertToSrt: payload.convertToSrt === true,
      language: String(payload.language || '') || null
    });
    const result = await advanced.extractEmbeddedTrack(context, payload);
    await logger.info('Extracao de legenda concluida no Gerenciador de Legendas.', {
      itemId,
      fileName: context.item?.fileName || path.basename(context.mediaPath),
      trackId,
      outputFileName: result?.fileName || null,
      durationMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    await logger.error(`Extracao de legenda falhou no Gerenciador de Legendas: ${error.message}`, {
      itemId,
      trackId,
      code: error.code || null,
      statusCode: error.statusCode || null,
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}

async function convertTrackToSrt(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return advanced.convertTrackToSrt(context, payload);
}

async function startOcrJob(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return advanced.startOcrJob(context, payload);
}

async function startTranslationJob(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return advanced.startTranslationJob(context, payload);
}

async function startRemuxJob(config, payload) {
  const context = await buildContext(config, payload.itemId);
  return advanced.startRemuxJob(context, payload);
}

async function getAdvancedStatus(config) {
  return advanced.getAdvancedStatus(config);
}

function getAdvancedJob(jobId) {
  const job = advanced.getJob(jobId);
  if (!job) {
    const error = new Error('Tarefa avancada nao encontrada ou expirada.');
    error.statusCode = 404;
    throw error;
  }
  return job;
}

async function setReviewStatus(itemId, reviewed) {
  return mutateState(async (state) => {
    const id = String(itemId || '').trim();
    for (const workspace of Object.values(state.workspaces || {})) {
      const item = workspace.items?.[id];
      if (!item) continue;
      item.reviewStatus = reviewed ? 'reviewed' : 'unreviewed';
      item.reviewedAt = reviewed ? nowIso() : null;
      workspace.updatedAt = nowIso();
      const values = Object.values(workspace.items || {});
      workspace.scanSummary = { ...(workspace.scanSummary || {}), reviewed: values.filter((entry) => entry.reviewStatus === 'reviewed').length, unreviewed: values.filter((entry) => entry.reviewStatus !== 'reviewed').length };
      return { itemId: id, reviewStatus: item.reviewStatus, reviewedAt: item.reviewedAt };
    }
    const error = new Error('Arquivo nao encontrado no Gerenciador de Legendas.');
    error.statusCode = 404;
    throw error;
  });
}

async function ensureBazarrMatch(config, context, { refresh = false } = {}) {
  if (!bazarrClient.configured(config.bazarr)) {
    const error = new Error('Configure a integracao com o Bazarr antes de usar esta acao.');
    error.statusCode = 409;
    throw error;
  }
  if (!refresh && context.item.bazarr?.match) return context.item.bazarr.match;
  const match = await bazarrClient.findMediaByPath(config.bazarr, context.mediaPath);
  await mutateState(async (state) => {
    const item = state.workspaces[context.workspace.id]?.items?.[context.item.id];
    if (item) item.bazarr = { ...(item.bazarr || {}), match: match || null, matchedAt: nowIso() };
  });
  if (!match) {
    const error = new Error('Este arquivo nao foi encontrado no catalogo do Bazarr. Verifique o mapeamento de caminhos e se ele esta indexado no Sonarr/Radarr.');
    error.statusCode = 404;
    error.code = 'BAZARR_MEDIA_NOT_FOUND';
    throw error;
  }
  return match;
}

async function bazarrSearch(config, itemId) {
  const context = await buildContext(config, itemId);
  const match = await ensureBazarrMatch(config, context, { refresh: true });
  const candidates = await bazarrClient.searchSubtitles(config.bazarr, match);
  return { match, candidates };
}

function sidecarSignature(entries) {
  return JSON.stringify((entries || []).map((entry) => [entry.fileName, entry.sizeBytes, entry.mtimeMs]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

async function waitForSidecarChange(mediaPath, beforeSignature, timeout = 20000) {
  const started = Date.now();
  let latest = await scanner.discoverSidecarsForMedia(mediaPath);
  while (Date.now() - started < timeout) {
    if (sidecarSignature(latest) !== beforeSignature) return { changed: true, sidecars: latest };
    await wait(500);
    latest = await scanner.discoverSidecarsForMedia(mediaPath);
  }
  return { changed: sidecarSignature(latest) !== beforeSignature, sidecars: latest };
}

async function registerBazarrTracks(itemId, before, after, candidate = {}) {
  const beforeMap = new Map((before || []).map((entry) => [entry.fileName, `${entry.sizeBytes}:${entry.mtimeMs}`]));
  const changed = (after || []).filter((entry) => entry.editable && beforeMap.get(entry.fileName) !== `${entry.sizeBytes}:${entry.mtimeMs}`);
  if (!changed.length) return [];
  const state = await subtitleManagerState.load();
  const itemState = subtitleManagerState.ensureItem(state, itemId);
  for (const entry of changed) {
    itemState.tracks[entry.trackId || entry.fileName] = {
      provider: 'bazarr',
      providerId: candidate.provider || null,
      sourceType: 'manual-download',
      sourceLabel: `Bazarr${candidate.provider ? ` · ${candidate.provider}` : ''}`,
      appliedAt: nowIso(),
      lastAppliedOffsetMs: 0,
      metadata: { score: candidate.score ?? null, releaseInfo: candidate.releaseInfo || [] }
    };
  }
  await subtitleManagerState.save(state);
  return changed.map((entry) => entry.fileName);
}

async function bazarrDownload(config, payload) {
  const context = await buildContext(config, payload.itemId);
  const match = await ensureBazarrMatch(config, context);
  const candidate = payload.candidate && typeof payload.candidate === 'object' ? payload.candidate : {};
  if (!candidate.candidateId || !candidate.provider) {
    const error = new Error('Candidato do Bazarr invalido. Execute uma nova pesquisa.');
    error.statusCode = 400;
    throw error;
  }
  const before = await scanner.discoverSidecarsForMedia(context.mediaPath);
  const signature = sidecarSignature(before);
  await bazarrClient.downloadCandidate(config.bazarr, match, candidate);
  const result = await waitForSidecarChange(context.mediaPath, signature, 20000);
  await refreshStoredSidecars(context.workspace.id, context.item.id, context.mediaPath);
  const changedTracks = await registerBazarrTracks(context.itemId, before, result.sidecars, candidate);
  return { match, changed: result.changed, changedTracks, queued: !result.changed };
}

async function bazarrSync(config, payload) {
  const context = await buildContext(config, payload.itemId);
  const match = await ensureBazarrMatch(config, context);
  const trackId = String(payload.trackId || payload.language || '').trim();
  const track = await context.resolveTrack(trackId);
  if (String(track?.language || '').toLowerCase() === 'und') {
    const error = new Error('O Bazarr precisa de um idioma identificado para sincronizar esta faixa. Renomeie o sidecar com o idioma (ex.: .pt-BR.srt) ou use o ajuste manual.');
    error.statusCode = 409;
    error.code = 'BAZARR_SUBTITLE_LANGUAGE_REQUIRED';
    throw error;
  }
  if (!track) {
    const error = new Error('Legenda SRT nao encontrada para sincronizacao.');
    error.statusCode = 404;
    throw error;
  }
  if ((track.flags || []).includes('forced')) {
    const error = new Error('O Bazarr nao sincroniza legendas marcadas como forced.');
    error.statusCode = 409;
    throw error;
  }
  await subtitleCore.assertUnchanged(track.filePath, payload.expectedFingerprint || null);
  const before = await subtitleCore.fingerprintFile(track.filePath);
  await subtitleCore.backupTrack(context, trackId, 'bazarr-sync');
  await bazarrClient.syncSubtitle(config.bazarr, match, {
    localSubtitlePath: track.filePath,
    language: track.language,
    forced: (track.flags || []).includes('forced'),
    hearingImpaired: (track.flags || []).some((flag) => flag === 'hi' || flag === 'sdh' || flag === 'cc')
  });
  const started = Date.now();
  let after = before;
  while (Date.now() - started < 30000) {
    await wait(750);
    if (!(await pathExists(track.filePath))) continue;
    after = await subtitleCore.fingerprintFile(track.filePath);
    if (!subtitleCore.fingerprintsEqual(before, after)) break;
  }
  await refreshStoredSidecars(context.workspace.id, context.item.id, context.mediaPath);
  return { match, changed: !subtitleCore.fingerprintsEqual(before, after), queued: subtitleCore.fingerprintsEqual(before, after), fingerprint: after };
}

async function testBazarr(config) {
  return bazarrClient.testConnection(config.bazarr);
}

module.exports = {
  publicWorkspace,
  validateRoot,
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  getScanStatus,
  startScan,
  listItems,
  findWorkspaceItem,
  buildContext,
  getItemStatus,
  previewLocal,
  applyOffset,
  replaceCues,
  previewTimingTransform,
  applyTimingTransform,
  restoreHistory,
  deleteLocalSubtitle,
  streamMedia,
  streamCompatibleMedia,
  createCompatiblePreview,
  createVisualization,
  extractEmbeddedTrack,
  convertTrackToSrt,
  startOcrJob,
  startTranslationJob,
  startRemuxJob,
  getAdvancedStatus,
  getAdvancedJob,
  setReviewStatus,
  bazarrSearch,
  bazarrDownload,
  bazarrSync,
  testBazarr,
  refreshStoredSidecars
};
