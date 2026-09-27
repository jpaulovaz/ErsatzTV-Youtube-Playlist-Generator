const { getErsatzTvCatalog, linkSmartCollection } = require('../ersatztvService');

async function handleErsatzTvRoutes(req, res, url, deps) {
  if (!url.pathname.startsWith('/api/ersatztv/')) return false;

  if (req.method === 'GET' && url.pathname === '/api/ersatztv/catalog') {
    const config = await deps.loadConfig();
    const catalog = await getErsatzTvCatalog(config);
    deps.sendJson(res, 200, { ok: true, catalog });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/ersatztv/smart-collections/link') {
    const config = await deps.loadConfig();
    const payload = await deps.readJson(req);
    const result = await linkSmartCollection(config, payload);
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  return false;
}

module.exports = { handleErsatzTvRoutes };
