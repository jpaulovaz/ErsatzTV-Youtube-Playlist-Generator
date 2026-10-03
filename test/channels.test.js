const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeConfig, validateConfig } = require('../src/config');
const {
  channelGlobalDestination,
  channelPlaylistDestination,
  getChannelDestinations
} = require('../src/destinationService');
const { analyzeChannel } = require('../src/discovery/channelCatalogService');
const { mergeCatalogIntoChannel } = require('../src/discovery/channelSyncService');
const { isCompletedStream } = require('../src/discovery/youtubeSourceProvider');
const discoveryLock = require('../src/discovery/discoveryLock');
const { DownloadManager, makeItemId } = require('../src/downloadManager');
const { runPlaylistAction, deletePlaylistWithFiles, deleteChannelWithFiles } = require('../src/channelActionsService');

function makeConfig(root = '/srv/media') {
  return normalizeConfig({
    configVersion: 7,
    paths: {
      baseDir: path.join(root, 'libraries'),
      channelsBaseDir: path.join(root, 'channels'),
      ytDlpPath: '/usr/local/bin/yt-dlp',
      ffmpegPath: '/usr/bin/ffmpeg',
      ffprobePath: '/usr/bin/ffprobe'
    },
    youtubeApi: { enabled: false, readMode: 'ytdlp' },
    playlists: [],
    channels: [{
      channelId: 'UC_TEST_CHANNEL',
      name: 'Twenty One Pilots',
      handle: '@twentyonepilots',
      url: 'https://www.youtube.com/@twentyonepilots',
      thumbnailUrl: '',
      uploadsPlaylistId: 'UU_TEST_CHANNEL',
      folderName: 'Twenty One Pilots',
      enabled: true,
      globalSources: {
        uploads: true,
        videos: true,
        shorts: false,
        streams: false,
        subtitles: { enabled: true, includeAuto: true, languages: ['pt-BR', 'en'] }
      },
      playlists: [{
        playlistId: 'PL_CLIPS',
        name: 'Official Music Videos',
        folderName: 'Official Music Videos',
        url: 'https://www.youtube.com/playlist?list=PL_CLIPS',
        enabled: true,
        mediaProfile: 'music_clips',
        libraryId: 31,
        channelNumber: 421,
        maxHeight: 1080,
        cookiesPath: '',
        subtitles: { enabled: true, includeAuto: true, languages: ['pt-BR', 'en'] }
      }, {
        playlistId: 'PL_SHOWS',
        name: 'Live Performances',
        folderName: 'Live Performances',
        url: 'https://www.youtube.com/playlist?list=PL_SHOWS',
        enabled: true,
        mediaProfile: 'movie',
        libraryId: 42,
        channelNumber: 419,
        maxHeight: null,
        cookiesPath: '',
        subtitles: { enabled: false, includeAuto: true, languages: ['pt-BR', 'pt', 'en', 'es'] }
      }]
    }],
    scheduler: { enabled: false },
    channelScheduler: { enabled: false }
  });
}

test('v3 config normalizes Channels without changing embedded playlist identity', () => {
  const config = validateConfig(makeConfig());
  assert.equal(config.configVersion, 9);
  assert.equal(config.paths.channelsBaseDir, '/srv/media/channels');
  assert.equal(config.channels.length, 1);
  assert.equal(config.channels[0].uploadsPlaylistId, 'UU_TEST_CHANNEL');
  assert.deepEqual(config.channels[0].globalSources.subtitles.languages, ['pt-BR', 'en']);
  assert.equal(config.channels[0].playlists[0].mediaProfile, 'music_clips');
  assert.equal(config.channels[0].playlists[0].libraryId, 31);
  assert.equal(config.channels[0].playlists[1].channelNumber, 419);
  assert.equal(config.channels[0].playlists[0].orphanPolicy, 'mark');
});

test('v3 config preserves an intentionally empty library list during migration', () => {
  const config = normalizeConfig({
    configVersion: 4,
    paths: { baseDir: '/srv/media/youtube' },
    playlists: []
  });
  assert.deepEqual(config.playlists, []);
  assert.equal(config.paths.channelsBaseDir, '/srv/media/youtube-channels');
});

