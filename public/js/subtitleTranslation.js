(() => {
  'use strict';
  let deps = null;
  let context = null;
  let options = null;
  let currentPlan = null;
  let statusTimer = null;
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => deps && deps.escapeHtml ? deps.escapeHtml(String(value ?? '')) : String(value ?? '');

  function languageLabel(code) {
    return ({ 'pt-BR': 'Português (Brasil)', en: 'English', es: 'Español' })[code] || code;
  }

  function contentContext() {
    return deps && deps.getContentContext ? deps.getContentContext() : {};
  }

  function panelOpen() { return !$('#subtitleTranslationPanel')?.classList.contains('hidden'); }

  function buildPayload() {
    const current = contentContext();
    return {
      sourceLanguage: $('#translationSourceLanguage')?.value || 'en',
      targetLanguage: $('#translationTargetLanguage')?.value || 'pt-BR',
      outputMode: $('#translationOutputMode')?.value || 'translated',
      scope: $('#translationScope')?.value || 'filtered',
      existingPolicy: $('#translationExistingPolicy')?.value || 'skip',
      filter: {
        view: current.view || 'content', query: current.query || '', path: current.path || '', subtitleOrigin: current.subtitleOrigin || 'all'
      }
    };
  }

  function invalidatePlan() {
    currentPlan = null;
    const start = $('#translationStartBtn'); if (start) start.disabled = true;
    const box = $('#translationPlanSummary'); if (box) box.innerHTML = '<span class="muted">Execute a pré-análise antes de iniciar.</span>';
  }

  function renderOptions() {
    const panel = $('#subtitleTranslationPanel'); if (!panel || !context) return;
    const counts = options && options.languageCounts || {};
    const sourceCodes = Object.keys(counts).filter((code) => code && code !== 'und' && counts[code] > 0).sort((a, b) => a.localeCompare(b));
    const defaultSource = sourceCodes.includes('en') ? 'en' : sourceCodes[0] || '';
    const cfg = options && options.config || {};
    panel.innerHTML = `
      <div class="subtitle-translation-head">
        <div><span class="page-kicker">Operação em massa</span><h3>Traduzir legendas</h3><p>A legenda-fonte e seus timestamps são preservados. O texto é enviado ao Gemini somente após confirmação.</p></div>
        <button type="button" class="small" data-translation-close>Fechar</button>
      </div>
      <div class="subtitle-translation-grid">
        <label>Legenda-fonte<select id="translationSourceLanguage">${sourceCodes.length ? sourceCodes.map((code) => `<option value="${esc(code)}" ${code === defaultSource ? 'selected' : ''}>${esc(languageLabel(code))} (${esc(code)}) · ${counts[code]}</option>`).join('') : '<option value="">Nenhuma legenda identificada</option>'}</select></label>
        <label>Idioma de destino<select id="translationTargetLanguage"><option value="pt-BR">Português (Brasil)</option><option value="en">English</option><option value="es">Español</option></select></label>
        <label>Formato de saída<select id="translationOutputMode"><option value="translated">Somente traduzida</option><option value="bilingual">Somente bilíngue (original + tradução)</option><option value="both">Traduzida + bilíngue</option></select></label>
        <label>Escopo<select id="translationScope"><option value="filtered">Resultado filtrado atual</option><option value="all">Toda a biblioteca / playlist</option></select></label>
        <label>Se destino existir<select id="translationExistingPolicy"><option value="skip">Ignorar</option><option value="replace">Substituir com histórico</option></select></label>
      </div>
      <div class="subtitle-translation-actions"><button id="translationPlanBtn" type="button">Pré-analisar</button><button id="translationStartBtn" type="button" class="primary" disabled>Iniciar tradução</button></div>
      <div id="translationPlanSummary" class="subtitle-translation-summary"><span class="muted">Execute a pré-análise antes de iniciar.</span></div>
      <div id="translationQueueSummary" class="subtitle-translation-queue"></div>`;
    if (cfg.defaultTargetLanguage && $('#translationTargetLanguage')) $('#translationTargetLanguage').value = cfg.defaultTargetLanguage;
    if (cfg.defaultOutputMode && $('#translationOutputMode')) $('#translationOutputMode').value = cfg.defaultOutputMode;
    panel.querySelectorAll('select').forEach((select) => select.addEventListener('change', invalidatePlan));
    refreshQueueStatus().catch(() => {});
  }

  async function loadOptions() {
    if (!context?.endpointBase) return;
    const response = await deps.api(`${context.endpointBase}/subtitle-translation-options`);
    options = response.result || {};
    renderOptions();
  }

  async function open() {
    if (!context?.endpointBase) return;
    $('#subtitleTranslationPanel')?.classList.remove('hidden');
    await loadOptions();
    startPolling();
  }
  function close() { $('#subtitleTranslationPanel')?.classList.add('hidden'); stopPolling(); }

  async function runPlan() {
    if (!$('#translationSourceLanguage')?.value) throw new Error('Nenhuma legenda-fonte identificada neste escopo.');
    const payload = buildPayload();
    const response = await deps.api(`${context.endpointBase}/subtitle-translation-plan`, { method: 'POST', body: JSON.stringify(payload) });
    currentPlan = response.result;
    const c = currentPlan.counts || {}; const t = currentPlan.totals || {};
    $('#translationPlanSummary').innerHTML = `
      <div class="translation-metrics">
        <span><strong>${c.eligible || 0}</strong> itens elegíveis</span>
        <span><strong>${c.translatedToWrite || 0}</strong> traduções a gerar</span>
        <span><strong>${c.bilingualToWrite || 0}</strong> bilíngues a gerar</span>
        <span><strong>${c.translatedExists || 0}</strong> traduzidas existentes</span>
        <span><strong>${c.bilingualExists || 0}</strong> bilíngues existentes</span>
        <span><strong>${c.sourceMissing || 0}</strong> fonte ausente</span>
        <span><strong>${c.sourceInvalid || 0}</strong> SRT inválido</span>
        <span><strong>${t.translatableCues || 0}</strong> cues enviados</span>
        <span><strong>~${t.estimatedTokens || 0}</strong> tokens estimados</span>
      </div>`;
    $('#translationStartBtn').disabled = !(c.eligible > 0);
  }

  async function startJob() {
    if (!currentPlan) return;
    const decision = await deps.showDialog({ eyebrow: 'Tradução de legendas', title: `Traduzir ${currentPlan.counts.eligible} item(ns)?`, message: 'O texto das legendas será enviado ao Google Gemini. A legenda-fonte nunca será alterada.', danger: false, confirmLabel: 'Iniciar tradução' });
    if (!decision.confirmed) return;
    const response = await deps.api(`${context.endpointBase}/subtitle-translation-start`, { method: 'POST', body: JSON.stringify(buildPayload()) });
    deps.showToast('Fila de tradução iniciada.');
    currentPlan = null; $('#translationStartBtn').disabled = true;
    await refreshQueueStatus(); startPolling();
  }

  function queueHtml(status) {
    const job = status && status.activeJob;
    if (!job) return '<span class="muted">Nenhuma tradução em massa ativa.</span>';
    const c = job.counts || {};
    return `<div class="translation-queue-card"><div><strong>${esc(job.status)}</strong><span>${c.completed || 0}/${c.total || 0} concluídos · ${c.failed || 0} falhas · ${c.skipped || 0} ignorados</span></div>
      <progress max="${Math.max(1, c.total || 1)}" value="${(c.completed || 0) + (c.failed || 0) + (c.skipped || 0) + (c.cancelled || 0)}"></progress>
      <div class="inline-actions"><button type="button" class="small" data-translation-queue="${status.paused ? 'resume' : 'pause'}">${status.paused ? 'Retomar' : 'Pausar'}</button><button type="button" class="small danger" data-translation-queue="cancel">Cancelar pendentes</button></div>
      ${(job.failures || []).length ? `<details><summary>Falhas recentes (${job.failures.length})</summary><ul>${job.failures.map((f) => `<li>${esc(f.title || f.itemId)}: ${esc(f.error)}</li>`).join('')}</ul></details>` : ''}</div>`;
  }

  async function refreshQueueStatus() {
    if (!deps) return;
    const response = await deps.api('/api/subtitle-translation/status');
    const box = $('#translationQueueSummary'); if (box) box.innerHTML = queueHtml(response.result || {});
  }
  function startPolling() { stopPolling(); statusTimer = setInterval(() => refreshQueueStatus().catch(() => {}), 2000); }
  function stopPolling() { if (statusTimer) clearInterval(statusTimer); statusTimer = null; }

  async function queueAction(action) {
    await deps.api(`/api/subtitle-translation/${action}`, { method: 'POST', body: JSON.stringify({}) });
    await refreshQueueStatus();
  }

  async function loadTranslationSettings() {
    if (!$('#translationSettingsModel')) return;
    const response = await deps.api('/api/subtitle-translation/config'); const cfg = response.result || {};
    $('#translationSettingsModel').value = cfg.model || 'gemini-3.6-flash';
    $('#translationSettingsBatchSize').value = cfg.batchSize || 300;
    $('#translationSettingsConcurrency').value = cfg.concurrency || 1;
    $('#translationSettingsTimeout').value = cfg.timeoutSeconds || 60;
    $('#translationSettingsAttempts').value = cfg.maxAttempts || 3;
    $('#translationSettingsTarget').value = cfg.defaultTargetLanguage || 'pt-BR';
    $('#translationSettingsOutput').value = cfg.defaultOutputMode || 'translated';
    $('#translationSettingsKeyStatus').textContent = cfg.configured ? `Chave configurada (${cfg.apiKeySource === 'environment' ? 'GEMINI_API_KEY' : 'arquivo local'})` : 'Chave não configurada';
    $('#translationSettingsApiKey').value = '';
  }

  function settingsPayload(includeKey = true) {
    const payload = {
      model: $('#translationSettingsModel')?.value.trim(), batchSize: Number($('#translationSettingsBatchSize')?.value) || 300,
      concurrency: Number($('#translationSettingsConcurrency')?.value) || 1, timeoutSeconds: Number($('#translationSettingsTimeout')?.value) || 60,
      maxAttempts: Number($('#translationSettingsAttempts')?.value) || 3, defaultTargetLanguage: $('#translationSettingsTarget')?.value || 'pt-BR', defaultOutputMode: $('#translationSettingsOutput')?.value || 'translated'
    };
    if (includeKey && $('#translationSettingsApiKey')?.value.trim()) payload.apiKey = $('#translationSettingsApiKey').value.trim();
    return payload;
  }

  async function saveSettings() { await deps.api('/api/subtitle-translation/config', { method: 'PUT', body: JSON.stringify(settingsPayload(true)) }); await loadTranslationSettings(); deps.showToast('Configuração de tradução salva.'); }
  async function testSettings() { const response = await deps.api('/api/subtitle-translation/config/test', { method: 'POST', body: JSON.stringify({ ...settingsPayload(false), apiKey: $('#translationSettingsApiKey')?.value.trim() || '' }) }); deps.showToast(`Gemini conectado: ${response.result.model.displayName || response.result.model.name}`); }
  async function loadModels() {
    const response = await deps.api('/api/subtitle-translation/models');
    const list = $('#translationSettingsModels'); if (list) list.innerHTML = (response.result.models || []).map((model) => `<option value="${esc(model.name)}">${esc(model.displayName)}</option>`).join('');
    deps.showToast(`${(response.result.models || []).length} modelo(s) compatível(is) encontrados.`);
  }

  function bind() {
    $('#subtitleTranslationToggle')?.addEventListener('click', () => (panelOpen() ? close() : open().catch((e) => deps.showToast(e.message, true))));
    $('#subtitleTranslationPanel')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-translation-close]')) { close(); return; }
      if (event.target.closest('#translationPlanBtn')) { runPlan().catch((e) => deps.showToast(e.message, true)); return; }
      if (event.target.closest('#translationStartBtn')) { startJob().catch((e) => deps.showToast(e.message, true)); return; }
      const queue = event.target.closest('[data-translation-queue]'); if (queue) queueAction(queue.dataset.translationQueue).catch((e) => deps.showToast(e.message, true));
    });
    $('#translationSettingsSave')?.addEventListener('click', () => saveSettings().catch((e) => deps.showToast(e.message, true)));
    $('#translationSettingsTest')?.addEventListener('click', () => testSettings().catch((e) => deps.showToast(e.message, true)));
    $('#translationSettingsLoadModels')?.addEventListener('click', () => loadModels().catch((e) => deps.showToast(e.message, true)));
  }

  function configure(nextDeps) { deps = nextDeps; bind(); loadTranslationSettings().catch(() => {}); }
  function setContext(next) { context = next; options = null; currentPlan = null; if (panelOpen()) loadOptions().catch((e) => deps.showToast(e.message, true)); }
  window.SubtitleTranslationUI = { configure, setContext, close, refreshQueueStatus };
})();
