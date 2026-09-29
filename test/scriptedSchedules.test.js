const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { defaultProject } = require('../src/scriptedSchedules/schema');
const { validateProject } = require('../src/scriptedSchedules/validator');
const { generateScript } = require('../src/scriptedSchedules/generator');
const { safePublishedPath, publishScript } = require('../src/scriptedSchedules/publisher');
const store = require('../src/scriptedSchedules/store');
const service = require('../src/scriptedSchedules/service');

function musicProject() {
  const project = defaultProject('11111111-1111-4111-8111-111111111111', { name: 'JohnFlix Music', fileName: 'johnflix-music.py' });
  project.graphicsGroups = [
    { key: 'COMMON_GRAPHICS', label: 'Comum', graphics: ['image/icon.yml', 'imagem/watermark.yml'], includes: [] },
    { key: 'MUSIC_GRAPHICS', label: 'Music', graphics: ['text/youtube_credits_music_proxima.yml', 'text/youtube_credits_music_atual.yml'], includes: ['COMMON_GRAPHICS'] }
  ];
  project.sources = [
    { key: 'TOP', label: 'Twenty One Pilots', type: 'smart_collection', name: '420 - TWENTY ONE PILOTS', order: 'shuffle', presentation: 'music' },
    { key: 'BASTILLE', label: 'Bastille', type: 'smart_collection', name: '420 - BASTILLE', order: 'shuffle', presentation: 'music' },
    { key: 'CONCERTS', label: 'Concerts', type: 'smart_collection', name: '420 - CONCERTS', order: 'shuffle', presentation: 'common' },
    { key: 'FILLER', label: 'Filler', type: 'smart_collection', name: '000 - FALLBACK FILLER', order: 'shuffle', presentation: 'common' }
  ];
  project.presentationProfiles = [
    { key: 'none', label: 'Nenhum', graphicsGroups: [], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true },
    { key: 'common', label: 'Comum', graphicsGroups: ['COMMON_GRAPHICS'], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true },
    { key: 'music', label: 'Música', graphicsGroups: ['MUSIC_GRAPHICS'], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true }
  ];
  project.modules.rotation = [
    { source: 'TOP', presentation: 'music', durationMinutes: 60 },
    { source: 'BASTILLE', presentation: 'music', durationMinutes: 30 }
  ];
  project.modules.fixedEvents = [
    { id: 'concert_10', time: '10:00', source: 'CONCERTS', count: 1, priority: 100, presentation: 'common', days: [] },
    { id: 'concert_18', time: '18:00', source: 'CONCERTS', count: 1, priority: 100, presentation: 'common', days: [] }
  ];
  project.filler = { source: 'FILLER', presentation: 'common' };
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

test('Scripted Schedule golden music project generates a valid Universal v1.3.0 script', async () => {
  const project = musicProject();
  assert.deepEqual(validateProject(project).errors, []);
  const script = await generateScript(project);
  assert.match(script, /SCRIPT_VERSION = "1\.3\.0"/);
  assert.match(script, /DEFAULT_ROTATION_DURATION_MINUTES = 60/);
  assert.match(script, /"duration_minutes": 30/);
  assert.match(script, /"420 - CONCERTS"/);
  assert.match(script, /text\/youtube_credits_music_atual\.yml/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
  assert.match(output, /ROTATION=2/);
  assert.match(output, /FIXED_EVENTS=2/);
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
    assert.deepEqual(result.cutoff, [['pad_until_exact', 'FILLER', '2026-09-28T10:10:00+00:00']]);
    assert.deepEqual(result.native, [['pad_to_next', 'FILLER', 15]]);
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
      ['pad_to_next', 'FILLER', 15],
      ['add_count', 'CONCERTS', 1],
      ['pad_to_next', 'FILLER', 15],
      ['add_count', 'CONCERTS', 1],
      ['pad_to_next', 'FILLER', 15]
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
    assert.equal(output.continuous, 'BASTILLE');
    assert.equal(output.fit_target, '2026-09-28T20:00:00+00:00');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('generator safely quotes queries and paths instead of producing free Python code', async () => {
  const project = musicProject();
  project.sources.push({ key: 'SEARCH', label: 'Busca', type: 'search', query: 'title:"x" AND tag:"__import__(\\"os\\")"', order: 'shuffle', presentation: 'none' });
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


test('projects cannot publish or validate the same output filename', async () => {
  const first = await store.createProject({ name: 'Projeto A', fileName: 'mesmo-script.py' });
  const second = await store.createProject({ name: 'Projeto B', fileName: 'outro-script.py' });
  try {
    const draft = { ...second, fileName: 'mesmo-script.py' };
    const result = await service.validateDraft(second.id, draft);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.path === 'fileName' && /Projeto A/.test(item.message)));
  } finally {
    await store.deleteProject(first.id);
    await store.deleteProject(second.id);
  }
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
