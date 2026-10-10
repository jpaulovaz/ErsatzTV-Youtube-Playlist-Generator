const crypto = require('crypto');
const stateStore = require('./youtubeManagerState');
const playlistService = require('./youtubePlaylistService');

let initialized = false;
let stopped = false;
let workerPromise = null;
let wakeTimer = null;

function nowIso() { return new Date().toISOString(); }
function jobId() { return `playlist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`; }

function publicPlaylistStatus(item) {
  if (!item) return '';
  if (item.status === 'completed') return 'added';
  if (item.status === 'skipped' && item.reason === 'already-in-playlist') return 'already-existing';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status === 'running') return 'running';
  if (item.status === 'pending') return 'queued';
  return String(item.status || '');
}

function syncLocalPlaylistState(state, job, item) {
  if (!job || !item || !item.localItemId) return null;
  const status = publicPlaylistStatus(item);
  const updatedAt = item.completedAt || item.startedAt || job.updatedAt || nowIso();
  const patch = {
    playlistTitle: job.playlistTitle || job.playlistId,
    status,
    jobId: job.id,
    playlistItemId: item.playlistItemId || '',
    reason: item.reason || '',
    lastError: item.lastError || '',
    createdAt: item.createdAt || job.createdAt || null,
    startedAt: item.startedAt || null,
    completedAt: item.completedAt || null,
    updatedAt
  };
  if (['added', 'already-existing'].includes(status)) {
    patch.verifiedPresent = true;
    patch.checkedAt = updatedAt;
  }
  return stateStore.setLocalPlaylistState(state, item.localItemId, job.playlistId, patch);
}

function summarize(job) {
  const counts = { pending: 0, running: 0, completed: 0, skipped: 0, failed: 0, cancelled: 0 };
  for (const item of job && job.items || []) {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
  }
  return counts;
}

function errorText(error) {
  if (!error) return '';
  return `${error.reason || ''} ${error.code || ''} ${error.message || error || ''}`.trim();
}

function quotaError(error) {
  const status = Number(error && (error.status || error.statusCode)) || 0;
  return /quota|daily/i.test(errorText(error)) && (!status || status === 403 || status === 429);
}

function authError(error) {
  const status = Number(error && (error.status || error.statusCode)) || 0;
  return status === 401 || /YOUTUBE_RECONNECT_REQUIRED|YOUTUBE_ACCOUNT_NOT_CONNECTED|insufficientPermissions|auth/i.test(errorText(error));
}

function playlistUnavailableError(error) {
  const status = Number(error && (error.status || error.statusCode)) || 0;
  return status === 404 || /playlistNotFound|playlist[^\n]*(not found|removed|deleted)/i.test(errorText(error));
}

function transientError(error) {
  const status = Number(error && (error.status || error.statusCode)) || 0;
  return status >= 500 || /YOUTUBE_ACCOUNT_(NETWORK|TIMEOUT)|timeout|network/i.test(errorText(error));
}

function operationalPauseReason(error) {
  if (quotaError(error)) return 'quota';
  if (authError(error)) return 'auth';
  if (playlistUnavailableError(error)) return 'playlist';
  if (transientError(error)) return 'network';
  return '';
}

function validVideoId(value) { return /^[A-Za-z0-9_-]{11}$/.test(String(value || '').trim()); }

function itemIdentityVideoId(state, item) {
  const match = state.matches && state.matches[item.id];
  if (match && match.status === 'confirmed' && validVideoId(match.videoId)) return match.videoId;
  return validVideoId(item.recoveredVideoId) ? item.recoveredVideoId : '';
}

