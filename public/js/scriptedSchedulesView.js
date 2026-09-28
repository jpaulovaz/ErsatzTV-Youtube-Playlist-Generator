(() => {
  const MODULE_META = {
    rotation: { label: 'Rotation', hint: 'Rotação contínua entre Sources por blocos de duração.' },
    fixedEvents: { label: 'Horário + quantidade', hint: 'Toca uma quantidade de itens em um horário.' },
    fixedDurationEvents: { label: 'Horário + duração', hint: 'Toca por X minutos e preserva o saldo se for interrompido.' },
    fixedAllEvents: { label: 'Todos os itens', hint: 'Toca todos os itens da Source; depois de iniciar é atômico.' },
    fixedWindowEvents: { label: 'Janela', hint: 'Toca uma Source somente dentro de uma faixa de horário.' },
    windowRotations: { label: 'Rotação em janela', hint: 'Alterna Sources apenas dentro de uma faixa de horário.' },
    sequenceEvents: { label: 'Sequência', hint: 'Executa vários passos na ordem definida.' },
    intervalEvents: { label: 'Intervalo', hint: 'Repete um evento a cada X minutos.' },
    dateEvents: { label: 'Data específica', hint: 'Executa uma vez em uma data e hora.' },
    offlineWindows: { label: 'Offline', hint: 'Reserva uma faixa de horário sem programação.' }
  };

  const DAY_OPTIONS = [
    ['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom']
  ];
  const LATEST_TEMPLATE_VERSION = '1.2.0';
  const PAD_TO_NEAREST_OPTIONS = [5, 10, 15, 30];

  const SOURCE_TYPES = [
    ['smart_collection', 'Smart Collection'], ['collection', 'Collection'], ['multi_collection', 'Multi-Collection'],
    ['playlist', 'Playlist'], ['search', 'Search'], ['show', 'Show'], ['marathon', 'Marathon']
  ];

  const state = {
    deps: null,
    settings: null,
    projects: [],
    catalog: { channels: [], smartCollections: [] },
    current: null,
    tab: 'general',
    validation: null,
    preview: '',
    history: [],
    openAccordions: new Set(),
    loading: false
  };

  const root = () => document.querySelector('#scriptedSchedulesRoot');
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pathParts(path) { return String(path || '').split('.').filter(Boolean).map((part) => /^\d+$/.test(part) ? Number(part) : part); }
  function getPath(obj, path) { let cur = obj; for (const p of pathParts(path)) cur = cur?.[p]; return cur; }
  function setPath(obj, path, value) {
    const parts = pathParts(path); let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
  }
  function listValue(value) { return Array.isArray(value) ? value.join('\n') : ''; }
  function parseList(value) { return String(value || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean); }
  function slug(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_') || 'schedule';
  }
  function sourceOptions(selected = '', includeBlank = true) {
    const options = state.current?.sources || [];
    return `${includeBlank ? '<option value="">Selecione...</option>' : ''}${options.map((item) => `<option value="${esc(item.key)}" ${String(item.key) === String(selected) ? 'selected' : ''}>${esc(item.key)}${item.name ? ` — ${esc(item.name)}` : ''}</option>`).join('')}`;
  }
  function profileOptions(selected = '', includeBlank = true) {
    const options = state.current?.presentationProfiles || [];
    return `${includeBlank ? '<option value="">Padrão da Source</option>' : ''}${options.map((item) => `<option value="${esc(item.key)}" ${String(item.key) === String(selected) ? 'selected' : ''}>${esc(item.label || item.key)}</option>`).join('')}`;
  }
  function playlistOptions(selected = '') {
    return `<option value="">Sem pre-roll</option>${(state.current?.scriptedPlaylists || []).map((item) => `<option value="${esc(item.key)}" ${String(item.key) === String(selected) ? 'selected' : ''}>${esc(item.key)}</option>`).join('')}`;
  }
  function smartCollectionOptions(selected = '') {
    const items = state.catalog.smartCollections || [];
    if (!items.length) return '';
    return `<option value="">Selecione...</option>${items.map((item) => `<option value="${esc(item.name)}" ${String(item.name) === String(selected) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}`;
  }
  function channelOptions(selected = '') {
    return `<option value="">Selecione...</option>${(state.catalog.channels || []).map((item) => `<option value="${esc(item.number)}" data-name="${esc(item.name)}" ${String(item.number) === String(selected) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}`;
  }

  async function init(deps) {
    state.deps = deps;
    const el = root();
    if (!el) return;
    bindRoot();
    await reloadCatalog(false);
    await reloadList();
  }

  async function reloadCatalog(showErrors = false) {
    try {
      const response = await state.deps.api('/api/ersatztv/catalog');
      state.catalog = response.catalog || state.catalog;
    } catch (error) {
      state.catalog = { channels: [], smartCollections: [] };
      if (showErrors) state.deps.showToast(`ErsatzTV: ${error.message}`, true);
    }
  }

  async function reloadList() {
    state.loading = true; render();
    try {
      const [projectsResponse, settingsResponse] = await Promise.all([
        state.deps.api('/api/scripted-schedules'),
        state.deps.api('/api/scripted-schedules/settings')
      ]);
      state.projects = projectsResponse.projects || [];
      state.settings = settingsResponse.settings || null;
    } finally {
      state.loading = false; render();
    }
  }

  async function openProject(id) {
    state.loading = true; render();
    try {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(id)}`);
      state.current = clone(response.project);
      state.tab = 'general'; state.validation = null; state.preview = ''; state.history = []; state.openAccordions.clear();
      await reloadCatalog(false);
    } finally { state.loading = false; render(); }
  }

  function bindRoot() {
    const el = root();
    el.addEventListener('click', (event) => handleClick(event).catch((error) => state.deps.showToast(error.message, true)));
    el.addEventListener('input', handleInput);
    el.addEventListener('change', handleInput);
    el.addEventListener('toggle', handleAccordionToggle, true);
  }

  function handleAccordionToggle(event) {
    const details = event.target;
    if (!details?.matches?.('details[data-ss-accordion]')) return;
    const key = details.dataset.ssAccordion;
    if (!key) return;
    if (details.open) state.openAccordions.add(key);
    else state.openAccordions.delete(key);
  }

  function accordionAttrs(key) {
    return `data-ss-accordion="${esc(key)}"${state.openAccordions.has(key) ? ' open' : ''}`;
  }

  function openAccordion(key) {
    state.openAccordions.add(key);
  }

  function clearAccordionPrefix(prefix) {
    for (const key of [...state.openAccordions]) {
      if (key.startsWith(prefix)) state.openAccordions.delete(key);
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (!state.current) {
      if (target.matches('[data-ss-settings="outputRoot"]')) state.settings.outputRoot = target.value;
      if (target.matches('[data-ss-settings="historyLimit"]')) state.settings.historyLimit = Number(target.value) || 10;
      return;
    }
    const path = target.dataset.bind;
    if (path) {
      let value;
      if (target.type === 'checkbox') value = target.checked;
      else if (target.dataset.type === 'number') value = target.value === '' ? '' : Number(target.value);
      else if (target.dataset.type === 'list') value = parseList(target.value);
      else value = target.value;
      setPath(state.current, path, value);
      state.validation = null;
      if (target.dataset.rerender === 'true') render();
    }

    if (target.dataset.channelIndex !== undefined) {
      const index = Number(target.dataset.channelIndex);
      const link = state.current.channelLinks[index];
      const selected = target.selectedOptions?.[0];
      link.channelNumber = target.value;
      link.channelName = selected?.dataset.name || '';
      if (!link.stateKey || /^schedule(?:_\d+)?$/.test(link.stateKey)) link.stateKey = `${slug(state.current.name)}_${String(target.value || index + 1)}`;
      render();
    }

    if (target.dataset.arrayToggle) {
      const arr = getPath(state.current, target.dataset.arrayToggle) || [];
      const value = target.value;
      const next = target.checked ? [...new Set([...arr, value])] : arr.filter((item) => item !== value);
      setPath(state.current, target.dataset.arrayToggle, next);
    }
  }

  async function handleClick(event) {
    const button = event.target.closest('[data-ss-action]');
    if (!button) return;
    const action = button.dataset.ssAction;

    if (action === 'new-project') {
      const decision = await state.deps.showDialog({ eyebrow: 'Scripted Schedules', title: 'Novo projeto', message: 'Informe um nome para esta programação.', input: true, inputRequired: true, inputLabel: 'Nome', confirmLabel: 'Criar' });
      if (!decision.confirmed) return;
      const response = await state.deps.api('/api/scripted-schedules', { method: 'POST', body: JSON.stringify({ name: decision.value }) });
      await openProject(response.project.id); return;
    }
    if (action === 'refresh-catalog') { await reloadCatalog(true); render(); return; }
    if (action === 'save-settings') {
      const response = await state.deps.api('/api/scripted-schedules/settings', { method: 'PUT', body: JSON.stringify(state.settings) });
      state.settings = response.settings; state.deps.showToast('Pasta de scripts atualizada.'); render(); return;
    }
    if (action === 'edit') return openProject(button.dataset.id);
    if (action === 'open-preview') { await openProject(button.dataset.id); await loadPreview(); state.tab = 'publish'; render(); return; }
    if (action === 'open-history') { await openProject(button.dataset.id); await loadHistory(); state.tab = 'publish'; render(); return; }
    if (action === 'open-reset') {
      await openProject(button.dataset.id);
      if (state.current.channelLinks.length === 1) return resetPlayout(state.current.channelLinks[0].channelNumber);
      state.tab = 'publish'; render(); state.deps.showToast('Escolha o canal no Assistente de vínculo.'); return;
    }
    if (action === 'duplicate') {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(button.dataset.id)}/duplicate`, { method: 'POST', body: '{}' });
      state.deps.showToast('Projeto duplicado.'); await openProject(response.project.id); return;
    }
    if (action === 'delete') {
      const item = state.projects.find((p) => p.id === button.dataset.id);
      const decision = await state.deps.showDialog({
        eyebrow: 'Scripted Schedules', title: 'Excluir projeto', message: `Excluir ${item?.name || 'este projeto'}?`,
        warning: 'A opção principal mantém o arquivo Python publicado. Use a segunda opção apenas se também quiser remover o arquivo.',
        confirmLabel: 'Excluir projeto', danger: true, secondaryLabel: 'Excluir projeto e arquivo', secondaryDanger: true
      });
      if (!decision.confirmed && !decision.secondary) return;
      await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: JSON.stringify({ removePublished: decision.secondary }) });
      state.deps.showToast('Projeto removido.'); await reloadList(); return;
    }
    if (action === 'back') { state.current = null; state.validation = null; state.preview = ''; state.history = []; await reloadList(); return; }
    if (action === 'tab') { state.tab = button.dataset.tab; render(); return; }
    if (action === 'publish') { await publishCurrent(); return; }
    if (action === 'validate') { await validateCurrent(); return; }
    if (action === 'preview') { await loadPreview(); state.tab = 'publish'; render(); return; }
    if (action === 'history') { await loadHistory(); state.tab = 'publish'; render(); return; }
    if (action === 'restore') { await restoreRevision(button.dataset.revision); return; }
    if (action === 'copy-path') { await copyText(button.dataset.value || ''); return; }
    if (action === 'reset-playout') { await resetPlayout(button.dataset.channel); return; }

    if (!state.current) return;
    if (action === 'upgrade-template') { state.current.templateVersion = LATEST_TEMPLATE_VERSION; state.validation = null; state.deps.showToast(`Motor atualizado para ${LATEST_TEMPLATE_VERSION}. A alteração será efetivada ao salvar e publicar.`); render(); return; }
    if (action === 'add-channel') {
      state.current.channelLinks.push({ channelNumber: '', channelName: '', stateKey: `${slug(state.current.name)}_${state.current.channelLinks.length + 1}`, status: 'local' }); render(); return;
    }
    if (action === 'remove-channel') { state.current.channelLinks.splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'add-resource') { const kind = button.dataset.kind; const index = addResource(kind); openAccordion(`resources:${kind}`); if (index >= 0) openAccordion(`resource:${kind}:${index}`); render(); return; }
    if (action === 'remove-resource') { const kind = button.dataset.kind; removeResource(kind, Number(button.dataset.index)); clearAccordionPrefix(`resource:${kind}:`); render(); return; }
    if (action === 'add-playlist-item') { state.current.scriptedPlaylists[Number(button.dataset.index)].items.push({ source: firstSource(), count: 1 }); render(); return; }
    if (action === 'remove-playlist-item') { state.current.scriptedPlaylists[Number(button.dataset.index)].items.splice(Number(button.dataset.itemIndex), 1); render(); return; }
    if (action === 'move-playlist-item') { moveItem(state.current.scriptedPlaylists[Number(button.dataset.index)].items, Number(button.dataset.itemIndex), Number(button.dataset.delta)); render(); return; }
    if (action === 'add-guid') { getPath(state.current, button.dataset.path).push({ provider: 'tmdb', value: '' }); render(); return; }
    if (action === 'remove-guid') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'add-variable') { getPath(state.current, button.dataset.path).push({ key: '', value: '' }); render(); return; }
    if (action === 'remove-variable') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'add-module') { const type = button.dataset.module || document.querySelector('#ssModulePicker')?.value; addModule(type); openAccordion(`module:${type}`); openAccordion(`module-entry:${type}:0`); render(); return; }
    if (action === 'remove-module') { const type = button.dataset.module; state.current.modules[type] = []; state.openAccordions.delete(`module:${type}`); clearAccordionPrefix(`module-entry:${type}:`); render(); return; }
    if (action === 'add-module-entry') { const type = button.dataset.module; const index = state.current.modules[type].length; state.current.modules[type].push(defaultModuleEntry(type)); openAccordion(`module:${type}`); openAccordion(`module-entry:${type}:${index}`); render(); return; }
    if (action === 'remove-module-entry') { const type = button.dataset.module; state.current.modules[type].splice(Number(button.dataset.index), 1); clearAccordionPrefix(`module-entry:${type}:`); render(); return; }
    if (action === 'add-window-item') { state.current.modules.windowRotations[Number(button.dataset.index)].items.push({ source: firstSource(), presentation: '', durationMinutes: '', padToNearestMinutes: '' }); render(); return; }
    if (action === 'remove-window-item') { state.current.modules.windowRotations[Number(button.dataset.index)].items.splice(Number(button.dataset.itemIndex), 1); render(); return; }
    if (action === 'add-step') { getPath(state.current, button.dataset.path).push({ mode: 'count', source: firstSource(), count: 1, presentation: '' }); render(); return; }
    if (action === 'remove-step') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'toggle-filler') {
      if (state.current.filler) {
        const cleared = clearPadToNearestSettings();
        state.current.filler = null;
        if (cleared) state.deps.showToast(`Filler desativado; ${cleared} alinhamento(s) Pad To Nearest Minute também foram desativados.`);
      } else {
        state.current.filler = { source: firstSource(), presentation: '' };
        openAccordion('programming:filler');
      }
      state.validation = null; render(); return;
    }
  }

  async function publishCurrent() {
    try {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}`, { method: 'PUT', body: JSON.stringify(state.current) });
      state.current = clone(response.project); state.validation = response.validation || null;
      state.preview = ''; state.history = [];
      state.deps.showToast('Script publicado com sucesso.');
      state.tab = 'publish'; render();
    } catch (error) {
      if (error.payload?.validation) state.validation = error.payload.validation;
      state.tab = 'review'; render(); throw error;
    }
  }

  async function validateCurrent() {
    try {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/validate`, { method: 'POST', body: JSON.stringify(state.current) });
      state.validation = response.validation; state.deps.showToast('Configuração válida.');
    } catch (error) {
      state.validation = error.payload?.validation || { ok: false, errors: [{ path: '', message: error.message }], warnings: [] };
    }
    render();
  }

  async function loadPreview() {
    const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/preview`, { method: 'POST', body: JSON.stringify(state.current) });
    state.preview = response.script || '';
  }
  async function loadHistory() {
    const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/history`);
    state.history = response.history || [];
  }
  async function restoreRevision(revisionId) {
    const decision = await state.deps.showDialog({ eyebrow: 'Histórico', title: 'Restaurar revisão', message: 'A revisão escolhida será restaurada e o arquivo Python será publicado novamente.', warning: 'A versão atual também será preservada no histórico.', confirmLabel: 'Restaurar' });
    if (!decision.confirmed) return;
    const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/restore`, { method: 'POST', body: JSON.stringify({ revisionId }) });
    state.current = clone(response.project); state.preview = ''; await loadHistory(); state.deps.showToast('Revisão restaurada.'); render();
  }
  async function resetPlayout(channelNumber) {
    const link = state.current.channelLinks.find((item) => String(item.channelNumber) === String(channelNumber));
    const decision = await state.deps.showDialog({
      eyebrow: 'ErsatzTV', title: 'Reset Playout',
      message: `Reconstruir o Playout de ${link?.channelName || 'este canal'}?`,
      warning: 'Esta ação é destrutiva: o ErsatzTV reconstruirá o Playout e o progresso atual pode ser perdido.',
      confirmLabel: 'Reset Playout', danger: true
    });
    if (!decision.confirmed) return;
    await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/reset-playout`, { method: 'POST', body: JSON.stringify({ channelNumber }) });
    state.deps.showToast('Reset Playout enviado ao ErsatzTV.');
  }
  async function copyText(value) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    state.deps.showToast('Copiado.');
  }

  function firstSource() { return state.current?.sources?.[0]?.key || ''; }
  function firstProfile() { return state.current?.presentationProfiles?.[0]?.key || 'none'; }
  function nextKey(prefix, items) {
    let i = items.length + 1; let key = `${prefix}_${i}`;
    const existing = new Set(items.map((x) => x.key)); while (existing.has(key)) { i += 1; key = `${prefix}_${i}`; } return key;
  }
  function addResource(kind) {
    const map = { graphics: 'graphicsGroups', source: 'sources', playlist: 'scriptedPlaylists', profile: 'presentationProfiles' };
    const list = state.current[map[kind]];
    if (!list) return -1;
    if (kind === 'graphics') list.push({ key: nextKey('GRAPHICS', list), label: 'Novo grupo', graphics: [], includes: [] });
    if (kind === 'source') list.push({ key: nextKey('SOURCE', list), label: 'Nova Source', type: 'smart_collection', name: '', order: 'shuffle', presentation: 'none', guids: [], searches: [] });
    if (kind === 'playlist') list.push({ key: nextKey('PLAYLIST', list), label: 'Nova Scripted Playlist', items: [{ source: firstSource(), count: 1 }] });
    if (kind === 'profile') list.push({ key: nextKey('profile', list).toLowerCase(), label: 'Novo perfil', graphicsGroups: [], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true });
    return list.length - 1;
  }
  function removeResource(kind, index) {
    const map = { graphics: 'graphicsGroups', source: 'sources', playlist: 'scriptedPlaylists', profile: 'presentationProfiles' };
    if (kind === 'profile' && state.current.presentationProfiles[index]?.key === 'none') return state.deps.showToast('O perfil none é reservado e não pode ser removido.', true);
    state.current[map[kind]].splice(index, 1);
  }
  function moveItem(items, index, delta) {
    const target = index + delta; if (target < 0 || target >= items.length) return;
    const [item] = items.splice(index, 1); items.splice(target, 0, item);
  }
  function addModule(type) {
    if (!type || !state.current.modules[type] || state.current.modules[type].length) return;
    state.current.modules[type].push(defaultModuleEntry(type));
  }
  function defaultFilters() { return { days: [], startDate: '', endDate: '', dates: [], excludeDates: [], enabled: true }; }
  function defaultBase(id) { return { id, label: '', priority: state.current.options.defaultFixedPriority || 100, presentation: '', ...defaultFilters() }; }
  function defaultModuleEntry(type) {
    const s = firstSource(); const p = state.current.options.defaultFixedPriority || 100; const n = (state.current.modules[type]?.length || 0) + 1;
    if (type === 'rotation') return { source: s, presentation: '', durationMinutes: state.current.options.defaultRotationDurationMinutes || 60, padToNearestMinutes: '' };
    if (type === 'fixedEvents') return { ...defaultBase(`fixed_${n}`), time: '10:00', source: s, count: 1, priority: p , padToNearestMinutes: ''};
    if (type === 'fixedDurationEvents') return { ...defaultBase(`duration_${n}`), time: '20:00', source: s, durationMinutes: 60, priority: p , padToNearestMinutes: ''};
    if (type === 'fixedAllEvents') return { ...defaultBase(`all_${n}`), time: '14:00', source: s, priority: p , padToNearestMinutes: ''};
    if (type === 'fixedWindowEvents') return { ...defaultBase(`window_${n}`), startTime: '06:00', endTime: '10:00', source: s, priority: p , padToNearestMinutes: ''};
    if (type === 'windowRotations') return { ...defaultBase(`window_rotation_${n}`), startTime: '12:00', endTime: '18:00', blockMinutes: 30, priority: p, items: [{ source: s, presentation: '', durationMinutes: '', padToNearestMinutes: '' }] };
    if (type === 'sequenceEvents') return { ...defaultBase(`sequence_${n}`), time: '19:55', priority: p, atomic: false, steps: [{ mode: 'count', source: s, count: 1, presentation: '' }] , padToNearestMinutes: ''};
    if (type === 'intervalEvents') return { ...defaultBase(`interval_${n}`), startTime: '00:00', endTime: '00:00', everyMinutes: 30, source: s, mode: 'count', count: 1, durationMinutes: '', priority: p, latePolicy: 'skip', maxLatenessMinutes: 10 , padToNearestMinutes: ''};
    if (type === 'dateEvents') return { ...defaultBase(`date_${n}`), datetime: `${new Date().toISOString().slice(0, 10)} 20:00`, source: s, mode: 'count', count: 1, durationMinutes: '', priority: p, steps: [] , padToNearestMinutes: ''};
    if (type === 'offlineWindows') return { ...defaultBase(`offline_${n}`), startTime: '03:00', endTime: '05:00', priority: 1000 };
    return {};
  }

  function render() {
    const el = root();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = '<section class="card ss-loading"><strong>Carregando Scripted Schedules...</strong></section>';
      return;
    }
    el.innerHTML = state.current ? renderEditor() : renderList();
  }

  function renderList() {
    const cards = state.projects.length ? state.projects.map(renderProjectCard).join('') : `
      <section class="card ss-empty">
        <span class="eyebrow">Programação</span>
        <h3>Nenhum Scripted Schedule criado</h3>
        <p>Crie um projeto para montar a programação pela interface e publicar o arquivo Python usado pelo ErsatzTV.</p>
        <button type="button" class="primary" data-ss-action="new-project">Novo Scripted Schedule</button>
      </section>`;
    return `
      <div class="page-header ss-page-header">
        <div><span class="page-kicker">Programação</span><h2>Scripted Schedules</h2></div>
        <button type="button" class="primary" data-ss-action="new-project">Novo Scripted Schedule</button>
      </div>
      ${renderSettingsCard()}
      <div class="ss-project-grid">${cards}</div>`;
  }

  function renderSettingsCard() {
    const settings = state.settings || { outputRoot: '', historyLimit: 10 };
    return `
      <details class="card ss-settings-card">
        <summary><strong>Pasta de saída dos scripts</strong><span>${esc(settings.outputRoot || 'Não configurada')}</span></summary>
        <div class="ss-settings-body">
          <label class="wide">Pasta absoluta
            <input type="text" data-ss-settings="outputRoot" value="${esc(settings.outputRoot || '')}" placeholder="/srv/ersatztv/scripts">
          </label>
          <label>Versões no histórico
            <input type="number" min="1" max="50" data-ss-settings="historyLimit" value="${esc(settings.historyLimit || 10)}">
          </label>
          <button type="button" data-ss-action="save-settings">Salvar pasta</button>
          <small>O aplicativo só publica arquivos .py dentro desta pasta. O processo do ErsatzTV também precisa ter acesso ao caminho.</small>
        </div>
      </details>`;
  }

  function renderProjectCard(project) {
    const links = (project.channelLinks || []).map((link) => link.channelName || link.channelNumber).filter(Boolean);
    return `
      <article class="card ss-project-card">
        <div class="ss-card-head">
          <div><span class="eyebrow">Scripted Schedule</span><h3>${esc(project.name)}</h3></div>
          <span class="status-pill ${project.publishedAt ? 'ok' : 'warn'}">${project.publishedAt ? 'Publicado' : 'Rascunho'}</span>
        </div>
        <div class="ss-card-meta">
          <span><strong>Arquivo</strong>${esc(project.fileName || '-')}</span>
          <span><strong>Motor</strong>${esc(project.templateVersion || '1.1.1')}</span>
          <span><strong>Atualizado</strong>${esc(formatDate(project.updatedAt))}</span>
        </div>
        <div class="ss-card-channels"><strong>Canais</strong><span>${links.length ? esc(links.join(', ')) : 'Nenhum vínculo local'}</span></div>
        <div class="ss-card-actions">
          <button type="button" class="primary" data-ss-action="edit" data-id="${esc(project.id)}">Editar</button>
          <button type="button" data-ss-action="open-preview" data-id="${esc(project.id)}">Prévia</button>
          <button type="button" data-ss-action="open-history" data-id="${esc(project.id)}">Histórico</button>
          <button type="button" data-ss-action="duplicate" data-id="${esc(project.id)}">Duplicar</button>
          ${links.length ? `<button type="button" class="danger ghost" data-ss-action="open-reset" data-id="${esc(project.id)}">Reset Playout</button>` : ''}
          <button type="button" class="danger ghost" data-ss-action="delete" data-id="${esc(project.id)}">Excluir</button>
        </div>
      </article>`;
  }

  function renderEditor() {
    const tabs = [
      ['general', 'Geral'], ['resources', 'Recursos'], ['programming', 'Programação'], ['review', 'Revisão'], ['publish', 'Publicar']
    ];
    return `
      <div class="page-header ss-page-header">
        <div>
          <button type="button" class="text-button ss-back" data-ss-action="back">← Scripted Schedules</button>
          <span class="page-kicker">Editor</span><h2>${esc(state.current.name || 'Scripted Schedule')}</h2>
        </div>
        <div class="header-actions">
          <button type="button" data-ss-action="validate">Validar</button>
          <button type="button" class="primary" data-ss-action="publish">Salvar e publicar</button>
        </div>
      </div>
      <nav class="ss-editor-tabs" aria-label="Etapas do editor">
        ${tabs.map(([key, label]) => `<button type="button" class="${state.tab === key ? 'active' : ''}" data-ss-action="tab" data-tab="${key}">${label}</button>`).join('')}
      </nav>
      <div class="ss-editor-body">
        ${state.tab === 'general' ? renderGeneral() : ''}
        ${state.tab === 'resources' ? renderResources() : ''}
        ${state.tab === 'programming' ? renderProgramming() : ''}
        ${state.tab === 'review' ? renderReview() : ''}
        ${state.tab === 'publish' ? renderPublish() : ''}
      </div>`;
  }

  function renderGeneral() {
    const p = state.current;
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><span class="eyebrow">01 · Geral</span><h3>Projeto</h3></div></div>
        <div class="form-grid two">
          <label>Nome do projeto<input data-bind="name" value="${esc(p.name)}"></label>
          <label>Arquivo Python<input data-bind="fileName" value="${esc(p.fileName)}" placeholder="johnflix-music.py"></label>
          <label>Motor<input value="${esc(p.templateVersion)}" disabled></label>
          <label>Pasta de saída<input value="${esc(state.settings?.outputRoot || '')}" disabled></label>
        </div>
        ${p.templateVersion !== LATEST_TEMPLATE_VERSION ? `<div class="ss-callout">Este projeto usa o motor ${esc(p.templateVersion)}. O Pad To Nearest Minute está disponível no motor ${LATEST_TEMPLATE_VERSION}. <button type="button" data-ss-action="upgrade-template">Atualizar motor</button></div>` : ''}
      </section>
      <section class="card ss-section-card">
        <div class="section-heading">
          <div><span class="eyebrow">ErsatzTV</span><h3>Vínculos com canais</h3><p>O vínculo aqui é local. O primeiro cadastro do caminho do script no Playout continua sendo feito no ErsatzTV.</p></div>
          <div class="header-actions"><button type="button" data-ss-action="refresh-catalog">Atualizar catálogo</button><button type="button" data-ss-action="add-channel">Adicionar canal</button></div>
        </div>
        <div class="ss-stack">${p.channelLinks.length ? p.channelLinks.map(renderChannelLink).join('') : '<div class="empty-state">Nenhum canal vinculado.</div>'}</div>
      </section>`;
  }

  function renderChannelLink(link, index) {
    return `
      <div class="ss-row-card ss-channel-link">
        <label>Canal no ErsatzTV<select data-channel-index="${index}">${channelOptions(link.channelNumber)}</select></label>
        <label>state_key<input data-bind="channelLinks.${index}.stateKey" value="${esc(link.stateKey || '')}" placeholder="music_420"></label>
        <button type="button" class="danger ghost" data-ss-action="remove-channel" data-index="${index}">Remover</button>
      </div>`;
  }

  function renderResources() {
    return `
      ${renderGraphicsGroups()}
      ${renderSources()}
      ${renderScriptedPlaylists()}
      ${renderProfiles()}
      ${renderEditorSaveBar('Recursos')}`;
  }

  function renderGraphicsGroups() {
    return resourceSection('Grupos de Graphics', 'Agrupe arquivos YAML que normalmente ficam ativos juntos.', 'graphics',
      state.current.graphicsGroups.map((group, index) => {
        const otherGroups = state.current.graphicsGroups.filter((_, i) => i !== index);
        return `
          <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:graphics:${index}`)}>
            <summary class="ss-accordion-summary"><strong>${esc(group.label || group.key)}</strong><span>${esc(group.key)}</span></summary>
            <div class="ss-accordion-body">
              <div class="ss-accordion-actions"><button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="graphics" data-index="${index}">Remover</button></div>
              <div class="form-grid two">
                <label>Nome amigável<input data-bind="graphicsGroups.${index}.label" value="${esc(group.label || '')}"></label>
                <label>Chave<input data-bind="graphicsGroups.${index}.key" value="${esc(group.key)}"></label>
                <label class="wide">Graphics Elements <small>Um caminho por linha</small><textarea rows="4" data-bind="graphicsGroups.${index}.graphics" data-type="list">${esc(listValue(group.graphics))}</textarea></label>
              </div>
              ${otherGroups.length ? `<div class="ss-check-group"><span>Incluir outros grupos</span>${otherGroups.map((item) => `<label class="check-row"><input type="checkbox" value="${esc(item.key)}" data-array-toggle="graphicsGroups.${index}.includes" ${(group.includes || []).includes(item.key) ? 'checked' : ''}><span>${esc(item.label || item.key)}</span></label>`).join('')}</div>` : ''}
            </div>
          </details>`;
      }).join(''));
  }

  function renderSources() {
    return resourceSection('Sources', 'Cadastre as fontes de conteúdo uma vez. Os módulos usam a chave da Source.', 'source',
      state.current.sources.map((source, index) => renderSourceCard(source, index)).join(''));
  }

  function renderSourceCard(source, index) {
    const typeLabel = SOURCE_TYPES.find(([value]) => value === source.type)?.[1] || source.type || 'Source';
    return `
      <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:source:${index}`)}>
        <summary class="ss-accordion-summary"><strong>${esc(source.label || source.key)}</strong><span>${esc(typeLabel)}</span></summary>
        <div class="ss-accordion-body">
          <div class="ss-accordion-actions"><button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="source" data-index="${index}">Remover</button></div>
          <div class="form-grid three">
            <label>Nome amigável<input data-bind="sources.${index}.label" value="${esc(source.label || '')}"></label>
            <label>Chave<input data-bind="sources.${index}.key" value="${esc(source.key)}"></label>
            <label>Tipo<select data-bind="sources.${index}.type" data-rerender="true">${SOURCE_TYPES.map(([value, label]) => `<option value="${value}" ${source.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            ${renderSourceTypeFields(source, index)}
            ${['smart_collection', 'collection', 'multi_collection', 'search', 'show'].includes(source.type) ? `<label>Ordem<select data-bind="sources.${index}.order"><option value="chronological" ${source.order === 'chronological' ? 'selected' : ''}>Chronological</option><option value="shuffle" ${source.order === 'shuffle' ? 'selected' : ''}>Shuffle</option></select></label>` : ''}
            <label>Presentation padrão<select data-bind="sources.${index}.presentation">${profileOptions(source.presentation, true)}</select></label>
          </div>
        </div>
      </details>`;
  }

  function renderSourceTypeFields(source, index) {
    const base = `sources.${index}`;
    if (source.type === 'smart_collection') {
      if (state.catalog.smartCollections?.length) return `<label class="wide">Smart Collection<select data-bind="${base}.name">${smartCollectionOptions(source.name)}</select></label>`;
      return `<label class="wide">Smart Collection<input data-bind="${base}.name" value="${esc(source.name || '')}" placeholder="Nome exato no ErsatzTV"><small>Catálogo indisponível; o nome pode ser informado manualmente.</small></label>`;
    }
    if (['collection', 'multi_collection'].includes(source.type)) return `<label class="wide">Nome no ErsatzTV<input data-bind="${base}.name" value="${esc(source.name || '')}"></label>`;
    if (source.type === 'playlist') return `<label>Playlist<input data-bind="${base}.playlist" value="${esc(source.playlist || '')}"></label><label>Playlist Group<input data-bind="${base}.playlistGroup" value="${esc(source.playlistGroup || '')}"></label>`;
    if (source.type === 'search') return `<label class="wide">Query<textarea rows="3" data-bind="${base}.query">${esc(source.query || '')}</textarea></label>`;
    if (source.type === 'show') return `<div class="wide">${renderGuidEditor(source.guids || [], `${base}.guids`)}</div>`;
    if (source.type === 'marathon') return `
      <label>Agrupar por<select data-bind="${base}.groupBy"><option value="show" ${source.groupBy === 'show' ? 'selected' : ''}>Show</option><option value="season" ${source.groupBy === 'season' ? 'selected' : ''}>Season</option><option value="artist" ${source.groupBy === 'artist' ? 'selected' : ''}>Artist</option><option value="album" ${source.groupBy === 'album' ? 'selected' : ''}>Album</option><option value="director" ${source.groupBy === 'director' ? 'selected' : ''}>Director</option></select></label>
      <label>Ordem dos itens<select data-bind="${base}.itemOrder"><option value="chronological" ${source.itemOrder === 'chronological' ? 'selected' : ''}>Chronological</option><option value="shuffle" ${source.itemOrder === 'shuffle' ? 'selected' : ''}>Shuffle</option></select></label>
      <label class="check-row"><input type="checkbox" data-bind="${base}.playAllItems" ${source.playAllItems ? 'checked' : ''}><span>Tocar todos os itens do grupo</span></label>
      <label class="check-row"><input type="checkbox" data-bind="${base}.shuffleGroups" ${source.shuffleGroups ? 'checked' : ''}><span>Embaralhar grupos</span></label>
      <label class="wide">Searches <small>Uma query por linha</small><textarea rows="3" data-bind="${base}.searches" data-type="list">${esc(listValue(source.searches))}</textarea></label>
      <div class="wide">${renderGuidEditor(source.guids || [], `${base}.guids`)}</div>`;
    return '';
  }

  function renderGuidEditor(items, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>GUIDs</strong><button type="button" data-ss-action="add-guid" data-path="${esc(path)}">Adicionar GUID</button></div>${items.length ? items.map((item, index) => `<div class="ss-inline-row"><input data-bind="${path}.${index}.provider" value="${esc(item.provider || '')}" placeholder="tmdb"><input data-bind="${path}.${index}.value" value="${esc(item.value || '')}" placeholder="12345"><button type="button" class="danger ghost" data-ss-action="remove-guid" data-path="${esc(path)}" data-index="${index}">×</button></div>`).join('') : '<small>Nenhum GUID.</small>'}</div>`;
  }

  function renderScriptedPlaylists() {
    return resourceSection('Scripted Playlists', 'Monte pequenas sequências reutilizáveis. Elas podem ser usadas como pre-roll nos perfis.', 'playlist',
      state.current.scriptedPlaylists.map((playlist, index) => `
        <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:playlist:${index}`)}>
          <summary class="ss-accordion-summary"><strong>${esc(playlist.label || playlist.key)}</strong><span>${(playlist.items || []).length} item(ns)</span></summary>
          <div class="ss-accordion-body">
            <div class="ss-accordion-actions"><button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="playlist" data-index="${index}">Remover</button></div>
            <div class="form-grid two"><label>Nome amigável<input data-bind="scriptedPlaylists.${index}.label" value="${esc(playlist.label || '')}"></label><label>Chave<input data-bind="scriptedPlaylists.${index}.key" value="${esc(playlist.key)}"></label></div>
            <div class="ss-mini-editor"><div class="ss-mini-head"><strong>Itens</strong><button type="button" data-ss-action="add-playlist-item" data-index="${index}">Adicionar item</button></div>
              ${(playlist.items || []).map((item, itemIndex) => `<div class="ss-inline-row ss-playlist-row"><select data-bind="scriptedPlaylists.${index}.items.${itemIndex}.source">${sourceOptions(item.source)}</select><input type="number" min="1" data-type="number" data-bind="scriptedPlaylists.${index}.items.${itemIndex}.count" value="${esc(item.count || 1)}" aria-label="Quantidade"><div class="ss-order-buttons"><button type="button" data-ss-action="move-playlist-item" data-index="${index}" data-item-index="${itemIndex}" data-delta="-1">↑</button><button type="button" data-ss-action="move-playlist-item" data-index="${index}" data-item-index="${itemIndex}" data-delta="1">↓</button><button type="button" class="danger ghost" data-ss-action="remove-playlist-item" data-index="${index}" data-item-index="${itemIndex}">×</button></div></div>`).join('') || '<small>Adicione itens à sequência.</small>'}
            </div>
          </div>
        </details>`).join(''));
  }

  function renderProfiles() {
    return resourceSection('Presentation Profiles', 'Combine Graphics, pre-roll, watermarks e opções de EPG para reutilizar nos módulos.', 'profile',
      state.current.presentationProfiles.map((profile, index) => `
        <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:profile:${index}`)}>
          <summary class="ss-accordion-summary"><strong>${esc(profile.label || profile.key)}</strong><span>${profile.key === 'none' ? 'Reservado' : esc(profile.key)}</span></summary>
          <div class="ss-accordion-body">
            <div class="ss-accordion-actions">${profile.key === 'none' ? '<span class="status-pill">Reservado</span>' : `<button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="profile" data-index="${index}">Remover</button>`}</div>
            <div class="form-grid two">
              <label>Nome amigável<input data-bind="presentationProfiles.${index}.label" value="${esc(profile.label || '')}"></label>
              <label>Chave<input data-bind="presentationProfiles.${index}.key" value="${esc(profile.key)}" ${profile.key === 'none' ? 'disabled' : ''}></label>
              <label>Pre-roll<select data-bind="presentationProfiles.${index}.preRoll">${playlistOptions(profile.preRoll)}</select></label>
              <label class="check-row"><input type="checkbox" data-bind="presentationProfiles.${index}.epgGroup" data-rerender="true" ${profile.epgGroup ? 'checked' : ''}><span>Agrupar no EPG</span></label>
              ${profile.epgGroup ? `<label>Título no EPG<input data-bind="presentationProfiles.${index}.epgTitle" value="${esc(profile.epgTitle || '')}"></label><label class="check-row"><input type="checkbox" data-bind="presentationProfiles.${index}.epgAdvance" ${profile.epgAdvance !== false ? 'checked' : ''}><span>Iniciar novo grupo no EPG</span></label>` : ''}
              <label class="wide">Graphics diretos <small>Um YAML por linha</small><textarea rows="3" data-bind="presentationProfiles.${index}.graphics" data-type="list">${esc(listValue(profile.graphics))}</textarea></label>
              <label class="wide">Watermarks nativos <small>Um nome por linha</small><textarea rows="2" data-bind="presentationProfiles.${index}.watermarks" data-type="list">${esc(listValue(profile.watermarks))}</textarea></label>
            </div>
            ${renderGroupChoices(profile.graphicsGroups || [], `presentationProfiles.${index}.graphicsGroups`)}
            <details class="ss-advanced"><summary>Variáveis dos Graphics</summary>${renderPairEditor(profile.graphicsVariables || [], `presentationProfiles.${index}.graphicsVariables`)}</details>
          </div>
        </details>`).join(''));
  }

  function renderGroupChoices(selected, path) {
    if (!state.current.graphicsGroups.length) return '';
    return `<div class="ss-check-group"><span>Grupos de Graphics</span>${state.current.graphicsGroups.map((group) => `<label class="check-row"><input type="checkbox" value="${esc(group.key)}" data-array-toggle="${esc(path)}" ${selected.includes(group.key) ? 'checked' : ''}><span>${esc(group.label || group.key)}</span></label>`).join('')}</div>`;
  }
  function renderPairEditor(items, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><span>Chave = valor</span><button type="button" data-ss-action="add-variable" data-path="${esc(path)}">Adicionar</button></div>${items.map((item, index) => `<div class="ss-inline-row"><input data-bind="${path}.${index}.key" value="${esc(item.key || '')}" placeholder="chave"><input data-bind="${path}.${index}.value" value="${esc(item.value || '')}" placeholder="valor"><button type="button" class="danger ghost" data-ss-action="remove-variable" data-path="${esc(path)}" data-index="${index}">×</button></div>`).join('') || '<small>Nenhuma variável.</small>'}</div>`;
  }

  function resourceSection(title, subtitle, kind, content) {
    const countMap = { graphics: state.current.graphicsGroups.length, source: state.current.sources.length, playlist: state.current.scriptedPlaylists.length, profile: state.current.presentationProfiles.length };
    return `
      <details class="card ss-section-card ss-section-accordion" ${accordionAttrs(`resources:${kind}`)}>
        <summary class="ss-section-summary"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><span>${countMap[kind] || 0} item(ns)</span></summary>
        <div class="ss-section-accordion-body">
          <div class="ss-section-actions"><button type="button" data-ss-action="add-resource" data-kind="${kind}">Adicionar</button></div>
          <div class="ss-stack">${content || '<div class="empty-state">Nenhum item cadastrado.</div>'}</div>
        </div>
      </details>`;
  }

  function renderProgramming() {
    const active = Object.entries(MODULE_META).filter(([key]) => state.current.modules[key]?.length);
    const inactive = Object.entries(MODULE_META).filter(([key]) => !state.current.modules[key]?.length);
    return `
      <details class="card ss-section-card ss-section-accordion" ${accordionAttrs('programming:options')}>
        <summary class="ss-section-summary"><div><span class="eyebrow">Opções globais</span><h3>Comportamento padrão</h3><p>Valores usados quando um módulo não informa uma opção própria.</p></div><span>Configuração</span></summary>
        <div class="ss-section-accordion-body">
          <div class="form-grid four">
            <label>Duração padrão da Rotation (min)<input type="number" min="1" data-type="number" data-bind="options.defaultRotationDurationMinutes" value="${esc(state.current.options.defaultRotationDurationMinutes)}"></label>
            <label>Prioridade padrão<input type="number" data-type="number" data-bind="options.defaultFixedPriority" value="${esc(state.current.options.defaultFixedPriority)}"></label>
            <label>Timeout HTTP (s)<input type="number" min="1" data-type="number" data-bind="options.httpTimeoutSeconds" value="${esc(state.current.options.httpTimeoutSeconds)}"></label>
            <label>Retenção de ocorrências (dias)<input type="number" min="1" data-type="number" data-bind="options.seenOccurrenceRetentionDays" value="${esc(state.current.options.seenOccurrenceRetentionDays)}"></label>
            <label class="check-row wide"><input type="checkbox" data-bind="options.allowOverrun" ${state.current.options.allowOverrun !== false ? 'checked' : ''}><span>Não cortar o vídeo atual para cumprir o horário exato</span></label>
          </div>
        </div>
      </details>
      <section class="card ss-section-card">
        <div class="section-heading">
          <div><span class="eyebrow">Módulos</span><h3>Programação</h3><p>Adicione somente os módulos que este canal precisa.</p></div>
          ${inactive.length ? `<div class="ss-add-module"><select id="ssModulePicker">${inactive.map(([key, meta]) => `<option value="${key}">${esc(meta.label)}</option>`).join('')}</select><button type="button" data-ss-action="add-module">Adicionar módulo</button></div>` : ''}
        </div>
        <div class="ss-stack">${active.length ? active.map(([key]) => renderModule(key)).join('') : '<div class="empty-state">Nenhum módulo ativo. Adicione um módulo ou use somente o Filler.</div>'}</div>
      </section>
      ${renderFiller()}
      ${renderEditorSaveBar('Programação')}`;
  }

  function renderModule(type) {
    const meta = MODULE_META[type]; const items = state.current.modules[type] || [];
    return `
      <details class="ss-module-card ss-accordion-card" ${accordionAttrs(`module:${type}`)}>
        <summary class="ss-accordion-summary ss-module-summary"><div><span class="eyebrow">${esc(meta.label)}</span><strong>${esc(meta.hint)}</strong></div><span>${items.length} item(ns)</span></summary>
        <div class="ss-accordion-body">
          <div class="ss-module-actions header-actions"><button type="button" data-ss-action="add-module-entry" data-module="${type}">Adicionar item</button><button type="button" class="danger ghost" data-ss-action="remove-module" data-module="${type}">Remover módulo</button></div>
          <div class="ss-stack">${items.map((item, index) => renderModuleEntry(type, item, index)).join('')}</div>
        </div>
      </details>`;
  }

  function renderModuleEntry(type, item, index) {
    if (type === 'rotation') return moduleEntryShell(type, index, `Bloco ${index + 1}`, `
      <div class="form-grid three">
        ${sourceSelect(`modules.rotation.${index}.source`, item.source)}
        ${profileSelect(`modules.rotation.${index}.presentation`, item.presentation)}
        <label>Duração (min)<input type="number" min="1" data-type="number" data-bind="modules.rotation.${index}.durationMinutes" value="${esc(item.durationMinutes ?? '')}" placeholder="${esc(state.current.options.defaultRotationDurationMinutes || 60)}"></label>
      </div>${renderPadToNearest(`modules.rotation.${index}`, item)}${renderPlaybackAdvanced(`modules.rotation.${index}`, item)}`);

    const base = `modules.${type}.${index}`;
    let body = '';
    if (type === 'fixedEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${sourceSelect(`${base}.source`, item.source)}<label>Quantidade<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label>${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'fixedDurationEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${sourceSelect(`${base}.source`, item.source)}<label>Duração (min)<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(item.durationMinutes || 60)}"></label>${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'fixedAllEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${sourceSelect(`${base}.source`, item.source)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div><div class="ss-callout">Depois que este bloco começar, todos os itens da Source terminam antes de outro módulo assumir.</div>${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'fixedWindowEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}${sourceSelect(`${base}.source`, item.source)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'windowRotations') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}<label>Bloco padrão (min)<input type="number" min="1" data-type="number" data-bind="${base}.blockMinutes" value="${esc(item.blockMinutes || 30)}"></label>${priorityInput(base, item)}</div>${renderWindowRotationItems(item, index)}${renderCommonAdvanced(base, item, false)}`;
    if (type === 'sequenceEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}<label class="check-row"><input type="checkbox" data-bind="${base}.atomic" ${item.atomic ? 'checked' : ''}><span>Sequência atômica</span></label></div>${renderSequenceSteps(item.steps || [], `${base}.steps`)}${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, false)}`;
    if (type === 'intervalEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}<label>A cada (min)<input type="number" min="1" data-type="number" data-bind="${base}.everyMinutes" value="${esc(item.everyMinutes || 30)}"></label>${modeSelect(`${base}.mode`, item.mode, false)}${intervalModeFields(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}<label>Se atrasar<select data-bind="${base}.latePolicy" data-rerender="true"><option value="queue" ${item.latePolicy === 'queue' ? 'selected' : ''}>Esperar na fila</option><option value="skip" ${item.latePolicy === 'skip' ? 'selected' : ''}>Ignorar se atrasar demais</option></select></label>${item.latePolicy === 'skip' ? `<label>Atraso máximo (min)<input type="number" min="0" data-type="number" data-bind="${base}.maxLatenessMinutes" value="${esc(item.maxLatenessMinutes ?? 10)}"></label>` : ''}</div>${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'dateEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}<label>Data e hora<input data-bind="${base}.datetime" value="${esc(item.datetime || '')}" placeholder="2026-12-24 20:00"></label>${modeSelect(`${base}.mode`, item.mode, true)}${dateModeFields(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${item.mode === 'sequence' ? renderSequenceSteps(item.steps || [], `${base}.steps`) : ''}${renderPadToNearest(base, item)}${renderPlaybackAdvanced(base, item)}`;
    if (type === 'offlineWindows') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}${priorityInput(base, item)}</div>${renderDateFilters(base, item)}`;
    return moduleEntryShell(type, index, item.label || item.id || `Item ${index + 1}`, body);
  }

  function moduleEntryShell(type, index, title, body) {
    return `<details class="ss-event-card ss-accordion-card ss-nested-accordion" ${accordionAttrs(`module-entry:${type}:${index}`)}><summary class="ss-accordion-summary ss-event-summary"><strong>${esc(title)}</strong><span>Editar</span></summary><div class="ss-accordion-body"><div class="ss-accordion-actions"><button type="button" class="danger ghost" data-ss-action="remove-module-entry" data-module="${type}" data-index="${index}">Remover</button></div>${body}</div></details>`;
  }
  function commonIdFields(base, item) {
    return `<label>ID<input data-bind="${base}.id" value="${esc(item.id || '')}"></label><label>Nome opcional<input data-bind="${base}.label" value="${esc(item.label || '')}" placeholder="Ex.: Especial da noite"></label>`;
  }
  function sourceSelect(path, value) { return `<label>Source<select data-bind="${path}">${sourceOptions(value)}</select></label>`; }
  function profileSelect(path, value) { return `<label>Presentation<select data-bind="${path}">${profileOptions(value)}</select></label>`; }
  function priorityInput(base, item) { return `<label>Prioridade<input type="number" data-type="number" data-bind="${base}.priority" value="${esc(item.priority ?? state.current.options.defaultFixedPriority ?? 100)}"></label>`; }
  function timeInput(path, value, label) { return `<label>${label}<input type="time" data-bind="${path}" value="${esc(value || '')}"></label>`; }
  function modeSelect(path, value, sequence) { return `<label>Modo<select data-bind="${path}" data-rerender="true"><option value="count" ${value === 'count' ? 'selected' : ''}>Quantidade</option><option value="duration" ${value === 'duration' ? 'selected' : ''}>Duração</option><option value="all" ${value === 'all' ? 'selected' : ''}>Todos os itens</option>${sequence ? `<option value="sequence" ${value === 'sequence' ? 'selected' : ''}>Sequência</option>` : ''}</select></label>`; }
  function intervalModeFields(base, item) {
    if (item.mode === 'duration') return `${sourceSelect(`${base}.source`, item.source)}<label>Duração (min)<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(item.durationMinutes || 60)}"></label>`;
    if (item.mode === 'all') return sourceSelect(`${base}.source`, item.source);
    return `${sourceSelect(`${base}.source`, item.source)}<label>Quantidade<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label>`;
  }
  function dateModeFields(base, item) {
    if (item.mode === 'sequence') return '';
    if (item.mode === 'duration') return `${sourceSelect(`${base}.source`, item.source)}<label>Duração (min)<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(item.durationMinutes || 60)}"></label>`;
    if (item.mode === 'all') return sourceSelect(`${base}.source`, item.source);
    return `${sourceSelect(`${base}.source`, item.source)}<label>Quantidade<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label>`;
  }

  function renderWindowRotationItems(item, index) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>Itens da rotação</strong><button type="button" data-ss-action="add-window-item" data-index="${index}">Adicionar Source</button></div>${(item.items || []).map((entry, j) => {
      const base = `modules.windowRotations.${index}.items.${j}`;
      const padEnabled = Boolean(state.current.filler && String(state.current.filler.source || '').trim()) && state.current.templateVersion === LATEST_TEMPLATE_VERSION;
      const padValue = entry.padToNearestMinutes === null || entry.padToNearestMinutes === undefined ? '' : String(entry.padToNearestMinutes);
      return `<div class="ss-inline-row ss-window-row"><select data-bind="${base}.source">${sourceOptions(entry.source)}</select><select data-bind="${base}.presentation">${profileOptions(entry.presentation)}</select><input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(entry.durationMinutes ?? '')}" placeholder="Bloco padrão"><select data-type="number" data-bind="${base}.padToNearestMinutes" ${padEnabled ? '' : 'disabled'} aria-label="Pad To Nearest Minute"><option value="" ${padValue === '' ? 'selected' : ''}>Pad: desativado</option>${PAD_TO_NEAREST_OPTIONS.map((minutes) => `<option value="${minutes}" ${padValue === String(minutes) ? 'selected' : ''}>Pad: ${minutes} min</option>`).join('')}</select><button type="button" class="danger ghost" data-ss-action="remove-window-item" data-index="${index}" data-item-index="${j}">×</button></div>`;
    }).join('')}</div>`;
  }

  function renderSequenceSteps(steps, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>Passos da sequência</strong><button type="button" data-ss-action="add-step" data-path="${esc(path)}">Adicionar passo</button></div>${steps.map((step, index) => {
      const base = `${path}.${index}`; const mode = step.mode || 'count';
      return `<div class="ss-sequence-step"><div class="ss-inline-row"><select data-bind="${base}.mode" data-rerender="true"><option value="count" ${mode === 'count' ? 'selected' : ''}>Quantidade</option><option value="duration" ${mode === 'duration' ? 'selected' : ''}>Duração</option><option value="all" ${mode === 'all' ? 'selected' : ''}>Todos</option><option value="pad_to_next" ${mode === 'pad_to_next' ? 'selected' : ''}>Até próxima marca</option><option value="wait" ${mode === 'wait' ? 'selected' : ''}>Esperar/offline</option></select>${mode !== 'wait' ? `<select data-bind="${base}.source">${sourceOptions(step.source)}</select>` : ''}${mode === 'count' ? `<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(step.count || 1)}" placeholder="Qtd.">` : ''}${['duration', 'wait'].includes(mode) ? `<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(step.durationMinutes || 1)}" placeholder="Minutos">` : ''}${mode === 'pad_to_next' ? `<input type="number" min="1" data-type="number" data-bind="${base}.minutes" value="${esc(step.minutes || 30)}" placeholder="Marca min.">` : ''}<select data-bind="${base}.presentation">${profileOptions(step.presentation)}</select><button type="button" class="danger ghost" data-ss-action="remove-step" data-path="${esc(path)}" data-index="${index}">×</button></div>${renderPlaybackAdvanced(base, step)}</div>`;
    }).join('')}</div>`;
  }

  function renderCommonAdvanced(base, item, playback) {
    return `${renderDateFilters(base, item)}${playback ? renderPlaybackAdvanced(base, item) : ''}`;
  }
  function renderDateFilters(base, item) {
    const days = Array.isArray(item.days) ? item.days : [];
    return `<details class="ss-advanced"><summary>Dias e datas</summary><div class="ss-advanced-body"><label class="check-row"><input type="checkbox" data-bind="${base}.enabled" ${item.enabled !== false ? 'checked' : ''}><span>Evento ativo</span></label><div class="ss-day-picker">${DAY_OPTIONS.map(([value, label]) => `<label><input type="checkbox" value="${value}" data-array-toggle="${base}.days" ${days.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><div class="form-grid two"><label>Data inicial<input type="date" data-bind="${base}.startDate" value="${esc(item.startDate || '')}"></label><label>Data final<input type="date" data-bind="${base}.endDate" value="${esc(item.endDate || '')}"></label><label>Somente estas datas <small>Uma por linha</small><textarea rows="2" data-type="list" data-bind="${base}.dates">${esc(listValue(item.dates))}</textarea></label><label>Excluir estas datas <small>Uma por linha</small><textarea rows="2" data-type="list" data-bind="${base}.excludeDates">${esc(listValue(item.excludeDates))}</textarea></label></div></div></details>`;
  }
  function renderPlaybackAdvanced(base, item) {
    return `<details class="ss-advanced"><summary>Reprodução avançada</summary><div class="ss-advanced-body form-grid three"><label>Título customizado<input data-bind="${base}.customTitle" value="${esc(item.customTitle || '')}"></label><label>Filler kind<input data-bind="${base}.fillerKind" value="${esc(item.fillerKind || '')}"></label><label>Fallback Source<select data-bind="${base}.fallback">${sourceOptions(item.fallback)}</select></label><label>Tentativas descartadas<input type="number" min="0" data-type="number" data-bind="${base}.discardAttempts" value="${esc(item.discardAttempts ?? '')}"></label><label class="check-row"><input type="checkbox" data-bind="${base}.disableWatermarks" ${item.disableWatermarks ? 'checked' : ''}><span>Desativar watermarks nativos</span></label><label class="check-row"><input type="checkbox" data-bind="${base}.trim" ${item.trim ? 'checked' : ''}><span>Permitir trim</span></label><label class="check-row"><input type="checkbox" data-bind="${base}.offlineTail" ${item.offlineTail ? 'checked' : ''}><span>Offline tail</span></label><label class="check-row"><input type="checkbox" data-bind="${base}.allowOverrun" ${item.allowOverrun !== false ? 'checked' : ''}><span>Deixar o vídeo terminar</span></label></div></details>`;
  }

  function renderPadToNearest(base, item) {
    const hasFiller = Boolean(state.current.filler && String(state.current.filler.source || '').trim());
    const hasMotor = state.current.templateVersion === LATEST_TEMPLATE_VERSION;
    const enabled = hasFiller && hasMotor;
    const current = item.padToNearestMinutes === null || item.padToNearestMinutes === undefined ? '' : String(item.padToNearestMinutes);
    const reason = !hasMotor
      ? `Atualize o motor para ${LATEST_TEMPLATE_VERSION} para usar esta opção.`
      : (!hasFiller ? 'Configure o Filler do projeto para liberar esta opção.' : 'Ao terminar este bloco, o Filler completa até a próxima marca do relógio escolhida.');
    return `<details class="ss-advanced"><summary>Alinhamento após o bloco</summary><div class="ss-advanced-body form-grid two"><label>Pad To Nearest Minute<select data-type="number" data-bind="${base}.padToNearestMinutes" ${enabled ? '' : 'disabled'}><option value="" ${current === '' ? 'selected' : ''}>Desativado</option>${PAD_TO_NEAREST_OPTIONS.map((minutes) => `<option value="${minutes}" ${current === String(minutes) ? 'selected' : ''}>${minutes} ${minutes === 5 ? '(:00, :05, :10, :15...)' : minutes === 10 ? '(:00, :10, :20, :30, :40, :50)' : minutes === 15 ? '(:00, :15, :30, :45)' : '(:00, :30)'}</option>`).join('')}</select><small>${esc(reason)}</small></label></div></details>`;
  }

  function clearPadToNearestSettings() {
    let cleared = 0;
    const modules = state.current.modules || {};
    for (const [type, items] of Object.entries(modules)) {
      if (type === 'offlineWindows') continue;
      for (const item of items || []) {
        if (item.padToNearestMinutes !== '' && item.padToNearestMinutes !== null && item.padToNearestMinutes !== undefined) {
          item.padToNearestMinutes = ''; cleared += 1;
        }
        if (type === 'windowRotations') {
          for (const entry of item.items || []) {
            if (entry.padToNearestMinutes !== '' && entry.padToNearestMinutes !== null && entry.padToNearestMinutes !== undefined) {
              entry.padToNearestMinutes = ''; cleared += 1;
            }
          }
        }
      }
    }
    return cleared;
  }

  function renderFiller() {
    const filler = state.current.filler;
    return `<details class="card ss-section-card ss-section-accordion" ${accordionAttrs('programming:filler')}><summary class="ss-section-summary"><div><span class="eyebrow">Filler</span><h3>Preenchimento de lacunas</h3><p>Usado quando não existe outro evento e a Rotation está vazia.</p></div><span>${filler ? 'Ativo' : 'Desativado'}</span></summary><div class="ss-section-accordion-body"><div class="ss-section-actions"><button type="button" data-ss-action="toggle-filler">${filler ? 'Desativar Filler' : 'Ativar Filler'}</button></div>${filler ? `<div class="form-grid two">${sourceSelect('filler.source', filler.source)}${profileSelect('filler.presentation', filler.presentation)}</div>${renderPlaybackAdvanced('filler', filler)}` : '<div class="empty-state">Filler desativado. Lacunas sem outros módulos ficarão sem programação.</div>'}</div></details>`;
  }

  function renderEditorSaveBar(sectionLabel) {
    return `<div class="card ss-editor-save-bar"><span>Terminou de editar ${esc(sectionLabel.toLowerCase())}? Salve sem precisar voltar ao topo.</span><div class="header-actions"><button type="button" data-ss-action="validate">Validar</button><button type="button" class="primary" data-ss-action="publish">Salvar e publicar</button></div></div>`;
  }

  function renderReview() {
    const v = state.validation;
    const counts = Object.entries(MODULE_META).map(([key, meta]) => ({ label: meta.label, count: state.current.modules[key]?.length || 0 })).filter((item) => item.count);
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><span class="eyebrow">04 · Revisão</span><h3>Resumo da programação</h3></div><button type="button" class="primary" data-ss-action="validate">Validar agora</button></div>
        <div class="metrics metrics-wide ss-review-metrics">
          <div><span>Sources</span><strong>${state.current.sources.length}</strong></div>
          <div><span>Graphics</span><strong>${state.current.graphicsGroups.length}</strong></div>
          <div><span>Playlists</span><strong>${state.current.scriptedPlaylists.length}</strong></div>
          <div><span>Profiles</span><strong>${state.current.presentationProfiles.length}</strong></div>
          <div><span>Módulos</span><strong>${counts.length}</strong></div>
          <div><span>Canais</span><strong>${state.current.channelLinks.length}</strong></div>
        </div>
        <div class="ss-summary-list">${counts.length ? counts.map((item) => `<div><strong>${esc(item.label)}</strong><span>${item.count} item(ns)</span></div>`).join('') : '<div><span>Nenhum módulo ativo.</span></div>'}</div>
        ${renderValidation(v)}
      </section>`;
  }

  function renderValidation(validation) {
    if (!validation) return '<div class="ss-validation neutral"><strong>Aguardando validação.</strong><span>Valide antes de publicar para encontrar referências ausentes e campos inválidos.</span></div>';
    const errors = validation.errors || []; const warnings = validation.warnings || [];
    return `<div class="ss-validation ${validation.ok ? 'ok' : 'danger'}"><strong>${validation.ok ? 'Configuração válida' : `${errors.length} erro(s) encontrado(s)`}</strong>${errors.length ? `<div class="ss-validation-list">${errors.map((item) => `<div><code>${esc(item.path || 'projeto')}</code><span>${esc(item.message)}</span></div>`).join('')}</div>` : ''}${warnings.length ? `<div class="ss-validation-list warnings">${warnings.map((item) => `<div><code>${esc(item.path || 'aviso')}</code><span>${esc(item.message)}</span></div>`).join('')}</div>` : ''}</div>`;
  }

  function renderPublish() {
    const p = state.current;
    const computedPath = `${String(state.settings?.outputRoot || '').replace(/\/+$/, '')}/${p.fileName}`;
    const pathChanged = Boolean(p.publishedPath && p.publishedPath !== computedPath);
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><span class="eyebrow">05 · Publicar</span><h3>Arquivo Python</h3></div><div class="header-actions"><button type="button" data-ss-action="preview">Pré-visualizar script</button><button type="button" class="primary" data-ss-action="publish">Salvar e publicar</button></div></div>
        <div class="ss-publish-path"><div><span>Caminho final</span><code>${esc(computedPath)}</code></div><button type="button" data-ss-action="copy-path" data-value="${esc(computedPath)}">Copiar</button></div>
        <div class="ss-card-meta">
          <span><strong>Estado</strong>${p.publishedAt ? 'Publicado' : 'Ainda não publicado'}</span>
          <span><strong>Última publicação</strong>${p.publishedAt ? esc(formatDate(p.publishedAt)) : '-'}</span>
          <span><strong>SHA-256</strong>${p.publishedHash ? `<code>${esc(p.publishedHash.slice(0, 16))}…</code>` : '-'}</span>
        </div>
        ${pathChanged ? `<div class="ss-callout warning"><strong>O caminho mudou.</strong> O arquivo já publicado continua em <code>${esc(p.publishedPath)}</code>. Depois de publicar com o novo nome/caminho, atualize também o Scripted Schedule no ErsatzTV.</div>` : ''}
        <div class="ss-callout">O primeiro cadastro deste caminho no Scripted Schedule do Playout continua sendo feito manualmente no ErsatzTV. Depois disso, salvar novamente mantém o mesmo arquivo atualizado.</div>
      </section>
      ${renderLinksAssistant(computedPath)}
      <section class="card ss-section-card">
        <div class="section-heading"><div><h3>Prévia do script</h3><p>Somente leitura. A configuração visual continua sendo a fonte de verdade.</p></div>${state.preview ? '' : '<button type="button" data-ss-action="preview">Carregar prévia</button>'}</div>
        ${state.preview ? `<pre class="ss-code-preview">${esc(state.preview)}</pre>` : '<div class="empty-state">Carregue a prévia para conferir o Python atualmente salvo.</div>'}
      </section>
      <section class="card ss-section-card">
        <div class="section-heading"><div><h3>Histórico</h3><p>As últimas publicações podem ser restauradas sem apagar as revisões intermediárias.</p></div><button type="button" data-ss-action="history">Atualizar histórico</button></div>
        ${state.history.length ? `<div class="ss-history-list">${state.history.map((item) => `<div><span><strong>${esc(formatDate(item.revisionAt))}</strong><small>${esc(item.reason || 'publish')} · ${esc(item.publishedHash ? item.publishedHash.slice(0, 12) : 'sem hash')}</small></span><button type="button" data-ss-action="restore" data-revision="${esc(item.id)}">Restaurar</button></div>`).join('')}</div>` : '<div class="empty-state">Carregue o histórico para ver revisões anteriores.</div>'}
      </section>`;
  }

  function renderLinksAssistant(filePath) {
    if (!state.current.channelLinks.length) return `
      <section class="card ss-section-card"><div class="section-heading"><div><h3>Assistente de vínculo</h3><p>Adicione um canal na etapa Geral para preparar os dados de vínculo.</p></div></div></section>`;
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><h3>Assistente de vínculo</h3><p>Use estes dados ao configurar o Scripted Schedule no Playout do ErsatzTV.</p></div></div>
        <div class="ss-stack">${state.current.channelLinks.map((link) => `<div class="ss-link-card"><div><span>Canal</span><strong>${esc(link.channelName || link.channelNumber)}</strong></div><div><span>Script</span><code>${esc(filePath)}</code></div><div><span>state_key</span><code>${esc(link.stateKey || '')}</code></div><div class="header-actions"><button type="button" data-ss-action="copy-path" data-value="${esc(filePath)}">Copiar caminho</button><button type="button" data-ss-action="copy-path" data-value="${esc(link.stateKey || '')}">Copiar state_key</button><button type="button" class="danger" data-ss-action="reset-playout" data-channel="${esc(link.channelNumber)}">Reset Playout</button></div></div>`).join('')}</div>
      </section>`;
  }

  function formatDate(value) {
    if (!value) return '-';
    try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
    catch { return String(value); }
  }

  window.ScriptedSchedulesView = { init, refresh: reloadList };
})();
