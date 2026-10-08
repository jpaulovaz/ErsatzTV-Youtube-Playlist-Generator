const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { getSubtitleSidecarPath, listSubtitleSidecars } = require('../subtitleService');
const { parseSrt } = require('../subtitleManager/subtitleFormats');
const subtitleManager = require('../subtitleManager/subtitleManagerService');
const { isPathInside, pathExists } = require('../utils');
const { isActiveContentItem, listDestinationContent } = require('../libraryContentService');
const translationConfig = require('./translationConfig');
const translationState = require('./translationState');
const { isTranslatableText } = require('./translationPrompt');
const { normalizeTranslations, renderValidatedSrt } = require('./translationValidator');
const gemini = require('./providers/geminiTranslator');

const providers = { gemini };

function hashText(value) { return `sha256:${crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')}`; }
function nowIso() { return new Date().toISOString(); }

function maskCueTags(cue) {
  const tags = [];
  const masked = String(cue.text || '').replace(/<[^>\n]{1,80}>/g, (tag) => {
    const token = `__ETV_TAG_${cue.id}_${tags.length}__`;
    tags.push({ token, tag });
    return token;
  });
  return { ...cue, text: masked, tags };
}

function restoreCueTags(id, text, tagMap) {
  let result = String(text || '');
  for (const entry of tagMap.get(String(id)) || []) {
    if (!result.includes(entry.token)) { const error = new Error(`Tradutor nao preservou marcador de formatacao no cue ${id}.`); error.code = 'TRANSLATION_CUE_MISMATCH'; throw error; }
    result = result.split(entry.token).join(entry.tag);
  }
  return result;
}

function normalizeSourceLanguage(value) {
  const language = String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
  if (!language || language.toLowerCase() === 'und') { const e = new Error('Selecione uma legenda-fonte com idioma identificado.'); e.statusCode = 400; throw e; }
  return language;
}

function normalizeTargetLanguage(value) {
  if (!translationConfig.TARGET_LANGUAGES.includes(value)) { const e = new Error('Idioma de destino invalido.'); e.statusCode = 400; throw e; }
  return value;
}

function normalizeOutputMode(value) {
  if (!translationConfig.OUTPUT_MODES.includes(value)) { const e = new Error('Formato de saida invalido.'); e.statusCode = 400; throw e; }
  return value;
}

function normalizeExistingPolicy(value) { return value === 'replace' ? 'replace' : 'skip'; }

function requestedOutputs(outputMode, targetLanguage) {
  const mode = normalizeOutputMode(outputMode || 'translated');
  const outputs = [];
  if (mode === 'translated' || mode === 'both') outputs.push({ kind: 'translated', language: targetLanguage });
  if (mode === 'bilingual' || mode === 'both') outputs.push({ kind: 'bilingual', language: 'und' });
  return outputs;
}

function languageFromSidecar(mediaPath, sidecarPath) {
  const media = path.parse(mediaPath);
  const base = path.basename(sidecarPath);
  if (base === `${media.name}.srt`) return 'und';
  const prefix = `${media.name}.`;
  if (!base.startsWith(prefix) || !base.toLowerCase().endsWith('.srt')) return 'und';
  return base.slice(prefix.length, -4) || 'und';
}

function allItems(downloadManager, destination) {
  return downloadManager.getDestinationItems(destination.id).map((item) => ({ ...item }));
}

async function getLanguageCounts({ destination, downloadManager }) {
  const counts = {};
  for (const item of allItems(downloadManager, destination).filter(isActiveContentItem)) {
    if (!item.targetPath || !await pathExists(item.targetPath)) continue;
    const sidecars = await listSubtitleSidecars(item.targetPath);
    for (const sidecar of sidecars) {
      const language = languageFromSidecar(item.targetPath, sidecar);
      counts[language] = (counts[language] || 0) + 1;
    }
  }
  return counts;
}

