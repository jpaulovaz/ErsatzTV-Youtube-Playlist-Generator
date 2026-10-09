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

module.exports = { getStatus, searchPublic, searchForItem, updateMatch, confirmRecoveredMatches, resolveEntries, planPlaylist, startPlaylistJob };
