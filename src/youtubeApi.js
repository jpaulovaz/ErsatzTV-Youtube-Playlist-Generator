const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('./config');

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const CACHE_PATH = path.join(ROOT_DIR, 'data', 'youtube-cache.json');
const VIDEO_BATCH_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 20000;
const THUMBNAIL_PRIORITY = ['maxres', 'standard', 'high', 'medium', 'default'];

class YouTubeApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = details.status || 0;
    this.reason = details.reason || '';
    this.details = details;
  }
}

function getApiConfig(config) {
  return config && config.youtubeApi && typeof config.youtubeApi === 'object' ? config.youtubeApi : {};
}

function hasApiKey(config) {
  return Boolean(String(getApiConfig(config).apiKey || '').trim());
}

function shouldUseYouTubeApi(config) {
  const api = getApiConfig(config);
  return Boolean(api.enabled && api.readMode === 'api' && hasApiKey(config));
}

function getApiKey(config) {
  return String(getApiConfig(config).apiKey || '').trim();
}

function getTimeoutMs(config) {
  const value = Number(getApiConfig(config).timeoutSeconds);
  return Number.isFinite(value) && value > 0 ? Math.floor(value * 1000) : DEFAULT_TIMEOUT_MS;
}

function chunkArray(values, size = VIDEO_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function parseIsoDurationToSeconds(value) {
  const text = String(value || '').trim();
  const match = text.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  const total = Math.floor((days * 86400) + (hours * 3600) + (minutes * 60) + seconds);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function extractVideoIdFromUrl(urlValue) {
  try {
    const parsed = new URL(String(urlValue || '').trim());
    const host = normalizeHost(parsed.hostname);
    const parts = parsed.pathname.split('/').filter(Boolean);

    if ((host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) && parsed.pathname === '/watch') {
      return parsed.searchParams.get('v') || '';
    }

    if ((host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) && parts[0] === 'shorts' && parts[1]) {
      return parts[1];
    }

    if ((host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) && parts[0] === 'embed' && parts[1]) {
      return parts[1];
    }

    if (host === 'youtu.be' && parts[0]) {
      return parts[0];
    }
  } catch {
    return '';
  }

  return '';
}

function extractPlaylistIdFromUrl(urlValue) {
  try {
    const parsed = new URL(String(urlValue || '').trim());
    const list = parsed.searchParams.get('list');
    if (list) return list;
  } catch {
    return '';
  }

  return '';
}

function parseYouTubeSource(urlValue) {
  const sourceUrl = String(urlValue || '').trim();
  const playlistId = extractPlaylistIdFromUrl(sourceUrl);
  if (playlistId) {
    return { kind: 'playlist', sourceUrl, playlistId, videoId: '' };
  }

  const videoId = extractVideoIdFromUrl(sourceUrl);
  if (videoId) {
    return { kind: 'video', sourceUrl, playlistId: '', videoId };
  }

  return { kind: 'unknown', sourceUrl, playlistId: '', videoId: '' };
}

function canonicalWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    return fallback;
  }
}

async function loadCache() {
  const cache = await readJsonIfExists(CACHE_PATH, { videos: {} });
  if (!cache || typeof cache !== 'object') return { videos: {} };
  if (!cache.videos || typeof cache.videos !== 'object') cache.videos = {};
  return cache;
}

async function saveCache(cache) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

function isCacheFresh(entry, ttlHours) {
  if (!entry || !entry.lastFetchedAt) return false;
  const ttlMs = Math.max(1, Number(ttlHours) || 168) * 3600 * 1000;
  const fetchedAt = new Date(entry.lastFetchedAt).getTime();
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < ttlMs;
}

function getThumbnailUrl(thumbnails) {
  if (!thumbnails || typeof thumbnails !== 'object') return '';
  for (const key of THUMBNAIL_PRIORITY) {
    if (thumbnails[key] && thumbnails[key].url) return thumbnails[key].url;
  }
  return '';
}

function mapApiVideoItem(item) {
  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const status = item.status || {};
  const duration = parseIsoDurationToSeconds(contentDetails.duration);
  const publishedAt = snippet.publishedAt || '';
  const year = publishedAt ? new Date(publishedAt).getUTCFullYear() : null;

  return {
    id: item.id,
    title: snippet.title || 'Sem Titulo',
    description: snippet.description || '',
    duration,
    durationIso: contentDetails.duration || '',
    thumbnailUrl: getThumbnailUrl(snippet.thumbnails),
    publishedAt,
    year: Number.isFinite(year) ? year : null,
    channelTitle: snippet.channelTitle || '',
    privacyStatus: status.privacyStatus || '',
    embeddable: status.embeddable !== undefined ? Boolean(status.embeddable) : null,
    uploadStatus: status.uploadStatus || '',
    raw: item
  };
}

