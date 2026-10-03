const fs = require('fs/promises');
const path = require('path');
const { normalizeArtistDisplayName, extractArtistAndTitle } = require('./utils');
const { normalizeDateOnly } = require('./releaseMetadataUtils');

const MEDIA_PROFILES = Object.freeze({
  GENERIC: 'generic',
  MOVIE: 'movie',
  MUSIC_CLIPS: 'music_clips'
});

const ALLOWED_MEDIA_PROFILES = new Set(Object.values(MEDIA_PROFILES));

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

function normalizeMediaProfile(value) {
  const profile = String(value || '').trim().toLowerCase();
  return ALLOWED_MEDIA_PROFILES.has(profile) ? profile : MEDIA_PROFILES.GENERIC;
}

function getMediaProfileSettings(playlist) {
  const profile = normalizeMediaProfile(playlist && playlist.mediaProfile);
  return {
    profile,
    generic: profile === MEDIA_PROFILES.GENERIC,
    movie: profile === MEDIA_PROFILES.MOVIE,
    musicClips: profile === MEDIA_PROFILES.MUSIC_CLIPS,
    seasonNumber: 1,
    showArtwork: 'poster.jpg',
    movieArtwork: 'poster.jpg',
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

function getReleaseMetadata(item) {
  const releaseDate = normalizeDateOnly(item && (item.releaseDate || item.publishedAt || item.uploadDate));
  const yearFromDate = releaseDate ? Number(releaseDate.slice(0, 4)) : null;
  const rawYear = Number(item && item.year);
  return {
    releaseDate: releaseDate || null,
    year: Number.isInteger(yearFromDate) && yearFromDate > 0
      ? yearFromDate
      : (Number.isInteger(rawYear) && rawYear > 0 ? rawYear : null)
  };
}

function hasXmlTag(content, tagName) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  return tagPattern.test(String(content || ''));
}

function insertMissingXmlTag(content, rootTag, tagName, value) {
  if (value == null || value === '') return { content, changed: false };
  if (hasXmlTag(content, tagName)) return { content, changed: false };
  const source = String(content || '');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const closePattern = new RegExp(`(^[ \\t]*)<\\/${rootTag}>`, 'im');
  const match = source.match(closePattern);
  if (match) {
    const indent = match[1] || '';
    const childIndent = `${indent}  `;
    const replacement = `${childIndent}<${tagName}>${xmlEscape(value)}</${tagName}>${newline}${match[0]}`;
    return { content: source.replace(closePattern, replacement), changed: true };
  }

  const selfClosingPattern = new RegExp(`<${rootTag}\\b([^>]*)\\/\\s*>`, 'i');
  const selfClosing = source.match(selfClosingPattern);
  if (!selfClosing) return { content: source, changed: false };
  const attrs = String(selfClosing[1] || '').replace(/\\s+$/, '');
  const expanded = `<${rootTag}${attrs}>${newline}  <${tagName}>${xmlEscape(value)}</${tagName}>${newline}</${rootTag}>`;
  return { content: source.replace(selfClosingPattern, expanded), changed: true };
}

function getXmlTagText(content, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(content || '').match(pattern);
  return match ? String(match[1] || '').trim() : '';
}

function replaceOrInsertXmlTag(content, rootTag, tagName, value) {
  if (value == null || value === '') return { content, changed: false };
  const source = String(content || '');
  const pattern = new RegExp(`(<${tagName}\\b[^>]*>)[\\s\\S]*?(<\\/${tagName}>)`, 'i');
  const match = source.match(pattern);
  if (match) {
    const replacement = `${match[1]}${xmlEscape(value)}${match[2]}`;
    const next = source.replace(pattern, replacement);
    return { content: next, changed: next !== source };
  }
  return insertMissingXmlTag(source, rootTag, tagName, value);
}

function patchEpisodeNfoNumberContent(content, item) {
  let next = String(content || '');
  const updated = [];
  const seasonNumber = Math.max(1, Number(item && item.showSeasonNumber) || 1);
  const episodeNumber = Math.max(1, Number(item && item.showEpisodeNumber) || 1);

  let result = replaceOrInsertXmlTag(next, 'episodedetails', 'season', seasonNumber);
  next = result.content;
  if (result.changed) updated.push('season');

  result = replaceOrInsertXmlTag(next, 'episodedetails', 'episode', episodeNumber);
  next = result.content;
  if (result.changed) updated.push('episode');


  return { content: next, changed: updated.length > 0, updated };
}

function resolveMediaIdentity(item) {
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

function getGenericMetadata(item) {
  const title = cleanTrackTitle(item && item.title || item && item.trackTitle || 'Sem Titulo');
  const description = String(item && item.description || '').trim();
  return {
    title,
    plot: description || title,
    videoId: String(item && item.videoId || '').trim(),
    ...getReleaseMetadata(item)
  };
}

function getMovieMetadata(item) {
  const identity = resolveMediaIdentity(item);
  return {
    ...identity,
    sortTitle: `${identity.artist} - ${identity.trackTitle}`,
    videoId: String(item && item.videoId || '').trim(),
    ...getReleaseMetadata(item)
  };
}

function getMusicClipMetadata(item) {
  const identity = resolveMediaIdentity(item);
  return {
    ...identity,
    seasonNumber: Math.max(1, Number(item && item.showSeasonNumber) || 1),
    episodeNumber: Math.max(1, Number(item && item.showEpisodeNumber) || 1),
    videoId: String(item && item.videoId || '').trim(),
    ...getReleaseMetadata(item)
  };
}

function buildGenericNfo(item) {
  const metadata = getGenericMetadata(item);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<movie>',
    `  <title>${xmlEscape(metadata.title)}</title>`,
    `  <plot>${xmlEscape(metadata.plot)}</plot>`
  ];
  if (metadata.year) lines.push(`  <year>${metadata.year}</year>`);
  if (metadata.releaseDate) lines.push(`  <premiered>${xmlEscape(metadata.releaseDate)}</premiered>`);
  if (metadata.videoId) {
    lines.push(`  <uniqueid type="youtube" default="true">${xmlEscape(metadata.videoId)}</uniqueid>`);
  }
  lines.push('</movie>', '');
  return lines.join('\n');
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
  if (metadata.year) lines.push(`  <year>${metadata.year}</year>`);
  if (metadata.releaseDate) lines.push(`  <premiered>${xmlEscape(metadata.releaseDate)}</premiered>`);
  if (metadata.videoId) {
    lines.push(`  <uniqueid type="youtube" default="true">${xmlEscape(metadata.videoId)}</uniqueid>`);
  }
  lines.push('</movie>', '');
  return lines.join('\n');
}

function buildTvShowNfo(item) {
  const metadata = getMusicClipMetadata(item);
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
  const metadata = getMusicClipMetadata(item);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<episodedetails>',
    `  <title>${xmlEscape(metadata.trackTitle)}</title>`,
    `  <season>${metadata.seasonNumber}</season>`,
    `  <episode>${metadata.episodeNumber}</episode>`,
    `  <plot>${xmlEscape(metadata.trackTitle)}</plot>`,
    ...(metadata.releaseDate ? [`  <aired>${xmlEscape(metadata.releaseDate)}</aired>`] : []),
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

async function writeGenericNfo(item, nfoPath) {
  const target = String(nfoPath || item && item.nfoPath || '').trim();
  if (!target) throw new Error('Caminho do NFO generico nao informado.');
  await atomicWriteText(target, buildGenericNfo(item));
  return target;
}

async function writeMovieNfo(item, nfoPath) {
  const target = String(nfoPath || item && item.nfoPath || '').trim();
  if (!target) throw new Error('Caminho do NFO de filme nao informado.');
  await atomicWriteText(target, buildMovieNfo(item));
  return target;
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

async function patchEpisodeNfoNumber(item, nfoPath) {
  const target = String(nfoPath || item && item.nfoPath || '').trim();
  if (!target) throw new Error('Caminho do NFO do episodio nao informado para atualizacao.');
  const current = await fs.readFile(target, 'utf8');
  const stat = await fs.stat(target);
  const result = patchEpisodeNfoNumberContent(current, item);
  if (result.changed) {
    await atomicWriteText(target, result.content);
    await fs.chmod(target, stat.mode & 0o777);
  }
  return { target, changed: result.changed, updated: result.updated };
}

module.exports = {
  MEDIA_PROFILES,
  ALLOWED_MEDIA_PROFILES,
  normalizeMediaProfile,
  getMediaProfileSettings,
  cleanTrackTitle,
  cleanArtist,
  xmlEscape,
  getReleaseMetadata,
  getXmlTagText,
  patchEpisodeNfoNumberContent,
  resolveMediaIdentity,
  getGenericMetadata,
  getMovieMetadata,
  getMusicClipMetadata,
  buildGenericNfo,
  buildMovieNfo,
  buildTvShowNfo,
  buildEpisodeNfo,
  writeGenericNfo,
  writeMovieNfo,
  writeTvShowNfo,
  writeEpisodeNfo,
  patchEpisodeNfoNumber
};
