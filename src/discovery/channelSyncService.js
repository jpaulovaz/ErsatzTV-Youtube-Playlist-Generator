const fs = require('fs/promises');
const logger = require('../logger');
const downloadManager = require('../downloadManager');
const { saveConfig } = require('../config');
const {
  getChannelDestinations,
  findChannel,
  findChannelPlaylist
} = require('../destinationService');
const { analyzeChannel } = require('./channelCatalogService');
const { fetchDestinationVideos } = require('./youtubeSourceProvider');
const channelState = require('./channelState');
const discoveryLock = require('./discoveryLock');

const state = {
  running: false,
  currentStep: 'idle',
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null
};

function nowIso() { return new Date().toISOString(); }

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function mergeCatalogIntoChannel(channel, catalog) {
  const byId = new Map((catalog.playlists || []).map((playlist) => [playlist.playlistId, playlist]));
  const playlists = (channel.playlists || []).map((playlist) => {
    const remote = byId.get(playlist.playlistId);
    if (!remote) return { ...playlist };
    return {
      ...playlist,
      name: remote.name || playlist.name,
      url: remote.url || playlist.url
    };
  });
  return {
    ...channel,
    name: catalog.name || channel.name,
    handle: catalog.handle || channel.handle,
    url: catalog.url || channel.url,
    thumbnailUrl: catalog.thumbnailUrl || channel.thumbnailUrl,
    playlists
  };
}

