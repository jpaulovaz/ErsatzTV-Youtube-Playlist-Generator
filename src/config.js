const fs = require('fs/promises');
const path = require('path');
const { sanitizeName, isDangerousBaseDir } = require('./utils');
const { DEFAULT_SUBTITLE_LANGUAGES, normalizeSubtitleLanguages } = require('./subtitleService');
const { MEDIA_PROFILES, normalizeMediaProfile } = require('./mediaProfileService');
const { normalizeChannels, validateChannels } = require('./channelConfig');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const CONFIG_VERSION = 6;

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_MAX_HEIGHT = 1080;
const ALLOWED_MAX_HEIGHTS = new Set([360, 480, 720, 1080, 1440, 2160]);
const JS_RUNTIME_MODES = new Set(['disabled', 'deno', 'node', 'custom']);
const EJS_COMPONENT_OPTIONS = new Set(['none', 'ejs:github', 'ejs:npm']);
const YOUTUBE_API_READ_MODES = new Set(['api', 'ytdlp']);

const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  server: {
    host: '0.0.0.0',
    port: 3099
  },
  paths: {
    baseDir: '/srv/media/youtube',
    channelsBaseDir: '/srv/media/youtube-channels',
    ytDlpPath: '/usr/local/bin/yt-dlp',
    ffmpegPath: '/usr/bin/ffmpeg',
    ffprobePath: '/usr/bin/ffprobe',
    cookiesPath: ''
  },
  downloads: {
    maxHeight: DEFAULT_MAX_HEIGHT,
    container: 'mp4',
    codecProfile: 'mp4_h264_aac',
    concurrentDownloads: 1,
    userAgent: DEFAULT_USER_AGENT,
    jsRuntimeMode: 'deno',
    jsRuntimePath: '/usr/local/bin/deno',
    jsRuntimeCustomName: 'deno',
    ejsComponents: 'ejs:github',
    writeThumbnails: true,
    updateExistingThumbnails: false,
    pauseOnLowDisk: true,
    minFreeSpaceGb: 20,
    scanOnQueueIdle: true,
    idleActionDelaySeconds: 15,
    retryDelaysMinutes: [1, 5, 15]
  },
  youtubeApi: {
    enabled: false,
    apiKey: '',
    readMode: 'api',
    cacheTtlHours: 168,
    timeoutSeconds: 20
  },
  ersatztv: {
    url: 'http://localhost:8409',
    apiKey: '',
    apiTimeoutSeconds: 10
  },
  playlists: [],
  scheduler: {
    enabled: false,
    intervalMinutes: 360,
    runOnStartup: false
  },
  channelScheduler: {
    enabled: false,
    intervalMinutes: 360,
    runOnStartup: false
  },
  channels: [],
  cleanup: {
    removeEmptyArtistFolders: true
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function toOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function normalizeMaxHeight(value, fallback = DEFAULT_MAX_HEIGHT) {
  const height = toPositiveInteger(value, fallback);
  return ALLOWED_MAX_HEIGHTS.has(height) ? height : fallback;
}

function normalizeOptionalMaxHeight(value) {
  const height = toOptionalPositiveInteger(value);
  if (height === null) return null;
  return ALLOWED_MAX_HEIGHTS.has(height) ? height : null;
}

function sanitizeJsRuntimeName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '') || 'deno';
}

function normalizeJsRuntimeMode(value) {
  const mode = String(value || '').trim();
  return JS_RUNTIME_MODES.has(mode) ? mode : DEFAULT_CONFIG.downloads.jsRuntimeMode;
}

function normalizeEjsComponents(value, runtimeMode) {
  if (runtimeMode === 'disabled') return 'none';
  const components = String(value || '').trim();
  return EJS_COMPONENT_OPTIONS.has(components) ? components : DEFAULT_CONFIG.downloads.ejsComponents;
}

function defaultJsRuntimePath(mode) {
  if (mode === 'deno') return '/usr/local/bin/deno';
  if (mode === 'node') return '/usr/bin/node';
  return '';
}

