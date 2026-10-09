const crypto = require('crypto');
const stateStore = require('./youtubeAdoptionState');
const adoptionService = require('./adoptionService');

let initialized = false;
let stopped = false;
let workerPromise = null;
let wakeTimer = null;
let configProvider = null;
function nowIso() { return new Date().toISOString(); }
function jobId() { return `adoption_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }
function summarize(job) {
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const item of job && job.items || []) if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
  return counts;
}
async function init(getConfig) {
  configProvider = getConfig || configProvider;
  if (initialized) return;
  initialized = true; stopped = false;
  await stateStore.mutate((state) => {
    for (const job of Object.values(state.queue.jobs || {})) {
      for (const item of job.items || []) if (item.status === 'running') {
        item.status = job.cancelRequested ? 'cancelled' : 'pending';
        if (job.cancelRequested) item.completedAt = nowIso();
      }
      if (job.cancelRequested) job.status = 'cancelled';
      else if (job.status === 'running') job.status = 'queued';
      job.counts = summarize(job);
    }
  });
  scheduleWorker(100);
}
function scheduleWorker(delay = 0) {
  if (stopped || wakeTimer) return;
  wakeTimer = setTimeout(() => { wakeTimer = null; runWorker().catch(() => {}).finally(() => { workerPromise = null; }); }, Math.max(0, delay));
  if (wakeTimer.unref) wakeTimer.unref();
}
async function selectJob() {
  const state = await stateStore.load();
  if (state.queue.paused) return null;
  return Object.values(state.queue.jobs || {}).filter((job) => ['queued', 'running'].includes(job.status)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] || null;
}
async function patchItem(jobIdValue, itemId, patch) {
  return stateStore.mutate((state) => {
    const job = state.queue.jobs[jobIdValue]; if (!job) return null;
    const item = (job.items || []).find((entry) => entry.id === itemId); if (item) Object.assign(item, patch);
    job.updatedAt = nowIso(); job.counts = summarize(job); return JSON.parse(JSON.stringify(job));
  });
}
async function processJob(job) {
  await stateStore.mutate((state) => { state.queue.activeJobId = job.id; const live = state.queue.jobs[job.id]; if (live) { live.status = 'running'; live.startedAt = live.startedAt || nowIso(); live.updatedAt = nowIso(); } });
  while (!stopped) {
    const state = await stateStore.load(); if (state.queue.paused) return;
    const live = state.queue.jobs[job.id]; if (!live || !['queued', 'running'].includes(live.status)) return;
    const next = (live.items || []).find((item) => item.status === 'pending');
    if (!next) {
      await stateStore.mutate((current) => { const finished = current.queue.jobs[job.id]; if (!finished) return; finished.status = finished.cancelRequested ? 'cancelled' : 'completed'; finished.completedAt = nowIso(); finished.updatedAt = nowIso(); finished.counts = summarize(finished); current.queue.activeJobId = null; stateStore.appendAudit(current, { action: 'adoption-job-complete', jobId: job.id, counts: finished.counts }); });
      return;
    }
    await patchItem(job.id, next.id, { status: 'running', startedAt: nowIso(), lastError: null });
    try {
      const config = await configProvider();
      const result = await adoptionService.adopt(config, { itemId: next.itemId, destinationId: live.destinationId, mode: live.mode, confirmed: true, moveConfirmed: live.mode === 'move' });
      await patchItem(job.id, next.id, { status: 'completed', transactionId: result.transactionId, completedAt: nowIso() });
    } catch (error) {
      if (error.code === 'DOWNLOAD_BUSY') {
        await patchItem(job.id, next.id, { status: 'pending', lastError: error.message });
        await stateStore.mutate((current) => { const waiting = current.queue.jobs[job.id]; if (waiting) waiting.status = 'queued'; current.queue.activeJobId = null; });
        scheduleWorker(2000); return 'defer';
      }
      await patchItem(job.id, next.id, { status: 'failed', lastError: error.message, completedAt: nowIso() });
    }
  }
}
async function runWorker() {
  if (workerPromise || stopped || !configProvider) return workerPromise;
  workerPromise = (async () => { while (!stopped) { const job = await selectJob(); if (!job) return; const result = await processJob(job); if (result === 'defer') return; } })();
  return workerPromise;
}
async function start({ itemIds = [], destinationId = '', mode = 'hardlink', confirmed = false, moveConfirmed = false } = {}) {
  const normalizedMode = adoptionService.normalizeMode(mode);
  if (!confirmed) throw Object.assign(new Error('Confirme a adocao antes de iniciar.'), { statusCode: 409 });
  if (normalizedMode === 'move' && !moveConfirmed) throw Object.assign(new Error('Move exige confirmacao reforcada.'), { statusCode: 409 });
  const unique = [...new Set((itemIds || []).map(String).filter(Boolean))];
  if (!unique.length) throw Object.assign(new Error('Nenhum item selecionado para adocao.'), { statusCode: 400 });
  const id = jobId();
  const job = { id, destinationId: String(destinationId), mode: normalizedMode, status: 'queued', createdAt: nowIso(), updatedAt: nowIso(), cancelRequested: false, items: unique.map((itemId) => ({ id: `item_${crypto.randomBytes(8).toString('hex')}`, itemId, status: 'pending', createdAt: nowIso() })) };
  job.counts = summarize(job);
  await stateStore.mutate((state) => { state.queue.jobs[id] = job; stateStore.appendAudit(state, { action: 'adoption-job-start', jobId: id, destinationId: job.destinationId, mode: job.mode, count: unique.length }); });
  scheduleWorker(0); return job;
}
async function pause() { await stateStore.mutate((state) => { state.queue.paused = true; }); return getStatus(); }
async function resume() { await stateStore.mutate((state) => { state.queue.paused = false; }); scheduleWorker(0); return getStatus(); }
async function cancelPending(jobIdValue = '') {
  await stateStore.mutate((state) => { const targets = jobIdValue ? [state.queue.jobs[jobIdValue]].filter(Boolean) : Object.values(state.queue.jobs || {}); for (const job of targets) { job.cancelRequested = true; for (const item of job.items || []) if (item.status === 'pending') { item.status = 'cancelled'; item.completedAt = nowIso(); } const active = (job.items || []).some((item) => item.status === 'running'); job.status = active ? 'running' : 'cancelled'; job.updatedAt = nowIso(); job.counts = summarize(job); } });
  return getStatus();
}
async function getStatus() {
  const state = await stateStore.load();
  const jobs = Object.values(state.queue.jobs || {}).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const active = state.queue.activeJobId && state.queue.jobs[state.queue.activeJobId] || jobs.find((job) => ['running', 'queued'].includes(job.status)) || null;
  return { paused: Boolean(state.queue.paused), activeJobId: state.queue.activeJobId, activeJob: active ? { ...active, counts: summarize(active) } : null, latestJob: jobs[0] ? { ...jobs[0], counts: summarize(jobs[0]) } : null, jobs: jobs.slice(0, 20).map((job) => ({ ...job, counts: summarize(job) })) };
}
async function stop() { stopped = true; if (wakeTimer) clearTimeout(wakeTimer); wakeTimer = null; if (workerPromise) await workerPromise.catch(() => {}); workerPromise = null; initialized = false; }
module.exports = { init, start, pause, resume, cancelPending, getStatus, stop, summarize };
