const { getErsatzTvCatalog, getErsatzTvVersion, linkSmartCollection } = require('../ersatztvService');

async function handleErsatzTvRoutes(req, res, url, deps) {
  if (!url.pathname.startsWith('/api/ersatztv/')) return false;

  if (req.method === 'GET' && url.pathname === '/api/ersatztv/catalog') {
    const config = await deps.loadConfig();
    const catalog = await getErsatzTvCatalog(config);
    deps.sendJson(res, 200, { ok: true, catalog });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/ersatztv/version') {
    const savedConfig = await deps.loadConfig();
    const payload = await deps.readJson(req);
    const config = {
      ...savedConfig,
      ersatztv: {
        ...(savedConfig.ersatztv || {}),
        url: String(payload.url || savedConfig.ersatztv && savedConfig.ersatztv.url || '').trim(),
        apiKey: String(payload.apiKey || '').trim(),
        apiTimeoutSeconds: Number(payload.apiTimeoutSeconds) || savedConfig.ersatztv && savedConfig.ersatztv.apiTimeoutSeconds || 10
      }
    };
    const result = await getErsatzTvVersion(config);
    deps.sendJson(res, 200, {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      version: result.version
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/ersatztv/smart-collections/link') {
    const config = await deps.loadConfig();
    const payload = await deps.readJson(req);
    const result = await linkSmartCollection(config, payload);
    const libraryId = Number(payload.libraryId);
    const selectionName = String(result && result.name || '').trim();
    if (Number.isInteger(libraryId) && libraryId > 0 && selectionName) {
      config.ersatztv = config.ersatztv || {};
      config.ersatztv.smartCollectionSelections = {
        ...(config.ersatztv.smartCollectionSelections || {}),
        [String(libraryId)]: {
          id: Number(result.id) || null,
          name: selectionName
        }
      };
      await deps.saveConfig(config);
    }
    deps.sendJson(res, 200, { ok: true, result });
    return true;
  }

  return false;
}

module.exports = { handleErsatzTvRoutes };
