const path = require('path');
const { sanitizeName, isDangerousBaseDir } = require('./utils');
const { DEFAULT_SUBTITLE_LANGUAGES, normalizeSubtitleLanguages } = require('./subtitleService');
const { MEDIA_PROFILES, normalizeMediaProfile } = require('./mediaProfileService');

const CHANNEL_SOURCE_KINDS = Object.freeze(['uploads', 'videos', 'shorts', 'streams']);
const CHANNEL_SOURCE_SET = new Set(CHANNEL_SOURCE_KINDS);

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function toOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function normalizeOptionalMaxHeight(value, allowedHeights) {
  if (value === null || value === undefined || value === '') return null;
  const height = Number(value);
  if (!Number.isFinite(height) || !allowedHeights.has(Math.floor(height))) return null;
  return Math.floor(height);
}

function normalizeSubtitles(rawValue, options = {}) {
  const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const configuredLanguages = hasOwn(raw, 'languages');
  const languages = normalizeSubtitleLanguages(raw.languages);
  return {
    enabled: Boolean(raw.enabled),
    includeAuto: raw.includeAuto !== false,
    languages: configuredLanguages ? languages : [...DEFAULT_SUBTITLE_LANGUAGES]
  };
}

function normalizeChannelPlaylist(rawPlaylist, allowedHeights) {
  const playlist = rawPlaylist && typeof rawPlaylist === 'object' ? rawPlaylist : {};
  const playlistId = String(playlist.playlistId || '').trim();
  const name = String(playlist.name || '').trim();
  const folderName = sanitizeName(String(playlist.folderName || name || playlistId).trim());
  return {
    playlistId,
    name,
    folderName,
    url: String(playlist.url || (playlistId ? `https://www.youtube.com/playlist?list=${playlistId}` : '')).trim(),
    enabled: playlist.enabled !== false,
    mediaProfile: normalizeMediaProfile(playlist.mediaProfile || MEDIA_PROFILES.GENERIC),
    libraryId: toOptionalPositiveInteger(playlist.libraryId),
    playoutId: toOptionalPositiveInteger(playlist.playoutId),
    maxHeight: normalizeOptionalMaxHeight(playlist.maxHeight, allowedHeights),
    cookiesPath: String(playlist.cookiesPath || '').trim(),
    subtitles: normalizeSubtitles(playlist.subtitles)
  };
}

function normalizeGlobalSources(rawGlobal) {
  const raw = rawGlobal && typeof rawGlobal === 'object' ? rawGlobal : {};
  return {
    uploads: Boolean(raw.uploads),
    videos: Boolean(raw.videos),
    shorts: Boolean(raw.shorts),
    streams: Boolean(raw.streams),
    subtitles: normalizeSubtitles(raw.subtitles)
  };
}

function normalizeChannel(rawChannel, allowedHeights) {
  const channel = rawChannel && typeof rawChannel === 'object' ? rawChannel : {};
  const channelId = String(channel.channelId || '').trim();
  const name = String(channel.name || '').trim();
  const handle = String(channel.handle || '').trim();
  const folderName = sanitizeName(String(channel.folderName || name || handle || channelId).trim());
  const playlists = Array.isArray(channel.playlists)
    ? channel.playlists.map((item) => normalizeChannelPlaylist(item, allowedHeights)).filter((item) => item.playlistId && item.name && item.folderName)
    : [];

  return {
    channelId,
    name,
    handle,
    url: String(channel.url || '').trim(),
    thumbnailUrl: String(channel.thumbnailUrl || '').trim(),
    uploadsPlaylistId: String(channel.uploadsPlaylistId || '').trim(),
    folderName,
    enabled: channel.enabled !== false,
    globalSources: normalizeGlobalSources(channel.globalSources),
    playlists
  };
}

function normalizeChannels(rawChannels, allowedHeights) {
  return (Array.isArray(rawChannels) ? rawChannels : [])
    .map((channel) => normalizeChannel(channel, allowedHeights))
    .filter((channel) => channel.channelId && channel.name && channel.folderName);
}

function validateChannels(config) {
  const channelsBaseDir = String(config && config.paths && config.paths.channelsBaseDir || '').trim();
  if (!path.isAbsolute(channelsBaseDir)) {
    throw new Error('A pasta base de Canais precisa ser um caminho absoluto.');
  }
  if (isDangerousBaseDir(channelsBaseDir)) {
    throw new Error('A pasta base de Canais e ampla demais. Use uma subpasta exclusiva.');
  }

  const seenChannels = new Set();
  const seenFolders = new Map();
  for (const channel of config.channels || []) {
    if (seenChannels.has(channel.channelId)) throw new Error(`O canal ${channel.name} esta cadastrado mais de uma vez.`);
    seenChannels.add(channel.channelId);

    const folderKey = channel.folderName.toLocaleLowerCase('pt-BR');
    if (seenFolders.has(folderKey)) {
      throw new Error(`Os canais "${seenFolders.get(folderKey)}" e "${channel.name}" usam a mesma pasta.`);
    }
    seenFolders.set(folderKey, channel.name);

    const globalSubtitles = channel.globalSources && channel.globalSources.subtitles;
    if (globalSubtitles && globalSubtitles.enabled && globalSubtitles.languages.length === 0) {
      throw new Error(`O canal "${channel.name}" esta com legendas globais ativas, mas sem idioma selecionado.`);
    }

    const seenPlaylists = new Set();
    const playlistFolders = new Map();
    for (const playlist of channel.playlists || []) {
      if (seenPlaylists.has(playlist.playlistId)) throw new Error(`A playlist "${playlist.name}" esta repetida no canal "${channel.name}".`);
      seenPlaylists.add(playlist.playlistId);
      const playlistFolderKey = playlist.folderName.toLocaleLowerCase('pt-BR');
      if (playlistFolders.has(playlistFolderKey)) {
        throw new Error(`As playlists "${playlistFolders.get(playlistFolderKey)}" e "${playlist.name}" do canal "${channel.name}" usam a mesma pasta.`);
      }
      playlistFolders.set(playlistFolderKey, playlist.name);
      if (playlist.subtitles && playlist.subtitles.enabled && playlist.subtitles.languages.length === 0) {
        throw new Error(`A playlist "${playlist.name}" esta com legendas ativas, mas sem idioma selecionado.`);
      }
    }
  }

  return config;
}

module.exports = {
  CHANNEL_SOURCE_KINDS,
  CHANNEL_SOURCE_SET,
  normalizeSubtitles,
  normalizeChannels,
  validateChannels
};
