const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const stateStore = require('./subtitleManagerState');
const historyService = require('./subtitleHistoryService');
const { parseSrt, writeSrt, cuesToVtt } = require('./subtitleFormats');
const { shiftCues, normalizeOffsetMs } = require('./subtitleTiming');
const mediaPreview = require('../mediaPreviewService');
const { pathExists } = require('../utils');

function nowIso() { return new Date().toISOString(); }

function trackLabel(track) {
  if (!track) return 'Arquivo local · origem não registrada';
  if (track.sourceLabel) return track.sourceLabel;
  if (track.provider === 'youtube' && track.sourceType === 'manual') return 'YouTube · enviada pelo canal';
  if (track.provider === 'youtube' && track.sourceType === 'automatic') return 'YouTube · automatica';
  if (track.provider === 'lrclib') return 'LRCLIB · letra sincronizada';
  if (track.provider === 'gemini') return track.sourceLabel || 'Gemini · traduzida';
  if (track.provider === 'bazarr') return 'Bazarr · legenda externa';
  return 'Arquivo local · origem não registrada';
}

function normalizeTrackId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 300) {
    const error = new Error('Faixa de legenda invalida.');
    error.statusCode = 400;
    throw error;
  }
  return id;
}

async function fingerprintFile(filePath) {
  const content = await fs.readFile(filePath);
  const stats = await fs.stat(filePath);
  return {
    sizeBytes: stats.size,
    mtimeMs: Math.round(stats.mtimeMs),
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  };
}

function fingerprintsEqual(a, b) {
  if (!a || !b) return true;
  return Number(a.sizeBytes) === Number(b.sizeBytes)
    && Number(a.mtimeMs) === Number(b.mtimeMs)
    && String(a.sha256 || '') === String(b.sha256 || '');
}

async function assertUnchanged(filePath, expectedFingerprint) {
  if (!expectedFingerprint) return;
  let current;
  try { current = await fingerprintFile(filePath); }
  catch (error) {
    if (error.code === 'ENOENT') {
      const wrapped = new Error('A legenda foi alterada externamente enquanto estava aberta. Recarregue antes de salvar.');
      wrapped.statusCode = 409;
      wrapped.code = 'SUBTITLE_CHANGED_EXTERNALLY';
      throw wrapped;
    }
    throw error;
  }
  if (!fingerprintsEqual(current, expectedFingerprint)) {
    const error = new Error('A legenda foi alterada externamente enquanto estava aberta. Recarregue a versão atual antes de salvar.');
    error.statusCode = 409;
    error.code = 'SUBTITLE_CHANGED_EXTERNALLY';
    throw error;
  }
}

async function atomicWriteText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await fs.open(temp, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function loadHistory(itemState) {
  const history = {};
  for (const [trackId, entries] of Object.entries(itemState.history || {})) {
    history[trackId] = await Promise.all((Array.isArray(entries) ? entries : []).map(async (entry) => ({
      id: entry.id,
      trackId,
      language: entry.language,
      createdAt: entry.createdAt,
      sizeBytes: entry.sizeBytes,
      provider: entry.provider,
      providerId: entry.providerId,
      sourceType: entry.sourceType,
      sourceLabel: entry.sourceLabel,
      lastAppliedOffsetMs: entry.lastAppliedOffsetMs,
      metadata: entry.metadata || {},
      reason: entry.reason,
      valid: Boolean(entry.fileName && await pathExists(path.join(stateStore.HISTORY_DIR, path.basename(entry.fileName))))
    })));
  }
  return history;
}

async function describeTracks(context, itemState) {
  const descriptors = await context.listTrackDescriptors();
  return Promise.all((Array.isArray(descriptors) ? descriptors : []).map(async (descriptor) => {
    const trackId = normalizeTrackId(descriptor.trackId || descriptor.language);
    const metadata = itemState.tracks[trackId] || null;
    const stats = descriptor.filePath ? await fs.stat(descriptor.filePath).catch(() => null) : null;
    return {
      trackId,
      language: descriptor.language || 'und',
      fileName: descriptor.fileName || (descriptor.filePath ? path.basename(descriptor.filePath) : ''),
      format: String(descriptor.format || 'srt').toLowerCase(),
      flags: Array.isArray(descriptor.flags) ? descriptor.flags : [],
      editable: descriptor.editable !== false && String(descriptor.format || 'srt').toLowerCase() === 'srt',
      embedded: Boolean(descriptor.embedded),
      sizeBytes: stats ? stats.size : (Number(descriptor.sizeBytes) || 0),
      sourceLabel: metadata ? trackLabel(metadata) : (descriptor.sourceLabel || trackLabel(metadata)),
      provider: metadata?.provider || descriptor.provider || 'local',
      providerId: metadata?.providerId || descriptor.providerId || null,
      sourceType: metadata?.sourceType || descriptor.sourceType || 'unregistered',
      lastAppliedOffsetMs: Number(metadata?.lastAppliedOffsetMs) || 0,
      appliedAt: metadata?.appliedAt || null,
      staleTranslation: Boolean(descriptor.staleTranslation),
      metadata: metadata?.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : (descriptor.metadata || {}),
      selectable: descriptor.selectable !== false
    };
  }));
}

async function getStatus(context, extra = {}) {
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.itemId);
  const tracks = await describeTracks(context, itemState);
  return {
    itemId: context.itemId,
    mediaAvailable: Boolean(context.mediaPath),
    canApply: Boolean(context.activeWritable),
    tracks,
    history: await loadHistory(itemState),
    ...extra
  };
}

