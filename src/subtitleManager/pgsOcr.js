const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { runCommand } = require('../processUtils');
const { writeSrt, normalizeCues } = require('./subtitleFormats');

function readU24BE(buffer, offset) {
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
}

function parsePackets(buffer) {
  const packets = [];
  let offset = 0;
  while (offset + 13 <= buffer.length) {
    if (buffer[offset] !== 0x50 || buffer[offset + 1] !== 0x47) {
      offset += 1;
      continue;
    }
    const pts = buffer.readUInt32BE(offset + 2);
    const dts = buffer.readUInt32BE(offset + 6);
    const type = buffer[offset + 10];
    const size = buffer.readUInt16BE(offset + 11);
    const start = offset + 13;
    const end = start + size;
    if (end > buffer.length) break;
    packets.push({ pts, dts, type, payload: buffer.subarray(start, end) });
    offset = end;
  }
  return packets;
}

function parsePalette(payload) {
  if (payload.length < 2) return null;
  const id = payload[0];
  const entries = new Map();
  for (let offset = 2; offset + 4 < payload.length; offset += 5) {
    const index = payload[offset];
    entries.set(index, {
      y: payload[offset + 1],
      cr: payload[offset + 2],
      cb: payload[offset + 3],
      alpha: payload[offset + 4]
    });
  }
  return { id, entries };
}

function parseObjectSegment(payload, objects) {
  if (payload.length < 4) return;
  const objectId = payload.readUInt16BE(0);
  const sequence = payload[3];
  let cursor = 4;
  let object = objects.get(objectId) || { id: objectId, width: 0, height: 0, parts: [] };
  if (sequence & 0x80) {
    if (payload.length < 11) return;
    cursor += 3; // object_data_length
    object = { id: objectId, width: payload.readUInt16BE(cursor), height: payload.readUInt16BE(cursor + 2), parts: [] };
    cursor += 4;
  }
  if (cursor < payload.length) object.parts.push(Buffer.from(payload.subarray(cursor)));
  objects.set(objectId, object);
}

function parseComposition(payload) {
  if (payload.length < 11) return null;
  const width = payload.readUInt16BE(0);
  const height = payload.readUInt16BE(2);
  const paletteId = payload[9];
  const objectCount = payload[10];
  let offset = 11;
  const objects = [];
  for (let index = 0; index < objectCount; index += 1) {
    if (offset + 8 > payload.length) break;
    const objectId = payload.readUInt16BE(offset);
    const windowId = payload[offset + 2];
    const flags = payload[offset + 3];
    const x = payload.readUInt16BE(offset + 4);
    const y = payload.readUInt16BE(offset + 6);
    offset += 8;
    let crop = null;
    if (flags & 0x80) {
      if (offset + 8 > payload.length) break;
      crop = {
        x: payload.readUInt16BE(offset), y: payload.readUInt16BE(offset + 2),
        width: payload.readUInt16BE(offset + 4), height: payload.readUInt16BE(offset + 6)
      };
      offset += 8;
    }
    objects.push({ objectId, windowId, forced: Boolean(flags & 0x40), x, y, crop });
  }
  return { width, height, paletteId, objects };
}

function decodeRle(object) {
  const width = Number(object?.width) || 0;
  const height = Number(object?.height) || 0;
  if (!width || !height) return null;
  const data = Buffer.concat(object.parts || []);
  const pixels = new Uint8Array(width * height);
  let cursor = 0;
  let x = 0;
  let y = 0;
  while (cursor < data.length && y < height) {
    const value = data[cursor++];
    if (value !== 0) {
      if (x < width) pixels[y * width + x] = value;
      x += 1;
      continue;
    }
    if (cursor >= data.length) break;
    const control = data[cursor++];
    if (control === 0) {
      x = 0;
      y += 1;
      continue;
    }
    let runLength;
    let color = 0;
    if ((control & 0xC0) === 0x00) {
      runLength = control & 0x3F;
    } else if ((control & 0xC0) === 0x40) {
      if (cursor >= data.length) break;
      runLength = ((control & 0x3F) << 8) | data[cursor++];
    } else if ((control & 0xC0) === 0x80) {
      runLength = control & 0x3F;
      if (cursor >= data.length) break;
      color = data[cursor++];
    } else {
      if (cursor + 1 >= data.length) break;
      runLength = ((control & 0x3F) << 8) | data[cursor++];
      color = data[cursor++];
    }
    for (let index = 0; index < runLength && y < height; index += 1) {
      if (x < width) pixels[y * width + x] = color;
      x += 1;
    }
  }
  return { width, height, pixels };
}