async function init() {
  if (initialized) return;
  initialized = true;
  stopped = false;
  await stateStore.mutate((state) => {
    let recoveredQuotaJob = false;
    for (const job of Object.values(state.playlistQueue.jobs || {})) {
      if (job.cancelRequested) {
        for (const item of job.items || []) {
          if (['running', 'pending'].includes(item.status)) { item.status = 'cancelled'; item.completedAt = item.completedAt || nowIso(); }
          syncLocalPlaylistState(state, job, item);
        }
        job.status = 'cancelled';
        job.updatedAt = nowIso();
        job.counts = summarize(job);
        continue;
      }

      const legacyQuotaFailure = job.status === 'failed' && quotaError({ message: job.lastError || '' });
      if (legacyQuotaFailure) {
        let recoverable = 0;
        for (const item of job.items || []) {
          if (item.status === 'running' || item.status === 'pending' || (item.status === 'failed' && quotaError({ message: item.lastError || job.lastError || '' }))) {
            item.status = 'pending';
            item.completedAt = null;
            item.reason = '';
            recoverable += 1;
          }
          syncLocalPlaylistState(state, job, item);
        }
        if (recoverable) {
          job.status = 'queued';
          job.pauseReason = 'quota';
          job.completedAt = null;
          job.recoveredAt = nowIso();
          job.updatedAt = nowIso();
          job.counts = summarize(job);
          recoveredQuotaJob = true;
          stateStore.appendAudit(state, { action: 'playlist-job-recovered', jobId: job.id, playlistId: job.playlistId, reason: 'quota', pending: job.counts.pending });
          continue;
        }
      }

      for (const item of job.items || []) {
        if (item.status === 'running') item.status = 'pending';
        syncLocalPlaylistState(state, job, item);
      }
      if (job.status === 'running') job.status = 'queued';
      job.counts = summarize(job);
    }
    if (recoveredQuotaJob) {
      state.playlistQueue.paused = true;
      state.playlistQueue.activeJobId = null;
    } else if (state.playlistQueue.activeJobId) {
      const active = state.playlistQueue.jobs[state.playlistQueue.activeJobId];
      if (!active || !['queued', 'running'].includes(active.status)) state.playlistQueue.activeJobId = null;
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
    if (item) syncLocalPlaylistState(state, job, item);
    return JSON.parse(JSON.stringify(job));
  });
}

async function pauseOperational(jobIdValue, error, reason, itemId = '') {
  await stateStore.mutate((state) => {
    state.playlistQueue.paused = true;
    state.playlistQueue.activeJobId = null;
    const job = state.playlistQueue.jobs[jobIdValue];
    if (!job) return;
    const item = itemId ? (job.items || []).find((entry) => entry.id === itemId) : null;
    if (item && item.status === 'running') {
      item.status = 'pending';
      item.lastError = error.message;
      item.completedAt = null;
      syncLocalPlaylistState(state, job, item);
    }
    job.status = 'queued';
    job.pauseReason = reason;
    job.lastError = error.message;
    job.updatedAt = nowIso();
    job.counts = summarize(job);
    stateStore.appendAudit(state, { action: 'playlist-job-paused', jobId: job.id, playlistId: job.playlistId, reason, error: error.message });
  });
}

async function reconcileJobPending(jobIdValue, index, { checkedAt = nowIso() } = {}) {
  return stateStore.mutate((state) => {
    const job = state.playlistQueue.jobs[jobIdValue];
    if (!job) return { skipped: 0 };
    let skipped = 0;
    for (const item of job.items || []) {
      if (!['pending', 'running'].includes(item.status) || !index.videoIds.has(item.videoId)) continue;
      item.status = 'skipped';
      item.reason = 'already-in-playlist';
      item.lastError = '';
      item.completedAt = checkedAt;
      skipped += 1;
      syncLocalPlaylistState(state, job, item);
    }
    job.lastReconcile = { checkedAt, playlistItems: index.items.length, skippedPending: skipped };
    job.pauseReason = null;
    job.updatedAt = checkedAt;
    job.counts = summarize(job);
    return { skipped };
  });
}

async function processJob(job) {
  await stateStore.mutate((state) => {
    state.playlistQueue.activeJobId = job.id;
    const live = state.playlistQueue.jobs[job.id];
    if (live) { live.status = 'running'; live.startedAt = live.startedAt || nowIso(); live.updatedAt = nowIso(); }
  });

  let index;
  try {
    index = await playlistService.getIndex(job.playlistId);
    await reconcileJobPending(job.id, index);
  } catch (error) {
    const reason = operationalPauseReason(error);
    if (reason) {
      await pauseOperational(job.id, error, reason);
      return;
    }
    await stateStore.mutate((state) => {
      const live = state.playlistQueue.jobs[job.id];
      if (live) {
        live.status = 'failed'; live.lastError = error.message; live.updatedAt = nowIso();
        for (const item of live.items || []) {
          if (['pending', 'running'].includes(item.status)) { item.status = 'failed'; item.lastError = error.message; item.completedAt = nowIso(); }
          syncLocalPlaylistState(state, live, item);
        }
        live.counts = summarize(live);
      }
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
      const reason = operationalPauseReason(error);
      if (reason) {
        await pauseOperational(job.id, error, reason, next.id);
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
    for (const item of job.items) syncLocalPlaylistState(state, job, item);
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
      for (const item of job.items || []) {
        if (item.status === 'pending') { item.status = 'cancelled'; item.completedAt = nowIso(); }
        syncLocalPlaylistState(state, job, item);
      }
      const active = (job.items || []).some((item) => item.status === 'running');
      job.status = active ? 'running' : 'cancelled';
      job.updatedAt = nowIso();
      job.counts = summarize(job);
    }
  });
  return getStatus();
}

async function reconcile({ jobId: jobIdValue = '', playlistId = '', playlistTitle = '' } = {}) {
  const initial = await stateStore.load();
  const jobs = Object.values(initial.playlistQueue.jobs || {}).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const targetJob = jobIdValue ? initial.playlistQueue.jobs[jobIdValue] : jobs.find((job) => !playlistId || job.playlistId === playlistId);
  const pid = String(playlistId || targetJob && targetJob.playlistId || '').trim();
  const title = String(playlistTitle || targetJob && targetJob.playlistTitle || pid).trim();
  if (!pid) throw Object.assign(new Error('Selecione uma playlist para conferir com o YouTube.'), { statusCode: 400 });

  let index;
  try { index = await playlistService.getIndex(pid); }
  catch (error) {
    const reason = operationalPauseReason(error);
    if (reason && targetJob) await pauseOperational(targetJob.id, error, reason);
    throw error;
  }

  const checkedAt = nowIso();
  return stateStore.mutate((state) => {
    let catalogPresent = 0;
    let catalogMissing = 0;
    let pendingSkipped = 0;
    const matchingJobs = Object.values(state.playlistQueue.jobs || {}).filter((job) => job.playlistId === pid && (!jobIdValue || job.id === jobIdValue));

    for (const job of matchingJobs) {
      let jobSkipped = 0;
      for (const item of job.items || []) {
        if (['pending', 'running'].includes(item.status) && index.videoIds.has(item.videoId)) {
          item.status = 'skipped';
          item.reason = 'already-in-playlist';
          item.lastError = '';
          item.completedAt = checkedAt;
          pendingSkipped += 1;
          jobSkipped += 1;
          syncLocalPlaylistState(state, job, item);
        }
      }
      job.lastReconcile = { checkedAt, playlistItems: index.items.length, skippedPending: jobSkipped };
      job.updatedAt = checkedAt;
      job.counts = summarize(job);
      if (!job.counts.pending && !job.counts.running && ['queued', 'running'].includes(job.status)) {
        job.status = job.cancelRequested ? 'cancelled' : 'completed';
        job.completedAt = checkedAt;
      }
    }

    for (const item of Object.values(state.localItems || {})) {
      const videoId = itemIdentityVideoId(state, item);
      const previous = item.playlistState && item.playlistState.playlists && item.playlistState.playlists[pid];
      if (!videoId) continue;
      const present = index.videoIds.has(videoId);
      if (!present && !previous) continue;
      let status = previous && previous.status || '';
      if (present) {
        catalogPresent += 1;
        if (!status || status === 'missing' || ['failed', 'cancelled'].includes(status)) status = 'verified-present';
      } else {
        catalogMissing += 1;
        if (['added', 'already-existing', 'verified-present'].includes(status)) status = 'missing';
      }
      stateStore.setLocalPlaylistState(state, item.id, pid, {
        playlistTitle: title || previous && previous.playlistTitle || pid,
        status: status || (present ? 'verified-present' : previous && previous.status || ''),
        verifiedPresent: present,
        checkedAt,
        updatedAt: checkedAt
      });
    }

    stateStore.appendAudit(state, { action: 'playlist-reconcile', playlistId: pid, jobId: jobIdValue || null, playlistItems: index.items.length, catalogPresent, catalogMissing, pendingSkipped });
    return { playlistId: pid, playlistTitle: title, checkedAt, playlistItems: index.items.length, catalogPresent, catalogMissing, pendingSkipped };
  });
}

async function getStatus() {
  const state = await stateStore.load();
  const jobs = Object.values(state.playlistQueue.jobs || {}).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const runnable = jobs.filter((job) => ['running', 'queued'].includes(job.status)).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const active = state.playlistQueue.activeJobId && state.playlistQueue.jobs[state.playlistQueue.activeJobId] || runnable[0] || null;
  const aggregateCounts = { pending: 0, running: 0, completed: 0, skipped: 0, failed: 0, cancelled: 0 };
  let aggregateTotal = 0;
  for (const job of runnable) {
    const counts = summarize(job);
    aggregateTotal += (job.items || []).length;
    for (const key of Object.keys(aggregateCounts)) aggregateCounts[key] += counts[key] || 0;
  }
  return {
    paused: Boolean(state.playlistQueue.paused),
    activeJobId: state.playlistQueue.activeJobId,
    activeJob: active ? { ...active, counts: summarize(active) } : null,
    latestJob: jobs[0] ? { ...jobs[0], counts: summarize(jobs[0]) } : null,
    runnableJobs: runnable.length,
    aggregateCounts: runnable.length ? aggregateCounts : null,
    aggregateTotal: runnable.length ? aggregateTotal : 0,
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

module.exports = { init, start, pause, resume, cancelPending, reconcile, getStatus, stop, summarize, quotaError, operationalPauseReason, publicPlaylistStatus };
