const crypto = require('crypto');
const stateStore = require('./youtubeManagerState');
const playlistService = require('./youtubePlaylistService');

let initialized = false;
let stopped = false;
let workerPromise = null;
let wakeTimer = null;

function nowIso() { return new Date().toISOString(); }
function jobId() { return `playlist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }

function summarize(job) {
  const counts = { pending: 0, running: 0, completed: 0, skipped: 0, failed: 0, cancelled: 0 };
  for (const item of job && job.items || []) {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
  }
  return counts;
}

async function init() {
  if (initialized) return;
  initialized = true;
  stopped = false;
  await stateStore.mutate((state) => {
    for (const job of Object.values(state.playlistQueue.jobs || {})) {
      if (job.cancelRequested) {
        for (const item of job.items || []) if (['running', 'pending'].includes(item.status)) item.status = 'cancelled';
        job.status = 'cancelled';
        job.updatedAt = nowIso();
        job.counts = summarize(job);
        continue;
      }
      for (const item of job.items || []) if (item.status === 'running') item.status = 'pending';
      if (job.status === 'running') job.status = 'queued';
    }
  });
  scheduleWorker(50);
}

function scheduleWorker(delay = 0) {
  if (stopped || wakeTimer) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    runWorker().catch(() => {}).finally(() => {
      workerPromise = null;
    });
  }, Math.max(0, delay));
  if (typeof wakeTimer.unref === 'function') wakeTimer.unref();
}

async function selectJob() {
  const state = await stateStore.load();
  if (state.playlistQueue.paused) return null;
  const jobs = Object.values(state.playlistQueue.jobs || {})
    .filter((job) => ['queued', 'running'].includes(job.status))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return jobs[0] || null;
}

async function setItem(jobIdValue, itemId, patch, jobPatch = {}) {
  return stateStore.mutate((state) => {
    const job = state.playlistQueue.jobs[jobIdValue];
    if (!job) return null;
    const item = (job.items || []).find((entry) => entry.id === itemId);
    if (item) Object.assign(item, patch);
    Object.assign(job, jobPatch);
    job.updatedAt = nowIso();
    job.counts = summarize(job);
    return JSON.parse(JSON.stringify(job));
  });
}

function quotaError(error) {
  return error && (error.status === 403 || error.statusCode === 403) && /quota|daily/i.test(`${error.reason || ''} ${error.code || ''} ${error.message || ''}`);
}

async function processJob(job) {
  await stateStore.mutate((state) => {
    state.playlistQueue.activeJobId = job.id;
    const live = state.playlistQueue.jobs[job.id];
    if (live) { live.status = 'running'; live.startedAt = live.startedAt || nowIso(); live.updatedAt = nowIso(); }
  });

  let index;
  try { index = await playlistService.getIndex(job.playlistId); }
  catch (error) {
    await stateStore.mutate((state) => {
      const live = state.playlistQueue.jobs[job.id];
      if (live) { live.status = 'failed'; live.lastError = error.message; live.updatedAt = nowIso(); }
      state.playlistQueue.activeJobId = null;
    });
    return;
  }

  while (!stopped) {
    const state = await stateStore.load();
    if (state.playlistQueue.paused) return;
    const live = state.playlistQueue.jobs[job.id];
    if (!live || !['queued', 'running'].includes(live.status)) return;
    const next = (live.items || []).find((item) => item.status === 'pending');
    if (!next) {
      await stateStore.mutate((current) => {
        const finished = current.playlistQueue.jobs[job.id];
        if (!finished) return;
        finished.status = finished.cancelRequested ? 'cancelled' : 'completed';
        finished.completedAt = nowIso();
        finished.updatedAt = nowIso();
        finished.counts = summarize(finished);
        current.playlistQueue.activeJobId = null;
        stateStore.appendAudit(current, { action: finished.cancelRequested ? 'playlist-job-cancelled' : 'playlist-job-complete', jobId: job.id, playlistId: job.playlistId, counts: finished.counts });
      });
      return;
    }

    if (index.videoIds.has(next.videoId)) {
      await setItem(job.id, next.id, { status: 'skipped', reason: 'already-in-playlist', completedAt: nowIso() });
      continue;
    }

    await setItem(job.id, next.id, { status: 'running', startedAt: nowIso(), lastError: null });
    try {
      const inserted = await playlistService.insertVideo(job.playlistId, next.videoId);
      index.videoIds.add(next.videoId);
      await setItem(job.id, next.id, { status: 'completed', playlistItemId: inserted.playlistItemId, completedAt: nowIso() });
    } catch (error) {
      if (quotaError(error)) {
        await stateStore.mutate((current) => {
          current.playlistQueue.paused = true;
          const liveJob = current.playlistQueue.jobs[job.id];
          const liveItem = liveJob && liveJob.items.find((item) => item.id === next.id);
          if (liveItem) { liveItem.status = 'pending'; liveItem.lastError = error.message; }
          if (liveJob) { liveJob.status = 'queued'; liveJob.pauseReason = 'quota'; liveJob.lastError = error.message; liveJob.updatedAt = nowIso(); liveJob.counts = summarize(liveJob); }
          current.playlistQueue.activeJobId = null;
        });
        return;
      }
      await setItem(job.id, next.id, { status: 'failed', lastError: error.message, completedAt: nowIso() });
    }
  }
}

async function runWorker() {
  if (workerPromise || stopped) return workerPromise;
  workerPromise = (async () => {
    while (!stopped) {
      const job = await selectJob();
      if (!job) return;
      await processJob(job);
    }
  })();
  return workerPromise;
}

async function start({ playlistId, playlistTitle = '', entries = [] } = {}) {
  const normalizedEntries = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const videoId = String(entry.videoId || entry || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    normalizedEntries.push({
      id: `item_${crypto.randomBytes(8).toString('hex')}`,
      videoId,
      localItemId: entry.localItemId || null,
      title: entry.title || '',
      status: 'pending',
      createdAt: nowIso()
    });
  }
  if (!String(playlistId || '').trim()) throw Object.assign(new Error('Selecione a playlist destino.'), { statusCode: 400 });
  if (!normalizedEntries.length) throw Object.assign(new Error('Nenhum video elegivel para inserir.'), { statusCode: 400 });

  const id = jobId();
  const job = {
    id,
    playlistId: String(playlistId),
    playlistTitle: String(playlistTitle || ''),
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    pauseReason: null,
    lastError: null,
    cancelRequested: false,
    items: normalizedEntries,
    counts: { pending: normalizedEntries.length, running: 0, completed: 0, skipped: 0, failed: 0, cancelled: 0 }
  };
  await stateStore.mutate((state) => {
    state.playlistQueue.jobs[id] = job;
    stateStore.appendAudit(state, { action: 'playlist-job-start', jobId: id, playlistId: job.playlistId, count: normalizedEntries.length });
  });
  scheduleWorker(0);
  return job;
}

async function pause() {
  await stateStore.mutate((state) => { state.playlistQueue.paused = true; });
  return getStatus();
}

async function resume() {
  await stateStore.mutate((state) => {
    state.playlistQueue.paused = false;
    for (const job of Object.values(state.playlistQueue.jobs || {})) if (job.status === 'queued') job.pauseReason = null;
  });
  scheduleWorker(0);
  return getStatus();
}

async function cancelPending(jobIdValue = '') {
  await stateStore.mutate((state) => {
    const targets = jobIdValue ? [state.playlistQueue.jobs[jobIdValue]].filter(Boolean) : Object.values(state.playlistQueue.jobs || {});
    for (const job of targets) {
      job.cancelRequested = true;
      for (const item of job.items || []) if (item.status === 'pending') { item.status = 'cancelled'; item.completedAt = nowIso(); }
      const active = (job.items || []).some((item) => item.status === 'running');
      job.status = active ? 'running' : 'cancelled';
      job.updatedAt = nowIso();
      job.counts = summarize(job);
    }
  });
  return getStatus();
}

async function getStatus() {
  const state = await stateStore.load();
  const jobs = Object.values(state.playlistQueue.jobs || {}).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const active = state.playlistQueue.activeJobId && state.playlistQueue.jobs[state.playlistQueue.activeJobId] || jobs.find((job) => ['running', 'queued'].includes(job.status)) || null;
  return {
    paused: Boolean(state.playlistQueue.paused),
    activeJobId: state.playlistQueue.activeJobId,
    activeJob: active ? { ...active, counts: summarize(active) } : null,
    latestJob: jobs[0] ? { ...jobs[0], counts: summarize(jobs[0]) } : null,
    jobs: jobs.slice(0, 20).map((job) => ({ ...job, counts: summarize(job) }))
  };
}

async function stop() {
  stopped = true;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  if (workerPromise) await workerPromise.catch(() => {});
  workerPromise = null;
  initialized = false;
}

module.exports = { init, start, pause, resume, cancelPending, getStatus, stop, summarize, quotaError };
