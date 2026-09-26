const fs = require('fs/promises');
const path = require('path');
const { ROOT_DIR } = require('../config');

const STATE_PATH = path.join(ROOT_DIR, 'data', 'channel-state.json');

function nowIso() { return new Date().toISOString(); }

function defaultState() {
  return { version: 1, channels: {}, destinations: {}, updatedAt: nowIso() };
}

function normalize(raw) {
  return {
    version: 1,
    channels: raw && raw.channels && typeof raw.channels === 'object' ? raw.channels : {},
    destinations: raw && raw.destinations && typeof raw.destinations === 'object' ? raw.destinations : {},
    updatedAt: raw && raw.updatedAt || nowIso()
  };
}

async function load() {
  try {
    return normalize(JSON.parse(await fs.readFile(STATE_PATH, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
    return defaultState();
  }
}

async function save(state) {
  const snapshot = normalize({ ...state, updatedAt: nowIso() });
  snapshot.updatedAt = nowIso();
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const tempPath = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.rename(tempPath, STATE_PATH);
  return snapshot;
}

async function mutate(mutator) {
  const state = await load();
  await mutator(state);
  return save(state);
}

async function updateChannel(channelId, patch) {
  const id = String(channelId || '').trim();
  if (!id) return load();
  return mutate((state) => {
    state.channels[id] = { ...(state.channels[id] || {}), ...patch, updatedAt: nowIso() };
  });
}

async function updateDestination(destinationId, patch) {
  const id = String(destinationId || '').trim();
  if (!id) return load();
  return mutate((state) => {
    state.destinations[id] = { ...(state.destinations[id] || {}), ...patch, updatedAt: nowIso() };
  });
}

async function updateCatalogAvailability(channel, catalog) {
  const channelId = String(channel && channel.channelId || '').trim();
  if (!channelId) return load();
  const remoteIds = new Set((catalog && catalog.playlists || []).map((entry) => String(entry.playlistId || '').trim()).filter(Boolean));
  const checkedAt = nowIso();
  return mutate((state) => {
    state.channels[channelId] = {
      ...(state.channels[channelId] || {}),
      available: true,
      lastCatalogAt: checkedAt,
      lastCatalogError: null,
      name: channel.name,
      handle: channel.handle || '',
      updatedAt: checkedAt
    };
    for (const playlist of channel.playlists || []) {
      const destinationId = `channel:${channelId}:playlist:${playlist.playlistId}`;
      const available = remoteIds.has(playlist.playlistId);
      state.destinations[destinationId] = {
        ...(state.destinations[destinationId] || {}),
        available,
        lastCatalogAt: checkedAt,
        lastCatalogError: available ? null : 'Playlist nao encontrada no catalogo publico do canal.',
        updatedAt: checkedAt
      };
    }
  });
}

async function removeDestination(destinationId) {
  const id = String(destinationId || '').trim();
  return mutate((state) => { delete state.destinations[id]; });
}

async function removeChannel(channelId) {
  const id = String(channelId || '').trim();
  return mutate((state) => {
    delete state.channels[id];
    for (const key of Object.keys(state.destinations)) {
      if (key.startsWith(`channel:${id}:`)) delete state.destinations[key];
    }
  });
}

module.exports = {
  STATE_PATH,
  defaultState,
  normalize,
  load,
  save,
  mutate,
  updateChannel,
  updateDestination,
  updateCatalogAvailability,
  removeDestination,
  removeChannel
};
