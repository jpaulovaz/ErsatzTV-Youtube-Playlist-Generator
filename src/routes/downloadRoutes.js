const downloadManager = require('../downloadManager');

async function handleDownloadRoutes(req, res, url, deps) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method !== 'POST' || parts[0] !== 'api' || parts[1] !== 'downloads') return false;

  if (parts.length === 3 && parts[2] === 'pause') {
    deps.sendJson(res, 200, { ok: true, queue: await downloadManager.pause() });
    return true;
  }
  if (parts.length === 3 && parts[2] === 'resume') {
    deps.sendJson(res, 200, { ok: true, queue: await downloadManager.resume() });
    return true;
  }
  if (parts.length === 3 && parts[2] === 'clear') {
    const payload = await deps.readJson(req);
    const result = await downloadManager.clearQueue({
      library: String(payload.library || '').trim(),
      cancelCurrent: payload.cancelCurrent !== false
    });
    deps.sendJson(res, 200, { ok: true, result, queue: downloadManager.getQueueStatus() });
    return true;
  }
  if (parts.length !== 4) return false;

  const id = decodeURIComponent(parts[2]);
  const action = parts[3];
  let result;
  if (action === 'retry') result = await downloadManager.retryItem(id);
  else if (action === 'cancel') result = await downloadManager.cancelItem(id);
  else if (action === 'priority') result = await downloadManager.prioritizeItem(id);
  else if (action === 'remove') result = await downloadManager.removeItem(id);
  else return false;

  deps.sendJson(res, 200, { ok: true, result });
  return true;
}

module.exports = { handleDownloadRoutes };
