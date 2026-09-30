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
        channelNumber: null,
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

test('generic profile keeps the flat layout and creates a basic sidecar NFO', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v28-generic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'generic';
  config.downloads.writeThumbnails = true;
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  const id = makeItemId('Teste', 'ppppppppppp');
  const target = manager.chooseTargetPaths(playlist, {
    id: 'ppppppppppp',
    title: 'Twenty One Pilots - City Walls (Official Video)',
    description: 'Clip description'
  }, id);
  assert.equal(target.mediaLayout, 'generic-flat');
  assert.equal(path.basename(target.targetPath), 'Twenty One Pilots - City Walls (Official Video).mp4');
  assert.equal(path.basename(target.thumbnailPath), 'Twenty One Pilots - City Walls (Official Video).jpg');
  assert.equal(path.basename(target.nfoPath), 'Twenty One Pilots - City Walls (Official Video).nfo');

  const workDir = path.join(root, 'work-generic');
  await fs.mkdir(workDir, { recursive: true });
  const stagedMedia = path.join(workDir, 'normalized.mp4');
  await fs.writeFile(stagedMedia, 'video-placeholder');
  await fs.writeFile(path.join(workDir, 'media.jpg'), 'art-placeholder');
  const item = {
    id,
    libraryName: 'Teste',
    libraryFolder: 'Teste',
    videoId: 'ppppppppppp',
    title: 'Twenty One Pilots - City Walls (Official Video)',
    description: 'Clip description',
    thumbnailUrl: '',
    ...target,
    status: 'downloading',
    progress: {}
  };
  manager.state.items[id] = item;
  await manager.finalizeDownload(item, stagedMedia, workDir);
  const nfo = await fs.readFile(item.nfoPath, 'utf8');
  assert.match(nfo, /<title>Twenty One Pilots - City Walls<\/title>/);
  assert.match(nfo, /<plot>Clip description<\/plot>/);
  assert.equal(item.mediaMetadata.profile, 'generic');
});

test('movie profile preserves the v2.6 per-video folder and poster layout', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v28-movie-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'movie';
  config.downloads.writeThumbnails = true;
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  const id = makeItemId('Teste', 'qqqqqqqqqqq');
  const target = manager.chooseTargetPaths(playlist, {
    id: 'qqqqqqqqqqq',
    title: 'Twenty One Pilots - Live at Somewhere (Official Video)'
  }, id);
  assert.equal(target.mediaLayout, 'movie-folder');
  assert.equal(path.basename(target.targetPath), 'Twenty One Pilots - Live at Somewhere (Official Video).mp4');
  assert.equal(path.basename(path.dirname(target.targetPath)), 'Twenty One Pilots - Live at Somewhere (Official Video)');
  assert.equal(path.basename(target.thumbnailPath), 'poster.jpg');
  assert.equal(path.basename(target.nfoPath), 'Twenty One Pilots - Live at Somewhere (Official Video).nfo');

  const workDir = path.join(root, 'work-movie');
  await fs.mkdir(workDir, { recursive: true });
  const stagedMedia = path.join(workDir, 'normalized.mp4');
  await fs.writeFile(stagedMedia, 'video-placeholder');
  await fs.writeFile(path.join(workDir, 'media.jpg'), 'poster-placeholder');
  const item = {
    id,
    libraryName: 'Teste',
    libraryFolder: 'Teste',
    videoId: 'qqqqqqqqqqq',
    title: 'Twenty One Pilots - Live at Somewhere (Official Video)',
    artist: 'Twenty One Pilots',
    trackTitle: 'Live at Somewhere (Official Video)',
    thumbnailUrl: '',
    ...target,
    status: 'downloading',
    progress: {}
  };
  manager.state.items[id] = item;
  await manager.finalizeDownload(item, stagedMedia, workDir);
  const nfo = await fs.readFile(item.nfoPath, 'utf8');
  assert.match(nfo, /<title>Twenty One Pilots<\/title>/);
  assert.match(nfo, /<outline>Live at Somewhere<\/outline>/);
  assert.equal(await fs.readFile(item.thumbnailPath, 'utf8'), 'poster-placeholder');
  assert.equal(item.mediaMetadata.profile, 'movie');
});

