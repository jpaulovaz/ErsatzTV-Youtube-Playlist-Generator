const fs = require('fs/promises');
const path = require('path');
const { DESTINATION_TYPES } = require('../destinationService');
const { USER_DISPOSITIONS, STORAGE_STATES, normalizeUserDisposition, normalizeStorageState } = require('../orphans/orphanPolicy');

const STATE_VERSION = 5;

function nowIso() {
  return new Date().toISOString();
}

function normalizeSubtitleState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  return {
    status: String(state.status || 'not-checked'),
    requestedLanguages: Array.isArray(state.requestedLanguages)
      ? state.requestedLanguages.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    foundLanguages: Array.isArray(state.foundLanguages)
      ? state.foundLanguages.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    missingLanguages: Array.isArray(state.missingLanguages)
      ? state.missingLanguages.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    includeAuto: state.includeAuto !== false,
    attempts: Math.max(0, Number(state.attempts) || 0),
    nextAttemptAt: state.nextAttemptAt || null,
    lastAttemptAt: state.lastAttemptAt || null,
    lastCompletedAt: state.lastCompletedAt || null,
    lastError: state.lastError || null,
    updatedAt: state.updatedAt || null
  };
}

function createDefaultState() {
  return {
    version: STATE_VERSION,
    paused: false,
    pauseReason: null,
    nextSequence: 1,
    items: {},
    libraries: {},
    updatedAt: nowIso()
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : createDefaultState();
  const normalized = {
    version: STATE_VERSION,
    paused: Boolean(state.paused),
    pauseReason: state.pauseReason || null,
    nextSequence: Math.max(1, Number(state.nextSequence) || 1),
    items: state.items && typeof state.items === 'object' ? state.items : {},
    libraries: state.libraries && typeof state.libraries === 'object' ? state.libraries : {},
    updatedAt: state.updatedAt || nowIso()
  };

  for (const [id, rawItem] of Object.entries(normalized.items)) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    item.id = id;
    item.destinationId = String(item.destinationId || item.libraryFolder || id.split('::')[0] || '').trim();
    item.destinationType = String(item.destinationType || DESTINATION_TYPES.LIBRARY);
    // Compatibility alias used by the v2 UI/filter/state shape. For channel
    // destinations it intentionally contains destinationId, not a filesystem folder.
    item.libraryFolder = String(item.libraryFolder || item.destinationId).trim();
    item.status = String(item.status || 'pending');
    if (item.status === 'downloading') {
      item.status = item.sourceActive === false ? 'orphaned' : 'pending';
      item.nextAttemptAt = null;
      item.lastError = 'Download interrompido pela reinicializacao; item devolvido para a fila.';
      item.phase = null;
    }
    item.attempts = Math.max(0, Number(item.attempts) || 0);
    item.priority = Number(item.priority) || 0;
    item.queueOrder = Math.max(1, Number(item.queueOrder) || normalized.nextSequence++);
    item.progress = item.progress && typeof item.progress === 'object' ? item.progress : {};
    item.sourceActive = item.sourceActive !== false;
    item.orphaned = Boolean(item.orphaned || item.sourceActive === false);
    item.suppressed = Boolean(item.suppressed);
    item.userDisposition = normalizeUserDisposition(item.userDisposition);
    item.storageState = normalizeStorageState(item.storageState, item);
    item.dispositionUpdatedAt = item.dispositionUpdatedAt || null;
    item.quarantine = item.quarantine && typeof item.quarantine === 'object' ? item.quarantine : null;
    if (item.userDisposition === USER_DISPOSITIONS.IGNORED && item.storageState === STORAGE_STATES.ACTIVE) {
      // Legacy states never used ignored; this only protects malformed future state.
      item.storageState = item.targetPath ? STORAGE_STATES.ACTIVE : STORAGE_STATES.ABSENT;
    }
    item.subtitles = normalizeSubtitleState(item.subtitles);
    normalized.items[id] = item;
  }

  return normalized;
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(tempPath, filePath);
}

module.exports = {
  STATE_VERSION,
  normalizeSubtitleState,
  createDefaultState,
  normalizeState,
  atomicWriteJson
};
