const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const accountConfig = require('../src/youtubeManager/youtubeAccountConfig');
const accountState = require('../src/youtubeManager/youtubeAccountState');
const oauth = require('../src/youtubeManager/youtubeOAuthService');
const accountService = require('../src/youtubeManager/youtubeAccountService');
const managerState = require('../src/youtubeManager/youtubeManagerState');
const searchService = require('../src/youtubeManager/youtubeSearchService');
const localCatalog = require('../src/youtubeManager/localCatalogScanner');
const identity = require('../src/youtubeManager/localIdentityExtractor');
const matchScore = require('../src/youtubeManager/matchScore');
const managerService = require('../src/youtubeManager/youtubeManagerService');
const playlistService = require('../src/youtubeManager/youtubePlaylistService');
const playlistQueue = require('../src/youtubeManager/playlistQueue');
const adoptionService = require('../src/youtubeManager/adoptionService');
const adoptionState = require('../src/youtubeManager/youtubeAdoptionState');
const adoptionQueue = require('../src/youtubeManager/adoptionQueue');

const originalFetch = global.fetch;
const originalGetIndex = playlistService.getIndex;
const originalInsertVideo = playlistService.insertVideo;
const originalAdopt = adoptionService.adopt;

async function resetState() {
  await playlistQueue.stop().catch(() => {});
  await adoptionQueue.stop().catch(() => {});
  await Promise.all([
    fs.rm(managerState.STATE_PATH, { force: true }),
    fs.rm(accountState.STATE_PATH, { force: true }),
    fs.rm(accountConfig.CONFIG_PATH, { force: true }),
    fs.rm(adoptionState.STATE_PATH, { force: true }),
    fs.rm(process.env.ERSATZTV_YOUTUBE_CACHE_PATH, { force: true })
  ]);
  global.fetch = originalFetch;
  playlistService.getIndex = originalGetIndex;
  playlistService.insertVideo = originalInsertVideo;
  adoptionService.adopt = originalAdopt;
}

test.beforeEach(resetState);
test.after(resetState);

test('youtube account config uses canonical johnflix HTTPS callback and masks the client secret', async () => {
  const saved = await accountConfig.save({
    clientId: 'client.apps.googleusercontent.com',
    clientSecret: 'super-secret',
    publicBaseUrl: 'https://yt.johnflix.com.br/'
  });
  assert.equal(accountConfig.redirectUri(saved), 'https://yt.johnflix.com.br/api/youtube-manager/oauth/callback');
  const publicValue = accountConfig.publicStatus(saved);
  assert.equal(publicValue.clientId, 'client.apps.googleusercontent.com');
  assert.equal(publicValue.clientSecretConfigured, true);
  assert.equal('clientSecret' in publicValue, false);
  const stat = await fs.stat(accountConfig.CONFIG_PATH);
  assert.equal(stat.mode & 0o077, 0);
  assert.throws(() => accountConfig.normalize({ publicBaseUrl: 'http://192.168.1.20:3099/' }), /HTTPS|IP bruto/);
});

