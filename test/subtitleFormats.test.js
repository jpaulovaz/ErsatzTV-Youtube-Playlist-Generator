const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, parseSrt, writeSrt, cuesToVtt } = require('../src/subtitleManager/subtitleFormats');
const { shiftCues, normalizeOffsetMs } = require('../src/subtitleManager/subtitleTiming');

 test('parseLrc converte timestamps sincronizados em cues estáveis', () => {
  const cues = parseLrc('[00:01.00]Linha 1\n[00:03.50]Linha 2', { durationSeconds: 8 });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3450);
  assert.equal(cues[1].endMs, 8000);
});

test('parseLrc aceita múltiplos timestamps na mesma linha', () => {
  const cues = parseLrc('[00:01.00][00:02.00]Refrão');
  assert.deepEqual(cues.map((cue) => cue.startMs), [1000, 2000]);
});

test('writeSrt e parseSrt fazem round-trip', () => {
  const source = [{ startMs: 100, endMs: 1200, text: 'Olá' }, { startMs: 1500, endMs: 2500, text: 'Mundo' }];
  assert.deepEqual(parseSrt(writeSrt(source)), source);
});

test('cuesToVtt produz documento WEBVTT', () => {
  const value = cuesToVtt([{ startMs: 0, endMs: 1000, text: 'Teste' }]);
  assert.match(value, /^WEBVTT/);
  assert.match(value, /00:00:00\.000 --> 00:00:01\.000/);
});

test('shiftCues aplica offset e protege início negativo', () => {
  const shifted = shiftCues([{ startMs: 500, endMs: 1500, text: 'A' }], -1000);
  assert.equal(shifted[0].startMs, 0);
  assert.ok(shifted[0].endMs >= 1000);
});

test('normalizeOffsetMs rejeita valores absurdos', () => {
  assert.throws(() => normalizeOffsetMs(31 * 60 * 1000), /30 minutos/);
});
