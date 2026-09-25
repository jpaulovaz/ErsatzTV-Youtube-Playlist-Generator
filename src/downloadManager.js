const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT_DIR, normalizeMaxHeight } = require('./config');
const logger = require('./logger');
const { scanAndRebuild, runLibraryAction } = require('./ersatztvService');
const {
  getSubtitleSettings,
  findExistingSubtitleLanguages,
  buildSubtitleDownloadArgs,
  finalizeStagedSubtitles,
  listSubtitleSidecars
} = require('./subtitleService');
const {
  getMovieMetadataSettings,
  getMovieMetadata,
  writeMovieNfo
} = require('./movieMetadataService');
const {
  sanitizeName,
  sanitizeFileComponent,
  normalizeArtistDisplayName,
  findCaseInsensitiveDirectoryName,
  extractArtistAndTitle,
  pathExists,
  removeEmptyDirectories,
  isPathInside
} = require('./utils');

const STATE_PATH = path.join(ROOT_DIR, 'data', 'download-state.json');
const STATE_VERSION = 2;
const TICK_INTERVAL_MS = 1000;
const PROGRESS_SAVE_DELAY_MS = 1500;
const STORAGE_REFRESH_MS = 30000;
const RETRY_IDLE_ACTION_MS = 5 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function makeItemId(libraryFolder, videoId) {
  return `${libraryFolder}::${videoId}`;
}

function getPlaylistUrls(playlist) {
  const values = [];
  if (playlist && typeof playlist.url === 'string') values.push(playlist.url);
  if (playlist && Array.isArray(playlist.urls)) values.push(...playlist.urls);
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizePlaylist(playlist) {
  const urls = getPlaylistUrls(playlist);
  return {
    ...playlist,
    url: urls[0] || '',
    urls,
    folderName: sanitizeName(playlist && playlist.name)
  };
}

function findPlaylistByFolder(config, libraryFolder) {
  const target = sanitizeName(libraryFolder);
  return (config.playlists || [])
    .map(normalizePlaylist)
    .find((playlist) => playlist.folderName === target || playlist.name === libraryFolder);
}

function getEffectiveCookiesPath(config, playlist) {
  return String((playlist && playlist.cookiesPath) || (config.paths && config.paths.cookiesPath) || '').trim();
}

function getEffectiveMaxHeight(config, playlist) {
  return normalizeMaxHeight((playlist && playlist.maxHeight) || (config.downloads && config.downloads.maxHeight));
}

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function getJsRuntimeArg(config) {
  const downloads = config.downloads || {};
  const mode = String(downloads.jsRuntimeMode || 'disabled').trim();
  if (!mode || mode === 'disabled') return '';

  const name = mode === 'custom'
    ? sanitizeJsRuntimeName(downloads.jsRuntimeCustomName)
    : sanitizeJsRuntimeName(mode);
  if (!name) return '';

  const runtimePath = String(downloads.jsRuntimePath || '').trim();
  return runtimePath ? `${name}:${runtimePath}` : name;
}

function buildFormatSelector(maxHeight) {
  const height = normalizeMaxHeight(maxHeight);
  const compatible = [
    `bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]`,
    `best[height<=${height}][ext=mp4][vcodec^=avc1][acodec^=mp4a]`,
    `best[height<=${height}][vcodec^=avc1][acodec^=mp4a]`
  ];
  const anyCodec = [
    `bestvideo[height<=${height}]+bestaudio`,
    `best[height<=${height}]`
  ];

  // YouTube normally offers AVC only up to 1080p. Above that, prefer the
  // requested resolution and let the local ffmpeg normalization create H.264/AAC.
  return height > 1080
    ? anyCodec.join('/')
    : [...compatible, ...anyCodec].join('/');
}

function buildDownloadArgs(config, playlist, item, workDir) {
  const downloads = config.downloads || {};
  const args = [];
  const runtimeArg = getJsRuntimeArg(config);
  const ejsComponents = runtimeArg ? String(downloads.ejsComponents || '').trim() : '';
  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const outputTemplate = path.join(workDir, 'media.%(ext)s');

  if (runtimeArg) args.push('--js-runtimes', runtimeArg);
  if (ejsComponents && ejsComponents !== 'none') args.push('--remote-components', ejsComponents);
  if (cookiesPath) args.push('--cookies', cookiesPath);
  if (downloads.userAgent) args.push('--add-header', `User-Agent: ${downloads.userAgent}`);
  if (config.paths && config.paths.ffmpegPath) args.push('--ffmpeg-location', path.dirname(config.paths.ffmpegPath));

  args.push(
    '--no-playlist',
    '--continue',
    '--no-overwrites',
    '--newline',
    '--no-color',
    '--progress',
    '--progress-template',
    'download:__YTDLP_PROGRESS__%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--print',
    'after_move:__YTDLP_FILE__%(filepath)s',
    '--no-simulate',
    '--merge-output-format',
    'mkv'
  );

  if (downloads.writeThumbnails !== false) {
    args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  }

  args.push(
    '-f',
    buildFormatSelector(item.maxHeight || getEffectiveMaxHeight(config, playlist)),
    '-o',
    outputTemplate,
    item.url || `https://www.youtube.com/watch?v=${item.videoId}`
  );

  return args;
}

function parseNumber(value) {
  const number = Number(String(value || '').trim());
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseProgressLine(line) {
  const marker = '__YTDLP_PROGRESS__';
  const index = String(line || '').indexOf(marker);
  if (index < 0) return null;
  const parts = String(line).slice(index + marker.length).trim().split('|');
  return {
    downloadedBytes: parseNumber(parts[0]),
    totalBytes: parseNumber(parts[1]) || parseNumber(parts[2]),
    speedBytesPerSecond: parseNumber(parts[3]),
    etaSeconds: parseNumber(parts[4])
  };
}

function parseFileLine(line) {
  const marker = '__YTDLP_FILE__';
  const index = String(line || '').indexOf(marker);
  if (index < 0) return '';
  return String(line).slice(index + marker.length).trim();
}

function normalizeSubtitleState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  return {
    status: String(state.status || 'not-checked'),
    requestedLanguages: Array.isArray(state.requestedLanguages)
      ? state.requestedLanguages.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    foundLanguages: Array.isArray(state.foundLanguages)
      ? state.foundLanguages.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    missingLanguages: Array.isArray(state.missingLanguages)
      ? state.missingLanguages.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    includeAuto: state.includeAuto !== false,
    attempts: Math.max(0, Number(state.attempts) || 0),
    nextAttemptAt: state.nextAttemptAt || null,
    lastAttemptAt: state.lastAttemptAt || null,
    lastCompletedAt: state.lastCompletedAt || null,
    lastError: state.lastError || null,
    updatedAt: state.updatedAt || null
  };
}

function isSubtitleUnavailableOutput(output) {
  return /there are no subtitles|no subtitles|requested subtitles?.*(?:not available|not found)|did not get any subtitles|no automatic captions/i.test(String(output || ''));
}

function createDefaultState() {
  return {
    version: STATE_VERSION,
    paused: false,
    pauseReason: null,
    nextSequence: 1,
    items: {},
    libraries: {},
    updatedAt: nowIso()
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : createDefaultState();
  const normalized = {
    version: STATE_VERSION,
    paused: Boolean(state.paused),
    pauseReason: state.pauseReason || null,
    nextSequence: Math.max(1, Number(state.nextSequence) || 1),
    items: state.items && typeof state.items === 'object' ? state.items : {},
    libraries: state.libraries && typeof state.libraries === 'object' ? state.libraries : {},
    updatedAt: state.updatedAt || nowIso()
  };

  for (const [id, rawItem] of Object.entries(normalized.items)) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    item.id = id;
    item.status = String(item.status || 'pending');
    if (item.status === 'downloading') {
      item.status = item.sourceActive === false ? 'orphaned' : 'pending';
      item.nextAttemptAt = null;
      item.lastError = 'Download interrompido pela reinicializacao; item devolvido para a fila.';
      item.phase = null;
    }
    item.attempts = Math.max(0, Number(item.attempts) || 0);
    item.priority = Number(item.priority) || 0;
    item.queueOrder = Math.max(1, Number(item.queueOrder) || normalized.nextSequence++);
    item.progress = item.progress && typeof item.progress === 'object' ? item.progress : {};
    item.sourceActive = item.sourceActive !== false;
    item.orphaned = Boolean(item.orphaned || item.sourceActive === false);
    item.suppressed = Boolean(item.suppressed);
    item.subtitles = normalizeSubtitleState(item.subtitles);
    normalized.items[id] = item;
  }

  return normalized;
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(tempPath, filePath);
}

function attachLineReader(stream, callback) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) callback(line);
  });
  stream.on('end', () => {
    if (buffer) callback(buffer);
  });
}

function appendTail(current, line, maxLength = 24000) {
  const next = `${current || ''}${current ? '\n' : ''}${line}`;
  return next.length <= maxLength ? next : next.slice(-maxLength);
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Processo ja finalizado.
    }
  }

  setTimeout(() => {
    try {
      if (process.platform !== 'win32') {
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      // Processo ja finalizado.
    }
  }, 5000).unref();
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      detached: Boolean(options.detached)
    });
    if (typeof options.onSpawn === 'function') options.onSpawn(child);
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

async function getDiskStats(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });

  if (typeof fs.statfs === 'function') {
    const stats = await fs.statfs(targetPath);
    const blockSize = Number(stats.bsize || stats.frsize || 0);
    const totalBytes = blockSize * Number(stats.blocks || 0);
    const freeBytes = blockSize * Number(stats.bfree || 0);
    const availableBytes = blockSize * Number(stats.bavail || stats.bfree || 0);
    return {
      path: targetPath,
      totalBytes,
      freeBytes,
      availableBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      checkedAt: nowIso(),
      error: null
    };
  }

  const result = await runCommand('/bin/df', ['-Pk', targetPath], { timeoutMs: 10000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'df falhou');
  const lines = result.stdout.trim().split(/\r?\n/);
  const fields = lines[lines.length - 1].trim().split(/\s+/);
  const totalBytes = Number(fields[1]) * 1024;
  const usedBytes = Number(fields[2]) * 1024;
  const availableBytes = Number(fields[3]) * 1024;
  return {
    path: targetPath,
    totalBytes,
    freeBytes: Math.max(0, totalBytes - usedBytes),
    availableBytes,
    usedBytes,
    checkedAt: nowIso(),
    error: null
  };
}

async function moveAcrossFileSystems(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    const tempTarget = `${targetPath}.importing-${process.pid}`;
    await fs.copyFile(sourcePath, tempTarget);
    await fs.rename(tempTarget, targetPath);
    await fs.rm(sourcePath, { force: true });
  }
}

