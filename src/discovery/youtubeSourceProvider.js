const path = require('path');
const { spawn } = require('child_process');
const logger = require('../logger');
const { DESTINATION_TYPES } = require('../destinationService');
const {
  shouldUseYouTubeApi,
  fetchSourcesViaApi,
  canonicalWatchUrl
} = require('../youtubeApi');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || process.cwd(), env: process.env, shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer = null;
    const timeoutMs = Number(options.timeoutMs) || 0;
    const timeout = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    }, timeoutMs) : null;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function getUrls(source) {
  const values = [];
  if (source && typeof source.url === 'string') values.push(source.url);
  if (source && Array.isArray(source.urls)) values.push(...source.urls);
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function getEffectiveCookiesPath(config, source) {
  return String((source && source.cookiesPath) || config.paths.cookiesPath || '').trim();
}

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function getYtDlpJsRuntimeArg(config) {
  const downloads = config.downloads || {};
  const mode = String(downloads.jsRuntimeMode || 'disabled').trim();
  if (!mode || mode === 'disabled') return '';
  const runtimeName = mode === 'custom' ? sanitizeJsRuntimeName(downloads.jsRuntimeCustomName) : sanitizeJsRuntimeName(mode);
  if (!runtimeName) return '';
  const runtimePath = String(downloads.jsRuntimePath || '').trim();
  return runtimePath ? `${runtimeName}:${runtimePath}` : runtimeName;
}

function buildYtDlpCommonArgs(config, source) {
  const args = [];
  const cookiesPath = getEffectiveCookiesPath(config, source);
  const runtimeArg = getYtDlpJsRuntimeArg(config);
  const ejsComponents = runtimeArg ? String(config.downloads.ejsComponents || '').trim() : '';
  if (runtimeArg) args.push('--js-runtimes', runtimeArg);
  if (ejsComponents && ejsComponents !== 'none') args.push('--remote-components', ejsComponents);
  if (cookiesPath) args.push('--cookies', cookiesPath);
  if (config.downloads.userAgent) args.push('--add-header', `User-Agent: ${config.downloads.userAgent}`);
  if (config.paths && config.paths.ffmpegPath) args.push('--ffmpeg-location', path.dirname(config.paths.ffmpegPath));
  args.push('--no-color');
  return args;
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
  // statuses are not eligible in v3.0.
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
  if (parsed.videos.length === 0) {
    const detail = result.stderr.trim() || `codigo ${result.code}`;
    throw new Error(`Nenhum video foi retornado para a fonte ${sourceIndex + 1} de ${label}: ${detail}`);
  }
  if (result.code !== 0) await logger.warn(`A fonte ${sourceIndex + 1} de ${label} retornou conteudo parcial (codigo ${result.code}).`);
  return parsed.videos.map((video) => normalizeYtDlpVideo(video, sourceUrl, sourceIndex, source.sourceKind || kind)).filter((video) => video.id);
}

async function fetchViaYtDlp(config, source, options = {}) {
  const urls = getUrls(source);
  if (urls.length === 0) throw new Error(`Nenhuma fonte configurada para ${source.displayName || source.folderName || 'destino'}.`);
  const byVideoId = new Map();
  const duplicates = [];
  const sourceResults = [];
  for (let index = 0; index < urls.length; index += 1) {
    const sourceUrl = urls[index];
    const sourceVideos = await fetchVideosFromSourceViaYtDlp(config, source, sourceUrl, index, options);
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
    sourceResults.push({ index, url: sourceUrl, kind: source.sourceKind || getSourceKind(sourceUrl), fetched: sourceVideos.length, unique, duplicates: duplicateCount });
  }
  return {
    videos: [...byVideoId.values()], duplicates, sourceResults, sourceCount: urls.length,
    fetchedCount: sourceResults.reduce((total, entry) => total + entry.fetched, 0),
    readMode: 'ytdlp', quotaUnitsUsed: 0, missingSourceIds: []
  };
}

async function fetchDestinationVideos(config, destination, options = {}) {
  const source = { ...destination, name: destination.displayName, url: destination.urls && destination.urls[0] || '', urls: destination.urls || [] };
  const canUseApi = destination.type !== DESTINATION_TYPES.CHANNEL_GLOBAL && shouldUseYouTubeApi(config);
  if (canUseApi) {
    try {
      return await fetchSourcesViaApi(config, source);
    } catch (error) {
      await logger.warn(`YouTube API falhou para ${destination.displayName}; usando yt-dlp como fallback: ${error.message}`);
    }
  }
  return fetchViaYtDlp(config, source, options);
}

module.exports = {
  runCommand,
  getUrls,
  getEffectiveCookiesPath,
  buildYtDlpCommonArgs,
  isSingleVideoSource,
  getSourceKind,
  parseYtDlpJsonLines,
  normalizeYtDlpVideo,
  isCompletedStream,
  fetchVideosFromSourceViaYtDlp,
  fetchViaYtDlp,
  fetchDestinationVideos
};
