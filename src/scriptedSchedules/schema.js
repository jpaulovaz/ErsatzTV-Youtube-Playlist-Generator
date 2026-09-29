const path = require('path');
const { ROOT_DIR } = require('../config');

const MODULE_SCHEMA_VERSION = 1;
const TEMPLATE_VERSION = '1.3.0';
const SUPPORTED_TEMPLATE_VERSIONS = ['1.1.1', '1.2.0', '1.3.0'];
const DEFAULT_OUTPUT_ROOT = path.join(ROOT_DIR, 'data', 'scripted-schedules', 'published');
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

function isCanonicalReservedPresentationProfile(profile) {
  if (!profile || String(profile.key || '').trim().toLowerCase() !== RESERVED_PRESENTATION_KEY) return false;
  const listEmpty = (value) => !Array.isArray(value) || value.length === 0;
  return listEmpty(profile.graphicsGroups)
    && listEmpty(profile.graphics)
    && listEmpty(profile.graphicsVariables)
    && listEmpty(profile.watermarks)
    && !String(profile.preRoll || '').trim()
    && profile.epgGroup !== true
    && !String(profile.epgTitle || '').trim();
}

function nextLegacyProfileKey(profiles) {
  const keys = new Set((profiles || []).map((profile) => String(profile && profile.key || '').trim().toLowerCase()));
  let key = 'legacy_none';
  let index = 2;
  while (keys.has(key)) {
    key = `legacy_none_${index}`;
    index += 1;
  }
  return key;
}

function rewritePresentationReferences(value, fromKey, toKey) {
  if (Array.isArray(value)) {
    for (const item of value) rewritePresentationReferences(item, fromKey, toKey);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, current] of Object.entries(value)) {
    if ((key === 'presentation' || key === 'breakPresentation') && String(current || '').trim() === fromKey) {
      value[key] = toKey;
      continue;
    }
    rewritePresentationReferences(current, fromKey, toKey);
  }
}

function normalizePresentationProfiles(project) {
  const input = Array.isArray(project.presentationProfiles) ? project.presentationProfiles : [];
  const visible = input.filter((profile) => String(profile && profile.key || '').trim().toLowerCase() !== RESERVED_PRESENTATION_KEY);
  const reserved = [...input].reverse().find((profile) => String(profile && profile.key || '').trim().toLowerCase() === RESERVED_PRESENTATION_KEY);

  if (reserved && !isCanonicalReservedPresentationProfile(reserved)) {
    const legacyKey = nextLegacyProfileKey(visible);
    visible.unshift({
      ...reserved,
      key: legacyKey,
      label: String(reserved.label || '').trim() && String(reserved.label || '').trim() !== 'Nenhum'
        ? String(reserved.label).trim()
        : 'Perfil antigo'
    });
    for (const source of project.sources || []) {
      const current = String(source && source.presentation || '').trim();
      if (!current || current === RESERVED_PRESENTATION_KEY) source.presentation = legacyKey;
    }
    rewritePresentationReferences(project.modules, RESERVED_PRESENTATION_KEY, legacyKey);
    rewritePresentationReferences(project.filler, RESERVED_PRESENTATION_KEY, legacyKey);
  }

  project.presentationProfiles = visible;
  return project;
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
  return normalizeGraphicsPaths(normalizeProjectSourceOrders(normalizePresentationProfiles(hydrated)));
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
  normalizeProjectSourceOrders,
  defaultProject,
  reservedPresentationProfile,
  isCanonicalReservedPresentationProfile,
  normalizePresentationProfiles,
  hydrateProject,
  defaultSettings,
  slugKey,
  slugFile,
  nowIso
};
