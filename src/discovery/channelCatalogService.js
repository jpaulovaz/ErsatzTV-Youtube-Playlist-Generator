const { sanitizeName } = require('../utils');
const {
  shouldUseYouTubeApi,
  fetchChannelCatalogViaApi
} = require('../youtubeApi');
const { normalizeChannelUrl } = require('../destinationService');
const { runCommand, buildYtDlpCommonArgs } = require('./youtubeSourceProvider');

function parseSingleJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  return null;
}

function channelIdentityFromYtDlp(data, originalUrl) {
  if (!data || typeof data !== 'object') return null;
  const channelId = String(data.channel_id || data.uploader_id || data.id || '').trim();
  const name = String(data.channel || data.uploader || data.title || channelId).trim();
  if (!channelId || !name) return null;
  const handleRaw = String(data.channel_url || data.uploader_url || '').match(/youtube\.com\/(?:@[^/?#]+)/i);
  const handle = handleRaw ? `@${handleRaw[0].split('/@')[1]}` : '';
  const url = String(data.channel_url || data.uploader_url || originalUrl || `https://www.youtube.com/channel/${channelId}`).trim();
  const thumbs = Array.isArray(data.thumbnails) ? data.thumbnails : [];
  const thumbnailUrl = String(data.thumbnail || (thumbs.length ? thumbs[thumbs.length - 1].url : '') || '').trim();
  return { channelId, name, handle, url, thumbnailUrl, uploadsPlaylistId: '' };
}

async function analyzeViaYtDlp(config, urlValue, runner = runCommand) {
  const url = String(urlValue || '').trim();
  if (!url) throw new Error('Informe a URL do canal.');
  const identityArgs = [
    ...buildYtDlpCommonArgs(config, {}),
    '--dump-single-json', '--flat-playlist', '--skip-download', '--playlist-items', '0', url
  ];
  let result = await runner(config.paths.ytDlpPath, identityArgs, { timeoutMs: 90000 });
  let identityData = parseSingleJson(result.stdout);
  let identity = channelIdentityFromYtDlp(identityData, url);
  if (!identity) {
    const fallbackArgs = [...buildYtDlpCommonArgs(config, {}), '--dump-single-json', '--flat-playlist', '--skip-download', '--playlist-items', '1', url];
    result = await runner(config.paths.ytDlpPath, fallbackArgs, { timeoutMs: 90000 });
    identityData = parseSingleJson(result.stdout);
    identity = channelIdentityFromYtDlp(identityData, url);
  }
  if (!identity) throw new Error(result.stderr.trim() || 'Nao foi possivel identificar o canal com yt-dlp.');

  const canonical = normalizeChannelUrl(identity) || url.replace(/\/+$/, '');
  const playlistUrl = `${canonical}/playlists`;
  const playlistArgs = [...buildYtDlpCommonArgs(config, {}), '--dump-single-json', '--flat-playlist', '--skip-download', playlistUrl];
  const playlistResult = await runner(config.paths.ytDlpPath, playlistArgs, { timeoutMs: 120000 });
  const playlistData = parseSingleJson(playlistResult.stdout);
  const playlists = [];
  for (const entry of playlistData && Array.isArray(playlistData.entries) ? playlistData.entries : []) {
    const playlistId = String(entry.id || entry.playlist_id || '').trim();
    const name = String(entry.title || entry.name || playlistId).trim();
    if (!playlistId || !name) continue;
    playlists.push({
      playlistId,
      name,
      itemCount: Number.isFinite(Number(entry.playlist_count)) ? Number(entry.playlist_count) : null,
      thumbnailUrl: String(entry.thumbnail || '').trim(),
      url: `https://www.youtube.com/playlist?list=${playlistId}`
    });
  }

  return { ...identity, playlists, readMode: 'ytdlp', quotaUnitsUsed: 0 };
}

function normalizeCatalog(catalog) {
  const channelId = String(catalog.channelId || '').trim();
  const name = String(catalog.name || '').trim();
  if (!channelId || !name) throw new Error('Catalogo de canal incompleto.');
  const seen = new Set();
  const playlists = [];
  for (const raw of catalog.playlists || []) {
    const playlistId = String(raw.playlistId || '').trim();
    if (!playlistId || seen.has(playlistId)) continue;
    seen.add(playlistId);
    playlists.push({
      playlistId,
      name: String(raw.name || playlistId).trim(),
      folderName: sanitizeName(String(raw.name || playlistId).trim()),
      url: String(raw.url || `https://www.youtube.com/playlist?list=${playlistId}`).trim(),
      itemCount: raw.itemCount == null ? null : Number(raw.itemCount),
      thumbnailUrl: String(raw.thumbnailUrl || '').trim()
    });
  }
  return {
    channelId,
    name,
    handle: String(catalog.handle || '').trim(),
    url: String(catalog.url || `https://www.youtube.com/channel/${channelId}`).trim(),
    thumbnailUrl: String(catalog.thumbnailUrl || '').trim(),
    folderName: sanitizeName(name),
    uploadsPlaylistId: String(catalog.uploadsPlaylistId || '').trim(),
    playlists,
    globalSources: ['uploads', 'videos', 'shorts', 'streams'],
    readMode: catalog.readMode || 'ytdlp',
    quotaUnitsUsed: Number(catalog.quotaUnitsUsed) || 0,
    analyzedAt: new Date().toISOString()
  };
}

async function analyzeChannel(config, urlValue, options = {}) {
  let apiError = null;
  if (shouldUseYouTubeApi(config)) {
    try {
      return normalizeCatalog(await fetchChannelCatalogViaApi(config, urlValue));
    } catch (error) {
      apiError = error;
    }
  }
  try {
    return normalizeCatalog(await analyzeViaYtDlp(config, urlValue, options.runner));
  } catch (error) {
    if (apiError) {
      error.message = `${error.message} Fallback apos falha da API: ${apiError.message}`;
    }
    throw error;
  }
}

module.exports = {
  analyzeChannel,
  analyzeViaYtDlp,
  normalizeCatalog,
  channelIdentityFromYtDlp,
  parseSingleJson
};
