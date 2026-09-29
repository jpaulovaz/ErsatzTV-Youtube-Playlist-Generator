const path = require('path');
const { MODULE_TYPES, TEMPLATE_VERSION, SUPPORTED_TEMPLATE_VERSIONS } = require('./schema');

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d$/;
const KEY_RE = /^[A-Za-z0-9_.-]+$/;
const SOURCE_TYPES = new Set(['smart_collection', 'collection', 'multi_collection', 'playlist', 'search', 'show', 'marathon']);
const ORDERS = new Set(['chronological', 'shuffle']);
const PAD_TO_NEAREST_VALUES = new Set([5, 10, 15, 30]);
const MODULE_LABELS = {
  rotation: 'ROTATION',
  countRotation: 'COUNT_ROTATION',
  weightedRotation: 'WEIGHTED_ROTATION',
  continuousBlocks: 'CONTINUOUS_BLOCKS',
  contentBreaks: 'CONTENT_BREAKS',
  fitToWindow: 'FIT_TO_WINDOW',
  fixedEvents: 'FIXED_EVENTS',
  fixedDurationEvents: 'FIXED_DURATION_EVENTS',
  fixedAllEvents: 'FIXED_ALL_EVENTS',
  fixedWindowEvents: 'FIXED_WINDOW_EVENTS',
  windowRotations: 'WINDOW_ROTATIONS',
  sequenceEvents: 'SEQUENCE_EVENTS',
  intervalEvents: 'INTERVAL_EVENTS',
  choiceEvents: 'CHOICE_EVENTS',
  clockTemplates: 'CLOCK_TEMPLATES',
  temporaryOverrides: 'TEMPORARY_OVERRIDES',
  dateEvents: 'DATE_EVENTS',
  offlineWindows: 'OFFLINE_WINDOWS'
};

function validateProject(project) {
  const errors = [];
  const warnings = [];
  const addError = (pathName, message) => errors.push({ path: pathName, message });
  const addWarning = (pathName, message) => warnings.push({ path: pathName, message });

  if (!project || typeof project !== 'object') {
    return { ok: false, errors: [{ path: 'project', message: 'Projeto invalido.' }], warnings: [] };
  }

  if (!String(project.name || '').trim()) addError('name', 'Informe o nome do projeto.');
  validateFileName(project.fileName, addError);
  const templateVersion = String(project.templateVersion || TEMPLATE_VERSION);
  if (!SUPPORTED_TEMPLATE_VERSIONS.includes(templateVersion)) addError('templateVersion', `Motor ${templateVersion} nao esta disponivel nesta versao.`);

  const groups = Array.isArray(project.graphicsGroups) ? project.graphicsGroups : [];
  const groupMap = uniqueMap(groups, 'key', 'graphicsGroups', addError);
  validateGraphicsGroups(groups, groupMap, addError);

  const sources = Array.isArray(project.sources) ? project.sources : [];
  const sourceMap = uniqueMap(sources, 'key', 'sources', addError);
  validateSources(sources, addError);

  const playlists = Array.isArray(project.scriptedPlaylists) ? project.scriptedPlaylists : [];
  const playlistMap = uniqueMap(playlists, 'key', 'scriptedPlaylists', addError);
  for (const key of playlistMap.keys()) if (sourceMap.has(key)) addError('scriptedPlaylists', `A chave ${key} tambem existe em SOURCES.`);
  validateScriptedPlaylists(playlists, sourceMap, addError);

  const profiles = Array.isArray(project.presentationProfiles) ? project.presentationProfiles : [];
  const profileMap = uniqueMap(profiles, 'key', 'presentationProfiles', addError);
  if (!profileMap.has('none')) addError('presentationProfiles', 'O perfil reservado "none" precisa existir.');
  validateProfiles(profiles, groupMap, playlistMap, addError);

  for (const [index, source] of sources.entries()) {
    validatePresentationRef(source.presentation, profileMap, `sources[${index}].presentation`, addError);
  }

  const modules = project.modules && typeof project.modules === 'object' ? project.modules : {};
  for (const type of MODULE_TYPES) {
    if (!Array.isArray(modules[type])) addError(`modules.${type}`, `${MODULE_LABELS[type]} precisa ser uma lista.`);
  }
  const v13Modules = ['countRotation', 'weightedRotation', 'continuousBlocks', 'contentBreaks', 'fitToWindow', 'choiceEvents', 'clockTemplates', 'temporaryOverrides'];
  if (v13Modules.some((type) => Array.isArray(modules[type]) && modules[type].length) && !templateAtLeast(templateVersion, '1.3.0')) {
    addError('templateVersion', 'Os novos módulos da v3.4.0 exigem o motor 1.3.0.');
  }

  validateRotation(modules.rotation || [], sourceMap, profileMap, project.options, project, addError);
  validateTimedModules(modules, sourceMap, profileMap, project, addError);
  validateEventIds(modules, addError);
  validateFiller(project.filler, sourceMap, profileMap, addError);
  validateOptions(project.options, addError);
  validateChannelLinks(project.channelLinks, addError);

  if (!hasBackground(project)) {
    addWarning('modules', 'Sem modulo de fundo e sem FILLER, os intervalos sem eventos ficam intencionalmente sem programacao.');
  }
  addScheduleWarnings(modules, addWarning);
  addBackgroundWarnings(modules, addWarning);

  return { ok: errors.length === 0, errors, warnings };
}

