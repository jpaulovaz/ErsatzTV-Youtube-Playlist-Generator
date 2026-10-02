const ORPHAN_POLICIES = Object.freeze({
  DELETE: 'delete',
  MARK: 'mark',
  QUARANTINE: 'quarantine'
});

const USER_DISPOSITIONS = Object.freeze({
  MANAGED: 'managed',
  KEEP: 'keep',
  IGNORED: 'ignored'
});

const STORAGE_STATES = Object.freeze({
  ACTIVE: 'active',
  QUARANTINED: 'quarantined',
  ABSENT: 'absent'
});

const ALLOWED_RETENTION_DAYS = new Set([30, 90, 180]);

function normalizeOrphanPolicy(value, fallback = null) {
  const policy = String(value || '').trim().toLowerCase();
  if (Object.values(ORPHAN_POLICIES).includes(policy)) return policy;
  return fallback;
}

function normalizeRetentionDays(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const days = Number(value);
  return ALLOWED_RETENTION_DAYS.has(days) ? days : fallback;
}

function normalizeUserDisposition(value) {
  const disposition = String(value || '').trim().toLowerCase();
  return Object.values(USER_DISPOSITIONS).includes(disposition)
    ? disposition
    : USER_DISPOSITIONS.MANAGED;
}

function normalizeStorageState(value, item = {}) {
  const state = String(value || '').trim().toLowerCase();
  if (Object.values(STORAGE_STATES).includes(state)) return state;
  if (item && item.quarantine && typeof item.quarantine === 'object') return STORAGE_STATES.QUARANTINED;
  if (item && (item.status === 'completed' || item.status === 'orphaned') && item.targetPath) return STORAGE_STATES.ACTIVE;
  return STORAGE_STATES.ABSENT;
}

function quarantineExpiresAt(retentionDays, movedAt = new Date()) {
  const days = normalizeRetentionDays(retentionDays, null);
  if (!days) return null;
  const date = movedAt instanceof Date ? new Date(movedAt.getTime()) : new Date(movedAt);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function shouldManageFromSource(item) {
  return normalizeUserDisposition(item && item.userDisposition) === USER_DISPOSITIONS.MANAGED;
}

function canRunWhileSourceInactive(item) {
  return normalizeUserDisposition(item && item.userDisposition) === USER_DISPOSITIONS.KEEP;
}

module.exports = {
  ORPHAN_POLICIES,
  USER_DISPOSITIONS,
  STORAGE_STATES,
  ALLOWED_RETENTION_DAYS,
  normalizeOrphanPolicy,
  normalizeRetentionDays,
  normalizeUserDisposition,
  normalizeStorageState,
  quarantineExpiresAt,
  shouldManageFromSource,
  canRunWhileSourceInactive
};
