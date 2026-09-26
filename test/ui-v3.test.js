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
  assert.match(html, /\/js\/destinationForm\.js\?v=3\.0\.0/);
  assert.match(html, /\/js\/channelsView\.js\?v=3\.0\.0/);
});
