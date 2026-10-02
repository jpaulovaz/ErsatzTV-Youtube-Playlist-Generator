(function destinationFormModule(global) {
  const DEFAULT_LANGUAGES = ['pt-BR', 'pt', 'en', 'es'];
  const ORPHAN_POLICY_LABELS = {
    delete: 'Excluir automaticamente',
    mark: 'Marcar como órfão',
    quarantine: 'Mover para quarentena recuperável'
  };
  const PROFILE_LABELS = {
    generic: 'Genérico',
    movie: 'Show / vídeo completo (Filmes)',
    music_clips: 'Clipes musicais (Seriados)'
  };

  let ersatzTvCatalog = {
    channels: [],
    smartCollections: [],
    smartCollectionSelections: {},
    channelsAvailable: false,
    smartCollectionsAvailable: false
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function numberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
  }

  function setErsatzTvCatalog(value) {
    const raw = value && typeof value === 'object' ? value : {};
    ersatzTvCatalog = {
      channels: Array.isArray(raw.channels) ? raw.channels : [],
      smartCollections: Array.isArray(raw.smartCollections) ? raw.smartCollections : [],
      smartCollectionSelections: raw.smartCollectionSelections && typeof raw.smartCollectionSelections === 'object'
        ? raw.smartCollectionSelections
        : {},
      channelsAvailable: Boolean(raw.channelsAvailable),
      smartCollectionsAvailable: Boolean(raw.smartCollectionsAvailable)
    };
  }

  function getErsatzTvCatalog() {
    return ersatzTvCatalog;
  }

  function channelNameFor(channelNumber, fallback = '') {
    const number = String(channelNumber || '').trim();
    const match = ersatzTvCatalog.channels.find((channel) => String(channel.number || '').trim() === number);
    return match && match.name ? match.name : String(fallback || '').trim();
  }

  function channelOptions(currentNumber, currentName) {
    const selectedValue = String(currentNumber || '').trim();
    const options = ['<option value="">Nenhum</option>'];
    const values = new Set();
    for (const channel of ersatzTvCatalog.channels) {
      const value = String(channel.number || '').trim();
      const name = String(channel.name || '').trim();
      if (!value || !name || values.has(value)) continue;
      values.add(value);
      options.push(`<option value="${escapeHtml(value)}" data-name="${escapeHtml(name)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(name)}</option>`);
    }
    if (selectedValue && !values.has(selectedValue)) {
      const label = String(currentName || '').trim() || 'Canal configurado';
      options.push(`<option value="${escapeHtml(selectedValue)}" data-name="${escapeHtml(label)}" selected>${escapeHtml(label)}</option>`);
    }
    return options.join('');
  }

  function smartCollectionOptions() {
    if (!ersatzTvCatalog.smartCollectionsAvailable) {
      return '<option value="">Indisponível</option>';
    }
    return [
      '<option value="">Selecionar...</option>',
      '<option value="__new__">Criar nova...</option>',
      ...ersatzTvCatalog.smartCollections.map((collection) => (
        `<option value="${Number(collection.id) || ''}">${escapeHtml(collection.name || '')}</option>`
      ))
    ].join('');
  }

  function lastSmartCollectionName(libraryId) {
    const id = numberOrNull(libraryId);
    if (!id) return '';
    const selection = ersatzTvCatalog.smartCollectionSelections[String(id)];
    if (!selection || typeof selection !== 'object') return '';
    const collectionId = numberOrNull(selection.id);
    const current = collectionId
      ? ersatzTvCatalog.smartCollections.find((item) => Number(item.id) === collectionId)
      : null;
    return String(current && current.name || selection.name || '').trim();
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
    const libraryId = entity && entity.libraryId || '';
    const currentChannelNumber = entity && entity.channelNumber || '';
    const currentChannelName = entity && entity.channelName || '';
    const orphanPolicy = entity && entity.orphanPolicy || '';
    const quarantineRetentionDays = entity && entity.quarantineRetentionDays == null ? '' : String(entity.quarantineRetentionDays);

    return `
      <div class="form-grid three destination-fields" data-destination-mode="${escapeHtml(mode)}">
        ${includeName ? `<label>Nome<input data-field="name" type="text" value="${escapeHtml(entity && entity.name || '')}"></label>` : ''}
        ${includeIds ? `<label>Library ID<input data-field="libraryId" type="number" min="1" value="${libraryId}"></label>
        <label>Canal no ErsatzTV
          <select data-field="channelNumber" data-current-name="${escapeHtml(currentChannelName)}">
            ${channelOptions(currentChannelNumber, currentChannelName)}
          </select>
        </label>
        <div class="wide destination-smart-collection ${libraryId ? '' : 'hidden'}" data-smart-collection-region>
          <label class="destination-smart-collection-picker">Smart Collection
            <select data-smart-collection-select ${ersatzTvCatalog.smartCollectionsAvailable ? '' : 'disabled'}>
              ${smartCollectionOptions()}
            </select>
          </label>
          <div class="destination-smart-collection-last" data-smart-collection-last>
            <span>Última</span>
            <strong>${escapeHtml(lastSmartCollectionName(libraryId) || '—')}</strong>
          </div>
        </div>` : ''}
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
        <label>Arquivos órfãos
          <select data-field="orphanPolicy">
            <option value="" ${orphanPolicy === '' ? 'selected' : ''}>Selecione...</option>
            ${Object.entries(ORPHAN_POLICY_LABELS).map(([value, label]) => `<option value="${value}" ${orphanPolicy === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="${orphanPolicy === 'quarantine' ? '' : 'hidden'}" data-quarantine-retention>Retenção da quarentena
          <select data-field="quarantineRetentionDays">
            <option value="" ${quarantineRetentionDays === '' ? 'selected' : ''}>Nunca</option>
            ${[30, 90, 180].map((days) => `<option value="${days}" ${quarantineRetentionDays === String(days) ? 'selected' : ''}>${days} dias</option>`).join('')}
          </select>
        </label>
        <label class="check-row"><input data-field="enabled" type="checkbox" ${enabled ? 'checked' : ''}><span>${escapeHtml(enabledLabel)}</span></label>
        <label class="wide">cookies.txt, opcional<input data-field="cookiesPath" type="text" value="${escapeHtml(entity && entity.cookiesPath || '')}" placeholder="Vazio usa a configuração global"></label>
        ${renderSubtitleSettings(entity && entity.subtitles)}
      </div>`;
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
    if (read('channelNumber')) {
      result.channelNumber = numberOrNull(read('channelNumber').value);
      const selected = read('channelNumber').selectedOptions && read('channelNumber').selectedOptions[0];
      result.channelName = result.channelNumber && selected
        ? String(selected.dataset.name || selected.textContent || '').trim()
        : '';
    }
    if (read('cookiesPath')) result.cookiesPath = read('cookiesPath').value.trim();
    if (read('maxHeight')) result.maxHeight = numberOrNull(read('maxHeight').value);
    if (read('mediaProfile')) result.mediaProfile = read('mediaProfile').value;
    if (read('orphanPolicy')) result.orphanPolicy = read('orphanPolicy').value;
    if (read('quarantineRetentionDays')) result.quarantineRetentionDays = numberOrNull(read('quarantineRetentionDays').value);
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


  function syncOrphanControls(container) {
    container.querySelectorAll('.destination-fields').forEach((fields) => {
      const policy = fields.querySelector('[data-field="orphanPolicy"]');
      const retention = fields.querySelector('[data-quarantine-retention]');
      if (!policy || !retention) return;
      const apply = () => {
        const visible = policy.value === 'quarantine';
        retention.classList.toggle('hidden', !visible);
        const select = retention.querySelector('[data-field="quarantineRetentionDays"]');
        if (select) select.disabled = !visible;
      };
      if (!policy.dataset.boundOrphanToggle) {
        policy.addEventListener('change', apply);
        policy.dataset.boundOrphanToggle = '1';
      }
      apply();
    });
  }

  function syncErsatzTvControls(container) {
    container.querySelectorAll('.destination-fields').forEach((fields) => {
      const libraryInput = fields.querySelector('[data-field="libraryId"]');
      const smartRegion = fields.querySelector('[data-smart-collection-region]');
      if (libraryInput && smartRegion) {
        const apply = () => {
          const hasLibrary = Boolean(numberOrNull(libraryInput.value));
          smartRegion.classList.toggle('hidden', !hasLibrary);
          const select = smartRegion.querySelector('[data-smart-collection-select]');
          if (select) select.disabled = !hasLibrary || !ersatzTvCatalog.smartCollectionsAvailable;
          const last = smartRegion.querySelector('[data-smart-collection-last] strong');
          if (last) last.textContent = lastSmartCollectionName(libraryInput.value) || '—';
        };
        if (!libraryInput.dataset.boundSmartCollectionToggle) {
          libraryInput.addEventListener('input', apply);
          libraryInput.dataset.boundSmartCollectionToggle = '1';
        }
        apply();
      }
    });
  }

  function refreshCatalogControls(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-field="channelNumber"]').forEach((select) => {
      const currentValue = String(select.value || '').trim();
      const currentName = String(select.selectedOptions?.[0]?.dataset.name || select.dataset.currentName || '').trim();
      select.innerHTML = channelOptions(currentValue, currentName);
      select.disabled = !ersatzTvCatalog.channelsAvailable && !currentValue;
    });
    scope.querySelectorAll('[data-smart-collection-select]').forEach((select) => {
      select.innerHTML = smartCollectionOptions();
      select.value = '';
      const fields = select.closest('.destination-fields');
      const libraryInput = fields && fields.querySelector('[data-field="libraryId"]');
      const last = fields && fields.querySelector('[data-smart-collection-last] strong');
      if (last) last.textContent = lastSmartCollectionName(libraryInput && libraryInput.value) || '—';
    });
    syncErsatzTvControls(scope);
    syncOrphanControls(scope);
  }

  global.DestinationForm = {
    DEFAULT_LANGUAGES,
    PROFILE_LABELS,
    ORPHAN_POLICY_LABELS,
    normalizedSubtitles,
    renderSubtitleSettings,
    renderFields,
    collect,
    syncSubtitleControls,
    syncOrphanControls,
    syncErsatzTvControls,
    setErsatzTvCatalog,
    getErsatzTvCatalog,
    refreshCatalogControls,
    channelNameFor
  };
})(window);
