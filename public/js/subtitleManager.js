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
    contextOnContentChanged: null,
    audioStreamIndex: null,
    compatibilityKey: '',
    visualizationTokens: {},
    advancedStatus: null,
    cueDraft: [],
    cueDirty: false,
    cuePage: 0,
    selectedCueIndex: 0,
    timingPreview: null,
    syncPoints: { a: { subtitleMs: null, mediaMs: null }, b: { subtitleMs: null, mediaMs: null } },
    fpsSource: 25,
    toolAction: null,
    activeJob: null,
    jobTimer: null,
    playerTime: 0
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
    for (const cue of visiblePreviewCues()) {
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

  function isWorkspaceMode() {
    return state.status?.mediaProfile === 'external_workspace';
  }

  function getMediaProbe() {
    return state.status?.mediaProbe || {};
  }

  function availableAudioStreams() {
    return Array.isArray(getMediaProbe().audioStreams) ? getMediaProbe().audioStreams : [];
  }

  function audioLanguageLabel(value) {
    const key = String(value || 'und').toLowerCase().replace(/_/g, '-');
    if (key === 'por' || key === 'pt' || key === 'pt-br') return 'Português';
    if (key === 'eng' || key === 'en' || key.startsWith('en-')) return 'English';
    if (key === 'spa' || key === 'es' || key.startsWith('es-')) return 'Español';
    if (key === 'fra' || key === 'fr') return 'Français';
    if (key === 'deu' || key === 'de') return 'Deutsch';
    if (key === 'ita' || key === 'it') return 'Italiano';
    return value && value !== 'und' ? value : 'Idioma não informado';
  }

  function audioStreamLabel(stream) {
    const parts = [audioLanguageLabel(stream.language)];
    if (stream.title) parts.push(stream.title);
    if (stream.codec) parts.push(String(stream.codec).toUpperCase());
    if (stream.channels) parts.push(`${stream.channels} canais`);
    if (stream.default) parts.push('padrão');
    return parts.join(' · ');
  }

  function ensureAudioSelection() {
    const streams = availableAudioStreams();
    if (!streams.length) { state.audioStreamIndex = null; return; }
    if (streams.some((entry) => Number(entry.streamIndex) === Number(state.audioStreamIndex))) return;
    const preferred = streams.find((entry) => entry.default) || streams[0];
    state.audioStreamIndex = Number(preferred.streamIndex);
  }

  function previewAssetUrl(token) {
    if (!state.item || !state.endpointBase || !token) return '';
    const params = new URLSearchParams({ id: state.item.id, previewToken: token });
    return `${state.endpointBase}/content-media?${params.toString()}`;
  }

  function formatTimestamp(ms, { srt = false } = {}) {
    const value = Math.max(0, Math.round(Number(ms) || 0));
    const hours = Math.floor(value / 3600000);
    const minutes = Math.floor((value % 3600000) / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const millis = value % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${srt ? ',' : '.'}${String(millis).padStart(3, '0')}`;
  }

  function parseTimestamp(value) {
    const raw = String(value || '').trim().replace(',', '.');
    if (!raw) return null;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
    const parts = raw.split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;
    if (![hours, minutes, seconds].every(Number.isFinite) || hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
    return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
  }

  function cloneCues(cues) {
    return (Array.isArray(cues) ? cues : []).map((cue) => ({ startMs: Number(cue.startMs) || 0, endMs: Number(cue.endMs) || 0, text: String(cue.text || '') }));
  }

  function visiblePreviewCues() {
    if (state.timingPreview?.cues) return state.timingPreview.cues;
    if (state.preview?.kind === 'local' && state.cueDraft.length) return state.cueDraft;
    return state.preview?.cues || [];
  }

  function activeTrackDescriptor() {
    const id = state.activeLocalTrackId || state.preview?.trackId || '';
    return (state.status?.tracks || []).find((track) => (track.trackId || track.language) === id) || null;
  }

  function isTextSubtitle(track) {
    return ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'mov_text', 'text'].includes(String(track?.format || '').toLowerCase());
  }

  function isPgsSubtitle(track) {
    return ['pgs', 'sup', 'hdmv_pgs_subtitle'].includes(String(track?.format || '').toLowerCase());
  }

  function playerCompatibilityHtml() {
    if (!state.status?.mediaAvailable) return '';
    if (!isWorkspaceMode()) return '<button id="subtitleManagerCompatiblePreview" type="button" class="small hidden">Criar prévia compatível</button>';
    const probe = getMediaProbe();
    const playback = probe.playback || {};
    const streams = availableAudioStreams();
    const audioSelect = streams.length ? `
      <label class="subtitle-manager-audio-select">Áudio
        <select id="subtitleManagerAudioStream">
          ${streams.map((stream) => `<option value="${esc(stream.streamIndex)}" ${Number(stream.streamIndex) === Number(state.audioStreamIndex) ? 'selected' : ''}>${esc(audioStreamLabel(stream))}</option>`).join('')}
        </select>
      </label>` : '<span class="subtitle-manager-player-note">Nenhuma faixa de áudio foi detectada.</span>';
    let message = 'O arquivo será reproduzido diretamente pelo navegador.';
    let tone = 'ok';
    let buttonLabel = 'Criar prévia compatível';
    if (state.previewToken) {
      message = 'Prévia compatível ativa. O vídeo original permanece intocado.';
      tone = 'ok';
      buttonLabel = 'Recriar prévia compatível';
    } else if (playback.mode === 'audio-transcode') {
      message = 'Este arquivo pode ficar sem som no navegador. O app prepara automaticamente uma prévia com áudio AAC, sem alterar o original.';
      tone = 'warn';
      buttonLabel = 'Preparar áudio compatível agora';
    } else if (playback.mode === 'full-transcode') {
      message = 'Este vídeo usa container ou codec que pode não funcionar no navegador. Uma prévia H.264 + AAC resolve a reprodução sem alterar o original.';
      tone = 'warn';
      buttonLabel = 'Criar prévia H.264 + AAC';
    }
    return `<div class="subtitle-manager-playback-tools">
      <div class="subtitle-manager-playback-copy ${tone}"><strong>Compatibilidade de reprodução</strong><span>${esc(message)}</span></div>
      ${audioSelect}
      <button id="subtitleManagerCompatiblePreview" type="button" class="small">${esc(buttonLabel)}</button>
    </div>`;
  }

  function visualizationHtml() {
    if (!isWorkspaceMode() || !state.status?.mediaAvailable || !availableAudioStreams().length) return '';
    const keySuffix = state.audioStreamIndex == null ? 'default' : String(state.audioStreamIndex);
    const waveform = state.visualizationTokens[`waveform:${keySuffix}`] || '';
    const spectrogram = state.visualizationTokens[`spectrogram:${keySuffix}`] || '';
    const image = (kind, token, label, help) => token
      ? `<div class="subtitle-manager-visual-card"><div><strong>${label}</strong><small>${help} · clique na imagem para ir até aquele ponto do vídeo.</small></div><img src="${esc(previewAssetUrl(token))}" alt="${esc(label)}" data-subtitle-visualization-seek="${kind}"></div>`
      : '';
    return `<section class="subtitle-manager-section subtitle-manager-audio-tools">
      <div class="subtitle-manager-section-head"><div><h4>Mapa do áudio</h4><p>Use a forma de onda para localizar início de falas e o espectrograma quando precisar distinguir voz, música e ruído.</p></div><div class="inline-actions"><button type="button" class="small" data-subtitle-visualization="waveform">${waveform ? 'Atualizar waveform' : 'Carregar waveform'}</button><button type="button" class="small" data-subtitle-visualization="spectrogram">${spectrogram ? 'Atualizar espectrograma' : 'Carregar espectrograma'}</button></div></div>
      <div id="subtitleManagerVisualizations" class="subtitle-manager-visualizations">${image('waveform', waveform, 'Waveform', 'Volume ao longo do tempo')}${image('spectrogram', spectrogram, 'Espectrograma', 'Frequências do áudio ao longo do tempo')}${!waveform && !spectrogram ? '<div class="subtitle-manager-empty">As visualizações são geradas sob demanda para não processar todos os vídeos sem necessidade.</div>' : ''}</div>
    </section>`;
  }

  function cueEditorHtml() {
    if (!state.preview || state.preview.kind !== 'local' || !state.cueDraft.length) return '';
    const pageSize = 30;
    const pageCount = Math.max(1, Math.ceil(state.cueDraft.length / pageSize));
    state.cuePage = Math.max(0, Math.min(pageCount - 1, state.cuePage));
    const start = state.cuePage * pageSize;
    const slice = state.cueDraft.slice(start, start + pageSize);
    const rows = slice.map((cue, offset) => {
      const index = start + offset;
      const selected = index === state.selectedCueIndex;
      return `<div class="subtitle-cue-row ${selected ? 'selected' : ''}" data-cue-row="${index}">
        <button type="button" class="subtitle-cue-number" data-subtitle-cue-seek="${index}" title="Ir para este cue">#${index + 1}</button>
        <label>Início<input type="text" value="${esc(formatTimestamp(cue.startMs))}" data-subtitle-cue-time="startMs" data-cue-index="${index}" inputmode="decimal"></label>
        <label>Fim<input type="text" value="${esc(formatTimestamp(cue.endMs))}" data-subtitle-cue-time="endMs" data-cue-index="${index}" inputmode="decimal"></label>
        <label class="subtitle-cue-text">Texto<textarea rows="2" data-subtitle-cue-text data-cue-index="${index}">${esc(cue.text)}</textarea></label>
      </div>`;
    }).join('');
    return `<section class="subtitle-manager-section subtitle-cue-editor">
      <div class="subtitle-manager-section-head"><div><h4>Editor cue por cue</h4><p>Edite o texto e os tempos individualmente. Clique no número do cue para conferir o trecho no player.</p></div><div class="inline-actions"><span class="badge">${state.cueDraft.length} cues</span><button id="subtitleManagerSaveCues" type="button" class="small primary" ${state.cueDirty ? '' : 'disabled'}>Salvar alterações</button></div></div>
      ${state.timingPreview ? '<div class="subtitle-manager-inline-warning">Há uma prévia de sincronização avançada ativa. Descarte ou aplique essa prévia antes de editar os cues.</div>' : ''}
      <div class="subtitle-cue-list">${rows}</div>
      <div class="subtitle-cue-pagination"><button type="button" class="small" data-subtitle-cue-page="${state.cuePage - 1}" ${state.cuePage <= 0 ? 'disabled' : ''}>← Cues anteriores</button><span>Página ${state.cuePage + 1} de ${pageCount}</span><button type="button" class="small" data-subtitle-cue-page="${state.cuePage + 1}" ${state.cuePage >= pageCount - 1 ? 'disabled' : ''}>Próximos cues →</button></div>
    </section>`;
  }

  function syncValue(value) {
    return value == null || !Number.isFinite(Number(value)) ? '' : formatTimestamp(Number(value));
  }

  function advancedSyncHtml() {
    if (!state.preview || state.preview.kind !== 'local') return '';
    const fpsTarget = Number(getMediaProbe().frameRate) || '';
    const p = state.syncPoints;
    const preview = state.timingPreview;
    return `<section class="subtitle-manager-section subtitle-advanced-sync">
      <div class="subtitle-manager-section-head"><div><h4>Sincronização avançada</h4><p>Use dois pontos quando a legenda vai se afastando aos poucos. Use FPS quando você conhece o frame rate da versão que originou a legenda.</p></div></div>
      ${preview ? `<div class="subtitle-sync-preview"><strong>Prévia ativa</strong><span>${preview.mode === 'fps' ? `Escala ${Number(preview.scale || 1).toFixed(6)} · ${preview.sourceFps} → ${preview.targetFps} fps` : `Escala ${Number(preview.scale || 1).toFixed(6)} · correção proporcional entre os dois pontos`}</span><div class="inline-actions"><button type="button" class="small" data-subtitle-timing-discard>Descartar prévia</button><button type="button" class="small primary" data-subtitle-timing-apply>Aplicar e salvar</button></div></div>` : ''}
      <details class="subtitle-tool-details" open>
        <summary>Sincronização por dois pontos</summary>
        <p>Marque uma fala perto do começo e outra mais adiante. Informe onde o cue está na legenda e onde ele deveria aparecer no vídeo.</p>
        <div class="subtitle-sync-points">
          ${['a','b'].map((key, index) => `<div class="subtitle-sync-point"><strong>Ponto ${index ? 'B' : 'A'}</strong><label>Tempo na legenda<input type="text" data-sync-field="subtitleMs" data-sync-point="${key}" value="${esc(syncValue(p[key].subtitleMs))}" placeholder="00:05:12.200"></label><label>Tempo correto no vídeo<input type="text" data-sync-field="mediaMs" data-sync-point="${key}" value="${esc(syncValue(p[key].mediaMs))}" placeholder="00:05:14.200"></label><div class="inline-actions"><button type="button" class="small" data-sync-capture-cue="${key}">Usar cue selecionado</button><button type="button" class="small" data-sync-capture-media="${key}">Usar tempo atual do vídeo</button></div></div>`).join('')}
        </div>
        <button type="button" class="small" data-subtitle-timing-preview="two-point">Testar correção sem salvar</button>
      </details>
      <details class="subtitle-tool-details">
        <summary>Correção de FPS</summary>
        <p>Útil quando a legenda começa certa e se afasta continuamente por ter sido criada para outro frame rate.</p>
        <div class="subtitle-fps-grid"><label>FPS da legenda<input id="subtitleManagerSourceFps" type="number" min="1" max="120" step="0.001" value="${esc(state.fpsSource || 25)}"></label><label>FPS do vídeo<input id="subtitleManagerTargetFps" type="number" min="1" max="120" step="0.001" value="${esc(fpsTarget || '')}" placeholder="Ex.: 23.976"></label></div>
        <button type="button" class="small" data-subtitle-timing-preview="fps">Testar correção sem salvar</button>
      </details>
    </section>`;
  }

  function toolActionHtml() {
    const action = state.toolAction;
    if (!action && !state.activeJob) return '<div class="subtitle-manager-empty">Escolha uma ação em uma das faixas acima. Operações que criam arquivos nunca alteram o vídeo original sem avisar.</div>';
    if (state.activeJob) {
      const job = state.activeJob;
      const progress = job.progress || {};
      const finished = ['completed', 'failed'].includes(job.status);
      const statusLabel = ({ queued: 'Na fila', running: 'Processando', completed: 'Concluído', failed: 'Falhou' })[job.status] || job.status;
      let resultHtml = '';
      if (job.status === 'completed' && job.result) {
        if (job.kind === 'translate') {
          const outputs = Array.isArray(job.result.outputs) ? job.result.outputs : [];
          resultHtml = outputs.length ? `<div class="subtitle-tool-result"><strong>Arquivos</strong>${outputs.map((output) => `<span>${esc(output.fileName || output.language || output.kind)}${output.skipped ? ' · já existia, mantido' : ' · criado'}</span>`).join('')}</div>` : '';
        } else if (job.kind === 'ocr-pgs') {
          resultHtml = `<div class="subtitle-tool-result"><strong>${esc(job.result.fileName || 'SRT criado')}</strong><span>${esc(job.result.cues || 0)} cues reconhecidos · idioma OCR ${esc(job.result.ocrLanguage || '?')}</span></div>`;
        } else if (job.kind === 'remux') {
          resultHtml = `<div class="subtitle-tool-result"><strong>${esc(job.result.fileName || 'Cópia MKV criada')}</strong><span>Original preservado · ${esc(job.result.validation?.streamCount || '?')} streams validados</span></div>`;
        }
      }
      return `<div class="subtitle-tool-action-card"><div class="subtitle-manager-section-head"><div><strong>${esc(job.kind === 'translate' ? 'Tradução' : job.kind === 'ocr-pgs' ? 'OCR PGS' : 'Remux')}</strong><p>${esc(progress.message || (job.status === 'queued' ? 'Na fila...' : 'Processando...'))}</p></div><span class="badge ${job.status === 'failed' ? 'warn' : (job.status === 'completed' ? 'ok' : '')}">${esc(statusLabel)}</span></div><progress max="100" value="${esc(progress.percent || 0)}"></progress>${resultHtml}${job.error ? `<div class="subtitle-manager-inline-warning">${esc(job.error)}</div>` : ''}${finished ? '<button type="button" class="small" data-subtitle-tool-close>Fechar</button>' : ''}</div>`;
    }
    const trackName = action.trackId || 'faixa';
    const languageValue = action.language && action.language !== 'und' ? action.language : '';
    const commonLanguage = `<label>Idioma da legenda<input id="subtitleToolLanguage" type="text" value="${esc(languageValue)}" placeholder="Ex.: en, pt-BR, es"><small>Se o arquivo não informa o idioma, escolha manualmente.</small></label>`;
    const replace = `<label class="check-row"><input id="subtitleToolReplace" type="checkbox"> Substituir arquivo de destino se ele já existir (a versão anterior vai para o histórico quando for SRT)</label>`;
    let content = '';
    if (action.kind === 'translate') {
      const translation = state.advancedStatus?.translation || {};
      content = `<h5>Traduzir ${esc(trackName)}</h5><p>A mesma engine Gemini das Bibliotecas será usada aqui. O SRT de origem é preservado.</p>${translation.configured ? '' : '<div class="subtitle-manager-inline-warning">A tradução Gemini ainda não está configurada. Configure a API em Configurações → Tradução de legendas.</div>'}<div class="subtitle-tool-form-grid"><label>Idioma de origem<input id="subtitleToolSourceLanguage" type="text" value="${esc(languageValue)}" placeholder="Ex.: en"></label><label>Idioma de destino<select id="subtitleToolTargetLanguage">${TARGET_LANGUAGES.map((entry) => `<option value="${entry.value}" ${entry.value === (translation.defaultTargetLanguage || 'pt-BR') ? 'selected' : ''}>${entry.label}</option>`).join('')}</select></label><label>Arquivos de saída<select id="subtitleToolOutputMode"><option value="translated" ${translation.defaultOutputMode === 'translated' ? 'selected' : ''}>Somente traduzida</option><option value="bilingual" ${translation.defaultOutputMode === 'bilingual' ? 'selected' : ''}>Somente bilíngue</option><option value="both" ${translation.defaultOutputMode === 'both' ? 'selected' : ''}>Traduzida + bilíngue</option></select></label></div>${replace}<div class="inline-actions"><button type="button" class="small" data-subtitle-tool-close>Cancelar</button><button type="button" class="small primary" data-subtitle-tool-submit ${translation.configured ? '' : 'disabled'}>Iniciar tradução</button></div>`;
    } else if (action.kind === 'ocr') {
      const tesseract = state.advancedStatus?.tesseract || {};
      content = `<h5>Converter PGS em texto (OCR)</h5><p>PGS é uma legenda formada por imagens. O Tesseract vai reconhecer cada quadro e criar um SRT editável; revise o resultado, pois OCR pode confundir caracteres.</p>${tesseract.available ? '' : '<div class="subtitle-manager-inline-warning">Tesseract não está disponível ou não possui idiomas instalados.</div>'}${commonLanguage}${replace}<div class="inline-actions"><button type="button" class="small" data-subtitle-tool-close>Cancelar</button><button type="button" class="small primary" data-subtitle-tool-submit ${tesseract.available ? '' : 'disabled'}>Iniciar OCR</button></div>`;
    } else if (action.kind === 'extract') {
      content = `<h5>${action.convertToSrt ? 'Extrair como SRT editável' : 'Extrair faixa embutida'}</h5><p>Será criado um arquivo de legenda ao lado do vídeo. O MKV/MP4 original não será modificado.</p>${commonLanguage}${replace}<div class="inline-actions"><button type="button" class="small" data-subtitle-tool-close>Cancelar</button><button type="button" class="small primary" data-subtitle-tool-submit>Extrair legenda</button></div>`;
    } else if (action.kind === 'convert') {
      content = `<h5>Criar cópia SRT</h5><p>O arquivo ${esc(String(action.format || '').toUpperCase())} original será preservado. Recursos de estilo, posição, karaokê ou efeitos que não existem em SRT podem ser simplificados.</p>${commonLanguage}${replace}<div class="inline-actions"><button type="button" class="small" data-subtitle-tool-close>Cancelar</button><button type="button" class="small primary" data-subtitle-tool-submit>Criar SRT editável</button></div>`;
    } else if (action.kind === 'remux-add') {
      content = `<h5>Adicionar legenda a uma cópia MKV</h5><p>O aplicativo criará um novo MKV com todos os streams originais e esta legenda externa. Vídeo e áudio serão copiados sem recodificação; o arquivo original ficará intacto.</p><div class="inline-actions"><button type="button" class="small" data-subtitle-tool-close>Cancelar</button><button type="button" class="small primary" data-subtitle-tool-submit>Criar cópia MKV</button></div>`;
    } else if (action.kind === 'remux-remove') {
      content = `<h5>Criar cópia sem esta faixa</h5><p>Será criado um novo MKV mantendo os demais streams, capítulos e metadados. O arquivo original não será substituído.</p><div class="inline-actions"><button type="button" class="small" data-subtitle-tool-close>Cancelar</button><button type="button" class="small primary" data-subtitle-tool-submit>Criar cópia MKV</button></div>`;
    }
    return `<div class="subtitle-tool-action-card">${content}</div>`;
  }

  function advancedToolsSectionHtml() {
    if (!isWorkspaceMode()) return '';
    return `<section class="subtitle-manager-section subtitle-workspace-advanced-tools"><div class="subtitle-manager-section-head"><div><h4>Ferramentas da faixa</h4><p>Extraia, converta, traduza, faça OCR ou crie uma nova cópia MKV sem sair do editor.</p></div></div><div id="subtitleManagerToolActionArea">${toolActionHtml()}</div></section>`;
  }

  function localTrackRows() {
    const tracks = state.status?.tracks || [];
    if (!tracks.length) return '<div class="subtitle-manager-empty">Nenhuma legenda local ou embutida foi detectada. Se o vídeo tiver uma faixa interna, confira se o FFprobe conseguiu analisá-la.</div>';
    return tracks.map((track) => {
      const trackId = track.trackId || track.language;
      const isPreviewing = state.preview?.kind === 'local' && (state.preview.trackId || state.preview.language) === trackId;
      const editable = track.editable !== false && !track.embedded;
      const textFormat = isTextSubtitle(track);
      const pgs = isPgsSubtitle(track);
      const streamIndex = Number(track.metadata?.streamIndex);
      const primary = [];
      const secondary = [];
      if (editable) {
        primary.push(`<button type="button" class="small subtitle-preview-button ${isPreviewing ? 'is-previewing' : ''}" aria-pressed="${isPreviewing ? 'true' : 'false'}" data-subtitle-local-preview="${esc(trackId)}">${isPreviewing ? 'Em teste no player' : 'Testar no player'}</button>`);
        if (isWorkspaceMode()) primary.push(`<button type="button" class="small" data-subtitle-tool-open="translate" data-track-id="${esc(trackId)}">Traduzir</button>`);
        if (isWorkspaceMode()) secondary.push(`<button type="button" class="small" data-subtitle-tool-open="remux-add" data-track-id="${esc(trackId)}">Adicionar a uma cópia MKV</button>`);
        secondary.push(`<button type="button" class="small danger" data-subtitle-local-delete="${esc(trackId)}" ${!state.status?.canApply ? 'disabled' : ''}>Excluir legenda</button>`);
      } else if (isWorkspaceMode()) {
        if (track.embedded && textFormat) {
          primary.push(`<button type="button" class="small primary" data-subtitle-tool-open="extract-srt" data-track-id="${esc(trackId)}">Extrair como SRT</button>`);
          const originalExt = String(track.format || '').toLowerCase();
          if (originalExt !== 'srt' && originalExt !== 'subrip' && originalExt !== 'mov_text' && originalExt !== 'text') {
            secondary.push(`<button type="button" class="small" data-subtitle-tool-open="extract-original" data-track-id="${esc(trackId)}">Extrair ${esc(String(track.format || '').toUpperCase())}</button>`);
          }
        } else if (!track.embedded && textFormat && String(track.format || '').toLowerCase() !== 'srt') {
          primary.push(`<button type="button" class="small primary" data-subtitle-tool-open="convert" data-track-id="${esc(trackId)}">Criar SRT editável</button>`);
        }
        if (pgs) {
          primary.push(`<button type="button" class="small primary" data-subtitle-tool-open="ocr" data-track-id="${esc(trackId)}">OCR para SRT</button>`);
          if (track.embedded) secondary.push(`<button type="button" class="small" data-subtitle-tool-open="extract-original" data-track-id="${esc(trackId)}">Extrair PGS</button>`);
        }
        if (track.embedded && Number.isInteger(streamIndex)) {
          secondary.push(`<button type="button" class="small" data-subtitle-tool-open="remux-remove" data-track-id="${esc(trackId)}">Criar cópia sem esta faixa</button>`);
        }
      }
      const readOnlyReason = track.embedded ? 'Embutida no vídeo' : (editable ? 'SRT editável' : 'Formato somente leitura');
      return `
      <div class="subtitle-manager-track ${isPreviewing ? 'is-previewing' : ''} ${editable ? '' : 'is-readonly'}">
        <div><strong>${esc(localTrackTitle(track))}</strong><small>${esc(localTrackSubtitle(track))} · ${esc(readOnlyReason)}</small></div>
        <div class="subtitle-track-actions">
          <div class="inline-actions">${primary.join('') || '<span class="badge">Somente leitura</span>'}</div>
          ${secondary.length ? `<details class="subtitle-track-more"><summary>Mais ações</summary><div class="inline-actions">${secondary.join('')}</div></details>` : ''}
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
    const existingVideo = $('#subtitleManagerVideo');
    if (existingVideo && Number.isFinite(existingVideo.currentTime)) state.playerTime = existingVideo.currentTime;
    ensureAudioSelection();
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
            <span id="subtitleManagerPreviewLabel">${state.preview ? esc(`${state.preview.sourceLabel || 'Prévia'} · ${state.preview.language || state.targetLanguage}`) : 'Nenhuma faixa em prévia'}</span>
            <span class="subtitle-manager-player-note">O player é apenas para conferência; o arquivo original não é alterado.</span>
          </div>
          ${playerCompatibilityHtml()}` : '<div class="subtitle-manager-empty">Arquivo de vídeo local indisponível para reprodução.</div>'}
      </div>

      ${visualizationHtml()}

      <div class="subtitle-manager-grid">
        <section class="subtitle-manager-section">
          <div class="subtitle-manager-section-head"><div><h4>Legendas encontradas</h4><p>Teste SRTs diretamente no player ou use as ferramentas de extração, conversão, OCR e remux.</p></div></div>
          <div id="subtitleManagerLocalTracks">${localTrackRows()}</div>
        </section>
        <section class="subtitle-manager-section">
          <div class="subtitle-manager-section-head"><div><h4>Sincronização rápida</h4><p>Para uma legenda correta que está apenas adiantada ou atrasada por um valor fixo.</p></div></div>
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

      ${advancedToolsSectionHtml()}
      ${advancedSyncHtml()}
      ${cueEditorHtml()}

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
        video.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(state.playerTime) && state.playerTime > 0 && state.playerTime < (video.duration || Infinity)) {
            try { video.currentTime = state.playerTime; } catch {}
          }
        }, { once: true });
        video.addEventListener('timeupdate', () => { if (Number.isFinite(video.currentTime)) state.playerTime = video.currentTime; });
        video.addEventListener('error', () => {
          const button = $('#subtitleManagerCompatiblePreview');
          if (button) { button.classList.remove('hidden'); button.classList.add('attention'); }
        });
      }
      maybeEnsureCompatiblePlayback().catch((error) => toast(error.message, true));
    }
    if (state.preview) renderPreviewCues();
    updateOffsetUi();
    if (state.playerOnly) root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function refreshStatus() {
    if (!state.item || !state.endpointBase) return;
    const response = await state.api(`${state.endpointBase}/subtitle-status?id=${encodeURIComponent(state.item.id)}`);
    state.status = response.result || {};
    ensureAudioSelection();
    state.defaults = { ...(state.status.queryDefaults || {}) };
    if (!state.queryDraft.track && !state.queryDraft.artist && !state.queryDraft.album) state.queryDraft = { ...state.defaults };
    if (state.activeLocalTrackId) {
      const stillLocal = (state.status.tracks || []).some((track) => (track.trackId || track.language) === state.activeLocalTrackId);
      const hasHistory = Boolean((state.status.history?.[state.activeLocalTrackId] || []).length);
      if (!stillLocal && !hasHistory) state.activeLocalTrackId = '';
    }
  }

  async function loadAdvancedStatus() {
    if (!isWorkspaceMode() || state.advancedStatus) return;
    try {
      const response = await state.api(`${state.endpointBase}/advanced-status`);
      state.advancedStatus = response.result || {};
    } catch (error) {
      state.advancedStatus = { error: error.message, tesseract: { available: false, languages: [] }, translation: { configured: false } };
    }
  }

  async function open(options = {}) {
    if (!state.item || !state.endpointBase || !state.api) return;
    state.playerOnly = options.mode === 'player';
    try {
      await refreshStatus();
      await loadAdvancedStatus();
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
    if (state.jobTimer) clearTimeout(state.jobTimer);
    state.jobTimer = null;
    state.preview = null;
    state.previewOffsetMs = 0;
    state.previewToken = '';
    state.textTrack = null;
    state.opened = false;
    state.audioStreamIndex = null;
    state.compatibilityKey = '';
    state.visualizationTokens = {};
    state.cueDraft = [];
    state.cueDirty = false;
    state.cuePage = 0;
    state.selectedCueIndex = 0;
    state.timingPreview = null;
    state.syncPoints = { a: { subtitleMs: null, mediaMs: null }, b: { subtitleMs: null, mediaMs: null } };
    state.toolAction = null;
    state.activeJob = null;
    state.playerTime = 0;
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
    state.cueDraft = cloneCues(response.result?.cues || []);
    state.cueDirty = false;
    state.cuePage = 0;
    state.selectedCueIndex = 0;
    state.timingPreview = null;
    state.syncPoints = { a: { subtitleMs: null, mediaMs: null }, b: { subtitleMs: null, mediaMs: null } };
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
      state.timingPreview = null;
      state.cueDraft = [];
      state.cueDirty = false;
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

  async function createCompatiblePreview(options = {}) {
    if (!isWorkspaceMode()) {
      const button = $('#subtitleManagerCompatiblePreview');
      if (button) { button.disabled = true; button.textContent = 'Criando prévia...'; }
      try {
        const response = await state.api(`${state.endpointBase}/content-preview-create`, { method: 'POST', body: JSON.stringify({ itemId: state.item.id }) });
        state.previewToken = response.result?.token || '';
        loadPlayerSource();
        toast('Prévia compatível criada.');
      } catch (error) { toast(error.message, true); }
      finally { if (button) button.disabled = false; }
      return;
    }
    const probe = getMediaProbe();
    const copyVideo = options.forceFull ? false : Boolean(probe.playback?.copyVideoPossible);
    const key = `${state.item?.id || ''}:${state.audioStreamIndex ?? 'default'}:${copyVideo ? 'copy' : 'full'}`;
    const button = $('#subtitleManagerCompatiblePreview');
    if (button) { button.disabled = true; button.textContent = copyVideo ? 'Preparando áudio compatível...' : 'Criando prévia H.264 + AAC...'; }
    try {
      const response = await state.api(`${state.endpointBase}/content-preview-create`, {
        method: 'POST',
        body: JSON.stringify({ itemId: state.item.id, audioStreamIndex: state.audioStreamIndex, copyVideo })
      });
      state.previewToken = response.result?.token || '';
      state.compatibilityKey = key;
      loadPlayerSource();
      if (!options.silent) toast(response.result?.metadata?.mode === 'full-transcode' || response.result?.mode === 'full-transcode' ? 'Prévia H.264 + AAC criada.' : 'Áudio compatível preparado.');
      const copy = $('.subtitle-manager-playback-copy');
      if (copy) copy.innerHTML = '<strong>Compatibilidade de reprodução</strong><span>Prévia compatível ativa. O arquivo original permanece intocado.</span>';
      if (button) { button.textContent = 'Recriar prévia compatível'; button.disabled = false; }
    } catch (error) {
      if (!options.silent) toast(error.message, true);
      else throw error;
      if (button) { button.disabled = false; button.textContent = 'Tentar prévia compatível'; }
    }
  }

  async function maybeEnsureCompatiblePlayback() {
    if (!isWorkspaceMode() || state.previewToken) return;
    const playback = getMediaProbe().playback || {};
    if (playback.mode !== 'audio-transcode') return;
    const key = `${state.item?.id || ''}:${state.audioStreamIndex ?? 'default'}:copy`;
    if (state.compatibilityKey === key) return;
    state.compatibilityKey = key;
    await createCompatiblePreview({ silent: true });
  }

  async function createVisualization(kind) {
    if (!isWorkspaceMode()) return;
    const button = document.querySelector(`[data-subtitle-visualization="${kind}"]`);
    if (button) { button.disabled = true; button.textContent = 'Gerando...'; }
    try {
      const response = await state.api(`${state.endpointBase}/audio-visualization-create`, {
        method: 'POST',
        body: JSON.stringify({ itemId: state.item.id, audioStreamIndex: state.audioStreamIndex, kind })
      });
      const key = `${kind}:${state.audioStreamIndex == null ? 'default' : state.audioStreamIndex}`;
      state.visualizationTokens[key] = response.result?.token || '';
      const section = $('.subtitle-manager-audio-tools');
      if (section) section.outerHTML = visualizationHtml();
    } catch (error) { toast(error.message, true); }
  }

  function seekFromVisualization(event) {
    const image = event.target.closest('[data-subtitle-visualization-seek]');
    const video = $('#subtitleManagerVideo');
    if (!image || !video || !Number.isFinite(video.duration) || !video.duration) return;
    const rect = image.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    video.currentTime = ratio * video.duration;
    video.play().catch(() => {});
  }

  function seekCue(index) {
    const cue = state.cueDraft[Number(index)];
    const video = $('#subtitleManagerVideo');
    if (!cue || !video) return;
    state.selectedCueIndex = Number(index);
    state.playerTime = Math.max(0, cue.startMs / 1000);
    try { video.currentTime = state.playerTime; video.play().catch(() => {}); } catch {}
    for (const row of document.querySelectorAll('[data-cue-row]')) row.classList.toggle('selected', Number(row.dataset.cueRow) === state.selectedCueIndex);
  }

  function updateCueDraftField(target) {
    const index = Number(target.dataset.cueIndex);
    const cue = state.cueDraft[index];
    if (!cue || state.timingPreview) return;
    if (target.matches('[data-subtitle-cue-text]')) cue.text = target.value;
    else if (target.matches('[data-subtitle-cue-time]')) {
      const value = parseTimestamp(target.value);
      if (value == null) { target.classList.add('invalid'); return; }
      target.classList.remove('invalid');
      cue[target.dataset.subtitleCueTime] = value;
    }
    state.cueDirty = true;
    const save = $('#subtitleManagerSaveCues');
    if (save) save.disabled = false;
    renderPreviewCues();
  }

  async function saveCueDraft() {
    if (!state.preview || state.preview.kind !== 'local' || !state.activeLocalTrackId || !state.cueDirty || state.timingPreview) return;
    for (let index = 0; index < state.cueDraft.length; index += 1) {
      const cue = state.cueDraft[index];
      if (!String(cue.text || '').trim() || !Number.isFinite(Number(cue.startMs)) || !Number.isFinite(Number(cue.endMs)) || Number(cue.endMs) <= Number(cue.startMs)) {
        return toast(`Confira o cue #${index + 1}: o texto precisa existir e o fim deve ser posterior ao início.`, true);
      }
    }
    const button = $('#subtitleManagerSaveCues');
    if (button) { button.disabled = true; button.textContent = 'Salvando...'; }
    try {
      await state.api(`${state.endpointBase}/subtitle-cues-save`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, trackId: state.activeLocalTrackId, cues: state.cueDraft, expectedFingerprint: state.preview.fingerprint || null })
      });
      toast('Alterações dos cues salvas. A versão anterior foi preservada no histórico.');
      const trackId = state.activeLocalTrackId;
      state.preview = null; state.cueDirty = false;
      await refreshStatus();
      await previewLocal(trackId);
      await notifyContentChanged({ action: 'cue-edit', trackId });
    } catch (error) {
      toast(error.message, true);
      if (button) { button.disabled = false; button.textContent = 'Salvar alterações'; }
    }
  }

  function syncPayload(mode) {
    if (!state.preview || state.preview.kind !== 'local') throw new Error('Abra um SRT editável antes de usar a sincronização avançada.');
    if (mode === 'two-point') {
      const values = ['a', 'b'].map((key) => state.syncPoints[key]);
      if (values.some((point) => !Number.isFinite(Number(point.subtitleMs)) || !Number.isFinite(Number(point.mediaMs)))) throw new Error('Preencha os dois tempos da legenda e do vídeo nos pontos A e B.');
      return { mode, pointA: values[0], pointB: values[1] };
    }
    const sourceFps = Number($('#subtitleManagerSourceFps')?.value || state.fpsSource);
    const targetFps = Number($('#subtitleManagerTargetFps')?.value || getMediaProbe().frameRate);
    if (!sourceFps || !targetFps) throw new Error('Informe o FPS da legenda e o FPS do vídeo.');
    state.fpsSource = sourceFps;
    return { mode: 'fps', sourceFps, targetFps };
  }

  async function previewTiming(mode) {
    try {
      const payload = syncPayload(mode);
      state.previewOffsetMs = 0;
      const response = await state.api(`${state.endpointBase}/subtitle-timing-preview`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, trackId: state.activeLocalTrackId, expectedFingerprint: state.preview.fingerprint || null, ...payload })
      });
      state.timingPreview = { ...(response.result || {}), cues: cloneCues(response.result?.cues || []) };
      render();
      renderPreviewCues();
      toast('Prévia aplicada somente no player. Nada foi salvo ainda.');
    } catch (error) { toast(error.message, true); }
  }

  function discardTimingPreview() {
    state.timingPreview = null;
    render();
    renderPreviewCues();
  }

  async function applyTimingPreview() {
    if (!state.timingPreview || !state.activeLocalTrackId) return;
    try {
      const payload = state.timingPreview.mode === 'two-point'
        ? { mode: 'two-point', pointA: state.timingPreview.pointA, pointB: state.timingPreview.pointB }
        : { mode: 'fps', sourceFps: state.timingPreview.sourceFps, targetFps: state.timingPreview.targetFps };
      await state.api(`${state.endpointBase}/subtitle-timing-apply`, {
        method: 'POST', body: JSON.stringify({ itemId: state.item.id, trackId: state.activeLocalTrackId, expectedFingerprint: state.preview.fingerprint || null, ...payload })
      });
      const trackId = state.activeLocalTrackId;
      state.timingPreview = null; state.preview = null; state.previewOffsetMs = 0;
      toast('Sincronização avançada aplicada. A versão anterior ficou no histórico.');
      await refreshStatus();
      await previewLocal(trackId);
      await notifyContentChanged({ action: payload.mode, trackId });
    } catch (error) { toast(error.message, true); }
  }

  function captureSyncCue(point) {
    const cue = state.cueDraft[state.selectedCueIndex];
    if (!cue) return toast('Selecione um cue no editor primeiro.', true);
    state.syncPoints[point].subtitleMs = Number(cue.startMs);
    render();
  }

  function captureSyncMedia(point) {
    const video = $('#subtitleManagerVideo');
    if (!video || !Number.isFinite(video.currentTime)) return toast('O player ainda não possui um tempo válido.', true);
    state.syncPoints[point].mediaMs = Math.round(video.currentTime * 1000);
    state.playerTime = video.currentTime;
    render();
  }

  function trackById(trackId) {
    return (state.status?.tracks || []).find((track) => (track.trackId || track.language) === trackId) || null;
  }

  function openToolAction(kind, trackId) {
    if (!isWorkspaceMode()) return;
    const track = trackById(trackId);
    if (!track) return toast('Faixa não encontrada. Atualize a varredura e tente novamente.', true);
    const base = { trackId, language: track.language || 'und', format: track.format || '', streamIndex: Number(track.metadata?.streamIndex) };
    if (kind === 'extract-srt') state.toolAction = { ...base, kind: 'extract', convertToSrt: true };
    else if (kind === 'extract-original') state.toolAction = { ...base, kind: 'extract', convertToSrt: false };
    else state.toolAction = { ...base, kind };
    state.activeJob = null;
    const area = $('#subtitleManagerToolActionArea');
    if (area) { area.innerHTML = toolActionHtml(); area.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }

  function closeToolAction() {
    if (state.jobTimer) clearTimeout(state.jobTimer);
    state.jobTimer = null;
    state.toolAction = null;
    state.activeJob = null;
    const area = $('#subtitleManagerToolActionArea');
    if (area) area.innerHTML = toolActionHtml();
  }

  async function refreshAfterToolMutation(change) {
    await refreshStatus();
    state.toolAction = null;
    render();
    await notifyContentChanged(change || { action: 'advanced-tool' });
  }

  async function pollAdvancedJob(jobId) {
    if (!jobId || !state.opened) return;
    try {
      const response = await state.api(`${state.endpointBase}/jobs/${encodeURIComponent(jobId)}`);
      state.activeJob = response.result || null;
      const area = $('#subtitleManagerToolActionArea');
      if (area) area.innerHTML = toolActionHtml();
      if (state.activeJob && ['queued', 'running'].includes(state.activeJob.status)) {
        state.jobTimer = setTimeout(() => pollAdvancedJob(jobId), 900);
        return;
      }
      if (state.activeJob?.status === 'completed') {
        toast(state.activeJob.kind === 'translate' ? 'Tradução concluída.' : state.activeJob.kind === 'ocr-pgs' ? 'OCR concluído.' : 'Cópia MKV criada com sucesso.');
        await refreshStatus();
        render();
        await notifyContentChanged({ action: state.activeJob.kind });
      } else if (state.activeJob?.status === 'failed') {
        toast(state.activeJob.error || 'A tarefa avançada falhou.', true);
      }
    } catch (error) { toast(error.message, true); }
  }

  async function startAdvancedJob(url, payload) {
    const response = await state.api(url, { method: 'POST', body: JSON.stringify(payload) });
    state.activeJob = response.result || null;
    const area = $('#subtitleManagerToolActionArea');
    if (area) area.innerHTML = toolActionHtml();
    if (state.activeJob?.id) await pollAdvancedJob(state.activeJob.id);
  }

  async function submitToolAction() {
    const action = state.toolAction;
    if (!action || !state.item) return;
    const itemBase = `${state.endpointBase}/items/${encodeURIComponent(state.item.id)}`;
    const replace = Boolean($('#subtitleToolReplace')?.checked);
    try {
      if (action.kind === 'extract') {
        const language = $('#subtitleToolLanguage')?.value || action.language;
        const response = await state.api(`${itemBase}/extract`, { method: 'POST', body: JSON.stringify({ trackId: action.trackId, language, replace, convertToSrt: action.convertToSrt === true }) });
        toast(`Legenda extraída: ${response.result?.fileName || 'arquivo criado'}.`);
        await refreshAfterToolMutation({ action: 'extract', trackId: response.result?.fileName || action.trackId });
      } else if (action.kind === 'convert') {
        const language = $('#subtitleToolLanguage')?.value || action.language;
        const response = await state.api(`${itemBase}/convert`, { method: 'POST', body: JSON.stringify({ trackId: action.trackId, language, replace }) });
        toast(`Cópia SRT criada: ${response.result?.fileName || 'arquivo criado'}.`);
        await refreshAfterToolMutation({ action: 'convert', trackId: response.result?.fileName || action.trackId });
      } else if (action.kind === 'translate') {
        await startAdvancedJob(`${itemBase}/translate`, {
          trackId: action.trackId,
          sourceLanguage: $('#subtitleToolSourceLanguage')?.value || action.language,
          targetLanguage: $('#subtitleToolTargetLanguage')?.value || 'pt-BR',
          outputMode: $('#subtitleToolOutputMode')?.value || 'translated',
          replace
        });
      } else if (action.kind === 'ocr') {
        await startAdvancedJob(`${itemBase}/ocr`, { trackId: action.trackId, language: $('#subtitleToolLanguage')?.value || action.language, replace });
      } else if (action.kind === 'remux-add') {
        await startAdvancedJob(`${itemBase}/remux`, { action: 'add-subtitle', trackId: action.trackId });
      } else if (action.kind === 'remux-remove') {
        await startAdvancedJob(`${itemBase}/remux`, { action: 'remove-stream', streamIndex: action.streamIndex, trackId: action.trackId });
      }
    } catch (error) { toast(error.message, true); }
  }

  function configure(options = {}) {
    state.api = options.api;
    state.showToast = options.showToast;
    state.showDialog = options.showDialog;
    state.escapeHtml = options.escapeHtml;
    state.onContentChanged = typeof options.onContentChanged === 'function' ? options.onContentChanged : null;
  }

  document.addEventListener('click', (event) => {
    const visualizationSeek = event.target.closest('[data-subtitle-visualization-seek]');
    if (visualizationSeek) { seekFromVisualization(event); return; }
    const openManager = event.target.closest('[data-subtitle-manager-open]');
    if (openManager) { open({ mode: 'manager' }); return; }
    const openPlayer = event.target.closest('[data-subtitle-player-open]');
    if (openPlayer) { open({ mode: 'player' }); return; }
    if (event.target.closest('[data-subtitle-manager-close]')) { close(); return; }
    const local = event.target.closest('[data-subtitle-local-preview]');
    if (local) { previewLocal(local.dataset.subtitleLocalPreview).catch((error) => toast(error.message, true)); return; }
    const localDelete = event.target.closest('[data-subtitle-local-delete]');
    if (localDelete) { deleteLocalSubtitle(localDelete.dataset.subtitleLocalDelete); return; }
    const toolOpen = event.target.closest('[data-subtitle-tool-open]');
    if (toolOpen) { openToolAction(toolOpen.dataset.subtitleToolOpen, toolOpen.dataset.trackId); return; }
    if (event.target.closest('[data-subtitle-tool-close]')) { closeToolAction(); return; }
    if (event.target.closest('[data-subtitle-tool-submit]')) { submitToolAction(); return; }
    const visualization = event.target.closest('[data-subtitle-visualization]');
    if (visualization) { createVisualization(visualization.dataset.subtitleVisualization); return; }
    const cueSeek = event.target.closest('[data-subtitle-cue-seek]');
    if (cueSeek) { seekCue(Number(cueSeek.dataset.subtitleCueSeek)); return; }
    const cuePage = event.target.closest('[data-subtitle-cue-page]');
    if (cuePage && !cuePage.disabled) { state.cuePage = Math.max(0, Number(cuePage.dataset.subtitleCuePage) || 0); render(); return; }
    if (event.target.closest('#subtitleManagerSaveCues')) { saveCueDraft(); return; }
    const captureCue = event.target.closest('[data-sync-capture-cue]');
    if (captureCue) { captureSyncCue(captureCue.dataset.syncCaptureCue); return; }
    const captureMedia = event.target.closest('[data-sync-capture-media]');
    if (captureMedia) { captureSyncMedia(captureMedia.dataset.syncCaptureMedia); return; }
    const timingPreview = event.target.closest('[data-subtitle-timing-preview]');
    if (timingPreview) { previewTiming(timingPreview.dataset.subtitleTimingPreview); return; }
    if (event.target.closest('[data-subtitle-timing-discard]')) { discardTimingPreview(); return; }
    if (event.target.closest('[data-subtitle-timing-apply]')) { applyTimingPreview(); return; }
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
    } else if (event.target.id === 'subtitleManagerAudioStream') {
      const video = $('#subtitleManagerVideo');
      if (video && Number.isFinite(video.currentTime)) state.playerTime = video.currentTime;
      state.audioStreamIndex = Number(event.target.value);
      state.previewToken = '';
      state.compatibilityKey = '';
      createCompatiblePreview({ silent: false }).catch((error) => toast(error.message, true));
    } else if (event.target.matches('[data-subtitle-cue-time], [data-subtitle-cue-text]')) {
      updateCueDraftField(event.target);
    } else if (event.target.matches('[data-sync-field]')) {
      const parsed = parseTimestamp(event.target.value);
      if (parsed == null) event.target.classList.add('invalid');
      else {
        event.target.classList.remove('invalid');
        const point = event.target.dataset.syncPoint;
        const field = event.target.dataset.syncField;
        if (state.syncPoints[point]) state.syncPoints[point][field] = parsed;
      }
    } else if (event.target.id === 'subtitleManagerSourceFps') {
      state.fpsSource = Number(event.target.value) || 25;
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'subtitleManagerArtist') state.queryDraft.artist = event.target.value;
    else if (event.target.id === 'subtitleManagerTrack') state.queryDraft.track = event.target.value;
    else if (event.target.id === 'subtitleManagerAlbum') state.queryDraft.album = event.target.value;
    else if (event.target.matches('[data-subtitle-cue-text]')) {
      const index = Number(event.target.dataset.cueIndex);
      if (state.cueDraft[index] && !state.timingPreview) {
        state.cueDraft[index].text = event.target.value;
        state.cueDirty = true;
        const save = $('#subtitleManagerSaveCues');
        if (save) save.disabled = false;
      }
    }
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
