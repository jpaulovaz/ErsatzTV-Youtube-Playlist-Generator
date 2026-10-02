(function channelsViewModule(global) {
  const SOURCE_META = {
    uploads: { label: 'Todos os uploads', folderName: 'Uploads' },
    videos: { label: 'Vídeos', folderName: 'Videos' },
    shorts: { label: 'Shorts', folderName: 'Shorts' },
    streams: { label: 'Transmissões finalizadas', folderName: 'Streams' }
  };

  let ctx = null;
  let catalog = null;
  let editingChannelId = '';
  let busy = false;
  const summaryOpenState = new Map();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function currentConfig() {
    return ctx && ctx.getConfig ? ctx.getConfig() : null;
  }

  function getChannel(channelId) {
    return (currentConfig() && currentConfig().channels || []).find((item) => item.channelId === channelId) || null;
  }

  function destinationId(channelId, sourceKind, playlistId = '') {
    return playlistId
      ? `channel:${channelId}:playlist:${playlistId}`
      : `channel:${channelId}:${sourceKind}`;
  }

  function statsFor(channelId, sourceKind, playlistId = '') {
    const all = ctx && ctx.getStatus ? ctx.getStatus() : null;
    const health = all && all.channelsHealth && all.channelsHealth[channelId];
    return health && health[destinationId(channelId, sourceKind, playlistId)] || null;
  }

  function stateForChannel(channelId) {
    const all = ctx && ctx.getStatus ? ctx.getStatus() : null;
    return all && all.channelState && all.channelState.channels && all.channelState.channels[channelId] || null;
  }

  function stateForDestination(channelId, sourceKind, playlistId = '') {
    const all = ctx && ctx.getStatus ? ctx.getStatus() : null;
    const states = all && all.channelState && all.channelState.destinations;
    return states && states[destinationId(channelId, sourceKind, playlistId)] || null;
  }

  function statsHtml(stats) {
    if (!stats) return '<span class="badge">Sem estatísticas</span>';
    const badges = [
      `<span class="badge info">${stats.total || 0} itens</span>`,
      `<span class="badge warn">${stats.pending || 0} pendentes</span>`,
      `<span class="badge ok">${stats.completed || 0} concluídos</span>`,
      `<span class="badge danger">${stats.failed || 0} falhas</span>`,
      `<span class="badge">${stats.orphaned || 0} órfãos</span>`,
      stats.quarantined ? `<span class="badge warn">${stats.quarantined} quarentena</span>` : '',
      stats.ignored ? `<span class="badge">${stats.ignored} ignorado(s)</span>` : '',
      `<span class="badge">${ctx.formatBytes(stats.totalBytes || 0)}</span>`
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

  function subtitleSummary(value) {
    const subtitles = global.DestinationForm.normalizedSubtitles(value);
    if (!subtitles.enabled) return 'Desativadas';
    const languages = subtitles.languages.length ? subtitles.languages.join(', ') : '-';
    return `${languages}${subtitles.includeAuto ? ' + automáticas' : ''}`;
  }

  function profileLabel(value) {
    const labels = global.DestinationForm.PROFILE_LABELS || {};
    return labels[value] || labels.generic || 'Genérico';
  }

  function destinationStatus(channel, sourceKind, playlistId = '', enabled = true) {
    const state = stateForDestination(channel.channelId, sourceKind, playlistId);
    if (state && state.available === false) return { label: 'Indisponível', className: 'warn' };
    if (channel.enabled === false || enabled === false) return { label: 'Pausada', className: '' };
    return { label: 'Ativa', className: 'ok' };
  }

  function aggregateChannelStats(channel) {
    const totals = {
      total: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      orphaned: 0,
      totalBytes: 0,
      found: false
    };
    const add = (stats) => {
      if (!stats) return;
      totals.found = true;
      totals.total += Number(stats.total) || 0;
      totals.pending += Number(stats.pending) || 0;
      totals.completed += Number(stats.completed) || 0;
      totals.failed += Number(stats.failed) || 0;
      totals.orphaned += Number(stats.orphaned) || 0;
      totals.totalBytes += Number(stats.totalBytes) || 0;
    };
    Object.keys(SOURCE_META).forEach((kind) => {
      if (channel.globalSources && channel.globalSources[kind]) add(statsFor(channel.channelId, kind));
    });
    (channel.playlists || []).forEach((playlist) => add(statsFor(channel.channelId, 'playlist', playlist.playlistId)));
    return totals;
  }

  function channelStatsHtml(channel) {
    const stats = aggregateChannelStats(channel);
    if (!stats.found) return '<span class="badge">Sem estatísticas</span>';
    return [
      `<span class="badge info">${stats.total} itens</span>`,
      `<span class="badge ok">${stats.completed} concluídos</span>`,
      `<span class="badge warn">${stats.pending} pendentes</span>`,
      `<span class="badge danger">${stats.failed} falhas</span>`,
      stats.orphaned ? `<span class="badge">${stats.orphaned} órfãos</span>` : '',
      `<span class="badge">${ctx.formatBytes(stats.totalBytes)}</span>`
    ].filter(Boolean).join('');
  }

  function readOnlyField(label, value) {
    return `<div class="channel-readonly-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value == null || value === '' ? '-' : value)}</strong></div>`;
  }

  function renderGlobalSourceSummary(channel, kind) {
    const meta = SOURCE_META[kind];
    const stats = statsFor(channel.channelId, kind);
    const state = stateForDestination(channel.channelId, kind);
    const status = destinationStatus(channel, kind);
    const lastSyncAt = state && state.lastSyncAt || stats && stats.lastDiscoveryAt || null;
    return `
      <details class="channel-readonly-item" data-channel-summary-source="${escapeHtml(kind)}">
        <summary>
          <div class="channel-readonly-summary-copy">
            <strong>${escapeHtml(meta.label)}</strong>
            <small>Genérico · Legendas ${escapeHtml(subtitleSummary(channel.globalSources && channel.globalSources.subtitles))}</small>
            <div class="library-stats">${statsHtml(stats)}</div>
          </div>
          <div class="channel-readonly-summary-state">
            <span class="badge ${status.className}">${status.label}</span>
            <span class="accordion-chevron" aria-hidden="true"></span>
          </div>
        </summary>
        <div class="channel-readonly-body">
          <div class="channel-readonly-grid">
            ${readOnlyField('Perfil', 'Genérico')}
            ${readOnlyField('Legendas', subtitleSummary(channel.globalSources && channel.globalSources.subtitles))}
            ${readOnlyField('Pasta', meta.folderName)}
            ${readOnlyField('Última atualização', lastSyncAt ? ctx.formatDate(lastSyncAt) : '-')}
          </div>
        </div>
      </details>`;
  }

  function renderPlaylistSummary(channel, playlist, index) {
    const stats = statsFor(channel.channelId, 'playlist', playlist.playlistId);
    const state = stateForDestination(channel.channelId, 'playlist', playlist.playlistId);
    const status = destinationStatus(channel, 'playlist', playlist.playlistId, playlist.enabled !== false);
    const qualityText = playlist.maxHeight ? `${playlist.maxHeight}p` : 'Qualidade global';
    const subtitleText = subtitleSummary(playlist.subtitles);
    const profileText = profileLabel(playlist.mediaProfile || 'generic');
    const lastSyncAt = state && state.lastSyncAt || stats && stats.lastDiscoveryAt || null;
    return `
      <details class="channel-readonly-playlist library-accordion" data-channel-summary-playlist="${escapeHtml(playlist.playlistId)}">
        <summary>
          <div class="library-summary-main">
            <span class="library-index">${String(index + 1).padStart(2, '0')}</span>
            <div class="playlist-title">
              <h3>${escapeHtml(playlist.name)}</h3>
              <p>${escapeHtml(`${qualityText} · ${profileText} · Legendas ${subtitleText}`)}</p>
              <div class="library-stats">${statsHtml(stats)}</div>
            </div>
          </div>
          <div class="library-summary-state">
            <span class="badge ${status.className}">${status.label}</span>
            <span class="accordion-chevron" aria-hidden="true"></span>
          </div>
        </summary>
        <div class="library-body channel-readonly-body">
          <div class="channel-readonly-grid">
            ${readOnlyField('Perfil', profileText)}
            ${readOnlyField('Resolução', qualityText)}
            ${readOnlyField('Library ID', playlist.libraryId || '-')}
            ${readOnlyField('Canal ErsatzTV', playlist.channelName || global.DestinationForm.channelNameFor(playlist.channelNumber, '-'))}
            ${readOnlyField('Legendas', subtitleText)}
            ${readOnlyField('Cookies', playlist.cookiesPath ? 'Personalizado' : 'Global')}
            ${readOnlyField('Pasta', playlist.folderName || playlist.name)}
            ${readOnlyField('Última atualização', lastSyncAt ? ctx.formatDate(lastSyncAt) : '-')}
          </div>
        </div>
      </details>`;
  }

  function renderSelectedContent(channel) {
    const selectedKinds = Object.keys(SOURCE_META).filter((kind) => channel.globalSources && channel.globalSources[kind]);
    const playlists = channel.playlists || [];
    if (!selectedKinds.length && !playlists.length) return '';
    return `
      <details class="channel-selected-content" data-channel-selected-content>
        <summary>
          <span class="accordion-copy">
            <strong class="accordion-title">Conteúdo selecionado</strong>
            <small>${selectedKinds.length} fonte(s) · ${playlists.length} playlist(s)</small>
          </span>
          <span class="accordion-state"><span class="accordion-chevron" aria-hidden="true"></span></span>
        </summary>
        <div class="channel-selected-content-body">
          ${selectedKinds.map((kind) => renderGlobalSourceSummary(channel, kind)).join('')}
          ${playlists.length ? `
            <details class="channel-selection-group" data-channel-summary-playlists>
              <summary>
                <span class="accordion-copy"><strong class="accordion-title">Playlists</strong><small>${playlists.length} selecionada(s)</small></span>
                <span class="accordion-state"><span class="accordion-chevron" aria-hidden="true"></span></span>
              </summary>
              <div class="channel-selection-group-body">
                ${playlists.map((playlist, index) => renderPlaylistSummary(channel, playlist, index)).join('')}
              </div>
            </details>` : ''}
        </div>
      </details>`;
  }

  function setBusy(value) {
    busy = Boolean(value);
    const root = $('#channelEditor');
    if (!root) return;
    root.classList.toggle('is-busy', busy);
    root.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
  }

  function showEditor(show = true) {
    $('#channelEditor')?.classList.toggle('hidden', !show);
  }

  function emptyDraft() {
    editingChannelId = '';
    catalog = null;
    const input = $('#channelUrlInput');
    if (input) input.value = '';
    const result = $('#channelAnalyzeResult');
    if (result) result.innerHTML = '<div class="empty-state">Informe a URL e analise o canal.</div>';
    showEditor(true);
    input?.focus();
  }

  function configuredPlaylistMap(channel) {
    return new Map((channel && channel.playlists || []).map((item) => [item.playlistId, item]));
  }

  function mergePlaylistCatalog(catalogPlaylists, channel) {
    const configured = configuredPlaylistMap(channel);
    const seen = new Set();
    const result = [];
    for (const item of catalogPlaylists || []) {
      const existing = configured.get(item.playlistId);
      result.push({ ...item, existing, selected: Boolean(existing), unavailable: false });
      seen.add(item.playlistId);
    }
    for (const existing of channel && channel.playlists || []) {
      if (seen.has(existing.playlistId)) continue;
      result.push({
        playlistId: existing.playlistId,
        name: existing.name,
        folderName: existing.folderName,
        url: existing.url,
        itemCount: null,
        thumbnailUrl: '',
        existing,
        selected: true,
        unavailable: true
      });
    }
    return result;
  }

  function globalSourceGrid(channel, availableSources) {
    const globalSources = channel && channel.globalSources || {};
    const available = new Set(availableSources || Object.keys(SOURCE_META));
    return `
      <div class="channel-source-grid">
        ${Object.entries(SOURCE_META).map(([kind, meta]) => `
          <label class="channel-source-option ${available.has(kind) ? '' : 'is-disabled'}">
            <input type="checkbox" data-channel-source="${kind}" ${globalSources[kind] ? 'checked' : ''} ${available.has(kind) ? '' : 'disabled'}>
            <span>${meta.label}</span>
          </label>
        `).join('')}
      </div>`;
  }

  function playlistCard(item, channel) {
    const value = item.existing || {
      playlistId: item.playlistId,
      name: item.name,
      folderName: item.folderName || item.name,
      url: item.url,
      enabled: true,
      mediaProfile: 'generic',
      libraryId: null,
      channelNumber: null,
      channelName: '',
      maxHeight: null,
      cookiesPath: '',
      subtitles: { enabled: false, includeAuto: true, languages: ['pt-BR', 'pt', 'en', 'es'] },
      orphanPolicy: '',
      quarantineRetentionDays: null
    };
    const checked = item.selected ? 'checked' : '';
    const count = Number.isFinite(Number(item.itemCount)) ? `${Number(item.itemCount)} itens` : '';
    const unavailable = item.unavailable ? '<span class="badge warn">Indisponível na análise</span>' : '';
    const stats = channel ? statsFor(channel.channelId, 'playlist', item.playlistId) : null;
    const orphanAction = value.orphanPolicy === 'mark' && Number(stats && stats.orphaned) > 0
      ? '<button class="small" type="button" data-channel-playlist-action="orphans-cleanup">Limpar órfãos</button>'
      : (value.orphanPolicy === 'quarantine' && Number(stats && stats.quarantined) > 0
        ? '<button class="small" type="button" data-channel-playlist-action="orphans-recover">Recuperar órfãos</button>'
        : '');
    return `
      <details class="channel-playlist-card" data-channel-playlist="${escapeHtml(item.playlistId)}" ${item.selected ? 'open' : ''}>
        <summary>
          <label class="channel-playlist-select" onclick="event.stopPropagation()">
            <input type="checkbox" data-playlist-selected ${checked}>
            <span>
              <strong>${escapeHtml(item.name)}</strong>
              <small>${escapeHtml(count)}</small>
            </span>
          </label>
          <div class="channel-playlist-summary-meta">${unavailable}<span class="accordion-chevron" aria-hidden="true"></span></div>
        </summary>
        <div class="channel-playlist-body ${item.selected ? '' : 'is-disabled'}" data-playlist-fields>
          <div class="library-stats channel-playlist-stats">${statsHtml(stats)}</div>
          ${global.DestinationForm.renderFields(value, {
            mode: 'channel-playlist',
            includeName: false,
            includeIds: true,
            includeUrls: false,
            sourceUrl: item.url,
            enabledLabel: 'Playlist ativa'
          })}
          ${channel && item.existing ? `
            <div class="library-actions-panel">
              <div class="library-action-group">
                <span class="library-action-group-title">Conteúdo</span>
                <div class="library-actions">
                  <button class="small primary" type="button" data-channel-playlist-action="run">Buscar novidades</button>
                  <button class="small" type="button" data-channel-playlist-action="view-content">Ver conteúdo</button>
                  <button class="small" type="button" data-channel-playlist-action="test-cookies">Testar cookies</button>
                  <button class="small" type="button" data-channel-playlist-action="refresh-thumbnails">Atualizar thumbnails</button>
                  <button class="small" type="button" data-channel-playlist-action="refresh-subtitles">Buscar legendas ausentes</button>
                  ${orphanAction}
                </div>
              </div>
              <div class="library-action-group">
                <span class="library-action-group-title">ErsatzTV</span>
                <div class="library-actions">
                  <button class="small" type="button" data-channel-playlist-action="scan">Executar scan</button>
                  <button class="small" type="button" data-channel-playlist-action="empty-trash">Limpar lixo</button>
                  <button class="small" type="button" data-channel-playlist-action="reset-playout">Reset Playout</button>
                </div>
              </div>
              <div class="library-actions library-danger-actions">
                <button class="small danger" type="button" data-channel-playlist-action="remove-config">Remover configuração</button>
                <button class="small danger" type="button" data-channel-playlist-action="delete-with-files">Excluir playlist e arquivos</button>
              </div>
            </div>` : ''}
        </div>
      </details>`;
  }

  function renderAnalyzed(catalogValue, existingChannel = null) {
    catalog = catalogValue;
    const playlistItems = mergePlaylistCatalog(catalog.playlists || [], existingChannel);
    const result = $('#channelAnalyzeResult');
    result.innerHTML = `
      <div class="channel-editor-identity">
        ${catalog.thumbnailUrl ? `<img src="${escapeHtml(catalog.thumbnailUrl)}" alt="">` : '<span class="channel-avatar-placeholder">▶</span>'}
        <div>
          <h3>${escapeHtml(catalog.name)}</h3>
          <p>${escapeHtml(catalog.handle || catalog.channelId)}</p>
        </div>
        <span class="badge">${escapeHtml(catalog.readMode || 'local')}</span>
      </div>

      <div class="channel-editor-section">
        <label class="check-row channel-enabled-toggle"><input type="checkbox" data-channel-enabled ${!existingChannel || existingChannel.enabled !== false ? 'checked' : ''}><span>Canal ativo</span></label>
        <h4>Conteúdo</h4>
        ${globalSourceGrid(existingChannel, catalog.globalSources)}
        <div class="channel-global-subtitles">
          ${global.DestinationForm.renderSubtitleSettings(existingChannel && existingChannel.globalSources && existingChannel.globalSources.subtitles, { compact: true })}
        </div>
        ${existingChannel ? `
          <div class="channel-global-actions">
            <button type="button" class="small" data-channel-global-action="refresh-subtitles">Buscar legendas ausentes</button>
            <button type="button" class="small" data-channel-global-action="orphans-cleanup">Limpar órfãos</button>
          </div>` : ''}
      </div>

      <div class="channel-editor-section">
        <div class="section-heading channel-playlist-heading">
          <h4>Playlists</h4>
          <span class="muted">${playlistItems.length}</span>
        </div>
        <div class="channel-playlist-list">
          ${playlistItems.length ? playlistItems.map((item) => playlistCard(item, existingChannel)).join('') : '<div class="empty-state">Nenhuma playlist pública encontrada.</div>'}
        </div>
      </div>

      <div class="channel-editor-actions">
        <button type="button" data-channel-editor-cancel>Cancelar</button>
        <button type="button" class="primary" data-channel-editor-save>Salvar canal</button>
      </div>`;
    global.DestinationForm.syncSubtitleControls(result);
    global.DestinationForm.syncErsatzTvControls(result);
    global.DestinationForm.syncOrphanControls(result);
    syncPlaylistSelections(result);
  }

  function syncPlaylistSelections(root) {
    $$('[data-channel-playlist]', root).forEach((card) => {
      const checkbox = $('[data-playlist-selected]', card);
      const body = $('[data-playlist-fields]', card);
      if (!checkbox || !body) return;
      const apply = () => {
        body.classList.toggle('is-disabled', !checkbox.checked);
        body.querySelectorAll('input, select, textarea, button').forEach((field) => {
          if (field === checkbox) return;
          field.disabled = !checkbox.checked;
        });
        if (checkbox.checked) {
          global.DestinationForm.syncSubtitleControls(body);
          global.DestinationForm.syncErsatzTvControls(body);
          global.DestinationForm.syncOrphanControls(body);
        }
      };
      checkbox.addEventListener('change', apply);
      apply();
    });
  }

  async function analyze() {
    if (busy) return;
    const url = String($('#channelUrlInput')?.value || '').trim();
    if (!url) throw new Error('Informe a URL do canal.');
    setBusy(true);
    try {
      const result = await ctx.api('/api/channels/analyze', { method: 'POST', body: JSON.stringify({ url }) });
      const existing = getChannel(editingChannelId) || getChannel(result.catalog.channelId);
      if (existing) editingChannelId = existing.channelId;
      renderAnalyzed(result.catalog, existing);
    } finally {
      setBusy(false);
    }
  }

  function collectEditorChannel() {
    if (!catalog) throw new Error('Analise o canal antes de salvar.');
    const existing = getChannel(editingChannelId) || getChannel(catalog.channelId);
    const resultRoot = $('#channelAnalyzeResult');
    const globalSubtitleBox = $('.channel-global-subtitles', resultRoot);
    const subtitles = global.DestinationForm.collect(globalSubtitleBox, {}).subtitles || {
      enabled: false,
      includeAuto: true,
      languages: ['pt-BR', 'pt', 'en', 'es']
    };
    const globalSources = { subtitles };
    Object.keys(SOURCE_META).forEach((kind) => {
      const input = $(`[data-channel-source="${kind}"]`, resultRoot);
      globalSources[kind] = Boolean(input && input.checked);
    });

    const existingMap = configuredPlaylistMap(existing);
    const catalogMap = new Map((catalog.playlists || []).map((item) => [item.playlistId, item]));
    const playlists = [];
    $$('[data-channel-playlist]', resultRoot).forEach((card) => {
      const selected = $('[data-playlist-selected]', card);
      if (!selected || !selected.checked) return;
      const playlistId = card.dataset.channelPlaylist;
      const source = catalogMap.get(playlistId) || existingMap.get(playlistId);
      if (!source) return;
      const previous = existingMap.get(playlistId);
      const value = global.DestinationForm.collect(card, previous ? clone(previous) : {});
      value.playlistId = playlistId;
      value.name = source.name || previous && previous.name || playlistId;
      value.folderName = previous && previous.folderName || source.folderName || value.name;
      value.url = source.url || previous && previous.url || `https://www.youtube.com/playlist?list=${playlistId}`;
      if (!value.orphanPolicy) throw new Error(`Selecione como tratar Arquivos órfãos em "${value.name}".`);
      playlists.push(value);
    });

    return {
      channelId: catalog.channelId,
      name: catalog.name,
      handle: catalog.handle || '',
      url: catalog.url,
      thumbnailUrl: catalog.thumbnailUrl || '',
      uploadsPlaylistId: catalog.uploadsPlaylistId || existing && existing.uploadsPlaylistId || '',
      folderName: existing && existing.folderName || catalog.folderName || catalog.name,
      enabled: Boolean($('[data-channel-enabled]', resultRoot)?.checked),
      globalSources,
      playlists
    };
  }

  async function persistEditor(options = {}) {
    const channel = collectEditorChannel();
    const next = clone(currentConfig());
    next.channels = Array.isArray(next.channels) ? next.channels : [];
    const index = next.channels.findIndex((item) => item.channelId === channel.channelId || (editingChannelId && item.channelId === editingChannelId));
    if (index >= 0) next.channels[index] = channel;
    else next.channels.push(channel);
    await ctx.saveConfig(next, options.message || '');
    editingChannelId = channel.channelId;
    if (options.close) {
      editingChannelId = '';
      catalog = null;
      showEditor(false);
    }
    render();
    return channel;
  }

  async function saveEditor() {
    return persistEditor({ close: true, message: 'Canal salvo.' });
  }

  async function openExisting(channelId) {
    const channel = getChannel(channelId);
    if (!channel) return;
    editingChannelId = channelId;
    showEditor(true);
    $('#channelUrlInput').value = channel.url || `https://www.youtube.com/channel/${channel.channelId}`;
    const fallbackCatalog = {
      channelId: channel.channelId,
      name: channel.name,
      handle: channel.handle || '',
      url: channel.url,
      thumbnailUrl: channel.thumbnailUrl || '',
      folderName: channel.folderName,
      uploadsPlaylistId: channel.uploadsPlaylistId || '',
      playlists: (channel.playlists || []).map((item) => ({ ...item, itemCount: null })),
      globalSources: Object.keys(SOURCE_META),
      readMode: 'config'
    };
    renderAnalyzed(fallbackCatalog, channel);
    setBusy(true);
    try {
      const result = await ctx.api('/api/channels/analyze', { method: 'POST', body: JSON.stringify({ url: channel.url }) });
      renderAnalyzed(result.catalog, channel);
    } catch (error) {
      ctx.showToast(`Canal aberto com a configuração salva. Análise atual falhou: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  function selectedSourceCount(channel) {
    return Object.keys(SOURCE_META).filter((kind) => channel.globalSources && channel.globalSources[kind]).length;
  }

  function summaryDetailsKey(details) {
    if (!details) return '';
    const channelCard = details.closest('[data-channel-id]');
    const channelId = channelCard && channelCard.dataset.channelId;
    if (!channelId) return '';
    if (details.hasAttribute('data-channel-selected-content')) return `${channelId}:selected`;
    if (details.dataset.channelSummarySource) return `${channelId}:source:${details.dataset.channelSummarySource}`;
    if (details.hasAttribute('data-channel-summary-playlists')) return `${channelId}:playlists`;
    if (details.dataset.channelSummaryPlaylist) return `${channelId}:playlist:${details.dataset.channelSummaryPlaylist}`;
    return '';
  }

  function rememberSummaryOpenState(root) {
    if (!root) return;
    root.querySelectorAll('details[data-channel-selected-content], details[data-channel-summary-source], details[data-channel-summary-playlists], details[data-channel-summary-playlist]').forEach((details) => {
      const key = summaryDetailsKey(details);
      if (key) summaryOpenState.set(key, details.open);
    });
  }

  function restoreSummaryOpenState(root) {
    if (!root) return;
    root.querySelectorAll('details[data-channel-selected-content], details[data-channel-summary-source], details[data-channel-summary-playlists], details[data-channel-summary-playlist]').forEach((details) => {
      const key = summaryDetailsKey(details);
      if (key && summaryOpenState.has(key)) details.open = summaryOpenState.get(key);
    });
  }

  function render() {
    if (!ctx) return;
    const root = $('#channelList');
    if (!root) return;
    const channels = currentConfig() && currentConfig().channels || [];
    $('#navChannelsBadge').textContent = String(channels.length);
    rememberSummaryOpenState(root);
    if (!channels.length) {
      root.innerHTML = '<div class="empty-state">Nenhum canal configurado.</div>';
      return;
    }
    root.innerHTML = channels.map((channel) => {
      const state = stateForChannel(channel.channelId);
      const selectedSources = selectedSourceCount(channel);
      const status = state && state.available === false ? 'Indisponível' : (channel.enabled === false ? 'Pausado' : 'Ativo');
      const statusClass = state && state.available === false ? 'warn' : (channel.enabled === false ? '' : 'ok');
      return `
        <article class="channel-card" data-channel-id="${escapeHtml(channel.channelId)}">
          <div class="channel-card-top">
            <div class="channel-card-main">
              ${channel.thumbnailUrl ? `<img class="channel-card-thumb" src="${escapeHtml(channel.thumbnailUrl)}" alt="">` : '<span class="channel-card-thumb channel-avatar-placeholder">▶</span>'}
              <div class="channel-card-copy">
                <div class="channel-card-title"><h3>${escapeHtml(channel.name)}</h3><span class="badge ${statusClass}">${status}</span></div>
                <p>${escapeHtml(channel.handle || channel.channelId)}</p>
                <small>${selectedSources} fonte(s) · ${(channel.playlists || []).length} playlist(s)${state && state.lastCatalogAt ? ` · ${ctx.formatDate(state.lastCatalogAt)}` : ''}</small>
              </div>
            </div>
            <div class="channel-card-actions">
              <button type="button" class="small primary" data-channel-action="run">Atualizar agora</button>
              <button type="button" class="small" data-channel-action="edit">Editar</button>
              <button type="button" class="small danger" data-channel-action="remove-config">Remover configuração</button>
              <button type="button" class="small danger" data-channel-action="delete-with-files">Excluir canal e arquivos</button>
            </div>
          </div>
          <div class="channel-card-stats">${channelStatsHtml(channel)}</div>
          ${renderSelectedContent(channel)}
        </article>`;
    }).join('');
    restoreSummaryOpenState(root);
  }

  async function runPlaylistAction(channelId, playlistId, action) {
    if (editingChannelId === channelId && catalog) await persistEditor({ close: false, message: '' });
    const channel = getChannel(channelId);
    const playlist = channel && (channel.playlists || []).find((item) => item.playlistId === playlistId);

    if (action === 'view-content' || action === 'orphans-recover') {
      if (!playlist || !ctx.openChannelPlaylistContent) throw new Error('Playlist não encontrada para abrir o conteúdo.');
      await ctx.openChannelPlaylistContent(channelId, playlistId, playlist.name, action === 'orphans-recover' ? 'quarantine' : 'content');
      return;
    }

    if (action === 'remove-config') {
      if (!playlist) return;
      const decision = await ctx.showDialog({
        eyebrow: 'Playlist',
        title: 'Remover configuração',
        message: `Remover "${playlist.name}" da configuração? Os arquivos serão preservados.`,
        danger: true
      });
      if (!decision.confirmed) return;
      const response = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/playlists/${encodeURIComponent(playlistId)}/remove-config`, { method: 'POST', body: '{}' });
      ctx.setConfig(response.result.config);
      render();
      await openExisting(channelId);
      ctx.showToast('Playlist removida da configuração.');
      return;
    }
    if (action === 'delete-with-files') {
      if (!playlist) return;
      const decision = await ctx.showDialog({
        eyebrow: 'Ação irreversível',
        title: 'Excluir playlist e arquivos',
        message: 'Os arquivos locais desta playlist serão removidos.',
        inputLabel: `Digite exatamente: ${playlist.name}`,
        expectedText: playlist.name,
        danger: true
      });
      if (!decision.confirmed) return;
      const response = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/playlists/${encodeURIComponent(playlistId)}/delete-with-files`, {
        method: 'POST', body: JSON.stringify({ confirmation: decision.value })
      });
      ctx.setConfig(response.result.config);
      render();
      await openExisting(channelId);
      ctx.showToast('Playlist e arquivos excluídos.');
      return;
    }
    if (action === 'run') {
      const response = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/playlists/${encodeURIComponent(playlistId)}/run`, { method: 'POST', body: '{}' });
      ctx.showToast(response.message || 'Atualização iniciada.');
      return;
    }
    if (action === 'orphans-cleanup') {
      const preview = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/playlists/${encodeURIComponent(playlistId)}/orphans-preview`, { method: 'POST', body: '{}' });
      if (!preview.result.count) return ctx.showToast('Nenhum item órfão encontrado.');
      const decision = await ctx.showDialog({
        eyebrow: 'Órfãos',
        title: 'Limpar órfãos',
        message: `Excluir ${preview.result.count} item(ns) e ${ctx.formatBytes(preview.result.totalBytes)}?`,
        danger: true
      });
      if (!decision.confirmed) return;
      const cleaned = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/playlists/${encodeURIComponent(playlistId)}/orphans-cleanup`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      ctx.showToast(`${cleaned.result.videosRemoved || 0} vídeo(s) órfão(s) removido(s).`);
      await ctx.refresh();
      return;
    }
    if (action === 'empty-trash') {
      const decision = await ctx.showDialog({
        eyebrow: 'ErsatzTV',
        title: 'Limpar lixo',
        message: 'A lixeira do ErsatzTV será esvaziada. Esta ação é global.',
        danger: true
      });
      if (!decision.confirmed) return;
    }
    if (action === 'reset-playout') {
      if (!playlist || !playlist.channelNumber) throw new Error('Selecione o Canal no ErsatzTV antes de resetar o Playout.');
      const decision = await ctx.showDialog({
        eyebrow: 'ErsatzTV',
        title: 'Reset Playout',
        message: `O Playout de "${playlist.channelName || global.DestinationForm.channelNameFor(playlist.channelNumber, 'canal selecionado')}" será apagado e reconstruído.`,
        warning: 'O progresso atual pode ser perdido.',
        danger: true
      });
      if (!decision.confirmed) return;
    }
    const response = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/playlists/${encodeURIComponent(playlistId)}/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' });
    if (action === 'test-cookies') ctx.showToast(response.result && response.result.message || 'Cookies testados.');
    else if (action === 'refresh-thumbnails') ctx.showToast('Atualização de thumbnails concluída.');
    else if (action === 'refresh-subtitles') ctx.showToast('Busca de legendas agendada/concluída.');
    else ctx.showToast('Ação concluída.');
    await ctx.refresh();
  }

  async function runGlobalAction(channelId, action) {
    if (editingChannelId === channelId && catalog) await persistEditor({ close: false, message: '' });
    if (action === 'orphans-cleanup') {
      const preview = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/global/orphans-preview`, { method: 'POST', body: '{}' });
      if (!preview.result.count) return ctx.showToast('Nenhum item órfão encontrado nas fontes globais.');
      const decision = await ctx.showDialog({
        eyebrow: 'Órfãos',
        title: 'Limpar órfãos',
        message: `Excluir ${preview.result.count} item(ns) das fontes globais e ${ctx.formatBytes(preview.result.totalBytes)}?`,
        danger: true
      });
      if (!decision.confirmed) return;
      await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/global/orphans-cleanup`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      ctx.showToast('Órfãos das fontes globais removidos.');
      await ctx.refresh();
      return;
    }
    await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/global/${encodeURIComponent(action)}`, { method: 'POST', body: '{}' });
    ctx.showToast('Ação concluída.');
    await ctx.refresh();
  }

  async function handleChannelAction(channelId, action) {
    const channel = getChannel(channelId);
    if (!channel) return;
    if (action === 'edit') return openExisting(channelId);
    if (action === 'run') {
      const response = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/run`, { method: 'POST', body: '{}' });
      ctx.showToast(response.message || 'Atualização iniciada.');
      return;
    }
    if (action === 'remove-config') {
      const decision = await ctx.showDialog({
        eyebrow: 'Canal',
        title: 'Remover configuração',
        message: `Remover "${channel.name}" da configuração? Os arquivos serão preservados.`,
        danger: true
      });
      if (!decision.confirmed) return;
      const response = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/remove-config`, { method: 'POST', body: '{}' });
      ctx.setConfig(response.result.config);
      render();
      ctx.showToast('Canal removido da configuração.');
      return;
    }
    if (action === 'delete-with-files') {
      const decision = await ctx.showDialog({
        eyebrow: 'Ação irreversível',
        title: 'Excluir canal e arquivos',
        message: 'Todos os arquivos locais dentro da pasta deste canal serão removidos.',
        inputLabel: `Digite exatamente: ${channel.name}`,
        expectedText: channel.name,
        danger: true
      });
      if (!decision.confirmed) return;
      const response = await ctx.api(`/api/channels/${encodeURIComponent(channelId)}/delete-with-files`, {
        method: 'POST', body: JSON.stringify({ confirmation: decision.value })
      });
      ctx.setConfig(response.result.config);
      render();
      ctx.showToast('Canal e arquivos excluídos.');
    }
  }

  function bindEvents() {
    $('#addChannelBtn')?.addEventListener('click', emptyDraft);
    $('#runChannelsBtn')?.addEventListener('click', () => {
      ctx.api('/api/channels/run', { method: 'POST', body: '{}' })
        .then((response) => ctx.showToast(response.message || 'Atualização de Canais iniciada.'))
        .catch((error) => ctx.showToast(error.message, true));
    });
    $('#channelAnalyzeBtn')?.addEventListener('click', () => analyze().catch((error) => ctx.showToast(error.message, true)));
    $('#channelUrlInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        analyze().catch((error) => ctx.showToast(error.message, true));
      }
    });
    $('#channelAnalyzeResult')?.addEventListener('click', (event) => {
      const save = event.target.closest('[data-channel-editor-save]');
      if (save) return saveEditor().catch((error) => ctx.showToast(error.message, true));
      if (event.target.closest('[data-channel-editor-cancel]')) {
        editingChannelId = '';
        catalog = null;
        showEditor(false);
        return;
      }
      const playlistAction = event.target.closest('[data-channel-playlist-action]');
      if (playlistAction) {
        const card = playlistAction.closest('[data-channel-playlist]');
        if (!editingChannelId || !card) return;
        return runPlaylistAction(editingChannelId, card.dataset.channelPlaylist, playlistAction.dataset.channelPlaylistAction)
          .catch((error) => ctx.showToast(error.message, true));
      }
      const globalAction = event.target.closest('[data-channel-global-action]');
      if (globalAction && editingChannelId) {
        return runGlobalAction(editingChannelId, globalAction.dataset.channelGlobalAction)
          .catch((error) => ctx.showToast(error.message, true));
      }
    });
    $('#channelList')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-channel-action]');
      const card = button && button.closest('[data-channel-id]');
      if (!button || !card) return;
      handleChannelAction(card.dataset.channelId, button.dataset.channelAction)
        .catch((error) => ctx.showToast(error.message, true));
    });
  }

  function init(context) {
    ctx = context;
    bindEvents();
    render();
  }

  function update() {
    render();
  }

  function home() {
    editingChannelId = '';
    catalog = null;
    const input = $('#channelUrlInput');
    if (input) input.value = '';
    const result = $('#channelAnalyzeResult');
    if (result) result.innerHTML = '';
    showEditor(false);
    render();
  }

  global.ChannelView = { init, render, update, home };
})(window);
