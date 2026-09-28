const path = require('path');
const { ROOT_DIR } = require('../config');

const MODULE_SCHEMA_VERSION = 1;
const TEMPLATE_VERSION = '1.1.1';
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
      fixedEvents: [],
      fixedDurationEvents: [],
      fixedAllEvents: [],
      fixedWindowEvents: [],
      windowRotations: [],
      sequenceEvents: [],
      intervalEvents: [],
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
  'fixedEvents',
  'fixedDurationEvents',
  'fixedAllEvents',
  'fixedWindowEvents',
  'windowRotations',
  'sequenceEvents',
  'intervalEvents',
  'dateEvents',
  'offlineWindows'
];

module.exports = {
  MODULE_SCHEMA_VERSION,
  TEMPLATE_VERSION,
  DEFAULT_OUTPUT_ROOT,
  HISTORY_LIMIT,
  MODULE_TYPES,
  defaultProject,
  defaultSettings,
  slugKey,
  slugFile,
  nowIso
};
