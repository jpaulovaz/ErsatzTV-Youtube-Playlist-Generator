(function initSubtitleManager(global) {
  'use strict';

  const state = {
    api: null,
    showToast: null,
    showDialog: null,
    escapeHtml: null,
    endpointBase: '',
    item: null,
    status: null,
    opened: false,
    playerOnly: false,
    preview: null,
    previewOffsetMs: 0,
    textTrack: null,
    activeLocalTrackId: '',
    panelId: 'subtitleManagerPanel',
    targetLanguage: 'pt-BR',
    provider: 'youtube',
    searchResults: [],
    defaults: { artist: '', track: '', album: '' },
    queryDraft: { artist: '', track: '', album: '' },
    previewToken: '',
    onContentChanged: null,
    contextOnContentChanged: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function esc(value) {
    return state.escapeHtml ? state.escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, '');
  }

  function toast(message, error = false) {
    if (state.showToast) state.showToast(message, error);
  }

  async function notifyContentChanged(change = {}) {
    const handler = state.contextOnContentChanged || state.onContentChanged;
    if (typeof handler !== 'function' || !state.item) return;
    try {
      await handler({ itemId: state.item.id, endpointBase: state.endpointBase, ...change });
    } catch (error) {
      toast(`Legenda atualizada, mas não foi possível atualizar a lista: ${error.message}`, true);
    }
  }

  function formatOffset(ms) {
    const value = Number(ms) || 0;
    const seconds = value / 1000;
    return `${seconds > 0 ? '+' : ''}${seconds.toFixed(3)} s`;
  }

  const TARGET_LANGUAGES = Object.freeze([
    { value: 'pt-BR', label: 'Português (Brasil)' },
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' }
  ]);

  function canonicalTargetLanguage(value) {
    const key = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (key === 'pt-br' || key === 'pt') return 'pt-BR';
    if (key === 'en' || key.startsWith('en-')) return 'en';
    if (key === 'es' || key.startsWith('es-')) return 'es';
    return '';
  }

  function targetLanguageOptions() {
    return TARGET_LANGUAGES.map((entry) => `<option value="${entry.value}" ${state.targetLanguage === entry.value ? 'selected' : ''}>${entry.label}</option>`).join('');
  }

  function localTrackTitle(track) {
    if (track?.language === 'und' && track?.metadata?.outputMode === 'bilingual') return 'Bilíngue';
    return track?.language || 'und';
  }

  function localTrackSubtitle(track) {
    const parts = [track?.sourceLabel || 'Arquivo local'];
    if (track?.language === 'und' && track?.metadata?.outputMode === 'bilingual') {
      const source = track.metadata.sourceLanguage || '?';
      const target = track.metadata.targetLanguage || '?';
      parts.push(`${source} + ${target}`);
      parts.push('ErsatzTV: und');
    }
    if (track?.fileName && track.fileName !== track.language) parts.push(track.fileName);
    if (track?.editable === false) parts.push('Somente leitura');
    if (track?.staleTranslation) parts.push('Tradução desatualizada');
    return parts.join(' · ');
  }

  function stopPlayer() {
    const video = $('#subtitleManagerVideo');
    if (!video) return;
    try { video.pause(); } catch {}
    try { video.removeAttribute('src'); video.load(); } catch {}
  }

  function panel() { return document.getElementById(state.panelId || 'subtitleManagerPanel'); }

  function canRenderCue() {
    return typeof global.VTTCue === 'function' || typeof global.TextTrackCue === 'function';
  }

  function cueCtor() { return global.VTTCue || global.TextTrackCue; }

  function clearTextTrack() {
    if (!state.textTrack) return;
    try {
      const cues = state.textTrack.cues ? Array.from(state.textTrack.cues) : [];
      for (const cue of cues) state.textTrack.removeCue(cue);
      state.textTrack.mode = 'hidden';
    } catch {}
  }

  function ensureTextTrack() {
    const video = $('#subtitleManagerVideo');
    if (!video || !canRenderCue()) return null;
    if (!state.textTrack) {
      state.textTrack = video.addTextTrack('subtitles', 'Prévia', 'und');
    }
    clearTextTrack();
    state.textTrack.mode = 'showing';
    return state.textTrack;
  }

  function renderPreviewCues() {
    if (!state.preview || !Array.isArray(state.preview.cues)) return;
    const track = ensureTextTrack();
    if (!track) {
      toast('Este navegador não permite carregar cues temporários de legenda no player.', true);
      return;
    }
    const Ctor = cueCtor();
    for (const cue of state.preview.cues) {
      const start = Math.max(0, (Number(cue.startMs) + state.previewOffsetMs) / 1000);
      const rawEnd = Math.max(0, (Number(cue.endMs) + state.previewOffsetMs) / 1000);
      const end = Math.max(start + 0.25, rawEnd);
      try { track.addCue(new Ctor(start, end, String(cue.text || ''))); } catch {}
    }
    const label = $('#subtitleManagerPreviewLabel');
    const previewLanguage = state.preview.kind === 'candidate' && (!state.preview.language || state.preview.language === 'und')
      ? state.targetLanguage
      : (state.preview.language || state.targetLanguage);
    if (label) label.textContent = `${state.preview.sourceLabel || 'Prévia'} · ${previewLanguage}`;
    updateOffsetUi();
  }

  function updateOffsetUi() {
    const value = $('#subtitleManagerOffsetValue');
    if (value) value.textContent = formatOffset(state.previewOffsetMs);
    const input = $('#subtitleManagerOffsetInput');
    if (input && document.activeElement !== input) input.value = (state.previewOffsetMs / 1000).toFixed(3);
    const save = $('#subtitleManagerSaveOffset');
    if (save) save.disabled = !(state.preview && state.preview.kind === 'local' && state.previewOffsetMs !== 0 && state.status?.canApply);
  }

  function setPreviewOffset(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    state.previewOffsetMs = Math.max(-1800000, Math.min(1800000, Math.round(number)));
    renderPreviewCues();
  }

  function mediaUrl() {
    if (!state.item || !state.endpointBase) return '';
    const params = new URLSearchParams({ id: state.item.id });
    if (state.previewToken) params.set('previewToken', state.previewToken);
    return `${state.endpointBase}/content-media?${params.toString()}`;
  }

  function loadPlayerSource() {
    const video = $('#subtitleManagerVideo');
    if (!video || !state.status?.mediaAvailable) return;
    video.src = mediaUrl();
    video.load();
  }

  function localTrackRows() {
    const tracks = state.status?.tracks || [];
    if (!tracks.length) return '<div class="subtitle-manager-empty">Sem legenda local ou embutida detectada.</div>';
    return tracks.map((track) => {
      const trackId = track.trackId || track.language;
      const isPreviewing = state.preview?.kind === 'local' && (state.preview.trackId || state.preview.language) === trackId;
      const editable = track.editable !== false && !track.embedded;
      return `
      <div class="subtitle-manager-track ${isPreviewing ? 'is-previewing' : ''} ${editable ? '' : 'is-readonly'}">
        <div><strong>${esc(localTrackTitle(track))}</strong><small>${esc(localTrackSubtitle(track))}</small></div>
        <div class="inline-actions">
          <button type="button" class="small subtitle-preview-button ${isPreviewing ? 'is-previewing' : ''}" aria-pressed="${isPreviewing ? 'true' : 'false'}" data-subtitle-local-preview="${esc(trackId)}" ${!editable ? 'disabled title="Este formato é somente leitura nesta versão"' : ''}>${!editable ? 'Somente leitura' : (isPreviewing ? 'Em teste no player' : 'Testar no player')}</button>
          <button type="button" class="small danger" data-subtitle-local-delete="${esc(trackId)}" ${!editable || !state.status?.canApply ? 'disabled title="A exclusão exige uma faixa SRT editável e gravável"' : ''}>Excluir legenda</button>
        </div>
      </div>`;
    }).join('');
  }

  function historyRows() {
    const trackId = state.activeLocalTrackId;
    const entries = trackId && state.status?.history ? state.status.history[trackId] || [] : [];
    if (!trackId) return '<div class="subtitle-manager-empty">Selecione uma legenda local para visualizar o histórico.</div>';
    if (!entries.length) return '<div class="subtitle-manager-empty">Nenhuma versão anterior registrada para esta faixa.</div>';
    return entries.map((entry) => `
      <div class="subtitle-manager-history-row">
        <div><strong>${esc(entry.sourceLabel || 'Versão anterior')}</strong><small>${esc(entry.createdAt ? new Date(entry.createdAt).toLocaleString('pt-BR') : '')} · offset ${esc(formatOffset(entry.lastAppliedOffsetMs || 0))}</small></div>
        <button type="button" class="small" data-subtitle-history-restore="${esc(entry.id)}" data-track-id="${esc(trackId)}" ${entry.valid === false ? 'disabled title="Arquivo histórico ausente"' : ''}>Restaurar</button>
      </div>`).join('');
  }

  function providerControls() {
    const providers = state.status?.providers || {};
    const youtubeAvailable = Boolean(providers.youtube?.available);
    const lrclibAvailable = Boolean(providers.lrclib?.available);
    if (!youtubeAvailable && !lrclibAvailable) return '';
    if (state.provider === 'lrclib' && !lrclibAvailable) state.provider = 'youtube';
    if (state.provider === 'youtube' && !youtubeAvailable && lrclibAvailable) state.provider = 'lrclib';
    const isLrclib = state.provider === 'lrclib';
    return `
      <div class="subtitle-manager-search-head">
        <label>Fonte
          <select id="subtitleManagerProvider">
            ${youtubeAvailable ? `<option value="youtube" ${state.provider === 'youtube' ? 'selected' : ''}>YouTube</option>` : ''}
            ${lrclibAvailable ? `<option value="lrclib" ${state.provider === 'lrclib' ? 'selected' : ''}>LRCLIB</option>` : ''}
          </select>
        </label>
        <label>Idioma desejado
          <select id="subtitleManagerApplyLanguage">${targetLanguageOptions()}</select>
        </label>
      </div>
      <div id="subtitleManagerLrclibFields" class="subtitle-manager-query ${isLrclib ? '' : 'hidden'}">
        <label>Artista<input id="subtitleManagerArtist" type="text" maxlength="220" value="${esc(state.queryDraft.artist)}"></label>
        <label>Música<input id="subtitleManagerTrack" type="text" maxlength="220" value="${esc(state.queryDraft.track)}"></label>
        <label>Álbum (opcional)<input id="subtitleManagerAlbum" type="text" maxlength="220" value="${esc(state.queryDraft.album)}"></label>
        <button type="button" class="small" data-subtitle-reset-query>Restaurar dados originais</button>
      </div>
      <button id="subtitleManagerSearchBtn" type="button" class="primary">${isLrclib ? 'Pesquisar LRCLIB' : 'Consultar faixas do YouTube'}</button>`;
  }

  function resultRows() {
    if (!state.searchResults.length) return '<div class="subtitle-manager-empty">Nenhuma pesquisa executada nesta sessão.</div>';
    return state.searchResults.map((item, index) => {
      const match = item.match?.label ? `${item.match.label}${item.match.score != null ? ` · ${item.match.score}/100` : ''}` : '';
      const duration = item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(Math.round(item.durationSeconds % 60)).padStart(2, '0')}` : '';
      const durationDelta = item.match?.durationDeltaSeconds != null ? `Diferença: ${Math.round(item.match.durationDeltaSeconds)} s` : '';
      const metadata = [item.artistName, item.albumName, duration, durationDelta, match].filter(Boolean).join(' · ');
      const warning = Array.isArray(item.warnings) && item.warnings.length ? `<small class="subtitle-manager-warning">${esc(item.warnings.join(' '))}</small>` : '';
      const isPreviewing = state.preview?.kind === 'candidate'
        && state.preview.provider === item.provider
        && state.preview.candidate?.candidateId === item.candidateId;
      return `
        <div class="subtitle-manager-result ${isPreviewing ? 'is-previewing' : ''}">
          <div class="subtitle-manager-result-copy">
            <strong>${esc(item.label || item.trackName || item.language || `Resultado ${index + 1}`)}</strong>
            <small>${esc(metadata)}</small>${warning}
          </div>
          <div class="inline-actions">
            <button type="button" class="small subtitle-preview-button ${isPreviewing ? 'is-previewing' : ''}" aria-pressed="${isPreviewing ? 'true' : 'false'}" data-subtitle-result-preview="${index}" ${item.canPreview === false || !state.status?.mediaAvailable ? 'disabled' : ''}>${isPreviewing ? 'Em teste no player' : 'Testar no player'}</button>
            <button type="button" class="small primary" data-subtitle-result-apply="${index}" ${item.canApply === false || !state.status?.canApply ? 'disabled' : ''}>Aplicar</button>
          </div>
        </div>`;
    }).join('');
  }

  function refreshPreviewSelectionUi() {
    const localTracks = $('#subtitleManagerLocalTracks');
    if (localTracks) localTracks.innerHTML = localTrackRows();
    const results = $('#subtitleManagerResults');
    if (results) results.innerHTML = resultRows();
  }

  function render() {
    const root = panel();
    if (!root || !state.status) return;
    const tracks = state.status.tracks || [];
    const current = tracks.length ? tracks.map((track) => `${localTrackTitle(track)}: ${track.sourceLabel}`).join(' · ') : 'Sem legenda';
    const hasProviders = Boolean(state.status?.providers?.youtube?.available || state.status?.providers?.lrclib?.available);
    root.innerHTML = `
      <div class="subtitle-manager-head">
        <div><span class="page-kicker">Legendas</span><h3>Gerenciador de legendas</h3><p>${esc(current)}</p></div>
        <button type="button" class="small" data-subtitle-manager-close>Fechar gerenciador</button>
      </div>

      <div class="subtitle-manager-player-card">
        ${state.status.mediaAvailable ? `
          <video id="subtitleManagerVideo" controls preload="metadata" playsinline></video>
          <div class="subtitle-manager-player-meta">
            <span id="subtitleManagerPreviewLabel">Nenhuma faixa em prévia</span>
            <button id="subtitleManagerCompatiblePreview" type="button" class="small hidden">Criar prévia compatível</button>
          </div>` : '<div class="subtitle-manager-empty">Arquivo de vídeo local indisponível para reprodução.</div>'}
      </div>

      <div class="subtitle-manager-grid">
        <section class="subtitle-manager-section">
          <h4>Legendas locais</h4>
          <div id="subtitleManagerLocalTracks">${localTrackRows()}</div>
        </section>
        <section class="subtitle-manager-section">
          <h4>Sincronização</h4>
          <div class="subtitle-manager-offset">
            <div class="inline-actions">
              <button type="button" class="small" data-subtitle-offset="-1000">Adiantar 1 s</button>
              <button type="button" class="small" data-subtitle-offset="-100">Adiantar 100 ms</button>
              <button type="button" class="small" data-subtitle-offset-reset>Reset</button>
              <button type="button" class="small" data-subtitle-offset="100">Atrasar 100 ms</button>
              <button type="button" class="small" data-subtitle-offset="1000">Atrasar 1 s</button>
            </div>
            <label>Offset de teste
              <input id="subtitleManagerOffsetInput" type="number" step="0.001" min="-1800" max="1800" value="${(state.previewOffsetMs / 1000).toFixed(3)}">
            </label>
            <strong id="subtitleManagerOffsetValue">${esc(formatOffset(state.previewOffsetMs))}</strong>
            <button id="subtitleManagerSaveOffset" type="button" class="small primary" disabled>Salvar ajuste na legenda ativa</button>
          </div>
        </section>
      </div>

      ${hasProviders ? `<section class="subtitle-manager-section subtitle-manager-search">
        <h4>Pesquisar outra legenda</h4>
        ${providerControls()}
        <div id="subtitleManagerResults" class="subtitle-manager-results">${resultRows()}</div>
      </section>` : ''}

      <section class="subtitle-manager-section">
        <h4>Histórico da faixa</h4>
        <div id="subtitleManagerHistory">${historyRows()}</div>
      </section>`;
    root.classList.remove('hidden');
    state.opened = true;
    if (state.status.mediaAvailable) {
      state.textTrack = null;
      loadPlayerSource();
      const video = $('#subtitleManagerVideo');
      if (video) {
        video.addEventListener('error', () => $('#subtitleManagerCompatiblePreview')?.classList.remove('hidden'));
      }
    }
    if (state.preview) renderPreviewCues();
    if (state.playerOnly) root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function refreshStatus() {
    if (!state.item || !state.endpointBase) return;
    const response = await state.api(`${state.endpointBase}/subtitle-status?id=${encodeURIComponent(state.item.id)}`);
    state.status = response.result || {};
    state.defaults = { ...(state.status.queryDefaults || {}) };
    if (!state.queryDraft.track && !state.queryDraft.artist && !state.queryDraft.album) state.queryDraft = { ...state.defaults };
    if (state.activeLocalTrackId) {
      const stillLocal = (state.status.tracks || []).some((track) => (track.trackId || track.language) === state.activeLocalTrackId);
      const hasHistory = Boolean((state.status.history?.[state.activeLocalTrackId] || []).length);
      if (!stillLocal && !hasHistory) state.activeLocalTrackId = '';
    }
  }

  async function open(options = {}) {
    if (!state.item || !state.endpointBase || !state.api) return;
    state.playerOnly = options.mode === 'player';
    try {
      await refreshStatus();
      render();
      if (options.autoPreviewFirst && !state.preview) {
        const first = (state.status?.tracks || []).find((track) => track.editable !== false && !track.embedded);
        if (first) await previewLocal(first.trackId || first.language);
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  function close() {
    stopPlayer();
    clearTextTrack();
    state.preview = null;
    state.previewOffsetMs = 0;
    state.previewToken = '';
    state.textTrack = null;
    state.opened = false;
    const root = panel();
    if (root) { root.classList.add('hidden'); root.innerHTML = ''; }
  }

  function setContext({ item, endpointBase, panelId = 'subtitleManagerPanel', onContentChanged = null }) {
    if (!item || !endpointBase) { close(); state.item = null; state.endpointBase = ''; state.contextOnContentChanged = null; state.queryDraft = { artist: '', track: '', album: '' }; return; }
    if (state.item?.id !== item.id || state.endpointBase !== endpointBase || state.panelId !== panelId) {
      close();
      state.queryDraft = { artist: '', track: '', album: '' };
      state.searchResults = [];
      state.activeLocalTrackId = '';
    }
    state.panelId = panelId;
    state.item = item;
    state.endpointBase = endpointBase;
    state.contextOnContentChanged = typeof onContentChanged === 'function' ? onContentChanged : null;
  }

  function getActiveTrack() {
    if (!state.item) return null;
    return {
      itemId: state.item.id,
      trackId: state.activeLocalTrackId || state.preview?.trackId || '',
      fingerprint: state.preview?.kind === 'local' ? (state.preview.fingerprint || null) : null,
      previewKind: state.preview?.kind || null
    };
  }

  async function previewLocal(trackId) {
    const response = await state.api(`${state.endpointBase}/subtitle-preview-local`, {
      method: 'POST', body: JSON.stringify({ itemId: state.item.id, trackId, language: trackId })
    });
    state.preview = { ...(response.result || {}), kind: 'local' };
    state.previewOffsetMs = 0;
    state.activeLocalTrackId = response.result?.trackId || trackId;
    render();
    renderPreviewCues();
    $('#subtitleManagerVideo')?.play().catch(() => {});
  }

  async function searchProvider() {
    const button = $('#subtitleManagerSearchBtn');
    if (button) button.disabled = true;
    try {
      const query = state.provider === 'lrclib' ? {
        artist: $('#subtitleManagerArtist')?.value || '', track: $('#subtitleManagerTrack')?.value || '', album: $('#subtitleManagerAlbum')?.value || ''
      } : {};
      const response = await state.api(`${state.endpointBase}/subtitle-search`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, provider: state.provider, language: state.targetLanguage, query })
      });
      state.searchResults = response.result?.candidates || [];
      const results = $('#subtitleManagerResults'); if (results) results.innerHTML = resultRows();
      toast(`${state.searchResults.length} candidato(s) encontrado(s).`);
    } catch (error) { toast(error.message, true); }
    finally { if (button) button.disabled = false; }
  }

  async function previewCandidate(index) {
    const candidate = state.searchResults[index];
    if (!candidate) return;
    try {
      const response = await state.api(`${state.endpointBase}/subtitle-preview`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, provider: state.provider, candidateId: candidate.candidateId })
      });
      state.preview = { ...(response.result || {}), kind: 'candidate', candidate, provider: state.provider };
      state.previewOffsetMs = 0;
      renderPreviewCues();
      refreshPreviewSelectionUi();
      $('#subtitleManagerVideo')?.play().catch(() => {});
    } catch (error) { toast(error.message, true); }
  }

  async function applyCandidate(index) {
    const candidate = state.searchResults[index];
    if (!candidate) return;
    const previewingThisCandidate = state.preview?.kind === 'candidate' && state.preview.candidate?.candidateId === candidate.candidateId;
    const language = state.targetLanguage;
    let offsetMs = 0;
    if (previewingThisCandidate) offsetMs = state.previewOffsetMs;
    try {
      const replacing = (state.status?.tracks || []).some((track) => track.language === language);
      if (replacing && state.showDialog) {
        const decision = await state.showDialog({ eyebrow: 'Legendas', title: `Substituir legenda ${language}`, message: 'A legenda atual será preservada no histórico antes da substituição.', confirmLabel: 'Aplicar e preservar anterior' });
        if (!decision.confirmed) return;
      }
      await state.api(`${state.endpointBase}/subtitle-apply`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, provider: state.provider, candidateId: candidate.candidateId, language, offsetMs })
      });
      toast(`Legenda ${language} aplicada com sucesso.`);
      state.activeLocalTrackId = language;
      state.preview = null; state.previewOffsetMs = 0;
      await refreshStatus();
      render();
      await previewLocal(language);
      await notifyContentChanged({ action: 'apply', language, provider: state.provider });
    } catch (error) { toast(error.message, true); }
  }

  async function saveOffset() {
    if (!state.preview || state.preview.kind !== 'local' || !state.activeLocalTrackId || !state.previewOffsetMs) return;
    try {
      const trackId = state.activeLocalTrackId;
      const delta = state.previewOffsetMs;
      await state.api(`${state.endpointBase}/subtitle-offset`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, trackId, language: trackId, offsetMs: delta, expectedFingerprint: state.preview.fingerprint || null })
      });
      toast(`Sincronização ${formatOffset(delta)} salva.`);
      state.preview = null; state.previewOffsetMs = 0;
      await refreshStatus(); render(); await previewLocal(trackId);
      await notifyContentChanged({ action: 'offset', trackId });
    } catch (error) {
      toast(error.message, true);
      if (error.code === 'SUBTITLE_CHANGED_EXTERNALLY') {
        state.preview = null; state.previewOffsetMs = 0;
        await refreshStatus().catch(() => {}); render();
      }
    }
  }

  async function restoreHistory(historyId, trackId) {
    let confirmed = true;
    if (state.showDialog) {
      const decision = await state.showDialog({ eyebrow: 'Legendas', title: 'Restaurar versão anterior', message: `Restaurar esta versão da faixa ${trackId}? A versão atual será preservada no histórico.`, confirmLabel: 'Restaurar' });
      confirmed = decision.confirmed;
    }
    if (!confirmed) return;
    try {
      const expectedFingerprint = state.preview?.kind === 'local' && state.activeLocalTrackId === trackId ? state.preview.fingerprint || null : null;
      await state.api(`${state.endpointBase}/subtitle-restore`, { method: 'POST', body: JSON.stringify({ itemId: state.item.id, trackId, language: trackId, historyId, expectedFingerprint }) });
      toast('Versão anterior restaurada.');
      state.activeLocalTrackId = trackId; state.preview = null; state.previewOffsetMs = 0;
      await refreshStatus(); render(); await previewLocal(trackId);
      await notifyContentChanged({ action: 'restore', trackId });
    } catch (error) { toast(error.message, true); }
  }

  async function deleteLocalSubtitle(trackId) {
    let confirmed = true;
    if (state.showDialog) {
      const decision = await state.showDialog({
        eyebrow: 'Legendas',
        title: 'Excluir legenda',
        message: `O arquivo ${trackId} será removido. Uma cópia será preservada no histórico para restauração, quando disponível.`,
        confirmLabel: 'Excluir legenda',
        danger: true
      });
      confirmed = decision.confirmed;
    }
    if (!confirmed) return;
    try {
      const expectedFingerprint = state.preview?.kind === 'local' && state.activeLocalTrackId === trackId ? state.preview.fingerprint || null : null;
      const response = await state.api(`${state.endpointBase}/subtitle-delete`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, trackId, language: trackId, expectedFingerprint })
      });
      stopPlayer(); clearTextTrack(); state.preview = null; state.previewOffsetMs = 0;
      state.activeLocalTrackId = response.result?.historyCount ? trackId : '';
      await refreshStatus(); render();
      toast(response.result?.recoverable ? 'Legenda excluída. A versão removida ficou disponível no histórico.' : 'Legenda excluída.');
      await notifyContentChanged({ action: 'delete', trackId });
    } catch (error) { toast(error.message, true); }
  }

  async function createCompatiblePreview() {
    const button = $('#subtitleManagerCompatiblePreview');
    if (button) { button.disabled = true; button.textContent = 'Criando prévia...'; }
    try {
      const response = await state.api(`${state.endpointBase}/content-preview-create`, { method: 'POST', body: JSON.stringify({ itemId: state.item.id }) });
      state.previewToken = response.result?.token || '';
      loadPlayerSource();
      if (button) button.classList.add('hidden');
      toast('Prévia compatível criada.');
    } catch (error) { toast(error.message, true); if (button) { button.disabled = false; button.textContent = 'Criar prévia compatível'; } }
  }

  function configure(options = {}) {
    state.api = options.api;
    state.showToast = options.showToast;
    state.showDialog = options.showDialog;
    state.escapeHtml = options.escapeHtml;
    state.onContentChanged = typeof options.onContentChanged === 'function' ? options.onContentChanged : null;
  }

  document.addEventListener('click', (event) => {
    const openManager = event.target.closest('[data-subtitle-manager-open]');
    if (openManager) { open({ mode: 'manager' }); return; }
    const openPlayer = event.target.closest('[data-subtitle-player-open]');
    if (openPlayer) { open({ mode: 'player' }); return; }
    if (event.target.closest('[data-subtitle-manager-close]')) { close(); return; }
    const local = event.target.closest('[data-subtitle-local-preview]');
    if (local) { previewLocal(local.dataset.subtitleLocalPreview); return; }
    const localDelete = event.target.closest('[data-subtitle-local-delete]');
    if (localDelete) { deleteLocalSubtitle(localDelete.dataset.subtitleLocalDelete); return; }
    const resultPreview = event.target.closest('[data-subtitle-result-preview]');
    if (resultPreview) { previewCandidate(Number(resultPreview.dataset.subtitleResultPreview)); return; }
    const resultApply = event.target.closest('[data-subtitle-result-apply]');
    if (resultApply) { applyCandidate(Number(resultApply.dataset.subtitleResultApply)); return; }
    const offset = event.target.closest('[data-subtitle-offset]');
    if (offset) { setPreviewOffset(state.previewOffsetMs + Number(offset.dataset.subtitleOffset || 0)); return; }
    if (event.target.closest('[data-subtitle-offset-reset]')) { setPreviewOffset(0); return; }
    if (event.target.closest('[data-subtitle-reset-query]')) {
      state.queryDraft = { ...state.defaults };
      const artist = $('#subtitleManagerArtist'); const track = $('#subtitleManagerTrack'); const album = $('#subtitleManagerAlbum');
      if (artist) artist.value = state.queryDraft.artist || ''; if (track) track.value = state.queryDraft.track || ''; if (album) album.value = state.queryDraft.album || '';
      return;
    }
    const restore = event.target.closest('[data-subtitle-history-restore]');
    if (restore) { restoreHistory(restore.dataset.subtitleHistoryRestore, restore.dataset.trackId); return; }
    if (event.target.closest('#subtitleManagerSearchBtn')) { searchProvider(); return; }
    if (event.target.closest('#subtitleManagerSaveOffset')) { saveOffset(); return; }
    if (event.target.closest('#subtitleManagerCompatiblePreview')) { createCompatiblePreview(); }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'subtitleManagerProvider') {
      state.provider = event.target.value;
      state.searchResults = [];
      const root = panel(); if (root) render();
    } else if (event.target.id === 'subtitleManagerApplyLanguage') {
      state.targetLanguage = canonicalTargetLanguage(event.target.value) || 'pt-BR';
      if (state.provider === 'youtube') {
        state.searchResults = [];
        const results = $('#subtitleManagerResults');
        if (results) results.innerHTML = resultRows();
      }
    } else if (event.target.id === 'subtitleManagerOffsetInput') {
      setPreviewOffset(Number(event.target.value) * 1000);
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'subtitleManagerArtist') state.queryDraft.artist = event.target.value;
    else if (event.target.id === 'subtitleManagerTrack') state.queryDraft.track = event.target.value;
    else if (event.target.id === 'subtitleManagerAlbum') state.queryDraft.album = event.target.value;
  });

  document.addEventListener('keydown', (event) => {
    if (!state.opened || !state.preview || state.preview.kind !== 'local') return;
    if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      const amount = event.shiftKey ? 1000 : 250;
      setPreviewOffset(state.previewOffsetMs + (event.key === '[' ? -amount : amount));
      return;
    }
    if (event.code === 'Space') {
      const video = $('#subtitleManagerVideo');
      if (!video) return;
      event.preventDefault();
      if (video.paused) video.play().catch(() => {}); else video.pause();
    }
  });

  global.SubtitleManagerUI = { configure, setContext, open, close, getActiveTrack };
})(window);
