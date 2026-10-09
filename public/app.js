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
let ersatzTvCatalog = { channels: [], smartCollections: [], smartCollectionSelections: {}, channelsAvailable: false, smartCollectionsAvailable: false };
let ersatzTvVersionTimer = null;
let ersatzTvVersionRequest = 0;
const DOWNLOAD_PAGE_SIZE = 100;
const LIBRARY_CONTENT_PAGE_SIZE = 60;
const ERSATZTV_VERSION_DEBOUNCE_MS = 650;
let libraryContentRequestId = 0;
let libraryContentSearchTimer = null;
let libraryContentState = {
  active: false,
  libraryName: '',
  endpointBase: '',
  returnView: 'libraries',
  view: 'content',
  subtitleOrigin: 'all',
  library: null,
  path: '',
  query: '',
  directories: [],
  items: [],
  itemMap: new Map(),
  selectedIds: new Set(),
  pagination: { total: 0, offset: 0, limit: LIBRARY_CONTENT_PAGE_SIZE, hasMore: false }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const APP_VIEWS = new Set(['overview', 'downloads', 'libraries', 'channels', 'youtube-manager', 'scripted-schedules', 'help', 'settings', 'logs']);
const MOBILE_NAV_BREAKPOINT = 760;
const MOBILE_NAV_IDLE_MS = 3600;
const MOBILE_NAV_SCROLL_THRESHOLD = 8;
let mobileNavHideTimer = null;
let mobileNavLastScrollY = Math.max(0, window.scrollY || 0);
let mobileNavTouchStartY = null;
let mobileNavTouchStartX = null;

function isMobileNavMode() {
  return window.innerWidth <= MOBILE_NAV_BREAKPOINT;
}

function clearMobileNavHideTimer() {
  if (!mobileNavHideTimer) return;
  window.clearTimeout(mobileNavHideTimer);
  mobileNavHideTimer = null;
}

function hideMobileNav() {
  if (!isMobileNavMode()) return;
  clearMobileNavHideTimer();
  $('.sidebar')?.classList.add('mobile-nav-hidden');
}

function scheduleMobileNavHide() {
  clearMobileNavHideTimer();
  if (!isMobileNavMode() || document.body.classList.contains('mobile-sheet-open')) return;
  mobileNavHideTimer = window.setTimeout(() => hideMobileNav(), MOBILE_NAV_IDLE_MS);
}

function centerActiveMobileNav({ behavior = 'smooth' } = {}) {
  if (!isMobileNavMode()) return;
  const sidebar = $('.sidebar');
  const active = sidebar?.querySelector('.nav-button.active');
  if (!sidebar || !active) return;
  const targetLeft = Math.max(0, active.offsetLeft - ((sidebar.clientWidth - active.offsetWidth) / 2));
  sidebar.scrollTo({ left: targetLeft, behavior });
}

function showMobileNav({ scheduleHide = true, centerActive = false } = {}) {
  if (!isMobileNavMode()) return;
  $('.sidebar')?.classList.remove('mobile-nav-hidden');
  if (centerActive) window.requestAnimationFrame(() => centerActiveMobileNav());
  if (scheduleHide) scheduleMobileNavHide();
}

function syncMobileNavForViewport() {
  const sidebar = $('.sidebar');
  if (!sidebar) return;
  if (!isMobileNavMode()) {
    clearMobileNavHideTimer();
    sidebar.classList.remove('mobile-nav-hidden');
    sidebar.scrollLeft = 0;
    return;
  }
  mobileNavLastScrollY = Math.max(0, window.scrollY || 0);
  showMobileNav({ scheduleHide: true, centerActive: true });
}

function bindMobileNavBehavior() {
  const sidebar = $('.sidebar');
  if (!sidebar) return;

  window.addEventListener('scroll', () => {
    if (!isMobileNavMode()) return;
    const currentY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    const delta = currentY - mobileNavLastScrollY;
    if (Math.abs(delta) < MOBILE_NAV_SCROLL_THRESHOLD) return;

    if (delta > 0 && currentY > MOBILE_NAV_SCROLL_THRESHOLD) hideMobileNav();
    else showMobileNav({ scheduleHide: true });
    mobileNavLastScrollY = currentY;
  }, { passive: true });

  document.addEventListener('touchstart', (event) => {
    if (!isMobileNavMode()) return;
    mobileNavTouchStartY = event.touches?.[0]?.clientY ?? null;
    mobileNavTouchStartX = event.touches?.[0]?.clientX ?? null;
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    if (!isMobileNavMode() || mobileNavTouchStartY === null || mobileNavTouchStartX === null) return;
    const endY = event.changedTouches?.[0]?.clientY ?? mobileNavTouchStartY;
    const endX = event.changedTouches?.[0]?.clientX ?? mobileNavTouchStartX;
    const deltaY = endY - mobileNavTouchStartY;
    const deltaX = endX - mobileNavTouchStartX;
    mobileNavTouchStartY = null;
    mobileNavTouchStartX = null;

    const verticalGesture = Math.abs(deltaY) > Math.abs(deltaX);
    if (verticalGesture && deltaY < -MOBILE_NAV_SCROLL_THRESHOLD) hideMobileNav();
    else showMobileNav({ scheduleHide: true });
  }, { passive: true });

  sidebar.addEventListener('pointerdown', () => showMobileNav({ scheduleHide: false }));
  sidebar.addEventListener('pointerup', () => scheduleMobileNavHide());
  sidebar.addEventListener('pointercancel', () => scheduleMobileNavHide());
}


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
  if (isMobileNavMode()) showMobileNav({ scheduleHide: true, centerActive: true });
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function goToViewHome(view) {
  const nextView = APP_VIEWS.has(view) ? view : 'overview';
  setActiveView(nextView, { scroll: true });
  if (nextView === 'downloads') {
    const accordion = $('#downloadsAccordion');
    if (accordion) accordion.open = false;
    if ($('#downloadFilter')) $('#downloadFilter').value = 'all';
    if ($('#downloadLibraryFilter')) $('#downloadLibraryFilter').value = '';
  } else if (nextView === 'libraries') {
    libraryContentRequestId += 1;
    setLibraryContentMode(false);
    $$('.library-accordion').forEach((item) => { item.open = false; });
  } else if (nextView === 'channels') {
    await window.ChannelView?.home?.();
  } else if (nextView === 'youtube-manager') {
    await window.YouTubeManagerView?.home?.();
  } else if (nextView === 'scripted-schedules') {
    await window.ScriptedSchedulesView?.home?.();
  } else if (nextView === 'help') {
    window.HelpView?.home?.();
  } else if (nextView === 'settings') {
    $$('.settings-accordion').forEach((item) => { item.open = false; });
    updateSettingsAccordionToggle();
  } else if (nextView === 'logs') {
    await refreshLogs();
  }
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
    error.payload = payload;
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

function showAppDialog(options = {}) {
  const dialog = $('#appDialog');
  const title = $('#appDialogTitle');
  const message = $('#appDialogMessage');
  const eyebrow = $('#appDialogEyebrow');
  const warning = $('#appDialogWarning');
  const inputWrap = $('#appDialogInputWrap');
  const inputLabel = $('#appDialogInputLabel');
  const input = $('#appDialogInput');
  const confirmButton = $('#appDialogConfirm');
  const secondaryButton = $('#appDialogSecondary');
  const cancelButton = $('#appDialogCancel');

  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.reject(new Error('Este navegador não oferece suporte ao diálogo interno do aplicativo.'));
  }

  const expectedText = options.expectedText == null ? null : String(options.expectedText);
  const showInput = expectedText !== null || options.input === true;
  const inputRequired = Boolean(options.inputRequired);
  dialog.returnValue = '';
  eyebrow.textContent = String(options.eyebrow || 'Confirmação');
  title.textContent = String(options.title || 'Confirmar ação');
  message.textContent = String(options.message || '');
  warning.textContent = String(options.warning || '');
  warning.classList.toggle('hidden', !options.warning);
  confirmButton.textContent = String(options.confirmLabel || 'OK');
  confirmButton.classList.toggle('danger', Boolean(options.danger));
  cancelButton.textContent = String(options.cancelLabel || 'Cancelar');

  const secondaryLabel = String(options.secondaryLabel || '').trim();
  secondaryButton.textContent = secondaryLabel || 'Outra opção';
  secondaryButton.classList.toggle('hidden', !secondaryLabel);
  secondaryButton.classList.toggle('danger', Boolean(options.secondaryDanger));

  input.value = String(options.inputValue || '');
  inputWrap.classList.toggle('hidden', !showInput);
  inputLabel.textContent = String(options.inputLabel || 'Confirmação');
  input.placeholder = String(options.inputPlaceholder || '');

  const syncConfirmState = () => {
    const exactInvalid = expectedText !== null && input.value !== expectedText;
    const requiredInvalid = inputRequired && !input.value.trim();
    confirmButton.disabled = exactInvalid || requiredInvalid;
  };
  input.oninput = syncConfirmState;
  syncConfirmState();

  return new Promise((resolve) => {
    const finish = () => {
      input.oninput = null;
      const action = dialog.returnValue || 'cancel';
      resolve({
        action,
        confirmed: action === 'confirm',
        secondary: action === 'secondary',
        value: input.value
      });
    };
    dialog.addEventListener('close', finish, { once: true });
    dialog.showModal();
    window.setTimeout(() => {
      if (showInput) input.focus();
      else cancelButton.focus();
    }, 0);
  });
}

async function refreshErsatzTvCatalog({ showErrors = false } = {}) {
  try {
    const response = await api('/api/ersatztv/catalog');
    ersatzTvCatalog = response.catalog || ersatzTvCatalog;
    if (config && config.ersatztv && ersatzTvCatalog.smartCollectionSelections) {
      config.ersatztv.smartCollectionSelections = clone(ersatzTvCatalog.smartCollectionSelections);
    }
    if (window.DestinationForm) {
      window.DestinationForm.setErsatzTvCatalog(ersatzTvCatalog);
      window.DestinationForm.refreshCatalogControls(document);
    }
    return ersatzTvCatalog;
  } catch (error) {
    ersatzTvCatalog = { channels: [], smartCollections: [], smartCollectionSelections: config && config.ersatztv && config.ersatztv.smartCollectionSelections || {}, channelsAvailable: false, smartCollectionsAvailable: false };
    if (window.DestinationForm) {
      window.DestinationForm.setErsatzTvCatalog(ersatzTvCatalog);
      window.DestinationForm.refreshCatalogControls(document);
    }
    if (showErrors) showToast(`ErsatzTV: ${error.message}`, true);
    return ersatzTvCatalog;
  }
}

function setErsatzTvVersionStatus(state = 'hidden', text = '') {
  const status = $('#ersatzTvVersionStatus');
  const label = $('#ersatzTvVersionText');
  if (!status || !label) return;
  status.classList.toggle('hidden', state === 'hidden');
  status.classList.remove('ok', 'warn', 'danger');
  if (state !== 'hidden' && state !== 'checking') status.classList.add(state);
  label.textContent = String(text || 'Verificando...');
}

function currentErsatzTvConnectionForm() {
  const url = $('#configForm [name="ersatztv.url"]')?.value.trim() || '';
  const apiKey = $('#configForm [name="ersatztv.apiKey"]')?.value.trim() || '';
  const timeoutField = $('#configForm [name="ersatztv.apiTimeoutSeconds"]');
  return {
    url,
    apiKey,
    apiTimeoutSeconds: Number(timeoutField?.value) || 10
  };
}

async function checkErsatzTvVersion() {
  const connection = currentErsatzTvConnectionForm();
  const requestId = ++ersatzTvVersionRequest;
  if (!connection.url || !connection.apiKey) {
    setErsatzTvVersionStatus('hidden');
    return;
  }

  setErsatzTvVersionStatus('checking', 'Verificando...');
  try {
    const response = await api('/api/ersatztv/version', {
      method: 'POST',
      body: JSON.stringify(connection)
    });
    if (requestId !== ersatzTvVersionRequest) return;
    if (!response.ok) {
      const authFailure = response.status === 401 || response.status === 403;
      setErsatzTvVersionStatus(authFailure ? 'danger' : 'warn', authFailure ? 'API Key inválida' : 'ErsatzTV indisponível');
      return;
    }

    const appVersion = String(response.version && response.version.appVersion || '').trim();
    const apiVersion = Number(response.version && response.version.apiVersion);
    const versionLabel = appVersion
      ? (/^v/i.test(appVersion) ? appVersion : `v${appVersion}`)
      : (Number.isFinite(apiVersion) ? `API ${apiVersion}` : 'Conectado');
    setErsatzTvVersionStatus('ok', versionLabel);
  } catch {
    if (requestId !== ersatzTvVersionRequest) return;
    setErsatzTvVersionStatus('warn', 'ErsatzTV indisponível');
  }
}

function scheduleErsatzTvVersionCheck({ immediate = false } = {}) {
  if (ersatzTvVersionTimer) window.clearTimeout(ersatzTvVersionTimer);
  const connection = currentErsatzTvConnectionForm();
  if (!connection.url || !connection.apiKey) {
    ersatzTvVersionRequest += 1;
    setErsatzTvVersionStatus('hidden');
    return;
  }
  setErsatzTvVersionStatus('checking', 'Verificando...');
  ersatzTvVersionTimer = window.setTimeout(() => {
    ersatzTvVersionTimer = null;
    checkErsatzTvVersion();
  }, immediate ? 0 : ERSATZTV_VERSION_DEBOUNCE_MS);
}

async function handleSmartCollectionSelection(select) {
  const fields = select.closest('.destination-fields');
  const libraryInput = fields && fields.querySelector('[data-field="libraryId"]');
  const libraryId = numberOrNull(libraryInput && libraryInput.value);
  const selectedValue = String(select.value || '');
  if (!libraryId || !selectedValue) {
    select.value = '';
    return;
  }

  try {
    if (selectedValue === '__new__') {
      const decision = await showAppDialog({
        eyebrow: 'ErsatzTV',
        title: 'Nova Smart Collection',
        message: `A coleção usará library_id:${libraryId}.`,
        input: true,
        inputRequired: true,
        inputLabel: 'Nome da Smart Collection',
        confirmLabel: 'Criar'
      });
      if (!decision.confirmed) return;
      const response = await api('/api/ersatztv/smart-collections/link', {
        method: 'POST',
        body: JSON.stringify({ mode: 'create', libraryId, name: decision.value.trim() })
      });
      showToast(`Smart Collection "${response.result.name}" criada.`);
      await refreshErsatzTvCatalog();
      return;
    }

    const collectionId = Number(selectedValue);
    const collection = (ersatzTvCatalog.smartCollections || []).find((item) => Number(item.id) === collectionId);
    if (!collection) throw new Error('Smart Collection não encontrada. Atualize a página e tente novamente.');

    const decision = await showAppDialog({
      eyebrow: 'Smart Collection',
      title: collection.name,
      message: `Vincular library_id:${libraryId} a esta coleção?`,
      confirmLabel: 'Agregar',
      secondaryLabel: 'Substituir',
      cancelLabel: 'Cancelar'
    });
    if (!decision.confirmed && !decision.secondary) return;
    const mode = decision.secondary ? 'replace' : 'aggregate';
    const response = await api('/api/ersatztv/smart-collections/link', {
      method: 'POST',
      body: JSON.stringify({ mode, libraryId, collectionId })
    });
    if (response.result.alreadyPresent) showToast('Esta Library ID já faz parte da Smart Collection.');
    else showToast(mode === 'replace' ? 'Query da Smart Collection substituída.' : 'Library ID agregada à Smart Collection.');
    await refreshErsatzTvCatalog();
  } finally {
    select.value = '';
  }
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
    const playlist = window.DestinationForm.collect(row, {});
    return playlist;
  }).filter((playlist) => playlist.name && Array.isArray(playlist.urls) && playlist.urls.length > 0);
  const missingOrphanPolicy = next.playlists.find((playlist) => !playlist.orphanPolicy);
  if (missingOrphanPolicy) throw new Error(`Selecione como tratar Arquivos órfãos em "${missingOrphanPolicy.name}".`);

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
    stats.quarantined ? `<span class="badge warn">${stats.quarantined} quarentena</span>` : '',
    stats.ignored ? `<span class="badge">${stats.ignored} ignorado(s)</span>` : '',
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
    const stats = libraryStatsFor({ name: nameField.value.trim() });
    statsBox.innerHTML = libraryBadgesHtml(stats);
    const policy = row.querySelector('[data-field="orphanPolicy"]')?.value || '';
    const slot = row.querySelector('[data-library-orphan-action-slot]');
    if (slot) {
      if (policy === 'mark' && Number(stats && stats.orphaned) > 0) slot.innerHTML = '<button class="small" type="button" data-library-action="orphans-cleanup">Limpar órfãos</button>';
      else if (policy === 'quarantine' && Number(stats && stats.quarantined) > 0) slot.innerHTML = '<button class="small" type="button" data-library-action="orphans-recover">Recuperar órfãos</button>';
      else slot.innerHTML = '';
    }
  });
}

