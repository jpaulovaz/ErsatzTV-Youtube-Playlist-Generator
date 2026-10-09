(() => {
  let deps = null;
  let initialized = false;
  let activeTab = 'search';
  let status = null;
  let accountConfig = null;
  let playlists = [];
  let playlistIndex = new Set();
  let sources = [];
  let catalogItems = [];
  let catalogPagination = { total: 0, offset: 0, limit: 100, hasMore: false };
  let selectedCatalog = new Set();
  let currentMatchItem = null;
  let searchState = { query: '', nextPageToken: '', results: [] };
  let pollTimer = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value) => deps && deps.escapeHtml ? deps.escapeHtml(value) : String(value ?? '');
  const duration = (seconds) => deps && deps.formatDuration ? deps.formatDuration(seconds) : (seconds ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '-');

  function setTab(tab) {
    activeTab = ['search', 'catalog', 'playlists', 'account'].includes(tab) ? tab : 'search';
    $$('.ytm-tab').forEach((button) => button.classList.toggle('active', button.dataset.ytmTab === activeTab));
    $$('[data-ytm-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.ytmPanel === activeTab));
  }

  function accountConnected() {
    return Boolean(status && status.account && status.account.connected && status.account.scopeGranted);
  }

  function renderQuota() {
    const quota = status && status.quota || {};
    const root = $('#ytmQuotaMetrics');
    if (!root) return;
    root.innerHTML = `
      <div><span>Search hoje</span><strong>${esc(quota.searchCalls || 0)} / ${esc(quota.defaultSearchLimit || 100)}</strong></div>
      <div><span>Quota geral estimada</span><strong>${esc(quota.generalUnits || 0)} / ${esc(quota.defaultGeneralLimit || 10000)}</strong></div>
      <div><span>Data local</span><strong>${esc(quota.date || '-')}</strong></div>
    `;
  }

  function renderAccount() {
    const account = status && status.account || {};
    const config = accountConfig || account.config || {};
    const accountInfo = account.account;
    if ($('#ytmPublicBaseUrl')) $('#ytmPublicBaseUrl').value = config.publicBaseUrl || 'https://yt.johnflix.com.br/';
    if ($('#ytmRedirectUri')) $('#ytmRedirectUri').value = config.redirectUri || 'https://yt.johnflix.com.br/api/youtube-manager/oauth/callback';
    if ($('#ytmClientId') && document.activeElement !== $('#ytmClientId')) $('#ytmClientId').value = config.clientId || '';
    const root = $('#ytmAccountStatus');
    if (!root) return;
    const state = account.connected && account.scopeGranted ? 'ok' : account.connected ? 'warn' : 'muted';
    const label = account.connected
      ? (accountInfo ? `${accountInfo.title || accountInfo.channelId}` : 'Conectada; identidade ainda não validada')
      : 'Não conectada';
    root.innerHTML = `
      <div class="ytm-account-banner ${state}">
        <strong>${esc(label)}</strong>
        <span>${account.connected ? `Escopo de playlists: ${account.scopeGranted ? 'OK' : 'ausente'}` : 'Pesquisa pública continua disponível com a API key normal.'}</span>
        ${account.lastError ? `<small class="error-text">${esc(account.lastError)}</small>` : ''}
      </div>`;
    $('#ytmAccountDisconnect')?.classList.toggle('hidden', !account.connected);
    $('#ytmAccountTest')?.classList.toggle('hidden', !account.connected);
    renderQuota();
  }

  function fillPlaylistSelect(select, { placeholder = 'Selecione uma playlist' } = {}) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${esc(accountConnected() ? placeholder : 'Conecte a conta')}</option>` + playlists.map((playlist) =>
      `<option value="${esc(playlist.id)}">${esc(playlist.title)} (${playlist.itemCount || 0})</option>`).join('');
    if (playlists.some((item) => item.id === current)) select.value = current;
  }

  function renderPlaylists() {
    fillPlaylistSelect($('#ytmSearchPlaylist'), { placeholder: 'Selecione uma playlist' });
    fillPlaylistSelect($('#ytmCatalogPlaylist'), { placeholder: 'Selecione uma playlist' });
    const root = $('#ytmPlaylistList');
    if (!root) return;
    if (!accountConnected()) {
      root.innerHTML = '<div class="empty-state"><strong>Conecte sua conta do YouTube</strong><span>A pesquisa pública não precisa de OAuth, mas suas playlists precisam.</span></div>';
      return;
    }
    if (!playlists.length) {
      root.innerHTML = '<div class="empty-state"><strong>Nenhuma playlist própria encontrada.</strong></div>';
      return;
    }
    root.innerHTML = playlists.map((playlist) => `
      <article class="ytm-playlist-card">
        ${playlist.thumbnailUrl ? `<img src="${esc(playlist.thumbnailUrl)}" alt="">` : ''}
        <div><strong>${esc(playlist.title)}</strong><small>${playlist.itemCount || 0} vídeos · ${esc(playlist.privacyStatus || '-')}</small></div>
        <div class="inline-actions"><button type="button" class="small" data-ytm-use-playlist="${esc(playlist.id)}">Usar como destino</button><a class="button-link small" href="${esc(playlist.url)}" target="_blank" rel="noopener">Abrir</a></div>
      </article>`).join('');
  }

  async function refreshPlaylistIndex() {
    const playlistId = $('#ytmSearchPlaylist')?.value || '';
    playlistIndex = new Set();
    if (!playlistId || !accountConnected()) { renderSearchResults(); return; }
    try {
      const response = await deps.api(`/api/youtube-manager/playlist-items?playlistId=${encodeURIComponent(playlistId)}`);
      playlistIndex = new Set((response.result.items || []).map((item) => item.videoId));
    } catch (error) {
      deps.showToast(error.message, true);
    }
    renderSearchResults();
  }

  function renderSearchResults() {
    const root = $('#ytmSearchResults');
    if (!root) return;
    const playlistSelected = $('#ytmSearchPlaylist')?.value || '';
    if (!searchState.results.length) {
      root.innerHTML = searchState.query ? '<div class="empty-state"><strong>Nenhum vídeo encontrado.</strong></div>' : '';
      return;
    }
    root.innerHTML = searchState.results.map((item) => {
      const exists = playlistIndex.has(item.id);
      const disabled = !accountConnected() || !playlistSelected || exists || item.unavailable;
      return `<article class="ytm-result-card">
        ${item.thumbnailUrl ? `<img src="${esc(item.thumbnailUrl)}" alt="">` : '<div class="ytm-thumb-placeholder"></div>'}
        <div class="ytm-result-copy">
          <strong>${esc(item.title || item.id)}</strong>
          <span>${esc(item.channelTitle || '')}</span>
          <small>${duration(item.duration)}${item.publishedAt ? ` · ${esc(String(item.publishedAt).slice(0, 10))}` : ''}</small>
        </div>
        <div class="ytm-result-actions">
          <a class="button-link small" href="${esc(item.url)}" target="_blank" rel="noopener">Abrir no YouTube</a>
          <button type="button" class="small primary" data-ytm-add-video="${esc(item.id)}" ${disabled ? 'disabled' : ''}>${exists ? 'Já está na playlist' : 'Adicionar'}</button>
        </div>
      </article>`;
    }).join('');
    $('#ytmSearchMore')?.classList.toggle('hidden', !searchState.nextPageToken);
  }

  async function doSearch({ more = false } = {}) {
    const query = $('#ytmSearchInput').value.trim();
    if (!query) { deps.showToast('Informe o que deseja pesquisar.', true); return; }
    const pageToken = more ? searchState.nextPageToken : '';
    const response = await deps.api('/api/youtube-manager/search', {
      method: 'POST',
      body: JSON.stringify({ query, pageToken, force: $('#ytmSearchForce').checked })
    });
    const result = response.result;
    searchState.query = query;
    searchState.nextPageToken = result.nextPageToken || '';
    searchState.results = more ? [...searchState.results, ...(result.results || [])] : (result.results || []);
    $('#ytmSearchMeta').textContent = `${result.direct ? 'Consulta direta por Video ID' : 'Pesquisa'} · ${result.cached ? 'cache' : 'API'} · ${searchState.results.length} resultado(s)`;
    renderSearchResults();
    await refreshStatus({ light: true });
  }

  async function addVideoToPlaylist(videoId, title = '') {
    const playlistId = $('#ytmSearchPlaylist').value;
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) throw new Error('Selecione a playlist destino.');
    const planResponse = await deps.api('/api/youtube-manager/playlist-plan', {
      method: 'POST', body: JSON.stringify({ playlistId, playlistTitle: playlist.title, videoIds: [{ videoId, title }] })
    });
    const plan = planResponse.result;
    if (!plan.eligible) {
      deps.showToast(plan.alreadyExists ? 'O vídeo já está nessa playlist.' : 'Nenhum vídeo elegível para adicionar.');
      playlistIndex.add(videoId); renderSearchResults(); return;
    }
    const dialog = await deps.showDialog({
      eyebrow: 'YouTube', title: 'Adicionar à playlist?',
      message: `${title || videoId} será adicionado a “${playlist.title}”.`,
      confirmLabel: 'Adicionar'
    });
    if (!dialog.confirmed) return;
    await deps.api('/api/youtube-manager/playlist-start', { method: 'POST', body: JSON.stringify({ plan }) });
    deps.showToast('Vídeo enviado para a fila da playlist.');
    setTab('playlists');
    await refreshQueue();
  }

  function sourceStatusLabel(item) {
    if (item.match && item.match.status === 'confirmed') return ['Confirmado', 'ok'];
    if (item.match && item.match.status === 'ignored') return ['Ignorado', 'muted'];
    if (item.scanError) return ['Erro de leitura', 'danger'];
    if (item.recoveredVideoId) return ['ID recuperado', 'info'];
    if (item.present === false) return ['Arquivo ausente', 'warn'];
    return ['Sem correspondência', 'warn'];
  }

  function renderCatalogMetrics() {
    const counts = status && status.counts || {};
    const root = $('#ytmCatalogMetrics');
    if (!root) return;
    const values = [
      ['Arquivos', counts.total || 0], ['IDs recuperados', counts.recovered || 0], ['Confirmados', counts.confirmed || 0],
      ['Sem match', counts.unmatched || 0], ['Ignorados', counts.ignored || 0], ['Ausentes', counts.missing || 0], ['Conflitos', counts.conflicts || 0]
    ];
    root.innerHTML = values.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function renderSources() {
    const select = $('#ytmSourceSelect');
    if (!select) return;
    const current = select.value;
    select.innerHTML = sources.length ? sources.map((source) => `<option value="${esc(source.id)}">${esc(source.name)}${source.lastScanSummary ? ` (${source.lastScanSummary.files || 0})` : ''}</option>`).join('') : '<option value="">Nenhuma raiz cadastrada</option>';
    if (sources.some((source) => source.id === current)) select.value = current;
  }

  function renderCatalog({ append = false } = {}) {
    const root = $('#ytmCatalogList');
    if (!root) return;
    if (!catalogItems.length) {
      root.innerHTML = '<div class="empty-state"><strong>Nenhum arquivo neste filtro.</strong></div>';
      return;
    }
    root.innerHTML = catalogItems.map((item) => {
      const [label, cls] = sourceStatusLabel(item);
      const match = item.match;
      const confirmed = match && match.status === 'confirmed';
      return `<article class="ytm-catalog-row" data-ytm-item="${esc(item.id)}">
        <label class="ytm-select"><input type="checkbox" data-ytm-select-item="${esc(item.id)}" ${selectedCatalog.has(item.id) ? 'checked' : ''} ${confirmed ? '' : 'disabled'}></label>
        <div class="ytm-catalog-main"><strong>${esc(item.inferredArtist || 'Outros')} — ${esc(item.inferredTitle || item.filename)}</strong><small>${esc(item.relativePath)} · ${duration(item.duration)}</small>${item.scanError ? `<span class="error-text">${esc(item.scanError)}</span>` : ''}</div>
        <div><span class="badge ${cls}">${esc(label)}</span>${item.recoveredVideoId && !confirmed ? `<small>${esc(item.recoveredVideoId)} · ${esc(item.matchSource || '')}</small>` : ''}${confirmed ? `<small>${esc(match.videoId)} · ${esc(match.channelTitle || '')}</small>` : ''}</div>
        <div class="row-actions"><button type="button" class="small" data-ytm-review="${esc(item.id)}">Revisar</button>${confirmed || item.match && item.match.status === 'ignored' ? `<button type="button" class="small" data-ytm-clear-match="${esc(item.id)}">Limpar</button>` : `<button type="button" class="small" data-ytm-ignore="${esc(item.id)}">Ignorar</button>`}</div>
      </article>`;
    }).join('');
    $('#ytmCatalogMore')?.classList.toggle('hidden', !catalogPagination.hasMore);
    renderCatalogMetrics();
  }

  async function refreshCatalog({ append = false } = {}) {
    const sourceId = $('#ytmSourceSelect')?.value || '';
    if (!sourceId) { catalogItems = []; catalogPagination = { total: 0, offset: 0, limit: 100, hasMore: false }; renderCatalog(); return; }
    const offset = append ? catalogPagination.offset + catalogPagination.limit : 0;
    const params = new URLSearchParams({ sourceId, status: $('#ytmCatalogStatus').value, q: $('#ytmCatalogQuery').value.trim(), offset: String(offset), limit: '100', present: 'true' });
    const response = await deps.api(`/api/youtube-manager/items?${params}`);
    catalogPagination = response.result;
    catalogItems = append ? [...catalogItems, ...(response.result.items || [])] : (response.result.items || []);
    selectedCatalog = new Set([...selectedCatalog].filter((id) => catalogItems.some((item) => item.id === id && item.match && item.match.status === 'confirmed')));
    renderCatalog();
  }

  function renderMatchResults(result) {
    const root = $('#ytmMatchResults');
    if (!root) return;
    const results = result && result.results || [];
    if (!results.length) { root.innerHTML = '<div class="empty-state"><strong>Nenhum candidato encontrado.</strong></div>'; return; }
    root.innerHTML = results.map((item) => `
      <article class="ytm-result-card ${item.score && item.score.level === 'high' ? 'is-high-confidence' : ''}">
        ${item.thumbnailUrl ? `<img src="${esc(item.thumbnailUrl)}" alt="">` : '<div class="ytm-thumb-placeholder"></div>'}
        <div class="ytm-result-copy"><strong>${esc(item.title)}</strong><span>${esc(item.channelTitle || '')}</span><small>${duration(item.duration)} · confiança ${item.score ? item.score.total : 0}%${item.score && item.score.durationDifferenceSeconds != null ? ` · Δ ${item.score.durationDifferenceSeconds}s` : ''}</small></div>
        <div class="ytm-result-actions"><a class="button-link small" href="${esc(item.url)}" target="_blank" rel="noopener">Abrir</a><button type="button" class="small primary" data-ytm-confirm-video="${esc(item.id)}">Confirmar</button></div>
      </article>`).join('');
  }

  async function reviewItem(itemId) {
    const item = catalogItems.find((value) => value.id === itemId);
    if (!item) return;
    currentMatchItem = item;
    $('#ytmMatchPanel').classList.remove('hidden');
    $('#ytmMatchTitle').textContent = `${item.inferredArtist || 'Outros'} — ${item.inferredTitle || item.filename}`;
    $('#ytmMatchMeta').textContent = `${item.relativePath} · ${duration(item.duration)}`;
    $('#ytmMatchQuery').value = item.recoveredVideoId || [item.inferredArtist, item.inferredTitle].filter(Boolean).join(' ');
    const response = await deps.api('/api/youtube-manager/item/search', { method: 'POST', body: JSON.stringify({ itemId }) });
    $('#ytmMatchQuery').value = response.result.suggestedQuery || $('#ytmMatchQuery').value;
    renderMatchResults(response.result);
    $('#ytmMatchPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function confirmMatch(videoId) {
    if (!currentMatchItem) return;
    await deps.api('/api/youtube-manager/item/match', { method: 'POST', body: JSON.stringify({ itemId: currentMatchItem.id, action: 'confirm', videoId }) });
    deps.showToast('Correspondência confirmada.');
    await refreshStatus({ light: true });
    await refreshCatalog();
    $('#ytmMatchPanel').classList.add('hidden');
  }

  async function catalogBulkAdd() {
    const playlistId = $('#ytmCatalogPlaylist').value;
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) throw new Error('Selecione a playlist destino.');
    if (!selectedCatalog.size) throw new Error('Selecione ao menos um item confirmado.');
    const planResponse = await deps.api('/api/youtube-manager/playlist-plan', { method: 'POST', body: JSON.stringify({ playlistId, playlistTitle: playlist.title, itemIds: [...selectedCatalog] }) });
    const plan = planResponse.result;
    const dialog = await deps.showDialog({ eyebrow: 'Migração de acervo', title: 'Adicionar vídeos à playlist?', message: `${plan.eligible} vídeo(s) serão inseridos em “${playlist.title}”. ${plan.alreadyExists} já existem e serão ignorados.`, warning: plan.estimatedGeneralQuotaUnits ? `Custo estimado: ${plan.estimatedGeneralQuotaUnits} unidades da quota geral.` : '', confirmLabel: 'Iniciar fila' });
    if (!dialog.confirmed || !plan.eligible) return;
    await deps.api('/api/youtube-manager/playlist-start', { method: 'POST', body: JSON.stringify({ plan }) });
    deps.showToast('Fila de inserção criada.');
    setTab('playlists');
    await refreshQueue();
  }

  function renderQueue(queue) {
    const job = queue && (queue.activeJob || queue.latestJob);
    const toggle = $('#ytmQueueToggle'); const cancel = $('#ytmQueueCancel'); const progress = $('#ytmQueueProgress');
    if (!job) {
      $('#ytmQueueSubtitle').textContent = 'Nenhuma fila ativa.';
      $('#ytmQueueMetrics').innerHTML = '<span><strong>0</strong> concluídos</span><span><strong>0</strong> pendentes</span><span><strong>0</strong> falhas</span>';
      progress.max = 1; progress.value = 0; toggle.classList.add('hidden'); cancel.classList.add('hidden'); return;
    }
    const counts = job.counts || {};
    const total = (job.items || []).length || 1;
    const done = (counts.completed || 0) + (counts.skipped || 0) + (counts.failed || 0) + (counts.cancelled || 0);
    $('#ytmQueueSubtitle').textContent = `${job.playlistTitle || job.playlistId} · ${job.status}${job.pauseReason ? ` · pausada por ${job.pauseReason}` : ''}`;
    progress.max = total; progress.value = Math.min(total, done);
    $('#ytmQueueMetrics').innerHTML = `<span><strong>${counts.completed || 0}</strong> concluídos</span><span><strong>${counts.pending || 0}</strong> pendentes</span><span><strong>${counts.skipped || 0}</strong> já existentes</span><span><strong>${counts.failed || 0}</strong> falhas</span>`;
    toggle.classList.toggle('hidden', !['queued', 'running'].includes(job.status));
    cancel.classList.toggle('hidden', !['queued', 'running'].includes(job.status));
    toggle.textContent = queue.paused ? 'Retomar' : 'Pausar';
    toggle.dataset.action = queue.paused ? 'resume' : 'pause';
  }

  async function refreshQueue() {
    const response = await deps.api('/api/youtube-manager/status');
    status = response.result;
    renderQueue(status.queue);
    renderQuota();
  }

  async function refreshPlaylists() {
    if (!accountConnected()) { playlists = []; renderPlaylists(); return; }
    try {
      const response = await deps.api('/api/youtube-manager/playlists');
      playlists = response.result.playlists || [];
    } catch (error) {
      playlists = [];
      if (error.status !== 401) deps.showToast(error.message, true);
    }
    renderPlaylists();
  }

  async function refreshStatus({ light = false } = {}) {
    const [statusResponse, configResponse] = await Promise.all([
      deps.api('/api/youtube-manager/status'),
      deps.api('/api/youtube-manager/account/config')
    ]);
    status = statusResponse.result;
    accountConfig = configResponse.result;
    sources = status.sources || [];
    renderAccount(); renderSources(); renderCatalogMetrics(); renderQueue(status.queue);
    if (!light) await refreshPlaylists();
  }

  async function saveAccountConfig() {
    const payload = {
      publicBaseUrl: $('#ytmPublicBaseUrl').value.trim(),
      clientId: $('#ytmClientId').value.trim(),
      clientSecret: $('#ytmClientSecret').value
    };
    const response = await deps.api('/api/youtube-manager/account/config', { method: 'PUT', body: JSON.stringify(payload) });
    accountConfig = response.result;
    $('#ytmClientSecret').value = '';
    renderAccount();
    deps.showToast('Configuração OAuth salva.');
  }

  async function home() {
    setTab(activeTab || 'search');
    await refreshStatus();
    if (activeTab === 'catalog') await refreshCatalog();
  }

  function bind() {
    $$('.ytm-tab').forEach((button) => button.addEventListener('click', async () => {
      setTab(button.dataset.ytmTab);
      if (activeTab === 'catalog') await refreshCatalog();
      if (activeTab === 'playlists') await refreshPlaylists();
      if (activeTab === 'account') await refreshStatus({ light: true });
    }));
    $('#ytmRefreshBtn').addEventListener('click', () => home().catch((error) => deps.showToast(error.message, true)));
    $('#ytmSearchBtn').addEventListener('click', () => doSearch().catch((error) => deps.showToast(error.message, true)));
    $('#ytmSearchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') doSearch().catch((error) => deps.showToast(error.message, true)); });
    $('#ytmSearchMore').addEventListener('click', () => doSearch({ more: true }).catch((error) => deps.showToast(error.message, true)));
    $('#ytmSearchPlaylist').addEventListener('change', () => refreshPlaylistIndex());
    $('#ytmSearchResults').addEventListener('click', (event) => {
      const button = event.target.closest('[data-ytm-add-video]'); if (!button) return;
      const item = searchState.results.find((value) => value.id === button.dataset.ytmAddVideo);
      addVideoToPlaylist(button.dataset.ytmAddVideo, item && item.title).catch((error) => deps.showToast(error.message, true));
    });

    $('#ytmSourceAdd').addEventListener('click', async () => {
      try {
        await deps.api('/api/youtube-manager/sources', { method: 'POST', body: JSON.stringify({ rootPath: $('#ytmSourcePath').value.trim(), name: $('#ytmSourceName').value.trim(), recursive: $('#ytmSourceRecursive').checked }) });
        $('#ytmSourcePath').value = ''; $('#ytmSourceName').value = '';
        await refreshStatus({ light: true }); await refreshCatalog(); deps.showToast('Raiz de acervo cadastrada.');
      } catch (error) { deps.showToast(error.message, true); }
    });
    $('#ytmScanBtn').addEventListener('click', async () => {
      const sourceId = $('#ytmSourceSelect').value; if (!sourceId) return deps.showToast('Cadastre uma raiz primeiro.', true);
      try { const response = await deps.api('/api/youtube-manager/scan', { method: 'POST', body: JSON.stringify({ sourceId }) }); await refreshStatus({ light: true }); await refreshCatalog(); deps.showToast(`Varredura concluída: ${response.result.files} arquivo(s).`); } catch (error) { deps.showToast(error.message, true); }
    });
    $('#ytmSourceRemove').addEventListener('click', async () => {
      const sourceId = $('#ytmSourceSelect').value; if (!sourceId) return;
      const dialog = await deps.showDialog({ eyebrow: 'Acervo local', title: 'Remover cadastro da raiz?', message: 'Isto remove apenas o catálogo do Gerenciador do YouTube. Nenhum arquivo do disco será apagado.', confirmLabel: 'Remover', danger: true });
      if (!dialog.confirmed) return;
      await deps.api('/api/youtube-manager/sources', { method: 'DELETE', body: JSON.stringify({ sourceId }) }); selectedCatalog.clear(); await refreshStatus({ light: true }); await refreshCatalog();
    });
    $('#ytmSourceSelect').addEventListener('change', () => { selectedCatalog.clear(); refreshCatalog().catch((error) => deps.showToast(error.message, true)); });
    $('#ytmCatalogRefresh').addEventListener('click', () => refreshCatalog().catch((error) => deps.showToast(error.message, true)));
    $('#ytmCatalogMore').addEventListener('click', () => refreshCatalog({ append: true }).catch((error) => deps.showToast(error.message, true)));
    $('#ytmCatalogAddSelected').addEventListener('click', () => catalogBulkAdd().catch((error) => deps.showToast(error.message, true)));
    $('#ytmCatalogList').addEventListener('change', (event) => { const box = event.target.closest('[data-ytm-select-item]'); if (!box) return; if (box.checked) selectedCatalog.add(box.dataset.ytmSelectItem); else selectedCatalog.delete(box.dataset.ytmSelectItem); });
    $('#ytmCatalogList').addEventListener('click', (event) => {
      const review = event.target.closest('[data-ytm-review]'); if (review) return reviewItem(review.dataset.ytmReview).catch((error) => deps.showToast(error.message, true));
      const ignore = event.target.closest('[data-ytm-ignore]'); if (ignore) return deps.api('/api/youtube-manager/item/match', { method: 'POST', body: JSON.stringify({ itemId: ignore.dataset.ytmIgnore, action: 'ignore' }) }).then(() => refreshCatalog()).catch((error) => deps.showToast(error.message, true));
      const clear = event.target.closest('[data-ytm-clear-match]'); if (clear) return deps.api('/api/youtube-manager/item/match', { method: 'POST', body: JSON.stringify({ itemId: clear.dataset.ytmClearMatch, action: 'clear' }) }).then(() => refreshCatalog()).catch((error) => deps.showToast(error.message, true));
    });
    $('#ytmMatchClose').addEventListener('click', () => $('#ytmMatchPanel').classList.add('hidden'));
    $('#ytmMatchSearch').addEventListener('click', async () => { if (!currentMatchItem) return; try { const response = await deps.api('/api/youtube-manager/item/search', { method: 'POST', body: JSON.stringify({ itemId: currentMatchItem.id, query: $('#ytmMatchQuery').value.trim(), force: true }) }); renderMatchResults(response.result); } catch (error) { deps.showToast(error.message, true); } });
    $('#ytmMatchResults').addEventListener('click', (event) => { const button = event.target.closest('[data-ytm-confirm-video]'); if (button) confirmMatch(button.dataset.ytmConfirmVideo).catch((error) => deps.showToast(error.message, true)); });

    $('#ytmPlaylistCreate').addEventListener('click', async () => { try { await deps.api('/api/youtube-manager/playlists', { method: 'POST', body: JSON.stringify({ title: $('#ytmPlaylistTitle').value.trim(), description: $('#ytmPlaylistDescription').value.trim(), privacyStatus: $('#ytmPlaylistPrivacy').value }) }); $('#ytmPlaylistTitle').value = ''; $('#ytmPlaylistDescription').value = ''; await refreshStatus(); deps.showToast('Playlist criada.'); } catch (error) { deps.showToast(error.message, true); } });
    $('#ytmPlaylistList').addEventListener('click', (event) => { const button = event.target.closest('[data-ytm-use-playlist]'); if (!button) return; $('#ytmSearchPlaylist').value = button.dataset.ytmUsePlaylist; $('#ytmCatalogPlaylist').value = button.dataset.ytmUsePlaylist; deps.showToast('Playlist definida como destino.'); });
    $('#ytmQueueToggle').addEventListener('click', async () => { try { const action = $('#ytmQueueToggle').dataset.action === 'resume' ? 'resume' : 'pause'; await deps.api(`/api/youtube-manager/playlist-${action}`, { method: 'POST', body: '{}' }); await refreshQueue(); } catch (error) { deps.showToast(error.message, true); } });
    $('#ytmQueueCancel').addEventListener('click', async () => { const dialog = await deps.showDialog({ eyebrow: 'Fila de playlist', title: 'Cancelar itens pendentes?', message: 'Itens já inseridos no YouTube serão preservados.', confirmLabel: 'Cancelar pendentes', danger: true }); if (!dialog.confirmed) return; await deps.api('/api/youtube-manager/playlist-cancel', { method: 'POST', body: '{}' }); await refreshQueue(); });

    $('#ytmAccountSave').addEventListener('click', () => saveAccountConfig().catch((error) => deps.showToast(error.message, true)));
    $('#ytmAccountConnect').addEventListener('click', async () => { try { await saveAccountConfig(); const response = await deps.api('/api/youtube-manager/oauth/start', { method: 'POST', body: '{}' }); window.location.assign(response.result.authorizationUrl); } catch (error) { deps.showToast(error.message, true); } });
    $('#ytmAccountTest').addEventListener('click', async () => { try { const response = await deps.api('/api/youtube-manager/account/test', { method: 'POST', body: '{}' }); deps.showToast(`Conectado como ${response.result.account.title}.`); await refreshStatus(); } catch (error) { deps.showToast(error.message, true); } });
    $('#ytmAccountDisconnect').addEventListener('click', async () => { const dialog = await deps.showDialog({ eyebrow: 'Conta YouTube', title: 'Desconectar conta?', message: 'Os tokens locais serão removidos e a revogação no Google será tentada.', confirmLabel: 'Desconectar', danger: true }); if (!dialog.confirmed) return; await deps.api('/api/youtube-manager/oauth/disconnect', { method: 'POST', body: '{}' }); await refreshStatus(); deps.showToast('Conta desconectada.'); });
  }

  async function init(options) {
    if (initialized) return;
    deps = options;
    initialized = true;
    bind();
    const params = new URLSearchParams(window.location.search);
    const oauthState = params.get('youtubeOAuth');
    if (oauthState) {
      deps.activateView?.();
      setTab('account');
      if (oauthState === 'success') deps.showToast('Conta do YouTube conectada.');
      else deps.showToast(params.get('message') || 'Falha ao conectar a conta do YouTube.', true);
      params.delete('youtubeOAuth'); params.delete('message');
      const query = params.toString();
      history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`);
    }
    await refreshStatus();
    pollTimer = window.setInterval(() => {
      if ($('#view-youtube-manager')?.classList.contains('active')) refreshQueue().catch(() => {});
    }, 4000);
  }

  window.YouTubeManagerView = { init, home, setTab };
})();
