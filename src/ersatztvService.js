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

async function runLibraryAction(config, destination, action) {
  const baseUrl = getBaseUrl(config);
  const timeoutSeconds = config && config.ersatztv ? config.ersatztv.apiTimeoutSeconds : 10;
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
  runLibraryAction,
  scanOnIdle
};