function updateLibraryFilters() {
  const selects = [$('#downloadLibraryFilter'), $('#clearQueueLibrary')].filter(Boolean);
  const destinations = [];
  for (const playlist of config && Array.isArray(config.playlists) ? config.playlists : []) {
    destinations.push({ value: playlist.name, label: playlist.name });
  }
  for (const channel of config && Array.isArray(config.channels) ? config.channels : []) {
    const globalMeta = [
      ['uploads', 'Todos os uploads'], ['videos', 'Vídeos'], ['shorts', 'Shorts'], ['streams', 'Transmissões finalizadas']
    ];
    for (const [kind, label] of globalMeta) {
      if (channel.globalSources && channel.globalSources[kind]) {
        destinations.push({ value: `channel:${channel.channelId}:${kind}`, label: `${channel.name} · ${label}` });
      }
    }
    for (const playlist of channel.playlists || []) {
      destinations.push({ value: `channel:${channel.channelId}:playlist:${playlist.playlistId}`, label: `${channel.name} · ${playlist.name}` });
    }
  }
  for (const select of selects) {
    const selected = select.value;
    const firstLabel = select.id === 'clearQueueLibrary' ? 'Todos os destinos' : 'Todos';
    select.innerHTML = `<option value="">${firstLabel}</option>`;
    for (const destination of destinations) {
      const option = document.createElement('option');
      option.value = destination.value;
      option.textContent = destination.label;
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
    const profileLabels = window.DestinationForm.PROFILE_LABELS;
    const metadataText = ` · ${profileLabels[mediaProfile] || profileLabels.generic}`;
    const orphanAction = playlist.orphanPolicy === 'mark' && Number(stats && stats.orphaned) > 0
      ? '<button class="small" type="button" data-library-action="orphans-cleanup">Limpar órfãos</button>'
      : (playlist.orphanPolicy === 'quarantine' && Number(stats && stats.quarantined) > 0
        ? '<button class="small" type="button" data-library-action="orphans-recover">Recuperar órfãos</button>'
        : '');

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
        ${window.DestinationForm.renderFields(playlist, { mode: 'library', includeName: true, includeIds: true, includeUrls: true, enabledLabel: 'Biblioteca ativa' })}

        <div class="library-actions-panel">
          <div class="library-action-group">
            <span class="library-action-group-title">Conteúdo</span>
            <div class="library-actions">
              <button class="small primary" type="button" data-library-action="run">Buscar novidades</button>
              <button class="small" type="button" data-library-action="view-content">Gerenciar conteúdo</button>
              <button class="small" type="button" data-library-action="test-cookies">Testar cookies</button>
              <button class="small" type="button" data-library-action="refresh-subtitles">Buscar legendas ausentes</button>
              <span data-library-orphan-action-slot>${orphanAction}</span>
            </div>
          </div>
          <div class="library-action-group">
            <span class="library-action-group-title">ErsatzTV</span>
            <div class="library-actions">
              <button class="small" type="button" data-library-action="scan">Executar scan</button>
              <button class="small" type="button" data-library-action="empty-trash">Limpar lixo</button>
              <button class="small" type="button" data-library-action="reset-playout">Reset Playout</button>
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
    window.DestinationForm.syncSubtitleControls(row);
    window.DestinationForm.syncErsatzTvControls(row);
    window.DestinationForm.syncOrphanControls(row);
  });
  updateLibraryFilters();
}

