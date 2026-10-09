const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { isDangerousBaseDir } = require('../utils');
const stateStore = require('./youtubeManagerState');
const identity = require('./localIdentityExtractor');

const MEDIA_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.ts', '.m2ts', '.mpg', '.mpeg']);

function stableItemId(sourceId, relativePath) {
  return `local_${crypto.createHash('sha256').update(`${sourceId}\n${relativePath}`).digest('hex').slice(0, 24)}`;
}

function sourceIdFor(realPath) {
  return `src_${crypto.createHash('sha256').update(realPath).digest('hex').slice(0, 16)}`;
}

async function validateRoot(rootPath) {
  const requested = path.resolve(String(rootPath || '').trim());
  if (!path.isAbsolute(requested) || isDangerousBaseDir(requested)) throw Object.assign(new Error('Selecione uma pasta de acervo especifica e segura.'), { statusCode: 400 });
  const stat = await fs.stat(requested).catch(() => null);
  if (!stat || !stat.isDirectory()) throw Object.assign(new Error('A raiz de acervo nao existe ou nao e uma pasta.'), { statusCode: 400 });
  const realPath = await fs.realpath(requested);
  if (isDangerousBaseDir(realPath)) throw Object.assign(new Error('A raiz resolvida e ampla demais para uma varredura segura.'), { statusCode: 400 });
  return realPath;
}

async function addSource({ rootPath, name, recursive = true } = {}) {
  const realPath = await validateRoot(rootPath);
  const sourceId = sourceIdFor(realPath);
  const source = {
    id: sourceId,
    name: String(name || path.basename(realPath) || sourceId).trim().slice(0, 120),
    rootPath: realPath,
    recursive: recursive !== false,
    createdAt: new Date().toISOString(),
    lastScanAt: null,
    lastScanSummary: null
  };
  await stateStore.mutate((state) => {
    const prior = state.sources[sourceId];
    state.sources[sourceId] = { ...prior, ...source, createdAt: prior && prior.createdAt || source.createdAt };
    stateStore.appendAudit(state, { action: 'source-upsert', sourceId, rootPath: realPath });
  });
  return source;
}

async function removeSource(sourceId) {
  await stateStore.mutate((state) => {
    if (!state.sources[sourceId]) return;
    delete state.sources[sourceId];
    for (const [itemId, item] of Object.entries(state.localItems)) if (item.sourceId === sourceId) delete state.localItems[itemId];
    for (const [itemId] of Object.entries(state.matches)) if (!state.localItems[itemId]) delete state.matches[itemId];
    stateStore.appendAudit(state, { action: 'source-remove', sourceId });
  });
}

async function listSources() {
  const state = await stateStore.load();
  return Object.values(state.sources || {}).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

async function walk(rootPath, recursive) {
  const result = [];
  async function visit(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (recursive) await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(full);
    }
  }
  await visit(rootPath);
  return result;
}

async function scanSource(sourceId, config) {
  const state = await stateStore.load();
  const source = state.sources[sourceId];
  if (!source) throw Object.assign(new Error('Raiz de acervo nao encontrada.'), { statusCode: 404 });
  const realRoot = await validateRoot(source.rootPath);
  if (realRoot !== source.rootPath) throw Object.assign(new Error('A raiz cadastrada mudou de destino fisico. Cadastre novamente antes de varrer.'), { statusCode: 409 });
  const files = await walk(realRoot, source.recursive !== false);
  const scannedAt = new Date().toISOString();
  const seen = new Set();
  const items = [];

  for (const filePath of files) {
    const relativePath = path.relative(realRoot, filePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
    const id = stableItemId(sourceId, relativePath);
    let details;
    try { details = await identity.inspect(filePath, config); }
    catch (error) { details = { scanError: error.message, size: 0, mtimeMs: 0, duration: null, inferredTitle: path.basename(filePath, path.extname(filePath)), inferredArtist: 'Outros', recoveredVideoId: '', matchSource: '' }; }
    const item = {
      id,
      sourceId,
      relativePath,
      path: filePath,
      filename: path.basename(filePath),
      present: true,
      scannedAt,
      ...details,
      status: details.scanError ? 'scan-error' : (details.recoveredVideoId ? 'recovered' : 'unmatched')
    };
    seen.add(id);
    items.push(item);
  }

  const summary = await stateStore.mutate((current) => {
    for (const item of items) {
      const previous = current.localItems[item.id] || {};
      const changed = Number(previous.size) !== Number(item.size) || Number(previous.mtimeMs) !== Number(item.mtimeMs);
      current.localItems[item.id] = { ...previous, ...item, changedSinceMatch: Boolean(changed && current.matches[item.id]) };
    }
    let missing = 0;
    for (const item of Object.values(current.localItems)) {
      if (item.sourceId !== sourceId || seen.has(item.id)) continue;
      item.present = false;
      item.missingSince = item.missingSince || scannedAt;
      missing += 1;
    }
    const identified = items.filter((item) => item.recoveredVideoId).length;
    const scanErrors = items.filter((item) => item.scanError).length;
    const value = { files: items.length, recoveredIds: identified, scanErrors, missing, scannedAt };
    current.sources[sourceId] = { ...current.sources[sourceId], lastScanAt: scannedAt, lastScanSummary: value };
    stateStore.appendAudit(current, { action: 'source-scan', sourceId, files: items.length, recoveredIds: identified, scanErrors, missing });
    return value;
  });
  return summary;
}

function matchesFilter(item, match, filters) {
  const status = String(filters.status || 'all');
  const effective = match && match.status || item.status || 'unmatched';
  if (status !== 'all' && effective !== status) return false;
  if (filters.sourceId && item.sourceId !== filters.sourceId) return false;
  if (filters.present === 'true' && item.present === false) return false;
  const q = String(filters.q || '').trim().toLowerCase();
  if (q) {
    const haystack = [item.filename, item.relativePath, item.inferredArtist, item.inferredTitle, item.recoveredVideoId, match && match.videoId].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

async function listItems(filters = {}) {
  const state = await stateStore.load();
  const all = Object.values(state.localItems || {})
    .map((item) => ({ ...item, match: state.matches[item.id] || null }))
    .filter((item) => matchesFilter(item, item.match, filters))
    .sort((a, b) => String(a.relativePath).localeCompare(String(b.relativePath), 'pt-BR'));
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));
  const limit = Math.max(1, Math.min(200, Math.floor(Number(filters.limit) || 100)));
  return { items: all.slice(offset, offset + limit), total: all.length, offset, limit, hasMore: offset + limit < all.length };
}

async function getItem(itemId) {
  const state = await stateStore.load();
  const item = state.localItems[itemId];
  if (!item) return null;
  return { ...item, match: state.matches[itemId] || null, source: state.sources[item.sourceId] || null };
}

module.exports = { MEDIA_EXTENSIONS, stableItemId, sourceIdFor, validateRoot, addSource, removeSource, listSources, scanSource, listItems, getItem };
