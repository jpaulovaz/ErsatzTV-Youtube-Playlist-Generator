const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getMovieMetadataSettings,
  cleanTrackTitle,
  getMovieMetadata,
  buildMovieNfo
} = require('../src/movieMetadataService');

test('movie metadata is disabled by default and can be enabled per library', () => {
  assert.deepEqual(getMovieMetadataSettings({}), {
    enabled: false,
    mode: 'movie-folder',
    artwork: 'poster.jpg'
  });
  assert.equal(getMovieMetadataSettings({ movieMetadata: { enabled: true } }).enabled, true);
});

test('cleans common YouTube presentation suffixes without changing the artist', () => {
  assert.equal(cleanTrackTitle('City Walls (Official Video)'), 'City Walls');
  assert.equal(cleanTrackTitle('The Line [Official Music Video]'), 'The Line');
  assert.equal(cleanTrackTitle('Overcompensate (Official Audio)'), 'Overcompensate');
  assert.equal(cleanTrackTitle('Next Semester'), 'Next Semester');

  const metadata = getMovieMetadata({
    artist: 'Twenty One Pilots',
    trackTitle: 'City Walls (Official Video)',
    videoId: 'abcdefghijk'
  });
  assert.equal(metadata.artist, 'Twenty One Pilots');
  assert.equal(metadata.trackTitle, 'City Walls');
  assert.equal(metadata.sortTitle, 'Twenty One Pilots - City Walls');
});

test('builds an ErsatzTV movie NFO with artist as title and song as plot', () => {
  const nfo = buildMovieNfo({
    artist: 'Twenty One Pilots & Friends',
    trackTitle: 'City <Walls> (Official Video)',
    videoId: 'abcdefghijk'
  });
  assert.match(nfo, /<title>Twenty One Pilots &amp; Friends<\/title>/);
  assert.match(nfo, /<sorttitle>Twenty One Pilots &amp; Friends - City &lt;Walls&gt;<\/sorttitle>/);
  assert.match(nfo, /<outline>City &lt;Walls&gt;<\/outline>/);
  assert.match(nfo, /<plot>City &lt;Walls&gt;<\/plot>/);
  assert.match(nfo, /<genre>Music<\/genre>/);
  assert.match(nfo, /<tag>Music Video<\/tag>/);
  assert.match(nfo, /<uniqueid type="youtube" default="true">abcdefghijk<\/uniqueid>/);
});