function libraryContentEpisodeLabel(item) {
  if (item.seasonNumber == null || item.episodeNumber == null) return '';
  return `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`;
}

function libraryContentSubtitleLabel(item) {
  const subtitles = item.subtitles || {};
  if (Array.isArray(subtitles.languages) && subtitles.languages.length > 0) return subtitles.languages.join(', ');
  const labels = {
    complete: 'Configuradas, sem idioma registrado',
    pending: 'Pendentes',
    checking: 'Em verificação',
    failed: 'Falha',
    unavailable: 'Indisponíveis',
    disabled: 'Desativadas'
  };
  return labels[subtitles.status] || 'Nenhuma registrada';
}

function setLibraryContentMode(active) {
  libraryContentState.active = Boolean(active);
  $('#librariesConfigView').classList.toggle('hidden', libraryContentState.active);
  $('#libraryContentBrowser').classList.toggle('hidden', !libraryContentState.active);
  if (!libraryContentState.active) {
    $('#libraryContentDetails').classList.add('hidden');
  }
}

function renderLibraryContentBreadcrumbs() {
  const container = $('#libraryContentBreadcrumbs');
  const library = libraryContentState.library || {};
  const parts = libraryContentState.path ? libraryContentState.path.split('/') : [];
  const crumbs = [`<button type="button" data-library-content-path="">${escapeHtml(library.name || libraryContentState.libraryName || 'Biblioteca')}</button>`];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    crumbs.push('<span class="separator" aria-hidden="true">/</span>');
    crumbs.push(`<button type="button" data-library-content-path="${escapeHtml(current)}">${escapeHtml(part)}</button>`);
  }
  if (libraryContentState.query) {
    crumbs.push('<span class="separator" aria-hidden="true">/</span>');
    crumbs.push('<span class="muted">Pesquisa</span>');
  }
  container.innerHTML = crumbs.join('');
}