test('music clips profile uses artist/show folders, Season 01 and stable episode numbers', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v27-targets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'ggggggggggg', title: 'Twenty One Pilots - City Walls (Official Video)' },
    { id: 'hhhhhhhhhhh', title: 'Twenty One Pilots - The Line [Official Music Video]' }
  ]);

  const first = manager.state.items[makeItemId('Teste', 'ggggggggggg')];
  const second = manager.state.items[makeItemId('Teste', 'hhhhhhhhhhh')];

  assert.equal(first.artist, 'Twenty One Pilots');
  assert.equal(first.trackTitle, 'City Walls');
  assert.equal(first.showSeasonNumber, 1);
  assert.equal(first.showEpisodeNumber, 1);
  assert.equal(second.showEpisodeNumber, 2);
  assert.equal(path.basename(first.targetPath), 'Twenty One Pilots - S01E01 - City Walls.mp4');
  assert.equal(path.basename(second.targetPath), 'Twenty One Pilots - S01E02 - The Line.mp4');
  assert.equal(path.basename(path.dirname(first.targetPath)), 'Season 01');
  assert.equal(path.basename(path.dirname(path.dirname(first.targetPath))), 'Twenty One Pilots');
  assert.equal(path.basename(first.thumbnailPath), 'Twenty One Pilots - S01E01 - City Walls-thumb.jpg');
  assert.equal(path.basename(first.nfoPath), 'Twenty One Pilots - S01E01 - City Walls.nfo');
  assert.equal(path.basename(first.showNfoPath), 'tvshow.nfo');
  assert.equal(path.basename(first.showPosterPath), 'poster.jpg');
  assert.equal(first.mediaLayout, 'show-season');

  await manager.reconcileLibrary(config, playlist, [
    { id: 'ggggggggggg', title: 'Twenty One Pilots - City Walls (Official Video)' },
    { id: 'hhhhhhhhhhh', title: 'Twenty One Pilots - The Line [Official Music Video]' },
    { id: 'iiiiiiiiiii', title: 'Twenty One Pilots - Next Semester' }
  ]);
  const third = manager.state.items[makeItemId('Teste', 'iiiiiiiiiii')];
  assert.equal(third.showEpisodeNumber, 3);
  assert.equal(path.basename(third.targetPath), 'Twenty One Pilots - S01E03 - Next Semester.mp4');
});

test('music clips episode numbers follow publication chronology instead of discovery order', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-episode-chronology-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'chrononewer01', title: 'Artist - Newer', publishedAt: '2025-06-12T14:30:00Z' },
    { id: 'chronoolder01', title: 'Artist - Older', publishedAt: '2023-01-02T10:00:00Z' },
    { id: 'chronomiddle1', title: 'Artist - Middle', publishedAt: '2024-04-09T11:00:00Z' }
  ]);

  const older = manager.state.items[makeItemId('Teste', 'chronoolder01')];
  const middle = manager.state.items[makeItemId('Teste', 'chronomiddle1')];
  const newer = manager.state.items[makeItemId('Teste', 'chrononewer01')];
  assert.equal(older.showEpisodeNumber, 1);
  assert.equal(middle.showEpisodeNumber, 2);
  assert.equal(newer.showEpisodeNumber, 3);
  assert.equal(path.basename(older.targetPath), 'Artist - S01E01 - Older.mp4');
  assert.equal(path.basename(middle.targetPath), 'Artist - S01E02 - Middle.mp4');
  assert.equal(path.basename(newer.targetPath), 'Artist - S01E03 - Newer.mp4');
});

