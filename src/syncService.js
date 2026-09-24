const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const { sanitizeName, pathExists } = require('./utils');
const downloadManager = require('./downloadManager');
const { runLibraryAction } = require('./ersatztvService');
const {
  shouldUseYouTubeApi,
  hasApiKey,
  fetchSourcesViaApi,
  testYouTubeApi,
  canonicalWatchUrl
} = require('./youtubeApi');

const state = {
  running: false,
  currentStep: 'idle',
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null
};

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer = null;
    const timeoutMs = Number(options.timeoutMs) || 0;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeoutMs)
      : null;

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

function getPlaylistUrls(playlist) {
  const values = [];
  if (playlist && typeof playlist.url === 'string') values.push(playlist.url);
  if (playlist && Array.isArray(playlist.urls)) values.push(...playlist.urls);
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function getPlaylistsWithFolders(config, options = {}) {
  const includeDisabled = Boolean(options.includeDisabled);
  return (config.playlists || [])
    .filter((playlist) => includeDisabled || playlist.enabled !== false)
    .map((playlist) => {
      const urls = getPlaylistUrls(playlist);
      return {
        ...playlist,
        url: urls[0] || '',
        urls,
        folderName: sanitizeName(playlist.name)
      };
    })
    .filter((playlist) => playlist.folderName && playlist.urls.length > 0);
}

function findPlaylist(config, identifier) {
  const decoded = decodeURIComponent(String(identifier || ''));
  const targetFolder = sanitizeName(decoded);
  return getPlaylistsWithFolders(config, { includeDisabled: true }).find((playlist) => (
    playlist.name === decoded ||
    playlist.folderName === decoded ||
    playlist.folderName === targetFolder
  ));
}

function getEffectiveCookiesPath(config, playlist) {
  return String((playlist && playlist.cookiesPath) || config.paths.cookiesPath || '').trim();
}

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function getYtDlpJsRuntimeArg(config) {
  const downloads = config.downloads || {};
  const mode = String(downloads.jsRuntimeMode || 'disabled').trim();
  if (!mode || mode === 'disabled') return '';
  const runtimeName = mode === 'custom'
    ? sanitizeJsRuntimeName(downloads.jsRuntimeCustomName)
    : sanitizeJsRuntimeName(mode);
  if (!runtimeName) return '';
  const runtimePath = String(downloads.jsRuntimePath || '').trim();
  return runtimePath ? `${runtimeName}:${runtimePath}` : runtimeName;
}

function buildYtDlpCommonArgs(config, playlist) {
  const args = [];
  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const runtimeArg = getYtDlpJsRuntimeArg(config);
  const ejsComponents = runtimeArg ? String(config.downloads.ejsComponents || '').trim() : '';

  if (runtimeArg) args.push('--js-runtimes', runtimeArg);
  if (ejsComponents && ejsComponents !== 'none') args.push('--remote-components', ejsComponents);
  if (cookiesPath) args.push('--cookies', cookiesPath);
  if (config.downloads.userAgent) args.push('--add-header', `User-Agent: ${config.downloads.userAgent}`);
  args.push('--no-color');
  return args;
}

function isSingleVideoSource(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ''));
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.searchParams.has('list')) return false;
    if ((host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) && parsed.pathname === '/watch') {
      return Boolean(parsed.searchParams.get('v'));
    }
    if ((host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) && ['shorts', 'embed'].includes(parts[0]) && parts[1]) {
      return true;
    }
    return host === 'youtu.be' && Boolean(parts[0]);
  } catch {
    return false;
  }
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
    try {
      videos.push(JSON.parse(trimmed));
    } catch (error) {
      errors.push({ line: trimmed.slice(0, 200), error: error.message });
    }
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
  const yearFromDate = /^\d{4}/.test(uploadDate) ? Number(uploadDate.slice(0, 4)) : null;
  return {
    id,
    title: String(video && video.title || (id ? `Video ${id}` : 'Sem Titulo')).trim(),
    description: String(video && video.description || ''),
    duration: Number(video && video.duration) || null,
    thumbnailUrl: getThumbnailFromYtDlp(video || {}),
    year: Number(video && video.release_year) || yearFromDate || null,
    webpage_url: id ? canonicalWatchUrl(id) : String(video && video.webpage_url || sourceUrl),
    sourceUrl,
    sourceIndex,
    sourceKind
  };
}

