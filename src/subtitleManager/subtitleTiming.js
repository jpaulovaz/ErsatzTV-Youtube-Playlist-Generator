const { normalizeCues } = require('./subtitleFormats');

const MAX_OFFSET_MS = 30 * 60 * 1000;
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.5;

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

function normalizeScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Escala de sincronizacao invalida.');
  if (scale < MIN_SCALE || scale > MAX_SCALE) {
    const error = new Error('A correcao calculada e extrema demais. Confira os pontos/FPS informados.');
    error.statusCode = 400;
    error.code = 'SUBTITLE_TIMING_SCALE_UNSAFE';
    throw error;
  }
  return scale;
}

function transformCues(input, { scale = 1, anchorSourceMs = 0, anchorTargetMs = 0 } = {}) {
  const safeScale = normalizeScale(scale);
  const source = Number(anchorSourceMs);
  const target = Number(anchorTargetMs);
  if (!Number.isFinite(source) || !Number.isFinite(target)) throw new Error('Ponto de sincronizacao invalido.');
  return normalizeCues(input).map((cue) => {
    const startMs = Math.max(0, Math.round(target + (cue.startMs - source) * safeScale));
    const endMs = Math.max(startMs + 250, Math.round(target + (cue.endMs - source) * safeScale));
    return { ...cue, startMs, endMs };
  });
}

function twoPointTransform(input, pointA = {}, pointB = {}) {
  const sourceA = Number(pointA.subtitleMs);
  const targetA = Number(pointA.mediaMs);
  const sourceB = Number(pointB.subtitleMs);
  const targetB = Number(pointB.mediaMs);
  if (![sourceA, targetA, sourceB, targetB].every(Number.isFinite)) throw new Error('Preencha os dois pontos da legenda e do video.');
  if (Math.abs(sourceB - sourceA) < 1000) {
    const error = new Error('Os dois pontos da legenda precisam estar separados por pelo menos 1 segundo.');
    error.statusCode = 400;
    throw error;
  }
  const scale = normalizeScale((targetB - targetA) / (sourceB - sourceA));
  return {
    cues: transformCues(input, { scale, anchorSourceMs: sourceA, anchorTargetMs: targetA }),
    scale,
    pointA: { subtitleMs: Math.round(sourceA), mediaMs: Math.round(targetA) },
    pointB: { subtitleMs: Math.round(sourceB), mediaMs: Math.round(targetB) }
  };
}

function fpsTransform(input, sourceFps, targetFps) {
  const source = Number(sourceFps);
  const target = Number(targetFps);
  if (!Number.isFinite(source) || !Number.isFinite(target) || source <= 0 || target <= 0) throw new Error('FPS de origem e do video precisam ser numeros positivos.');
  const scale = normalizeScale(source / target);
  return { cues: transformCues(input, { scale, anchorSourceMs: 0, anchorTargetMs: 0 }), scale, sourceFps: source, targetFps: target };
}

module.exports = {
  MAX_OFFSET_MS,
  MIN_SCALE,
  MAX_SCALE,
  normalizeOffsetMs,
  normalizeScale,
  shiftCues,
  transformCues,
  twoPointTransform,
  fpsTransform
};
