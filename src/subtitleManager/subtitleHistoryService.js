const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { HISTORY_DIR } = require('./subtitleManagerState');

const MAX_HISTORY = 5;

function safePart(value) {
  return String(value || 'track').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'track';
}

async function backupCurrent({ itemId, language, sidecarPath, trackState, metadata = {} }) {
  let content;
  try {
    content = await fs.readFile(sidecarPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!content.length) return null;
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(String(itemId)).digest('hex').slice(0, 12);
  const fileName = `${hash}-${safePart(language)}-${Date.now()}-${id.slice(0, 8)}.srt`;
  const historyPath = path.join(HISTORY_DIR, fileName);
  await fs.writeFile(historyPath, content);
  return {
    id,
    fileName,
    language,
    createdAt: new Date().toISOString(),
    sizeBytes: content.length,
    provider: trackState && trackState.provider || 'local',
    providerId: trackState && trackState.providerId || null,
    sourceType: trackState && trackState.sourceType || 'unregistered',
    sourceLabel: trackState && trackState.sourceLabel || 'Arquivo local · origem não registrada',
    lastAppliedOffsetMs: Number(trackState && trackState.lastAppliedOffsetMs) || 0,
    reason: String(metadata.reason || 'replace')
  };
}

async function pruneHistory(entries) {
  const normalized = Array.isArray(entries) ? entries : [];
  while (normalized.length > MAX_HISTORY) {
    const removed = normalized.pop();
    if (removed && removed.fileName) {
      await fs.rm(path.join(HISTORY_DIR, path.basename(removed.fileName)), { force: true }).catch(() => {});
    }
  }
  return normalized;
}

async function readHistory(entry) {
  if (!entry || !entry.fileName) {
    const error = new Error('Versao de historico invalida.');
    error.statusCode = 404;
    throw error;
  }
  const filePath = path.join(HISTORY_DIR, path.basename(entry.fileName));
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      const wrapped = new Error('Arquivo da versao historica nao foi encontrado.');
      wrapped.statusCode = 404;
      throw wrapped;
    }
    throw error;
  }
}

module.exports = { MAX_HISTORY, backupCurrent, pruneHistory, readHistory };
