const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { defaultProject, hydrateProject } = require('../src/scriptedSchedules/schema');
const { validateProject } = require('../src/scriptedSchedules/validator');
const { generateScript, projectToEngine } = require('../src/scriptedSchedules/generator');
const { safePublishedPath, publishScript } = require('../src/scriptedSchedules/publisher');
const store = require('../src/scriptedSchedules/store');
const service = require('../src/scriptedSchedules/service');
const { duplicateModuleEntry } = require('../public/js/scriptedScheduleEditorUtils');

function musicProject() {
  const project = defaultProject('11111111-1111-4111-8111-111111111111', { name: 'JohnFlix Music', fileName: 'johnflix-music.py' });
  project.graphicsGroups = [
    { key: 'COMMON_GRAPHICS', label: 'Comum', graphics: ['image/icon.yml', 'imagem/watermark.yml'], includes: [] },
    { key: 'MUSIC_GRAPHICS', label: 'Music', graphics: ['text/youtube_credits_music_proxima.yml', 'text/youtube_credits_music_atual.yml'], includes: ['COMMON_GRAPHICS'] }
  ];
  project.sources = [
    { key: 'TOP', label: 'Twenty One Pilots', type: 'smart_collection', name: '420 - TWENTY ONE PILOTS', presentation: 'music' },
    { key: 'BASTILLE', label: 'Bastille', type: 'smart_collection', name: '420 - BASTILLE', presentation: 'music' },
    { key: 'CONCERTS', label: 'Concerts', type: 'smart_collection', name: '420 - CONCERTS', presentation: 'common' },
    { key: 'FILLER', label: 'Filler', type: 'smart_collection', name: '000 - FALLBACK FILLER', presentation: 'common' }
  ];
  project.presentationProfiles = [
    { key: 'common', label: 'Comum', graphicsGroups: ['COMMON_GRAPHICS'], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true },
    { key: 'music', label: 'Música', graphicsGroups: ['MUSIC_GRAPHICS'], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true }
  ];
  project.modules.rotation = [
    { source: 'TOP', order: 'shuffle', presentation: 'music', durationMinutes: 60 },
    { source: 'BASTILLE', order: 'shuffle', presentation: 'music', durationMinutes: 30 }
  ];
  project.modules.fixedEvents = [
    { id: 'concert_10', time: '10:00', source: 'CONCERTS', order: 'shuffle', count: 1, priority: 100, presentation: 'common', days: [] },
    { id: 'concert_18', time: '18:00', source: 'CONCERTS', order: 'shuffle', count: 1, priority: 100, presentation: 'common', days: [] }
  ];
  project.filler = { source: 'FILLER', order: 'shuffle', presentation: 'common' };
  return project;
}

