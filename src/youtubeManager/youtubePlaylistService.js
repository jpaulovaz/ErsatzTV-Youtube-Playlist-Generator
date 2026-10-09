const accountService = require('./youtubeAccountService');
const quotaTracker = require('./quotaTracker');

function mapPlaylist(item) {
  const snippet = item && item.snippet || {};
  const details = item && item.contentDetails || {};
  const status = item && item.status || {};
  return {
    id: item.id,
    title: snippet.title || item.id,
    description: snippet.description || '',
    channelId: snippet.channelId || '',
    channelTitle: snippet.channelTitle || '',
    itemCount: Number(details.itemCount) || 0,
    privacyStatus: status.privacyStatus || '',
    thumbnailUrl: snippet.thumbnails && (snippet.thumbnails.high || snippet.thumbnails.medium || snippet.thumbnails.default) && (snippet.thumbnails.high || snippet.thumbnails.medium || snippet.thumbnails.default).url || '',
    url: `https://www.youtube.com/playlist?list=${item.id}`
  };
}

async function listMine() {
  const playlists = [];
  let pageToken = '';
  do {
    const payload = await accountService.authorizedRequest('playlists', {
      part: 'id,snippet,contentDetails,status',
      mine: 'true',
      maxResults: 50,
      pageToken: pageToken || undefined
    });
    await quotaTracker.record('playlistsList', 1, { reason: 'youtube-manager-list-mine' });
    for (const item of payload.items || []) if (item && item.id) playlists.push(mapPlaylist(item));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  playlists.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  return playlists;
}

async function create({ title, description = '', privacyStatus = 'private' } = {}) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('Informe o nome da playlist.'), { statusCode: 400 });
  const allowed = new Set(['private', 'unlisted', 'public']);
  const privacy = allowed.has(privacyStatus) ? privacyStatus : 'private';
  const payload = await accountService.authorizedRequest('playlists', { part: 'snippet,status' }, {
    method: 'POST',
    body: {
      snippet: { title: cleanTitle.slice(0, 150), description: String(description || '').slice(0, 5000) },
      status: { privacyStatus: privacy }
    }
  });
  await quotaTracker.record('playlistsInsert', 1, { title: cleanTitle.slice(0, 100) });
  return mapPlaylist(payload);
}

async function listItems(playlistId) {
  const id = String(playlistId || '').trim();
  if (!id) throw Object.assign(new Error('Playlist nao informada.'), { statusCode: 400 });
  const items = [];
  let pageToken = '';
  do {
    const payload = await accountService.authorizedRequest('playlistItems', {
      part: 'id,snippet,contentDetails,status',
      playlistId: id,
      maxResults: 50,
      pageToken: pageToken || undefined
    });
    await quotaTracker.record('playlistItemsList', 1, { playlistId: id });
    for (const item of payload.items || []) {
      const snippet = item.snippet || {};
      const videoId = item.contentDetails && item.contentDetails.videoId || snippet.resourceId && snippet.resourceId.videoId || '';
      if (!videoId) continue;
      items.push({
        playlistItemId: item.id,
        videoId,
        title: snippet.title || videoId,
        position: Number.isFinite(Number(snippet.position)) ? Number(snippet.position) : null,
        privacyStatus: item.status && item.status.privacyStatus || ''
      });
    }
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function getIndex(playlistId) {
  const items = await listItems(playlistId);
  return { items, videoIds: new Set(items.map((item) => item.videoId)) };
}

async function insertVideo(playlistId, videoId) {
  const pid = String(playlistId || '').trim();
  const vid = String(videoId || '').trim();
  if (!pid || !/^[A-Za-z0-9_-]{11}$/.test(vid)) throw Object.assign(new Error('Playlist ou Video ID invalido.'), { statusCode: 400 });
  const payload = await accountService.authorizedRequest('playlistItems', { part: 'snippet' }, {
    method: 'POST',
    body: {
      snippet: {
        playlistId: pid,
        resourceId: { kind: 'youtube#video', videoId: vid }
      }
    }
  });
  await quotaTracker.record('playlistItemsInsert', 1, { playlistId: pid, videoId: vid });
  return {
    playlistItemId: payload.id || '',
    videoId: vid,
    playlistId: pid
  };
}

module.exports = { mapPlaylist, listMine, create, listItems, getIndex, insertVideo };
