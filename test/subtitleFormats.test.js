const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, parseSrt, parseVtt, parseAss, writeSrt, cuesToVtt } = require('../src/subtitleManager/subtitleFormats');
const { shiftCues, normalizeOffsetMs, twoPointTransform, fpsTransform } = require('../src/subtitleManager/subtitleTiming');

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


test('parseVtt converte cues textuais preservando timing e texto', () => {
  const cues = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.500 align:start\nHello\nworld\n');
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0], { startMs: 1000, endMs: 2500, text: 'Hello\nworld' });
});

test('parseAss remove estilos e converte quebra de linha sem tocar no original', () => {
  const ass = '[Script Info]\nTitle: Teste\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.25,Default,,0,0,0,,{\\i1}Hello{\\i0}\\Nworld\n';
  const cues = parseAss(ass);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3250);
  assert.equal(cues[0].text, 'Hello\nworld');
});

test('sincronizacao por dois pontos corrige drift por transformacao linear', () => {
  const source = [{ startMs: 1000, endMs: 2000, text: 'A' }, { startMs: 10000, endMs: 11000, text: 'B' }];
  const result = twoPointTransform(source, { subtitleMs: 1000, mediaMs: 2000 }, { subtitleMs: 10000, mediaMs: 12000 });
  assert.equal(result.cues[0].startMs, 2000);
  assert.equal(result.cues[1].startMs, 12000);
  assert.ok(result.scale > 1);
});

test('correcao de FPS reescala a timeline explicitamente', () => {
  const result = fpsTransform([{ startMs: 25000, endMs: 26000, text: 'A' }], 25, 23.976);
  assert.ok(result.cues[0].startMs > 25000);
  assert.ok(Math.abs(result.scale - (25 / 23.976)) < 0.000001);
});
