const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT_DIR } = require('./config');
const { STATE_VERSION, normalizeSubtitleState, createDefaultState, normalizeState, atomicWriteJson } = require('./download/queueState');
const { getDiskStats, moveAcrossFileSystems, downloadRemoteFile } = require('./download/storageUtils');
const { findNextRunnableItem: selectNextRunnableItem, findNextSubtitleRunnableItem: selectNextSubtitleRunnableItem } = require('./download/workerSelector');
const {
  DESTINATION_TYPES,
  libraryDestination,
  findDestinationById,
  getAllDestinations
} = require('./destinationService');
const logger = require('./logger');
const { runCommand, killProcessTree } = require('./processUtils');
const { scanOnIdle, runLibraryAction } = require('./ersatztvService');
const {
  getSubtitleSettings,
  findExistingSubtitleLanguages,
  buildSubtitleDownloadArgs,
  finalizeStagedSubtitles
} = require('./subtitleService');
const {
  MEDIA_PROFILES,
  getMediaProfileSettings,
  resolveMediaIdentity,
  getGenericMetadata,
  getMovieMetadata,
  getMusicClipMetadata,
  writeGenericNfo,
  writeMovieNfo,
  writeTvShowNfo,
  writeEpisodeNfo
} = require('./mediaProfileService');
const {
  normalizeDateOnly,
  releaseMetadataFromVideo,
  mergeReleaseMetadata
} = require('./releaseMetadataUtils');
const {
  ORPHAN_POLICIES,
  USER_DISPOSITIONS,
  STORAGE_STATES,
  normalizeOrphanPolicy
} = require('./orphans/orphanPolicy');
const {
  moveItemToQuarantine,
  restoreItemFromQuarantine,
  deleteQuarantinedFiles,
  deleteActivePackage,
  getQuarantineRoot
} = require('./orphans/quarantineService');
const { sweepExpiredQuarantine } = require('./orphans/orphanMaintenance');
const { fetchReleaseMetadataForItems } = require('./discovery/releaseMetadataService');
const { getUrls } = require('./discovery/youtubeSourceProvider');
const { buildYtDlpCommonArgs } = require('./ytDlpUtils');
const {
  getEffectiveMaxHeight,
  buildDownloadArgs,
  parseProgressLine,
  parseFileLine,
  isSubtitleUnavailableOutput,
  attachLineReader,
  appendTail
} = require('./download/ytDlpDownload');
const {
  sanitizeName,
  sanitizeFileComponent,
  normalizeArtistDisplayName,
  extractArtistAndTitle,
  findCaseInsensitiveDirectoryName,
  pathExists,
  removeEmptyDirectories,
  isPathInside
} = require('./utils');

const STATE_PATH = path.join(ROOT_DIR, 'data', 'download-state.json');
const TICK_INTERVAL_MS = 1000;
const PROGRESS_SAVE_DELAY_MS = 1500;
const STORAGE_REFRESH_MS = 30000;
const RETRY_IDLE_ACTION_MS = 5 * 60 * 1000;
const ORPHAN_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function addSpecialItemStats(stats, item) {
  const disposition = item.userDisposition || USER_DISPOSITIONS.MANAGED;
  const storage = item.storageState || (item.targetPath ? STORAGE_STATES.ACTIVE : STORAGE_STATES.ABSENT);
  if (disposition === USER_DISPOSITIONS.IGNORED) stats.ignored = (stats.ignored || 0) + 1;
  if (storage === STORAGE_STATES.QUARANTINED && disposition !== USER_DISPOSITIONS.IGNORED) stats.quarantined = (stats.quarantined || 0) + 1;
  if (item.sourceActive === false && disposition === USER_DISPOSITIONS.KEEP && storage === STORAGE_STATES.ACTIVE) {
    stats.keptOutsideSource = (stats.keptOutsideSource || 0) + 1;
  }
  if (item.sourceActive === false && disposition === USER_DISPOSITIONS.MANAGED && storage === STORAGE_STATES.ACTIVE && item.status !== 'orphaned') {
    stats.orphaned = (stats.orphaned || 0) + 1;
  }
}

function makeItemId(destinationId, videoId) {
  return `${destinationId}::${videoId}`;
}

function getAssignedShowEpisodeNumber(state, destinationId, artist, itemId) {
  const current = state && state.items ? state.items[itemId] : null;
  const currentNumber = Number(current && (current.showEpisodeNumber || current.mediaMetadata && current.mediaMetadata.episodeNumber));
  if (Number.isInteger(currentNumber) && currentNumber > 0) return currentNumber;

  const artistKey = normalizeArtistDisplayName(artist).toLocaleLowerCase('pt-BR');
  let maxEpisode = 0;
  for (const existing of Object.values(state && state.items || {})) {
    if (!existing || existing.id === itemId || (existing.destinationId || existing.libraryFolder) !== destinationId) continue;
    const existingArtist = normalizeArtistDisplayName(
      existing.artist || resolveMediaIdentity(existing).artist
    );
    if (existingArtist.toLocaleLowerCase('pt-BR') !== artistKey) continue;
    const episodeNumber = Number(existing.showEpisodeNumber || existing.mediaMetadata && existing.mediaMetadata.episodeNumber);
    if (Number.isInteger(episodeNumber) && episodeNumber > maxEpisode) maxEpisode = episodeNumber;
  }
  return maxEpisode + 1;
}


function normalizePlaylist(playlist) {
  const urls = getUrls(playlist);
  return {
    ...playlist,
    url: urls[0] || '',
    urls,
    folderName: sanitizeName(playlist && playlist.name)
  };
}

function findPlaylistByFolder(config, libraryFolder) {
  const target = String(libraryFolder || '').trim();
  const destination = findDestinationById(config, target, { includeDisabled: true });
  if (destination) return destination;
  const normalizedTarget = sanitizeName(target);
  const raw = (config.playlists || []).map(normalizePlaylist).find((playlist) => playlist.folderName === normalizedTarget || playlist.name === target);
  return raw ? libraryDestination(config, raw) : null;
}