function validateFileName(fileName, addError) {
  const value = String(fileName || '').trim();
  if (!value) return addError('fileName', 'Informe o nome do arquivo Python.');
  if (path.basename(value) !== value || value.includes('..') || /[\\/]/.test(value)) {
    return addError('fileName', 'Use apenas o nome do arquivo, sem pastas ou ..');
  }
  if (!/^[A-Za-z0-9._-]+\.py$/i.test(value)) addError('fileName', 'O arquivo deve terminar em .py e usar somente letras, numeros, ponto, _ ou -.');
}

function uniqueMap(items, keyField, basePath, addError) {
  const map = new Map();
  items.forEach((item, index) => {
    const key = String(item && item[keyField] || '').trim();
    if (!key) {
      addError(`${basePath}[${index}].${keyField}`, 'Informe uma chave.');
      return;
    }
    if (!KEY_RE.test(key)) addError(`${basePath}[${index}].${keyField}`, 'Use somente letras, numeros, _, . ou - na chave.');
    if (map.has(key)) addError(`${basePath}[${index}].${keyField}`, `A chave ${key} esta duplicada.`);
    else map.set(key, item);
  });
  return map;
}

function validateGraphicsGroups(groups, groupMap, addError) {
  const visiting = new Set();
  const visited = new Set();
  function visit(key, trail = []) {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      addError('graphicsGroups', `Referencia circular entre grupos de Graphics: ${[...trail, key].join(' -> ')}`);
      return;
    }
    visiting.add(key);
    const group = groupMap.get(key) || {};
    for (const include of group.includes || []) {
      const ref = String(include || '').trim();
      if (!groupMap.has(ref)) addError(`graphicsGroups.${key}.includes`, `Grupo ${ref} nao existe.`);
      else visit(ref, [...trail, key]);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const [key, group] of groupMap) {
    if (!Array.isArray(group.graphics)) addError(`graphicsGroups.${key}.graphics`, 'Graphics precisa ser uma lista.');
    if (!Array.isArray(group.includes)) addError(`graphicsGroups.${key}.includes`, 'Includes precisa ser uma lista.');
    visit(key);
  }
}

