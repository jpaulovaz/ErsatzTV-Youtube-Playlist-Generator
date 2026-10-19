const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('../config');

const STATE_VERSION = 1;
const DATA_ROOT = process.env.ERSATZTV_SUBTITLE_WORKSPACE_DIR
  ? path.resolve(process.env.ERSATZTV_SUBTITLE_WORKSPACE_DIR)
  : path.join(ROOT_DIR, 'data');
const STATE_PATH = path.join(DATA_ROOT, 'subtitle-workspace-state.json');
let saveChain = Promise.resolve();

function emptyState() {
  return { version: STATE_VERSION, updatedAt: null, workspaces: {} };
}

function normalizeItem(item = {}) {
  return {
    id: String(item.id || ''),
    relativePath: String(item.relativePath || ''),
    fileName: String(item.fileName || ''),
    sizeBytes: Number(item.sizeBytes) || 0,
    mtimeMs: Number(item.mtimeMs) || 0,
    sidecars: Array.isArray(item.sidecars) ? item.sidecars : [],
    reviewStatus: item.reviewStatus === 'reviewed' ? 'reviewed' : 'unreviewed',
    reviewedAt: item.reviewedAt || null,
    lastSeenAt: item.lastSeenAt || null,
    probe: item.probe && typeof item.probe === 'object' ? item.probe : null,
    bazarr: item.bazarr && typeof item.bazarr === 'object' ? item.bazarr : null
  };
}

function normalizeWorkspace(workspace = {}) {
  const items = {};
  for (const [id, item] of Object.entries(workspace.items || {})) {
    const normalized = normalizeItem({ ...item, id: item.id || id });
    if (normalized.id && normalized.relativePath) items[normalized.id] = normalized;
  }
  return {
    id: String(workspace.id || ''),
    name: String(workspace.name || ''),
    rootPath: String(workspace.rootPath || ''),
    recursive: workspace.recursive !== false,
    createdAt: workspace.createdAt || null,
    updatedAt: workspace.updatedAt || null,
    lastScanAt: workspace.lastScanAt || null,
    scanSummary: workspace.scanSummary && typeof workspace.scanSummary === 'object' ? workspace.scanSummary : null,
    items
  };
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function load() {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
    if (!parsed || Number(parsed.version) !== STATE_VERSION || !parsed.workspaces || typeof parsed.workspaces !== 'object') return emptyState();
    const state = emptyState();
    state.updatedAt = parsed.updatedAt || null;
    for (const [id, workspace] of Object.entries(parsed.workspaces)) {
      const normalized = normalizeWorkspace({ ...workspace, id: workspace.id || id });
      if (normalized.id && normalized.rootPath) state.workspaces[normalized.id] = normalized;
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    if (error instanceof SyntaxError) {
      await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
      await fs.rename(STATE_PATH, `${STATE_PATH}.invalid-${Date.now()}`).catch(() => {});
      return emptyState();
    }
    throw error;
  }
}

async function save(state) {
  const snapshot = JSON.parse(JSON.stringify(state || emptyState()));
  snapshot.version = STATE_VERSION;
  snapshot.updatedAt = new Date().toISOString();
  saveChain = saveChain.catch(() => {}).then(() => atomicWriteJson(STATE_PATH, snapshot));
  await saveChain;
  return snapshot;
}

module.exports = { STATE_VERSION, DATA_ROOT, STATE_PATH, emptyState, load, save, normalizeWorkspace, normalizeItem };
