const logger = require('../logger');
const downloadManager = require('../downloadManager');
const channelScheduler = require('../channelScheduler');
const { analyzeChannel } = require('../discovery/channelCatalogService');
const { runChannelSync, runChannelPlaylist, getState: getChannelSyncState } = require('../discovery/channelSyncService');
const channelState = require('../discovery/channelState');
const discoveryLock = require('../discovery/discoveryLock');
const {
  runPlaylistAction,
  runGlobalAction,
  removePlaylistConfig,
  deletePlaylistWithFiles,
  removeChannelConfig,
  deleteChannelWithFiles,
  getPlaylistDestination
} = require('../channelActionsService');
const { findChannel } = require('../destinationService');
const { listDestinationContent, getDestinationThumbnail, getDestinationFolderPoster } = require('../libraryContentService');
const { handleSubtitleManagerAction } = require('./subtitleManagerRoutes');

function parseParts(pathname) {
  return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

function ensureIdle() {
  const lock = discoveryLock.getStatus();
  if (lock.locked) {
    const error = new Error('Ja existe uma descoberta/sincronizacao em execucao.');
    error.statusCode = 409;
    error.code = 'SYNC_ALREADY_RUNNING';
    throw error;
  }
}

function applyConfigRuntime(config, deps) {
  deps.downloadManager.configure(config);
  deps.channelScheduler.configure(config);
  deps.libraryScheduler.configure(config);
}

async function handleChannelRoutes(req, res, url, deps) {
  if (!url.pathname.startsWith('/api/channels')) return false;
  const parts = parseParts(url.pathname);

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'analyze') {
    const payload = await deps.readJson(req);
    const config = await deps.loadConfig();
    const catalog = await analyzeChannel(config, payload.url);
    deps.sendJson(res, 200, { ok: true, catalog });
    return true;
  }

  if (req.method === 'GET' && parts.length === 3 && parts[2] === 'state') {
    const persistent = await channelState.load();
    deps.sendJson(res, 200, {
      ok: true,
      sync: getChannelSyncState(),
      scheduler: channelScheduler.getStatus(),
      state: persistent
    });
    return true;
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'run') {
    ensureIdle();
    const config = await deps.loadConfig();
    runChannelSync(config, { trigger: 'manual-channels' })
      .catch((error) => logger.error(`Sincronizacao manual de Canais falhou: ${error.message}`));
    deps.sendJson(res, 202, { ok: true, message: 'Atualizacao de Canais iniciada.' });
    return true;
  }

  if (parts.length < 3) return false;
  const channelId = parts[2];
  let config = await deps.loadConfig();
  const channel = findChannel(config, channelId);
  if (!channel) {
    deps.sendJson(res, 404, { ok: false, error: 'Canal nao encontrado na configuracao.' });
    return true;
  }

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'run') {
    ensureIdle();
    runChannelSync(config, { trigger: 'manual-channel', channelId }).catch((error) => logger.error(`Sincronizacao manual do canal falhou: ${error.message}`));
    deps.sendJson(res, 202, { ok: true, message: `Sincronizacao iniciada para ${channel.name}.` });
    return true;
  }

  if (req.method === 'POST' && parts.length === 5 && parts[3] === 'global') {
    const action = parts[4];
    const payload = ['orphans-cleanup'].includes(action) ? await deps.readJson(req) : {};
    const result = await runGlobalAction(config, channelId, action, payload);
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'remove-config') {
    const result = await removeChannelConfig(config, channelId);
    applyConfigRuntime(result.config, deps);
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'delete-with-files') {
    const payload = await deps.readJson(req);
    const result = await deleteChannelWithFiles(config, channelId, payload.confirmation);
    applyConfigRuntime(result.config, deps);
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (parts.length >= 5 && parts[3] === 'playlists') {
    const playlistId = parts[4];
    if (req.method === 'GET' && parts.length === 6 && parts[5] === 'content') {
      const { destination } = getPlaylistDestination(config, channelId, playlistId);
      const result = await listDestinationContent({
        destination,
        downloadManager,
        browserPath: url.searchParams.get('path'),
        query: url.searchParams.get('q'),
        offset: url.searchParams.get('offset'),
        limit: url.searchParams.get('limit'),
        view: url.searchParams.get('view')
      });
      deps.sendJson(res, 200, { ok: true, result });
      return true;
    }
    if (req.method === 'GET' && parts.length === 6 && parts[5] === 'content-thumbnail') {
      const { destination } = getPlaylistDestination(config, channelId, playlistId);
      const thumbnail = await getDestinationThumbnail({ destination, downloadManager, itemId: url.searchParams.get('id') });
      if (!thumbnail) {
        deps.sendJson(res, 404, { ok: false, error: 'Thumbnail nao encontrada.' });
        return true;
      }
      deps.sendBuffer(res, 200, thumbnail.content, thumbnail.contentType, { 'Cache-Control': 'private, max-age=60' });
      return true;
    }
    if (req.method === 'GET' && parts.length === 6 && parts[5] === 'content-folder-poster') {
      const { destination } = getPlaylistDestination(config, channelId, playlistId);
      const poster = await getDestinationFolderPoster({ destination, downloadManager, itemId: url.searchParams.get('id') });
      if (!poster) {
        deps.sendJson(res, 404, { ok: false, error: 'Poster nao encontrado.' });
        return true;
      }
      deps.sendBuffer(res, 200, poster.content, poster.contentType, { 'Cache-Control': 'private, max-age=60' });
      return true;
    }
    if (parts.length === 6) {
      const { destination } = getPlaylistDestination(config, channelId, playlistId);
      if (await handleSubtitleManagerAction({ req, res, url, deps, config, destination, action: parts[5] })) return true;
    }
    if (req.method === 'POST' && parts.length === 6 && parts[5] === 'run') {
      ensureIdle();
      runChannelPlaylist(config, channelId, playlistId, { trigger: 'manual-channel-playlist' })
        .catch((error) => logger.error(`Sincronizacao manual da playlist do canal falhou: ${error.message}`));
      deps.sendJson(res, 202, { ok: true, message: 'Sincronizacao da playlist iniciada.' });
      return true;
    }
    if (req.method === 'POST' && parts.length === 6 && parts[5] === 'remove-config') {
      const result = await removePlaylistConfig(config, channelId, playlistId);
      applyConfigRuntime(result.config, deps);
      deps.sendJson(res, 200, { ok: true, result });
      return true;
    }
    if (req.method === 'POST' && parts.length === 6 && parts[5] === 'delete-with-files') {
      const payload = await deps.readJson(req);
      const result = await deletePlaylistWithFiles(config, channelId, playlistId, payload.confirmation);
      applyConfigRuntime(result.config, deps);
      deps.sendJson(res, 200, { ok: true, result });
      return true;
    }
    if (req.method === 'POST' && parts.length === 6) {
      const action = parts[5];
      if (action === 'content-action') {
        const payload = await deps.readJson(req);
        const { destination } = getPlaylistDestination(config, channelId, playlistId);
        const result = await downloadManager.runContentAction(destination.id, payload.action, payload.itemIds);
        deps.sendJson(res, 200, { ok: true, result });
        return true;
      }
      const payload = action === 'orphans-cleanup' ? await deps.readJson(req) : {};
      const result = await runPlaylistAction(config, channelId, playlistId, action, payload);
      deps.sendJson(res, 200, { ok: true, result });
      return true;
    }
  }

  return false;
}

module.exports = { handleChannelRoutes, ensureIdle };
