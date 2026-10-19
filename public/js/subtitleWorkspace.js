(function initSubtitleWorkspace(global) {
  'use strict';

  const state = {
    api: null,
    showToast: null,
    showDialog: null,
    escapeHtml: null,
    activateView: null,
    openSettings: null,
    initialized: false,
    workspaces: [],
    activeWorkspaceId: '',
    items: [],
    itemMap: new Map(),
    counts: {},
    languageCounts: {},
    filter: 'unreviewed',
    language: 'all',
    query: '',
    selectedItemId: '',
    scanTimer: null,
    bazarrCandidates: [],
    bazarrMatch: null,
    pagination: { total: 0, offset: 0, limit: 250, hasMore: false }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => state.escapeHtml ? state.escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, '');

  function toast(message, error = false, options) {
    if (state.showToast) state.showToast(message, error, options);
  }

  function activeWorkspace() {
    return state.workspaces.find((entry) => entry.id === state.activeWorkspaceId) || null;
  }

  function persistWorkspace() {
    try { localStorage.setItem('subtitle-workspace-active', state.activeWorkspaceId || ''); } catch {}
  }

  function loadPersistedWorkspace() {
    try { return localStorage.getItem('subtitle-workspace-active') || ''; } catch { return ''; }
  }

  function formatDate(value) {
    if (!value) return 'Nunca';
    try { return new Date(value).toLocaleString('pt-BR'); } catch { return String(value); }
  }

  function renderWorkspaceSelector() {
    const select = $('#subtitleWorkspaceSelect');
    if (!select) return;
    if (!state.workspaces.length) {
      select.innerHTML = '<option value="">Nenhuma pasta cadastrada</option>';
      select.value = '';
      state.activeWorkspaceId = '';
      return;
    }
    select.innerHTML = state.workspaces.map((workspace) => `<option value="${esc(workspace.id)}">${esc(workspace.name)} · ${esc(workspace.rootPath)}</option>`).join('');
    if (!state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)) {
      const persisted = loadPersistedWorkspace();
      state.activeWorkspaceId = state.workspaces.some((workspace) => workspace.id === persisted) ? persisted : state.workspaces[0].id;
    }
    select.value = state.activeWorkspaceId;
    persistWorkspace();
  }

  function renderSummary() {
    const target = $('#subtitleWorkspaceMetrics');
    if (!target) return;
    const c = state.counts || {};
    const workspace = activeWorkspace();
    target.innerHTML = [
      ['Vídeos', c.all ?? workspace?.itemCount ?? 0, 'Itens encontrados na pasta'],
      ['Com SRT editável', c.editable ?? 0, 'Podem ser ajustados aqui'],
      ['Sem legenda externa', c.withoutSubtitles ?? 0, 'Candidatos a busca no Bazarr'],
      ['Não revisados', c.unreviewed ?? 0, 'Fila sugerida de conferência']
    ].map(([label, value, help]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(help)}</small></div>`).join('');
    const scan = $('#subtitleWorkspaceLastScan');
    if (scan) scan.textContent = workspace ? `Última varredura: ${formatDate(workspace.lastScanAt)}` : 'Cadastre uma pasta para começar.';
  }

  function renderLanguageOptions() {
    const select = $('#subtitleWorkspaceLanguage');
    if (!select) return;
    const current = state.language;
    const entries = Object.entries(state.languageCounts || {}).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
    select.innerHTML = '<option value="all">Todos os idiomas</option>' + entries.map(([language, count]) => `<option value="${esc(language)}">${esc(language)} (${esc(count)})</option>`).join('');
    select.value = entries.some(([key]) => key === current) ? current : 'all';
    state.language = select.value;
  }

  function sidecarBadges(item) {
    const tracks = Array.isArray(item.sidecars) ? item.sidecars : [];
    if (!tracks.length) return '<span class="badge warn">Sem legenda externa</span>';
    return tracks.slice(0, 5).map((track) => {
      const cls = track.editable ? 'ok' : '';
      const flags = (track.flags || []).length ? ` · ${(track.flags || []).join('/')}` : '';
      return `<span class="badge ${cls}">${esc(track.language || 'und')} · ${esc(String(track.format || '').toUpperCase())}${esc(flags)}</span>`;
    }).join('') + (tracks.length > 5 ? `<span class="badge">+${tracks.length - 5}</span>` : '');
  }

  function renderItems() {
    const list = $('#subtitleWorkspaceList');
    if (!list) return;
    state.itemMap = new Map(state.items.map((item) => [item.id, item]));
    if (!activeWorkspace()) {
      list.innerHTML = '<div class="empty-state"><strong>Cadastre uma pasta</strong><span>Informe uma pasta de filmes ou séries para localizar vídeos e suas legendas externas.</span></div>';
      return;
    }
    if (!state.items.length) {
      const scanned = Boolean(activeWorkspace()?.lastScanAt);
      list.innerHTML = `<div class="empty-state"><strong>${scanned ? 'Nenhum vídeo neste filtro' : 'Pasta ainda não varrida'}</strong><span>${scanned ? 'Altere os filtros ou atualize a varredura.' : 'Clique em Atualizar varredura para catalogar vídeos e sidecars.'}</span></div>`;
      return;
    }
    list.innerHTML = state.items.map((item, index) => {
      const reviewed = item.reviewStatus === 'reviewed';
      return `<article class="subtitle-workspace-item ${reviewed ? 'reviewed' : ''}" data-workspace-item="${esc(item.id)}">
        <button type="button" class="subtitle-workspace-item-main" data-workspace-open="${esc(item.id)}">
          <span class="subtitle-workspace-item-index">${index + 1}</span>
          <span class="subtitle-workspace-item-copy"><strong>${esc(item.fileName)}</strong><small>${esc(item.relativePath)}</small><span class="subtitle-workspace-badges">${sidecarBadges(item)}</span></span>
          <span class="subtitle-workspace-review ${reviewed ? 'ok' : ''}">${reviewed ? '✓ Revisado' : 'Não revisado'}</span>
        </button>
      </article>`;
    }).join('');
  }

  function renderFiltersMeta(result) {
    const meta = $('#subtitleWorkspaceResultMeta');
    if (meta) meta.textContent = `${result.total || 0} resultado(s) · até ${result.limit || 250} exibidos`;
  }

  async function loadWorkspaces({ keepSelection = true } = {}) {
    const response = await state.api('/api/tools/subtitles/workspaces');
    const previous = keepSelection ? state.activeWorkspaceId : '';
    state.workspaces = response.result?.workspaces || [];
    state.activeWorkspaceId = previous || loadPersistedWorkspace();
    renderWorkspaceSelector();
    renderSummary();
  }

  async function loadItems({ append = false } = {}) {
    const workspace = activeWorkspace();
    if (!workspace) {
      state.items = []; state.counts = {}; state.languageCounts = {};
      renderSummary(); renderLanguageOptions(); renderItems();
      return;
    }
    const params = new URLSearchParams({
      filter: state.filter || 'all',
      language: state.language || 'all',
      q: state.query || '',
      limit: String(state.pagination.limit || 250),
      offset: String(append ? state.items.length : 0)
    });
    const response = await state.api(`/api/tools/subtitles/workspaces/${encodeURIComponent(workspace.id)}/items?${params}`);
    const result = response.result || {};
    state.items = append ? [...state.items, ...(result.items || [])] : (result.items || []);
    state.pagination = { total: result.total || 0, offset: result.offset || 0, limit: result.limit || 250, hasMore: Boolean(result.hasMore) };
    state.counts = result.counts || {};
    state.languageCounts = result.languageCounts || {};
    if (result.workspace) {
      const index = state.workspaces.findIndex((entry) => entry.id === result.workspace.id);
      if (index >= 0) state.workspaces[index] = result.workspace;
    }
    renderSummary(); renderLanguageOptions(); renderItems(); renderFiltersMeta({ ...result, total: state.pagination.total });
    const more = $('#subtitleWorkspaceMore');
    if (more) more.classList.toggle('hidden', !state.pagination.hasMore);
  }

  async function home() {
    await loadWorkspaces();
    await loadItems();
    const workspace = activeWorkspace();
    if (workspace) await resumeScanPolling(workspace.id);
  }

  async function createWorkspace() {
    const name = $('#subtitleWorkspaceName')?.value.trim() || '';
    const rootPath = $('#subtitleWorkspacePath')?.value.trim() || '';
    const recursive = $('#subtitleWorkspaceRecursive')?.checked !== false;
    if (!rootPath) return toast('Informe a pasta raiz.', true);

    const submit = async (confirmBroadPath = false) => state.api('/api/tools/subtitles/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, rootPath, recursive, confirmBroadPath })
    });

    let response;
    try {
      response = await submit(false);
    } catch (error) {
      if (error.code !== 'SUBTITLE_WORKSPACE_BROAD_PATH_CONFIRM_REQUIRED') throw error;
      const dialog = await state.showDialog({
        eyebrow: 'Gerenciar legendas',
        title: 'Usar esta pasta mesmo assim?',
        message: `O caminho “${rootPath}” parece amplo e pode fazer a varredura percorrer muitos arquivos ou diretorios que nao fazem parte do seu acervo.`,
        warning: 'Se este caminho for realmente o ponto de montagem ou a pasta que contem seus filmes/series, pode continuar normalmente.',
        confirmLabel: 'Usar esta pasta'
      });
      if (!dialog.confirmed) return;
      response = await submit(true);
    }

    state.activeWorkspaceId = response.result.id;
    persistWorkspace();
    if ($('#subtitleWorkspaceName')) $('#subtitleWorkspaceName').value = '';
    if ($('#subtitleWorkspacePath')) $('#subtitleWorkspacePath').value = '';
    await loadWorkspaces();
    await loadItems();
    toast('Pasta cadastrada. Execute a primeira varredura.');
  }

  async function removeWorkspace() {
    const workspace = activeWorkspace();
    if (!workspace) return;
    const dialog = await state.showDialog({
      eyebrow: 'Gerenciar legendas', title: 'Remover esta pasta da ferramenta?',
      message: `O cadastro “${workspace.name}” será removido. Nenhum vídeo ou arquivo de legenda será apagado do disco.`,
      confirmLabel: 'Remover cadastro', danger: true
    });
    if (!dialog.confirmed) return;
    await state.api(`/api/tools/subtitles/workspaces/${encodeURIComponent(workspace.id)}`, { method: 'DELETE', body: '{}' });
    state.activeWorkspaceId = '';
    persistWorkspace();
    await home();
    toast('Cadastro removido. Os arquivos permaneceram intactos.');
  }

  function setScanUi(job) {
    const button = $('#subtitleWorkspaceScan');
    const status = $('#subtitleWorkspaceScanStatus');
    const running = job?.status === 'running';
    if (button) { button.disabled = running; button.textContent = running ? 'Varrendo...' : 'Atualizar varredura'; }
    if (!status) return;
    if (running) {
      const progress = job.progress || {};
      status.textContent = `Varrendo ${progress.currentPath ? `· ${progress.currentPath}` : ''}${progress.videosFound != null ? ` · ${progress.videosFound} vídeo(s)` : ''}`;
      status.classList.remove('hidden');
    } else if (job?.status === 'failed') {
      status.textContent = `Falha: ${job.error || 'erro desconhecido'}`;
      status.classList.remove('hidden');
    } else status.classList.add('hidden');
  }

  function stopScanPolling() {
    if (state.scanTimer) window.clearTimeout(state.scanTimer);
    state.scanTimer = null;
  }

  async function pollScan(workspaceId) {
    stopScanPolling();
    try {
      const response = await state.api(`/api/tools/subtitles/workspaces/${encodeURIComponent(workspaceId)}/scan-status`);
      const job = response.result || {};
      setScanUi(job);
      if (job.status === 'running') {
        state.scanTimer = window.setTimeout(() => pollScan(workspaceId), 800);
        return;
      }
      if (job.status === 'completed') {
        await loadWorkspaces(); await loadItems();
        toast('Varredura concluída.');
      }
    } catch (error) {
      setScanUi({ status: 'failed', error: error.message });
    }
  }

  async function resumeScanPolling(workspaceId) {
    const response = await state.api(`/api/tools/subtitles/workspaces/${encodeURIComponent(workspaceId)}/scan-status`);
    const job = response.result || {};
    setScanUi(job);
    if (job.status === 'running') state.scanTimer = window.setTimeout(() => pollScan(workspaceId), 500);
  }

  async function startScan() {
    const workspace = activeWorkspace();
    if (!workspace) return toast('Cadastre e selecione uma pasta primeiro.', true);
    await state.api(`/api/tools/subtitles/workspaces/${encodeURIComponent(workspace.id)}/scan`, { method: 'POST', body: '{}' });
    toast('Varredura iniciada.', false, { persistent: true, loading: true });
    await pollScan(workspace.id);
  }

  function currentItemIndex() {
    return state.items.findIndex((item) => item.id === state.selectedItemId);
  }

  function renderEditorNavigator() {
    const box = $('#subtitleWorkspaceNavigator');
    if (!box) return;
    const index = currentItemIndex();
    const item = index >= 0 ? state.items[index] : null;
    if (!item) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="subtitle-workspace-nav-copy"><span>${index + 1} de ${state.items.length} neste filtro</span><strong>${esc(item.fileName)}</strong><small>${esc(item.relativePath)}</small></div>
      <div class="inline-actions">
        <button type="button" class="small" data-workspace-nav="previous" ${index <= 0 ? 'disabled' : ''}>← Anterior</button>
        <button type="button" class="${item.reviewStatus === 'reviewed' ? '' : 'primary'} small" data-workspace-review>${item.reviewStatus === 'reviewed' ? 'Marcar não revisado' : '✓ Revisado e próximo'}</button>
        <button type="button" class="small" data-workspace-nav="next" ${index < 0 || index >= state.items.length - 1 ? 'disabled' : ''}>Próximo →</button>
      </div>`;
  }

  function renderBazarrArea(status = null) {
    const box = $('#subtitleWorkspaceBazarr');
    if (!box) return;
    const configured = Boolean(status?.bazarr?.configured);
    const item = state.itemMap.get(state.selectedItemId);
    if (!item) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    if (!configured) {
      box.innerHTML = `<div class="section-heading"><div><span class="eyebrow">Opcional</span><h3>Bazarr</h3><p>Conecte o Bazarr para buscar uma legenda ausente ou tentar sincronização automática.</p></div><button type="button" class="small" data-workspace-open-bazarr-settings>Configurar Bazarr</button></div>`;
      return;
    }
    box.innerHTML = `<div class="section-heading"><div><span class="eyebrow">Integração</span><h3>Bazarr</h3><p>${status?.bazarr?.matched ? 'Este arquivo já foi associado ao catálogo do Bazarr.' : 'A associação é feita pelo caminho mapeado no Sonarr/Radarr, nunca somente pelo título.'}</p></div><div class="inline-actions"><button type="button" class="small" data-workspace-bazarr-search>Buscar legenda</button><button type="button" class="small" data-workspace-bazarr-sync>Sincronizar legenda ativa</button></div></div><div id="subtitleWorkspaceBazarrResults" class="subtitle-workspace-bazarr-results"></div>`;
    renderBazarrCandidates();
  }

  function renderBazarrCandidates() {
    const target = $('#subtitleWorkspaceBazarrResults');
    if (!target) return;
    if (!state.bazarrCandidates.length) { target.innerHTML = '<p class="muted">Nenhuma busca executada para este item.</p>'; return; }
    target.innerHTML = state.bazarrCandidates.map((candidate, index) => {
      const flags = [candidate.language, candidate.forced ? 'Forced' : '', candidate.hearingImpaired ? 'SDH/HI' : '', candidate.provider].filter(Boolean).join(' · ');
      const releases = Array.isArray(candidate.releaseInfo) ? candidate.releaseInfo.slice(0, 3).join(' · ') : String(candidate.releaseInfo || '');
      return `<article class="subtitle-workspace-bazarr-candidate"><div><strong>${esc(flags || 'Legenda')}</strong><small>${candidate.score != null ? `Score ${esc(candidate.score)}%` : 'Score não informado'}${releases ? ` · ${esc(releases)}` : ''}</small></div><button type="button" class="small primary" data-workspace-bazarr-download="${index}">Baixar</button></article>`;
    }).join('');
  }

  async function openItem(itemId, { autoPreviewFirst = true } = {}) {
    const item = state.itemMap.get(itemId);
    if (!item) return;
    state.selectedItemId = itemId;
    state.bazarrCandidates = [];
    state.bazarrMatch = null;
    renderEditorNavigator();
    global.SubtitleManagerUI?.setContext?.({
      item: { id: item.id, name: item.fileName, title: item.fileName, fileName: item.fileName },
      endpointBase: '/api/tools/subtitles',
      panelId: 'subtitleWorkspaceManagerPanel',
      onContentChanged: async () => {
        await loadItems();
        const refreshed = state.itemMap.get(state.selectedItemId);
        if (refreshed) await openItem(refreshed.id, { autoPreviewFirst: false });
      }
    });
    await global.SubtitleManagerUI?.open?.({ mode: 'manager', autoPreviewFirst });
    try {
      const response = await state.api(`/api/tools/subtitles/subtitle-status?id=${encodeURIComponent(itemId)}`);
      renderBazarrArea(response.result || {});
    } catch (error) { toast(error.message, true); }
  }

  async function navigate(direction) {
    const index = currentItemIndex();
    let nextIndex = direction === 'previous' ? index - 1 : index + 1;
    if (direction === 'next' && nextIndex >= state.items.length && state.pagination.hasMore) {
      await loadItems({ append: true });
      nextIndex = index + 1;
    }
    if (nextIndex < 0 || nextIndex >= state.items.length) return;
    await openItem(state.items[nextIndex].id);
  }

  async function toggleReview({ advance = true } = {}) {
    const item = state.itemMap.get(state.selectedItemId);
    if (!item) return;
    const reviewed = item.reviewStatus !== 'reviewed';
    const currentIndex = currentItemIndex();
    await state.api(`/api/tools/subtitles/items/${encodeURIComponent(item.id)}/review-status`, { method: 'POST', body: JSON.stringify({ reviewed }) });
    toast(reviewed ? 'Marcado como revisado.' : 'Marcado como não revisado.');
    await loadItems();
    if (reviewed && advance && state.filter === 'unreviewed') {
      const next = state.items[Math.min(currentIndex, state.items.length - 1)];
      if (next) await openItem(next.id); else { global.SubtitleManagerUI?.close?.(); state.selectedItemId = ''; renderEditorNavigator(); renderBazarrArea(); }
      return;
    }
    if (reviewed && advance) {
      const next = state.items[Math.min(currentIndex + 1, state.items.length - 1)];
      if (next && next.id !== item.id) await openItem(next.id); else if (state.itemMap.has(item.id)) await openItem(item.id, { autoPreviewFirst: false });
    } else if (state.itemMap.has(item.id)) await openItem(item.id, { autoPreviewFirst: false });
  }

  async function bazarrSearch() {
    if (!state.selectedItemId) return;
    const button = $('[data-workspace-bazarr-search]');
    if (button) { button.disabled = true; button.textContent = 'Buscando...'; }
    try {
      const response = await state.api(`/api/tools/subtitles/items/${encodeURIComponent(state.selectedItemId)}/bazarr/search`, { method: 'POST', body: '{}' });
      state.bazarrCandidates = response.result?.candidates || [];
      state.bazarrMatch = response.result?.match || null;
      renderBazarrCandidates();
      toast(`${state.bazarrCandidates.length} candidato(s) encontrado(s) no Bazarr.`);
    } catch (error) { toast(error.message, true); }
    finally { if (button) { button.disabled = false; button.textContent = 'Buscar legenda'; } }
  }

  async function bazarrDownload(index) {
    const candidate = state.bazarrCandidates[index];
    if (!candidate || !state.selectedItemId) return;
    toast('Solicitando download ao Bazarr...', false, { persistent: true, loading: true });
    try {
      const response = await state.api(`/api/tools/subtitles/items/${encodeURIComponent(state.selectedItemId)}/bazarr/download`, { method: 'POST', body: JSON.stringify({ candidate }) });
      await loadItems();
      await openItem(state.selectedItemId, { autoPreviewFirst: true });
      toast(response.result?.changed ? 'Legenda recebida do Bazarr e carregada.' : 'Bazarr aceitou a solicitação; o arquivo ainda não apareceu no disco. Atualize a varredura se necessário.');
    } catch (error) { toast(error.message, true); }
  }

  async function bazarrSync() {
    const active = global.SubtitleManagerUI?.getActiveTrack?.();
    if (!state.selectedItemId || !active?.trackId) return toast('Abra uma legenda SRT no editor antes de sincronizar.', true);
    const dialog = await state.showDialog({
      eyebrow: 'Bazarr', title: 'Tentar sincronização automática?',
      message: 'O arquivo atual será preservado no histórico antes de o Bazarr tentar ajustar a sincronização.',
      warning: 'Use esta opção para legendas de release diferente ou com drift. Para um atraso fixo, o ajuste manual costuma ser mais previsível.',
      confirmLabel: 'Sincronizar via Bazarr'
    });
    if (!dialog.confirmed) return;
    toast('Bazarr está sincronizando a legenda...', false, { persistent: true, loading: true });
    try {
      const response = await state.api(`/api/tools/subtitles/items/${encodeURIComponent(state.selectedItemId)}/bazarr/sync`, { method: 'POST', body: JSON.stringify({ trackId: active.trackId, expectedFingerprint: active.fingerprint || null }) });
      await openItem(state.selectedItemId, { autoPreviewFirst: true });
      toast(response.result?.changed ? 'Sincronização do Bazarr aplicada. Confira no player.' : 'O Bazarr aceitou a ação, mas ainda não alterou o arquivo.');
    } catch (error) { toast(error.message, true); }
  }

  function openBazarrSettings() {
    state.openSettings?.('bazarr');
  }

  function bind() {
    $('#subtitleWorkspaceSelect')?.addEventListener('change', async (event) => {
      stopScanPolling(); state.activeWorkspaceId = event.target.value || ''; persistWorkspace(); state.selectedItemId = ''; global.SubtitleManagerUI?.close?.(); await loadItems(); if (state.activeWorkspaceId) await resumeScanPolling(state.activeWorkspaceId);
    });
    $('#subtitleWorkspaceAdd')?.addEventListener('click', () => createWorkspace().catch((error) => toast(error.message, true)));
    $('#subtitleWorkspaceRemove')?.addEventListener('click', () => removeWorkspace().catch((error) => toast(error.message, true)));
    $('#subtitleWorkspaceScan')?.addEventListener('click', () => startScan().catch((error) => toast(error.message, true)));
    $('#subtitleWorkspaceMore')?.addEventListener('click', () => loadItems({ append: true }).catch((error) => toast(error.message, true)));
    $('#subtitleWorkspaceFilter')?.addEventListener('change', async (event) => { state.filter = event.target.value; await loadItems(); });
    $('#subtitleWorkspaceLanguage')?.addEventListener('change', async (event) => { state.language = event.target.value; await loadItems(); });
    let queryTimer = null;
    $('#subtitleWorkspaceQuery')?.addEventListener('input', (event) => {
      state.query = event.target.value || '';
      if (queryTimer) clearTimeout(queryTimer);
      queryTimer = setTimeout(() => loadItems().catch((error) => toast(error.message, true)), 250);
    });
    $('#view-subtitle-tools')?.addEventListener('click', (event) => {
      const open = event.target.closest('[data-workspace-open]');
      if (open) { openItem(open.dataset.workspaceOpen).catch((error) => toast(error.message, true)); return; }
      const nav = event.target.closest('[data-workspace-nav]');
      if (nav) { navigate(nav.dataset.workspaceNav).catch((error) => toast(error.message, true)); return; }
      if (event.target.closest('[data-workspace-review]')) { toggleReview().catch((error) => toast(error.message, true)); return; }
      if (event.target.closest('[data-workspace-bazarr-search]')) { bazarrSearch(); return; }
      const download = event.target.closest('[data-workspace-bazarr-download]');
      if (download) { bazarrDownload(Number(download.dataset.workspaceBazarrDownload)); return; }
      if (event.target.closest('[data-workspace-bazarr-sync]')) { bazarrSync(); return; }
      if (event.target.closest('[data-workspace-open-bazarr-settings]')) { openBazarrSettings(); }
    });
  }

  async function init(options = {}) {
    if (state.initialized) return;
    state.api = options.api;
    state.showToast = options.showToast;
    state.showDialog = options.showDialog;
    state.escapeHtml = options.escapeHtml;
    state.activateView = options.activateView;
    state.openSettings = options.openSettings;
    state.initialized = true;
    bind();
  }

  global.SubtitleWorkspaceView = { init, home };
})(window);
