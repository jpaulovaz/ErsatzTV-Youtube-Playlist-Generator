const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeArtistDisplayName,
  findCaseInsensitiveDirectoryName,
  extractArtistAndTitle
} = require('../src/utils');

test('normalizes obvious multi-word artist casing without rewriting stylized names', () => {
  assert.equal(normalizeArtistDisplayName('TWENTY ONE PILOTS'), 'Twenty One Pilots');
  assert.equal(normalizeArtistDisplayName('twenty one pilots'), 'Twenty One Pilots');
  assert.equal(normalizeArtistDisplayName('Twenty One Pilots'), 'Twenty One Pilots');
  assert.equal(normalizeArtistDisplayName('AC/DC'), 'AC/DC');
  assert.equal(normalizeArtistDisplayName('P!NK'), 'P!NK');
  assert.equal(normalizeArtistDisplayName('deadmau5'), 'deadmau5');
  assert.equal(normalizeArtistDisplayName('blink-182'), 'blink-182');
  assert.equal(normalizeArtistDisplayName('CHVRCHES'), 'CHVRCHES');
});

test('artist/title parsing uses a spaced separator and preserves hyphens inside names', () => {
  assert.deepEqual(extractArtistAndTitle('TWENTY ONE PILOTS - City Walls'), {
    artist: 'Twenty One Pilots',
    title: 'City Walls'
  });
  assert.deepEqual(extractArtistAndTitle('blink-182 - All The Small Things'), {
    artist: 'blink-182',
    title: 'All The Small Things'
  });
  assert.deepEqual(extractArtistAndTitle('Artist - Song - Live'), {
    artist: 'Artist',
    title: 'Song - Live'
  });
});

test('finds an existing artist directory ignoring only letter casing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-artist-dir-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'Twenty One Pilots'));

  assert.equal(findCaseInsensitiveDirectoryName(root, 'TWENTY ONE PILOTS'), 'Twenty One Pilots');
  assert.equal(findCaseInsensitiveDirectoryName(root, 'Twenty One Pilots'), 'Twenty One Pilots');
  assert.equal(findCaseInsensitiveDirectoryName(root, 'Twenty Óne Pilots'), null);
});