test('oauth flow sends exact redirect URI, validates state and stores offline tokens server-side', async () => {
  await accountConfig.save({ clientId: 'client-id', clientSecret: 'client-secret', publicBaseUrl: 'https://yt.johnflix.com.br/' });
  const start = await oauth.startAuthorization();
  const authUrl = new URL(start.authorizationUrl);
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://yt.johnflix.com.br/api/youtube-manager/oauth/callback');
  assert.equal(authUrl.searchParams.get('access_type'), 'offline');
  assert.equal(authUrl.searchParams.get('scope'), oauth.YOUTUBE_SCOPE);

  global.fetch = async (url) => {
    assert.equal(String(url), oauth.TOKEN_ENDPOINT);
    return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: oauth.YOUTUBE_SCOPE, token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await oauth.handleCallback({ state: authUrl.searchParams.get('state'), code: 'code-123' });
  const state = await accountState.load();
  assert.equal(state.tokens.refreshToken, 'refresh');
  assert.equal(state.tokens.accessToken, 'access');
  assert.ok(state.scopes.includes(oauth.YOUTUBE_SCOPE));
  await assert.rejects(() => oauth.handleCallback({ state: 'wrong', code: 'x' }), /State OAuth invalido/);
});

test('public search accepts direct Video ID without calling search.list and enriches with videos.list', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/youtube/v3/videos');
    return new Response(JSON.stringify({ items: [{
      id: 'dQw4w9WgXcQ',
      snippet: { title: 'Example', channelTitle: 'Artist', publishedAt: '2020-01-02T00:00:00Z', thumbnails: { default: { url: 'https://img.test/x.jpg' } } },
      contentDetails: { duration: 'PT4M32S' },
      status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' }
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await searchService.search({ youtubeApi: { apiKey: 'key', timeoutSeconds: 5, cacheTtlHours: 1 } }, { query: 'dQw4w9WgXcQ' });
  assert.equal(result.direct, true);
  assert.equal(result.results[0].duration, 272);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/videos?'));
});

test('match scoring uses title, artist and duration so close official clip outranks live version', () => {
  const local = { inferredArtist: 'Queen', inferredTitle: 'I Want To Break Free', duration: 271 };
  const official = matchScore.scoreCandidate(local, { title: 'Queen - I Want To Break Free (Official Video)', channelTitle: 'Queen Official', duration: 272 });
  const live = matchScore.scoreCandidate(local, { title: 'Queen - I Want To Break Free Live at Wembley', channelTitle: 'Random Live', duration: 349 });
  assert.ok(official.total >= 92, `expected high confidence, got ${official.total}`);
  assert.ok(official.total > live.total);
  assert.equal(official.level, 'high');
});

test('local catalog scan is read-only and recovers a YouTube ID from filename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-catalog-'));
  try {
    const file = path.join(root, 'Queen - Example [dQw4w9WgXcQ].mp4');
    await fs.writeFile(file, 'not-a-real-video');
    const source = await localCatalog.addSource({ rootPath: root, name: 'Antigos', recursive: true });
    const summary = await localCatalog.scanSource(source.id, { paths: { ffprobePath: '/usr/bin/ffprobe' } });
    assert.equal(summary.files, 1);
    assert.equal(summary.recoveredIds, 1);
    const page = await localCatalog.listItems({ sourceId: source.id, limit: 10, present: 'true' });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].recoveredVideoId, 'dQw4w9WgXcQ');
    assert.equal(page.items[0].matchSource, 'filename');
    assert.equal(await fs.readFile(file, 'utf8'), 'not-a-real-video');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('catalog scan exposes per-file progress and background job status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-scan-progress-'));
  try {
    await fs.writeFile(path.join(root, 'Artist - One [AAAAAAAAAAA].mp4'), 'x');
    await fs.writeFile(path.join(root, 'Artist - Two [BBBBBBBBBBB].mp4'), 'y');
    const source = await localCatalog.addSource({ rootPath: root, name: 'Acervo 300', recursive: true });
    const events = [];
    const summary = await localCatalog.scanSource(source.id, { paths: { ffprobePath: '/usr/bin/ffprobe' } }, { onProgress: (event) => events.push({ ...event }) });
    assert.equal(summary.files, 2);
    assert.ok(events.some((event) => event.phase === 'listing'));
    assert.ok(events.some((event) => event.phase === 'scanning' && event.currentFile));
    assert.ok(events.some((event) => event.phase === 'completed' && event.processed === 2));

    const background = await localCatalog.startScanSource(source.id, { paths: { ffprobePath: '/usr/bin/ffprobe' } });
    assert.equal(background.sourceName, 'Acervo 300');
    let job = background;
    for (let i = 0; i < 100 && job.status === 'running'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      job = localCatalog.getScanStatus({ jobId: background.id });
    }
    assert.equal(job.status, 'completed');
    assert.equal(job.summary.files, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('bulk validation confirms strong recovered IDs and leaves large duration mismatches for manual review', async () => {
  await managerState.save({
    ...managerState.emptyState(),
    sources: { src1: { id: 'src1', name: 'Clipes', rootPath: '/tmp/clipes' } },
    localItems: {
      a: { id: 'a', sourceId: 'src1', present: true, recoveredVideoId: 'AAAAAAAAAAA', matchSource: 'embedded', inferredArtist: 'Artist', inferredTitle: 'Song A', duration: 240 },
      b: { id: 'b', sourceId: 'src1', present: true, recoveredVideoId: 'BBBBBBBBBBB', matchSource: 'filename', inferredArtist: 'Artist', inferredTitle: 'Song B', duration: 200 }
    }
  });
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/youtube/v3/videos');
    const requested = new Set((parsed.searchParams.get('id') || '').split(','));
    const items = [];
    if (requested.has('AAAAAAAAAAA')) items.push({
      id: 'AAAAAAAAAAA',
      snippet: { title: 'Artist - Song A', channelTitle: 'Artist', publishedAt: '2020-01-01T00:00:00Z', thumbnails: {} },
      contentDetails: { duration: 'PT4M1S' },
      status: { privacyStatus: 'public', uploadStatus: 'processed' }
    });
    if (requested.has('BBBBBBBBBBB')) items.push({
      id: 'BBBBBBBBBBB',
      snippet: { title: 'Artist - Song B', channelTitle: 'Artist', publishedAt: '2020-01-01T00:00:00Z', thumbnails: {} },
      contentDetails: { duration: 'PT5M' },
      status: { privacyStatus: 'public', uploadStatus: 'processed' }
    });
    return new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await managerService.confirmRecoveredMatches({ youtubeApi: { apiKey: 'key', timeoutSeconds: 5, cacheTtlHours: 1 } }, { sourceId: 'src1' });
  assert.equal(result.candidates, 2);
  assert.equal(result.confirmed, 1);
  assert.equal(result.blocked, 1);
  const state = await managerState.load();
  assert.equal(state.matches.a.status, 'confirmed');
  assert.equal(state.matches.a.confirmationMode, 'bulk-recovered');
  assert.equal(state.matches.b, undefined);
  assert.equal(result.details.find((item) => item.itemId === 'b').reason, 'duration-difference');
});

test('identity helper recognizes video IDs in filenames, URLs and metadata text', () => {
  assert.equal(identity.findVideoIdInText('Artist - Song [dQw4w9WgXcQ].mp4'), 'dQw4w9WgXcQ');
  assert.equal(identity.findVideoIdInText('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(identity.cleanStem('/tmp/Artist - Song [dQw4w9WgXcQ] [1080p].mp4'), 'Artist - Song');
});

test('playlist queue serializes inserts, skips existing IDs and persists completion', async () => {
  const inserted = [];
  playlistService.getIndex = async () => ({ items: [], videoIds: new Set(['AAAAAAAAAAA']) });
  playlistService.insertVideo = async (playlistId, videoId) => { inserted.push([playlistId, videoId]); return { playlistItemId: `pi-${videoId}` }; };
  await playlistQueue.init();
  const job = await playlistQueue.start({
    playlistId: 'PL123', playlistTitle: 'Migracao',
    entries: [{ videoId: 'AAAAAAAAAAA' }, { videoId: 'BBBBBBBBBBB' }, { videoId: 'CCCCCCCCCCC' }]
  });
  for (let i = 0; i < 100; i += 1) {
    const state = await playlistQueue.getStatus();
    const current = state.jobs.find((value) => value.id === job.id);
    if (current && current.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const status = await playlistQueue.getStatus();
  const completed = status.jobs.find((value) => value.id === job.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.counts.skipped, 1);
  assert.equal(completed.counts.completed, 2);
  assert.deepEqual(inserted.map((x) => x[1]), ['BBBBBBBBBBB', 'CCCCCCCCCCC']);
});

test('bulk playlist planning blocks confirmed duplicate videoId conflicts', async () => {
  await managerState.save({
    ...managerState.emptyState(),
    localItems: {
      a: { id: 'a', present: true, inferredTitle: 'A' },
      b: { id: 'b', present: true, inferredTitle: 'B' }
    },
    matches: {
      a: { itemId: 'a', status: 'confirmed', videoId: 'AAAAAAAAAAA' },
      b: { itemId: 'b', status: 'confirmed', videoId: 'AAAAAAAAAAA' }
    }
  });
  const resolved = await managerService.resolveEntries({ itemIds: ['a', 'b'] });
  assert.equal(resolved.entries.length, 0);
  assert.equal(resolved.blocked.length, 2);
  assert.ok(resolved.blocked.every((x) => x.reason === 'video-id-conflict'));
});

test('account service refreshes public channel identity with server-side bearer token', async () => {
  await accountConfig.save({ clientId: 'client-id', clientSecret: 'client-secret', publicBaseUrl: 'https://yt.johnflix.com.br/' });
  await accountState.save({
    ...accountState.emptyState(),
    tokens: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 3600000).toISOString() },
    scopes: [oauth.YOUTUBE_SCOPE]
  });
  global.fetch = async (url, options) => {
    assert.ok(String(url).includes('/youtube/v3/channels?'));
    assert.equal(options.headers.Authorization, 'Bearer access');
    return new Response(JSON.stringify({ items: [{ id: 'UC123', snippet: { title: 'Minha Conta', thumbnails: { default: { url: 'https://img.test/a.jpg' } } } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const account = await accountService.refreshAccountSummary();
  assert.equal(account.channelId, 'UC123');
  assert.equal(account.title, 'Minha Conta');
  const status = await accountService.getStatus();
  assert.equal(status.connected, true);
  assert.equal(status.scopeGranted, true);
});

test('identity helper does not mistake arbitrary eleven-character words for YouTube IDs', () => {
  assert.equal(identity.findVideoIdInText('Performance - Example.mp4'), '');
  assert.equal(identity.findVideoIdInText('ABCDEFGHIJK'), 'ABCDEFGHIJK');
  assert.equal(identity.findVideoIdInText('[ABCDEFGHIJK]'), 'ABCDEFGHIJK');
});

test('quota day key follows the YouTube Pacific reset day', () => {
  const quotaTracker = require('../src/youtubeManager/quotaTracker');
  // 00:30 UTC on Jan 2 is still Jan 1 in Los Angeles during standard time.
  assert.equal(quotaTracker.dateKey(new Date('2026-01-02T00:30:00Z')), '2026-01-01');
});

test('cancelling a playlist job while one insert is running keeps the finished item and cancels pending work', async () => {
  let releaseInsert;
  let insertStarted = false;
  const gate = new Promise((resolve) => { releaseInsert = resolve; });
  playlistService.getIndex = async () => ({ items: [], videoIds: new Set() });
  playlistService.insertVideo = async (playlistId, videoId) => {
    insertStarted = true;
    await gate;
    return { playlistItemId: `pi-${videoId}` };
  };
  await playlistQueue.init();
  const job = await playlistQueue.start({
    playlistId: 'PL123', playlistTitle: 'Migracao',
    entries: [{ videoId: 'BBBBBBBBBBB' }, { videoId: 'CCCCCCCCCCC' }]
  });
  for (let i = 0; i < 100 && !insertStarted; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(insertStarted, true);
  await playlistQueue.cancelPending(job.id);
  releaseInsert();
  for (let i = 0; i < 100; i += 1) {
    const state = await playlistQueue.getStatus();
    const current = state.jobs.find((value) => value.id === job.id);
    if (current && current.status === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const final = (await playlistQueue.getStatus()).jobs.find((value) => value.id === job.id);
  assert.equal(final.status, 'cancelled');
  assert.equal(final.counts.completed, 1);
  assert.equal(final.counts.cancelled, 1);
});

test('adoption preflight warns above 10 seconds and blocks above 45 seconds', async () => {
  const adoption = require('../src/youtubeManager/adoptionService');
  assert.deepEqual(adoption.durationAssessment(271, 272), { differenceSeconds: 1, level: 'ok' });
  assert.deepEqual(adoption.durationAssessment(271, 286), { differenceSeconds: 15, level: 'warning' });
  assert.deepEqual(adoption.durationAssessment(271, 317), { differenceSeconds: 46, level: 'block' });
});

test('hardlink adoption creates managed media and NFO while preserving the original and legacy sidecars', async () => {
  const adoption = require('../src/youtubeManager/adoptionService');
  const adoptionState = require('../src/youtubeManager/youtubeAdoptionState');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-adopt-hardlink-'));
  const sourceRoot = path.join(root, 'source');
  const baseDir = path.join(root, 'managed');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(baseDir, { recursive: true });
  const sourcePath = path.join(sourceRoot, 'Artist - Song.mp4');
  const legacyNfo = path.join(sourceRoot, 'Artist - Song.nfo');
  await fs.writeFile(sourcePath, 'media-bytes');
  await fs.writeFile(legacyNfo, '<legacy/>');
  const targetPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Song.mp4');
  const nfoPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Song.nfo');
  const itemId = 'local_adopt_hardlink';
  const videoId = 'AAAAAAAAAAA';
  await managerState.save({
    ...managerState.emptyState(),
    sources: { src: { id: 'src', rootPath: sourceRoot, name: 'Source' } },
    localItems: { [itemId]: { id: itemId, sourceId: 'src', path: sourcePath, relativePath: 'Artist - Song.mp4', present: true, duration: 200, inferredArtist: 'Artist', inferredTitle: 'Song', sidecars: { nfo: legacyNfo } } },
    matches: { [itemId]: { itemId, status: 'confirmed', videoId, title: 'Artist - Song', channelTitle: 'Artist', duration: 200 } }
  });
  await fs.rm(adoptionState.STATE_PATH, { force: true });
  const managedId = `Managed::${videoId}`;
  const fakeManager = {
    initialized: true, config: null, current: null, currentPromise: null,
    state: { items: { [managedId]: { id: managedId, libraryFolder: 'Managed', destinationId: 'Managed', videoId, title: 'Artist - Song', channelTitle: 'Artist', targetPath, nfoPath, thumbnailPath: path.join(baseDir, 'Managed', 'Artist', 'Artist - Song.jpg'), sourceActive: true, status: 'pending' } }, libraries: {} },
    configure(config) { this.config = config; },
    async validateMedia() { return { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', video: { codec_name: 'h264' }, audio: { codec_name: 'aac' } }; },
    async ensureReleaseMetadata(item) { return item; },
    ensureLibraryState(id) { this.state.libraries[id] ||= {}; return this.state.libraries[id]; },
    async saveNow() {}, beginExternalMutation() {}, endExternalMutation() {}
  };
  const config = { paths: { baseDir }, downloads: { writeThumbnails: false, minFreeSpaceGb: 0 }, playlists: [{ name: 'Managed', enabled: true, mediaProfile: 'generic', url: 'https://www.youtube.com/playlist?list=PLX' }], channels: [] };
  const result = await adoption.adopt(config, { itemId, destinationId: 'Managed', mode: 'hardlink', confirmed: true }, { manager: fakeManager, remoteVideo: { id: videoId, title: 'Artist - Song', channelTitle: 'Artist', duration: 200 } });
  assert.equal(result.status, 'completed');
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'media-bytes');
  assert.equal(await fs.readFile(legacyNfo, 'utf8'), '<legacy/>');
  assert.match(await fs.readFile(nfoPath, 'utf8'), /AAAAAAAAAAA/);
  const [sourceStat, targetStat] = await Promise.all([fs.stat(sourcePath), fs.stat(targetPath)]);
  assert.equal(sourceStat.ino, targetStat.ino);
  assert.equal(fakeManager.state.items[managedId].acquisition.type, 'adopted-local');
  const catalog = await localCatalog.getItem(itemId);
  assert.equal(catalog.adoptionState.status, 'adopted');
  await fs.rm(root, { recursive: true, force: true });
});

test('failed adoption rolls back created media and restores the managed item', async () => {
  const adoption = require('../src/youtubeManager/adoptionService');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-adopt-rollback-'));
  const sourceRoot = path.join(root, 'source'); const baseDir = path.join(root, 'managed');
  await fs.mkdir(sourceRoot, { recursive: true }); await fs.mkdir(baseDir, { recursive: true });
  const sourcePath = path.join(sourceRoot, 'Artist - Broken.mp4'); await fs.writeFile(sourcePath, 'media-bytes');
  const targetPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Broken.mp4'); const nfoPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Broken.nfo');
  const itemId = 'local_adopt_rollback'; const videoId = 'BBBBBBBBBBB'; const managedId = `Managed::${videoId}`;
  await managerState.save({ ...managerState.emptyState(), sources: { src: { id: 'src', rootPath: sourceRoot } }, localItems: { [itemId]: { id: itemId, sourceId: 'src', path: sourcePath, relativePath: 'Artist - Broken.mp4', present: true, duration: 200 } }, matches: { [itemId]: { itemId, status: 'confirmed', videoId, title: 'Artist - Broken', duration: 200 } } });
  const original = { id: managedId, libraryFolder: 'Managed', destinationId: 'Managed', videoId, title: 'Artist - Broken', targetPath, nfoPath, thumbnailPath: path.join(baseDir, 'Managed', 'Artist', 'Artist - Broken.jpg'), sourceActive: true, status: 'pending' };
  const fakeManager = { initialized: true, current: null, currentPromise: null, state: { items: { [managedId]: JSON.parse(JSON.stringify(original)) }, libraries: {} }, configure() {}, async validateMedia() { return { formatName: 'mp4', video: { codec_name: 'h264' }, audio: { codec_name: 'aac' } }; }, async ensureReleaseMetadata() { throw new Error('metadata failure'); }, ensureLibraryState(id) { this.state.libraries[id] ||= {}; return this.state.libraries[id]; }, async saveNow() {}, beginExternalMutation() {}, endExternalMutation() {} };
  const config = { paths: { baseDir }, downloads: { writeThumbnails: false, minFreeSpaceGb: 0 }, playlists: [{ name: 'Managed', enabled: true, mediaProfile: 'generic', url: 'https://www.youtube.com/playlist?list=PLX' }], channels: [] };
  await assert.rejects(() => adoption.adopt(config, { itemId, destinationId: 'Managed', mode: 'copy', confirmed: true }, { manager: fakeManager, remoteVideo: { id: videoId, title: 'Artist - Broken', duration: 200 } }), /metadata failure/);
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'media-bytes');
  await assert.rejects(() => fs.stat(targetPath), /ENOENT/);
  assert.equal(fakeManager.state.items[managedId].status, 'pending');
  await fs.rm(root, { recursive: true, force: true });
});

test('move adoption removes only the source video at final commit and preserves old sidecars', async () => {
  const adoption = require('../src/youtubeManager/adoptionService');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-adopt-move-'));
  const sourceRoot = path.join(root, 'source'); const baseDir = path.join(root, 'managed');
  await fs.mkdir(sourceRoot, { recursive: true }); await fs.mkdir(baseDir, { recursive: true });
  const sourcePath = path.join(sourceRoot, 'Artist - Move.mp4'); const oldSubtitle = path.join(sourceRoot, 'Artist - Move.pt-BR.srt');
  await fs.writeFile(sourcePath, 'move-media'); await fs.writeFile(oldSubtitle, 'legacy subtitle');
  const targetPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Move.mp4'); const nfoPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Move.nfo');
  const itemId = 'local_adopt_move'; const videoId = 'CCCCCCCCCCC'; const managedId = `Managed::${videoId}`;
  await managerState.save({ ...managerState.emptyState(), sources: { src: { id: 'src', rootPath: sourceRoot } }, localItems: { [itemId]: { id: itemId, sourceId: 'src', path: sourcePath, relativePath: 'Artist - Move.mp4', present: true, duration: 210 } }, matches: { [itemId]: { itemId, status: 'confirmed', videoId, title: 'Artist - Move', duration: 210 } } });
  const fakeManager = { initialized: true, current: null, currentPromise: null, state: { items: { [managedId]: { id: managedId, libraryFolder: 'Managed', destinationId: 'Managed', videoId, title: 'Artist - Move', targetPath, nfoPath, thumbnailPath: path.join(baseDir, 'Managed', 'Artist', 'Artist - Move.jpg'), sourceActive: true, status: 'pending' } }, libraries: {} }, configure() {}, async validateMedia() { return { formatName: 'mp4', video: { codec_name: 'h264' }, audio: { codec_name: 'aac' } }; }, async ensureReleaseMetadata(item) { return item; }, ensureLibraryState(id) { this.state.libraries[id] ||= {}; return this.state.libraries[id]; }, async saveNow() {}, beginExternalMutation() {}, endExternalMutation() {} };
  const config = { paths: { baseDir }, downloads: { writeThumbnails: false, minFreeSpaceGb: 0 }, playlists: [{ name: 'Managed', enabled: true, mediaProfile: 'generic', url: 'https://www.youtube.com/playlist?list=PLX' }], channels: [] };
  await adoption.adopt(config, { itemId, destinationId: 'Managed', mode: 'move', confirmed: true, moveConfirmed: true }, { manager: fakeManager, remoteVideo: { id: videoId, title: 'Artist - Move', duration: 210 } });
  await assert.rejects(() => fs.stat(sourcePath), /ENOENT/);
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'move-media');
  assert.equal(await fs.readFile(oldSubtitle, 'utf8'), 'legacy subtitle');
  await fs.rm(root, { recursive: true, force: true });
});


test('restart recovery restores a Move source and removes transaction-owned artifacts even before createdPaths was checkpointed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-adopt-recover-'));
  try {
    const sourceRoot = path.join(root, 'source'); const baseDir = path.join(root, 'managed');
    await fs.mkdir(sourceRoot, { recursive: true }); await fs.mkdir(baseDir, { recursive: true });
    const sourcePath = path.join(sourceRoot, 'Artist - Crash.mp4');
    const targetPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Crash.mp4');
    const nfoPath = path.join(baseDir, 'Managed', 'Artist', 'Artist - Crash.nfo');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'recover-media'); await fs.writeFile(nfoPath, '<nfo/>');
    const itemId = 'local_adopt_recover'; const videoId = 'DDDDDDDDDDD'; const managedId = `Managed::${videoId}`;
    await managerState.save({
      ...managerState.emptyState(),
      localItems: { [itemId]: { id: itemId, adoptionState: { status: 'adopting', transactionId: 'tx-crash' } } }
    });
    const previousManagedItem = { id: managedId, libraryFolder: 'Managed', destinationId: 'Managed', videoId, targetPath, nfoPath, sourceActive: true, status: 'pending' };
    const fakeManager = {
      initialized: true,
      state: { items: { [managedId]: { ...previousManagedItem, status: 'completed' } }, libraries: {} },
      configure() {}, async saveNow() {}
    };
    await adoptionState.save({
      ...adoptionState.emptyState(),
      transactions: {
        'tx-crash': {
          id: 'tx-crash', itemId, managedItemId: managedId, destinationId: 'Managed', videoId, mode: 'move', status: 'running',
          sourcePath, targetPath,
          manifest: { ownedPaths: [targetPath, nfoPath], createdPaths: [], sourceRemoved: false, previousManagedItem, previousCatalogAdoptionState: null }
        }
      }
    });
    const recovered = await adoptionService.recover({}, { manager: fakeManager });
    assert.deepEqual(recovered, [{ id: 'tx-crash', status: 'rolled-back' }]);
    assert.equal(await fs.readFile(sourcePath, 'utf8'), 'recover-media');
    await assert.rejects(() => fs.stat(targetPath), /ENOENT/);
    await assert.rejects(() => fs.stat(nfoPath), /ENOENT/);
    assert.equal(fakeManager.state.items[managedId].status, 'pending');
    assert.equal((await localCatalog.getItem(itemId)).adoptionState, null);
    assert.equal((await adoptionState.load()).transactions['tx-crash'].status, 'rolled-back');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('adoption queue honors a pending cancellation after restart', async () => {
  await adoptionState.save({
    ...adoptionState.emptyState(),
    queue: {
      paused: true,
      activeJobId: 'job-cancelled',
      jobs: {
        'job-cancelled': {
          id: 'job-cancelled', destinationId: 'Managed', mode: 'copy', status: 'running', cancelRequested: true, createdAt: new Date().toISOString(),
          items: [{ id: 'queued-item', itemId: 'local-one', status: 'running', createdAt: new Date().toISOString() }]
        }
      }
    }
  });
  await adoptionQueue.init(async () => ({}));
  const status = await adoptionQueue.getStatus();
  const job = status.jobs.find((entry) => entry.id === 'job-cancelled');
  assert.equal(job.status, 'cancelled');
  assert.equal(job.counts.cancelled, 1);
  assert.equal(job.counts.pending, 0);
  await adoptionQueue.stop();
});

test('adoption queue defers instead of busy-spinning while a download is active', async () => {
  let calls = 0;
  adoptionService.adopt = async () => {
    calls += 1;
    const error = new Error('download busy'); error.code = 'DOWNLOAD_BUSY'; throw error;
  };
  await adoptionQueue.init(async () => ({}));
  await adoptionQueue.start({ itemIds: ['local-busy'], destinationId: 'Managed', mode: 'copy', confirmed: true });
  for (let i = 0; i < 20 && calls === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls, 1);
  const status = await adoptionQueue.getStatus();
  assert.equal(status.latestJob.items[0].status, 'pending');
  await adoptionQueue.stop();
});

test('single recovered ID validation confirms safely without opening review and keeps duration guardrails', async () => {
  await managerState.save({
    ...managerState.emptyState(),
    localItems: {
      safe: { id: 'safe', sourceId: 'src', present: true, relativePath: 'Safe.mp4', recoveredVideoId: 'AAAAAAAAAAA', matchSource: 'embedded', duration: 197 },
      blocked: { id: 'blocked', sourceId: 'src', present: true, relativePath: 'Blocked.mp4', recoveredVideoId: 'BBBBBBBBBBB', matchSource: 'filename', duration: 100 }
    }
  });
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/youtube/v3/videos');
    const id = parsed.searchParams.get('id');
    const items = [];
    if (id && id.includes('AAAAAAAAAAA')) items.push({ id: 'AAAAAAAAAAA', snippet: { title: 'Ace of Base - The Sign', channelTitle: 'Ace of Base', thumbnails: {} }, contentDetails: { duration: 'PT3M17S' }, status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' } });
    if (id && id.includes('BBBBBBBBBBB')) items.push({ id: 'BBBBBBBBBBB', snippet: { title: 'Wrong Cut', channelTitle: 'Artist', thumbnails: {} }, contentDetails: { duration: 'PT2M30S' }, status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' } });
    return new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const config = { youtubeApi: { apiKey: 'key', timeoutSeconds: 5, cacheTtlHours: 1 } };
  const confirmed = await managerService.confirmRecoveredItem(config, { itemId: 'safe' });
  assert.equal(confirmed.match.status, 'confirmed');
  assert.equal(confirmed.match.videoId, 'AAAAAAAAAAA');
  assert.equal(confirmed.match.confirmationMode, 'single-recovered');
  assert.equal(confirmed.warning, false);
  await assert.rejects(
    () => managerService.confirmRecoveredItem(config, { itemId: 'blocked' }),
    (error) => error && error.code === 'DURATION_DIFFERENCE_BLOCKED' && /45s/.test(error.message)
  );
});

test('catalog shows managed destinations for recovered or confirmed IDs and filters library presence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-catalog-managed-'));
  try {
    const baseDir = path.join(root, 'managed');
    const targetPath = path.join(baseDir, 'Managed', 'Artist - Confirmed.mp4');
    const adoptedPath = path.join(baseDir, 'Managed', 'Artist - Adopted.mp4');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'managed-media');
    await fs.writeFile(adoptedPath, 'adopted-media');
    await managerState.save({
      ...managerState.emptyState(),
      sources: { src: { id: 'src', name: 'Clipes', rootPath: root } },
      localItems: {
        recovered: { id: 'recovered', sourceId: 'src', present: true, relativePath: 'Recovered.mp4', recoveredVideoId: 'AAAAAAAAAAA', matchSource: 'embedded' },
        confirmed: { id: 'confirmed', sourceId: 'src', present: true, relativePath: 'Confirmed.mp4' },
        absent: { id: 'absent', sourceId: 'src', present: true, relativePath: 'Absent.mp4', recoveredVideoId: 'CCCCCCCCCCC', matchSource: 'filename' },
        adopted: { id: 'adopted', sourceId: 'src', present: true, relativePath: 'Adopted.mp4', recoveredVideoId: 'DDDDDDDDDDD', matchSource: 'embedded', adoptionState: { status: 'adopted', destinationId: 'Managed', mode: 'hardlink' } }
      },
      matches: { confirmed: { itemId: 'confirmed', status: 'confirmed', videoId: 'BBBBBBBBBBB', title: 'Artist - Confirmed' } }
    });
    const fakeManager = {
      initialized: true,
      state: {
        items: {
          'Managed::AAAAAAAAAAA': { id: 'Managed::AAAAAAAAAAA', destinationId: 'Managed', libraryFolder: 'Managed', videoId: 'AAAAAAAAAAA', sourceActive: true, status: 'pending', targetPath: '' },
          'Managed::BBBBBBBBBBB': { id: 'Managed::BBBBBBBBBBB', destinationId: 'Managed', libraryFolder: 'Managed', videoId: 'BBBBBBBBBBB', sourceActive: true, status: 'completed', targetPath },
          'Managed::DDDDDDDDDDD': { id: 'Managed::DDDDDDDDDDD', destinationId: 'Managed', libraryFolder: 'Managed', videoId: 'DDDDDDDDDDD', sourceActive: true, status: 'completed', targetPath: adoptedPath }
        }
      }
    };
    const config = { paths: { baseDir }, playlists: [{ name: 'Managed', enabled: true, mediaProfile: 'generic', url: 'https://www.youtube.com/playlist?list=PLX' }], channels: [] };
    const present = await managerService.listCatalogItems(config, { sourceId: 'src', present: 'true', libraryPresence: 'present', limit: 20 }, { manager: fakeManager });
    assert.deepEqual(present.items.map((item) => item.id).sort(), ['adopted', 'confirmed', 'recovered']);
    const recovered = present.items.find((item) => item.id === 'recovered');
    assert.equal(recovered.match, null);
    assert.equal(recovered.identityVideoId, 'AAAAAAAAAAA');
    assert.equal(recovered.managedDestinations[0].displayName, 'Managed');
    assert.equal(recovered.managedDestinations[0].hasMedia, false);
    const confirmed = present.items.find((item) => item.id === 'confirmed');
    assert.equal(confirmed.managedDestinations[0].hasMedia, true);

    const missing = await managerService.listCatalogItems(config, { sourceId: 'src', present: 'true', libraryPresence: 'absent', limit: 20 }, { manager: fakeManager });
    assert.deepEqual(missing.items.map((item) => item.id), ['absent']);

    const awaitingMedia = await managerService.listCatalogItems(config, { sourceId: 'src', present: 'true', libraryPresence: 'awaiting-media', limit: 20 }, { manager: fakeManager });
    assert.deepEqual(awaitingMedia.items.map((item) => item.id), ['recovered']);

    const mediaPresent = await managerService.listCatalogItems(config, { sourceId: 'src', present: 'true', libraryPresence: 'media-present', limit: 20 }, { manager: fakeManager });
    assert.deepEqual(mediaPresent.items.map((item) => item.id), ['confirmed']);

    const adopted = await managerService.listCatalogItems(config, { sourceId: 'src', present: 'true', libraryPresence: 'adopted', limit: 20 }, { manager: fakeManager });
    assert.deepEqual(adopted.items.map((item) => item.id), ['adopted']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('playlist queue persists catalog-facing playlist status for local items', async () => {
  await managerState.save({
    ...managerState.emptyState(),
    localItems: {
      existing: { id: 'existing', present: true, relativePath: 'Existing.mp4' },
      inserted: { id: 'inserted', present: true, relativePath: 'Inserted.mp4' }
    }
  });
  playlistService.getIndex = async () => ({ items: [], videoIds: new Set(['AAAAAAAAAAA']) });
  playlistService.insertVideo = async (playlistId, videoId) => ({ playlistItemId: `${playlistId}-${videoId}` });
  await playlistQueue.init();
  const job = await playlistQueue.start({
    playlistId: 'PLSTATUS', playlistTitle: 'Migracao',
    entries: [
      { videoId: 'AAAAAAAAAAA', localItemId: 'existing' },
      { videoId: 'BBBBBBBBBBB', localItemId: 'inserted' }
    ]
  });
  for (let i = 0; i < 100; i += 1) {
    const queue = await playlistQueue.getStatus();
    const current = queue.jobs.find((value) => value.id === job.id);
    if (current && current.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const state = await managerState.load();
  assert.equal(state.localItems.existing.playlistState.playlists.PLSTATUS.status, 'already-existing');
  assert.equal(state.localItems.inserted.playlistState.playlists.PLSTATUS.status, 'added');
  assert.equal(state.localItems.inserted.playlistState.playlists.PLSTATUS.playlistTitle, 'Migracao');

  const fakeManager = { initialized: true, state: { items: {} } };
  const config = { paths: { baseDir: os.tmpdir() }, playlists: [], channels: [] };
  const page = await managerService.listCatalogItems(config, { playlistStatus: 'added', limit: 20 }, { manager: fakeManager });
  assert.deepEqual(page.items.map((item) => item.id).sort(), ['existing', 'inserted']);
});

test('playlist preflight records already-existing membership even when no insert job is created', async () => {
  await accountConfig.save({ clientId: 'client-id', clientSecret: 'client-secret', publicBaseUrl: 'https://yt.johnflix.com.br/' });
  await accountState.save({
    ...accountState.emptyState(),
    tokens: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 3600000).toISOString() },
    scopes: [oauth.YOUTUBE_SCOPE]
  });
  await managerState.save({
    ...managerState.emptyState(),
    localItems: { local: { id: 'local', present: true, relativePath: 'Local.mp4' } },
    matches: { local: { itemId: 'local', status: 'confirmed', videoId: 'AAAAAAAAAAA', title: 'Local' } }
  });
  playlistService.getIndex = async () => ({ items: [], videoIds: new Set(['AAAAAAAAAAA']) });
  const plan = await managerService.planPlaylist({ playlistId: 'PLKNOWN', playlistTitle: 'Ja existente', itemIds: ['local'] });
  assert.equal(plan.eligible, 0);
  assert.equal(plan.alreadyExists, 1);
  const state = await managerState.load();
  assert.equal(state.localItems.local.playlistState.playlists.PLKNOWN.status, 'already-existing');
  assert.equal(state.localItems.local.playlistState.playlists.PLKNOWN.playlistTitle, 'Ja existente');
});
