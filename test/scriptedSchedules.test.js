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

test('Scripted Schedule golden music project generates a valid Universal v1.1.1 script', async () => {
  const project = musicProject();
  assert.deepEqual(validateProject(project).errors, []);
  const script = await generateScript(project);
  assert.match(script, /SCRIPT_VERSION = "1\.1\.1"/);
  assert.match(script, /DEFAULT_ROTATION_DURATION_MINUTES = 60/);
  assert.match(script, /"duration_minutes": 30/);
  assert.match(script, /"420 - CONCERTS"/);
  assert.match(script, /text\/youtube_credits_music_atual\.yml/);
  const output = await validateWithPython(script);
  assert.match(output, /configuracao valida/);
  assert.match(output, /ROTATION=True/);
  assert.match(output, /FIXED_EVENTS=2/);
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
