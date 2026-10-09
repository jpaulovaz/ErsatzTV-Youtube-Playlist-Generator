const accountConfig = require('./youtubeAccountConfig');
const accountState = require('./youtubeAccountState');
const { TOKEN_ENDPOINT, YOUTUBE_SCOPE, postForm } = require('./youtubeOAuthService');

const API_BASE = 'https://www.googleapis.com/youtube/v3';

class YouTubeAccountError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'YouTubeAccountError';
    this.code = details.code || 'YOUTUBE_ACCOUNT_ERROR';
    this.statusCode = details.statusCode || details.status || 400;
    this.status = details.status || 0;
    this.reason = details.reason || '';
    this.payload = details.payload || null;
  }
}

function hasRequiredScope(scopes) {
  return (scopes || []).includes(YOUTUBE_SCOPE) || (scopes || []).includes('https://www.googleapis.com/auth/youtube');
}

async function refreshAccessToken(config, state) {
  const refreshToken = String(state.tokens && state.tokens.refreshToken || '').trim();
  if (!refreshToken) throw new YouTubeAccountError('Refresh token inexistente. Reconecte a conta do YouTube.', { code: 'YOUTUBE_RECONNECT_REQUIRED', statusCode: 401 });
  const payload = await postForm(TOKEN_ENDPOINT, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const accessToken = String(payload.access_token || '').trim();
  if (!accessToken) throw new YouTubeAccountError('Google nao retornou novo access token.', { code: 'YOUTUBE_TOKEN_REFRESH_FAILED', statusCode: 502 });
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
  state.tokens = {
    ...state.tokens,
    accessToken,
    tokenType: String(payload.token_type || state.tokens.tokenType || 'Bearer'),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
  };
  if (payload.scope) state.scopes = String(payload.scope).split(/\s+/).filter(Boolean);
  state.lastError = null;
  await accountState.save(state);
  return accessToken;
}

async function ensureAccessToken({ forceRefresh = false } = {}) {
  const config = await accountConfig.load();
  const state = await accountState.load();
  if (!config.clientId || !config.clientSecret) {
    throw new YouTubeAccountError('OAuth do YouTube ainda nao foi configurado.', { code: 'YOUTUBE_OAUTH_NOT_CONFIGURED' });
  }
  if (!state.tokens) {
    throw new YouTubeAccountError('Conta do YouTube nao conectada.', { code: 'YOUTUBE_ACCOUNT_NOT_CONNECTED', statusCode: 401 });
  }
  const expiresAt = new Date(state.tokens.expiresAt || 0).getTime();
  if (!forceRefresh && state.tokens.accessToken && expiresAt > Date.now() + 60000) return state.tokens.accessToken;
  try {
    return await refreshAccessToken(config, state);
  } catch (error) {
    state.lastError = error.message;
    await accountState.save(state).catch(() => {});
    if (error.code === 'invalid_grant' || /invalid_grant/i.test(error.message)) {
      throw new YouTubeAccountError('A autorizacao do YouTube expirou ou foi revogada. Reconecte a conta.', { code: 'YOUTUBE_RECONNECT_REQUIRED', statusCode: 401 });
    }
    throw error;
  }
}

async function authorizedRequest(endpoint, params = {}, options = {}, retry = true) {
  const token = await ensureAccessToken({ forceRefresh: false });
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 20000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.headers || {})
    };
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(url, { method: options.method || 'GET', headers, body, signal: controller.signal });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) {
      const info = payload && payload.error || {};
      const reason = info.errors && info.errors[0] && info.errors[0].reason || '';
      if (response.status === 401 && retry) {
        await ensureAccessToken({ forceRefresh: true });
        return authorizedRequest(endpoint, params, options, false);
      }
      throw new YouTubeAccountError(info.message || `YouTube API HTTP ${response.status}`, {
        code: reason || 'YOUTUBE_API_ERROR',
        statusCode: response.status,
        status: response.status,
        reason,
        payload
      });
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new YouTubeAccountError('Timeout ao consultar a conta do YouTube.', { code: 'YOUTUBE_ACCOUNT_TIMEOUT', statusCode: 504 });
    if (error instanceof YouTubeAccountError) throw error;
    throw new YouTubeAccountError(`Falha ao consultar a conta do YouTube: ${error.message}`, { code: 'YOUTUBE_ACCOUNT_NETWORK', statusCode: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAccountSummary() {
  const payload = await authorizedRequest('channels', { part: 'id,snippet', mine: 'true', maxResults: 1 });
  const item = Array.isArray(payload.items) ? payload.items[0] : null;
  if (!item || !item.id) throw new YouTubeAccountError('Nenhum canal do YouTube foi encontrado para a conta conectada.', { code: 'YOUTUBE_CHANNEL_NOT_FOUND', statusCode: 404 });
  const state = await accountState.load();
  state.account = {
    channelId: item.id,
    title: item.snippet && item.snippet.title || item.id,
    customUrl: item.snippet && item.snippet.customUrl || '',
    thumbnailUrl: item.snippet && item.snippet.thumbnails && (item.snippet.thumbnails.high || item.snippet.thumbnails.default) && (item.snippet.thumbnails.high || item.snippet.thumbnails.default).url || '',
    verifiedAt: new Date().toISOString()
  };
  state.lastError = null;
  await accountState.save(state);
  return state.account;
}

async function getStatus({ verify = false } = {}) {
  const config = await accountConfig.load();
  let state = await accountState.load();
  if (verify && state.tokens) {
    try { await refreshAccountSummary(); } catch (error) {
      state = await accountState.load();
      state.lastError = error.message;
      await accountState.save(state).catch(() => {});
    }
    state = await accountState.load();
  }
  return {
    config: accountConfig.publicStatus(config),
    connected: Boolean(state.tokens && state.tokens.refreshToken),
    scopes: state.scopes || [],
    scopeGranted: hasRequiredScope(state.scopes || []),
    account: state.account,
    tokenExpiresAt: state.tokens && state.tokens.expiresAt || null,
    lastError: state.lastError || null,
    pendingAuthorization: Boolean(state.pendingAuth)
  };
}

module.exports = {
  API_BASE,
  YouTubeAccountError,
  hasRequiredScope,
  ensureAccessToken,
  authorizedRequest,
  refreshAccountSummary,
  getStatus
};
