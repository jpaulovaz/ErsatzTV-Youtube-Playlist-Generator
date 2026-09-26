const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getShowMetadataSettings,
  cleanTrackTitle,
  getShowMetadata,
  buildTvShowNfo,
  buildEpisodeNfo
} = require('../src/showMetadataService');

test('show metadata is disabled by default and can be enabled per library', () => {
  assert.deepEqual(getShowMetadataSettings({}), {
    enabled: false,
    mode: 'show-season',
    seasonNumber: 1,
    showArtwork: 'poster.jpg',
    episodeArtworkSuffix: '-thumb.jpg'
  });
  assert.equal(getShowMetadataSettings({ showMetadata: { enabled: true } }).enabled, true);
});

test('cleans common YouTube presentation suffixes and resolves artist/title', () => {
  assert.equal(cleanTrackTitle('City Walls (Official Video)'), 'City Walls');
  assert.equal(cleanTrackTitle('The Line [Official Music Video]'), 'The Line');
  assert.equal(cleanTrackTitle('Overcompensate (Official Audio)'), 'Overcompensate');
  assert.equal(cleanTrackTitle('Next Semester'), 'Next Semester');

  const metadata = getShowMetadata({
    artist: 'TWENTY ONE PILOTS',
    trackTitle: 'City Walls (Official Video)',
    showSeasonNumber: 1,
    showEpisodeNumber: 7,
    videoId: 'abcdefghijk'
  });
  assert.equal(metadata.artist, 'Twenty One Pilots');
  assert.equal(metadata.trackTitle, 'City Walls');
  assert.equal(metadata.seasonNumber, 1);
  assert.equal(metadata.episodeNumber, 7);
});

test('builds tvshow.nfo with artist as show title', () => {
  const nfo = buildTvShowNfo({
    artist: 'Twenty One Pilots & Friends',
    trackTitle: 'City Walls',
    showSeasonNumber: 1,
    showEpisodeNumber: 1
  });
  assert.match(nfo, /<tvshow>/);
  assert.match(nfo, /<title>Twenty One Pilots &amp; Friends<\/title>/);
  assert.match(nfo, /<genre>Music<\/genre>/);
  assert.match(nfo, /<tag>Music Video<\/tag>/);
});

test('builds episode NFO with song title and episode number', () => {
  const nfo = buildEpisodeNfo({
    artist: 'Twenty One Pilots',
    trackTitle: 'City <Walls> (Official Video)',
    showSeasonNumber: 1,
    showEpisodeNumber: 12
  });
  assert.match(nfo, /<episodedetails>/);
  assert.match(nfo, /<title>City &lt;Walls&gt;<\/title>/);
  assert.match(nfo, /<season>1<\/season>/);
  assert.match(nfo, /<episode>12<\/episode>/);
  assert.match(nfo, /<plot>City &lt;Walls&gt;<\/plot>/);
});

test('preserves stylized artist names', () => {
  const metadata = getShowMetadata({
    artist: 'AC/DC',
    trackTitle: 'Thunderstruck',
    showSeasonNumber: 1,
    showEpisodeNumber: 1
  });
  assert.equal(metadata.artist, 'AC/DC');
});
