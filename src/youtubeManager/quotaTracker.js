const stateStore = require('./youtubeManagerState');

const COSTS = Object.freeze({
  searchList: { bucket: 'search', units: 1 },
  videosList: { bucket: 'general', units: 1 },
  channelsList: { bucket: 'general', units: 1 },
  playlistsList: { bucket: 'general', units: 1 },
  playlistItemsList: { bucket: 'general', units: 1 },
  playlistsInsert: { bucket: 'general', units: 50 },
  playlistItemsInsert: { bucket: 'general', units: 50 }
});

function dateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function record(operation, count = 1, metadata = {}) {
  const cost = COSTS[operation] || { bucket: 'general', units: 1 };
  const qty = Math.max(1, Math.floor(Number(count) || 1));
  const key = dateKey();
  return stateStore.mutate((state) => {
    if (!state.quotaUsage[key]) state.quotaUsage[key] = { searchCalls: 0, generalUnits: 0, operations: {} };
    const day = state.quotaUsage[key];
    if (cost.bucket === 'search') day.searchCalls += qty * cost.units;
    else day.generalUnits += qty * cost.units;
    day.operations[operation] = (day.operations[operation] || 0) + qty;
    day.updatedAt = new Date().toISOString();
    if (metadata && Object.keys(metadata).length) day.last = { operation, ...metadata, at: day.updatedAt };
    const keys = Object.keys(state.quotaUsage).sort().reverse();
    for (const oldKey of keys.slice(31)) delete state.quotaUsage[oldKey];
    return { ...day, estimated: true, date: key };
  });
}

async function getToday() {
  const state = await stateStore.load();
  const key = dateKey();
  const day = state.quotaUsage[key] || { searchCalls: 0, generalUnits: 0, operations: {} };
  return {
    date: key,
    searchCalls: Number(day.searchCalls) || 0,
    generalUnits: Number(day.generalUnits) || 0,
    operations: day.operations || {},
    estimated: true,
    defaultSearchLimit: 100,
    defaultGeneralLimit: 10000
  };
}

module.exports = { COSTS, dateKey, record, getToday };
