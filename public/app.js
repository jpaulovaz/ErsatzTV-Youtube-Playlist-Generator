let config = null;
let statusData = null;
let downloadItems = [];
let toastTimer = null;
let refreshInFlight = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
  }
  return payload;
}

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.textContent = String(message || '');
  toast.classList.toggle('error', error);
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5500);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** exponent);
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

function getByPath(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value && value[key], object);
}

function setByPath(object, dottedPath, value) {
  const parts = dottedPath.split('.');
  let target = object;
  while (parts.length > 1) {
    const key = parts.shift();
    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[parts[0]] = value;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function fillConfigForm() {
  if (!config) return;
  $$('#configForm [name]').forEach((field) => {
    const value = getByPath(config, field.name);
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  });
}

function collectConfigForm() {
  const next = clone(config || {});
  $$('#configForm [name]').forEach((field) => {
    let value;
    if (field.type === 'checkbox') value = field.checked;
    else if (field.type === 'number') value = numberOrNull(field.value);
    else value = field.value.trim();
    setByPath(next, field.name, value);
  });

  next.playlists = $$('#playlistList .playlist-row').map((row) => {
    const urls = row.querySelector('[data-field="urls"]').value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      name: row.querySelector('[data-field="name"]').value.trim(),
      enabled: row.querySelector('[data-field="enabled"]').checked,
      url: urls[0] || '',
      urls,
      libraryId: numberOrNull(row.querySelector('[data-field="libraryId"]').value),
      playoutId: numberOrNull(row.querySelector('[data-field="playoutId"]').value),
      cookiesPath: row.querySelector('[data-field="cookiesPath"]').value.trim(),
      maxHeight: numberOrNull(row.querySelector('[data-field="maxHeight"]').value)
    };
  }).filter((playlist) => playlist.name && playlist.urls.length > 0);

  return next;
}

function libraryStatsFor(playlist) {
  if (!statusData || !statusData.health) return null;
  return statusData.health[playlist.name] || statusData.health[playlist.folderName] || null;
}


function libraryBadgesHtml(stats) {
  if (!stats) return '<span class="badge">Sem estatisticas</span>';
  return [
    `<span class="badge info">${stats.total || 0} itens</span>`,
    `<span class="badge warn">${stats.pending || 0} pendentes</span>`,
    `<span class="badge ok">${stats.completed || 0} concluidos</span>`,
    `<span class="badge danger">${stats.failed || 0} falhas</span>`,
    `<span class="badge">${stats.orphaned || 0} orfaos</span>`,
    `<span class="badge">${formatBytes(stats.totalBytes || 0)}</span>`
  ].join('');
}

function updateLibraryStats() {
  $$('#playlistList .playlist-row').forEach((row) => {
    const nameField = row.querySelector('[data-field="name"]');
    const statsBox = row.querySelector('.library-stats');
    if (!nameField || !statsBox) return;
    statsBox.innerHTML = libraryBadgesHtml(libraryStatsFor({ name: nameField.value.trim() }));
  });
}

function renderLibraries() {
  const container = $('#playlistList');
  container.innerHTML = '';
  const playlists = config && Array.isArray(config.playlists) ? config.playlists : [];

  if (playlists.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhuma biblioteca configurada.</div>';
    return;
  }

  playlists.forEach((playlist, index) => {
    const stats = libraryStatsFor(playlist);
    const row = document.createElement('div');
    row.className = 'playlist-row';
    row.dataset.index = String(index);
    const maxHeight = playlist.maxHeight == null ? '' : String(playlist.maxHeight);
    const badges = libraryBadgesHtml(stats);

    row.innerHTML = `
      <div class="playlist-header">
        <div class="playlist-title">
          <h3>${escapeHtml(playlist.name || `Biblioteca ${index + 1}`)}</h3>
          <p>${escapeHtml((playlist.urls || []).length)} fonte(s) configurada(s).</p>
          <div class="library-stats">${badges}</div>
        </div>
        <label class="check-row"><input data-field="enabled" type="checkbox" ${playlist.enabled !== false ? 'checked' : ''}><span>Ativa</span></label>
      </div>
      <div class="form-grid three">
        <label>Nome<input data-field="name" type="text" value="${escapeHtml(playlist.name || '')}"></label>
        <label>Library ID<input data-field="libraryId" type="number" min="1" value="${playlist.libraryId || ''}"></label>
        <label>Playout ID<input data-field="playoutId" type="number" min="1" value="${playlist.playoutId || ''}"></label>
        <label class="wide">Fontes, uma URL por linha<textarea data-field="urls" rows="4">${escapeHtml((playlist.urls || []).join('\n'))}</textarea></label>
        <label>Resolucao desta biblioteca
          <select data-field="maxHeight">
            <option value="" ${maxHeight === '' ? 'selected' : ''}>Herdar configuracao geral</option>
            ${[360, 480, 720, 1080, 1440, 2160].map((height) => `<option value="${height}" ${maxHeight === String(height) ? 'selected' : ''}>${height}p</option>`).join('')}
          </select>
        </label>
        <label class="wide">cookies.txt desta biblioteca, opcional<input data-field="cookiesPath" type="text" value="${escapeHtml(playlist.cookiesPath || '')}" placeholder="Vazio usa o campo global; ambos vazios desativam cookies"></label>
      </div>
      <div class="library-actions">
        <button class="small primary" data-library-action="run">Buscar novidades</button>
        <button class="small" data-library-action="test-cookies">Testar cookies</button>
        <button class="small" data-library-action="refresh-thumbnails">Thumbnails</button>
        <button class="small" data-library-action="scan">Scan</button>
        <button class="small" data-library-action="empty-trash">Limpar lixo</button>
        <button class="small" data-library-action="rebuild-playout">Atualizar playout</button>
        <button class="small" data-library-action="legacy-cleanup">Limpar YML antigos</button>
        <button class="small" data-library-action="orphans-cleanup">Limpar orfaos</button>
        <span class="spacer"></span>
        <button class="small danger" data-library-action="remove-config">Remover configuracao</button>
        <button class="small danger" data-library-action="delete-with-files">Excluir biblioteca e arquivos</button>
      </div>
    `;
    container.appendChild(row);
  });
}

async function saveConfiguration(showMessage = true) {
  const payload = collectConfigForm();
  const result = await api('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
  config = result.config;
  fillConfigForm();
  renderLibraries();
  if (showMessage) showToast('Configuracao salva.');
  return config;
}

function statusLabel(status) {
  const labels = {
    pending: 'Pendente',
    downloading: 'Baixando',
    completed: 'Concluido',
    failed: 'Falhou',
    cancelled: 'Cancelado',
    orphaned: 'Orfao',
    removed: 'Removido'
  };
  return labels[status] || status || '-';
}

function phaseLabel(phase) {
  const labels = {
    downloading: 'Baixando',
    validating: 'Validando',
    remuxing: 'Convertendo container',
    transcoding: 'Convertendo codecs',
    finalizing: 'Finalizando'
  };
  return labels[phase] || '';
}

function statusBadgeClass(item) {
  if (item.status === 'completed' && !item.orphaned) return 'ok';
  if (item.status === 'downloading') return 'info';
  if (item.status === 'pending') return 'warn';
  if (item.status === 'failed') return 'danger';
  return '';
}

function formatDiscoverySummary(summary) {
  if (!summary) return 'Nenhuma descoberta registrada nesta execucao.';
  if (summary.message && !summary.playlists) return `Erro: ${summary.message}`;
  return [
    `Inicio: ${formatDate(summary.startedAt)}`,
    `Fim: ${formatDate(summary.finishedAt)}`,
    `Bibliotecas processadas: ${summary.playlistsProcessed || 0}`,
    `Bibliotecas com erro: ${summary.playlistsFailed || 0}`,
    `Videos encontrados: ${summary.videosFound || 0}`,
    `Novos downloads enfileirados: ${summary.downloadsQueued || 0}`,
    `Ja concluidos: ${summary.alreadyCompleted || 0}`,
    `Ja conhecidos: ${summary.alreadyKnown || 0}`,
    `Reativados: ${summary.reactivated || 0}`,
    `Marcados como orfaos: ${summary.orphaned || 0}`
  ].join('\n');
}

function renderStatus() {
  if (!statusData) return;
  const discovery = statusData.discovery || {};
  const queue = statusData.queue || {};
  const counts = queue.counts || {};
  const scheduler = statusData.scheduler || {};
  const storage = queue.storage || {};

  $('#versionBadge').textContent = `v${statusData.version || '2.0.0'}`;
  $('#discoveryState').textContent = discovery.running ? 'Em execucao' : 'Aguardando';
  $('#discoveryStep').textContent = discovery.currentStep || '-';
  $('#queueState').textContent = queue.paused ? 'Pausada' : (queue.running ? 'Baixando' : (queue.lowDiskBlocked ? 'Bloqueada por disco' : 'Aguardando'));
  $('#pendingCount').textContent = counts.pending || 0;
  $('#completedCount').textContent = counts.completed || 0;
  $('#failedCount').textContent = counts.failed || 0;
  $('#freeSpace').textContent = storage.error ? 'Erro ao medir' : formatBytes(storage.availableBytes || 0);
  $('#nextRun').textContent = scheduler.enabled ? formatDate(scheduler.nextRunAt) : 'Desativado';
  $('#lastSummary').textContent = formatDiscoverySummary(discovery.lastResult);

  const pill = $('#runningPill');
  pill.className = 'status-pill';
  if (queue.lowDiskBlocked || counts.failed > 0) pill.classList.add('danger');
  else if (queue.paused || discovery.running || queue.running) pill.classList.add('warn');
  else pill.classList.add('ok');
  pill.textContent = queue.lowDiskBlocked ? 'Disco abaixo da reserva' : (queue.paused ? 'Fila pausada' : (queue.running ? 'Download ativo' : 'Operacional'));

  const queueToggle = $('#queueToggleBtn');
  queueToggle.textContent = queue.paused ? 'Retomar fila' : 'Pausar fila';
  queueToggle.dataset.action = queue.paused ? 'resume' : 'pause';

  const currentBox = $('#currentDownload');
  const current = queue.current;
  if (!current) {
    currentBox.classList.add('hidden');
  } else {
    currentBox.classList.remove('hidden');
    const progress = current.progress || {};
    const percent = Number(progress.percent);
    const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    $('#currentTitle').textContent = current.title || current.videoId;
    const phase = phaseLabel(current.phase);
    $('#currentMeta').textContent = `${current.libraryFolder} | ${current.videoId} | ${current.maxHeight || 1080}p${phase ? ` | ${phase}` : ''}`;
    $('#currentProgress').style.width = `${safePercent}%`;
    $('#currentPercent').textContent = Number.isFinite(percent) ? `${percent.toFixed(1)}%` : 'Progresso indeterminado';
    $('#currentBytes').textContent = progress.totalBytes
      ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
      : formatBytes(progress.downloadedBytes);
    $('#currentSpeed').textContent = progress.speedBytesPerSecond ? `${formatBytes(progress.speedBytesPerSecond)}/s` : '-';
    $('#currentEta').textContent = progress.etaSeconds != null ? `ETA ${formatDuration(progress.etaSeconds)}` : '-';
    $('#cancelCurrentBtn').dataset.id = current.id;
  }

  updateLibraryStats();
}

function renderDownloads() {
  const filter = $('#downloadFilter').value;
  const items = downloadItems.filter((item) => {
    if (!filter) return true;
    if (filter === 'orphaned') return item.orphaned || item.status === 'orphaned';
    return item.status === filter;
  });
  const body = $('#downloadsBody');
  const empty = $('#downloadsEmpty');
  body.innerHTML = '';
  empty.classList.toggle('hidden', items.length > 0);

  for (const item of items) {
    const progress = item.progress || {};
    const percent = Number(progress.percent);
    const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : (item.status === 'completed' ? 100 : 0);
    const actions = [];
    if (item.status === 'pending') {
      actions.push('<button class="small" data-download-action="priority">Baixar agora</button>');
      actions.push('<button class="small danger" data-download-action="cancel">Cancelar</button>');
    } else if (item.status === 'downloading') {
      actions.push('<button class="small danger" data-download-action="cancel">Cancelar</button>');
    } else if (item.status === 'failed' || item.status === 'cancelled') {
      if (!item.orphaned) actions.push('<button class="small primary" data-download-action="retry">Tentar novamente</button>');
      actions.push('<button class="small danger" data-download-action="remove">Remover da fila</button>');
    } else if (item.status === 'removed') {
      if (!item.orphaned) actions.push('<button class="small primary" data-download-action="retry">Tentar novamente</button>');
    } else if (item.status === 'orphaned' && !item.mediaPath) {
      actions.push('<button class="small danger" data-download-action="remove">Remover da fila</button>');
    }

    const row = document.createElement('tr');
    row.dataset.id = item.id;
    row.innerHTML = `
      <td class="download-title">
        <strong>${escapeHtml(item.title || item.videoId)}</strong>
        <small>${escapeHtml(item.videoId)}${item.orphaned ? ' | fora das fontes atuais' : ''}${item.phase ? ` | ${escapeHtml(phaseLabel(item.phase))}` : ''}</small>
        ${item.lastError ? `<div class="error-text">${escapeHtml(String(item.lastError).slice(-700))}</div>` : ''}
      </td>
      <td>${escapeHtml(item.libraryFolder || '-')}</td>
      <td><span class="badge ${statusBadgeClass(item)}">${escapeHtml(statusLabel(item.status))}</span></td>
      <td>
        <div class="mini-progress"><span style="width:${safePercent}%"></span></div>
        <small>${Number.isFinite(percent) ? `${percent.toFixed(1)}%` : '-'}</small>
      </td>
      <td>${formatBytes(item.fileSizeBytes || progress.totalBytes || 0)}</td>
      <td>${item.attempts || 0}</td>
      <td><div class="row-actions">${actions.join('') || '<span class="muted">-</span>'}</div></td>
    `;
    body.appendChild(row);
  }
}

async function refreshStatus() {
  statusData = await api('/api/status');
  renderStatus();
}

async function refreshDownloads() {
  const result = await api('/api/downloads?limit=600');
  downloadItems = result.items || [];
  if (statusData) statusData.queue = result.queue;
  renderDownloads();
  if (statusData) renderStatus();
}

async function refreshLogs() {
  const result = await api('/api/logs?limit=250');
  $('#logs').textContent = (result.logs || []).map((entry) => {
    const meta = entry.meta && Object.keys(entry.meta).length ? ` ${JSON.stringify(entry.meta)}` : '';
    return `[${formatDate(entry.ts)}] ${String(entry.level || 'info').toUpperCase()} ${entry.message}${meta}`;
  }).join('\n');
}

async function refreshAll(showErrors = false) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    await Promise.all([refreshStatus(), refreshDownloads(), refreshLogs()]);
  } catch (error) {
    if (showErrors) showToast(error.message, true);
  } finally {
    refreshInFlight = false;
  }
}

