const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MEDIA_PROFILES,
  normalizeMediaProfile,
  getMediaProfileSettings,
  cleanTrackTitle,
  getGenericMetadata,
  getMovieMetadata,
  getMusicClipMetadata,
  buildGenericNfo,
  buildMovieNfo,
  buildTvShowNfo,
  buildEpisodeNfo
} = require('../src/mediaProfileService');

test('normalizes the three media profiles and defaults to generic', () => {
  assert.equal(normalizeMediaProfile('generic'), MEDIA_PROFILES.GENERIC);
  assert.equal(normalizeMediaProfile('movie'), MEDIA_PROFILES.MOVIE);
  assert.equal(normalizeMediaProfile('music_clips'), MEDIA_PROFILES.MUSIC_CLIPS);
  assert.equal(normalizeMediaProfile('invalid'), MEDIA_PROFILES.GENERIC);
  assert.equal(getMediaProfileSettings({}).profile, MEDIA_PROFILES.GENERIC);
});

test('cleans common YouTube presentation suffixes', () => {
  assert.equal(cleanTrackTitle('City Walls (Official Video)'), 'City Walls');
  assert.equal(cleanTrackTitle('The Line [Official Music Video]'), 'The Line');
  assert.equal(cleanTrackTitle('Overcompensate (Official Audio)'), 'Overcompensate');
  assert.equal(cleanTrackTitle('Next Semester'), 'Next Semester');
});

test('generic metadata keeps a simple title and plot', () => {
  const metadata = getGenericMetadata({
    title: 'Twenty One Pilots - City Walls (Official Video)',
    description: 'Descrição do vídeo',
    videoId: 'abcdefghijk'
  });
  assert.equal(metadata.title, 'Twenty One Pilots - City Walls');
  assert.equal(metadata.plot, 'Descrição do vídeo');
  const nfo = buildGenericNfo({
    title: 'Twenty One Pilots - City Walls (Official Video)',
    description: 'Descrição do vídeo',
    videoId: 'abcdefghijk'
  });
  assert.match(nfo, /<title>Twenty One Pilots - City Walls<\/title>/);
  assert.match(nfo, /<plot>Descrição do vídeo<\/plot>/);
  assert.match(nfo, /<uniqueid type="youtube" default="true">abcdefghijk<\/uniqueid>/);
});

test('movie profile preserves the v2.6 artist/title NFO model', () => {
  const metadata = getMovieMetadata({
    artist: 'TWENTY ONE PILOTS',
    trackTitle: 'City Walls (Official Video)',
    videoId: 'abcdefghijk'
  });
  assert.equal(metadata.artist, 'Twenty One Pilots');
  assert.equal(metadata.trackTitle, 'City Walls');
  const nfo = buildMovieNfo({
    artist: 'TWENTY ONE PILOTS',
    trackTitle: 'City Walls (Official Video)',
    videoId: 'abcdefghijk'
  });
  assert.match(nfo, /<title>Twenty One Pilots<\/title>/);
  assert.match(nfo, /<outline>City Walls<\/outline>/);
  assert.match(nfo, /<plot>City Walls<\/plot>/);
});

test('music clips profile creates show and episode NFO metadata', () => {
  const metadata = getMusicClipMetadata({
    artist: 'TWENTY ONE PILOTS',
    trackTitle: 'City <Walls> (Official Video)',
    showSeasonNumber: 1,
    showEpisodeNumber: 12
  });
  assert.equal(metadata.artist, 'Twenty One Pilots');
  assert.equal(metadata.trackTitle, 'City <Walls>');
  assert.equal(metadata.episodeNumber, 12);

  const showNfo = buildTvShowNfo({ artist: 'Twenty One Pilots', trackTitle: 'City Walls' });
  const episodeNfo = buildEpisodeNfo({
    artist: 'Twenty One Pilots',
    trackTitle: 'City <Walls>',
    showSeasonNumber: 1,
    showEpisodeNumber: 12
  });
  assert.match(showNfo, /<tvshow>/);
  assert.match(showNfo, /<title>Twenty One Pilots<\/title>/);
  assert.match(episodeNfo, /<title>City &lt;Walls&gt;<\/title>/);
  assert.match(episodeNfo, /<season>1<\/season>/);
  assert.match(episodeNfo, /<episode>12<\/episode>/);
});

test('preserves stylized artist names', () => {
  const metadata = getMusicClipMetadata({ artist: 'AC/DC', trackTitle: 'Thunderstruck' });
  assert.equal(metadata.artist, 'AC/DC');
});
