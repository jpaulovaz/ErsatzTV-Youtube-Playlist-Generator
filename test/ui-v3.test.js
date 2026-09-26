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
  assert.match(html, /\/js\/destinationForm\.js\?v=3\.0\.1/);
  assert.match(html, /\/js\/channelsView\.js\?v=3\.0\.1/);
  assert.match(html, /rev=channel-summary-2/);
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
