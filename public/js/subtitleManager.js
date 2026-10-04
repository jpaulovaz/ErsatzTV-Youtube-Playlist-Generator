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
    activeLocalLanguage: '',
    provider: 'youtube',
    searchResults: [],
    defaults: { artist: '', track: '', album: '' },
    queryDraft: { artist: '', track: '', album: '' },
    previewToken: ''
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function esc(value) {
    return state.escapeHtml ? state.escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, '');
  }

  function toast(message, error = false) {
    if (state.showToast) state.showToast(message, error);
  }

  function formatOffset(ms) {
    const value = Number(ms) || 0;
    const seconds = value / 1000;
    return `${seconds > 0 ? '+' : ''}${seconds.toFixed(3)} s`;
  }

  function panel() { return $('#subtitleManagerPanel'); }

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
    if (label) label.textContent = `${state.preview.sourceLabel || 'Prévia'} · ${state.preview.language || 'und'}`;
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
    if (!tracks.length) return '<div class="subtitle-manager-empty">Sem legenda local.</div>';
    return tracks.map((track) => `
      <div class="subtitle-manager-track ${state.activeLocalLanguage === track.language ? 'is-active' : ''}">
        <div><strong>${esc(track.language)}</strong><small>${esc(track.sourceLabel || 'Arquivo local')}</small></div>
        <div class="inline-actions">
          <button type="button" class="small" data-subtitle-local-preview="${esc(track.language)}">Testar no player</button>
        </div>
      </div>`).join('');
  }

  function historyRows() {
    const language = state.activeLocalLanguage;
    const entries = language && state.status?.history ? state.status.history[language] || [] : [];
    if (!language) return '<div class="subtitle-manager-empty">Selecione uma legenda local para visualizar o histórico.</div>';
    if (!entries.length) return '<div class="subtitle-manager-empty">Nenhuma versão anterior registrada para esta faixa.</div>';
    return entries.map((entry) => `
      <div class="subtitle-manager-history-row">
        <div><strong>${esc(entry.sourceLabel || 'Versão anterior')}</strong><small>${esc(entry.createdAt ? new Date(entry.createdAt).toLocaleString('pt-BR') : '')} · offset ${esc(formatOffset(entry.lastAppliedOffsetMs || 0))}</small></div>
        <button type="button" class="small" data-subtitle-history-restore="${esc(entry.id)}" data-language="${esc(language)}" ${entry.valid === false ? 'disabled title="Arquivo histórico ausente"' : ''}>Restaurar</button>
      </div>`).join('');
  }

  function providerControls() {
    const providers = state.status?.providers || {};
    const youtubeDisabled = !providers.youtube?.available;
    const lrclibAvailable = Boolean(providers.lrclib?.available);
    if (state.provider === 'lrclib' && !lrclibAvailable) state.provider = 'youtube';
    if (state.provider === 'youtube' && youtubeDisabled && lrclibAvailable) state.provider = 'lrclib';
    const isLrclib = state.provider === 'lrclib';
    return `
      <div class="subtitle-manager-search-head">
        <label>Fonte
          <select id="subtitleManagerProvider">
            <option value="youtube" ${state.provider === 'youtube' ? 'selected' : ''} ${youtubeDisabled ? 'disabled' : ''}>YouTube</option>
            ${lrclibAvailable ? `<option value="lrclib" ${state.provider === 'lrclib' ? 'selected' : ''}>LRCLIB</option>` : ''}
          </select>
        </label>
        <label>Idioma de destino
          <input id="subtitleManagerApplyLanguage" type="text" maxlength="40" value="${esc(state.preview?.language || state.activeLocalLanguage || 'und')}">
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
      return `
        <div class="subtitle-manager-result">
          <div class="subtitle-manager-result-copy">
            <strong>${esc(item.label || item.trackName || item.language || `Resultado ${index + 1}`)}</strong>
            <small>${esc(metadata)}</small>${warning}
          </div>
          <div class="inline-actions">
            <button type="button" class="small" data-subtitle-result-preview="${index}" ${item.canPreview === false || !state.status?.mediaAvailable ? 'disabled' : ''}>Testar no player</button>
            <button type="button" class="small primary" data-subtitle-result-apply="${index}" ${item.canApply === false || !state.status?.canApply ? 'disabled' : ''}>Aplicar</button>
          </div>
        </div>`;
    }).join('');
  }

  function render() {
    const root = panel();
    if (!root || !state.status) return;
    const tracks = state.status.tracks || [];
    const current = tracks.length ? tracks.map((track) => `${track.language}: ${track.sourceLabel}`).join(' · ') : 'Sem legenda';
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

      <section class="subtitle-manager-section subtitle-manager-search">
        <h4>Pesquisar outra legenda</h4>
        ${providerControls()}
        <div id="subtitleManagerResults" class="subtitle-manager-results">${resultRows()}</div>
      </section>

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
    if (state.activeLocalLanguage && !(state.status.tracks || []).some((track) => track.language === state.activeLocalLanguage)) state.activeLocalLanguage = '';
  }

  async function open(options = {}) {
    if (!state.item || !state.endpointBase || !state.api) return;
    state.playerOnly = options.mode === 'player';
    try {
      await refreshStatus();
      render();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function close() {
    clearTextTrack();
    state.preview = null;
    state.previewOffsetMs = 0;
    state.previewToken = '';
    state.textTrack = null;
    state.opened = false;
    panel()?.classList.add('hidden');
  }

  function setContext({ item, endpointBase }) {
    if (!item || !endpointBase) { close(); state.item = null; state.endpointBase = ''; state.queryDraft = { artist: '', track: '', album: '' }; return; }
    if (state.item?.id !== item.id || state.endpointBase !== endpointBase) {
      close();
      state.queryDraft = { artist: '', track: '', album: '' };
      state.searchResults = [];
    }
    state.item = item;
    state.endpointBase = endpointBase;
  }

  async function previewLocal(language) {
    const response = await state.api(`${state.endpointBase}/subtitle-preview-local`, {
      method: 'POST', body: JSON.stringify({ itemId: state.item.id, language })
    });
    state.preview = { ...(response.result || {}), kind: 'local' };
    state.previewOffsetMs = 0;
    state.activeLocalLanguage = language;
    const applyLanguage = $('#subtitleManagerApplyLanguage'); if (applyLanguage) applyLanguage.value = language;
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
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, provider: state.provider, query })
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
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, provider: state.provider, candidateId: candidate.candidateId, language: candidate.language })
      });
      state.preview = { ...(response.result || {}), kind: 'candidate', candidate, provider: state.provider };
      state.previewOffsetMs = 0;
      const applyLanguage = $('#subtitleManagerApplyLanguage'); if (applyLanguage) applyLanguage.value = state.preview.language || candidate.language || 'und';
      renderPreviewCues();
      $('#subtitleManagerVideo')?.play().catch(() => {});
    } catch (error) { toast(error.message, true); }
  }

  async function applyCandidate(index) {
    const candidate = state.searchResults[index];
    if (!candidate) return;
    const previewingThisCandidate = state.preview?.kind === 'candidate' && state.preview.candidate?.candidateId === candidate.candidateId;
    const language = (previewingThisCandidate
      ? ($('#subtitleManagerApplyLanguage')?.value || candidate.language || 'und')
      : (candidate.language || 'und')).trim();
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
      state.activeLocalLanguage = language;
      state.preview = null; state.previewOffsetMs = 0;
      await refreshStatus();
      render();
      await previewLocal(language);
    } catch (error) { toast(error.message, true); }
  }

  async function saveOffset() {
    if (!state.preview || state.preview.kind !== 'local' || !state.activeLocalLanguage || !state.previewOffsetMs) return;
    try {
      const language = state.activeLocalLanguage;
      const delta = state.previewOffsetMs;
      await state.api(`${state.endpointBase}/subtitle-offset`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, language, offsetMs: delta })
      });
      toast(`Sincronização ${formatOffset(delta)} salva em ${language}.`);
      state.preview = null; state.previewOffsetMs = 0;
      await refreshStatus(); render(); await previewLocal(language);
    } catch (error) { toast(error.message, true); }
  }

  async function restoreHistory(historyId, language) {
    let confirmed = true;
    if (state.showDialog) {
      const decision = await state.showDialog({ eyebrow: 'Legendas', title: 'Restaurar versão anterior', message: `Restaurar esta versão da legenda ${language}? A versão atual será preservada no histórico.`, confirmLabel: 'Restaurar' });
      confirmed = decision.confirmed;
    }
    if (!confirmed) return;
    try {
      await state.api(`${state.endpointBase}/subtitle-restore`, { method: 'POST', body: JSON.stringify({ itemId: state.item.id, language, historyId }) });
      toast(`Versão anterior de ${language} restaurada.`);
      state.activeLocalLanguage = language; state.preview = null; state.previewOffsetMs = 0;
      await refreshStatus(); render(); await previewLocal(language);
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
  }

  document.addEventListener('click', (event) => {
    const openManager = event.target.closest('[data-subtitle-manager-open]');
    if (openManager) { open({ mode: 'manager' }); return; }
    const openPlayer = event.target.closest('[data-subtitle-player-open]');
    if (openPlayer) { open({ mode: 'player' }); return; }
    if (event.target.closest('[data-subtitle-manager-close]')) { close(); return; }
    const local = event.target.closest('[data-subtitle-local-preview]');
    if (local) { previewLocal(local.dataset.subtitleLocalPreview); return; }
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
    if (restore) { restoreHistory(restore.dataset.subtitleHistoryRestore, restore.dataset.language); return; }
    if (event.target.closest('#subtitleManagerSearchBtn')) { searchProvider(); return; }
    if (event.target.closest('#subtitleManagerSaveOffset')) { saveOffset(); return; }
    if (event.target.closest('#subtitleManagerCompatiblePreview')) { createCompatiblePreview(); }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'subtitleManagerProvider') {
      state.provider = event.target.value;
      state.searchResults = [];
      const root = panel(); if (root) render();
    } else if (event.target.id === 'subtitleManagerOffsetInput') {
      setPreviewOffset(Number(event.target.value) * 1000);
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'subtitleManagerArtist') state.queryDraft.artist = event.target.value;
    else if (event.target.id === 'subtitleManagerTrack') state.queryDraft.track = event.target.value;
    else if (event.target.id === 'subtitleManagerAlbum') state.queryDraft.album = event.target.value;
  });

  global.SubtitleManagerUI = { configure, setContext, open, close };
})(window);
