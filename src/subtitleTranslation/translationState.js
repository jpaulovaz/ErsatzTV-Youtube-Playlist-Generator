const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('../config');

const STATE_VERSION = 1;
const DATA_ROOT = process.env.ERSATZTV_SUBTITLE_TRANSLATION_DIR
  ? path.resolve(process.env.ERSATZTV_SUBTITLE_TRANSLATION_DIR)
  : path.join(ROOT_DIR, 'data');
const STATE_PATH = path.join(DATA_ROOT, 'subtitle-translation-state.json');
const JOBS_DIR = path.join(DATA_ROOT, 'subtitle-translation-jobs');
let saveChain = Promise.resolve();

function emptyState() {
  return { version: STATE_VERSION, updatedAt: null, paused: false, activeJobId: null, jobs: {} };
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, filePath);
}

async function load() {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
    if (!parsed || parsed.version !== STATE_VERSION || !parsed.jobs || typeof parsed.jobs !== 'object') return emptyState();
    return parsed;
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
  const snapshot = JSON.parse(JSON.stringify(state || emptyState()));
  snapshot.version = STATE_VERSION;
  snapshot.updatedAt = new Date().toISOString();
  saveChain = saveChain.catch(() => {}).then(() => atomicWriteJson(STATE_PATH, snapshot));
  await saveChain;
  return snapshot;
}

function checkpointPath(jobId, itemId) {
  const safeJob = String(jobId || '').replace(/[^A-Za-z0-9._-]/g, '_');
  const safeItem = String(itemId || '').replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(JOBS_DIR, safeJob, `${safeItem}.json`);
}

async function loadCheckpoint(jobId, itemId) {
  try { return JSON.parse(await fs.readFile(checkpointPath(jobId, itemId), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function saveCheckpoint(jobId, itemId, value) {
  await atomicWriteJson(checkpointPath(jobId, itemId), value);
}

async function cleanupOldCheckpoints(retentionDays = 7) {
  const cutoff = Date.now() - Math.max(1, Number(retentionDays) || 7) * 86400000;
  let dirs = [];
  try { dirs = await fs.readdir(JOBS_DIR, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(JOBS_DIR, dir.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.rm(full, { recursive: true, force: true });
  }
}

module.exports = { STATE_VERSION, STATE_PATH, JOBS_DIR, emptyState, load, save, checkpointPath, loadCheckpoint, saveCheckpoint, cleanupOldCheckpoints };
