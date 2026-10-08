const LANGUAGE_NAMES = Object.freeze({
  'pt-BR': 'Portuguese (Brazil)',
  en: 'English',
  es: 'Spanish'
});

function languageName(code) { return LANGUAGE_NAMES[code] || String(code || ''); }

function isTranslatableText(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

function buildPrompt({ sourceLanguage, targetLanguage, context = {}, cues = [] }) {
  const title = String(context.title || '').trim();
  const artist = String(context.artist || '').trim();
  const mediaProfile = String(context.mediaProfile || '').trim();
  const payload = cues.map((cue) => ({ id: String(cue.id), text: String(cue.text || '') }));
  return [
    `Translate subtitle cue text from ${languageName(sourceLanguage)} to ${languageName(targetLanguage)}.`,
    'Return only the structured JSON requested by the response schema.',
    'Translate naturally for subtitles/lyrics. Do not summarize, explain, censor, complete missing lyrics, or alter cue IDs.',
    'Preserve proper names when appropriate, profanity/tone, simple formatting markers, music symbols, and intentional line breaks when practical.',
    'Each output item must contain exactly one existing cue id and its translated text. Do not add or omit ids.',
    title ? `Title context: ${title}` : '',
    artist ? `Artist context: ${artist}` : '',
    mediaProfile ? `Media profile: ${mediaProfile}` : '',
    `Input cues JSON: ${JSON.stringify(payload)}`
  ].filter(Boolean).join('\n');
}

module.exports = { LANGUAGE_NAMES, languageName, isTranslatableText, buildPrompt };
