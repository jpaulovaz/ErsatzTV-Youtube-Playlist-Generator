const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('../config');

const STATE_VERSION = 1;
const STATE_PATH = process.env.ERSATZTV_YOUTUBE_ADOPTION_STATE_PATH
  ? path.resolve(process.env.ERSATZTV_YOUTUBE_ADOPTION_STATE_PATH)
  : path.join(ROOT_DIR, 'data', 'youtube-adoption-state.json');
let saveChain = Promise.resolve();
let mutateChain = Promise.resolve();

function nowIso() { return new Date().toISOString(); }

function emptyState() {
  return {
    version: STATE_VERSION,
    updatedAt: null,
    transactions: {},
    queue: { paused: false, activeJobId: null, jobs: {} },
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
    transactions: value.transactions && typeof value.transactions === 'object' ? value.transactions : {},
    queue: {
      ...base.queue,
      ...(value.queue && typeof value.queue === 'object' ? value.queue : {}),
      jobs: value.queue && value.queue.jobs && typeof value.queue.jobs === 'object' ? value.queue.jobs : {}
    },
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
  normalized.updatedAt = nowIso();
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
  if (!Array.isArray(state.audit)) state.audit = [];
  state.audit.push({ at: nowIso(), ...entry });
  if (state.audit.length > 1000) state.audit.splice(0, state.audit.length - 1000);
}

module.exports = { STATE_VERSION, STATE_PATH, emptyState, normalizeState, load, save, mutate, appendAudit };