function bindLibraryContentImages(container) {
  container.querySelectorAll('[data-library-content-image] img').forEach((image) => {
    const frame = image.closest('[data-library-content-image]');
    if (!frame) return;
    const markLoaded = () => {
      frame.classList.add('has-image');
      image.classList.remove('is-missing');
    };
    const markMissing = () => {
      frame.classList.remove('has-image');
      image.classList.add('is-missing');
    };
    image.addEventListener('load', markLoaded, { once: true });
    image.addEventListener('error', markMissing, { once: true });
    if (image.complete) {
      if (image.naturalWidth > 0) markLoaded();
      else markMissing();
    }
  });
}

function updateLibraryContentViewControls() {
  const select = $('#libraryContentView');
  const originLabel = $('#libraryContentSubtitleOriginLabel');
  const originSelect = $('#libraryContentSubtitleOrigin');
  if (!select) return;
  const counts = libraryContentState.library && libraryContentState.library.specialCounts || {};
  const countKeys = {
    'subtitles-missing': 'subtitleMissing',
    'subtitles-present': 'subtitlePresent',
    orphans: 'orphans',
    quarantine: 'quarantine',
    ignored: 'ignored'
  };
  const labels = {
    content: 'Conteúdo',
    'subtitles-missing': 'Sem legendas',
    'subtitles-present': 'Com legendas',
    orphans: 'Órfãos',
    quarantine: 'Quarentena',
    ignored: 'Ignorados'
  };
  for (const option of select.options) {
    if (option.value === 'content') {
      option.disabled = false;
      option.textContent = labels.content;
      continue;
    }
    const count = Number(counts[countKeys[option.value]]) || 0;
    option.disabled = count === 0 && option.value !== libraryContentState.view;
    option.textContent = `${labels[option.value] || option.textContent}${count ? ` (${count})` : ''}`;
  }
  select.value = libraryContentState.view;

  const showOrigin = libraryContentState.view === 'subtitles-present';
  if (originLabel) originLabel.classList.toggle('hidden', !showOrigin);
  if (originSelect) {
    originSelect.value = libraryContentState.subtitleOrigin || 'all';
    const originCounts = libraryContentState.subtitleOriginCounts || {};
    const originLabels = { youtube: 'YouTube', lrclib: 'LRCLIB', gemini: 'Gemini', local: 'Arquivo local / origem não registrada' };
    for (const option of originSelect.options) {
      if (option.value === 'all') { option.textContent = 'Todas as origens'; option.disabled = false; continue; }
      const count = Number(originCounts[option.value]) || 0;
      option.textContent = `${originLabels[option.value] || option.textContent}${count ? ` (${count})` : ''}`;
      option.disabled = count === 0 && option.value !== libraryContentState.subtitleOrigin;
    }
  }
}

function updateLibraryContentBatchActions() {
  const box = $('#libraryContentBatchActions');
  const primary = $('#libraryContentBatchPrimary');
  const remove = $('#libraryContentBatchDelete');
  if (!box || !primary || !remove) return;
  const count = libraryContentState.selectedIds.size;
  const allowed = ['quarantine', 'ignored'].includes(libraryContentState.view);
  box.classList.toggle('hidden', !allowed || count === 0);
  if (!allowed || count === 0) return;
  if (libraryContentState.view === 'quarantine') {
    primary.textContent = `Restaurar selecionados (${count})`;
    primary.dataset.contentBatchAction = 'restore-keep';
  } else {
    primary.textContent = `Reativar selecionados (${count})`;
    primary.dataset.contentBatchAction = 'reactivate';
  }
  remove.textContent = `Excluir definitivamente (${count})`;
}

