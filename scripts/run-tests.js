const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const EXCLUDED = new Set([
  'movieMetadataService.test.js',
  'showMetadataService.test.js',
  'releaseDateService.test.js'
]);

const tests = fs.readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.js') && !EXCLUDED.has(name))
  .sort()
  .map((name) => path.join('test', name));

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ersatztv-tests-'));
const logDir = path.join(testRoot, 'logs');
const scriptedSchedulesDir = path.join(testRoot, 'scripted-schedules');
try {
  const result = spawnSync(process.execPath, ['--test', ...tests], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ERSATZTV_LOG_DIR: logDir,
      ERSATZTV_CONFIG_DIR: path.join(testRoot, 'config'),
      ERSATZTV_SCRIPTED_SCHEDULES_DIR: scriptedSchedulesDir
    }
  });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
