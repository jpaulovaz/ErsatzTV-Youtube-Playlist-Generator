const fs = require('fs/promises');
const path = require('path');
const { moveAcrossFileSystems } = require('./download/storageUtils');
const { buildYtDlpCommonArgs } = require('./ytDlpUtils');

const SUPPORTED_SUBTITLE_LANGUAGES = ['pt-BR', 'pt', 'en', 'es'];
const DEFAULT_SUBTITLE_LANGUAGES = [...SUPPORTED_SUBTITLE_LANGUAGES];


function normalizeSubtitleLanguages(value) {
  const input = Array.isArray(value) ? value : [];
  const unique = [];
  for (const language of input) {
    const normalized = String(language || '').trim();
    if (!SUPPORTED_SUBTITLE_LANGUAGES.includes(normalized) || unique.includes(normalized)) continue;
    unique.push(normalized);
  }
  return unique;
}

function getSubtitleSettings(playlist) {
  const raw = playlist && playlist.subtitles && typeof playlist.subtitles === 'object'
    ? playlist.subtitles
    : {};
  const languages = normalizeSubtitleLanguages(raw.languages);
  return {
    enabled: Boolean(raw.enabled),
    includeAuto: raw.includeAuto !== false,
    languages: languages.length > 0 ? languages : [...DEFAULT_SUBTITLE_LANGUAGES],
    format: 'srt'
  };
}

function safeLanguageCode(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 40);
}

function getSubtitleSidecarPath(mediaPath, language) {
  const parsed = path.parse(mediaPath);
  const safeLanguage = safeLanguageCode(language);
  if (!safeLanguage) throw new Error('Codigo de idioma de legenda invalido.');
  return path.join(parsed.dir, `${parsed.name}.${safeLanguage}.srt`);
}