async function downloadRemoteFile(url, targetPath, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(targetPath, buffer);
    return buffer.length;
  } finally {
    clearTimeout(timeout);
  }
}

class DownloadManager {
  constructor(options = {}) {
    this.statePath = options.statePath || STATE_PATH;
    this.state = createDefaultState();
    this.config = null;
    this.initialized = false;
    this.running = false;
    this.ticking = false;
    this.current = null;
    this.currentPromise = null;
    this.tickTimer = null;
    this.saveTimer = null;
    this.saveChain = Promise.resolve();
    this.storage = null;
    this.storageCheckedAtMs = 0;
    this.idleSinceMs = null;
    this.idleActionRunning = false;
    this.nextIdleActionAtMs = 0;
  }

  async init(config) {
    if (this.initialized) {
      this.configure(config);
      return;
    }

    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      this.state = normalizeState(JSON.parse(content));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await logger.warn(`Estado da fila nao pôde ser lido; um novo estado sera criado: ${error.message}`);
      }
      this.state = createDefaultState();
    }

    this.configure(config);
    this.initialized = true;
    await this.saveNow();
  }

  configure(config) {
    this.config = clone(config);
    this.kick();
  }

  async start(config) {
    await this.init(config);
    if (this.running) return;
    this.running = true;
    this.scheduleTick(0);
    await logger.info('Worker de downloads iniciado com concorrencia 1.');
  }

  async stop(options = {}) {
    this.running = false;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;

    if (options.terminateCurrent !== false && this.current) {
      this.current.shutdownRequested = true;
      if (this.current.child) killProcessTree(this.current.child);
    }

    if (this.currentPromise) {
      await Promise.race([
        this.currentPromise.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 8000))
      ]);
    }

    await this.saveNow();
  }

  scheduleTick(delayMs = TICK_INTERVAL_MS) {
    if (!this.running) return;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.tick().catch((error) => logger.error(`Falha no worker de downloads: ${error.message}`));
    }, delayMs);
    this.tickTimer.unref();
  }

  kick() {
    if (!this.running) return;
    this.scheduleTick(0);
  }

  async tick() {
    if (!this.running || this.ticking) return;
    this.ticking = true;

    try {
      if (!this.initialized || !this.config) return;
      await this.refreshStorage(false);

      if (this.current || this.currentPromise || this.idleActionRunning) return;
      if (this.state.paused) return;

      const lowDisk = this.isLowDisk();
      if (lowDisk) {
        this.state.pauseReason = `Espaco livre abaixo de ${this.config.downloads.minFreeSpaceGb} GB.`;
        this.saveSoon();
        return;
      }
      if (this.state.pauseReason && this.state.pauseReason.startsWith('Espaco livre')) {
        this.state.pauseReason = null;
        this.saveSoon();
      }

      const nextItem = this.findNextRunnableItem();
      if (nextItem) {
        this.idleSinceMs = null;
        this.currentPromise = this.processItem(nextItem)
          .catch((error) => logger.error(`Erro inesperado no download ${nextItem.id}: ${error.message}`))
          .finally(() => {
            this.currentPromise = null;
            this.kick();
          });
        return;
      }

      const nextSubtitleItem = this.findNextSubtitleRunnableItem();
      if (nextSubtitleItem) {
        this.idleSinceMs = null;
        this.currentPromise = this.processSubtitleItem(nextSubtitleItem)
          .catch((error) => logger.error(`Erro inesperado ao processar legendas de ${nextSubtitleItem.id}: ${error.message}`))
          .finally(() => {
            this.currentPromise = null;
            this.kick();
          });
        return;
      }

      await this.maybeFinalizeSubtitleBackfills();
      await this.maybeRunIdleActions();
    } finally {
      this.ticking = false;
      this.scheduleTick();
    }
  }

  findNextRunnableItem() {
    const now = Date.now();
    const enabledFolders = new Set(
      (this.config.playlists || [])
        .filter((playlist) => playlist.enabled !== false)
        .map((playlist) => sanitizeName(playlist.name))
    );

    const candidates = Object.values(this.state.items).filter((item) => {
      if (item.status !== 'pending') return false;
      if (item.sourceActive === false || item.orphaned) return false;
      if (!enabledFolders.has(item.libraryFolder)) return false;
      if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > now) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const priorityDelta = (Number(b.priority) || 0) - (Number(a.priority) || 0);
      if (priorityDelta !== 0) return priorityDelta;
      return (Number(a.queueOrder) || 0) - (Number(b.queueOrder) || 0);
    });

    return candidates[0] || null;
  }

  findNextSubtitleRunnableItem() {
    const now = Date.now();
    const configured = new Map(
      (this.config.playlists || []).map((playlist) => [sanitizeName(playlist.name), playlist])
    );

    const candidates = Object.values(this.state.items).filter((item) => {
      if (item.status !== 'completed' || item.orphaned || item.sourceActive === false) return false;
      const playlist = configured.get(item.libraryFolder);
      if (!playlist || !getSubtitleSettings(playlist).enabled) return false;
      const subtitleState = normalizeSubtitleState(item.subtitles);
      item.subtitles = subtitleState;
      if (subtitleState.status !== 'pending') return false;
      if (subtitleState.nextAttemptAt && new Date(subtitleState.nextAttemptAt).getTime() > now) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const left = new Date(a.subtitles && a.subtitles.updatedAt || a.updatedAt || 0).getTime();
      const right = new Date(b.subtitles && b.subtitles.updatedAt || b.updatedAt || 0).getTime();
      return left - right;
    });
    return candidates[0] || null;
  }

  async scheduleSubtitlesForItem(item, playlist, options = {}) {
    const settings = getSubtitleSettings(playlist);
    if (!settings.enabled || !item.targetPath || item.status !== 'completed') return false;

    const found = await findExistingSubtitleLanguages(item.targetPath, settings.languages);
    const missing = settings.languages.filter((language) => !found.includes(language));
    item.subtitles = normalizeSubtitleState(item.subtitles);
    item.subtitles.requestedLanguages = [...settings.languages];
    item.subtitles.foundLanguages = found;
    item.subtitles.missingLanguages = missing;
    item.subtitles.includeAuto = settings.includeAuto;
    item.subtitles.updatedAt = nowIso();

    if (missing.length === 0) {
      item.subtitles.status = 'complete';
      item.subtitles.nextAttemptAt = null;
      item.subtitles.lastError = null;
      return false;
    }

    item.subtitles.status = 'pending';
    item.subtitles.nextAttemptAt = null;
    item.subtitles.lastError = null;
    if (options.resetAttempts !== false) item.subtitles.attempts = 0;
    return true;
  }

  async processSubtitleItem(item) {
    const playlist = findPlaylistByFolder(this.config, item.libraryFolder);
    if (!playlist) return;
    const settings = getSubtitleSettings(playlist);
    if (!settings.enabled) {
      item.subtitles = normalizeSubtitleState(item.subtitles);
      item.subtitles.status = 'disabled';
      item.subtitles.nextAttemptAt = null;
      item.subtitles.updatedAt = nowIso();
      await this.saveNow();
      return;
    }

    if (!item.targetPath || !(await pathExists(item.targetPath))) {
      item.subtitles = normalizeSubtitleState(item.subtitles);
      item.subtitles.status = 'failed';
      item.subtitles.nextAttemptAt = null;
      item.subtitles.lastError = 'Arquivo de video local nao encontrado para baixar as legendas.';
      item.subtitles.updatedAt = nowIso();
      await this.saveNow();
      return;
    }

    const foundBefore = await findExistingSubtitleLanguages(item.targetPath, settings.languages);
    const missing = settings.languages.filter((language) => !foundBefore.includes(language));
    item.subtitles = normalizeSubtitleState(item.subtitles);
    item.subtitles.requestedLanguages = [...settings.languages];
    item.subtitles.foundLanguages = foundBefore;
    item.subtitles.missingLanguages = missing;
    item.subtitles.includeAuto = settings.includeAuto;

    if (missing.length === 0) {
      item.subtitles.status = 'complete';
      item.subtitles.nextAttemptAt = null;
      item.subtitles.lastError = null;
      item.subtitles.updatedAt = nowIso();
      await this.saveNow();
      return;
    }

    const workDir = path.join(this.getWorkDir(item), 'subtitles');
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.mkdir(workDir, { recursive: true });

    item.subtitles.status = 'checking';
    item.subtitles.attempts = Math.max(0, Number(item.subtitles.attempts) || 0) + 1;
    item.subtitles.lastAttemptAt = nowIso();
    item.subtitles.updatedAt = item.subtitles.lastAttemptAt;
    item.subtitles.nextAttemptAt = null;
    item.subtitles.lastError = null;
    await this.saveNow();

    const context = {
      itemId: item.id,
      child: null,
      cancelRequested: false,
      shutdownRequested: false,
      startedAt: item.subtitles.lastAttemptAt,
      phase: 'subtitles'
    };
    this.current = context;

    const args = buildSubtitleDownloadArgs(this.config, playlist, item, workDir, missing);
    await logger.info(`Buscando legendas SRT: ${item.title} (${item.videoId})`, {
      playlist: item.libraryFolder,
      languages: missing,
      includeAuto: settings.includeAuto,
      attempt: item.subtitles.attempts
    });

    let stderrTail = '';
    let stdoutTail = '';
    try {
      const child = spawn(this.config.paths.ytDlpPath, args, {
        cwd: workDir,
        env: process.env,
        shell: false,
        detached: process.platform !== 'win32'
      });
      context.child = child;
      attachLineReader(child.stdout, (line) => { stdoutTail = appendTail(stdoutTail, line); });
      attachLineReader(child.stderr, (line) => { stderrTail = appendTail(stderrTail, line); });

      const closeResult = await new Promise((resolve) => {
        let resolved = false;
        child.on('error', (error) => {
          if (resolved) return;
          resolved = true;
          resolve({ code: null, signal: null, error });
        });
        child.on('close', (code, signal) => {
          if (resolved) return;
          resolved = true;
          resolve({ code, signal, error: null });
        });
      });
      context.child = null;

      if (context.shutdownRequested) {
        item.subtitles.status = 'pending';
        item.subtitles.nextAttemptAt = null;
        item.subtitles.lastError = 'Busca de legendas interrompida durante o encerramento; sera retomada depois.';
        item.subtitles.updatedAt = nowIso();
        await this.saveNow();
        return;
      }

      const output = [stderrTail, stdoutTail].filter(Boolean).join('\n').trim();
      if (closeResult.error || closeResult.code !== 0) {
        if (isSubtitleUnavailableOutput(output)) {
          await this.finishSubtitleAttempt(item, playlist, workDir, settings, { unavailable: true });
          return;
        }
        const detail = closeResult.error
          ? closeResult.error.message
          : `yt-dlp terminou com codigo ${closeResult.code}${closeResult.signal ? ` (${closeResult.signal})` : ''}`;
        await this.handleSubtitleFailure(item, output ? `${detail}\n${output}` : detail);
        return;
      }

      await this.finishSubtitleAttempt(item, playlist, workDir, settings, { unavailable: false });
    } catch (error) {
      await this.handleSubtitleFailure(item, error.message);
    } finally {
      context.child = null;
      if (this.current === context) this.current = null;
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async finishSubtitleAttempt(item, playlist, workDir, settings, options = {}) {
    const finalized = await finalizeStagedSubtitles(workDir, item.targetPath);
    const found = await findExistingSubtitleLanguages(item.targetPath, settings.languages);
    const missing = settings.languages.filter((language) => !found.includes(language));
    const changed = finalized.moved.length;

    item.subtitles = normalizeSubtitleState(item.subtitles);
    item.subtitles.status = found.length > 0 ? 'complete' : 'unavailable';
    item.subtitles.requestedLanguages = [...settings.languages];
    item.subtitles.foundLanguages = found;
    item.subtitles.missingLanguages = missing;
    item.subtitles.includeAuto = settings.includeAuto;
    item.subtitles.nextAttemptAt = null;
    item.subtitles.lastCompletedAt = nowIso();
    item.subtitles.updatedAt = item.subtitles.lastCompletedAt;
    item.subtitles.lastError = null;

    if (changed > 0) {
      const libraryState = this.ensureLibraryState(item.libraryFolder);
      libraryState.dirty = true;
      if (libraryState.subtitleBackfill && libraryState.subtitleBackfill.active) {
        libraryState.subtitleBackfill.changed = Math.max(0, Number(libraryState.subtitleBackfill.changed) || 0) + changed;
      }
      await logger.info(`Legendas adicionadas para ${item.title} (${item.videoId}): ${finalized.moved.map((entry) => entry.language).join(', ')}`, {
        playlist: item.libraryFolder,
        files: finalized.moved.map((entry) => entry.targetPath)
      });
    } else if (options.unavailable || found.length === 0) {
      await logger.info(`Nenhuma legenda selecionada foi encontrada para ${item.title} (${item.videoId}).`, {
        playlist: item.libraryFolder,
        requestedLanguages: settings.languages
      });
    }

    await this.saveNow();
  }

  async handleSubtitleFailure(item, message) {
    item.subtitles = normalizeSubtitleState(item.subtitles);
    const delays = this.config.downloads.retryDelaysMinutes || [1, 5, 15];
    const maxAttempts = delays.length + 1;
    const shortMessage = String(message || 'Falha desconhecida').slice(-16000);
    item.subtitles.lastError = shortMessage;
    item.subtitles.updatedAt = nowIso();

    if (item.subtitles.attempts < maxAttempts) {
      const delayMinutes = Number(delays[item.subtitles.attempts - 1]) || 1;
      item.subtitles.status = 'pending';
      item.subtitles.nextAttemptAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
      await logger.warn(`Falha ao baixar legendas; nova tentativa em ${delayMinutes} minuto(s): ${item.title} (${item.videoId}).`, {
        playlist: item.libraryFolder,
        attempt: item.subtitles.attempts,
        maxAttempts,
        error: shortMessage.slice(-1500)
      });
    } else {
      item.subtitles.status = 'failed';
      item.subtitles.nextAttemptAt = null;
      await logger.warn(`Falha definitiva ao baixar legendas apos ${item.subtitles.attempts} tentativa(s): ${item.title} (${item.videoId}). O video permanece concluido.`, {
        playlist: item.libraryFolder,
        error: shortMessage.slice(-1500)
      });
    }
    await this.saveNow();
  }

  async queueMissingSubtitles(libraryFolder) {
    const folder = sanitizeName(libraryFolder);
    const playlist = findPlaylistByFolder(this.config, folder);
    if (!playlist) {
      const error = new Error('Biblioteca nao encontrada na configuracao.');
      error.statusCode = 404;
      throw error;
    }
    const settings = getSubtitleSettings(playlist);
    if (!settings.enabled) {
      const error = new Error('Ative as legendas desta biblioteca e salve a configuracao antes de buscar legendas ausentes.');
      error.statusCode = 400;
      throw error;
    }

    const summary = {
      playlist: folder,
      requestedLanguages: [...settings.languages],
      checked: 0,
      queued: 0,
      alreadyComplete: 0,
      skipped: 0,
      startedAt: nowIso()
    };

    for (const item of Object.values(this.state.items)) {
      if (item.libraryFolder !== folder || item.status !== 'completed' || item.orphaned || item.sourceActive === false) continue;
      summary.checked += 1;
      if (!item.targetPath || !(await pathExists(item.targetPath))) {
        summary.skipped += 1;
        continue;
      }
      const queued = await this.scheduleSubtitlesForItem(item, playlist, { resetAttempts: true });
      if (queued) summary.queued += 1;
      else summary.alreadyComplete += 1;
    }

    const libraryState = this.ensureLibraryState(folder);
    const preExistingDirty = Boolean(libraryState.dirty);
    libraryState.subtitleBackfill = {
      active: summary.queued > 0,
      requestedAt: summary.startedAt,
      requestedLanguages: [...settings.languages],
      checked: summary.checked,
      queued: summary.queued,
      changed: 0,
      preExistingDirty,
      finishedAt: summary.queued > 0 ? null : nowIso(),
      scan: null
    };
    await this.saveNow();
    if (summary.queued > 0) this.kick();
    await logger.info(`Busca de legendas ausentes preparada para ${folder}: ${summary.queued} item(ns) enfileirado(s).`, summary);
    return summary;
  }

  async maybeFinalizeSubtitleBackfills() {
    let changedState = false;
    for (const [folder, libraryState] of Object.entries(this.state.libraries)) {
      const job = libraryState && libraryState.subtitleBackfill;
      if (!job || !job.active) continue;
      const pending = Object.values(this.state.items).some((item) => (
        item.libraryFolder === folder &&
        item.subtitles &&
        ['pending', 'checking'].includes(item.subtitles.status)
      ));
      if (pending) continue;

      const playlist = findPlaylistByFolder(this.config, folder);
      let scan = null;
      if (Number(job.changed) > 0 && playlist && playlist.libraryId) {
        scan = await runLibraryAction(this.config, playlist, 'scan');
        if (scan && scan.ok && !job.preExistingDirty) libraryState.dirty = false;
      }
      job.active = false;
      job.finishedAt = nowIso();
      job.scan = scan;
      changedState = true;
      await logger.info(`Busca de legendas ausentes finalizada para ${folder}.`, {
        changed: Number(job.changed) || 0,
        scan
      });
    }
    if (changedState) await this.saveNow();
  }

  getWorkDir(item) {
    return path.join(this.config.paths.baseDir, '.youtube-downloader-work', item.libraryFolder, item.videoId);
  }

  async processItem(item) {
    const playlist = findPlaylistByFolder(this.config, item.libraryFolder);
    if (!playlist || playlist.enabled === false) return;

    if (item.targetPath && await pathExists(item.targetPath)) {
      let existingFileValid = false;
      try {
        await this.validateMedia(item.targetPath);
        existingFileValid = true;
      } catch (error) {
        const quarantinePath = `${item.targetPath}.invalid-${Date.now()}`;
        await fs.rename(item.targetPath, quarantinePath);
        await logger.warn(`Arquivo local invalido foi preservado para analise: ${quarantinePath}`, {
          videoId: item.videoId,
          error: error.message
        });
      }

      if (existingFileValid) {
        await this.markCompletedFromExistingFile(item);
        try {
          await this.scheduleSubtitlesForItem(item, playlist, { resetAttempts: true });
          await this.saveNow();
        } catch (error) {
          await logger.warn(`Video local reconhecido, mas a preparacao das legendas falhou: ${item.title} (${item.videoId}): ${error.message}`);
        }
        return;
      }
    }

    const workDir = this.getWorkDir(item);
    await fs.mkdir(workDir, { recursive: true });

    item.status = 'downloading';
    item.phase = 'downloading';
    item.attempts = Math.max(0, Number(item.attempts) || 0) + 1;
    item.startedAt = nowIso();
    item.updatedAt = item.startedAt;
    item.nextAttemptAt = null;
    item.lastError = null;
    item.progress = {
      downloadedBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null,
      percent: 0,
      updatedAt: item.startedAt
    };
    await this.saveNow();

    const context = {
      itemId: item.id,
      child: null,
      cancelRequested: false,
      shutdownRequested: false,
      startedAt: item.startedAt,
      phase: 'downloading'
    };
    this.current = context;

    const args = buildDownloadArgs(this.config, playlist, item, workDir);
    await logger.info(`Download iniciado: ${item.title} (${item.videoId})`, {
      playlist: item.libraryFolder,
      attempt: item.attempts,
      maxHeight: item.maxHeight,
      targetPath: item.targetPath
    });

    let stderrTail = '';
    let stdoutTail = '';
    let reportedFile = '';

    try {
      let child;
      try {
        child = spawn(this.config.paths.ytDlpPath, args, {
          cwd: workDir,
          env: process.env,
          shell: false,
          detached: process.platform !== 'win32'
        });
      } catch (error) {
        await this.handleDownloadFailure(item, `Nao foi possivel iniciar o yt-dlp: ${error.message}`);
        return;
      }

      context.child = child;

      const handleLine = (line, source) => {
        const progress = parseProgressLine(line);
        if (progress) {
          const currentItem = this.state.items[item.id];
          if (!currentItem) return;
          const total = progress.totalBytes;
          currentItem.progress = {
            downloadedBytes: progress.downloadedBytes,
            totalBytes: total,
            speedBytesPerSecond: progress.speedBytesPerSecond,
            etaSeconds: progress.etaSeconds,
            percent: total && progress.downloadedBytes !== null
              ? Math.min(100, (progress.downloadedBytes / total) * 100)
              : null,
            updatedAt: nowIso()
          };
          currentItem.updatedAt = currentItem.progress.updatedAt;
          this.saveSoon();
          return;
        }

        const filePath = parseFileLine(line);
        if (filePath) {
          reportedFile = filePath;
          return;
        }

        if (source === 'stderr') stderrTail = appendTail(stderrTail, line);
        else stdoutTail = appendTail(stdoutTail, line);
      };

      attachLineReader(child.stdout, (line) => handleLine(line, 'stdout'));
      attachLineReader(child.stderr, (line) => handleLine(line, 'stderr'));

      const closeResult = await new Promise((resolve) => {
        let resolved = false;
        child.on('error', (error) => {
          if (resolved) return;
          resolved = true;
          resolve({ code: null, signal: null, error });
        });
        child.on('close', (code, signal) => {
          if (resolved) return;
          resolved = true;
          resolve({ code, signal, error: null });
        });
      });
      context.child = null;

      if (!this.state.items[item.id]) return;
      if (await this.applyInterruption(item, context)) return;

      if (closeResult.error || closeResult.code !== 0) {
        const detail = closeResult.error
          ? closeResult.error.message
          : `yt-dlp terminou com codigo ${closeResult.code}${closeResult.signal ? ` (${closeResult.signal})` : ''}`;
        const output = [stderrTail, stdoutTail].filter(Boolean).join('\n').trim();
        await this.handleDownloadFailure(item, output ? `${detail}\n${output}` : detail);
        return;
      }

      item.phase = 'validating';
      item.updatedAt = nowIso();
      this.saveSoon();
      const stagedMedia = await this.resolveStagedMedia(workDir, reportedFile);
      const compatibleMedia = await this.normalizeMedia(stagedMedia, workDir, item, context);
      if (await this.applyInterruption(item, context)) return;

      item.phase = 'finalizing';
      item.updatedAt = nowIso();
      this.saveSoon();
      await this.validateMedia(compatibleMedia);
      if (await this.applyInterruption(item, context)) return;
      await this.finalizeDownload(item, compatibleMedia, workDir);
      try {
        await this.scheduleSubtitlesForItem(item, playlist, { resetAttempts: true });
        await this.saveNow();
      } catch (error) {
        await logger.warn(`Video concluido, mas a preparacao das legendas falhou: ${item.title} (${item.videoId}): ${error.message}`);
      }
      await logger.info(`Download concluido: ${item.title} (${item.videoId})`, {
        playlist: item.libraryFolder,
        targetPath: item.targetPath,
        sizeBytes: item.fileSizeBytes
      });
    } catch (error) {
      if (!this.state.items[item.id]) return;
      if (await this.applyInterruption(item, context)) return;
      await this.handleDownloadFailure(item, `Pos-processamento/validacao falhou: ${error.message}`);
    } finally {
      context.child = null;
      if (this.current === context) this.current = null;
    }
  }

  async applyInterruption(item, context) {
    if (context.shutdownRequested) {
      item.status = item.sourceActive === false ? 'orphaned' : 'pending';
      item.phase = null;
      item.lastError = 'Download interrompido durante o encerramento do aplicativo; sera retomado depois.';
      item.updatedAt = nowIso();
      item.progress = { ...item.progress, speedBytesPerSecond: null, etaSeconds: null };
      await this.saveNow();
      return true;
    }

    if (context.cancelRequested) {
      item.status = item.sourceActive === false ? 'orphaned' : 'cancelled';
      item.phase = null;
      item.cancelledAt = nowIso();
      item.updatedAt = item.cancelledAt;
      item.nextAttemptAt = null;
      item.lastError = 'Download cancelado pelo usuario.';
      item.progress = { ...item.progress, speedBytesPerSecond: null, etaSeconds: null };
      await this.saveNow();
      await logger.warn(`Download cancelado: ${item.title} (${item.videoId}).`);
      return true;
    }

    return false;
  }

  async resolveStagedMedia(workDir, reportedFile) {
    const reportedPath = reportedFile
      ? (path.isAbsolute(reportedFile) ? reportedFile : path.join(workDir, reportedFile))
      : '';
    if (reportedPath && await pathExists(reportedPath)) return reportedPath;

    const normalized = path.join(workDir, 'normalized-output.mp4');
    if (await pathExists(normalized)) return normalized;

    const expected = path.join(workDir, 'media.mp4');
    if (await pathExists(expected)) return expected;

    const entries = await fs.readdir(workDir, { withFileTypes: true });
    const candidate = entries.find((entry) => (
      entry.isFile() &&
      entry.name.startsWith('media.') &&
      !entry.name.endsWith('.part') &&
      !entry.name.endsWith('.ytdl') &&
      !/\.(jpg|jpeg|png|webp)$/i.test(entry.name)
    ));

    if (!candidate) throw new Error('O yt-dlp terminou sem produzir um arquivo de video final.');
    return path.join(workDir, candidate.name);
  }

  async inspectMedia(mediaPath) {
    const stats = await fs.stat(mediaPath);
    if (!stats.isFile() || stats.size <= 0) throw new Error('Arquivo de video final vazio ou invalido.');

    const result = await runCommand(this.config.paths.ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height:format=format_name,duration',
      '-of',
      'json',
      mediaPath
    ], { timeoutMs: 60000 });

    if (result.timedOut) throw new Error('Timeout ao validar o arquivo com ffprobe.');
    if (result.code !== 0) throw new Error(result.stderr.trim() || `ffprobe terminou com codigo ${result.code}.`);

    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      throw new Error('ffprobe retornou JSON invalido.');
    }

    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video') || null;
    const audio = streams.find((stream) => stream.codec_type === 'audio') || null;
    return {
      stats,
      payload,
      video,
      audio,
      formatName: String(payload.format && payload.format.format_name || ''),
      durationSeconds: Number(payload.format && payload.format.duration) || null
    };
  }

  async normalizeMedia(mediaPath, workDir, item, context) {
    const inspection = await this.inspectMedia(mediaPath);
    if (!inspection.video) throw new Error('Nenhum stream de video encontrado.');
    if (!inspection.audio) throw new Error('Nenhum stream de audio encontrado.');

    const compatibleCodecs = inspection.video.codec_name === 'h264' && inspection.audio.codec_name === 'aac';
    const mp4Container = /(^|,)(mov|mp4|m4a|3gp|3g2|mj2)(,|$)/i.test(inspection.formatName) || path.extname(mediaPath).toLowerCase() === '.mp4';
    if (compatibleCodecs && mp4Container) return mediaPath;

    const preferredOutput = path.join(workDir, 'normalized-output.mp4');
    const outputPath = path.resolve(mediaPath) === path.resolve(preferredOutput)
      ? path.join(workDir, 'normalized-output-2.mp4')
      : preferredOutput;
    await fs.rm(outputPath, { force: true });

    const executeFfmpeg = async (copyCodecs) => {
      if (context.cancelRequested || context.shutdownRequested) {
        throw new Error('Normalizacao interrompida.');
      }

      item.phase = copyCodecs ? 'remuxing' : 'transcoding';
      context.phase = item.phase;
      item.updatedAt = nowIso();
      this.saveSoon();

      const args = [
        '-nostdin',
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        mediaPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-sn',
        '-dn'
      ];

      if (copyCodecs) {
        args.push('-c:v', 'copy', '-c:a', 'copy');
      } else {
        args.push(
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '192k'
        );
      }

      args.push(
        '-max_muxing_queue_size',
        '4096',
        '-movflags',
        '+faststart',
        outputPath
      );

      let spawnedChild = null;
      const result = await runCommand(this.config.paths.ffmpegPath, args, {
        detached: process.platform !== 'win32',
        onSpawn: (child) => {
          spawnedChild = child;
          context.child = child;
        }
      });
      if (context.child === spawnedChild) context.child = null;
      return result;
    };

    let result = await executeFfmpeg(compatibleCodecs);
    if ((result.code !== 0 || result.timedOut) && compatibleCodecs && !context.cancelRequested && !context.shutdownRequested) {
      await logger.warn(`Remux sem recodificacao falhou para ${item.videoId}; tentando normalizacao completa.`, {
        error: result.stderr.trim().slice(-1500)
      });
      await fs.rm(outputPath, { force: true });
      result = await executeFfmpeg(false);
    }

    if (context.cancelRequested || context.shutdownRequested) {
      throw new Error('Normalizacao interrompida.');
    }
    if (result.timedOut) throw new Error('Timeout durante a normalizacao com ffmpeg.');
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `ffmpeg terminou com codigo ${result.code}.`);
    }

    await this.validateMedia(outputPath);
    if (path.resolve(outputPath) !== path.resolve(mediaPath)) {
      await fs.rm(mediaPath, { force: true });
    }
    return outputPath;
  }

  async validateMedia(mediaPath) {
    const inspection = await this.inspectMedia(mediaPath);
    if (!inspection.video) throw new Error('Nenhum stream de video encontrado.');
    if (!inspection.audio) throw new Error('Nenhum stream de audio encontrado.');
    if (inspection.video.codec_name !== 'h264') {
      throw new Error(`Codec de video inesperado: ${inspection.video.codec_name || 'desconhecido'}; esperado H.264.`);
    }
    if (inspection.audio.codec_name !== 'aac') {
      throw new Error(`Codec de audio inesperado: ${inspection.audio.codec_name || 'desconhecido'}; esperado AAC.`);
    }
    const mp4Container = /(^|,)(mov|mp4|m4a|3gp|3g2|mj2)(,|$)/i.test(inspection.formatName) || path.extname(mediaPath).toLowerCase() === '.mp4';
    if (!mp4Container) throw new Error(`Container inesperado: ${inspection.formatName || path.extname(mediaPath)}; esperado MP4.`);
    return inspection;
  }

  async finalizeDownload(item, stagedMedia, workDir) {
    await fs.mkdir(path.dirname(item.targetPath), { recursive: true });

    if (await pathExists(item.targetPath)) {
      await fs.rm(stagedMedia, { force: true });
    } else {
      await moveAcrossFileSystems(stagedMedia, item.targetPath);
    }

    const playlist = findPlaylistByFolder(this.config, item.libraryFolder);
    const movieSettings = getMovieMetadataSettings(playlist);
    const stagedThumbnail = await this.findStagedThumbnail(workDir);
    if (this.config.downloads.writeThumbnails !== false || movieSettings.enabled) {
      const shouldReplace = this.config.downloads.updateExistingThumbnails === true;
      if (stagedThumbnail && (shouldReplace || !(await pathExists(item.thumbnailPath)))) {
        if (shouldReplace) await fs.rm(item.thumbnailPath, { force: true });
        await moveAcrossFileSystems(stagedThumbnail, item.thumbnailPath);
      } else if (!stagedThumbnail && item.thumbnailUrl && (shouldReplace || !(await pathExists(item.thumbnailPath)))) {
        const tempThumbnail = path.join(workDir, 'remote-thumbnail.jpg');
        try {
          await downloadRemoteFile(item.thumbnailUrl, tempThumbnail, 30000);
          if (shouldReplace) await fs.rm(item.thumbnailPath, { force: true });
          await moveAcrossFileSystems(tempThumbnail, item.thumbnailPath);
        } catch (error) {
          await logger.warn(`Video concluido, mas a thumbnail de ${item.videoId} nao pôde ser salva: ${error.message}`);
        }
      }
    }

    if (movieSettings.enabled) {
      const baseName = path.parse(item.targetPath).name;
      item.nfoPath = item.nfoPath || path.join(path.dirname(item.targetPath), `${baseName}.nfo`);
      item.mediaLayout = 'movie-folder';
      try {
        await writeMovieNfo(item, item.nfoPath);
        const movieMetadata = getMovieMetadata(item);
        item.movieMetadata = {
          status: 'complete',
          artist: movieMetadata.artist,
          title: movieMetadata.trackTitle,
          nfoPath: item.nfoPath,
          posterPath: item.thumbnailPath,
          updatedAt: nowIso(),
          lastError: null
        };
      } catch (error) {
        item.movieMetadata = {
          status: 'failed',
          nfoPath: item.nfoPath,
          posterPath: item.thumbnailPath,
          updatedAt: nowIso(),
          lastError: error.message
        };
        await logger.warn(`Video concluido, mas o NFO de ${item.videoId} nao pôde ser salvo: ${error.message}`);
      }
    }

    const stats = await fs.stat(item.targetPath);
    item.status = 'completed';
    item.phase = null;
    item.completedAt = nowIso();
    item.updatedAt = item.completedAt;
    item.mediaPath = item.targetPath;
    item.fileSizeBytes = stats.size;
    item.nextAttemptAt = null;
    item.lastError = null;
    item.priority = 0;
    item.progress = {
      downloadedBytes: stats.size,
      totalBytes: stats.size,
      speedBytesPerSecond: null,
      etaSeconds: 0,
      percent: 100,
      updatedAt: item.completedAt
    };

    const libraryState = this.ensureLibraryState(item.libraryFolder);
    libraryState.dirty = true;
    libraryState.lastCompletedAt = item.completedAt;
    libraryState.lastIdleActionError = null;
    this.idleSinceMs = null;

    await fs.rm(workDir, { recursive: true, force: true });
    await this.saveNow();
  }

  async findStagedThumbnail(workDir) {
    let entries = [];
    try {
      entries = await fs.readdir(workDir, { withFileTypes: true });
    } catch {
      return '';
    }
    const candidate = entries.find((entry) => entry.isFile() && /^media\.(jpg|jpeg|png|webp)$/i.test(entry.name));
    return candidate ? path.join(workDir, candidate.name) : '';
  }

  async markCompletedFromExistingFile(item) {
    const stats = await fs.stat(item.targetPath);
    item.status = 'completed';
    item.phase = null;
    item.mediaPath = item.targetPath;
    item.fileSizeBytes = stats.size;
    item.completedAt = item.completedAt || nowIso();
    item.updatedAt = nowIso();
    item.nextAttemptAt = null;
    item.lastError = null;
    item.progress = {
      downloadedBytes: stats.size,
      totalBytes: stats.size,
      speedBytesPerSecond: null,
      etaSeconds: 0,
      percent: 100,
      updatedAt: item.updatedAt
    };
    await this.saveNow();
  }

  async handleDownloadFailure(item, message) {
    const delays = this.config.downloads.retryDelaysMinutes || [1, 5, 15];
    const maxAttempts = delays.length + 1;
    const shortMessage = String(message || 'Falha desconhecida').slice(-24000);
    item.lastError = shortMessage;
    item.phase = null;
    item.updatedAt = nowIso();
    item.progress = { ...item.progress, speedBytesPerSecond: null, etaSeconds: null };

    if (item.sourceActive === false || item.orphaned) {
      item.status = 'orphaned';
      item.nextAttemptAt = null;
    } else if (item.attempts < maxAttempts) {
      const delayMinutes = Number(delays[item.attempts - 1]) || 1;
      item.status = 'pending';
      item.nextAttemptAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
      await logger.warn(`Download falhou e sera tentado novamente em ${delayMinutes} minuto(s): ${item.title} (${item.videoId}).`, {
        attempt: item.attempts,
        maxAttempts,
        error: shortMessage.slice(-1500)
      });
    } else {
      item.status = 'failed';
      item.failedAt = item.updatedAt;
      item.nextAttemptAt = null;
      await logger.error(`Download falhou definitivamente apos ${item.attempts} tentativa(s): ${item.title} (${item.videoId}).`, {
        error: shortMessage.slice(-2000)
      });
    }

    await this.saveNow();
  }

  ensureLibraryState(libraryFolder) {
    if (!this.state.libraries[libraryFolder]) {
      this.state.libraries[libraryFolder] = {
        dirty: false,
        lastDiscoveryAt: null,
        lastCompletedAt: null,
        lastIdleActionAt: null,
        lastIdleActionResult: null,
        lastIdleActionError: null,
        subtitleBackfill: null
      };
    }
    return this.state.libraries[libraryFolder];
  }

  async maybeRunIdleActions() {
    const dirtyFolders = Object.entries(this.state.libraries)
      .filter(([folder, value]) => {
        if (!value || !value.dirty) return false;
        if (value.subtitleBackfill && value.subtitleBackfill.active) return false;
        const subtitleWorkPending = Object.values(this.state.items).some((item) => (
          item.libraryFolder === folder &&
          item.subtitles &&
          ['pending', 'checking'].includes(item.subtitles.status)
        ));
        return !subtitleWorkPending;
      })
      .map(([folder]) => folder);
    if (dirtyFolders.length === 0) {
      this.idleSinceMs = null;
      return;
    }

    if (Date.now() < this.nextIdleActionAtMs) return;
    if (!this.idleSinceMs) {
      this.idleSinceMs = Date.now();
      return;
    }

    const delayMs = Math.max(3, Number(this.config.downloads.idleActionDelaySeconds) || 15) * 1000;
    if (Date.now() - this.idleSinceMs < delayMs) return;

    this.idleActionRunning = true;
    try {
      for (const libraryFolder of dirtyFolders) {
        const libraryState = this.ensureLibraryState(libraryFolder);
        const playlist = findPlaylistByFolder(this.config, libraryFolder);
        if (!playlist) {
          libraryState.dirty = false;
          libraryState.lastIdleActionError = 'Biblioteca removida da configuracao; scan automatico ignorado.';
          continue;
        }

        if (!playlist.libraryId && !playlist.playoutId) {
          libraryState.dirty = true;
          libraryState.lastIdleActionError = 'Library ID e Playout ID nao configurados; os arquivos aguardam o scan automatico.';
          this.nextIdleActionAtMs = Date.now() + RETRY_IDLE_ACTION_MS;
          continue;
        }

        try {
          const result = await scanAndRebuild(this.config, playlist);
          libraryState.lastIdleActionAt = nowIso();
          libraryState.lastIdleActionResult = result;
          libraryState.lastIdleActionError = result.ok ? null : 'Uma ou mais acoes do ErsatzTV falharam.';
          libraryState.dirty = !result.ok;
          if (!result.ok) this.nextIdleActionAtMs = Date.now() + RETRY_IDLE_ACTION_MS;
        } catch (error) {
          libraryState.lastIdleActionAt = nowIso();
          libraryState.lastIdleActionError = error.message;
          libraryState.dirty = true;
          this.nextIdleActionAtMs = Date.now() + RETRY_IDLE_ACTION_MS;
          await logger.warn(`Falha nas acoes automaticas do ErsatzTV para ${libraryFolder}: ${error.message}`);
        }
      }
      await this.saveNow();
    } finally {
      this.idleActionRunning = false;
      this.idleSinceMs = null;
    }
  }

  async refreshStorage(force = false) {
    if (!this.config || !this.config.paths || !this.config.paths.baseDir) return null;
    if (!force && this.storage && Date.now() - this.storageCheckedAtMs < STORAGE_REFRESH_MS) return this.storage;

    try {
      const stats = await getDiskStats(this.config.paths.baseDir);
      const minBytes = Math.max(1, Number(this.config.downloads.minFreeSpaceGb) || 20) * 1024 ** 3;
      this.storage = {
        ...stats,
        minFreeBytes: minBytes,
        low: stats.availableBytes < minBytes
      };
    } catch (error) {
      this.storage = {
        path: this.config.paths.baseDir,
        totalBytes: 0,
        freeBytes: 0,
        availableBytes: 0,
        usedBytes: 0,
        minFreeBytes: Math.max(1, Number(this.config.downloads.minFreeSpaceGb) || 20) * 1024 ** 3,
        low: false,
        checkedAt: nowIso(),
        error: error.message
      };
    }
    this.storageCheckedAtMs = Date.now();
    return this.storage;
  }

  isLowDisk() {
    return Boolean(
      this.config &&
      this.config.downloads &&
      this.config.downloads.pauseOnLowDisk &&
      this.storage &&
      !this.storage.error &&
      this.storage.low
    );
  }

  chooseTargetPaths(playlist, video, itemId) {
    const playlistDir = path.join(this.config.paths.baseDir, playlist.folderName);
    const extracted = extractArtistAndTitle(video.title || 'Sem Titulo');
    let artist = normalizeArtistDisplayName(extracted.artist);
    const title = extracted.title;

    // Usa um unico nome canonico para o artista dentro da biblioteca, ignorando
    // diferencas apenas de maiusculas/minusculas vindas do YouTube.
    const artistKey = artist.toLocaleLowerCase('pt-BR');
    for (const existing of Object.values(this.state.items)) {
      if (existing.id === itemId || existing.libraryFolder !== playlist.folderName || !existing.artist) continue;
      const existingArtist = normalizeArtistDisplayName(existing.artist);
      if (existingArtist.toLocaleLowerCase('pt-BR') === artistKey) {
        artist = existingArtist;
        break;
      }
    }

    const desiredArtistFolder = sanitizeFileComponent(artist, 'Outros', 100);
    const existingArtistFolder = findCaseInsensitiveDirectoryName(playlistDir, desiredArtistFolder);
    const artistFolderName = existingArtistFolder || desiredArtistFolder;
    const artistDir = path.join(playlistDir, artistFolderName);
    const preferredBase = artist !== 'Outros'
      ? sanitizeFileComponent(`${artist} - ${title}`, `Video ${video.id}`, 220)
      : sanitizeFileComponent(title, `Video ${video.id}`, 220);
    const movieSettings = getMovieMetadataSettings(playlist);

    const usedPaths = new Map();
    for (const existing of Object.values(this.state.items)) {
      if (existing.targetPath) usedPaths.set(path.resolve(existing.targetPath), existing.id);
    }

    let baseName = preferredBase;
    const buildTargetPath = () => movieSettings.enabled
      ? path.join(artistDir, baseName, `${baseName}.mp4`)
      : path.join(artistDir, `${baseName}.mp4`);
    let targetPath = buildTargetPath();
    let counter = 1;
    while (true) {
      const owner = usedPaths.get(path.resolve(targetPath));
      const exists = require('fs').existsSync(targetPath);
      if ((!owner || owner === itemId) && (!exists || owner === itemId)) break;
      const suffix = counter === 1 ? video.id : `${video.id}-${counter}`;
      baseName = sanitizeFileComponent(`${preferredBase} [${suffix}]`, `Video ${video.id}`, 230);
      targetPath = buildTargetPath();
      counter += 1;
    }

    const targetDir = path.dirname(targetPath);
    return {
      artist,
      trackTitle: title,
      targetPath,
      thumbnailPath: movieSettings.enabled
        ? path.join(targetDir, 'poster.jpg')
        : path.join(artistDir, `${baseName}.jpg`),
      nfoPath: movieSettings.enabled ? path.join(targetDir, `${baseName}.nfo`) : null,
      mediaLayout: movieSettings.enabled ? 'movie-folder' : 'flat-artist'
    };
  }

  async reconcileLibrary(config, playlistInput, videos) {
    await this.init(config);
    this.configure(config);
    const playlist = normalizePlaylist(playlistInput);
    const libraryFolder = playlist.folderName;
    if (!libraryFolder) throw new Error('Nome de biblioteca invalido.');

    const discoveredIds = new Set();
    const summary = {
      library: libraryFolder,
      discovered: 0,
      queued: 0,
      alreadyCompleted: 0,
      alreadyKnown: 0,
      reactivated: 0,
      orphaned: 0,
      skipped: 0
    };

    await fs.mkdir(path.join(config.paths.baseDir, libraryFolder), { recursive: true });

    for (const video of videos || []) {
      const videoId = String(video && video.id || '').trim();
      if (!videoId) {
        summary.skipped += 1;
        continue;
      }

      discoveredIds.add(videoId);
      summary.discovered += 1;
      const id = makeItemId(libraryFolder, videoId);
      const existing = this.state.items[id];
      const metadata = {
        title: String(video.title || existing && existing.title || `Video ${videoId}`).trim(),
        description: String(video.description || existing && existing.description || ''),
        durationSeconds: Number(video.duration) || existing && existing.durationSeconds || null,
        year: Number(video.year) || existing && existing.year || null,
        thumbnailUrl: String(video.thumbnailUrl || video.thumbnail || existing && existing.thumbnailUrl || '').trim(),
        channelTitle: String(video.channelTitle || existing && existing.channelTitle || '').trim(),
        url: String(video.webpage_url || video.url || `https://www.youtube.com/watch?v=${videoId}`).trim(),
        sourceUrl: String(video.sourceUrl || '').trim(),
        sourceIndex: Number.isFinite(Number(video.sourceIndex)) ? Number(video.sourceIndex) : null,
        sourceKind: String(video.sourceKind || '').trim(),
        maxHeight: getEffectiveMaxHeight(config, playlist)
      };

      if (existing) {
        const wasOrphaned = existing.orphaned || existing.sourceActive === false || existing.status === 'orphaned';
        const previousPathExists = Boolean(existing.targetPath && await pathExists(existing.targetPath));
        Object.assign(existing, metadata, {
          libraryName: playlist.name,
          libraryFolder,
          videoId,
          sourceActive: true,
          orphaned: false,
          orphanedAt: null,
          lastSeenAt: nowIso(),
          updatedAt: nowIso()
        });

        // Se o arquivo local foi apagado, recalcula o destino com as regras atuais.
        // Isso permite apagar o acervo inicial e baixar novamente sem herdar paths
        // antigos com casing inconsistente de artista.
        if (!previousPathExists && !(existing.status === 'removed' && existing.suppressed)) {
          Object.assign(existing, this.chooseTargetPaths(playlist, video, id));
        }

        if (existing.status === 'completed' && existing.targetPath && !(await pathExists(existing.targetPath))) {
          existing.status = 'pending';
          existing.mediaPath = null;
          existing.fileSizeBytes = 0;
          existing.attempts = 0;
          existing.nextAttemptAt = null;
          existing.phase = null;
          summary.reactivated += 1;
        } else if (existing.status === 'orphaned' || (existing.status === 'removed' && !existing.suppressed)) {
          existing.status = existing.targetPath && await pathExists(existing.targetPath) ? 'completed' : 'pending';
          existing.suppressed = false;
          existing.attempts = 0;
          existing.nextAttemptAt = null;
          existing.phase = null;
          summary.reactivated += 1;
        } else if (existing.status === 'removed' && existing.suppressed) {
          summary.alreadyKnown += 1;
        } else if (existing.status === 'completed') {
          summary.alreadyCompleted += 1;
        } else {
          summary.alreadyKnown += 1;
          if (wasOrphaned) summary.reactivated += 1;
        }
        continue;
      }

      const target = this.chooseTargetPaths(playlist, video, id);
      const exists = await pathExists(target.targetPath);
      const createdAt = nowIso();
      this.state.items[id] = {
        id,
        libraryName: playlist.name,
        libraryFolder,
        videoId,
        ...metadata,
        ...target,
        status: exists ? 'completed' : 'pending',
        phase: null,
        suppressed: false,
        sourceActive: true,
        orphaned: false,
        orphanedAt: null,
        queueOrder: this.state.nextSequence++,
        priority: 0,
        attempts: 0,
        nextAttemptAt: null,
        createdAt,
        discoveredAt: createdAt,
        lastSeenAt: createdAt,
        updatedAt: createdAt,
        completedAt: exists ? createdAt : null,
        mediaPath: exists ? target.targetPath : null,
        fileSizeBytes: exists ? (await fs.stat(target.targetPath)).size : 0,
        progress: exists ? { percent: 100, updatedAt: createdAt } : { percent: 0, updatedAt: createdAt },
        lastError: null
      };
      if (exists) summary.alreadyCompleted += 1;
      else summary.queued += 1;
    }

    for (const item of Object.values(this.state.items)) {
      if (item.libraryFolder !== libraryFolder || discoveredIds.has(item.videoId)) continue;
      if (item.sourceActive === false && item.orphaned) continue;

      item.sourceActive = false;
      item.orphaned = true;
      item.orphanedAt = nowIso();
      item.updatedAt = item.orphanedAt;
      const keepSuppressedRemoval = item.status === 'removed' && item.suppressed;
      if (!keepSuppressedRemoval && ['pending', 'failed', 'cancelled', 'removed'].includes(item.status)) {
        item.status = 'orphaned';
        item.nextAttemptAt = null;
      }
      summary.orphaned += 1;
    }

    const libraryState = this.ensureLibraryState(libraryFolder);
    libraryState.lastDiscoveryAt = nowIso();
    libraryState.lastDiscoverySummary = summary;
    await this.saveNow();
    this.kick();
    return summary;
  }

  async pause(reason = 'Fila pausada pelo usuario.') {
    this.state.paused = true;
    this.state.pauseReason = reason;
    await this.saveNow();
    return this.getQueueStatus();
  }

  async resume() {
    this.state.paused = false;
    this.state.pauseReason = null;
    await this.saveNow();
    this.kick();
    return this.getQueueStatus();
  }

  async clearQueue(options = {}) {
    const requestedLibrary = String(options.library || '').trim();
    const libraryFolder = requestedLibrary ? sanitizeName(requestedLibrary) : '';
    const cancelCurrent = options.cancelCurrent !== false;
    const summary = {
      library: libraryFolder || null,
      cancelledCurrent: false,
      removed: 0,
      workDirectoriesRemoved: 0,
      completedPreserved: 0,
      skippedCurrent: 0
    };

    const currentItem = this.current ? this.state.items[this.current.itemId] : null;
    const currentMatches = Boolean(currentItem && (!libraryFolder || currentItem.libraryFolder === libraryFolder));
    if (currentMatches) {
      if (!cancelCurrent) {
        summary.skippedCurrent = 1;
      } else {
        this.current.cancelRequested = true;
        killProcessTree(this.current.child);
        summary.cancelledCurrent = true;
        if (this.currentPromise) {
          await Promise.race([
            this.currentPromise.catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 10000))
          ]);
        }
        if (this.current && this.current.itemId === currentItem.id) {
          throw new Error('O download atual ainda esta sendo encerrado. Aguarde alguns segundos e tente novamente.');
        }
      }
    }

    const updatedAt = nowIso();
    for (const item of Object.values(this.state.items)) {
      if (libraryFolder && item.libraryFolder !== libraryFolder) continue;
      if (item.status === 'completed') {
        summary.completedPreserved += 1;
        continue;
      }
      if (item.status === 'downloading') {
        summary.skippedCurrent += 1;
        continue;
      }

      await fs.rm(this.getWorkDir(item), { recursive: true, force: true });
      summary.workDirectoriesRemoved += 1;
      item.status = 'removed';
      item.phase = null;
      item.suppressed = true;
      item.priority = 0;
      item.nextAttemptAt = null;
      item.lastError = 'Item removido pela limpeza da fila. Use Tentar novamente para reativar.';
      item.updatedAt = updatedAt;
      item.progress = {
        ...(item.progress || {}),
        speedBytesPerSecond: null,
        etaSeconds: null,
        updatedAt
      };
      summary.removed += 1;
    }

    await this.saveNow();
    await logger.warn(`Fila de downloads limpa: ${summary.removed} item(ns) removido(s).`, {
      library: summary.library,
      cancelledCurrent: summary.cancelledCurrent,
      completedPreserved: summary.completedPreserved
    });
    this.kick();
    return summary;
  }

  async retryItem(id) {
    const item = this.state.items[id];
    if (!item) throw this.notFoundError();
    if (item.sourceActive === false || item.orphaned) throw new Error('O item esta fora das fontes atuais e nao pode ser recolocado na fila.');
    if (item.status === 'downloading') throw new Error('O item ja esta sendo baixado.');
    if (item.status === 'completed' && item.targetPath && await pathExists(item.targetPath)) {
      throw new Error('O item ja possui um arquivo concluido.');
    }

    item.status = 'pending';
    item.phase = null;
    item.suppressed = false;
    item.attempts = 0;
    item.nextAttemptAt = null;
    item.lastError = null;
    item.failedAt = null;
    item.cancelledAt = null;
    item.updatedAt = nowIso();
    await this.saveNow();
    this.kick();
    return clone(item);
  }

  async prioritizeItem(id) {
    const item = this.state.items[id];
    if (!item) throw this.notFoundError();
    if (item.status !== 'pending') throw new Error('Somente itens pendentes podem receber prioridade.');
    const maxPriority = Math.max(0, ...Object.values(this.state.items).map((entry) => Number(entry.priority) || 0));
    item.priority = maxPriority + 1;
    item.updatedAt = nowIso();
    await this.saveNow();
    this.kick();
    return clone(item);
  }

  async cancelItem(id) {
    const item = this.state.items[id];
    if (!item) throw this.notFoundError();

    if (this.current && this.current.itemId === id) {
      this.current.cancelRequested = true;
      killProcessTree(this.current.child);
      return clone(item);
    }

    if (!['pending', 'failed'].includes(item.status)) {
      throw new Error('Este item nao esta pendente nem em falha e nao pode ser cancelado.');
    }

    item.status = 'cancelled';
    item.phase = null;
    item.cancelledAt = nowIso();
    item.updatedAt = item.cancelledAt;
    item.nextAttemptAt = null;
    item.lastError = 'Download cancelado pelo usuario.';
    await this.saveNow();
    return clone(item);
  }

  async removeItem(id) {
    const item = this.state.items[id];
    if (!item) throw this.notFoundError();
    if (this.current && this.current.itemId === id) throw new Error('Cancele o download antes de remover o item da fila.');
    if (item.status === 'completed' && item.targetPath && await pathExists(item.targetPath)) {
      throw new Error('Itens concluidos permanecem no indice para evitar downloads duplicados. Use a limpeza de orfaos quando aplicavel.');
    }

    await fs.rm(this.getWorkDir(item), { recursive: true, force: true });

    const hasLocalFile = Boolean(item.targetPath && await pathExists(item.targetPath));
    if (item.orphaned && !hasLocalFile) {
      delete this.state.items[id];
      await this.saveNow();
      return { id, deleted: true, status: 'deleted' };
    }

    item.status = 'removed';
    item.phase = null;
    item.suppressed = true;
    item.nextAttemptAt = null;
    item.lastError = 'Item removido manualmente da fila. Use Tentar novamente para reativar.';
    item.updatedAt = nowIso();
    await this.saveNow();
    return clone(item);
  }

  notFoundError() {
    const error = new Error('Item de download nao encontrado.');
    error.statusCode = 404;
    return error;
  }

  getQueueStatus() {
    const items = Object.values(this.state.items);
    const counts = {
      pending: 0,
      downloading: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      orphaned: 0,
      removed: 0
    };
    let totalBytes = 0;
    let oldestPendingAt = null;
    let nextRetryAt = null;
    let lastCompletedAt = null;
    let lastFailedAt = null;
    const activeLibraries = new Set();

    for (const item of items) {
      if (counts[item.status] !== undefined) counts[item.status] += 1;
      if (item.orphaned && item.status === 'completed') counts.orphaned += 1;
      totalBytes += Number(item.fileSizeBytes) || 0;

      if (item.status === 'pending' || item.status === 'downloading') {
        activeLibraries.add(item.libraryFolder);
        const pendingDate = item.createdAt || item.discoveredAt || item.updatedAt;
        if (pendingDate && (!oldestPendingAt || new Date(pendingDate).getTime() < new Date(oldestPendingAt).getTime())) {
          oldestPendingAt = pendingDate;
        }
      }
      if (item.status === 'pending' && item.nextAttemptAt) {
        if (!nextRetryAt || new Date(item.nextAttemptAt).getTime() < new Date(nextRetryAt).getTime()) {
          nextRetryAt = item.nextAttemptAt;
        }
      }
      if (item.completedAt && (!lastCompletedAt || new Date(item.completedAt).getTime() > new Date(lastCompletedAt).getTime())) {
        lastCompletedAt = item.completedAt;
      }
      if (item.failedAt && (!lastFailedAt || new Date(item.failedAt).getTime() > new Date(lastFailedAt).getTime())) {
        lastFailedAt = item.failedAt;
      }
    }

    const currentItem = this.current ? this.state.items[this.current.itemId] : null;
    const activeItems = counts.pending + counts.downloading;
    const actionRequired = counts.failed;
    const historyItems = Math.max(0, items.length - activeItems - actionRequired);
    const storage = this.storage ? clone(this.storage) : null;
    if (storage && storage.totalBytes > 0) {
      storage.usedPercent = Math.min(100, Math.max(0, (storage.usedBytes / storage.totalBytes) * 100));
    } else if (storage) {
      storage.usedPercent = null;
    }

    return {
      running: Boolean(this.current),
      workerStarted: this.running,
      paused: this.state.paused,
      pauseReason: this.state.pauseReason,
      lowDiskBlocked: this.isLowDisk(),
      counts,
      totalItems: items.length,
      activeItems,
      actionRequired,
      historyItems,
      activeLibraries: activeLibraries.size,
      totalBytes,
      oldestPendingAt,
      nextRetryAt,
      lastCompletedAt,
      lastFailedAt,
      current: currentItem ? clone(currentItem) : null,
      idleActionRunning: this.idleActionRunning,
      storage,
      updatedAt: this.state.updatedAt
    };
  }

  filterAndSortItems(options = {}) {
    const statusFilter = String(options.status || '').trim();
    const libraryFilter = sanitizeName(options.library || '');
    const statusRank = {
      downloading: 0,
      pending: 1,
      failed: 2,
      cancelled: 3,
      orphaned: 4,
      completed: 5,
      removed: 6
    };

    return Object.values(this.state.items)
      .filter((item) => {
        if (!statusFilter || statusFilter === 'all') return true;
        if (statusFilter === 'active') return ['downloading', 'pending', 'failed'].includes(item.status);
        if (statusFilter === 'history') return !['downloading', 'pending', 'failed'].includes(item.status);
        if (statusFilter === 'orphaned') return item.orphaned || item.status === 'orphaned';
        return item.status === statusFilter;
      })
      .filter((item) => !libraryFilter || item.libraryFolder === libraryFilter)
      .sort((a, b) => {
        const rankDelta = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
        if (rankDelta !== 0) return rankDelta;
        if (a.status === 'pending') {
          const priorityDelta = (Number(b.priority) || 0) - (Number(a.priority) || 0);
          if (priorityDelta !== 0) return priorityDelta;
          return (Number(a.queueOrder) || 0) - (Number(b.queueOrder) || 0);
        }
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
  }

  getItemsPage(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
    const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
    const filtered = this.filterAndSortItems(options);
    const items = filtered.slice(offset, offset + limit).map(clone);
    return {
      items,
      total: filtered.length,
      offset,
      limit,
      hasMore: offset + items.length < filtered.length
    };
  }

  listItems(options = {}) {
    return this.getItemsPage(options).items;
  }

  getLibraryStats(config = this.config) {
    const result = {};
    const configured = (config.playlists || []).map(normalizePlaylist);

    for (const playlist of configured) {
      const stats = {
        playlist: playlist.folderName,
        total: 0,
        pending: 0,
        downloading: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        orphaned: 0,
        removed: 0,
        totalBytes: 0,
        lastDiscoveryAt: null,
        dirtyForScan: false,
        lastIdleActionAt: null,
        lastIdleActionError: null,
        subtitlesEnabled: getSubtitleSettings(playlist).enabled,
        subtitlePending: 0,
        subtitleFailed: 0,
        subtitleComplete: 0,
        subtitleUnavailable: 0,
        subtitleBackfill: null
      };

      for (const item of Object.values(this.state.items)) {
        if (item.libraryFolder !== playlist.folderName) continue;
        stats.total += 1;
        if (stats[item.status] !== undefined) stats[item.status] += 1;
        if (item.orphaned && item.status === 'completed') stats.orphaned += 1;
        stats.totalBytes += Number(item.fileSizeBytes) || 0;
        if (item.subtitles && item.status === 'completed') {
          if (['pending', 'checking'].includes(item.subtitles.status)) stats.subtitlePending += 1;
          else if (item.subtitles.status === 'failed') stats.subtitleFailed += 1;
          else if (item.subtitles.status === 'complete') stats.subtitleComplete += 1;
          else if (item.subtitles.status === 'unavailable') stats.subtitleUnavailable += 1;
        }
      }

      const libraryState = this.state.libraries[playlist.folderName] || {};
      stats.lastDiscoveryAt = libraryState.lastDiscoveryAt || null;
      stats.dirtyForScan = Boolean(libraryState.dirty);
      stats.lastIdleActionAt = libraryState.lastIdleActionAt || null;
      stats.lastIdleActionError = libraryState.lastIdleActionError || null;
      stats.subtitleBackfill = libraryState.subtitleBackfill ? clone(libraryState.subtitleBackfill) : null;
      result[playlist.folderName] = stats;
      result[playlist.name] = stats;
    }

    return result;
  }

  async prepareMovieMetadata(libraryFolder) {
    const folder = sanitizeName(libraryFolder);
    const playlist = findPlaylistByFolder(this.config, folder);
    if (!playlist) throw new Error('Biblioteca nao encontrada na configuracao.');
    const settings = getMovieMetadataSettings(playlist);
    if (!settings.enabled) {
      throw new Error('Ative "Metadados para ErsatzTV (Filmes)" nesta biblioteca e salve a configuracao antes de preparar os arquivos existentes.');
    }

    if (this.current) {
      const currentItem = this.state.items[this.current.itemId];
      if (currentItem && currentItem.libraryFolder === folder) {
        throw new Error('Aguarde o processamento atual desta biblioteca terminar antes de reorganizar os metadados.');
      }
    }

    const libraryDir = path.join(this.config.paths.baseDir, folder);
    const summary = {
      playlist: folder,
      checked: 0,
      reorganized: 0,
      nfoWritten: 0,
      postersMoved: 0,
      postersDownloaded: 0,
      alreadyOrganized: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      scan: null
    };
    const libraryState = this.ensureLibraryState(folder);
    const preExistingDirty = Boolean(libraryState.dirty);

    for (const item of Object.values(this.state.items)) {
      if (item.libraryFolder !== folder || item.status !== 'completed' || item.orphaned) continue;
      summary.checked += 1;
      try {
        if (!item.targetPath || !isPathInside(libraryDir, item.targetPath)) {
          throw new Error('Caminho do video ausente ou fora da biblioteca.');
        }

        const sourceMedia = path.resolve(item.targetPath);
        const sourceBaseName = path.parse(sourceMedia).name;
        const sourceDir = path.dirname(sourceMedia);
        const alreadyOrganized = path.basename(sourceDir) === sourceBaseName;
        const movieDir = alreadyOrganized ? sourceDir : path.join(sourceDir, sourceBaseName);
        const targetMedia = alreadyOrganized ? sourceMedia : path.join(movieDir, path.basename(sourceMedia));
        const sourceExists = await pathExists(sourceMedia);
        const targetExists = sourceMedia === targetMedia ? sourceExists : await pathExists(targetMedia);

        if (!sourceExists && !targetExists) {
          throw new Error('Arquivo de video concluido nao foi encontrado no disco.');
        }
        if (!alreadyOrganized && sourceExists && targetExists) {
          throw new Error(`Conflito: o destino ja existe (${targetMedia}).`);
        }

        const subtitlePaths = !alreadyOrganized && sourceExists
          ? await listSubtitleSidecars(sourceMedia)
          : [];
        await fs.mkdir(movieDir, { recursive: true });

        if (!alreadyOrganized) {
          if (sourceExists) await moveAcrossFileSystems(sourceMedia, targetMedia);
          for (const subtitlePath of subtitlePaths) {
            const subtitleTarget = path.join(movieDir, path.basename(subtitlePath));
            if (await pathExists(subtitleTarget)) await fs.rm(subtitlePath, { force: true });
            else await moveAcrossFileSystems(subtitlePath, subtitleTarget);
          }
          summary.reorganized += 1;
        } else {
          summary.alreadyOrganized += 1;
        }

        const posterPath = path.join(movieDir, 'poster.jpg');
        const legacyThumbnail = item.thumbnailPath
          ? path.resolve(item.thumbnailPath)
          : path.join(sourceDir, `${sourceBaseName}.jpg`);
        if (legacyThumbnail !== path.resolve(posterPath) && await pathExists(legacyThumbnail)) {
          if (await pathExists(posterPath)) await fs.rm(legacyThumbnail, { force: true });
          else await moveAcrossFileSystems(legacyThumbnail, posterPath);
          summary.postersMoved += 1;
        }

        if (!(await pathExists(posterPath)) && item.thumbnailUrl) {
          const tempPoster = `${posterPath}.tmp-${process.pid}-${Date.now()}`;
          try {
            await downloadRemoteFile(item.thumbnailUrl, tempPoster, 30000);
            await moveAcrossFileSystems(tempPoster, posterPath);
            summary.postersDownloaded += 1;
          } finally {
            await fs.rm(tempPoster, { force: true }).catch(() => {});
          }
        }

        const nfoPath = path.join(movieDir, `${sourceBaseName}.nfo`);
        const oldNfoPath = item.nfoPath ? path.resolve(item.nfoPath) : null;
        await writeMovieNfo(item, nfoPath);
        if (oldNfoPath && oldNfoPath !== path.resolve(nfoPath) && await pathExists(oldNfoPath)) {
          await fs.rm(oldNfoPath, { force: true });
        }
        summary.nfoWritten += 1;

        const metadata = getMovieMetadata(item);
        item.targetPath = targetMedia;
        item.mediaPath = targetMedia;
        item.thumbnailPath = posterPath;
        item.nfoPath = nfoPath;
        item.mediaLayout = 'movie-folder';
        item.movieMetadata = {
          status: 'complete',
          artist: metadata.artist,
          title: metadata.trackTitle,
          nfoPath,
          posterPath,
          updatedAt: nowIso(),
          lastError: null
        };
        item.updatedAt = nowIso();
      } catch (error) {
        summary.failed += 1;
        if (summary.failures.length < 20) {
          summary.failures.push({ videoId: item.videoId, title: item.title, error: error.message });
        }
        item.movieMetadata = {
          ...(item.movieMetadata && typeof item.movieMetadata === 'object' ? item.movieMetadata : {}),
          status: 'failed',
          updatedAt: nowIso(),
          lastError: error.message
        };
        await logger.warn(`Falha ao preparar NFO/poster de ${item.videoId}: ${error.message}`);
      }
    }

    const changed = summary.reorganized + summary.nfoWritten + summary.postersMoved + summary.postersDownloaded;
    if (changed > 0) {
      libraryState.dirty = true;
      if (playlist.libraryId) {
        summary.scan = await runLibraryAction(this.config, playlist, 'scan');
        if (summary.scan && summary.scan.ok && !preExistingDirty) libraryState.dirty = false;
      }
    }
    libraryState.lastMovieMetadataAt = nowIso();
    libraryState.lastMovieMetadataSummary = summary;
    await this.saveNow();
    await logger.info(`Preparacao de metadados de Filmes concluida para ${folder}.`, summary);
    return summary;
  }

  previewOrphans(libraryFolder) {
    const folder = sanitizeName(libraryFolder);
    const items = Object.values(this.state.items).filter((item) => item.libraryFolder === folder && item.orphaned);
    return {
      playlist: folder,
      count: items.length,
      filesCount: items.filter((item) => item.targetPath && require('fs').existsSync(item.targetPath)).length,
      totalBytes: items.reduce((total, item) => total + (Number(item.fileSizeBytes) || 0), 0),
      examples: items.slice(0, 20).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        targetPath: item.targetPath,
        fileSizeBytes: item.fileSizeBytes || 0
      }))
    };
  }

  async cleanupOrphans(libraryFolder) {
    const folder = sanitizeName(libraryFolder);
    if (this.current && this.state.items[this.current.itemId] && this.state.items[this.current.itemId].libraryFolder === folder && this.state.items[this.current.itemId].orphaned) {
      throw new Error('Existe um item orfao em download. Cancele-o antes da limpeza.');
    }

    const summary = { playlist: folder, itemsRemoved: 0, videosRemoved: 0, thumbnailsRemoved: 0, subtitlesRemoved: 0, nfoRemoved: 0, bytesRemoved: 0 };
    const idsToDelete = [];
    for (const [id, item] of Object.entries(this.state.items)) {
      if (item.libraryFolder !== folder || !item.orphaned) continue;
      if (item.targetPath && await pathExists(item.targetPath)) {
        const stats = await fs.stat(item.targetPath);
        await fs.rm(item.targetPath, { force: true });
        summary.videosRemoved += 1;
        summary.bytesRemoved += stats.size;
      }
      if (item.thumbnailPath && await pathExists(item.thumbnailPath)) {
        await fs.rm(item.thumbnailPath, { force: true });
        summary.thumbnailsRemoved += 1;
      }
      if (item.targetPath) {
        for (const subtitlePath of await listSubtitleSidecars(item.targetPath)) {
          await fs.rm(subtitlePath, { force: true });
          summary.subtitlesRemoved += 1;
        }
      }
      if (item.nfoPath && await pathExists(item.nfoPath)) {
        await fs.rm(item.nfoPath, { force: true });
        summary.nfoRemoved += 1;
      }
      await fs.rm(this.getWorkDir(item), { recursive: true, force: true });
      idsToDelete.push(id);
      summary.itemsRemoved += 1;
    }
    for (const id of idsToDelete) delete this.state.items[id];

    const playlistDir = path.join(this.config.paths.baseDir, folder);
    if (this.config.cleanup.removeEmptyArtistFolders) {
      await removeEmptyDirectories(playlistDir, playlistDir, logger);
    }
    const libraryState = this.ensureLibraryState(folder);
    libraryState.dirty = true;
    await this.saveNow();
    this.kick();
    return summary;
  }

  async refreshThumbnails(libraryFolder) {
    const folder = sanitizeName(libraryFolder);
    const summary = { playlist: folder, checked: 0, created: 0, updated: 0, skipped: 0, failed: 0 };

    for (const item of Object.values(this.state.items)) {
      if (item.libraryFolder !== folder || item.status !== 'completed') continue;
      summary.checked += 1;
      if (!item.thumbnailUrl) {
        summary.skipped += 1;
        continue;
      }
      const exists = await pathExists(item.thumbnailPath);
      if (exists && !this.config.downloads.updateExistingThumbnails) {
        summary.skipped += 1;
        continue;
      }
      try {
        const temp = `${item.thumbnailPath}.tmp-${process.pid}`;
        await fs.mkdir(path.dirname(item.thumbnailPath), { recursive: true });
        await downloadRemoteFile(item.thumbnailUrl, temp, 30000);
        await fs.rm(item.thumbnailPath, { force: true });
        await fs.rename(temp, item.thumbnailPath);
        if (exists) summary.updated += 1;
        else summary.created += 1;
      } catch (error) {
        summary.failed += 1;
        await logger.warn(`Falha ao atualizar thumbnail de ${item.videoId}: ${error.message}`);
      }
    }

    return summary;
  }

  async deleteLibraryData(config, playlistInput) {
    const playlist = normalizePlaylist(playlistInput);
    const libraryFolder = playlist.folderName;
    const libraryDir = path.join(config.paths.baseDir, libraryFolder);
    if (!isPathInside(config.paths.baseDir, libraryDir)) throw new Error('Caminho da biblioteca fora da pasta base.');

    if (this.current) {
      const currentItem = this.state.items[this.current.itemId];
      if (currentItem && currentItem.libraryFolder === libraryFolder) {
        this.current.cancelRequested = true;
        killProcessTree(this.current.child);
        await Promise.race([
          this.currentPromise ? this.currentPromise.catch(() => {}) : Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, 8000))
        ]);
      }
    }

    const ids = Object.values(this.state.items)
      .filter((item) => item.libraryFolder === libraryFolder)
      .map((item) => item.id);
    for (const id of ids) delete this.state.items[id];
    delete this.state.libraries[libraryFolder];

    await fs.rm(libraryDir, { recursive: true, force: true });
    await fs.rm(path.join(config.paths.baseDir, '.youtube-downloader-work', libraryFolder), { recursive: true, force: true });
    await this.saveNow();
    return { playlist: libraryFolder, itemsRemoved: ids.length, directoryRemoved: libraryDir };
  }

  async saveNow() {
    if (!this.initialized && this.state.version !== STATE_VERSION) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.state.updatedAt = nowIso();
    const snapshot = clone(this.state);
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(() => atomicWriteJson(this.statePath, snapshot));
    await this.saveChain;
  }

  saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow().catch((error) => logger.error(`Falha ao persistir progresso da fila: ${error.message}`));
    }, PROGRESS_SAVE_DELAY_MS);
    this.saveTimer.unref();
  }
}

const manager = new DownloadManager();

module.exports = manager;
module.exports.DownloadManager = DownloadManager;
module.exports.STATE_PATH = STATE_PATH;
module.exports.makeItemId = makeItemId;
module.exports.buildFormatSelector = buildFormatSelector;
module.exports.buildDownloadArgs = buildDownloadArgs;
module.exports.parseProgressLine = parseProgressLine;
module.exports.findPlaylistByFolder = findPlaylistByFolder;
module.exports.getEffectiveMaxHeight = getEffectiveMaxHeight;
