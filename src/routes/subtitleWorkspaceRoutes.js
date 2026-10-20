const workspaceService = require('../tools/subtitleWorkspaceService');

const EDITOR_ACTIONS = new Set([
  'content-media', 'subtitle-status', 'subtitle-preview-local', 'subtitle-offset',
  'subtitle-cues-save', 'subtitle-timing-preview', 'subtitle-timing-apply',
  'subtitle-restore', 'subtitle-delete', 'content-preview-create', 'audio-visualization-create'
]);

function decodePart(value) {
  try { return decodeURIComponent(value || ''); } catch { return value || ''; }
}

async function handleEditorAction(req, res, url, deps, config, action) {
  if (!EDITOR_ACTIONS.has(action)) return false;
  const queryId = String(url.searchParams.get('id') || '').trim();
  if ((req.method === 'GET' || req.method === 'HEAD') && action === 'content-media') {
    await workspaceService.streamMedia(config, queryId, req, res, url.searchParams.get('previewToken') || '');
    return true;
  }
  if (req.method === 'GET' && action === 'subtitle-status') {
    deps.sendJson(res, 200, { ok: true, result: await workspaceService.getItemStatus(config, queryId) });
    return true;
  }
  if (req.method !== 'POST') return false;
  const payload = await deps.readJson(req);
  payload.itemId = String(payload.itemId || queryId).trim();
  let result;
  if (action === 'subtitle-preview-local') result = await workspaceService.previewLocal(config, payload);
  else if (action === 'subtitle-offset') result = await workspaceService.applyOffset(config, payload);
  else if (action === 'subtitle-cues-save') result = await workspaceService.replaceCues(config, payload);
  else if (action === 'subtitle-timing-preview') result = await workspaceService.previewTimingTransform(config, payload);
  else if (action === 'subtitle-timing-apply') result = await workspaceService.applyTimingTransform(config, payload);
  else if (action === 'subtitle-restore') result = await workspaceService.restoreHistory(config, payload);
  else if (action === 'subtitle-delete') result = await workspaceService.deleteLocalSubtitle(config, payload);
  else if (action === 'content-preview-create') result = await workspaceService.createCompatiblePreview(config, payload);
  else if (action === 'audio-visualization-create') result = await workspaceService.createVisualization(config, payload);
  else return false;
  deps.sendJson(res, 200, { ok: true, result });
  return true;
}

async function handleSubtitleWorkspaceRoutes(req, res, url, deps) {
  const prefix = '/api/tools/subtitles';
  if (!url.pathname.startsWith(prefix)) return false;
  const config = await deps.loadConfig();
  const relative = url.pathname.slice(prefix.length).replace(/^\/+/, '');
  const parts = relative.split('/').filter(Boolean).map(decodePart);

  if (parts.length === 1 && EDITOR_ACTIONS.has(parts[0])) {
    return handleEditorAction(req, res, url, deps, config, parts[0]);
  }

  if (parts.length === 1 && parts[0] === 'advanced-status' && req.method === 'GET') {
    deps.sendJson(res, 200, { ok: true, result: await workspaceService.getAdvancedStatus(config) });
    return true;
  }
  if (parts.length === 2 && parts[0] === 'jobs' && req.method === 'GET') {
    deps.sendJson(res, 200, { ok: true, result: workspaceService.getAdvancedJob(parts[1]) });
    return true;
  }

  if (req.method === 'POST' && parts.length === 2 && parts[0] === 'bazarr' && parts[1] === 'test') {
    deps.sendJson(res, 200, { ok: true, result: await workspaceService.testBazarr(config) });
    return true;
  }

  if (parts.length === 1 && parts[0] === 'workspaces') {
    if (req.method === 'GET') {
      deps.sendJson(res, 200, { ok: true, result: { workspaces: await workspaceService.listWorkspaces() } });
      return true;
    }
    if (req.method === 'POST') {
      const result = await workspaceService.createWorkspace(await deps.readJson(req));
      deps.sendJson(res, 201, { ok: true, result });
      return true;
    }
  }

  if (parts[0] === 'workspaces' && parts[1]) {
    const workspaceId = parts[1];
    if (parts.length === 2 && req.method === 'DELETE') {
      deps.sendJson(res, 200, { ok: true, result: await workspaceService.deleteWorkspace(workspaceId) });
      return true;
    }
    if (parts.length === 3 && parts[2] === 'scan' && req.method === 'POST') {
      deps.sendJson(res, 202, { ok: true, result: await workspaceService.startScan(workspaceId) });
      return true;
    }
    if (parts.length === 3 && parts[2] === 'scan-status' && req.method === 'GET') {
      deps.sendJson(res, 200, { ok: true, result: workspaceService.getScanStatus(workspaceId) });
      return true;
    }
    if (parts.length === 3 && parts[2] === 'items' && req.method === 'GET') {
      const result = await workspaceService.listItems(workspaceId, {
        query: url.searchParams.get('q'),
        filter: url.searchParams.get('filter'),
        language: url.searchParams.get('language'),
        offset: url.searchParams.get('offset'),
        limit: url.searchParams.get('limit')
      });
      deps.sendJson(res, 200, { ok: true, result });
      return true;
    }
  }

  if (parts[0] === 'items' && parts[1]) {
    const itemId = parts[1];
    if (parts.length === 3 && parts[2] === 'review-status' && req.method === 'POST') {
      const payload = await deps.readJson(req);
      deps.sendJson(res, 200, { ok: true, result: await workspaceService.setReviewStatus(itemId, payload.reviewed === true) });
      return true;
    }
    if (parts.length === 3 && req.method === 'POST' && ['extract', 'convert', 'ocr', 'translate', 'remux'].includes(parts[2])) {
      const payload = await deps.readJson(req);
      payload.itemId = itemId;
      let result;
      if (parts[2] === 'extract') result = await workspaceService.extractEmbeddedTrack(config, payload);
      else if (parts[2] === 'convert') result = await workspaceService.convertTrackToSrt(config, payload);
      else if (parts[2] === 'ocr') result = await workspaceService.startOcrJob(config, payload);
      else if (parts[2] === 'translate') result = await workspaceService.startTranslationJob(config, payload);
      else if (parts[2] === 'remux') result = await workspaceService.startRemuxJob(config, payload);
      deps.sendJson(res, ['ocr', 'translate', 'remux'].includes(parts[2]) ? 202 : 200, { ok: true, result });
      return true;
    }
    if (parts.length === 4 && parts[2] === 'bazarr' && req.method === 'POST') {
      const action = parts[3];
      const payload = await deps.readJson(req);
      payload.itemId = itemId;
      let result;
      if (action === 'search') result = await workspaceService.bazarrSearch(config, itemId);
      else if (action === 'download') result = await workspaceService.bazarrDownload(config, payload);
      else if (action === 'sync') result = await workspaceService.bazarrSync(config, payload);
      else return false;
      deps.sendJson(res, 200, { ok: true, result });
      return true;
    }
  }

  deps.sendJson(res, 404, { ok: false, error: 'Endpoint do Gerenciador de Legendas nao encontrado.' });
  return true;
}

module.exports = { handleSubtitleWorkspaceRoutes, EDITOR_ACTIONS };
