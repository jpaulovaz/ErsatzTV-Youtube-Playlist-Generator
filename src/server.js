const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { ROOT_DIR, loadConfig, saveConfig } = require('./config');
const { runSync, manualCleanupPlaylist, previewCleanupPlaylist, runPlaylistApiAction, testPlaylistCookies, checkPlaylistAvailability, refreshPlaylistThumbnails, testYouTubeApi, getAllPlaylistHealth, findPlaylist, getState } = require('./syncService');
const scheduler = require('./scheduler');
const logger = require('./logger');

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Payload grande demais.'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length
    });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendText(res, 404, 'Not found');
      return;
    }
    throw error;
  }
}

async function handlePlaylistAction(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const playlistName = parts[2];
  const action = parts[3];

  if (req.method !== 'POST' || parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'playlists') {
    return false;
  }

  const config = await loadConfig();

  if (action === 'run') {
    const currentState = getState();
    if (currentState.running) {
      sendJson(res, 409, { ok: false, error: 'Ja existe uma operacao em execucao.' });
      return true;
    }

    const playlist = findPlaylist(config, playlistName);
    if (!playlist) {
      sendJson(res, 404, { ok: false, error: 'Biblioteca nao encontrada na configuracao.' });
      return true;
    }

    runSync(config, { trigger: 'manual-playlist', playlistName }).catch((error) => {
      logger.error(`Execucao manual da playlist falhou: ${error.message}`);
    });

    sendJson(res, 202, {
      ok: true,
      message: `Sincronizacao iniciada para ${playlist.folderName}.`
    });
    return true;
  }

  let result;

  if (action === 'cleanup-preview') {
    result = await previewCleanupPlaylist(config, playlistName);
  } else if (action === 'cleanup') {
    result = await manualCleanupPlaylist(config, playlistName);
  } else if (action === 'test-cookies') {
    result = await testPlaylistCookies(config, playlistName);
  } else if (action === 'availability') {
    result = await checkPlaylistAvailability(config, playlistName);
  } else if (action === 'refresh-thumbnails') {
    result = await refreshPlaylistThumbnails(config, playlistName);
  } else {
    result = await runPlaylistApiAction(config, playlistName, action);
  }

  sendJson(res, 202, { ok: true, result });
  return true;
}

async function handleApi(req, res, url) {
  if (url.pathname.startsWith('/api/playlists/')) {
    const handled = await handlePlaylistAction(req, res, url);
    if (handled) return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    const config = await loadConfig();
    sendJson(res, 200, config);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/config') {
    const payload = await readJson(req);
    const config = await saveConfig(payload);
    scheduler.configure(config);
    await logger.info('Configuracao salva pela interface.');
    sendJson(res, 200, { ok: true, config });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/youtube-api/test') {
    const config = await loadConfig();
    const result = await testYouTubeApi(config);
    sendJson(res, 200, { ok: result.ok, result });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    const state = getState();
    if (state.running) {
      sendJson(res, 409, { ok: false, error: 'Ja existe uma operacao em execucao.' });
      return;
    }

    const config = await loadConfig();
    runSync(config, { trigger: 'manual' }).catch((error) => {
      logger.error(`Execucao manual falhou: ${error.message}`);
    });
    sendJson(res, 202, { ok: true, message: 'Sincronizacao iniciada.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const config = await loadConfig();
    const health = await getAllPlaylistHealth(config);
    sendJson(res, 200, {
      sync: getState(),
      scheduler: scheduler.getStatus(),
      health,
      now: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    const limit = Number(url.searchParams.get('limit')) || 200;
    const logs = await logger.getLogs(limit);
    sendJson(res, 200, { logs });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logs/clear') {
    await logger.clear();
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'API endpoint nao encontrado.' });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }

      if (req.method !== 'GET') {
        sendText(res, 405, 'Method not allowed');
        return;
      }

      await serveStatic(req, res, url.pathname);
    } catch (error) {
      await logger.error(`Erro no servidor: ${error.message}`);
      if (!res.headersSent) {
        sendJson(res, error.statusCode || 500, { ok: false, error: error.message });
      } else {
        res.end();
      }
    }
  });
}

async function startServer(config) {
  const server = createServer();
  const host = config.server.host || '0.0.0.0';
  const port = Number(config.server.port) || 3099;

  await new Promise((resolve) => server.listen(port, host, resolve));
  await logger.info(`Interface iniciada em http://${host}:${port}`);
  return server;
}

module.exports = {
  startServer
};
