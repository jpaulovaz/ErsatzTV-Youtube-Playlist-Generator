let currentConfig = null;
let refreshTimer = null;

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

function showToast(message) {
  const toast = qs('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error((payload && payload.error) || `HTTP ${response.status}`);
  }

  return payload;
}

function getByPath(object, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), object);
}

function setByPath(object, dottedPath, value) {
  const parts = dottedPath.split('.');
  let target = object;
  while (parts.length > 1) {
    const key = parts.shift();
    target[key] = target[key] || {};
    target = target[key];
  }
  target[parts[0]] = value;
}

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function fillForm(config) {
  qsa('#configForm [name]').forEach((field) => {
    const value = getByPath(config, field.name);
    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? '';
    }
  });
}

function readForm() {
  const config = JSON.parse(JSON.stringify(currentConfig));

  qsa('#configForm [name]').forEach((field) => {
    let value;
    if (field.type === 'checkbox') {
      value = field.checked;
    } else if (field.type === 'number') {
      value = Number(field.value);
    } else {
      value = field.value.trim();
    }
    setByPath(config, field.name, value);
  });

  config.playlists = qsa('.playlist-row').map((row) => ({
    name: row.querySelector('[data-field="name"]').value.trim(),
    url: row.querySelector('[data-field="url"]').value.trim(),
    enabled: row.querySelector('[data-field="enabled"]').checked,
    libraryId: optionalNumber(row.querySelector('[data-field="libraryId"]').value),
    playoutId: optionalNumber(row.querySelector('[data-field="playoutId"]').value),
    cookiesPath: row.querySelector('[data-field="cookiesPath"]').value.trim()
  })).filter((playlist) => playlist.name && playlist.url);

  return config;
}

function renderPlaylists(playlists) {
  const container = qs('#playlistList');
  container.innerHTML = '';

  for (const playlist of playlists || []) {
    addPlaylistRow(playlist);
  }
}

function addPlaylistRow(playlist = { name: '', url: '', enabled: true, libraryId: null, playoutId: null, cookiesPath: '' }) {
  const container = qs('#playlistList');
  const row = document.createElement('div');
  row.className = 'playlist-row';

  row.innerHTML = `
    <div class="playlist-fields">
      <label>Nome da pasta
        <input data-field="name" type="text" value="">
      </label>
      <label>URL da playlist
        <input data-field="url" type="text" value="">
      </label>
      <label>Library ID
        <input data-field="libraryId" type="number" min="1" value="">
      </label>
      <label>Playout ID
        <input data-field="playoutId" type="number" min="1" value="">
      </label>
      <label>Caminho do cookies.txt desta playlist
        <input data-field="cookiesPath" type="text" placeholder="Vazio usa o caminho global">
      </label>
      <label class="check-row">
        <input data-field="enabled" type="checkbox">
        <span>Ativa</span>
      </label>
    </div>
    <div class="playlist-actions">
      <button type="button" class="primary" data-action="run">Executar esta biblioteca</button>
      <button type="button" data-action="cleanup">Limpar YML ausentes</button>
      <button type="button" data-action="scan">Scan biblioteca</button>
      <button type="button" data-action="empty-trash">Limpar lixo ErsatzTV</button>
      <button type="button" data-action="rebuild-playout">Atualizar playout</button>
      <button type="button" class="danger" data-action="remove">Remover da config</button>
    </div>
  `;

  row.querySelector('[data-field="name"]').value = playlist.name || '';
  row.querySelector('[data-field="url"]').value = playlist.url || '';
  row.querySelector('[data-field="libraryId"]').value = playlist.libraryId || '';
  row.querySelector('[data-field="playoutId"]').value = playlist.playoutId || '';
  row.querySelector('[data-field="cookiesPath"]').value = playlist.cookiesPath || '';
  row.querySelector('[data-field="enabled"]').checked = playlist.enabled !== false;

  row.querySelector('[data-action="remove"]').addEventListener('click', () => row.remove());
  row.querySelector('[data-action="run"]').addEventListener('click', () => runPlaylistAction(row, 'run'));
  row.querySelector('[data-action="cleanup"]').addEventListener('click', () => runPlaylistAction(row, 'cleanup'));
  row.querySelector('[data-action="scan"]').addEventListener('click', () => runPlaylistAction(row, 'scan'));
  row.querySelector('[data-action="empty-trash"]').addEventListener('click', () => runPlaylistAction(row, 'empty-trash'));
  row.querySelector('[data-action="rebuild-playout"]').addEventListener('click', () => runPlaylistAction(row, 'rebuild-playout'));

  container.appendChild(row);
}

