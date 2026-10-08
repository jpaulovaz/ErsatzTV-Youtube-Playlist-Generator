const crypto = require('crypto');
const logger = require('../logger');
const { findDestinationById } = require('../destinationService');
const translationConfig = require('./translationConfig');
const stateStore = require('./translationState');
const service = require('./translationService');

let runtime = null;
let state = null;
let pumpPromise = null;
let stopping = false;

function nowIso() { return new Date().toISOString(); }

function configure(nextRuntime) { runtime = nextRuntime; }

async function ensureState() {
  if (state) return state;
  state = await stateStore.load();
  let changed = false;
  for (const job of Object.values(state.jobs || {})) {
    if (job.status === 'running') { job.status = 'paused'; job.pauseReason = 'restart'; changed = true; }
    for (const item of job.items || []) {
      if (item.status === 'running') { item.status = 'pending'; item.startedAt = null; changed = true; }
    }
  }
  if (state.activeJobId && (!state.jobs[state.activeJobId] || ['completed', 'cancelled'].includes(state.jobs[state.activeJobId].status))) {
    state.activeJobId = null; changed = true;
  }
  if (changed) { state.paused = true; await stateStore.save(state); }
  await stateStore.cleanupOldCheckpoints().catch(() => {});
  return state;
}

function jobCounts(job) {
  const counts = { total: 0, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, cancelled: 0 };
  for (const item of job.items || []) { counts.total += 1; counts[item.status] = (counts[item.status] || 0) + 1; }
  return counts;
}

async function persist() {
  if (!state) return;
  for (const job of Object.values(state.jobs || {})) job.counts = jobCounts(job);
  const saved = await stateStore.save(state);
  state.updatedAt = saved.updatedAt;
}

function publicJob(job) {
  if (!job) return null;
  const failed = (job.items || []).filter((item) => item.status === 'failed').slice(-20).map((item) => ({ itemId: item.itemId, title: item.title, error: item.error, code: item.code || null }));
  const running = (job.items || []).find((item) => item.status === 'running') || null;
  return {
    ...job,
    items: undefined,
    counts: jobCounts(job),
    failures: failed,
    currentItem: running ? { itemId: running.itemId, title: running.title, startedAt: running.startedAt || null } : null
  };
}

async function getStatus() {
  await ensureState();
  const jobs = Object.values(state.jobs || {}).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 10).map(publicJob);
  return { version: stateStore.STATE_VERSION, paused: Boolean(state.paused), activeJobId: state.activeJobId || null, activeJob: publicJob(state.activeJobId ? state.jobs[state.activeJobId] : null), jobs };
}

async function startJob(plan) {
  await ensureState();
  if (!runtime || !runtime.getConfig || !runtime.downloadManager) throw new Error('Fila de traducao ainda nao foi inicializada.');
  const id = crypto.randomUUID();
  const job = {
    id, destinationId: plan.destinationId, destinationType: plan.destinationType || '', destinationName: plan.destinationName || plan.destinationId,
    channelId: plan.channelId || null, playlistId: plan.playlistId || null,
    status: state.paused ? 'paused' : 'queued', createdAt: nowIso(), startedAt: null, completedAt: null,
    options: { sourceLanguage: plan.sourceLanguage, targetLanguage: plan.targetLanguage, outputMode: plan.outputMode, existingPolicy: plan.existingPolicy },
    scope: plan.scope, filter: plan.filter || {}, totals: plan.totals || {},
    cancelRequested: false,
    items: (plan.eligibleItems || []).map((item) => ({ itemId: item.itemId, title: item.title, status: 'pending', error: null, code: null, startedAt: null, completedAt: null }))
  };
  state.jobs[id] = job;
  if (!state.activeJobId) state.activeJobId = id;
  await persist();
  schedulePump();
  return publicJob(job);
}

function nextRunnableJob() {
  if (state.activeJobId) {
    const current = state.jobs[state.activeJobId];
    if (current && !['completed', 'cancelled'].includes(current.status)) return current;
  }
  const next = Object.values(state.jobs || {}).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).find((job) => ['queued', 'paused', 'running'].includes(job.status) && (job.items || []).some((item) => item.status === 'pending'));
  state.activeJobId = next ? next.id : null;
  return next || null;
}

