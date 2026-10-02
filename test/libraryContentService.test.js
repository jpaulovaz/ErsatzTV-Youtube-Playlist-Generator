const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeBrowserPath,
  safeRelativeFile,
  listLibraryContent,
  getLibraryThumbnail,
  getLibraryFolderPoster
} = require('../src/libraryContentService');

function makeManager(items) {
  return {
    getItemsPage(options = {}) {
      const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
      const offset = Math.max(0, Number(options.offset) || 0);
      const library = String(options.library || '');
      const filtered = items.filter((item) => !library || item.libraryFolder === library);
      const page = filtered.slice(offset, offset + limit);
      return {
        items: page.map((item) => JSON.parse(JSON.stringify(item))),
        total: filtered.length,
        offset,
        limit,
        hasMore: offset + page.length < filtered.length
      };
    }
  };
}

async function fixture() {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatz-library-content-'));
  const root = path.join(baseDir, 'Music');
  const madonna = path.join(root, 'Madonna');
  const madonnaSeason = path.join(madonna, 'Season 01');
  const ahaSeason = path.join(root, 'A-ha', 'Season 01');
  await fs.mkdir(madonnaSeason, { recursive: true });
  await fs.mkdir(ahaSeason, { recursive: true });

  const firstTarget = path.join(madonnaSeason, 'Madonna - S01E07 - Holiday.mp4');
  const firstNfo = path.join(madonnaSeason, 'Madonna - S01E07 - Holiday.nfo');
  const firstThumb = path.join(madonnaSeason, 'Madonna - S01E07 - Holiday-thumb.jpg');
  const showNfo = path.join(madonna, 'tvshow.nfo');
  const showPoster = path.join(madonna, 'poster.jpg');
  await fs.writeFile(firstTarget, 'video');
  await fs.writeFile(firstThumb, Buffer.from([1, 2, 3, 4]));
  await fs.writeFile(showPoster, Buffer.from([5, 6, 7, 8]));
  await fs.writeFile(firstNfo, [
    '<episodedetails>',
    '  <title>Holiday &amp; Friends - corrigido</title>',
    '  <season>1</season>',
    '  <episode>7</episode>',
    '  <aired>1983-09-07</aired>',
    '</episodedetails>'
  ].join('\n'));
  await fs.writeFile(showNfo, '<tvshow><title>Madonna Manual</title></tvshow>');

  const secondTarget = path.join(ahaSeason, 'A-ha - S01E01 - Take On Me.mp4');
  await fs.writeFile(secondTarget, 'video2');

  const items = [
    {
      id: 'Music:holiday',
      videoId: 'holiday',
      libraryFolder: 'Music',
      status: 'completed',
      targetPath: firstTarget,
      mediaPath: firstTarget,
      thumbnailPath: firstThumb,
      nfoPath: firstNfo,
      showNfoPath: showNfo,
      showPosterPath: showPoster,
      mediaProfile: 'music_clips',
      mediaLayout: 'show-season',
      title: 'Madonna - Holiday',
      trackTitle: 'Holiday',
      artist: 'Madonna',
      showSeasonNumber: 1,
      showEpisodeNumber: 1,
      releaseDate: '1983-01-01',
      durationSeconds: 219,
      fileSizeBytes: 1234,
      subtitles: { status: 'complete', foundLanguages: ['pt-BR', 'en'] }
    },
    {
      id: 'Music:takeonme',
      videoId: 'takeonme',
      libraryFolder: 'Music',
      status: 'completed',
      targetPath: secondTarget,
      mediaPath: secondTarget,
      mediaProfile: 'music_clips',
      mediaLayout: 'show-season',
      title: 'A-ha - Take On Me',
      trackTitle: 'Take On Me',
      artist: 'A-ha',
      showSeasonNumber: 1,
      showEpisodeNumber: 1,
      releaseDate: '1985-01-10',
      durationSeconds: 225,
      fileSizeBytes: 5678
    },
    {
      id: 'Music:pending',
      videoId: 'pending',
      libraryFolder: 'Music',
      status: 'pending',
      targetPath: path.join(root, 'Pending', 'pending.mp4'),
      title: 'Pending item'
    }
  ];

  return {
    baseDir,
    root,
    playlist: { name: 'Music', mediaProfile: 'music_clips', urls: ['https://example.invalid/list'] },
    config: { paths: { baseDir }, playlists: [] },
    manager: makeManager(items),
    items
  };
}

test('library content follows the real directory tree and excludes pending queue items', async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.baseDir, { recursive: true, force: true }));

  const root = await listLibraryContent({ config: fx.config, playlist: fx.playlist, downloadManager: fx.manager });
  assert.equal(root.library.totalVideos, 2);
  assert.deepEqual(root.directories.map((entry) => entry.name), ['A-ha', 'Madonna']);
  assert.equal(root.directories.find((entry) => entry.name === 'Madonna').posterItemId, 'Music:holiday');
  assert.equal(root.directories.find((entry) => entry.name === 'A-ha').posterItemId, '');
  assert.equal(root.items.length, 0);

  const artist = await listLibraryContent({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: fx.manager,
    browserPath: 'Madonna'
  });
  assert.deepEqual(artist.directories.map((entry) => entry.name), ['Season 01']);
  assert.equal(artist.directories[0].posterItemId, '');

  const season = await listLibraryContent({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: fx.manager,
    browserPath: 'Madonna/Season 01'
  });
  assert.equal(season.items.length, 1);
  assert.equal(season.items[0].title, 'Holiday & Friends - corrigido');
  assert.equal(season.items[0].artist, 'Madonna Manual');
  assert.equal(season.items[0].episodeNumber, 7);
  assert.equal(season.items[0].releaseDate, '1983-09-07');
  assert.equal(season.items[0].relativeFile, 'Madonna/Season 01/Madonna - S01E07 - Holiday.mp4');
  assert.deepEqual(season.items[0].subtitles.languages, ['pt-BR', 'en']);
});

