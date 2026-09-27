const logger = require('./logger');

function buildApiHeaders(config) {
  const apiKey = String(config && config.ersatztv && config.ersatztv.apiKey || '').trim();
  return apiKey ? { 'X-Etv-Api-Key': apiKey } : {};
}

async function apiRequest(url, method = 'POST', timeoutSeconds = 10, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutSeconds) || 10) * 1000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: '',
      signal: controller.signal
    });

    let statusText = response.statusText;
    if (response.status === 401 || response.status === 403) {
      statusText = 'API Key do ErsatzTV ausente ou invalida';
    }

    return {
      ok: [200, 202, 204].includes(response.status),
      status: response.status,
      statusText
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error.name === 'AbortError' ? 'Timeout' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getBaseUrl(config) {
  return String(config && config.ersatztv && config.ersatztv.url || '').trim().replace(/\/+$/, '');
}

function getTimeoutSeconds(config) {
  return config && config.ersatztv ? config.ersatztv.apiTimeoutSeconds : 10;
}

function authStatusText(status, fallback) {
  if (status === 401 || status === 403) return 'API Key do ErsatzTV ausente ou invalida';
  return fallback;
}

async function ersatzTvJsonRequest(config, pathname, options = {}) {
  const baseUrl = getBaseUrl(config);
  if (!baseUrl) {
    return { ok: false, status: 0, statusText: 'URL do ErsatzTV nao configurada', data: null };
  }

  const method = String(options.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(getTimeoutSeconds(config)) || 10) * 1000);
  const headers = {
    Accept: 'application/json',
    ...buildApiHeaders(config)
  };
  let body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: authStatusText(response.status, response.statusText),
      data
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error.name === 'AbortError' ? 'Timeout' : error.message,
      data: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sortByName(items) {
  return items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' }));
}

async function listErsatzTvChannels(config) {
  const result = await ersatzTvJsonRequest(config, '/api/channels');
  const items = result.ok && Array.isArray(result.data)
    ? sortByName(result.data.map((channel) => ({
      id: Number(channel && channel.id) || null,
      number: String(channel && channel.number || '').trim(),
      name: String(channel && channel.name || '').trim()
    })).filter((channel) => channel.number && channel.name))
    : [];
  return { ...result, items };
}

async function listSmartCollections(config) {
  const result = await ersatzTvJsonRequest(config, '/api/collections/smart');
  const items = result.ok && Array.isArray(result.data)
    ? sortByName(result.data.map((collection) => ({
      id: Number(collection && collection.id) || null,
      name: String(collection && collection.name || '').trim(),
      query: String(collection && collection.query || '').trim()
    })).filter((collection) => collection.id && collection.name))
    : [];
  return { ...result, items };
}

async function getErsatzTvVersion(config) {
  const result = await ersatzTvJsonRequest(config, '/api/version');
  const data = result.ok && result.data && typeof result.data === 'object' ? result.data : {};
  return {
    ...result,
    version: result.ok ? {
      apiVersion: Number.isFinite(Number(data.apiVersion)) ? Number(data.apiVersion) : null,
      appVersion: String(data.appVersion || '').trim()
    } : null
  };
}

async function getErsatzTvCatalog(config) {
  const [channels, smartCollections] = await Promise.all([
    listErsatzTvChannels(config),
    listSmartCollections(config)
  ]);
  return {
    channels: channels.items,
    smartCollections: smartCollections.items,
    smartCollectionSelections: config && config.ersatztv && config.ersatztv.smartCollectionSelections || {},
    channelsAvailable: channels.ok,
    smartCollectionsAvailable: smartCollections.ok,
    channelError: channels.ok ? '' : channels.statusText,
    smartCollectionError: smartCollections.ok ? '' : smartCollections.statusText
  };
}

function libraryQuery(libraryId) {
  const id = Number(libraryId);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('Library ID invalido.');
    error.statusCode = 400;
    throw error;
  }
  return `library_id:${id}`;
}

function queryContainsLibraryId(query, libraryId) {
  const id = String(Number(libraryId));
  const pattern = new RegExp(`\\blibrary_id\\s*:\\s*"?${id}"?(?!\\d)`, 'i');
  return pattern.test(String(query || ''));
}

function externalApiError(prefix, result) {
  const error = new Error(`${prefix}: ${result.status ? `HTTP ${result.status} ` : ''}${result.statusText || 'falha desconhecida'}`.trim());
  error.statusCode = result.status === 401 || result.status === 403 ? 502 : 502;
  return error;
}

