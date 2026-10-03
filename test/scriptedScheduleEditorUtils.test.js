const test = require('node:test');
const assert = require('node:assert/strict');
const {
  duplicateModuleEntry,
  nextCopyId
} = require('../public/js/scriptedScheduleEditorUtils');

test('module item duplication inserts immediately after the original and generates a project-wide unique ID', () => {
  const modules = {
    fixedEvents: [{ id: 'jornal_10h', label: 'Sessão da manhã', time: '10:00', days: ['seg', 'ter'] }],
    choiceEvents: [{ id: 'jornal_10h_copy' }],
    clockTemplates: [{ id: 'jornal_10h_copy_2' }]
  };

  assert.equal(nextCopyId('jornal_10h', modules), 'jornal_10h_copy_3');
  const result = duplicateModuleEntry(modules, 'fixedEvents', 0);

  assert.equal(result.index, 1);
  assert.equal(modules.fixedEvents.length, 2);
  assert.equal(modules.fixedEvents[0].id, 'jornal_10h');
  assert.equal(modules.fixedEvents[1].id, 'jornal_10h_copy_3');
  assert.equal(modules.fixedEvents[1].label, 'Sessão da manhã (cópia)');
  assert.equal(modules.fixedEvents[1].time, '10:00');
  assert.deepEqual(modules.fixedEvents[1].days, ['seg', 'ter']);
});

test('complex Scripted Schedule entries are deep-cloned without sharing nested structures', () => {
  const fixtures = {
    sequenceEvents: {
      id: 'seq_main', label: 'Sequência principal', time: '19:55',
      steps: [{ mode: 'count', source: 'MOVIES', count: 2, playback: { fallbackSource: 'FILLER' } }],
      dates: ['2026-12-24'], excludeDates: ['2026-12-31']
    },
    choiceEvents: {
      id: 'choice_main', label: 'Escolha principal', time: '20:00', selection: 'weighted',
      choices: [{ source: 'MOVIES', weight: 2, watermarks: ['wm-a'] }, { source: 'SHOWS', weight: 1 }]
    },
    clockTemplates: {
      id: 'clock_main', label: 'Relógio principal', cycleMinutes: 60,
      slots: [{ offsetMinutes: 0, mode: 'count', source: 'NEWS', count: 1, nested: { title: 'Top' } }]
    },
    windowRotations: {
      id: 'window_main', label: 'Janela principal', startTime: '06:00', endTime: '12:00',
      items: [{ source: 'MUSIC', durationMinutes: 30, advanced: { trim: false } }]
    }
  };
  const modules = Object.fromEntries(Object.entries(fixtures).map(([type, item]) => [type, [item]]));

  for (const type of Object.keys(fixtures)) {
    const original = modules[type][0];
    const result = duplicateModuleEntry(modules, type, 0);
    const clone = result.item;

    assert.notStrictEqual(clone, original);
    assert.equal(clone.id, `${original.id}_copy`);
    assert.equal(clone.label, `${original.label} (cópia)`);

    const nestedKey = type === 'sequenceEvents' ? 'steps' : type === 'choiceEvents' ? 'choices' : type === 'clockTemplates' ? 'slots' : 'items';
    assert.notStrictEqual(clone[nestedKey], original[nestedKey]);
    assert.notStrictEqual(clone[nestedKey][0], original[nestedKey][0]);

    clone[nestedKey][0].source = 'CHANGED';
    assert.notEqual(original[nestedKey][0].source, 'CHANGED');
  }
});

test('simple rotation entries duplicate literally without inventing ID or label fields', () => {
  const modules = {
    rotation: [
      { source: 'ROCK', order: 'shuffle', presentation: 'music', durationMinutes: 60 },
      { source: 'POP', order: 'shuffle', presentation: 'music', durationMinutes: 45 }
    ]
  };
  const original = modules.rotation[0];
  const result = duplicateModuleEntry(modules, 'rotation', 0);

  assert.equal(result.index, 1);
  assert.deepEqual(result.item, original);
  assert.notStrictEqual(result.item, original);
  assert.equal(Object.prototype.hasOwnProperty.call(result.item, 'id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.item, 'label'), false);
  assert.equal(modules.rotation[2].source, 'POP');
});
