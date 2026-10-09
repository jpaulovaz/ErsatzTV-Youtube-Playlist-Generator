const crypto = require('crypto');
const { extractVideoIdFromUrl, fetchVideoDetails, requestYouTube, canonicalWatchUrl } = require('../youtubeApi');
const stateStore = require('./youtubeManagerState');
const quotaTracker = require('./quotaTracker');

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 10;

function normalizeQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function directVideoId(value) {
  const text = normalizeQuery(value);
  const fromUrl = extractVideoIdFromUrl(text);
  if (fromUrl) return fromUrl;
  return /^[A-Za-z0-9_-]{11}$/.test(text) ? text : '';
}

function cacheKey(query, pageToken = '', maxResults = MAX_RESULTS) {
  return crypto.createHash('sha256')
    .update(`${normalizeQuery(query).toLowerCase()}\n${pageToken}\n${maxResults}`)
    .digest('hex');
}

function mapSearchSnippet(item) {
  const snippet = item && item.snippet || {};
  const videoId = item && item.id && item.id.videoId || '';
  return {
    id: videoId,
    title: snippet.title || '',
    description: snippet.description || '',
    channelTitle: snippet.channelTitle || '',
    channelId: snippet.channelId || '',
    publishedAt: snippet.publishedAt || '',
    thumbnailUrl: snippet.thumbnails && (snippet.thumbnails.high || snippet.thumbnails.medium || snippet.thumbnails.default) && (snippet.thumbnails.high || snippet.thumbnails.medium || snippet.thumbnails.default).url || '',
    url: videoId ? canonicalWatchUrl(videoId) : ''
  };
}

async function enrich(config, ids, fallback = new Map()) {
  const details = await fetchVideoDetails(config, ids, { useCache: true });
  if (details.quotaUnitsUsed) await quotaTracker.record('videosList', details.quotaUnitsUsed, { reason: 'youtube-manager-search-enrichment' });
  return ids.map((id) => {
    const detail = details.videosById.get(id);
    const base = fallback.get(id) || { id, url: canonicalWatchUrl(id) };
    if (!detail) return { ...base, unavailable: true };
    return {
      ...base,
      ...detail,
      id,
      url: canonicalWatchUrl(id),
      unavailable: false
    };
  });
}

async function search(config, { query, pageToken = '', maxResults = MAX_RESULTS, force = false } = {}) {
  const q = normalizeQuery(query);
  if (!q) throw Object.assign(new Error('Informe um termo, URL ou Video ID para pesquisar.'), { statusCode: 400 });
  const directId = directVideoId(q);
  if (directId) {
    const results = await enrich(config, [directId]);
    return { query: q, direct: true, cached: false, nextPageToken: '', results };
  }

  const size = Math.max(1, Math.min(25, Math.floor(Number(maxResults) || MAX_RESULTS)));
  const key = cacheKey(q, pageToken, size);
  if (!force) {
    const state = await stateStore.load();
    const cached = state.searchCache[key];
    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
      return { ...cached.result, cached: true };
    }
  }

  const payload = await requestYouTube(config, 'search', {
    part: 'snippet',
    q,
    type: 'video',
    maxResults: size,
    pageToken: pageToken || undefined,
    safeSearch: 'none'
  });
  await quotaTracker.record('searchList', 1, { query: q.slice(0, 120) });

  const snippets = (payload.items || []).map(mapSearchSnippet).filter((x) => x.id);
  const fallback = new Map(snippets.map((x) => [x.id, x]));
  const results = await enrich(config, snippets.map((x) => x.id), fallback);
  const result = {
    query: q,
    direct: false,
    cached: false,
    nextPageToken: payload.nextPageToken || '',
    prevPageToken: payload.prevPageToken || '',
    results
  };
  await stateStore.mutate((state) => {
    state.searchCache[key] = {
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SEARCH_TTL_MS).toISOString(),
      result
    };
    stateStore.pruneSearchCache(state);
  });
  return result;
}

module.exports = { SEARCH_TTL_MS, MAX_RESULTS, normalizeQuery, directVideoId, cacheKey, search };
