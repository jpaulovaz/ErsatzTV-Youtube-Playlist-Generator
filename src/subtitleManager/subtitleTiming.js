const { normalizeCues } = require('./subtitleFormats');

const MAX_OFFSET_MS = 30 * 60 * 1000;

function normalizeOffsetMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Offset de legenda invalido.');
  const rounded = Math.round(number);
  if (Math.abs(rounded) > MAX_OFFSET_MS) throw new Error('Offset de legenda excede o limite de 30 minutos.');
  return rounded;
}

function shiftCues(input, offsetMs) {
  const offset = normalizeOffsetMs(offsetMs);
  return normalizeCues(input).map((cue) => {
    const duration = Math.max(250, cue.endMs - cue.startMs);
    const startMs = Math.max(0, cue.startMs + offset);
    const endMs = Math.max(startMs + 250, cue.endMs + offset, startMs + duration);
    return { ...cue, startMs, endMs };
  });
}

module.exports = { MAX_OFFSET_MS, normalizeOffsetMs, shiftCues };
