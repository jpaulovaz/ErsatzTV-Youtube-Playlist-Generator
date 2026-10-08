const fs = require('fs/promises');
const path = require('path');
const { libraryDestination } = require('./destinationService');
const { getXmlTagText, normalizeMediaProfile, MEDIA_PROFILES } = require('./mediaProfileService');
const { normalizeDateOnly } = require('./releaseMetadataUtils');
const { USER_DISPOSITIONS, STORAGE_STATES } = require('./orphans/orphanPolicy');
const { quarantineThumbnailPath } = require('./orphans/quarantineService');
const subtitleManagerState = require('./subtitleManager/subtitleManagerState');

const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 120;
const STATE_PAGE_SIZE = 500;
const CONTENT_VIEWS = new Set(['content', 'subtitles-missing', 'subtitles-present', 'orphans', 'quarantine', 'ignored']);
const SUBTITLE_ORIGINS = new Set(['all', 'youtube', 'lrclib', 'gemini', 'local']);

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

function normalizeContentView(value) {
  const normalized = String(value || 'content').trim().toLowerCase();
  return CONTENT_VIEWS.has(normalized) ? normalized : 'content';
}


function normalizeSubtitleOrigin(value) {
  const normalized = String(value || 'all').trim().toLowerCase();
  return SUBTITLE_ORIGINS.has(normalized) ? normalized : 'all';
}

function subtitlePresence(item) {
  const raw = item && item.subtitles && typeof item.subtitles === 'object' ? item.subtitles : {};
  const languages = Array.isArray(raw.foundLanguages)
    ? raw.foundLanguages.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return {
    languages,
    hasSubtitles: languages.length > 0 || String(raw.status || '').trim().toLowerCase() === 'complete'
  };
}

function subtitleOrigins(item, managerItemState = null) {
  const presence = subtitlePresence(item);
  if (!presence.hasSubtitles) return [];
  const tracks = managerItemState && managerItemState.tracks && typeof managerItemState.tracks === 'object'
    ? managerItemState.tracks
    : {};
  const origins = new Set();
  const languages = presence.languages.length ? presence.languages : Object.keys(tracks);
  if (!languages.length) origins.add('local');
  for (const language of languages) {
    const provider = String(tracks[language] && tracks[language].provider || '').trim().toLowerCase();
    if (provider === 'youtube') origins.add('youtube');
    else if (provider === 'lrclib') origins.add('lrclib');
    else if (provider === 'gemini') origins.add('gemini');
    else origins.add('local');
  }
  return [...origins];
}

function matchesSubtitleOrigin(item, managerItemState, origin) {
  const selected = normalizeSubtitleOrigin(origin);
  return selected === 'all' || subtitleOrigins(item, managerItemState).includes(selected);
}

function isStoredItem(item) {
  return Boolean(item && item.targetPath && (item.status === 'completed' || item.mediaPath || Number(item.fileSizeBytes) > 0));
}

function isActiveContentItem(item) {
  return Boolean(
    item
    && (item.userDisposition || USER_DISPOSITIONS.MANAGED) !== USER_DISPOSITIONS.IGNORED
    && (item.storageState || STORAGE_STATES.ACTIVE) === STORAGE_STATES.ACTIVE
    && isStoredItem(item)
  );
}

