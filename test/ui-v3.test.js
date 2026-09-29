const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
}

test('login v3 keeps only actionable authentication content', () => {
  const html = read('login.html');
  assert.match(html, /ErsatzTV YouTube Downloader/);
  assert.match(html, /id="username"/);
  assert.match(html, /id="password"/);
  assert.match(html, /Caps Lock/);
  assert.doesNotMatch(html, /Fila resiliente/);
  assert.doesNotMatch(html, /Mídia local/);
  assert.doesNotMatch(html, /Acesso protegido/);
  assert.doesNotMatch(html, /Senha protegida por derivação scrypt/);
  assert.doesNotMatch(html, /Sessão expira automaticamente/);
});

test('main UI exposes Channels separately and loads shared destination form', () => {
  const html = read('index.html');
  assert.match(html, /data-view="channels"/);
  assert.match(html, /id="view-channels"/);
  assert.match(html, /id="channelUrlInput"/);
  assert.match(html, /id="runChannelsBtn"/);
  assert.match(html, /paths\.channelsBaseDir/);
  assert.match(html, /channelScheduler\.intervalMinutes/);
  assert.match(html, /\/js\/destinationForm\.js\?v=3\.4\.8/);
  assert.match(html, /\/js\/channelsView\.js\?v=3\.4\.8/);
  assert.match(html, /rev=ersatztv-catalog-1/);
});

test('saved Channels expose compact read-only summaries without moving edit controls into the accordions', () => {
  const view = read('js/channelsView.js');
  const css = read('styles.css');
  assert.match(view, /data-channel-selected-content/);
  assert.match(view, /data-channel-summary-source/);
  assert.match(view, /data-channel-summary-playlists/);
  assert.match(view, /data-channel-summary-playlist/);
  assert.match(view, /channelStatsHtml\(channel\)/);
  assert.match(view, /channel-readonly-grid/);
  assert.match(css, /\.channel-selected-content/);
  assert.match(css, /\.channel-readonly-field/);

  const playlistSummary = view.match(/function renderPlaylistSummary[\s\S]*?\n  function renderSelectedContent/);
  assert.ok(playlistSummary, 'read-only playlist summary renderer should exist');
  assert.doesNotMatch(playlistSummary[0], /DestinationForm\.renderFields/);
  assert.doesNotMatch(playlistSummary[0], /<button/);
  assert.doesNotMatch(playlistSummary[0], /<input/);
});


test('Channel summary accordions preserve their open state across automatic status renders', () => {
  const view = read('js/channelsView.js');
  assert.match(view, /const summaryOpenState = new Map\(\)/);
  assert.match(view, /function summaryDetailsKey\(details\)/);
  assert.match(view, /function rememberSummaryOpenState\(root\)/);
  assert.match(view, /function restoreSummaryOpenState\(root\)/);
  assert.match(view, /rememberSummaryOpenState\(root\)[\s\S]*root\.innerHTML = channels\.map/);
  assert.match(view, /root\.innerHTML = channels\.map[\s\S]*restoreSummaryOpenState\(root\)/);
  assert.match(view, /data-channel-selected-content/);
  assert.match(view, /data-channel-summary-source/);
  assert.match(view, /data-channel-summary-playlists/);
  assert.match(view, /data-channel-summary-playlist/);
});


