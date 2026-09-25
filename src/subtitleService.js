const fs = require('fs/promises');
const path = require('path');

const SUPPORTED_SUBTITLE_LANGUAGES = ['pt-BR', 'pt', 'en', 'es'];
const DEFAULT_SUBTITLE_LANGUAGES = [...SUPPORTED_SUBTITLE_LANGUAGES];

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function getJsRuntimeArg(config) {
  const downloads = config && config.downloads || {};
  const mode = String(downloads.jsRuntimeMode || 'disabled').trim();
  if (!mode || mode === 'disabled') return '';

  const name = mode === 'custom'
    ? sanitizeJsRuntimeName(downloads.jsRuntimeCustomName)
    : sanitizeJsRuntimeName(mode);
  if (!name) return '';

  const runtimePath = String(downloads.jsRuntimePath || '').trim();
  return runtimePath ? `${name}:${runtimePath}` : name;
}

function getEffectiveCookiesPath(config, playlist) {
  return String((playlist && playlist.cookiesPath) || (config && config.paths && config.paths.cookiesPath) || '').trim();
}

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

function buildSubtitleDownloadArgs(config, playlist, item, workDir, languages) {
  const requested = normalizeSubtitleLanguages(languages);
  if (requested.length === 0) throw new Error('Nenhum idioma de legenda foi solicitado.');

  const downloads = config && config.downloads || {};
  const settings = getSubtitleSettings(playlist);
  const runtimeArg = getJsRuntimeArg(config);
  const ejsComponents = runtimeArg ? String(downloads.ejsComponents || '').trim() : '';
  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const outputTemplate = path.join(workDir, 'subtitle.%(ext)s');
  const args = [];

  if (runtimeArg) args.push('--js-runtimes', runtimeArg);
  if (ejsComponents && ejsComponents !== 'none') args.push('--remote-components', ejsComponents);
  if (cookiesPath) args.push('--cookies', cookiesPath);
  if (downloads.userAgent) args.push('--add-header', `User-Agent: ${downloads.userAgent}`);
  if (config && config.paths && config.paths.ffmpegPath) {
    args.push('--ffmpeg-location', path.dirname(config.paths.ffmpegPath));
  }

  args.push(
    '--skip-download',
    '--no-playlist',
    '--write-subs'
  );
  if (settings.includeAuto) args.push('--write-auto-subs');
  args.push(
    '--sub-langs',
    requested.join(','),
    '--sub-format',
    'srt/best',
    '--convert-subs',
    'srt',
    '--no-overwrites',
    '--newline',
    '--no-color',
    '-o',
    outputTemplate,
    item.url || `https://www.youtube.com/watch?v=${item.videoId}`
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

async function moveAcrossFileSystems(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    const tempTarget = `${targetPath}.importing-${process.pid}`;
    await fs.copyFile(sourcePath, tempTarget);
    await fs.rename(tempTarget, targetPath);
    await fs.rm(sourcePath, { force: true });
  }
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
  buildSubtitleDownloadArgs,
  collectStagedSubtitles,
  finalizeStagedSubtitles
};
