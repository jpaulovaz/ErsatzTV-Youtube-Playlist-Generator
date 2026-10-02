const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pathExists, isPathInside, sanitizeFileComponent } = require('../utils');
const { listSubtitleSidecars } = require('../subtitleService');
const { STORAGE_STATES, USER_DISPOSITIONS, quarantineExpiresAt } = require('./orphanPolicy');

function nowIso() { return new Date().toISOString(); }

function destinationBucket(destination) {
  return destination && destination.type === 'library' ? 'libraries' : 'channels';
}

function destinationToken(destination) {
  const raw = String(destination && destination.id || 'destination');
  const readable = sanitizeFileComponent(raw.replace(/[:/\\]+/g, '-'), 'destination', 72);
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
  return `${readable}-${hash}`;
}

function getQuarantineRoot(destination) {
  const baseRoot = path.resolve(String(destination && destination.baseRootPath || destination && destination.rootPath || '.'));
  const parent = path.dirname(baseRoot);
  return path.join(parent, '.ersatztv-youtube-quarantine', destinationBucket(destination), destinationToken(destination));
}

function sameResolved(a, b) {
  return path.resolve(String(a || '')) === path.resolve(String(b || ''));
}

function getShowDir(item) {
  if (!item || item.mediaLayout !== 'show-season') return '';
  if (item.showNfoPath) return path.dirname(path.resolve(item.showNfoPath));
  if (item.targetPath) return path.dirname(path.dirname(path.resolve(item.targetPath)));
  return '';
}

function shouldIncludeSharedShowAssets(item, allItems) {
  const showDir = getShowDir(item);
  if (!showDir) return false;
  return !(allItems || []).some((other) => {
    if (!other || other.id === item.id) return false;
    if ((other.destinationId || other.libraryFolder) !== (item.destinationId || item.libraryFolder)) return false;
    if (other.mediaLayout !== 'show-season') return false;
    if (String(other.storageState || STORAGE_STATES.ACTIVE) !== STORAGE_STATES.ACTIVE) return false;
    if (String(other.userDisposition || USER_DISPOSITIONS.MANAGED) === USER_DISPOSITIONS.IGNORED) return false;
    const otherShowDir = getShowDir(other);
    return otherShowDir && sameResolved(otherShowDir, showDir);
  });
}

function uniqueFileEntries(entries) {
  const result = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || !entry.path) continue;
    const resolved = path.resolve(entry.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push({ ...entry, path: resolved });
  }
  return result;
}

async function buildMediaPackage(item, destination, allItems = []) {
  if (!item || !destination) throw new Error('Item/destino invalido para pacote de midia.');
  const entries = [];
  if (item.targetPath) entries.push({ kind: 'video', path: item.targetPath });
  if (item.nfoPath) entries.push({ kind: 'nfo', path: item.nfoPath });
  if (item.thumbnailPath) entries.push({ kind: 'thumbnail', path: item.thumbnailPath });
  if (item.targetPath) {
    for (const subtitlePath of await listSubtitleSidecars(item.targetPath)) {
      entries.push({ kind: 'subtitle', path: subtitlePath });
    }
  }
  if (shouldIncludeSharedShowAssets(item, allItems)) {
    if (item.showNfoPath) entries.push({ kind: 'show-nfo', path: item.showNfoPath });
    if (item.showPosterPath) entries.push({ kind: 'show-poster', path: item.showPosterPath });
  }

  return uniqueFileEntries(entries).filter((entry) => isPathInside(destination.rootPath, entry.path));
}