async function filteredIds({ destination, downloadManager, filter = {} }) {
  const view = String(filter.view || 'content');
  const query = String(filter.query || '').trim();
  const browserPath = String(filter.path || '').trim();
  const subtitleOrigin = String(filter.subtitleOrigin || 'all');
  const ids = [];
  let offset = 0;
  while (true) {
    const result = await listDestinationContent({ destination, downloadManager, view, query, browserPath, subtitleOrigin, offset, limit: 120 });
    ids.push(...(result.items || []).map((item) => item.id));
    if (!result.pagination || !result.pagination.hasMore || !result.items.length) break;
    offset += result.items.length;
  }
  return new Set(ids);
}

async function selectItems({ destination, downloadManager, scope = 'all', filter = {} }) {
  let items = allItems(downloadManager, destination).filter(isActiveContentItem);
  if (scope === 'filtered') {
    const ids = await filteredIds({ destination, downloadManager, filter });
    items = items.filter((item) => ids.has(item.id));
  }
  return items;
}

async function analyzeItem(item, destination, sourceLanguage, targetLanguage, outputMode, existingPolicy) {
  if (!item.targetPath || !isPathInside(destination.rootPath, item.targetPath) || !await pathExists(item.targetPath)) return { status: 'inactive' };
  const sourcePath = getSubtitleSidecarPath(item.targetPath, sourceLanguage);
  const outputs = requestedOutputs(outputMode, targetLanguage).map((entry) => ({ ...entry, path: getSubtitleSidecarPath(item.targetPath, entry.language) }));
  if (!isPathInside(destination.rootPath, sourcePath) || outputs.some((entry) => !isPathInside(destination.rootPath, entry.path))) return { status: 'invalid-path' };
  if (!await pathExists(sourcePath)) return { status: 'source-missing' };
  let content;
  try { content = await fs.readFile(sourcePath, 'utf8'); } catch { return { status: 'source-invalid' }; }
  let cues;
  try { cues = parseSrt(content); } catch { return { status: 'source-invalid' }; }
  if (!cues.length) return { status: 'source-invalid' };

  for (const output of outputs) output.exists = await pathExists(output.path);
  const outputsToWrite = existingPolicy === 'replace' ? outputs : outputs.filter((entry) => !entry.exists);
  const existence = Object.fromEntries(outputs.map((entry) => [entry.kind, Boolean(entry.exists)]));
  if (!outputsToWrite.length) return { status: 'target-exists', cues: cues.length, existence };

  const translatable = cues.filter((cue) => isTranslatableText(cue.text));
  const textChars = translatable.reduce((sum, cue) => sum + cue.text.length, 0);
  return {
    status: 'eligible', cues: cues.length, translatableCues: translatable.length, textChars,
    estimatedTokens: Math.max(1, Math.ceil(textChars / 4)), existence,
    outputKinds: outputsToWrite.map((entry) => entry.kind), sourcePath, sourceHash: hashText(content)
  };
}