test('music clips chronology uses a manually corrected aired date from the existing NFO', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-episode-manual-aired-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'manualaired01', title: 'Artist - First', publishedAt: '2025-01-01T10:00:00Z' },
    { id: 'manualaired02', title: 'Artist - Second', publishedAt: '2024-01-01T10:00:00Z' }
  ]);
  const first = manager.state.items[makeItemId('Teste', 'manualaired01')];
  const second = manager.state.items[makeItemId('Teste', 'manualaired02')];

  await fs.mkdir(path.dirname(first.nfoPath), { recursive: true });
  await fs.writeFile(first.nfoPath, '<episodedetails>\n  <season>1</season>\n  <episode>2</episode>\n  <aired>2020-05-10</aired>\n</episodedetails>\n');
  await fs.writeFile(second.nfoPath, '<episodedetails>\n  <season>1</season>\n  <episode>1</episode>\n  <aired>2024-01-01</aired>\n</episodedetails>\n');

  await manager.resequenceMusicClipEpisodes(playlist, { renameFiles: true, patchNfos: true, addMissingDate: false });
  assert.equal(first.showEpisodeNumber, 1);
  assert.equal(second.showEpisodeNumber, 2);
});

test('music clips profile creates tvshow NFO, episode NFO and episode artwork', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v27-finalize-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  config.downloads.writeThumbnails = true;
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  const id = makeItemId('Teste', 'jjjjjjjjjjj');
  const target = manager.chooseTargetPaths(playlist, {
    id: 'jjjjjjjjjjj',
    title: 'Twenty One Pilots - City Walls (Official Video)'
  }, id);
  const workDir = path.join(root, 'work');
  await fs.mkdir(workDir, { recursive: true });
  const stagedMedia = path.join(workDir, 'normalized.mp4');
  await fs.writeFile(stagedMedia, 'video-placeholder');
  await fs.writeFile(path.join(workDir, 'media.jpg'), 'episode-art-placeholder');

  const item = {
    id,
    libraryName: 'Teste',
    libraryFolder: 'Teste',
    videoId: 'jjjjjjjjjjj',
    title: 'Twenty One Pilots - City Walls (Official Video)',
    thumbnailUrl: '',
    ...target,
    status: 'downloading',
    progress: {}
  };
  manager.state.items[id] = item;

  await manager.finalizeDownload(item, stagedMedia, workDir);

  assert.equal(item.status, 'completed');
  assert.equal(await fs.readFile(item.thumbnailPath, 'utf8'), 'episode-art-placeholder');
  assert.equal(await fs.readFile(item.showPosterPath, 'utf8'), 'episode-art-placeholder');
  const showNfo = await fs.readFile(item.showNfoPath, 'utf8');
  const episodeNfo = await fs.readFile(item.nfoPath, 'utf8');
  assert.match(showNfo, /<title>Twenty One Pilots<\/title>/);
  assert.match(showNfo, /<genre>Music<\/genre>/);
  assert.match(episodeNfo, /<title>City Walls<\/title>/);
  assert.match(episodeNfo, /<season>1<\/season>/);
  assert.match(episodeNfo, /<episode>1<\/episode>/);
  assert.equal(item.mediaMetadata.status, 'complete');
});

test('music clips profile consolidates artist casing and falls back to channel artist when title has no separator', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v27-casing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'kkkkkkkkkkk', title: 'TWENTY ONE PILOTS - City Walls' },
    { id: 'lllllllllll', title: 'twenty one pilots - The Line' },
    { id: 'mmmmmmmmmmm', title: 'Next Semester (Official Video)', channelTitle: 'TWENTY ONE PILOTS' }
  ]);

  const first = manager.state.items[makeItemId('Teste', 'kkkkkkkkkkk')];
  const second = manager.state.items[makeItemId('Teste', 'lllllllllll')];
  const third = manager.state.items[makeItemId('Teste', 'mmmmmmmmmmm')];
  assert.equal(first.artist, 'Twenty One Pilots');
  assert.equal(second.artist, 'Twenty One Pilots');
  assert.equal(third.artist, 'Twenty One Pilots');
  assert.equal(third.trackTitle, 'Next Semester');
  assert.equal(path.basename(path.dirname(path.dirname(first.targetPath))), 'Twenty One Pilots');
  assert.equal(path.basename(path.dirname(path.dirname(second.targetPath))), 'Twenty One Pilots');
  assert.equal(path.basename(path.dirname(path.dirname(third.targetPath))), 'Twenty One Pilots');
});

