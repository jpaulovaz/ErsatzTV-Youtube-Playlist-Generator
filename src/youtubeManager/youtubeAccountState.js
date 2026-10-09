const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('../config');

const STATE_VERSION = 1;
const STATE_PATH = process.env.ERSATZTV_YOUTUBE_ACCOUNT_STATE_PATH
  ? path.resolve(process.env.ERSATZTV_YOUTUBE_ACCOUNT_STATE_PATH)
  : path.join(ROOT_DIR, 'data', 'youtube-account-state.json');
let saveChain = Promise.resolve();

function emptyState() {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    tokens: null,
    scopes: [],
    account: null,
    pendingAuth: null,
    lastError: null
  };
}

function normalize(raw) {
  const base = emptyState();
  const value = raw && typeof raw === 'object' ? raw : {};
  if (Number(value.version) !== STATE_VERSION) return base;
  return {
    ...base,
    ...value,
    version: STATE_VERSION,
    scopes: Array.isArray(value.scopes) ? value.scopes.map((x) => String(x)) : []
  };
}

async function atomicWrite(value) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temp = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(temp, 0o600).catch(() => {});
  await fs.rename(temp, STATE_PATH);
  await fs.chmod(STATE_PATH, 0o600).catch(() => {});
}

async function load() {
  try {
    return normalize(JSON.parse(await fs.readFile(STATE_PATH, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    if (error instanceof SyntaxError) {
      await fs.rename(STATE_PATH, `${STATE_PATH}.invalid-${Date.now()}`).catch(() => {});
      return emptyState();
    }
    throw error;
  }
}

async function save(state) {
  const snapshot = normalize(state);
  snapshot.updatedAt = new Date().toISOString();
  saveChain = saveChain.catch(() => {}).then(() => atomicWrite(snapshot));
  await saveChain;
  return snapshot;
}

async function clear() {
  const state = emptyState();
  await save(state);
  return state;
}

module.exports = { STATE_VERSION, STATE_PATH, emptyState, normalize, load, save, clear };
