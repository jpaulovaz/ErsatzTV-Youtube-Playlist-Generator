const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function runConfigScript(configDir, source) {
  return spawnSync(process.execPath, ['-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ERSATZTV_CONFIG_DIR: configDir }
  });
}

test('clean install creates a current v11 config and saveConfig persists it atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ersatztv-config-'));
  try {
    const result = runConfigScript(root, `
      (async () => {
        const config = require('./src/config');
        const loaded = await config.loadConfig();
        if (loaded.configVersion !== 11) throw new Error('unexpected config version');
        loaded.server.port = 4312;
        await config.saveConfig(loaded);
      })().catch((error) => { console.error(error); process.exit(1); });
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(saved.configVersion, 11);
    assert.equal(saved.server.port, 4312);
    assert.equal(Object.hasOwn(saved.downloads, 'updateExistingThumbnails'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});



test('loadConfig migrates configVersion 9 to 11 adding Bazarr and Tesseract defaults without losing existing values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ersatztv-config-v9-'));
  try {
    const legacy = {
      configVersion: 9,
      server: { host: '127.0.0.1', port: 4111 },
      paths: { baseDir: '/srv/media/youtube', channelsBaseDir: '/srv/media/channels' },
      downloads: { maxHeight: 720 },
      youtubeApi: { enabled: false },
      ersatztv: { url: 'http://localhost:8409', apiKey: '' },
      playlists: [], channels: [], scheduler: { enabled: false }, channelScheduler: { enabled: false }
    };
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(legacy) + '\n');
    const result = runConfigScript(root, `
      (async () => {
        const config = require('./src/config');
        const loaded = await config.loadConfig();
        if (loaded.configVersion !== 11) throw new Error('migration failed');
        if (loaded.server.port !== 4111) throw new Error('value lost');
        if (loaded.bazarr.enabled !== false) throw new Error('bazarr should default disabled');
        if (loaded.paths.tesseractPath !== '/usr/bin/tesseract') throw new Error('tesseract default missing');
      })().catch((error) => { console.error(error); process.exit(1); });
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(saved.configVersion, 11);
    assert.equal(saved.server.port, 4111);
    assert.equal(saved.bazarr.enabled, false);
    assert.deepEqual(saved.bazarr.pathMappings, []);
    assert.equal(saved.paths.tesseractPath, '/usr/bin/tesseract');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('loadConfig rejects an old config instead of silently migrating it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ersatztv-config-old-'));
  try {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ configVersion: 2 }) + '\n');
    const result = runConfigScript(root, `
      (async () => {
        const config = require('./src/config');
        await config.loadConfig();
      })().catch((error) => { console.error(error.message); process.exit(23); });
    `);
    assert.equal(result.status, 23);
    assert.match(result.stderr, /aceita configVersion 11/);
    const stillOld = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(stillOld.configVersion, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
