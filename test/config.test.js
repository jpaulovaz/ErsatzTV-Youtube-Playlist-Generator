const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, validateConfig } = require('../src/config');

test('migrates useful v1 settings without enabling legacy cookies', () => {
  const config = normalizeConfig({
    server: { host: '127.0.0.1', port: 4000 },
    paths: {
      baseDir: '/srv/media/youtube',
      streamScriptPath: '/srv/old/stream-yt.sh',
      ytDlpPath: '/usr/local/bin/yt-dlp'
    },
    stream: {
      maxHeight: 720,
      jsRuntimeMode: 'deno',
      jsRuntimePath: '/usr/local/bin/deno'
    },
    ersatztv: {
      url: 'http://localhost:8409',
      libraryId: 27,
      playoutId: 33
    },
    playlists: [
      {
        name: 'Mix Principal',
        url: 'https://www.youtube.com/playlist?list=PL123',
        enabled: true
      }
    ],
    scheduler: { enabled: false, intervalMinutes: 60 }
  });

  assert.equal(config.configVersion, 2);
  assert.equal(config.paths.baseDir, '/srv/media/youtube');
  assert.equal(config.paths.cookiesPath, '');
  assert.equal(config.paths.ffmpegPath, '/usr/bin/ffmpeg');
  assert.equal(config.downloads.maxHeight, 720);
  assert.equal(config.downloads.concurrentDownloads, 1);
  assert.equal(config.playlists[0].libraryId, 27);
  assert.equal(config.playlists[0].playoutId, 33);
  assert.equal(config.scheduler.intervalMinutes, 60);
  assert.equal(config.ersatztv.apiKey, '');
});

test('preserves explicitly configured cookies', () => {
  const config = normalizeConfig({
    configVersion: 2,
    paths: {
      baseDir: '/srv/media/youtube',
      cookiesPath: '/srv/secrets/cookies.txt'
    },
    playlists: []
  });
  assert.equal(config.paths.cookiesPath, '/srv/secrets/cookies.txt');
});

test('rejects unsafe base paths and duplicate library folders', () => {
  const unsafe = normalizeConfig({ configVersion: 2, paths: { baseDir: '/' }, playlists: [] });
  assert.throws(() => validateConfig(unsafe), /ampla demais/);

  const duplicate = normalizeConfig({
    configVersion: 2,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: [
      { name: 'Mix/Teste', urls: ['https://youtu.be/aaaaaaaaaaa'] },
      { name: 'MixTeste', urls: ['https://youtu.be/bbbbbbbbbbb'] }
    ]
  });
  assert.throws(() => validateConfig(duplicate), /mesma pasta/);
});


test('preserves the ErsatzTV API Key when explicitly configured', () => {
  const config = normalizeConfig({
    configVersion: 2,
    paths: { baseDir: '/srv/media/youtube' },
    ersatztv: {
      url: 'http://localhost:8409',
      apiKey: 'etv-test-key',
      apiTimeoutSeconds: 12
    },
    playlists: []
  });

  assert.equal(config.ersatztv.apiKey, 'etv-test-key');
  assert.equal(config.ersatztv.apiTimeoutSeconds, 12);
});
