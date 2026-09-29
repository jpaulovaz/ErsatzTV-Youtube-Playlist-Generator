const fs = require('fs/promises');
const path = require('path');
const {
  TEMPLATE_VERSION,
  SUPPORTED_TEMPLATE_VERSIONS,
  normalizeGraphicsElementPath,
  sourceSupportsPlaybackOrder,
  normalizePlaybackOrder
} = require('./schema');
const { validateProject } = require('./validator');

const TEMPLATE_PATHS = Object.fromEntries(SUPPORTED_TEMPLATE_VERSIONS.map((version) => [version, path.join(__dirname, 'templates', `universal-v${version}.py.tpl`)]));

function py(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const next = indent + 4;
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Numero invalido ao gerar Python.');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value).replace(/\\\//g, '/');
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[` + value.map((item) => `\n${' '.repeat(next)}${py(item, next)}`).join(',') + `,\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return '{}';
    return `{` + entries.map(([key, item]) => `\n${' '.repeat(next)}${py(String(key))}: ${py(item, next)}`).join(',') + `,\n${pad}}`;
  }
  throw new Error(`Tipo nao suportado na geracao Python: ${typeof value}`);
}

function cleanString(value) {
  return String(value ?? '').trim();
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

function arrayStrings(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function objectFromPairs(value) {
  const result = {};
  for (const item of Array.isArray(value) ? value : []) {
    const key = cleanString(item && item.key);
    if (key) result[key] = String((item && item.value) ?? '');
  }
  return result;
}

function groupResolver(project) {
  const groups = new Map((project.graphicsGroups || []).map((item) => [String(item.key), item]));
  const memo = new Map();
  function resolve(key, stack = []) {
    if (memo.has(key)) return memo.get(key);
    if (stack.includes(key)) throw new Error(`Referencia circular de Graphics: ${[...stack, key].join(' -> ')}`);
    const group = groups.get(key);
    if (!group) return [];
    const result = [];
    for (const include of group.includes || []) {
      for (const item of resolve(String(include), [...stack, key])) if (!result.includes(item)) result.push(item);
    }
    for (const item of group.graphics || []) {
      const text = normalizeGraphicsElementPath(item);
      if (text && !result.includes(text)) result.push(text);
    }
    memo.set(key, result);
    return result;
  }
  return resolve;
}

function sourceToEngine(source, order = undefined) {
  const type = cleanString(source.type);
  const common = compact({
    type,
    order: sourceSupportsPlaybackOrder(source) ? normalizePlaybackOrder(order) : undefined,
    presentation: source.presentation
  });
  if (['smart_collection', 'collection', 'multi_collection'].includes(type)) return { ...common, name: cleanString(source.name) };
  if (type === 'playlist') return { ...common, playlist: cleanString(source.playlist), playlist_group: cleanString(source.playlistGroup) };
  if (type === 'search') return { ...common, query: String(source.query || '') };
  if (type === 'show') return { ...common, guids: objectFromPairs((source.guids || []).map((item) => ({ key: item.provider, value: item.value }))) };
  if (type === 'marathon') {
    return compact({
      ...common,
      group_by: source.groupBy,
      item_order: source.itemOrder,
      guids: objectFromPairs((source.guids || []).map((item) => ({ key: item.provider, value: item.value }))),
      searches: arrayStrings(source.searches),
      play_all_items: Boolean(source.playAllItems),
      shuffle_groups: Boolean(source.shuffleGroups)
    });
  }
  return common;
}

function normalizeFillerKind(value, fallback = undefined) {
  const normalized = cleanString(value).toLowerCase();
  return ['none', 'preroll', 'midroll', 'postroll'].includes(normalized) ? normalized : fallback;
}

function playbackFields(input = {}, resolveSource = (key) => key) {
  const trim = input.trim === true;
  return compact({
    custom_title: input.customTitle,
    filler_kind: input.fillerKind,
    disable_watermarks: input.disableWatermarks === true ? true : undefined,
    fallback: input.fallback ? resolveSource(input.fallback, input.fallbackOrder) : undefined,
    trim: trim ? true : undefined,
    discard_attempts: input.discardAttempts !== '' && input.discardAttempts !== undefined ? Number(input.discardAttempts) : undefined,
    offline_tail: input.offlineTail === true ? true : undefined,
    // Trim e overrun sao intencoes opostas. Se Trim estiver ligado, o motor deve respeitar o limite.
    allow_overrun: trim ? false : (input.allowOverrun === false ? false : undefined)
  });
}

function startTimingFields(input = {}) {
  const policy = cleanString(input.startPolicy).toLowerCase();
  const normalized = ['wait', 'closest'].includes(policy) ? policy : 'closest';
  const rawMaxEarly = input.maxEarlyMinutes;
  const maxEarly = rawMaxEarly === '' || rawMaxEarly === undefined || rawMaxEarly === null ? 40 : Number(rawMaxEarly);
  return {
    start_policy: normalized,
    max_early_minutes: Number.isFinite(maxEarly) ? Math.max(0, maxEarly) : 40
  };
}

function dateFields(input = {}) {
  return compact({
    days: arrayStrings(input.days),
    start_date: input.startDate,
    end_date: input.endDate,
    dates: arrayStrings(input.dates),
    exclude_dates: arrayStrings(input.excludeDates),
    recurrence_type: input.recurrenceType && input.recurrenceType !== 'none' ? input.recurrenceType : undefined,
    recurrence_ordinal: input.recurrenceOrdinal !== '' && input.recurrenceOrdinal !== undefined ? Number(input.recurrenceOrdinal) : undefined,
    recurrence_weekday: input.recurrenceWeekday !== '' && input.recurrenceWeekday !== undefined ? Number(input.recurrenceWeekday) : undefined,
    recurrence_every_days: input.recurrenceEveryDays !== '' && input.recurrenceEveryDays !== undefined ? Number(input.recurrenceEveryDays) : undefined,
    recurrence_anchor_date: input.recurrenceAnchorDate
  });
}

function baseEvent(input = {}, options = {}, resolveSource = (key) => key) {
  return compact({
    id: input.id,
    label: input.label,
    priority: input.priority !== '' && input.priority !== undefined ? Number(input.priority) : undefined,
    presentation: input.presentation,
    enabled: input.enabled === false ? false : undefined,
    pad_to_nearest_minutes: options.includePad === false ? undefined : (input.padToNearestMinutes !== '' && input.padToNearestMinutes !== null && input.padToNearestMinutes !== undefined ? Number(input.padToNearestMinutes) : undefined),
    ...dateFields(input),
    ...playbackFields(input, resolveSource)
  });
}


function sequenceSupportsItemPad(steps = []) {
  const modes = (steps || []).map((step) => String(step?.mode || 'count'));
  return modes.includes('count') && modes.every((mode) => !['duration', 'all'].includes(mode));
}

function versionAtLeast(value, minimum) {
  const a = String(value || '0').split('.').map((n) => Number(n) || 0);
  const b = String(minimum || '0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

function modeSupportsItemPad(mode, steps = []) {
  const normalized = String(mode || 'count');
  if (normalized === 'count') return true;
  if (normalized === 'sequence') return sequenceSupportsItemPad(steps);
  return false;
}

function stepToEngine(step = {}, resolveSource = (key) => key) {
  return compact({
    source: step.source ? resolveSource(step.source, step.order) : undefined,
    mode: step.mode,
    count: step.count !== '' && step.count !== undefined ? Number(step.count) : undefined,
    duration_minutes: step.durationMinutes !== '' && step.durationMinutes !== undefined ? Number(step.durationMinutes) : undefined,
    minutes: step.minutes !== '' && step.minutes !== undefined ? Number(step.minutes) : undefined,
    presentation: step.presentation,
    ...playbackFields(step, resolveSource)
  });
}

function modulesToEngine(project, resolveSource) {
  const modules = project.modules || {};
  const itemPadEngine = versionAtLeast(project.templateVersion || TEMPLATE_VERSION, '1.3.0');
  const closestStartEngine = versionAtLeast(project.templateVersion || TEMPLATE_VERSION, '1.3.1');
  const timing = (item) => closestStartEngine ? startTimingFields(item) : {};
  const rotation = (modules.rotation || []).map((item) => compact({
    source: resolveSource(item.source, item.order), presentation: item.presentation,
    duration_minutes: item.durationMinutes !== '' && item.durationMinutes !== undefined ? Number(item.durationMinutes) : undefined,
    pad_to_nearest_minutes: !itemPadEngine && item.padToNearestMinutes !== '' && item.padToNearestMinutes !== null && item.padToNearestMinutes !== undefined ? Number(item.padToNearestMinutes) : undefined,
    ...playbackFields(item, resolveSource)
  }));
  const countRotation = (modules.countRotation || []).map((item) => compact({
    source: resolveSource(item.source, item.order), presentation: item.presentation, count: Number(item.count),
    pad_to_nearest_minutes: item.padToNearestMinutes !== '' && item.padToNearestMinutes !== null && item.padToNearestMinutes !== undefined ? Number(item.padToNearestMinutes) : undefined,
    ...playbackFields(item, resolveSource)
  }));
  const weightedRotation = (modules.weightedRotation || []).map((item) => compact({
    source: resolveSource(item.source, item.order), presentation: item.presentation, weight: Number(item.weight), avoid_repeat: item.avoidRepeat === true ? true : undefined,
    pad_to_nearest_minutes: item.padToNearestMinutes !== '' && item.padToNearestMinutes !== null && item.padToNearestMinutes !== undefined ? Number(item.padToNearestMinutes) : undefined,
    ...playbackFields(item, resolveSource)
  }));
  const continuousBlocks = (modules.continuousBlocks || []).map((item) => compact({
    ...baseEvent(item, { includePad: false }, resolveSource), start_time: item.startTime, source: resolveSource(item.source, item.order)
  }));
  const contentBreaks = (modules.contentBreaks || []).map((item) => compact({
    ...baseEvent(item, {}, resolveSource), source: resolveSource(item.source, item.order), every_items: Number(item.everyItems), break_source: resolveSource(item.breakSource, item.breakOrder),
    break_count: Number(item.breakCount), break_presentation: item.breakPresentation,
    ...playbackFields(item, resolveSource), break_playback: playbackFields(item.breakPlayback || {}, resolveSource)
  }));
  const fitToWindow = (modules.fitToWindow || []).map((item) => compact({
    ...baseEvent(item, { includePad: false }, resolveSource), start_time: item.startTime, end_time: item.endTime, source: resolveSource(item.source, item.order),
    look_ahead_minutes: Number(item.lookAheadMinutes), discard_attempts: Number(item.discardAttempts || 0),
    use_filler_remainder: item.useFillerRemainder !== false
  }));
  const fixedEvents = (modules.fixedEvents || []).map((item) => compact({ ...baseEvent(item, {}, resolveSource), ...timing(item), time: item.time, source: resolveSource(item.source, item.order), count: Number(item.count) }));
  const fixedDurationEvents = (modules.fixedDurationEvents || []).map((item) => compact({ ...baseEvent(item, { includePad: !itemPadEngine }, resolveSource), ...timing(item), time: item.time, source: resolveSource(item.source, item.order), duration_minutes: Number(item.durationMinutes) }));
  const fixedAllEvents = (modules.fixedAllEvents || []).map((item) => compact({ ...baseEvent(item, { includePad: !itemPadEngine }, resolveSource), ...timing(item), time: item.time, source: resolveSource(item.source, item.order) }));
  const fixedWindowEvents = (modules.fixedWindowEvents || []).map((item) => compact({ ...baseEvent(item, { includePad: !itemPadEngine }, resolveSource), start_time: item.startTime, end_time: item.endTime, source: resolveSource(item.source, item.order) }));
  const windowRotations = (modules.windowRotations || []).map((item) => compact({
    ...baseEvent(item, { includePad: false }, resolveSource), start_time: item.startTime, end_time: item.endTime, block_minutes: Number(item.blockMinutes),
    items: (item.items || []).map((entry) => compact({
      source: resolveSource(entry.source, entry.order), presentation: entry.presentation,
      duration_minutes: entry.durationMinutes !== '' && entry.durationMinutes !== undefined ? Number(entry.durationMinutes) : undefined,
      pad_to_nearest_minutes: !itemPadEngine && entry.padToNearestMinutes !== '' && entry.padToNearestMinutes !== null && entry.padToNearestMinutes !== undefined ? Number(entry.padToNearestMinutes) : undefined,
      ...playbackFields(entry, resolveSource)
    }))
  }));
  const sequenceEvents = (modules.sequenceEvents || []).map((item) => compact({ ...baseEvent(item, { includePad: !itemPadEngine || sequenceSupportsItemPad(item.steps) }, resolveSource), ...timing(item), time: item.time, atomic: Boolean(item.atomic), steps: (item.steps || []).map((step) => stepToEngine(step, resolveSource)) }));
  const intervalEvents = (modules.intervalEvents || []).map((item) => compact({
    ...baseEvent(item, { includePad: !itemPadEngine || modeSupportsItemPad(item.mode) }, resolveSource), ...timing(item), start_time: item.startTime, end_time: item.endTime, every_minutes: Number(item.everyMinutes),
    source: item.source ? resolveSource(item.source, item.order) : undefined, mode: item.mode, count: item.count !== '' && item.count !== undefined ? Number(item.count) : undefined,
    duration_minutes: item.durationMinutes !== '' && item.durationMinutes !== undefined ? Number(item.durationMinutes) : undefined,
    late_policy: item.latePolicy || 'queue', max_lateness_minutes: item.maxLatenessMinutes !== '' && item.maxLatenessMinutes !== undefined ? Number(item.maxLatenessMinutes) : undefined
  }));
  const choiceEvents = (modules.choiceEvents || []).map((item) => compact({
    ...baseEvent(item, { includePad: !itemPadEngine || modeSupportsItemPad(item.mode) }, resolveSource), ...timing(item), time: item.time, mode: item.mode, count: item.count !== '' && item.count !== undefined ? Number(item.count) : undefined,
    duration_minutes: item.durationMinutes !== '' && item.durationMinutes !== undefined ? Number(item.durationMinutes) : undefined,
    selection: item.selection || 'weighted', choices: (item.choices || []).map((choice) => compact({
      source: resolveSource(choice.source, choice.order), presentation: choice.presentation, weight: Number(choice.weight || 1), ...playbackFields(choice, resolveSource)
    }))
  }));
  const clockTemplates = (modules.clockTemplates || []).map((item) => compact({
    ...baseEvent(item, { includePad: false }, resolveSource), ...timing(item), start_time: item.startTime, end_time: item.endTime, cycle_minutes: Number(item.cycleMinutes),
    slots: (item.slots || []).map((slot) => compact({
      offset_minutes: Number(slot.offsetMinutes), mode: slot.mode || 'count', source: resolveSource(slot.source, slot.order),
      count: slot.count !== '' && slot.count !== undefined ? Number(slot.count) : undefined,
      duration_minutes: slot.durationMinutes !== '' && slot.durationMinutes !== undefined ? Number(slot.durationMinutes) : undefined,
      presentation: slot.presentation, priority: slot.priority !== '' && slot.priority !== undefined ? Number(slot.priority) : undefined,
      pad_to_nearest_minutes: (!itemPadEngine || modeSupportsItemPad(slot.mode)) && slot.padToNearestMinutes !== '' && slot.padToNearestMinutes !== undefined ? Number(slot.padToNearestMinutes) : undefined,
      ...playbackFields(slot, resolveSource)
    }))
  }));
  const temporaryOverrides = (modules.temporaryOverrides || []).map((item) => compact({
    ...baseEvent(item, { includePad: !itemPadEngine }, resolveSource), start_datetime: item.startDatetime, end_datetime: item.endDatetime, source: resolveSource(item.source, item.order)
  }));
  const dateEvents = (modules.dateEvents || []).map((item) => compact({
    ...baseEvent(item, { includePad: !itemPadEngine || modeSupportsItemPad(item.mode, item.steps) }, resolveSource), ...timing(item), datetime: item.datetime, source: item.source ? resolveSource(item.source, item.order) : undefined, mode: item.mode,
    count: item.count !== '' && item.count !== undefined ? Number(item.count) : undefined,
    duration_minutes: item.durationMinutes !== '' && item.durationMinutes !== undefined ? Number(item.durationMinutes) : undefined,
    steps: item.mode === 'sequence' ? (item.steps || []).map((step) => stepToEngine(step, resolveSource)) : undefined
  }));
  const offlineWindows = (modules.offlineWindows || []).map((item) => compact({ ...baseEvent(item, { includePad: false }, resolveSource), start_time: item.startTime, end_time: item.endTime }));
  return { rotation, countRotation, weightedRotation, continuousBlocks, contentBreaks, fitToWindow, fixedEvents, fixedDurationEvents, fixedAllEvents, fixedWindowEvents, windowRotations, sequenceEvents, intervalEvents, choiceEvents, clockTemplates, temporaryOverrides, dateEvents, offlineWindows };
}

function createSourceCompiler(project) {
  const logicalSources = new Map((project.sources || []).map((source) => [cleanString(source.key), source]));
  const reservedKeys = new Set(logicalSources.keys());
  const engineSources = {};
  const variants = new Map();

  function variantKey(sourceKey, order) {
    const id = `${sourceKey}\u0000${order}`;
    if (variants.has(id)) return variants.get(id);
    const suffix = order === 'chronological' ? 'CHRONOLOGICAL' : 'SHUFFLE';
    const base = `${sourceKey}__${suffix}`;
    let candidate = base;
    let counter = 2;
    while (reservedKeys.has(candidate) || Object.prototype.hasOwnProperty.call(engineSources, candidate)) {
      candidate = `${base}_${counter}`;
      counter += 1;
    }
    variants.set(id, candidate);
    reservedKeys.add(candidate);
    return candidate;
  }

  function resolve(sourceKey, order = 'shuffle') {
    const key = cleanString(sourceKey);
    if (!key) return key;
    const source = logicalSources.get(key);
    if (!source) return key;
    if (sourceSupportsPlaybackOrder(source)) {
      const normalizedOrder = normalizePlaybackOrder(order);
      const keyForEngine = variantKey(key, normalizedOrder);
      if (!Object.prototype.hasOwnProperty.call(engineSources, keyForEngine)) {
        engineSources[keyForEngine] = sourceToEngine(source, normalizedOrder);
      }
      return keyForEngine;
    }
    if (!Object.prototype.hasOwnProperty.call(engineSources, key)) engineSources[key] = sourceToEngine(source);
    return key;
  }

  return { sources: engineSources, resolve };
}

function projectToEngine(project) {
  const resolveGroup = groupResolver(project);
  const sourceCompiler = createSourceCompiler(project);
  const resolveSource = sourceCompiler.resolve;

  const scriptedPlaylists = {};
  for (const playlist of project.scriptedPlaylists || []) {
    scriptedPlaylists[String(playlist.key)] = (playlist.items || []).map((item) => ({ source: resolveSource(item.source, item.order), count: Number(item.count) }));
  }

  const profiles = {};
  for (const profile of project.presentationProfiles || []) {
    if (String(profile && profile.key || '').trim().toLowerCase() === 'none') continue;
    const graphics = [];
    for (const groupKey of profile.graphicsGroups || []) {
      for (const item of resolveGroup(String(groupKey))) if (!graphics.includes(item)) graphics.push(item);
    }
    for (const item of profile.graphics || []) {
      const text = normalizeGraphicsElementPath(item);
      if (text && !graphics.includes(text)) graphics.push(text);
    }
    profiles[String(profile.key)] = compact({
      graphics,
      graphics_variables: objectFromPairs(profile.graphicsVariables),
      watermarks: arrayStrings(profile.watermarks),
      pre_roll: cleanString(profile.preRoll) || null,
      epg_group: Boolean(profile.epgGroup),
      epg_title: profile.epgGroup ? String(profile.epgTitle || '') : undefined,
      epg_advance: profile.epgGroup ? profile.epgAdvance !== false : undefined
    });
  }
  profiles.none = { graphics: [], graphics_variables: {}, watermarks: [], pre_roll: null, epg_group: false };

  const modules = modulesToEngine(project, resolveSource);
  const filler = project.filler ? compact({ source: resolveSource(project.filler.source, project.filler.order), presentation: project.filler.presentation, ...playbackFields(project.filler, resolveSource), filler_kind: normalizeFillerKind(project.filler.fillerKind, 'postroll') }) : null;
  const options = project.options || {};

  return {
    sources: sourceCompiler.sources,
    scriptedPlaylists,
    profiles,
    modules,
    filler,
    options: {
      defaultRotationDurationMinutes: Number(options.defaultRotationDurationMinutes) || 60,
      defaultFixedPriority: Number.isFinite(Number(options.defaultFixedPriority)) ? Number(options.defaultFixedPriority) : 100,
      allowOverrun: options.allowOverrun !== false,
      httpTimeoutSeconds: Number(options.httpTimeoutSeconds) || 30,
      seenOccurrenceRetentionDays: Number(options.seenOccurrenceRetentionDays) || 14
    }
  };
}

function generatedConfig(project, templateVersion = String(project.templateVersion || TEMPLATE_VERSION)) {
  const data = projectToEngine(project);
  return [
    '# Este bloco foi gerado automaticamente. Edite a configuracao no aplicativo.',
    `# Projeto: ${String(project.name || '').replace(/\r?\n/g, ' ')}`,
    `# Template: ${templateVersion}`,
    '',
    `SOURCES: dict[str, dict[str, Any]] = ${py(data.sources)}`,
    '',
    `SCRIPTED_PLAYLISTS: dict[str, list[dict[str, Any]]] = ${py(data.scriptedPlaylists)}`,
    '',
    `PRESENTATION_PROFILES: dict[str, dict[str, Any]] = ${py(data.profiles)}`,
    '',
    `DEFAULT_ROTATION_DURATION_MINUTES = ${py(data.options.defaultRotationDurationMinutes)}`,
    `ROTATION: list[dict[str, Any]] = ${py(data.modules.rotation)}`,
    `COUNT_ROTATION: list[dict[str, Any]] = ${py(data.modules.countRotation)}`,
    `WEIGHTED_ROTATION: list[dict[str, Any]] = ${py(data.modules.weightedRotation)}`,
    `CONTINUOUS_BLOCKS: list[dict[str, Any]] = ${py(data.modules.continuousBlocks)}`,
    `CONTENT_BREAKS: list[dict[str, Any]] = ${py(data.modules.contentBreaks)}`,
    `FIT_TO_WINDOW: list[dict[str, Any]] = ${py(data.modules.fitToWindow)}`,
    '',
    `FIXED_EVENTS: list[dict[str, Any]] = ${py(data.modules.fixedEvents)}`,
    `FIXED_DURATION_EVENTS: list[dict[str, Any]] = ${py(data.modules.fixedDurationEvents)}`,
    `FIXED_ALL_EVENTS: list[dict[str, Any]] = ${py(data.modules.fixedAllEvents)}`,
    `FIXED_WINDOW_EVENTS: list[dict[str, Any]] = ${py(data.modules.fixedWindowEvents)}`,
    `WINDOW_ROTATIONS: list[dict[str, Any]] = ${py(data.modules.windowRotations)}`,
    `SEQUENCE_EVENTS: list[dict[str, Any]] = ${py(data.modules.sequenceEvents)}`,
    `INTERVAL_EVENTS: list[dict[str, Any]] = ${py(data.modules.intervalEvents)}`,
    `CHOICE_EVENTS: list[dict[str, Any]] = ${py(data.modules.choiceEvents)}`,
    `CLOCK_TEMPLATES: list[dict[str, Any]] = ${py(data.modules.clockTemplates)}`,
    `TEMPORARY_OVERRIDES: list[dict[str, Any]] = ${py(data.modules.temporaryOverrides)}`,
    `DATE_EVENTS: list[dict[str, Any]] = ${py(data.modules.dateEvents)}`,
    `OFFLINE_WINDOWS: list[dict[str, Any]] = ${py(data.modules.offlineWindows)}`,
    '',
    `FILLER: dict[str, Any] | None = ${py(data.filler)}`,
    '',
    `DEFAULT_FIXED_PRIORITY = ${py(data.options.defaultFixedPriority)}`,
    `ALLOW_OVERRUN = ${py(data.options.allowOverrun)}`,
    `HTTP_TIMEOUT_SECONDS = ${py(data.options.httpTimeoutSeconds)}`,
    `DEFAULT_STATE_DIR = Path(os.environ.get("ETV_SCRIPT_STATE_DIR", Path(__file__).resolve().parent))`,
    `STATE_VERSION = ${versionAtLeast(templateVersion, '1.3.1') ? 12 : 11}`,
    `SEEN_OCCURRENCE_RETENTION_DAYS = ${py(data.options.seenOccurrenceRetentionDays)}`
  ].join('\n');
}

async function generateScript(project) {
  const validation = validateProject(project);
  if (!validation.ok) {
    const error = new Error('O projeto possui erros e nao pode gerar o script.');
    error.statusCode = 400;
    error.code = 'SCRIPTED_SCHEDULE_INVALID';
    error.validation = validation;
    throw error;
  }
  const templateVersion = String(project.templateVersion || TEMPLATE_VERSION);
  if (!SUPPORTED_TEMPLATE_VERSIONS.includes(templateVersion)) {
    const error = new Error(`Template ${templateVersion} nao esta disponivel nesta versao.`);
    error.statusCode = 400;
    throw error;
  }
  const template = await fs.readFile(TEMPLATE_PATHS[templateVersion], 'utf8');
  const marker = '__GENERATED_CONFIG__';
  if (!template.includes(marker)) throw new Error('Template interno sem marcador de configuracao.');
  return template.replace(marker, generatedConfig(project, templateVersion));
}

module.exports = { generateScript, generatedConfig, projectToEngine, py };
