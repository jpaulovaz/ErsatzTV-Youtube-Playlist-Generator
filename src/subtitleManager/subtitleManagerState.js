const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('../config');

const STATE_VERSION = 1;
const DATA_ROOT = process.env.ERSATZTV_SUBTITLE_MANAGER_DIR
  ? path.resolve(process.env.ERSATZTV_SUBTITLE_MANAGER_DIR)
  : path.join(ROOT_DIR, 'data');
const STATE_PATH = path.join(DATA_ROOT, 'subtitle-manager-state.json');
const HISTORY_DIR = path.join(DATA_ROOT, 'subtitle-history');
const PREVIEW_DIR = path.join(DATA_ROOT, '.subtitle-preview');

let saveChain = Promise.resolve();

function emptyState() {
  return { version: STATE_VERSION, updatedAt: null, items: {} };
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function load() {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
    if (!parsed || parsed.version !== STATE_VERSION || !parsed.items || typeof parsed.items !== 'object') return emptyState();
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    if (error instanceof SyntaxError) {
      await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
      const invalidPath = `${STATE_PATH}.invalid-${Date.now()}`;
      await fs.rename(STATE_PATH, invalidPath).catch(() => {});
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

function ensureItem(state, itemId) {
  if (!state.items[itemId] || typeof state.items[itemId] !== 'object') {
    state.items[itemId] = { tracks: {}, history: {} };
  }
  const item = state.items[itemId];
  if (!item.tracks || typeof item.tracks !== 'object') item.tracks = {};
  if (!item.history || typeof item.history !== 'object') item.history = {};
  return item;
}

module.exports = {
  STATE_VERSION,
  DATA_ROOT,
  STATE_PATH,
  HISTORY_DIR,
  PREVIEW_DIR,
  emptyState,
  load,
  save,
  ensureItem,
  atomicWriteJson
};