async function listSubtitleSidecars(mediaPath) {
  const parsed = path.parse(mediaPath);
  let entries = [];
  try {
    entries = await fs.readdir(parsed.dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const prefix = `${parsed.name}.`;
  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.toLowerCase().endsWith('.srt'))
    .map((entry) => path.join(parsed.dir, entry.name));
}

async function findExistingSubtitleLanguages(mediaPath, languages) {
  const found = [];
  for (const language of normalizeSubtitleLanguages(languages)) {
    try {
      const stats = await fs.stat(getSubtitleSidecarPath(mediaPath, language));
      if (stats.isFile() && stats.size > 0) found.push(language);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return found;
}

function subtitleVideoUrl(item) {
  return item.url || `https://www.youtube.com/watch?v=${item.videoId}`;
}

function normalizeAvailableLanguage(value) {
  return safeLanguageCode(value).toLowerCase();
}

function languageMatchRank(availableLanguage, targetLanguage, requestedLanguages = []) {
  const source = normalizeAvailableLanguage(availableLanguage);
  const target = normalizeAvailableLanguage(targetLanguage);
  const requested = new Set(normalizeSubtitleLanguages(requestedLanguages).map((value) => value.toLowerCase()));
  if (!source || !target) return null;
  if (source === target) return 0;

  if (target === 'pt-br') {
    if (source.startsWith('pt-br-')) return 1;
    if (!requested.has('pt') && source === 'pt') return 2;
    return null;
  }
  if (target === 'pt') return source.startsWith('pt-') ? 1 : null;
  if (target === 'en') return source.startsWith('en-') ? 1 : null;
  if (target === 'es') return source.startsWith('es-') ? 1 : null;
  return null;
}

function collectYoutubeSubtitleCandidates(info, includeAuto = true) {
  const candidates = [];
  const add = (collection, sourceType) => {
    for (const [language, entries] of Object.entries(collection || {})) {
      const normalized = safeLanguageCode(language);
      if (!normalized) continue;
      const name = Array.isArray(entries) ? entries.map((entry) => entry && entry.name).find(Boolean) : '';
      candidates.push({
        sourceLanguage: normalized,
        sourceType,
        providerId: `${sourceType === 'manual' ? 'manual' : 'auto'}:${normalized}`,
        sourceLabel: sourceType === 'manual' ? 'YouTube · enviada pelo canal' : 'YouTube · automatica',
        name: name || ''
      });
    }
  };
  add(info && info.subtitles, 'manual');
  if (includeAuto) add(info && info.automatic_captions, 'automatic');
  return candidates;
}

function selectYoutubeSubtitleCandidates(info, requestedLanguages, includeAuto = true) {
  const requested = normalizeSubtitleLanguages(requestedLanguages);
  const candidates = collectYoutubeSubtitleCandidates(info, includeAuto);
  const used = new Set();
  const selections = [];

  for (const targetLanguage of requested) {
    const matches = candidates
      .map((candidate) => ({
        ...candidate,
        matchRank: languageMatchRank(candidate.sourceLanguage, targetLanguage, requested)
      }))
      .filter((candidate) => candidate.matchRank !== null && !used.has(candidate.providerId))
      .sort((a, b) => {
        const typeRank = (a.sourceType === 'manual' ? 0 : 100) - (b.sourceType === 'manual' ? 0 : 100);
        if (typeRank !== 0) return typeRank;
        if (a.matchRank !== b.matchRank) return a.matchRank - b.matchRank;
        return a.sourceLanguage.length - b.sourceLanguage.length || a.sourceLanguage.localeCompare(b.sourceLanguage);
      });
    const selected = matches[0];
    if (!selected) continue;
    used.add(selected.providerId);
    selections.push({ ...selected, targetLanguage });
  }

  return selections;
}

function buildSubtitleDiscoveryArgs(config, playlist, item) {
  return [
    ...buildYtDlpCommonArgs(config, playlist),
    '--skip-download',
    '--no-playlist',
    '--dump-single-json',
    '--no-color',
    subtitleVideoUrl(item)
  ];
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSubtitleCandidateDownloadArgs(config, playlist, item, workDir, selection) {
  if (!selection || !selection.sourceLanguage || !selection.targetLanguage) {
    throw new Error('Selecao de legenda do YouTube invalida.');
  }
  const args = [...buildYtDlpCommonArgs(config, playlist), '--skip-download', '--no-playlist'];
  if (selection.sourceType === 'manual') args.push('--write-subs', '--no-write-auto-subs');
  else args.push('--no-write-subs', '--write-auto-subs');
  args.push(
    '--sub-langs',
    `^${escapeRegex(selection.sourceLanguage)}$`,
    '--sub-format',
    'srt/best',
    '--convert-subs',
    'srt',
    '--no-overwrites',
    '--newline',
    '--no-color',
    '-o',
    path.join(workDir, 'subtitle.%(ext)s'),
    subtitleVideoUrl(item)
  );
  return args;
}

async function collectStagedSubtitles(workDir) {
  let entries = [];
  try {
    entries = await fs.readdir(workDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const result = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = /^subtitle\.(.+)\.srt$/i.exec(entry.name);
    if (!match) continue;
    const language = safeLanguageCode(match[1]);
    if (!language) continue;
    const filePath = path.join(workDir, entry.name);
    const stats = await fs.stat(filePath);
    if (stats.size <= 0) continue;
    result.push({ language, filePath, sizeBytes: stats.size });
  }
  return result;
}

async function finalizeStagedSubtitles(workDir, mediaPath) {
  const staged = await collectStagedSubtitles(workDir);
  const moved = [];
  const preserved = [];

  for (const subtitle of staged) {
    const targetPath = getSubtitleSidecarPath(mediaPath, subtitle.language);
    try {
      const existing = await fs.stat(targetPath);
      if (existing.isFile() && existing.size > 0) {
        preserved.push({ language: subtitle.language, targetPath, sizeBytes: existing.size });
        await fs.rm(subtitle.filePath, { force: true });
        continue;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await moveAcrossFileSystems(subtitle.filePath, targetPath);
    moved.push({ language: subtitle.language, targetPath, sizeBytes: subtitle.sizeBytes });
  }

  return { moved, preserved };
}

module.exports = {
  SUPPORTED_SUBTITLE_LANGUAGES,
  DEFAULT_SUBTITLE_LANGUAGES,
  normalizeSubtitleLanguages,
  getSubtitleSettings,
  getSubtitleSidecarPath,
  listSubtitleSidecars,
  findExistingSubtitleLanguages,
  languageMatchRank,
  collectYoutubeSubtitleCandidates,
  selectYoutubeSubtitleCandidates,
  buildSubtitleDiscoveryArgs,
  buildSubtitleCandidateDownloadArgs,
  collectStagedSubtitles,
  finalizeStagedSubtitles
};
