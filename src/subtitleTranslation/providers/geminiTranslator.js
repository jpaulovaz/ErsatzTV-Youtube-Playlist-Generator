const { buildPrompt } = require('../translationPrompt');

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseRetryAfter(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  return null;
}

async function fetchJson(url, options, settings = {}) {
  const attempts = Math.max(1, Number(settings.maxAttempts) || 3);
  const timeoutMs = Math.max(10000, Number(settings.timeoutSeconds || 60) * 1000);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (response.ok) return { data, response };
      const retryAfter = parseRetryAfter(response.headers);
      const error = new Error(data && data.error && data.error.message ? data.error.message : `Gemini API retornou HTTP ${response.status}.`);
      error.statusCode = response.status === 429 ? 429 : 502;
      error.providerStatus = response.status;
      error.retryAfterSeconds = retryAfter;
      error.code = response.status === 429 ? 'GEMINI_RATE_LIMIT' : `GEMINI_HTTP_${response.status}`;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= attempts) throw error;
      lastError = error;
      await sleep((retryAfter || Math.min(30, 2 ** (attempt - 1))) * 1000);
    } catch (error) {
      if (error.name === 'AbortError') {
        const wrapped = new Error('Timeout ao consultar Gemini.');
        wrapped.code = 'GEMINI_TIMEOUT';
        wrapped.statusCode = 504;
        lastError = wrapped;
      } else {
        lastError = error;
      }
      if (attempt >= attempts || (lastError.providerStatus && ![429, 500, 502, 503, 504].includes(lastError.providerStatus))) throw lastError;
      await sleep(Math.min(30, 2 ** (attempt - 1)) * 1000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Falha desconhecida ao consultar Gemini.');
}

function headers(apiKey) {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

async function listModels(config) {
  if (!config.apiKey) {
    const error = new Error('Configure a API key do Gemini antes de consultar modelos.');
    error.statusCode = 400;
    throw error;
  }
  const { data } = await fetchJson(`${API_ROOT}/models?pageSize=1000`, { method: 'GET', headers: headers(config.apiKey) }, config);
  return (Array.isArray(data.models) ? data.models : [])
    .filter((model) => {
      const methods = model.supportedGenerationMethods || model.supportedActions || [];
      return methods.includes('generateContent');
    })
    .map((model) => ({
      name: String(model.name || '').replace(/^models\//, ''),
      displayName: String(model.displayName || model.name || ''),
      description: String(model.description || ''),
      inputTokenLimit: Number(model.inputTokenLimit) || null,
      outputTokenLimit: Number(model.outputTokenLimit) || null
    }))
    .filter((model) => model.name)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR', { sensitivity: 'base' }));
}

async function testConnection(config) {
  const models = await listModels(config);
  const selected = models.find((model) => model.name === config.model);
  if (!selected) {
    const error = new Error(`O modelo ${config.model} nao esta disponivel para generateContent nesta chave/projeto.`);
    error.statusCode = 400;
    throw error;
  }
  return { ok: true, model: selected, modelsAvailable: models.length };
}

function responseSchema() {
  return {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, text: { type: 'string' } },
          required: ['id', 'text']
        }
      }
    },
    required: ['translations']
  };
}

async function translate(config, request) {
  if (!config.apiKey) {
    const error = new Error('Gemini nao esta configurado. Informe GEMINI_API_KEY ou salve uma API key em Configuracoes.');
    error.statusCode = 400;
    throw error;
  }
  const prompt = buildPrompt(request);
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: responseSchema()
    }
  };
  const endpoint = `${API_ROOT}/models/${encodeURIComponent(config.model)}:generateContent`;
  const { data } = await fetchJson(endpoint, { method: 'POST', headers: headers(config.apiKey), body: JSON.stringify(body) }, config);
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((part) => part && part.text || '').join('').trim() : '';
  if (!text) {
    const reason = data && data.candidates && data.candidates[0] && data.candidates[0].finishReason;
    const error = new Error(`Gemini nao devolveu texto estruturado${reason ? ` (${reason})` : ''}.`);
    error.code = 'GEMINI_EMPTY_RESPONSE';
    error.statusCode = 502;
    throw error;
  }
  try { return JSON.parse(text); }
  catch {
    const error = new Error('Gemini devolveu JSON invalido.');
    error.code = 'GEMINI_INVALID_JSON';
    error.statusCode = 502;
    throw error;
  }
}

module.exports = { API_ROOT, listModels, testConnection, translate, parseRetryAfter };
