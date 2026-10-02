const { STORAGE_STATES, USER_DISPOSITIONS } = require('./orphanPolicy');
const { deleteQuarantinedFiles } = require('./quarantineService');

function nowMs() { return Date.now(); }

async function sweepExpiredQuarantine(state, options = {}) {
  const items = state && state.items && typeof state.items === 'object' ? state.items : {};
  const summary = { checked: 0, expired: 0, ignoredPreserved: 0, recordsRemoved: 0, filesRemoved: 0, bytesRemoved: 0 };
  const toDelete = [];

  for (const [id, item] of Object.entries(items)) {
    if (!item || item.storageState !== STORAGE_STATES.QUARANTINED || !item.quarantine) continue;
    summary.checked += 1;
    const expiresAt = item.quarantine.expiresAt ? Date.parse(item.quarantine.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs()) continue;

    const removed = await deleteQuarantinedFiles(item);
    summary.expired += 1;
    summary.filesRemoved += removed.filesRemoved;
    summary.bytesRemoved += removed.bytesRemoved;
    item.updatedAt = new Date().toISOString();

    if (item.userDisposition === USER_DISPOSITIONS.IGNORED) {
      item.status = 'removed';
      summary.ignoredPreserved += 1;
    } else {
      toDelete.push(id);
    }
  }

  for (const id of toDelete) {
    delete items[id];
    summary.recordsRemoved += 1;
  }
  if (typeof options.onChanged === 'function' && (summary.expired > 0 || summary.recordsRemoved > 0)) {
    await options.onChanged(summary);
  }
  return summary;
}

module.exports = { sweepExpiredQuarantine };
