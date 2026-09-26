const { getSubtitleSettings } = require('../subtitleService');

function findNextRunnableItem(state, destinations, nowMs = Date.now()) {
  const enabled = new Set(destinations.filter((destination) => destination.enabled !== false).map((destination) => destination.id));
  const candidates = Object.values(state.items || {}).filter((item) => {
    if (item.status !== 'pending') return false;
    if (item.sourceActive === false || item.orphaned) return false;
    if (!enabled.has(item.destinationId || item.libraryFolder)) return false;
    if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > nowMs) return false;
    return true;
  });
  candidates.sort((a, b) => {
    const priorityDelta = (Number(b.priority) || 0) - (Number(a.priority) || 0);
    if (priorityDelta !== 0) return priorityDelta;
    return (Number(a.queueOrder) || 0) - (Number(b.queueOrder) || 0);
  });
  return candidates[0] || null;
}

function findNextSubtitleRunnableItem(state, destinations, nowMs = Date.now()) {
  const configured = new Map(destinations.map((destination) => [destination.id, destination]));
  const candidates = Object.values(state.items || {}).filter((item) => {
    if (item.status !== 'completed' || item.orphaned || item.sourceActive === false) return false;
    const destination = configured.get(item.destinationId || item.libraryFolder);
    if (!destination || !getSubtitleSettings(destination).enabled) return false;
    const subtitleState = item.subtitles || {};
    if (subtitleState.status !== 'pending') return false;
    if (subtitleState.nextAttemptAt && new Date(subtitleState.nextAttemptAt).getTime() > nowMs) return false;
    return true;
  });
  candidates.sort((a, b) => {
    const priorityDelta = (Number(b.priority) || 0) - (Number(a.priority) || 0);
    if (priorityDelta !== 0) return priorityDelta;
    return (Number(a.queueOrder) || 0) - (Number(b.queueOrder) || 0);
  });
  return candidates[0] || null;
}

module.exports = { findNextRunnableItem, findNextSubtitleRunnableItem };
