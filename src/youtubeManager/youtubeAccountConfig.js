const fs = require('fs/promises');
const path = require('path');
const { CONFIG_PATH: MAIN_CONFIG_PATH } = require('../config');

const CONFIG_VERSION = 1;
const DEFAULT_PUBLIC_BASE_URL = 'https://yt.johnflix.com.br/';
const CALLBACK_PATH = '/api/youtube-manager/oauth/callback';
const CONFIG_PATH = process.env.ERSATZTV_YOUTUBE_ACCOUNT_CONFIG_PATH
  ? path.resolve(process.env.ERSATZTV_YOUTUBE_ACCOUNT_CONFIG_PATH)
  : path.join(path.dirname(MAIN_CONFIG_PATH), 'youtube-account.json');

const DEFAULTS = Object.freeze({
  version: CONFIG_VERSION,
  clientId: '',
  clientSecret: '',
  publicBaseUrl: DEFAULT_PUBLIC_BASE_URL
});

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || DEFAULT_PUBLIC_BASE_URL).trim());
  } catch {
    throw new Error('URL publica do aplicativo invalida.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('URL publica nao deve conter credenciais, query string ou fragmento.');
  }
  const hostname = parsed.hostname.toLowerCase();
  const localhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (parsed.protocol !== 'https:' && !(localhost && parsed.protocol === 'http:')) {
    throw new Error('OAuth do Google exige HTTPS; apenas localhost pode usar HTTP.');
  }
  if (!localhost && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    throw new Error('OAuth do Google nao aceita IP bruto como host remoto. Use um dominio HTTPS.');
  }
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function normalize(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const baseUrl = normalizeBaseUrl(source.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL);
  return {
    version: CONFIG_VERSION,
    clientId: String(source.clientId || '').trim(),
    clientSecret: String(source.clientSecret || '').trim(),
    publicBaseUrl: baseUrl
  };
}

function redirectUri(config) {
  const base = new URL((config && config.publicBaseUrl) || DEFAULT_PUBLIC_BASE_URL);
  return new URL(CALLBACK_PATH, base).toString();
}

async function loadFile() {
  try {
    const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
    return normalize(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') return normalize(DEFAULTS);
    if (error instanceof SyntaxError) {
      await fs.rename(CONFIG_PATH, `${CONFIG_PATH}.invalid-${Date.now()}`).catch(() => {});
      return normalize(DEFAULTS);
    }
    throw error;
  }
}

async function load() {
  const file = await loadFile();
  const clientId = String(process.env.YOUTUBE_OAUTH_CLIENT_ID || '').trim() || file.clientId;
  const clientSecret = String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '').trim() || file.clientSecret;
  const publicBaseUrl = process.env.YOUTUBE_PUBLIC_BASE_URL
    ? normalizeBaseUrl(process.env.YOUTUBE_PUBLIC_BASE_URL)
    : file.publicBaseUrl;
  return {
    ...file,
    clientId,
    clientSecret,
    publicBaseUrl,
    clientIdSource: process.env.YOUTUBE_OAUTH_CLIENT_ID ? 'environment' : (file.clientId ? 'file' : 'none'),
    clientSecretSource: process.env.YOUTUBE_OAUTH_CLIENT_SECRET ? 'environment' : (file.clientSecret ? 'file' : 'none')
  };
}

async function atomicWrite(value) {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  const temp = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(temp, 0o600).catch(() => {});
  await fs.rename(temp, CONFIG_PATH);
  await fs.chmod(CONFIG_PATH, 0o600).catch(() => {});
}

async function save(patch = {}) {
  const current = await loadFile();
  const next = { ...current, ...patch };
  if (!Object.prototype.hasOwnProperty.call(patch, 'clientSecret') || !String(patch.clientSecret || '').trim()) {
    next.clientSecret = current.clientSecret;
  }
  if (!Object.prototype.hasOwnProperty.call(patch, 'clientId') || !String(patch.clientId || '').trim()) {
    next.clientId = current.clientId;
  }
  if (patch.clearClientSecret === true) next.clientSecret = '';
  delete next.clearClientSecret;
  const normalized = normalize(next);
  await atomicWrite(normalized);
  return load();
}

function publicStatus(config) {
  const value = config || {};
  return {
    version: CONFIG_VERSION,
    configured: Boolean(value.clientId && value.clientSecret),
    clientIdConfigured: Boolean(value.clientId),
    clientId: value.clientId || '',
    clientSecretConfigured: Boolean(value.clientSecret),
    clientIdSource: value.clientIdSource || 'none',
    clientSecretSource: value.clientSecretSource || 'none',
    publicBaseUrl: value.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL,
    redirectUri: redirectUri(value),
    redirectReady: true,
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl'
  };
}

module.exports = {
  CONFIG_VERSION,
  CONFIG_PATH,
  CALLBACK_PATH,
  DEFAULT_PUBLIC_BASE_URL,
  DEFAULTS,
  normalizeBaseUrl,
  normalize,
  redirectUri,
  load,
  save,
  publicStatus
};
