const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const downloadManager = require('../downloadManager');
const { makeItemId } = require('../downloadManager');
const { getAllDestinations, findDestinationById } = require('../destinationService');
const { getDiskStats, downloadRemoteFile } = require('../download/storageUtils');
const { STORAGE_STATES, USER_DISPOSITIONS } = require('../orphans/orphanPolicy');
const {
  getMediaProfileSettings,
  getGenericMetadata,
  getMovieMetadata,
  getMusicClipMetadata,
  writeGenericNfo,
  writeMovieNfo,
  writeTvShowNfo,
  writeEpisodeNfo
} = require('../mediaProfileService');
const { fetchVideoDetails } = require('../youtubeApi');
const quotaTracker = require('./quotaTracker');
const localCatalog = require('./localCatalogScanner');
const managerState = require('./youtubeManagerState');
const adoptionState = require('./youtubeAdoptionState');
const { isPathInside, pathExists } = require('../utils');

const DURATION_WARNING_SECONDS = 10;
const DURATION_BLOCK_SECONDS = 45;
const MODES = new Set(['hardlink', 'copy', 'move']);

function nowIso() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function statusError(message, statusCode = 400, code = '') {
  const error = new Error(message); error.statusCode = statusCode; if (code) error.code = code; return error;
}
function normalizeMode(value) {
  const mode = String(value || 'hardlink').trim().toLowerCase();
  if (!MODES.has(mode)) throw statusError('Modo de adocao invalido.', 400, 'ADOPTION_MODE_INVALID');
  return mode;
}
async function statOrNull(filePath) { try { return await fs.stat(filePath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function nearestExistingPath(filePath) {
  let current = path.resolve(filePath);
  while (true) {
    if (await statOrNull(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}
async function sameFilesystem(sourcePath, targetPath) {
  const [source, target] = await Promise.all([fs.stat(sourcePath), fs.stat(await nearestExistingPath(path.dirname(targetPath)))]);
  return source.dev === target.dev;
}
function durationAssessment(localDuration, remoteDuration) {
  if (!(Number(localDuration) > 0) || !(Number(remoteDuration) > 0)) return { differenceSeconds: null, level: 'unknown' };
  const differenceSeconds = Math.abs(Math.round(Number(localDuration) - Number(remoteDuration)));
  return { differenceSeconds, level: differenceSeconds > DURATION_BLOCK_SECONDS ? 'block' : differenceSeconds > DURATION_WARNING_SECONDS ? 'warning' : 'ok' };
}
function confirmedConflict(state, itemId, videoId) {
  return Object.entries(state.matches || {}).filter(([id, match]) => id !== itemId && match && match.status === 'confirmed' && match.videoId === videoId).map(([id]) => id);
}
function publicDestination(destination, managedItem) {
  return {
    id: destination.id,
    displayName: destination.displayName,
    type: destination.type,
    enabled: destination.enabled !== false,
    mediaProfile: destination.mediaProfile,
    rootPath: destination.rootPath || '',
    targetPath: managedItem && managedItem.targetPath || '',
    managedStatus: managedItem && managedItem.status || '',
    hasMedia: Boolean(managedItem && managedItem.targetPath && require('fs').existsSync(managedItem.targetPath))
  };
}

async function ensureManager(config, manager) {
  if (!manager.initialized && typeof manager.init === 'function') await manager.init(config);
  else if (typeof manager.configure === 'function') manager.configure(config);
}

async function resolveConfirmedItem(itemId) {
  const item = await localCatalog.getItem(itemId);
  if (!item) throw statusError('Item do acervo nao encontrado.', 404, 'LOCAL_ITEM_NOT_FOUND');
  if (item.present === false) throw statusError('O arquivo local nao esta mais presente.', 409, 'LOCAL_FILE_MISSING');
  const match = item.match;
  if (!match || match.status !== 'confirmed' || !/^[A-Za-z0-9_-]{11}$/.test(String(match.videoId || ''))) {
    throw statusError('A adocao exige uma correspondencia YouTube confirmada.', 409, 'MATCH_NOT_CONFIRMED');
  }
  const state = await managerState.load();
  const conflicts = confirmedConflict(state, item.id, match.videoId);
  if (conflicts.length) throw statusError('Este Video ID esta confirmado para mais de um arquivo local. Resolva o conflito antes de adotar.', 409, 'VIDEO_ID_CONFLICT');
  if (!item.source || !item.source.rootPath || !isPathInside(item.source.rootPath, item.path)) {
    throw statusError('O arquivo nao pertence mais a uma raiz de acervo autorizada.', 409, 'SOURCE_OUTSIDE_ROOT');
  }
  return { item, match };
}

async function listDestinations(config, { itemIds = [] } = {}, options = {}) {
  const manager = options.manager || downloadManager;
  await ensureManager(config, manager);
  const ids = [...new Set((itemIds || []).map(String).filter(Boolean))];
  if (!ids.length) return { destinations: [] };
  const resolved = [];
  for (const itemId of ids) resolved.push(await resolveConfirmedItem(itemId));
  const destinations = [];
  for (const destination of getAllDestinations(config, { includeDisabled: true })) {
    let eligible = true;
    const managed = [];
    for (const entry of resolved) {
      const managedItem = manager.state.items[makeItemId(destination.id, entry.match.videoId)];
      if (!managedItem || managedItem.sourceActive === false || managedItem.suppressed) { eligible = false; break; }
      managed.push(managedItem);
    }
    if (!eligible) continue;
    const first = managed[0];
    destinations.push({
      ...publicDestination(destination, first),
      allPending: managed.every((item) => !item.targetPath || !require('fs').existsSync(item.targetPath)),
      itemCount: managed.length
    });
  }
  return { destinations };
}

async function getFreshRemote(config, videoId) {
  const details = await fetchVideoDetails(config, [videoId], { useCache: true, forceFresh: true });
  if (details.quotaUnitsUsed) await quotaTracker.record('videosList', details.quotaUnitsUsed, { reason: 'youtube-manager-adoption-preflight' });
  return details.videosById.get(videoId) || null;
}

async function preflight(config, payload = {}, options = {}) {
  const manager = options.manager || downloadManager;
  await ensureManager(config, manager);
  const mode = normalizeMode(payload.mode);
  const { item, match } = await resolveConfirmedItem(payload.itemId);
  const destination = findDestinationById(config, payload.destinationId, { includeDisabled: true });
  if (!destination) throw statusError('Destino gerenciado nao encontrado.', 404, 'DESTINATION_NOT_FOUND');
  const managedItemId = makeItemId(destination.id, match.videoId);
  const managedItem = manager.state.items[managedItemId];
  const blockers = [];
  const warnings = [];
  if (!managedItem || managedItem.sourceActive === false || managedItem.suppressed) blockers.push({ code: 'MANAGED_SOURCE_MISSING', message: 'O video ainda nao existe como item ativo desta fonte gerenciada. Sincronize o destino antes de adotar.' });
  if (destination.enabled === false) warnings.push({ code: 'DESTINATION_DISABLED', message: 'O destino existe, mas esta desativado na configuracao.' });
  if (managedItem && ['downloading', 'adopting'].includes(managedItem.status)) blockers.push({ code: 'MANAGED_ITEM_BUSY', message: 'O item gerenciado esta em processamento.' });
  if (manager.current && manager.current.itemId === managedItemId) blockers.push({ code: 'DOWNLOAD_BUSY', message: 'Este item esta sendo baixado neste momento.' });

  const sourceStat = await statOrNull(item.path);
  if (!sourceStat || !sourceStat.isFile()) blockers.push({ code: 'LOCAL_FILE_MISSING', message: 'O arquivo local nao esta mais presente.' });
  let targetPath = managedItem && managedItem.targetPath || '';
  if (managedItem && !targetPath && typeof manager.chooseTargetPaths === 'function') {
    const target = manager.chooseTargetPaths(destination, { id: match.videoId, title: match.title || item.inferredTitle, channelTitle: match.channelTitle || '', duration: match.duration || item.duration }, managedItemId);
    targetPath = target.targetPath;
  }
  if (!targetPath) blockers.push({ code: 'TARGET_UNRESOLVED', message: 'Nao foi possivel determinar o caminho gerenciado de destino.' });
  if (targetPath && path.resolve(targetPath) === path.resolve(item.path)) blockers.push({ code: 'SOURCE_EQUALS_TARGET', message: 'O arquivo de origem ja esta no caminho gerenciado de destino.' });

  let targetExists = false;
  if (targetPath) targetExists = Boolean(await statOrNull(targetPath));
  if (targetExists) blockers.push({ code: 'TARGET_EXISTS', message: 'Ja existe um arquivo de midia no destino proposto; nada sera sobrescrito.' });

  let compatible = false;
  let mediaInspection = null;
  if (sourceStat) {
    try { mediaInspection = await manager.validateMedia(item.path); compatible = true; }
    catch (error) { blockers.push({ code: 'INCOMPATIBLE_MEDIA', message: `A midia local nao atende ao padrao gerenciado atual: ${error.message}` }); }
  }

  const remote = options.remoteVideo === undefined ? await getFreshRemote(config, match.videoId) : options.remoteVideo;
  if (!remote) blockers.push({ code: 'REMOTE_UNAVAILABLE', message: 'O video confirmado nao esta disponivel na YouTube Data API.' });
  const duration = durationAssessment(item.duration, remote && remote.duration);
  if (duration.level === 'block') blockers.push({ code: 'DURATION_CRITICAL', message: `A duracao local difere ${duration.differenceSeconds}s do YouTube; acima do limite de 45s.` });
  else if (duration.level === 'warning') warnings.push({ code: 'DURATION_WARNING', message: `A duracao local difere ${duration.differenceSeconds}s do YouTube; acima do aviso de 10s.` });
  if (item.changedSinceMatch) warnings.push({ code: 'LOCAL_CHANGED', message: 'O arquivo mudou desde a confirmacao do match; este preflight usa a midia atual.' });

  let sameFs = false;
  if (sourceStat && targetPath) {
    try { sameFs = await sameFilesystem(item.path, targetPath); } catch {}
  }
  if (mode === 'hardlink' && !sameFs) blockers.push({ code: 'HARDLINK_CROSS_DEVICE', message: 'Hardlink nao esta disponivel entre filesystems diferentes. Use Copy.' });

  let disk = null;
  if (sourceStat && targetPath && (mode === 'copy' || (mode === 'move' && !sameFs))) {
    try {
      const existing = await nearestExistingPath(path.dirname(targetPath));
      disk = await getDiskStats(existing);
      const reserve = Math.max(0, Number(config.downloads && config.downloads.minFreeSpaceGb) || 0) * 1024 ** 3;
      if (disk.availableBytes < sourceStat.size || disk.availableBytes - sourceStat.size < reserve) blockers.push({ code: 'INSUFFICIENT_SPACE', message: 'Espaco livre insuficiente para copiar a midia mantendo a reserva configurada.' });
    } catch (error) { blockers.push({ code: 'DISK_CHECK_FAILED', message: `Nao foi possivel validar o espaco no destino: ${error.message}` }); }
  }

  const collisions = [];
  if (managedItem) {
    const profile = getMediaProfileSettings(destination);
    const targetSpecific = [managedItem.nfoPath, managedItem.thumbnailPath].filter(Boolean);
    for (const filePath of targetSpecific) if (await pathExists(filePath)) collisions.push(filePath);
    if (collisions.length) blockers.push({ code: 'SIDECAR_COLLISION', message: 'Existem sidecars no caminho proposto. A adocao nao sobrescreve arquivos existentes.', paths: collisions });
    if (profile.musicClips) {
      for (const shared of [managedItem.showNfoPath, managedItem.showPosterPath].filter(Boolean)) if (await pathExists(shared)) warnings.push({ code: 'SHARED_SIDECAR_PRESERVED', message: `Sidecar compartilhado existente sera preservado: ${shared}` });
    }
  }

  return {
    itemId: item.id,
    managedItemId,
    videoId: match.videoId,
    mode,
    canCommit: blockers.length === 0,
    blockers,
    warnings,
    source: { path: item.path, relativePath: item.relativePath, sizeBytes: sourceStat && sourceStat.size || 0, duration: Number(item.duration) || null, sidecars: item.sidecars || {} },
    youtube: remote ? { id: remote.id, title: remote.title, channelTitle: remote.channelTitle, duration: remote.duration, thumbnailUrl: remote.thumbnailUrl, publishedAt: remote.publishedAt } : null,
    durationDifferenceSeconds: duration.differenceSeconds,
    durationLevel: duration.level,
    sameFilesystem: sameFs,
    compatible,
    mediaInspection: mediaInspection ? { container: mediaInspection.formatName || '', videoCodec: mediaInspection.video && mediaInspection.video.codec_name || '', audioCodec: mediaInspection.audio && mediaInspection.audio.codec_name || '' } : null,
    destination: { ...publicDestination(destination, managedItem), targetPath },
    disk: disk ? { availableBytes: disk.availableBytes, requiredBytes: sourceStat && sourceStat.size || 0 } : null,
    policy: { warningSeconds: DURATION_WARNING_SECONDS, blockSeconds: DURATION_BLOCK_SECONDS, preserveLegacySidecars: true }
  };
}

async function plan(config, payload = {}, options = {}) {
  const manager = options.manager || downloadManager;
  const itemIds = [...new Set((payload.itemIds || (payload.itemId ? [payload.itemId] : [])).map(String).filter(Boolean))];
  if (!itemIds.length) throw statusError('Selecione ao menos um item confirmado.', 400, 'NO_ITEMS');
  const remoteById = new Map();
  const resolved = [];
  for (const itemId of itemIds) resolved.push(await resolveConfirmedItem(itemId));
  const ids = [...new Set(resolved.map((entry) => entry.match.videoId))];
  const details = options.remoteVideos ? null : await fetchVideoDetails(config, ids, { useCache: true, forceFresh: true });
  if (details && details.quotaUnitsUsed) await quotaTracker.record('videosList', details.quotaUnitsUsed, { reason: 'youtube-manager-adoption-bulk-preflight' });
  if (details) for (const id of ids) remoteById.set(id, details.videosById.get(id) || null);
  if (options.remoteVideos) for (const [id, value] of Object.entries(options.remoteVideos)) remoteById.set(id, value);
  const items = [];
  for (const entry of resolved) items.push(await preflight(config, { itemId: entry.item.id, destinationId: payload.destinationId, mode: payload.mode }, { manager, remoteVideo: remoteById.get(entry.match.videoId) || null }));
  return {
    destinationId: String(payload.destinationId || ''),
    mode: normalizeMode(payload.mode),
    requested: items.length,
    eligible: items.filter((entry) => entry.canCommit).length,
    blocked: items.filter((entry) => !entry.canCommit).length,
    warnings: items.reduce((total, entry) => total + entry.warnings.length, 0),
    items
  };
}

async function recordTransaction(tx) {
  await adoptionState.mutate((state) => { state.transactions[tx.id] = tx; adoptionState.appendAudit(state, { action: 'adoption-transaction-start', transactionId: tx.id, itemId: tx.itemId, destinationId: tx.destinationId, mode: tx.mode }); });
}
async function patchTransaction(id, patch) {
  return adoptionState.mutate((state) => { const tx = state.transactions[id]; if (!tx) return null; Object.assign(tx, patch, { updatedAt: nowIso() }); return clone(tx); });
}
async function setCatalogAdoption(itemId, value) {
  await managerState.mutate((state) => { if (state.localItems[itemId]) state.localItems[itemId].adoptionState = value; managerState.appendAudit(state, { action: 'adoption-state', itemId, status: value && value.status || 'cleared', transactionId: value && value.transactionId || null }); });
}

async function plannedOwnedPaths(config, destination, managedItem, targetPath) {
  const profile = getMediaProfileSettings(destination);
  const forceArtwork = profile.movie || profile.musicClips;
  const candidates = [targetPath, managedItem.nfoPath];
  if ((config.downloads.writeThumbnails !== false || forceArtwork) && managedItem.thumbnailPath) candidates.push(managedItem.thumbnailPath);
  if (profile.musicClips) {
    if (managedItem.showNfoPath) candidates.push(managedItem.showNfoPath);
    if (managedItem.showPosterPath) candidates.push(managedItem.showPosterPath);
  }
  const owned = [];
  for (const filePath of [...new Set(candidates.filter(Boolean))]) if (!(await pathExists(filePath))) owned.push(filePath);
  return owned;
}

async function createManagedMetadata({ config, manager, destination, managedItem, createdPaths, workDir }) {
  await manager.ensureReleaseMetadata(managedItem, destination);
  const profile = getMediaProfileSettings(destination);
  const forceArtwork = profile.movie || profile.musicClips;
  if (config.downloads.writeThumbnails !== false || forceArtwork) {
    if (managedItem.thumbnailPath && !(await pathExists(managedItem.thumbnailPath)) && managedItem.thumbnailUrl) {
      await fs.mkdir(path.dirname(managedItem.thumbnailPath), { recursive: true });
      const temp = path.join(workDir, `thumbnail-${crypto.randomBytes(4).toString('hex')}.tmp`);
      await downloadRemoteFile(managedItem.thumbnailUrl, temp, 30000);
      await fs.rename(temp, managedItem.thumbnailPath);
      createdPaths.push(managedItem.thumbnailPath);
    }
  }
  managedItem.mediaProfile = profile.profile;
  if (profile.musicClips) {
    if (!(await pathExists(managedItem.showNfoPath))) { await writeTvShowNfo(managedItem, managedItem.showNfoPath); createdPaths.push(managedItem.showNfoPath); }
    await writeEpisodeNfo(managedItem, managedItem.nfoPath); createdPaths.push(managedItem.nfoPath);
    if (managedItem.showPosterPath && !(await pathExists(managedItem.showPosterPath)) && managedItem.thumbnailPath && await pathExists(managedItem.thumbnailPath)) { await fs.copyFile(managedItem.thumbnailPath, managedItem.showPosterPath); createdPaths.push(managedItem.showPosterPath); }
    const metadata = getMusicClipMetadata(managedItem);
    managedItem.mediaMetadata = { status: 'complete', profile: profile.profile, artist: metadata.artist, title: metadata.trackTitle, seasonNumber: metadata.seasonNumber, episodeNumber: metadata.episodeNumber, releaseDate: metadata.releaseDate, year: metadata.year, nfoPath: managedItem.nfoPath, showNfoPath: managedItem.showNfoPath, artworkPath: managedItem.thumbnailPath, showPosterPath: managedItem.showPosterPath, updatedAt: nowIso(), lastError: null };
  } else if (profile.movie) {
    await writeMovieNfo(managedItem, managedItem.nfoPath); createdPaths.push(managedItem.nfoPath);
    const metadata = getMovieMetadata(managedItem);
    managedItem.mediaMetadata = { status: 'complete', profile: profile.profile, artist: metadata.artist, title: metadata.trackTitle, releaseDate: metadata.releaseDate, year: metadata.year, nfoPath: managedItem.nfoPath, artworkPath: managedItem.thumbnailPath, updatedAt: nowIso(), lastError: null };
  } else {
    await writeGenericNfo(managedItem, managedItem.nfoPath); createdPaths.push(managedItem.nfoPath);
    const metadata = getGenericMetadata(managedItem);
    managedItem.mediaMetadata = { status: 'complete', profile: profile.profile, title: metadata.title, releaseDate: metadata.releaseDate, year: metadata.year, nfoPath: managedItem.nfoPath, artworkPath: managedItem.thumbnailPath, updatedAt: nowIso(), lastError: null };
  }
}

async function rollbackTransaction(tx, options = {}) {
  const manager = options.manager || downloadManager;
  const createdPaths = [...new Set([...(tx.manifest && tx.manifest.ownedPaths || []), ...(tx.manifest && tx.manifest.createdPaths || [])])];
  if (tx.mode === 'move' && !(await pathExists(tx.sourcePath)) && await pathExists(tx.targetPath)) {
    await fs.mkdir(path.dirname(tx.sourcePath), { recursive: true });
    try { await fs.link(tx.targetPath, tx.sourcePath); } catch (error) { if (error.code !== 'EXDEV') throw error; await fs.copyFile(tx.targetPath, tx.sourcePath); }
  }
  for (const filePath of createdPaths.sort((a, b) => b.length - a.length)) await fs.rm(filePath, { force: true }).catch(() => {});
  if (tx.manifest && tx.manifest.previousManagedItem) {
    manager.state.items[tx.managedItemId] = clone(tx.manifest.previousManagedItem);
    await manager.saveNow();
  }
  await setCatalogAdoption(tx.itemId, tx.manifest && tx.manifest.previousCatalogAdoptionState || null).catch(() => {});
  await patchTransaction(tx.id, { status: 'rolled-back', rolledBackAt: nowIso(), lastError: tx.lastError || null });
}

async function adopt(config, payload = {}, options = {}) {
  const manager = options.manager || downloadManager;
  const check = await preflight(config, payload, { manager, remoteVideo: options.remoteVideo });
  if (!payload.confirmed) throw statusError('Confirme explicitamente a adocao apos revisar o preflight.', 409, 'ADOPTION_CONFIRMATION_REQUIRED');
  if (check.mode === 'move' && !payload.moveConfirmed) throw statusError('Move exige confirmacao reforcada de que a origem sera removida somente no commit final.', 409, 'MOVE_CONFIRMATION_REQUIRED');
  if (!check.canCommit) throw statusError(check.blockers.map((entry) => entry.message).join(' '), 409, 'ADOPTION_PREFLIGHT_BLOCKED');
  if (manager.current || manager.currentPromise) throw statusError('A adocao aguardara o download atual terminar para evitar disputa de arquivos.', 409, 'DOWNLOAD_BUSY');

  const destination = findDestinationById(config, check.destination.id, { includeDisabled: true });
  const managedItem = manager.state.items[check.managedItemId];
  const catalogItem = await localCatalog.getItem(check.itemId);
  const txId = `adopt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const workDir = path.join(path.dirname(check.destination.targetPath), `.adoption-${txId}`);
  const previousManagedItem = clone(managedItem);
  const previousCatalogAdoptionState = catalogItem.adoptionState ? clone(catalogItem.adoptionState) : null;
  const ownedPaths = await plannedOwnedPaths(config, destination, managedItem, check.destination.targetPath);
  const tx = {
    id: txId, itemId: check.itemId, managedItemId: check.managedItemId, destinationId: destination.id, videoId: check.videoId,
    mode: check.mode, status: 'running', sourcePath: check.source.path, targetPath: check.destination.targetPath,
    createdAt: nowIso(), startedAt: nowIso(), updatedAt: nowIso(), completedAt: null, rolledBackAt: null, lastError: null,
    preflight: { durationDifferenceSeconds: check.durationDifferenceSeconds, warnings: check.warnings },
    manifest: { ownedPaths, createdPaths: [], sourceRemoved: false, previousManagedItem, previousCatalogAdoptionState }
  };
  await recordTransaction(tx);
  let mutationHeld = false;
  try {
    if (typeof manager.beginExternalMutation === 'function') { manager.beginExternalMutation(); mutationHeld = true; }
    managedItem.status = 'adopting'; managedItem.phase = 'adopting'; managedItem.updatedAt = nowIso(); managedItem.lastError = null;
    await manager.saveNow();
    await setCatalogAdoption(check.itemId, { status: 'adopting', transactionId: txId, destinationId: destination.id, mode: check.mode, startedAt: tx.startedAt });
    await fs.mkdir(path.dirname(check.destination.targetPath), { recursive: true });
    await fs.mkdir(workDir, { recursive: true });

    if (check.mode === 'hardlink' || (check.mode === 'move' && check.sameFilesystem)) {
      await fs.link(check.source.path, check.destination.targetPath);
    } else {
      const temp = `${check.destination.targetPath}.adopting-${txId}`;
      await fs.copyFile(check.source.path, temp);
      await fs.rename(temp, check.destination.targetPath);
    }
    tx.manifest.createdPaths.push(check.destination.targetPath);
    await patchTransaction(txId, { manifest: tx.manifest });
    await manager.validateMedia(check.destination.targetPath);

    if (check.youtube) {
      managedItem.title = check.youtube.title || managedItem.title;
      managedItem.channelTitle = check.youtube.channelTitle || managedItem.channelTitle;
      managedItem.durationSeconds = Number(check.youtube.duration) || managedItem.durationSeconds || null;
      managedItem.thumbnailUrl = check.youtube.thumbnailUrl || managedItem.thumbnailUrl || '';
      managedItem.publishedAt = check.youtube.publishedAt || managedItem.publishedAt || null;
      managedItem.url = managedItem.url || `https://www.youtube.com/watch?v=${check.videoId}`;
    }
    await createManagedMetadata({ config, manager, destination, managedItem, createdPaths: tx.manifest.createdPaths, workDir });
    await patchTransaction(txId, { manifest: tx.manifest });

    const stats = await fs.stat(check.destination.targetPath);
    const completedAt = nowIso();
    Object.assign(managedItem, {
      status: 'completed', phase: null, mediaPath: managedItem.targetPath, storageState: STORAGE_STATES.ACTIVE,
      userDisposition: managedItem.userDisposition || USER_DISPOSITIONS.MANAGED, fileSizeBytes: stats.size,
      completedAt, updatedAt: completedAt, nextAttemptAt: null, lastError: null, priority: 0,
      progress: { downloadedBytes: stats.size, totalBytes: stats.size, speedBytesPerSecond: null, etaSeconds: 0, percent: 100, updatedAt: completedAt },
      acquisition: { type: 'adopted-local', transactionId: txId, localItemId: check.itemId, mode: check.mode, sourcePathAtAdoption: check.source.path, adoptedAt: completedAt }
    });
    const libraryState = manager.ensureLibraryState(managedItem.libraryFolder);
    libraryState.dirty = true; libraryState.lastCompletedAt = completedAt; libraryState.lastIdleActionError = null;
    await manager.saveNow();

    if (check.mode === 'move') {
      await fs.rm(check.source.path);
      tx.manifest.sourceRemoved = true;
      await patchTransaction(txId, { manifest: tx.manifest });
    }
    await setCatalogAdoption(check.itemId, { status: 'adopted', transactionId: txId, destinationId: destination.id, targetPath: managedItem.targetPath, mode: check.mode, adoptedAt: completedAt, sourceRemoved: check.mode === 'move' });
    await patchTransaction(txId, { status: 'completed', completedAt, manifest: tx.manifest });
    await fs.rm(workDir, { recursive: true, force: true });
    return { transactionId: txId, status: 'completed', itemId: check.itemId, managedItemId: check.managedItemId, destinationId: destination.id, targetPath: managedItem.targetPath, mode: check.mode, sourceRemoved: check.mode === 'move' };
  } catch (error) {
    tx.lastError = error.message;
    await patchTransaction(txId, { status: 'rolling-back', lastError: error.message, manifest: tx.manifest }).catch(() => {});
    await rollbackTransaction({ ...tx, manifest: tx.manifest }, { manager }).catch((rollbackError) => {
      error.message = `${error.message} Rollback tambem falhou: ${rollbackError.message}`;
    });
    throw error;
  } finally {
    if (mutationHeld && typeof manager.endExternalMutation === 'function') manager.endExternalMutation();
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function recover(config, options = {}) {
  const manager = options.manager || downloadManager;
  await ensureManager(config, manager);
  const state = await adoptionState.load();
  const pending = Object.values(state.transactions || {}).filter((tx) => ['running', 'rolling-back'].includes(tx.status));
  const results = [];
  for (const tx of pending) {
    try { await rollbackTransaction(tx, { manager }); results.push({ id: tx.id, status: 'rolled-back' }); }
    catch (error) { await patchTransaction(tx.id, { status: 'rollback-failed', lastError: error.message }); results.push({ id: tx.id, status: 'rollback-failed', error: error.message }); }
  }
  return results;
}

module.exports = { DURATION_WARNING_SECONDS, DURATION_BLOCK_SECONDS, normalizeMode, durationAssessment, listDestinations, preflight, plan, adopt, recover, rollbackTransaction };
