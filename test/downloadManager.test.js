const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeConfig } = require('../src/config');
const {
  DownloadManager,
  buildFormatSelector,
  buildDownloadArgs,
  parseProgressLine,
  makeItemId
} = require('../src/downloadManager');

function makeConfig(baseDir) {
  return normalizeConfig({
    configVersion: 2,
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
      minFreeSpaceGb: 1
    },
    playlists: [
      {
        name: 'Teste',
        urls: ['https://www.youtube.com/playlist?list=PLTESTE'],
        enabled: true,
        libraryId: null,
        playoutId: null,
        maxHeight: null,
        cookiesPath: ''
      }
    ],
    scheduler: { enabled: false }
  });
}

test('format selector prefers compatible codecs at 1080p and requested resolution above 1080p', () => {
  const fullHd = buildFormatSelector(1080);
  assert.match(fullHd, /^bestvideo\[height<=1080\]\[vcodec\^=avc1\]/);
  assert.match(fullHd, /bestvideo\[height<=1080\]\+bestaudio/);

  const ultraHd = buildFormatSelector(2160);
  assert.match(ultraHd, /^bestvideo\[height<=2160\]\+bestaudio/);
  assert.doesNotMatch(ultraHd.split('/')[0], /vcodec\^=avc1/);
});

test('download arguments use a staging template and optional cookies only when configured', () => {
  const config = makeConfig('/tmp/ersatztv-test-media');
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const item = {
    videoId: 'abcdefghijk',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    maxHeight: 1080
  };
  const args = buildDownloadArgs(config, playlist, item, '/tmp/work');
  assert.ok(args.includes('--continue'));
  assert.ok(args.includes('--merge-output-format'));
  assert.ok(args.includes('mkv'));
  assert.ok(args.includes('/tmp/work/media.%(ext)s'));
  const ffmpegLocationIndex = args.indexOf('--ffmpeg-location');
  assert.equal(args[ffmpegLocationIndex + 1], '/usr/bin');
  assert.equal(args.includes('--cookies'), false);

  config.paths.cookiesPath = '/tmp/cookies.txt';
  const withCookies = buildDownloadArgs(config, playlist, item, '/tmp/work');
  const cookieIndex = withCookies.indexOf('--cookies');
  assert.equal(withCookies[cookieIndex + 1], '/tmp/cookies.txt');
});

test('progress parser reads yt-dlp machine output', () => {
  const progress = parseProgressLine('__YTDLP_PROGRESS__1048576|2097152|NA|524288|2');
  assert.deepEqual(progress, {
    downloadedBytes: 1048576,
    totalBytes: 2097152,
    speedBytesPerSecond: 524288,
    etaSeconds: 2
  });
});

test('queue state persists and missing source items become orphaned', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v2-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, 'state.json');
  const config = makeConfig(path.join(root, 'media'));
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath });

  await manager.init(config);
  const first = await manager.reconcileLibrary(config, playlist, [
    { id: 'aaaaaaaaaaa', title: 'Artist - First' },
    { id: 'bbbbbbbbbbb', title: 'Artist - Second' }
  ]);
  assert.equal(first.queued, 2);

  const second = await manager.reconcileLibrary(config, playlist, [
    { id: 'aaaaaaaaaaa', title: 'Artist - First' }
  ]);
  assert.equal(second.orphaned, 1);
  assert.equal(manager.state.items[makeItemId('Teste', 'bbbbbbbbbbb')].orphaned, true);

  const reloaded = new DownloadManager({ statePath });
  await reloaded.init(config);
  assert.equal(reloaded.listItems({ limit: 10 }).length, 2);
  assert.equal(reloaded.state.items[makeItemId('Teste', 'bbbbbbbbbbb')].status, 'orphaned');
});


