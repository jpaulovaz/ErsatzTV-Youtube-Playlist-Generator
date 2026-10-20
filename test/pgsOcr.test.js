const test = require('node:test');
const assert = require('node:assert/strict');
const pgs = require('../src/subtitleManager/pgsOcr');

function packet(type, pts, payload = Buffer.alloc(0)) {
  const out = Buffer.alloc(13 + payload.length);
  out[0] = 0x50; out[1] = 0x47;
  out.writeUInt32BE(pts >>> 0, 2);
  out.writeUInt32BE(pts >>> 0, 6);
  out[10] = type;
  out.writeUInt16BE(payload.length, 11);
  payload.copy(out, 13);
  return out;
}

function composition({ objects = 1 } = {}) {
  const payload = Buffer.alloc(11 + (objects ? 8 : 0));
  payload.writeUInt16BE(1920, 0);
  payload.writeUInt16BE(1080, 2);
  payload[9] = 0;
  payload[10] = objects;
  if (objects) {
    payload.writeUInt16BE(1, 11);
    payload[13] = 0;
    payload[14] = 0;
    payload.writeUInt16BE(100, 15);
    payload.writeUInt16BE(900, 17);
  }
  return payload;
}

test('PGS parser extrai um quadro simples com timing em milissegundos', () => {
  const palette = Buffer.from([0, 0, 0, 16, 128, 128, 0, 1, 235, 128, 128, 255]);
  const rle = Buffer.from([1, 1]);
  const ods = Buffer.alloc(11 + rle.length);
  ods.writeUInt16BE(1, 0);
  ods[2] = 0;
  ods[3] = 0xC0;
  ods[4] = 0; ods[5] = 0; ods[6] = 6;
  ods.writeUInt16BE(2, 7);
  ods.writeUInt16BE(1, 9);
  rle.copy(ods, 11);
  const buffer = Buffer.concat([
    packet(0x16, 90000, composition()),
    packet(0x14, 90000, palette),
    packet(0x15, 90000, ods),
    packet(0x80, 90000),
    packet(0x16, 180000, composition({ objects: 0 }))
  ]);
  const frames = pgs.extractPgsImages(buffer);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].startMs, 1000);
  assert.equal(frames[0].endMs, 2000);
  assert.equal(frames[0].image.width, 2);
  assert.equal(frames[0].image.height, 1);
  assert.ok(frames[0].image.gray.some((value) => value > 0));
});

test('OCR normaliza texto e escolhe pacote de idioma Tesseract com fallback', () => {
  assert.equal(pgs.normalizeOcrText('  Hello   world \n\n Teste  '), 'Hello world\nTeste');
  assert.equal(pgs.selectTesseractLanguage('pt-BR', ['eng', 'por']), 'por');
  assert.equal(pgs.selectTesseractLanguage('de', ['eng']), 'eng');
});

test('PGS RLE respeita marcador explicito de fim de linha sem pular linhas', () => {
  const object = { width: 2, height: 2, parts: [Buffer.from([
    1, 1, 0, 0,
    1, 1, 0, 0
  ])] };
  const bitmap = pgs.decodeRle(object);
  assert.equal(bitmap.width, 2);
  assert.equal(bitmap.height, 2);
  assert.deepEqual([...bitmap.pixels], [1, 1, 1, 1]);
});
