const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  AuthManager,
  buildAuthConfig,
  writeAuthConfig,
  verifyPassword,
  parseCookies
} = require('../src/auth');

function makeRequest({ cookie = '', csrf = '', origin = 'http://localhost:3099', ip = '127.0.0.1', userAgent = 'node-test-agent' } = {}) {
  return {
    headers: {
      host: 'localhost:3099',
      origin,
      cookie,
      'x-csrf-token': csrf,
      'user-agent': userAgent
    },
    socket: {
      remoteAddress: ip,
      encrypted: false
    }
  };
}

test('auth config stores a scrypt hash and never the plaintext password', async () => {
  const config = await buildAuthConfig({
    username: 'admin.local',
    password: 'Uma-senha-de-teste-2026!'
  });

  assert.equal(config.username, 'admin.local');
  assert.equal(config.password.algorithm, 'scrypt');
  assert.notEqual(config.password.hash, 'Uma-senha-de-teste-2026!');
  assert.equal(JSON.stringify(config).includes('Uma-senha-de-teste-2026!'), false);
  assert.equal(await verifyPassword('Uma-senha-de-teste-2026!', config.password), true);
  assert.equal(await verifyPassword('senha-incorreta', config.password), false);
});

test('login creates a signed HttpOnly session and CSRF is required for mutations', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-auth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'auth.json');
  const config = await buildAuthConfig({
    username: 'joao',
    password: 'Senha-local-bem-forte-2026!'
  });
  await writeAuthConfig(config, configPath);

  const manager = new AuthManager({ configPath });
  t.after(() => manager.stop());
  await manager.init();

  const request = makeRequest();
  const login = await manager.login('joao', 'Senha-local-bem-forte-2026!', request);
  assert.match(login.cookie, /^ersatztv_session=/);
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Strict/);
  assert.equal(login.cookie.includes('Secure'), false);

  const cookiePair = login.cookie.split(';')[0];
  assert.ok(parseCookies(cookiePair).ersatztv_session);
  const sessionRequest = makeRequest({ cookie: cookiePair });
  const session = manager.getSession(sessionRequest);
  assert.ok(session);
  assert.equal(session.username, 'joao');
  assert.equal(manager.validateCsrf(sessionRequest, session), false);

  const csrfRequest = makeRequest({ cookie: cookiePair, csrf: session.csrfToken });
  assert.equal(manager.validateCsrf(csrfRequest, session), true);

  const wrongOriginRequest = makeRequest({
    cookie: cookiePair,
    csrf: session.csrfToken,
    origin: 'https://attacker.example'
  });
  assert.equal(manager.validateCsrf(wrongOriginRequest, session), false);

  const clearCookie = manager.logout(sessionRequest);
  assert.match(clearCookie, /Max-Age=0/);
  assert.equal(manager.getSession(sessionRequest), null);
});

test('repeated invalid logins trigger an IP lockout', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-auth-lock-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'auth.json');
  const config = await buildAuthConfig({
    username: 'admin',
    password: 'Outra-senha-forte-2026!'
  });
  config.security.maxFailedAttempts = 2;
  config.security.lockoutMinutes = 1;
  await writeAuthConfig(config, configPath);

  const manager = new AuthManager({ configPath });
  t.after(() => manager.stop());
  await manager.init();
  const request = makeRequest({ ip: '192.0.2.15' });

  await assert.rejects(
    manager.login('admin', 'senha-errada', request),
    (error) => error.statusCode === 401 && error.code === 'AUTH_INVALID_CREDENTIALS'
  );
  await assert.rejects(
    manager.login('admin', 'senha-errada', request),
    (error) => error.statusCode === 429 && error.code === 'AUTH_RATE_LIMITED'
  );
  await assert.rejects(
    manager.login('admin', 'Outra-senha-forte-2026!', request),
    (error) => error.statusCode === 429 && Number(error.retryAfterSeconds) > 0
  );
});

test('trusted HTTPS proxy enables Secure cookies and validates the forwarded origin', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-auth-proxy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'auth.json');
  const config = await buildAuthConfig({
    username: 'proxyadmin',
    password: 'Proxy-Seguro-Password-2026!'
  });
  config.security.trustProxy = true;
  await writeAuthConfig(config, configPath);

  const manager = new AuthManager({ configPath });
  t.after(() => manager.stop());
  await manager.init();
  const request = {
    headers: {
      host: '127.0.0.1:3099',
      origin: 'https://media.example.test',
      'x-forwarded-host': 'media.example.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '198.51.100.25',
      'user-agent': 'proxy-test-agent'
    },
    socket: { remoteAddress: '127.0.0.1', encrypted: false }
  };

  assert.equal(manager.validateOrigin(request), true);
  assert.equal(manager.isSecureRequest(request), true);
  assert.equal(manager.getClientIp(request), '198.51.100.25');
  const login = await manager.login('proxyadmin', 'Proxy-Seguro-Password-2026!', request);
  assert.match(login.cookie, /; Secure/);
});