test('channel destinations are independent and playlists keep their own ErsatzTV settings', () => {
  const config = makeConfig();
  const channel = config.channels[0];
  const uploadDestination = channelGlobalDestination(config, channel, 'uploads');
  const videoDestination = channelGlobalDestination(config, channel, 'videos');
  const clipDestination = channelPlaylistDestination(config, channel, channel.playlists[0]);
  const showDestination = channelPlaylistDestination(config, channel, channel.playlists[1]);

  assert.equal(uploadDestination.id, 'channel:UC_TEST_CHANNEL:uploads');
  assert.equal(videoDestination.id, 'channel:UC_TEST_CHANNEL:videos');
  assert.notEqual(uploadDestination.rootPath, videoDestination.rootPath);
  assert.equal(uploadDestination.mediaProfile, 'generic');
  assert.equal(uploadDestination.libraryId, null);
  assert.equal(clipDestination.mediaProfile, 'music_clips');
  assert.equal(clipDestination.libraryId, 31);
  assert.equal(clipDestination.channelNumber, 421);
  assert.equal(showDestination.mediaProfile, 'movie');
  assert.equal(showDestination.libraryId, 42);
  assert.equal(showDestination.channelNumber, 419);
  assert.match(clipDestination.rootPath, /Twenty One Pilots[\\/]Playlists[\\/]Official Music Videos$/);
});

test('channel analysis via yt-dlp returns identity and playlists without touching queue state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v3-analyze-'));
  try {
    const config = makeConfig(root);
    const calls = [];
    const runner = async (_command, args) => {
      calls.push(args);
      const target = args.at(-1);
      if (String(target).endsWith('/playlists')) {
        return {
          code: 0,
          stdout: JSON.stringify({ entries: [
            { id: 'PL_A', title: 'Playlist A', playlist_count: 12 },
            { id: 'PL_B', title: 'Playlist B', playlist_count: 7 }
          ] }),
          stderr: ''
        };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          channel_id: 'UC_ANALYZE',
          channel: 'Canal Teste',
          channel_url: 'https://www.youtube.com/@canalteste',
          thumbnail: 'https://example.invalid/thumb.jpg'
        }),
        stderr: ''
      };
    };
    const catalog = await analyzeChannel(config, 'https://www.youtube.com/@canalteste', { runner });
    assert.equal(catalog.channelId, 'UC_ANALYZE');
    assert.equal(catalog.name, 'Canal Teste');
    assert.equal(catalog.playlists.length, 2);
    assert.equal(catalog.playlists[0].playlistId, 'PL_A');
    assert.deepEqual(catalog.globalSources, ['uploads', 'videos', 'shorts', 'streams']);
    assert.equal(catalog.readMode, 'ytdlp');
    assert.equal(calls.length, 2);
    await assert.rejects(fs.access(path.join(root, 'data', 'download-state.json')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('remote rename updates display names but preserves stable local folders', () => {
  const channel = makeConfig().channels[0];
  const merged = mergeCatalogIntoChannel(channel, {
    channelId: channel.channelId,
    name: 'Twenty One Pilots Official',
    handle: '@twentyonepilots',
    url: channel.url,
    thumbnailUrl: '',
    playlists: [{
      playlistId: 'PL_CLIPS',
      name: 'Music Videos Renamed',
      folderName: 'Music Videos Renamed',
      url: 'https://www.youtube.com/playlist?list=PL_CLIPS'
    }]
  });
  assert.equal(merged.name, 'Twenty One Pilots Official');
  assert.equal(merged.folderName, 'Twenty One Pilots');
  assert.equal(merged.playlists[0].name, 'Music Videos Renamed');
  assert.equal(merged.playlists[0].folderName, 'Official Music Videos');
});

test('completed stream filter rejects live/upcoming and accepts finished broadcasts', () => {
  assert.equal(isCompletedStream({ liveStatus: 'is_live', wasLive: false }), false);
  assert.equal(isCompletedStream({ liveStatus: 'is_upcoming', wasLive: false }), false);
  assert.equal(isCompletedStream({ liveStatus: '', wasLive: false }), false);
  assert.equal(isCompletedStream({ liveStatus: 'was_live', wasLive: false }), true);
  assert.equal(isCompletedStream({ liveStatus: 'not_live', wasLive: false }), true);
  assert.equal(isCompletedStream({ liveStatus: '', wasLive: true }), true);
});

test('shared discovery lock prevents simultaneous broad synchronizations', () => {
  discoveryLock.release();
  assert.equal(discoveryLock.acquire('libraries'), true);
  assert.equal(discoveryLock.acquire('channels'), false);
  assert.equal(discoveryLock.getStatus().owner, 'libraries');
  discoveryLock.release('libraries');
  assert.equal(discoveryLock.acquire('channels'), true);
  discoveryLock.release('channels');
});

test('destination identity allows the same video in different Channel targets and dedupes inside one target', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v3-dedupe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(root);
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);
  const channel = config.channels[0];
  const clipDestination = channelPlaylistDestination(config, channel, channel.playlists[0]);
  const showDestination = channelPlaylistDestination(config, channel, channel.playlists[1]);
  const video = { id: 'abcdefghijk', title: 'Other Artist - Shared Video', channelTitle: 'Other Artist', channelId: 'UC_OTHER' };

  const first = await manager.reconcileDestination(config, clipDestination, [video, video]);
  const second = await manager.reconcileDestination(config, showDestination, [video]);
  assert.equal(first.queued, 1);
  assert.equal(second.queued, 1);
  assert.ok(manager.state.items[makeItemId(clipDestination.id, video.id)]);
  assert.ok(manager.state.items[makeItemId(showDestination.id, video.id)]);
  assert.equal(Object.keys(manager.state.items).length, 2);
});

