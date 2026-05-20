const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  server: {
    host: '0.0.0.0',
    port: 3099
  },
  paths: {
    baseDir: '/home/joaopaulovaz/comerciais/videclipes/youtube/youtube',
    streamScriptPath: '/home/joaopaulovaz/comerciais/videclipes/youtube/stream-yt.sh',
    ytDlpPath: '/usr/local/bin/yt-dlp'
  },
  ersatztv: {
    url: 'http://localhost:8409',
    libraryId: 27,
    playoutId: 33,
    apiTimeoutSeconds: 10,
    scanWaitSeconds: 30
  },
  playlists: [
    {
      name: 'Mix_Principal',
      url: 'https://www.youtube.com/watch?v=u2ah9tWTkmk&list=PLHg022HMFzFCRq-5ZVR3hiiCkGPJ3Ur1D',
      enabled: true
    }
  ],
  scheduler: {
    enabled: false,
    intervalMinutes: 60,
    runOnStartup: false
  },
  cleanup: {
    removeDisabledPlaylistFolders: true,
    removeMissingVideos: true,
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

function normalizeConfig(raw) {
  const config = deepMerge(DEFAULT_CONFIG, raw || {});

  config.server.port = Number(config.server.port) || DEFAULT_CONFIG.server.port;
  config.ersatztv.libraryId = Number(config.ersatztv.libraryId) || DEFAULT_CONFIG.ersatztv.libraryId;
  config.ersatztv.playoutId = Number(config.ersatztv.playoutId) || DEFAULT_CONFIG.ersatztv.playoutId;
  config.ersatztv.apiTimeoutSeconds = Math.max(1, Number(config.ersatztv.apiTimeoutSeconds) || 10);
  config.ersatztv.scanWaitSeconds = Math.max(0, Number(config.ersatztv.scanWaitSeconds) || 0);
  config.scheduler.intervalMinutes = Math.max(1, Number(config.scheduler.intervalMinutes) || 60);

  if (!Array.isArray(config.playlists)) {
    config.playlists = [];
  }

  config.playlists = config.playlists
    .map((playlist) => ({
      name: String(playlist.name || '').trim(),
      url: String(playlist.url || '').trim(),
      enabled: playlist.enabled !== false
    }))
    .filter((playlist) => playlist.name && playlist.url);

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
  loadConfig,
  saveConfig,
  normalizeConfig
};
