(function destinationFormModule(global) {
  const DEFAULT_LANGUAGES = ['pt-BR', 'pt', 'en', 'es'];
  const PROFILE_LABELS = {
    generic: 'Genérico',
    movie: 'Show / vídeo completo (Filmes)',
    music_clips: 'Clipes musicais (Seriados)'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizedSubtitles(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      enabled: Boolean(raw.enabled),
      includeAuto: raw.includeAuto !== false,
      languages: Array.isArray(raw.languages) ? raw.languages : [...DEFAULT_LANGUAGES]
    };
  }

  function renderSubtitleSettings(value, options = {}) {
    const subtitles = normalizedSubtitles(value);
    const disabled = subtitles.enabled ? '' : 'disabled';
    const compact = options.compact === true;
    return `
      <div class="wide library-subtitle-settings ${compact ? 'compact-subtitle-settings' : ''}">
        <div class="library-subtitle-heading"><strong>Legendas</strong><span class="badge info">SRT</span></div>
        <label class="check-row"><input data-field="subtitlesEnabled" type="checkbox" ${subtitles.enabled ? 'checked' : ''}><span>Baixar legendas</span></label>
        <div class="subtitle-options ${subtitles.enabled ? '' : 'is-disabled'}" data-subtitle-options>
          <label class="check-row"><input data-field="subtitlesIncludeAuto" type="checkbox" ${subtitles.includeAuto ? 'checked' : ''} ${disabled}><span>Incluir automáticas</span></label>
          <div class="subtitle-language-grid" role="group" aria-label="Idiomas de legenda">
            ${[
              ['pt-BR', 'Português (Brasil)'],
              ['pt', 'Português'],
              ['en', 'English'],
              ['es', 'Español']
            ].map(([code, label]) => `
              <label class="subtitle-language-option">
                <input data-subtitle-language type="checkbox" value="${code}" ${subtitles.languages.includes(code) ? 'checked' : ''} ${disabled}>
                <span>${label}<small>${code}</small></span>
              </label>
            `).join('')}
          </div>
        </div>
      </div>`;
  }

  function renderFields(entity, options = {}) {
    const mode = options.mode || 'library';
    const maxHeight = entity && entity.maxHeight != null ? String(entity.maxHeight) : '';
    const mediaProfile = entity && entity.mediaProfile || 'generic';
    const enabled = !entity || entity.enabled !== false;
    const includeName = options.includeName !== false;
    const includeIds = options.includeIds !== false;
    const includeUrls = options.includeUrls === true;
    const sourceUrl = String(options.sourceUrl || '').trim();
    const enabledLabel = options.enabledLabel || (mode === 'channel-playlist' ? 'Playlist ativa' : 'Biblioteca ativa');

    return `
      <div class="form-grid three destination-fields" data-destination-mode="${escapeHtml(mode)}">
        ${includeName ? `<label>Nome<input data-field="name" type="text" value="${escapeHtml(entity && entity.name || '')}"></label>` : ''}
        ${includeIds ? `<label>Library ID<input data-field="libraryId" type="number" min="1" value="${entity && entity.libraryId || ''}"></label>
        <label>Número do canal<input data-field="channelNumber" type="number" min="1" value="${entity && entity.channelNumber || ''}"></label>` : ''}
        ${includeUrls ? `<label class="wide">Fontes, uma URL por linha<textarea data-field="urls" rows="4">${escapeHtml((entity && entity.urls || []).join('\n'))}</textarea></label>` : ''}
        ${sourceUrl ? `<label class="wide">Fonte<input type="text" value="${escapeHtml(sourceUrl)}" readonly></label>` : ''}
        <label>Resolução
          <select data-field="maxHeight">
            <option value="" ${maxHeight === '' ? 'selected' : ''}>Herdar geral</option>
            ${[360, 480, 720, 1080, 1440, 2160].map((height) => `<option value="${height}" ${maxHeight === String(height) ? 'selected' : ''}>${height}p</option>`).join('')}
          </select>
        </label>
        <label>Perfil
          <select data-field="mediaProfile">
            ${Object.entries(PROFILE_LABELS).map(([value, label]) => `<option value="${value}" ${mediaProfile === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="check-row"><input data-field="enabled" type="checkbox" ${enabled ? 'checked' : ''}><span>${escapeHtml(enabledLabel)}</span></label>
        <label class="wide">cookies.txt, opcional<input data-field="cookiesPath" type="text" value="${escapeHtml(entity && entity.cookiesPath || '')}" placeholder="Vazio usa a configuração global"></label>
        ${renderSubtitleSettings(entity && entity.subtitles)}
      </div>`;
  }

  function numberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
  }

  function collect(container, base = {}, options = {}) {
    const result = { ...base };
    const read = (name) => container.querySelector(`[data-field="${name}"]`);
    if (read('name')) result.name = read('name').value.trim();
    if (read('urls')) {
      const urls = read('urls').value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      result.url = urls[0] || '';
      result.urls = urls;
    }
    if (read('libraryId')) result.libraryId = numberOrNull(read('libraryId').value);
    if (read('channelNumber')) result.channelNumber = numberOrNull(read('channelNumber').value);
    if (read('cookiesPath')) result.cookiesPath = read('cookiesPath').value.trim();
    if (read('maxHeight')) result.maxHeight = numberOrNull(read('maxHeight').value);
    if (read('mediaProfile')) result.mediaProfile = read('mediaProfile').value;
    if (read('enabled')) result.enabled = read('enabled').checked;
    if (read('subtitlesEnabled')) {
      result.subtitles = {
        enabled: read('subtitlesEnabled').checked,
        includeAuto: read('subtitlesIncludeAuto') ? read('subtitlesIncludeAuto').checked : true,
        languages: [...container.querySelectorAll('[data-subtitle-language]')]
          .filter((input) => input.checked)
          .map((input) => input.value)
      };
    }
    return result;
  }

  function syncSubtitleControls(container) {
    container.querySelectorAll('[data-field="subtitlesEnabled"]').forEach((checkbox) => {
      const region = checkbox.closest('.library-subtitle-settings');
      const options = region && region.querySelector('[data-subtitle-options]');
      if (!options) return;
      const apply = () => {
        options.classList.toggle('is-disabled', !checkbox.checked);
        options.querySelectorAll('input').forEach((input) => { input.disabled = !checkbox.checked; });
      };
      if (!checkbox.dataset.boundSubtitleToggle) {
        checkbox.addEventListener('change', apply);
        checkbox.dataset.boundSubtitleToggle = '1';
      }
      apply();
    });
  }

  global.DestinationForm = {
    DEFAULT_LANGUAGES,
    PROFILE_LABELS,
    normalizedSubtitles,
    renderSubtitleSettings,
    renderFields,
    collect,
    syncSubtitleControls
  };
})(window);