async function fetchVideosFromSourceViaYtDlp(config, playlist, sourceUrl, sourceIndex) {
  const kind = getSourceKind(sourceUrl);
  const args = [
    ...buildYtDlpCommonArgs(config, playlist),
    '--dump-json',
    '--ignore-errors',
    '--skip-download'
  ];
  if (kind === 'video') args.push('--no-playlist');
  else args.push('--flat-playlist');
  args.push(sourceUrl);

  const result = await runCommand(config.paths.ytDlpPath, args, { timeoutMs: 15 * 60 * 1000 });
  const parsed = parseYtDlpJsonLines(result.stdout);

  if (result.stderr && result.stderr.trim()) {
    await logger.warn(`yt-dlp informou avisos ao ler ${playlist.folderName}: ${result.stderr.trim().slice(-2000)}`);
  }
  for (const error of parsed.errors) {
    await logger.warn(`Linha JSON ignorada em ${playlist.folderName}: ${error.error}`);
  }

  if (parsed.videos.length === 0) {
    const detail = result.stderr.trim() || `codigo ${result.code}`;
    throw new Error(`Nenhum video foi retornado para a fonte ${sourceIndex + 1} de ${playlist.folderName}: ${detail}`);
  }

  if (result.code !== 0) {
    await logger.warn(`A fonte ${sourceIndex + 1} de ${playlist.folderName} retornou conteudo parcial (codigo ${result.code}); os videos validos serao preservados.`);
  }

  return parsed.videos
    .map((video) => normalizeYtDlpVideo(video, sourceUrl, sourceIndex, kind))
    .filter((video) => video.id);
}

async function fetchPlaylistVideosViaYtDlp(config, playlist) {
  const urls = getPlaylistUrls(playlist);
  if (urls.length === 0) throw new Error(`Nenhuma fonte configurada para ${playlist.folderName}.`);

  const byVideoId = new Map();
  const duplicates = [];
  const sourceResults = [];

  for (let index = 0; index < urls.length; index += 1) {
    const sourceUrl = urls[index];
    await logger.info(`Lendo fonte ${index + 1}/${urls.length} via yt-dlp para ${playlist.folderName}: ${sourceUrl}`);
    const sourceVideos = await fetchVideosFromSourceViaYtDlp(config, playlist, sourceUrl, index);
    let unique = 0;
    let duplicateCount = 0;

    for (const video of sourceVideos) {
      if (byVideoId.has(video.id)) {
        const first = byVideoId.get(video.id);
        duplicates.push({
          id: video.id,
          title: video.title || first.title,
          firstSourceIndex: first.sourceIndex,
          duplicateSourceIndex: index,
          firstSourceUrl: first.sourceUrl,
          duplicateSourceUrl: sourceUrl
        });
        duplicateCount += 1;
        continue;
      }
      byVideoId.set(video.id, video);
      unique += 1;
    }

    sourceResults.push({
      index,
      url: sourceUrl,
      kind: getSourceKind(sourceUrl),
      fetched: sourceVideos.length,
      unique,
      duplicates: duplicateCount
    });
  }

  return {
    videos: [...byVideoId.values()],
    duplicates,
    sourceResults,
    sourceCount: urls.length,
    fetchedCount: sourceResults.reduce((total, source) => total + source.fetched, 0),
    readMode: 'ytdlp',
    quotaUnitsUsed: 0,
    missingSourceIds: []
  };
}

async function fetchPlaylistVideos(config, playlist) {
  if (shouldUseYouTubeApi(config)) {
    try {
      await logger.info(`Lendo fontes via YouTube Data API para ${playlist.folderName}.`);
      return await fetchSourcesViaApi(config, playlist);
    } catch (error) {
      await logger.warn(`YouTube API falhou para ${playlist.folderName}; usando yt-dlp como fallback: ${error.message}`);
    }
  }
  return fetchPlaylistVideosViaYtDlp(config, playlist);
}

function createRunSummary(options) {
  return {
    startedAt: state.startedAt,
    finishedAt: null,
    trigger: options.trigger || 'manual',
    targetPlaylist: options.playlistName ? sanitizeName(decodeURIComponent(String(options.playlistName))) : null,
    playlistsProcessed: 0,
    playlistsFailed: 0,
    videosFound: 0,
    videosDuplicate: 0,
    downloadsQueued: 0,
    alreadyCompleted: 0,
    alreadyKnown: 0,
    reactivated: 0,
    orphaned: 0,
    quotaUnitsUsed: 0,
    playlists: []
  };
}

