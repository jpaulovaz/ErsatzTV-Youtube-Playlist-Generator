const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { ROOT_DIR } = require('./config');
const logger = require('./logger');

const scryptAsync = promisify(crypto.scrypt);

const AUTH_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'auth.json');
const COOKIE_NAME = 'ersatztv_session';
const AUTH_VERSION = 1;
const DEFAULT_SCRYPT = Object.freeze({
  algorithm: 'scrypt',
  keyLength: 64,
  N: 32768,
  r: 8,
  p: 1
});
const DEFAULT_SESSION = Object.freeze({
  maxAgeHours: 24,
  idleTimeoutMinutes: 120,
  cookieSecure: 'auto'
});
const DEFAULT_SECURITY = Object.freeze({
  maxFailedAttempts: 5,
  attemptWindowMinutes: 15,
  lockoutMinutes: 15,
  trustProxy: false
});

function nowMs() {
  return Date.now();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPositiveNumber(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeCookieSecure(value) {
  if (value === true || value === false || value === 'auto') return value;
  return DEFAULT_SESSION.cookieSecure;
}

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (username.length < 3 || username.length > 64) {
    throw new Error('O usuario deve ter entre 3 e 64 caracteres.');
  }
  if (!/^[\p{L}\p{N}._@-]+$/u.test(username)) {
    throw new Error('O usuario pode conter letras, numeros, ponto, hifen, sublinhado e @.');
  }
  return username;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12) throw new Error('A senha precisa ter pelo menos 12 caracteres.');
  if (value.length > 512) throw new Error('A senha excede o limite de 512 caracteres.');
  return value;
}

function normalizeAuthConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Arquivo de autenticacao invalido.');
  const password = raw.password && typeof raw.password === 'object' ? raw.password : {};
  const session = raw.session && typeof raw.session === 'object' ? raw.session : {};
  const security = raw.security && typeof raw.security === 'object' ? raw.security : {};

  const normalized = {
    version: AUTH_VERSION,
    username: normalizeUsername(raw.username),
    password: {
      algorithm: String(password.algorithm || 'scrypt'),
      salt: String(password.salt || '').trim(),
      hash: String(password.hash || '').trim(),
      keyLength: Math.floor(toPositiveNumber(password.keyLength, DEFAULT_SCRYPT.keyLength, 32, 128)),
      N: Math.floor(toPositiveNumber(password.N, DEFAULT_SCRYPT.N, 16384, 1048576)),
      r: Math.floor(toPositiveNumber(password.r, DEFAULT_SCRYPT.r, 1, 32)),
      p: Math.floor(toPositiveNumber(password.p, DEFAULT_SCRYPT.p, 1, 16))
    },
    sessionSecret: String(raw.sessionSecret || '').trim(),
    session: {
      maxAgeHours: toPositiveNumber(session.maxAgeHours, DEFAULT_SESSION.maxAgeHours, 1, 720),
      idleTimeoutMinutes: toPositiveNumber(session.idleTimeoutMinutes, DEFAULT_SESSION.idleTimeoutMinutes, 5, 10080),
      cookieSecure: normalizeCookieSecure(session.cookieSecure)
    },
    security: {
      maxFailedAttempts: Math.floor(toPositiveNumber(security.maxFailedAttempts, DEFAULT_SECURITY.maxFailedAttempts, 2, 100)),
      attemptWindowMinutes: toPositiveNumber(security.attemptWindowMinutes, DEFAULT_SECURITY.attemptWindowMinutes, 1, 1440),
      lockoutMinutes: toPositiveNumber(security.lockoutMinutes, DEFAULT_SECURITY.lockoutMinutes, 1, 1440),
      trustProxy: Boolean(security.trustProxy)
    }
  };

  if (normalized.password.algorithm !== 'scrypt') throw new Error('Algoritmo de senha nao suportado.');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(normalized.password.salt) || normalized.password.salt.length < 16) {
    throw new Error('Salt de senha invalido.');
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(normalized.password.hash) || normalized.password.hash.length < 32) {
    throw new Error('Hash de senha invalido.');
  }
  if (!/^[a-fA-F0-9]{64,256}$/.test(normalized.sessionSecret)) {
    throw new Error('Segredo de sessao invalido.');
  }

  return normalized;
}

function scryptMaxMemory(params) {
  return Math.max(64 * 1024 * 1024, 128 * params.N * params.r + 16 * 1024 * 1024);
}

