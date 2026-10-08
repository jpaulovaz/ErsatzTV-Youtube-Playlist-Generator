const fs = require('fs/promises');
const path = require('path');
const { CONFIG_PATH: MAIN_CONFIG_PATH } = require('../config');

const CONFIG_VERSION = 1;
const CONFIG_PATH = process.env.ERSATZTV_SUBTITLE_TRANSLATION_CONFIG_PATH
  ? path.resolve(process.env.ERSATZTV_SUBTITLE_TRANSLATION_CONFIG_PATH)
  : path.join(path.dirname(MAIN_CONFIG_PATH), 'subtitle-translation.json');
const TARGET_LANGUAGES = Object.freeze(['pt-BR', 'en', 'es']);
const OUTPUT_MODES = Object.freeze(['translated', 'bilingual', 'both']);
const DEFAULTS = Object.freeze({
  version: CONFIG_VERSION,
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-3.6-flash',
  batchSize: 300,
  concurrency: 1,
  timeoutSeconds: 60,
  maxAttempts: 3,
  defaultTargetLanguage: 'pt-BR',
  defaultOutputMode: 'translated'
});

function clampInt(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalize(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const target = TARGET_LANGUAGES.includes(source.defaultTargetLanguage) ? source.defaultTargetLanguage : DEFAULTS.defaultTargetLanguage;
  const output = OUTPUT_MODES.includes(source.defaultOutputMode) ? source.defaultOutputMode : DEFAULTS.defaultOutputMode;
  return {
    version: CONFIG_VERSION,
    provider: 'gemini',
    apiKey: String(source.apiKey || '').trim(),
    model: (String(source.model || DEFAULTS.model).trim().replace(/^models\//, '') || DEFAULTS.model),
    batchSize: clampInt(source.batchSize, DEFAULTS.batchSize, 20, 1000),
    concurrency: clampInt(source.concurrency, DEFAULTS.concurrency, 1, 3),
    timeoutSeconds: clampInt(source.timeoutSeconds, DEFAULTS.timeoutSeconds, 10, 180),
    maxAttempts: clampInt(source.maxAttempts, DEFAULTS.maxAttempts, 1, 6),
    defaultTargetLanguage: target,
    defaultOutputMode: output
  };
}

async function loadFile() {
  try {
    const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
    if (!parsed || Number(parsed.version) !== CONFIG_VERSION) return normalize(parsed);
    return normalize(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') return normalize(DEFAULTS);
    if (error instanceof SyntaxError) {
      const invalid = `${CONFIG_PATH}.invalid-${Date.now()}`;
      await fs.rename(CONFIG_PATH, invalid).catch(() => {});
      return normalize(DEFAULTS);
    }
    throw error;
  }
}

async function load() {
  const config = await loadFile();
  const envKey = String(process.env.GEMINI_API_KEY || '').trim();
  return { ...config, apiKey: envKey || config.apiKey, apiKeySource: envKey ? 'environment' : (config.apiKey ? 'file' : 'none') };
}

async function atomicWrite(value) {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  const temp = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(temp, 0o600).catch(() => {});
  await fs.rename(temp, CONFIG_PATH);
  await fs.chmod(CONFIG_PATH, 0o600).catch(() => {});
}

async function save(patch = {}) {
  const currentFile = await loadFile();
  const nextRaw = { ...currentFile, ...patch };
  if (!Object.prototype.hasOwnProperty.call(patch, 'apiKey') || String(patch.apiKey || '').trim() === '') {
    nextRaw.apiKey = currentFile.apiKey;
  }
  if (patch.clearApiKey === true) nextRaw.apiKey = '';
  delete nextRaw.clearApiKey;
  const next = normalize(nextRaw);
  await atomicWrite(next);
  return load();
}

function publicStatus(config) {
  const value = config || {};
  return {
    version: CONFIG_VERSION,
    provider: 'gemini',
    configured: Boolean(value.apiKey),
    apiKeySource: value.apiKeySource || 'none',
    model: value.model || DEFAULTS.model,
    batchSize: value.batchSize || DEFAULTS.batchSize,
    concurrency: value.concurrency || DEFAULTS.concurrency,
    timeoutSeconds: value.timeoutSeconds || DEFAULTS.timeoutSeconds,
    maxAttempts: value.maxAttempts || DEFAULTS.maxAttempts,
    defaultTargetLanguage: value.defaultTargetLanguage || DEFAULTS.defaultTargetLanguage,
    defaultOutputMode: value.defaultOutputMode || DEFAULTS.defaultOutputMode
  };
}

module.exports = {
  CONFIG_VERSION,
  CONFIG_PATH,
  TARGET_LANGUAGES,
  OUTPUT_MODES,
  DEFAULTS,
  normalize,
  load,
  save,
  publicStatus
};
