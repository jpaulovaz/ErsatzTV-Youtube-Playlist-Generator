const fs = require('fs/promises');
const path = require('path');

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

function getMovieMetadataSettings(playlist) {
  const raw = playlist && playlist.movieMetadata && typeof playlist.movieMetadata === 'object'
    ? playlist.movieMetadata
    : {};
  return {
    enabled: Boolean(raw.enabled),
    mode: 'movie-folder',
    artwork: 'poster.jpg'
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

function getMovieMetadata(item) {
  const itemArtist = cleanArtist(item && item.artist);
  const channelArtist = cleanArtist(item && item.channelTitle);
  const artist = itemArtist && itemArtist.toLowerCase() !== 'outros'
    ? itemArtist
    : (channelArtist || 'Artista Desconhecido');
  const trackTitle = cleanTrackTitle(
    item && (item.trackTitle || item.title) || 'Sem Titulo'
  );
  const videoId = String(item && item.videoId || '').trim();
  return {
    artist,
    trackTitle,
    sortTitle: `${artist} - ${trackTitle}`,
    videoId
  };
}

function buildMovieNfo(item) {
  const metadata = getMovieMetadata(item);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<movie>',
    `  <title>${xmlEscape(metadata.artist)}</title>`,
    `  <sorttitle>${xmlEscape(metadata.sortTitle)}</sorttitle>`,
    `  <outline>${xmlEscape(metadata.trackTitle)}</outline>`,
    `  <plot>${xmlEscape(metadata.trackTitle)}</plot>`,
    '  <genre>Music</genre>',
    '  <tag>Music Video</tag>'
  ];

  if (metadata.videoId) {
    lines.push(`  <uniqueid type="youtube" default="true">${xmlEscape(metadata.videoId)}</uniqueid>`);
  }
  lines.push('</movie>', '');
  return lines.join('\n');
}

async function atomicWriteText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function writeMovieNfo(item, nfoPath) {
  const target = String(nfoPath || item && item.nfoPath || '').trim();
  if (!target) throw new Error('Caminho do NFO nao informado.');
  await atomicWriteText(target, buildMovieNfo(item));
  return target;
}

module.exports = {
  getMovieMetadataSettings,
  cleanTrackTitle,
  cleanArtist,
  xmlEscape,
  getMovieMetadata,
  buildMovieNfo,
  writeMovieNfo
};