test('mobile navigation stays on one horizontal row and auto-hides without covering content', () => {
  const app = read('app.js');
  const css = read('styles.css');

  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.sidebar \{[\s\S]*?display: flex;[\s\S]*?flex-direction: row;/);
  assert.match(css, /\.sidebar \{[\s\S]*?overflow-x: auto;/);
  assert.match(css, /scroll-snap-type: x proximity/);
  assert.match(css, /\.nav-button \{[\s\S]*?flex: 0 0 76px;/);
  assert.match(css, /\.sidebar\.mobile-nav-hidden/);
  assert.match(css, /transform: translateY\(calc\(100% \+ 10px\)\)/);
  assert.match(css, /padding: 12px 12px calc\(var\(--mobile-nav-height\) \+ 24px \+ env\(safe-area-inset-bottom\)\)/);

  assert.match(app, /const MOBILE_NAV_IDLE_MS = 3600/);
  assert.match(app, /function hideMobileNav\(\)/);
  assert.match(app, /function showMobileNav\(/);
  assert.match(app, /function bindMobileNavBehavior\(\)/);
  assert.match(app, /window\.addEventListener\('scroll'/);
  assert.match(app, /document\.addEventListener\('touchstart'/);
  assert.match(app, /document\.addEventListener\('touchend'/);
  assert.match(app, /delta > 0[\s\S]*hideMobileNav\(\)/);
  assert.match(app, /else showMobileNav\(\{ scheduleHide: true \}\)/);
  assert.match(app, /window\.setTimeout\(\(\) => hideMobileNav\(\), MOBILE_NAV_IDLE_MS\)/);
  assert.match(app, /centerActiveMobileNav/);
});


test('ErsatzTV actions select channels by name, keep number internal and expose Smart Collections only with Library ID', () => {
  const html = read('index.html');
  const form = read('js/destinationForm.js');
  const app = read('app.js');
  const channels = read('js/channelsView.js');

  assert.match(form, /Canal no ErsatzTV/);
  assert.match(form, /data-field="channelNumber"/);
  assert.match(form, /data-smart-collection-select/);
  assert.match(form, /data-smart-collection-region/);
  assert.match(form, /data-smart-collection-last/);
  assert.match(form, /lastSmartCollectionName/);
  assert.match(form, /Criar nova/);
  assert.match(app, /smartCollectionSelections/);
  assert.doesNotMatch(form, /Número do canal/);
  assert.doesNotMatch(form, /Playout ID/);
  assert.doesNotMatch(html, /rebuildPlayoutOnQueueIdle/);
  assert.doesNotMatch(html, /Atualizar playout ao esvaziar/);
  assert.match(app, /\/api\/ersatztv\/catalog/);
  assert.match(app, /\/api\/ersatztv\/smart-collections\/link/);
  assert.match(app, /confirmLabel: 'Agregar'/);
  assert.match(app, /secondaryLabel: 'Substituir'/);
  assert.match(app, /data-library-action="reset-playout">Reset Playout/);
  assert.match(channels, /data-channel-playlist-action="reset-playout">Reset Playout/);
  assert.match(channels, /readOnlyField\('Canal ErsatzTV'/);
});

test('destructive confirmations use the application modal instead of browser alert confirm or prompt', () => {
  const html = read('index.html');
  const app = read('app.js');
  const channels = read('js/channelsView.js');

  assert.match(html, /id="appDialog"/);
  assert.match(html, /id="appDialogInput"/);
  assert.match(html, /id="appDialogSecondary"/);
  assert.match(app, /function showAppDialog\(options = \{\}\)/);
  assert.match(app, /expectedText/);
  assert.match(app, /secondaryLabel/);
  assert.match(app, /warning: 'O progresso atual pode ser perdido\.'/);
  assert.match(channels, /ctx\.showDialog/);
  assert.doesNotMatch(app, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(channels, /\b(?:alert|confirm|prompt)\s*\(/);
});


test('Smart Collection selector is compact and shows the last successful selection beside it', () => {
  const css = read('styles.css');
  const form = read('js/destinationForm.js');
  assert.match(css, /\.destination-smart-collection\s*\{[\s\S]*grid-template-columns: minmax\(190px, 320px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.destination-smart-collection-last/);
  assert.match(form, />Última</);
  assert.match(form, /lastSmartCollectionName\(libraryId\)/);
});

test('ErsatzTV settings validate the API Key through GET api version and show a compact connection state', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  const routes = read('../src/routes/ersatztvRoutes.js');
  const service = read('../src/ersatztvService.js');

  assert.match(html, /id="ersatzTvVersionStatus"/);
  assert.match(html, /id="ersatzTvVersionText"/);
  assert.match(css, /\.ersatztv-version-status/);
  assert.match(app, /\/api\/ersatztv\/version/);
  assert.match(app, /ERSATZTV_VERSION_DEBOUNCE_MS = 650/);
  assert.match(app, /API Key inválida/);
  assert.match(app, /scheduleErsatzTvVersionCheck/);
  assert.match(routes, /getErsatzTvVersion/);
  assert.match(service, /ersatzTvJsonRequest\(config, '\/api\/version'\)/);
});


test('Scripted Schedules is an isolated builder view with Universal v1.3.0 modules', () => {
  const html = read('index.html');
  const app = read('app.js');
  const view = read('js/scriptedSchedulesView.js');
  const css = read('scripted-schedules.css');
  const server = read('../src/server.js');

  assert.match(html, /data-view="scripted-schedules"/);
  assert.match(html, /id="view-scripted-schedules"/);
  assert.match(html, /id="scriptedSchedulesRoot"/);
  assert.match(html, /scripted-schedules\.css\?v=3\.4\.8/);
  assert.match(html, /scriptedSchedulesView\.js\?v=3\.4\.8/);
  assert.match(app, /'scripted-schedules'/);
  assert.match(app, /ScriptedSchedulesView\.init/);
  assert.match(server, /handleScriptedScheduleRoutes/);

  for (const moduleName of ['rotation', 'countRotation', 'weightedRotation', 'continuousBlocks', 'contentBreaks', 'fitToWindow', 'fixedEvents', 'fixedDurationEvents', 'fixedAllEvents', 'fixedWindowEvents', 'windowRotations', 'sequenceEvents', 'intervalEvents', 'choiceEvents', 'clockTemplates', 'temporaryOverrides', 'dateEvents', 'offlineWindows']) {
    assert.match(view, new RegExp(`${moduleName}:`));
  }
  assert.match(view, /toggle-filler/);
  assert.match(view, /Presentation Profiles/);
  assert.match(view, /Scripted Playlists/);
  assert.match(view, /Grupos de Graphics/);
  assert.match(view, /LATEST_TEMPLATE_VERSION = '1\.3\.0'/);
  assert.match(view, /Pad To Nearest Minute/);
  assert.match(view, /PAD_TO_NEAREST_OPTIONS = \[5, 10, 15, 30\]/);
  assert.match(view, /Configure o Filler do projeto para liberar esta opção/);
  assert.match(view, /upgrade-template/);
  assert.match(css, /\.ss-editor-tabs/);
  assert.match(view, /handleAccordionToggle/);
  assert.match(view, /data-ss-accordion/);
  assert.match(view, /renderEditorSaveBar\('Recursos'\)/);
  assert.match(view, /renderEditorSaveBar\('Programação'\)/);
  assert.match(css, /\.ss-section-accordion/);
  assert.match(css, /\.ss-editor-save-bar/);
  assert.doesNotMatch(view, /\b(?:alert|confirm|prompt)\s*\(/);
});


test('Scripted Schedules resources and programming keep accordion state and expose bottom save actions', () => {
  const view = read('js/scriptedSchedulesView.js');
  const css = read('scripted-schedules.css');

  assert.match(view, /openAccordions: new Set\(\)/);
  assert.match(view, /addEventListener\('toggle', handleAccordionToggle, true\)/);
  assert.match(view, /accordionAttrs\(`resources:\$\{kind\}`\)/);
  assert.match(view, /accordionAttrs\(`module:\$\{type\}`\)/);
  assert.match(view, /module-entry:\$\{type\}:\$\{index\}/);
  assert.match(view, /renderEditorSaveBar\('Recursos'\)/);
  assert.match(view, /renderEditorSaveBar\('Programação'\)/);
  assert.match(view, />Salvar e publicar<\/button>/);
  assert.match(css, /\.ss-accordion-summary/);
  assert.match(css, /\.ss-section-summary/);
});



test('Scripted Schedules exposes discreet contextual help for configuration fields', () => {
  const view = read('js/scriptedSchedulesView.js');
  const css = read('scripted-schedules.css');

  assert.match(view, /const HELP_TEXT = \{/);
  assert.match(view, /function help\(key\)/);
  assert.match(view, /function labelTitle\(text, key/);
  assert.match(view, /data-ss-help=/);
  assert.match(view, /showHelpPopover/);
  assert.match(view, /hideHelpPopover/);
  assert.match(view, /Tipo de Filler/);
  assert.match(view, /Diz ao ErsatzTV como este conteúdo deve ser tratado no EPG/);
  assert.match(view, /Fallback Source/);
  assert.match(view, /É diferente do Filler geral do projeto/);
  assert.match(view, /Pad To Nearest Minute/);
  assert.match(view, /um filme que termina 10:07 recebe Filler até 10:15/);
  assert.match(view, /labelTitle\('Nome do projeto', 'projectName'\)/);
  assert.match(view, /labelTitle\('Smart Collection', 'smartCollection'\)/);
  assert.match(view, /labelTitle\('Prioridade', 'priority'\)/);
  assert.match(view, /labelTitle\('Título customizado', 'customTitle'\)/);
  assert.match(css, /\.ss-help\s*\{/);
  assert.match(css, /\.ss-help-popover\s*\{/);
  assert.match(css, /width: 14px/);
});

test('Scripted Schedules exposes item Pad only on item-compatible modules and modes', () => {
  const view = read('js/scriptedSchedulesView.js');
  for (const type of ['countRotation', 'weightedRotation', 'contentBreaks', 'fixedEvents']) {
    assert.match(view, new RegExp(`${type}: \\{[^\\n]+pad: 'direct'`));
  }
  for (const type of ['sequenceEvents', 'intervalEvents', 'choiceEvents', 'clockTemplates', 'dateEvents']) {
    assert.match(view, new RegExp(`${type}: \\{[^\\n]+pad: 'conditional'`));
  }
  for (const type of ['rotation', 'continuousBlocks', 'fitToWindow', 'fixedDurationEvents', 'fixedAllEvents', 'fixedWindowEvents', 'windowRotations', 'temporaryOverrides', 'offlineWindows']) {
    assert.match(view, new RegExp(`${type}: \\{[^\\n]+pad: 'none'`));
  }

  const rotationRenderer = view.match(/if \(type === 'rotation'\)[\s\S]*?if \(type === 'countRotation'\)/)?.[0] || '';
  assert.doesNotMatch(rotationRenderer, /renderPadToNearest/);
  assert.match(view, /renderPadToNearest\(`modules\.countRotation\.\$\{index\}`/);
  assert.match(view, /renderPadToNearest\(`modules\.weightedRotation\.\$\{index\}`/);
  for (const type of ['contentBreaks', 'fixedEvents']) {
    const line = view.split('\n').find((row) => row.includes(`if (type === '${type}') body =`));
    assert.ok(line && line.includes('renderPadToNearest(base, item)'), `${type} should expose item Pad`);
  }
  for (const type of ['continuousBlocks', 'fitToWindow', 'fixedDurationEvents', 'fixedAllEvents', 'fixedWindowEvents', 'windowRotations', 'temporaryOverrides', 'offlineWindows']) {
    const line = view.split('\n').find((row) => row.includes(`if (type === '${type}') body =`));
    assert.ok(line && !line.includes('renderPadToNearest'), `${type} must not expose item Pad`);
  }
  const sequenceLine = view.split('\n').find((row) => row.includes("if (type === 'sequenceEvents') body =")) || '';
  assert.match(sequenceLine, /sequenceSupportsItemPad\(item\.steps\) \? renderPadToNearest/);
  const intervalLine = view.split('\n').find((row) => row.includes("if (type === 'intervalEvents') body =")) || '';
  const choiceLine = view.split('\n').find((row) => row.includes("if (type === 'choiceEvents') body =")) || '';
  const dateLine = view.split('\n').find((row) => row.includes("if (type === 'dateEvents') body =")) || '';
  assert.match(intervalLine, /item\.mode === 'count' \? renderPadToNearest/);
  assert.match(choiceLine, /item\.mode === 'count' \? renderPadToNearest/);
  assert.match(dateLine, /modeSupportsItemPad\(item\.mode, item\.steps\) \? renderPadToNearest/);
  const windowRotationRenderer = view.match(/function renderWindowRotationItems\(item, index\)[\s\S]*?function renderSequenceSteps/)?.[0] || '';
  assert.doesNotMatch(windowRotationRenderer, /padToNearestMinutes/);
  const clockRenderer = view.match(/function renderClockSlots\(slots, path\)[\s\S]*?function renderPadToNearest/)?.[0] || '';
  assert.match(clockRenderer, /slot\.mode === 'count' \? renderPadToNearest\(base, slot\)/);
  const fillerRenderer = view.match(/function renderFiller\(\)[\s\S]*?function renderEditorSaveBar/)?.[0] || '';
  assert.doesNotMatch(fillerRenderer, /renderPadToNearest/);
  assert.match(view, /clearPadToNearestSettings/);
})

test('module picker and Help explain item Pad compatibility in simple language', () => {
  const view = read('js/scriptedSchedulesView.js');
  const help = read('js/helpView.js');
  assert.match(view, /Disponível\. Se tocar 3 itens: item → Pad → item → Pad → item → Pad/);
  assert.match(view, /Não se aplica aqui: o ErsatzTV recebe “todos os itens” de uma vez/);
  assert.match(view, /Não se aplica aqui: este módulo entrega um período inteiro ao ErsatzTV/);
  assert.match(view, /Disponível quando o modo for Quantidade/);
  assert.match(view, /Em cada posição, o Pad aparece quando o modo for Quantidade/);
  assert.match(view, /meta\.pad === 'none' \|\| meta\.padNote/);
  assert.match(help, /Com Pad: filme → Filler até a marca → filme → Filler → filme → Filler/);
  assert.match(help, /Pad To Nearest não aparece aqui: todos os itens são enviados de uma vez/);
  assert.match(help, /Pad To Nearest não aparece aqui, porque esse período é montado de uma vez/);
  assert.match(help, /usa o Filler depois de cada item até a próxima marca/);
  assert.match(help, /Um evento com horário marcado continua entrando no horário dele/);
})

test('sidebar navigation always returns each section to its home state', () => {
  const app = read('app.js');
  const channels = read('js/channelsView.js');
  const schedules = read('js/scriptedSchedulesView.js');
  assert.match(app, /async function goToViewHome\(view\)/);
  assert.match(app, /ScriptedSchedulesView\?\.home/);
  assert.match(app, /ChannelView\?\.home/);
  assert.match(app, /library-accordion/);
  assert.match(app, /downloadsAccordion/);
  assert.match(app, /settings-accordion/);
  assert.match(channels, /function home\(\)[\s\S]*editingChannelId = ''/);
  assert.match(schedules, /async function home\(\)[\s\S]*state\.current = null/);
});

test('Scripted Schedules Help stays inside the Programacao sidebar group and is clearly scoped', () => {
  const html = read('index.html');
  const help = read('js/helpView.js');
  const programacaoGroup = html.match(/<div class="nav-group">\s*<span class="nav-label">Programação<\/span>[\s\S]*?<\/div>/)?.[0] || '';
  const sistemaGroup = html.match(/<div class="nav-group">\s*<span class="nav-label">Sistema<\/span>[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(programacaoGroup, /data-view="scripted-schedules"/);
  assert.match(programacaoGroup, /data-view="help"/);
  assert.doesNotMatch(sistemaGroup, /data-view="help"/);
  assert.match(html, /id="view-help"/);
  assert.match(html, /helpView\.js\?v=3\.4\.8/);
  assert.match(help, /Programação · Scripted Schedules/);
  assert.match(help, /Assuntos da ajuda de Scripted Schedules/);
  for (const tab of ['Começando', 'Recursos', 'Módulos', 'Combinações', 'Publicar', 'Glossário']) assert.match(help, new RegExp(tab));
  for (const name of ['Rotação por quantidade', 'Rotação por peso', 'Bloco contínuo por horário', 'Inserções após X itens', 'Encaixar até o próximo evento', 'Escolha entre fontes', 'Relógio de programação', 'Programação especial temporária']) assert.match(help, new RegExp(name));
  assert.match(help, /Combina bem com/);
  assert.match(help, /Exemplo simples/);
  assert.match(help, /Fallback Source/);
});

test('module selection modal keeps only module names in the left list and details on the right', () => {
  const view = read('js/scriptedSchedulesView.js');
  const css = read('scripted-schedules.css');
  assert.match(view, /data-ss-action="open-module-picker"/);
  assert.match(view, /function renderModulePickerModal/);
  assert.match(view, /data-ss-action="select-module"/);
  assert.match(view, /aria-label="Tipos de módulo"/);
  assert.ok(view.includes('<strong>${esc(item.label)}</strong></button>'));
  const pickerListTemplate = view.match(/<div class=\"ss-module-picker-list\"[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(pickerListTemplate, /item\.hint/);
  assert.match(view, /ss-module-picker-description/);
  assert.ok(view.includes('${esc(meta.hint)}'));
  assert.match(view, /Combina bem com/);
  assert.match(view, /Ajuda de Scripted Schedules/);
  assert.doesNotMatch(view, /id="ssModulePicker"/);
  assert.match(css, /\.ss-module-modal-backdrop/);
  assert.match(css, /grid-template-columns: minmax\(250px, 330px\) minmax\(0, 1fr\)/);
  assert.match(css, /\.ss-module-picker-list[\s\S]*overflow-x: hidden/);
  assert.match(css, /\.ss-module-picker-item[\s\S]*white-space: normal/);
  assert.match(css, /\.ss-module-picker-description/);
});

test('Scripted Schedules follows a fluent resource order and configures Filler before modules', () => {
  const view = read('js/scriptedSchedulesView.js');
  const help = read('js/helpView.js');
  const css = read('scripted-schedules.css');

  const resources = view.match(/function renderResources\(\)[\s\S]*?function renderGraphicsGroups/)?.[0] || '';
  const graphicsIndex = resources.indexOf('${renderGraphicsGroups()}');
  const profilesIndex = resources.indexOf('${renderProfiles()}');
  const sourcesIndex = resources.indexOf('${renderSources()}');
  const playlistsIndex = resources.indexOf('${renderScriptedPlaylists()}');
  assert.ok(graphicsIndex >= 0 && graphicsIndex < profilesIndex, 'Graphics Groups should come before Presentation Profiles');
  assert.ok(profilesIndex < sourcesIndex, 'Presentation Profiles should exist before Sources choose a default profile');
  assert.ok(sourcesIndex < playlistsIndex, 'Sources should exist before Scripted Playlists use them');

  assert.match(view, /Pre-roll opcional/);
  assert.match(view, /crie a Scripted Playlist depois e volte aqui para selecioná-la/);

  const programming = view.match(/function renderProgramming\(\)[\s\S]*?function renderModulePickerModal/)?.[0] || '';
  assert.ok(programming.indexOf('${renderFiller()}') < programming.indexOf('>Módulos<'), 'Filler should be configured before programming modules');

  assert.match(help, /A tela segue a ordem mais comum/);
  assert.match(help, /Post-roll é o mais indicado para preencher lacunas/);
  assert.match(css, /\.ss-module-picker-description \.ss-callout \+ \.ss-callout \{ margin-top: 12px; \}/);
});

test('playback order is configured in programming instead of the Source resource', () => {
  const view = read('js/scriptedSchedulesView.js');
  const sourcesRenderer = view.match(/function renderSources\(\)[\s\S]*?function renderSourceTypeFields/)?.[0] || '';
  assert.doesNotMatch(sourcesRenderer, /sources\.\$\{index\}\.order/);
  assert.doesNotMatch(sourcesRenderer, /labelTitle\('Ordem'/);
  assert.match(view, /function sourceOrderPair/);
  assert.match(view, /playbackOrder/);
  assert.match(view, /modules\.rotation\.\$\{index\}/);
  assert.match(view, /breakOrder/);
  assert.match(view, /fallbackOrder/);
  assert.match(view, /sourceOrderPair\('filler'/);
  assert.match(view, /A mesma Source pode usar ordens diferentes em outros blocos/);
});


test('internal none Presentation Profile is hidden from Resources but remains a simple selector choice', () => {
  const view = read('js/scriptedSchedulesView.js');
  const help = read('js/helpView.js');
  const profilesRenderer = view.match(/function renderProfiles\(\)[\s\S]*?function renderGroupChoices/)?.[0] || '';
  assert.match(view, /function visibleProfiles\(\)/);
  assert.match(view, /<option value="none" \$\{noneSelected \? 'selected' : ''\}>Nenhum<\/option>/);
  assert.doesNotMatch(profilesRenderer, /Reservado/);
  assert.doesNotMatch(profilesRenderer, /profile\.key === 'none'/);
  assert.match(view, /profile: visibleProfiles\(\)\.length/);
  assert.match(view, /<span>Profiles<\/span><strong>\$\{visibleProfiles\(\)\.length\}<\/strong>/);
  assert.match(help, /Ao escolher <strong>Nenhum<\/strong>/);
  assert.match(help, /Você não precisa criar nem configurar esse perfil/);
});

test('global Filler exposes a compact filler type picklist with postroll as the recommended default', () => {
  const view = read('js/scriptedSchedulesView.js');
  const fillerRenderer = view.match(/function renderFiller\(\)[\s\S]*?function renderEditorSaveBar/)?.[0] || '';
  assert.match(view, /const FILLER_KIND_OPTIONS = \[/);
  for (const value of ['postroll', 'preroll', 'midroll', 'none']) assert.match(view, new RegExp(`'${value}'`));
  assert.match(fillerRenderer, /renderFillerKindSelect\('filler\.fillerKind'/);
  assert.match(fillerRenderer, /defaultValue: 'postroll'/);
  assert.match(fillerRenderer, /recommendPostroll: true/);
  assert.doesNotMatch(fillerRenderer, /<strong>EPG:<\/strong>/);
});

test('Scripted Schedules removes redundant chips and uses more natural linking copy', () => {
  const view = read('js/scriptedSchedulesView.js');
  const settings = view.match(/function renderSettingsCard\(\)[\s\S]*?function renderProjectCard/)?.[0] || '';
  const programming = view.match(/function renderProgramming\(\)[\s\S]*?function renderModulePickerModal/)?.[0] || '';
  const fillerRenderer = view.match(/function renderFiller\(\)[\s\S]*?function renderEditorSaveBar/)?.[0] || '';
  const publish = view.match(/function renderPublish\(\)[\s\S]*?function renderLinksAssistant/)?.[0] || '';
  assert.doesNotMatch(settings, /O aplicativo só publica arquivos \.py dentro desta pasta/);
  assert.doesNotMatch(programming, /<strong>Programação-base:<\/strong>/);
  assert.doesNotMatch(fillerRenderer, /<strong>EPG:<\/strong>/);
  assert.match(view, /Aqui você escolhe o canal que usa este script\. Na primeira vez, cadastre o caminho do script no Playout do ErsatzTV\./);
  assert.match(publish, /Na primeira vez, cadastre este caminho no Scripted Schedule do Playout no ErsatzTV\. Depois, é só salvar por aqui/);
});

test('Graphics variable help explains custom keys and built-in media data without inventing a fixed list', () => {
  const view = read('js/scriptedSchedulesView.js');
  const help = read('js/helpView.js');
  assert.match(view, /Não existe uma lista fixa: cada YAML pode criar as próprias variáveis/);
  assert.match(view, /se o YAML usa \{\{ promo_text \}\}, a chave aqui é promo_text/);
  assert.match(help, /Variáveis dos Graphics/);
  assert.match(help, /Não existe uma lista fixa/);
  for (const name of ['MediaItem_Title', 'MediaItem_Artist', 'MediaItem_Path', 'MediaItem_Duration']) assert.match(help, new RegExp(name));
  assert.match(help, /não precisam ser cadastrados aqui/);
});

test('Graphics Element fields normalize a leading slash when editing', () => {
  const view = read('js/scriptedSchedulesView.js');
  assert.match(view, /function normalizeGraphicsElementPath/);
  assert.match(view, /replace\(\/\^\\\/\+\/, ''\)/);
  assert.match(view, /isGraphicsListPath/);
  assert.match(view, /graphicsGroups\\\.\\d\+\\\.graphics/);
  assert.match(view, /presentationProfiles\\\.\\d\+\\\.graphics/);
  assert.match(view, /event\.type === 'change'/);
});