async function validateWithPython(script) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-test-'));
  const file = path.join(dir, 'schedule.py');
  await fsp.writeFile(file, script, 'utf8');
  try {
    return execFileSync('python3', [file, '--validate-config'], { encoding: 'utf8' });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('Scripted Schedule golden music project generates a valid Universal v1.3.1 script', async () => {
  const project = musicProject();
  assert.deepEqual(validateProject(project).errors, []);
  const script = await generateScript(project);
  assert.match(script, /SCRIPT_VERSION = "1\.3\.1"/);
  assert.match(script, /DEFAULT_ROTATION_DURATION_MINUTES = 60/);
  assert.match(script, /"duration_minutes": 30/);
  assert.match(script, /"420 - CONCERTS"/);
  assert.match(script, /text\/youtube_credits_music_atual\.yml/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
  assert.match(output, /ROTATION=2/);
  assert.match(output, /FIXED_EVENTS=2/);
});


test('duplicated module items remain valid normal entries for validator and generator', () => {
  const project = musicProject();
  project.modules.fixedEvents[0].label = 'Sessão de concertos';
  const result = duplicateModuleEntry(project.modules, 'fixedEvents', 0);

  assert.equal(result.index, 1);
  assert.equal(project.modules.fixedEvents[1].id, 'concert_10_copy');
  assert.equal(project.modules.fixedEvents[1].label, 'Sessão de concertos (cópia)');
  assert.equal(project.modules.fixedEvents[1].time, '10:00');
  assert.deepEqual(validateProject(project).errors, []);

  const engine = projectToEngine(project);
  assert.equal(engine.modules.fixedEvents.length, 3);
  assert.equal(engine.modules.fixedEvents[1].id, 'concert_10_copy');
  assert.equal(engine.modules.fixedEvents[1].time, '10:00');
});


test('custom title can rename individual EPG entries without grouping', () => {
  const project = musicProject();
  project.modules.rotation[0].customTitle = 'MINHAS FAVORITAS';
  project.modules.rotation[0].customTitleGroup = false;

  const engine = projectToEngine(project);
  const item = engine.modules.rotation[0];
  assert.equal(item.custom_title, 'MINHAS FAVORITAS');
  assert.equal(item.epg_group, undefined);
  assert.equal(item.epg_title, undefined);
  assert.equal(item.epg_advance, undefined);
});

test('custom title grouping uses native EPG group and does not rename each item', async () => {
  const project = musicProject();
  project.modules.rotation[0].customTitle = 'MINHAS FAVORITAS';
  project.modules.rotation[0].customTitleGroup = true;

  const validation = validateProject(project);
  assert.deepEqual(validation.errors, []);

  const engine = projectToEngine(project);
  const item = engine.modules.rotation[0];
  assert.equal(item.custom_title, undefined);
  assert.equal(item.epg_group, true);
  assert.equal(item.epg_title, 'MINHAS FAVORITAS');
  assert.equal(item.epg_advance, true);

  const script = await generateScript(project);
  assert.match(script, /"epg_group": True/);
  assert.match(script, /"epg_title": "MINHAS FAVORITAS"/);
  assert.match(script, /"epg_advance": True/);
  assert.doesNotMatch(script, /"custom_title": "MINHAS FAVORITAS"/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
});

test('custom title grouping requires a title', () => {
  const project = musicProject();
  project.modules.rotation[0].customTitle = '   ';
  project.modules.rotation[0].customTitleGroup = true;
  const validation = validateProject(project);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.path === 'modules.rotation[0].customTitle'));
});


test('custom title grouping reaches PresentationController while playback omits per-item customTitle', async () => {
  const project = musicProject();
  project.modules.rotation = [{ source: 'TOP', order: 'shuffle', presentation: 'music', durationMinutes: 60, customTitle: 'MINHAS FAVORITAS', customTitleGroup: true }];
  const script = await generateScript(project);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-custom-title-group-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("schedule", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Api:
    def __init__(self): self.calls = []
    def graphics_off(self, graphics): self.calls.append(["graphics_off", graphics])
    def watermark_off(self, watermarks): self.calls.append(["watermark_off", watermarks])
    def pre_roll_off(self): self.calls.append(["pre_roll_off"])
    def graphics_on(self, graphics, variables=None): self.calls.append(["graphics_on", graphics, variables])
    def watermark_on(self, watermarks): self.calls.append(["watermark_on", watermarks])
    def pre_roll_on(self, playlist): self.calls.append(["pre_roll_on", playlist])
    def start_epg_group(self, advance=True, custom_title=None): self.calls.append(["start_epg_group", advance, custom_title])
    def stop_epg_group(self): self.calls.append(["stop_epg_group"])
api = Api()
controller = m.PresentationController(api)
item = m.ROTATION[0]
presentation = m.resolve_presentation(item, item["source"])
controller.set(presentation, "rotation:test")
print(json.dumps({"calls": api.calls, "options": m.playback_options(item), "presentation": presentation}))
`, 'utf8');
  try {
    const result = JSON.parse(execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }).trim().split('\n').pop());
    assert.ok(result.calls.some((call) => call[0] === 'start_epg_group' && call[1] === true && call[2] === 'MINHAS FAVORITAS'));
    assert.equal(result.options.custom_title, null);
    assert.equal(result.presentation.epg_group, true);
    assert.equal(result.presentation.epg_title, 'MINHAS FAVORITAS');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('Presentation EPG grouping remains available independently from custom title grouping', () => {
  const project = musicProject();
  const profile = project.presentationProfiles.find((item) => item.key === 'music');
  profile.epgGroup = true;
  profile.epgTitle = 'BLOCO DA PRESENTATION';
  profile.epgAdvance = false;

  const engine = projectToEngine(project);
  assert.equal(engine.profiles.music.epg_group, true);
  assert.equal(engine.profiles.music.epg_title, 'BLOCO DA PRESENTATION');
  assert.equal(engine.profiles.music.epg_advance, false);
  assert.equal(engine.modules.rotation[0].epg_group, undefined);
});

test('playback order is defined per programming use and the compiler derives independent ErsatzTV Sources', async () => {
  const project = musicProject();
  project.sources[0].order = 'chronological';
  project.modules.rotation = [
    { source: 'TOP', order: 'chronological', presentation: 'music', durationMinutes: 60 },
    { source: 'TOP', order: 'shuffle', presentation: 'music', durationMinutes: 60 }
  ];

  const hydrated = hydrateProject(project);
  assert.equal(Object.prototype.hasOwnProperty.call(hydrated.sources[0], 'order'), false);

  const engine = projectToEngine(hydrated);
  assert.equal(engine.sources.TOP, undefined);
  assert.equal(engine.sources.TOP__CHRONOLOGICAL.order, 'chronological');
  assert.equal(engine.sources.TOP__SHUFFLE.order, 'shuffle');
  assert.equal(engine.sources.TOP__CHRONOLOGICAL.name, '420 - TWENTY ONE PILOTS');
  assert.equal(engine.sources.TOP__SHUFFLE.name, '420 - TWENTY ONE PILOTS');
  assert.equal(engine.modules.rotation[0].source, 'TOP__CHRONOLOGICAL');
  assert.equal(engine.modules.rotation[1].source, 'TOP__SHUFFLE');

  const script = await generateScript(hydrated);
  assert.match(script, /TOP__CHRONOLOGICAL/);
  assert.match(script, /TOP__SHUFFLE/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
});

test('Scripted Playlist, Filler and Fallback compile their own playback order variants', () => {
  const project = musicProject();
  project.scriptedPlaylists = [{ key: 'PRE', label: 'Pre', items: [{ source: 'TOP', order: 'chronological', count: 1 }] }];
  project.modules.fixedEvents[0].fallback = 'TOP';
  project.modules.fixedEvents[0].fallbackOrder = 'chronological';
  project.filler = { source: 'FILLER', order: 'chronological', presentation: 'common', fallback: 'BASTILLE', fallbackOrder: 'chronological' };

  const engine = projectToEngine(hydrateProject(project));
  assert.equal(engine.scriptedPlaylists.PRE[0].source, 'TOP__CHRONOLOGICAL');
  assert.equal(engine.modules.fixedEvents[0].fallback, 'TOP__CHRONOLOGICAL');
  assert.equal(engine.filler.source, 'FILLER__CHRONOLOGICAL');
  assert.equal(engine.filler.fallback, 'BASTILLE__CHRONOLOGICAL');
  assert.equal(engine.sources.TOP__CHRONOLOGICAL.order, 'chronological');
  assert.equal(engine.sources.FILLER__CHRONOLOGICAL.order, 'chronological');
  assert.equal(engine.sources.BASTILLE__CHRONOLOGICAL.order, 'chronological');
});

test('programming order validation accepts only Chronological and Shuffle for orderable Sources', () => {
  const project = musicProject();
  project.modules.rotation[0].order = 'random';
  const validation = validateProject(project);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.path === 'modules.rotation[0].order'));
});


test('saved Scripted Schedule data normalizes Graphics Element paths before use', () => {
  const project = musicProject();
  project.graphicsGroups[0].graphics = [' /image/icon.yml ', '\\image\\watermark.yml'];
  project.presentationProfiles[0].graphics = ['/text/direct.yml', 'motion/overlay.yml'];

  const hydrated = hydrateProject(project);

  assert.deepEqual(hydrated.graphicsGroups[0].graphics, ['image/icon.yml', 'image/watermark.yml']);
  assert.deepEqual(hydrated.presentationProfiles[0].graphics, ['text/direct.yml', 'motion/overlay.yml']);
});

test('Graphics Element paths are normalized to ErsatzTV relative identifiers', async () => {
  const project = musicProject();
  project.graphicsGroups[0].graphics = ['/image/icon.yml', '\\image\\watermark.yml'];
  project.presentationProfiles[0].graphics = ['/text/direct.yml', 'motion/overlay.yml'];
  const script = await generateScript(project);

  assert.match(script, /"image\/icon\.yml"/);
  assert.match(script, /"image\/watermark\.yml"/);
  assert.match(script, /"text\/direct\.yml"/);
  assert.match(script, /"motion\/overlay\.yml"/);
  assert.doesNotMatch(script, /"\/image\//);
  assert.doesNotMatch(script, /"\/text\//);
  assert.doesNotMatch(script, /\\\\image/);
});

test('Universal v1.3.1 serializes closest-start timing and Trim forces no overrun', async () => {
  const project = musicProject();
  project.modules.fixedEvents[0].startPolicy = 'closest';
  project.modules.fixedEvents[0].maxEarlyMinutes = 40;
  project.modules.fixedEvents[0].trim = true;
  project.modules.fixedEvents[0].allowOverrun = true;

  const engine = projectToEngine(project);
  assert.equal(engine.modules.fixedEvents[0].start_policy, 'closest');
  assert.equal(engine.modules.fixedEvents[0].max_early_minutes, 40);
  assert.equal(engine.modules.fixedEvents[0].trim, true);
  assert.equal(engine.modules.fixedEvents[0].allow_overrun, false);

  const script = await generateScript(project);
  assert.match(script, /SCRIPT_VERSION = "1\.3\.1"/);
  assert.match(script, /"start_policy": "closest"/);
  assert.match(script, /"max_early_minutes": 40/);
  assert.match(script, /STATE_VERSION = 12/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
});

test('Universal v1.3.1 starts a fixed event early when that is closer than finishing the next movie late', async () => {
  const project = musicProject();
  project.modules.rotation = [];
  project.modules.countRotation = [{ source: 'TOP', order: 'shuffle', presentation: 'music', count: 1 }];
  project.modules.fixedEvents = [{
    id: 'movie_22', label: 'Filme das 22h', time: '22:00', source: 'CONCERTS', order: 'shuffle',
    count: 1, priority: 100, presentation: 'common', days: [], startPolicy: 'closest', maxEarlyMinutes: 40
  }];
  project.presentationProfiles.find((item) => item.key === 'music').preRoll = 'PRE';
  project.scriptedPlaylists = [{ key: 'PRE', label: 'Pre-roll', items: [{ source: 'FILLER', order: 'shuffle', count: 1 }] }];
  project.filler = null;

  const script = await generateScript(project);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-closest-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("schedule", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Presentation:
    def set(self, presentation, token):
        pass
class Api:
    def __init__(self): self.calls = []
    def peek_next(self, content):
        self.calls.append(["peek_next", content])
        if content.startswith("TOP"):
            return {"content": content, "milliseconds": 6222000}
        if content.startswith("FILLER"):
            return {"content": content, "milliseconds": 250000}
        return {"content": content, "milliseconds": 600000}
    def add_count(self, content, count, options=None):
        self.calls.append(["add_count", content, count])
        return {"currentTime": "2026-09-30T23:09:10+00:00", "finishTime": "2026-10-01T02:00:00+00:00", "isDone": False}
api = Api()
state = m.default_state()
ctx = {"currentTime": "2026-09-30T21:21:18+00:00", "finishTime": "2026-10-01T02:00:00+00:00", "isDone": False}
result = m.run_count_rotation(api, Presentation(), ctx, state)
winner = m.choose_task(state)
print(json.dumps({
  "unchanged": result["currentTime"] == ctx["currentTime"],
  "add_count": [c for c in api.calls if c[0] == "add_count"],
  "task_count": len(state["tasks"]),
  "winner": winner["label"] if winner else None,
  "target": winner["target"] if winner else None,
  "peek_calls": [c for c in api.calls if c[0] == "peek_next"]
}))
`, 'utf8');
  try {
    const result = JSON.parse(execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }).trim().split('\n').pop());
    assert.equal(result.unchanged, true);
    assert.deepEqual(result.add_count, []);
    assert.equal(result.task_count, 1);
    assert.equal(result.winner, 'Filme das 22h');
    assert.equal(result.target, '2026-09-30T22:00:00+00:00');
    assert.equal(result.peek_calls.length, 2); // filme + pre-roll
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('Universal v1.3.1 lets the current item finish late when lateness is closer than starting the event early', async () => {
  const project = musicProject();
  project.modules.rotation = [];
  project.modules.countRotation = [{ source: 'TOP', order: 'shuffle', presentation: 'music', count: 1 }];
  project.modules.fixedEvents = [{
    id: 'event_22', label: 'Evento 22h', time: '22:00', source: 'CONCERTS', order: 'shuffle',
    count: 1, priority: 100, presentation: 'common', days: [], startPolicy: 'closest', maxEarlyMinutes: 40
  }];
  project.presentationProfiles.find((item) => item.key === 'music').preRoll = null;
  project.filler = null;

  const script = await generateScript(project);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-closest-late-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("schedule", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Presentation:
    def set(self, presentation, token): pass
class Api:
    def __init__(self): self.calls = []
    def peek_next(self, content):
        self.calls.append(["peek_next", content])
        return {"content": content, "milliseconds": 900000}
    def add_count(self, content, count, options=None):
        self.calls.append(["add_count", content, count])
        return {"currentTime": "2026-09-30T22:05:00+00:00", "finishTime": "2026-10-01T02:00:00+00:00", "isDone": False}
api = Api()
state = m.default_state()
ctx = {"currentTime": "2026-09-30T21:50:00+00:00", "finishTime": "2026-10-01T02:00:00+00:00", "isDone": False}
result = m.run_count_rotation(api, Presentation(), ctx, state)
print(json.dumps({"time": result["currentTime"], "calls": api.calls, "tasks": len(state["tasks"])}))
`, 'utf8');
  try {
    const result = JSON.parse(execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }).trim().split('\n').pop());
    assert.equal(result.time, '2026-09-30T22:05:00+00:00');
    assert.ok(result.calls.some((call) => call[0] === 'add_count'));
    assert.equal(result.tasks, 1); // ocorrência das 22h entrou na fila depois do item
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('Universal v1.3.1 respects the maximum early-start limit even when starting early would be closer', async () => {
  const project = musicProject();
  project.modules.rotation = [];
  project.modules.countRotation = [{ source: 'TOP', order: 'shuffle', presentation: 'music', count: 1 }];
  project.modules.fixedEvents = [{
    id: 'event_22', label: 'Evento 22h', time: '22:00', source: 'CONCERTS', order: 'shuffle',
    count: 1, priority: 100, presentation: 'common', days: [], startPolicy: 'closest', maxEarlyMinutes: 40
  }];
  project.presentationProfiles.find((item) => item.key === 'music').preRoll = null;
  project.filler = null;
  const script = await generateScript(project);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-closest-cap-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("schedule", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Presentation:
    def set(self, presentation, token): pass
class Api:
    def __init__(self): self.calls = []
    def peek_next(self, content): return {"content": content, "milliseconds": 10800000}
    def add_count(self, content, count, options=None):
        self.calls.append(["add_count", content, count])
        return {"currentTime": "2026-10-01T00:00:00+00:00", "finishTime": "2026-10-01T02:00:00+00:00", "isDone": False}
api = Api()
state = m.default_state()
ctx = {"currentTime": "2026-09-30T21:00:00+00:00", "finishTime": "2026-10-01T02:00:00+00:00", "isDone": False}
result = m.run_count_rotation(api, Presentation(), ctx, state)
print(json.dumps({"time": result["currentTime"], "calls": api.calls, "tasks": len(state["tasks"])}))
`, 'utf8');
  try {
    const result = JSON.parse(execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }).trim().split('\n').pop());
    assert.equal(result.time, '2026-10-01T00:00:00+00:00');
    assert.ok(result.calls.some((call) => call[0] === 'add_count'));
    assert.equal(result.tasks, 1);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('existing Universal v1.1.1 projects remain publishable without silent motor upgrade', async () => {
  const project = musicProject();
  project.templateVersion = '1.1.1';
  const validation = validateProject(project);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const script = await generateScript(project);
  assert.match(script, /SCRIPT_VERSION = "1\.1\.1"/);
  assert.doesNotMatch(script, /ALINHAMENTO POS-BLOCO/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
});

test('Pad To Nearest Minute requires Filler, accepts only 5 10 15 30 and requires Universal v1.2.0', async () => {
  const project = musicProject();
  project.modules.fixedEvents[0].padToNearestMinutes = 15;
  let result = validateProject(project);
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  project.filler = null;
  result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.path.endsWith('.padToNearestMinutes') && /Filler/.test(item.message)));

  project.filler = { source: 'FILLER', presentation: 'common' };
  project.modules.fixedEvents[0].padToNearestMinutes = 12;
  result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => /5, 10, 15 ou 30/.test(item.message)));

  project.modules.fixedEvents[0].padToNearestMinutes = 30;
  project.templateVersion = '1.1.1';
  result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => /motor 1\.2\.0/.test(item.message)));
});

