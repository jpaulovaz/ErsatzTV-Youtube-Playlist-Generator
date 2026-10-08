const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { normalizeConfig, validateConfig } = require('../src/config');
const {
  DEFAULT_SUBTITLE_LANGUAGES,
  buildSubtitleDiscoveryArgs,
  buildSubtitleCandidateDownloadArgs,
  selectYoutubeSubtitleCandidates,
  getSubtitleSidecarPath,
  listSubtitleSidecars,
  finalizeStagedSubtitles
} = require('../src/subtitleService');
const { DownloadManager, makeItemId } = require('../src/downloadManager');

function makeConfig(baseDir, extraPlaylist = {}) {
  return normalizeConfig({
    configVersion: 9,
    paths: {
      baseDir,
      ytDlpPath: '/usr/local/bin/yt-dlp',
      ffmpegPath: '/usr/bin/ffmpeg',
      ffprobePath: '/usr/bin/ffprobe',
      cookiesPath: ''
    },
    downloads: {
      maxHeight: 1080,
      jsRuntimeMode: 'disabled',
      ejsComponents: 'none',
      writeThumbnails: false,
      pauseOnLowDisk: false,
      scanOnQueueIdle: false,
      retryDelaysMinutes: [1]
    },
    ersatztv: {
      url: 'http://127.0.0.1:8409',
      apiKey: 'test-key',
      apiTimeoutSeconds: 2
    },
    playlists: [{
      name: 'Teste',
      urls: ['https://www.youtube.com/playlist?list=PLTESTE'],
      enabled: true,
      libraryId: 17,
      channelNumber: null,
      cookiesPath: '',
      maxHeight: null,
      orphanPolicy: 'mark',
      quarantineRetentionDays: null,
      ...extraPlaylist
    }],
    scheduler: { enabled: false }
  });
}

test('existing libraries keep subtitles disabled and receive the four default language options', () => {
  const config = makeConfig('/tmp/ersatztv-subtitle-config');
  assert.equal(config.playlists[0].subtitles.enabled, false);
  assert.equal(config.playlists[0].subtitles.includeAuto, true);
  assert.deepEqual(config.playlists[0].subtitles.languages, DEFAULT_SUBTITLE_LANGUAGES);
});

test('subtitle settings preserve multiple selected languages and reject an enabled empty selection', () => {
  const config = makeConfig('/tmp/ersatztv-subtitle-config-2', {
    subtitles: {
      enabled: true,
      includeAuto: true,
      languages: ['pt-BR', 'en', 'es']
    }
  });
  assert.deepEqual(config.playlists[0].subtitles.languages, ['pt-BR', 'en', 'es']);

  const invalid = normalizeConfig({
    configVersion: 9,
    paths: { baseDir: '/tmp/ersatztv-subtitle-config-3' },
    playlists: [{
      name: 'Teste',
      urls: ['https://youtu.be/abcdefghijk'],
      subtitles: { enabled: true, includeAuto: true, languages: [] },
      orphanPolicy: 'mark',
      quarantineRetentionDays: null
    }]
  });
  assert.throws(() => validateConfig(invalid), /nenhum idioma/);
});

test('automatic subtitle flow discovers real YouTube tags and prefers manual tracks', () => {
  const info = {
    subtitles: {
      'en-eEY6OEpapPo': [{ ext: 'vtt', name: 'English - English' }],
      'es-419': [{ ext: 'vtt', name: 'Español (Latinoamérica)' }]
    },
    automatic_captions: {
      en: [{ ext: 'vtt', name: 'English' }],
      es: [{ ext: 'vtt', name: 'Español' }]
    }
  };
  const selected = selectYoutubeSubtitleCandidates(info, ['en', 'es'], true);
  assert.deepEqual(selected.map((item) => [item.targetLanguage, item.sourceLanguage, item.sourceType]), [
    ['en', 'en-eEY6OEpapPo', 'manual'],
    ['es', 'es-419', 'manual']
  ]);
});

