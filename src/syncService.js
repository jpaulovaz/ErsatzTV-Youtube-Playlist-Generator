const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const {
  sanitizeName,
  extractArtistAndTitle,
  secondsToDuration,
  yamlDoubleQuoted,
  shellCommandQuote,
  pathExists,
  walkFiles,
  removeEmptyDirectories
} = require('./utils');

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

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
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

async function apiRequest(url, method = 'POST', timeoutSeconds = 10) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const response = await fetch(url, {
      method,
      body: '',
      signal: controller.signal
    });

    return {
      ok: [200, 202, 204].includes(response.status),
      status: response.status,
      statusText: response.statusText
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error.name === 'AbortError' ? 'Timeout' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getPlaylistsWithFolders(config, options = {}) {
  const includeDisabled = Boolean(options.includeDisabled);

  return (config.playlists || [])
    .filter((playlist) => includeDisabled || playlist.enabled !== false)
    .map((playlist) => ({
      ...playlist,
      folderName: sanitizeName(playlist.name)
    }))
    .filter((playlist) => playlist.folderName && playlist.url);
}

function getEffectiveCookiesPath(config, playlist) {
  return String((playlist && playlist.cookiesPath) || config.paths.cookiesPath || '').trim();
}

function getPlaylistDir(config, playlist) {
  return path.join(config.paths.baseDir, playlist.folderName);
}

function getPlaylistScriptPath(config, playlist) {
  return path.join(getPlaylistDir(config, playlist), config.paths.streamScriptName || 'stream-yt.sh');
}

function findPlaylist(config, identifier) {
  const decoded = decodeURIComponent(String(identifier || ''));
  const targetFolder = sanitizeName(decoded);
  const playlists = getPlaylistsWithFolders(config, { includeDisabled: true });

  return playlists.find((playlist) => (
    playlist.name === decoded ||
    playlist.folderName === decoded ||
    playlist.folderName === targetFolder
  ));
}

function buildYtDlpCommonArgs(config, playlist) {
  const args = [];
  const cookiesPath = getEffectiveCookiesPath(config, playlist);

  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  if (config.stream && config.stream.userAgent) {
    args.push('--add-header', `User-Agent: ${config.stream.userAgent}`);
  }

  return args;
}

function buildStreamScriptContent(config, playlist) {
  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'URL="${1:?URL obrigatoria}"',
    `YT_DLP=${shellCommandQuote(config.paths.ytDlpPath)}`,
    `USER_AGENT=${shellCommandQuote(config.stream.userAgent)}`,
    `FORMAT=${shellCommandQuote(config.stream.format)}`
  ];

  if (cookiesPath) {
    lines.push(`COOKIES=${shellCommandQuote(cookiesPath)}`);
  }

  lines.push('', 'exec "$YT_DLP" \\');

  if (cookiesPath) {
    lines.push('  --cookies "$COOKIES" \\');
  }

  lines.push(
    '  --no-playlist \\',
    '  --no-progress \\',
    '  --quiet \\'
  );

  if (config.stream.useHlsMpegTs !== false) {
    lines.push('  --hls-use-mpegts \\');
  }

  lines.push(
    '  --add-header "User-Agent: ${USER_AGENT}" \\',
    '  -f "$FORMAT" \\',
    '  -o - \\',
    '  "$URL"',
    ''
  );

  return lines.join('\n');
}

async function ensurePlaylistStreamScript(config, playlist) {
  const scriptPath = getPlaylistScriptPath(config, playlist);
  const content = buildStreamScriptContent(config, playlist);

  await fs.writeFile(scriptPath, content, 'utf8');
  await fs.chmod(scriptPath, 0o755);
  await logger.info(`Script de stream atualizado: ${scriptPath}`);

  return scriptPath;
}

function buildYmlContent(config, playlist, videoId, durationSeconds) {
  const scriptPath = getPlaylistScriptPath(config, playlist);
  const command = `${shellCommandQuote(scriptPath)} https://www.youtube.com/watch?v=${videoId}`;

  return [
    `script: "${yamlDoubleQuoted(command)}"`,
    'is_live: false',
    `duration: "${secondsToDuration(durationSeconds)}"`,
    ''
  ].join('\n');
}

