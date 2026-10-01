const fs = require('fs/promises');
const path = require('path');
const { libraryDestination } = require('./destinationService');
const { getXmlTagText, normalizeMediaProfile, MEDIA_PROFILES } = require('./mediaProfileService');
const { normalizeDateOnly } = require('./releaseMetadataUtils');

const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 120;
const STATE_PAGE_SIZE = 500;

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function safeRelativeFile(rootPath, candidate) {
  if (!rootPath || !candidate) return '';
  const root = path.resolve(rootPath);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return relative.split(path.sep).join('/');
}

function normalizeBrowserPath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) {
    const error = new Error('Caminho de navegacao invalido.');
    error.statusCode = 400;
    throw error;
  }
  return parts.join('/');
}

function isStoredItem(item) {
  return Boolean(item && item.targetPath && (item.status === 'completed' || item.mediaPath || Number(item.fileSizeBytes) > 0));
}

function stateSort(a, b) {
  const artistDelta = String(a.item.artist || '').localeCompare(String(b.item.artist || ''), 'pt-BR', { sensitivity: 'base' });
  if (artistDelta !== 0) return artistDelta;
  const seasonDelta = (Number(a.item.showSeasonNumber) || 0) - (Number(b.item.showSeasonNumber) || 0);
  if (seasonDelta !== 0) return seasonDelta;
  const episodeDelta = (Number(a.item.showEpisodeNumber) || 0) - (Number(b.item.showEpisodeNumber) || 0);
  if (episodeDelta !== 0) return episodeDelta;
  return String(a.item.title || a.item.videoId || '').localeCompare(String(b.item.title || b.item.videoId || ''), 'pt-BR', { sensitivity: 'base' });
}

function metadataSort(a, b) {
  const artistDelta = String(a.artist || '').localeCompare(String(b.artist || ''), 'pt-BR', { sensitivity: 'base' });
  if (artistDelta !== 0) return artistDelta;
  const seasonDelta = (Number(a.seasonNumber) || 0) - (Number(b.seasonNumber) || 0);
  if (seasonDelta !== 0) return seasonDelta;
  const episodeDelta = (Number(a.episodeNumber) || 0) - (Number(b.episodeNumber) || 0);
  if (episodeDelta !== 0) return episodeDelta;
  return String(a.title || a.videoId || '').localeCompare(String(b.title || b.videoId || ''), 'pt-BR', { sensitivity: 'base' });
}

function getAllLibraryItems(downloadManager, libraryFolder) {
  const items = [];
  let offset = 0;
  while (true) {
    const page = downloadManager.getItemsPage({
      library: libraryFolder,
      status: 'all',
      offset,
      limit: STATE_PAGE_SIZE
    });
    items.push(...(page.items || []));
    if (!page.hasMore || !page.items || page.items.length === 0) break;
    offset += page.items.length;
  }
  return items;
}

async function readTextIfSafe(rootPath, filePath, cache = null) {
  if (!safeRelativeFile(rootPath, filePath)) return '';
  if (cache && cache.has(filePath)) return cache.get(filePath);
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
  }
  if (cache) cache.set(filePath, content);
  return content;
}

function stateReleaseDate(item) {
  return normalizeDateOnly(item && (item.releaseDate || item.publishedAt || item.uploadDate)) || (item && item.year ? String(item.year) : '');
}

function subtitleSummary(item) {
  const raw = item && item.subtitles && typeof item.subtitles === 'object' ? item.subtitles : {};
  const languages = Array.isArray(raw.foundLanguages) ? raw.foundLanguages.map((value) => String(value || '').trim()).filter(Boolean) : [];
  return {
    status: String(raw.status || '').trim(),
    languages
  };
}