function channelChanged(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

async function refreshChannelMetadata(config, channel, options = {}) {
  try {
    const catalog = await analyzeChannel(config, channel.url || `https://www.youtube.com/channel/${channel.channelId}`, options);
    if (catalog.channelId !== channel.channelId) {
      throw new Error('A URL configurada passou a apontar para outro channelId.');
    }
    const merged = mergeCatalogIntoChannel(channel, catalog);
    let savedConfig = config;
    if (channelChanged(channel, merged)) {
      const updatedConfig = clone(config);
      const index = updatedConfig.channels.findIndex((entry) => entry.channelId === channel.channelId);
      if (index >= 0) updatedConfig.channels[index] = merged;
      savedConfig = await saveConfig(updatedConfig);
    }
    const savedChannel = findChannel(savedConfig, channel.channelId) || merged;
    await channelState.updateCatalogAvailability(savedChannel, catalog);
    return { config: savedConfig, channel: savedChannel, catalog, changed: savedConfig !== config };
  } catch (error) {
    await channelState.updateChannel(channel.channelId, {
      available: false,
      lastCatalogError: error.message,
      lastCatalogAt: nowIso()
    });
    await logger.warn(`Nao foi possivel atualizar o catalogo do canal ${channel.name}: ${error.message}`);
    return { config, channel, catalog: null, changed: false, error };
  }
}

function summarizeDestination(destination) {
  return {
    destinationId: destination.id,
    destinationType: destination.type,
    displayName: destination.displayName,
    sourceKind: destination.sourceKind,
    playlistId: destination.playlistId || null,
    videosFound: 0,
    videosDuplicate: 0,
    downloadsQueued: 0,
    alreadyCompleted: 0,
    alreadyKnown: 0,
    reactivated: 0,
    orphaned: 0,
    readMode: null,
    quotaUnitsUsed: 0,
    failed: false,
    error: null
  };
}

async function processDestination(config, destination, summary, options = {}) {
  const entry = summarizeDestination(destination);
  summary.destinations.push(entry);
  try {
    await fs.mkdir(destination.rootPath, { recursive: true });
    const result = await fetchDestinationVideos(config, destination, options);
    entry.videosFound = (result.videos || []).length;
    entry.videosDuplicate = (result.duplicates || []).length;
    entry.readMode = result.readMode || 'ytdlp';
    entry.quotaUnitsUsed = Number(result.quotaUnitsUsed) || 0;
    const queue = await downloadManager.reconcileDestination(config, destination, result.videos || []);
    entry.downloadsQueued = queue.queued;
    entry.alreadyCompleted = queue.alreadyCompleted;
    entry.alreadyKnown = queue.alreadyKnown;
    entry.reactivated = queue.reactivated;
    entry.orphaned = queue.orphaned;
    summary.processed += 1;
    summary.videosFound += entry.videosFound;
    summary.downloadsQueued += entry.downloadsQueued;
    summary.orphaned += entry.orphaned;
    summary.quotaUnitsUsed += entry.quotaUnitsUsed;
    await channelState.updateDestination(destination.id, {
      available: true,
      lastSyncAt: nowIso(),
      lastError: null,
      lastSummary: entry
    });
  } catch (error) {
    entry.failed = true;
    entry.error = error.message;
    summary.failed += 1;
    await channelState.updateDestination(destination.id, {
      available: false,
      lastSyncAt: nowIso(),
      lastError: error.message
    });
    await logger.error(`Sincronizacao falhou para ${destination.displayName}: ${error.message}. O acervo local foi preservado.`);
  }
  return entry;
}

async function runChannelSync(config, options = {}) {
  const channelId = String(options.channelId || '').trim();
  let targetChannel = channelId ? findChannel(config, channelId) : null;
  if (channelId && !targetChannel) {
    const error = new Error('Canal nao encontrado na configuracao.');
    error.statusCode = 404;
    throw error;
  }
  if (state.running || !discoveryLock.acquire('channels')) {
    const error = new Error('Ja existe uma descoberta/sincronizacao em execucao.');
    error.code = 'SYNC_ALREADY_RUNNING';
    throw error;
  }

  state.running = true;
  state.currentStep = 'starting';
  state.startedAt = nowIso();
  state.finishedAt = null;
  state.lastError = null;
  const summary = {
    trigger: options.trigger || 'manual-channels',
    startedAt: state.startedAt,
    finishedAt: null,
    channelId: channelId || null,
    processed: 0,
    failed: 0,
    videosFound: 0,
    downloadsQueued: 0,
    orphaned: 0,
    quotaUnitsUsed: 0,
    destinations: []
  };

  try {
    await downloadManager.init(config);
    downloadManager.configure(config);
    let workingConfig = config;
    const channels = targetChannel ? [targetChannel] : (config.channels || []).filter((channel) => channel.enabled !== false);
    for (const originalChannel of channels) {
      state.currentStep = `catalog:${originalChannel.channelId}`;
      const refreshed = await refreshChannelMetadata(workingConfig, originalChannel, options);
      workingConfig = refreshed.config;
      const channel = findChannel(workingConfig, originalChannel.channelId) || originalChannel;
      await channelState.updateChannel(channel.channelId, {
        available: !refreshed.error,
        lastCatalogAt: nowIso(),
        lastCatalogError: refreshed.error ? refreshed.error.message : null,
        name: channel.name,
        handle: channel.handle
      });

      let destinations = getChannelDestinations(workingConfig, channel.channelId);
      if (options.playlistId) {
        destinations = destinations.filter((destination) => destination.playlistId === options.playlistId);
      }
      if (options.sourceKind) {
        destinations = destinations.filter((destination) => destination.sourceKind === options.sourceKind);
      }
      for (const destination of destinations) {
        state.currentStep = `sync:${destination.id}`;
        await processDestination(workingConfig, destination, summary, options);
      }
    }
    summary.finishedAt = nowIso();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'idle';
    state.lastResult = summary;
    await logger.info('Sincronizacao de Canais finalizada.', summary);
    return summary;
  } catch (error) {
    summary.finishedAt = nowIso();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'error';
    state.lastError = { message: error.message, stack: error.stack };
    state.lastResult = summary;
    await logger.error(`Sincronizacao de Canais interrompida: ${error.message}`);
    throw error;
  } finally {
    state.running = false;
    discoveryLock.release('channels');
  }
}

async function runChannelPlaylist(config, channelId, playlistId, options = {}) {
  const found = findChannelPlaylist(config, channelId, playlistId);
  if (!found) {
    const error = new Error('Playlist do canal nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }
  return runChannelSync(config, { ...options, channelId, playlistId, trigger: options.trigger || 'manual-channel-playlist' });
}

function getState() { return clone(state); }

module.exports = {
  mergeCatalogIntoChannel,
  refreshChannelMetadata,
  processDestination,
  runChannelSync,
  runChannelPlaylist,
  getState
};
