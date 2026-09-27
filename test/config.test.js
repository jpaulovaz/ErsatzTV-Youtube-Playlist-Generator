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

  assert.equal(config.configVersion, 8);
  assert.equal(config.paths.baseDir, '/srv/media/youtube');
  assert.equal(config.paths.cookiesPath, '');
  assert.equal(config.paths.ffmpegPath, '/usr/bin/ffmpeg');
  assert.equal(config.downloads.maxHeight, 720);
  assert.equal(config.downloads.concurrentDownloads, 1);
  assert.equal(config.playlists[0].libraryId, 27);
  assert.equal(config.playlists[0].channelNumber, null);
  assert.equal(Object.hasOwn(config.playlists[0], 'playoutId'), false);
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



test('uses ErsatzTV channelNumber explicitly and never converts a legacy Playout ID into it', () => {
  const explicit = normalizeConfig({
    configVersion: 7,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: [{
      name: 'Canal ErsatzTV',
      urls: ['https://www.youtube.com/playlist?list=PLCHANNEL'],
      channelNumber: 421,
      playoutId: 999
    }]
  });

  assert.equal(explicit.playlists[0].channelNumber, 421);
  assert.equal(explicit.playlists[0].channelName, '');
  assert.equal(Object.hasOwn(explicit.playlists[0], 'playoutId'), false);

  const legacyOnly = normalizeConfig({
    configVersion: 5,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: [{
      name: 'Legado',
      urls: ['https://www.youtube.com/playlist?list=PLLEGACY'],
      playoutId: 33
    }]
  });
  assert.equal(legacyOnly.playlists[0].channelNumber, null);
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

test('media profile defaults to generic and accepts the three supported values', () => {
  const existing = normalizeConfig({
    configVersion: 4,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: [{ name: 'Generica', urls: ['https://youtu.be/aaaaaaaaaaa'] }]
  });
  assert.equal(existing.playlists[0].mediaProfile, 'generic');

  for (const mediaProfile of ['generic', 'movie', 'music_clips']) {
    const normalized = normalizeConfig({
      configVersion: 4,
      paths: { baseDir: '/srv/media/youtube' },
      playlists: [{ name: `Perfil ${mediaProfile}`, urls: ['https://youtu.be/aaaaaaaaaaa'], mediaProfile }]
    });
    assert.equal(normalized.playlists[0].mediaProfile, mediaProfile);
  }
});

test('v2.7 show metadata migrates to the music clips profile', () => {
  const migrated = normalizeConfig({
    configVersion: 3,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: [{
      name: 'Clipes',
      urls: ['https://youtu.be/aaaaaaaaaaa'],
      showMetadata: { enabled: true }
    }]
  });
  assert.equal(migrated.playlists[0].mediaProfile, 'music_clips');
});

test('legacy movie metadata migrates to the movie profile', () => {
  const migrated = normalizeConfig({
    configVersion: 2,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: [{
      name: 'Shows completos',
      urls: ['https://youtu.be/aaaaaaaaaaa'],
      movieMetadata: { enabled: true }
    }]
  });
  assert.equal(migrated.playlists[0].mediaProfile, 'movie');
});


test('preserves the ErsatzTV channel display name with the internal channel number', () => {
  const config = normalizeConfig({
    configVersion: 7,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: [{
      name: 'Clipes',
      urls: ['https://www.youtube.com/playlist?list=PLCLIPS'],
      channelNumber: 421,
      channelName: 'JohnFlix Favoritos'
    }]
  });
  assert.equal(config.playlists[0].channelNumber, 421);
  assert.equal(config.playlists[0].channelName, 'JohnFlix Favoritos');
});


test('preserves the last Smart Collection used for each Library ID', () => {
  const config = normalizeConfig({
    configVersion: 8,
    paths: { baseDir: '/srv/media/youtube' },
    ersatztv: {
      smartCollectionSelections: {
        '47': { id: 31, name: '420 - BASTILLE' },
        invalid: { id: 99, name: 'Ignorar' }
      }
    },
    playlists: []
  });
  assert.deepEqual(config.ersatztv.smartCollectionSelections, {
    '47': { id: 31, name: '420 - BASTILLE' }
  });
});
