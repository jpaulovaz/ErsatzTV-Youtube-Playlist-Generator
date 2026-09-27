const fs = require('fs/promises');
const path = require('path');
const downloadManager = require('./downloadManager');
const { saveConfig } = require('./config');
const { runLibraryAction } = require('./ersatztvService');
const { testDestinationCookies } = require('./syncService');
const {
  channelPlaylistDestination,
  getChannelDestinations,
  findChannel,
  findChannelPlaylist,
  DESTINATION_TYPES
} = require('./destinationService');
const channelState = require('./discovery/channelState');
const { isPathInside } = require('./utils');

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function getPlaylistDestination(config, channelId, playlistId) {
  const found = findChannelPlaylist(config, channelId, playlistId);
  if (!found) throw notFound('Playlist do canal nao encontrada na configuracao.');
  return { ...found, destination: channelPlaylistDestination(config, found.channel, found.playlist) };
}

async function runPlaylistAction(config, channelId, playlistId, action, payload = {}) {
  const { playlist, destination } = getPlaylistDestination(config, channelId, playlistId);
  if (action === 'test-cookies') return testDestinationCookies(config, destination);
  if (action === 'refresh-thumbnails') return downloadManager.refreshThumbnails(destination.id);
  if (action === 'refresh-subtitles') return downloadManager.queueMissingSubtitles(destination.id);
  if (action === 'orphans-preview') return downloadManager.previewOrphans(destination.id);
  if (action === 'orphans-cleanup') {
    if (payload.confirmed !== true) throw badRequest('Confirme a limpeza de orfaos depois de revisar o preview.');
    return downloadManager.cleanupOrphans(destination.id);
  }
  if (['scan', 'empty-trash', 'reset-playout'].includes(action)) {
    const result = await runLibraryAction(config, destination, action);
    return {
      ok: result.ok,
      destinationId: destination.id,
      playlistId: playlist.playlistId,
      action,
      libraryId: destination.libraryId,
      channelNumber: destination.channelNumber,
      result
    };
  }
  throw notFound('Acao da playlist nao suportada.');
}

function getGlobalDestinations(config, channelId) {
  const channel = findChannel(config, channelId);
  if (!channel) throw notFound('Canal nao encontrado na configuracao.');
  return getChannelDestinations(config, channelId, { includeDisabled: true })
    .filter((destination) => destination.type === DESTINATION_TYPES.CHANNEL_GLOBAL)
    .filter((destination) => channel.globalSources && channel.globalSources[destination.sourceKind]);
}

async function runGlobalAction(config, channelId, action, payload = {}) {
  const destinations = getGlobalDestinations(config, channelId);
  if (action === 'refresh-subtitles') {
    const results = [];
    for (const destination of destinations) {
      if (!destination.subtitles || !destination.subtitles.enabled) {
        results.push({ destinationId: destination.id, skipped: true, reason: 'Legendas desativadas.' });
        continue;
      }
      results.push({ destinationId: destination.id, result: await downloadManager.queueMissingSubtitles(destination.id) });
    }
    return { action, destinations: results };
  }
  if (action === 'orphans-preview') {
    const previews = destinations.map((destination) => ({ destinationId: destination.id, result: downloadManager.previewOrphans(destination.id) }));
    return {
      action,
      destinations: previews,
      count: previews.reduce((total, entry) => total + Number(entry.result.count || 0), 0),
      totalBytes: previews.reduce((total, entry) => total + Number(entry.result.totalBytes || 0), 0)
    };
  }
  if (action === 'orphans-cleanup') {
    if (payload.confirmed !== true) throw badRequest('Confirme a limpeza de orfaos depois de revisar o preview.');
    const results = [];
    for (const destination of destinations) {
      results.push({ destinationId: destination.id, result: await downloadManager.cleanupOrphans(destination.id) });
    }
    return { action, destinations: results };
  }
  throw notFound('Acao global do canal nao suportada.');
}

async function removePlaylistConfig(config, channelId, playlistId) {
  const channelIndex = (config.channels || []).findIndex((entry) => entry.channelId === channelId);
  if (channelIndex < 0) throw notFound('Canal nao encontrado na configuracao.');
  const playlist = (config.channels[channelIndex].playlists || []).find((entry) => entry.playlistId === playlistId);
  if (!playlist) throw notFound('Playlist do canal nao encontrada na configuracao.');
  const next = JSON.parse(JSON.stringify(config));
  next.channels[channelIndex].playlists = (next.channels[channelIndex].playlists || []).filter((entry) => entry.playlistId !== playlistId);
  const saved = await saveConfig(next);
  await channelState.removeDestination(`channel:${channelId}:playlist:${playlistId}`).catch(() => {});
  return { config: saved, playlist };
}

async function deletePlaylistWithFiles(config, channelId, playlistId, confirmation) {
  const { playlist, destination } = getPlaylistDestination(config, channelId, playlistId);
  if (String(confirmation || '').trim() !== playlist.name) {
    throw badRequest('Confirmacao invalida. Digite exatamente o nome atual da playlist.');
  }
  const deleted = await downloadManager.deleteDestinationData(config, destination);
  const removed = await removePlaylistConfig(config, channelId, playlistId);
  return { ...deleted, config: removed.config };
}

async function removeChannelConfig(config, channelId) {
  const channel = findChannel(config, channelId);
  if (!channel) throw notFound('Canal nao encontrado na configuracao.');
  const next = JSON.parse(JSON.stringify(config));
  next.channels = (next.channels || []).filter((entry) => entry.channelId !== channelId);
  const saved = await saveConfig(next);
  await channelState.removeChannel(channelId).catch(() => {});
  return { config: saved, channel };
}

async function deleteChannelWithFiles(config, channelId, confirmation) {
  const channel = findChannel(config, channelId);
  if (!channel) throw notFound('Canal nao encontrado na configuracao.');
  if (String(confirmation || '').trim() !== channel.name) {
    throw badRequest('Confirmacao invalida. Digite exatamente o nome atual do canal.');
  }
  const deleted = await downloadManager.deleteChannelData(config, channel);
  const removed = await removeChannelConfig(config, channelId);
  return { ...deleted, config: removed.config };
}

async function removeUntrackedChannelDirectory(config, channel) {
  const root = path.join(config.paths.channelsBaseDir, channel.folderName);
  if (!isPathInside(config.paths.channelsBaseDir, root)) throw badRequest('Pasta do canal fora da raiz configurada.');
  await fs.rm(root, { recursive: true, force: true });
  return root;
}

module.exports = {
  getPlaylistDestination,
  getGlobalDestinations,
  runPlaylistAction,
  runGlobalAction,
  removePlaylistConfig,
  deletePlaylistWithFiles,
  removeChannelConfig,
  deleteChannelWithFiles,
  removeUntrackedChannelDirectory
};