test('manual removal stays suppressed after rediscovery until retry', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v2-suppressed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, 'state.json');
  const config = makeConfig(path.join(root, 'media'));
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath });

  await manager.init(config);
  await manager.reconcileLibrary(config, playlist, [
    { id: 'ddddddddddd', title: 'Artist - Removed' }
  ]);

  const itemId = makeItemId('Teste', 'ddddddddddd');
  await manager.removeItem(itemId);
  assert.equal(manager.state.items[itemId].status, 'removed');
  assert.equal(manager.state.items[itemId].suppressed, true);

  const rediscovery = await manager.reconcileLibrary(config, playlist, [
    { id: 'ddddddddddd', title: 'Artist - Removed' }
  ]);
  assert.equal(rediscovery.queued, 0);
  assert.equal(manager.state.items[itemId].status, 'removed');
  assert.equal(manager.state.items[itemId].suppressed, true);

  await manager.reconcileLibrary(config, playlist, []);
  assert.equal(manager.state.items[itemId].status, 'removed');
  assert.equal(manager.state.items[itemId].suppressed, true);
  assert.equal(manager.state.items[itemId].orphaned, true);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'ddddddddddd', title: 'Artist - Removed' }
  ]);
  assert.equal(manager.state.items[itemId].status, 'removed');
  assert.equal(manager.state.items[itemId].suppressed, true);
  assert.equal(manager.state.items[itemId].orphaned, false);

  await manager.retryItem(itemId);
  assert.equal(manager.state.items[itemId].status, 'pending');
  assert.equal(manager.state.items[itemId].suppressed, false);
});

test('normalizes a non-H264/AAC file to MP4 H264/AAC', async (t) => {
  const ffmpeg = '/usr/bin/ffmpeg';
  const ffprobe = '/usr/bin/ffprobe';
  try {
    await fs.access(ffmpeg);
    await fs.access(ffprobe);
  } catch {
    t.skip('ffmpeg/ffprobe are not available in this environment');
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v2-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workDir = path.join(root, 'work');
  await fs.mkdir(workDir, { recursive: true });
  const input = path.join(workDir, 'media.avi');
  const generated = spawnSync(ffmpeg, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=1',
    '-c:v', 'mpeg4', '-c:a', 'mp3', '-shortest', input
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);

  const config = makeConfig(path.join(root, 'media'));
  config.paths.ffmpegPath = ffmpeg;
  config.paths.ffprobePath = ffprobe;
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);
  const item = { id: 'Teste::ccccccccccc', videoId: 'ccccccccccc', phase: null, updatedAt: null };
  const context = { child: null, cancelRequested: false, shutdownRequested: false, phase: null };
  const output = await manager.normalizeMedia(input, workDir, item, context);
  const inspection = await manager.validateMedia(output);
  assert.equal(path.extname(output), '.mp4');
  assert.equal(inspection.video.codec_name, 'h264');
  assert.equal(inspection.audio.codec_name, 'aac');
  await manager.stop({ terminateCurrent: false });
});

test('worker processes a queued item end-to-end with a yt-dlp compatible stub', async (t) => {
  const ffmpeg = '/usr/bin/ffmpeg';
  const ffprobe = '/usr/bin/ffprobe';
  try {
    await fs.access(ffmpeg);
    await fs.access(ffprobe);
  } catch {
    t.skip('ffmpeg/ffprobe are not available in this environment');
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v2-worker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = path.join(root, 'fixture.mp4');
  const generated = spawnSync(ffmpeg, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=44100:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixture
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);

  const fakeYtDlp = path.join(root, 'fake-yt-dlp');
  await fs.writeFile(fakeYtDlp, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const source = ${JSON.stringify(fixture)};
const target = path.join(process.cwd(), 'media.mp4');
fs.copyFileSync(source, target);
const size = fs.statSync(target).size;
console.log('__YTDLP_PROGRESS__' + size + '|' + size + '|NA|1000000|0');
console.log('__YTDLP_FILE__' + target);
`, 'utf8');
  await fs.chmod(fakeYtDlp, 0o755);

  const mediaDir = path.join(root, 'media');
  const config = makeConfig(mediaDir);
  config.paths.ytDlpPath = fakeYtDlp;
  config.paths.ffmpegPath = ffmpeg;
  config.paths.ffprobePath = ffprobe;
  config.downloads.pauseOnLowDisk = false;
  config.downloads.scanOnQueueIdle = false;
  config.downloads.rebuildPlayoutOnQueueIdle = false;
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });

  await manager.start(config);
  await manager.reconcileLibrary(config, playlist, [
    { id: 'eeeeeeeeeee', title: 'Artist - Full Worker Test' }
  ]);

  const itemId = makeItemId('Teste', 'eeeeeeeeeee');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && manager.state.items[itemId].status !== 'completed') {
    if (manager.state.items[itemId].status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const item = manager.state.items[itemId];
  assert.equal(item.status, 'completed', item.lastError || 'worker did not complete');
  assert.equal(await fs.stat(item.targetPath).then((stats) => stats.size > 0), true);
  const inspection = await manager.validateMedia(item.targetPath);
  assert.equal(inspection.video.codec_name, 'h264');
  assert.equal(inspection.audio.codec_name, 'aac');
  await manager.stop({ terminateCurrent: true });
});