async function resolveEditableTrack(context, trackId, { allowMissing = false } = {}) {
  const id = normalizeTrackId(trackId);
  const track = await context.resolveTrack(id, { allowMissing });
  if (!track) {
    const error = new Error('Legenda local nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  if (track.editable === false || String(track.format || 'srt').toLowerCase() !== 'srt') {
    const error = new Error('Este formato de legenda e somente leitura nesta versao.');
    error.statusCode = 409;
    error.code = 'SUBTITLE_FORMAT_READ_ONLY';
    throw error;
  }
  return { ...track, trackId: id };
}

async function previewLocal(context, payload) {
  if (!context.mediaPath) {
    const error = new Error('Midia local nao disponivel.');
    error.statusCode = 404;
    throw error;
  }
  const trackId = normalizeTrackId(payload.trackId || payload.language);
  const track = await resolveEditableTrack(context, trackId);
  let text;
  try { text = await fs.readFile(track.filePath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') {
      const wrapped = new Error('Legenda local nao encontrada.');
      wrapped.statusCode = 404;
      throw wrapped;
    }
    throw error;
  }
  const cues = parseSrt(text);
  if (!cues.length) {
    const error = new Error('A legenda local nao possui cues SRT validos.');
    error.statusCode = 422;
    throw error;
  }
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.itemId);
  const metadata = itemState.tracks[trackId];
  return {
    provider: metadata?.provider || track.provider || 'local',
    providerId: metadata?.providerId || track.providerId || null,
    sourceType: metadata?.sourceType || track.sourceType || 'unregistered',
    sourceLabel: track.sourceLabel || trackLabel(metadata),
    trackId,
    language: track.language || 'und',
    fileName: track.fileName || path.basename(track.filePath),
    cues,
    vtt: cuesToVtt(cues),
    fingerprint: await fingerprintFile(track.filePath)
  };
}

async function backupAndRegister(state, itemState, context, track, reason) {
  const trackId = normalizeTrackId(track.trackId || track.language);
  const currentTrack = itemState.tracks[trackId] || {
    provider: track.provider || 'local',
    providerId: track.providerId || null,
    sourceType: track.sourceType || 'unregistered',
    sourceLabel: track.sourceLabel || 'Arquivo local · origem não registrada',
    lastAppliedOffsetMs: 0,
    metadata: track.metadata || {}
  };
  const backup = await historyService.backupCurrent({
    itemId: context.itemId,
    language: trackId,
    sidecarPath: track.filePath,
    trackState: currentTrack,
    metadata: { reason }
  });
  if (!backup) return null;
  const entries = Array.isArray(itemState.history[trackId]) ? itemState.history[trackId] : [];
  entries.unshift(backup);
  itemState.history[trackId] = await historyService.pruneHistory(entries);
  return backup;
}

async function backupTrack(context, trackId, reason = 'external-change') {
  const track = await resolveEditableTrack(context, trackId);
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.itemId);
  const backup = await backupAndRegister(state, itemState, context, track, reason);
  if (backup) await stateStore.save(state);
  return backup;
}

async function applyOffset(context, payload) {
  if (!context.activeWritable) {
    const error = new Error('Salvar offset exige um item ativo e gravavel.');
    error.statusCode = 409;
    throw error;
  }
  const trackId = normalizeTrackId(payload.trackId || payload.language);
  const offsetMs = normalizeOffsetMs(payload.offsetMs);
  const track = await resolveEditableTrack(context, trackId);
  await assertUnchanged(track.filePath, payload.expectedFingerprint || null);
  let text;
  try { text = await fs.readFile(track.filePath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') {
      const wrapped = new Error('Legenda ativa nao encontrada.');
      wrapped.statusCode = 404;
      throw wrapped;
    }
    throw error;
  }
  const cues = parseSrt(text);
  if (!cues.length) {
    const error = new Error('Nao foi possivel interpretar o SRT ativo com seguranca.');
    error.statusCode = 422;
    throw error;
  }
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.itemId);
  await backupAndRegister(state, itemState, context, track, 'offset');
  await atomicWriteText(track.filePath, writeSrt(shiftCues(cues, offsetMs)));
  const previous = itemState.tracks[trackId] || {
    provider: track.provider || 'local',
    sourceType: track.sourceType || 'unregistered',
    sourceLabel: track.sourceLabel || 'Arquivo local · origem não registrada',
    metadata: track.metadata || {}
  };
  itemState.tracks[trackId] = {
    ...previous,
    appliedAt: nowIso(),
    lastAppliedOffsetMs: (Number(previous.lastAppliedOffsetMs) || 0) + offsetMs
  };
  await stateStore.save(state);
  if (typeof context.afterMutation === 'function') await context.afterMutation({ action: 'offset', trackId });
  return {
    trackId,
    language: track.language || 'und',
    offsetMs,
    totalOffsetMs: itemState.tracks[trackId].lastAppliedOffsetMs,
    historyCount: (itemState.history[trackId] || []).length,
    fingerprint: await fingerprintFile(track.filePath)
  };
}