async function processItem(job, itemEntry, destination) {
  itemEntry.status = 'running'; itemEntry.startedAt = nowIso(); itemEntry.error = null; itemEntry.code = null;
  job.status = 'running'; if (!job.startedAt) job.startedAt = nowIso();
  await persist();
  try {
    const result = await service.translateItem({ jobId: job.id, destination, downloadManager: runtime.downloadManager, itemId: itemEntry.itemId, options: job.options });
    itemEntry.status = result && result.skipped ? 'skipped' : 'completed';
    itemEntry.result = result || null;
  } catch (error) {
    itemEntry.status = 'failed'; itemEntry.error = String(error.message || error).slice(0, 1200); itemEntry.code = error.code || null;
    await logger.warn('Falha ao traduzir legenda.', { destinationId: job.destinationId, itemId: itemEntry.itemId, code: itemEntry.code, error: itemEntry.error });
  }
  itemEntry.completedAt = nowIso();
  await persist();
}

async function pump() {
  await ensureState();
  if (stopping || state.paused) return;
  const job = nextRunnableJob();
  if (!job) { await persist(); return; }
  if (job.status === 'paused') job.status = 'queued';
  const config = await runtime.getConfig();
  const destination = findDestinationById(config, job.destinationId, { includeDisabled: true });
  if (!destination) {
    job.status = 'paused'; job.pauseReason = 'destination-missing'; state.paused = true; await persist(); return;
  }
  const providerConfig = await translationConfig.load();
  const concurrency = Math.max(1, Math.min(3, Number(providerConfig.concurrency) || 1));
  const workers = Array.from({ length: concurrency }, async () => {
    while (!stopping && !state.paused) {
      const item = (job.items || []).find((entry) => entry.status === 'pending');
      if (!item) return;
      await processItem(job, item, destination);
    }
  });
  await Promise.all(workers);
  if ((job.items || []).every((item) => ['completed', 'failed', 'skipped', 'cancelled'].includes(item.status))) {
    job.status = job.cancelRequested ? 'cancelled' : 'completed'; job.completedAt = nowIso(); job.pauseReason = null;
    state.activeJobId = null;
    await persist();
    schedulePump();
  } else if (state.paused) {
    job.status = 'paused'; await persist();
  }
}

function schedulePump() {
  if (pumpPromise || stopping) return;
  pumpPromise = Promise.resolve().then(pump).catch((error) => logger.error(`Fila de traducao falhou: ${error.message}`)).finally(() => { pumpPromise = null; });
}

async function pause() {
  await ensureState(); state.paused = true;
  const job = state.activeJobId ? state.jobs[state.activeJobId] : null;
  if (job && job.status !== 'completed') job.status = 'paused';
  await persist(); return getStatus();
}

async function resume() {
  await ensureState(); stopping = false; state.paused = false;
  const job = state.activeJobId ? state.jobs[state.activeJobId] : null;
  if (job && job.status === 'paused') job.status = 'queued';
  await persist(); schedulePump(); return getStatus();
}

async function cancel(jobId = '') {
  await ensureState();
  const id = String(jobId || state.activeJobId || '').trim();
  const job = id ? state.jobs[id] : null;
  if (!job) return getStatus();
  job.cancelRequested = true;
  for (const item of job.items || []) if (item.status === 'pending') item.status = 'cancelled';
  if ((job.items || []).every((item) => item.status !== 'running' && item.status !== 'pending')) { job.status = 'cancelled'; job.completedAt = nowIso(); if (state.activeJobId === id) state.activeJobId = null; }
  await persist(); schedulePump(); return getStatus();
}

async function init() { await ensureState(); schedulePump(); return getStatus(); }
async function stop() { stopping = true; await ensureState(); state.paused = true; const job = state.activeJobId ? state.jobs[state.activeJobId] : null; if (job && job.status === 'running') job.status = 'paused'; await persist(); }

module.exports = { configure, init, stop, getStatus, startJob, pause, resume, cancel };
