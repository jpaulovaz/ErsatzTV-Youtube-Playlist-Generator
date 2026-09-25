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
  getAllPlaylistHealth,
  findPlaylist,
  getState
} = require('./syncService');
const downloadManager = require('./downloadManager');
const scheduler = require('./scheduler');
const auth = require('./auth');
const logger = require('./logger');

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const MAX_BODY_BYTES = 1024 * 1024;
const PUBLIC_LOGIN_ASSETS = new Set(['/login', '/login.html', '/login.js', '/styles.css', '/brand-mark.svg', '/favicon.ico']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function applySecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (auth.isSecureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    ...headers
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        const error = new Error('Payload grande demais.');
        error.statusCode = 413;
        reject(error);
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
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('JSON invalido.');
    error.statusCode = 400;
    throw error;
  }
}

async function serveStatic(req, res, pathname) {
  let requested;
  if (pathname === '/') requested = 'index.html';
  else if (pathname === '/login' || pathname === '/login.html') requested = 'login.html';
  else requested = decodeURIComponent(pathname).replace(/^\/+/, '');

  const filePath = path.resolve(PUBLIC_DIR, requested);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const noStore = ext === '.html' || requested === 'login.js' || requested === 'app.js';
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': noStore ? 'no-store' : 'public, max-age=300'
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

async function handleAuthApi(req, res, url) {
  if (!url.pathname.startsWith('/api/auth/')) return false;

  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const session = auth.getSession(req);
    sendJson(res, 200, auth.publicSession(req, session));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!auth.validateOrigin(req)) {
      sendJson(res, 403, { ok: false, error: 'Origem da requisicao nao autorizada.', code: 'AUTH_ORIGIN_INVALID' });
      return true;
    }
    const payload = await readJson(req);
    try {
      const result = await auth.login(payload.username, payload.password, req);
      await logger.info('Login realizado na interface web.', { ip: auth.getClientIp(req) });
      sendJson(res, 200, {
        ok: true,
        ...auth.publicSession(req, result.session)
      }, { 'Set-Cookie': result.cookie });
    } catch (error) {
      const headers = {};
      if (error.retryAfterSeconds) headers['Retry-After'] = String(error.retryAfterSeconds);
      await logger.warn('Tentativa de login rejeitada.', {
        ip: auth.getClientIp(req),
        code: error.code || 'AUTH_LOGIN_FAILED'
      });
      sendJson(res, error.statusCode || 401, {
        ok: false,
        error: error.message,
        code: error.code || 'AUTH_LOGIN_FAILED',
        retryAfterSeconds: error.retryAfterSeconds || null
      }, headers);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const session = auth.getSession(req);
    if (session && !auth.validateCsrf(req, session)) {
      sendJson(res, 403, { ok: false, error: 'Sessao de seguranca invalida.', code: 'CSRF_INVALID' });
      return true;
    }
    const cookie = auth.logout(req);
    if (session) await logger.info('Logout realizado na interface web.', { ip: auth.getClientIp(req) });
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    return true;
  }

  sendJson(res, 404, { ok: false, error: 'Endpoint de autenticacao nao encontrado.' });
  return true;
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
  } else if (action === 'refresh-subtitles') {
    result = await downloadManager.queueMissingSubtitles(playlist.folderName);
  } else if (action === 'prepare-movie-metadata') {
    result = await downloadManager.prepareMovieMetadata(playlist.folderName);
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
  if (parts.length === 3 && parts[2] === 'clear') {
    const payload = await readJson(req);
    const result = await downloadManager.clearQueue({
      library: String(payload.library || '').trim(),
      cancelCurrent: payload.cancelCurrent !== false
    });
    sendJson(res, 200, { ok: true, result, queue: downloadManager.getQueueStatus() });
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
    return pkg.version || '2.6.0';
  } catch {
    return '2.6.0';
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
    const page = downloadManager.getItemsPage({
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      status: url.searchParams.get('status'),
      library: url.searchParams.get('library')
    });
    sendJson(res, 200, {
      queue: downloadManager.getQueueStatus(),
      items: page.items,
      pagination: {
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore
      }
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

function isMutatingMethod(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

function createServer() {
  return http.createServer(async (req, res) => {
    applySecurityHeaders(req, res);
    try {
      const url = new URL(req.url, 'http://localhost');

      if (await handleAuthApi(req, res, url)) return;

      const session = auth.getSession(req);
      if (url.pathname.startsWith('/api/')) {
        if (auth.setupRequired) {
          sendJson(res, 503, {
            ok: false,
            error: 'Autenticacao ainda nao configurada. Execute npm run auth:set no servidor.',
            code: 'AUTH_SETUP_REQUIRED'
          });
          return;
        }
        if (!session) {
          sendJson(res, 401, { ok: false, error: 'Sessao expirada ou inexistente.', code: 'AUTH_REQUIRED' });
          return;
        }
        if (isMutatingMethod(req.method) && !auth.validateCsrf(req, session)) {
          sendJson(res, 403, { ok: false, error: 'Sessao de seguranca invalida. Recarregue a pagina.', code: 'CSRF_INVALID' });
          return;
        }
        await handleApi(req, res, url);
        return;
      }

      if (req.method !== 'GET') {
        sendText(res, 405, 'Method not allowed');
        return;
      }

      if (PUBLIC_LOGIN_ASSETS.has(url.pathname)) {
        if ((url.pathname === '/login' || url.pathname === '/login.html') && session) {
          redirect(res, '/');
          return;
        }
        await serveStatic(req, res, url.pathname);
        return;
      }

      if (auth.setupRequired || !session) {
        redirect(res, '/login');
        return;
      }

      await serveStatic(req, res, url.pathname);
    } catch (error) {
      await logger.error(`Erro no servidor: ${error.message}`);
      if (!res.headersSent) {
        const headers = {};
        if (error.retryAfterSeconds) headers['Retry-After'] = String(error.retryAfterSeconds);
        sendJson(res, error.statusCode || 500, {
          ok: false,
          error: error.message,
          code: error.code || null
        }, headers);
      } else {
        res.end();
      }
    }
  });
}

async function startServer(config) {
  await auth.init();
  const server = createServer();
  const host = config.server.host || '0.0.0.0';
  const port = Number(config.server.port) || 3099;
  await new Promise((resolve) => server.listen(port, host, resolve));
  await logger.info(`Interface v2.5 iniciada em http://${host}:${port}`);
  if (auth.setupRequired) {
    await logger.warn('A interface esta bloqueada ate que config/auth.json seja criado com npm run auth:set.');
  }
  return server;
}

module.exports = { startServer, createServer };
