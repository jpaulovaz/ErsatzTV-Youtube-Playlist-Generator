const path = require('path');
const store = require('./store');
const { generateScript } = require('./generator');
const { validateProject } = require('./validator');
const publisher = require('./publisher');
const { TEMPLATE_VERSION, slugFile, slugKey, nowIso } = require('./schema');
const logger = require('../logger');

function validationError(validation) {
  const error = new Error('O projeto possui erros de configuracao.');
  error.statusCode = 400;
  error.code = 'SCRIPTED_SCHEDULE_INVALID';
  error.validation = validation;
  return error;
}

async function listProjects() {
  return store.listProjects();
}

async function createProject(payload = {}) {
  const project = await store.createProject({
    name: payload.name,
    fileName: ''
  });
  await logger.info(`Scripted Schedule criado: ${project.name}.`, { projectId: project.id });
  return project;
}

async function getProject(id) {
  return store.getProject(id);
}

async function addProjectFileCollision(validation, project) {
  const normalized = String(project.fileName || '').trim().toLowerCase();
  if (!normalized) return validation;
  const other = (await store.listProjects()).find((item) => item.id !== project.id && String(item.fileName || '').trim().toLowerCase() === normalized);
  if (other) {
    validation.errors.push({ path: 'fileName', message: `O arquivo ${project.fileName} ja esta sendo usado pelo projeto ${other.name}.` });
    validation.ok = false;
  }
  return validation;
}

async function validateDraft(id, draft) {
  const current = await store.getProject(id);
  const project = normalizeDraft(current, draft);
  return addProjectFileCollision(validateProject(project), project);
}

async function previewProject(id) {
  const project = await store.getProject(id);
  return { project, script: await generateScript(project) };
}

async function previewDraft(id, draft) {
  const current = await store.getProject(id);
  const project = normalizeDraft(current, draft);
  return { project, script: await generateScript(project) };
}

function derivedStateKey(projectName, link, index) {
  const base = slugKey(projectName, 'schedule').toLowerCase();
  const channel = String(link && link.channelNumber || '').trim();
  return `${base}_${channel || index + 1}`;
}

function normalizeDraft(current, draft = {}) {
  const firstPublication = !current.publishedAt;
  const project = {
    ...current,
    ...draft,
    id: current.id,
    schemaVersion: current.schemaVersion,
    templateVersion: String(draft.templateVersion || current.templateVersion || TEMPLATE_VERSION),
    createdAt: current.createdAt,
    publishedAt: current.publishedAt || null,
    publishedHash: current.publishedHash || null,
    publishedPath: current.publishedPath || null
  };
  project.name = String(project.name || '').trim();
  project.channelLinks = Array.isArray(project.channelLinks) ? project.channelLinks.map((link) => ({ ...link })) : [];

  if (firstPublication) {
    project.fileName = slugFile(project.name);
    project.channelLinks = project.channelLinks.map((link, index) => ({
      ...link,
      stateKey: derivedStateKey(project.name, link, index)
    }));
  } else {
    project.fileName = String(project.fileName || current.fileName || slugFile(project.name)).trim();
  }
  return project;
}

async function updateAndPublish(id, draft = {}, options = {}) {
  const current = await store.getProject(id);
  const project = normalizeDraft(current, draft);
  const validation = await addProjectFileCollision(validateProject(project), project);
  if (!validation.ok) throw validationError(validation);
  const settings = await store.getSettings();
  const script = await generateScript(project);

  if (!options.skipHistory) await store.saveHistory(current, { reason: options.reason || 'publish' });
  const published = await publisher.publishScript({
    projectId: id,
    fileName: project.fileName,
    outputRoot: settings.outputRoot,
    script,
    historyLimit: settings.historyLimit
  });
  project.publishedAt = nowIso();
  project.publishedHash = published.hash;
  project.publishedPath = published.path;
  const saved = await store.saveProject(project);
  await logger.info(`Scripted Schedule publicado: ${saved.name}.`, { projectId: id, path: published.path, hash: published.hash });
  return { project: saved, validation, published };
}

async function duplicateProject(id) {
  const source = await store.getProject(id);
  const duplicate = await store.createProject({ name: `${source.name} - Copia`, fileName: '' });
  const next = {
    ...structuredClone(source),
    id: duplicate.id,
    name: duplicate.name,
    fileName: '',
    createdAt: duplicate.createdAt,
    updatedAt: duplicate.updatedAt,
    publishedAt: null,
    publishedHash: null,
    publishedPath: null,
    channelLinks: []
  };
  return store.saveProject(next);
}

async function deleteProject(id, options = {}) {
  const project = await store.getProject(id);
  if (options.removePublished && project.publishedAt && project.fileName) {
    const settings = await store.getSettings();
    const expected = publisher.safePublishedPath(settings.outputRoot, project.fileName).finalPath;
    if (project.publishedPath && path.resolve(project.publishedPath) !== expected) {
      const error = new Error('O arquivo foi publicado em outra pasta de saida. Ajuste a pasta atual antes de remove-lo pelo aplicativo.');
      error.statusCode = 400;
      throw error;
    }
    await publisher.removePublished(settings.outputRoot, project.fileName);
  }
  await store.deleteProject(id);
  await logger.info(`Scripted Schedule removido: ${project.name}.`, { projectId: id, removePublished: Boolean(options.removePublished) });
  return { removed: true };
}

async function getHistory(id) {
  await store.getProject(id);
  return store.listHistory(id);
}

async function restoreRevision(id, revisionId) {
  const current = await store.getProject(id);
  const revision = await store.getHistoryRevision(id, revisionId);
  const restored = {
    ...revision.project,
    id: current.id,
    createdAt: current.createdAt,
    publishedAt: current.publishedAt,
    publishedHash: current.publishedHash,
    publishedPath: current.publishedPath
  };
  return updateAndPublish(id, restored, { reason: `restore:${revisionId}` });
}

async function getSettings() {
  return store.getSettings();
}

async function saveSettings(payload = {}) {
  const outputRoot = await publisher.testOutputRoot(payload.outputRoot);
  const settings = await store.saveSettings({ ...payload, outputRoot });
  await logger.info('Pasta de Scripted Schedules atualizada.', { outputRoot });
  return settings;
}

async function getLinkAssistant(id) {
  const project = await store.getProject(id);
  if (!project.publishedAt) return { path: null, links: [] };
  const settings = await store.getSettings();
  const filePath = project.publishedPath || publisher.safePublishedPath(settings.outputRoot, project.fileName).finalPath;
  return {
    path: filePath,
    links: (project.channelLinks || []).map((link) => ({
      channelNumber: String(link.channelNumber || ''),
      channelName: String(link.channelName || ''),
      stateKey: String(link.stateKey || '')
    }))
  };
}

module.exports = {
  listProjects,
  createProject,
  getProject,
  validateDraft,
  previewProject,
  previewDraft,
  updateAndPublish,
  duplicateProject,
  deleteProject,
  getHistory,
  restoreRevision,
  getSettings,
  saveSettings,
  getLinkAssistant,
  normalizeDraft
};