test('Universal v1.3.0 serializes item Pad only for module modes that can align individual items', async () => {
  const project = musicProject();
  project.templateVersion = '1.3.0';
  project.modules.rotation[0].padToNearestMinutes = 5; // configuração antiga: deve ser ignorada no motor atual
  project.modules.countRotation = [{ source: 'TOP', presentation: 'music', count: 2, padToNearestMinutes: 5 }];
  project.modules.weightedRotation = [{ source: 'BASTILLE', presentation: 'music', weight: 1, avoidRepeat: true, padToNearestMinutes: 10 }];
  project.modules.contentBreaks = [{ id: 'break_pad', source: 'TOP', everyItems: 2, breakSource: 'CONCERTS', breakCount: 1, breakPresentation: 'common', priority: 40, presentation: 'music', padToNearestMinutes: 15 }];
  project.modules.fixedEvents[0].padToNearestMinutes = 10;
  project.modules.fixedDurationEvents = [{ id: 'duration_pad', time: '20:00', source: 'TOP', durationMinutes: 60, priority: 120, presentation: 'music', padToNearestMinutes: 15 }];
  project.modules.fixedAllEvents = [{ id: 'all_pad', time: '14:00', source: 'CONCERTS', priority: 80, presentation: 'common', padToNearestMinutes: 30 }];
  project.modules.fixedWindowEvents = [{ id: 'window_pad', startTime: '06:00', endTime: '09:00', source: 'BASTILLE', priority: 30, presentation: 'music', padToNearestMinutes: 5 }];
  project.modules.windowRotations = [{ id: 'window_rotation_pad', startTime: '12:00', endTime: '16:00', blockMinutes: 30, priority: 40, items: [{ source: 'TOP', presentation: 'music', durationMinutes: 30, padToNearestMinutes: 10 }] }];
  project.modules.sequenceEvents = [
    { id: 'sequence_count_pad', time: '19:55', priority: 150, atomic: false, presentation: 'common', padToNearestMinutes: 15, steps: [{ mode: 'count', source: 'CONCERTS', count: 2, presentation: 'common' }] },
    { id: 'sequence_mixed_no_pad', time: '21:00', priority: 151, atomic: false, presentation: 'common', padToNearestMinutes: 30, steps: [{ mode: 'count', source: 'CONCERTS', count: 1, presentation: 'common' }, { mode: 'duration', source: 'TOP', durationMinutes: 10, presentation: 'music' }] }
  ];
  project.modules.intervalEvents = [
    { id: 'interval_count_pad', startTime: '00:00', endTime: '00:00', everyMinutes: 30, source: 'CONCERTS', mode: 'count', count: 2, priority: 180, presentation: 'common', latePolicy: 'skip', maxLatenessMinutes: 10, padToNearestMinutes: 30 },
    { id: 'interval_duration_no_pad', startTime: '01:00', endTime: '02:00', everyMinutes: 30, source: 'TOP', mode: 'duration', durationMinutes: 10, priority: 181, presentation: 'music', latePolicy: 'queue', padToNearestMinutes: 5 }
  ];
  project.modules.choiceEvents = [
    { id: 'choice_count_pad', time: '22:00', mode: 'count', count: 2, selection: 'weighted', choices: [{ source: 'TOP', presentation: 'music', weight: 1 }], priority: 190, presentation: 'music', padToNearestMinutes: 5 },
    { id: 'choice_all_no_pad', time: '23:00', mode: 'all', selection: 'weighted', choices: [{ source: 'CONCERTS', presentation: 'common', weight: 1 }], priority: 191, presentation: 'common', padToNearestMinutes: 10 }
  ];
  project.modules.clockTemplates = [{ id: 'clock_pad', startTime: '00:00', endTime: '00:00', cycleMinutes: 60, priority: 50, slots: [
    { offsetMinutes: 0, mode: 'count', source: 'TOP', count: 2, presentation: 'music', padToNearestMinutes: 10 },
    { offsetMinutes: 30, mode: 'duration', source: 'BASTILLE', durationMinutes: 20, presentation: 'music', padToNearestMinutes: 15 }
  ] }];
  project.modules.temporaryOverrides = [{ id: 'override_no_pad', startDatetime: '2026-12-24 18:00', endDatetime: '2026-12-24 23:00', source: 'CONCERTS', priority: 500, presentation: 'common', padToNearestMinutes: 15 }];
  project.modules.dateEvents = [
    { id: 'date_count_pad', datetime: '2026-12-24 20:00', source: 'CONCERTS', mode: 'count', count: 2, priority: 500, presentation: 'common', padToNearestMinutes: 30 },
    { id: 'date_all_no_pad', datetime: '2026-12-25 20:00', source: 'CONCERTS', mode: 'all', priority: 500, presentation: 'common', padToNearestMinutes: 5 }
  ];
  project.modules.offlineWindows = [{ id: 'offline_1', startTime: '03:00', endTime: '05:00', priority: 1000, days: ['dom'], padToNearestMinutes: 30 }];

  const result = validateProject(project);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const script = await generateScript(project);
  const configBlock = (name) => {
    const marker = `${name}: list[dict[str, Any]] =`;
    const start = script.indexOf(marker);
    if (start < 0) return '';
    const tail = script.slice(start);
    const next = tail.slice(name.length + 1).search(/\n[A-Z][A-Z_]+(?:\[[^\n]+\])?\s*[:=]/);
    return next < 0 ? tail : tail.slice(0, marker.length + next);
  };

  for (const name of ['COUNT_ROTATION', 'WEIGHTED_ROTATION', 'CONTENT_BREAKS', 'FIXED_EVENTS', 'SEQUENCE_EVENTS', 'INTERVAL_EVENTS', 'CHOICE_EVENTS', 'CLOCK_TEMPLATES', 'DATE_EVENTS']) {
    assert.match(configBlock(name), /pad_to_nearest_minutes/, `${name} should keep at least one item-compatible Pad`);
  }
  for (const name of ['ROTATION', 'FIXED_DURATION_EVENTS', 'FIXED_ALL_EVENTS', 'FIXED_WINDOW_EVENTS', 'WINDOW_ROTATIONS', 'TEMPORARY_OVERRIDES', 'OFFLINE_WINDOWS']) {
    assert.doesNotMatch(configBlock(name), /pad_to_nearest_minutes/, `${name} must not serialize item Pad in v1.3.0`);
  }
  assert.match(script, /def apply_item_pad\(/);
  assert.match(script, /ALINHAMENTO ENTRE ITENS/);
  assert.doesNotMatch(script, /def apply_post_pad\(/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
})

test('Universal v1.3.0 item Pad uses ErsatzTV pad_to_next, yields to a scheduled event and does nothing on an exact mark', async () => {
  const project = musicProject();
  project.templateVersion = '1.3.0';
  project.modules.fixedEvents = [
    { id: 'next_event', time: '10:10', source: 'CONCERTS', count: 1, priority: 100, presentation: 'common', days: [] }
  ];
  const script = await generateScript(project);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-pad-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("schedule", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Presentation:
    def set(self, presentation, token):
        pass
class Api:
    def __init__(self):
        self.calls = []
    def pad_to_next(self, content, minutes, options=None):
        self.calls.append(["pad_to_next", content, minutes])
        return {"currentTime": "2026-09-28T10:30:00+00:00", "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
    def pad_until_exact(self, content, when, options=None):
        self.calls.append(["pad_until_exact", content, when.isoformat()])
        return {"currentTime": when.isoformat(), "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
api = Api()
ctx = {"currentTime": "2026-09-28T10:07:00+00:00", "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
m.apply_item_pad(api, Presentation(), ctx, {"tasks": []}, 15, "probe")
cutoff = list(api.calls)
api.calls.clear()
ctx = {"currentTime": "2026-09-28T10:16:00+00:00", "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
m.apply_item_pad(api, Presentation(), ctx, {"tasks": []}, 15, "probe")
native = list(api.calls)
api.calls.clear()
ctx = {"currentTime": "2026-09-28T10:30:00+00:00", "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
m.apply_item_pad(api, Presentation(), ctx, {"tasks": []}, 15, "probe")
print(json.dumps({"cutoff": cutoff, "native": native, "exact": api.calls}))
`, 'utf8');
  try {
    const output = execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }).trim().split('\n').pop();
    const result = JSON.parse(output);
    assert.deepEqual(result.cutoff, [['pad_until_exact', 'FILLER__SHUFFLE', '2026-09-28T10:10:00+00:00']]);
    assert.deepEqual(result.native, [['pad_to_next', 'FILLER__SHUFFLE', 15]]);
    assert.deepEqual(result.exact, []);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
})

test('Horário fixo quantidade applies Pad To Nearest after every item, including the last one', async () => {
  const project = musicProject();
  project.modules.fixedEvents = [];
  const script = await generateScript(project);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-count-pad-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("schedule", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Presentation:
    def set(self, presentation, token):
        pass
class Api:
    def __init__(self):
        self.calls = []
        self.item_times = [
            "2026-09-28T10:07:00+00:00",
            "2026-09-28T10:22:00+00:00",
            "2026-09-28T10:37:00+00:00",
        ]
        self.pad_times = [
            "2026-09-28T10:15:00+00:00",
            "2026-09-28T10:30:00+00:00",
            "2026-09-28T10:45:00+00:00",
        ]
    def add_count(self, content, count, options=None):
        self.calls.append(["add_count", content, count])
        current = self.item_times.pop(0)
        return {"currentTime": current, "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
    def pad_to_next(self, content, minutes, options=None):
        self.calls.append(["pad_to_next", content, minutes])
        current = self.pad_times.pop(0)
        return {"currentTime": current, "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
    def pad_until_exact(self, content, when, options=None):
        self.calls.append(["pad_until_exact", content, when.isoformat()])
        return {"currentTime": when.isoformat(), "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
api = Api()
task = {
    "task_id": "three-movies-probe", "module": "FIXED_EVENTS", "label": "3 filmes",
    "priority": 100, "source": "CONCERTS", "presentation": "common", "playback": {},
    "remaining_count": 3, "pad_to_nearest_minutes": 15
}
state = {"tasks": [task], "active_task_id": "three-movies-probe", "seen_occurrences": {}}
ctx = {"currentTime": "2026-09-28T10:00:00+00:00", "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
ctx = m.run_count_task(api, Presentation(), ctx, state, task)
ctx = m.run_count_task(api, Presentation(), ctx, state, task)
ctx = m.run_count_task(api, Presentation(), ctx, state, task)
print(json.dumps(api.calls))
`, 'utf8');
  try {
    const output = execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }).trim().split('\n').pop();
    assert.deepEqual(JSON.parse(output), [
      ['add_count', 'CONCERTS', 1],
      ['pad_to_next', 'FILLER__SHUFFLE', 15],
      ['add_count', 'CONCERTS', 1],
      ['pad_to_next', 'FILLER__SHUFFLE', 15],
      ['add_count', 'CONCERTS', 1],
      ['pad_to_next', 'FILLER__SHUFFLE', 15]
    ]);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
})

test('Horário fixo todos os itens does not expose or execute item Pad because ErsatzTV add_all is atomic', async () => {
  const project = musicProject();
  project.modules.fixedEvents = [];
  project.modules.fixedAllEvents = [{ id: 'all_pad', time: '14:00', source: 'CONCERTS', priority: 80, presentation: 'common', padToNearestMinutes: 15 }];
  const validation = validateProject(project);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const script = await generateScript(project);
  const configLine = script.split('\n').find((line) => line.startsWith('FIXED_ALL_EVENTS:')) || '';
  assert.doesNotMatch(configLine, /pad_to_nearest_minutes/);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-all-pad-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("schedule", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Presentation:
    def set(self, presentation, token):
        pass
class Api:
    def __init__(self): self.calls = []
    def add_all(self, content, options=None):
        self.calls.append(["add_all", content])
        return {"currentTime": "2026-09-28T10:40:00+00:00", "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
api = Api()
task = {
    "task_id": "all-pad-probe", "module": "FIXED_ALL_EVENTS", "label": "Especial",
    "priority": 80, "source": "CONCERTS", "presentation": "common", "playback": {},
    "pad_to_nearest_minutes": 15
}
state = {"tasks": [task], "active_task_id": "all-pad-probe", "seen_occurrences": {}}
ctx = {"currentTime": "2026-09-28T10:00:00+00:00", "finishTime": "2026-09-28T11:00:00+00:00", "isDone": False}
m.run_all_task(api, Presentation(), ctx, state, task)
print(json.dumps(api.calls))
`, 'utf8');
  try {
    const output = execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }).trim().split('\n').pop();
    assert.deepEqual(JSON.parse(output), [['add_all', 'CONCERTS']]);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
})

test('Universal v1.2.0 keeps its historical post-block Pad behavior without silent conversion', async () => {
  const project = musicProject();
  project.templateVersion = '1.2.0';
  project.modules.rotation[0].padToNearestMinutes = 5;
  project.modules.fixedAllEvents = [{ id: 'legacy_all_pad', time: '14:00', source: 'CONCERTS', priority: 80, presentation: 'common', padToNearestMinutes: 15 }];
  const validation = validateProject(project);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const script = await generateScript(project);
  const rotationBlock = script.slice(script.indexOf('ROTATION: list[dict[str, Any]] ='), script.indexOf('COUNT_ROTATION: list[dict[str, Any]] ='));
  const allBlock = script.slice(script.indexOf('FIXED_ALL_EVENTS: list[dict[str, Any]] ='), script.indexOf('FIXED_WINDOW_EVENTS: list[dict[str, Any]] ='));
  assert.match(rotationBlock, /pad_to_nearest_minutes/);
  assert.match(allBlock, /pad_to_nearest_minutes/);
  assert.match(script, /ALINHAMENTO POS-BLOCO/);
  assert.match(script, /def apply_post_pad\(/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
});

test('all ten scheduling modules can coexist and validate through the Python engine', async () => {
  const project = musicProject();
  project.modules.fixedDurationEvents = [{ id: 'duration_1', time: '20:00', source: 'TOP', durationMinutes: 60, priority: 120, presentation: 'music' }];
  project.modules.fixedAllEvents = [{ id: 'all_1', time: '14:00', source: 'CONCERTS', priority: 80, presentation: 'common' }];
  project.modules.fixedWindowEvents = [{ id: 'window_1', startTime: '06:00', endTime: '09:00', source: 'BASTILLE', priority: 30, presentation: 'music' }];
  project.modules.windowRotations = [{ id: 'window_rotation_1', startTime: '12:00', endTime: '16:00', blockMinutes: 30, priority: 40, items: [{ source: 'TOP', presentation: 'music', durationMinutes: 30 }, { source: 'BASTILLE', presentation: 'music', durationMinutes: 45 }] }];
  project.modules.sequenceEvents = [{ id: 'sequence_1', time: '19:55', priority: 150, atomic: false, presentation: 'common', steps: [{ mode: 'count', source: 'CONCERTS', count: 1, presentation: 'common' }, { mode: 'duration', source: 'TOP', durationMinutes: 20, presentation: 'music' }, { mode: 'wait', durationMinutes: 2, presentation: 'none' }] }];
  project.modules.intervalEvents = [{ id: 'interval_1', startTime: '00:00', endTime: '00:00', everyMinutes: 30, source: 'CONCERTS', mode: 'count', count: 1, priority: 180, presentation: 'common', latePolicy: 'skip', maxLatenessMinutes: 10 }];
  project.modules.dateEvents = [{ id: 'date_1', datetime: '2026-12-24 20:00', source: 'CONCERTS', mode: 'all', priority: 500, presentation: 'common' }];
  project.modules.offlineWindows = [{ id: 'offline_1', startTime: '03:00', endTime: '05:00', priority: 1000, days: ['dom'] }];
  const validation = validateProject(project);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const script = await generateScript(project);
  const output = await validateWithPython(script);
  for (const expected of ['FIXED_DURATION_EVENTS=1', 'FIXED_ALL_EVENTS=1', 'FIXED_WINDOW_EVENTS=1', 'WINDOW_ROTATIONS=1', 'SEQUENCE_EVENTS=1', 'INTERVAL_EVENTS=1', 'DATE_EVENTS=1', 'OFFLINE_WINDOWS=1']) assert.match(output, new RegExp(expected));
});

test('validator rejects missing references, duplicated event IDs and Graphics cycles', () => {
  const project = musicProject();
  project.graphicsGroups[0].includes = ['MUSIC_GRAPHICS'];
  project.modules.fixedDurationEvents = [{ id: 'concert_10', time: '21:00', source: 'MISSING', durationMinutes: 60, priority: 10, presentation: 'missing-profile' }];
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => /circular/i.test(item.message)));
  assert.ok(result.errors.some((item) => /Source MISSING/.test(item.message)));
  assert.ok(result.errors.some((item) => /Presentation missing-profile/.test(item.message)));
  assert.ok(result.errors.some((item) => /ja esta sendo usado/.test(item.message)));
});

test('all modules are optional and an intentional gap is warning, not an error', () => {
  const project = defaultProject('22222222-2222-4222-8222-222222222222', { name: 'Eventos', fileName: 'eventos.py' });
  const result = validateProject(project);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((item) => /sem programacao/i.test(item.message)));
});


test('Universal v1.3.0 validates every new programming module together', async () => {
  const project = musicProject();
  project.templateVersion = '1.3.0';
  project.modules.countRotation = [{ source: 'TOP', count: 3, presentation: 'music', padToNearestMinutes: 5 }];
  project.modules.weightedRotation = [
    { source: 'TOP', weight: 3, avoidRepeat: true, presentation: 'music' },
    { source: 'BASTILLE', weight: 1, avoidRepeat: true, presentation: 'music' }
  ];
  project.modules.continuousBlocks = [{ id: 'base_day', startTime: '06:00', source: 'TOP', priority: 10, presentation: 'music', enabled: true, days: [] }];
  project.modules.contentBreaks = [{ id: 'ids', source: 'TOP', everyItems: 4, breakSource: 'CONCERTS', breakCount: 1, priority: 10, presentation: 'music', breakPresentation: 'common', enabled: true, days: [], padToNearestMinutes: 10 }];
  project.modules.fitToWindow = [{ id: 'fit', startTime: '00:00', endTime: '00:00', source: 'TOP', lookAheadMinutes: 45, discardAttempts: 4, useFillerRemainder: true, priority: 20, presentation: 'music', enabled: true, days: [] }];
  project.modules.choiceEvents = [{ id: 'movie_choice', time: '21:00', mode: 'count', count: 1, selection: 'weighted', choices: [{ source: 'CONCERTS', weight: 2, presentation: 'common' }, { source: 'TOP', weight: 1, presentation: 'music' }], priority: 180, presentation: 'common', enabled: true, days: [] }];
  project.modules.clockTemplates = [{ id: 'clock', startTime: '00:00', endTime: '00:00', cycleMinutes: 60, priority: 170, presentation: 'common', enabled: true, days: [], slots: [{ offsetMinutes: 0, mode: 'count', source: 'CONCERTS', count: 1, presentation: 'common' }, { offsetMinutes: 30, mode: 'duration', source: 'TOP', durationMinutes: 10, presentation: 'music' }] }];
  project.modules.temporaryOverrides = [{ id: 'xmas', startDatetime: '2026-12-24 18:00', endDatetime: '2026-12-26 06:00', source: 'CONCERTS', priority: 500, presentation: 'common', enabled: true, days: [] }];
  project.modules.fixedEvents[0].recurrenceType = 'monthly_nth_weekday';
  project.modules.fixedEvents[0].recurrenceOrdinal = 1;
  project.modules.fixedEvents[0].recurrenceWeekday = 0;

  const validation = validateProject(project);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const script = await generateScript(project);
  for (const token of ['COUNT_ROTATION', 'WEIGHTED_ROTATION', 'CONTINUOUS_BLOCKS', 'CONTENT_BREAKS', 'FIT_TO_WINDOW', 'CHOICE_EVENTS', 'CLOCK_TEMPLATES', 'TEMPORARY_OVERRIDES']) {
    assert.match(script, new RegExp(`${token}: list`));
  }
  assert.match(script, /recurrence_type/);
  assert.match(script, /def run_continuous_block/);
  assert.match(script, /def run_fit_to_window/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
  assert.match(output, /CONTINUOUS_BLOCKS=1/);
  assert.match(output, /CLOCK_TEMPLATES=1/);
});

test('new v1.3.0 modules do not silently upgrade an older project', async () => {
  const project = musicProject();
  project.templateVersion = '1.2.0';
  let validation = validateProject(project);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  let script = await generateScript(project);
  assert.match(script, /SCRIPT_VERSION = "1\.2\.0"/);

  project.modules.continuousBlocks = [{ id: 'base', startTime: '06:00', source: 'TOP', priority: 10, presentation: 'music', enabled: true, days: [] }];
  validation = validateProject(project);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.path === 'templateVersion' && /1\.3\.0/.test(item.message)));
});

test('continuous blocks find the latest start marker and Fit To Window targets the next scheduled event', async () => {
  const project = musicProject();
  project.modules.rotation = [];
  project.modules.continuousBlocks = [
    { id: 'morning', startTime: '06:00', source: 'TOP', priority: 10, presentation: 'music', enabled: true, days: [] },
    { id: 'night', startTime: '18:00', source: 'BASTILLE', priority: 10, presentation: 'music', enabled: true, days: [] }
  ];
  project.modules.fitToWindow = [{ id: 'fit', startTime: '00:00', endTime: '00:00', source: 'TOP', lookAheadMinutes: 45, discardAttempts: 3, useFillerRemainder: true, priority: 20, presentation: 'music', enabled: true, days: [] }];
  project.modules.fixedEvents = [{ id: 'fixed', time: '20:00', source: 'CONCERTS', count: 1, priority: 100, presentation: 'common', enabled: true, days: [] }];
  const script = await generateScript(project);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-v13-runtime-'));
  const scheduleFile = path.join(dir, 'schedule.py');
  const probeFile = path.join(dir, 'probe.py');
  await fsp.writeFile(scheduleFile, script, 'utf8');
  await fsp.writeFile(probeFile, `
import importlib.util, json, sys
from datetime import datetime
spec=importlib.util.spec_from_file_location("schedule", sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
now=datetime.fromisoformat("2026-09-28T19:30:00+00:00")
active=m.active_continuous_block(now)
fit=m.active_fit_to_window(now, datetime.fromisoformat("2026-09-28T21:00:00+00:00"))
print(json.dumps({"continuous": active[1]["source"] if active else None, "fit_target": fit[2].isoformat() if fit else None}))
`, 'utf8');
  try {
    const output = JSON.parse(execFileSync('python3', [probeFile, scheduleFile], { encoding: 'utf8' }));
    assert.equal(output.continuous, 'BASTILLE__SHUFFLE');
    assert.equal(output.fit_target, '2026-09-28T20:00:00+00:00');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('generator safely quotes queries and paths instead of producing free Python code', async () => {
  const project = musicProject();
  project.sources.push({ key: 'SEARCH', label: 'Busca', type: 'search', query: 'title:"x" AND tag:"__import__(\\"os\\")"', presentation: 'none' });
  project.modules.fixedEvents.push({ id: 'search_probe', time: '22:00', source: 'SEARCH', order: 'shuffle', count: 1, priority: 10, presentation: 'none', days: [] });
  const script = await generateScript(project);
  assert.match(script, /__import__/);
  await validateWithPython(script);
});

test('publisher restricts filenames to the configured root and performs atomic replacement with backup', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'scripted-publish-'));
  try {
    assert.throws(() => safePublishedPath('', 'schedule.py'), /pasta de saida precisa ser um caminho absoluto/i);
    assert.throws(() => safePublishedPath(root, '../escape.py'), /Nome de arquivo Python invalido/);
    const project = musicProject();
    const first = await generateScript(project);
    const result1 = await publishScript({ projectId: project.id, fileName: project.fileName, outputRoot: root, script: first, historyLimit: 2 });
    assert.equal(fs.existsSync(result1.path), true);
    assert.equal(fs.statSync(result1.path).mode & 0o111, 0o111);
    project.name = 'JohnFlix Music 2';
    const second = await generateScript(project);
    const result2 = await publishScript({ projectId: project.id, fileName: project.fileName, outputRoot: root, script: second, historyLimit: 2 });
    assert.notEqual(result1.hash, result2.hash);
    assert.ok(result2.backupPath);
    assert.equal(fs.existsSync(result2.backupPath), true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(path.join(store.FILE_BACKUPS_DIR, '11111111-1111-4111-8111-111111111111'), { recursive: true, force: true });
  }
});


test('first publication derives fileName and state_key from the final draft identity and keeps them stable later', async () => {
  const created = await service.createProject({ name: 'Rascunho antigo' });
  let publishedPath = '';
  try {
    assert.equal(created.fileName, '');
    const draft = {
      ...created,
      name: '420 - JOHNFLIX NOVO',
      fileName: 'canal-antigo-copia.py',
      channelLinks: [{ channelNumber: '999', channelName: 'Canal Novo', stateKey: 'canal_antigo_copia' }]
    };
    const validation = await service.validateDraft(created.id, draft);
    assert.equal(validation.ok, true);
    const stillDraft = await service.getProject(created.id);
    assert.equal(stillDraft.fileName, '');
    assert.equal(stillDraft.channelLinks.length, 0);

    const first = await service.updateAndPublish(created.id, draft, { skipHistory: true });

    publishedPath = first.project.publishedPath;
    assert.equal(first.project.fileName, '420-johnflix-novo.py');
    assert.equal(first.project.channelLinks[0].stateKey, '420_johnflix_novo_999');
    assert.equal(path.basename(first.project.publishedPath), '420-johnflix-novo.py');
    assert.equal(fs.existsSync(first.project.publishedPath), true);

    const second = await service.updateAndPublish(created.id, {
      ...first.project,
      name: 'Nome visual alterado depois',
      channelLinks: first.project.channelLinks
    }, { skipHistory: true });
    assert.equal(second.project.fileName, '420-johnflix-novo.py');
    assert.equal(second.project.channelLinks[0].stateKey, '420_johnflix_novo_999');
  } finally {
    if (publishedPath) await fsp.rm(publishedPath, { force: true });
    await store.deleteProject(created.id);
  }
});

test('duplicating a Scripted Schedule copies programming but resets publication identity and channel binding', async () => {
  const source = await service.createProject({ name: 'Canal Original' });
  let sourcePath = '';
  let duplicateId = '';
  try {
    const published = await service.updateAndPublish(source.id, {
      ...source,
      name: 'Canal Original',
      channelLinks: [{ channelNumber: '415', channelName: '415 - Original', stateKey: '' }],
      options: { ...source.options, defaultFixedPriority: 222 }
    }, { skipHistory: true });
    sourcePath = published.project.publishedPath;

    const duplicate = await service.duplicateProject(source.id);
    duplicateId = duplicate.id;
    assert.equal(duplicate.name, 'Canal Original - Copia');
    assert.equal(duplicate.fileName, '');
    assert.equal(duplicate.publishedAt, null);
    assert.equal(duplicate.publishedHash, null);
    assert.equal(duplicate.publishedPath, null);
    assert.deepEqual(duplicate.channelLinks, []);
    assert.equal(duplicate.options.defaultFixedPriority, 222);
  } finally {
    if (sourcePath) await fsp.rm(sourcePath, { force: true });
    if (duplicateId) await store.deleteProject(duplicateId);
    await store.deleteProject(source.id);
  }
});

test('projects cannot validate a first-publication filename already owned by a published project', async () => {
  const first = await service.createProject({ name: 'Projeto A' });
  const second = await service.createProject({ name: 'Projeto B' });
  let firstPath = '';
  try {
    const published = await service.updateAndPublish(first.id, first, { skipHistory: true });
    firstPath = published.project.publishedPath;
    const draft = { ...second, name: 'Projeto A' };
    const result = await service.validateDraft(second.id, draft);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.path === 'fileName' && /Projeto A/.test(item.message)));
  } finally {
    if (firstPath) await fsp.rm(firstPath, { force: true });
    await store.deleteProject(first.id);
    await store.deleteProject(second.id);
  }
});


test('reserved none presentation stays internal while remaining available to the engine', async () => {
  const project = defaultProject('33333333-3333-4333-8333-333333333333', { name: 'Sem perfil', fileName: 'sem-perfil.py' });
  assert.deepEqual(project.presentationProfiles, []);
  project.sources = [{ key: 'SRC', label: 'Source', type: 'smart_collection', name: 'Source', order: 'shuffle', presentation: 'none' }];
  project.modules.fixedEvents = [{ id: 'event_1', time: '10:00', source: 'SRC', count: 1, priority: 100, presentation: 'none', days: [] }];
  assert.deepEqual(validateProject(project).errors, []);
  const script = await generateScript(project);
  assert.match(script, /"none": \{/);
  assert.match(script, /"graphics": \[\]/);
  assert.match(script, /"epg_group": False/);
});

test('hydrateProject removes the old canonical none card and safely preserves a customized legacy none profile', async () => {
  const canonical = defaultProject('44444444-4444-4444-8444-444444444444', { name: 'Canonico', fileName: 'canonico.py' });
  canonical.presentationProfiles = [{ key: 'none', label: 'Nenhum', graphicsGroups: [], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true }];
  assert.deepEqual(hydrateProject(canonical).presentationProfiles, []);

  const legacy = defaultProject('55555555-5555-4555-8555-555555555555', { name: 'Legado', fileName: 'legado.py' });
  legacy.presentationProfiles = [{ key: 'none', label: 'Nenhum', graphicsGroups: [], graphics: ['legacy.yml'], graphicsVariables: [{ key: 'message', value: 'Oi' }], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true }];
  legacy.sources = [{ key: 'SRC', label: 'Source', type: 'smart_collection', name: 'Source', order: 'shuffle', presentation: 'none' }];
  legacy.modules.fixedEvents = [{ id: 'event_1', time: '10:00', source: 'SRC', count: 1, priority: 100, presentation: 'none', days: [] }];
  const hydrated = hydrateProject(legacy);
  assert.equal(hydrated.presentationProfiles.some((profile) => profile.key === 'none'), false);
  const migrated = hydrated.presentationProfiles.find((profile) => profile.key.startsWith('legacy_none'));
  assert.ok(migrated);
  assert.deepEqual(migrated.graphics, ['legacy.yml']);
  assert.deepEqual(migrated.graphicsVariables, [{ key: 'message', value: 'Oi' }]);
  assert.equal(hydrated.sources[0].presentation, migrated.key);
  assert.equal(hydrated.modules.fixedEvents[0].presentation, migrated.key);
  assert.deepEqual(validateProject(hydrated).errors, []);
  const script = await generateScript(hydrated);
  assert.match(script, new RegExp(`\"${migrated.key}\": \{`));
  assert.match(script, /legacy\.yml/);
  assert.match(script, /\"none\": \{/);
});

test('a user Presentation Profile cannot take the internal none key', () => {
  const project = defaultProject('66666666-6666-4666-8666-666666666666', { name: 'Chave reservada', fileName: 'chave-reservada.py' });
  project.presentationProfiles = [{ key: 'none', label: 'Meu perfil', graphicsGroups: [], graphics: ['custom.yml'], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true }];
  const validation = validateProject(project);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.path === 'presentationProfiles[0].key' && /interna/i.test(item.message)));
});

test('global Filler defaults to postroll and preserves an explicit supported filler kind', async () => {
  const project = musicProject();
  project.filler = { source: 'FILLER', presentation: 'common' };
  const defaultScript = await generateScript(project);
  const defaultBlock = defaultScript.match(/FILLER: dict\[str, Any\] \| None = \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(defaultBlock, /"filler_kind": "postroll"/);

  project.filler.fillerKind = 'midroll';
  const midrollScript = await generateScript(project);
  const midrollBlock = midrollScript.match(/FILLER: dict\[str, Any\] \| None = \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(midrollBlock, /"filler_kind": "midroll"/);
  assert.doesNotMatch(midrollBlock, /"filler_kind": "postroll"/);

  project.filler.fillerKind = 'none';
  const noneScript = await generateScript(project);
  const noneBlock = noneScript.match(/FILLER: dict\[str, Any\] \| None = \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(noneBlock, /"filler_kind": "none"/);

  const output = await validateWithPython(midrollScript);
  assert.match(output, /configuracao valida/);
});
