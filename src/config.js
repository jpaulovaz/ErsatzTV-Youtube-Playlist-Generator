const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_STREAM_MAX_HEIGHT = 720;
const STREAM_QUALITY_MODES = new Set(['compatible', 'high', 'custom']);

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function buildCompatibleFormat(maxHeight = DEFAULT_STREAM_MAX_HEIGHT) {
  const height = toPositiveInteger(maxHeight, DEFAULT_STREAM_MAX_HEIGHT);
  return `best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
}

function buildHighQualityFormat(maxHeight = DEFAULT_STREAM_MAX_HEIGHT) {
  const height = toPositiveInteger(maxHeight, DEFAULT_STREAM_MAX_HEIGHT);
  return `bestvideo[height<=${height}][vcodec!=none]+bestaudio[acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
}

function buildDefaultFormatSort(maxHeight = DEFAULT_STREAM_MAX_HEIGHT) {
  const height = toPositiveInteger(maxHeight, DEFAULT_STREAM_MAX_HEIGHT);
  return `res:${height},fps`;
}

function buildStreamFormat(stream) {
  const mode = STREAM_QUALITY_MODES.has(stream && stream.qualityMode) ? stream.qualityMode : 'compatible';
  const maxHeight = toPositiveInteger(stream && stream.maxHeight, DEFAULT_STREAM_MAX_HEIGHT);

  if (mode === 'compatible') return buildCompatibleFormat(maxHeight);
  if (mode === 'high') return buildHighQualityFormat(maxHeight);

  return String((stream && stream.format) || buildCompatibleFormat(maxHeight)).trim();
}

const DEFAULT_STREAM_FORMAT = buildCompatibleFormat(DEFAULT_STREAM_MAX_HEIGHT);
const DEFAULT_HIGH_QUALITY_FORMAT = buildHighQualityFormat(DEFAULT_STREAM_MAX_HEIGHT);

const DEFAULT_CONFIG = {
  server: {
    host: '0.0.0.0',
    port: 3099
  },
  paths: {
    baseDir: '/home/joaopaulovaz/comerciais/videclipes/youtube/youtube',
    ytDlpPath: '/usr/local/bin/yt-dlp',
    cookiesPath: '/home/joaopaulovaz/comerciais/videclipes/youtube/cookies.txt',
    streamScriptName: 'stream-yt.sh'
  },
  stream: {
    userAgent: DEFAULT_USER_AGENT,
    qualityMode: 'compatible',
    maxHeight: DEFAULT_STREAM_MAX_HEIGHT,
    format: DEFAULT_STREAM_FORMAT,
    useHlsMpegTs: true,
    useFormatSort: false,
    formatSort: buildDefaultFormatSort(DEFAULT_STREAM_MAX_HEIGHT),
    useMergeOutputFormat: false,
    mergeOutputFormat: 'mkv'
  },
  ersatztv: {
    url: 'http://localhost:8409',
    apiTimeoutSeconds: 10
  },
  playlists: [
    {
      name: 'Mix_Principal',
      url: 'https://www.youtube.com/watch?v=u2ah9tWTkmk&list=PLHg022HMFzFCRq-5ZVR3hiiCkGPJ3Ur1D',
      enabled: true,
      libraryId: 27,
      playoutId: 33,
      cookiesPath: ''
    }
  ],
  scheduler: {
    enabled: false,
    intervalMinutes: 60,
    runOnStartup: false
  },
  cleanup: {
    removeEmptyArtistFolders: true
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, override) {
  const result = clone(base);
  if (!override || typeof override !== 'object') return result;

  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function toOptionalPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function inferQualityMode(rawStream) {
  const explicitMode = String((rawStream && rawStream.qualityMode) || '').trim();
  if (STREAM_QUALITY_MODES.has(explicitMode)) return explicitMode;

  const rawFormat = String((rawStream && rawStream.format) || '').trim();
  const rawMaxHeight = toPositiveInteger(rawStream && rawStream.maxHeight, DEFAULT_STREAM_MAX_HEIGHT);

  if (!rawFormat || rawFormat === buildCompatibleFormat(rawMaxHeight) || rawFormat === DEFAULT_STREAM_FORMAT) {
    return 'compatible';
  }

  if (rawFormat === buildHighQualityFormat(rawMaxHeight) || rawFormat === DEFAULT_HIGH_QUALITY_FORMAT) {
    return 'high';
  }

  return 'custom';
}

function normalizeStreamConfig(config, rawConfig) {
  const rawStream = rawConfig.stream && typeof rawConfig.stream === 'object' ? rawConfig.stream : {};
  const stream = config.stream && typeof config.stream === 'object' ? config.stream : clone(DEFAULT_CONFIG.stream);

  stream.userAgent = String(stream.userAgent || DEFAULT_USER_AGENT).trim();
  stream.qualityMode = inferQualityMode(rawStream);
  stream.maxHeight = toPositiveInteger(stream.maxHeight, DEFAULT_STREAM_MAX_HEIGHT);
  stream.useHlsMpegTs = stream.useHlsMpegTs !== false;

  if (stream.qualityMode === 'high') {
    stream.useFormatSort = rawStream.useFormatSort !== undefined ? Boolean(stream.useFormatSort) : true;
    stream.useMergeOutputFormat = rawStream.useMergeOutputFormat !== undefined ? Boolean(stream.useMergeOutputFormat) : true;
  } else if (stream.qualityMode === 'compatible') {
    stream.useFormatSort = rawStream.useFormatSort !== undefined ? Boolean(stream.useFormatSort) : false;
    stream.useMergeOutputFormat = rawStream.useMergeOutputFormat !== undefined ? Boolean(stream.useMergeOutputFormat) : false;
  } else {
    stream.useFormatSort = Boolean(stream.useFormatSort);
    stream.useMergeOutputFormat = Boolean(stream.useMergeOutputFormat);
  }

  if (rawStream.formatSort !== undefined && String(rawStream.formatSort || '').trim()) {
    stream.formatSort = String(rawStream.formatSort).trim();
  } else {
    stream.formatSort = buildDefaultFormatSort(stream.maxHeight);
  }

  stream.mergeOutputFormat = String(stream.mergeOutputFormat || 'mkv').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'mkv';
  stream.format = buildStreamFormat(stream);

  config.stream = stream;
}

function normalizeConfig(raw) {
  const rawConfig = raw && typeof raw === 'object' ? raw : {};
  const config = deepMerge(DEFAULT_CONFIG, rawConfig);

  const legacyLibraryId = toOptionalPositiveNumber(rawConfig.ersatztv && rawConfig.ersatztv.libraryId);
  const legacyPlayoutId = toOptionalPositiveNumber(rawConfig.ersatztv && rawConfig.ersatztv.playoutId);
  const legacyStreamScriptPath = rawConfig.paths && rawConfig.paths.streamScriptPath;

  config.server.port = Number(config.server.port) || DEFAULT_CONFIG.server.port;
  config.paths.baseDir = String(config.paths.baseDir || DEFAULT_CONFIG.paths.baseDir).trim();
  config.paths.ytDlpPath = String(config.paths.ytDlpPath || DEFAULT_CONFIG.paths.ytDlpPath).trim();
  config.paths.cookiesPath = String(config.paths.cookiesPath || '').trim();
  config.paths.streamScriptName = String(config.paths.streamScriptName || DEFAULT_CONFIG.paths.streamScriptName)
    .replace(/[\\/]/g, '')
    .trim() || DEFAULT_CONFIG.paths.streamScriptName;

  if (!config.paths.cookiesPath && legacyStreamScriptPath) {
    config.paths.cookiesPath = DEFAULT_CONFIG.paths.cookiesPath;
  }

  normalizeStreamConfig(config, rawConfig);

  config.ersatztv = config.ersatztv && typeof config.ersatztv === 'object' ? config.ersatztv : clone(DEFAULT_CONFIG.ersatztv);
  config.ersatztv.url = String(config.ersatztv.url || DEFAULT_CONFIG.ersatztv.url).trim().replace(/\/+$/, '');
  config.ersatztv.apiTimeoutSeconds = Math.max(1, Number(config.ersatztv.apiTimeoutSeconds) || 10);
  delete config.ersatztv.libraryId;
  delete config.ersatztv.playoutId;
  delete config.ersatztv.scanWaitSeconds;

  config.scheduler.intervalMinutes = Math.max(1, Number(config.scheduler.intervalMinutes) || 60);
  config.scheduler.enabled = Boolean(config.scheduler.enabled);
  config.scheduler.runOnStartup = Boolean(config.scheduler.runOnStartup);

  if (!Array.isArray(config.playlists)) {
    config.playlists = [];
  }

  config.playlists = config.playlists
    .map((playlist) => ({
      name: String(playlist.name || '').trim(),
      url: String(playlist.url || '').trim(),
      enabled: playlist.enabled !== false,
      libraryId: toOptionalPositiveNumber(playlist.libraryId) || legacyLibraryId,
      playoutId: toOptionalPositiveNumber(playlist.playoutId) || legacyPlayoutId,
      cookiesPath: String(playlist.cookiesPath || '').trim()
    }))
    .filter((playlist) => playlist.name && playlist.url);

  config.cleanup = config.cleanup && typeof config.cleanup === 'object' ? config.cleanup : {};
  config.cleanup.removeEmptyArtistFolders = config.cleanup.removeEmptyArtistFolders !== false;
  delete config.cleanup.removeDisabledPlaylistFolders;
  delete config.cleanup.removeMissingVideos;

  return config;
}

async function ensureConfigFile() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');
  }
}

async function loadConfig() {
  await ensureConfigFile();
  const content = await fs.readFile(CONFIG_PATH, 'utf8');
  const raw = JSON.parse(content);
  return normalizeConfig(raw);
}

async function saveConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const normalized = normalizeConfig(config);
  await fs.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

module.exports = {
  ROOT_DIR,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  DEFAULT_USER_AGENT,
  DEFAULT_STREAM_FORMAT,
  DEFAULT_HIGH_QUALITY_FORMAT,
  DEFAULT_STREAM_MAX_HEIGHT,
  buildCompatibleFormat,
  buildHighQualityFormat,
  buildDefaultFormatSort,
  buildStreamFormat,
  loadConfig,
  saveConfig,
  normalizeConfig
};
