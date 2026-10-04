const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
const MIN_CUE_MS = 250;
const DEFAULT_LAST_CUE_MS = 5000;

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function assertSubtitleText(value) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') > MAX_SUBTITLE_BYTES) {
    const error = new Error('Arquivo de legenda excede o limite suportado.');
    error.statusCode = 413;
    throw error;
  }
  return text;
}

function parseSrtTimestamp(value) {
  const match = /^\s*(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})\s*$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(String(match[4]).padEnd(3, '0').slice(0, 3));
  if (minutes > 59 || seconds > 59) return null;
  return (((hours * 60 + minutes) * 60) + seconds) * 1000 + millis;
}

function formatSrtTimestamp(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function formatVttTimestamp(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function normalizeCues(input) {
  const cues = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const startMs = Math.max(0, Math.round(Number(raw && raw.startMs) || 0));
    const rawEnd = Math.round(Number(raw && raw.endMs) || 0);
    const endMs = Math.max(startMs + MIN_CUE_MS, rawEnd);
    const text = normalizeNewlines(raw && raw.text).trim();
    if (!text) continue;
    cues.push({ startMs, endMs, text });
  }
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return cues;
}

function parseSrt(value) {
  const text = assertSubtitleText(normalizeNewlines(value)).replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  const blocks = text.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.replace(/\s+$/g, ''));
    if (!lines.length) continue;
    let index = /^\d+$/.test(String(lines[0] || '').trim()) ? 1 : 0;
    const timing = String(lines[index] || '');
    const match = /^\s*(.*?)\s*-->\s*(.*?)\s*$/.exec(timing);
    if (!match) continue;
    const startMs = parseSrtTimestamp(match[1]);
    const endMs = parseSrtTimestamp(match[2].split(/\s+/)[0]);
    if (startMs == null || endMs == null || endMs <= startMs) continue;
    const cueText = lines.slice(index + 1).join('\n').trim();
    if (!cueText) continue;
    cues.push({ startMs, endMs, text: cueText });
  }
  return normalizeCues(cues);
}

function writeSrt(input) {
  const cues = normalizeCues(input);
  return `${cues.map((cue, index) => `${index + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}\n${cue.text}`).join('\n\n')}\n`;
}

function cuesToVtt(input) {
  const cues = normalizeCues(input);
  return `WEBVTT\n\n${cues.map((cue) => `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}\n${cue.text}`).join('\n\n')}\n`;
}

function parseLrcTimestamp(value) {
  const match = /^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/.exec(String(value || '').trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  const fraction = match[3] == null ? 0 : Number(`0.${match[3]}`) * 1000;
  return Math.round((minutes * 60 + seconds) * 1000 + fraction);
}

function parseLrc(value, options = {}) {
  const text = assertSubtitleText(normalizeNewlines(value)).replace(/^\uFEFF/, '');
  const byStart = new Map();
  for (const line of text.split('\n')) {
    const timestamps = [...line.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
    if (!timestamps.length) continue;
    const lyric = line.replace(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g, '').trim();
    if (!lyric) continue;
    for (const match of timestamps) {
      const startMs = parseLrcTimestamp(match[1]);
      if (startMs == null) continue;
      const current = byStart.get(startMs) || [];
      if (!current.includes(lyric)) current.push(lyric);
      byStart.set(startMs, current);
    }
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const durationMs = Number(options.durationSeconds) > 0 ? Math.round(Number(options.durationSeconds) * 1000) : null;
  return starts.map((startMs, index) => {
    const nextStart = starts[index + 1];
    let endMs;
    if (nextStart != null) endMs = Math.max(startMs + MIN_CUE_MS, nextStart - 50);
    else if (durationMs && durationMs > startMs) endMs = Math.max(startMs + MIN_CUE_MS, Math.min(durationMs, startMs + 15000));
    else endMs = startMs + DEFAULT_LAST_CUE_MS;
    return { startMs, endMs, text: byStart.get(startMs).join('\n') };
  });
}

module.exports = {
  MAX_SUBTITLE_BYTES,
  MIN_CUE_MS,
  parseSrtTimestamp,
  formatSrtTimestamp,
  parseSrt,
  writeSrt,
  cuesToVtt,
  parseLrc,
  normalizeCues
};