async function processPlaylist(config, playlist, summary) {
  const playlistSummary = {
    name: playlist.folderName,
    sourceName: playlist.name,
    sourceCount: playlist.urls.length,
    sourceResults: [],
    videosFound: 0,
    videosDuplicate: 0,
    readMode: null,
    quotaUnitsUsed: 0,
    queue: null,
    failed: false,
    error: null
  };

  await logger.info(`--- Descobrindo biblioteca: ${playlist.folderName} ---`);
  try {
    const fetchResult = await fetchPlaylistVideos(config, playlist);
    const sourceVideos = [...(fetchResult.videos || [])];
    for (const missingId of fetchResult.missingSourceIds || []) {
      if (!sourceVideos.some((video) => video && video.id === missingId)) {
        sourceVideos.push({
          id: missingId,
          title: '',
          description: '',
          duration: null,
          thumbnailUrl: '',
          webpage_url: canonicalWatchUrl(missingId),
          sourceKind: 'playlist'
        });
      }
    }

    playlistSummary.sourceResults = fetchResult.sourceResults || [];
    playlistSummary.videosFound = sourceVideos.length;
    playlistSummary.videosDuplicate = (fetchResult.duplicates || []).length;
    playlistSummary.readMode = fetchResult.readMode || 'ytdlp';
    playlistSummary.quotaUnitsUsed = Number(fetchResult.quotaUnitsUsed) || 0;
    playlistSummary.queue = await downloadManager.reconcileLibrary(config, playlist, sourceVideos);

    summary.playlistsProcessed += 1;
    summary.videosFound += playlistSummary.videosFound;
    summary.videosDuplicate += playlistSummary.videosDuplicate;
    summary.downloadsQueued += playlistSummary.queue.queued;
    summary.alreadyCompleted += playlistSummary.queue.alreadyCompleted;
    summary.alreadyKnown += playlistSummary.queue.alreadyKnown;
    summary.reactivated += playlistSummary.queue.reactivated;
    summary.orphaned += playlistSummary.queue.orphaned;
    summary.quotaUnitsUsed += playlistSummary.quotaUnitsUsed;
  } catch (error) {
    playlistSummary.failed = true;
    playlistSummary.error = error.message;
    summary.playlistsFailed += 1;
    await logger.error(`Descoberta falhou para ${playlist.folderName}: ${error.message}. A fila existente foi preservada.`);
  }

  summary.playlists.push(playlistSummary);
  return playlistSummary;
}

