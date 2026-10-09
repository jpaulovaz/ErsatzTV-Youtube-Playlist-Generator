const accountConfig = require('../youtubeManager/youtubeAccountConfig');
const accountService = require('../youtubeManager/youtubeAccountService');
const oauth = require('../youtubeManager/youtubeOAuthService');
const playlistService = require('../youtubeManager/youtubePlaylistService');
const playlistQueue = require('../youtubeManager/playlistQueue');
const localCatalog = require('../youtubeManager/localCatalogScanner');
const managerService = require('../youtubeManager/youtubeManagerService');
const adoptionService = require('../youtubeManager/adoptionService');
const adoptionQueue = require('../youtubeManager/adoptionQueue');

function queryFilters(url) {
  return {
    sourceId: url.searchParams.get('sourceId') || '',
    status: url.searchParams.get('status') || 'all',
    q: url.searchParams.get('q') || '',
    present: url.searchParams.get('present') || '',
    libraryPresence: url.searchParams.get('libraryPresence') || 'all',
    playlistStatus: url.searchParams.get('playlistStatus') || 'all',
    offset: url.searchParams.get('offset') || 0,
    limit: url.searchParams.get('limit') || 100
  };
}

async function handleYouTubeManagerRoutes(req, res, url, deps) {
  if (!url.pathname.startsWith('/api/youtube-manager/')) return false;
  const action = url.pathname.slice('/api/youtube-manager/'.length);

  if (req.method === 'GET' && action === 'status') {
    deps.sendJson(res, 200, { ok: true, result: await managerService.getStatus() }); return true;
  }
  if (req.method === 'POST' && action === 'search') {
    const payload = await deps.readJson(req);
    deps.sendJson(res, 200, { ok: true, result: await managerService.searchPublic(await deps.loadConfig(), payload) }); return true;
  }

  if (req.method === 'GET' && action === 'account/config') {
    const config = await accountConfig.load(); deps.sendJson(res, 200, { ok: true, result: accountConfig.publicStatus(config) }); return true;
  }
  if (req.method === 'PUT' && action === 'account/config') {
    const config = await accountConfig.save(await deps.readJson(req)); deps.sendJson(res, 200, { ok: true, result: accountConfig.publicStatus(config) }); return true;
  }
  if (req.method === 'GET' && action === 'account') {
    deps.sendJson(res, 200, { ok: true, result: await accountService.getStatus({ verify: false }) }); return true;
  }
  if (req.method === 'POST' && action === 'account/test') {
    const account = await accountService.refreshAccountSummary(); deps.sendJson(res, 200, { ok: true, result: { account, status: await accountService.getStatus({ verify: false }) } }); return true;
  }
  if (req.method === 'POST' && action === 'oauth/start') {
    deps.sendJson(res, 200, { ok: true, result: await oauth.startAuthorization() }); return true;
  }
  if (req.method === 'GET' && action === 'oauth/callback') {
    try {
      await oauth.handleCallback({
        state: url.searchParams.get('state') || '',
        code: url.searchParams.get('code') || '',
        error: url.searchParams.get('error') || '',
        errorDescription: url.searchParams.get('error_description') || ''
      });
      await accountService.refreshAccountSummary().catch(() => {});
      deps.redirect(res, '/?youtubeOAuth=success#youtube-manager');
    } catch (error) {
      deps.redirect(res, `/?youtubeOAuth=error&message=${encodeURIComponent(error.message)}#youtube-manager`);
    }
    return true;
  }
  if (req.method === 'POST' && action === 'oauth/disconnect') {
    deps.sendJson(res, 200, { ok: true, result: await oauth.disconnect() }); return true;
  }

  if (req.method === 'GET' && action === 'playlists') {
    deps.sendJson(res, 200, { ok: true, result: { playlists: await playlistService.listMine() } }); return true;
  }
  if (req.method === 'POST' && action === 'playlists') {
    deps.sendJson(res, 201, { ok: true, result: await playlistService.create(await deps.readJson(req)) }); return true;
  }
  if (req.method === 'GET' && action === 'playlist-items') {
    const playlistId = url.searchParams.get('playlistId') || '';
    deps.sendJson(res, 200, { ok: true, result: { items: await playlistService.listItems(playlistId) } }); return true;
  }
  if (req.method === 'POST' && action === 'playlist-plan') {
    deps.sendJson(res, 200, { ok: true, result: await managerService.planPlaylist(await deps.readJson(req)) }); return true;
  }
  if (req.method === 'POST' && action === 'playlist-start') {
    const payload = await deps.readJson(req);
    const plan = payload.plan || await managerService.planPlaylist(payload);
    deps.sendJson(res, 202, { ok: true, result: await managerService.startPlaylistJob(plan) }); return true;
  }
  if (req.method === 'POST' && action === 'playlist-pause') {
    deps.sendJson(res, 200, { ok: true, result: await playlistQueue.pause() }); return true;
  }
  if (req.method === 'POST' && action === 'playlist-resume') {
    deps.sendJson(res, 200, { ok: true, result: await playlistQueue.resume() }); return true;
  }
  if (req.method === 'POST' && action === 'playlist-cancel') {
    const payload = await deps.readJson(req); deps.sendJson(res, 200, { ok: true, result: await playlistQueue.cancelPending(payload.jobId || '') }); return true;
  }

  if (req.method === 'GET' && action === 'sources') {
    deps.sendJson(res, 200, { ok: true, result: { sources: await localCatalog.listSources() } }); return true;
  }
  if (req.method === 'POST' && action === 'sources') {
    deps.sendJson(res, 201, { ok: true, result: await localCatalog.addSource(await deps.readJson(req)) }); return true;
  }
  if (req.method === 'DELETE' && action === 'sources') {
    const payload = await deps.readJson(req); await localCatalog.removeSource(payload.sourceId); deps.sendJson(res, 200, { ok: true }); return true;
  }
  if (req.method === 'POST' && action === 'scan') {
    const payload = await deps.readJson(req); deps.sendJson(res, 200, { ok: true, result: await localCatalog.scanSource(payload.sourceId, await deps.loadConfig()) }); return true;
  }
  if (req.method === 'POST' && action === 'scan-start') {
    const payload = await deps.readJson(req); deps.sendJson(res, 202, { ok: true, result: await localCatalog.startScanSource(payload.sourceId, await deps.loadConfig()) }); return true;
  }
  if (req.method === 'GET' && action === 'scan-status') {
    deps.sendJson(res, 200, { ok: true, result: localCatalog.getScanStatus({ sourceId: url.searchParams.get('sourceId') || '', jobId: url.searchParams.get('jobId') || '' }) }); return true;
  }
  if (req.method === 'GET' && action === 'items') {
    deps.sendJson(res, 200, { ok: true, result: await managerService.listCatalogItems(await deps.loadConfig(), queryFilters(url)) }); return true;
  }
  if (req.method === 'POST' && action === 'item/search') {
    deps.sendJson(res, 200, { ok: true, result: await managerService.searchForItem(await deps.loadConfig(), await deps.readJson(req)) }); return true;
  }
  if (req.method === 'POST' && action === 'item/match') {
    deps.sendJson(res, 200, { ok: true, result: await managerService.updateMatch(await deps.loadConfig(), await deps.readJson(req)) }); return true;
  }
  if (req.method === 'POST' && action === 'matches/confirm-recovered') {
    deps.sendJson(res, 200, { ok: true, result: await managerService.confirmRecoveredMatches(await deps.loadConfig(), await deps.readJson(req)) }); return true;
  }

  if (req.method === 'GET' && action === 'adoption-destinations') {
    const itemIds = (url.searchParams.get('itemIds') || url.searchParams.get('itemId') || '').split(',').map((value) => value.trim()).filter(Boolean);
    deps.sendJson(res, 200, { ok: true, result: await adoptionService.listDestinations(await deps.loadConfig(), { itemIds }) }); return true;
  }
  if (req.method === 'POST' && action === 'adoption-destinations') {
    const payload = await deps.readJson(req);
    deps.sendJson(res, 200, { ok: true, result: await adoptionService.listDestinations(await deps.loadConfig(), { itemIds: payload.itemIds || [] }) }); return true;
  }
  if (req.method === 'POST' && action === 'adoption-plan') {
    deps.sendJson(res, 200, { ok: true, result: await adoptionService.plan(await deps.loadConfig(), await deps.readJson(req)) }); return true;
  }
  if (req.method === 'POST' && action === 'adoption-start') {
    deps.sendJson(res, 202, { ok: true, result: await adoptionQueue.start(await deps.readJson(req)) }); return true;
  }
  if (req.method === 'POST' && action === 'adoption-pause') {
    deps.sendJson(res, 200, { ok: true, result: await adoptionQueue.pause() }); return true;
  }
  if (req.method === 'POST' && action === 'adoption-resume') {
    deps.sendJson(res, 200, { ok: true, result: await adoptionQueue.resume() }); return true;
  }
  if (req.method === 'POST' && action === 'adoption-cancel') {
    const payload = await deps.readJson(req); deps.sendJson(res, 200, { ok: true, result: await adoptionQueue.cancelPending(payload.jobId || '') }); return true;
  }

  deps.sendJson(res, 404, { ok: false, error: 'Endpoint do Gerenciador do YouTube nao encontrado.' });
  return true;
}

module.exports = { handleYouTubeManagerRoutes };
