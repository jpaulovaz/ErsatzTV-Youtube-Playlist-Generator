const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { getSubtitleSidecarPath, listSubtitleSidecars } = require('../subtitleService');
const { isPathInside, pathExists } = require('../utils');
const { getQuarantineRoot } = require('../orphans/quarantineService');
const { STORAGE_STATES } = require('../orphans/orphanPolicy');
const { MEDIA_PROFILES } = require('../mediaProfileService');
const stateStore = require('./subtitleManagerState');
const historyService = require('./subtitleHistoryService');
const { parseSrt, writeSrt, cuesToVtt, normalizeCues } = require('./subtitleFormats');
const { shiftCues, normalizeOffsetMs } = require('./subtitleTiming');
const youtubeProvider = require('../subtitleProviders/youtubeProvider');
const lrclibProvider = require('../subtitleProviders/lrclibProvider');
const mediaPreview = require('../mediaPreviewService');
const subtitleCore = require('./subtitleCore');

const providers = { youtube: youtubeProvider, lrclib: lrclibProvider };
const TARGET_LANGUAGES = Object.freeze(['pt-BR', 'en', 'es']);

function nowIso() { return new Date().toISOString(); }

function normalizeTargetLanguage(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase().replace(/_/g, '-');
  if (['pt-br', 'ptbr', 'portugues-brasil', 'portuguese-brazil'].includes(key)) return 'pt-BR';
  if (['en', 'english', 'ingles'].includes(key)) return 'en';
  if (['es', 'spanish', 'espanol'].includes(key)) return 'es';
  const error = new Error('Idioma de destino invalido. Use pt-BR, en ou es.');
  error.statusCode = 400;
  throw error;
}

function normalizeLanguage(value) {
  const lang = String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
  if (!lang) {
    const error = new Error('Idioma de legenda invalido.');
    error.statusCode = 400;
    throw error;
  }
  return lang;
}

function findItem(downloadManager, destination, itemId) {
  const id = String(itemId || '').trim();
  const item = downloadManager.getDestinationItems(destination.id).find((entry) => entry.id === id);
  if (!item) {
    const error = new Error('Item de conteudo nao encontrado neste destino.');
    error.statusCode = 404;
    throw error;
  }
  return item;
}

function mediaPathForItem(item, destination) {
  const storage = item.storageState || STORAGE_STATES.ACTIVE;
  if (storage === STORAGE_STATES.QUARANTINED && item.quarantine && Array.isArray(item.quarantine.files)) {
    const video = item.quarantine.files.find((file) => file.kind === 'video' && file.quarantine);
    if (video) {
      const root = getQuarantineRoot(destination);
      if (isPathInside(root, video.quarantine)) return video.quarantine;
    }
  }
  if (item.targetPath && isPathInside(destination.rootPath, item.targetPath)) return item.targetPath;
  return '';
}

async function resolveContext({ config, destination, downloadManager, itemId }) {
  const item = findItem(downloadManager, destination, itemId);
  const mediaPath = mediaPathForItem(item, destination);
  const mediaExists = mediaPath ? await pathExists(mediaPath) : false;
  const activeWritable = (item.storageState || STORAGE_STATES.ACTIVE) === STORAGE_STATES.ACTIVE
    && item.targetPath && isPathInside(destination.rootPath, item.targetPath) && await pathExists(item.targetPath);
  return {
    config, destination, downloadManager, item, itemId: item.id, videoId: item.videoId,
    url: item.url || (item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : ''),
    durationSeconds: Number(item.durationSeconds) || null,
    mediaProfile: item.mediaProfile || destination.mediaProfile,
    sourceConfig: destination.sourceConfig || {},
    mediaPath: mediaExists ? mediaPath : '',
    activeWritable: Boolean(activeWritable)
  };
}

function languageFromSidecar(mediaPath, sidecarPath) {
  const media = path.parse(mediaPath);
  const base = path.basename(sidecarPath);
  const prefix = `${media.name}.`;
  if (!base.startsWith(prefix) || !base.toLowerCase().endsWith('.srt')) return 'und';
  return base.slice(prefix.length, -4) || 'und';
}

const trackLabel = subtitleCore.trackLabel;