async function linkSmartCollection(config, options = {}) {
  const mode = String(options.mode || '').trim();
  const queryForLibrary = libraryQuery(options.libraryId);

  if (mode === 'create') {
    const name = String(options.name || '').trim();
    if (!name) {
      const error = new Error('Informe o nome da Smart Collection.');
      error.statusCode = 400;
      throw error;
    }
    const created = await ersatzTvJsonRequest(config, '/api/collections/smart/new', {
      method: 'POST',
      json: { name, query: queryForLibrary }
    });
    if (!created.ok) throw externalApiError('Nao foi possivel criar a Smart Collection', created);
    const createdId = Number(created.data && created.data.id) || null;
    const createdName = String(created.data && created.data.name || name).trim() || name;
    await logger.info(`Smart Collection criada no ErsatzTV: ${createdName}.`, { libraryId: Number(options.libraryId) });
    return { changed: true, created: true, id: createdId, name: createdName, query: queryForLibrary };
  }

  if (!['aggregate', 'replace'].includes(mode)) {
    const error = new Error('Modo de vinculacao da Smart Collection invalido.');
    error.statusCode = 400;
    throw error;
  }

  const collectionId = Number(options.collectionId);
  if (!Number.isInteger(collectionId) || collectionId <= 0) {
    const error = new Error('Smart Collection invalida.');
    error.statusCode = 400;
    throw error;
  }

  // Always re-read immediately before PUT so we never overwrite a stale query loaded by the browser.
  const current = await listSmartCollections(config);
  if (!current.ok) throw externalApiError('Nao foi possivel ler as Smart Collections', current);
  const collection = current.items.find((item) => item.id === collectionId);
  if (!collection) {
    const error = new Error('Smart Collection nao encontrada no ErsatzTV.');
    error.statusCode = 404;
    throw error;
  }

  if (mode === 'aggregate' && queryContainsLibraryId(collection.query, options.libraryId)) {
    return { changed: false, created: false, alreadyPresent: true, ...collection };
  }

  const existingQuery = String(collection.query || '').trim();
  const nextQuery = mode === 'replace'
    ? queryForLibrary
    : (existingQuery ? `(${existingQuery}) OR (${queryForLibrary})` : queryForLibrary);

  const updated = await ersatzTvJsonRequest(config, '/api/collections/smart/update', {
    method: 'PUT',
    json: {
      id: collection.id,
      name: collection.name,
      query: nextQuery
    }
  });
  if (!updated.ok) throw externalApiError('Nao foi possivel atualizar a Smart Collection', updated);
  await logger.info(`Smart Collection atualizada no ErsatzTV: ${collection.name}.`, {
    libraryId: Number(options.libraryId),
    mode
  });
  return { changed: true, created: false, id: collection.id, name: collection.name, query: nextQuery };
}

async function runLibraryAction(config, destination, action) {
  const baseUrl = getBaseUrl(config);
  const timeoutSeconds = getTimeoutSeconds(config);
  let url;
  let label;

  if (!baseUrl) {
    return {
      ok: false,
      status: 0,
      statusText: 'URL do ErsatzTV nao configurada'
    };
  }

  if (action === 'scan') {
    if (!destination.libraryId) {
      return { ok: false, status: 0, statusText: 'Library ID nao configurado' };
    }
    url = `${baseUrl}/api/libraries/${destination.libraryId}/scan`;
    label = `scan da biblioteca ${destination.libraryId}`;
  } else if (action === 'empty-trash') {
    url = `${baseUrl}/api/maintenance/empty_trash`;
    label = 'limpeza global de lixo';
  } else if (action === 'reset-playout') {
    if (!destination.channelNumber) {
      return { ok: false, status: 0, statusText: 'Numero do canal do ErsatzTV nao configurado' };
    }
    url = `${baseUrl}/api/channels/${destination.channelNumber}/playout/reset`;
    label = `reset do playout do canal ${destination.channelNumber}`;
  } else {
    const error = new Error('Acao do ErsatzTV nao suportada.');
    error.statusCode = 404;
    throw error;
  }

  await logger.info(`Disparando ${label} (${destination.folderName || destination.name})...`);
  const result = await apiRequest(url, 'POST', timeoutSeconds, buildApiHeaders(config));

  if (result.ok) {
    await logger.info(`Acao concluida: ${label} (${destination.folderName || destination.name}).`, result);
  } else {
    await logger.warn(`Acao falhou: ${label} (${destination.folderName || destination.name}) HTTP ${result.status} ${result.statusText}.`);
  }

  return result;
}

async function scanOnIdle(config, destination) {
  const result = {
    playlist: destination.folderName || destination.name,
    scan: null,
    ok: true
  };

  if (config.downloads.scanOnQueueIdle) {
    result.scan = await runLibraryAction(config, destination, 'scan');
    result.ok = result.ok && result.scan.ok;
  }

  return result;
}

module.exports = {
  apiRequest,
  buildApiHeaders,
  ersatzTvJsonRequest,
  listErsatzTvChannels,
  listSmartCollections,
  getErsatzTvVersion,
  getErsatzTvCatalog,
  linkSmartCollection,
  queryContainsLibraryId,
  runLibraryAction,
  scanOnIdle
};
