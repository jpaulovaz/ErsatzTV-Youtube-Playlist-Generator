const logger = require('../logger');
const downloadManager = require('../downloadManager');
const scheduler = require('../scheduler');
const channelScheduler = require('../channelScheduler');
const discoveryLock = require('../discovery/discoveryLock');
const { listLibraryContent, getLibraryThumbnail, getLibraryFolderPoster } = require('../libraryContentService');
const { libraryDestination } = require('../destinationService');
const { handleSubtitleManagerAction } = require('./subtitleManagerRoutes');
const {
  runSync,
  runPlaylistApiAction,
  testPlaylistCookies,
  findPlaylist
} = require('../syncService');

function sanitizeEntryName(value) {
  return String(value || '').replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
}

async function handleLibraryRoutes(req, res, url, deps) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'playlists') return false;

  const playlistName = parts[2];
  const action = parts[3];
  let config = await deps.loadConfig();
  const playlist = findPlaylist(config, playlistName);
  if (!playlist) {
    deps.sendJson(res, 404, { ok: false, error: 'Biblioteca nao encontrada na configuracao.' });
    return true;
  }

  if (req.method === 'GET' && action === 'content') {
    const result = await listLibraryContent({
      config,
      playlist,
      downloadManager,
      browserPath: url.searchParams.get('path'),
      query: url.searchParams.get('q'),
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit'),
      view: url.searchParams.get('view'),
      subtitleOrigin: url.searchParams.get('subtitleOrigin')
    });
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method === 'GET' && action === 'content-thumbnail') {
    const thumbnail = await getLibraryThumbnail({
      config,
      playlist,
      downloadManager,
      itemId: url.searchParams.get('id')
    });
    if (!thumbnail) {
      deps.sendJson(res, 404, { ok: false, error: 'Thumbnail nao encontrada.' });
      return true;
    }
    deps.sendBuffer(res, 200, thumbnail.content, thumbnail.contentType, {
      'Cache-Control': 'private, max-age=60'
    });
    return true;
  }

  if (req.method === 'GET' && action === 'content-folder-poster') {
    const poster = await getLibraryFolderPoster({
      config,
      playlist,
      downloadManager,
      itemId: url.searchParams.get('id')
    });
    if (!poster) {
      deps.sendJson(res, 404, { ok: false, error: 'Poster nao encontrado.' });
      return true;
    }
    deps.sendBuffer(res, 200, poster.content, poster.contentType, {
      'Cache-Control': 'private, max-age=60'
    });
    return true;
  }

  const subtitleDestination = libraryDestination(config, playlist);
  if (subtitleDestination && await handleSubtitleManagerAction({ req, res, url, deps, config, destination: subtitleDestination, action })) return true;

  if (req.method !== 'POST') return false;

  if (action === 'run') {
    const lock = discoveryLock.getStatus();
    if (lock.locked) {
      deps.sendJson(res, 409, { ok: false, error: 'Ja existe uma descoberta/sincronizacao em execucao.' });
      return true;
    }
    runSync(config, { trigger: 'manual-playlist', playlistName }).catch((error) => {
      logger.error(`Descoberta manual da biblioteca falhou: ${error.message}`);
    });
    deps.sendJson(res, 202, { ok: true, message: `Descoberta iniciada para ${playlist.folderName}.` });
    return true;
  }

  let result;
  if (action === 'test-cookies') {
    result = await testPlaylistCookies(config, playlistName);
  } else if (action === 'refresh-subtitles') {
    result = await downloadManager.queueMissingSubtitles(playlist.folderName);
  } else if (action === 'content-action') {
    const payload = await deps.readJson(req);
    result = await downloadManager.runContentAction(playlist.folderName, payload.action, payload.itemIds);
  } else if (action === 'orphans-preview') {
    result = downloadManager.previewOrphans(playlist.folderName);
  } else if (action === 'orphans-cleanup') {
    const payload = await deps.readJson(req);
    if (payload.confirmed !== true) {
      deps.sendJson(res, 400, { ok: false, error: 'Confirme a limpeza depois de revisar o preview.' });
      return true;
    }
    result = await downloadManager.cleanupOrphans(playlist.folderName);
  } else if (action === 'delete-with-files') {
    const payload = await deps.readJson(req);
    const confirmation = String(payload.confirmation || '').trim();
    if (confirmation !== playlist.name && confirmation !== playlist.folderName) {
      deps.sendJson(res, 400, { ok: false, error: 'Confirmacao invalida. Digite exatamente o nome da biblioteca.' });
      return true;
    }
    const deleteResult = await downloadManager.deleteLibraryData(config, playlist);
    config.playlists = (config.playlists || []).filter((entry) => sanitizeEntryName(entry.name) !== playlist.folderName);
    config = await deps.saveConfig(config);
    scheduler.configure(config);
    channelScheduler.configure(config);
    downloadManager.configure(config);
    result = { ...deleteResult, config };
  } else {
    result = await runPlaylistApiAction(config, playlistName, action);
  }

  deps.sendJson(res, 200, { ok: true, result });
  return true;
}

module.exports = { handleLibraryRoutes, sanitizeEntryName };
