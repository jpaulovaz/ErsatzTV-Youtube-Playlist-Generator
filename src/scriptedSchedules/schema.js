const path = require('path');
const { ROOT_DIR } = require('../config');

const MODULE_SCHEMA_VERSION = 1;
const TEMPLATE_VERSION = '1.3.0';
const SUPPORTED_TEMPLATE_VERSIONS = ['1.1.1', '1.2.0', '1.3.0'];
const DEFAULT_OUTPUT_ROOT = path.join(ROOT_DIR, 'data', 'scripted-schedules', 'published');
const HISTORY_LIMIT = 10;

function nowIso() {
  return new Date().toISOString();
}

function slugKey(value, fallback = 'ITEM') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return normalized || fallback;
}

function slugFile(value, fallback = 'scripted-schedule') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return `${normalized || fallback}.py`;
}

function defaultProject(id, options = {}) {
  const createdAt = nowIso();
  const name = String(options.name || 'Novo Scripted Schedule').trim() || 'Novo Scripted Schedule';
  return {
    schemaVersion: MODULE_SCHEMA_VERSION,
    id,
    name,
    fileName: options.fileName ? String(options.fileName).trim() : slugFile(name),
    templateVersion: TEMPLATE_VERSION,
    createdAt,
    updatedAt: createdAt,
    publishedAt: null,
    publishedHash: null,
    publishedPath: null,
    channelLinks: [],
    graphicsGroups: [],
    sources: [],
    scriptedPlaylists: [],
    presentationProfiles: [
      {
        key: 'none',
        label: 'Nenhum',
        graphicsGroups: [],
        graphics: [],
        graphicsVariables: [],
        watermarks: [],
        preRoll: null,
        epgGroup: false,
        epgTitle: '',
        epgAdvance: true
      }
    ],
    modules: {
      rotation: [],
      countRotation: [],
      weightedRotation: [],
      continuousBlocks: [],
      contentBreaks: [],
      fitToWindow: [],
      fixedEvents: [],
      fixedDurationEvents: [],
      fixedAllEvents: [],
      fixedWindowEvents: [],
      windowRotations: [],
      sequenceEvents: [],
      intervalEvents: [],
      choiceEvents: [],
      clockTemplates: [],
      temporaryOverrides: [],
      dateEvents: [],
      offlineWindows: []
    },
    filler: null,
    options: {
      defaultRotationDurationMinutes: 60,
      defaultFixedPriority: 100,
      allowOverrun: true,
      httpTimeoutSeconds: 30,
      seenOccurrenceRetentionDays: 14
    }
  };
}

function hydrateProject(project) {
  if (!project || typeof project !== 'object') return project;
  const base = defaultProject(String(project.id || 'unknown'), {
    name: project.name,
    fileName: project.fileName
  });
  return {
    ...base,
    ...project,
    channelLinks: Array.isArray(project.channelLinks) ? project.channelLinks : [],
    graphicsGroups: Array.isArray(project.graphicsGroups) ? project.graphicsGroups : [],
    sources: Array.isArray(project.sources) ? project.sources : [],
    scriptedPlaylists: Array.isArray(project.scriptedPlaylists) ? project.scriptedPlaylists : [],
    presentationProfiles: Array.isArray(project.presentationProfiles) ? project.presentationProfiles : base.presentationProfiles,
    modules: { ...base.modules, ...(project.modules && typeof project.modules === 'object' ? project.modules : {}) },
    options: { ...base.options, ...(project.options && typeof project.options === 'object' ? project.options : {}) }
  };
}

function defaultSettings() {
  return {
    schemaVersion: MODULE_SCHEMA_VERSION,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    historyLimit: HISTORY_LIMIT,
    updatedAt: nowIso()
  };
}

const MODULE_TYPES = [
  'rotation',
  'countRotation',
  'weightedRotation',
  'continuousBlocks',
  'contentBreaks',
  'fitToWindow',
  'fixedEvents',
  'fixedDurationEvents',
  'fixedAllEvents',
  'fixedWindowEvents',
  'windowRotations',
  'sequenceEvents',
  'intervalEvents',
  'choiceEvents',
  'clockTemplates',
  'temporaryOverrides',
  'dateEvents',
  'offlineWindows'
];

module.exports = {
  MODULE_SCHEMA_VERSION,
  TEMPLATE_VERSION,
  SUPPORTED_TEMPLATE_VERSIONS,
  DEFAULT_OUTPUT_ROOT,
  HISTORY_LIMIT,
  MODULE_TYPES,
  defaultProject,
  hydrateProject,
  defaultSettings,
  slugKey,
  slugFile,
  nowIso
};