test('yt-dlp subtitle flow uses metadata discovery then exact selected language tag', () => {
  const config = makeConfig('/tmp/ersatztv-subtitle-args', {
    cookiesPath: '/tmp/library-cookies.txt',
    subtitles: { enabled: true, includeAuto: true, languages: ['en'] }
  });
  const playlist = config.playlists[0];
  const item = { videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  const discoveryArgs = buildSubtitleDiscoveryArgs(config, playlist, item);
  assert.ok(discoveryArgs.includes('--dump-single-json'));
  assert.equal(discoveryArgs[discoveryArgs.indexOf('--cookies') + 1], '/tmp/library-cookies.txt');

  const selected = selectYoutubeSubtitleCandidates({ subtitles: { 'en-eEY6OEpapPo': [{ ext: 'vtt' }] } }, ['en'], true)[0];
  const downloadArgs = buildSubtitleCandidateDownloadArgs(config, playlist, item, '/tmp/work', selected);
  assert.ok(downloadArgs.includes('--write-subs'));
  assert.ok(downloadArgs.includes('--no-write-auto-subs'));
  assert.equal(downloadArgs[downloadArgs.indexOf('--sub-langs') + 1], '^en-eEY6OEpapPo$');
  assert.equal(downloadArgs[downloadArgs.indexOf('--convert-subs') + 1], 'srt');
});

test('sidecar sem sufixo e reconhecido como faixa UND reservada ao bilingue', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-subtitle-und-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const media = path.join(root, 'Artist - Song.mp4');
  await fs.writeFile(media, 'video');
  await fs.writeFile(path.join(root, 'Artist - Song.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello\nOlá\n');
  await fs.writeFile(path.join(root, 'Artist - Song.en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
  await fs.writeFile(path.join(root, 'Other.srt'), 'ignore');

  assert.equal(getSubtitleSidecarPath(media, 'und'), path.join(root, 'Artist - Song.srt'));
  const sidecars = await listSubtitleSidecars(media);
  assert.deepEqual(sidecars.map((file) => path.basename(file)), ['Artist - Song.srt', 'Artist - Song.en.srt']);
});

test('staged subtitle files become sidecars with the same media base name', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-subtitle-sidecar-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const work = path.join(root, 'work');
  const media = path.join(root, 'Artist - Song.mp4');
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(media, 'video');
  await fs.writeFile(path.join(work, 'subtitle.pt-BR.srt'), '1\n00:00:00,000 --> 00:00:01,000\nOi\n');
  await fs.writeFile(path.join(work, 'subtitle.en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHi\n');

  const result = await finalizeStagedSubtitles(work, media);
  assert.equal(result.moved.length, 2);
  assert.equal(await fs.readFile(getSubtitleSidecarPath(media, 'pt-BR'), 'utf8').then(Boolean), true);
  assert.equal(await fs.readFile(getSubtitleSidecarPath(media, 'en'), 'utf8').then(Boolean), true);
});

test('backfill downloads only subtitles, preserves completed video and scans ErsatzTV once at the end', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-subtitle-backfill-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  let scanRequests = 0;
  let receivedApiKey = '';
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/libraries/17/scan') {
      scanRequests += 1;
      receivedApiKey = req.headers['x-etv-api-key'] || '';
      res.statusCode = 200;
      res.end('{}');
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();

  const fakeYtDlp = path.join(root, 'fake-yt-dlp');
  await fs.writeFile(fakeYtDlp, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--dump-single-json')) {
  console.log(JSON.stringify({ subtitles: { 'pt-BR': [{ ext: 'vtt' }], 'en-eEY6OEpapPo': [{ ext: 'vtt', name: 'English - English' }] }, automatic_captions: {} }));
  process.exit(0);
}
const out = args[args.indexOf('-o') + 1];
const selector = args[args.indexOf('--sub-langs') + 1];
const language = selector.includes('pt-BR') ? 'pt-BR' : 'en-eEY6OEpapPo';
const text = language === 'pt-BR' ? 'Oi' : 'Hi';
fs.writeFileSync(out.replace('%(ext)s', language + '.srt'), '1\\n00:00:00,000 --> 00:00:01,000\\n' + text + '\\n');
`, 'utf8');
  await fs.chmod(fakeYtDlp, 0o755);

  const mediaDir = path.join(root, 'media');
  const config = makeConfig(mediaDir, {
    subtitles: { enabled: true, includeAuto: true, languages: ['pt-BR', 'en'] }
  });
  config.paths.ytDlpPath = fakeYtDlp;
  config.ersatztv.url = `http://127.0.0.1:${address.port}`;
  config.ersatztv.apiKey = 'backfill-key';

  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  await manager.reconcileLibrary(config, playlist, [{ id: 'abcdefghijk', title: 'Artist - Song' }]);

  const item = manager.state.items[makeItemId('Teste', 'abcdefghijk')];
  await fs.mkdir(path.dirname(item.targetPath), { recursive: true });
  await fs.writeFile(item.targetPath, 'already-downloaded-video');
  item.status = 'completed';
  item.fileSizeBytes = 24;
  item.completedAt = new Date().toISOString();
  await manager.saveNow();

  const beforeVideo = await fs.readFile(item.targetPath, 'utf8');
  const queued = await manager.queueMissingSubtitles('Teste');
  assert.equal(queued.queued, 1);
  assert.equal(item.status, 'completed');

  await manager.processSubtitleItem(item);
  assert.equal(item.status, 'completed');
  assert.equal(item.subtitles.status, 'complete');
  assert.deepEqual(item.subtitles.foundLanguages.sort(), ['en', 'pt-BR']);
  assert.equal(await fs.readFile(item.targetPath, 'utf8'), beforeVideo);
  assert.ok((await fs.stat(getSubtitleSidecarPath(item.targetPath, 'pt-BR'))).size > 0);
  assert.ok((await fs.stat(getSubtitleSidecarPath(item.targetPath, 'en'))).size > 0);

  await manager.maybeFinalizeSubtitleBackfills();
  await manager.maybeFinalizeSubtitleBackfills();
  assert.equal(scanRequests, 1);
  assert.equal(receivedApiKey, 'backfill-key');
  assert.equal(manager.state.libraries.Teste.subtitleBackfill.active, false);
  assert.equal(manager.state.libraries.Teste.dirty, false);
});

test('subtitle failure schedules a retry without changing completed video status', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-subtitle-retry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const fakeYtDlp = path.join(root, 'fake-yt-dlp-fail');
  await fs.writeFile(fakeYtDlp, '#!/bin/sh\necho "temporary network failure" >&2\nexit 1\n', 'utf8');
  await fs.chmod(fakeYtDlp, 0o755);

  const config = makeConfig(path.join(root, 'media'), {
    subtitles: { enabled: true, includeAuto: true, languages: ['es'] }
  });
  config.paths.ytDlpPath = fakeYtDlp;
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  await manager.reconcileLibrary(config, playlist, [{ id: 'zzzzzzzzzzz', title: 'Artist - Song' }]);

  const item = manager.state.items[makeItemId('Teste', 'zzzzzzzzzzz')];
  await fs.mkdir(path.dirname(item.targetPath), { recursive: true });
  await fs.writeFile(item.targetPath, 'video');
  item.status = 'completed';
  item.completedAt = new Date().toISOString();
  await manager.scheduleSubtitlesForItem(item, playlist, { resetAttempts: true });
  await manager.processSubtitleItem(item);

  assert.equal(item.status, 'completed');
  assert.equal(item.subtitles.status, 'pending');
  assert.ok(item.subtitles.nextAttemptAt);
  assert.match(item.subtitles.lastError, /temporary network failure/);
});