function validateSources(sources, addError) {
  sources.forEach((source, index) => {
    const base = `sources[${index}]`;
    const type = String(source && source.type || '').trim();
    if (!SOURCE_TYPES.has(type)) addError(`${base}.type`, `Tipo de Source invalido: ${type || '(vazio)'}.`);
    const order = String(source && source.order || 'chronological');
    if (['smart_collection', 'collection', 'multi_collection', 'search', 'show'].includes(type) && !ORDERS.has(order)) {
      addError(`${base}.order`, 'Order deve ser chronological ou shuffle.');
    }
    if (['smart_collection', 'collection', 'multi_collection'].includes(type) && !String(source.name || '').trim()) addError(`${base}.name`, 'Informe o nome no ErsatzTV.');
    if (type === 'playlist') {
      if (!String(source.playlist || '').trim()) addError(`${base}.playlist`, 'Informe a Playlist.');
      if (!String(source.playlistGroup || '').trim()) addError(`${base}.playlistGroup`, 'Informe o Playlist Group.');
    }
    if (type === 'search' && !String(source.query || '').trim()) addError(`${base}.query`, 'Informe a query.');
    if (type === 'show') {
      if (!Array.isArray(source.guids) || source.guids.length === 0) addError(`${base}.guids`, 'Informe ao menos um GUID.');
      for (const [gIndex, guid] of (source.guids || []).entries()) {
        if (!String(guid.provider || '').trim() || !String(guid.value || '').trim()) addError(`${base}.guids[${gIndex}]`, 'GUID precisa de provedor e valor.');
      }
    }
    if (type === 'marathon') {
      if (!new Set(['show', 'season', 'artist', 'album', 'director']).has(String(source.groupBy || ''))) addError(`${base}.groupBy`, 'group_by invalido.');
      if (!ORDERS.has(String(source.itemOrder || 'chronological'))) addError(`${base}.itemOrder`, 'item_order deve ser chronological ou shuffle.');
    }
  });
}

function validateScriptedPlaylists(playlists, sourceMap, addError) {
  playlists.forEach((playlist, index) => {
    const base = `scriptedPlaylists[${index}]`;
    if (!Array.isArray(playlist.items) || playlist.items.length === 0) addError(`${base}.items`, 'Adicione pelo menos um item.');
    for (const [itemIndex, item] of (playlist.items || []).entries()) {
      requireSource(item.source, sourceMap, `${base}.items[${itemIndex}].source`, addError);
      positiveInt(item.count, `${base}.items[${itemIndex}].count`, addError);
    }
  });
}

function validateProfiles(profiles, groupMap, playlistMap, addError) {
  profiles.forEach((profile, index) => {
    const base = `presentationProfiles[${index}]`;
    for (const group of profile.graphicsGroups || []) {
      if (!groupMap.has(String(group))) addError(`${base}.graphicsGroups`, `Grupo de Graphics ${group} nao existe.`);
    }
    const preRoll = String(profile.preRoll || '').trim();
    if (preRoll && !playlistMap.has(preRoll)) addError(`${base}.preRoll`, `Scripted Playlist ${preRoll} nao existe.`);
    if (profile.epgGroup && !String(profile.epgTitle || '').trim()) {
      // ErsatzTV accepts an empty title, but the builder keeps it explicit for a friendlier result.
      addError(`${base}.epgTitle`, 'Informe o titulo do grupo EPG.');
    }
  });
}

function validatePresentationRef(value, profileMap, pathName, addError) {
  const key = String(value || '').trim();
  if (key && !profileMap.has(key)) addError(pathName, `Presentation ${key} nao existe.`);
}

function validateRotation(items, sourceMap, profileMap, options, project, addError) {
  const fallback = Number(options && options.defaultRotationDurationMinutes);
  if (items.length && !(fallback > 0)) addError('options.defaultRotationDurationMinutes', 'A duracao padrao da ROTATION precisa ser maior que zero.');
  items.forEach((item, index) => {
    const base = `modules.rotation[${index}]`;
    requireSource(item.source, sourceMap, `${base}.source`, addError);
    validatePresentationRef(item.presentation, profileMap, `${base}.presentation`, addError);
    if (item.durationMinutes !== '' && item.durationMinutes !== null && item.durationMinutes !== undefined) positiveNumber(item.durationMinutes, `${base}.durationMinutes`, addError);
    validatePadToNearest(item, base, project, addError);
    validatePlayback(item, sourceMap, base, addError);
  });
}