async function buildPlan({ destination, downloadManager, payload = {} }) {
  const sourceLanguage = normalizeSourceLanguage(payload.sourceLanguage);
  const targetLanguage = normalizeTargetLanguage(payload.targetLanguage);
  if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) { const e = new Error('Legenda-fonte e idioma de destino precisam ser diferentes.'); e.statusCode = 400; throw e; }
  const outputMode = normalizeOutputMode(payload.outputMode || 'translated');
  const existingPolicy = normalizeExistingPolicy(payload.existingPolicy);
  const scope = payload.scope === 'filtered' ? 'filtered' : 'all';
  const filter = payload.filter && typeof payload.filter === 'object' ? payload.filter : {};
  const items = await selectItems({ destination, downloadManager, scope, filter });
  const counts = {
    scanned: items.length, eligible: 0, sourceMissing: 0, sourceInvalid: 0, targetExists: 0, inactive: 0,
    translatedExists: 0, bilingualExists: 0, translatedToWrite: 0, bilingualToWrite: 0
  };
  let totalCues = 0; let translatableCues = 0; let textChars = 0; let estimatedTokens = 0;
  const eligibleItems = [];
  for (const item of items) {
    const analysis = await analyzeItem(item, destination, sourceLanguage, targetLanguage, outputMode, existingPolicy);
    if (analysis.existence?.translated) counts.translatedExists += 1;
    if (analysis.existence?.bilingual) counts.bilingualExists += 1;
    if (analysis.status === 'eligible') {
      counts.eligible += 1;
      if (analysis.outputKinds.includes('translated')) counts.translatedToWrite += 1;
      if (analysis.outputKinds.includes('bilingual')) counts.bilingualToWrite += 1;
      totalCues += analysis.cues; translatableCues += analysis.translatableCues; textChars += analysis.textChars; estimatedTokens += analysis.estimatedTokens;
      eligibleItems.push({
        itemId: item.id, title: item.title || item.trackTitle || item.videoId || item.id,
        sourceHash: analysis.sourceHash, outputKinds: analysis.outputKinds, existence: analysis.existence || {}
      });
    } else if (analysis.status === 'source-missing') counts.sourceMissing += 1;
    else if (analysis.status === 'target-exists') counts.targetExists += 1;
    else if (analysis.status === 'source-invalid') counts.sourceInvalid += 1;
    else counts.inactive += 1;
  }
  return {
    destinationId: destination.id,
    destinationType: destination.type || '',
    destinationName: destination.displayName || destination.folderName || destination.id,
    channelId: destination.channelId || null,
    playlistId: destination.playlistId || null,
    sourceLanguage, targetLanguage, outputMode, existingPolicy, scope, filter,
    counts, totals: { totalCues, translatableCues, textChars, estimatedTokens }, eligibleItems
  };
}

async function translateBatchResilient(provider, providerConfig, request, expectedIds, depth = 0) {
  try {
    const raw = await provider.translate(providerConfig, request);
    return normalizeTranslations(raw, expectedIds);
  } catch (error) {
    if (!['TRANSLATION_CUE_MISMATCH', 'GEMINI_INVALID_JSON', 'GEMINI_EMPTY_RESPONSE'].includes(error.code) || request.cues.length <= 1 || depth >= 8) throw error;
    const middle = Math.ceil(request.cues.length / 2);
    const first = request.cues.slice(0, middle);
    const second = request.cues.slice(middle);
    const firstMap = await translateBatchResilient(provider, providerConfig, { ...request, cues: first }, first.map((cue) => cue.id), depth + 1);
    const secondMap = await translateBatchResilient(provider, providerConfig, { ...request, cues: second }, second.map((cue) => cue.id), depth + 1);
    return new Map([...firstMap, ...secondMap]);
  }
}

