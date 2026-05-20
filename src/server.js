const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { ROOT_DIR, loadConfig, saveConfig } = require('./config');
const { runSync, getState } = require('./syncService');
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

async function handleApi(req, res, url) {
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

  if (req.method === 'POST' && url.pathname === '/api/run') {
    const state = getState();
    if (state.running) {
      sendJson(res, 409, { ok: false, error: 'Sincronizacao ja esta em execucao.' });
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
    sendJson(res, 200, {
      sync: getState(),
      scheduler: scheduler.getStatus(),
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
        sendJson(res, 500, { ok: false, error: error.message });
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
