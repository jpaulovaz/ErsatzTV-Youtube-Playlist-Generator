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

test('clear queue preserves completed media and suppresses every unfinished item', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v2-clear-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, 'state.json');
  const config = makeConfig(path.join(root, 'media'));
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath });

  await manager.init(config);
  await manager.reconcileLibrary(config, playlist, [
    { id: 'ffffffffffa', title: 'Artist - Completed' },
    { id: 'ffffffffffb', title: 'Artist - Pending One' },
    { id: 'ffffffffffc', title: 'Artist - Pending Two' }
  ]);

  const completedId = makeItemId('Teste', 'ffffffffffa');
  const completed = manager.state.items[completedId];
  await fs.mkdir(path.dirname(completed.targetPath), { recursive: true });
  await fs.writeFile(completed.targetPath, 'valid-placeholder');
  completed.status = 'completed';
  completed.fileSizeBytes = 17;
  completed.completedAt = new Date().toISOString();
  await manager.saveNow();

  const result = await manager.clearQueue({ library: 'Teste' });
  assert.equal(result.removed, 2);
  assert.equal(result.completedPreserved, 1);
  assert.equal(manager.state.items[completedId].status, 'completed');

  for (const videoId of ['ffffffffffb', 'ffffffffffc']) {
    const item = manager.state.items[makeItemId('Teste', videoId)];
    assert.equal(item.status, 'removed');
    assert.equal(item.suppressed, true);
  }

  assert.equal(manager.getItemsPage({ status: 'active' }).total, 0);
  assert.equal(manager.getItemsPage({ status: 'history', limit: 2 }).total, 3);
  assert.equal(manager.getItemsPage({ status: 'history', limit: 2 }).items.length, 2);
  assert.equal(manager.getItemsPage({ status: 'history', limit: 2 }).hasMore, true);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'ffffffffffa', title: 'Artist - Completed' },
    { id: 'ffffffffffb', title: 'Artist - Pending One' },
    { id: 'ffffffffffc', title: 'Artist - Pending Two' }
  ]);
  assert.equal(manager.state.items[makeItemId('Teste', 'ffffffffffb')].status, 'removed');
  assert.equal(manager.state.items[makeItemId('Teste', 'ffffffffffc')].status, 'removed');
});

test('movie metadata mode uses one subfolder per video with poster.jpg and NFO paths', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v25-targets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].movieMetadata = { enabled: true };
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  const itemId = makeItemId('Teste', 'ggggggggggg');
  const target = manager.chooseTargetPaths(playlist, {
    id: 'ggggggggggg',
    title: 'Twenty One Pilots - City Walls (Official Video)'
  }, itemId);

  assert.equal(path.basename(target.targetPath), 'Twenty One Pilots - City Walls (Official Video).mp4');
  assert.equal(path.basename(path.dirname(target.targetPath)), 'Twenty One Pilots - City Walls (Official Video)');
  assert.equal(path.basename(target.thumbnailPath), 'poster.jpg');
  assert.equal(path.basename(target.nfoPath), 'Twenty One Pilots - City Walls (Official Video).nfo');
  assert.equal(target.mediaLayout, 'movie-folder');
});

test('prepares existing completed files for ErsatzTV movie metadata without redownloading media', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v25-migrate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const mediaDir = path.join(root, 'media');
  const config = makeConfig(mediaDir);
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [{
    id: 'hhhhhhhhhhh',
    title: 'Twenty One Pilots - City Walls (Official Video)',
    thumbnailUrl: ''
  }]);
  const id = makeItemId('Teste', 'hhhhhhhhhhh');
  const item = manager.state.items[id];
  await fs.mkdir(path.dirname(item.targetPath), { recursive: true });
  await fs.writeFile(item.targetPath, 'video-placeholder');
  await fs.writeFile(item.thumbnailPath, 'poster-placeholder');
  const oldSubtitle = item.targetPath.replace(/\.mp4$/, '.pt-BR.srt');
  await fs.writeFile(oldSubtitle, 'subtitle-placeholder');
  item.status = 'completed';
  item.mediaPath = item.targetPath;
  item.fileSizeBytes = 17;
  item.completedAt = new Date().toISOString();
  await manager.saveNow();

  config.playlists[0].movieMetadata = { enabled: true };
  manager.configure(config);
  const summary = await manager.prepareMovieMetadata('Teste');
  const migrated = manager.state.items[id];

  assert.equal(summary.reorganized, 1);
  assert.equal(summary.nfoWritten, 1);
  assert.equal(summary.postersMoved, 1);
  assert.equal(summary.failed, 0);
  assert.equal(path.basename(path.dirname(migrated.targetPath)), path.parse(migrated.targetPath).name);
  assert.equal(path.basename(migrated.thumbnailPath), 'poster.jpg');
  assert.equal(await fs.readFile(migrated.targetPath, 'utf8'), 'video-placeholder');
  assert.equal(await fs.readFile(migrated.thumbnailPath, 'utf8'), 'poster-placeholder');
  assert.equal(await fs.readFile(migrated.targetPath.replace(/\.mp4$/, '.pt-BR.srt'), 'utf8'), 'subtitle-placeholder');
  const nfo = await fs.readFile(migrated.nfoPath, 'utf8');
  assert.match(nfo, /<title>Twenty One Pilots<\/title>/);
  assert.match(nfo, /<plot>City Walls<\/plot>/);
  assert.match(nfo, /<uniqueid type="youtube" default="true">hhhhhhhhhhh<\/uniqueid>/);
  assert.equal(await fs.access(item.targetPath).then(() => true).catch(() => false), true);
});