async function loadInitial() {
  config = await api('/api/config');
  fillConfigForm();
  renderLibraries();
  await refreshAll(true);
  renderLibraries();
}

async function runDiscovery(name = '') {
  const url = name ? `/api/playlists/${encodeURIComponent(name)}/run` : '/api/run';
  const result = await api(url, { method: 'POST', body: '{}' });
  showToast(result.message || 'Descoberta iniciada.');
  setTimeout(() => refreshAll(), 600);
}

async function handleLibraryAction(button) {
  const row = button.closest('.playlist-row');
  const index = Number(row.dataset.index);
  await saveConfiguration(false);
  const playlist = config.playlists[index];
  if (!playlist) throw new Error('Biblioteca nao encontrada apos salvar.');
  const name = playlist.name;
  const action = button.dataset.libraryAction;

  if (action === 'remove-config') {
    if (!confirm(`Remover apenas a configuracao de "${name}"? Os videos no disco nao serao apagados.`)) return;
    config.playlists.splice(index, 1);
    await api('/api/config', { method: 'PUT', body: JSON.stringify(config) });
    config = await api('/api/config');
    fillConfigForm();
    renderLibraries();
    showToast('Biblioteca removida da configuracao. Arquivos locais preservados.');
    return;
  }

  if (action === 'delete-with-files') {
    const typed = prompt(`Acao irreversivel. Para excluir a biblioteca, videos, thumbnails e indice, digite exatamente:\n${name}`);
    if (typed === null) return;
    const result = await api(`/api/playlists/${encodeURIComponent(name)}/delete-with-files`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: typed })
    });
    config = result.result.config;
    fillConfigForm();
    renderLibraries();
    showToast('Biblioteca e arquivos excluidos.');
    await refreshAll();
    return;
  }

  if (action === 'run') {
    await runDiscovery(name);
    return;
  }

  if (action === 'legacy-cleanup') {
    const preview = await api(`/api/playlists/${encodeURIComponent(name)}/legacy-preview`, { method: 'POST', body: '{}' });
    const count = preview.result.filesToRemove || 0;
    if (!count) {
      showToast('Nenhum YML ou script legado encontrado.');
      return;
    }
    if (!confirm(`Remover ${count} arquivo(s) YML/script legado(s) de ${name}? Videos e thumbnails nao serao apagados.`)) return;
    const result = await api(`/api/playlists/${encodeURIComponent(name)}/legacy-cleanup`, { method: 'POST', body: '{}' });
    showToast(`${result.result.filesRemoved || 0} arquivo(s) legado(s) removido(s).`);
    return;
  }

  if (action === 'orphans-cleanup') {
    const preview = await api(`/api/playlists/${encodeURIComponent(name)}/orphans-preview`, { method: 'POST', body: '{}' });
    const info = preview.result;
    if (!info.count) {
      showToast('Nenhum item orfao encontrado.');
      return;
    }
    if (!confirm(`Excluir ${info.count} item(ns) orfao(s), incluindo ${info.filesCount} arquivo(s) de video e ${formatBytes(info.totalBytes)}?`)) return;
    const result = await api(`/api/playlists/${encodeURIComponent(name)}/orphans-cleanup`, { method: 'POST', body: '{}' });
    showToast(`${result.result.videosRemoved || 0} video(s) orfao(s) removido(s).`);
    await refreshAll();
    return;
  }

  const result = await api(`/api/playlists/${encodeURIComponent(name)}/${action}`, { method: 'POST', body: '{}' });
  if (action === 'test-cookies') {
    const details = result.result;
    showToast(`${details.message}${details.ytDlp && details.ytDlp.stderr ? `\n${details.ytDlp.stderr.slice(-800)}` : ''}`, !details.ok && details.status !== 'not-configured');
  } else if (action === 'refresh-thumbnails') {
    showToast(`Thumbnails: ${result.result.created || 0} criadas, ${result.result.updated || 0} atualizadas, ${result.result.failed || 0} falhas.`);
  } else {
    showToast(result.result && result.result.ok === false ? 'A acao foi enviada, mas o ErsatzTV retornou falha.' : 'Acao concluida.');
  }
  await refreshAll();
}

