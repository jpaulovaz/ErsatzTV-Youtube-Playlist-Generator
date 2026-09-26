const fs = require('fs/promises');
const path = require('path');
const { normalizeArtistDisplayName, extractArtistAndTitle } = require('./utils');

const OFFICIAL_SUFFIX_PATTERNS = [
  /\s*[\[(](?:official\s+)?music\s+video[\])]\s*$/i,
  /\s*[\[(]official\s+video[\])]\s*$/i,
  /\s*[\[(]official\s+audio[\])]\s*$/i,
  /\s*[\[(]official\s+lyric\s+video[\])]\s*$/i,
  /\s*[\[(]lyric\s+video[\])]\s*$/i,
  /\s*[\[(]lyrics?[\])]\s*$/i,
  /\s*[\[(]official\s+visuali[sz]er[\])]\s*$/i,
  /\s*[\[(]visuali[sz]er[\])]\s*$/i,
  /\s*[\[(]official[\])]\s*$/i
];

function getShowMetadataSettings(playlist) {
  const raw = playlist && playlist.showMetadata && typeof playlist.showMetadata === 'object'
    ? playlist.showMetadata
    : {};
  return {
    enabled: Boolean(raw.enabled),
    mode: 'show-season',
    seasonNumber: 1,
    showArtwork: 'poster.jpg',
    episodeArtworkSuffix: '-thumb.jpg'
  };
}

function cleanTrackTitle(value) {
  let result = String(value || '').trim();
  let changed = true;
  while (result && changed) {
    changed = false;
    for (const pattern of OFFICIAL_SUFFIX_PATTERNS) {
      const next = result.replace(pattern, '').trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }
  return result || String(value || '').trim() || 'Sem Titulo';
}

function cleanArtist(value) {
  return String(value || '')
    .replace(/\s+-\s+Topic\s*$/i, '')
    .trim();
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveShowIdentity(item) {
  const extracted = extractArtistAndTitle(item && (item.title || item.trackTitle) || 'Sem Titulo');
  const itemArtist = cleanArtist(item && item.artist);
  const extractedArtist = cleanArtist(extracted.artist);
  const channelArtist = cleanArtist(item && item.channelTitle);
  const artistSource = itemArtist && itemArtist.toLowerCase() !== 'outros'
    ? itemArtist
    : (extractedArtist && extractedArtist.toLowerCase() !== 'outros'
      ? extractedArtist
      : (channelArtist || 'Outros'));

  const artist = normalizeArtistDisplayName(artistSource);
  const trackSource = item && item.trackTitle
    ? item.trackTitle
    : extracted.title;
  const trackTitle = cleanTrackTitle(trackSource || item && item.title || 'Sem Titulo');

  return { artist, trackTitle };
}

function getShowMetadata(item) {
  const identity = resolveShowIdentity(item);
  const seasonNumber = Math.max(1, Number(item && item.showSeasonNumber) || 1);
  const episodeNumber = Math.max(1, Number(item && item.showEpisodeNumber) || 1);
  const videoId = String(item && item.videoId || '').trim();
  return {
    ...identity,
    seasonNumber,
    episodeNumber,
    videoId
  };
}

function buildTvShowNfo(item) {
  const metadata = getShowMetadata(item);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<tvshow>',
    `  <title>${xmlEscape(metadata.artist)}</title>`,
    `  <plot>${xmlEscape(`Music Videos - ${metadata.artist}`)}</plot>`,
    '  <genre>Music</genre>',
    '  <tag>Music Video</tag>',
    '</tvshow>',
    ''
  ].join('\n');
}

function buildEpisodeNfo(item) {
  const metadata = getShowMetadata(item);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<episodedetails>',
    `  <title>${xmlEscape(metadata.trackTitle)}</title>`,
    `  <season>${metadata.seasonNumber}</season>`,
    `  <episode>${metadata.episodeNumber}</episode>`,
    `  <plot>${xmlEscape(metadata.trackTitle)}</plot>`,
    '</episodedetails>',
    ''
  ].join('\n');
}

async function atomicWriteText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function writeTvShowNfo(item, showNfoPath) {
  const target = String(showNfoPath || item && item.showNfoPath || '').trim();
  if (!target) throw new Error('Caminho do tvshow.nfo nao informado.');
  await atomicWriteText(target, buildTvShowNfo(item));
  return target;
}

async function writeEpisodeNfo(item, nfoPath) {
  const target = String(nfoPath || item && item.nfoPath || '').trim();
  if (!target) throw new Error('Caminho do NFO do episodio nao informado.');
  await atomicWriteText(target, buildEpisodeNfo(item));
  return target;
}

module.exports = {
  getShowMetadataSettings,
  cleanTrackTitle,
  cleanArtist,
  xmlEscape,
  resolveShowIdentity,
  getShowMetadata,
  buildTvShowNfo,
  buildEpisodeNfo,
  writeTvShowNfo,
  writeEpisodeNfo
};
