const logger = require('../logger');
const { runCommand } = require('../processUtils');
const { DESTINATION_TYPES } = require('../destinationService');
const { buildYtDlpCommonArgs } = require('../ytDlpUtils');
const {
  shouldUseYouTubeApi,
  fetchSourcesViaApi,
  canonicalWatchUrl
} = require('../youtubeApi');

function getUrls(source) {
  const values = [];
  if (source && typeof source.url === 'string') values.push(source.url);
  if (source && Array.isArray(source.urls)) values.push(...source.urls);
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}


function isSingleVideoSource(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ''));
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.searchParams.has('list')) return false;
    if ((host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) && parsed.pathname === '/watch') return Boolean(parsed.searchParams.get('v'));
    if ((host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) && ['shorts', 'embed'].includes(parts[0]) && parts[1]) return true;
    return host === 'youtu.be' && Boolean(parts[0]);
  } catch { return false; }
}

function getSourceKind(sourceUrl) {
  return isSingleVideoSource(sourceUrl) ? 'video' : 'playlist';
}

function parseYtDlpJsonLines(stdout) {
  const videos = [];
  const errors = [];
  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { videos.push(JSON.parse(trimmed)); }
    catch (error) { errors.push({ line: trimmed.slice(0, 200), error: error.message }); }
  }
  return { videos, errors };
}

function getThumbnailFromYtDlp(video) {
  if (video.thumbnail) return String(video.thumbnail);
  if (!Array.isArray(video.thumbnails)) return '';
  const candidates = video.thumbnails.filter((item) => item && item.url);
  return candidates.length > 0 ? String(candidates[candidates.length - 1].url) : '';
}

function normalizeYtDlpVideo(video, sourceUrl, sourceIndex, sourceKind) {
  const id = String(video && video.id || '').trim();
  const uploadDate = String(video && video.upload_date || '').trim();
  const timestamp = Number(video && video.timestamp);
  const publishedAt = Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString()
    : '';
  const yearFromDate = /^\d{4}/.test(uploadDate) ? Number(uploadDate.slice(0, 4)) : null;
  return {
    id,
    title: String(video && video.title || (id ? `Video ${id}` : 'Sem Titulo')).trim(),
    description: String(video && video.description || ''),
    duration: Number(video && video.duration) || null,
    thumbnailUrl: getThumbnailFromYtDlp(video || {}),
    publishedAt,
    uploadDate,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
    year: Number(video && video.release_year) || yearFromDate || null,
    channelTitle: String(video && (video.channel || video.channel_title || video.uploader) || '').trim(),
    channelId: String(video && (video.channel_id || video.uploader_id) || '').trim(),
    liveStatus: String(video && video.live_status || '').trim(),
    wasLive: Boolean(video && video.was_live),
    webpage_url: id ? canonicalWatchUrl(id) : String(video && video.webpage_url || sourceUrl),
    sourceUrl,
    sourceIndex,
    sourceKind
  };
}

function isCompletedStream(video) {
  const liveStatus = String(video && video.liveStatus || '').toLowerCase();
  if (video && video.wasLive) return true;
  if (['was_live', 'not_live'].includes(liveStatus)) return true;
  // Be conservative for the Streams source: unknown, current and upcoming
  // statuses are not eligible for the completed-stream source.
  return false;
}

async function fetchVideosFromSourceViaYtDlp(config, source, sourceUrl, sourceIndex, options = {}) {
  const kind = getSourceKind(sourceUrl);
  const args = [...buildYtDlpCommonArgs(config, source), '--dump-json', '--ignore-errors', '--skip-download'];
  if (kind === 'video') args.push('--no-playlist');
  else if (source.sourceKind !== 'streams') args.push('--flat-playlist');
  args.push(sourceUrl);
  const runner = options.runner || runCommand;
  const result = await runner(config.paths.ytDlpPath, args, { timeoutMs: 15 * 60 * 1000 });
  const parsed = parseYtDlpJsonLines(result.stdout);
  const label = source.displayName || source.folderName || source.name || 'destino';
  if (result.stderr && result.stderr.trim()) await logger.warn(`yt-dlp informou avisos ao ler ${label}: ${result.stderr.trim().slice(-2000)}`);
  for (const error of parsed.errors) await logger.warn(`Linha JSON ignorada em ${label}: ${error.error}`);

  const partialReasons = [];
  if (result.timedOut) partialReasons.push('timeout');
  if (result.code !== 0) partialReasons.push(`ytdlp_exit_${result.code}`);
  if (/(^|\n)\s*ERROR:/i.test(String(result.stderr || ''))) partialReasons.push('ytdlp_reported_error');
  if (parsed.errors.length > 0) partialReasons.push('invalid_json_lines');
  const authoritative = partialReasons.length === 0;
  if (!authoritative) {
    await logger.warn(`A fonte ${sourceIndex + 1} de ${label} retornou conteudo parcial; ausencias nao serao reconciliadas.`);
  }

  return {
    videos: parsed.videos
      .map((video) => normalizeYtDlpVideo(video, sourceUrl, sourceIndex, source.sourceKind || kind))
      .filter((video) => video.id),
    authoritative,
    partialReasons,
    exitCode: result.code,
    timedOut: Boolean(result.timedOut)
  };
}