async function derivePassword(password, passwordConfig) {
  const value = Buffer.from(String(password || ''), 'utf8');
  return scryptAsync(value, Buffer.from(passwordConfig.salt, 'base64'), passwordConfig.keyLength, {
    N: passwordConfig.N,
    r: passwordConfig.r,
    p: passwordConfig.p,
    maxmem: scryptMaxMemory(passwordConfig)
  });
}

async function hashPassword(password, params = DEFAULT_SCRYPT) {
  const validated = validatePassword(password);
  const config = {
    algorithm: 'scrypt',
    salt: crypto.randomBytes(24).toString('base64'),
    hash: '',
    keyLength: Number(params.keyLength) || DEFAULT_SCRYPT.keyLength,
    N: Number(params.N) || DEFAULT_SCRYPT.N,
    r: Number(params.r) || DEFAULT_SCRYPT.r,
    p: Number(params.p) || DEFAULT_SCRYPT.p
  };
  const derived = await derivePassword(validated, config);
  config.hash = Buffer.from(derived).toString('base64');
  return config;
}

async function verifyPassword(password, passwordConfig) {
  let derived;
  try {
    derived = Buffer.from(await derivePassword(password, passwordConfig));
  } catch {
    return false;
  }
  const expected = Buffer.from(passwordConfig.hash, 'base64');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function timingSafeTextEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

async function atomicWriteJson(filePath, value, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode });
  await fs.chmod(tempPath, mode);
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, mode);
}

async function buildAuthConfig({ username, password, existing = null } = {}) {
  const normalizedUsername = normalizeUsername(username);
  const passwordConfig = await hashPassword(password);
  const prior = existing && typeof existing === 'object' ? existing : {};
  const priorSession = prior.session && typeof prior.session === 'object' ? prior.session : {};
  const priorSecurity = prior.security && typeof prior.security === 'object' ? prior.security : {};
  const secret = /^[a-fA-F0-9]{64,256}$/.test(String(prior.sessionSecret || ''))
    ? String(prior.sessionSecret)
    : crypto.randomBytes(48).toString('hex');

  return normalizeAuthConfig({
    version: AUTH_VERSION,
    username: normalizedUsername,
    password: passwordConfig,
    sessionSecret: secret,
    session: {
      ...DEFAULT_SESSION,
      ...priorSession
    },
    security: {
      ...DEFAULT_SECURITY,
      ...priorSecurity
    }
  });
}

async function writeAuthConfig(config, filePath = AUTH_CONFIG_PATH) {
  const normalized = normalizeAuthConfig(config);
  await atomicWriteJson(filePath, normalized, 0o600);
  return normalized;
}

