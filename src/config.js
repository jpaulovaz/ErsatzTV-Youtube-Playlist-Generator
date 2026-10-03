const fs = require('fs/promises');
const path = require('path');
const { sanitizeName, isDangerousBaseDir } = require('./utils');
const { DEFAULT_SUBTITLE_LANGUAGES, normalizeSubtitleLanguages } = require('./subtitleService');
const { MEDIA_PROFILES, normalizeMediaProfile } = require('./mediaProfileService');
const { normalizeChannels, validateChannels } = require('./channelConfig');
const { normalizeOrphanPolicy, normalizeRetentionDays, ORPHAN_POLICIES } = require('./orphans/orphanPolicy');
const { sanitizeJsRuntimeName } = require('./ytDlpUtils');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_DIR = process.env.ERSATZTV_CONFIG_DIR
  ? path.resolve(process.env.ERSATZTV_CONFIG_DIR)
  : path.join(ROOT_DIR, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const CONFIG_VERSION = 9;

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
    apiTimeoutSeconds: 10,
    smartCollectionSelections: {}
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

function normalizeSmartCollectionSelections(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [libraryKey, selection] of Object.entries(raw).slice(0, 500)) {
    const libraryId = toOptionalPositiveInteger(libraryKey);
    if (!libraryId || !selection || typeof selection !== 'object') continue;
    const name = String(selection.name || '').trim();
    if (!name) continue;
    result[String(libraryId)] = {
      id: toOptionalPositiveInteger(selection.id),
      name
    };
  }
  return result;
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
  const runtimeMode = normalizeJsRuntimeMode(rawDownloads.jsRuntimeMode);

  return {
    maxHeight: normalizeMaxHeight(rawDownloads.maxHeight),
    container: 'mp4',
    codecProfile: 'mp4_h264_aac',
    concurrentDownloads: 1,
    userAgent: String(rawDownloads.userAgent || DEFAULT_CONFIG.downloads.userAgent).trim() || DEFAULT_CONFIG.downloads.userAgent,
    jsRuntimeMode: runtimeMode,
    jsRuntimePath: String(hasOwn(rawDownloads, 'jsRuntimePath') ? rawDownloads.jsRuntimePath : defaultJsRuntimePath(runtimeMode)).trim(),
    jsRuntimeCustomName: sanitizeJsRuntimeName(rawDownloads.jsRuntimeCustomName) || 'deno',
    ejsComponents: normalizeEjsComponents(rawDownloads.ejsComponents, runtimeMode),
    writeThumbnails: rawDownloads.writeThumbnails !== false,
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
  return normalizeMediaProfile(playlist && playlist.mediaProfile || MEDIA_PROFILES.GENERIC);
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
      cookiesPath: String(rawPaths.cookiesPath || '').trim()
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
      apiTimeoutSeconds: Math.max(1, Number(rawErsatz.apiTimeoutSeconds) || DEFAULT_CONFIG.ersatztv.apiTimeoutSeconds),
      smartCollectionSelections: normalizeSmartCollectionSelections(rawErsatz.smartCollectionSelections)
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
        libraryId: toOptionalPositiveInteger(playlist && playlist.libraryId),
        channelNumber: toOptionalPositiveInteger(playlist && playlist.channelNumber),
        channelName: String(playlist && playlist.channelName || '').trim(),
        cookiesPath: String(playlist && playlist.cookiesPath || '').trim(),
        maxHeight: normalizeOptionalMaxHeight(playlist && playlist.maxHeight),
        subtitles: normalizePlaylistSubtitles(playlist),
        mediaProfile: normalizePlaylistMediaProfile(playlist),
        orphanPolicy: normalizeOrphanPolicy(playlist && playlist.orphanPolicy, null),
        quarantineRetentionDays: normalizeRetentionDays(playlist && playlist.quarantineRetentionDays, null)
      };
    })
    .filter((playlist) => playlist.name && playlist.urls.length > 0);

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
    if (!normalizeOrphanPolicy(playlist.orphanPolicy, null)) {
      throw new Error(`Selecione como tratar arquivos orfaos na biblioteca "${playlist.name}".`);
    }
    if (playlist.orphanPolicy === ORPHAN_POLICIES.QUARANTINE && playlist.quarantineRetentionDays !== null && ![30, 90, 180].includes(Number(playlist.quarantineRetentionDays))) {
      throw new Error(`Retencao de quarentena invalida na biblioteca "${playlist.name}".`);
    }
  }

  validateChannels(config);
  return config;
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function ensureConfigFile() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await atomicWriteJson(CONFIG_PATH, DEFAULT_CONFIG);
  }
}

async function loadConfig() {
  await ensureConfigFile();
  const content = await fs.readFile(CONFIG_PATH, 'utf8');
  const raw = JSON.parse(content);
  if (Number(raw.configVersion) !== CONFIG_VERSION) {
    throw new Error(`config.json usa configVersion ${raw.configVersion ?? 'ausente'}. A v3.5.3 aceita somente configVersion ${CONFIG_VERSION}; conclua a migracao na v3.5.2 antes de atualizar.`);
  }
  return validateConfig(normalizeConfig(raw));
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