async function localTracks(context, managerItemState) {
  if (!context.mediaPath) return [];
  const paths = await listSubtitleSidecars(context.mediaPath);
  const tracks = [];
  for (const filePath of paths) {
    const language = languageFromSidecar(context.mediaPath, filePath);
    const metadata = managerItemState.tracks[language] || null;
    const stats = await fs.stat(filePath);
    let staleTranslation = false;
    const trackMetadata = metadata && metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
    if (metadata?.provider === 'gemini' && trackMetadata.sourceLanguage && trackMetadata.sourceHash) {
      const sourcePath = getSubtitleSidecarPath(context.mediaPath, trackMetadata.sourceLanguage);
      try {
        const sourceText = await fs.readFile(sourcePath, 'utf8');
        const currentHash = `sha256:${crypto.createHash('sha256').update(sourceText, 'utf8').digest('hex')}`;
        staleTranslation = currentHash !== trackMetadata.sourceHash;
      } catch { staleTranslation = true; }
    }
    tracks.push({
      language, sizeBytes: stats.size, sourceLabel: trackLabel(metadata), provider: metadata?.provider || 'local',
      providerId: metadata?.providerId || null, sourceType: metadata?.sourceType || 'unregistered',
      lastAppliedOffsetMs: Number(metadata?.lastAppliedOffsetMs) || 0, appliedAt: metadata?.appliedAt || null,
      staleTranslation, metadata: trackMetadata, selectable: true
    });
  }
  tracks.sort((a, b) => a.language.localeCompare(b.language));
  return tracks;
}

function managedCoreContext(context) {
  return {
    config: context.config,
    itemId: context.item.id,
    mediaPath: context.mediaPath,
    activeWritable: context.activeWritable,
    async listTrackDescriptors() {
      if (!context.mediaPath) return [];
      const paths = await listSubtitleSidecars(context.mediaPath);
      const state = await stateStore.load();
      const itemState = stateStore.ensureItem(state, context.item.id);
      const descriptors = [];
      for (const filePath of paths) {
        const language = languageFromSidecar(context.mediaPath, filePath);
        const metadata = itemState.tracks[language] || null;
        const trackMetadata = metadata && metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
        let staleTranslation = false;
        if (metadata?.provider === 'gemini' && trackMetadata.sourceLanguage && trackMetadata.sourceHash) {
          const sourcePath = getSubtitleSidecarPath(context.mediaPath, trackMetadata.sourceLanguage);
          try {
            const sourceText = await fs.readFile(sourcePath, 'utf8');
            const currentHash = `sha256:${crypto.createHash('sha256').update(sourceText, 'utf8').digest('hex')}`;
            staleTranslation = currentHash !== trackMetadata.sourceHash;
          } catch { staleTranslation = true; }
        }
        descriptors.push({
          trackId: language,
          language,
          filePath,
          fileName: path.basename(filePath),
          format: 'srt',
          editable: true,
          staleTranslation,
          metadata: trackMetadata,
          selectable: true
        });
      }
      return descriptors;
    },
    async resolveTrack(trackId, { allowMissing = false } = {}) {
      const language = normalizeLanguage(trackId);
      const baseMediaPath = context.item.targetPath || context.mediaPath;
      if (!baseMediaPath) return null;
      const filePath = getSubtitleSidecarPath(baseMediaPath, language);
      if (!isPathInside(path.dirname(baseMediaPath), filePath)) {
        const error = new Error('Caminho de legenda invalido.');
        error.statusCode = 400;
        throw error;
      }
      if (!allowMissing && !(await pathExists(filePath))) return null;
      return { trackId: language, language, filePath, fileName: path.basename(filePath), format: 'srt', editable: true };
    },
    afterMutation: async () => syncDownloadSubtitleState(context)
  };
}

async function getStatus(args) {
  const context = await resolveContext(args);
  return subtitleCore.getStatus(managedCoreContext(context), {
    videoId: context.videoId || '',
    mediaProfile: context.mediaProfile,
    providers: {
      youtube: { available: Boolean(context.videoId || context.url) },
      lrclib: { available: context.mediaProfile === MEDIA_PROFILES.MUSIC_CLIPS }
    },
    queryDefaults: {
      artist: String(context.item.artist || context.item.channelTitle || '').trim(),
      track: String(context.item.trackTitle || context.item.title || '').trim(),
      album: String(context.item.album || '').trim()
    }
  });
}