function parseCookies(header) {
  const result = {};
  for (const segment of String(header || '').split(';')) {
    const index = segment.indexOf('=');
    if (index <= 0) continue;
    const key = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function firstForwardedValue(value) {
  return String(value || '').split(',')[0].trim();
}

function safeHeaderValue(value) {
  return String(value || '').replace(/[\r\n]/g, '').trim();
}

function requestUserAgent(req) {
  return safeHeaderValue(req && req.headers && req.headers['user-agent']).slice(0, 1024);
}

function userAgentDigest(req) {
  return crypto.createHash('sha256').update(requestUserAgent(req), 'utf8').digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AuthManager {
  constructor(options = {}) {
    this.configPath = options.configPath || AUTH_CONFIG_PATH;
    this.config = null;
    this.setupRequired = true;
    this.setupError = null;
    this.sessions = new Map();
    this.attempts = new Map();
    this.cleanupTimer = null;
  }

  async init() {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      this.config = normalizeAuthConfig(JSON.parse(content));
      this.setupRequired = false;
      this.setupError = null;
      try {
        const stats = await fs.stat(this.configPath);
        if ((stats.mode & 0o077) !== 0) {
          await fs.chmod(this.configPath, 0o600);
          await logger.warn(`As permissoes de ${this.configPath} foram corrigidas automaticamente para 600.`);
        }
      } catch {
        // A leitura ja foi validada; falha de stat nao deve impedir a autenticacao.
      }
      this.startCleanupTimer();
      return this.getSetupStatus();
    } catch (error) {
      this.config = null;
      this.setupRequired = true;
      this.setupError = error.code === 'ENOENT'
        ? 'Arquivo config/auth.json ainda nao foi criado.'
        : `Arquivo config/auth.json invalido: ${error.message}`;
      await logger.warn(`Autenticacao bloqueada: ${this.setupError}`);
      return this.getSetupStatus();
    }
  }

  startCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  stop() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.sessions.clear();
    this.attempts.clear();
  }

  getSetupStatus() {
    return {
      setupRequired: this.setupRequired,
      setupError: this.setupError
    };
  }

  getClientIp(req) {
    if (this.config && this.config.security.trustProxy) {
      const forwarded = firstForwardedValue(req.headers && req.headers['x-forwarded-for']);
      if (forwarded) return forwarded.slice(0, 128);
      const realIp = safeHeaderValue(req.headers && req.headers['x-real-ip']);
      if (realIp) return realIp.slice(0, 128);
    }
    return String(req.socket && req.socket.remoteAddress || 'unknown').slice(0, 128);
  }

  isSecureRequest(req) {
    if (req.socket && req.socket.encrypted) return true;
    if (this.config && this.config.security.trustProxy) {
      return firstForwardedValue(req.headers && req.headers['x-forwarded-proto']).toLowerCase() === 'https';
    }
    return false;
  }

  expectedRequestOrigin(req) {
    const trustProxy = Boolean(this.config && this.config.security.trustProxy);
    const host = safeHeaderValue(
      trustProxy
        ? firstForwardedValue(req.headers && req.headers['x-forwarded-host']) || req.headers && req.headers.host
        : req.headers && req.headers.host
    );
    if (!host) return null;
    const protocol = this.isSecureRequest(req) ? 'https:' : 'http:';
    return { host: host.toLowerCase(), protocol };
  }

  validateOrigin(req) {
    const origin = safeHeaderValue(req.headers && req.headers.origin);
    if (!origin) return true;
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    const expected = this.expectedRequestOrigin(req);
    if (!expected) return false;
    return parsed.host.toLowerCase() === expected.host && parsed.protocol === expected.protocol;
  }

  signSessionId(id) {
    return crypto.createHmac('sha256', Buffer.from(this.config.sessionSecret, 'hex')).update(id).digest('base64url');
  }

  serializeSessionValue(id) {
    return `${id}.${this.signSessionId(id)}`;
  }

  verifySessionValue(value) {
    const text = String(value || '');
    const separator = text.lastIndexOf('.');
    if (separator <= 0) return null;
    const id = text.slice(0, separator);
    const signature = text.slice(separator + 1);
    const expected = this.signSessionId(id);
    if (!timingSafeTextEqual(signature, expected)) return null;
    return id;
  }

  shouldUseSecureCookie(req) {
    const setting = this.config.session.cookieSecure;
    if (setting === true) return true;
    if (setting === false) return false;
    return this.isSecureRequest(req);
  }

  makeCookie(value, req, maxAgeSeconds) {
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(value)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
      'Priority=High'
    ];
    if (this.config && this.shouldUseSecureCookie(req)) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookie(req) {
    return this.makeCookie('', req, 0);
  }

  getAttemptState(ip) {
    const now = nowMs();
    const windowMs = this.config.security.attemptWindowMinutes * 60 * 1000;
    let state = this.attempts.get(ip);
    if (!state || now - state.firstAttemptAt > windowMs) {
      state = { firstAttemptAt: now, failures: 0, lockedUntil: 0 };
      this.attempts.set(ip, state);
    }
    return state;
  }

  getLockStatus(ip) {
    const state = this.getAttemptState(ip);
    const remainingMs = Math.max(0, state.lockedUntil - nowMs());
    return {
      locked: remainingMs > 0,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000))
    };
  }

  recordFailure(ip) {
    const state = this.getAttemptState(ip);
    state.failures += 1;
    if (state.failures >= this.config.security.maxFailedAttempts) {
      state.lockedUntil = nowMs() + this.config.security.lockoutMinutes * 60 * 1000;
      state.failures = 0;
      state.firstAttemptAt = nowMs();
    }
    this.attempts.set(ip, state);
    return this.getLockStatus(ip);
  }

  clearFailures(ip) {
    this.attempts.delete(ip);
  }

  async login(username, password, req) {
    if (this.setupRequired || !this.config) {
      const error = new Error('A autenticacao ainda nao foi configurada no servidor.');
      error.statusCode = 503;
      error.code = 'AUTH_SETUP_REQUIRED';
      throw error;
    }

    const ip = this.getClientIp(req);
    const lock = this.getLockStatus(ip);
    if (lock.locked) {
      const error = new Error('Muitas tentativas. Aguarde antes de tentar novamente.');
      error.statusCode = 429;
      error.code = 'AUTH_RATE_LIMITED';
      error.retryAfterSeconds = lock.retryAfterSeconds;
      throw error;
    }

    const rawPassword = String(password || '');
    const passwordTooLong = rawPassword.length > 512;
    const passwordCandidate = passwordTooLong ? rawPassword.slice(0, 512) : rawPassword;
    const passwordOk = await verifyPassword(passwordCandidate, this.config.password);
    const rawUsername = String(username || '').trim();
    const usernameOk = rawUsername.length <= 64 && timingSafeTextEqual(rawUsername, this.config.username);
    if (passwordTooLong || !passwordOk || !usernameOk) {
      const updatedLock = this.recordFailure(ip);
      await delay(300 + crypto.randomInt(0, 250));
      const error = new Error(updatedLock.locked
        ? 'Muitas tentativas. Aguarde antes de tentar novamente.'
        : 'Usuario ou senha invalidos.');
      error.statusCode = updatedLock.locked ? 429 : 401;
      error.code = updatedLock.locked ? 'AUTH_RATE_LIMITED' : 'AUTH_INVALID_CREDENTIALS';
      error.retryAfterSeconds = updatedLock.locked ? updatedLock.retryAfterSeconds : null;
      throw error;
    }

    this.clearFailures(ip);
    const now = nowMs();
    const absoluteLifetimeMs = this.config.session.maxAgeHours * 60 * 60 * 1000;
    const id = randomToken(32);
    const session = {
      id,
      username: this.config.username,
      csrfToken: randomToken(32),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + absoluteLifetimeMs,
      userAgentHash: userAgentDigest(req),
      ip
    };
    this.sessions.set(id, session);
    this.cleanup();

    return {
      session: clone(session),
      cookie: this.makeCookie(this.serializeSessionValue(id), req, Math.floor(absoluteLifetimeMs / 1000))
    };
  }

  getSession(req, options = {}) {
    if (this.setupRequired || !this.config) return null;
    const cookies = parseCookies(req.headers && req.headers.cookie);
    const id = this.verifySessionValue(cookies[COOKIE_NAME]);
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;

    const now = nowMs();
    const idleMs = this.config.session.idleTimeoutMinutes * 60 * 1000;
    if (session.expiresAt <= now || now - session.lastSeenAt > idleMs || session.userAgentHash !== userAgentDigest(req)) {
      this.sessions.delete(id);
      return null;
    }

    if (options.touch !== false) session.lastSeenAt = now;
    return session;
  }

  validateCsrf(req, session) {
    if (!session) return false;
    const token = safeHeaderValue(req.headers && req.headers['x-csrf-token']);
    return Boolean(token) && timingSafeTextEqual(token, session.csrfToken) && this.validateOrigin(req);
  }

  logout(req) {
    const cookies = parseCookies(req.headers && req.headers.cookie);
    const id = this.verifySessionValue(cookies[COOKIE_NAME]);
    if (id) this.sessions.delete(id);
    return this.clearCookie(req);
  }

  publicSession(req, session) {
    return {
      authenticated: Boolean(session),
      setupRequired: this.setupRequired,
      username: session ? session.username : null,
      csrfToken: session ? session.csrfToken : null,
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
      idleTimeoutMinutes: this.config ? this.config.session.idleTimeoutMinutes : null,
      secureTransport: this.isSecureRequest(req),
      trustProxy: this.config ? this.config.security.trustProxy : false
    };
  }

  cleanup() {
    const now = nowMs();
    if (this.config) {
      const idleMs = this.config.session.idleTimeoutMinutes * 60 * 1000;
      for (const [id, session] of this.sessions.entries()) {
        if (session.expiresAt <= now || now - session.lastSeenAt > idleMs) this.sessions.delete(id);
      }
      const windowMs = this.config.security.attemptWindowMinutes * 60 * 1000;
      for (const [ip, state] of this.attempts.entries()) {
        if (state.lockedUntil <= now && now - state.firstAttemptAt > windowMs) this.attempts.delete(ip);
      }
    }
  }
}

const authManager = new AuthManager();

module.exports = authManager;
module.exports.AuthManager = AuthManager;
module.exports.AUTH_CONFIG_PATH = AUTH_CONFIG_PATH;
module.exports.COOKIE_NAME = COOKIE_NAME;
module.exports.AUTH_VERSION = AUTH_VERSION;
module.exports.DEFAULT_SCRYPT = DEFAULT_SCRYPT;
module.exports.DEFAULT_SESSION = DEFAULT_SESSION;
module.exports.DEFAULT_SECURITY = DEFAULT_SECURITY;
module.exports.normalizeUsername = normalizeUsername;
module.exports.validatePassword = validatePassword;
module.exports.normalizeAuthConfig = normalizeAuthConfig;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.buildAuthConfig = buildAuthConfig;
module.exports.writeAuthConfig = writeAuthConfig;
module.exports.parseCookies = parseCookies;