async function requestYouTube(config, endpoint, params = {}) {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    throw new YouTubeApiError('API Key do YouTube nao configurada.', { reason: 'missing-api-key' });
  }

  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('key', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs(config));

  try {
    const response = await fetch(url, { signal: controller.signal });
    const bodyText = await response.text();
    let payload = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errorInfo = payload && payload.error ? payload.error : {};
      const reason = errorInfo.errors && errorInfo.errors[0] ? errorInfo.errors[0].reason : '';
      throw new YouTubeApiError(errorInfo.message || `YouTube API HTTP ${response.status}`, {
        status: response.status,
        reason,
        payload
      });
    }

    return payload || {};
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new YouTubeApiError('Timeout ao consultar a YouTube Data API.', { reason: 'timeout' });
    }
    if (error instanceof YouTubeApiError) throw error;
    throw new YouTubeApiError(`Falha ao consultar a YouTube Data API: ${error.message}`, { reason: 'request-failed' });
  } finally {
    clearTimeout(timeout);
  }
}

async function testYouTubeApi(config) {
  const testedAt = new Date().toISOString();
  const summary = {
    ok: false,
    status: 'failed',
    message: '',
    testedAt,
    quotaUnitsEstimated: 1,
    sampleVideoId: 'dQw4w9WgXcQ'
  };

  try {
    const payload = await requestYouTube(config, 'videos', {
      part: 'id,snippet',
      id: summary.sampleVideoId,
      maxResults: 1
    });
    const item = Array.isArray(payload.items) ? payload.items[0] : null;
    summary.ok = Boolean(item && item.id);
    summary.status = summary.ok ? 'valid' : 'empty-response';
    summary.message = summary.ok
      ? 'API Key aceita. A YouTube Data API respondeu corretamente.'
      : 'A API respondeu, mas nao retornou o video de teste.';
    summary.title = item && item.snippet ? item.snippet.title : '';
  } catch (error) {
    summary.ok = false;
    summary.status = error.reason || 'api-error';
    summary.message = error.message;
    summary.httpStatus = error.status || 0;
  }

  return summary;
}