function validateProvider(context, name) {
  const provider = providers[String(name || '').trim().toLowerCase()];
  if (!provider) {
    const error = new Error('Provider de legenda nao suportado.');
    error.statusCode = 400;
    throw error;
  }
  if (provider === lrclibProvider && context.mediaProfile !== MEDIA_PROFILES.MUSIC_CLIPS) {
    const error = new Error('LRCLIB esta disponivel apenas para o perfil Clipes musicais.');
    error.statusCode = 400;
    throw error;
  }
  return provider;
}

async function search(args, payload) {
  const context = await resolveContext(args);
  const providerName = String(payload.provider || '').toLowerCase();
  const provider = validateProvider(context, providerName);
  const targetLanguage = normalizeTargetLanguage(payload.language || 'pt-BR');
  const result = await provider.search(context, payload.query || {}, { targetLanguage });
  return { provider: providerName, targetLanguage, ...result };
}

async function materializeCandidate(context, payload, options = {}) {
  const providerName = String(payload.provider || '').toLowerCase();
  const provider = validateProvider(context, providerName);
  const candidate = { candidateId: String(payload.candidateId || ''), providerId: String(payload.candidateId || '') };
  const language = options.forApply ? normalizeTargetLanguage(payload.language) : undefined;
  return provider.materialize(context, candidate, { language });
}

async function previewCandidate(args, payload) {
  const context = await resolveContext(args);
  const normalized = await materializeCandidate(context, payload, { forApply: false });
  return {
    provider: normalized.provider,
    providerId: normalized.providerId,
    sourceType: normalized.sourceType,
    sourceLabel: normalized.sourceLabel,
    language: normalized.language,
    cues: normalizeCues(normalized.cues),
    vtt: cuesToVtt(normalized.cues),
    metadata: normalized.metadata || {}
  };
}

async function previewLocal(args, payload) {
  const context = await resolveContext(args);
  return subtitleCore.previewLocal(managedCoreContext(context), payload);
}

async function atomicWriteText(filePath, content) {
  return subtitleCore.atomicWriteText(filePath, content);
}

async function syncDownloadSubtitleState(context) {
  if (!context.item.targetPath) return;
  const sidecars = await listSubtitleSidecars(context.item.targetPath).catch(() => []);
  const languages = sidecars.map((filePath) => languageFromSidecar(context.item.targetPath, filePath));
  context.item.subtitles = context.item.subtitles && typeof context.item.subtitles === 'object' ? context.item.subtitles : {};
  context.item.subtitles.foundLanguages = [...new Set(languages)];
  context.item.subtitles.status = languages.length ? 'complete' : 'unavailable';
  context.item.subtitles.updatedAt = nowIso();
  if (typeof context.downloadManager.saveNow === 'function') await context.downloadManager.saveNow();
}

async function backupAndRegister(state, itemState, context, language, sidecarPath, reason) {
  const currentTrack = itemState.tracks[language] || null;
  const backup = await historyService.backupCurrent({ itemId: context.item.id, language, sidecarPath, trackState: currentTrack, metadata: { reason } });
  if (!backup) return;
  const entries = Array.isArray(itemState.history[language]) ? itemState.history[language] : [];
  entries.unshift(backup);
  itemState.history[language] = await historyService.pruneHistory(entries);
}

async function applyCandidate(args, payload) {
  const context = await resolveContext(args);
  if (!context.activeWritable) {
    const error = new Error('Aplicar legenda exige um item ativo com arquivo local gravavel.'); error.statusCode = 409; throw error;
  }
  const language = normalizeTargetLanguage(payload.language);
  const normalized = await materializeCandidate(context, { ...payload, language }, { forApply: true });
  const initialOffsetMs = payload.offsetMs == null ? 0 : normalizeOffsetMs(payload.offsetMs);
  const appliedCues = initialOffsetMs ? shiftCues(normalized.cues, initialOffsetMs) : normalized.cues;
  const sidecarPath = getSubtitleSidecarPath(context.item.targetPath, language);
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.item.id);
  await backupAndRegister(state, itemState, context, language, sidecarPath, 'replace');
  await atomicWriteText(sidecarPath, writeSrt(appliedCues));
  itemState.tracks[language] = {
    provider: normalized.provider, providerId: normalized.providerId || null, sourceType: normalized.sourceType,
    sourceLabel: normalized.sourceLabel, appliedAt: nowIso(), lastAppliedOffsetMs: initialOffsetMs, metadata: normalized.metadata || {}
  };
  await stateStore.save(state);
  await syncDownloadSubtitleState(context);
  return { language, sourceLabel: normalized.sourceLabel, appliedOffsetMs: initialOffsetMs, historyCount: (itemState.history[language] || []).length };
}

