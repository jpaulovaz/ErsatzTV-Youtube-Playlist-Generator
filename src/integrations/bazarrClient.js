const path = require('path');

function configured(bazarr = {}) {
  return Boolean(bazarr.enabled && String(bazarr.url || '').trim() && String(bazarr.apiKey || '').trim());
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function timeoutMs(bazarr = {}) {
  return Math.max(5000, Math.min(120000, (Number(bazarr.timeoutSeconds) || 20) * 1000));
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function request(bazarr, pathname, options = {}) {
  if (!configured(bazarr)) {
    const error = new Error('A integracao com o Bazarr nao esta configurada.');
    error.statusCode = 409;
    error.code = 'BAZARR_NOT_CONFIGURED';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(bazarr));
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const headers = { 'X-API-KEY': String(bazarr.apiKey).trim(), Accept: 'application/json', ...(options.headers || {}) };
    const response = await fetch(`${normalizeUrl(bazarr.url)}/api${pathname}`, { ...options, headers, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text.trim()) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      const detail = typeof body === 'string' ? body : (body?.message || body?.error || '');
      const error = new Error(`Bazarr respondeu HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
      error.statusCode = response.status === 401 ? 401 : 502;
      error.code = response.status === 401 ? 'BAZARR_AUTH_REQUIRED' : 'BAZARR_REQUEST_FAILED';
      error.bazarrStatus = response.status;
      throw error;
    }
    return { status: response.status, body };
  } catch (error) {
    if (error.name === 'AbortError') {
      const wrapped = new Error('Tempo limite excedido ao acessar o Bazarr.');
      wrapped.statusCode = 504;
      wrapped.code = 'BAZARR_TIMEOUT';
      throw wrapped;
    }
    if (error.code || error.statusCode) throw error;
    const wrapped = new Error(`Nao foi possivel acessar o Bazarr: ${error.message}`);
    wrapped.statusCode = 502;
    wrapped.code = 'BAZARR_UNAVAILABLE';
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

function pathKey(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isUnder(root, candidate) {
  const normalizedRoot = pathKey(root);
  const normalizedCandidate = pathKey(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function mapLocalToBazarr(localPath, bazarr = {}) {
  const mappings = Array.isArray(bazarr.pathMappings) ? [...bazarr.pathMappings] : [];
  mappings.sort((a, b) => String(b.localRoot || '').length - String(a.localRoot || '').length);
  for (const mapping of mappings) {
    if (!mapping?.localRoot || !mapping?.bazarrRoot || !isUnder(mapping.localRoot, localPath)) continue;
    const relative = path.relative(path.resolve(mapping.localRoot), path.resolve(localPath));
    const parts = relative.split(path.sep).filter(Boolean);
    return path.posix.join(String(mapping.bazarrRoot).replace(/\\/g, '/'), ...parts);
  }
  return String(localPath || '').replace(/\\/g, '/');
}

async function testConnection(bazarr) {
  const response = await request(bazarr, '/providers');
  return { ok: true, providers: unwrapList(response.body).length };
}

function numberFrom(record, keys) {
  for (const key of keys) {
    const value = Number(record?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

async function listMovies(bazarr) {
  const response = await request(bazarr, '/movies?start=0&length=-1');
  return unwrapList(response.body);
}

async function listSeries(bazarr) {
  const response = await request(bazarr, '/series?start=0&length=-1');
  return unwrapList(response.body);
}

async function listEpisodes(bazarr, seriesId) {
  const query = new URLSearchParams();
  if (seriesId) query.append('seriesid[]', String(seriesId));
  const response = await request(bazarr, `/episodes?${query.toString()}`);
  return unwrapList(response.body);
}

async function findMediaByPath(bazarr, localMediaPath) {
  const mappedPath = mapLocalToBazarr(localMediaPath, bazarr);
  const target = pathKey(mappedPath);
  const movies = await listMovies(bazarr);
  for (const movie of movies) {
    if (pathKey(movie.path) !== target) continue;
    return {
      type: 'movie',
      id: numberFrom(movie, ['radarrId', 'radarrid', 'id']),
      radarrId: numberFrom(movie, ['radarrId', 'radarrid', 'id']),
      title: movie.title || path.basename(mappedPath),
      path: movie.path || mappedPath
    };
  }

  const series = await listSeries(bazarr);
  const candidateSeries = series
    .filter((entry) => entry?.path && isUnder(entry.path, mappedPath))
    .sort((a, b) => String(b.path || '').length - String(a.path || '').length)[0];
  if (!candidateSeries) return null;
  const seriesId = numberFrom(candidateSeries, ['sonarrSeriesId', 'sonarrSeriesID', 'seriesId', 'id']);
  if (!seriesId) return null;
  const episodes = await listEpisodes(bazarr, seriesId);
  const episode = episodes.find((entry) => pathKey(entry.path) === target);
  if (!episode) return null;
  return {
    type: 'episode',
    id: numberFrom(episode, ['sonarrEpisodeId', 'episodeId', 'id']),
    episodeId: numberFrom(episode, ['sonarrEpisodeId', 'episodeId', 'id']),
    seriesId,
    title: episode.title || path.basename(mappedPath),
    seriesTitle: candidateSeries.title || '',
    season: Number(episode.season) || Number(episode.seasonNumber) || null,
    episode: Number(episode.episode) || Number(episode.episodeNumber) || null,
    path: episode.path || mappedPath
  };
}

function normalizeCandidate(candidate = {}, index = 0) {
  return {
    candidateId: String(candidate.subtitle || candidate.id || index),
    provider: String(candidate.provider || ''),
    language: String(candidate.language || ''),
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
    scoreWithoutHash: Number.isFinite(Number(candidate.score_without_hash)) ? Number(candidate.score_without_hash) : null,
    forced: String(candidate.forced || '').toLowerCase() === 'true',
    hearingImpaired: String(candidate.hearing_impaired || '').toLowerCase() === 'true',
    originalFormat: String(candidate.original_format || '').toLowerCase() === 'true' || candidate.original_format === true,
    releaseInfo: Array.isArray(candidate.release_info) ? candidate.release_info : [],
    matches: Array.isArray(candidate.matches) ? candidate.matches : [],
    dontMatches: Array.isArray(candidate.dont_matches) ? candidate.dont_matches : [],
    uploader: candidate.uploader || null,
    url: candidate.url || null
  };
}

async function searchSubtitles(bazarr, match) {
  if (!match) {
    const error = new Error('Este arquivo nao foi encontrado no catalogo do Bazarr.');
    error.statusCode = 404;
    error.code = 'BAZARR_MEDIA_NOT_FOUND';
    throw error;
  }
  const pathname = match.type === 'movie'
    ? `/providers/movies?radarrid=${encodeURIComponent(match.radarrId)}`
    : `/providers/episodes?episodeid=${encodeURIComponent(match.episodeId)}`;
  const response = await request(bazarr, pathname);
  return unwrapList(response.body).map(normalizeCandidate);
}

async function downloadCandidate(bazarr, match, candidate) {
  if (!match) {
    const error = new Error('Este arquivo nao foi encontrado no catalogo do Bazarr.');
    error.statusCode = 404;
    throw error;
  }
  const body = new URLSearchParams();
  if (match.type === 'movie') body.set('radarrid', String(match.radarrId));
  else {
    body.set('seriesid', String(match.seriesId));
    body.set('episodeid', String(match.episodeId));
  }
  body.set('hi', candidate.hearingImpaired ? 'True' : 'False');
  body.set('forced', candidate.forced ? 'True' : 'False');
  body.set('original_format', 'False');
  body.set('provider', String(candidate.provider || ''));
  body.set('subtitle', String(candidate.candidateId || ''));
  const pathname = match.type === 'movie' ? '/providers/movies' : '/providers/episodes';
  await request(bazarr, pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  return { ok: true };
}

async function syncSubtitle(bazarr, match, { localSubtitlePath, language, forced = false, hearingImpaired = false }) {
  const body = new URLSearchParams();
  body.set('action', 'sync');
  body.set('language', String(language || 'und'));
  body.set('path', mapLocalToBazarr(localSubtitlePath, bazarr));
  body.set('type', match.type === 'movie' ? 'movie' : 'episode');
  body.set('id', String(match.type === 'movie' ? match.radarrId : match.episodeId));
  body.set('forced', forced ? 'True' : 'False');
  body.set('hi', hearingImpaired ? 'True' : 'False');
  await request(bazarr, '/subtitles', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  return { ok: true };
}

module.exports = {
  configured,
  request,
  unwrapList,
  mapLocalToBazarr,
  testConnection,
  listMovies,
  listSeries,
  listEpisodes,
  findMediaByPath,
  normalizeCandidate,
  searchSubtitles,
  downloadCandidate,
  syncSubtitle
};