test('recomputes a missing target path into the current music clips layout before redownload', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v27-redownload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'nnnnnnnnnnn', title: 'TWENTY ONE PILOTS - City Walls' }
  ]);
  const id = makeItemId('Teste', 'nnnnnnnnnnn');
  const item = manager.state.items[id];
  item.status = 'completed';
  item.artist = 'TWENTY ONE PILOTS';
  item.targetPath = path.join(config.paths.baseDir, 'Teste', 'TWENTY ONE PILOTS', 'TWENTY ONE PILOTS - City Walls.mp4');
  item.mediaPath = item.targetPath;
  item.showEpisodeNumber = null;
  item.mediaMetadata = null;

  const result = await manager.reconcileLibrary(config, playlist, [
    { id: 'nnnnnnnnnnn', title: 'TWENTY ONE PILOTS - City Walls' }
  ]);

  assert.equal(result.reactivated, 1);
  assert.equal(item.status, 'pending');
  assert.equal(item.artist, 'Twenty One Pilots');
  assert.equal(item.showEpisodeNumber, 1);
  assert.equal(path.basename(path.dirname(item.targetPath)), 'Season 01');
  assert.equal(path.basename(path.dirname(path.dirname(item.targetPath))), 'Twenty One Pilots');
  assert.equal(path.basename(item.targetPath), 'Twenty One Pilots - S01E01 - City Walls.mp4');
});

test('discovery persists YouTube publication metadata for future NFO generation', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-release-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [{
    id: 'releasedate01',
    title: 'Artist - Song',
    publishedAt: '2025-06-12T14:30:00Z',
    year: 2025
  }]);

  const item = manager.state.items[makeItemId('Teste', 'releasedate01')];
  assert.equal(item.publishedAt, '2025-06-12T14:30:00Z');
  assert.equal(item.releaseDate, '2025-06-12');
  assert.equal(item.releaseDateSource, 'youtube');
  assert.equal(item.year, 2025);
});

test('temporary NFO refresh adds the missing date, renumbers season/episode and preserves all other manual fields', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-release-nfo-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  const id = makeItemId('Teste', 'releasedate02');
  const target = manager.chooseTargetPaths(playlist, {
    id: 'releasedate02',
    title: 'Artist - Song'
  }, id);
  await fs.mkdir(path.dirname(target.nfoPath), { recursive: true });
  const manualNfo = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<episodedetails>',
    '  <title>Título corrigido pelo usuário</title>',
    '  <season>9</season>',
    '  <episode>99</episode>',
    '  <plot>Descrição manual importante</plot>',
    '  <genre>Personalizado</genre>',
    '</episodedetails>',
    ''
  ].join('\n');
  await fs.writeFile(target.nfoPath, manualNfo, 'utf8');

  manager.state.items[id] = {
    id,
    destinationId: 'Teste',
    libraryFolder: 'Teste',
    destinationType: 'library',
    videoId: 'releasedate02',
    title: 'Artist - Song',
    status: 'completed',
    releaseDate: '2025-06-12',
    releaseDateSource: 'youtube',
    year: 2025,
    mediaProfile: 'music_clips',
    nfoPath: target.nfoPath,
    targetPath: target.targetPath,
    progress: {},
    subtitles: {}
  };

  const summary = await manager.refreshReleaseDates('Teste');
  assert.equal(summary.checked, 1);
  assert.equal(summary.nfoUpdated, 1);
  assert.equal(summary.failed, 0);
  const updated = await fs.readFile(target.nfoPath, 'utf8');
  assert.match(updated, /<aired>2025-06-12<\/aired>/);
  assert.match(updated, /<title>Título corrigido pelo usuário<\/title>/);
  assert.match(updated, /<season>1<\/season>/);
  assert.match(updated, /<episode>1<\/episode>/);
  assert.match(updated, /<plot>Descrição manual importante<\/plot>/);
  assert.match(updated, /<genre>Personalizado<\/genre>/);
  assert.equal(summary.episodesRenumbered, 1);
  assert.equal(summary.episodeNfoUpdated, 1);
  const normalized = updated
    .replace('  <season>1</season>', '  <season>9</season>')
    .replace('  <episode>1</episode>', '  <episode>99</episode>')
    .replace('  <aired>2025-06-12</aired>\n', '');
  assert.equal(normalized, manualNfo);
});


