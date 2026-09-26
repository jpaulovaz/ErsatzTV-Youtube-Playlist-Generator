const logger = require('../logger');
const downloadManager = require('../downloadManager');
const scheduler = require('../scheduler');
const channelScheduler = require('../channelScheduler');
const discoveryLock = require('../discovery/discoveryLock');
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
  if (req.method !== 'POST' || parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'playlists') return false;

  const playlistName = parts[2];
  const action = parts[3];
  let config = await deps.loadConfig();
  const playlist = findPlaylist(config, playlistName);
  if (!playlist) {
    deps.sendJson(res, 404, { ok: false, error: 'Biblioteca nao encontrada na configuracao.' });
    return true;
  }

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
  } else if (action === 'refresh-thumbnails') {
    result = await downloadManager.refreshThumbnails(playlist.folderName);
  } else if (action === 'refresh-subtitles') {
    result = await downloadManager.queueMissingSubtitles(playlist.folderName);
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
