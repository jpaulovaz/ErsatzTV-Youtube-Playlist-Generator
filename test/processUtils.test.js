const test = require('node:test');
const assert = require('node:assert/strict');
const { runCommand } = require('../src/processUtils');

test('runCommand captures stdout, stderr and exit status', async () => {
  const script = [
    "process.stdout.write('saida')",
    "process.stderr.write('erro')",
    'process.exit(7)'
  ].join(';');
  const result = await runCommand(process.execPath, ['-e', script]);
  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'saida');
  assert.equal(result.stderr, 'erro');
  assert.equal(result.timedOut, false);
});

test('runCommand reports timeout without throwing', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 40 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});