function resolveDestinationId(config, value) {
  const raw = decodeURIComponent(String(value || '').trim());
  if (!raw) return '';
  return findDestinationById(config, raw, { includeDisabled: true }) ? raw : sanitizeName(raw);
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
    this.lastOrphanMaintenanceAtMs = 0;
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
    await this.runOrphanMaintenance({ force: true });
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

      await this.runOrphanMaintenance();

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
    return selectNextRunnableItem(this.state, getAllDestinations(this.config));
  }

  findNextSubtitleRunnableItem() {
    const item = selectNextSubtitleRunnableItem(this.state, getAllDestinations(this.config, { includeDisabled: true }));
    if (item) item.subtitles = normalizeSubtitleState(item.subtitles);
    return item;
  }

  getDestinationItems(destinationId) {
    const id = String(destinationId || '').trim();
    return Object.values(this.state.items).filter((item) => (item.destinationId || item.libraryFolder) === id);
  }

  async runOrphanMaintenance(options = {}) {
    const now = Date.now();
    if (!options.force && now - this.lastOrphanMaintenanceAtMs < ORPHAN_MAINTENANCE_INTERVAL_MS) {
      return { skipped: true };
    }
    this.lastOrphanMaintenanceAtMs = now;
    const summary = await sweepExpiredQuarantine(this.state);
    if (summary.expired > 0 || summary.recordsRemoved > 0) {
      await logger.info('Manutencao da quarentena concluida.', summary);
      await this.saveNow();
    }
    return summary;
  }

  async probeVideoAvailable(item) {
    const url = String(item && (item.url || (item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : '')) || '').trim();
    if (!url) return { ok: false, error: 'URL do video nao esta disponivel no estado.' };
    const source = findPlaylistByFolder(this.config, item.destinationId || item.libraryFolder);
    const args = [...buildYtDlpCommonArgs(this.config, source), '--skip-download', '--no-playlist', '--print', '%(id)s', url];
    try {
      const result = await runCommand(this.config.paths.ytDlpPath, args, { timeoutMs: 60 * 1000 });
      if (result.code === 0 && String(result.stdout || '').trim()) return { ok: true };
      return { ok: false, error: String(result.stderr || '').trim() || `yt-dlp terminou com codigo ${result.code}` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
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
    const playlist = findPlaylistByFolder(this.config, item.destinationId || item.libraryFolder);
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
    const folder = resolveDestinationId(this.config, libraryFolder);
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
    const destination = findPlaylistByFolder(this.config, item.destinationId || item.libraryFolder);
    const workRoot = destination && destination.workRootPath
      ? destination.workRootPath
      : path.join(this.config.paths.baseDir, '.youtube-downloader-work', item.libraryFolder);
    return path.join(workRoot, item.videoId);
  }

  async processItem(item) {
    const playlist = findPlaylistByFolder(this.config, item.destinationId || item.libraryFolder);
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
      const deferredOrphanAction = await this.applyDeferredOrphanPolicy(item, playlist);
      if (!deferredOrphanAction.applied) {
        try {
          await this.scheduleSubtitlesForItem(item, playlist, { resetAttempts: true });
          await this.saveNow();
        } catch (error) {
          await logger.warn(`Video concluido, mas a preparacao das legendas falhou: ${item.title} (${item.videoId}): ${error.message}`);
        }
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

  async ensureReleaseMetadata(item, source) {
    if (normalizeDateOnly(item && (item.releaseDate || item.publishedAt || item.uploadDate))) return item;
    try {
      const result = await fetchReleaseMetadataForItems(this.config, source || {}, [item]);
      const fetched = result.byVideoId.get(String(item.videoId));
      if (fetched) Object.assign(item, mergeReleaseMetadata(item, fetched));
      if (!fetched && result.failed.length > 0) {
        await logger.warn(`Data de publicacao nao encontrada para ${item.title} (${item.videoId}); NFO sera salvo sem data.`);
      }
    } catch (error) {
      await logger.warn(`Falha ao enriquecer data de publicacao de ${item.title} (${item.videoId}): ${error.message}`);
    }
    return item;
  }

  async finalizeDownload(item, stagedMedia, workDir) {
    const playlist = findPlaylistByFolder(this.config, item.destinationId || item.libraryFolder);
    const profileSettings = getMediaProfileSettings(playlist);
    await this.ensureReleaseMetadata(item, playlist);


    await fs.mkdir(path.dirname(item.targetPath), { recursive: true });
    if (await pathExists(item.targetPath)) {
      await fs.rm(stagedMedia, { force: true });
    } else {
      await moveAcrossFileSystems(stagedMedia, item.targetPath);
    }

    const stagedThumbnail = await this.findStagedThumbnail(workDir);
    const forceArtwork = profileSettings.movie || profileSettings.musicClips;
    if (this.config.downloads.writeThumbnails !== false || forceArtwork) {
      const artworkMissing = !(await pathExists(item.thumbnailPath));
      if (artworkMissing && stagedThumbnail) {
        await moveAcrossFileSystems(stagedThumbnail, item.thumbnailPath);
      } else if (artworkMissing && item.thumbnailUrl) {
        const tempThumbnail = path.join(workDir, 'remote-thumbnail.jpg');
        try {
          await downloadRemoteFile(item.thumbnailUrl, tempThumbnail, 30000);
          await moveAcrossFileSystems(tempThumbnail, item.thumbnailPath);
        } catch (error) {
          await logger.warn(`Video concluido, mas a thumbnail de ${item.videoId} nao pôde ser salva: ${error.message}`);
        }
      }
    }

    item.mediaProfile = profileSettings.profile;

    try {
      if (profileSettings.musicClips) {
        const baseName = path.parse(item.targetPath).name;
        const seasonDir = path.dirname(item.targetPath);
        const showDir = path.dirname(seasonDir);
        item.nfoPath = item.nfoPath || path.join(seasonDir, `${baseName}.nfo`);
        item.showNfoPath = item.showNfoPath || path.join(showDir, 'tvshow.nfo');
        item.showPosterPath = item.showPosterPath || path.join(showDir, 'poster.jpg');
        item.mediaLayout = 'show-season';

        await writeTvShowNfo(item, item.showNfoPath);
        await writeEpisodeNfo(item, item.nfoPath);
        if (!(await pathExists(item.showPosterPath)) && await pathExists(item.thumbnailPath)) {
          await fs.copyFile(item.thumbnailPath, item.showPosterPath);
        }

        const metadata = getMusicClipMetadata(item);
        item.mediaMetadata = {
          status: 'complete',
          profile: profileSettings.profile,
          artist: metadata.artist,
          title: metadata.trackTitle,
          seasonNumber: metadata.seasonNumber,
          episodeNumber: metadata.episodeNumber,
          releaseDate: metadata.releaseDate,
          year: metadata.year,
          nfoPath: item.nfoPath,
          showNfoPath: item.showNfoPath,
          artworkPath: item.thumbnailPath,
          showPosterPath: item.showPosterPath,
          updatedAt: nowIso(),
          lastError: null
        };
      } else if (profileSettings.movie) {
        const baseName = path.parse(item.targetPath).name;
        item.nfoPath = item.nfoPath || path.join(path.dirname(item.targetPath), `${baseName}.nfo`);
        item.showNfoPath = null;
        item.showPosterPath = null;
        item.mediaLayout = 'movie-folder';

        await writeMovieNfo(item, item.nfoPath);
        const metadata = getMovieMetadata(item);
        item.mediaMetadata = {
          status: 'complete',
          profile: profileSettings.profile,
          artist: metadata.artist,
          title: metadata.trackTitle,
          releaseDate: metadata.releaseDate,
          year: metadata.year,
          nfoPath: item.nfoPath,
          artworkPath: item.thumbnailPath,
          updatedAt: nowIso(),
          lastError: null
        };
      } else {
        const baseName = path.parse(item.targetPath).name;
        item.nfoPath = item.nfoPath || path.join(path.dirname(item.targetPath), `${baseName}.nfo`);
        item.showNfoPath = null;
        item.showPosterPath = null;
        item.mediaLayout = 'generic-flat';

        await writeGenericNfo(item, item.nfoPath);
        const metadata = getGenericMetadata(item);
        item.mediaMetadata = {
          status: 'complete',
          profile: profileSettings.profile,
          title: metadata.title,
          releaseDate: metadata.releaseDate,
          year: metadata.year,
          nfoPath: item.nfoPath,
          artworkPath: item.thumbnailPath,
          updatedAt: nowIso(),
          lastError: null
        };
      }
    } catch (error) {
      item.mediaMetadata = {
        status: 'failed',
        profile: profileSettings.profile,
        nfoPath: item.nfoPath || null,
        showNfoPath: item.showNfoPath || null,
        artworkPath: item.thumbnailPath || null,
        showPosterPath: item.showPosterPath || null,
        updatedAt: nowIso(),
        lastError: error.message
      };
      await logger.warn(`Video concluido, mas os metadados ${profileSettings.profile} de ${item.videoId} nao puderam ser salvos: ${error.message}`);
    }

    const stats = await fs.stat(item.targetPath);
    item.status = 'completed';
    item.phase = null;
    item.completedAt = nowIso();
    item.updatedAt = item.completedAt;
    item.mediaPath = item.targetPath;
    item.storageState = STORAGE_STATES.ACTIVE;
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
    item.storageState = STORAGE_STATES.ACTIVE;
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

        if (!this.config.downloads.scanOnQueueIdle) {
          libraryState.dirty = false;
          libraryState.lastIdleActionError = null;
          continue;
        }

        if (!playlist.libraryId) {
          if (playlist.type === DESTINATION_TYPES.LIBRARY) {
            libraryState.dirty = true;
            libraryState.lastIdleActionError = 'Library ID nao configurado; os arquivos aguardam o scan automatico.';
            this.nextIdleActionAtMs = Date.now() + RETRY_IDLE_ACTION_MS;
          } else {
            libraryState.dirty = false;
            libraryState.lastIdleActionError = null;
          }
          continue;
        }

        try {
          const result = await scanOnIdle(this.config, playlist);
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

    const roots = [...new Set([
      this.config.paths.baseDir,
      this.config.paths.channelsBaseDir
    ].map((value) => String(value || '').trim()).filter(Boolean))];
    const minBytes = Math.max(1, Number(this.config.downloads.minFreeSpaceGb) || 20) * 1024 ** 3;
    const volumes = [];

    for (const rootPath of roots) {
      try {
        await fs.mkdir(rootPath, { recursive: true });
        const stats = await getDiskStats(rootPath);
        volumes.push({ ...stats, minFreeBytes: minBytes, low: stats.availableBytes < minBytes });
      } catch (error) {
        volumes.push({
          path: rootPath, totalBytes: 0, freeBytes: 0, availableBytes: 0, usedBytes: 0,
          minFreeBytes: minBytes, low: false, checkedAt: nowIso(), error: error.message
        });
      }
    }

    const healthy = volumes.filter((entry) => !entry.error);
    const limiting = healthy.slice().sort((a, b) => a.availableBytes - b.availableBytes)[0] || volumes[0] || null;
    this.storage = limiting ? {
      ...limiting,
      low: healthy.some((entry) => entry.low),
      volumes
    } : null;
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
    const playlistDir = playlist.rootPath || path.join(this.config.paths.baseDir, playlist.folderName);
    const profileSettings = getMediaProfileSettings(playlist);
    const extracted = extractArtistAndTitle(video.title || 'Sem Titulo');
    const identity = profileSettings.musicClips
      ? resolveMediaIdentity({
        ...video,
        artist: extracted.artist,
        trackTitle: extracted.title
      })
      : {
        artist: normalizeArtistDisplayName(extracted.artist),
        trackTitle: extracted.title
      };
    let artist = identity.artist;
    const title = identity.trackTitle;

    // Usa um unico nome canonico para o artista dentro da biblioteca, ignorando
    // diferencas apenas de maiusculas/minusculas vindas do YouTube.
    const artistKey = artist.toLocaleLowerCase('pt-BR');
    for (const existing of Object.values(this.state.items)) {
      if (existing.id === itemId || (existing.destinationId || existing.libraryFolder) !== (playlist.id || playlist.folderName) || !existing.artist) continue;
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

    const showSeasonNumber = profileSettings.musicClips ? profileSettings.seasonNumber : null;
    const showEpisodeNumber = profileSettings.musicClips
      ? getAssignedShowEpisodeNumber(this.state, playlist.id || playlist.folderName, artist, itemId)
      : null;
    const seasonLabel = profileSettings.musicClips ? String(showSeasonNumber).padStart(2, '0') : '';
    const episodeLabel = profileSettings.musicClips ? String(showEpisodeNumber).padStart(2, '0') : '';

    const preferredBase = profileSettings.musicClips
      ? sanitizeFileComponent(
        `${artist} - S${seasonLabel}E${episodeLabel} - ${title}`,
        `Video ${video.id}`,
        220
      )
      : (artist !== 'Outros'
        ? sanitizeFileComponent(`${artist} - ${title}`, `Video ${video.id}`, 220)
        : sanitizeFileComponent(title, `Video ${video.id}`, 220));

    const usedPaths = new Map();
    for (const existing of Object.values(this.state.items)) {
      if (existing.targetPath) usedPaths.set(path.resolve(existing.targetPath), existing.id);
    }

    let baseName = preferredBase;
    const seasonDir = profileSettings.musicClips
      ? path.join(artistDir, `Season ${seasonLabel}`)
      : artistDir;
    const buildTargetPath = () => {
      if (profileSettings.movie) return path.join(artistDir, baseName, `${baseName}.mp4`);
      return path.join(seasonDir, `${baseName}.mp4`);
    };
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
    const thumbnailPath = profileSettings.musicClips
      ? path.join(targetDir, `${baseName}-thumb.jpg`)
      : profileSettings.movie
        ? path.join(targetDir, 'poster.jpg')
        : path.join(artistDir, `${baseName}.jpg`);

    return {
      artist,
      trackTitle: title,
      targetPath,
      thumbnailPath,
      nfoPath: path.join(targetDir, `${baseName}.nfo`),
      showNfoPath: profileSettings.musicClips ? path.join(artistDir, 'tvshow.nfo') : null,
      showPosterPath: profileSettings.musicClips ? path.join(artistDir, 'poster.jpg') : null,
      showSeasonNumber,
      showEpisodeNumber,
      mediaProfile: profileSettings.profile,
      mediaLayout: profileSettings.musicClips
        ? 'show-season'
        : (profileSettings.movie ? 'movie-folder' : 'generic-flat')
    };
  }

  async reconcileDestination(config, destinationInput, videos, reconcileOptions = {}) {
    await this.init(config);
    this.configure(config);
    const destination = destinationInput && destinationInput.id && destinationInput.rootPath
      ? destinationInput
      : libraryDestination(config, normalizePlaylist(destinationInput));
    if (!destination || !destination.id || !destination.rootPath) throw new Error('Destino invalido.');

    const destinationId = destination.id;
    const authoritative = reconcileOptions.authoritative !== false;
    const partialReasons = Array.isArray(reconcileOptions.partialReasons) ? reconcileOptions.partialReasons : [];
    const discoveredIds = new Set();
    const summary = {
      destinationId,
      destinationType: destination.type,
      library: destination.folderName,
      authoritative,
      partialReasons,
      discovered: 0,
      queued: 0,
      alreadyCompleted: 0,
      alreadyKnown: 0,
      reactivated: 0,
      restoredFromQuarantine: 0,
      restoreFailed: 0,
      orphaned: 0,
      quarantined: 0,
      deleted: 0,
      destructiveDeferred: 0,
      skipped: 0
    };

    await fs.mkdir(destination.rootPath, { recursive: true });

    for (const video of videos || []) {
      const videoId = String(video && video.id || '').trim();
      if (!videoId) {
        summary.skipped += 1;
        continue;
      }

      discoveredIds.add(videoId);
      summary.discovered += 1;
      const id = makeItemId(destinationId, videoId);
      const existing = this.state.items[id];
      const releaseMetadata = mergeReleaseMetadata(existing, releaseMetadataFromVideo(video));
      const metadata = {
        title: String(video.title || existing && existing.title || `Video ${videoId}`).trim(),
        description: String(video.description || existing && existing.description || ''),
        durationSeconds: Number(video.duration) || existing && existing.durationSeconds || null,
        publishedAt: releaseMetadata.publishedAt,
        uploadDate: releaseMetadata.uploadDate,
        releaseDate: releaseMetadata.releaseDate,
        releaseDateSource: releaseMetadata.releaseDateSource,
        year: releaseMetadata.year,
        thumbnailUrl: String(video.thumbnailUrl || video.thumbnail || existing && existing.thumbnailUrl || '').trim(),
        channelTitle: String(video.channelTitle || existing && existing.channelTitle || '').trim(),
        url: String(video.webpage_url || video.url || `https://www.youtube.com/watch?v=${videoId}`).trim(),
        sourceUrl: String(video.sourceUrl || existing && existing.sourceUrl || '').trim(),
        sourceIndex: Number.isFinite(Number(video.sourceIndex)) ? Number(video.sourceIndex) : (existing && existing.sourceIndex != null ? existing.sourceIndex : null),
        sourceKind: String(video.sourceKind || destination.sourceKind || '').trim(),
        maxHeight: getEffectiveMaxHeight(config, destination)
      };

      const destinationFields = {
        libraryName: destination.displayName,
        libraryFolder: destinationId,
        destinationId,
        destinationType: destination.type,
        channelId: destination.channelId || null,
        playlistId: destination.playlistId || null,
        targetRoot: destination.rootPath,
        workRootPath: destination.workRootPath,
        videoId
      };

      if (existing) {
        const wasSourceActive = existing.sourceActive !== false;
        const wasOrphaned = existing.orphaned || existing.sourceActive === false || existing.status === 'orphaned';
        Object.assign(existing, metadata, destinationFields, {
          sourceActive: true,
          orphaned: false,
          orphanedAt: null,
          lastSeenAt: nowIso(),
          updatedAt: nowIso()
        });
        delete existing.orphanPolicyPending;
        existing.userDisposition = existing.userDisposition || USER_DISPOSITIONS.MANAGED;
        existing.storageState = existing.storageState || (existing.targetPath && await pathExists(existing.targetPath) ? STORAGE_STATES.ACTIVE : STORAGE_STATES.ABSENT);

        if (existing.userDisposition === USER_DISPOSITIONS.IGNORED) {
          summary.alreadyKnown += 1;
          continue;
        }

        if (existing.userDisposition === USER_DISPOSITIONS.KEEP) {
          existing.userDisposition = USER_DISPOSITIONS.MANAGED;
          existing.dispositionUpdatedAt = nowIso();
        }

        if (existing.status === 'removed' && existing.suppressed) {
          summary.alreadyKnown += 1;
          continue;
        }

        if (existing.storageState === STORAGE_STATES.QUARANTINED && existing.quarantine) {
          try {
            await restoreItemFromQuarantine(existing, destination, Object.values(this.state.items));
            existing.status = 'completed';
            existing.suppressed = false;
            existing.attempts = 0;
            existing.nextAttemptAt = null;
            existing.phase = null;
            summary.restoredFromQuarantine += 1;
            summary.reactivated += 1;
            this.ensureLibraryState(destinationId).dirty = true;
          } catch (error) {
            summary.restoreFailed += 1;
            existing.lastError = `Falha ao restaurar automaticamente da quarentena: ${error.message}`;
            await logger.warn(`${existing.lastError} (${existing.videoId})`);
          }
          continue;
        }

        const pathExistsNow = Boolean(existing.targetPath && await pathExists(existing.targetPath));
        if (pathExistsNow) existing.storageState = STORAGE_STATES.ACTIVE;
        else if (existing.storageState === STORAGE_STATES.ACTIVE) existing.storageState = STORAGE_STATES.ABSENT;

        if (!pathExistsNow && !(existing.status === 'removed' && existing.suppressed)) {
          Object.assign(existing, this.chooseTargetPaths(destination, video, id));
          existing.status = 'pending';
          existing.storageState = STORAGE_STATES.ABSENT;
          existing.mediaPath = null;
          existing.fileSizeBytes = 0;
          existing.attempts = 0;
          existing.nextAttemptAt = null;
          existing.phase = null;
          summary.reactivated += 1;
        } else if (existing.status === 'orphaned' || (existing.status === 'removed' && !existing.suppressed)) {
          existing.status = pathExistsNow ? 'completed' : 'pending';
          existing.suppressed = false;
          existing.attempts = 0;
          existing.nextAttemptAt = null;
          existing.phase = null;
          summary.reactivated += 1;
        } else if (existing.status === 'completed') {
          summary.alreadyCompleted += 1;
          if (!wasSourceActive || wasOrphaned) summary.reactivated += 1;
        } else {
          summary.alreadyKnown += 1;
          if (!wasSourceActive || wasOrphaned) summary.reactivated += 1;
        }
        continue;
      }

      const target = this.chooseTargetPaths(destination, video, id);
      const exists = await pathExists(target.targetPath);
      const createdAt = nowIso();
      this.state.items[id] = {
        id,
        ...destinationFields,
        ...metadata,
        ...target,
        status: exists ? 'completed' : 'pending',
        phase: null,
        suppressed: false,
        sourceActive: true,
        orphaned: false,
        orphanedAt: null,
        userDisposition: USER_DISPOSITIONS.MANAGED,
        storageState: exists ? STORAGE_STATES.ACTIVE : STORAGE_STATES.ABSENT,
        dispositionUpdatedAt: null,
        quarantine: null,
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

    if (!authoritative) {
      await logger.warn(`Descoberta parcial em ${destination.displayName}; acoes de orfaos foram preservadas.`, { partialReasons });
    } else {
      const entries = Object.entries(this.state.items);
      for (const [id, item] of entries) {
        if ((item.destinationId || item.libraryFolder) !== destinationId || discoveredIds.has(item.videoId)) continue;

        const wasSourceActive = item.sourceActive !== false;
        item.sourceActive = false;
        item.updatedAt = nowIso();
        item.userDisposition = item.userDisposition || USER_DISPOSITIONS.MANAGED;
        item.storageState = item.storageState || (item.targetPath && await pathExists(item.targetPath) ? STORAGE_STATES.ACTIVE : STORAGE_STATES.ABSENT);

        if (item.userDisposition === USER_DISPOSITIONS.IGNORED) {
          item.orphaned = false;
          item.orphanedAt = null;
          continue;
        }
        if (item.userDisposition === USER_DISPOSITIONS.KEEP) {
          item.orphaned = true;
          item.orphanedAt = item.orphanedAt || nowIso();
          continue;
        }

        item.orphaned = true;
        item.orphanedAt = item.orphanedAt || nowIso();
        if (wasSourceActive) summary.orphaned += 1;

        // A quarantine requested explicitly by the user has precedence over the
        // automatic orphan policy until it is restored, expires or is deleted.
        if (item.storageState === STORAGE_STATES.QUARANTINED && item.quarantine && item.quarantine.reason === 'manual') {
          continue;
        }

        const policy = normalizeOrphanPolicy(destination.orphanPolicy, ORPHAN_POLICIES.MARK);
        const isCurrent = Boolean(this.current && this.current.itemId === id);
        if (isCurrent && policy !== ORPHAN_POLICIES.MARK) {
          item.orphanPolicyPending = policy;
          summary.destructiveDeferred += 1;
          continue;
        }

        if (policy === ORPHAN_POLICIES.DELETE) {
          if (item.storageState === STORAGE_STATES.QUARANTINED) await deleteQuarantinedFiles(item);
          else if (item.storageState === STORAGE_STATES.ACTIVE) await deleteActivePackage(item, destination, Object.values(this.state.items));
          await fs.rm(this.getWorkDir(item), { recursive: true, force: true });
          delete this.state.items[id];
          summary.deleted += 1;
          this.ensureLibraryState(destinationId).dirty = true;
          continue;
        }

        if (policy === ORPHAN_POLICIES.QUARANTINE) {
          if (item.storageState === STORAGE_STATES.ACTIVE && item.targetPath && await pathExists(item.targetPath)) {
            await moveItemToQuarantine(item, destination, Object.values(this.state.items), {
              reason: 'orphan',
              retentionDays: destination.quarantineRetentionDays
            });
            item.status = 'orphaned';
            item.mediaPath = null;
            summary.quarantined += 1;
            this.ensureLibraryState(destinationId).dirty = true;
          } else if (item.storageState === STORAGE_STATES.ABSENT) {
            await fs.rm(this.getWorkDir(item), { recursive: true, force: true });
            delete this.state.items[id];
            summary.deleted += 1;
          }
          continue;
        }

        const keepSuppressedRemoval = item.status === 'removed' && item.suppressed;
        if (!keepSuppressedRemoval && ['pending', 'failed', 'cancelled', 'removed'].includes(item.status)) {
          item.status = 'orphaned';
          item.nextAttemptAt = null;
        }
      }
    }


    const destinationState = this.ensureLibraryState(destinationId);
    destinationState.lastDiscoveryAt = nowIso();
    destinationState.lastDiscoverySummary = summary;
    await this.runOrphanMaintenance({ force: true });
    await this.saveNow();
    this.kick();
    return summary;
  }

  async reconcileLibrary(config, playlistInput, videos, reconcileOptions = {}) {
    const destination = libraryDestination(config, normalizePlaylist(playlistInput));
    return this.reconcileDestination(config, destination, videos, reconcileOptions);
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
    const libraryFolder = requestedLibrary ? resolveDestinationId(this.config, requestedLibrary) : '';
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
      quarantined: 0,
      ignored: 0,
      keptOutsideSource: 0,
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
      addSpecialItemStats(counts, item);
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
    const libraryFilter = resolveDestinationId(this.config || { playlists: [], channels: [] }, options.library || '');
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
        quarantined: 0,
        ignored: 0,
        keptOutsideSource: 0,
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
        addSpecialItemStats(stats, item);
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


  getDestinationStats(config = this.config, destinationId = '') {
    const destination = findDestinationById(config, destinationId, { includeDisabled: true });
    if (!destination) return null;
    const stats = {
      destinationId: destination.id,
      destinationType: destination.type,
      displayName: destination.displayName,
      total: 0,
      pending: 0,
      downloading: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      orphaned: 0,
      quarantined: 0,
      ignored: 0,
      keptOutsideSource: 0,
      removed: 0,
      totalBytes: 0,
      lastDiscoveryAt: null,
      dirtyForScan: false,
      lastIdleActionAt: null,
      lastIdleActionError: null,
      subtitlesEnabled: getSubtitleSettings(destination).enabled,
      subtitlePending: 0,
      subtitleFailed: 0,
      subtitleComplete: 0,
      subtitleUnavailable: 0,
      subtitleBackfill: null
    };
    for (const item of Object.values(this.state.items)) {
      if ((item.destinationId || item.libraryFolder) !== destination.id) continue;
      stats.total += 1;
      if (stats[item.status] !== undefined) stats[item.status] += 1;
      addSpecialItemStats(stats, item);
      stats.totalBytes += Number(item.fileSizeBytes) || 0;
      if (item.subtitles && item.status === 'completed') {
        if (['pending', 'checking'].includes(item.subtitles.status)) stats.subtitlePending += 1;
        else if (item.subtitles.status === 'failed') stats.subtitleFailed += 1;
        else if (item.subtitles.status === 'complete') stats.subtitleComplete += 1;
        else if (item.subtitles.status === 'unavailable') stats.subtitleUnavailable += 1;
      }
    }
    const state = this.state.libraries[destination.id] || {};
    stats.lastDiscoveryAt = state.lastDiscoveryAt || null;
    stats.dirtyForScan = Boolean(state.dirty);
    stats.lastIdleActionAt = state.lastIdleActionAt || null;
    stats.lastIdleActionError = state.lastIdleActionError || null;
    stats.subtitleBackfill = state.subtitleBackfill ? clone(state.subtitleBackfill) : null;
    return stats;
  }

  getChannelStats(config = this.config, channelId = '') {
    const result = {};
    for (const destination of getAllDestinations(config, { includeDisabled: true })) {
      if (destination.channelId !== channelId) continue;
      result[destination.id] = this.getDestinationStats(config, destination.id);
    }
    return result;
  }


  previewOrphans(libraryFolder) {
    const folder = resolveDestinationId(this.config, libraryFolder);
    const destination = findDestinationById(this.config, folder, { includeDisabled: true });
    if (!destination) throw this.notFoundError();
    if (normalizeOrphanPolicy(destination.orphanPolicy, ORPHAN_POLICIES.MARK) !== ORPHAN_POLICIES.MARK) {
      throw new Error('A limpeza manual de orfaos so esta disponivel na politica Marcar como orfao.');
    }
    const items = Object.values(this.state.items).filter((item) => (
      (item.destinationId || item.libraryFolder) === folder &&
      item.sourceActive === false &&
      (item.userDisposition || USER_DISPOSITIONS.MANAGED) === USER_DISPOSITIONS.MANAGED &&
      (item.storageState || STORAGE_STATES.ACTIVE) === STORAGE_STATES.ACTIVE
    ));
    return {
      playlist: folder,
      count: items.length,
      filesCount: items.filter((item) => item.targetPath && require('fs').existsSync(item.targetPath)).length,
      totalBytes: items.reduce((total, item) => total + (Number(item.fileSizeBytes) || 0), 0),
      examples: items.slice(0, 20).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        fileSizeBytes: item.fileSizeBytes || 0
      }))
    };
  }

  async cleanupOrphans(libraryFolder) {
    const folder = resolveDestinationId(this.config, libraryFolder);
    const destination = findDestinationById(this.config, folder, { includeDisabled: true });
    if (!destination) throw this.notFoundError();
    if (normalizeOrphanPolicy(destination.orphanPolicy, ORPHAN_POLICIES.MARK) !== ORPHAN_POLICIES.MARK) {
      throw new Error('A limpeza manual de orfaos so esta disponivel na politica Marcar como orfao.');
    }

    const candidates = this.getDestinationItems(folder).filter((item) => (
      item.sourceActive === false &&
      (item.userDisposition || USER_DISPOSITIONS.MANAGED) === USER_DISPOSITIONS.MANAGED &&
      (item.storageState || STORAGE_STATES.ACTIVE) === STORAGE_STATES.ACTIVE
    ));
    if (this.current && candidates.some((item) => item.id === this.current.itemId)) {
      throw new Error('Existe um item orfao em download. Cancele-o antes da limpeza.');
    }

    const summary = { playlist: folder, itemsRemoved: 0, filesRemoved: 0, bytesRemoved: 0 };
    for (const item of candidates) {
      const removed = await deleteActivePackage(item, destination, Object.values(this.state.items));
      await fs.rm(this.getWorkDir(item), { recursive: true, force: true });
      summary.itemsRemoved += 1;
      summary.filesRemoved += removed.filesRemoved;
      summary.bytesRemoved += removed.bytesRemoved;
      delete this.state.items[item.id];
    }

    if (this.config.cleanup.removeEmptyArtistFolders) {
      await removeEmptyDirectories(destination.rootPath, destination.rootPath, logger);
    }
    const libraryState = this.ensureLibraryState(folder);
    libraryState.dirty = candidates.length > 0 || libraryState.dirty;
    await this.saveNow();
    this.kick();
    return summary;
  }



  getContentActionItems(destinationId, itemIds) {
    const destination = findDestinationById(this.config, destinationId, { includeDisabled: true });
    if (!destination) throw this.notFoundError();
    const requested = [...new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).map((value) => String(value || '').trim()).filter(Boolean))];
    if (requested.length === 0) throw new Error('Selecione pelo menos um item.');
    const items = requested.map((id) => {
      const item = this.state.items[id];
      if (!item || (item.destinationId || item.libraryFolder) !== destination.id) throw this.notFoundError();
      if (this.current && this.current.itemId === id) throw new Error('Aguarde/cancele o processamento atual deste item antes de altera-lo.');
      return item;
    });
    return { destination, items };
  }

  async runContentAction(destinationId, action, itemIds) {
    const { destination, items } = this.getContentActionItems(destinationId, itemIds);
    const summary = { action, destinationId: destination.id, requested: items.length, changed: 0, restored: 0, quarantined: 0, deleted: 0, queued: 0 };

    for (const item of items) {
      item.userDisposition = item.userDisposition || USER_DISPOSITIONS.MANAGED;
      item.storageState = item.storageState || (item.targetPath && await pathExists(item.targetPath) ? STORAGE_STATES.ACTIVE : STORAGE_STATES.ABSENT);

      if (action === 'ignore') {
        if (item.userDisposition === USER_DISPOSITIONS.IGNORED) continue;
        if (item.storageState !== STORAGE_STATES.ACTIVE || !item.targetPath || !(await pathExists(item.targetPath))) {
          throw new Error('Excluir e ignorar exige um arquivo ativo no acervo.');
        }
        const retentionDays = destination.orphanPolicy === ORPHAN_POLICIES.QUARANTINE
          ? destination.quarantineRetentionDays
          : 30;
        await moveItemToQuarantine(item, destination, Object.values(this.state.items), {
          reason: 'manual-ignore',
          retentionDays
        });
        item.userDisposition = USER_DISPOSITIONS.IGNORED;
        item.dispositionUpdatedAt = nowIso();
        item.orphaned = false;
        item.orphanedAt = null;
        item.status = 'removed';
        item.suppressed = false;
        item.nextAttemptAt = null;
        item.updatedAt = nowIso();
        summary.changed += 1;
        summary.quarantined += 1;
        continue;
      }

      if (action === 'restore-keep') {
        if (item.storageState !== STORAGE_STATES.QUARANTINED) throw new Error('O item selecionado nao esta na quarentena.');
        await restoreItemFromQuarantine(item, destination, Object.values(this.state.items));
        item.userDisposition = item.sourceActive === false ? USER_DISPOSITIONS.KEEP : USER_DISPOSITIONS.MANAGED;
        item.dispositionUpdatedAt = nowIso();
        item.orphaned = item.sourceActive === false;
        item.orphanedAt = item.orphaned ? (item.orphanedAt || nowIso()) : null;
        item.status = 'completed';
        item.suppressed = false;
        item.lastError = null;
        item.updatedAt = nowIso();
        summary.changed += 1;
        summary.restored += 1;
        continue;
      }

      if (action === 'quarantine') {
        if (item.sourceActive !== false) throw new Error('Enviar para quarentena esta disponivel para itens mantidos fora da fonte.');
        if (item.storageState !== STORAGE_STATES.ACTIVE) throw new Error('O item selecionado nao possui arquivo ativo para mover.');
        const retentionDays = destination.orphanPolicy === ORPHAN_POLICIES.QUARANTINE
          ? destination.quarantineRetentionDays
          : 30;
        await moveItemToQuarantine(item, destination, Object.values(this.state.items), {
          reason: 'manual',
          retentionDays
        });
        item.userDisposition = USER_DISPOSITIONS.MANAGED;
        item.dispositionUpdatedAt = nowIso();
        item.orphaned = true;
        item.orphanedAt = item.orphanedAt || nowIso();
        item.status = 'orphaned';
        item.updatedAt = nowIso();
        summary.changed += 1;
        summary.quarantined += 1;
        continue;
      }

      if (action === 'delete-permanently') {
        if (item.storageState === STORAGE_STATES.QUARANTINED) {
          await deleteQuarantinedFiles(item);
        } else if (item.storageState === STORAGE_STATES.ACTIVE) {
          await deleteActivePackage(item, destination, Object.values(this.state.items));
        }
        await fs.rm(this.getWorkDir(item), { recursive: true, force: true });
        if (item.userDisposition === USER_DISPOSITIONS.IGNORED) {
          item.storageState = STORAGE_STATES.ABSENT;
          item.quarantine = null;
          item.status = 'removed';
          item.updatedAt = nowIso();
        } else {
          delete this.state.items[item.id];
        }
        summary.changed += 1;
        summary.deleted += 1;
        continue;
      }

      if (action === 'reactivate') {
        if (item.userDisposition !== USER_DISPOSITIONS.IGNORED) throw new Error('Somente itens ignorados podem ser reativados por esta acao.');
        if (item.storageState === STORAGE_STATES.QUARANTINED) {
          await restoreItemFromQuarantine(item, destination, Object.values(this.state.items));
          item.userDisposition = item.sourceActive === false ? USER_DISPOSITIONS.KEEP : USER_DISPOSITIONS.MANAGED;
          item.dispositionUpdatedAt = nowIso();
          item.orphaned = item.sourceActive === false;
          item.orphanedAt = item.orphaned ? nowIso() : null;
          item.status = 'completed';
          item.suppressed = false;
          item.lastError = null;
          item.updatedAt = nowIso();
          summary.restored += 1;
          summary.changed += 1;
            continue;
        }

        if (item.sourceActive === false) {
          const probe = await this.probeVideoAvailable(item);
          if (!probe.ok) throw new Error(`Nao foi possivel reativar ${item.title || item.videoId}: ${probe.error}`);
        }
        if (!item.targetPath) Object.assign(item, this.chooseTargetPaths(destination, { ...item, id: item.videoId, title: item.title }, item.id));
        item.userDisposition = item.sourceActive === false ? USER_DISPOSITIONS.KEEP : USER_DISPOSITIONS.MANAGED;
        item.dispositionUpdatedAt = nowIso();
        item.storageState = STORAGE_STATES.ABSENT;
        item.orphaned = item.sourceActive === false;
        item.orphanedAt = item.orphaned ? nowIso() : null;
        item.status = 'pending';
        item.suppressed = false;
        item.attempts = 0;
        item.nextAttemptAt = null;
        item.lastError = null;
        item.phase = null;
        item.updatedAt = nowIso();
        summary.queued += 1;
        summary.changed += 1;
        continue;
      }

      throw new Error('Acao de conteudo nao suportada.');
    }

    if (summary.changed > 0) this.ensureLibraryState(destination.id).dirty = true;
    if (this.config.cleanup.removeEmptyArtistFolders) {
      await removeEmptyDirectories(destination.rootPath, destination.rootPath, logger).catch(() => {});
    }
    await this.saveNow();
    this.kick();
    return summary;
  }

  async applyDeferredOrphanPolicy(item, destinationInput) {
    const rawPolicy = item && item.orphanPolicyPending;
    if (!rawPolicy) return { applied: false };
    delete item.orphanPolicyPending;

    if (item.sourceActive !== false || (item.userDisposition || USER_DISPOSITIONS.MANAGED) !== USER_DISPOSITIONS.MANAGED) {
      await this.saveNow();
      return { applied: false };
    }

    const destination = destinationInput && destinationInput.id && destinationInput.rootPath
      ? destinationInput
      : findDestinationById(this.config, item.destinationId || item.libraryFolder, { includeDisabled: true });
    if (!destination) {
      await this.saveNow();
      return { applied: false };
    }

    const policy = normalizeOrphanPolicy(rawPolicy, ORPHAN_POLICIES.MARK);
    if (policy === ORPHAN_POLICIES.MARK) {
      item.status = 'orphaned';
      item.orphaned = true;
      item.orphanedAt = item.orphanedAt || nowIso();
      await this.saveNow();
      return { applied: false };
    }

    item.orphaned = true;
    item.orphanedAt = item.orphanedAt || nowIso();
    if (policy === ORPHAN_POLICIES.DELETE) {
      if (item.storageState === STORAGE_STATES.QUARANTINED) await deleteQuarantinedFiles(item);
      else if (item.storageState === STORAGE_STATES.ACTIVE) await deleteActivePackage(item, destination, Object.values(this.state.items));
      await fs.rm(this.getWorkDir(item), { recursive: true, force: true });
      delete this.state.items[item.id];
      this.ensureLibraryState(destination.id).dirty = true;
      await this.saveNow();
      await logger.info(`Politica de orfao aplicada apos concluir download: arquivo excluido (${item.videoId}).`);
      return { applied: true, action: 'delete' };
    }

    if (policy === ORPHAN_POLICIES.QUARANTINE) {
      if (item.storageState === STORAGE_STATES.ACTIVE && item.targetPath && await pathExists(item.targetPath)) {
        await moveItemToQuarantine(item, destination, Object.values(this.state.items), {
          reason: 'orphan',
          retentionDays: destination.quarantineRetentionDays
        });
        item.status = 'orphaned';
        item.updatedAt = nowIso();
        this.ensureLibraryState(destination.id).dirty = true;
        await this.saveNow();
        await logger.info(`Politica de orfao aplicada apos concluir download: item movido para quarentena (${item.videoId}).`);
        return { applied: true, action: 'quarantine' };
      }
      if (item.storageState === STORAGE_STATES.ABSENT) {
        delete this.state.items[item.id];
        await this.saveNow();
        return { applied: true, action: 'delete' };
      }
    }

    await this.saveNow();
    return { applied: false };
  }

  async deleteDestinationData(config, destination) {
    if (!destination || !destination.id || !destination.rootPath) throw new Error('Destino invalido para exclusao.');
    const destinationId = destination.id;
    const destinationDir = destination.rootPath;
    if (!isPathInside(destination.baseRootPath, destinationDir) && path.resolve(destination.baseRootPath) !== path.resolve(destinationDir)) {
      throw new Error('Caminho do destino fora da pasta base.');
    }

    if (this.current) {
      const currentItem = this.state.items[this.current.itemId];
      if (currentItem && (currentItem.destinationId || currentItem.libraryFolder) === destinationId) {
        this.current.cancelRequested = true;
        killProcessTree(this.current.child);
        await Promise.race([
          this.currentPromise ? this.currentPromise.catch(() => {}) : Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, 8000))
        ]);
      }
    }

    const ids = Object.values(this.state.items)
      .filter((item) => (item.destinationId || item.libraryFolder) === destinationId)
      .map((item) => item.id);
    for (const id of ids) delete this.state.items[id];
    delete this.state.libraries[destinationId];

    await fs.rm(destinationDir, { recursive: true, force: true });
    await fs.rm(getQuarantineRoot(destination), { recursive: true, force: true }).catch(() => {});
    if (destination.workRootPath) await fs.rm(destination.workRootPath, { recursive: true, force: true });
    await this.saveNow();
    return { destinationId, itemsRemoved: ids.length, directoryRemoved: destinationDir };
  }

  async deleteChannelData(config, channel) {
    if (!channel || !channel.channelId || !channel.folderName) throw new Error('Canal invalido para exclusao.');
    const channelId = String(channel.channelId);
    const channelRoot = path.join(config.paths.channelsBaseDir, channel.folderName);
    if (!isPathInside(config.paths.channelsBaseDir, channelRoot)) {
      throw new Error('Caminho do canal fora da pasta base de Canais.');
    }

    if (this.current) {
      const currentItem = this.state.items[this.current.itemId];
      if (currentItem && (currentItem.channelId === channelId || String(currentItem.destinationId || '').startsWith(`channel:${channelId}:`))) {
        this.current.cancelRequested = true;
        killProcessTree(this.current.child);
        await Promise.race([
          this.currentPromise ? this.currentPromise.catch(() => {}) : Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, 8000))
        ]);
      }
    }

    const ids = Object.values(this.state.items)
      .filter((item) => item.channelId === channelId || String(item.destinationId || item.libraryFolder || '').startsWith(`channel:${channelId}:`))
      .map((item) => item.id);
    for (const id of ids) delete this.state.items[id];
    for (const key of Object.keys(this.state.libraries)) {
      if (key.startsWith(`channel:${channelId}:`)) delete this.state.libraries[key];
    }

    await fs.rm(channelRoot, { recursive: true, force: true });
    for (const destination of getAllDestinations(config, { includeDisabled: true }).filter((entry) => entry.channelId === channelId)) {
      await fs.rm(getQuarantineRoot(destination), { recursive: true, force: true }).catch(() => {});
    }
    await fs.rm(path.join(config.paths.channelsBaseDir, '.youtube-downloader-work', channelId), { recursive: true, force: true });
    await this.saveNow();
    return { channelId, itemsRemoved: ids.length, directoryRemoved: channelRoot };
  }

  async deleteLibraryData(config, playlistInput) {
    const destination = libraryDestination(config, normalizePlaylist(playlistInput));
    return this.deleteDestinationData(config, destination);
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
module.exports.findPlaylistByFolder = findPlaylistByFolder;
