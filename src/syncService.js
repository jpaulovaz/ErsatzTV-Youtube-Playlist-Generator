const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const {
  sanitizeName,
  extractArtistAndTitle,
  secondsToDuration,
  yamlDoubleQuoted,
  listDirectories,
  walkFiles,
  removeEmptyDirectories,
  isDangerousBaseDir
} = require('./utils');

const state = {
  running: false,
  currentStep: 'idle',
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function getActivePlaylists(config) {
  return (config.playlists || [])
    .filter((playlist) => playlist.enabled !== false)
    .map((playlist) => ({
      ...playlist,
      folderName: sanitizeName(playlist.name)
    }))
    .filter((playlist) => playlist.folderName && playlist.url);
}

function buildYmlContent(config, videoId, durationSeconds) {
  const script = `${config.paths.streamScriptPath} https://www.youtube.com/watch?v=${videoId}`;
  return [
    `script: "${yamlDoubleQuoted(script)}"`,
    'is_live: false',
    `duration: "${secondsToDuration(durationSeconds)}"`,
    ''
  ].join('\n');
}

async function cleanupDisabledPlaylistFolders(config, activePlaylists, summary) {
  if (!config.cleanup.removeDisabledPlaylistFolders) return;

  const baseDir = config.paths.baseDir;

  if (isDangerousBaseDir(baseDir)) {
    await logger.warn(`GC Pasta desativado: baseDir inseguro para remocao automatica (${baseDir}).`);
    return;
  }

  if (activePlaylists.length === 0) {
    await logger.warn('GC Pasta desativado: nenhuma playlist ativa. Nada sera removido para evitar limpeza acidental.');
    return;
  }

  const activeNames = new Set(activePlaylists.map((playlist) => playlist.folderName));
  const existingFolders = await listDirectories(baseDir);

  for (const folder of existingFolders) {
    if (!activeNames.has(folder)) {
      const folderPath = path.join(baseDir, folder);
      await logger.info(`GC Pasta: Removendo playlist desativada: ${folder}`);
      await fs.rm(folderPath, { recursive: true, force: true });
      summary.playlistFoldersRemoved += 1;
    }
  }
}

async function cleanupPlaylistFiles(playlistDir, currentIds, config, summary) {
  if (!config.cleanup.removeMissingVideos) return;

  if (!currentIds || currentIds.size === 0) {
    await logger.warn(`GC Arquivo ignorado: nenhuma ID valida obtida para ${playlistDir}.`);
    return;
  }

  const files = await walkFiles(playlistDir);

  for (const filePath of files) {
    if (!filePath.endsWith('.yml')) continue;

    const content = await fs.readFile(filePath, 'utf8');
    const match = content.match(/watch\?v=([a-zA-Z0-9_-]+)/);

    if (!match || !currentIds.has(match[1])) {
      await fs.rm(filePath, { force: true });
      summary.filesRemoved += 1;
      await logger.info(`GC Arquivo: Removido ${path.basename(filePath)}`);
    }
  }

  if (config.cleanup.removeEmptyArtistFolders) {
    await removeEmptyDirectories(playlistDir, playlistDir, logger);
  }
}

async function processPlaylist(config, playlist, summary) {
  const playlistDir = path.join(config.paths.baseDir, playlist.folderName);
  await fs.mkdir(playlistDir, { recursive: true });

  await logger.info(`--- Processando: ${playlist.folderName} ---`);
  const cmdArgs = ['--dump-json', '--flat-playlist', playlist.url];
  const result = await runCommand(config.paths.ytDlpPath, cmdArgs);

  if (result.stderr && result.stderr.trim()) {
    await logger.warn(`yt-dlp stderr (${playlist.folderName}): ${result.stderr.trim().slice(0, 1200)}`);
  }

  if (result.code !== 0) {
    summary.playlistsFailed += 1;
    await logger.error(`yt-dlp falhou para ${playlist.folderName} com codigo ${result.code}. GC interno ignorado para proteger arquivos existentes.`);
    return;
  }

  const { videos, errors } = parseYtDlpJsonLines(result.stdout);
  for (const error of errors) {
    await logger.warn(`Linha JSON ignorada em ${playlist.folderName}: ${error.error}`);
  }

  if (videos.length === 0) {
    summary.playlistsFailed += 1;
    await logger.error(`Nenhum video retornado para ${playlist.folderName}. GC interno ignorado para proteger arquivos existentes.`);
    return;
  }

  const currentIds = new Set(videos.map((video) => video.id).filter(Boolean));
  summary.videosFound += videos.length;

  for (const video of videos) {
    const videoId = video.id;
    const rawTitle = video.title || 'Sem_Titulo';
    const duration = video.duration;

    if (!videoId || !duration) {
      summary.videosSkipped += 1;
      continue;
    }

    const { artist, title } = extractArtistAndTitle(rawTitle);
    const artistDir = path.join(playlistDir, artist);
    await fs.mkdir(artistDir, { recursive: true });

    const fileName = artist !== 'Outros' ? `${artist} - ${title}.yml` : `${title}.yml`;
    const filePath = path.join(artistDir, fileName);
    const ymlContent = buildYmlContent(config, videoId, Number(duration));

    await fs.writeFile(filePath, ymlContent, 'utf8');
    summary.filesWritten += 1;
  }

  await cleanupPlaylistFiles(playlistDir, currentIds, config, summary);
  summary.playlistsProcessed += 1;
}

async function triggerErsatzTv(config, summary) {
  const baseUrl = String(config.ersatztv.url || '').replace(/\/+$/, '');
  const timeoutSeconds = config.ersatztv.apiTimeoutSeconds;

  await logger.info('Disparando Scan...');
  const scan = await apiRequest(`${baseUrl}/api/libraries/${config.ersatztv.libraryId}/scan`, 'POST', timeoutSeconds);
  summary.api.scan = scan;

  if (!scan.ok) {
    await logger.error(`Scan falhou: HTTP ${scan.status} ${scan.statusText}`);
    return;
  }

  const waitSeconds = Number(config.ersatztv.scanWaitSeconds) || 0;
  if (waitSeconds > 0) {
    await logger.info(`Esperando processamento (${waitSeconds}s)...`);
    await wait(waitSeconds * 1000);
  }

  await logger.info('Limpando Lixo...');
  const trash = await apiRequest(`${baseUrl}/api/libraries/${config.ersatztv.libraryId}/empty-trash`, 'POST', timeoutSeconds);
  summary.api.emptyTrash = trash;
  if (!trash.ok) {
    await logger.warn(`Empty trash falhou: HTTP ${trash.status} ${trash.statusText}`);
  }

  await logger.info('Reconstruindo Playout...');
  const rebuild = await apiRequest(`${baseUrl}/api/playout/${config.ersatztv.playoutId}/rebuild`, 'POST', timeoutSeconds);
  summary.api.rebuild = rebuild;
  if (!rebuild.ok) {
    await logger.warn(`Rebuild falhou: HTTP ${rebuild.status} ${rebuild.statusText}`);
  }
}

async function runSync(config, options = {}) {
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

  const summary = {
    startedAt: state.startedAt,
    finishedAt: null,
    trigger: options.trigger || 'manual',
    playlistsProcessed: 0,
    playlistsFailed: 0,
    playlistFoldersRemoved: 0,
    videosFound: 0,
    videosSkipped: 0,
    filesWritten: 0,
    filesRemoved: 0,
    api: {
      scan: null,
      emptyTrash: null,
      rebuild: null
    }
  };

  try {
    await logger.info(`Sincronizacao iniciada (${summary.trigger}).`);

    state.currentStep = 'prepare-base-dir';
    await fs.mkdir(config.paths.baseDir, { recursive: true });

    const activePlaylists = getActivePlaylists(config);

    state.currentStep = 'cleanup-disabled-playlists';
    await cleanupDisabledPlaylistFolders(config, activePlaylists, summary);

    state.currentStep = 'process-playlists';
    for (const playlist of activePlaylists) {
      await processPlaylist(config, playlist, summary);
    }

    state.currentStep = 'ersatztv-api';
    await triggerErsatzTv(config, summary);

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

function getState() {
  return { ...state };
}

module.exports = {
  runSync,
  getState
};
