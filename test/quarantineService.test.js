const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  getQuarantineRoot,
  moveItemToQuarantine,
  restoreItemFromQuarantine,
  deleteQuarantinedFiles
} = require('../src/orphans/quarantineService');
const { STORAGE_STATES } = require('../src/orphans/orphanPolicy');

async function write(filePath, content = 'x') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

test('quarantine moves and restores a complete generic media package outside the active library', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-quarantine-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseRoot = path.join(root, 'media');
  const libraryRoot = path.join(baseRoot, 'Teste');
  const targetPath = path.join(libraryRoot, 'Artist', 'Artist - Song.mp4');
  const nfoPath = targetPath.replace(/\.mp4$/, '.nfo');
  const thumbnailPath = targetPath.replace(/\.mp4$/, '.jpg');
  const subtitlePath = targetPath.replace(/\.mp4$/, '.pt-BR.srt');
  await write(targetPath, 'video-data');
  await write(nfoPath, '<movie/>');
  await write(thumbnailPath, 'image');
  await write(subtitlePath, 'subtitle');

  const destination = { id: 'Teste', type: 'library', rootPath: libraryRoot, baseRootPath: baseRoot };
  const item = {
    id: 'Teste::aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', targetPath, nfoPath, thumbnailPath,
    mediaLayout: 'generic-flat', storageState: STORAGE_STATES.ACTIVE, fileSizeBytes: 10
  };

  const metadata = await moveItemToQuarantine(item, destination, [item], { reason: 'orphan', retentionDays: 30 });
  assert.equal(item.storageState, STORAGE_STATES.QUARANTINED);
  assert.equal(metadata.originalPaths.targetPath, targetPath);
  assert.equal(metadata.subtitlePaths.length, 1);
  assert.equal(await fs.stat(metadata.quarantinePaths.targetPath).then(() => true), true);
  await assert.rejects(fs.access(targetPath));
  assert.equal(path.resolve(getQuarantineRoot(destination)).startsWith(path.resolve(libraryRoot) + path.sep), false);

  await restoreItemFromQuarantine(item, destination, [item]);
  assert.equal(item.storageState, STORAGE_STATES.ACTIVE);
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'video-data');
  assert.equal(await fs.readFile(subtitlePath, 'utf8'), 'subtitle');
  assert.equal(item.quarantine, null);
});

test('music clip restore remaps an occupied SxxExx path and keeps current shared show assets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-q-clip-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseRoot = path.join(root, 'media');
  const libraryRoot = path.join(baseRoot, 'Clipes');
  const showDir = path.join(libraryRoot, 'Artist');
  const seasonDir = path.join(showDir, 'Season 01');
  const base = 'Artist - S01E02 - Old Song';
  const targetPath = path.join(seasonDir, `${base}.mp4`);
  const nfoPath = path.join(seasonDir, `${base}.nfo`);
  const thumbnailPath = path.join(seasonDir, `${base}-thumb.jpg`);
  const subtitlePath = path.join(seasonDir, `${base}.pt-BR.srt`);
  const showNfoPath = path.join(showDir, 'tvshow.nfo');
  const showPosterPath = path.join(showDir, 'poster.jpg');
  for (const [file, content] of [[targetPath, 'old-video'], [nfoPath, '<episodedetails/>'], [thumbnailPath, 'old-thumb'], [subtitlePath, 'old-sub'], [showNfoPath, 'old-show'], [showPosterPath, 'old-poster']]) await write(file, content);

  const destination = { id: 'Clipes', type: 'library', rootPath: libraryRoot, baseRootPath: baseRoot };
  const item = {
    id: 'Clipes::old', videoId: 'old', targetPath, nfoPath, thumbnailPath, showNfoPath, showPosterPath,
    showSeasonNumber: 1, showEpisodeNumber: 2, mediaLayout: 'show-season', storageState: STORAGE_STATES.ACTIVE, fileSizeBytes: 9
  };
  await moveItemToQuarantine(item, destination, [item], { reason: 'orphan', retentionDays: null });

  // Another active episode now occupies the historical E02 slot and recreated Show-level assets.
  await write(targetPath, 'current-video');
  await write(nfoPath, '<episodedetails><episode>2</episode></episodedetails>');
  await write(thumbnailPath, 'current-thumb');
  await write(showNfoPath, 'current-show');
  await write(showPosterPath, 'current-poster');
  const other = { id: 'Clipes::current', targetPath, nfoPath, thumbnailPath, mediaLayout: 'show-season', storageState: STORAGE_STATES.ACTIVE };

  await restoreItemFromQuarantine(item, destination, [item, other]);
  assert.equal(item.storageState, STORAGE_STATES.ACTIVE);
  assert.match(path.basename(item.targetPath), /S01E03/);
  assert.equal(item.showEpisodeNumber, 3);
  assert.match(await fs.readFile(item.nfoPath, 'utf8'), /<episode>3<\/episode>/);
  assert.equal(await fs.readFile(item.targetPath, 'utf8'), 'old-video');
  assert.equal(await fs.readFile(showNfoPath, 'utf8'), 'current-show');
  assert.equal(await fs.readFile(showPosterPath, 'utf8'), 'current-poster');
});

test('deleting expired quarantine bytes leaves the item absent and removes its files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-q-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseRoot = path.join(root, 'media');
  const libraryRoot = path.join(baseRoot, 'Teste');
  const targetPath = path.join(libraryRoot, 'video.mp4');
  await write(targetPath, 'video');
  const destination = { id: 'Teste', type: 'library', rootPath: libraryRoot, baseRootPath: baseRoot };
  const item = { id: 'Teste::v', videoId: 'v', targetPath, mediaLayout: 'generic-flat', storageState: STORAGE_STATES.ACTIVE };
  await moveItemToQuarantine(item, destination, [item], { retentionDays: 30 });
  const qPath = item.quarantine.files[0].quarantine;
  const result = await deleteQuarantinedFiles(item);
  assert.equal(result.filesRemoved, 1);
  assert.equal(item.storageState, STORAGE_STATES.ABSENT);
  await assert.rejects(fs.access(qPath));
});