test('artist poster delivery resolves only stored show poster paths inside the library root', async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.baseDir, { recursive: true, force: true }));

  const poster = await getLibraryFolderPoster({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: fx.manager,
    itemId: 'Music:holiday'
  });
  assert.equal(poster.contentType, 'image/jpeg');
  assert.deepEqual([...poster.content], [5, 6, 7, 8]);

  const outside = path.join(fx.baseDir, 'outside-poster.jpg');
  await fs.writeFile(outside, 'outside');
  fx.items[0].showPosterPath = outside;
  const blocked = await getLibraryFolderPoster({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: makeManager(fx.items),
    itemId: 'Music:holiday'
  });
  assert.equal(blocked, null);
});

test('library search uses manual NFO metadata and episode identity', async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.baseDir, { recursive: true, force: true }));

  const titleSearch = await listLibraryContent({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: fx.manager,
    query: 'corrigido'
  });
  assert.equal(titleSearch.pagination.total, 1);
  assert.equal(titleSearch.items[0].videoId, 'holiday');

  const episodeSearch = await listLibraryContent({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: fx.manager,
    query: 's01e07'
  });
  assert.equal(episodeSearch.pagination.total, 1);
  assert.equal(episodeSearch.items[0].title, 'Holiday & Friends - corrigido');
});

test('thumbnail delivery resolves only stored state paths inside the library root', async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.baseDir, { recursive: true, force: true }));

  const thumbnail = await getLibraryThumbnail({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: fx.manager,
    itemId: 'Music:holiday'
  });
  assert.equal(thumbnail.contentType, 'image/jpeg');
  assert.deepEqual([...thumbnail.content], [1, 2, 3, 4]);

  const outside = path.join(fx.baseDir, 'outside.jpg');
  await fs.writeFile(outside, 'outside');
  fx.items[0].thumbnailPath = outside;
  const blocked = await getLibraryThumbnail({
    config: fx.config,
    playlist: fx.playlist,
    downloadManager: makeManager(fx.items),
    itemId: 'Music:holiday'
  });
  assert.equal(blocked, null);
});

test('browser path validation blocks parent traversal and safeRelativeFile blocks paths outside root', () => {
  assert.equal(normalizeBrowserPath('Madonna/Season 01'), 'Madonna/Season 01');
  assert.throws(() => normalizeBrowserPath('../etc'), /invalido/);
  assert.equal(safeRelativeFile('/srv/library', '/srv/library/Artist/video.mp4'), 'Artist/video.mp4');
  assert.equal(safeRelativeFile('/srv/library', '/srv/private/secret.jpg'), '');
});

test('special content views keep recoverable orphan quarantine separate from ignored tombstones', async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.baseDir, { recursive: true, force: true }));

  const orphanTarget = path.join(fx.root, 'Orphan', 'orphan.mp4');
  await fs.mkdir(path.dirname(orphanTarget), { recursive: true });
  await fs.writeFile(orphanTarget, 'orphan');
  fx.items.push({
    id: 'Music:orphan', videoId: 'orphan', libraryFolder: 'Music', status: 'completed',
    targetPath: orphanTarget, mediaPath: orphanTarget, sourceActive: false, orphaned: true,
    userDisposition: 'managed', storageState: 'active', title: 'Orphan'
  });
  fx.items.push({
    id: 'Music:q', videoId: 'q', libraryFolder: 'Music', status: 'orphaned',
    targetPath: path.join(fx.root, 'Quarantine', 'q.mp4'), sourceActive: false, orphaned: true,
    userDisposition: 'managed', storageState: 'quarantined', title: 'Recoverable',
    quarantine: { originalPaths: { targetPath: path.join(fx.root, 'Quarantine', 'q.mp4') }, movedAt: '2026-10-01T00:00:00Z', files: [] }
  });
  fx.items.push({
    id: 'Music:ignored', videoId: 'ignored', libraryFolder: 'Music', status: 'removed',
    targetPath: path.join(fx.root, 'Ignored', 'ignored.mp4'), sourceActive: true, orphaned: false,
    userDisposition: 'ignored', storageState: 'quarantined', title: 'Ignored',
    quarantine: { originalPaths: { targetPath: path.join(fx.root, 'Ignored', 'ignored.mp4') }, movedAt: '2026-10-01T00:00:00Z', files: [] }
  });

  const qView = await listLibraryContent({ config: fx.config, playlist: fx.playlist, downloadManager: makeManager(fx.items), view: 'quarantine' });
  assert.deepEqual(qView.items.map((item) => item.videoId), ['q']);
  assert.equal(qView.library.specialCounts.quarantine, 1);
  assert.equal(qView.library.specialCounts.ignored, 1);

  const ignoredView = await listLibraryContent({ config: fx.config, playlist: fx.playlist, downloadManager: makeManager(fx.items), view: 'ignored' });
  assert.deepEqual(ignoredView.items.map((item) => item.videoId), ['ignored']);

  const orphanView = await listLibraryContent({ config: fx.config, playlist: fx.playlist, downloadManager: makeManager(fx.items), view: 'orphans' });
  assert.deepEqual(orphanView.items.map((item) => item.videoId), ['orphan']);
});
