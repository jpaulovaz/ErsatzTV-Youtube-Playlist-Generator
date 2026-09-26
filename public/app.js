let config = null;
let statusData = null;
let downloadItems = [];
let authSession = null;
let csrfToken = '';
let toastTimer = null;
let refreshInFlight = false;
let downloadRequestInFlight = false;
let downloadPagination = { total: 0, offset: 0, limit: 100, hasMore: false };
let activeView = 'overview';
const DOWNLOAD_PAGE_SIZE = 100;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const APP_VIEWS = new Set(['overview', 'downloads', 'libraries', 'settings', 'logs']);


function setMobileActionSheet(open) {
  const sheet = $('#mobileActionSheet');
  const backdrop = $('#mobileActionBackdrop');
  const trigger = $('#mobileActionsBtn');
  if (!sheet || !backdrop || !trigger) return;

  const shouldOpen = Boolean(open);
  document.body.classList.toggle('mobile-sheet-open', shouldOpen);
  sheet.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  backdrop.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  for (const region of [$('.topbar'), $('.workspace')].filter(Boolean)) {
    if ('inert' in region) region.inert = shouldOpen;
  }

  if (shouldOpen) {
    window.setTimeout(() => $('#mobileActionCloseBtn')?.focus(), 220);
  } else if (document.activeElement && sheet.contains(document.activeElement)) {
    trigger.focus();
  }
}

function setActiveView(view, { persist = true, scroll = false } = {}) {
  const nextView = APP_VIEWS.has(view) ? view : 'overview';
  activeView = nextView;
  $$('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.viewPanel === nextView);
  });
  $$('.nav-button[data-view]').forEach((button) => {
    const selected = button.dataset.view === nextView;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (persist) sessionStorage.setItem('ersatztv_active_view', nextView);
  setMobileActionSheet(false);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateSettingsAccordionToggle() {
  const button = $('#settingsAccordionToggle');
  if (!button) return;
  const accordions = $$('.settings-accordion');
  button.textContent = accordions.length > 0 && accordions.every((item) => item.open)
    ? 'Recolher tudo'
    : 'Expandir tudo';
}

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

function isMutatingMethod(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || 'GET').toUpperCase());
}