test('new completed downloads create poster.jpg and NFO automatically in movie metadata mode', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v25-finalize-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].movieMetadata = { enabled: true };
  config.downloads.writeThumbnails = true;
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  const id = makeItemId('Teste', 'iiiiiiiiiii');
  const target = manager.chooseTargetPaths(playlist, {
    id: 'iiiiiiiiiii',
    title: 'Twenty One Pilots - City Walls (Official Video)'
  }, id);
  const workDir = path.join(root, 'work');
  await fs.mkdir(workDir, { recursive: true });
  const stagedMedia = path.join(workDir, 'normalized.mp4');
  await fs.writeFile(stagedMedia, 'video-placeholder');
  await fs.writeFile(path.join(workDir, 'media.jpg'), 'poster-placeholder');

  const item = {
    id,
    libraryName: 'Teste',
    libraryFolder: 'Teste',
    videoId: 'iiiiiiiiiii',
    title: 'Twenty One Pilots - City Walls (Official Video)',
    artist: target.artist,
    trackTitle: target.trackTitle,
    thumbnailUrl: '',
    ...target,
    status: 'downloading',
    progress: {}
  };
  manager.state.items[id] = item;

  await manager.finalizeDownload(item, stagedMedia, workDir);

  assert.equal(item.status, 'completed');
  assert.equal(await fs.readFile(item.thumbnailPath, 'utf8'), 'poster-placeholder');
  const nfo = await fs.readFile(item.nfoPath, 'utf8');
  assert.match(nfo, /<title>Twenty One Pilots<\/title>/);
  assert.match(nfo, /<plot>City Walls<\/plot>/);
  assert.equal(item.movieMetadata.status, 'complete');
});

test('consolidates artist casing for new targets and NFO-facing metadata', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v26-casing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].movieMetadata = { enabled: true };
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'jjjjjjjjjjj', title: 'TWENTY ONE PILOTS - City Walls' },
    { id: 'kkkkkkkkkkk', title: 'twenty one pilots - The Line' }
  ]);

  const first = manager.state.items[makeItemId('Teste', 'jjjjjjjjjjj')];
  const second = manager.state.items[makeItemId('Teste', 'kkkkkkkkkkk')];
  assert.equal(first.artist, 'Twenty One Pilots');
  assert.equal(second.artist, 'Twenty One Pilots');
  assert.equal(path.basename(path.dirname(path.dirname(first.targetPath))), 'Twenty One Pilots');
  assert.equal(path.basename(path.dirname(path.dirname(second.targetPath))), 'Twenty One Pilots');
});

test('recomputes a missing legacy target path before redownload using current artist rules', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v26-redownload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'lllllllllll', title: 'TWENTY ONE PILOTS - City Walls' }
  ]);
  const id = makeItemId('Teste', 'lllllllllll');
  const item = manager.state.items[id];
  item.status = 'completed';
  item.artist = 'TWENTY ONE PILOTS';
  item.targetPath = path.join(config.paths.baseDir, 'Teste', 'TWENTY ONE PILOTS', 'TWENTY ONE PILOTS - City Walls.mp4');
  item.mediaPath = item.targetPath;

  const result = await manager.reconcileLibrary(config, playlist, [
    { id: 'lllllllllll', title: 'TWENTY ONE PILOTS - City Walls' }
  ]);

  assert.equal(result.reactivated, 1);
  assert.equal(item.status, 'pending');
  assert.equal(item.artist, 'Twenty One Pilots');
  assert.equal(path.basename(path.dirname(item.targetPath)), 'Twenty One Pilots');
});