function renderComposition(composition, objects, palettes) {
  if (!composition || !composition.objects?.length) return null;
  const palette = palettes.get(composition.paletteId) || [...palettes.values()].at(-1);
  if (!palette) return null;
  const decoded = [];
  for (const ref of composition.objects) {
    const object = objects.get(ref.objectId);
    const bitmap = decodeRle(object);
    if (!bitmap) continue;
    const crop = ref.crop || { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const width = Math.min(crop.width || bitmap.width, bitmap.width - crop.x);
    const height = Math.min(crop.height || bitmap.height, bitmap.height - crop.y);
    if (width <= 0 || height <= 0) continue;
    decoded.push({ ref, bitmap, crop: { ...crop, width, height } });
  }
  if (!decoded.length) return null;
  const minX = Math.min(...decoded.map((entry) => entry.ref.x));
  const minY = Math.min(...decoded.map((entry) => entry.ref.y));
  const maxX = Math.max(...decoded.map((entry) => entry.ref.x + entry.crop.width));
  const maxY = Math.max(...decoded.map((entry) => entry.ref.y + entry.crop.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const gray = new Uint8Array(width * height);
  let foreground = 0;
  let foregroundSum = 0;
  for (const entry of decoded) {
    for (let y = 0; y < entry.crop.height; y += 1) {
      for (let x = 0; x < entry.crop.width; x += 1) {
        const sx = entry.crop.x + x;
        const sy = entry.crop.y + y;
        const colorIndex = entry.bitmap.pixels[sy * entry.bitmap.width + sx];
        const color = palette.entries.get(colorIndex);
        if (!color || color.alpha < 8) continue;
        const dx = entry.ref.x - minX + x;
        const dy = entry.ref.y - minY + y;
        const intensity = Math.max(0, Math.min(255, Math.round(color.y * (color.alpha / 255))));
        const pos = dy * width + dx;
        if (intensity > gray[pos]) gray[pos] = intensity;
        foreground += 1;
        foregroundSum += intensity;
      }
    }
  }
  if (!foreground) return null;
  const average = foregroundSum / foreground;
  if (average < 90) {
    for (let index = 0; index < gray.length; index += 1) if (gray[index] > 0) gray[index] = 255 - gray[index];
  }
  return { width, height, gray };
}

function extractPgsImages(buffer) {
  const packets = parsePackets(buffer);
  const palettes = new Map();
  const objects = new Map();
  const frames = [];
  let composition = null;
  let startPts = null;
  let pending = null;

  function closePending(endPts) {
    if (!pending) return;
    const safeEnd = endPts > pending.startPts ? endPts : pending.startPts + 450000;
    frames.push({ ...pending, endPts: safeEnd });
    pending = null;
  }

  for (const packet of packets) {
    if (packet.type === 0x16) {
      closePending(packet.pts);
      composition = parseComposition(packet.payload);
      startPts = packet.pts;
    } else if (packet.type === 0x14) {
      const palette = parsePalette(packet.payload);
      if (palette) palettes.set(palette.id, palette);
    } else if (packet.type === 0x15) {
      parseObjectSegment(packet.payload, objects);
    } else if (packet.type === 0x80 && composition && composition.objects?.length) {
      const image = renderComposition(composition, objects, palettes);
      if (image) pending = { startPts: startPts ?? packet.pts, image, forced: composition.objects.some((entry) => entry.forced) };
      composition = null;
      startPts = null;
    }
  }
  closePending((pending?.startPts || 0) + 450000);
  return frames.map((frame) => ({
    startMs: Math.max(0, Math.round(frame.startPts / 90)),
    endMs: Math.max(250, Math.round(frame.endPts / 90)),
    image: frame.image,
    forced: frame.forced
  })).filter((frame) => frame.endMs > frame.startMs);
}

async function writePgm(filePath, image) {
  const header = Buffer.from(`P5\n${image.width} ${image.height}\n255\n`, 'ascii');
  await fs.writeFile(filePath, Buffer.concat([header, Buffer.from(image.gray)]));
}

function normalizeOcrText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

const LANGUAGE_MAP = Object.freeze({
  'pt': 'por', 'pt-br': 'por', 'por': 'por',
  'en': 'eng', 'en-us': 'eng', 'en-gb': 'eng', 'eng': 'eng',
  'es': 'spa', 'es-es': 'spa', 'spa': 'spa',
  'fr': 'fra', 'fra': 'fra', 'de': 'deu', 'deu': 'deu',
  'it': 'ita', 'ita': 'ita'
});

async function listTesseractLanguages(tesseractPath = 'tesseract') {
  const result = await runCommand(tesseractPath, ['--list-langs'], { timeoutMs: 10000 });
  if (result.code !== 0) return [];
  return String(result.stdout || '').split(/\r?\n/).map((value) => value.trim()).filter((value) => value && !/^List of available languages/i.test(value));
}

function selectTesseractLanguage(requested, available = []) {
  const normalized = String(requested || '').trim().toLowerCase().replace(/_/g, '-');
  const mapped = LANGUAGE_MAP[normalized] || normalized.split('-')[0] || 'eng';
  if (available.includes(mapped)) return mapped;
  if (available.includes('eng')) return 'eng';
  return available[0] || mapped || 'eng';
}

async function ocrPgsBuffer({ buffer, tesseractPath = 'tesseract', language = 'eng', tempDir, onProgress = null }) {
  const frames = extractPgsImages(buffer);
  if (!frames.length) {
    const error = new Error('Nao foi possivel localizar quadros de legenda PGS validos.');
    error.statusCode = 422;
    error.code = 'PGS_NO_FRAMES';
    throw error;
  }
  await fs.mkdir(tempDir, { recursive: true });
  const available = await listTesseractLanguages(tesseractPath);
  const ocrLanguage = selectTesseractLanguage(language, available);
  const cache = new Map();
  const cues = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const hash = crypto.createHash('sha1').update(Buffer.from(frame.image.gray)).digest('hex');
    let text = cache.get(hash);
    if (text == null) {
      const imagePath = path.join(tempDir, `${String(index + 1).padStart(6, '0')}.pgm`);
      await writePgm(imagePath, frame.image);
      const result = await runCommand(tesseractPath, [imagePath, 'stdout', '-l', ocrLanguage, '--psm', '6'], { timeoutMs: 60000 });
      await fs.rm(imagePath, { force: true }).catch(() => {});
      if (result.code !== 0) {
        const error = new Error(String(result.stderr || '').trim().slice(-1200) || 'Tesseract falhou durante o OCR.');
        error.statusCode = 502;
        error.code = 'PGS_OCR_FAILED';
        throw error;
      }
      text = normalizeOcrText(result.stdout);
      cache.set(hash, text);
    }
    if (text) cues.push({ startMs: frame.startMs, endMs: frame.endMs, text });
    if (typeof onProgress === 'function') await onProgress({ current: index + 1, total: frames.length, percent: Math.round(((index + 1) / frames.length) * 100) });
  }
  const normalized = normalizeCues(cues);
  if (!normalized.length) {
    const error = new Error('O OCR terminou, mas nenhum texto reconhecivel foi encontrado.');
    error.statusCode = 422;
    error.code = 'PGS_OCR_EMPTY';
    throw error;
  }
  return { cues: normalized, srt: writeSrt(normalized), ocrLanguage, frameCount: frames.length, recognizedCount: normalized.length };
}

module.exports = {
  parsePackets,
  parsePalette,
  parseComposition,
  decodeRle,
  renderComposition,
  extractPgsImages,
  normalizeOcrText,
  listTesseractLanguages,
  selectTesseractLanguage,
  ocrPgsBuffer
};
