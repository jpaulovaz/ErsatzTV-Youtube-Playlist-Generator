const logger = require('./logger');

async function apiRequest(url, method = 'POST', timeoutSeconds = 10) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutSeconds) || 10) * 1000);

  try {
    const response = await fetch(url, {
      method,
      body: '',
      signal: controller.signal
    });

    return {
      ok: [200, 202, 204].includes(response.status),
      status: response.status,
      statusText: response.statusText
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

async function runLibraryAction(config, playlist, action) {
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
    if (!playlist.libraryId) {
      return { ok: false, status: 0, statusText: 'Library ID nao configurado' };
    }
    url = `${baseUrl}/api/libraries/${playlist.libraryId}/scan`;
    label = `scan da biblioteca ${playlist.libraryId}`;
  } else if (action === 'empty-trash') {
    if (!playlist.libraryId) {
      return { ok: false, status: 0, statusText: 'Library ID nao configurado' };
    }
    url = `${baseUrl}/api/libraries/${playlist.libraryId}/empty-trash`;
    label = `limpeza de lixo da biblioteca ${playlist.libraryId}`;
  } else if (action === 'rebuild-playout') {
    if (!playlist.playoutId) {
      return { ok: false, status: 0, statusText: 'Playout ID nao configurado' };
    }
    url = `${baseUrl}/api/playout/${playlist.playoutId}/rebuild`;
    label = `rebuild do playout ${playlist.playoutId}`;
  } else {
    const error = new Error('Acao do ErsatzTV nao suportada.');
    error.statusCode = 404;
    throw error;
  }

  await logger.info(`Disparando ${label} (${playlist.folderName || playlist.name})...`);
  const result = await apiRequest(url, 'POST', timeoutSeconds);

  if (result.ok) {
    await logger.info(`Acao concluida: ${label} (${playlist.folderName || playlist.name}).`, result);
  } else {
    await logger.warn(`Acao falhou: ${label} (${playlist.folderName || playlist.name}) HTTP ${result.status} ${result.statusText}.`);
  }

  return result;
}

async function scanAndRebuild(config, playlist) {
  const result = {
    playlist: playlist.folderName || playlist.name,
    scan: null,
    rebuild: null,
    ok: true
  };

  if (config.downloads.scanOnQueueIdle) {
    result.scan = await runLibraryAction(config, playlist, 'scan');
    result.ok = result.ok && result.scan.ok;
  }

  if (config.downloads.rebuildPlayoutOnQueueIdle && playlist.playoutId) {
    result.rebuild = await runLibraryAction(config, playlist, 'rebuild-playout');
    result.ok = result.ok && result.rebuild.ok;
  }

  return result;
}

module.exports = {
  apiRequest,
  runLibraryAction,
  scanAndRebuild
};
