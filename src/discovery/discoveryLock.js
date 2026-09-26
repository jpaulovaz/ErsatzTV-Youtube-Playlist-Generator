let owner = null;
let startedAt = null;

function acquire(name) {
  if (owner) return false;
  owner = String(name || 'discovery');
  startedAt = new Date().toISOString();
  return true;
}

function release(name) {
  if (!owner) return;
  if (name && owner !== String(name)) return;
  owner = null;
  startedAt = null;
}

function getStatus() {
  return { locked: Boolean(owner), owner, startedAt };
}

module.exports = { acquire, release, getStatus };
