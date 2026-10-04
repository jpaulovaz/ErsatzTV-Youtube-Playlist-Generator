const pkg = require('../../package.json');
const { parseLrc } = require('../subtitleManager/subtitleFormats');
const { scoreCandidate } = require('./matchScore');

const BASE_URL = 'https://lrclib.net';
const TIMEOUT_MS = 15000;

function cleanText(value, max = 220) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeLanguage(value) {
  const lang = cleanText(value, 32).replace(/[^A-Za-z0-9._-]/g, '');
  return lang || 'und';
}

async function requestJson(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': `ErsatzTV-YouTube-Downloader/${pkg.version} subtitle-manager`
      }
    });
    if (response.status === 429) {
      const retryHeader = String(response.headers.get('retry-after') || '').trim();
      let retryAfterSeconds = Number(retryHeader);
      if (!Number.isFinite(retryAfterSeconds) && retryHeader) {
        const retryAt = Date.parse(retryHeader);
        if (Number.isFinite(retryAt)) retryAfterSeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
      }
      const wait = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : null;
      const error = new Error(wait
        ? `LRCLIB limitou temporariamente as consultas. Tente novamente em cerca de ${wait} segundo(s).`
        : 'LRCLIB limitou temporariamente as consultas. Tente novamente mais tarde.');
      error.statusCode = 429;
      if (wait) error.retryAfterSeconds = wait;
      throw error;
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = new Error(`LRCLIB respondeu HTTP ${response.status}.`);
      error.statusCode = response.status >= 500 ? 502 : response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      const wrapped = new Error('Tempo limite excedido ao consultar o LRCLIB.');
      wrapped.statusCode = 504;
      throw wrapped;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRecord(record, query = {}, videoDurationSeconds = null) {
  if (!record || typeof record !== 'object') return null;
  const id = Number(record.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const candidate = {
    provider: 'lrclib',
    candidateId: String(id),
    providerId: String(id),
    language: normalizeLanguage(record.lang || record.language),
    label: cleanText(record.trackName || record.name || `LRCLIB #${id}`),
    trackName: cleanText(record.trackName || record.name),
    artistName: cleanText(record.artistName),
    albumName: cleanText(record.albumName),
    durationSeconds: Number(record.duration) > 0 ? Number(record.duration) : null,
    sourceType: record.instrumental ? 'instrumental' : (record.syncedLyrics ? 'synced-lyrics' : 'plain-lyrics'),
    canPreview: Boolean(record.syncedLyrics) && !record.instrumental,
    canApply: Boolean(record.syncedLyrics) && !record.instrumental,
    instrumental: Boolean(record.instrumental),
    warnings: []
  };
  const match = scoreCandidate(query, record, videoDurationSeconds);
  candidate.match = { score: match.score, label: match.label, durationDeltaSeconds: match.durationDeltaSeconds };
  candidate.warnings.push(...match.warnings);
  if (candidate.instrumental) candidate.warnings.push('Faixa marcada como instrumental.');
  else if (!record.syncedLyrics) candidate.warnings.push('Resultado sem letra sincronizada.');
  return candidate;
}

async function search(context, queryInput = {}) {
  const query = {
    artist: cleanText(queryInput.artist),
    track: cleanText(queryInput.track),
    album: cleanText(queryInput.album)
  };
  if (!query.track) {
    const error = new Error('Informe o nome da musica para pesquisar no LRCLIB.');
    error.statusCode = 400;
    throw error;
  }
  const params = new URLSearchParams();
  params.set('track_name', query.track);
  if (query.artist) params.set('artist_name', query.artist);
  if (query.album) params.set('album_name', query.album);
  const records = await requestJson(`/api/search?${params.toString()}`);
  const candidates = (Array.isArray(records) ? records : [])
    .map((record) => normalizeRecord(record, query, context.durationSeconds))
    .filter(Boolean)
    .sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0));
  return { query, candidates };
}

async function getRecord(candidateId) {
  const id = Number(candidateId);
  if (!Number.isFinite(id) || id <= 0) {
    const error = new Error('Candidato LRCLIB invalido.');
    error.statusCode = 400;
    throw error;
  }
  const record = await requestJson(`/api/get/${id}`);
  if (!record) {
    const error = new Error('Candidato LRCLIB nao encontrado.');
    error.statusCode = 404;
    throw error;
  }
  return record;
}

async function materialize(context, candidate, options = {}) {
  const record = await getRecord(candidate.candidateId || candidate.providerId);
  if (record.instrumental) {
    const error = new Error('O resultado LRCLIB selecionado e instrumental.');
    error.statusCode = 400;
    throw error;
  }
  if (!record.syncedLyrics) {
    const error = new Error('O resultado LRCLIB selecionado nao possui letra sincronizada.');
    error.statusCode = 400;
    throw error;
  }
  const cues = parseLrc(record.syncedLyrics, { durationSeconds: Number(record.duration) || context.durationSeconds });
  if (!cues.length) {
    const error = new Error('Nao foi possivel converter a letra sincronizada do LRCLIB.');
    error.statusCode = 422;
    throw error;
  }
  return {
    provider: 'lrclib',
    providerId: String(record.id),
    sourceType: 'synced-lyrics',
    sourceLabel: 'LRCLIB · letra sincronizada',
    language: normalizeLanguage(options.language || record.lang || record.language),
    cues,
    metadata: {
      trackName: cleanText(record.trackName || record.name),
      artistName: cleanText(record.artistName),
      albumName: cleanText(record.albumName),
      durationSeconds: Number(record.duration) || null
    }
  };
}

module.exports = { search, materialize, getRecord, normalizeRecord, normalizeLanguage };