test('only selected channel destinations are active', () => {
  const config = makeConfig();
  const destinations = getChannelDestinations(config, 'UC_TEST_CHANNEL');
  const ids = destinations.map((destination) => destination.id);
  assert.ok(ids.includes('channel:UC_TEST_CHANNEL:uploads'));
  assert.ok(ids.includes('channel:UC_TEST_CHANNEL:videos'));
  assert.ok(!ids.includes('channel:UC_TEST_CHANNEL:shorts'));
  assert.ok(!ids.includes('channel:UC_TEST_CHANNEL:streams'));
  assert.ok(ids.includes('channel:UC_TEST_CHANNEL:playlist:PL_CLIPS'));
  assert.ok(ids.includes('channel:UC_TEST_CHANNEL:playlist:PL_SHOWS'));
});


test('channel destination marks remotely removed items as orphaned without deleting local state', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-v3-channel-orphan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = makeConfig(root);
  const manager = new DownloadManager({ statePath: path.join(root, 'state.json') });
  await manager.init(config);
  const channel = config.channels[0];
  const destination = channelPlaylistDestination(config, channel, channel.playlists[0]);
  const video = { id: 'orphanvideo1', title: 'Artist - Track', channelTitle: 'Artist' };

  await manager.reconcileDestination(config, destination, [video]);
  const id = makeItemId(destination.id, video.id);
  assert.ok(manager.state.items[id]);

  const summary = await manager.reconcileDestination(config, destination, []);
  assert.equal(summary.orphaned, 1);
  assert.equal(manager.state.items[id].orphaned, true);
  assert.equal(manager.state.items[id].sourceActive, false);
  assert.ok(manager.state.items[id], 'remote removal must preserve the local queue/state item until manual cleanup');
});


test('obsolete manual thumbnail refresh is not a supported Channel Playlist action', async () => {
  const config = makeConfig();
  await assert.rejects(
    runPlaylistAction(config, 'UC_TEST_CHANNEL', 'PL_CLIPS', 'refresh-thumbnails', {}),
    /Acao da playlist nao suportada/
  );
});


test('channel destructive operations reject cleanup or deletion without explicit confirmation', async () => {
  const config = makeConfig();
  await assert.rejects(
    runPlaylistAction(config, 'UC_TEST_CHANNEL', 'PL_CLIPS', 'orphans-cleanup', {}),
    /Confirme a limpeza/
  );
  await assert.rejects(
    deletePlaylistWithFiles(config, 'UC_TEST_CHANNEL', 'PL_CLIPS', 'nome incorreto'),
    /Confirmacao invalida/
  );
  await assert.rejects(
    deleteChannelWithFiles(config, 'UC_TEST_CHANNEL', 'nome incorreto'),
    /Confirmacao invalida/
  );
});
