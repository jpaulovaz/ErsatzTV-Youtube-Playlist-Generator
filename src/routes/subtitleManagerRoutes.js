const subtitleManager = require('../subtitleManager/subtitleManagerService');

const ACTIONS = new Set([
  'content-media', 'subtitle-status', 'subtitle-search', 'subtitle-preview', 'subtitle-preview-local',
  'subtitle-apply', 'subtitle-offset', 'subtitle-restore', 'content-preview-create'
]);

async function handleSubtitleManagerAction({ req, res, url, deps, config, destination, action }) {
  if (!ACTIONS.has(action)) return false;
  const baseArgs = { config, destination, downloadManager: deps.downloadManager, itemId: url.searchParams.get('id') };

  if ((req.method === 'GET' || req.method === 'HEAD') && action === 'content-media') {
    await subtitleManager.streamMedia(baseArgs, req, res, url.searchParams.get('previewToken') || '');
    return true;
  }

  if (req.method === 'GET' && action === 'subtitle-status') {
    const result = await subtitleManager.getStatus(baseArgs);
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  if (req.method !== 'POST') return false;
  const payload = await deps.readJson(req);
  const itemId = String(payload.itemId || url.searchParams.get('id') || '').trim();
  const args = { ...baseArgs, itemId };
  let result;
  if (action === 'subtitle-search') result = await subtitleManager.search(args, payload);
  else if (action === 'subtitle-preview') result = await subtitleManager.previewCandidate(args, payload);
  else if (action === 'subtitle-preview-local') result = await subtitleManager.previewLocal(args, payload);
  else if (action === 'subtitle-apply') result = await subtitleManager.applyCandidate(args, payload);
  else if (action === 'subtitle-offset') result = await subtitleManager.applyOffset(args, payload);
  else if (action === 'subtitle-restore') result = await subtitleManager.restoreHistory(args, payload);
  else if (action === 'content-preview-create') result = await subtitleManager.createCompatiblePreview(args);
  else return false;
  deps.sendJson(res, 200, { ok: true, result });
  return true;
}

module.exports = { handleSubtitleManagerAction, ACTIONS };