async function fetchPlaylistVideos(config, playlist) {
  const cmdArgs = [
    ...buildYtDlpCommonArgs(config, playlist),
    '--dump-json',
    '--flat-playlist',
    playlist.url
  ];

  const result = await runCommand(config.paths.ytDlpPath, cmdArgs);

  if (result.stderr && result.stderr.trim()) {
    await logger.warn(`yt-dlp stderr (${playlist.folderName}): ${result.stderr.trim().slice(0, 1200)}`);
  }

  if (result.code !== 0) {
    const error = new Error(`yt-dlp falhou para ${playlist.folderName} com codigo ${result.code}.`);
    error.code = 'YTDLP_FAILED';
    error.stderr = result.stderr;
    throw error;
  }

  const { videos, errors } = parseYtDlpJsonLines(result.stdout);
  for (const error of errors) {
    await logger.warn(`Linha JSON ignorada em ${playlist.folderName}: ${error.error}`);
  }

  if (videos.length === 0) {
    const error = new Error(`Nenhum video retornado para ${playlist.folderName}.`);
    error.code = 'NO_VIDEOS';
    throw error;
  }

  return videos;
}

async function readExistingYmlIndex(playlistDir) {
  const files = await walkFiles(playlistDir);
  const byVideoId = new Map();
  const ymlFiles = [];

  for (const filePath of files) {
    if (!filePath.endsWith('.yml')) continue;

    ymlFiles.push(filePath);

    const content = await fs.readFile(filePath, 'utf8');
    const match = content.match(/watch\?v=([a-zA-Z0-9_-]+)/);
    if (match && !byVideoId.has(match[1])) {
      byVideoId.set(match[1], filePath);
    }
  }

  return { byVideoId, ymlFiles };
}

async function writeVideoYml(config, playlist, playlistDir, existingIndex, video, summary) {
  const videoId = video.id;
  const rawTitle = video.title || 'Sem_Titulo';
  const duration = Number(video.duration);

  if (!videoId || !Number.isFinite(duration) || duration <= 0) {
    summary.videosSkipped += 1;
    return;
  }

  const { artist, title } = extractArtistAndTitle(rawTitle);
  const artistDir = path.join(playlistDir, artist);
  await fs.mkdir(artistDir, { recursive: true });

  const fileName = artist !== 'Outros' ? `${artist} - ${title}.yml` : `${title}.yml`;
  const filePath = path.join(artistDir, fileName);
  const existingPath = existingIndex.byVideoId.get(videoId);
  const ymlContent = buildYmlContent(config, playlist, videoId, duration);

  if (existingPath && path.resolve(existingPath) !== path.resolve(filePath)) {
    await fs.rm(existingPath, { force: true });
    summary.filesMoved += 1;
    await logger.info(`YML movido/renomeado: ${path.basename(existingPath)} -> ${path.basename(filePath)}`);
  }

  const alreadyExists = await pathExists(filePath);
  const previousContent = alreadyExists ? await fs.readFile(filePath, 'utf8') : null;

  if (previousContent === ymlContent) {
    summary.filesUnchanged += 1;
    return;
  }

  await fs.writeFile(filePath, ymlContent, 'utf8');
  if (alreadyExists) {
    summary.filesUpdated += 1;
  } else {
    summary.filesCreated += 1;
  }
}

async function scanPlaylistLibrary(config, playlist) {
  if (!playlist.libraryId) {
    await logger.warn(`Scan ignorado para ${playlist.folderName}: Library ID nao configurado.`);
    return { ok: false, status: 0, statusText: 'Library ID nao configurado' };
  }

  const baseUrl = String(config.ersatztv.url || '').replace(/\/+$/, '');
  const url = `${baseUrl}/api/libraries/${playlist.libraryId}/scan`;

  await logger.info(`Disparando scan da biblioteca ${playlist.libraryId} (${playlist.folderName})...`);
  const result = await apiRequest(url, 'POST', config.ersatztv.apiTimeoutSeconds);

  if (!result.ok) {
    await logger.warn(`Scan falhou para ${playlist.folderName}: HTTP ${result.status} ${result.statusText}`);
  }

  return result;
}

function getCountSnapshot(summary) {
  return {
    videosSkipped: summary.videosSkipped,
    filesCreated: summary.filesCreated,
    filesUpdated: summary.filesUpdated,
    filesMoved: summary.filesMoved,
    filesUnchanged: summary.filesUnchanged
  };
}