async function fetchViaYtDlp(config, source, options = {}) {
  const urls = getUrls(source);
  if (urls.length === 0) throw new Error(`Nenhuma fonte configurada para ${source.displayName || source.folderName || 'destino'}.`);
  const byVideoId = new Map();
  const duplicates = [];
  const sourceResults = [];
  const partialReasons = [];
  let authoritative = true;
  for (let index = 0; index < urls.length; index += 1) {
    const sourceUrl = urls[index];
    const sourceFetch = await fetchVideosFromSourceViaYtDlp(config, source, sourceUrl, index, options);
    const sourceVideos = sourceFetch.videos || [];
    if (!sourceFetch.authoritative) {
      authoritative = false;
      for (const reason of sourceFetch.partialReasons || []) partialReasons.push(`source_${index + 1}:${reason}`);
    }
    let unique = 0;
    let duplicateCount = 0;
    for (const video of sourceVideos) {
      if (source.sourceKind === 'streams' && !isCompletedStream(video)) continue;
      if (byVideoId.has(video.id)) {
        const first = byVideoId.get(video.id);
        duplicates.push({ id: video.id, title: video.title || first.title, firstSourceIndex: first.sourceIndex, duplicateSourceIndex: index, firstSourceUrl: first.sourceUrl, duplicateSourceUrl: sourceUrl });
        duplicateCount += 1;
        continue;
      }
      byVideoId.set(video.id, video);
      unique += 1;
    }
    sourceResults.push({
      index,
      url: sourceUrl,
      kind: source.sourceKind || getSourceKind(sourceUrl),
      fetched: sourceVideos.length,
      unique,
      duplicates: duplicateCount,
      authoritative: sourceFetch.authoritative,
      partialReasons: sourceFetch.partialReasons || [],
      exitCode: sourceFetch.exitCode,
      timedOut: sourceFetch.timedOut
    });
  }
  return {
    videos: [...byVideoId.values()], duplicates, sourceResults, sourceCount: urls.length,
    fetchedCount: sourceResults.reduce((total, entry) => total + entry.fetched, 0),
    readMode: 'ytdlp', quotaUnitsUsed: 0, missingSourceIds: [],
    authoritative, partialReasons
  };
}

async function fetchDestinationVideos(config, destination, options = {}) {
  const source = { ...destination, name: destination.displayName, url: destination.urls && destination.urls[0] || '', urls: destination.urls || [] };
  const canUseApi = destination.type !== DESTINATION_TYPES.CHANNEL_GLOBAL && shouldUseYouTubeApi(config);
  if (canUseApi) {
    try {
      const apiResult = await fetchSourcesViaApi(config, source);
      const videos = [...(apiResult.videos || [])];
      for (const missingId of apiResult.missingSourceIds || []) {
        if (!videos.some((video) => video && video.id === missingId)) {
          videos.push({
            id: missingId,
            title: '',
            description: '',
            duration: null,
            thumbnailUrl: '',
            webpage_url: canonicalWatchUrl(missingId),
            sourceKind: destination.sourceKind || 'playlist'
          });
        }
      }
      return { ...apiResult, videos, authoritative: true, partialReasons: [] };
    } catch (error) {
      await logger.warn(`YouTube API falhou para ${destination.displayName}; usando yt-dlp como fallback: ${error.message}`);
    }
  }
  return fetchViaYtDlp(config, source, options);
}

module.exports = {
  getUrls,
  isSingleVideoSource,
  getSourceKind,
  parseYtDlpJsonLines,
  normalizeYtDlpVideo,
  isCompletedStream,
  fetchVideosFromSourceViaYtDlp,
  fetchViaYtDlp,
  fetchDestinationVideos
};
