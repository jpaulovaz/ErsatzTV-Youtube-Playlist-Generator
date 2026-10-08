const { writeSrt } = require('../subtitleManager/subtitleFormats');

function mismatch(message) {
  const error = new Error(message);
  error.code = 'TRANSLATION_CUE_MISMATCH';
  error.statusCode = 502;
  return error;
}

function normalizeTranslations(raw, expectedIds) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.translations) ? raw.translations : null);
  if (!list) throw mismatch('Resposta do tradutor nao contem translations.');
  const expected = new Set(expectedIds.map(String));
  const byId = new Map();
  for (const entry of list) {
    const id = String(entry && entry.id != null ? entry.id : '').trim();
    if (!id || !expected.has(id)) throw mismatch(`Tradutor devolveu ID desconhecido: ${id || '(vazio)'}.`);
    if (byId.has(id)) throw mismatch(`Tradutor devolveu ID duplicado: ${id}.`);
    const text = String(entry && entry.text != null ? entry.text : '').trim();
    if (!text) throw mismatch(`Tradutor devolveu texto vazio para o cue ${id}.`);
    byId.set(id, text);
  }
  for (const id of expected) if (!byId.has(id)) throw mismatch(`Tradutor omitiu o cue ${id}.`);
  return byId;
}

function buildOutputCues(sourceCues, translationMap, outputMode) {
  return sourceCues.map((cue, index) => {
    const id = String(index + 1);
    const hasTranslation = translationMap.has(id);
    const translated = hasTranslation ? translationMap.get(id) : cue.text;
    const text = outputMode === 'bilingual' && hasTranslation ? `${cue.text}\n${translated}` : translated;
    return { startMs: cue.startMs, endMs: cue.endMs, text };
  });
}

function validateTimeline(sourceCues, outputCues) {
  if (sourceCues.length !== outputCues.length) throw mismatch('Quantidade de cues mudou durante a traducao.');
  for (let index = 0; index < sourceCues.length; index += 1) {
    const source = sourceCues[index];
    const output = outputCues[index];
    if (source.startMs !== output.startMs || source.endMs !== output.endMs) {
      throw mismatch(`Timeline divergente no cue ${index + 1}.`);
    }
  }
  return true;
}

function renderValidatedSrt(sourceCues, translationMap, outputMode) {
  const outputCues = buildOutputCues(sourceCues, translationMap, outputMode);
  validateTimeline(sourceCues, outputCues);
  return { cues: outputCues, content: writeSrt(outputCues) };
}

module.exports = { normalizeTranslations, buildOutputCues, validateTimeline, renderValidatedSrt };