function getCountDelta(summary, before) {
  return {
    videosSkipped: summary.videosSkipped - before.videosSkipped,
    filesCreated: summary.filesCreated - before.filesCreated,
    filesUpdated: summary.filesUpdated - before.filesUpdated,
    filesMoved: summary.filesMoved - before.filesMoved,
    filesUnchanged: summary.filesUnchanged - before.filesUnchanged
  };
}

async function processPlaylist(config, playlist, summary) {
  const playlistDir = getPlaylistDir(config, playlist);
  const playlistSummary = {
    name: playlist.folderName,
    sourceName: playlist.name,
    enabled: playlist.enabled !== false,
    libraryId: playlist.libraryId || null,
    playoutId: playlist.playoutId || null,
    videosFound: 0,
    videosSkipped: 0,
    filesCreated: 0,
    filesUpdated: 0,
    filesMoved: 0,
    filesUnchanged: 0,
    scanRequested: false,
    scanSkippedReason: null,
    scan: null,
    failed: false,
    error: null
  };

  await fs.mkdir(playlistDir, { recursive: true });
  await ensurePlaylistStreamScript(config, playlist);

  await logger.info(`--- Processando: ${playlist.folderName} ---`);

  let videos;
  try {
    videos = await fetchPlaylistVideos(config, playlist);
  } catch (error) {
    summary.playlistsFailed += 1;
    playlistSummary.failed = true;
    playlistSummary.error = error.message;
    summary.playlists.push(playlistSummary);
    await logger.error(`${error.message} Nenhum arquivo sera removido automaticamente.`);
    return playlistSummary;
  }

  const existingIndex = await readExistingYmlIndex(playlistDir);
  summary.videosFound += videos.length;
  playlistSummary.videosFound = videos.length;

  const before = getCountSnapshot(summary);

  for (const video of videos) {
    await writeVideoYml(config, playlist, playlistDir, existingIndex, video, summary);
  }

  Object.assign(playlistSummary, getCountDelta(summary, before));

  const hasNewOrMovedYml = playlistSummary.filesCreated > 0 || playlistSummary.filesMoved > 0;
  if (hasNewOrMovedYml) {
    const scan = await scanPlaylistLibrary(config, playlist);
    playlistSummary.scanRequested = true;
    playlistSummary.scan = scan;
    summary.api.scans.push({ playlist: playlist.folderName, libraryId: playlist.libraryId || null, ...scan });
  } else {
    const reason = 'Nenhum YML novo ou movido nesta rodada.';
    playlistSummary.scanSkippedReason = reason;
    summary.api.scansSkipped.push({ playlist: playlist.folderName, libraryId: playlist.libraryId || null, reason });
    await logger.info(`Scan automatico ignorado para ${playlist.folderName}: ${reason}`);
  }

  summary.playlistsProcessed += 1;
  summary.playlists.push(playlistSummary);
  return playlistSummary;
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
    videosSkipped: 0,
    filesCreated: 0,
    filesUpdated: 0,
    filesMoved: 0,
    filesUnchanged: 0,
    playlists: [],
    api: {
      scans: [],
      scansSkipped: []
    }
  };
}

