const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ROOT_DIR } = require('../config');
const { defaultProject, hydrateProject, defaultSettings, MODULE_SCHEMA_VERSION, nowIso } = require('./schema');

const BASE_DIR = path.join(ROOT_DIR, 'data', 'scripted-schedules');
const SETTINGS_PATH = path.join(BASE_DIR, 'settings.json');
const PROJECTS_DIR = path.join(BASE_DIR, 'projects');
const HISTORY_DIR = path.join(BASE_DIR, 'history');
const FILE_BACKUPS_DIR = path.join(BASE_DIR, 'file-backups');

async function ensureBase() {
  await Promise.all([
    fs.mkdir(PROJECTS_DIR, { recursive: true }),
    fs.mkdir(HISTORY_DIR, { recursive: true }),
    fs.mkdir(FILE_BACKUPS_DIR, { recursive: true })
  ]);
}

function projectPath(id) {
  const safe = String(id || '').trim();
  if (!/^[a-f0-9-]{20,}$/i.test(safe)) {
    const error = new Error('Projeto de Scripted Schedule invalido.');
    error.statusCode = 400;
    throw error;
  }
  return path.join(PROJECTS_DIR, `${safe}.json`);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicJsonWrite(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, filePath);
}

async function getSettings() {
  await ensureBase();
  const current = await readJson(SETTINGS_PATH, null);
  return current && current.schemaVersion === MODULE_SCHEMA_VERSION
    ? { ...defaultSettings(), ...current }
    : defaultSettings();
}

async function saveSettings(input = {}) {
  await ensureBase();
  const next = {
    ...defaultSettings(),
    ...input,
    schemaVersion: MODULE_SCHEMA_VERSION,
    outputRoot: String(input.outputRoot || '').trim(),
    historyLimit: Math.max(1, Math.min(50, Number(input.historyLimit) || 10)),
    updatedAt: nowIso()
  };
  await atomicJsonWrite(SETTINGS_PATH, next);
  return next;
}

async function createProject(input = {}) {
  await ensureBase();
  const id = crypto.randomUUID();
  const project = defaultProject(id, input);
  await atomicJsonWrite(projectPath(id), project);
  return project;
}

async function getProject(id) {
  await ensureBase();
  const project = await readJson(projectPath(id), null);
  if (!project) {
    const error = new Error('Scripted Schedule nao encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const hydrated = hydrateProject(project);
  if (!hydrated.publishedAt) {
    hydrated.fileName = '';
    hydrated.channelLinks = (hydrated.channelLinks || []).map((link) => ({ ...link, stateKey: '' }));
  }
  return hydrated;
}

async function saveProject(project) {
  await ensureBase();
  const current = await readJson(projectPath(project.id), null);
  const next = hydrateProject({
    ...project,
    schemaVersion: MODULE_SCHEMA_VERSION,
    createdAt: current && current.createdAt || project.createdAt || nowIso(),
    updatedAt: nowIso()
  });
  await atomicJsonWrite(projectPath(next.id), next);
  return next;
}

async function listProjects() {
  await ensureBase();
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const item = await readJson(path.join(PROJECTS_DIR, entry.name), null);
      if (!item) continue;
      projects.push({
        id: item.id,
        name: item.name,
        fileName: item.publishedAt ? item.fileName : '',
        templateVersion: item.templateVersion,
        updatedAt: item.updatedAt,
        publishedAt: item.publishedAt,
        publishedHash: item.publishedHash,
        publishedPath: item.publishedPath,
        channelLinks: Array.isArray(item.channelLinks) ? item.channelLinks : []
      });
    } catch {
      // An invalid individual project must not prevent the rest of the catalog from loading.
    }
  }
  projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return projects;
}

async function deleteProject(id) {
  const filePath = projectPath(id);
  let removed = false;
  try {
    await fs.unlink(filePath);
    removed = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await Promise.all([
    fs.rm(path.join(HISTORY_DIR, String(id)), { recursive: true, force: true }),
    fs.rm(path.join(FILE_BACKUPS_DIR, String(id)), { recursive: true, force: true })
  ]);
  return removed;
}

function revisionFileName() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.json`;
}

async function saveHistory(project, metadata = {}) {
  if (!project) return null;
  const settings = await getSettings();
  const dir = path.join(HISTORY_DIR, project.id);
  await fs.mkdir(dir, { recursive: true });
  const fileName = revisionFileName();
  const payload = {
    revisionAt: nowIso(),
    reason: String(metadata.reason || 'publish'),
    publishedHash: metadata.publishedHash || project.publishedHash || null,
    project
  };
  await atomicJsonWrite(path.join(dir, fileName), payload);
  const entries = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort().reverse();
  for (const oldName of entries.slice(settings.historyLimit)) {
    await fs.unlink(path.join(dir, oldName)).catch(() => {});
  }
  return { id: fileName.replace(/\.json$/, ''), ...payload };
}

async function listHistory(id) {
  const dir = path.join(HISTORY_DIR, String(id));
  try {
    const entries = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort().reverse();
    const result = [];
    for (const name of entries) {
      const value = await readJson(path.join(dir, name), null);
      if (!value) continue;
      result.push({
        id: name.replace(/\.json$/, ''),
        revisionAt: value.revisionAt,
        reason: value.reason,
        publishedHash: value.publishedHash,
        projectName: value.project && value.project.name,
        fileName: value.project && value.project.fileName
      });
    }
    return result;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function getHistoryRevision(id, revisionId) {
  const safeRevision = String(revisionId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeRevision)) {
    const error = new Error('Revisao invalida.');
    error.statusCode = 400;
    throw error;
  }
  const filePath = path.join(HISTORY_DIR, String(id), `${safeRevision}.json`);
  const value = await readJson(filePath, null);
  if (!value) {
    const error = new Error('Revisao nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  return value;
}

module.exports = {
  BASE_DIR,
  SETTINGS_PATH,
  PROJECTS_DIR,
  HISTORY_DIR,
  FILE_BACKUPS_DIR,
  ensureBase,
  getSettings,
  saveSettings,
  createProject,
  getProject,
  saveProject,
  listProjects,
  deleteProject,
  saveHistory,
  listHistory,
  getHistoryRevision,
  atomicJsonWrite
};