test('temporary music-clip migration renames media sidecars when chronology changes without touching manual NFO text', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-episode-rename-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'rename-newer1', title: 'Artist - Newer', publishedAt: '2025-01-02T10:00:00Z' },
    { id: 'rename-older1', title: 'Artist - Older', publishedAt: '2024-01-02T10:00:00Z' }
  ]);
  const newer = manager.state.items[makeItemId('Teste', 'rename-newer1')];
  const older = manager.state.items[makeItemId('Teste', 'rename-older1')];

  // Simulate an old library whose file numbering was discovery-based, opposite to chronology.
  const seasonDir = path.dirname(newer.targetPath);
  const newerOldBase = 'Artist - S01E01 - Nome manual do arquivo novo';
  const olderOldBase = 'Artist - S01E02 - Nome manual do arquivo antigo';
  Object.assign(newer, {
    showEpisodeNumber: 1,
    status: 'completed',
    targetPath: path.join(seasonDir, `${newerOldBase}.mp4`),
    mediaPath: path.join(seasonDir, `${newerOldBase}.mp4`),
    nfoPath: path.join(seasonDir, `${newerOldBase}.nfo`),
    thumbnailPath: path.join(seasonDir, `${newerOldBase}-thumb.jpg`)
  });
  Object.assign(older, {
    showEpisodeNumber: 2,
    status: 'completed',
    targetPath: path.join(seasonDir, `${olderOldBase}.mp4`),
    mediaPath: path.join(seasonDir, `${olderOldBase}.mp4`),
    nfoPath: path.join(seasonDir, `${olderOldBase}.nfo`),
    thumbnailPath: path.join(seasonDir, `${olderOldBase}-thumb.jpg`)
  });
  await fs.mkdir(seasonDir, { recursive: true });
  await fs.writeFile(newer.targetPath, 'newer-video');
  await fs.writeFile(older.targetPath, 'older-video');
  await fs.writeFile(newer.thumbnailPath, 'newer-thumb');
  await fs.writeFile(older.thumbnailPath, 'older-thumb');
  await fs.writeFile(path.join(seasonDir, `${newerOldBase}.pt-BR.srt`), 'newer-sub');
  await fs.writeFile(path.join(seasonDir, `${olderOldBase}.pt-BR.srt`), 'older-sub');
  await fs.writeFile(newer.nfoPath, [
    '<episodedetails>',
    '  <title>Título manual mais novo</title>',
    '  <season>1</season>',
    '  <episode>1</episode>',
    '  <plot>Não alterar este texto</plot>',
    '  <aired>2025-01-02</aired>',
    '</episodedetails>',
    ''
  ].join('\n'));
  await fs.writeFile(older.nfoPath, [
    '<episodedetails>',
    '  <title>Título manual mais antigo</title>',
    '  <season>1</season>',
    '  <episode>2</episode>',
    '  <plot>Também preservar</plot>',
    '  <aired>2024-01-02</aired>',
    '</episodedetails>',
    ''
  ].join('\n'));

  const summary = await manager.refreshReleaseDates('Teste');
  assert.equal(summary.episodesRenumbered, 2);
  assert.ok(summary.filesRenamed >= 8);
  assert.equal(older.showEpisodeNumber, 1);
  assert.equal(newer.showEpisodeNumber, 2);
  assert.equal(path.basename(older.targetPath), 'Artist - S01E01 - Nome manual do arquivo antigo.mp4');
  assert.equal(path.basename(newer.targetPath), 'Artist - S01E02 - Nome manual do arquivo novo.mp4');
  assert.equal(await fs.readFile(older.targetPath, 'utf8'), 'older-video');
  assert.equal(await fs.readFile(newer.targetPath, 'utf8'), 'newer-video');
  assert.equal(await fs.readFile(path.join(seasonDir, 'Artist - S01E01 - Nome manual do arquivo antigo.pt-BR.srt'), 'utf8'), 'older-sub');
  assert.equal(await fs.readFile(path.join(seasonDir, 'Artist - S01E02 - Nome manual do arquivo novo.pt-BR.srt'), 'utf8'), 'newer-sub');
  const olderNfo = await fs.readFile(older.nfoPath, 'utf8');
  const newerNfo = await fs.readFile(newer.nfoPath, 'utf8');
  assert.match(olderNfo, /<title>Título manual mais antigo<\/title>/);
  assert.match(olderNfo, /<plot>Também preservar<\/plot>/);
  assert.match(olderNfo, /<episode>1<\/episode>/);
  assert.match(newerNfo, /<title>Título manual mais novo<\/title>/);
  assert.match(newerNfo, /<plot>Não alterar este texto<\/plot>/);
  assert.match(newerNfo, /<episode>2<\/episode>/);
});

