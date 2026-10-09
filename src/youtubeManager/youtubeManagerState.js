const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('../config');

const STATE_VERSION = 1;
const STATE_PATH = process.env.ERSATZTV_YOUTUBE_MANAGER_STATE_PATH
  ? path.resolve(process.env.ERSATZTV_YOUTUBE_MANAGER_STATE_PATH)
  : path.join(ROOT_DIR, 'data', 'youtube-manager-state.json');
let saveChain = Promise.resolve();
let mutateChain = Promise.resolve();

function emptyState() {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    sources: {},
    localItems: {},
    matches: {},
    searchCache: {},
    playlistQueue: {
      paused: false,
      activeJobId: null,
      jobs: {}
    },
    quotaUsage: {},
    accountSummary: null,
    audit: []
  };
}

function normalizeState(raw) {
  const base = emptyState();
  const value = raw && typeof raw === 'object' ? raw : {};
  if (Number(value.version) !== STATE_VERSION) return base;
  return {
    ...base,
    ...value,
    version: STATE_VERSION,
    sources: value.sources && typeof value.sources === 'object' ? value.sources : {},
    localItems: value.localItems && typeof value.localItems === 'object' ? value.localItems : {},
    matches: value.matches && typeof value.matches === 'object' ? value.matches : {},
    searchCache: value.searchCache && typeof value.searchCache === 'object' ? value.searchCache : {},
    playlistQueue: {
      ...base.playlistQueue,
      ...(value.playlistQueue && typeof value.playlistQueue === 'object' ? value.playlistQueue : {}),
      jobs: value.playlistQueue && value.playlistQueue.jobs && typeof value.playlistQueue.jobs === 'object'
        ? value.playlistQueue.jobs
        : {}
    },
    quotaUsage: value.quotaUsage && typeof value.quotaUsage === 'object' ? value.quotaUsage : {},
    audit: Array.isArray(value.audit) ? value.audit.slice(-1000) : []
  };
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, filePath);
}

async function load() {
  try {
    return normalizeState(JSON.parse(await fs.readFile(STATE_PATH, 'utf8')));
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
  const normalized = normalizeState({ ...state, version: STATE_VERSION });
  normalized.updatedAt = new Date().toISOString();
  const snapshot = JSON.parse(JSON.stringify(normalized));
  saveChain = saveChain.catch(() => {}).then(() => atomicWriteJson(STATE_PATH, snapshot));
  await saveChain;
  return snapshot;
}


async function mutate(mutator) {
  let result;
  mutateChain = mutateChain.catch(() => {}).then(async () => {
    const state = await load();
    result = await mutator(state);
    await save(state);
  });
  await mutateChain;
  return result;
}

function appendAudit(state, entry) {
  const target = state || emptyState();
  if (!Array.isArray(target.audit)) target.audit = [];
  target.audit.push({ at: new Date().toISOString(), ...entry });
  if (target.audit.length > 1000) target.audit.splice(0, target.audit.length - 1000);
  return target;
}

function pruneSearchCache(state, { maxEntries = 500, now = Date.now() } = {}) {
  const target = state || emptyState();
  const entries = Object.entries(target.searchCache || {})
    .filter(([, value]) => !value.expiresAt || new Date(value.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b[1].createdAt || 0).getTime() - new Date(a[1].createdAt || 0).getTime())
    .slice(0, Math.max(10, Number(maxEntries) || 500));
  target.searchCache = Object.fromEntries(entries);
  return target;
}

module.exports = {
  STATE_VERSION,
  STATE_PATH,
  emptyState,
  normalizeState,
  load,
  save,
  mutate,
  appendAudit,
  pruneSearchCache
};