async function translateItem({ jobId, destination, downloadManager, itemId, options }) {
  const item = allItems(downloadManager, destination).find((entry) => entry.id === itemId);
  if (!item || !isActiveContentItem(item) || !item.targetPath || !await pathExists(item.targetPath)) throw new Error('Item deixou de estar ativo durante a traducao.');
  const sourcePath = getSubtitleSidecarPath(item.targetPath, options.sourceLanguage);
  const outputMode = normalizeOutputMode(options.outputMode || 'translated');
  const outputs = requestedOutputs(outputMode, options.targetLanguage).map((entry) => ({ ...entry, path: getSubtitleSidecarPath(item.targetPath, entry.language) }));
  if (!isPathInside(destination.rootPath, sourcePath) || outputs.some((entry) => !isPathInside(destination.rootPath, entry.path))) throw new Error('Caminho de legenda fora do destino autorizado.');
  const sourceContent = await fs.readFile(sourcePath, 'utf8');
  const sourceHash = hashText(sourceContent);
  const cues = parseSrt(sourceContent);
  if (!cues.length) throw new Error('Legenda-fonte nao possui cues validos.');

  const outputsToWrite = [];
  for (const output of outputs) {
    const exists = await pathExists(output.path);
    if (options.existingPolicy === 'replace' || !exists) outputsToWrite.push({ ...output, exists });
  }
  if (!outputsToWrite.length) return { skipped: true, reason: 'target-exists' };

  const providerConfig = await translationConfig.load();
  const provider = providers[providerConfig.provider];
  if (!provider) throw new Error('Provider de traducao nao suportado.');
  const checkpoint = await translationState.loadCheckpoint(jobId, itemId);
  const validCheckpoint = checkpoint && checkpoint.sourceHash === sourceHash && checkpoint.model === providerConfig.model
    && checkpoint.sourceLanguage === options.sourceLanguage && checkpoint.targetLanguage === options.targetLanguage;
  const translations = new Map(validCheckpoint && Array.isArray(checkpoint.translations) ? checkpoint.translations.map((entry) => [String(entry.id), String(entry.text)]) : []);
  const pending = cues.map((cue, index) => ({ id: String(index + 1), text: cue.text })).filter((cue) => isTranslatableText(cue.text) && !translations.has(cue.id));
  const batchSize = Math.max(20, Math.min(1000, providerConfig.batchSize || 300));
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    const maskedBatch = batch.map(maskCueTags);
    const tagMap = new Map(maskedBatch.map((cue) => [String(cue.id), cue.tags]));
    const translated = await translateBatchResilient(provider, providerConfig, {
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      context: { title: item.trackTitle || item.title || '', artist: item.artist || item.channelTitle || '', mediaProfile: item.mediaProfile || destination.mediaProfile },
      cues: maskedBatch.map(({ id, text }) => ({ id, text }))
    }, batch.map((cue) => cue.id));
    for (const [id, text] of translated) translations.set(id, restoreCueTags(id, text, tagMap));
    await translationState.saveCheckpoint(jobId, itemId, {
      version: 1, itemId, sourceHash, model: providerConfig.model, sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage, outputMode, updatedAt: nowIso(),
      translations: [...translations].map(([id, text]) => ({ id, text }))
    });
  }
  for (let index = 0; index < cues.length; index += 1) {
    const id = String(index + 1);
    if (!translations.has(id)) translations.set(id, cues[index].text);
  }

  const renderedByKind = new Map();
  for (const output of outputsToWrite) {
    if (!renderedByKind.has(output.kind)) renderedByKind.set(output.kind, renderValidatedSrt(cues, translations, output.kind));
  }

  const written = [];
  for (const output of outputsToWrite) {
    const rendered = renderedByKind.get(output.kind);
    const bilingual = output.kind === 'bilingual';
    await subtitleManager.applyGeneratedSubtitle({ config: null, destination, downloadManager, itemId }, {
      language: output.language,
      content: rendered.content,
      replace: options.existingPolicy === 'replace',
      reason: 'gemini-translation',
      track: {
        provider: 'gemini', providerId: providerConfig.model, sourceType: 'translation',
        sourceLabel: bilingual ? 'Gemini · bilíngue' : 'Gemini · traduzida',
        metadata: {
          sourceLanguage: options.sourceLanguage, targetLanguage: options.targetLanguage,
          outputMode: output.kind, model: providerConfig.model, sourceHash, translatedAt: nowIso(),
          ersatzTvLanguage: bilingual ? 'und' : options.targetLanguage
        }
      }
    });
    written.push(output.kind);
  }
  return { skipped: false, sourceHash, model: providerConfig.model, cues: cues.length, outputs: written };
}

module.exports = {
  hashText,
  getLanguageCounts,
  buildPlan,
  translateItem,
  normalizeSourceLanguage,
  normalizeTargetLanguage,
  normalizeOutputMode,
  normalizeExistingPolicy,
  requestedOutputs,
  languageFromSidecar
};
