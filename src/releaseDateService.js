const { fetchVideoDetails, shouldUseYouTubeApi, canonicalWatchUrl } = require('./youtubeApi');
const {
  runCommand,
  buildYtDlpCommonArgs,
  normalizeYtDlpVideo
} = require('./discovery/youtubeSourceProvider');
const { releaseMetadataFromVideo } = require('./releaseMetadataUtils');

async function fetchOneViaYtDlp(config, source, item, options = {}) {
  const runner = options.runner || runCommand;
  const commonArgs = buildYtDlpCommonArgs(config, source || {});
  const url = String(item && (item.url || item.webpage_url) || canonicalWatchUrl(item.videoId));
  const args = [
    ...commonArgs,
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    url
  ];
  const result = await runner(config.paths.ytDlpPath, args, { timeoutMs: 2 * 60 * 1000 });
  if (result.code !== 0) {
    const detail = String(result.stderr || result.stdout || `codigo ${result.code}`).trim().slice(-1600);
    throw new Error(`yt-dlp nao conseguiu ler a data de ${item.videoId}: ${detail}`);
  }
  let raw;
  try {
    raw = JSON.parse(String(result.stdout || '').trim());
  } catch (error) {
    throw new Error(`yt-dlp retornou metadata invalida para ${item.videoId}: ${error.message}`);
  }
  const normalized = normalizeYtDlpVideo(raw, url, 0, 'video');
  return releaseMetadataFromVideo(normalized);
}

async function fetchReleaseMetadataForItems(config, source, items, options = {}) {
  const requested = (items || []).filter((item) => item && item.videoId);
  const result = {
    byVideoId: new Map(),
    apiFetched: 0,
    apiCached: 0,
    ytDlpFetched: 0,
    failed: []
  };
  if (requested.length === 0) return result;

  const missing = new Map(requested.map((item) => [String(item.videoId), item]));
  const apiFetcher = options.fetchVideoDetails || fetchVideoDetails;

  if (shouldUseYouTubeApi(config)) {
    try {
      const apiResult = await apiFetcher(config, [...missing.keys()], { useCache: true });
      result.apiFetched = Number(apiResult.fetched) || 0;
      result.apiCached = Number(apiResult.fromCache) || 0;
      for (const [videoId, video] of apiResult.videosById || []) {
        const metadata = releaseMetadataFromVideo(video);
        if (metadata.releaseDate) {
          result.byVideoId.set(String(videoId), metadata);
          missing.delete(String(videoId));
        }
      }
    } catch (error) {
      result.failed.push({ source: 'api', videoId: null, error: error.message });
    }
  }

  const ytDlpFetcher = options.fetchOneViaYtDlp || fetchOneViaYtDlp;
  for (const [videoId, item] of missing) {
    try {
      const metadata = await ytDlpFetcher(config, source, item, options);
      if (metadata.releaseDate) {
        result.byVideoId.set(videoId, metadata);
        result.ytDlpFetched += 1;
      } else {
        result.failed.push({ source: 'yt-dlp', videoId, error: 'Data de publicacao nao encontrada.' });
      }
    } catch (error) {
      result.failed.push({ source: 'yt-dlp', videoId, error: error.message });
    }
  }

  return result;
}

module.exports = {
  fetchOneViaYtDlp,
  fetchReleaseMetadataForItems
};