async function api(url, options = {}) {
  const { skipAuthRedirect = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const headers = { ...(fetchOptions.headers || {}) };
  if (fetchOptions.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (isMutatingMethod(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...fetchOptions,
    method,
    headers
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401 && !skipAuthRedirect) {
    window.location.replace('/login');
    throw new Error('Sessão expirada.');
  }
  if (!response.ok) {
    const error = new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload && payload.code;
    error.retryAfterSeconds = payload && payload.retryAfterSeconds;
    throw error;
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
      maxHeight: numberOrNull(row.querySelector('[data-field="maxHeight"]').value),
      subtitles: {
        enabled: row.querySelector('[data-field="subtitlesEnabled"]').checked,
        includeAuto: row.querySelector('[data-field="subtitlesIncludeAuto"]').checked,
        languages: [...row.querySelectorAll('[data-subtitle-language]')]
          .filter((input) => input.checked)
          .map((input) => input.value)
      },
      mediaProfile: row.querySelector('[data-field="mediaProfile"]').value
    };
  }).filter((playlist) => playlist.name && playlist.urls.length > 0);

  return next;
}

function libraryStatsFor(playlist) {
  if (!statusData || !statusData.health) return null;
  return statusData.health[playlist.name] || statusData.health[playlist.folderName] || null;
}

function libraryBadgesHtml(stats) {
  if (!stats) return '<span class="badge">Sem estatísticas</span>';
  const badges = [
    `<span class="badge info">${stats.total || 0} itens</span>`,
    `<span class="badge warn">${stats.pending || 0} pendentes</span>`,
    `<span class="badge ok">${stats.completed || 0} concluídos</span>`,
    `<span class="badge danger">${stats.failed || 0} falhas</span>`,
    `<span class="badge">${stats.orphaned || 0} órfãos</span>`,
    `<span class="badge">${formatBytes(stats.totalBytes || 0)}</span>`
  ];
  if (stats.subtitlesEnabled) {
    const pending = Number(stats.subtitlePending) || 0;
    const failed = Number(stats.subtitleFailed) || 0;
    const klass = failed > 0 ? 'danger' : (pending > 0 ? 'warn' : 'ok');
    const text = failed > 0
      ? `Legendas: ${failed} falha(s)`
      : (pending > 0 ? `Legendas: ${pending} pendente(s)` : 'Legendas ativas');
    badges.push(`<span class="badge ${klass}">${text}</span>`);
  }
  return badges.join('');
}

function updateLibraryStats() {
  $$('#playlistList .playlist-row').forEach((row) => {
    const nameField = row.querySelector('[data-field="name"]');
    const statsBox = row.querySelector('.library-stats');
    if (!nameField || !statsBox) return;
    statsBox.innerHTML = libraryBadgesHtml(libraryStatsFor({ name: nameField.value.trim() }));
  });
}

function updateLibraryFilters() {
  const selects = [$('#downloadLibraryFilter'), $('#clearQueueLibrary')].filter(Boolean);
  for (const select of selects) {
    const selected = select.value;
    const firstLabel = select.id === 'clearQueueLibrary' ? 'Todas as bibliotecas' : 'Todas';
    select.innerHTML = `<option value="">${firstLabel}</option>`;
    for (const playlist of config && Array.isArray(config.playlists) ? config.playlists : []) {
      const option = document.createElement('option');
      option.value = playlist.name;
      option.textContent = playlist.name;
      select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }
}

function renderLibraries() {
  const container = $('#playlistList');
  container.innerHTML = '';
  const playlists = config && Array.isArray(config.playlists) ? config.playlists : [];
  $('#navLibrariesBadge').textContent = String(playlists.length);

  if (playlists.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhuma biblioteca configurada.</div>';
    updateLibraryFilters();
    return;
  }

  playlists.forEach((playlist, index) => {
    const stats = libraryStatsFor(playlist);
    const row = document.createElement('details');
    row.className = 'playlist-row library-accordion';
    row.dataset.index = String(index);
    const maxHeight = playlist.maxHeight == null ? '' : String(playlist.maxHeight);
    const badges = libraryBadgesHtml(stats);
    const sourcesCount = (playlist.urls || []).filter(Boolean).length;
    const qualityText = maxHeight ? `${maxHeight}p` : 'Qualidade global';
    const enabled = playlist.enabled !== false;
    const subtitles = playlist.subtitles || { enabled: false, includeAuto: true, languages: ['pt-BR', 'pt', 'en', 'es'] };
    const subtitleLanguages = Array.isArray(subtitles.languages) ? subtitles.languages : ['pt-BR', 'pt', 'en', 'es'];
    const subtitleDisabled = subtitles.enabled ? '' : 'disabled';
    const subtitleText = subtitles.enabled ? ` · Legendas SRT (${subtitleLanguages.join(', ')})` : '';
    const mediaProfile = playlist.mediaProfile || 'generic';
    const profileLabels = { generic: 'Genérico', movie: 'Show / vídeo completo', music_clips: 'Clipes musicais' };
    const metadataText = ` · ${profileLabels[mediaProfile] || profileLabels.generic}`;

    row.innerHTML = `
      <summary>
        <div class="library-summary-main">
          <span class="library-index">${String(index + 1).padStart(2, '0')}</span>
          <div class="playlist-title">
            <h3>${escapeHtml(playlist.name || `Biblioteca ${index + 1}`)}</h3>
            <p>${sourcesCount} fonte(s) · ${qualityText}${subtitleText}${metadataText}</p>
            <div class="library-stats">${badges}</div>
          </div>
        </div>
        <div class="library-summary-state">
          <span class="badge library-enabled-state ${enabled ? 'ok' : ''}">${enabled ? 'Ativa' : 'Pausada'}</span>
          <span class="accordion-chevron" aria-hidden="true"></span>
        </div>
      </summary>
      <div class="library-body">
        <div class="form-grid three">
          <label>Nome<input data-field="name" type="text" value="${escapeHtml(playlist.name || '')}"></label>
          <label>Library ID<input data-field="libraryId" type="number" min="1" value="${playlist.libraryId || ''}"></label>
          <label>Playout ID<input data-field="playoutId" type="number" min="1" value="${playlist.playoutId || ''}"></label>
          <label class="wide">Fontes, uma URL por linha<textarea data-field="urls" rows="4">${escapeHtml((playlist.urls || []).join('\n'))}</textarea></label>
          <label>Resolução desta biblioteca
            <select data-field="maxHeight">
              <option value="" ${maxHeight === '' ? 'selected' : ''}>Herdar configuração geral</option>
              ${[360, 480, 720, 1080, 1440, 2160].map((height) => `<option value="${height}" ${maxHeight === String(height) ? 'selected' : ''}>${height}p</option>`).join('')}
            </select>
          </label>
          <label>Perfil
            <select data-field="mediaProfile">
              <option value="generic" ${mediaProfile === 'generic' ? 'selected' : ''}>Genérico</option>
              <option value="movie" ${mediaProfile === 'movie' ? 'selected' : ''}>Show / vídeo completo (Filmes)</option>
              <option value="music_clips" ${mediaProfile === 'music_clips' ? 'selected' : ''}>Clipes musicais (Seriados)</option>
            </select>
          </label>
          <label class="check-row"><input data-field="enabled" type="checkbox" ${enabled ? 'checked' : ''}><span>Biblioteca ativa</span></label>
          <label class="wide">cookies.txt desta biblioteca, opcional<input data-field="cookiesPath" type="text" value="${escapeHtml(playlist.cookiesPath || '')}" placeholder="Vazio usa a configuração global"></label>
          <div class="wide library-subtitle-settings">
            <div class="library-subtitle-heading">
              <div>
                <strong>Legendas</strong>
                <small>SRT externo, com o mesmo nome-base do vídeo. Novos vídeos são processados automaticamente.</small>
              </div>
              <span class="badge info">SRT</span>
            </div>
            <label class="check-row"><input data-field="subtitlesEnabled" type="checkbox" ${subtitles.enabled ? 'checked' : ''}><span>Baixar legendas nesta biblioteca</span></label>
            <div class="subtitle-options ${subtitles.enabled ? '' : 'is-disabled'}" data-subtitle-options>
              <label class="check-row"><input data-field="subtitlesIncludeAuto" type="checkbox" ${subtitles.includeAuto !== false ? 'checked' : ''} ${subtitleDisabled}><span>Incluir legendas automáticas quando disponíveis</span></label>
              <div class="subtitle-language-grid" role="group" aria-label="Idiomas de legenda">
                ${[
                  ['pt-BR', 'Português (Brasil)'],
                  ['pt', 'Português'],
                  ['en', 'English'],
                  ['es', 'Español']
                ].map(([code, label]) => `
                  <label class="subtitle-language-option">
                    <input data-subtitle-language type="checkbox" value="${code}" ${subtitleLanguages.includes(code) ? 'checked' : ''} ${subtitleDisabled}>
                    <span>${label}<small>${code}</small></span>
                  </label>
                `).join('')}
              </div>
              <p class="field-help">Marque um ou mais idiomas. O aplicativo baixa todos os selecionados que existirem no YouTube; ausência de legenda não transforma o vídeo em falha.</p>
            </div>
          </div>

        </div>

        <div class="library-actions-panel">
          <div class="library-action-group">
            <span class="library-action-group-title">Conteúdo</span>
            <div class="library-actions">
              <button class="small primary" type="button" data-library-action="run">Buscar novidades</button>
              <button class="small" type="button" data-library-action="test-cookies">Testar cookies</button>
              <button class="small" type="button" data-library-action="refresh-thumbnails">Atualizar thumbnails</button>
              <button class="small" type="button" data-library-action="refresh-subtitles">Buscar legendas ausentes</button>
            </div>
          </div>
          <div class="library-action-group">
            <span class="library-action-group-title">ErsatzTV</span>
            <div class="library-actions">
              <button class="small" type="button" data-library-action="scan">Executar scan</button>
              <button class="small" type="button" data-library-action="empty-trash">Limpar lixo</button>
              <button class="small" type="button" data-library-action="rebuild-playout">Atualizar playout</button>
              <button class="small" type="button" data-library-action="orphans-cleanup">Limpar órfãos</button>
            </div>
          </div>
          <div class="library-actions library-danger-actions">
            <button class="small danger" type="button" data-library-action="remove-config">Remover configuração</button>
            <button class="small danger" type="button" data-library-action="delete-with-files">Excluir biblioteca e arquivos</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
  updateLibraryFilters();
}

async function saveConfiguration(showMessage = true) {
  const payload = collectConfigForm();
  const result = await api('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
  config = result.config;
  fillConfigForm();
  renderLibraries();
  if (showMessage) showToast('Configuração salva.');
  return config;
}

function statusLabel(status) {
  const labels = {
    pending: 'Pendente',
    downloading: 'Baixando',
    completed: 'Concluído',
    failed: 'Falhou',
    cancelled: 'Cancelado',
    orphaned: 'Órfão',
    removed: 'Removido da fila'
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
  if (!summary) return 'Nenhuma descoberta registrada nesta execução.';
  if (summary.message && !summary.playlists) return `Erro: ${summary.message}`;
  return [
    `Início: ${formatDate(summary.startedAt)}`,
    `Fim: ${formatDate(summary.finishedAt)}`,
    `Bibliotecas processadas: ${summary.playlistsProcessed || 0}`,
    `Bibliotecas com erro: ${summary.playlistsFailed || 0}`,
    `Vídeos encontrados: ${summary.videosFound || 0}`,
    `Novos downloads enfileirados: ${summary.downloadsQueued || 0}`,
    `Já concluídos: ${summary.alreadyCompleted || 0}`,
    `Já conhecidos: ${summary.alreadyKnown || 0}`,
    `Reativados: ${summary.reactivated || 0}`,
    `Marcados como órfãos: ${summary.orphaned || 0}`
  ].join('\n');
}

function queueStateText(queue) {
  if (queue.lowDiskBlocked) return 'Bloqueada por disco';
  if (queue.paused) return 'Pausada';
  if (queue.running) return 'Baixando';
  if (queue.idleActionRunning) return 'Atualizando ErsatzTV';
  return 'Aguardando';
}

function renderStatus() {
  if (!statusData) return;
  const discovery = statusData.discovery || {};
  const queue = statusData.queue || {};
  const counts = queue.counts || {};
  const scheduler = statusData.scheduler || {};
  const storage = queue.storage || {};
  const current = queue.current;
  const progress = current && current.progress ? current.progress : {};

  $('#versionBadge').textContent = `v${statusData.version || '2.8.0'}`;
  $('#discoveryState').textContent = discovery.running ? 'Em execução' : 'Aguardando';
  $('#discoveryStep').textContent = discovery.currentStep || '-';
  $('#queueState').textContent = queueStateText(queue);
  $('#pendingCount').textContent = counts.pending || 0;
  $('#completedCount').textContent = counts.completed || 0;
  $('#failedCount').textContent = counts.failed || 0;
  $('#freeSpace').textContent = storage.error ? 'Erro ao medir' : formatBytes(storage.availableBytes || 0);
  $('#nextRun').textContent = scheduler.enabled ? formatDate(scheduler.nextRunAt) : 'Desativado';
  $('#lastSummary').textContent = formatDiscoverySummary(discovery.lastResult);

  $('#queueOverviewState').textContent = queueStateText(queue);
  $('#queueOverviewActive').textContent = queue.activeItems || 0;
  $('#queueOverviewPending').textContent = counts.pending || 0;
  $('#queueOverviewCompleted').textContent = counts.completed || 0;
  $('#queueOverviewFailed').textContent = counts.failed || 0;
  $('#queueOverviewRemoved').textContent = counts.removed || 0;
  $('#queueOverviewOrphans').textContent = counts.orphaned || 0;
  $('#queueOverviewSize').textContent = formatBytes(queue.totalBytes || 0);
  $('#queueOverviewDisk').textContent = storage.error
    ? 'Erro ao medir'
    : `${formatBytes(storage.availableBytes || 0)} livres${storage.totalBytes ? ` · ${Number(storage.usedPercent || 0).toFixed(1)}% usado` : ''}`;
  $('#queueOverviewSpeed').textContent = progress.speedBytesPerSecond ? `${formatBytes(progress.speedBytesPerSecond)}/s` : '-';
  $('#queueOverviewNextRetry').textContent = queue.nextRetryAt ? formatDate(queue.nextRetryAt) : '-';
  $('#queueOverviewLastCompleted').textContent = queue.lastCompletedAt ? formatDate(queue.lastCompletedAt) : '-';

  const activeCount = Number(queue.activeItems) || 0;
  $('#navDownloadsBadge').textContent = String(activeCount);
  $('#queueAccordionBadge').textContent = `${activeCount} ativo${activeCount === 1 ? '' : 's'}`;
  $('#queueAccordionHint').textContent = `${counts.pending || 0} pendente(s), ${counts.failed || 0} falha(s), ${queue.historyItems || 0} item(ns) no histórico.`;
  $('#clearQueueBtn').disabled = (queue.totalItems || 0) - (counts.completed || 0) <= 0;

  const pillText = queue.lowDiskBlocked
    ? 'Disco abaixo da reserva'
    : (queue.paused ? 'Fila pausada' : (queue.running ? 'Download ativo' : 'Operacional'));
  const pillClass = queue.lowDiskBlocked || counts.failed > 0
    ? 'danger'
    : (queue.paused || discovery.running || queue.running ? 'warn' : 'ok');

  const pill = $('#runningPill');
  pill.className = `status-pill ${pillClass}`;
  pill.textContent = pillText;

  const mobilePill = $('#mobileRunningPill');
  if (mobilePill) {
    mobilePill.className = `mobile-status-pill ${pillClass}`;
    const text = mobilePill.querySelector('.mobile-status-text');
    if (text) text.textContent = pillText;
    mobilePill.title = pillText;
  }

  const sheetStatus = $('#mobileSheetStatus');
  if (sheetStatus) {
    sheetStatus.className = `status-pill ${pillClass}`;
    sheetStatus.textContent = pillText;
  }

  $('#sidebarStatusText').textContent = pillText;
  $('#sidebarNextRun').textContent = scheduler.enabled
    ? `Próxima busca: ${formatDate(scheduler.nextRunAt)}`
    : 'Agendador desativado';
  const sidebarDot = $('.sidebar-status-dot');
  sidebarDot.classList.toggle('warn', queue.paused || discovery.running || queue.running);
  sidebarDot.classList.toggle('danger', queue.lowDiskBlocked || counts.failed > 0);

  for (const queueToggle of [$('#queueToggleBtn'), $('#mobileQueueToggleBtn')].filter(Boolean)) {
    const label = queue.paused ? 'Retomar fila' : 'Pausar fila';
    queueToggle.dataset.action = queue.paused ? 'resume' : 'pause';
    if (queueToggle.id === 'mobileQueueToggleBtn') {
      const strong = queueToggle.querySelector('strong');
      if (strong) strong.textContent = label;
      const icon = queueToggle.querySelector('svg');
      if (icon) {
        icon.innerHTML = queue.paused
          ? '<path d="m8 5 10 7-10 7Z"/>'
          : '<path d="M8 5v14M16 5v14"/>';
      }
    } else {
      queueToggle.textContent = label;
    }
  }

  const currentBox = $('#currentDownload');
  if (!current) {
    currentBox.classList.add('hidden');
  } else {
    currentBox.classList.remove('hidden');
    const percent = Number(progress.percent);
    const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    $('#currentTitle').textContent = current.title || current.videoId;
    const phase = phaseLabel(current.phase);
    $('#currentMeta').textContent = `${current.libraryFolder} | ${current.videoId} | ${current.maxHeight || 1080}p${phase ? ` | ${phase}` : ''}`;
    $('#currentProgress').value = safePercent;
    $('#currentProgress').textContent = `${safePercent.toFixed(1)}%`;
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
  const body = $('#downloadsBody');
  const empty = $('#downloadsEmpty');
  body.innerHTML = '';
  empty.classList.toggle('hidden', downloadItems.length > 0);

  for (const item of downloadItems) {
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
    row.className = 'download-row';
    row.dataset.id = item.id;
    row.innerHTML = `
      <td class="download-title" data-label="Vídeo">
        <strong>${escapeHtml(item.title || item.videoId)}</strong>
        <small>${escapeHtml(item.videoId)}${item.orphaned ? ' | fora das fontes atuais' : ''}${item.phase ? ` | ${escapeHtml(phaseLabel(item.phase))}` : ''}</small>
        ${item.lastError ? `<div class="error-text">${escapeHtml(String(item.lastError).slice(-700))}</div>` : ''}
      </td>
      <td data-label="Biblioteca">${escapeHtml(item.libraryFolder || '-')}</td>
      <td data-label="Status"><span class="badge ${statusBadgeClass(item)}">${escapeHtml(statusLabel(item.status))}</span></td>
      <td data-label="Progresso">
        <progress class="mini-progress" max="100" value="${safePercent}">${safePercent}%</progress>
        <small>${Number.isFinite(percent) ? `${percent.toFixed(1)}%` : '-'}</small>
      </td>
      <td data-label="Tamanho">${formatBytes(item.fileSizeBytes || progress.totalBytes || 0)}</td>
      <td data-label="Tentativas">${item.attempts || 0}</td>
      <td data-label="Ações"><div class="row-actions">${actions.join('') || '<span class="muted">-</span>'}</div></td>
    `;
    body.appendChild(row);
  }

  const shown = downloadItems.length;
  const total = downloadPagination.total || 0;
  $('#downloadsPaginationInfo').textContent = total ? `${shown} de ${total} item(ns)` : 'Nenhum item';
  $('#loadMoreDownloadsBtn').classList.toggle('hidden', !downloadPagination.hasMore);
}

async function refreshStatus() {
  statusData = await api('/api/status');
  renderStatus();
}

function downloadQuery(offset = 0, limit = DOWNLOAD_PAGE_SIZE) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const status = $('#downloadFilter').value;
  const library = $('#downloadLibraryFilter').value;
  if (status) params.set('status', status);
  if (library) params.set('library', library);
  return params.toString();
}

async function refreshDownloads(options = {}) {
  const { append = false, force = false, preserveLoaded = false } = options;
  if (!force && !$('#downloadsAccordion').open) return;
  if (downloadRequestInFlight) return;
  downloadRequestInFlight = true;
  try {
    const offset = append ? downloadItems.length : 0;
    const limit = append ? DOWNLOAD_PAGE_SIZE : (preserveLoaded ? Math.max(DOWNLOAD_PAGE_SIZE, Math.min(downloadItems.length || DOWNLOAD_PAGE_SIZE, 500)) : DOWNLOAD_PAGE_SIZE);
    const result = await api(`/api/downloads?${downloadQuery(offset, limit)}`);
    if (append) {
      const byId = new Map(downloadItems.map((item) => [item.id, item]));
      for (const item of result.items || []) byId.set(item.id, item);
      downloadItems = [...byId.values()];
    } else {
      downloadItems = result.items || [];
    }
    downloadPagination = result.pagination || { total: downloadItems.length, offset: 0, limit, hasMore: false };
    if (statusData) statusData.queue = result.queue;
    renderDownloads();
    if (statusData) renderStatus();
  } finally {
    downloadRequestInFlight = false;
  }
}

async function refreshLogs() {
  const result = await api('/api/logs?limit=250');
  $('#logs').textContent = (result.logs || []).map((entry) => {
    const meta = entry.meta && Object.keys(entry.meta).length ? ` ${JSON.stringify(entry.meta)}` : '';
    return `[${formatDate(entry.ts)}] ${String(entry.level || 'info').toUpperCase()} ${entry.message}${meta}`;
  }).join('\n');
}

async function refreshAll(showErrors = false, options = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const tasks = [refreshStatus(), refreshLogs()];
    if ($('#downloadsAccordion').open || options.forceDownloads) {
      tasks.push(refreshDownloads({ force: true, preserveLoaded: true }));
    }
    await Promise.all(tasks);
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
  if (!playlist) throw new Error('Biblioteca não encontrada após salvar.');
  const name = playlist.name;
  const action = button.dataset.libraryAction;

  if (action === 'remove-config') {
    if (!confirm(`Remover apenas a configuração de "${name}"? Os vídeos no disco não serão apagados.`)) return;
    config.playlists.splice(index, 1);
    await api('/api/config', { method: 'PUT', body: JSON.stringify(config) });
    config = await api('/api/config');
    fillConfigForm();
    renderLibraries();
    showToast('Biblioteca removida da configuração. Arquivos locais preservados.');
    return;
  }

  if (action === 'delete-with-files') {
    const typed = prompt(`Ação irreversível. Para excluir a biblioteca, vídeos, thumbnails e índice, digite exatamente:\n${name}`);
    if (typed === null) return;
    const result = await api(`/api/playlists/${encodeURIComponent(name)}/delete-with-files`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: typed })
    });
    config = result.result.config;
    fillConfigForm();
    renderLibraries();
    showToast('Biblioteca e arquivos excluídos.');
    await refreshAll();
    return;
  }

  if (action === 'run') {
    await runDiscovery(name);
    return;
  }

  if (action === 'orphans-cleanup') {
    const preview = await api(`/api/playlists/${encodeURIComponent(name)}/orphans-preview`, { method: 'POST', body: '{}' });
    const info = preview.result;
    if (!info.count) {
      showToast('Nenhum item órfão encontrado.');
      return;
    }
    if (!confirm(`Excluir ${info.count} item(ns) órfão(s), incluindo ${info.filesCount} arquivo(s) de vídeo e ${formatBytes(info.totalBytes)}?`)) return;
    const result = await api(`/api/playlists/${encodeURIComponent(name)}/orphans-cleanup`, { method: 'POST', body: '{}' });
    showToast(`${result.result.videosRemoved || 0} vídeo(s) órfão(s) removido(s).`);
    await refreshAll();
    return;
  }

  const result = await api(`/api/playlists/${encodeURIComponent(name)}/${action}`, { method: 'POST', body: '{}' });
  if (action === 'test-cookies') {
    const details = result.result;
    showToast(`${details.message}${details.ytDlp && details.ytDlp.stderr ? `\n${details.ytDlp.stderr.slice(-800)}` : ''}`, !details.ok && details.status !== 'not-configured');
  } else if (action === 'refresh-thumbnails') {
    showToast(`Thumbnails: ${result.result.created || 0} criadas, ${result.result.updated || 0} atualizadas, ${result.result.failed || 0} falhas.`);
  } else if (action === 'refresh-subtitles') {
    const details = result.result;
    showToast(details.queued > 0
      ? `Legendas: ${details.queued} vídeo(s) enfileirado(s) para verificação. O scan do ErsatzTV ocorrerá uma vez ao final.`
      : `Legendas: nenhum download necessário; ${details.alreadyComplete || 0} vídeo(s) já possuem os idiomas selecionados.`);
  } else {
    showToast(result.result && result.result.ok === false ? 'A ação foi enviada, mas o ErsatzTV retornou falha.' : 'Ação concluída.');
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
  await refreshAll(false, { forceDownloads: $('#downloadsAccordion').open });
}

function openClearQueueDialog() {
  updateLibraryFilters();
  $('#clearQueueCancelCurrent').checked = true;
  const dialog = $('#clearQueueDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else if (confirm('Limpar todos os itens não concluídos da fila?')) clearQueue().catch((error) => showToast(error.message, true));
}

async function clearQueue() {
  const library = $('#clearQueueLibrary').value;
  const cancelCurrent = $('#clearQueueCancelCurrent').checked;
  const result = await api('/api/downloads/clear', {
    method: 'POST',
    body: JSON.stringify({ library, cancelCurrent })
  });
  $('#clearQueueDialog').close();
  showToast(`${result.result.removed || 0} item(ns) retirado(s) da fila. ${result.result.completedPreserved || 0} concluído(s) preservado(s).`);
  downloadItems = [];
  await refreshAll(true, { forceDownloads: $('#downloadsAccordion').open });
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } finally {
    window.location.replace('/login');
  }
}

async function toggleQueueFrom(button) {
  const action = button.dataset.action || 'pause';
  await api(`/api/downloads/${action}`, { method: 'POST', body: '{}' });
  showToast(action === 'pause' ? 'Fila pausada.' : 'Fila retomada.');
  await refreshAll();
}

function bindEvents() {
  $$('.nav-button[data-view]').forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.view, { scroll: true }));
  });

  $('#settingsAccordionToggle').addEventListener('click', () => {
    const accordions = $$('.settings-accordion');
    const shouldOpen = !accordions.every((item) => item.open);
    accordions.forEach((item) => { item.open = shouldOpen; });
    updateSettingsAccordionToggle();
  });
  $$('.settings-accordion').forEach((item) => item.addEventListener('toggle', updateSettingsAccordionToggle));

  $('#saveBtn').addEventListener('click', () => saveConfiguration().catch((error) => showToast(error.message, true)));
  $('#saveBtnBottom').addEventListener('click', () => saveConfiguration().catch((error) => showToast(error.message, true)));
  $('#runNowBtn').addEventListener('click', () => runDiscovery().catch((error) => showToast(error.message, true)));
  $('#refreshBtn').addEventListener('click', () => refreshAll(true, { forceDownloads: $('#downloadsAccordion').open }));
  $('#refreshDownloadsBtn').addEventListener('click', () => refreshDownloads({ force: true }).catch((error) => showToast(error.message, true)));
  $('#loadMoreDownloadsBtn').addEventListener('click', () => refreshDownloads({ append: true, force: true }).catch((error) => showToast(error.message, true)));
  $('#downloadFilter').addEventListener('change', () => {
    downloadItems = [];
    refreshDownloads({ force: true }).catch((error) => showToast(error.message, true));
  });
  $('#downloadLibraryFilter').addEventListener('change', () => {
    downloadItems = [];
    refreshDownloads({ force: true }).catch((error) => showToast(error.message, true));
  });
  $('#downloadsAccordion').addEventListener('toggle', (event) => {
    if (event.currentTarget.open) refreshDownloads({ force: true }).catch((error) => showToast(error.message, true));
  });

  for (const button of [$('#queueToggleBtn'), $('#mobileQueueToggleBtn')].filter(Boolean)) {
    button.addEventListener('click', async (event) => {
      try {
        await toggleQueueFrom(event.currentTarget);
        setMobileActionSheet(false);
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  $('#mobileActionsBtn')?.addEventListener('click', () => setMobileActionSheet(true));
  $('#mobileActionCloseBtn')?.addEventListener('click', () => setMobileActionSheet(false));
  $('#mobileActionBackdrop')?.addEventListener('click', () => setMobileActionSheet(false));
  $('#mobileRunNowBtn')?.addEventListener('click', () => {
    runDiscovery()
      .then(() => setMobileActionSheet(false))
      .catch((error) => showToast(error.message, true));
  });
  $('#mobileRefreshBtn')?.addEventListener('click', () => {
    refreshAll(true, { forceDownloads: $('#downloadsAccordion').open })
      .then(() => {
        showToast('Dados atualizados.');
        setMobileActionSheet(false);
      })
      .catch((error) => showToast(error.message, true));
  });
  $('#mobileLogoutBtn')?.addEventListener('click', () => logout().catch(() => window.location.replace('/login')));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('mobile-sheet-open')) {
      setMobileActionSheet(false);
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) setMobileActionSheet(false);
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
      maxHeight: null,
      subtitles: {
        enabled: false,
        includeAuto: true,
        languages: ['pt-BR', 'pt', 'en', 'es']
      },
      mediaProfile: 'generic'
    });
    renderLibraries();
    requestAnimationFrame(() => {
      const created = $$('#playlistList .playlist-row').at(-1);
      if (created) {
        created.open = true;
        created.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  $('#playlistList').addEventListener('change', (event) => {
    const input = event.target.closest('[data-field]');
    if (!input) return;
    const row = input.closest('.playlist-row');
    if (!row) return;

    if (input.dataset.field === 'enabled') {
      const badge = row.querySelector('.library-enabled-state');
      if (!badge) return;
      badge.textContent = input.checked ? 'Ativa' : 'Pausada';
      badge.classList.toggle('ok', input.checked);
      return;
    }

    if (input.dataset.field === 'subtitlesEnabled') {
      const options = row.querySelector('[data-subtitle-options]');
      if (!options) return;
      options.classList.toggle('is-disabled', !input.checked);
      options.querySelectorAll('input').forEach((control) => { control.disabled = !input.checked; });
    }
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

  $('#clearQueueBtn').addEventListener('click', openClearQueueDialog);
  $('#confirmClearQueueBtn').addEventListener('click', () => clearQueue().catch((error) => showToast(error.message, true)));
  $('#logoutBtn').addEventListener('click', () => logout().catch(() => window.location.replace('/login')));

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

async function bootstrap() {
  authSession = await api('/api/auth/session', { skipAuthRedirect: true });
  if (!authSession.authenticated) {
    window.location.replace('/login');
    return;
  }
  csrfToken = authSession.csrfToken || '';
  const username = authSession.username || 'Usuário';
  const initial = String(username || 'U').slice(0, 1).toUpperCase();
  $('#signedInUser').textContent = username;
  $('#userInitial').textContent = initial;
  if ($('#mobileSignedInUser')) $('#mobileSignedInUser').textContent = username;
  if ($('#mobileUserInitial')) $('#mobileUserInitial').textContent = initial;
  $('#downloadsAccordion').open = false;
  $$('.settings-accordion').forEach((item) => { item.open = false; });
  setActiveView(sessionStorage.getItem('ersatztv_active_view') || 'overview', { persist: false });
  updateSettingsAccordionToggle();
  bindEvents();
  await loadInitial();
  setInterval(() => refreshAll(false), 4000);
}

bootstrap().catch((error) => {
  showToast(error.message, true);
  if (error.status === 401) window.location.replace('/login');
});