async function runSync(config, options = {}) {
  const targetPlaylist = options.playlistName ? findPlaylist(config, options.playlistName) : null;
  if (options.playlistName && !targetPlaylist) {
    const error = new Error('Biblioteca nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }
  if (state.running) {
    const error = new Error('Uma descoberta de fontes ja esta em execucao.');
    error.code = 'SYNC_ALREADY_RUNNING';
    throw error;
  }

  state.running = true;
  state.currentStep = 'starting';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;
  const summary = createRunSummary(options);

  try {
    await downloadManager.init(config);
    downloadManager.configure(config);
    await fs.mkdir(config.paths.baseDir, { recursive: true });
    const playlists = targetPlaylist ? [targetPlaylist] : getPlaylistsWithFolders(config);
    await logger.info(`Descoberta iniciada (${summary.trigger}) para ${playlists.length} biblioteca(s).`);

    for (const playlist of playlists) {
      state.currentStep = `discover:${playlist.folderName}`;
      await processPlaylist(config, playlist, summary);
    }

    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'idle';
    state.lastResult = summary;
    await logger.info('Descoberta finalizada; novos videos foram adicionados a fila persistente.', summary);
    return summary;
  } catch (error) {
    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'error';
    state.lastError = { message: error.message, stack: error.stack };
    state.lastResult = summary;
    await logger.error(`Descoberta interrompida: ${error.message}`);
    throw error;
  } finally {
    state.running = false;
  }
}

function truncateText(value, maxLength = 2400) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  const half = Math.floor(maxLength / 2);
  return `${text.slice(0, half)}\n...\n${text.slice(-half)}`;
}

async function inspectCookieFile(cookiesPath) {
  const result = {
    path: cookiesPath,
    configured: Boolean(cookiesPath),
    exists: false,
    readable: false,
    sizeBytes: 0,
    modifiedAt: null,
    error: null
  };
  if (!cookiesPath) {
    result.error = 'Nenhum cookies.txt foi configurado. Isso e valido; cookies sao opcionais.';
    return result;
  }
  try {
    const stats = await fs.stat(cookiesPath);
    result.exists = true;
    result.sizeBytes = stats.size;
    result.modifiedAt = stats.mtime.toISOString();
    await fs.access(cookiesPath, fsConstants.R_OK);
    result.readable = true;
    if (stats.size <= 0) result.error = 'O arquivo cookies.txt esta vazio.';
  } catch (error) {
    result.error = error.code === 'ENOENT' ? 'O arquivo cookies.txt nao existe.' : `Nao foi possivel ler o cookies.txt: ${error.message}`;
  }
  return result;
}

function classifyCookieOutput(output) {
  if (/cookies are no longer valid|cookie.*expired|expired.*cookie|invalid cookie/i.test(output)) {
    return { status: 'invalid-cookie', message: 'O yt-dlp informou que os cookies estao expirados ou invalidos.' };
  }
  if (/sign in to confirm.*not a bot|confirm you.?re not a bot|login required|authentication/i.test(output)) {
    return { status: 'invalid-cookie', message: 'O YouTube recusou a sessao ou exigiu autenticacao.' };
  }
  if (/signature solving failed|n challenge solving failed|only images are available/i.test(output)) {
    return { status: 'javascript-challenge', message: 'O YouTube exigiu um desafio JavaScript que nao foi resolvido.' };
  }
  if (/http error 429|too many requests|rate.?limit/i.test(output)) {
    return { status: 'rate-limited', message: 'O YouTube limitou temporariamente as requisicoes.' };
  }
  return { status: 'yt-dlp-failed', message: 'O yt-dlp falhou no teste ativo.' };
}

async function resolveCookieTestTarget(config, playlist) {
  const sourceUrl = playlist.urls[0];
  if (!sourceUrl) throw new Error('Nenhuma fonte configurada para escolher um video de teste.');
  const args = [
    ...buildYtDlpCommonArgs(config, playlist),
    '--dump-json',
    '--flat-playlist',
    '--playlist-items',
    '1',
    '--skip-download',
    sourceUrl
  ];
  if (getSourceKind(sourceUrl) === 'video') {
    const flatIndex = args.indexOf('--flat-playlist');
    if (flatIndex >= 0) args.splice(flatIndex, 1);
    args.push('--no-playlist');
  }
  const result = await runCommand(config.paths.ytDlpPath, args, { timeoutMs: 75000 });
  const parsed = parseYtDlpJsonLines(result.stdout);
  const first = parsed.videos.find((video) => video && video.id);
  if (!first) throw new Error(result.stderr.trim() || 'Nao foi possivel selecionar um video para o teste.');
  return {
    videoId: first.id,
    title: first.title || '',
    url: canonicalWatchUrl(first.id),
    sourceUrl
  };
}

async function testPlaylistCookies(config, identifier) {
  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Biblioteca nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const cookieFile = await inspectCookieFile(cookiesPath);
  const summary = {
    playlist: playlist.folderName,
    ok: false,
    status: 'not-tested',
    message: '',
    cookiesPath,
    cookieFile,
    target: null,
    ytDlp: null,
    testedAt: new Date().toISOString()
  };

  if (!cookieFile.configured) {
    summary.status = 'not-configured';
    summary.message = cookieFile.error;
    return summary;
  }
  if (!cookieFile.exists || !cookieFile.readable || cookieFile.sizeBytes <= 0) {
    summary.status = 'cookie-file-error';
    summary.message = cookieFile.error || 'Arquivo de cookies invalido.';
    return summary;
  }

  try {
    summary.target = await resolveCookieTestTarget(config, playlist);
  } catch (error) {
    summary.status = 'target-error';
    summary.message = error.message;
    return summary;
  }

  const args = [
    ...buildYtDlpCommonArgs(config, playlist),
    '--no-playlist',
    '--simulate',
    '--skip-download',
    '-f',
    'best[height<=360][vcodec!=none][acodec!=none]/best',
    '--print',
    'id=%(id)s title=%(title)s format=%(format_id)s',
    summary.target.url
  ];
  const result = await runCommand(config.paths.ytDlpPath, args, { timeoutMs: 75000 });
  summary.ytDlp = {
    code: result.code,
    signal: result.signal || null,
    timedOut: result.timedOut,
    stdout: truncateText(result.stdout),
    stderr: truncateText(result.stderr)
  };

  const combined = `${result.stderr}\n${result.stdout}`;
  const warningClassification = classifyCookieOutput(combined);
  if (result.timedOut) {
    summary.status = 'timeout';
    summary.message = 'O teste excedeu o tempo limite.';
  } else if (result.code === 0 && warningClassification.status !== 'invalid-cookie') {
    summary.ok = true;
    summary.status = 'valid';
    summary.message = 'O yt-dlp conseguiu consultar o video usando o cookies.txt configurado.';
  } else {
    summary.status = warningClassification.status;
    summary.message = warningClassification.message;
  }

  return summary;
}

async function runPlaylistApiAction(config, identifier, action) {
  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Biblioteca nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }
  const result = await runLibraryAction(config, playlist, action);
  return {
    ok: result.ok,
    playlist: playlist.folderName,
    action,
    libraryId: playlist.libraryId || null,
    playoutId: playlist.playoutId || null,
    result
  };
}

function getAllPlaylistHealth(config) {
  return downloadManager.getLibraryStats(config);
}

function getState() {
  return { ...state };
}

module.exports = {
  runSync,
  runPlaylistApiAction,
  testPlaylistCookies,
  testYouTubeApi,
  getAllPlaylistHealth,
  findPlaylist,
  getPlaylistsWithFolders,
  getState
};