function renderLibraryContent() {
  const library = libraryContentState.library || {};
  const viewLabels = { content: 'Conteúdo', 'subtitles-missing': 'Sem legendas', 'subtitles-present': 'Com legendas', orphans: 'Órfãos', quarantine: 'Quarentena', ignored: 'Ignorados' };
  $('#libraryContentTitle').textContent = `${library.name || libraryContentState.libraryName || 'Conteúdo'} · ${viewLabels[libraryContentState.view] || 'Conteúdo'}`;
  $('#libraryContentCount').textContent = `${Number(library.totalVideos) || 0} vídeo(s) no acervo ativo`;
  updateLibraryContentViewControls();
  renderLibraryContentBreadcrumbs();
  $('#libraryContentBreadcrumbs').classList.toggle('hidden', libraryContentState.view !== 'content');

  const folders = $('#libraryContentFolders');
  folders.innerHTML = libraryContentState.view !== 'content' || libraryContentState.query ? '' : libraryContentState.directories.map((folder) => {
    const posterUrl = folder.posterItemId
      ? `${libraryContentState.endpointBase}/content-folder-poster?id=${encodeURIComponent(folder.posterItemId)}`
      : '';
    return `
      <button type="button" class="library-content-folder" data-library-content-folder="${escapeHtml(folder.path)}">
        ${posterUrl ? `<span class="library-content-folder-poster" data-library-content-image>
          <span class="library-content-folder-poster-placeholder" aria-hidden="true">Sem poster</span>
          <img loading="lazy" alt="" src="${posterUrl}">
        </span>` : ''}
        <span class="library-content-folder-copy"><strong>${escapeHtml(folder.name)}</strong><small>${Number(folder.totalVideos) || 0} vídeo(s)</small></span>
        <span class="library-content-folder-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }).join('');
  bindLibraryContentImages(folders);

  const pagination = libraryContentState.pagination || {};
  let status;
  if (libraryContentState.view !== 'content') {
    status = `${pagination.total || 0} item(ns) em ${String(viewLabels[libraryContentState.view] || '').toLowerCase()}`;
    if (libraryContentState.view === 'subtitles-present' && libraryContentState.subtitleOrigin !== 'all') {
      const originLabels = { youtube: 'YouTube', lrclib: 'LRCLIB', gemini: 'Gemini', local: 'arquivo local/origem não registrada' };
      status += ` · origem: ${originLabels[libraryContentState.subtitleOrigin] || libraryContentState.subtitleOrigin}`;
    }
  }
  else if (libraryContentState.query) status = `${pagination.total || 0} resultado(s) em toda a biblioteca`;
  else status = `${libraryContentState.directories.length} pasta(s) · ${pagination.total || 0} vídeo(s) diretamente neste nível`;
  $('#libraryContentStatus').textContent = status;

  const items = $('#libraryContentItems');
  items.innerHTML = libraryContentState.items.map((item) => {
    const episode = libraryContentEpisodeLabel(item);
    const duration = item.durationSeconds ? formatDuration(item.durationSeconds) : '';
    const details = [item.stateLabel && libraryContentState.view !== 'content' ? item.stateLabel : '', episode, duration, item.releaseDate].filter(Boolean);
    const thumbnailUrl = `${libraryContentState.endpointBase}/content-thumbnail?id=${encodeURIComponent(item.id)}`;
    const visibleTitle = item.title || item.videoId;
    const selectable = item.selectable && ['quarantine', 'ignored'].includes(libraryContentState.view);
    const selected = libraryContentState.selectedIds.has(item.id);
    return `
      <article class="library-content-card ${selected ? 'is-selected' : ''}">
        ${selectable ? `<label class="library-content-select"><input type="checkbox" data-library-content-select="${escapeHtml(item.id)}" ${selected ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(visibleTitle)}"></label>` : ''}
        <button type="button" class="library-content-thumb-button" data-library-content-item="${escapeHtml(item.id)}" aria-label="Abrir detalhes de ${escapeHtml(visibleTitle)}">
          <span class="library-content-thumb" data-library-content-image>
            <span class="library-content-thumb-placeholder">Sem imagem</span>
            ${item.hasThumbnail ? `<img loading="lazy" alt="" src="${thumbnailUrl}">` : ''}
          </span>
        </button>
        <span class="library-content-card-copy">
          <strong class="library-content-card-title">${escapeHtml(visibleTitle)}</strong>
          <small>${escapeHtml(item.artist || item.relativeDirectory || '')}</small>
          <span class="library-content-card-meta">${details.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</span>
        </span>
      </article>
    `;
  }).join('');
  bindLibraryContentImages(items);

  const hasAnything = libraryContentState.items.length > 0 || (libraryContentState.view === 'content' && !libraryContentState.query && libraryContentState.directories.length > 0);
  $('#libraryContentEmpty').classList.toggle('hidden', hasAnything);
  $('#libraryContentLoadMoreBtn').classList.toggle('hidden', !pagination.hasMore);
  updateLibraryContentBatchActions();
}

function closeLibraryContentDetails() {
  $('#libraryContentDetails').classList.add('hidden');
  if (window.SubtitleManagerUI) window.SubtitleManagerUI.close();
}

function contentDetailActions(item) {
  if (!item) return [];
  if (item.userDisposition === 'ignored') {
    const actions = [{ action: 'reactivate', label: 'Reativar', danger: false }];
    if (item.storageState === 'quarantined') actions.push({ action: 'delete-permanently', label: 'Excluir definitivamente agora', danger: true });
    return actions;
  }
  if (item.storageState === 'quarantined') {
    return [
      { action: 'restore-keep', label: 'Restaurar e manter', danger: false },
      { action: 'delete-permanently', label: 'Excluir definitivamente', danger: true }
    ];
  }
  if (item.userDisposition === 'keep' && item.sourceActive === false && item.storageState === 'active') {
    return [
      { action: 'quarantine', label: 'Enviar para quarentena', danger: false },
      { action: 'delete-permanently', label: 'Excluir definitivamente', danger: true }
    ];
  }
  if (item.sourceActive !== false && item.storageState === 'active') {
    return [{ action: 'ignore', label: 'Excluir e ignorar', danger: true }];
  }
  return [];
}

function showLibraryContentDetails(item) {
  if (!item) return;
  const episode = libraryContentEpisodeLabel(item) || '-';
  const rows = [
    ['Estado', item.stateLabel || 'Ativo'],
    ['Título', item.title || '-'],
    ['Artista', item.artist || '-'],
    ['Data', item.releaseDate || '-'],
    ['Episódio', episode],
    ['Duração', item.durationSeconds ? formatDuration(item.durationSeconds) : '-'],
    ['Arquivo', item.relativeFile || '-'],
    ['Tamanho', item.fileSizeBytes ? formatBytes(item.fileSizeBytes) : '-'],
    ['Legendas', libraryContentSubtitleLabel(item)],
    ['Video ID', item.videoId || '-'],
    ['Expira', item.quarantineExpiresAt ? formatDate(item.quarantineExpiresAt) : '-']
  ];
  $('#libraryContentDetailsTitle').textContent = item.title || item.videoId || 'Vídeo';
  $('#libraryContentDetailsList').innerHTML = rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  const hasLocalMedia = ['active', 'quarantined'].includes(String(item.storageState || 'active')) && Number(item.fileSizeBytes || 0) > 0;
  const subtitleActions = item.videoId
    ? [
        '<button type="button" class="small" data-subtitle-manager-open>Gerenciar legendas</button>',
        ...(hasLocalMedia ? ['<button type="button" class="small" data-subtitle-player-open>Abrir player</button>'] : [])
      ]
    : [];
  const contentActions = contentDetailActions(item).map((entry) => (
    `<button type="button" class="small ${entry.danger ? 'danger' : ''}" data-content-item-action="${entry.action}" data-item-id="${escapeHtml(item.id)}">${escapeHtml(entry.label)}</button>`
  ));
  $('#libraryContentDetailsActions').innerHTML = [...subtitleActions, ...contentActions].join('');
  if (window.SubtitleManagerUI) window.SubtitleManagerUI.setContext({ item, endpointBase: libraryContentState.endpointBase });
  const panel = $('#libraryContentDetails');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function runLibraryContentAction(action, itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  if (!ids.length) return;
  const destructive = ['ignore', 'delete-permanently'].includes(action);
  if (destructive) {
    const labels = { ignore: 'Excluir e ignorar', 'delete-permanently': 'Excluir definitivamente' };
    const decision = await showAppDialog({
      eyebrow: 'Conteúdo',
      title: labels[action] || 'Confirmar ação',
      message: action === 'ignore'
        ? `Mover ${ids.length} item(ns) para a quarentena e impedir novo download até reativação?`
        : `Excluir definitivamente ${ids.length} item(ns) selecionado(s)?`,
      danger: true
    });
    if (!decision.confirmed) return;
  }
  const response = await api(`${libraryContentState.endpointBase}/content-action`, {
    method: 'POST',
    body: JSON.stringify({ action, itemIds: ids })
  });
  libraryContentState.selectedIds.clear();
  closeLibraryContentDetails();
  await loadLibraryContent();
  await refreshAll();
  const result = response.result || {};
  showToast(`${result.changed || 0} item(ns) atualizado(s).`);
}

async function loadLibraryContent(options = {}) {
  const append = Boolean(options.append);
  if (!libraryContentState.active || !libraryContentState.endpointBase) return;
  const requestId = ++libraryContentRequestId;
  const browser = $('#libraryContentBrowser');
  browser.classList.add('library-content-loading');
  if (!append) closeLibraryContentDetails();

  const params = new URLSearchParams();
  params.set('limit', String(LIBRARY_CONTENT_PAGE_SIZE));
  params.set('offset', String(append ? libraryContentState.items.length : 0));
  params.set('view', libraryContentState.view);
  if (libraryContentState.view === 'subtitles-present' && libraryContentState.subtitleOrigin !== 'all') {
    params.set('subtitleOrigin', libraryContentState.subtitleOrigin);
  }
  if (libraryContentState.view === 'content' && libraryContentState.path) params.set('path', libraryContentState.path);
  if (libraryContentState.query) params.set('q', libraryContentState.query);

  try {
    const response = await api(`${libraryContentState.endpointBase}/content?${params.toString()}`);
    if (requestId !== libraryContentRequestId) return;
    const result = response.result || {};
    libraryContentState.library = result.library || libraryContentState.library;
    libraryContentState.view = result.view || libraryContentState.view;
    libraryContentState.subtitleOrigin = result.subtitleOrigin || (libraryContentState.view === 'subtitles-present' ? libraryContentState.subtitleOrigin : 'all');
    libraryContentState.subtitleOriginCounts = result.subtitleOriginCounts || {};
    libraryContentState.path = result.path || '';
    libraryContentState.directories = result.directories || [];
    const nextItems = result.items || [];
    if (append) {
      const byId = new Map(libraryContentState.items.map((item) => [item.id, item]));
      nextItems.forEach((item) => byId.set(item.id, item));
      libraryContentState.items = [...byId.values()];
    } else {
      libraryContentState.items = nextItems;
      libraryContentState.selectedIds.clear();
    }
    libraryContentState.itemMap = new Map(libraryContentState.items.map((item) => [item.id, item]));
    libraryContentState.pagination = result.pagination || { total: libraryContentState.items.length, offset: 0, limit: LIBRARY_CONTENT_PAGE_SIZE, hasMore: false };
    renderLibraryContent();
    if (window.SubtitleTranslationUI) window.SubtitleTranslationUI.setContext({ endpointBase: libraryContentState.endpointBase, name: libraryContentState.libraryName });
  } finally {
    if (requestId === libraryContentRequestId) browser.classList.remove('library-content-loading');
  }
}

async function openDestinationContent({ name, endpointBase, view = 'content', returnView = 'libraries' }) {
  libraryContentState = {
    active: true,
    libraryName: String(name || ''),
    endpointBase,
    returnView,
    view,
    subtitleOrigin: 'all',
    subtitleOriginCounts: {},
    library: null,
    path: '',
    query: '',
    directories: [],
    items: [],
    itemMap: new Map(),
    selectedIds: new Set(),
    pagination: { total: 0, offset: 0, limit: LIBRARY_CONTENT_PAGE_SIZE, hasMore: false }
  };
  $('#libraryContentSearch').value = '';
  $('#libraryContentView').value = view;
  $('#libraryContentSubtitleOrigin').value = 'all';
  $('#libraryContentSubtitleOriginLabel').classList.add('hidden');
  if (activeView !== 'libraries') setActiveView('libraries', { persist: false });
  setLibraryContentMode(true);
  $('#libraryContentBackBtn').textContent = returnView === 'channels' ? 'Voltar para Canais' : 'Voltar para Bibliotecas';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await loadLibraryContent();
}

async function openLibraryContent(playlist, view = 'content') {
  return openDestinationContent({
    name: playlist.name,
    endpointBase: `/api/playlists/${encodeURIComponent(playlist.name)}`,
    view,
    returnView: 'libraries'
  });
}

async function openChannelPlaylistContent(channelId, playlistId, name, view = 'content') {
  return openDestinationContent({
    name,
    endpointBase: `/api/channels/${encodeURIComponent(channelId)}/playlists/${encodeURIComponent(playlistId)}`,
    view,
    returnView: 'channels'
  });
}

async function saveConfiguration(showMessage = true) {
  const payload = collectConfigForm();
  const result = await api('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
  setConfigState(result.config);
  if (showMessage) {
    await refreshErsatzTvCatalog({ showErrors: false });
    scheduleErsatzTvVersionCheck({ immediate: true });
    showToast('Configuração salva.');
  }
  return config;
}

function setConfigState(nextConfig) {
  config = nextConfig;
  fillConfigForm();
  renderLibraries();
  updateLibraryFilters();
  if (window.ChannelView) window.ChannelView.update();
}

async function saveConfigObject(nextConfig, message = '') {
  const result = await api('/api/config', { method: 'PUT', body: JSON.stringify(nextConfig) });
  setConfigState(result.config);
  if (message) showToast(message);
  return result.config;
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

function translationOutputLabel(mode) {
  if (mode === 'bilingual') return 'bilíngue';
  if (mode === 'both') return 'traduzida + bilíngue';
  return 'traduzida';
}

function currentTranslationOverviewJob() {
  const status = statusData && statusData.subtitleTranslation || {};
  return status.activeJob || (Array.isArray(status.jobs) ? status.jobs[0] : null) || null;
}

function renderTranslationOverview() {
  const status = statusData && statusData.subtitleTranslation || {};
  const job = currentTranslationOverviewJob();
  const stateEl = $('#translationOverviewState');
  const currentEl = $('#translationOverviewCurrent');
  const progress = $('#translationOverviewProgress');
  const toggle = $('#translationOverviewToggle');
  const manage = $('#translationOverviewManage');
  if (!stateEl || !currentEl || !progress) return;

  if (!job) {
    stateEl.textContent = 'Nenhuma tradução em andamento';
    currentEl.textContent = 'Nenhum job registrado nesta execução.';
    progress.max = 1; progress.value = 0;
    $('#translationOverviewCompleted').textContent = '0';
    $('#translationOverviewPending').textContent = '0';
    $('#translationOverviewFailed').textContent = '0';
    $('#translationOverviewSkipped').textContent = '0';
    toggle?.classList.add('hidden'); manage?.classList.add('hidden');
    return;
  }

  const counts = job.counts || {};
  const total = Math.max(1, Number(counts.total) || 0);
  const done = (Number(counts.completed) || 0) + (Number(counts.failed) || 0) + (Number(counts.skipped) || 0) + (Number(counts.cancelled) || 0);
  progress.max = total; progress.value = Math.min(total, done);
  $('#translationOverviewCompleted').textContent = counts.completed || 0;
  $('#translationOverviewPending').textContent = (Number(counts.pending) || 0) + (Number(counts.running) || 0);
  $('#translationOverviewFailed').textContent = counts.failed || 0;
  $('#translationOverviewSkipped').textContent = counts.skipped || 0;

  const active = Boolean(status.activeJob);
  const labels = { queued: 'Na fila', running: 'Em execução', paused: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada' };
  stateEl.textContent = status.paused && active ? 'Pausada' : (labels[job.status] || job.status || 'Aguardando');
  const currentTitle = job.currentItem && job.currentItem.title ? job.currentItem.title : '';
  const destination = job.destinationName || job.destinationId || 'Destino';
  currentEl.textContent = currentTitle
    ? `${currentTitle} · ${destination} · ${translationOutputLabel(job.options && job.options.outputMode)}`
    : `${destination} · ${translationOutputLabel(job.options && job.options.outputMode)}${active ? '' : ' · último job'}`;

  if (toggle) {
    toggle.classList.toggle('hidden', !active);
    toggle.dataset.action = status.paused ? 'resume' : 'pause';
    toggle.textContent = status.paused ? 'Retomar' : 'Pausar';
  }
  if (manage) manage.classList.toggle('hidden', !job.destinationType);
}

async function runTranslationOverviewAction(action) {
  await api(`/api/subtitle-translation/${action}`, { method: 'POST', body: '{}' });
  await refreshStatus();
  if (window.SubtitleTranslationUI) window.SubtitleTranslationUI.refreshQueueStatus().catch(() => {});
}

async function openTranslationOverviewContent() {
  const job = currentTranslationOverviewJob();
  if (!job) return;
  if (job.destinationType === 'library') {
    const playlist = (config.playlists || []).find((entry) => entry.name === job.destinationName);
    if (playlist) { await openLibraryContent(playlist); return; }
  }
  if (job.destinationType === 'channel-playlist' && job.channelId && job.playlistId) {
    const channel = (config.channels || []).find((entry) => entry.channelId === job.channelId);
    const playlist = channel && (channel.playlists || []).find((entry) => entry.playlistId === job.playlistId);
    if (playlist) { await openChannelPlaylistContent(job.channelId, job.playlistId, playlist.name || job.destinationName); return; }
  }
  setActiveView('libraries');
  showToast('Abra Gerenciar conteúdo no destino correspondente para ver os detalhes da tradução.');
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

  const runtimeVersion = statusData.version || $('#versionBadge').textContent.replace(/^v/, '') || 'desconhecida';
  $('#versionBadge').textContent = `v${runtimeVersion}`;
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

  renderTranslationOverview();
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
  if (window.ChannelView) window.ChannelView.update();
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
  await refreshErsatzTvCatalog({ showErrors: false });
  fillConfigForm();
  scheduleErsatzTvVersionCheck({ immediate: true });
  renderLibraries();
  updateLibraryFilters();
  if (window.ChannelView) window.ChannelView.render();
  await refreshAll(true);
  renderLibraries();
  if (window.ChannelView) window.ChannelView.update();
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

  if (action === 'view-content') {
    await openLibraryContent(playlist);
    return;
  }
  if (action === 'orphans-recover') {
    await openLibraryContent(playlist, 'quarantine');
    return;
  }

  if (action === 'remove-config') {
    const decision = await showAppDialog({
      eyebrow: 'Biblioteca',
      title: 'Remover configuração',
      message: `Remover "${name}" da configuração? Os arquivos locais serão preservados.`,
      danger: true
    });
    if (!decision.confirmed) return;
    config.playlists.splice(index, 1);
    await api('/api/config', { method: 'PUT', body: JSON.stringify(config) });
    config = await api('/api/config');
    fillConfigForm();
    renderLibraries();
    showToast('Biblioteca removida da configuração. Arquivos locais preservados.');
    return;
  }

  if (action === 'delete-with-files') {
    const decision = await showAppDialog({
      eyebrow: 'Ação irreversível',
      title: 'Excluir biblioteca e arquivos',
      message: 'Vídeos, thumbnails, legendas, NFOs e índice local serão removidos.',
      inputLabel: `Digite exatamente: ${name}`,
      expectedText: name,
      danger: true
    });
    if (!decision.confirmed) return;
    const result = await api(`/api/playlists/${encodeURIComponent(name)}/delete-with-files`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: decision.value })
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
    const decision = await showAppDialog({
      eyebrow: 'Órfãos',
      title: 'Limpar órfãos',
      message: `Excluir ${info.count} item(ns), incluindo ${info.filesCount} arquivo(s) de vídeo e ${formatBytes(info.totalBytes)}?`,
      danger: true
    });
    if (!decision.confirmed) return;
    const result = await api(`/api/playlists/${encodeURIComponent(name)}/orphans-cleanup`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
    showToast(`${result.result.videosRemoved || 0} vídeo(s) órfão(s) removido(s).`);
    await refreshAll();
    return;
  }

  if (action === 'empty-trash') {
    const decision = await showAppDialog({
      eyebrow: 'ErsatzTV',
      title: 'Limpar lixo',
      message: 'A lixeira do ErsatzTV será esvaziada. Esta ação é global.',
      danger: true
    });
    if (!decision.confirmed) return;
  }

  if (action === 'reset-playout') {
    if (!playlist.channelNumber) throw new Error('Selecione o Canal no ErsatzTV antes de resetar o Playout.');
    const decision = await showAppDialog({
      eyebrow: 'ErsatzTV',
      title: 'Reset Playout',
      message: `O Playout de "${playlist.channelName || window.DestinationForm.channelNameFor(playlist.channelNumber, 'canal selecionado')}" será apagado e reconstruído.`,
      warning: 'O progresso atual pode ser perdido.',
      danger: true
    });
    if (!decision.confirmed) return;
  }


  const result = await api(`/api/playlists/${encodeURIComponent(name)}/${action}`, { method: 'POST', body: '{}' });
  if (action === 'test-cookies') {
    const details = result.result;
    showToast(`${details.message}${details.ytDlp && details.ytDlp.stderr ? `\n${details.ytDlp.stderr.slice(-800)}` : ''}`, !details.ok && details.status !== 'not-configured');
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
  if (action === 'cancel' || action === 'remove') {
    const decision = await showAppDialog({
      eyebrow: 'Fila',
      title: action === 'cancel' ? 'Cancelar download' : 'Remover item',
      message: action === 'cancel' ? 'Cancelar o download deste item?' : 'Remover este item da fila?',
      danger: action === 'remove'
    });
    if (!decision.confirmed) return;
  }
  await api(`/api/downloads/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
  showToast('Fila atualizada.');
  await refreshAll(false, { forceDownloads: $('#downloadsAccordion').open });
}

function openClearQueueDialog() {
  updateLibraryFilters();
  $('#clearQueueCancelCurrent').checked = true;
  const dialog = $('#clearQueueDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else showToast('Este navegador não oferece suporte ao diálogo interno da fila.', true);
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
    button.addEventListener('click', () => goToViewHome(button.dataset.view).catch((error) => showToast(error.message, true)));
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
  for (const field of [
    $('#configForm [name="ersatztv.url"]'),
    $('#configForm [name="ersatztv.apiKey"]'),
    $('#configForm [name="ersatztv.apiTimeoutSeconds"]')
  ].filter(Boolean)) {
    field.addEventListener('input', () => scheduleErsatzTvVersionCheck());
    field.addEventListener('change', () => scheduleErsatzTvVersionCheck({ immediate: true }));
  }
  $('#runNowBtn').addEventListener('click', () => runDiscovery().catch((error) => showToast(error.message, true)));
  $('#refreshBtn').addEventListener('click', () => refreshAll(true, { forceDownloads: $('#downloadsAccordion').open }));
  $('#translationOverviewToggle')?.addEventListener('click', (event) => {
    runTranslationOverviewAction(event.currentTarget.dataset.action || 'pause').catch((error) => showToast(error.message, true));
  });
  $('#translationOverviewManage')?.addEventListener('click', () => {
    openTranslationOverviewContent().catch((error) => showToast(error.message, true));
  });
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
    if (window.innerWidth > MOBILE_NAV_BREAKPOINT) setMobileActionSheet(false);
    syncMobileNavForViewport();
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
      channelNumber: null,
      channelName: '',
      cookiesPath: '',
      maxHeight: null,
      subtitles: {
        enabled: false,
        includeAuto: true,
        languages: ['pt-BR', 'pt', 'en', 'es']
      },
      mediaProfile: 'generic',
      orphanPolicy: '',
      quarantineRetentionDays: null
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

  document.addEventListener('change', (event) => {
    const select = event.target.closest('[data-smart-collection-select]');
    if (!select) return;
    handleSmartCollectionSelection(select).catch((error) => showToast(error.message, true));
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

    if (input.dataset.field === 'orphanPolicy') {
      window.DestinationForm.syncOrphanControls(row);
      updateLibraryStats();
    }
  });

  $('#playlistList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-library-action]');
    if (!button) return;
    handleLibraryAction(button).catch((error) => showToast(error.message, true));
  });

  $('#libraryContentBackBtn').addEventListener('click', () => {
    libraryContentRequestId += 1;
    const returnView = libraryContentState.returnView || 'libraries';
    setLibraryContentMode(false);
    if (window.SubtitleTranslationUI) window.SubtitleTranslationUI.close();
    if (returnView !== 'libraries') setActiveView(returnView, { persist: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#libraryContentDetailsClose').addEventListener('click', closeLibraryContentDetails);

  $('#libraryContentBrowser').addEventListener('click', (event) => {
    const itemAction = event.target.closest('[data-content-item-action]');
    if (itemAction) {
      runLibraryContentAction(itemAction.dataset.contentItemAction, [itemAction.dataset.itemId])
        .catch((error) => showToast(error.message, true));
      return;
    }
    const selector = event.target.closest('[data-library-content-select]');
    if (selector) {
      const id = selector.dataset.libraryContentSelect;
      if (selector.checked) libraryContentState.selectedIds.add(id);
      else libraryContentState.selectedIds.delete(id);
      updateLibraryContentBatchActions();
      return;
    }
    const folder = event.target.closest('[data-library-content-folder]');
    if (folder) {
      libraryContentState.path = folder.dataset.libraryContentFolder || '';
      libraryContentState.query = '';
      $('#libraryContentSearch').value = '';
      loadLibraryContent().catch((error) => showToast(error.message, true));
      return;
    }

    const crumb = event.target.closest('[data-library-content-path]');
    if (crumb) {
      libraryContentState.path = crumb.dataset.libraryContentPath || '';
      libraryContentState.query = '';
      $('#libraryContentSearch').value = '';
      loadLibraryContent().catch((error) => showToast(error.message, true));
      return;
    }

    const card = event.target.closest('[data-library-content-item]');
    if (card) showLibraryContentDetails(libraryContentState.itemMap.get(card.dataset.libraryContentItem));
  });

  $('#libraryContentView').addEventListener('change', (event) => {
    libraryContentState.view = event.currentTarget.value || 'content';
    libraryContentState.path = '';
    libraryContentState.query = '';
    libraryContentState.subtitleOrigin = 'all';
    libraryContentState.subtitleOriginCounts = {};
    libraryContentState.selectedIds.clear();
    $('#libraryContentSearch').value = '';
    loadLibraryContent().catch((error) => showToast(error.message, true));
  });

  $('#libraryContentSubtitleOrigin').addEventListener('change', (event) => {
    libraryContentState.subtitleOrigin = event.currentTarget.value || 'all';
    libraryContentState.selectedIds.clear();
    loadLibraryContent().catch((error) => showToast(error.message, true));
  });

  $('#libraryContentBatchPrimary').addEventListener('click', (event) => {
    runLibraryContentAction(event.currentTarget.dataset.contentBatchAction, [...libraryContentState.selectedIds])
      .catch((error) => showToast(error.message, true));
  });
  $('#libraryContentBatchDelete').addEventListener('click', () => {
    runLibraryContentAction('delete-permanently', [...libraryContentState.selectedIds])
      .catch((error) => showToast(error.message, true));
  });

  $('#libraryContentSearch').addEventListener('input', (event) => {
    libraryContentState.query = event.currentTarget.value.trim();
    if (libraryContentSearchTimer) clearTimeout(libraryContentSearchTimer);
    libraryContentSearchTimer = setTimeout(() => {
      loadLibraryContent().catch((error) => showToast(error.message, true));
    }, 350);
  });

  $('#libraryContentLoadMoreBtn').addEventListener('click', () => {
    loadLibraryContent({ append: true }).catch((error) => showToast(error.message, true));
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
  if (window.SubtitleManagerUI) {
    window.SubtitleManagerUI.configure({ api, showToast, showDialog: showAppDialog, escapeHtml });
  }
  if (window.SubtitleTranslationUI) {
    window.SubtitleTranslationUI.configure({
      api, showToast, showDialog: showAppDialog, escapeHtml,
      getContentContext: () => ({
        view: libraryContentState.view,
        query: libraryContentState.query,
        path: libraryContentState.path,
        subtitleOrigin: libraryContentState.subtitleOrigin
      })
    });
  }
  bindEvents();
  bindMobileNavBehavior();
  syncMobileNavForViewport();
  if (window.YouTubeManagerView) {
    await window.YouTubeManagerView.init({
      api, showToast, showDialog: showAppDialog, escapeHtml, formatDuration,
      activateView: () => setActiveView('youtube-manager', { persist: true, scroll: true })
    });
  }
  if (window.ChannelView) {
    window.ChannelView.init({
      api,
      getConfig: () => config,
      getStatus: () => statusData,
      setConfig: setConfigState,
      saveConfig: saveConfigObject,
      showToast,
      showDialog: showAppDialog,
      formatBytes,
      formatDate,
      openChannelPlaylistContent,
      refresh: () => refreshAll(false, { forceDownloads: $('#downloadsAccordion').open })
    });
  }
  await loadInitial();
  if (window.ScriptedSchedulesView) {
    await window.ScriptedSchedulesView.init({ api, showToast, showDialog: showAppDialog });
  }
  if (window.HelpView) window.HelpView.init();
  setInterval(() => refreshAll(false), 4000);
}

bootstrap().catch((error) => {
  showToast(error.message, true);
  if (error.status === 401) window.location.replace('/login');
});
