const path = require('path');
const { sanitizeName, isPathInside } = require('./utils');
const { MEDIA_PROFILES, normalizeMediaProfile } = require('./mediaProfileService');
const { CHANNEL_SOURCE_KINDS } = require('./channelConfig');

const DESTINATION_TYPES = Object.freeze({
  LIBRARY: 'library',
  CHANNEL_GLOBAL: 'channel-global',
  CHANNEL_PLAYLIST: 'channel-playlist'
});

const GLOBAL_SOURCE_META = Object.freeze({
  uploads: { folderName: 'Uploads', label: 'Todos os uploads', tab: '' },
  videos: { folderName: 'Videos', label: 'Videos', tab: 'videos' },
  shorts: { folderName: 'Shorts', label: 'Shorts', tab: 'shorts' },
  streams: { folderName: 'Streams', label: 'Transmissoes finalizadas', tab: 'streams' }
});

function normalizeChannelUrl(channel) {
  const configured = String(channel && channel.url || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (channel && channel.channelId) return `https://www.youtube.com/channel/${channel.channelId}`;
  return '';
}

function libraryDestination(config, playlist) {
  const folderName = sanitizeName(playlist && playlist.name);
  if (!folderName) return null;
  const rootPath = path.join(config.paths.baseDir, folderName);
  return {
    id: folderName,
    type: DESTINATION_TYPES.LIBRARY,
    displayName: String(playlist.name || folderName),
    folderName,
    rootPath,
    baseRootPath: config.paths.baseDir,
    workRootPath: path.join(config.paths.baseDir, '.youtube-downloader-work', folderName),
    enabled: playlist.enabled !== false,
    mediaProfile: normalizeMediaProfile(playlist.mediaProfile),
    maxHeight: playlist.maxHeight == null ? null : Number(playlist.maxHeight),
    cookiesPath: String(playlist.cookiesPath || '').trim(),
    subtitles: playlist.subtitles || {},
    libraryId: playlist.libraryId || null,
    channelNumber: playlist.channelNumber || null,
    channelId: null,
    playlistId: null,
    sourceKind: 'library',
    urls: Array.isArray(playlist.urls) ? playlist.urls : (playlist.url ? [playlist.url] : []),
    sourceConfig: playlist
  };
}

function channelGlobalDestination(config, channel, sourceKind) {
  if (!CHANNEL_SOURCE_KINDS.includes(sourceKind)) return null;
  const meta = GLOBAL_SOURCE_META[sourceKind];
  const channelRoot = path.join(config.paths.channelsBaseDir, channel.folderName);
  const rootPath = path.join(channelRoot, meta.folderName);
  const canonical = normalizeChannelUrl(channel);
  const sourceUrl = meta.tab ? `${canonical}/${meta.tab}` : canonical;
  return {
    id: `channel:${channel.channelId}:${sourceKind}`,
    type: DESTINATION_TYPES.CHANNEL_GLOBAL,
    displayName: `${channel.name} - ${meta.label}`,
    folderName: meta.folderName,
    rootPath,
    baseRootPath: config.paths.channelsBaseDir,
    workRootPath: path.join(config.paths.channelsBaseDir, '.youtube-downloader-work', channel.channelId, sourceKind),
    enabled: channel.enabled !== false && Boolean(channel.globalSources && channel.globalSources[sourceKind]),
    mediaProfile: MEDIA_PROFILES.GENERIC,
    maxHeight: null,
    cookiesPath: '',
    subtitles: channel.globalSources && channel.globalSources.subtitles || {},
    libraryId: null,
    channelNumber: null,
    channelId: channel.channelId,
    playlistId: null,
    sourceKind,
    urls: sourceUrl ? [sourceUrl] : [],
    sourceConfig: channel
  };
}

function channelPlaylistDestination(config, channel, playlist) {
  const channelRoot = path.join(config.paths.channelsBaseDir, channel.folderName);
  const playlistRoot = path.join(channelRoot, 'Playlists', playlist.folderName);
  const url = String(playlist.url || (playlist.playlistId ? `https://www.youtube.com/playlist?list=${playlist.playlistId}` : '')).trim();
  return {
    id: `channel:${channel.channelId}:playlist:${playlist.playlistId}`,
    type: DESTINATION_TYPES.CHANNEL_PLAYLIST,
    displayName: playlist.name,
    folderName: playlist.folderName,
    rootPath: playlistRoot,
    baseRootPath: config.paths.channelsBaseDir,
    workRootPath: path.join(config.paths.channelsBaseDir, '.youtube-downloader-work', channel.channelId, 'playlists', playlist.playlistId),
    enabled: channel.enabled !== false && playlist.enabled !== false,
    mediaProfile: normalizeMediaProfile(playlist.mediaProfile),
    maxHeight: playlist.maxHeight == null ? null : Number(playlist.maxHeight),
    cookiesPath: String(playlist.cookiesPath || '').trim(),
    subtitles: playlist.subtitles || {},
    libraryId: playlist.libraryId || null,
    channelNumber: playlist.channelNumber || null,
    channelId: channel.channelId,
    playlistId: playlist.playlistId,
    sourceKind: 'playlist',
    urls: url ? [url] : [],
    sourceConfig: playlist,
    channelConfig: channel
  };
}

function getLibraryDestinations(config, options = {}) {
  return (config.playlists || [])
    .map((playlist) => libraryDestination(config, playlist))
    .filter(Boolean)
    .filter((destination) => options.includeDisabled || destination.enabled);
}

function getChannelDestinations(config, channelFilter = null, options = {}) {
  const result = [];
  for (const channel of config.channels || []) {
    if (channelFilter && channel.channelId !== channelFilter) continue;
    for (const sourceKind of CHANNEL_SOURCE_KINDS) {
      const destination = channelGlobalDestination(config, channel, sourceKind);
      if (destination && (options.includeDisabled || destination.enabled)) result.push(destination);
    }
    for (const playlist of channel.playlists || []) {
      const destination = channelPlaylistDestination(config, channel, playlist);
      if (destination && (options.includeDisabled || destination.enabled)) result.push(destination);
    }
  }
  return result;
}

function getAllDestinations(config, options = {}) {
  return [
    ...getLibraryDestinations(config, options),
    ...getChannelDestinations(config, null, options)
  ];
}

function findDestinationById(config, id, options = {}) {
  const target = String(id || '').trim();
  if (!target) return null;
  return getAllDestinations(config, { ...options, includeDisabled: true }).find((destination) => destination.id === target) || null;
}

function findChannel(config, channelId) {
  return (config.channels || []).find((channel) => channel.channelId === String(channelId || '').trim()) || null;
}

function findChannelPlaylist(config, channelId, playlistId) {
  const channel = findChannel(config, channelId);
  if (!channel) return null;
  const playlist = (channel.playlists || []).find((entry) => entry.playlistId === String(playlistId || '').trim()) || null;
  return playlist ? { channel, playlist } : null;
}

function assertDestinationPath(destination, candidate) {
  if (!destination || !destination.rootPath) throw new Error('Destino sem pasta raiz.');
  if (!isPathInside(destination.rootPath, candidate) && path.resolve(candidate) !== path.resolve(destination.rootPath)) {
    throw new Error('Caminho fora da raiz do destino.');
  }
  return candidate;
}

module.exports = {
  DESTINATION_TYPES,
  GLOBAL_SOURCE_META,
  normalizeChannelUrl,
  libraryDestination,
  channelGlobalDestination,
  channelPlaylistDestination,
  getLibraryDestinations,
  getChannelDestinations,
  getAllDestinations,
  findDestinationById,
  findChannel,
  findChannelPlaylist,
  assertDestinationPath
};
