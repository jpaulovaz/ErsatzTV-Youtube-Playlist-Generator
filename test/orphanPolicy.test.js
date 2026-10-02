const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ORPHAN_POLICIES,
  USER_DISPOSITIONS,
  STORAGE_STATES,
  normalizeOrphanPolicy,
  normalizeRetentionDays,
  quarantineExpiresAt
} = require('../src/orphans/orphanPolicy');
const { STATE_VERSION, normalizeState } = require('../src/download/queueState');

test('orphan policy helpers normalize supported policies and retention windows', () => {
  assert.equal(normalizeOrphanPolicy('DELETE'), ORPHAN_POLICIES.DELETE);
  assert.equal(normalizeOrphanPolicy('mark'), ORPHAN_POLICIES.MARK);
  assert.equal(normalizeOrphanPolicy('quarantine'), ORPHAN_POLICIES.QUARANTINE);
  assert.equal(normalizeOrphanPolicy('unknown', null), null);
  assert.equal(normalizeRetentionDays(30, null), 30);
  assert.equal(normalizeRetentionDays('90', null), 90);
  assert.equal(normalizeRetentionDays(7, null), null);
  assert.equal(normalizeRetentionDays('', null), null);

  assert.equal(quarantineExpiresAt(null, '2026-10-02T12:00:00.000Z'), null);
  assert.equal(quarantineExpiresAt(30, '2026-10-02T12:00:00.000Z'), '2026-11-01T12:00:00.000Z');
});

test('state v4 migrates to v5 without turning suppressed queue items into ignored content', () => {
  const state = normalizeState({
    version: 4,
    nextSequence: 2,
    items: {
      'Teste::aaaaaaaaaaa': {
        libraryFolder: 'Teste',
        videoId: 'aaaaaaaaaaa',
        status: 'removed',
        suppressed: true,
        sourceActive: true,
        targetPath: '/tmp/does-not-matter.mp4',
        queueOrder: 1
      }
    },
    libraries: {}
  });
  const item = state.items['Teste::aaaaaaaaaaa'];
  assert.equal(state.version, STATE_VERSION);
  assert.equal(STATE_VERSION, 5);
  assert.equal(item.suppressed, true);
  assert.equal(item.userDisposition, USER_DISPOSITIONS.MANAGED);
  assert.equal(item.storageState, STORAGE_STATES.ABSENT);
});
