const path = require('path');
const { ROOT_DIR } = require('../config');

const MODULE_SCHEMA_VERSION = 1;
const TEMPLATE_VERSION = '1.3.1';
const SUPPORTED_TEMPLATE_VERSIONS = [TEMPLATE_VERSION];
const SCRIPTED_SCHEDULES_BASE_DIR = process.env.ERSATZTV_SCRIPTED_SCHEDULES_DIR
  ? path.resolve(process.env.ERSATZTV_SCRIPTED_SCHEDULES_DIR)
  : path.join(ROOT_DIR, 'data', 'scripted-schedules');
const DEFAULT_OUTPUT_ROOT = path.join(SCRIPTED_SCHEDULES_BASE_DIR, 'published');
const HISTORY_LIMIT = 10;
const RESERVED_PRESENTATION_KEY = 'none';
const ORDERABLE_SOURCE_TYPES = new Set(['smart_collection', 'collection', 'multi_collection', 'search', 'show']);
const PLAYBACK_ORDERS = new Set(['chronological', 'shuffle']);

function nowIso() {
  return new Date().toISOString();
}

function normalizeGraphicsElementPath(value) {
  const text = String(value ?? '').trim().replace(/\\/g, '/');
  return text.replace(/^\/+/, '');
}

function normalizeGraphicsPaths(project) {
  const normalizeList = (value) => (Array.isArray(value) ? value : [])
    .map(normalizeGraphicsElementPath)
    .filter(Boolean);

  for (const group of project.graphicsGroups || []) {
    if (group && typeof group === 'object') group.graphics = normalizeList(group.graphics);
  }
  for (const profile of project.presentationProfiles || []) {
    if (profile && typeof profile === 'object') profile.graphics = normalizeList(profile.graphics);
  }
  return project;
}

function sourceSupportsPlaybackOrder(source) {
  return ORDERABLE_SOURCE_TYPES.has(String(source && source.type || '').trim());
}

function normalizePlaybackOrder(value) {
  return String(value || '').trim().toLowerCase() === 'chronological' ? 'chronological' : 'shuffle';
}

function sequenceSupportsItemPad(steps = []) {
  const modes = (steps || []).map((step) => String(step?.mode || 'count'));
  return modes.includes('count') && modes.every((mode) => !['duration', 'all'].includes(mode));
}

function modeSupportsItemPad(mode, steps = []) {
  const normalized = String(mode || 'count');
  if (normalized === 'count') return true;
  if (normalized === 'sequence') return sequenceSupportsItemPad(steps);
  return false;
}

function normalizeProjectSourceOrders(project) {
  const sources = Array.isArray(project.sources) ? project.sources : [];
  const sourceMap = new Map(sources.map((source) => [String(source && source.key || '').trim(), source]));

  // Ordem de reprodução pertence ao uso da Source na programação, não ao cadastro da Source.
  for (const source of sources) {
    if (source && typeof source === 'object') delete source.order;
  }

  const normalizeRef = (target, sourceField = 'source', orderField = 'order') => {
    if (!target || typeof target !== 'object') return;
    const key = String(target[sourceField] || '').trim();
    const source = sourceMap.get(key);
    if (key && sourceSupportsPlaybackOrder(source)) target[orderField] = normalizePlaybackOrder(target[orderField]);
    else delete target[orderField];
  };

  const normalizePlayback = (target) => {
    if (!target || typeof target !== 'object') return;
    normalizeRef(target, 'fallback', 'fallbackOrder');
  };

  for (const playlist of project.scriptedPlaylists || []) {
    for (const item of playlist && Array.isArray(playlist.items) ? playlist.items : []) normalizeRef(item);
  }

  const modules = project.modules || {};
  const simpleLists = [
    'rotation', 'countRotation', 'weightedRotation', 'continuousBlocks', 'fitToWindow',
    'fixedEvents', 'fixedDurationEvents', 'fixedAllEvents', 'fixedWindowEvents',
    'intervalEvents', 'temporaryOverrides', 'dateEvents'
  ];
  for (const name of simpleLists) {
    for (const item of Array.isArray(modules[name]) ? modules[name] : []) {
      normalizeRef(item);
      normalizePlayback(item);
    }
  }

  for (const item of Array.isArray(modules.contentBreaks) ? modules.contentBreaks : []) {
    normalizeRef(item);
    normalizeRef(item, 'breakSource', 'breakOrder');
    normalizePlayback(item);
    normalizePlayback(item.breakPlayback);
  }

  for (const item of Array.isArray(modules.windowRotations) ? modules.windowRotations : []) {
    normalizePlayback(item);
    for (const entry of Array.isArray(item.items) ? item.items : []) {
      normalizeRef(entry);
      normalizePlayback(entry);
    }
  }

  for (const item of Array.isArray(modules.sequenceEvents) ? modules.sequenceEvents : []) {
    normalizePlayback(item);
    for (const step of Array.isArray(item.steps) ? item.steps : []) {
      normalizeRef(step);
      normalizePlayback(step);
    }
  }

  for (const item of Array.isArray(modules.choiceEvents) ? modules.choiceEvents : []) {
    normalizePlayback(item);
    for (const choice of Array.isArray(item.choices) ? item.choices : []) {
      normalizeRef(choice);
      normalizePlayback(choice);
    }
  }

  for (const item of Array.isArray(modules.clockTemplates) ? modules.clockTemplates : []) {
    normalizePlayback(item);
    for (const slot of Array.isArray(item.slots) ? item.slots : []) {
      normalizeRef(slot);
      normalizePlayback(slot);
    }
  }

  for (const item of Array.isArray(modules.dateEvents) ? modules.dateEvents : []) {
    for (const step of Array.isArray(item.steps) ? item.steps : []) {
      normalizeRef(step);
      normalizePlayback(step);
    }
  }

  if (project.filler && typeof project.filler === 'object') {
    normalizeRef(project.filler);
    normalizePlayback(project.filler);
  }
  return project;
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
    fileName: Object.prototype.hasOwnProperty.call(options, 'fileName') ? String(options.fileName || '').trim() : slugFile(name),
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
    presentationProfiles: [],
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

function reservedPresentationProfile() {
  return {
    key: RESERVED_PRESENTATION_KEY,
    label: 'Nenhum',
    graphicsGroups: [],
    graphics: [],
    graphicsVariables: [],
    watermarks: [],
    preRoll: null,
    epgGroup: false,
    epgTitle: '',
    epgAdvance: true
  };
}


function hydrateProject(project) {
  if (!project || typeof project !== 'object') return project;
  const base = defaultProject(String(project.id || 'unknown'), {
    name: project.name,
    fileName: project.fileName
  });
  const hydrated = {
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
  return normalizeGraphicsPaths(normalizeProjectSourceOrders(hydrated));
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
  RESERVED_PRESENTATION_KEY,
  ORDERABLE_SOURCE_TYPES,
  PLAYBACK_ORDERS,
  MODULE_TYPES,
  normalizeGraphicsElementPath,
  normalizeGraphicsPaths,
  sourceSupportsPlaybackOrder,
  normalizePlaybackOrder,
  sequenceSupportsItemPad,
  modeSupportsItemPad,
  normalizeProjectSourceOrders,
  defaultProject,
  reservedPresentationProfile,
  hydrateProject,
  defaultSettings,
  slugKey,
  slugFile,
  nowIso
};
