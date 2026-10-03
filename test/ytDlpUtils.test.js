const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeJsRuntimeName,
  getYtDlpJsRuntimeArg,
  getEffectiveCookiesPath,
  buildYtDlpCommonArgs
} = require('../src/ytDlpUtils');

function config() {
  return {
    paths: {
      cookiesPath: '/global/cookies.txt',
      ffmpegPath: '/usr/bin/ffmpeg'
    },
    downloads: {
      userAgent: 'UA-Test',
      jsRuntimeMode: 'deno',
      jsRuntimePath: '/usr/local/bin/deno',
      jsRuntimeCustomName: 'deno',
      ejsComponents: 'ejs:github'
    }
  };
}

test('yt-dlp common args centralize runtime, cookies, user-agent and ffmpeg location', () => {
  const args = buildYtDlpCommonArgs(config(), { cookiesPath: '/library/cookies.txt' });
  assert.deepEqual(args, [
    '--js-runtimes', 'deno:/usr/local/bin/deno',
    '--remote-components', 'ejs:github',
    '--cookies', '/library/cookies.txt',
    '--add-header', 'User-Agent: UA-Test',
    '--ffmpeg-location', '/usr/bin',
    '--no-color'
  ]);
});

test('yt-dlp helpers sanitize custom runtimes and fall back to global cookies', () => {
  const value = config();
  value.downloads.jsRuntimeMode = 'custom';
  value.downloads.jsRuntimeCustomName = 'bun; rm -rf /';
  value.downloads.jsRuntimePath = '/opt/bun';
  assert.equal(sanitizeJsRuntimeName(value.downloads.jsRuntimeCustomName), 'bunrm-rf');
  assert.equal(getYtDlpJsRuntimeArg(value), 'bunrm-rf:/opt/bun');
  assert.equal(getEffectiveCookiesPath(value, {}), '/global/cookies.txt');
});