test('temporary music-clip migration leaves manual filenames without an episode token unchanged', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-episode-manual-name-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const playlist = { ...config.playlists[0], folderName: 'Teste' };
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);

  await manager.reconcileLibrary(config, playlist, [
    { id: 'manual-name-1', title: 'Artist - Track', publishedAt: '2024-01-02T10:00:00Z' }
  ]);
  const item = manager.state.items[makeItemId('Teste', 'manual-name-1')];
  const seasonDir = path.dirname(item.targetPath);
  const manualBase = 'Artist - Nome totalmente manual';
  Object.assign(item, {
    showEpisodeNumber: 7,
    status: 'completed',
    targetPath: path.join(seasonDir, `${manualBase}.mp4`),
    mediaPath: path.join(seasonDir, `${manualBase}.mp4`),
    nfoPath: path.join(seasonDir, `${manualBase}.nfo`),
    thumbnailPath: path.join(seasonDir, `${manualBase}-thumb.jpg`)
  });
  await fs.mkdir(seasonDir, { recursive: true });
  await fs.writeFile(item.targetPath, 'video');
  await fs.writeFile(item.thumbnailPath, 'thumb');
  await fs.writeFile(path.join(seasonDir, `${manualBase}.pt-BR.srt`), 'subtitle');
  await fs.writeFile(item.nfoPath, [
    '<episodedetails>',
    '  <title>Título manual</title>',
    '  <season>9</season>',
    '  <episode>7</episode>',
    '  <aired>2024-01-02</aired>',
    '</episodedetails>',
    ''
  ].join('\n'));

  const summary = await manager.refreshReleaseDates('Teste');
  assert.equal(summary.episodesRenumbered, 1);
  assert.equal(summary.filesRenamed, 0);
  assert.equal(path.basename(item.targetPath), `${manualBase}.mp4`);
  assert.equal(path.basename(item.nfoPath), `${manualBase}.nfo`);
  assert.equal(path.basename(item.thumbnailPath), `${manualBase}-thumb.jpg`);
  assert.equal(await fs.readFile(path.join(seasonDir, `${manualBase}.pt-BR.srt`), 'utf8'), 'subtitle');
  const nfo = await fs.readFile(item.nfoPath, 'utf8');
  assert.match(nfo, /<title>Título manual<\/title>/);
  assert.match(nfo, /<season>1<\/season>/);
  assert.match(nfo, /<episode>1<\/episode>/);
});

test('temporary metadata migration refuses to rename libraries while a worker item is active', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-episode-active-worker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(path.join(root, 'media'));
  config.playlists[0].mediaProfile = 'music_clips';
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);
  manager.current = { itemId: 'synthetic-active-item' };

  await assert.rejects(
    () => manager.refreshReleaseDates('Teste'),
    /Aguarde o download ou a legenda em andamento terminar/
  );
});
