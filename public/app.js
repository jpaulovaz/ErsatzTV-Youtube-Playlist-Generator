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

function streamMaxHeight(value) {
  return optionalNumber(value) || 720;
}

const CODEC_PROFILE_OPTIONS = ['auto', 'mp4_h264_aac'];

function normalizeCodecProfile(value) {
  return CODEC_PROFILE_OPTIONS.includes(value) ? value : 'auto';
}

function buildCompatibleFormat(maxHeight, codecProfile = 'auto') {
  const height = streamMaxHeight(maxHeight);
  const profile = normalizeCodecProfile(codecProfile);

  if (profile === 'mp4_h264_aac') {
    return `best[height<=${height}][ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[height<=${height}][ext=mp4][vcodec!=none][acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
  }

  return `best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
}

function buildHighQualityFormat(maxHeight, codecProfile = 'auto') {
  const height = streamMaxHeight(maxHeight);
  const profile = normalizeCodecProfile(codecProfile);

  if (profile === 'mp4_h264_aac') {
    return `bestvideo[height<=${height}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=${height}][ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
  }

  return `bestvideo[height<=${height}][vcodec!=none]+bestaudio[acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
}

function buildFormatSort(maxHeight) {
  return `res:${streamMaxHeight(maxHeight)},fps`;
}

const JS_RUNTIME_DEFAULT_PATHS = {
  deno: '/usr/local/bin/deno',
  node: '/usr/bin/node',
  custom: ''
};
const JS_RUNTIME_MODES = ['disabled', 'deno', 'node', 'custom'];
const EJS_COMPONENT_OPTIONS = ['none', 'ejs:github', 'ejs:npm'];

function defaultJsRuntimePath(mode) {
  return JS_RUNTIME_DEFAULT_PATHS[mode] || '';
}

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function refreshYtDlpJsUi(applyDefaults = false) {
  const modeField = qs('[name="stream.jsRuntimeMode"]');
  const pathField = qs('[name="stream.jsRuntimePath"]');
  const customNameField = qs('[name="stream.jsRuntimeCustomName"]');
  const customNameWrapper = qs('[data-js-runtime-custom]');
  const ejsField = qs('[name="stream.ejsComponents"]');

  if (!modeField) return;

  const mode = JS_RUNTIME_MODES.includes(modeField.value) ? modeField.value : 'deno';
  const defaultPath = defaultJsRuntimePath(mode);

  if (pathField) {
    pathField.placeholder = defaultPath || 'Ex.: /usr/local/bin/deno';
    if (applyDefaults && mode !== 'custom') {
      pathField.value = defaultPath;
    } else if (!pathField.value.trim() && defaultPath) {
      pathField.value = defaultPath;
    }

    pathField.readOnly = mode === 'disabled';
    pathField.classList.toggle('readonly', mode === 'disabled');
  }

  if (customNameWrapper) {
    customNameWrapper.classList.toggle('hidden', mode !== 'custom');
  }

  if (customNameField) {
    customNameField.readOnly = mode !== 'custom';
    customNameField.classList.toggle('readonly', mode !== 'custom');
    if (!customNameField.value.trim()) customNameField.value = 'deno';
  }

  if (ejsField && applyDefaults) {
    if (mode === 'disabled') {
      ejsField.value = 'none';
    } else if (!EJS_COMPONENT_OPTIONS.includes(ejsField.value) || ejsField.value === 'none') {
      ejsField.value = 'ejs:github';
    }
  }
}

function resolveFormatForMode(mode, maxHeight, currentFormat, codecProfile = 'auto') {
  const profile = normalizeCodecProfile(codecProfile);
  if (mode === 'compatible') return buildCompatibleFormat(maxHeight, profile);
  if (mode === 'high') return buildHighQualityFormat(maxHeight, profile);
  return String(currentFormat || '').trim() || buildCompatibleFormat(maxHeight, profile);
}

function refreshStreamQualityUi(applyDefaults = false) {
  const modeField = qs('[name="stream.qualityMode"]');
  const heightField = qs('[name="stream.maxHeight"]');
  const codecProfileField = qs('[name="stream.codecProfile"]');
  const formatField = qs('[name="stream.format"]');
  const useSortField = qs('[name="stream.useFormatSort"]');
  const sortField = qs('[name="stream.formatSort"]');
  const useMergeField = qs('[name="stream.useMergeOutputFormat"]');
  const mergeField = qs('[name="stream.mergeOutputFormat"]');

  if (!modeField || !heightField || !formatField) return;

  const mode = modeField.value || 'compatible';
  const height = streamMaxHeight(heightField.value);
  const codecProfile = codecProfileField ? codecProfileField.value : 'auto';
  const autoFormat = resolveFormatForMode(mode, height, formatField.value, codecProfile);

  if (mode !== 'custom') {
    formatField.value = autoFormat;
    formatField.readOnly = true;
    formatField.classList.add('readonly');
  } else {
    formatField.readOnly = false;
    formatField.classList.remove('readonly');
  }

  if (sortField) {
    sortField.placeholder = buildFormatSort(height);
    if (applyDefaults && (mode === 'high' || !sortField.value.trim())) {
      sortField.value = buildFormatSort(height);
    }
  }

  if (mergeField && applyDefaults && !mergeField.value.trim()) {
    mergeField.value = 'mkv';
  }

  if (applyDefaults && useSortField && useMergeField) {
    if (mode === 'high') {
      useSortField.checked = true;
      useMergeField.checked = true;
    } else if (mode === 'compatible') {
      useSortField.checked = false;
      useMergeField.checked = false;
    }
  }
}

function normalizeStreamBeforeSave(stream) {
  stream.qualityMode = ['compatible', 'high', 'custom'].includes(stream.qualityMode) ? stream.qualityMode : 'compatible';
  stream.codecProfile = normalizeCodecProfile(stream.codecProfile);
  stream.maxHeight = streamMaxHeight(stream.maxHeight);
  stream.format = resolveFormatForMode(stream.qualityMode, stream.maxHeight, stream.format, stream.codecProfile);

  if (!String(stream.formatSort || '').trim()) {
    stream.formatSort = buildFormatSort(stream.maxHeight);
  }

  if (!String(stream.mergeOutputFormat || '').trim()) {
    stream.mergeOutputFormat = 'mkv';
  }

  stream.jsRuntimeMode = JS_RUNTIME_MODES.includes(stream.jsRuntimeMode) ? stream.jsRuntimeMode : 'deno';
  stream.jsRuntimePath = String(stream.jsRuntimePath || '').trim();
  if (!stream.jsRuntimePath && stream.jsRuntimeMode !== 'disabled') {
    stream.jsRuntimePath = defaultJsRuntimePath(stream.jsRuntimeMode);
  }
  stream.jsRuntimeCustomName = sanitizeJsRuntimeName(stream.jsRuntimeCustomName) || 'deno';
  stream.ejsComponents = EJS_COMPONENT_OPTIONS.includes(stream.ejsComponents) ? stream.ejsComponents : 'ejs:github';
  if (stream.jsRuntimeMode === 'disabled') {
    stream.ejsComponents = 'none';
  }

  stream.useFormatSort = Boolean(stream.useFormatSort);
  stream.useMergeOutputFormat = Boolean(stream.useMergeOutputFormat);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}


function formatCookieTestDetails(result) {
  if (!result) return '';

  const lines = [
    result.ok ? 'Cookies validos no teste ativo.' : 'Teste de cookies falhou.',
    `Status: ${result.status || '-'}`,
    result.message ? `Mensagem: ${result.message}` : '',
    result.cookiesPath ? `Arquivo: ${result.cookiesPath}` : '',
    result.cookieFile && result.cookieFile.modifiedAt ? `Atualizado em: ${formatDate(result.cookieFile.modifiedAt)}` : '',
    result.target && result.target.url ? `Video testado: ${result.target.url}` : '',
    result.ytDlp && result.ytDlp.code !== null && result.ytDlp.code !== undefined ? `yt-dlp exit code: ${result.ytDlp.code}` : '',
    !result.ok && result.ytDlp && result.ytDlp.stderr ? `stderr:
${result.ytDlp.stderr}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

function renderPlaylistInlineResult(row, result, fallbackMessage = '') {
  const box = row.querySelector('[data-role="playlist-result"]');
  if (!box) return;

  box.textContent = result ? formatCookieTestDetails(result) : fallbackMessage;
  box.classList.remove('hidden', 'ok', 'fail');
  box.classList.add(result && result.ok ? 'ok' : 'fail');
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
  refreshStreamQualityUi(false);
  refreshYtDlpJsUi(false);
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

  normalizeStreamBeforeSave(config.stream);

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
      <button type="button" data-action="test-cookies">Testar cookies</button>
      <button type="button" data-action="cleanup">Limpar YML ausentes</button>
      <button type="button" data-action="scan">Scan biblioteca</button>
      <button type="button" data-action="empty-trash">Limpar lixo ErsatzTV</button>
      <button type="button" data-action="rebuild-playout">Atualizar playout</button>
      <button type="button" class="danger" data-action="remove">Remover da config</button>
    </div>
    <pre class="playlist-result hidden" data-role="playlist-result"></pre>
  `;

  row.querySelector('[data-field="name"]').value = playlist.name || '';
  row.querySelector('[data-field="url"]').value = playlist.url || '';
  row.querySelector('[data-field="libraryId"]').value = playlist.libraryId || '';
  row.querySelector('[data-field="playoutId"]').value = playlist.playoutId || '';
  row.querySelector('[data-field="cookiesPath"]').value = playlist.cookiesPath || '';
  row.querySelector('[data-field="enabled"]').checked = playlist.enabled !== false;

  row.querySelector('[data-action="remove"]').addEventListener('click', () => row.remove());
  row.querySelector('[data-action="run"]').addEventListener('click', () => runPlaylistAction(row, 'run'));
  row.querySelector('[data-action="test-cookies"]').addEventListener('click', () => runPlaylistAction(row, 'test-cookies'));
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
  } else if (action === 'test-cookies') {
    renderPlaylistInlineResult(row, payload.result);
    showToast(payload.result && payload.result.ok ? 'Cookies validos no teste ativo.' : 'Teste de cookies falhou. Veja o resultado na playlist e os logs.');
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

function bindSaveButton(selector) {
  const button = qs(selector);
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    saveConfig().catch((error) => showToast(error.message));
  });
}

function bindStreamQualityControls() {
  const modeField = qs('[name="stream.qualityMode"]');
  const heightField = qs('[name="stream.maxHeight"]');
  const codecProfileField = qs('[name="stream.codecProfile"]');

  if (modeField) {
    modeField.addEventListener('change', () => refreshStreamQualityUi(true));
  }

  if (heightField) {
    heightField.addEventListener('change', () => refreshStreamQualityUi(true));
    heightField.addEventListener('input', () => refreshStreamQualityUi(false));
  }

  if (codecProfileField) {
    codecProfileField.addEventListener('change', () => refreshStreamQualityUi(true));
  }
}

function bindYtDlpJsControls() {
  const modeField = qs('[name="stream.jsRuntimeMode"]');
  const pathField = qs('[name="stream.jsRuntimePath"]');

  if (modeField) {
    modeField.addEventListener('change', () => refreshYtDlpJsUi(true));
  }

  if (pathField) {
    pathField.addEventListener('input', () => refreshYtDlpJsUi(false));
  }
}

bindStreamQualityControls();
bindYtDlpJsControls();
bindSaveButton('#saveBtn');
bindSaveButton('#saveBtnBottom');

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