async function resolveMetadata(entry, destination, nfoCache = null) {
  const item = entry.item;
  const profile = normalizeMediaProfile(item.mediaProfile || destination.mediaProfile);
  const nfo = await readTextIfSafe(destination.rootPath, item.nfoPath, nfoCache);
  const nfoTitle = decodeXmlEntities(getXmlTagText(nfo, 'title'));
  const nfoOutline = decodeXmlEntities(getXmlTagText(nfo, 'outline'));
  const nfoPremiere = normalizeDateOnly(getXmlTagText(nfo, 'premiered'));
  const nfoAired = normalizeDateOnly(getXmlTagText(nfo, 'aired'));
  const nfoYear = String(getXmlTagText(nfo, 'year') || '').trim();
  let title = String(item.trackTitle || item.title || item.videoId || '').trim();
  let artist = String(item.artist || item.channelTitle || '').trim();
  let seasonNumber = Number(item.showSeasonNumber) || null;
  let episodeNumber = Number(item.showEpisodeNumber) || null;
  let releaseDate = stateReleaseDate(item);
  let metadataSource = 'state';

  if (profile === MEDIA_PROFILES.MUSIC_CLIPS) {
    if (nfoTitle) {
      title = nfoTitle;
      metadataSource = 'nfo';
    }
    const season = Number(getXmlTagText(nfo, 'season'));
    const episode = Number(getXmlTagText(nfo, 'episode'));
    if (Number.isInteger(season) && season >= 0) seasonNumber = season;
    if (Number.isInteger(episode) && episode >= 0) episodeNumber = episode;
    if (nfoAired) releaseDate = nfoAired;
    const showNfo = await readTextIfSafe(destination.rootPath, item.showNfoPath, nfoCache);
    const showTitle = decodeXmlEntities(getXmlTagText(showNfo, 'title'));
    if (showTitle) {
      artist = showTitle;
      metadataSource = 'nfo';
    }
  } else if (profile === MEDIA_PROFILES.MOVIE) {
    if (nfoOutline) {
      title = nfoOutline;
      metadataSource = 'nfo';
    } else if (nfoTitle && !artist) {
      title = nfoTitle;
      metadataSource = 'nfo';
    }
    if (nfoTitle) {
      artist = nfoTitle;
      metadataSource = 'nfo';
    }
    if (nfoPremiere) releaseDate = nfoPremiere;
    else if (nfoYear) releaseDate = nfoYear;
  } else {
    if (nfoTitle) {
      title = nfoTitle;
      metadataSource = 'nfo';
    }
    if (nfoPremiere) releaseDate = nfoPremiere;
    else if (nfoYear) releaseDate = nfoYear;
  }

  return {
    id: item.id,
    videoId: String(item.videoId || '').trim(),
    title: title || String(item.videoId || 'Video'),
    artist,
    releaseDate,
    seasonNumber,
    episodeNumber,
    durationSeconds: Number(item.durationSeconds) || null,
    fileSizeBytes: Number(item.fileSizeBytes) || 0,
    relativeFile: entry.relativeFile,
    relativeDirectory: entry.directory,
    mediaProfile: profile,
    mediaLayout: String(item.mediaLayout || '').trim(),
    orphaned: Boolean(item.orphaned),
    hasThumbnail: Boolean(item.thumbnailPath && safeRelativeFile(destination.rootPath, item.thumbnailPath)),
    subtitles: subtitleSummary(item),
    metadataSource
  };
}

async function mapLimit(values, limit, worker) {
  const result = new Array(values.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      result[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return result;
}

function buildEntries(downloadManager, destination) {
  return getAllLibraryItems(downloadManager, destination.id)
    .filter(isStoredItem)
    .map((item) => {
      const relativeFile = safeRelativeFile(destination.rootPath, item.targetPath);
      if (!relativeFile) return null;
      const directory = relativeFile.includes('/') ? relativeFile.slice(0, relativeFile.lastIndexOf('/')) : '';
      return { item, relativeFile, directory };
    })
    .filter(Boolean);
}

function directoryListing(entries, currentPath) {
  const directories = new Map();
  const direct = [];
  const prefix = currentPath ? `${currentPath}/` : '';

  for (const entry of entries) {
    if (currentPath) {
      if (entry.directory !== currentPath && !entry.directory.startsWith(prefix)) continue;
    }
    const remainder = currentPath ? entry.directory.slice(prefix.length) : entry.directory;
    if (!remainder) {
      direct.push(entry);
      continue;
    }
    const childName = remainder.split('/')[0];
    const childPath = currentPath ? `${currentPath}/${childName}` : childName;
    const current = directories.get(childPath) || { name: childName, path: childPath, totalVideos: 0 };
    current.totalVideos += 1;
    directories.set(childPath, current);
  }

  return {
    directories: [...directories.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })),
    direct: direct.sort(stateSort)
  };
}