async function restoreHistory(context, payload) {
  if (!context.activeWritable) {
    const error = new Error('Restaurar legenda exige um item ativo e gravavel.');
    error.statusCode = 409;
    throw error;
  }
  const trackId = normalizeTrackId(payload.trackId || payload.language);
  const historyId = String(payload.historyId || '').trim();
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.itemId);
  const entries = Array.isArray(itemState.history[trackId]) ? itemState.history[trackId] : [];
  const index = entries.findIndex((entry) => entry.id === historyId);
  if (index < 0) {
    const error = new Error('Versao historica nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  const selected = entries[index];
  const historicalText = await historyService.readHistory(selected);
  const cues = parseSrt(historicalText);
  if (!cues.length) {
    const error = new Error('A versao historica nao contem um SRT valido.');
    error.statusCode = 422;
    throw error;
  }
  const track = await context.resolveTrack(trackId, { allowMissing: true, historyEntry: selected });
  if (!track || !track.filePath) {
    const error = new Error('Nao foi possivel determinar onde restaurar a legenda.');
    error.statusCode = 409;
    throw error;
  }
  if (track.editable === false || String(track.format || 'srt').toLowerCase() !== 'srt') {
    const error = new Error('O historico so pode restaurar uma faixa SRT editavel.');
    error.statusCode = 409;
    throw error;
  }
  if (await pathExists(track.filePath)) {
    await assertUnchanged(track.filePath, payload.expectedFingerprint || null);
    await backupAndRegister(state, itemState, context, { ...track, trackId }, 'restore');
  }
  const currentEntries = itemState.history[trackId] || [];
  const restoredIndex = currentEntries.findIndex((entry) => entry.id === historyId);
  if (restoredIndex >= 0) currentEntries.splice(restoredIndex, 1);
  await atomicWriteText(track.filePath, writeSrt(cues));
  itemState.tracks[trackId] = {
    provider: selected.provider || 'local',
    providerId: selected.providerId || null,
    sourceType: selected.sourceType || 'unregistered',
    sourceLabel: selected.sourceLabel || 'Arquivo local · origem não registrada',
    appliedAt: nowIso(),
    lastAppliedOffsetMs: Number(selected.lastAppliedOffsetMs) || 0,
    metadata: selected.metadata || {}
  };
  await stateStore.save(state);
  if (typeof context.afterMutation === 'function') await context.afterMutation({ action: 'restore', trackId });
  return { trackId, language: track.language || selected.language || 'und', restoredHistoryId: historyId, historyCount: (itemState.history[trackId] || []).length };
}

async function deleteLocalSubtitle(context, payload) {
  if (!context.activeWritable) {
    const error = new Error('Excluir legenda exige um item ativo e gravavel.');
    error.statusCode = 409;
    throw error;
  }
  const trackId = normalizeTrackId(payload.trackId || payload.language);
  const track = await resolveEditableTrack(context, trackId);
  await assertUnchanged(track.filePath, payload.expectedFingerprint || null);
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.itemId);
  await backupAndRegister(state, itemState, context, track, 'delete');
  await fs.rm(track.filePath, { force: true });
  delete itemState.tracks[trackId];
  await stateStore.save(state);
  if (typeof context.afterMutation === 'function') await context.afterMutation({ action: 'delete', trackId });
  return { trackId, language: track.language || 'und', historyCount: (itemState.history[trackId] || []).length, recoverable: (itemState.history[trackId] || []).length > 0 };
}

async function streamMedia(context, req, res, previewToken = '') {
  if (!context.mediaPath) {
    const error = new Error('Midia local nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  let target = context.mediaPath;
  if (previewToken) {
    const preview = mediaPreview.resolvePreview(previewToken, context.itemId);
    if (!preview) {
      const error = new Error('Previa compativel expirada ou invalida.');
      error.statusCode = 404;
      throw error;
    }
    target = preview.filePath;
  }
  await mediaPreview.streamFile(req, res, target);
}

async function createCompatiblePreview(context) {
  if (!context.mediaPath) {
    const error = new Error('Midia local nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  return mediaPreview.createCompatiblePreview({ config: context.config, itemId: context.itemId, mediaPath: context.mediaPath });
}

module.exports = {
  nowIso,
  trackLabel,
  normalizeTrackId,
  fingerprintFile,
  fingerprintsEqual,
  assertUnchanged,
  atomicWriteText,
  getStatus,
  previewLocal,
  backupTrack,
  applyOffset,
  restoreHistory,
  deleteLocalSubtitle,
  streamMedia,
  createCompatiblePreview
};
