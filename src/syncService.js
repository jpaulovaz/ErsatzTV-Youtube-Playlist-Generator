const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const path = require('path');
const logger = require('./logger');
const { runCommand } = require('./processUtils');
const { sanitizeName, pathExists } = require('./utils');
const downloadManager = require('./downloadManager');
const { runLibraryAction } = require('./ersatztvService');
const { testYouTubeApi, canonicalWatchUrl } = require('./youtubeApi');
const {
  getUrls,
  getSourceKind,
  parseYtDlpJsonLines,
  fetchDestinationVideos
} = require('./discovery/youtubeSourceProvider');
const { getEffectiveCookiesPath, buildYtDlpCommonArgs } = require('./ytDlpUtils');
const { libraryDestination } = require('./destinationService');
const discoveryLock = require('./discovery/discoveryLock');

const state = {
  running: false,
  currentStep: 'idle',
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null
};


function getPlaylistsWithFolders(config, options = {}) {
  const includeDisabled = Boolean(options.includeDisabled);
  return (config.playlists || [])
    .filter((playlist) => includeDisabled || playlist.enabled !== false)
    .map((playlist) => {
      const urls = getUrls(playlist);
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
    authoritative: true,
    partialReasons: [],
    queue: null,
    failed: false,
    error: null
  };

  await logger.info(`--- Descobrindo biblioteca: ${playlist.folderName} ---`);
  try {
    const destination = libraryDestination(config, playlist);
    const fetchResult = await fetchDestinationVideos(config, destination);
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
    playlistSummary.authoritative = fetchResult.authoritative !== false;
    playlistSummary.partialReasons = fetchResult.partialReasons || [];
    playlistSummary.queue = await downloadManager.reconcileDestination(config, destination, sourceVideos, {
      authoritative: playlistSummary.authoritative,
      partialReasons: playlistSummary.partialReasons
    });

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
  if (state.running || !discoveryLock.acquire('libraries')) {
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
    discoveryLock.release('libraries');
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

async function testDestinationCookies(config, destination) {
  if (!destination) {
    const error = new Error('Destino nao encontrado na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  const cookiesPath = getEffectiveCookiesPath(config, destination);
  const cookieFile = await inspectCookieFile(cookiesPath);
  const summary = {
    playlist: destination.folderName || destination.displayName,
    destinationId: destination.id || null,
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
    summary.target = await resolveCookieTestTarget(config, destination);
  } catch (error) {
    summary.status = 'target-error';
    summary.message = error.message;
    return summary;
  }

  const args = [
    ...buildYtDlpCommonArgs(config, destination),
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

async function testPlaylistCookies(config, identifier) {
  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Biblioteca nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }
  return testDestinationCookies(config, libraryDestination(config, playlist));
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
    channelNumber: playlist.channelNumber || null,
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
  testDestinationCookies,
  testYouTubeApi,
  getAllPlaylistHealth,
  findPlaylist,
  getPlaylistsWithFolders,
  getState
};
