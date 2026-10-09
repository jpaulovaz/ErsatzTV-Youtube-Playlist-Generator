const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const tests = fs.readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join('test', name));

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ersatztv-tests-'));
const logDir = path.join(testRoot, 'logs');
const scriptedSchedulesDir = path.join(testRoot, 'scripted-schedules');
try {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ERSATZTV_LOG_DIR: logDir,
      ERSATZTV_CONFIG_DIR: path.join(testRoot, 'config'),
      ERSATZTV_SCRIPTED_SCHEDULES_DIR: scriptedSchedulesDir,
      ERSATZTV_SUBTITLE_MANAGER_DIR: path.join(testRoot, 'subtitle-manager'),
      ERSATZTV_SUBTITLE_TRANSLATION_DIR: path.join(testRoot, 'subtitle-translation'),
      ERSATZTV_SUBTITLE_TRANSLATION_CONFIG_PATH: path.join(testRoot, 'config', 'subtitle-translation.json'),
      ERSATZTV_YOUTUBE_MANAGER_STATE_PATH: path.join(testRoot, 'data', 'youtube-manager-state.json'),
      ERSATZTV_YOUTUBE_ACCOUNT_STATE_PATH: path.join(testRoot, 'data', 'youtube-account-state.json'),
      ERSATZTV_YOUTUBE_ACCOUNT_CONFIG_PATH: path.join(testRoot, 'config', 'youtube-account.json'),
      ERSATZTV_YOUTUBE_CACHE_PATH: path.join(testRoot, 'data', 'youtube-cache.json')
    }
  });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
