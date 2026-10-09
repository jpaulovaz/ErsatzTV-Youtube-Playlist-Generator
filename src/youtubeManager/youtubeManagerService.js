const fs = require('fs');
const youtubeSearch = require('./youtubeSearchService');
const accountService = require('./youtubeAccountService');
const playlistService = require('./youtubePlaylistService');
const playlistQueue = require('./playlistQueue');
const localCatalog = require('./localCatalogScanner');
const stateStore = require('./youtubeManagerState');
const quotaTracker = require('./quotaTracker');
const { scoreCandidate } = require('./matchScore');
const adoptionQueue = require('./adoptionQueue');
const { fetchVideoDetails } = require('../youtubeApi');
const downloadManager = require('../downloadManager');
const { getAllDestinations } = require('../destinationService');

function queuePlaylistStatus(item) {
  if (!item) return '';
  if (item.status === 'completed') return 'added';
  if (item.status === 'skipped' && item.reason === 'already-in-playlist') return 'already-existing';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status === 'running') return 'running';
  if (item.status === 'pending') return 'queued';
  return String(item.status || '');
}

function membershipTimestamp(value) {
  const time = new Date(value && value.updatedAt || value && value.completedAt || value && value.startedAt || value && value.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergeMembership(target, membership) {
  if (!membership || !membership.playlistId) return;
  const current = target.get(membership.playlistId);
  if (!current || membershipTimestamp(membership) >= membershipTimestamp(current)) target.set(membership.playlistId, membership);
}

function buildPlaylistMembershipIndex(state) {
  const byLocalItem = new Map();
  const ensure = (itemId) => {
    if (!byLocalItem.has(itemId)) byLocalItem.set(itemId, new Map());
    return byLocalItem.get(itemId);
  };

  for (const item of Object.values(state.localItems || {})) {
    const playlists = item && item.playlistState && item.playlistState.playlists;
    if (!playlists || typeof playlists !== 'object') continue;
    for (const value of Object.values(playlists)) {
      if (!value || !value.playlistId) continue;
      mergeMembership(ensure(item.id), { ...value });
    }
  }

  const jobs = Object.values(state.playlistQueue && state.playlistQueue.jobs || {})
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  for (const job of jobs) {
    for (const item of job.items || []) {
      if (!item.localItemId) continue;
      mergeMembership(ensure(item.localItemId), {
        playlistId: job.playlistId,
        playlistTitle: job.playlistTitle || job.playlistId,
        status: queuePlaylistStatus(item),
        jobId: job.id,
        playlistItemId: item.playlistItemId || '',
        reason: item.reason || '',
        lastError: item.lastError || '',
        createdAt: item.createdAt || job.createdAt,
        startedAt: item.startedAt || null,
        completedAt: item.completedAt || null,
        updatedAt: item.completedAt || item.startedAt || job.updatedAt || job.createdAt
      });
    }
  }
  return byLocalItem;
}

async function ensureManagedState(config, manager) {
  if (!manager.initialized && typeof manager.init === 'function') await manager.init(config);
}

function buildManagedDestinationIndex(config, manager) {
  const destinationById = new Map(getAllDestinations(config, { includeDisabled: true }).map((destination) => [destination.id, destination]));
  const byVideoId = new Map();
  for (const managedItem of Object.values(manager.state && manager.state.items || {})) {
    if (!managedItem || managedItem.sourceActive === false || managedItem.suppressed) continue;
    const destinationId = String(managedItem.destinationId || managedItem.libraryFolder || '').trim();
    const destination = destinationById.get(destinationId);
    if (!destination) continue;
    const fallbackId = String(managedItem.id || '').split('::').pop();
    const videoId = String(managedItem.videoId || fallbackId || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
    let hasMedia = false;
    try { hasMedia = Boolean(managedItem.targetPath && fs.existsSync(managedItem.targetPath)); } catch {}
    const entry = {
      destinationId,
      displayName: destination.displayName,
      type: destination.type,
      mediaProfile: destination.mediaProfile,
      rootPath: destination.rootPath || '',
      enabled: destination.enabled !== false,
      managedStatus: managedItem.status || '',
      targetPath: managedItem.targetPath || '',
      hasMedia
    };
    if (!byVideoId.has(videoId)) byVideoId.set(videoId, []);
    byVideoId.get(videoId).push(entry);
  }
  for (const entries of byVideoId.values()) entries.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'pt-BR'));
  return byVideoId;
}

function catalogIdentityVideoId(item) {
  const confirmed = item.match && item.match.status === 'confirmed' ? String(item.match.videoId || '') : '';
  if (/^[A-Za-z0-9_-]{11}$/.test(confirmed)) return confirmed;
  const recovered = String(item.recoveredVideoId || '');
  return /^[A-Za-z0-9_-]{11}$/.test(recovered) ? recovered : '';
}

async function listCatalogItems(config, filters = {}, options = {}) {
  const manager = options.manager || downloadManager;
  await ensureManagedState(config, manager);
  const state = await stateStore.load();
  const managedByVideoId = buildManagedDestinationIndex(config, manager);
  const playlistByLocalItem = buildPlaylistMembershipIndex(state);

  return localCatalog.listItems(filters, {
    decorateItem(item) {
      const videoId = catalogIdentityVideoId(item);
      const adoption = item.adoptionState && typeof item.adoptionState === 'object' ? item.adoptionState : null;
      const managedDestinations = (managedByVideoId.get(videoId) || []).map((entry) => ({
        ...entry,
        adopted: Boolean(adoption && adoption.status === 'adopted' && adoption.destinationId === entry.destinationId),
        adoptionMode: adoption && adoption.destinationId === entry.destinationId ? adoption.mode || '' : ''
      }));
      const playlistMemberships = [...(playlistByLocalItem.get(item.id) || new Map()).values()]
        .sort((a, b) => String(a.playlistTitle || a.playlistId).localeCompare(String(b.playlistTitle || b.playlistId), 'pt-BR'));
      return { ...item, identityVideoId: videoId, managedDestinations, playlistMemberships };
    }
  });
}

async function getStatus() {
  const [account, sources, queue, quota, state, adoption] = await Promise.all([
    accountService.getStatus({ verify: false }),
    localCatalog.listSources(),
    playlistQueue.getStatus(),
    quotaTracker.getToday(),
    stateStore.load(),
    adoptionQueue.getStatus()
  ]);
  const counts = { total: 0, recovered: 0, confirmed: 0, probable: 0, ignored: 0, unmatched: 0, missing: 0, errors: 0, conflicts: 0 };
  const videoIdToItems = new Map();
  for (const item of Object.values(state.localItems || {})) {
    counts.total += 1;
    if (item.present === false) counts.missing += 1;
    if (item.scanError) counts.errors += 1;
    const match = state.matches[item.id];
    const effective = match && match.status || item.status || 'unmatched';
    if (effective === 'confirmed') counts.confirmed += 1;
    else if (effective === 'ignored') counts.ignored += 1;
    else if (effective === 'probable') counts.probable += 1;
    else if (item.recoveredVideoId) counts.recovered += 1;
    else counts.unmatched += 1;
    const videoId = match && match.status === 'confirmed' ? match.videoId : '';
    if (videoId) {
      if (!videoIdToItems.has(videoId)) videoIdToItems.set(videoId, []);
      videoIdToItems.get(videoId).push(item.id);
    }
  }
  counts.conflicts = [...videoIdToItems.values()].filter((ids) => ids.length > 1).reduce((total, ids) => total + ids.length, 0);
  return { account, sources, queue, quota, counts, adoption };
}

async function searchPublic(config, options) {
  return youtubeSearch.search(config, options);
}

async function searchForItem(config, { itemId, query = '', force = false, pageToken = '' } = {}) {
  const item = await localCatalog.getItem(itemId);
  if (!item) throw Object.assign(new Error('Item do acervo nao encontrado.'), { statusCode: 404 });
  if (item.present === false) throw Object.assign(new Error('O arquivo local nao esta mais presente.'), { statusCode: 409 });
  const suggestedQuery = String(query || '').trim() || (item.recoveredVideoId || [item.inferredArtist, item.inferredTitle].filter(Boolean).join(' '));
  const result = await youtubeSearch.search(config, { query: suggestedQuery, pageToken, maxResults: 10, force });
  result.results = result.results.map((candidate) => ({ ...candidate, score: scoreCandidate(item, candidate) }));
  result.results.sort((a, b) => (b.score && b.score.total || 0) - (a.score && a.score.total || 0));
  return { item, suggestedQuery, ...result };
}

async function updateMatch(config, { itemId, action, videoId = '', candidate = null } = {}) {
  const item = await localCatalog.getItem(itemId);
  if (!item) throw Object.assign(new Error('Item do acervo nao encontrado.'), { statusCode: 404 });
  const normalizedAction = String(action || '').trim();
  if (normalizedAction === 'clear') {
    await stateStore.mutate((state) => {
      delete state.matches[itemId];
      stateStore.appendAudit(state, { action: 'match-clear', itemId });
    });
    return { status: 'unmatched' };
  }
  if (normalizedAction === 'ignore') {
    const value = { itemId, status: 'ignored', videoId: '', confirmedAt: new Date().toISOString(), source: 'manual' };
    await stateStore.mutate((state) => {
      state.matches[itemId] = value;
      stateStore.appendAudit(state, { action: 'match-ignore', itemId });
    });
    return value;
  }
  if (normalizedAction !== 'confirm') throw Object.assign(new Error('Acao de correspondencia invalida.'), { statusCode: 400 });
  const vid = String(videoId || candidate && candidate.id || item.recoveredVideoId || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) throw Object.assign(new Error('Video ID invalido.'), { statusCode: 400 });
  const validated = await youtubeSearch.search(config, { query: vid, force: false });
  const remote = validated.results[0];
  if (!remote || remote.unavailable) throw Object.assign(new Error('O video selecionado nao esta disponivel na YouTube Data API.'), { statusCode: 409 });
  const score = scoreCandidate(item, remote);
  const value = {
    itemId,
    status: 'confirmed',
    videoId: vid,
    title: remote.title || '',
    channelTitle: remote.channelTitle || '',
    duration: remote.duration || null,
    thumbnailUrl: remote.thumbnailUrl || '',
    score,
    source: item.recoveredVideoId === vid ? (item.matchSource || 'recovered') : 'search',
    confirmedAt: new Date().toISOString()
  };
  await stateStore.mutate((state) => {
    state.matches[itemId] = value;
    stateStore.appendAudit(state, { action: 'match-confirm', itemId, videoId: vid, score: score.total });
  });
  return value;
}


async function confirmRecoveredItem(config, { itemId = '' } = {}) {
  const state = await stateStore.load();
  const item = state.localItems[itemId];
  if (!item) throw Object.assign(new Error('Item do acervo nao encontrado.'), { statusCode: 404, code: 'CATALOG_ITEM_NOT_FOUND' });
  if (item.present === false) throw Object.assign(new Error('O arquivo local nao esta mais presente.'), { statusCode: 409, code: 'LOCAL_FILE_MISSING' });
  const videoId = String(item.recoveredVideoId || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw Object.assign(new Error('Este item nao possui um Video ID recuperado valido.'), { statusCode: 409, code: 'RECOVERED_VIDEO_ID_REQUIRED' });

  const existing = state.matches[itemId];
  if (existing && existing.status === 'confirmed' && existing.videoId === videoId) {
    return { match: existing, alreadyConfirmed: true, warning: Boolean(existing.durationWarning), durationDifferenceSeconds: existing.score && existing.score.durationDifferenceSeconds != null ? existing.score.durationDifferenceSeconds : null, quotaUnitsUsed: 0 };
  }

  const conflicts = [];
  for (const other of Object.values(state.localItems || {})) {
    if (!other || other.id === itemId || other.present === false) continue;
    const otherMatch = state.matches[other.id];
    const otherVideoId = otherMatch && otherMatch.status === 'confirmed' ? otherMatch.videoId : other.recoveredVideoId;
    if (otherVideoId === videoId) conflicts.push(other.id);
  }
  if (conflicts.length) throw Object.assign(new Error('Este Video ID tambem esta associado a outro arquivo do acervo. Resolva o conflito antes de confirmar.'), { statusCode: 409, code: 'VIDEO_ID_CONFLICT', conflicts });

  const remote = await fetchVideoDetails(config, [videoId], { useCache: true });
  if (remote.quotaUnitsUsed) await quotaTracker.record('videosList', remote.quotaUnitsUsed, { reason: 'youtube-manager-confirm-recovered-item' });
  const remoteVideo = remote.videosById.get(videoId);
  if (!remoteVideo) throw Object.assign(new Error('O Video ID recuperado nao esta disponivel na YouTube Data API.'), { statusCode: 409, code: 'VIDEO_UNAVAILABLE' });

  const localDuration = Number(item.duration) || null;
  const remoteDuration = Number(remoteVideo.duration) || null;
  const durationDifferenceSeconds = localDuration && remoteDuration ? Math.abs(localDuration - remoteDuration) : null;
  if (durationDifferenceSeconds != null && durationDifferenceSeconds > 45) {
    throw Object.assign(new Error(`A diferenca de duracao e ${durationDifferenceSeconds}s, acima do limite de 45s. Revise manualmente este item.`), { statusCode: 409, code: 'DURATION_DIFFERENCE_BLOCKED', durationDifferenceSeconds });
  }

  const score = scoreCandidate(item, remoteVideo);
  const hasWarning = durationDifferenceSeconds != null && durationDifferenceSeconds > 10;
  const value = {
    itemId,
    status: 'confirmed',
    videoId,
    title: remoteVideo.title || '',
    channelTitle: remoteVideo.channelTitle || '',
    duration: remoteVideo.duration || null,
    thumbnailUrl: remoteVideo.thumbnailUrl || '',
    score,
    source: item.matchSource || 'recovered',
    confirmedAt: new Date().toISOString(),
    confirmationMode: 'single-recovered',
    durationWarning: hasWarning
  };
  await stateStore.mutate((current) => {
    current.matches[itemId] = value;
    stateStore.appendAudit(current, { action: 'match-confirm-recovered-item', itemId, videoId, source: value.source, score: score.total });
  });
  return { match: value, alreadyConfirmed: false, warning: hasWarning, durationDifferenceSeconds, quotaUnitsUsed: remote.quotaUnitsUsed || 0 };
}

async function confirmRecoveredMatches(config, { sourceId = '' } = {}) {
  const state = await stateStore.load();
  if (sourceId && !state.sources[sourceId]) throw Object.assign(new Error('Raiz de acervo nao encontrada.'), { statusCode: 404 });

  const localItems = Object.values(state.localItems || {}).filter((item) =>
    item && item.present !== false && (!sourceId || item.sourceId === sourceId) && /^[A-Za-z0-9_-]{11}$/.test(String(item.recoveredVideoId || ''))
  );
  const alreadyConfirmed = localItems.filter((item) => state.matches[item.id] && state.matches[item.id].status === 'confirmed').length;
  const candidates = localItems.filter((item) => !state.matches[item.id] || state.matches[item.id].status !== 'confirmed');
  if (!candidates.length) {
    return { sourceId, candidates: 0, confirmed: 0, alreadyConfirmed, blocked: 0, warnings: 0, unavailable: 0, quotaUnitsUsed: 0, details: [] };
  }

  const candidateIdsByVideo = new Map();
  for (const item of candidates) {
    const videoId = String(item.recoveredVideoId || '');
    if (!candidateIdsByVideo.has(videoId)) candidateIdsByVideo.set(videoId, []);
    candidateIdsByVideo.get(videoId).push(item.id);
  }
  const confirmedIdsByVideo = new Map();
  for (const [itemId, match] of Object.entries(state.matches || {})) {
    if (!match || match.status !== 'confirmed' || !match.videoId) continue;
    if (!confirmedIdsByVideo.has(match.videoId)) confirmedIdsByVideo.set(match.videoId, []);
    confirmedIdsByVideo.get(match.videoId).push(itemId);
  }

  const duplicateIds = new Set();
  for (const [videoId, itemIds] of candidateIdsByVideo.entries()) {
    const otherConfirmed = (confirmedIdsByVideo.get(videoId) || []).filter((itemId) => !itemIds.includes(itemId));
    if (itemIds.length > 1 || otherConfirmed.length) duplicateIds.add(videoId);
  }

  const idsToValidate = [...new Set(candidates.map((item) => item.recoveredVideoId).filter((videoId) => !duplicateIds.has(videoId)))];
  const remote = await fetchVideoDetails(config, idsToValidate, { useCache: true });
  if (remote.quotaUnitsUsed) await quotaTracker.record('videosList', remote.quotaUnitsUsed, { reason: 'youtube-manager-bulk-confirm-recovered' });

  const updates = [];
  const details = [];
  let warnings = 0;
  let unavailable = 0;
  let blocked = 0;
  const now = new Date().toISOString();

  for (const item of candidates) {
    const videoId = String(item.recoveredVideoId || '');
    if (duplicateIds.has(videoId)) {
      blocked += 1;
      details.push({ itemId: item.id, videoId, status: 'blocked', reason: 'video-id-conflict' });
      continue;
    }
    const remoteVideo = remote.videosById.get(videoId);
    if (!remoteVideo) {
      blocked += 1;
      unavailable += 1;
      details.push({ itemId: item.id, videoId, status: 'blocked', reason: 'video-unavailable' });
      continue;
    }
    const localDuration = Number(item.duration) || null;
    const remoteDuration = Number(remoteVideo.duration) || null;
    const durationDifferenceSeconds = localDuration && remoteDuration ? Math.abs(localDuration - remoteDuration) : null;
    if (durationDifferenceSeconds != null && durationDifferenceSeconds > 45) {
      blocked += 1;
      details.push({ itemId: item.id, videoId, status: 'blocked', reason: 'duration-difference', durationDifferenceSeconds });
      continue;
    }
    const score = scoreCandidate(item, remoteVideo);
    const hasWarning = durationDifferenceSeconds != null && durationDifferenceSeconds > 10;
    if (hasWarning) warnings += 1;
    const value = {
      itemId: item.id,
      status: 'confirmed',
      videoId,
      title: remoteVideo.title || '',
      channelTitle: remoteVideo.channelTitle || '',
      duration: remoteVideo.duration || null,
      thumbnailUrl: remoteVideo.thumbnailUrl || '',
      score,
      source: item.matchSource || 'recovered',
      confirmedAt: now,
      confirmationMode: 'bulk-recovered',
      durationWarning: hasWarning
    };
    updates.push(value);
    details.push({ itemId: item.id, videoId, status: 'confirmed', durationDifferenceSeconds, warning: hasWarning });
  }

  if (updates.length) {
    await stateStore.mutate((current) => {
      for (const value of updates) {
        current.matches[value.itemId] = value;
        stateStore.appendAudit(current, { action: 'match-confirm-recovered-bulk', itemId: value.itemId, videoId: value.videoId, source: value.source, score: value.score.total });
      }
    });
  }

  return {
    sourceId,
    candidates: candidates.length,
    confirmed: updates.length,
    alreadyConfirmed,
    blocked,
    warnings,
    unavailable,
    quotaUnitsUsed: remote.quotaUnitsUsed || 0,
    details
  };
}

async function resolveEntries({ itemIds = [], videoIds = [] } = {}) {
  const state = await stateStore.load();
  const entries = [];
  const seen = new Set();
  const blocked = [];
  const confirmedByVideoId = new Map();
  for (const [knownItemId, knownMatch] of Object.entries(state.matches || {})) {
    if (!knownMatch || knownMatch.status !== 'confirmed' || !knownMatch.videoId) continue;
    if (!confirmedByVideoId.has(knownMatch.videoId)) confirmedByVideoId.set(knownMatch.videoId, []);
    confirmedByVideoId.get(knownMatch.videoId).push(knownItemId);
  }
  for (const itemId of itemIds || []) {
    const item = state.localItems[itemId];
    const match = state.matches[itemId];
    if (!item || item.present === false || !match || match.status !== 'confirmed') {
      blocked.push({ itemId, reason: !item ? 'not-found' : item.present === false ? 'missing-file' : 'match-not-confirmed' });
      continue;
    }
    if ((confirmedByVideoId.get(match.videoId) || []).length > 1) {
      blocked.push({ itemId, videoId: match.videoId, reason: 'video-id-conflict' });
      continue;
    }
    if (seen.has(match.videoId)) continue;
    seen.add(match.videoId);
    entries.push({ videoId: match.videoId, localItemId: itemId, title: match.title || item.inferredTitle || item.filename });
  }
  for (const raw of videoIds || []) {
    const videoId = String(raw.videoId || raw || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) { blocked.push({ videoId, reason: 'invalid-video-id' }); continue; }
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    entries.push({ videoId, localItemId: null, title: raw.title || '' });
  }
  return { entries, blocked };
}

async function planPlaylist({ playlistId, playlistTitle = '', itemIds = [], videoIds = [] } = {}) {
  const account = await accountService.getStatus({ verify: false });
  if (!account.connected || !account.scopeGranted) throw Object.assign(new Error('Conecte a conta do YouTube com permissao de playlists antes de inserir videos.'), { statusCode: 401 });
  const resolved = await resolveEntries({ itemIds, videoIds });
  const index = await playlistService.getIndex(playlistId);
  const pending = [];
  const existing = [];
  for (const entry of resolved.entries) {
    if (index.videoIds.has(entry.videoId)) existing.push(entry);
    else pending.push(entry);
  }
  if (existing.some((entry) => entry.localItemId)) {
    const checkedAt = new Date().toISOString();
    await stateStore.mutate((state) => {
      for (const entry of existing) {
        if (!entry.localItemId) continue;
        stateStore.setLocalPlaylistState(state, entry.localItemId, playlistId, {
          playlistTitle: playlistTitle || playlistId,
          status: 'already-existing',
          checkedAt,
          updatedAt: checkedAt
        });
      }
    });
  }
  return {
    playlistId,
    playlistTitle,
    requested: resolved.entries.length,
    eligible: pending.length,
    alreadyExists: existing.length,
    blocked: resolved.blocked,
    estimatedGeneralQuotaUnits: pending.length * 50,
    entries: pending,
    existing
  };
}

async function startPlaylistJob(plan) {
  if (!plan || !plan.playlistId || !Array.isArray(plan.entries)) throw Object.assign(new Error('Plano de playlist invalido.'), { statusCode: 400 });
  return playlistQueue.start({ playlistId: plan.playlistId, playlistTitle: plan.playlistTitle || '', entries: plan.entries });
}

module.exports = { getStatus, listCatalogItems, searchPublic, searchForItem, updateMatch, confirmRecoveredItem, confirmRecoveredMatches, resolveEntries, planPlaylist, startPlaylistJob, buildPlaylistMembershipIndex, buildManagedDestinationIndex };