function assertPlaylistSaved(name) {
  return (currentConfig.playlists || []).some((playlist) => playlist.name === name);
}

async function runPlaylistAction(row, action) {
  const name = row.querySelector('[data-field="name"]').value.trim();
  if (!name) {
    showToast('Informe o nome da playlist antes de executar a acao.');
    return;
  }

  if (!assertPlaylistSaved(name)) {
    showToast('Salve a configuracao antes de executar acoes nesta playlist.');
    return;
  }

  if (action === 'cleanup') {
    const confirmed = window.confirm(`Remover YML que nao aparecem mais na playlist "${name}"?`);
    if (!confirmed) return;
  }

  const payload = await api(`/api/playlists/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
  if (action === 'run') {
    showToast(payload.message || 'Sincronizacao da playlist iniciada. Acompanhe pelos logs.');
  } else {
    showToast(payload.result && payload.result.ok === false ? 'Acao enviada, mas a API retornou falha. Veja os logs.' : 'Acao executada. Veja os logs.');
  }
  await refreshAll();
}

async function loadConfig() {
  currentConfig = await api('/api/config');
  fillForm(currentConfig);
  renderPlaylists(currentConfig.playlists || []);
}

async function saveConfig() {
  const config = readForm();
  const result = await api('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  currentConfig = result.config;
  fillForm(currentConfig);
  renderPlaylists(currentConfig.playlists || []);
  showToast('Configuracao salva. Mudancas de host/porta exigem reinicio do app.');
  await refreshAll();
}

async function runNow() {
  await api('/api/run', { method: 'POST' });
  showToast('Sincronizacao iniciada. Acompanhe pelos logs.');
  await refreshAll();
}

function renderStatus(status) {
  const running = Boolean(status.sync.running);
  const pill = qs('#runningPill');
  pill.textContent = running ? 'Executando' : 'Ocioso';
  pill.classList.toggle('running', running);
  pill.classList.toggle('idle', !running);

  qs('#syncState').textContent = running ? 'Executando' : 'Ocioso';
  qs('#syncStep').textContent = status.sync.currentStep || '-';
  qs('#lastRun').textContent = formatDate(status.sync.finishedAt || status.sync.startedAt);
  qs('#nextRun').textContent = status.scheduler.nextRunAt ? formatDate(status.scheduler.nextRunAt) : '-';

  const summary = status.sync.lastResult || status.sync.lastError || null;
  qs('#lastSummary').textContent = summary ? JSON.stringify(summary, null, 2) : 'Sem execucao registrada ainda.';
}

function renderLogs(payload) {
  const lines = (payload.logs || []).map((log) => {
    const time = formatDate(log.ts);
    const meta = log.meta && Object.keys(log.meta).length ? ` ${JSON.stringify(log.meta)}` : '';
    return `[${time}] ${String(log.level).toUpperCase()}: ${log.message}${meta}`;
  });
  const box = qs('#logs');
  box.textContent = lines.join('\n');
  box.scrollTop = box.scrollHeight;
}

async function refreshAll() {
  try {
    const [status, logs] = await Promise.all([
      api('/api/status'),
      api('/api/logs?limit=250')
    ]);
    renderStatus(status);
    renderLogs(logs);
  } catch (error) {
    showToast(error.message);
  }
}

async function clearLogs() {
  await api('/api/logs/clear', { method: 'POST' });
  await refreshAll();
}

async function boot() {
  try {
    await loadConfig();
    await refreshAll();
    refreshTimer = setInterval(refreshAll, 3000);
  } catch (error) {
    showToast(error.message);
  }
}

qs('#saveBtn').addEventListener('click', (event) => {
  event.preventDefault();
  saveConfig().catch((error) => showToast(error.message));
});

qs('#runNowBtn').addEventListener('click', () => {
  runNow().catch((error) => showToast(error.message));
});

qs('#addPlaylistBtn').addEventListener('click', () => addPlaylistRow());

qs('#clearLogsBtn').addEventListener('click', () => {
  clearLogs().catch((error) => showToast(error.message));
});

window.addEventListener('beforeunload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

boot();