function validateTimedModules(modules, sourceMap, profileMap, project, addError) {
  (modules.countRotation || []).forEach((e, i) => {
    const base = `modules.countRotation[${i}]`;
    requireSource(e.source, sourceMap, `${base}.source`, addError); validatePresentationRef(e.presentation, profileMap, `${base}.presentation`, addError);
    positiveInt(e.count, `${base}.count`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.weightedRotation || []).forEach((e, i) => {
    const base = `modules.weightedRotation[${i}]`;
    requireSource(e.source, sourceMap, `${base}.source`, addError); validatePresentationRef(e.presentation, profileMap, `${base}.presentation`, addError);
    positiveNumber(e.weight, `${base}.weight`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.continuousBlocks || []).forEach((e, i) => {
    const base = `modules.continuousBlocks[${i}]`;
    commonEvent(e, base, profileMap, addError); time(e.startTime, `${base}.startTime`, addError); requireSource(e.source, sourceMap, `${base}.source`, addError);
    validatePlayback(e, sourceMap, base, addError);
  });
  (modules.contentBreaks || []).forEach((e, i) => {
    const base = `modules.contentBreaks[${i}]`;
    commonEvent(e, base, profileMap, addError); requireSource(e.source, sourceMap, `${base}.source`, addError); positiveInt(e.everyItems, `${base}.everyItems`, addError);
    requireSource(e.breakSource, sourceMap, `${base}.breakSource`, addError); positiveInt(e.breakCount, `${base}.breakCount`, addError);
    validatePresentationRef(e.breakPresentation, profileMap, `${base}.breakPresentation`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.fitToWindow || []).forEach((e, i) => {
    const base = `modules.fitToWindow[${i}]`;
    commonEvent(e, base, profileMap, addError); time(e.startTime, `${base}.startTime`, addError); time(e.endTime, `${base}.endTime`, addError);
    requireSource(e.source, sourceMap, `${base}.source`, addError); positiveInt(e.lookAheadMinutes, `${base}.lookAheadMinutes`, addError);
    if (!Number.isInteger(Number(e.discardAttempts || 0)) || Number(e.discardAttempts || 0) < 0) addError(`${base}.discardAttempts`, 'Tentativas descartadas precisa ser zero ou um inteiro positivo.');
    if (e.useFillerRemainder !== false && (!project.filler || !String(project.filler.source || '').trim())) addError(`${base}.useFillerRemainder`, 'Configure o Filler ou desative o preenchimento do restante.');
    validatePlayback(e, sourceMap, base, addError);
  });
  (modules.fixedEvents || []).forEach((e, i) => {
    const base = `modules.fixedEvents[${i}]`; commonEvent(e, base, profileMap, addError); time(e.time, `${base}.time`, addError);
    requireSource(e.source, sourceMap, `${base}.source`, addError); positiveInt(e.count, `${base}.count`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.fixedDurationEvents || []).forEach((e, i) => {
    const base = `modules.fixedDurationEvents[${i}]`; commonEvent(e, base, profileMap, addError); time(e.time, `${base}.time`, addError);
    requireSource(e.source, sourceMap, `${base}.source`, addError); positiveNumber(e.durationMinutes, `${base}.durationMinutes`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.fixedAllEvents || []).forEach((e, i) => {
    const base = `modules.fixedAllEvents[${i}]`; commonEvent(e, base, profileMap, addError); time(e.time, `${base}.time`, addError);
    requireSource(e.source, sourceMap, `${base}.source`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.fixedWindowEvents || []).forEach((e, i) => {
    const base = `modules.fixedWindowEvents[${i}]`; commonEvent(e, base, profileMap, addError); time(e.startTime, `${base}.startTime`, addError); time(e.endTime, `${base}.endTime`, addError);
    requireSource(e.source, sourceMap, `${base}.source`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.windowRotations || []).forEach((e, i) => {
    const base = `modules.windowRotations[${i}]`; commonEvent(e, base, profileMap, addError); time(e.startTime, `${base}.startTime`, addError); time(e.endTime, `${base}.endTime`, addError); positiveNumber(e.blockMinutes, `${base}.blockMinutes`, addError);
    if (!Array.isArray(e.items) || !e.items.length) addError(`${base}.items`, 'Adicione pelo menos uma Source na rotacao da janela.');
    for (const [j, item] of (e.items || []).entries()) {
      requireSource(item.source, sourceMap, `${base}.items[${j}].source`, addError); validatePresentationRef(item.presentation, profileMap, `${base}.items[${j}].presentation`, addError);
      if (item.durationMinutes !== '' && item.durationMinutes !== null && item.durationMinutes !== undefined) positiveNumber(item.durationMinutes, `${base}.items[${j}].durationMinutes`, addError);
      validatePadToNearest(item, `${base}.items[${j}]`, project, addError); validatePlayback(item, sourceMap, `${base}.items[${j}]`, addError);
    }
  });
  (modules.sequenceEvents || []).forEach((e, i) => {
    const base = `modules.sequenceEvents[${i}]`; commonEvent(e, base, profileMap, addError); time(e.time, `${base}.time`, addError);
    validateSteps(e.steps, sourceMap, profileMap, `${base}.steps`, addError); validatePadToNearest(e, base, project, addError);
  });
  (modules.intervalEvents || []).forEach((e, i) => {
    const base = `modules.intervalEvents[${i}]`; commonEvent(e, base, profileMap, addError); time(e.startTime, `${base}.startTime`, addError); time(e.endTime, `${base}.endTime`, addError); positiveInt(e.everyMinutes, `${base}.everyMinutes`, addError);
    validateModeEvent(e, sourceMap, profileMap, base, addError, false); if (!['queue', 'skip'].includes(String(e.latePolicy || 'queue'))) addError(`${base}.latePolicy`, 'late_policy deve ser queue ou skip.');
    validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.choiceEvents || []).forEach((e, i) => {
    const base = `modules.choiceEvents[${i}]`; commonEvent(e, base, profileMap, addError); time(e.time, `${base}.time`, addError);
    const mode = String(e.mode || 'count'); if (!['count', 'duration', 'all'].includes(mode)) addError(`${base}.mode`, 'Modo deve ser count, duration ou all.');
    if (mode === 'count') positiveInt(e.count, `${base}.count`, addError); if (mode === 'duration') positiveNumber(e.durationMinutes, `${base}.durationMinutes`, addError);
    if (!['weighted', 'round_robin'].includes(String(e.selection || 'weighted'))) addError(`${base}.selection`, 'Selecao deve ser weighted ou round_robin.');
    if (!Array.isArray(e.choices) || !e.choices.length) addError(`${base}.choices`, 'Adicione pelo menos uma Source para escolha.');
    (e.choices || []).forEach((choice, j) => { requireSource(choice.source, sourceMap, `${base}.choices[${j}].source`, addError); validatePresentationRef(choice.presentation, profileMap, `${base}.choices[${j}].presentation`, addError); positiveNumber(choice.weight || 1, `${base}.choices[${j}].weight`, addError); validatePlayback(choice, sourceMap, `${base}.choices[${j}]`, addError); });
    validatePadToNearest(e, base, project, addError);
  });
  (modules.clockTemplates || []).forEach((e, i) => {
    const base = `modules.clockTemplates[${i}]`; commonEvent(e, base, profileMap, addError); time(e.startTime, `${base}.startTime`, addError); time(e.endTime, `${base}.endTime`, addError); positiveInt(e.cycleMinutes, `${base}.cycleMinutes`, addError);
    if (!Array.isArray(e.slots) || !e.slots.length) addError(`${base}.slots`, 'Adicione pelo menos uma posicao ao relogio.');
    (e.slots || []).forEach((slot, j) => { const p = `${base}.slots[${j}]`; const offset = Number(slot.offsetMinutes); if (!Number.isInteger(offset) || offset < 0 || offset >= Number(e.cycleMinutes || 0)) addError(`${p}.offsetMinutes`, 'A posicao precisa estar dentro do ciclo.'); requireSource(slot.source, sourceMap, `${p}.source`, addError); validatePresentationRef(slot.presentation, profileMap, `${p}.presentation`, addError); const mode = String(slot.mode || 'count'); if (!['count','duration','all'].includes(mode)) addError(`${p}.mode`, 'Modo invalido.'); if (mode === 'count') positiveInt(slot.count, `${p}.count`, addError); if (mode === 'duration') positiveNumber(slot.durationMinutes, `${p}.durationMinutes`, addError); validatePadToNearest(slot, p, project, addError); validatePlayback(slot, sourceMap, p, addError); });
  });
  (modules.temporaryOverrides || []).forEach((e, i) => {
    const base = `modules.temporaryOverrides[${i}]`; commonEvent(e, base, profileMap, addError);
    if (!DATE_TIME_RE.test(String(e.startDatetime || ''))) addError(`${base}.startDatetime`, 'Use AAAA-MM-DD HH:MM.');
    if (!DATE_TIME_RE.test(String(e.endDatetime || ''))) addError(`${base}.endDatetime`, 'Use AAAA-MM-DD HH:MM.');
    if (DATE_TIME_RE.test(String(e.startDatetime || '')) && DATE_TIME_RE.test(String(e.endDatetime || '')) && String(e.endDatetime) <= String(e.startDatetime)) addError(`${base}.endDatetime`, 'O fim precisa ser posterior ao inicio.');
    requireSource(e.source, sourceMap, `${base}.source`, addError); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.dateEvents || []).forEach((e, i) => {
    const base = `modules.dateEvents[${i}]`; commonEvent(e, base, profileMap, addError); if (!DATE_TIME_RE.test(String(e.datetime || ''))) addError(`${base}.datetime`, 'Use data e hora no formato AAAA-MM-DD HH:MM.');
    validateModeEvent(e, sourceMap, profileMap, base, addError, true); validatePadToNearest(e, base, project, addError); validatePlayback(e, sourceMap, base, addError);
  });
  (modules.offlineWindows || []).forEach((e, i) => { const base = `modules.offlineWindows[${i}]`; commonEvent(e, base, profileMap, addError); time(e.startTime, `${base}.startTime`, addError); time(e.endTime, `${base}.endTime`, addError); });
}

function validateModeEvent(e, sourceMap, profileMap, base, addError, allowSequence) {
  const allowed = allowSequence ? ['count', 'duration', 'all', 'sequence'] : ['count', 'duration', 'all'];
  const mode = String(e.mode || 'count');
  if (!allowed.includes(mode)) return addError(`${base}.mode`, `Modo invalido: ${mode}.`);
  if (mode === 'sequence') return validateSteps(e.steps, sourceMap, profileMap, `${base}.steps`, addError);
  requireSource(e.source, sourceMap, `${base}.source`, addError);
  if (mode === 'count') positiveInt(e.count, `${base}.count`, addError);
  if (mode === 'duration') positiveNumber(e.durationMinutes, `${base}.durationMinutes`, addError);
}

function validateSteps(steps, sourceMap, profileMap, base, addError) {
  if (!Array.isArray(steps) || !steps.length) return addError(base, 'Adicione pelo menos um passo.');
  steps.forEach((step, i) => {
    const p = `${base}[${i}]`;
    const mode = String(step.mode || 'count');
    if (!['count', 'duration', 'all', 'pad_to_next', 'wait'].includes(mode)) addError(`${p}.mode`, `Modo invalido: ${mode}.`);
    if (mode !== 'wait') requireSource(step.source, sourceMap, `${p}.source`, addError);
    validatePresentationRef(step.presentation, profileMap, `${p}.presentation`, addError);
    if (mode === 'count') positiveInt(step.count, `${p}.count`, addError);
    if (['duration', 'wait'].includes(mode)) positiveNumber(step.durationMinutes, `${p}.durationMinutes`, addError);
    if (mode === 'pad_to_next') positiveInt(step.minutes, `${p}.minutes`, addError);
  });
}

function validatePadToNearest(item, base, project, addError) {
  const raw = item && item.padToNearestMinutes;
  if (raw === '' || raw === null || raw === undefined) return;
  const value = Number(raw);
  if (!PAD_TO_NEAREST_VALUES.has(value)) { addError(`${base}.padToNearestMinutes`, 'Pad To Nearest Minute deve ser 5, 10, 15 ou 30.'); return; }
  if (!project.filler || !String(project.filler.source || '').trim()) addError(`${base}.padToNearestMinutes`, 'Configure o Filler antes de ativar Pad To Nearest Minute.');
  if (!templateAtLeast(String(project.templateVersion || TEMPLATE_VERSION), '1.2.0')) addError(`${base}.padToNearestMinutes`, 'Pad To Nearest Minute requer o motor 1.2.0 ou superior.');
}

function validatePlayback(item, sourceMap, base, addError) {
  if (item && item.fallback) requireSource(item.fallback, sourceMap, `${base}.fallback`, addError);
  if (item && item.discardAttempts !== '' && item.discardAttempts !== undefined && item.discardAttempts !== null) {
    const value = Number(item.discardAttempts); if (!Number.isInteger(value) || value < 0) addError(`${base}.discardAttempts`, 'Informe zero ou um numero inteiro positivo.');
  }
}

function templateAtLeast(value, minimum) {
  const a = String(value || '0').split('.').map((n) => Number(n) || 0); const b = String(minimum || '0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) { if ((a[i] || 0) > (b[i] || 0)) return true; if ((a[i] || 0) < (b[i] || 0)) return false; }
  return true;
}

function commonEvent(e, base, profileMap, addError) {
  if (!String(e.id || '').trim()) addError(`${base}.id`, 'Informe um ID unico para o evento.');
  validatePresentationRef(e.presentation, profileMap, `${base}.presentation`, addError);
  if (e.priority !== '' && e.priority !== undefined && e.priority !== null && !Number.isFinite(Number(e.priority))) addError(`${base}.priority`, 'Prioridade precisa ser numero.');
  validateDateFilters(e, base, addError);
}

function validateDateFilters(e, base, addError) {
  for (const field of ['startDate', 'endDate']) {
    if (e[field] && !DATE_RE.test(String(e[field]))) addError(`${base}.${field}`, 'Use AAAA-MM-DD.');
  }
  if (e.startDate && e.endDate && String(e.startDate) > String(e.endDate)) addError(`${base}.endDate`, 'A data final nao pode ser anterior a inicial.');
  for (const field of ['dates', 'excludeDates']) {
    for (const [i, value] of (Array.isArray(e[field]) ? e[field] : []).entries()) {
      if (!DATE_RE.test(String(value))) addError(`${base}.${field}[${i}]`, 'Use AAAA-MM-DD.');
    }
  }
  const recurrence = String(e.recurrenceType || 'none');
  if (!['none', 'monthly_nth_weekday', 'every_n_days'].includes(recurrence)) addError(`${base}.recurrenceType`, 'Recorrencia invalida.');
  if (recurrence === 'monthly_nth_weekday') {
    if (![1,2,3,4,-1].includes(Number(e.recurrenceOrdinal))) addError(`${base}.recurrenceOrdinal`, 'Escolha primeiro, segundo, terceiro, quarto ou ultimo.');
    if (!Number.isInteger(Number(e.recurrenceWeekday)) || Number(e.recurrenceWeekday) < 0 || Number(e.recurrenceWeekday) > 6) addError(`${base}.recurrenceWeekday`, 'Dia da semana invalido.');
  }
  if (recurrence === 'every_n_days') { positiveInt(e.recurrenceEveryDays, `${base}.recurrenceEveryDays`, addError); if (!DATE_RE.test(String(e.recurrenceAnchorDate || ''))) addError(`${base}.recurrenceAnchorDate`, 'Informe a data inicial da recorrencia.'); }
}


function validateEventIds(modules, addError) {
  const seen = new Map();
  for (const type of ['continuousBlocks','contentBreaks','fitToWindow','fixedEvents','fixedDurationEvents','fixedAllEvents','fixedWindowEvents','windowRotations','sequenceEvents','intervalEvents','choiceEvents','clockTemplates','temporaryOverrides','dateEvents','offlineWindows']) {
    for (const [index, item] of (modules[type] || []).entries()) {
      const id = String(item.id || '').trim();
      if (!id) continue;
      if (seen.has(id)) addError(`modules.${type}[${index}].id`, `O ID ${id} ja esta sendo usado em ${seen.get(id)}.`);
      else seen.set(id, `${MODULE_LABELS[type]}[${index}]`);
    }
  }
}

function validateFiller(filler, sourceMap, profileMap, addError) {
  if (!filler) return;
  requireSource(filler.source, sourceMap, 'filler.source', addError);
  validatePresentationRef(filler.presentation, profileMap, 'filler.presentation', addError);
}

function validateOptions(options = {}, addError) {
  positiveNumber(options.defaultRotationDurationMinutes, 'options.defaultRotationDurationMinutes', addError);
  if (!Number.isFinite(Number(options.defaultFixedPriority))) addError('options.defaultFixedPriority', 'Prioridade padrao precisa ser numero.');
  positiveInt(options.httpTimeoutSeconds, 'options.httpTimeoutSeconds', addError);
  positiveInt(options.seenOccurrenceRetentionDays, 'options.seenOccurrenceRetentionDays', addError);
}

function validateChannelLinks(links, addError) {
  if (!Array.isArray(links)) return addError('channelLinks', 'Vinculos de canais precisa ser uma lista.');
  const numbers = new Set();
  const stateKeys = new Set();
  links.forEach((link, i) => {
    const number = String(link.channelNumber || '').trim();
    const stateKey = String(link.stateKey || '').trim();
    if (!number) addError(`channelLinks[${i}].channelNumber`, 'Selecione um canal do ErsatzTV.');
    if (number && numbers.has(number)) addError(`channelLinks[${i}].channelNumber`, 'Canal duplicado neste projeto.');
    numbers.add(number);
    if (!stateKey || !KEY_RE.test(stateKey)) addError(`channelLinks[${i}].stateKey`, 'state_key deve usar letras, numeros, _, . ou -.');
    if (stateKey && stateKeys.has(stateKey)) addError(`channelLinks[${i}].stateKey`, 'state_key precisa ser exclusivo neste projeto.');
    stateKeys.add(stateKey);
  });
}

function requireSource(value, sourceMap, pathName, addError) {
  const key = String(value || '').trim();
  if (!key || !sourceMap.has(key)) addError(pathName, `Source ${key || '(vazia)'} nao existe.`);
}

function positiveNumber(value, pathName, addError) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) addError(pathName, 'Informe um numero maior que zero.');
}
function positiveInt(value, pathName, addError) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) addError(pathName, 'Informe um numero inteiro maior que zero.');
}
function time(value, pathName, addError) {
  if (!TIME_RE.test(String(value || ''))) addError(pathName, 'Use horario HH:MM.');
}
function hasBackground(project) {
  return Boolean(project.filler) || Boolean(project.modules && ['rotation','countRotation','weightedRotation','continuousBlocks','contentBreaks','fitToWindow'].some((type) => Array.isArray(project.modules[type]) && project.modules[type].length));
}

function addBackgroundWarnings(modules, addWarning) {
  const labels = {
    rotation: 'Rotação por tempo',
    countRotation: 'Rotação por quantidade',
    weightedRotation: 'Rotação por peso',
    continuousBlocks: 'Bloco contínuo por horário',
    contentBreaks: 'Inserções após X itens'
  };
  const active = Object.keys(labels).filter((type) => Array.isArray(modules[type]) && modules[type].length);
  if (active.length <= 1) return;
  addWarning(
    'modules',
    `Ha mais de uma programacao-base configurada (${active.map((type) => labels[type]).join(', ')}). Isso pode ser intencional, mas uma base pode esconder outra. Em geral escolha uma delas e use eventos fixos por cima.`
  );
}

function addScheduleWarnings(modules, addWarning) {
  const timed = [];
  for (const [type, fields] of Object.entries({
    fixedEvents: ['time'], fixedDurationEvents: ['time'], fixedAllEvents: ['time'], sequenceEvents: ['time']
  })) {
    for (const item of modules[type] || []) {
      if (item.time) timed.push({ type, time: item.time, priority: Number(item.priority || 100), id: item.id || '' });
    }
  }
  const buckets = new Map();
  for (const item of timed) {
    const key = `${item.time}:${item.priority}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  for (const [key, items] of buckets) {
    if (items.length > 1) addWarning('modules', `Ha ${items.length} eventos no mesmo horario/prioridade (${key}). Em empate, quem ja estiver tocando continua e os demais aguardam.`);
  }
}

module.exports = { validateProject, TIME_RE, DATE_RE, DATE_TIME_RE };