async function fetchPlaylistItemIds(config, playlistId, sourceUrl, sourceIndex) {
  const ids = [];
  const sourceItems = [];
  let pageToken = '';
  let pages = 0;
  let quotaUnitsUsed = 0;

  do {
    const payload = await requestYouTube(config, 'playlistItems', {
      part: 'snippet,contentDetails,status',
      playlistId,
      maxResults: 50,
      pageToken
    });
    quotaUnitsUsed += 1;
    pages += 1;

    for (const item of payload.items || []) {
      const videoId = (item.contentDetails && item.contentDetails.videoId) ||
        (item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId) || '';
      if (!videoId) continue;
      ids.push(videoId);
      sourceItems.push({
        id: videoId,
        sourceUrl,
        sourceIndex,
        sourceKind: 'playlist',
        playlistId,
        playlistPosition: item.snippet ? item.snippet.position : null,
        playlistItemStatus: item.status ? item.status.privacyStatus : ''
      });
    }

    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  return { ids, sourceItems, pages, quotaUnitsUsed };
}

async function fetchVideoDetails(config, videoIds, options = {}) {
  const uniqueIds = [...new Set((videoIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const result = {
    videosById: new Map(),
    missingIds: [],
    quotaUnitsUsed: 0,
    fromCache: 0,
    fetched: 0
  };

  if (uniqueIds.length === 0) return result;

  const api = getApiConfig(config);
  const ttlHours = Math.max(1, Number(api.cacheTtlHours) || 168);
  const useCache = options.useCache !== false;
  const forceFresh = Boolean(options.forceFresh);
  const cache = useCache ? await loadCache() : { videos: {} };
  const idsToFetch = [];

  for (const id of uniqueIds) {
    const cached = cache.videos[id];
    if (!forceFresh && useCache && isCacheFresh(cached, ttlHours)) {
      result.videosById.set(id, { ...cached.data, fromCache: true });
      result.fromCache += 1;
    } else {
      idsToFetch.push(id);
    }
  }

  for (const chunk of chunkArray(idsToFetch, VIDEO_BATCH_SIZE)) {
    const payload = await requestYouTube(config, 'videos', {
      part: 'snippet,contentDetails,status',
      id: chunk.join(',')
    });
    result.quotaUnitsUsed += 1;

    const returnedIds = new Set();
    for (const item of payload.items || []) {
      const mapped = mapApiVideoItem(item);
      returnedIds.add(mapped.id);
      result.videosById.set(mapped.id, mapped);
      cache.videos[mapped.id] = {
        lastFetchedAt: new Date().toISOString(),
        data: mapped
      };
      result.fetched += 1;
    }

    for (const id of chunk) {
      if (!returnedIds.has(id)) result.missingIds.push(id);
    }
  }

  if (useCache && idsToFetch.length > 0) {
    await saveCache(cache);
  }

  return result;
}

async function fetchSourcesViaApi(config, playlist) {
  const urls = Array.isArray(playlist.urls) ? playlist.urls : [];
  const byVideoId = new Map();
  const videosWithoutId = [];
  const duplicates = [];
  const sourceResults = [];
  const missingSourceIds = [];
  let quotaUnitsUsed = 0;
  let fetchedCount = 0;

  for (let index = 0; index < urls.length; index += 1) {
    const sourceUrl = urls[index];
    const parsed = parseYouTubeSource(sourceUrl);
    let sourceIds = [];
    let pages = 0;
    let sourceError = null;

    if (parsed.kind === 'playlist') {
      const listResult = await fetchPlaylistItemIds(config, parsed.playlistId, sourceUrl, index);
      quotaUnitsUsed += listResult.quotaUnitsUsed;
      sourceIds = listResult.ids;
      pages = listResult.pages;
    } else if (parsed.kind === 'video') {
      sourceIds = [parsed.videoId];
    } else {
      sourceError = 'URL do YouTube nao reconhecida pela API.';
    }

    let uniqueFromSource = 0;
    let duplicateFromSource = 0;

    for (const videoId of sourceIds) {
      fetchedCount += 1;
      if (byVideoId.has(videoId)) {
        const first = byVideoId.get(videoId);
        duplicates.push({
          id: videoId,
          title: first.title || '',
          firstSourceIndex: first.sourceIndex,
          firstSourceUrl: first.sourceUrl,
          duplicateSourceIndex: index,
          duplicateSourceUrl: sourceUrl
        });
        duplicateFromSource += 1;
        continue;
      }

      byVideoId.set(videoId, {
        id: videoId,
        sourceUrl,
        sourceIndex: index,
        sourceKind: parsed.kind,
        playlistId: parsed.playlistId || ''
      });
      uniqueFromSource += 1;
    }

    sourceResults.push({
      index,
      url: sourceUrl,
      kind: parsed.kind,
      fetched: sourceIds.length,
      unique: uniqueFromSource,
      duplicates: duplicateFromSource,
      pages,
      error: sourceError
    });
  }

  const ids = [...byVideoId.keys()];
  const details = await fetchVideoDetails(config, ids, { useCache: true });
  quotaUnitsUsed += details.quotaUnitsUsed;

  const videos = [];
  for (const id of ids) {
    const sourceInfo = byVideoId.get(id);
    const detailsItem = details.videosById.get(id);
    if (!detailsItem) {
      missingSourceIds.push(id);
      continue;
    }

    videos.push({
      ...detailsItem,
      sourceUrl: sourceInfo.sourceUrl,
      sourceIndex: sourceInfo.sourceIndex,
      sourceKind: sourceInfo.sourceKind,
      playlistId: sourceInfo.playlistId,
      webpage_url: canonicalWatchUrl(id)
    });
  }

  return {
    videos: [...videos, ...videosWithoutId],
    duplicates,
    sourceResults,
    sourceCount: urls.length,
    fetchedCount,
    missingSourceIds,
    quotaUnitsUsed,
    readMode: 'api'
  };
}

module.exports = {
  YouTubeApiError,
  shouldUseYouTubeApi,
  hasApiKey,
  parseYouTubeSource,
  extractVideoIdFromUrl,
  extractPlaylistIdFromUrl,
  parseIsoDurationToSeconds,
  canonicalWatchUrl,
  getThumbnailUrl,
  fetchSourcesViaApi,
  fetchVideoDetails,
  testYouTubeApi
};