async function runSync(config, options = {}) {
  const targetPlaylist = options.playlistName ? findPlaylist(config, options.playlistName) : null;
  if (options.playlistName && !targetPlaylist) {
    const error = new Error('Playlist nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  if (state.running) {
    const error = new Error('Sincronizacao ja esta em execucao.');
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
    const scope = targetPlaylist ? ` para ${targetPlaylist.folderName}` : '';
    await logger.info(`Sincronizacao iniciada (${summary.trigger})${scope}.`);

    state.currentStep = 'prepare-base-dir';
    await fs.mkdir(config.paths.baseDir, { recursive: true });

    const playlistsToProcess = targetPlaylist ? [targetPlaylist] : getPlaylistsWithFolders(config);

    for (const playlist of playlistsToProcess) {
      state.currentStep = `process-playlist:${playlist.folderName}`;
      await processPlaylist(config, playlist, summary);
    }

    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'idle';
    state.lastResult = summary;

    await logger.info('Sincronizacao finalizada.', summary);
    return summary;
  } catch (error) {
    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'error';
    state.lastError = {
      message: error.message,
      stack: error.stack
    };
    state.lastResult = summary;
    await logger.error(`Sincronizacao interrompida: ${error.message}`);
    throw error;
  } finally {
    state.running = false;
  }
}

async function manualCleanupPlaylist(config, identifier) {
  if (state.running) {
    const error = new Error('Existe uma operacao em execucao. Tente novamente quando terminar.');
    error.code = 'SYNC_ALREADY_RUNNING';
    throw error;
  }

  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Playlist nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  state.running = true;
  state.currentStep = `manual-cleanup:${playlist.folderName}`;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;

  const summary = {
    startedAt: state.startedAt,
    finishedAt: null,
    trigger: 'manual-cleanup',
    playlist: playlist.folderName,
    videosFound: 0,
    filesChecked: 0,
    filesRemoved: 0,
    foldersRemoved: 0
  };

  try {
    await logger.info(`Limpeza manual iniciada para ${playlist.folderName}.`);

    const playlistDir = getPlaylistDir(config, playlist);
    const videos = await fetchPlaylistVideos(config, playlist);
    const currentIds = new Set(videos.map((video) => video.id).filter(Boolean));
    const files = await walkFiles(playlistDir);

    summary.videosFound = currentIds.size;

    for (const filePath of files) {
      if (!filePath.endsWith('.yml')) continue;
      summary.filesChecked += 1;

      const content = await fs.readFile(filePath, 'utf8');
      const match = content.match(/watch\?v=([a-zA-Z0-9_-]+)/);

      if (!match || !currentIds.has(match[1])) {
        await fs.rm(filePath, { force: true });
        summary.filesRemoved += 1;
        await logger.info(`YML removido na limpeza manual: ${filePath}`);
      }
    }

    if (config.cleanup.removeEmptyArtistFolders) {
      summary.foldersRemoved = await removeEmptyDirectories(playlistDir, playlistDir, logger);
    }

    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'idle';
    state.lastResult = summary;

    await logger.info('Limpeza manual finalizada.', summary);
    return summary;
  } catch (error) {
    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'error';
    state.lastError = {
      message: error.message,
      stack: error.stack
    };
    state.lastResult = summary;
    await logger.error(`Limpeza manual interrompida: ${error.message}`);
    throw error;
  } finally {
    state.running = false;
  }
}

async function runPlaylistApiAction(config, identifier, action) {
  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Playlist nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  const baseUrl = String(config.ersatztv.url || '').replace(/\/+$/, '');
  const timeoutSeconds = config.ersatztv.apiTimeoutSeconds;
  let url;
  let label;

  if (action === 'scan') {
    if (!playlist.libraryId) throw new Error(`Library ID nao configurado para ${playlist.folderName}.`);
    url = `${baseUrl}/api/libraries/${playlist.libraryId}/scan`;
    label = `scan da biblioteca ${playlist.libraryId}`;
  } else if (action === 'empty-trash') {
    if (!playlist.libraryId) throw new Error(`Library ID nao configurado para ${playlist.folderName}.`);
    url = `${baseUrl}/api/libraries/${playlist.libraryId}/empty-trash`;
    label = `limpeza de lixo da biblioteca ${playlist.libraryId}`;
  } else if (action === 'rebuild-playout') {
    if (!playlist.playoutId) throw new Error(`Playout ID nao configurado para ${playlist.folderName}.`);
    url = `${baseUrl}/api/playout/${playlist.playoutId}/rebuild`;
    label = `rebuild do playout ${playlist.playoutId}`;
  } else {
    const error = new Error('Acao de playlist nao suportada.');
    error.statusCode = 404;
    throw error;
  }

  await logger.info(`Disparando ${label} (${playlist.folderName})...`);
  const result = await apiRequest(url, 'POST', timeoutSeconds);

  if (result.ok) {
    await logger.info(`Acao concluida: ${label} (${playlist.folderName}).`, result);
  } else {
    await logger.warn(`Acao falhou: ${label} (${playlist.folderName}) HTTP ${result.status} ${result.statusText}.`);
  }

  return {
    ok: result.ok,
    playlist: playlist.folderName,
    action,
    libraryId: playlist.libraryId || null,
    playoutId: playlist.playoutId || null,
    result
  };
}

function getState() {
  return { ...state };
}

module.exports = {
  runSync,
  manualCleanupPlaylist,
  runPlaylistApiAction,
  findPlaylist,
  getState
};