function matchesView(item, view) {
  const disposition = item.userDisposition || USER_DISPOSITIONS.MANAGED;
  const storage = item.storageState || (isStoredItem(item) ? STORAGE_STATES.ACTIVE : STORAGE_STATES.ABSENT);
  if (view === 'content') return isActiveContentItem(item);
  if (view === 'subtitles-missing') return isActiveContentItem(item) && !subtitlePresence(item).hasSubtitles;
  if (view === 'subtitles-present') return isActiveContentItem(item) && subtitlePresence(item).hasSubtitles;
  if (view === 'orphans') return item.sourceActive === false && disposition === USER_DISPOSITIONS.MANAGED && storage === STORAGE_STATES.ACTIVE;
  if (view === 'quarantine') return storage === STORAGE_STATES.QUARANTINED && disposition !== USER_DISPOSITIONS.IGNORED;
  if (view === 'ignored') return disposition === USER_DISPOSITIONS.IGNORED;
  return false;
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

function getAllDestinationItems(downloadManager, destinationId) {
  if (downloadManager && typeof downloadManager.getDestinationItems === 'function') {
    return downloadManager.getDestinationItems(destinationId).map((item) => ({ ...item }));
  }
  const items = [];
  let offset = 0;
  while (true) {
    const page = downloadManager.getItemsPage({ library: destinationId, status: 'all', offset, limit: STATE_PAGE_SIZE });
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
  return { status: String(raw.status || '').trim(), languages };
}

function relativeFromState(item, destination) {
  const active = safeRelativeFile(destination.rootPath, item.targetPath);
  if (active) return active;
  const original = item.quarantine && item.quarantine.originalPaths && item.quarantine.originalPaths.targetPath;
  return safeRelativeFile(destination.rootPath, original) || '';
}

function stateLabel(item) {
  const disposition = item.userDisposition || USER_DISPOSITIONS.MANAGED;
  const storage = item.storageState || STORAGE_STATES.ACTIVE;
  if (disposition === USER_DISPOSITIONS.IGNORED) return storage === STORAGE_STATES.QUARANTINED ? 'Ignorado · recuperável' : 'Ignorado';
  if (disposition === USER_DISPOSITIONS.KEEP && item.sourceActive === false) return 'Mantido fora da fonte';
  if (storage === STORAGE_STATES.QUARANTINED) return 'Quarentena';
  if (item.sourceActive === false) return 'Órfão';
  return 'Ativo';
}

async function resolveMetadata(entry, destination, nfoCache = null, options = {}) {
  const item = entry.item;
  const profile = normalizeMediaProfile(item.mediaProfile || destination.mediaProfile);
  const canReadActiveNfo = (item.storageState || STORAGE_STATES.ACTIVE) === STORAGE_STATES.ACTIVE;
  const nfo = canReadActiveNfo ? await readTextIfSafe(destination.rootPath, item.nfoPath, nfoCache) : '';
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
    if (nfoTitle) { title = nfoTitle; metadataSource = 'nfo'; }
    const season = Number(getXmlTagText(nfo, 'season'));
    const episode = Number(getXmlTagText(nfo, 'episode'));
    if (Number.isInteger(season) && season >= 0) seasonNumber = season;
    if (Number.isInteger(episode) && episode >= 0) episodeNumber = episode;
    if (nfoAired) releaseDate = nfoAired;
    const showNfo = canReadActiveNfo ? await readTextIfSafe(destination.rootPath, item.showNfoPath, nfoCache) : '';
    const showTitle = decodeXmlEntities(getXmlTagText(showNfo, 'title'));
    if (showTitle) { artist = showTitle; metadataSource = 'nfo'; }
  } else if (profile === MEDIA_PROFILES.MOVIE) {
    if (nfoOutline) { title = nfoOutline; metadataSource = 'nfo'; }
    else if (nfoTitle && !artist) { title = nfoTitle; metadataSource = 'nfo'; }
    if (nfoTitle) { artist = nfoTitle; metadataSource = 'nfo'; }
    if (nfoPremiere) releaseDate = nfoPremiere;
    else if (nfoYear) releaseDate = nfoYear;
  } else {
    if (nfoTitle) { title = nfoTitle; metadataSource = 'nfo'; }
    if (nfoPremiere) releaseDate = nfoPremiere;
    else if (nfoYear) releaseDate = nfoYear;
  }

  const quarantineThumb = quarantineThumbnailPath(item);
  const activeThumb = item.thumbnailPath && safeRelativeFile(destination.rootPath, item.thumbnailPath) ? item.thumbnailPath : '';
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
    sourceActive: item.sourceActive !== false,
    orphaned: Boolean(item.orphaned || item.sourceActive === false),
    userDisposition: item.userDisposition || USER_DISPOSITIONS.MANAGED,
    storageState: item.storageState || STORAGE_STATES.ACTIVE,
    orphanedAt: item.orphanedAt || null,
    quarantineMovedAt: item.quarantine && item.quarantine.movedAt || null,
    quarantineExpiresAt: item.quarantine && item.quarantine.expiresAt || null,
    quarantineReason: item.quarantine && item.quarantine.reason || '',
    stateLabel: stateLabel(item),
    hasThumbnail: Boolean(activeThumb || quarantineThumb),
    subtitles: subtitleSummary(item),
    metadataSource,
    selectable: options.view === 'quarantine' || options.view === 'ignored'
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

function buildEntries(downloadManager, destination, view = 'content') {
  return getAllDestinationItems(downloadManager, destination.id)
    .filter((item) => matchesView(item, view))
    .map((item) => {
      const relativeFile = relativeFromState(item, destination) || String(item.title || item.videoId || 'Video');
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
    if (currentPath && entry.directory !== currentPath && !entry.directory.startsWith(prefix)) continue;
    const remainder = currentPath ? entry.directory.slice(prefix.length) : entry.directory;
    if (!remainder) { direct.push(entry); continue; }
    const childName = remainder.split('/')[0];
    const childPath = currentPath ? `${currentPath}/${childName}` : childName;
    const current = directories.get(childPath) || { name: childName, path: childPath, totalVideos: 0, posterItemId: '' };
    current.totalVideos += 1;
    if (!currentPath && !current.posterItemId && entry.item.showPosterPath) current.posterItemId = entry.item.id;
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

function specialCounts(items) {
  return items.reduce((acc, item) => {
    if (matchesView(item, 'subtitles-missing')) acc.subtitleMissing += 1;
    if (matchesView(item, 'subtitles-present')) acc.subtitlePresent += 1;
    if (matchesView(item, 'orphans')) acc.orphans += 1;
    if (matchesView(item, 'quarantine')) acc.quarantine += 1;
    if (matchesView(item, 'ignored')) acc.ignored += 1;
    return acc;
  }, { subtitleMissing: 0, subtitlePresent: 0, orphans: 0, quarantine: 0, ignored: 0 });
}

function subtitleOriginCounts(entries, managerState) {
  const counts = { youtube: 0, lrclib: 0, gemini: 0, local: 0 };
  for (const entry of entries) {
    const itemState = managerState && managerState.items ? managerState.items[entry.item.id] : null;
    for (const origin of subtitleOrigins(entry.item, itemState)) counts[origin] += 1;
  }
  return counts;
}

async function listDestinationContent({ destination, downloadManager, browserPath = '', query = '', offset = 0, limit = DEFAULT_PAGE_SIZE, view = 'content', subtitleOrigin = 'all' }) {
  if (!destination) {
    const error = new Error('Destino invalido.');
    error.statusCode = 404;
    throw error;
  }
  const selectedView = normalizeContentView(view);
  const currentPath = selectedView === 'content' ? normalizeBrowserPath(browserPath) : '';
  const selectedSubtitleOrigin = selectedView === 'subtitles-present' ? normalizeSubtitleOrigin(subtitleOrigin) : 'all';
  const q = String(query || '').trim().toLocaleLowerCase('pt-BR');
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
  const allItems = getAllDestinationItems(downloadManager, destination.id);
  let entries = buildEntries(downloadManager, destination, selectedView);
  let managerState = null;
  let originCounts = { youtube: 0, lrclib: 0, gemini: 0, local: 0 };
  if (selectedView === 'subtitles-present') {
    managerState = await subtitleManagerState.load();
    originCounts = subtitleOriginCounts(entries, managerState);
    if (selectedSubtitleOrigin !== 'all') {
      entries = entries.filter((entry) => matchesSubtitleOrigin(
        entry.item,
        managerState.items && managerState.items[entry.item.id],
        selectedSubtitleOrigin
      ));
    }
  }
  let directories = [];
  let metadata = [];
  const nfoCache = new Map();
  let total = 0;

  if (selectedView !== 'content' || q) {
    const allMetadata = await mapLimit(entries, 16, (entry) => resolveMetadata(entry, destination, nfoCache, { view: selectedView }));
    const matches = q ? allMetadata.filter((item) => {
      const haystack = [
        item.title, item.artist, item.videoId, item.relativeFile, item.stateLabel,
        item.seasonNumber != null ? `s${String(item.seasonNumber).padStart(2, '0')}` : '',
        item.episodeNumber != null ? `e${String(item.episodeNumber).padStart(2, '0')}` : '',
        item.seasonNumber != null && item.episodeNumber != null ? `s${String(item.seasonNumber).padStart(2, '0')}e${String(item.episodeNumber).padStart(2, '0')}` : ''
      ].join(' ').toLocaleLowerCase('pt-BR');
      return haystack.includes(q);
    }) : allMetadata;
    matches.sort(metadataSort);
    total = matches.length;
    metadata = matches.slice(safeOffset, safeOffset + safeLimit);
  } else {
    const listing = directoryListing(entries, currentPath);
    directories = listing.directories;
    total = listing.direct.length;
    const pageEntries = listing.direct.slice(safeOffset, safeOffset + safeLimit);
    metadata = await mapLimit(pageEntries, 12, (entry) => resolveMetadata(entry, destination, nfoCache, { view: selectedView }));
  }

  return {
    library: {
      name: String(destination.displayName || destination.name || destination.id),
      folderName: destination.id,
      mediaProfile: destination.mediaProfile,
      totalVideos: buildEntries(downloadManager, destination, 'content').length,
      specialCounts: specialCounts(allItems)
    },
    view: selectedView,
    path: currentPath,
    breadcrumbs: breadcrumbsFor(currentPath),
    query: String(query || '').trim(),
    subtitleOrigin: selectedSubtitleOrigin,
    subtitleOriginCounts: originCounts,
    directories,
    items: metadata,
    pagination: { total, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + metadata.length < total }
  };
}

async function listLibraryContent({ config, playlist, downloadManager, ...options }) {
  const destination = libraryDestination(config, playlist);
  return listDestinationContent({ destination, downloadManager, ...options });
}

async function readImage(filePath) {
  if (!filePath) return null;
  try {
    const content = await fs.readFile(filePath);
    if (!content.length) return null;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
    return { content, contentType };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return null;
    throw error;
  }
}

async function getDestinationThumbnail({ destination, downloadManager, itemId }) {
  if (!destination) return null;
  const id = String(itemId || '').trim();
  if (!id) return null;
  const item = getAllDestinationItems(downloadManager, destination.id).find((entry) => entry.id === id);
  if (!item) return null;
  if ((item.storageState || STORAGE_STATES.ACTIVE) === STORAGE_STATES.QUARANTINED) {
    const candidate = quarantineThumbnailPath(item);
    const quarantineRoot = item.quarantine && item.quarantine.rootPath;
    if (!candidate || !quarantineRoot || !safeRelativeFile(quarantineRoot, candidate)) return null;
    return readImage(candidate);
  }
  if (!item.thumbnailPath || !safeRelativeFile(destination.rootPath, item.thumbnailPath)) return null;
  return readImage(item.thumbnailPath);
}

async function getDestinationFolderPoster({ destination, downloadManager, itemId }) {
  if (!destination) return null;
  const id = String(itemId || '').trim();
  if (!id) return null;
  const item = getAllDestinationItems(downloadManager, destination.id).find((entry) => entry.id === id);
  if (!item || !isActiveContentItem(item) || !item.showPosterPath) return null;
  if (!safeRelativeFile(destination.rootPath, item.showPosterPath)) return null;
  return readImage(item.showPosterPath);
}

async function getLibraryThumbnail({ config, playlist, downloadManager, itemId }) {
  return getDestinationThumbnail({ destination: libraryDestination(config, playlist), downloadManager, itemId });
}

async function getLibraryFolderPoster({ config, playlist, downloadManager, itemId }) {
  return getDestinationFolderPoster({ destination: libraryDestination(config, playlist), downloadManager, itemId });
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  CONTENT_VIEWS,
  decodeXmlEntities,
  safeRelativeFile,
  normalizeBrowserPath,
  normalizeContentView,
  normalizeSubtitleOrigin,
  subtitlePresence,
  subtitleOrigins,
  matchesSubtitleOrigin,
  isStoredItem,
  isActiveContentItem,
  matchesView,
  listDestinationContent,
  listLibraryContent,
  getDestinationThumbnail,
  getDestinationFolderPoster,
  getLibraryThumbnail,
  getLibraryFolderPoster
};