async function applyOffset(args, payload) {
  const context = await resolveContext(args);
  return subtitleCore.applyOffset(managedCoreContext(context), payload);
}

async function restoreHistory(args, payload) {
  const context = await resolveContext(args);
  return subtitleCore.restoreHistory(managedCoreContext(context), payload);
}

async function deleteLocalSubtitle(args, payload) {
  const context = await resolveContext(args);
  return subtitleCore.deleteLocalSubtitle(managedCoreContext(context), payload);
}


async function registerManagedDownload(item, movedEntries) {
  const entries = Array.isArray(movedEntries) ? movedEntries : [];
  if (!item || !item.id || !entries.length) return;
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, item.id);
  let changed = false;
  for (const entry of entries) {
    const language = String(entry && entry.language || '').trim();
    if (!language) continue;
    itemState.tracks[language] = {
      provider: String(entry.provider || 'youtube'),
      providerId: entry.providerId || null,
      sourceType: String(entry.sourceType || 'unknown'),
      sourceLabel: String(entry.sourceLabel || 'YouTube · tipo não identificado'),
      appliedAt: nowIso(),
      lastAppliedOffsetMs: 0,
      metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}
    };
    changed = true;
  }
  if (changed) await stateStore.save(state);
}

async function applyGeneratedSubtitle(args, payload = {}) {
  const context = await resolveContext(args);
  if (!context.activeWritable) { const error = new Error('Aplicar legenda gerada exige um item ativo com arquivo local gravavel.'); error.statusCode = 409; throw error; }
  const rawLanguage = String(payload.language || '').trim();
  const language = rawLanguage.toLowerCase() === 'und' ? 'und' : normalizeTargetLanguage(rawLanguage);
  const sidecarPath = getSubtitleSidecarPath(context.item.targetPath, language);
  if (!isPathInside(path.dirname(context.item.targetPath), sidecarPath)) { const error = new Error('Caminho de legenda invalido.'); error.statusCode = 400; throw error; }
  const cues = parseSrt(String(payload.content || ''));
  if (!cues.length) { const error = new Error('Legenda gerada nao contem um SRT valido.'); error.statusCode = 422; throw error; }
  const exists = await pathExists(sidecarPath);
  if (exists && payload.replace !== true) { const error = new Error('Ja existe legenda no idioma de destino.'); error.statusCode = 409; throw error; }
  const state = await stateStore.load();
  const itemState = stateStore.ensureItem(state, context.item.id);
  if (exists) await backupAndRegister(state, itemState, context, language, sidecarPath, payload.reason || 'replace');
  await atomicWriteText(sidecarPath, writeSrt(cues));
  const track = payload.track && typeof payload.track === 'object' ? payload.track : {};
  itemState.tracks[language] = {
    provider: String(track.provider || 'local'), providerId: track.providerId || null,
    sourceType: String(track.sourceType || 'generated'), sourceLabel: String(track.sourceLabel || 'Legenda gerada'),
    appliedAt: nowIso(), lastAppliedOffsetMs: 0,
    metadata: track.metadata && typeof track.metadata === 'object' ? track.metadata : {}
  };
  await stateStore.save(state);
  await syncDownloadSubtitleState(context);
  return { language, sourceLabel: itemState.tracks[language].sourceLabel, historyCount: (itemState.history[language] || []).length };
}

async function streamMedia(args, req, res, previewToken = '') {
  const context = await resolveContext(args);
  return subtitleCore.streamMedia(managedCoreContext(context), req, res, previewToken);
}

async function createCompatiblePreview(args) {
  const context = await resolveContext(args);
  return subtitleCore.createCompatiblePreview(managedCoreContext(context));
}

module.exports = {
  resolveContext,
  getStatus,
  search,
  previewCandidate,
  previewLocal,
  applyCandidate,
  applyOffset,
  restoreHistory,
  deleteLocalSubtitle,
  registerManagedDownload,
  applyGeneratedSubtitle,
  streamMedia,
  createCompatiblePreview,
  normalizeLanguage,
  normalizeTargetLanguage,
  TARGET_LANGUAGES,
  mediaPathForItem,
  languageFromSidecar
};
