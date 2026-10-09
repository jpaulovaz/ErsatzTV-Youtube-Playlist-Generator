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

const originalFetch = global.fetch;
const originalGetIndex = playlistService.getIndex;
const originalInsertVideo = playlistService.insertVideo;

async function resetState() {
  await playlistQueue.stop().catch(() => {});
  await Promise.all([
    fs.rm(managerState.STATE_PATH, { force: true }),
    fs.rm(accountState.STATE_PATH, { force: true }),
    fs.rm(accountConfig.CONFIG_PATH, { force: true }),
    fs.rm(process.env.ERSATZTV_YOUTUBE_CACHE_PATH, { force: true })
  ]);
  global.fetch = originalFetch;
  playlistService.getIndex = originalGetIndex;
  playlistService.insertVideo = originalInsertVideo;
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