async function handleDownloadAction(button) {
  const row = button.closest('tr');
  const id = row ? row.dataset.id : button.dataset.id;
  const action = button.dataset.downloadAction || 'cancel';
  if (!id) return;
  if ((action === 'cancel' || action === 'remove') && !confirm(`${action === 'cancel' ? 'Cancelar' : 'Remover'} este item?`)) return;
  await api(`/api/downloads/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
  showToast('Fila atualizada.');
  await refreshAll();
}

function bindEvents() {
  $('#saveBtn').addEventListener('click', () => saveConfiguration().catch((error) => showToast(error.message, true)));
  $('#saveBtnBottom').addEventListener('click', () => saveConfiguration().catch((error) => showToast(error.message, true)));
  $('#runNowBtn').addEventListener('click', () => runDiscovery().catch((error) => showToast(error.message, true)));
  $('#refreshBtn').addEventListener('click', () => refreshAll(true));
  $('#refreshDownloadsBtn').addEventListener('click', () => refreshDownloads().catch((error) => showToast(error.message, true)));
  $('#downloadFilter').addEventListener('change', renderDownloads);

  $('#queueToggleBtn').addEventListener('click', async (event) => {
    try {
      const action = event.currentTarget.dataset.action || 'pause';
      await api(`/api/downloads/${action}`, { method: 'POST', body: '{}' });
      showToast(action === 'pause' ? 'Fila pausada.' : 'Fila retomada.');
      await refreshAll();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $('#cancelCurrentBtn').addEventListener('click', (event) => {
    event.currentTarget.dataset.downloadAction = 'cancel';
    handleDownloadAction(event.currentTarget).catch((error) => showToast(error.message, true));
  });

  $('#testYoutubeApiBtn').addEventListener('click', async () => {
    try {
      await saveConfiguration(false);
      const result = await api('/api/youtube-api/test', { method: 'POST', body: '{}' });
      showToast(result.result.message, !result.ok);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $('#addPlaylistBtn').addEventListener('click', () => {
    config.playlists = config.playlists || [];
    config.playlists.push({
      name: `Biblioteca_${config.playlists.length + 1}`,
      url: '',
      urls: [''],
      enabled: true,
      libraryId: null,
      playoutId: null,
      cookiesPath: '',
      maxHeight: null
    });
    renderLibraries();
  });

  $('#playlistList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-library-action]');
    if (!button) return;
    handleLibraryAction(button).catch((error) => showToast(error.message, true));
  });

  $('#downloadsBody').addEventListener('click', (event) => {
    const button = event.target.closest('[data-download-action]');
    if (!button) return;
    handleDownloadAction(button).catch((error) => showToast(error.message, true));
  });

  $('#clearLogsBtn').addEventListener('click', async () => {
    try {
      await api('/api/logs/clear', { method: 'POST', body: '{}' });
      await refreshLogs();
      showToast('Logs limpos.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

bindEvents();
loadInitial().catch((error) => showToast(error.message, true));
setInterval(() => refreshAll(false), 3500);