function normalizePlaylistUrls(playlist) {
  const values = [];
  if (playlist && typeof playlist.url === 'string') values.push(playlist.url);
  if (playlist && Array.isArray(playlist.urls)) values.push(...playlist.urls);

  const seen = new Set();
  const urls = [];
  for (const value of values) {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function normalizeRetryDelays(value) {
  const input = Array.isArray(value) ? value : DEFAULT_CONFIG.downloads.retryDelaysMinutes;
  const result = input
    .map((item) => toPositiveInteger(item, 0))
    .filter((item) => item > 0)
    .slice(0, 10);
  return result.length > 0 ? result : clone(DEFAULT_CONFIG.downloads.retryDelaysMinutes);
}

function buildDownloadsConfig(rawConfig) {
  const rawDownloads = rawConfig.downloads && typeof rawConfig.downloads === 'object'
    ? rawConfig.downloads
    : {};
  const legacyStream = rawConfig.stream && typeof rawConfig.stream === 'object'
    ? rawConfig.stream
    : {};

  const maxHeightSource = hasOwn(rawDownloads, 'maxHeight')
    ? rawDownloads.maxHeight
    : (hasOwn(legacyStream, 'maxHeight') ? legacyStream.maxHeight : DEFAULT_CONFIG.downloads.maxHeight);

  const runtimeModeSource = hasOwn(rawDownloads, 'jsRuntimeMode')
    ? rawDownloads.jsRuntimeMode
    : legacyStream.jsRuntimeMode;
  const runtimeMode = normalizeJsRuntimeMode(runtimeModeSource);

  const runtimePathSource = hasOwn(rawDownloads, 'jsRuntimePath')
    ? rawDownloads.jsRuntimePath
    : legacyStream.jsRuntimePath;

  const ejsSource = hasOwn(rawDownloads, 'ejsComponents')
    ? rawDownloads.ejsComponents
    : legacyStream.ejsComponents;

  const userAgentSource = hasOwn(rawDownloads, 'userAgent')
    ? rawDownloads.userAgent
    : legacyStream.userAgent;

  return {
    maxHeight: normalizeMaxHeight(maxHeightSource),
    container: 'mp4',
    codecProfile: 'mp4_h264_aac',
    concurrentDownloads: 1,
    userAgent: String(userAgentSource || DEFAULT_CONFIG.downloads.userAgent).trim() || DEFAULT_CONFIG.downloads.userAgent,
    jsRuntimeMode: runtimeMode,
    jsRuntimePath: String(runtimePathSource !== undefined ? runtimePathSource : defaultJsRuntimePath(runtimeMode)).trim(),
    jsRuntimeCustomName: sanitizeJsRuntimeName(
      hasOwn(rawDownloads, 'jsRuntimeCustomName')
        ? rawDownloads.jsRuntimeCustomName
        : legacyStream.jsRuntimeCustomName
    ),
    ejsComponents: normalizeEjsComponents(ejsSource, runtimeMode),
    writeThumbnails: rawDownloads.writeThumbnails !== false,
    updateExistingThumbnails: Boolean(
      hasOwn(rawDownloads, 'updateExistingThumbnails')
        ? rawDownloads.updateExistingThumbnails
        : (rawConfig.youtubeApi && rawConfig.youtubeApi.updateExistingThumbnails)
    ),
    pauseOnLowDisk: rawDownloads.pauseOnLowDisk !== false,
    minFreeSpaceGb: Math.max(1, Number(rawDownloads.minFreeSpaceGb) || DEFAULT_CONFIG.downloads.minFreeSpaceGb),
    scanOnQueueIdle: rawDownloads.scanOnQueueIdle !== false,
    idleActionDelaySeconds: Math.max(3, Number(rawDownloads.idleActionDelaySeconds) || DEFAULT_CONFIG.downloads.idleActionDelaySeconds),
    retryDelaysMinutes: normalizeRetryDelays(rawDownloads.retryDelaysMinutes)
  };
}

function normalizePlaylistSubtitles(playlist) {
  const raw = playlist && playlist.subtitles && typeof playlist.subtitles === 'object'
    ? playlist.subtitles
    : {};
  const languagesConfigured = hasOwn(raw, 'languages');
  const languages = normalizeSubtitleLanguages(raw.languages);
  return {
    enabled: Boolean(raw.enabled),
    includeAuto: raw.includeAuto !== false,
    languages: languagesConfigured ? languages : [...DEFAULT_SUBTITLE_LANGUAGES]
  };
}

function normalizePlaylistMediaProfile(playlist) {
  if (playlist && playlist.mediaProfile) return normalizeMediaProfile(playlist.mediaProfile);

  // Compatibilidade de transicao apenas para a configuracao imediatamente anterior.
  if (playlist && playlist.showMetadata && playlist.showMetadata.enabled) return MEDIA_PROFILES.MUSIC_CLIPS;
  if (playlist && playlist.movieMetadata && playlist.movieMetadata.enabled) return MEDIA_PROFILES.MOVIE;
  return MEDIA_PROFILES.GENERIC;
}

function normalizeConfig(raw) {
  const rawConfig = raw && typeof raw === 'object' ? raw : {};
  const rawServer = rawConfig.server && typeof rawConfig.server === 'object' ? rawConfig.server : {};
  const rawPaths = rawConfig.paths && typeof rawConfig.paths === 'object' ? rawConfig.paths : {};
  const rawApi = rawConfig.youtubeApi && typeof rawConfig.youtubeApi === 'object' ? rawConfig.youtubeApi : {};
  const rawErsatz = rawConfig.ersatztv && typeof rawConfig.ersatztv === 'object' ? rawConfig.ersatztv : {};
  const rawScheduler = rawConfig.scheduler && typeof rawConfig.scheduler === 'object' ? rawConfig.scheduler : {};
  const rawChannelScheduler = rawConfig.channelScheduler && typeof rawConfig.channelScheduler === 'object' ? rawConfig.channelScheduler : {};
  const rawCleanup = rawConfig.cleanup && typeof rawConfig.cleanup === 'object' ? rawConfig.cleanup : {};

  const legacyLibraryId = toOptionalPositiveInteger(rawErsatz.libraryId);
  const legacyChannelNumber = toOptionalPositiveInteger(rawErsatz.channelNumber);
  const normalizedBaseDir = String(rawPaths.baseDir || DEFAULT_CONFIG.paths.baseDir).trim() || DEFAULT_CONFIG.paths.baseDir;
  const defaultChannelsBaseDir = path.join(path.dirname(normalizedBaseDir), 'youtube-channels');

  const config = {
    configVersion: CONFIG_VERSION,
    server: {
      host: String(rawServer.host || DEFAULT_CONFIG.server.host).trim() || DEFAULT_CONFIG.server.host,
      port: Math.min(65535, toPositiveInteger(rawServer.port, DEFAULT_CONFIG.server.port))
    },
    paths: {
      baseDir: normalizedBaseDir,
      channelsBaseDir: String(rawPaths.channelsBaseDir || defaultChannelsBaseDir).trim() || defaultChannelsBaseDir,
      ytDlpPath: String(rawPaths.ytDlpPath || DEFAULT_CONFIG.paths.ytDlpPath).trim() || DEFAULT_CONFIG.paths.ytDlpPath,
      ffmpegPath: String(rawPaths.ffmpegPath || DEFAULT_CONFIG.paths.ffmpegPath).trim() || DEFAULT_CONFIG.paths.ffmpegPath,
      ffprobePath: String(rawPaths.ffprobePath || DEFAULT_CONFIG.paths.ffprobePath).trim() || DEFAULT_CONFIG.paths.ffprobePath,
      // Cookies only remain enabled when explicitly configured. A legacy streamScriptPath never enables them.
      cookiesPath: hasOwn(rawPaths, 'cookiesPath') ? String(rawPaths.cookiesPath || '').trim() : ''
    },
    downloads: buildDownloadsConfig(rawConfig),
    youtubeApi: {
      enabled: Boolean(rawApi.enabled),
      apiKey: String(rawApi.apiKey || '').trim(),
      readMode: YOUTUBE_API_READ_MODES.has(String(rawApi.readMode || '').trim())
        ? String(rawApi.readMode).trim()
        : DEFAULT_CONFIG.youtubeApi.readMode,
      cacheTtlHours: Math.max(1, Number(rawApi.cacheTtlHours) || DEFAULT_CONFIG.youtubeApi.cacheTtlHours),
      timeoutSeconds: Math.max(5, Number(rawApi.timeoutSeconds) || DEFAULT_CONFIG.youtubeApi.timeoutSeconds)
    },
    ersatztv: {
      url: String(rawErsatz.url || DEFAULT_CONFIG.ersatztv.url).trim().replace(/\/+$/, '') || DEFAULT_CONFIG.ersatztv.url,
      apiKey: String(rawErsatz.apiKey || '').trim(),
      apiTimeoutSeconds: Math.max(1, Number(rawErsatz.apiTimeoutSeconds) || DEFAULT_CONFIG.ersatztv.apiTimeoutSeconds)
    },
    playlists: [],
    channels: normalizeChannels(rawConfig.channels, ALLOWED_MAX_HEIGHTS),
    scheduler: {
      enabled: Boolean(rawScheduler.enabled),
      intervalMinutes: Math.max(1, Number(rawScheduler.intervalMinutes) || DEFAULT_CONFIG.scheduler.intervalMinutes),
      runOnStartup: Boolean(rawScheduler.runOnStartup)
    },
    channelScheduler: {
      enabled: Boolean(rawChannelScheduler.enabled),
      intervalMinutes: Math.max(1, Number(rawChannelScheduler.intervalMinutes) || DEFAULT_CONFIG.channelScheduler.intervalMinutes),
      runOnStartup: Boolean(rawChannelScheduler.runOnStartup)
    },
    cleanup: {
      removeEmptyArtistFolders: rawCleanup.removeEmptyArtistFolders !== false
    }
  };

  const rawPlaylists = Array.isArray(rawConfig.playlists) ? rawConfig.playlists : [];
  config.playlists = rawPlaylists
    .map((playlist) => {
      const urls = normalizePlaylistUrls(playlist);
      return {
        name: String(playlist && playlist.name || '').trim(),
        url: urls[0] || '',
        urls,
        enabled: !playlist || playlist.enabled !== false,
        libraryId: toOptionalPositiveInteger(playlist && playlist.libraryId) || legacyLibraryId,
        channelNumber: toOptionalPositiveInteger(playlist && playlist.channelNumber) || legacyChannelNumber,
        cookiesPath: String(playlist && playlist.cookiesPath || '').trim(),
        maxHeight: normalizeOptionalMaxHeight(playlist && playlist.maxHeight),
        subtitles: normalizePlaylistSubtitles(playlist),
        mediaProfile: normalizePlaylistMediaProfile(playlist)
      };
    })
    .filter((playlist) => playlist.name && playlist.urls.length > 0);

  // Empty library lists are valid. Version upgrades must never create a sample library.
  if (!Array.isArray(rawConfig.playlists) && Number(rawConfig.configVersion || 0) <= 1) {
    config.playlists = clone(DEFAULT_CONFIG.playlists);
  }

  return config;
}


function validateConfig(config) {
  if (!path.isAbsolute(config.paths.baseDir)) {
    throw new Error('A pasta base das bibliotecas precisa ser um caminho absoluto.');
  }
  if (isDangerousBaseDir(config.paths.baseDir)) {
    throw new Error('A pasta base informada e ampla demais. Use uma subpasta exclusiva para as bibliotecas.');
  }

  const requiredTools = [
    ['yt-dlp', config.paths.ytDlpPath],
    ['ffmpeg', config.paths.ffmpegPath],
    ['ffprobe', config.paths.ffprobePath]
  ];
  for (const [label, value] of requiredTools) {
    if (!String(value || '').trim()) throw new Error(`O caminho do ${label} nao pode ficar vazio.`);
  }

  const seenFolders = new Map();
  for (const playlist of config.playlists || []) {
    const folder = sanitizeName(playlist.name).toLowerCase();
    if (!folder) throw new Error('Toda biblioteca precisa ter um nome valido.');
    if (seenFolders.has(folder)) {
      throw new Error(`As bibliotecas "${seenFolders.get(folder)}" e "${playlist.name}" geram a mesma pasta. Use nomes diferentes.`);
    }
    seenFolders.set(folder, playlist.name);
    if (playlist.subtitles && playlist.subtitles.enabled && (!Array.isArray(playlist.subtitles.languages) || playlist.subtitles.languages.length === 0)) {
      throw new Error(`A biblioteca "${playlist.name}" esta com legendas ativas, mas nenhum idioma foi selecionado.`);
    }
  }

  validateChannels(config);
  return config;
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(tempPath, filePath);
}

async function ensureConfigFile() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await atomicWriteJson(CONFIG_PATH, DEFAULT_CONFIG);
  }
}

