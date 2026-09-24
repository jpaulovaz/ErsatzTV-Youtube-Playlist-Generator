const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { ROOT_DIR, loadConfig, saveConfig } = require('./config');
const {
  runSync,
  runPlaylistApiAction,
  testPlaylistCookies,
  testYouTubeApi,
  previewLegacyCleanup,
  cleanupLegacyFiles,
  getAllPlaylistHealth,
  findPlaylist,
  getState
} = require('./syncService');
const downloadManager = require('./downloadManager');
const scheduler = require('./scheduler');
const logger = require('./logger');

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
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
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
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
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, requested);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
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
  if (req.method !== 'POST' || parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'playlists') return false;

  const playlistName = parts[2];
  const action = parts[3];
  let config = await loadConfig();
  const playlist = findPlaylist(config, playlistName);
  if (!playlist) {
    sendJson(res, 404, { ok: false, error: 'Biblioteca nao encontrada na configuracao.' });
    return true;
  }

  if (action === 'run') {
    if (getState().running) {
      sendJson(res, 409, { ok: false, error: 'Ja existe uma descoberta em execucao.' });
      return true;
    }
    runSync(config, { trigger: 'manual-playlist', playlistName }).catch((error) => {
      logger.error(`Descoberta manual da biblioteca falhou: ${error.message}`);
    });
    sendJson(res, 202, { ok: true, message: `Descoberta iniciada para ${playlist.folderName}.` });
    return true;
  }

  let result;
  if (action === 'test-cookies') {
    result = await testPlaylistCookies(config, playlistName);
  } else if (action === 'refresh-thumbnails') {
    result = await downloadManager.refreshThumbnails(playlist.folderName);
  } else if (action === 'legacy-preview') {
    result = await previewLegacyCleanup(config, playlistName);
  } else if (action === 'legacy-cleanup') {
    result = await cleanupLegacyFiles(config, playlistName);
  } else if (action === 'orphans-preview') {
    result = downloadManager.previewOrphans(playlist.folderName);
  } else if (action === 'orphans-cleanup') {
    result = await downloadManager.cleanupOrphans(playlist.folderName);
  } else if (action === 'delete-with-files') {
    const payload = await readJson(req);
    const confirmation = String(payload.confirmation || '').trim();
    if (confirmation !== playlist.name && confirmation !== playlist.folderName) {
      sendJson(res, 400, { ok: false, error: 'Confirmacao invalida. Digite exatamente o nome da biblioteca.' });
      return true;
    }
    const deleteResult = await downloadManager.deleteLibraryData(config, playlist);
    config.playlists = (config.playlists || []).filter((entry) => sanitizeEntryName(entry.name) !== playlist.folderName);
    config = await saveConfig(config);
    scheduler.configure(config);
    downloadManager.configure(config);
    result = { ...deleteResult, config };
  } else {
    result = await runPlaylistApiAction(config, playlistName, action);
  }

  sendJson(res, 200, { ok: true, result });
  return true;
}

function sanitizeEntryName(value) {
  return String(value || '').replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
}

async function handleDownloadAction(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method !== 'POST' || parts[0] !== 'api' || parts[1] !== 'downloads') return false;

  if (parts.length === 3 && parts[2] === 'pause') {
    sendJson(res, 200, { ok: true, queue: await downloadManager.pause() });
    return true;
  }
  if (parts.length === 3 && parts[2] === 'resume') {
    sendJson(res, 200, { ok: true, queue: await downloadManager.resume() });
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

  sendJson(res, 200, { ok: true, result });
  return true;
}

async function getVersion() {
  try {
    const pkg = JSON.parse(await fs.readFile(PACKAGE_PATH, 'utf8'));
    return pkg.version || '2.0.0';
  } catch {
    return '2.0.0';
  }
}

async function handleApi(req, res, url) {
  if (url.pathname.startsWith('/api/playlists/')) {
    if (await handlePlaylistAction(req, res, url)) return;
  }
  if (url.pathname.startsWith('/api/downloads/')) {
    if (await handleDownloadAction(req, res, url)) return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, await loadConfig());
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/config') {
    const config = await saveConfig(await readJson(req));
    scheduler.configure(config);
    downloadManager.configure(config);
    await logger.info('Configuracao v2 salva pela interface.');
    sendJson(res, 200, { ok: true, config });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/youtube-api/test') {
    const result = await testYouTubeApi(await loadConfig());
    sendJson(res, 200, { ok: result.ok, result });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (getState().running) {
      sendJson(res, 409, { ok: false, error: 'Ja existe uma descoberta em execucao.' });
      return;
    }
    const config = await loadConfig();
    runSync(config, { trigger: 'manual' }).catch((error) => logger.error(`Descoberta manual falhou: ${error.message}`));
    sendJson(res, 202, { ok: true, message: 'Descoberta iniciada.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const config = await loadConfig();
    await downloadManager.refreshStorage(false);
    sendJson(res, 200, {
      version: await getVersion(),
      discovery: getState(),
      queue: downloadManager.getQueueStatus(),
      scheduler: scheduler.getStatus(),
      health: getAllPlaylistHealth(config),
      now: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/downloads') {
    sendJson(res, 200, {
      queue: downloadManager.getQueueStatus(),
      items: downloadManager.listItems({
        limit: url.searchParams.get('limit'),
        status: url.searchParams.get('status'),
        library: url.searchParams.get('library')
      })
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    const limit = Number(url.searchParams.get('limit')) || 200;
    sendJson(res, 200, { logs: await logger.getLogs(limit) });
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
      if (!res.headersSent) sendJson(res, error.statusCode || 500, { ok: false, error: error.message });
      else res.end();
    }
  });
}

async function startServer(config) {
  const server = createServer();
  const host = config.server.host || '0.0.0.0';
  const port = Number(config.server.port) || 3099;
  await new Promise((resolve) => server.listen(port, host, resolve));
  await logger.info(`Interface v2 iniciada em http://${host}:${port}`);
  return server;
}

module.exports = { startServer };
