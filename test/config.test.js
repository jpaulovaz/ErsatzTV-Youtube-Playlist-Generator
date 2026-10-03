const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, validateConfig, CONFIG_VERSION } = require('../src/config');

function library(overrides = {}) {
  return {
    name: 'Mix Principal',
    urls: ['https://www.youtube.com/playlist?list=PL123'],
    enabled: true,
    mediaProfile: 'generic',
    orphanPolicy: 'mark',
    quarantineRetentionDays: null,
    ...overrides
  };
}

function currentConfig(overrides = {}) {
  return {
    configVersion: CONFIG_VERSION,
    server: { host: '127.0.0.1', port: 4000 },
    paths: {
      baseDir: '/srv/media/youtube',
      channelsBaseDir: '/srv/media/youtube-channels',
      ytDlpPath: '/usr/local/bin/yt-dlp',
      ffmpegPath: '/usr/bin/ffmpeg',
      ffprobePath: '/usr/bin/ffprobe',
      cookiesPath: ''
    },
    downloads: {
      maxHeight: 720,
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
    youtubeApi: { enabled: false, apiKey: '', readMode: 'api', cacheTtlHours: 168, timeoutSeconds: 20 },
    ersatztv: { url: 'http://localhost:8409', apiKey: '', apiTimeoutSeconds: 10, smartCollectionSelections: {} },
    playlists: [library()],
    channels: [],
    scheduler: { enabled: false, intervalMinutes: 60, runOnStartup: false },
    channelScheduler: { enabled: false, intervalMinutes: 360, runOnStartup: false },
    cleanup: { removeEmptyArtistFolders: true },
    ...overrides
  };
}

test('normalizes the current v9 configuration without legacy fallbacks', () => {
  const config = normalizeConfig(currentConfig({
    paths: {
      ...currentConfig().paths,
      cookiesPath: '/srv/secrets/cookies.txt'
    },
    playlists: [library({ libraryId: 27, channelNumber: 421, channelName: 'JohnFlix', mediaProfile: 'music_clips' })]
  }));

  assert.equal(config.configVersion, 9);
  assert.equal(config.paths.cookiesPath, '/srv/secrets/cookies.txt');
  assert.equal(config.downloads.maxHeight, 720);
  assert.equal(config.downloads.concurrentDownloads, 1);
  assert.equal(config.playlists[0].libraryId, 27);
  assert.equal(config.playlists[0].channelNumber, 421);
  assert.equal(config.playlists[0].channelName, 'JohnFlix');
  assert.equal(config.playlists[0].mediaProfile, 'music_clips');
  assert.equal(config.playlists[0].orphanPolicy, 'mark');
  assert.equal(Object.hasOwn(config.downloads, 'updateExistingThumbnails'), false);
  assert.equal(Object.hasOwn(config.playlists[0], 'showMetadata'), false);
  assert.equal(Object.hasOwn(config.playlists[0], 'movieMetadata'), false);
});

test('legacy-only fields no longer influence current configuration', () => {
  const raw = currentConfig({
    stream: { maxHeight: 360, jsRuntimeMode: 'node' },
    youtubeApi: { updateExistingThumbnails: true },
    ersatztv: { libraryId: 99, channelNumber: 999 },
    playlists: [library({
      libraryId: null,
      channelNumber: null,
      showMetadata: { enabled: true },
      movieMetadata: { enabled: true }
    })]
  });
  delete raw.downloads.maxHeight;
  const config = normalizeConfig(raw);
  assert.equal(config.downloads.maxHeight, 1080);
  assert.equal(config.playlists[0].libraryId, null);
  assert.equal(config.playlists[0].channelNumber, null);
  assert.equal(config.playlists[0].mediaProfile, 'generic');
  assert.equal(Object.hasOwn(config.downloads, 'updateExistingThumbnails'), false);
});

test('rejects unsafe base paths and duplicate library folders', () => {
  const unsafe = normalizeConfig(currentConfig({ paths: { ...currentConfig().paths, baseDir: '/' }, playlists: [] }));
  assert.throws(() => validateConfig(unsafe), /ampla demais/);

  const duplicate = normalizeConfig(currentConfig({
    playlists: [
      library({ name: 'Mix/Teste', urls: ['https://youtu.be/aaaaaaaaaaa'] }),
      library({ name: 'MixTeste', urls: ['https://youtu.be/bbbbbbbbbbb'] })
    ]
  }));
  assert.throws(() => validateConfig(duplicate), /mesma pasta/);
});

test('media profile defaults to generic and accepts the three supported values', () => {
  const existing = normalizeConfig(currentConfig({ playlists: [library({ mediaProfile: undefined })] }));
  assert.equal(existing.playlists[0].mediaProfile, 'generic');

  for (const mediaProfile of ['generic', 'movie', 'music_clips']) {
    const normalized = normalizeConfig(currentConfig({ playlists: [library({ name: `Perfil ${mediaProfile}`, mediaProfile })] }));
    assert.equal(normalized.playlists[0].mediaProfile, mediaProfile);
  }
});

test('preserves the ErsatzTV API key and last Smart Collection per Library ID', () => {
  const config = normalizeConfig(currentConfig({
    ersatztv: {
      url: 'http://localhost:8409',
      apiKey: 'etv-test-key',
      apiTimeoutSeconds: 12,
      smartCollectionSelections: {
        '47': { id: 31, name: '420 - BASTILLE' },
        invalid: { id: 99, name: 'Ignorar' }
      }
    },
    playlists: []
  }));

  assert.equal(config.ersatztv.apiKey, 'etv-test-key');
  assert.equal(config.ersatztv.apiTimeoutSeconds, 12);
  assert.deepEqual(config.ersatztv.smartCollectionSelections, {
    '47': { id: 31, name: '420 - BASTILLE' }
  });
});

test('v9 requires an explicit orphan policy for newly saved libraries', () => {
  const missing = normalizeConfig(currentConfig({
    playlists: [{ name: 'Nova', urls: ['https://www.youtube.com/playlist?list=PLNEW'], mediaProfile: 'generic' }]
  }));
  assert.throws(() => validateConfig(missing), /arquivos orfaos/);

  const configured = normalizeConfig(currentConfig({
    playlists: [library({ name: 'Nova', urls: ['https://www.youtube.com/playlist?list=PLNEW'], orphanPolicy: 'quarantine', quarantineRetentionDays: 90 })]
  }));
  assert.doesNotThrow(() => validateConfig(configured));
  assert.equal(configured.playlists[0].quarantineRetentionDays, 90);
});
