const fs = require('fs/promises');
const path = require('path');
const { runCommand } = require('../processUtils');
const { extractArtistAndTitle } = require('../utils');
const { extractVideoIdFromUrl } = require('../youtubeApi');

const VIDEO_ID_RE = /\[([A-Za-z0-9_-]{11})\]/g;
const URL_RE = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s"'<>]*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

function cleanStem(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/\[[A-Za-z0-9_-]{11}\]/g, ' ')
    .replace(/\[(?:2160p|1440p|1080p|720p|480p|360p|4k|hd)\]/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findVideoIdInText(value) {
  const text = String(value || '');
  const url = text.match(URL_RE);
  if (url) return url[1];
  VIDEO_ID_RE.lastIndex = 0;
  const match = VIDEO_ID_RE.exec(text);
  if (match) return match[1];
  const trimmed = text.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? trimmed : '';
}

async function readSmallText(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      const size = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      return buffer.toString('utf8');
    } finally { await handle.close(); }
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    return '';
  }
}

async function inspectInfoJson(mediaPath) {
  const ext = path.extname(mediaPath);
  const stem = mediaPath.slice(0, -ext.length);
  const candidates = [`${stem}.info.json`, `${mediaPath}.info.json`];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, 'utf8'));
      const id = String(parsed.id || '').trim();
      return {
        path: candidate,
        videoId: /^[A-Za-z0-9_-]{11}$/.test(id) ? id : findVideoIdInText(parsed.webpage_url || parsed.original_url || ''),
        title: String(parsed.title || parsed.track || '').trim(),
        artist: String(parsed.artist || parsed.uploader || parsed.channel || '').trim(),
        duration: Number(parsed.duration) || null,
        year: Number(parsed.release_year || parsed.release_date && String(parsed.release_date).slice(0, 4)) || null
      };
    } catch (error) {
      if (error.code !== 'ENOENT') continue;
    }
  }
  return null;
}

async function inspectNfo(mediaPath) {
  const ext = path.extname(mediaPath);
  const nfoPath = `${mediaPath.slice(0, -ext.length)}.nfo`;
  const text = await readSmallText(nfoPath);
  if (!text) return null;
  const videoId = findVideoIdInText(text) || ((text.match(/<uniqueid[^>]*type=["']youtube["'][^>]*>([^<]+)<\/uniqueid>/i) || [])[1] || '').trim();
  const title = ((text.match(/<title>([^<]+)<\/title>/i) || [])[1] || '').trim();
  const artist = ((text.match(/<artist>([^<]+)<\/artist>/i) || [])[1] || '').trim();
  return { path: nfoPath, videoId: /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : '', title, artist };
}

async function inspectFfprobe(mediaPath, config) {
  const ffprobe = config && config.paths && config.paths.ffprobePath || '/usr/bin/ffprobe';
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name:format_tags=title,artist,album_artist,comment,purl,url,description,date:stream=index,codec_type,codec_name,width,height',
    '-of', 'json',
    mediaPath
  ];
  try {
    const result = await runCommand(ffprobe, args, { timeoutMs: 15000 });
    if (result.code !== 0 || result.timedOut) return { duration: null, container: '', streams: [], tags: {}, videoId: '' };
    const payload = JSON.parse(result.stdout || '{}');
    const format = payload.format || {};
    const tags = format.tags || {};
    const tagText = Object.values(tags).join(' ');
    return {
      duration: Number(format.duration) || null,
      container: String(format.format_name || ''),
      streams: Array.isArray(payload.streams) ? payload.streams.map((stream) => ({
        index: stream.index,
        type: stream.codec_type || '',
        codec: stream.codec_name || '',
        width: Number(stream.width) || null,
        height: Number(stream.height) || null
      })) : [],
      tags,
      videoId: findVideoIdInText(tagText) || extractVideoIdFromUrl(tags.purl || tags.url || '')
    };
  } catch {
    return { duration: null, container: '', streams: [], tags: {}, videoId: '' };
  }
}

async function inspect(mediaPath, config) {
  const stat = await fs.stat(mediaPath);
  const filenameId = findVideoIdInText(path.basename(mediaPath));
  const info = await inspectInfoJson(mediaPath);
  const nfo = await inspectNfo(mediaPath);
  const probe = await inspectFfprobe(mediaPath, config);
  const stem = cleanStem(mediaPath);
  const inferred = extractArtistAndTitle(stem);
  const embeddedTitle = String(probe.tags.title || '').trim();
  const embeddedArtist = String(probe.tags.artist || probe.tags.album_artist || '').trim();

  let videoId = '';
  let matchSource = '';
  for (const [id, source] of [[filenameId, 'filename'], [info && info.videoId, 'info-json'], [nfo && nfo.videoId, 'nfo'], [probe.videoId, 'embedded']]) {
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) { videoId = id; matchSource = source; break; }
  }

  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    duration: Number(info && info.duration) || probe.duration || null,
    container: probe.container,
    streams: probe.streams,
    embeddedMetadata: probe.tags,
    inferredTitle: String(info && info.title || nfo && nfo.title || embeddedTitle || inferred.title || '').trim(),
    inferredArtist: String(info && info.artist || nfo && nfo.artist || embeddedArtist || inferred.artist || '').trim(),
    year: Number(info && info.year) || null,
    recoveredVideoId: videoId,
    matchSource,
    sidecars: {
      infoJson: info && info.path || '',
      nfo: nfo && nfo.path || ''
    }
  };
}

module.exports = { VIDEO_ID_RE, cleanStem, findVideoIdInText, inspectInfoJson, inspectNfo, inspectFfprobe, inspect };
