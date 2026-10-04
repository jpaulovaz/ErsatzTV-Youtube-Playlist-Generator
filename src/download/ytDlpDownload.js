const path = require('path');
const { normalizeMaxHeight } = require('../config');
const { buildYtDlpCommonArgs } = require('../ytDlpUtils');

function getEffectiveMaxHeight(config, playlist) {
  return normalizeMaxHeight((playlist && playlist.maxHeight) || (config.downloads && config.downloads.maxHeight));
}

function buildFormatSelector(maxHeight) {
  const height = normalizeMaxHeight(maxHeight);
  const compatible = [
    `bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]`,
    `best[height<=${height}][ext=mp4][vcodec^=avc1][acodec^=mp4a]`,
    `best[height<=${height}][vcodec^=avc1][acodec^=mp4a]`
  ];
  const anyCodec = [
    `bestvideo[height<=${height}]+bestaudio`,
    `best[height<=${height}]`
  ];

  // YouTube normally offers AVC only up to 1080p. Above that, prefer the
  // requested resolution and let the local ffmpeg normalization create H.264/AAC.
  return height > 1080
    ? anyCodec.join('/')
    : [...compatible, ...anyCodec].join('/');
}

function buildDownloadArgs(config, playlist, item, workDir) {
  const downloads = config.downloads || {};
  const args = [...buildYtDlpCommonArgs(config, playlist)];
  const outputTemplate = path.join(workDir, 'media.%(ext)s');

  args.push(
    '--no-playlist',
    '--continue',
    '--no-overwrites',
    '--newline',
    '--progress',
    '--progress-template',
    'download:__YTDLP_PROGRESS__%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--print',
    'after_move:__YTDLP_FILE__%(filepath)s',
    '--no-simulate',
    '--merge-output-format',
    'mkv'
  );

  if (downloads.writeThumbnails !== false) {
    args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  }

  args.push(
    '-f',
    buildFormatSelector(item.maxHeight || getEffectiveMaxHeight(config, playlist)),
    '-o',
    outputTemplate,
    item.url || `https://www.youtube.com/watch?v=${item.videoId}`
  );

  return args;
}

function parseNumber(value) {
  const number = Number(String(value || '').trim());
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseProgressLine(line) {
  const marker = '__YTDLP_PROGRESS__';
  const index = String(line || '').indexOf(marker);
  if (index < 0) return null;
  const parts = String(line).slice(index + marker.length).trim().split('|');
  return {
    downloadedBytes: parseNumber(parts[0]),
    totalBytes: parseNumber(parts[1]) || parseNumber(parts[2]),
    speedBytesPerSecond: parseNumber(parts[3]),
    etaSeconds: parseNumber(parts[4])
  };
}

function parseFileLine(line) {
  const marker = '__YTDLP_FILE__';
  const index = String(line || '').indexOf(marker);
  if (index < 0) return '';
  return String(line).slice(index + marker.length).trim();
}

function attachLineReader(stream, callback) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) callback(line);
  });
  stream.on('end', () => {
    if (buffer) callback(buffer);
  });
}

function appendTail(current, line, maxLength = 24000) {
  const next = `${current || ''}${current ? '\n' : ''}${line}`;
  return next.length <= maxLength ? next : next.slice(-maxLength);
}

module.exports = {
  getEffectiveMaxHeight,
  buildFormatSelector,
  buildDownloadArgs,
  parseProgressLine,
  parseFileLine,
  attachLineReader,
  appendTail
};