async function fileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function safeMove(sourcePath, targetPath) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  if (!(await pathExists(source))) return { moved: false, bytes: 0 };
  if (await pathExists(target)) throw new Error(`Movimento cancelado: o destino ja existe: ${target}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const sourceSize = await fileSize(source);
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    const temp = `${target}.copying-${process.pid}-${Date.now()}`;
    try {
      await fs.copyFile(source, temp);
      const copiedSize = await fileSize(temp);
      if (sourceSize !== null && copiedSize !== sourceSize) {
        throw new Error(`Copia incompleta ao mover ${source}.`);
      }
      await fs.rename(temp, target);
      const targetSize = await fileSize(target);
      if (sourceSize !== null && targetSize !== sourceSize) {
        throw new Error(`Validacao falhou ao mover ${source}.`);
      }
      await fs.rm(source, { force: true });
    } catch (copyError) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw copyError;
    }
  }
  return { moved: true, bytes: sourceSize || 0 };
}

function relativeQuarantinePath(destination, originalPath) {
  const relative = path.relative(path.resolve(destination.rootPath), path.resolve(originalPath));
  if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Arquivo fora da raiz do destino: ${originalPath}`);
  }
  return relative;
}

const QUARANTINE_PATH_KEYS = Object.freeze({
  video: 'targetPath',
  nfo: 'nfoPath',
  thumbnail: 'thumbnailPath',
  'show-nfo': 'showNfoPath',
  'show-poster': 'showPosterPath'
});

function rebuildQuarantineIndexes(metadata) {
  const originalPaths = {};
  const quarantinePaths = {};
  const subtitlePaths = [];
  for (const file of metadata.files || []) {
    if (file.kind === 'subtitle') {
      subtitlePaths.push({ original: file.original, quarantine: file.quarantine });
      continue;
    }
    const key = QUARANTINE_PATH_KEYS[file.kind] || `${String(file.kind || 'file').replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Path`;
    originalPaths[key] = file.original;
    quarantinePaths[key] = file.quarantine;
  }
  metadata.originalPaths = originalPaths;
  metadata.quarantinePaths = quarantinePaths;
  metadata.subtitlePaths = subtitlePaths;
  return metadata;
}

function buildQuarantineMetadata(item, destination, files, options = {}) {
  const movedAt = options.movedAt || nowIso();
  const retentionDays = options.retentionDays == null ? null : Number(options.retentionDays);
  return rebuildQuarantineIndexes({
    movedAt,
    expiresAt: quarantineExpiresAt(retentionDays, movedAt),
    retentionDays: retentionDays || null,
    reason: String(options.reason || 'orphan'),
    rootPath: getQuarantineRoot(destination),
    originalPaths: {},
    quarantinePaths: {},
    subtitlePaths: [],
    files
  });
}

async function moveItemToQuarantine(item, destination, allItems, options = {}) {
  if (item.storageState === STORAGE_STATES.QUARANTINED && item.quarantine) return item.quarantine;
  const packageFiles = await buildMediaPackage(item, destination, allItems);
  const root = getQuarantineRoot(destination);
  const itemToken = sanitizeFileComponent(String(item.videoId || item.id || 'item'), 'item', 96);
  const itemRoot = path.join(root, 'items', itemToken);
  const mappings = packageFiles.map((entry) => ({
    kind: entry.kind,
    original: entry.path,
    quarantine: path.join(itemRoot, relativeQuarantinePath(destination, entry.path))
  }));

  for (const mapping of mappings) {
    if (await pathExists(mapping.quarantine)) {
      throw new Error(`Quarentena ja contem um arquivo para este item: ${mapping.quarantine}`);
    }
  }

  const moved = [];
  try {
    for (const mapping of mappings) {
      const result = await safeMove(mapping.original, mapping.quarantine);
      if (result.moved) {
        mapping.bytes = result.bytes;
        moved.push(mapping);
      }
    }
  } catch (error) {
    for (const mapping of moved.reverse()) {
      try {
        if (await pathExists(mapping.quarantine) && !(await pathExists(mapping.original))) {
          await safeMove(mapping.quarantine, mapping.original);
        }
      } catch {
        // Best effort rollback. Original error is more useful.
      }
    }
    throw error;
  }

  const movedVideoBytes = moved.filter((mapping) => mapping.kind === 'video').reduce((total, mapping) => total + (Number(mapping.bytes) || 0), 0);
  const originalVideoSize = movedVideoBytes || Number(item.fileSizeBytes) || 0;
  const metadata = buildQuarantineMetadata(item, destination, mappings.filter((mapping) => moved.some((entry) => entry.quarantine === mapping.quarantine)), options);
  item.quarantine = metadata;
  item.storageState = STORAGE_STATES.QUARANTINED;
  item.mediaPath = null;
  item.fileSizeBytes = originalVideoSize;
  return metadata;
}

