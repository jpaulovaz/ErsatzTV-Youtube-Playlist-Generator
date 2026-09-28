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
  assert.match(html, /\/js\/destinationForm\.js\?v=3\.2\.0/);
  assert.match(html, /\/js\/channelsView\.js\?v=3\.2\.0/);
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


test('Scripted Schedules is an isolated builder view with all Universal v1.1.1 modules', () => {
  const html = read('index.html');
  const app = read('app.js');
  const view = read('js/scriptedSchedulesView.js');
  const css = read('scripted-schedules.css');
  const server = read('../src/server.js');

  assert.match(html, /data-view="scripted-schedules"/);
  assert.match(html, /id="view-scripted-schedules"/);
  assert.match(html, /id="scriptedSchedulesRoot"/);
  assert.match(html, /scripted-schedules\.css\?v=3\.2\.0/);
  assert.match(html, /scriptedSchedulesView\.js\?v=3\.2\.0/);
  assert.match(app, /'scripted-schedules'/);
  assert.match(app, /ScriptedSchedulesView\.init/);
  assert.match(server, /handleScriptedScheduleRoutes/);

  for (const moduleName of ['rotation', 'fixedEvents', 'fixedDurationEvents', 'fixedAllEvents', 'fixedWindowEvents', 'windowRotations', 'sequenceEvents', 'intervalEvents', 'dateEvents', 'offlineWindows']) {
    assert.match(view, new RegExp(`${moduleName}:`));
  }
  assert.match(view, /toggle-filler/);
  assert.match(view, /Presentation Profiles/);
  assert.match(view, /Scripted Playlists/);
  assert.match(view, /Grupos de Graphics/);
  assert.match(css, /\.ss-editor-tabs/);
  assert.doesNotMatch(view, /\b(?:alert|confirm|prompt)\s*\(/);
});
