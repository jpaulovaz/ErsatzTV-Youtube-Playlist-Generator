const crypto = require('crypto');
const accountConfig = require('./youtubeAccountConfig');
const accountState = require('./youtubeAccountState');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const STATE_TTL_MS = 15 * 60 * 1000;

class YouTubeOAuthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'YouTubeOAuthError';
    this.code = details.code || 'YOUTUBE_OAUTH_ERROR';
    this.statusCode = details.statusCode || 400;
    this.details = details;
  }
}

async function postForm(url, values, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) {
      const message = payload.error_description || payload.error || `OAuth HTTP ${response.status}`;
      throw new YouTubeOAuthError(message, { code: String(payload.error || 'YOUTUBE_OAUTH_HTTP'), statusCode: response.status, payload });
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new YouTubeOAuthError('Timeout ao comunicar com o Google OAuth.', { code: 'YOUTUBE_OAUTH_TIMEOUT', statusCode: 504 });
    if (error instanceof YouTubeOAuthError) throw error;
    throw new YouTubeOAuthError(`Falha ao comunicar com o Google OAuth: ${error.message}`, { code: 'YOUTUBE_OAUTH_NETWORK', statusCode: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function startAuthorization() {
  const config = await accountConfig.load();
  if (!config.clientId || !config.clientSecret) {
    throw new YouTubeOAuthError('Configure Client ID e Client Secret antes de conectar a conta.', { code: 'YOUTUBE_OAUTH_NOT_CONFIGURED' });
  }
  const stateValue = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const state = await accountState.load();
  state.pendingAuth = {
    state: stateValue,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + STATE_TTL_MS).toISOString(),
    redirectUri: accountConfig.redirectUri(config)
  };
  state.lastError = null;
  await accountState.save(state);

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', accountConfig.redirectUri(config));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', stateValue);
  return {
    authorizationUrl: url.toString(),
    redirectUri: accountConfig.redirectUri(config),
    scope: YOUTUBE_SCOPE,
    expiresAt: state.pendingAuth.expiresAt
  };
}

async function handleCallback({ state: returnedState, code, error: oauthError, errorDescription } = {}) {
  const config = await accountConfig.load();
  const state = await accountState.load();
  const pending = state.pendingAuth;

  if (oauthError) {
    state.pendingAuth = null;
    state.lastError = String(errorDescription || oauthError);
    await accountState.save(state);
    throw new YouTubeOAuthError(`Autorizacao recusada pelo Google: ${state.lastError}`, { code: 'YOUTUBE_OAUTH_DENIED' });
  }
  if (!pending || !pending.state || !returnedState || pending.state !== returnedState) {
    throw new YouTubeOAuthError('State OAuth invalido ou expirado. Inicie a conexao novamente.', { code: 'YOUTUBE_OAUTH_STATE_INVALID', statusCode: 403 });
  }
  if (new Date(pending.expiresAt).getTime() < Date.now()) {
    state.pendingAuth = null;
    await accountState.save(state);
    throw new YouTubeOAuthError('A autorizacao OAuth expirou. Inicie a conexao novamente.', { code: 'YOUTUBE_OAUTH_STATE_EXPIRED', statusCode: 403 });
  }
  if (!code) throw new YouTubeOAuthError('Google nao retornou o codigo OAuth.', { code: 'YOUTUBE_OAUTH_CODE_MISSING' });

  const payload = await postForm(TOKEN_ENDPOINT, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: accountConfig.redirectUri(config)
  });

  const previousRefreshToken = state.tokens && state.tokens.refreshToken || '';
  const accessToken = String(payload.access_token || '').trim();
  const refreshToken = String(payload.refresh_token || previousRefreshToken || '').trim();
  if (!accessToken) throw new YouTubeOAuthError('Google nao retornou access token.', { code: 'YOUTUBE_OAUTH_TOKEN_MISSING', statusCode: 502 });
  if (!refreshToken) throw new YouTubeOAuthError('Google nao retornou refresh token. Reconecte usando consentimento offline.', { code: 'YOUTUBE_OAUTH_REFRESH_TOKEN_MISSING', statusCode: 502 });

  const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
  state.tokens = {
    accessToken,
    refreshToken,
    tokenType: String(payload.token_type || 'Bearer'),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
  };
  state.scopes = String(payload.scope || YOUTUBE_SCOPE).split(/\s+/).filter(Boolean);
  state.pendingAuth = null;
  state.lastError = null;
  await accountState.save(state);
  return { connected: true, scopes: state.scopes, expiresAt: state.tokens.expiresAt };
}

async function disconnect() {
  const state = await accountState.load();
  const token = state.tokens && (state.tokens.refreshToken || state.tokens.accessToken);
  if (token) {
    try {
      await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token })
      });
    } catch {
      // Revogacao remota e best-effort; os tokens locais sempre sao removidos.
    }
  }
  await accountState.clear();
  return { disconnected: true };
}

module.exports = {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  REVOKE_ENDPOINT,
  YOUTUBE_SCOPE,
  YouTubeOAuthError,
  startAuthorization,
  handleCallback,
  disconnect,
  postForm
};