function replaceEpisodeTokenInPath(filePath, seasonNumber, episodeNumber) {
  const parsed = path.parse(String(filePath || ''));
  if (!/S\d+E\d+/i.test(parsed.name)) return '';
  const season = String(Math.max(1, Number(seasonNumber) || 1)).padStart(2, '0');
  const episode = String(Math.max(1, Number(episodeNumber) || 1)).padStart(2, '0');
  const nextName = parsed.name.replace(/S\d+E\d+/i, `S${season}E${episode}`);
  return path.join(parsed.dir, `${nextName}${parsed.ext}`);
}

async function prepareMusicClipRestore(item, destination, allItems = []) {
  const quarantine = item && item.quarantine;
  if (!item || item.mediaLayout !== 'show-season' || !quarantine || !Array.isArray(quarantine.files)) {
    return { remapped: false, sharedDiscarded: 0 };
  }

  let sharedDiscarded = 0;
  const keptFiles = [];
  for (const file of quarantine.files) {
    if (['show-nfo', 'show-poster'].includes(file.kind) && await pathExists(file.original)) {
      // A current Show-level asset wins over the historical quarantined copy.
      await fs.rm(file.quarantine, { force: true });
      sharedDiscarded += 1;
      continue;
    }
    keptFiles.push(file);
  }
  quarantine.files = keptFiles;
  rebuildQuarantineIndexes(quarantine);

  const episodeFiles = quarantine.files.filter((file) => ['video', 'nfo', 'thumbnail', 'subtitle'].includes(file.kind));
  let hasConflict = false;
  for (const file of episodeFiles) {
    if (await pathExists(file.original)) {
      hasConflict = true;
      break;
    }
  }
  if (!hasConflict) return { remapped: false, sharedDiscarded };

  if (episodeFiles.some((file) => !replaceEpisodeTokenInPath(file.original, 1, 1))) {
    throw new Error('Restauracao cancelada: existe colisao em um clipe sem token SxxExx que possa ser remapeado com seguranca.');
  }

  const reserved = new Set();
  for (const other of allItems || []) {
    if (!other || other.id === item.id) continue;
    for (const candidate of [other.targetPath, other.nfoPath, other.thumbnailPath]) {
      if (candidate) reserved.add(path.resolve(candidate));
    }
  }

  const seasonNumber = Number(item.showSeasonNumber) || 1;
  let tempEpisode = 900000;
  let remappedFiles = null;
  while (tempEpisode < 999999) {
    const candidates = episodeFiles.map((file) => ({
      file,
      original: replaceEpisodeTokenInPath(file.original, seasonNumber, tempEpisode)
    }));
    let collision = false;
    for (const candidate of candidates) {
      if (!candidate.original || reserved.has(path.resolve(candidate.original)) || await pathExists(candidate.original)) {
        collision = true;
        break;
      }
    }
    if (!collision) {
      remappedFiles = candidates;
      break;
    }
    tempEpisode += 1;
  }
  if (!remappedFiles) throw new Error('Restauracao cancelada: nao foi possivel reservar um caminho temporario seguro para o clipe.');

  for (const candidate of remappedFiles) candidate.file.original = candidate.original;
  rebuildQuarantineIndexes(quarantine);

  const byKind = new Map(quarantine.files.filter((file) => file.kind !== 'subtitle').map((file) => [file.kind, file.original]));
  if (byKind.get('video')) item.targetPath = byKind.get('video');
  if (byKind.get('nfo')) item.nfoPath = byKind.get('nfo');
  if (byKind.get('thumbnail')) item.thumbnailPath = byKind.get('thumbnail');
  if (item.mediaMetadata && typeof item.mediaMetadata === 'object') {
    if (item.nfoPath) item.mediaMetadata.nfoPath = item.nfoPath;
    if (item.thumbnailPath) item.mediaMetadata.artworkPath = item.thumbnailPath;
  }
  return { remapped: true, sharedDiscarded, temporaryEpisodeNumber: tempEpisode };
}