function breadcrumbsFor(currentPath) {
  const parts = currentPath ? currentPath.split('/') : [];
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
}

async function listLibraryContent({ config, playlist, downloadManager, browserPath = '', query = '', offset = 0, limit = DEFAULT_PAGE_SIZE }) {
  const destination = libraryDestination(config, playlist);
  if (!destination) {
    const error = new Error('Biblioteca invalida.');
    error.statusCode = 404;
    throw error;
  }

  const currentPath = normalizeBrowserPath(browserPath);
  const q = String(query || '').trim().toLocaleLowerCase('pt-BR');
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
  const entries = buildEntries(downloadManager, destination);
  let directories = [];
  let metadata = [];
  const nfoCache = new Map();
  let total = 0;

  if (q) {
    const allMetadata = await mapLimit(entries, 16, (entry) => resolveMetadata(entry, destination, nfoCache));
    const matches = allMetadata.filter((item) => {
      const haystack = [
        item.title,
        item.artist,
        item.videoId,
        item.relativeFile,
        item.seasonNumber != null ? `s${String(item.seasonNumber).padStart(2, '0')}` : '',
        item.episodeNumber != null ? `e${String(item.episodeNumber).padStart(2, '0')}` : '',
        item.seasonNumber != null && item.episodeNumber != null
          ? `s${String(item.seasonNumber).padStart(2, '0')}e${String(item.episodeNumber).padStart(2, '0')}`
          : ''
      ].join(' ').toLocaleLowerCase('pt-BR');
      return haystack.includes(q);
    }).sort(metadataSort);
    total = matches.length;
    metadata = matches.slice(safeOffset, safeOffset + safeLimit);
  } else {
    const listing = directoryListing(entries, currentPath);
    directories = listing.directories;
    total = listing.direct.length;
    const pageEntries = listing.direct.slice(safeOffset, safeOffset + safeLimit);
    metadata = await mapLimit(pageEntries, 12, (entry) => resolveMetadata(entry, destination, nfoCache));
  }

  return {
    library: {
      name: String(playlist.name || destination.displayName || destination.id),
      folderName: destination.id,
      mediaProfile: destination.mediaProfile,
      totalVideos: entries.length
    },
    path: currentPath,
    breadcrumbs: breadcrumbsFor(currentPath),
    query: String(query || '').trim(),
    directories,
    items: metadata,
    pagination: {
      total,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + metadata.length < total
    }
  };
}

async function getLibraryThumbnail({ config, playlist, downloadManager, itemId }) {
  const destination = libraryDestination(config, playlist);
  if (!destination) return null;
  const id = String(itemId || '').trim();
  if (!id) return null;
  const item = getAllLibraryItems(downloadManager, destination.id).find((entry) => entry.id === id);
  if (!item || !isStoredItem(item) || !item.thumbnailPath) return null;
  if (!safeRelativeFile(destination.rootPath, item.thumbnailPath)) return null;
  try {
    const content = await fs.readFile(item.thumbnailPath);
    if (!content.length) return null;
    const ext = path.extname(item.thumbnailPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
    return { content, contentType };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return null;
    throw error;
  }
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeXmlEntities,
  safeRelativeFile,
  normalizeBrowserPath,
  isStoredItem,
  listLibraryContent,
  getLibraryThumbnail
};