async function migrateConfigFile(raw, normalized) {
  const sourceVersion = Number(raw && raw.configVersion) || 1;
  const backupPath = path.join(CONFIG_DIR, `config.v${sourceVersion}.backup-${timestampForFilename()}.json`);
  await fs.writeFile(backupPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  await atomicWriteJson(CONFIG_PATH, normalized);
  return backupPath;
}

async function loadConfig() {
  await ensureConfigFile();
  const content = await fs.readFile(CONFIG_PATH, 'utf8');
  const raw = JSON.parse(content);
  const normalized = validateConfig(normalizeConfig(raw));

  if (Number(raw.configVersion) !== CONFIG_VERSION) {
    await migrateConfigFile(raw, normalized);
  }

  return normalized;
}

async function saveConfig(config) {
  const normalized = validateConfig(normalizeConfig({ ...config, configVersion: CONFIG_VERSION }));
  await atomicWriteJson(CONFIG_PATH, normalized);
  return normalized;
}

module.exports = {
  ROOT_DIR,
  CONFIG_PATH,
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  DEFAULT_USER_AGENT,
  DEFAULT_MAX_HEIGHT,
  ALLOWED_MAX_HEIGHTS,
  JS_RUNTIME_MODES,
  EJS_COMPONENT_OPTIONS,
  YOUTUBE_API_READ_MODES,
  normalizeMaxHeight,
  normalizeConfig,
  validateConfig,
  loadConfig,
  saveConfig
};