async function restoreItemFromQuarantine(item, destination, allItems = []) {
  await prepareMusicClipRestore(item, destination, allItems);
  const quarantine = item && item.quarantine;
  const files = quarantine && Array.isArray(quarantine.files) ? quarantine.files : [];
  if (!files.length) throw new Error('O item nao possui arquivos registrados na quarentena.');

  const existingSources = [];
  for (const file of files) {
    if (!(await pathExists(file.quarantine))) {
      throw new Error(`Arquivo da quarentena nao encontrado: ${path.basename(file.quarantine)}`);
    }
    if (await pathExists(file.original)) {
      throw new Error(`Restauracao cancelada: o destino ja existe: ${file.original}`);
    }
    existingSources.push(file);
  }

  const restored = [];
  try {
    for (const file of existingSources) {
      await safeMove(file.quarantine, file.original);
      restored.push(file);
    }
  } catch (error) {
    for (const file of restored.reverse()) {
      try {
        if (await pathExists(file.original) && !(await pathExists(file.quarantine))) {
          await safeMove(file.original, file.quarantine);
        }
      } catch {
        // Best effort rollback.
      }
    }
    throw error;
  }

  item.storageState = STORAGE_STATES.ACTIVE;
  item.quarantine = null;
  if (item.targetPath && await pathExists(item.targetPath)) {
    item.mediaPath = item.targetPath;
    item.fileSizeBytes = (await fs.stat(item.targetPath)).size;
  }
  return { restored: restored.length, bytes: Number(item.fileSizeBytes) || 0 };
}

async function deleteQuarantinedFiles(item) {
  const quarantine = item && item.quarantine;
  const files = quarantine && Array.isArray(quarantine.files) ? quarantine.files : [];
  const summary = { filesRemoved: 0, bytesRemoved: 0 };
  for (const file of files) {
    if (!(await pathExists(file.quarantine))) continue;
    const size = await fileSize(file.quarantine);
    await fs.rm(file.quarantine, { force: true });
    summary.filesRemoved += 1;
    summary.bytesRemoved += size || 0;
  }
  if (quarantine && quarantine.rootPath) {
    const itemRoot = files[0] ? path.dirname(files[0].quarantine) : '';
    let cursor = itemRoot;
    const stop = path.resolve(quarantine.rootPath);
    while (cursor && isPathInside(stop, cursor) && !sameResolved(cursor, stop)) {
      try { await fs.rmdir(cursor); } catch { break; }
      cursor = path.dirname(cursor);
    }
  }
  item.quarantine = null;
  item.storageState = STORAGE_STATES.ABSENT;
  item.mediaPath = null;
  item.fileSizeBytes = 0;
  return summary;
}

async function deleteActivePackage(item, destination, allItems) {
  const files = await buildMediaPackage(item, destination, allItems);
  const summary = { filesRemoved: 0, bytesRemoved: 0 };
  for (const entry of files) {
    if (!(await pathExists(entry.path))) continue;
    const size = await fileSize(entry.path);
    await fs.rm(entry.path, { force: true });
    summary.filesRemoved += 1;
    summary.bytesRemoved += size || 0;
  }
  item.storageState = STORAGE_STATES.ABSENT;
  item.mediaPath = null;
  item.fileSizeBytes = 0;
  return summary;
}

function quarantineThumbnailPath(item) {
  const files = item && item.quarantine && Array.isArray(item.quarantine.files) ? item.quarantine.files : [];
  const preferred = files.find((file) => ['thumbnail', 'show-poster'].includes(file.kind));
  return preferred ? preferred.quarantine : '';
}

module.exports = {
  getQuarantineRoot,
  getShowDir,
  shouldIncludeSharedShowAssets,
  buildMediaPackage,
  safeMove,
  moveItemToQuarantine,
  prepareMusicClipRestore,
  restoreItemFromQuarantine,
  deleteQuarantinedFiles,
  deleteActivePackage,
  quarantineThumbnailPath
};
