let currentConfig = null;
let refreshTimer = null;
let latestHealth = {};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function showToast(message) {
  const toast = qs('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error((payload && payload.error) || `HTTP ${response.status}`);
  }

  return payload;
}

function getByPath(object, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), object);
}

function setByPath(object, dottedPath, value) {
  const parts = dottedPath.split('.');
  let target = object;
  while (parts.length > 1) {
    const key = parts.shift();
    target[key] = target[key] || {};
    target = target[key];
  }
  target[parts[0]] = value;
}

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function streamMaxHeight(value) {
  return optionalNumber(value) || 720;
}

function splitPlaylistUrls(value) {
  const seen = new Set();
  const urls = [];

  for (const line of String(value || '').split(/\r?\n/)) {
    const url = line.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function getPlaylistUrls(playlist) {
  const values = [];
  if (playlist && typeof playlist.url === 'string') values.push(playlist.url);
  if (playlist && Array.isArray(playlist.urls)) values.push(...playlist.urls);
  return splitPlaylistUrls(values.join('\n'));
}

const CODEC_PROFILE_OPTIONS = ['auto', 'mp4_h264_aac'];

function normalizeCodecProfile(value) {
  return CODEC_PROFILE_OPTIONS.includes(value) ? value : 'auto';
}

function buildCompatibleFormat(maxHeight, codecProfile = 'auto') {
  const height = streamMaxHeight(maxHeight);
  const profile = normalizeCodecProfile(codecProfile);

  if (profile === 'mp4_h264_aac') {
    return `best[height<=${height}][ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[height<=${height}][ext=mp4][vcodec!=none][acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
  }

  return `best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
}

function buildHighQualityFormat(maxHeight, codecProfile = 'auto') {
  const height = streamMaxHeight(maxHeight);
  const profile = normalizeCodecProfile(codecProfile);

  if (profile === 'mp4_h264_aac') {
    return `bestvideo[height<=${height}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec^=mp4a]/bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=${height}][ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
  }

  return `bestvideo[height<=${height}][vcodec!=none]+bestaudio[acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`;
}

function buildFormatSort(maxHeight) {
  return `res:${streamMaxHeight(maxHeight)},fps`;
}

const JS_RUNTIME_DEFAULT_PATHS = {
  deno: '/usr/local/bin/deno',
  node: '/usr/bin/node',
  custom: ''
};
const JS_RUNTIME_MODES = ['disabled', 'deno', 'node', 'custom'];
const EJS_COMPONENT_OPTIONS = ['none', 'ejs:github', 'ejs:npm'];

function defaultJsRuntimePath(mode) {
  return JS_RUNTIME_DEFAULT_PATHS[mode] || '';
}

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function refreshYtDlpJsUi(applyDefaults = false) {
  const modeField = qs('[name="stream.jsRuntimeMode"]');
  const pathField = qs('[name="stream.jsRuntimePath"]');
  const customNameField = qs('[name="stream.jsRuntimeCustomName"]');
  const customNameWrapper = qs('[data-js-runtime-custom]');
  const ejsField = qs('[name="stream.ejsComponents"]');

  if (!modeField) return;

  const mode = JS_RUNTIME_MODES.includes(modeField.value) ? modeField.value : 'deno';
  const defaultPath = defaultJsRuntimePath(mode);

  if (pathField) {
    pathField.placeholder = defaultPath || 'Ex.: /usr/local/bin/deno';
    if (applyDefaults && mode !== 'custom') {
      pathField.value = defaultPath;
    } else if (!pathField.value.trim() && defaultPath) {
      pathField.value = defaultPath;
    }

    pathField.readOnly = mode === 'disabled';
    pathField.classList.toggle('readonly', mode === 'disabled');
  }

  if (customNameWrapper) {
    customNameWrapper.classList.toggle('hidden', mode !== 'custom');
  }

  if (customNameField) {
    customNameField.readOnly = mode !== 'custom';
    customNameField.classList.toggle('readonly', mode !== 'custom');
    if (!customNameField.value.trim()) customNameField.value = 'deno';
  }

  if (ejsField && applyDefaults) {
    if (mode === 'disabled') {
      ejsField.value = 'none';
    } else if (!EJS_COMPONENT_OPTIONS.includes(ejsField.value) || ejsField.value === 'none') {
      ejsField.value = 'ejs:github';
    }
  }
}

function resolveFormatForMode(mode, maxHeight, currentFormat, codecProfile = 'auto') {
  const profile = normalizeCodecProfile(codecProfile);
  if (mode === 'compatible') return buildCompatibleFormat(maxHeight, profile);
  if (mode === 'high') return buildHighQualityFormat(maxHeight, profile);
  return String(currentFormat || '').trim() || buildCompatibleFormat(maxHeight, profile);
}

function refreshStreamQualityUi(applyDefaults = false) {
  const modeField = qs('[name="stream.qualityMode"]');
  const heightField = qs('[name="stream.maxHeight"]');
  const codecProfileField = qs('[name="stream.codecProfile"]');
  const formatField = qs('[name="stream.format"]');
  const useSortField = qs('[name="stream.useFormatSort"]');
  const sortField = qs('[name="stream.formatSort"]');
  const useMergeField = qs('[name="stream.useMergeOutputFormat"]');
  const mergeField = qs('[name="stream.mergeOutputFormat"]');

  if (!modeField || !heightField || !formatField) return;

  const mode = modeField.value || 'compatible';
  const height = streamMaxHeight(heightField.value);
  const codecProfile = codecProfileField ? codecProfileField.value : 'auto';
  const autoFormat = resolveFormatForMode(mode, height, formatField.value, codecProfile);

  if (mode !== 'custom') {
    formatField.value = autoFormat;
    formatField.readOnly = true;
    formatField.classList.add('readonly');
  } else {
    formatField.readOnly = false;
    formatField.classList.remove('readonly');
  }

  if (sortField) {
    sortField.placeholder = buildFormatSort(height);
    if (applyDefaults && (mode === 'high' || !sortField.value.trim())) {
      sortField.value = buildFormatSort(height);
    }
  }

  if (mergeField && applyDefaults && !mergeField.value.trim()) {
    mergeField.value = 'mkv';
  }

  if (applyDefaults && useSortField && useMergeField) {
    if (mode === 'high') {
      useSortField.checked = true;
      useMergeField.checked = true;
    } else if (mode === 'compatible') {
      useSortField.checked = false;
      useMergeField.checked = false;
    }
  }
}

const YOUTUBE_API_READ_MODES = ['api', 'ytdlp'];
const YOUTUBE_API_AVAILABILITY_MODES = ['disabled', 'light', 'rigorous_manual'];
const YOUTUBE_API_PLOT_STRATEGIES = ['title', 'first_description_line', 'full_description'];

function normalizeYouTubeApiBeforeSave(apiConfig) {
  const api = apiConfig || {};
  api.enabled = Boolean(api.enabled);
  api.apiKey = String(api.apiKey || '').trim();
  api.readMode = YOUTUBE_API_READ_MODES.includes(api.readMode) ? api.readMode : 'api';
  api.availabilityMode = YOUTUBE_API_AVAILABILITY_MODES.includes(api.availabilityMode) ? api.availabilityMode : 'light';
  api.plotStrategy = YOUTUBE_API_PLOT_STRATEGIES.includes(api.plotStrategy) ? api.plotStrategy : 'title';
  api.updateExistingThumbnails = Boolean(api.updateExistingThumbnails);
  api.thumbnailFormat = 'jpg';
  api.cacheTtlHours = optionalNumber(api.cacheTtlHours) || 168;
  api.timeoutSeconds = Math.max(5, optionalNumber(api.timeoutSeconds) || 20);
}

function normalizeStreamBeforeSave(stream) {
  stream.qualityMode = ['compatible', 'high', 'custom'].includes(stream.qualityMode) ? stream.qualityMode : 'compatible';
  stream.codecProfile = normalizeCodecProfile(stream.codecProfile);
  stream.maxHeight = streamMaxHeight(stream.maxHeight);
  stream.format = resolveFormatForMode(stream.qualityMode, stream.maxHeight, stream.format, stream.codecProfile);

  if (!String(stream.formatSort || '').trim()) {
    stream.formatSort = buildFormatSort(stream.maxHeight);
  }

  if (!String(stream.mergeOutputFormat || '').trim()) {
    stream.mergeOutputFormat = 'mkv';
  }

  stream.jsRuntimeMode = JS_RUNTIME_MODES.includes(stream.jsRuntimeMode) ? stream.jsRuntimeMode : 'deno';
  stream.jsRuntimePath = String(stream.jsRuntimePath || '').trim();
  if (!stream.jsRuntimePath && stream.jsRuntimeMode !== 'disabled') {
    stream.jsRuntimePath = defaultJsRuntimePath(stream.jsRuntimeMode);
  }
  stream.jsRuntimeCustomName = sanitizeJsRuntimeName(stream.jsRuntimeCustomName) || 'deno';
  stream.ejsComponents = EJS_COMPONENT_OPTIONS.includes(stream.ejsComponents) ? stream.ejsComponents : 'ejs:github';
  if (stream.jsRuntimeMode === 'disabled') {
    stream.ejsComponents = 'none';
  }

  stream.useFormatSort = Boolean(stream.useFormatSort);
  stream.useMergeOutputFormat = Boolean(stream.useMergeOutputFormat);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatStep(step) {
  const value = String(step || 'idle');
  if (value === 'idle') return 'Aguardando';
  if (value === 'starting') return 'Iniciando';
  if (value === 'prepare-base-dir') return 'Preparando pastas';
  if (value === 'error') return 'Erro';
  if (value.startsWith('process-playlist:')) return `Atualizando ${value.split(':').slice(1).join(':')}`;
  if (value.startsWith('manual-cleanup:')) return `Limpando ${value.split(':').slice(1).join(':')}`;
  return value;
}

function formatRunSummary(summary) {
  if (!summary) return 'Nenhuma execucao registrada ainda.';

  if (summary.message && !summary.playlists) {
    return `Erro: ${summary.message}`;
  }

  if (summary.trigger === 'manual-cleanup') {
    return [
      `Limpeza manual: ${summary.playlist || '-'}`,
      `Videos validos na fonte: ${summary.videosFound || 0}`,
      `YML verificados: ${summary.filesChecked || 0}`,
      `YML removidos: ${summary.filesRemoved || 0}`,
      `Thumbnails removidas: ${summary.thumbnailsRemoved || 0}`,
      `Pastas vazias removidas: ${summary.foldersRemoved || 0}`
    ].join('\n');
  }

  const lines = [
    `Bibliotecas atualizadas: ${summary.playlistsProcessed || 0}`,
    `Bibliotecas com erro: ${summary.playlistsFailed || 0}`,
    `Videos encontrados: ${summary.videosFound || 0}`,
    `Videos repetidos ignorados: ${summary.videosDuplicate || 0}`,
    `YML criados: ${summary.filesCreated || 0}`,
    `YML atualizados: ${summary.filesUpdated || 0}`,
    `YML sem mudanca: ${summary.filesUnchanged || 0}`,
    `Thumbnails novas: ${summary.thumbnailsCreated || 0}`,
    `Thumbnails atualizadas: ${summary.thumbnailsUpdated || 0}`,
    `Cota API estimada: ${summary.quotaUnitsUsed || 0}`
  ];

  if (Array.isArray(summary.playlists) && summary.playlists.length > 0) {
    lines.push('', 'Detalhes:');
    for (const playlist of summary.playlists) {
      const sources = playlist.sourceCount || 0;
      const found = playlist.videosFound || 0;
      const created = playlist.filesCreated || 0;
      const updated = playlist.filesUpdated || 0;
      const duplicates = playlist.videosDuplicate || 0;
      const scan = playlist.scanRequested ? 'scan solicitado' : 'scan ignorado';
      const readMode = playlist.readMode ? `, leitura ${playlist.readMode}` : '';
      const thumbs = (playlist.thumbnailsCreated || playlist.thumbnailsUpdated) ? `, ${(playlist.thumbnailsCreated || 0) + (playlist.thumbnailsUpdated || 0)} thumbnail(s)` : '';
      lines.push(`- ${playlist.name}: ${sources} fonte(s), ${found} video(s), ${created} criado(s), ${updated} atualizado(s), ${duplicates} repetido(s)${thumbs}${readMode}, ${scan}`);
      if (playlist.failed && playlist.error) {
        lines.push(`  Erro: ${playlist.error}`);
      }
    }
  }

  return lines.join('\n');
}


function formatCookieTestDetails(result) {
  if (!result) return '';

  const lines = [
    result.ok ? 'Cookies validos no teste ativo.' : 'Teste de cookies falhou.',
    `Status: ${result.status || '-'}`,
    result.message ? `Mensagem: ${result.message}` : '',
    result.cookiesPath ? `Arquivo: ${result.cookiesPath}` : '',
    result.cookieFile && result.cookieFile.modifiedAt ? `Atualizado em: ${formatDate(result.cookieFile.modifiedAt)}` : '',
    result.target && result.target.url ? `Video testado: ${result.target.url}` : '',
    result.target && result.target.sourceUrl ? `Fonte usada: ${result.target.sourceUrl}` : '',
    result.ytDlp && result.ytDlp.code !== null && result.ytDlp.code !== undefined ? `yt-dlp exit code: ${result.ytDlp.code}` : '',
    !result.ok && result.ytDlp && result.ytDlp.stderr ? `stderr:
${result.ytDlp.stderr}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}


function formatHealthSummary(health) {
  if (!health) return 'Sem dados de saude ainda.';
  return [
    `Videos ativos: ${health.videosActive || 0}`,
    `Arquivos locais: ${health.localFiles || 0}`,
    `Fora das fontes: ${health.sourceMissing || 0}`,
    `Suspeitos: ${health.suspicious || 0}`,
    `Sem duracao valida: ${health.noDuration || 0}`,
    `Thumbnails pendentes: ${health.thumbnailsPending || 0}`,
    `Ultima verificacao: ${formatDate(health.lastCheckedAt)}`
  ].join(' | ');
}

function formatPlaylistActionDetails(result) {
  if (!result) return '';
  if (result.status && result.cookieFile) return formatCookieTestDetails(result);
  if (result.trigger === 'cleanup-preview') {
    const lines = [
      'Pre-visualizacao da limpeza:',
      `YML verificados: ${result.filesChecked || 0}`,
      `YML que seriam removidos: ${result.filesToRemove || 0}`,
      `Thumbnails junto desses YML: ${result.thumbnailsToRemove || 0}`
    ];
    if (Array.isArray(result.examples) && result.examples.length > 0) {
      lines.push('', 'Exemplos:');
      for (const item of result.examples.slice(0, 10)) {
        lines.push(`- ${item.filePath}`);
      }
    }
    return lines.join('\n');
  }
  if (result.trigger === 'availability') {
    return [
      result.ok ? 'Verificacao concluida.' : 'Verificacao falhou.',
      `Modo: ${result.readMode || '-'}`,
      `Videos nas fontes: ${result.videosFound || 0}`,
      result.health ? formatHealthSummary(result.health) : '',
      result.error ? `Erro: ${result.error}` : ''
    ].filter(Boolean).join('\n');
  }
  if (result.trigger === 'manual-thumbnails' || result.trigger === 'manual-playlist' || result.trigger === 'manual') {
    return formatRunSummary(result);
  }
  if (result.trigger === 'manual-cleanup') {
    return formatRunSummary(result);
  }
  if (result.action) {
    const ok = result.ok === false ? 'falhou' : 'enviada';
    return `Acao ${result.action} ${ok}.`;
  }
  if (result.message || result.status) {
    return [result.message || '', result.status ? `Status: ${result.status}` : ''].filter(Boolean).join('\n');
  }
  return JSON.stringify(result, null, 2);
}

function renderPlaylistInlineResult(row, result, fallbackMessage = '') {
  const box = row.querySelector('[data-role="playlist-result"]');
  if (!box) return;

  box.textContent = result ? formatPlaylistActionDetails(result) : fallbackMessage;
  box.classList.remove('hidden', 'ok', 'fail');
  box.classList.add(result && result.ok ? 'ok' : 'fail');
}

function fillForm(config) {
  qsa('#configForm [name]').forEach((field) => {
    const value = getByPath(config, field.name);
    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? '';
    }
  });
  refreshStreamQualityUi(false);
  refreshYtDlpJsUi(false);
}

function readForm() {
  const config = JSON.parse(JSON.stringify(currentConfig));

  qsa('#configForm [name]').forEach((field) => {
    let value;
    if (field.type === 'checkbox') {
      value = field.checked;
    } else if (field.type === 'number') {
      value = Number(field.value);
    } else {
      value = field.value.trim();
    }
    setByPath(config, field.name, value);
  });

  normalizeStreamBeforeSave(config.stream);
  config.youtubeApi = config.youtubeApi || {};
  normalizeYouTubeApiBeforeSave(config.youtubeApi);

  config.playlists = qsa('.playlist-row').map((row) => {
    const urls = getPlaylistUrlsFromRow(row);
    return {
      name: row.querySelector('[data-field="name"]').value.trim(),
      url: urls[0] || '',
      urls,
      enabled: row.querySelector('[data-field="enabled"]').checked,
      libraryId: optionalNumber(row.querySelector('[data-field="libraryId"]').value),
      playoutId: optionalNumber(row.querySelector('[data-field="playoutId"]').value),
      cookiesPath: row.querySelector('[data-field="cookiesPath"]').value.trim()
    };
  }).filter((playlist) => playlist.name && playlist.urls.length > 0);

  return config;
}

function renderPlaylists(playlists) {
  const container = qs('#playlistList');
  container.innerHTML = '';

  for (const playlist of playlists || []) {
    addPlaylistRow(playlist);
  }
}

function getPlaylistUrlsFromRow(row) {
  const values = qsa('[data-field="url"]', row).map((input) => input.value);
  return splitPlaylistUrls(values.join('\n'));
}

function updatePlaylistUrlRemoveButtons(row) {
  const urlRows = qsa('.playlist-url-row', row);
  for (const urlRow of urlRows) {
    const button = urlRow.querySelector('[data-action="remove-url"]');
    if (!button) continue;
    button.disabled = urlRows.length <= 1;
    button.title = urlRows.length <= 1 ? 'Mantenha pelo menos um campo de URL.' : 'Remover esta URL';
  }
}

function addPlaylistUrlField(row, value = '') {
  const list = row.querySelector('[data-role="url-list"]');
  if (!list) return;

  const item = document.createElement('div');
  item.className = 'playlist-url-row';
  item.innerHTML = `
    <input data-field="url" type="url" value="" placeholder="Cole uma playlist ou um video do YouTube">
    <button type="button" class="compact danger ghost" data-action="remove-url">Remover</button>
  `;

  item.querySelector('[data-field="url"]').value = value || '';
  item.querySelector('[data-action="remove-url"]').addEventListener('click', () => {
    item.remove();
    updatePlaylistUrlRemoveButtons(row);
  });

  list.appendChild(item);
  updatePlaylistUrlRemoveButtons(row);
}

function addPlaylistRow(playlist = { name: '', url: '', urls: [], enabled: true, libraryId: null, playoutId: null, cookiesPath: '' }) {
  const container = qs('#playlistList');
  const row = document.createElement('div');
  row.className = 'playlist-row';
  row.dataset.folder = playlist.name || '';

  row.innerHTML = `
    <div class="playlist-fields">
      <div class="playlist-top-row">
        <label>
          <span class="label-line">Nome da pasta <span class="help" tabindex="0" data-help="Nome da pasta que sera criada dentro da pasta base. Exemplo: Mix_Principal.">?</span></span>
          <input data-field="name" type="text" value="" placeholder="Mix_Principal">
        </label>
        <label>
          <span class="label-line">Library ID <span class="help" tabindex="0" data-help="ID da biblioteca no ErsatzTV. Usado para avisar o ErsatzTV quando novos YML forem criados ou atualizados.">?</span></span>
          <input data-field="libraryId" type="number" min="1" value="">
        </label>
        <label>
          <span class="label-line">Playout ID <span class="help" tabindex="0" data-help="ID do playout no ErsatzTV. Usado pelo botao Atualizar playout.">?</span></span>
          <input data-field="playoutId" type="number" min="1" value="">
        </label>
      </div>

      <div class="playlist-url-section">
        <div class="playlist-section-header">
          <div>
            <strong>Fontes do YouTube</strong>
            <p>Use playlists, videos avulsos ou os dois. Repetidos sao ignorados automaticamente. Para video unico, use uma URL sem list=.</p>
          </div>
          <button type="button" class="compact" data-action="add-url">Adicionar fonte</button>
        </div>
        <div class="playlist-url-list" data-role="url-list"></div>
      </div>

      <div class="playlist-meta-row">
        <label>
          <span class="label-line">cookies.txt desta biblioteca <span class="help" tabindex="0" data-help="Opcional. Preencha apenas se esta biblioteca precisar de outro cookies.txt. Vazio usa o arquivo global.">?</span></span>
          <input data-field="cookiesPath" type="text" placeholder="Vazio usa o caminho global">
        </label>
        <label class="check-row">
          <input data-field="enabled" type="checkbox">
          <span>Ativa</span>
        </label>
      </div>
    </div>
    <div class="playlist-health" data-role="playlist-health">Saude da biblioteca: ainda nao verificada.</div>
    <div class="playlist-actions">
      <button type="button" class="primary" data-action="run" title="Atualiza apenas esta biblioteca">Executar</button>
      <button type="button" data-action="test-cookies" title="Testa o cookies.txt contra o YouTube">Testar cookies</button>
      <button type="button" data-action="availability" title="Verifica os videos locais sem apagar arquivos">Verificar</button>
      <button type="button" data-action="refresh-thumbnails" title="Baixa ou atualiza as thumbnails da biblioteca">Thumbnails</button>
      <button type="button" data-action="cleanup" title="Remove YML que nao estao mais nas fontes desta biblioteca">Limpar YML</button>
      <button type="button" data-action="scan" title="Solicita scan da biblioteca no ErsatzTV">Scan</button>
      <button type="button" data-action="empty-trash" title="Solicita limpeza de lixo da biblioteca no ErsatzTV">Limpar lixo</button>
      <button type="button" data-action="rebuild-playout" title="Solicita atualizacao do playout no ErsatzTV">Atualizar playout</button>
      <button type="button" class="danger" data-action="remove" title="Remove esta biblioteca da configuracao">Remover</button>
    </div>
    <pre class="playlist-result hidden" data-role="playlist-result"></pre>
  `;

  const playlistUrls = getPlaylistUrls(playlist);
  row.querySelector('[data-field="name"]').value = playlist.name || '';
  row.querySelector('[data-field="libraryId"]').value = playlist.libraryId || '';
  row.querySelector('[data-field="playoutId"]').value = playlist.playoutId || '';
  row.querySelector('[data-field="cookiesPath"]').value = playlist.cookiesPath || '';
  row.querySelector('[data-field="enabled"]').checked = playlist.enabled !== false;

  row.querySelector('[data-action="add-url"]').addEventListener('click', () => addPlaylistUrlField(row));
  for (const url of playlistUrls.length ? playlistUrls : ['']) {
    addPlaylistUrlField(row, url);
  }

  row.querySelector('[data-action="remove"]').addEventListener('click', () => row.remove());
  row.querySelector('[data-action="run"]').addEventListener('click', () => runPlaylistAction(row, 'run'));
  row.querySelector('[data-action="test-cookies"]').addEventListener('click', () => runPlaylistAction(row, 'test-cookies'));
  row.querySelector('[data-action="availability"]').addEventListener('click', () => runPlaylistAction(row, 'availability'));
  row.querySelector('[data-action="refresh-thumbnails"]').addEventListener('click', () => runPlaylistAction(row, 'refresh-thumbnails'));
  row.querySelector('[data-action="cleanup"]').addEventListener('click', () => runPlaylistAction(row, 'cleanup'));
  row.querySelector('[data-action="scan"]').addEventListener('click', () => runPlaylistAction(row, 'scan'));
  row.querySelector('[data-action="empty-trash"]').addEventListener('click', () => runPlaylistAction(row, 'empty-trash'));
  row.querySelector('[data-action="rebuild-playout"]').addEventListener('click', () => runPlaylistAction(row, 'rebuild-playout'));

  container.appendChild(row);
}

function assertPlaylistSaved(name) {
  return (currentConfig.playlists || []).some((playlist) => playlist.name === name);
}

async function runPlaylistAction(row, action) {
  const name = row.querySelector('[data-field="name"]').value.trim();
  if (!name) {
    showToast('Informe o nome da biblioteca antes de executar a acao.');
    return;
  }

  if (!assertPlaylistSaved(name)) {
    showToast('Salve a configuracao antes de executar acoes nesta biblioteca.');
    return;
  }

  if (action === 'cleanup') {
    const preview = await api(`/api/playlists/${encodeURIComponent(name)}/cleanup-preview`, { method: 'POST' });
    renderPlaylistInlineResult(row, preview.result);
    const toRemove = Number(preview.result && preview.result.filesToRemove) || 0;
    if (toRemove <= 0) {
      showToast('Nada para remover nesta biblioteca.');
      await refreshAll();
      return;
    }
    const thumbs = Number(preview.result && preview.result.thumbnailsToRemove) || 0;
    const confirmed = window.confirm(`Remover ${toRemove} YML e ${thumbs} thumbnail(s) fora das fontes da biblioteca "${name}"?`);
    if (!confirmed) return;
  }

  const payload = await api(`/api/playlists/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
  if (action === 'run') {
    showToast(payload.message || 'Atualizacao da biblioteca iniciada. Acompanhe pelos logs.');
  } else if (action === 'test-cookies') {
    renderPlaylistInlineResult(row, payload.result);
    showToast(payload.result && payload.result.ok ? 'Cookies validos no teste ativo.' : 'Teste de cookies falhou. Veja o resultado na biblioteca e os logs.');
  } else if (action === 'availability' || action === 'refresh-thumbnails') {
    renderPlaylistInlineResult(row, payload.result);
    showToast(action === 'availability' ? 'Verificacao concluida. Veja o resumo na biblioteca.' : 'Atualizacao de thumbnails iniciada/concluida. Veja o resumo.');
  } else {
    renderPlaylistInlineResult(row, payload.result);
    showToast(payload.result && payload.result.ok === false ? 'Acao enviada, mas a API retornou falha. Veja os logs.' : 'Acao executada. Veja os logs.');
  }
  await refreshAll();
}


function renderHealthForRows(healthMap) {
  latestHealth = healthMap || {};
  qsa('.playlist-row').forEach((row) => {
    const name = row.querySelector('[data-field="name"]') ? row.querySelector('[data-field="name"]').value.trim() : row.dataset.folder;
    const health = latestHealth[name] || null;
    const box = row.querySelector('[data-role="playlist-health"]');
    if (!box) return;
    box.textContent = health ? formatHealthSummary(health) : 'Saude da biblioteca: ainda nao verificada.';
    box.classList.toggle('has-warning', Boolean(health && ((health.suspicious || 0) > 0 || (health.apiErrors || 0) > 0)));
  });
}

async function loadConfig() {
  currentConfig = await api('/api/config');
  fillForm(currentConfig);
  renderPlaylists(currentConfig.playlists || []);
  renderHealthForRows(latestHealth);
}

async function saveConfig() {
  const config = readForm();
  const result = await api('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  currentConfig = result.config;
  fillForm(currentConfig);
  renderPlaylists(currentConfig.playlists || []);
  renderHealthForRows(latestHealth);
  showToast('Configuracao salva. Mudancas de host/porta exigem reinicio do app.');
  await refreshAll();
}

async function runNow() {
  await api('/api/run', { method: 'POST' });
  showToast('Atualizacao iniciada. Acompanhe pelos logs.');
  await refreshAll();
}

function renderStatus(status) {
  const running = Boolean(status.sync.running);
  const pill = qs('#runningPill');
  pill.textContent = running ? 'Executando' : 'Ocioso';
  pill.classList.toggle('running', running);
  pill.classList.toggle('idle', !running);

  qs('#syncState').textContent = running ? 'Executando' : 'Ocioso';
  qs('#syncStep').textContent = formatStep(status.sync.currentStep);
  qs('#lastRun').textContent = formatDate(status.sync.finishedAt || status.sync.startedAt);
  qs('#nextRun').textContent = status.scheduler.nextRunAt ? formatDate(status.scheduler.nextRunAt) : '-';

  const summary = status.sync.lastResult || status.sync.lastError || null;
  qs('#lastSummary').textContent = formatRunSummary(summary);
  renderHealthForRows(status.health || {});
}

function renderLogs(payload) {
  const lines = (payload.logs || []).map((log) => {
    const time = formatDate(log.ts);
    const meta = log.meta && Object.keys(log.meta).length ? ` ${JSON.stringify(log.meta)}` : '';
    return `[${time}] ${String(log.level).toUpperCase()}: ${log.message}${meta}`;
  });
  const box = qs('#logs');
  box.textContent = lines.join('\n');
  box.scrollTop = box.scrollHeight;
}

async function refreshAll() {
  try {
    const [status, logs] = await Promise.all([
      api('/api/status'),
      api('/api/logs?limit=250')
    ]);
    renderStatus(status);
    renderLogs(logs);
  } catch (error) {
    showToast(error.message);
  }
}

async function clearLogs() {
  await api('/api/logs/clear', { method: 'POST' });
  await refreshAll();
}

async function testYoutubeApiFromForm() {
  const config = readForm();
  const saved = await api('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  currentConfig = saved.config;
  const payload = await api('/api/youtube-api/test', { method: 'POST' });
  const result = payload.result || {};
  showToast(result.ok ? 'YouTube API funcionando.' : `Falha na YouTube API: ${result.message || result.status || 'erro'}`);
  await loadConfig();
  await refreshAll();
}

async function boot() {
  try {
    await loadConfig();
    await refreshAll();
    refreshTimer = setInterval(refreshAll, 3000);
  } catch (error) {
    showToast(error.message);
  }
}

function bindSaveButton(selector) {
  const button = qs(selector);
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    saveConfig().catch((error) => showToast(error.message));
  });
}

function bindStreamQualityControls() {
  const modeField = qs('[name="stream.qualityMode"]');
  const heightField = qs('[name="stream.maxHeight"]');
  const codecProfileField = qs('[name="stream.codecProfile"]');

  if (modeField) {
    modeField.addEventListener('change', () => refreshStreamQualityUi(true));
  }

  if (heightField) {
    heightField.addEventListener('change', () => refreshStreamQualityUi(true));
    heightField.addEventListener('input', () => refreshStreamQualityUi(false));
  }

  if (codecProfileField) {
    codecProfileField.addEventListener('change', () => refreshStreamQualityUi(true));
  }
}

function bindYtDlpJsControls() {
  const modeField = qs('[name="stream.jsRuntimeMode"]');
  const pathField = qs('[name="stream.jsRuntimePath"]');

  if (modeField) {
    modeField.addEventListener('change', () => refreshYtDlpJsUi(true));
  }

  if (pathField) {
    pathField.addEventListener('input', () => refreshYtDlpJsUi(false));
  }
}

bindStreamQualityControls();
bindYtDlpJsControls();
bindSaveButton('#saveBtn');
bindSaveButton('#saveBtnBottom');

qs('#runNowBtn').addEventListener('click', () => {
  runNow().catch((error) => showToast(error.message));
});

const testYoutubeApiBtn = qs('#testYoutubeApiBtn');
if (testYoutubeApiBtn) {
  testYoutubeApiBtn.addEventListener('click', () => {
    testYoutubeApiFromForm().catch((error) => showToast(error.message));
  });
}

qs('#addPlaylistBtn').addEventListener('click', () => addPlaylistRow());

qs('#clearLogsBtn').addEventListener('click', () => {
  clearLogs().catch((error) => showToast(error.message));
});

window.addEventListener('beforeunload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

boot();
