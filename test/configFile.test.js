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

test('clean install creates a current v9 config and saveConfig persists it atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ersatztv-config-'));
  try {
    const result = runConfigScript(root, `
      (async () => {
        const config = require('./src/config');
        const loaded = await config.loadConfig();
        if (loaded.configVersion !== 9) throw new Error('unexpected config version');
        loaded.server.port = 4312;
        await config.saveConfig(loaded);
      })().catch((error) => { console.error(error); process.exit(1); });
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(saved.configVersion, 9);
    assert.equal(saved.server.port, 4312);
    assert.equal(Object.hasOwn(saved.downloads, 'updateExistingThumbnails'), false);
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
    assert.match(result.stderr, /aceita somente configVersion 9/);
    const stillOld = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(stillOld.configVersion, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
