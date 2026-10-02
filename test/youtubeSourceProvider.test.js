const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchVideosFromSourceViaYtDlp,
  fetchViaYtDlp
} = require('../src/discovery/youtubeSourceProvider');

function config() {
  return {
    paths: { ytDlpPath: '/usr/local/bin/yt-dlp', ffmpegPath: '/usr/bin/ffmpeg', cookiesPath: '' },
    downloads: { jsRuntimeMode: 'disabled', ejsComponents: 'none', userAgent: '' }
  };
}

test('yt-dlp nonzero exit keeps parsed videos but marks discovery non-authoritative', async () => {
  const result = await fetchVideosFromSourceViaYtDlp(
    config(),
    { name: 'Teste', sourceKind: 'playlist' },
    'https://www.youtube.com/playlist?list=PLTEST',
    0,
    { runner: async () => ({ code: 1, timedOut: false, stdout: '{"id":"aaaaaaaaaaa","title":"A"}\n', stderr: 'one item failed' }) }
  );
  assert.equal(result.videos.length, 1);
  assert.equal(result.authoritative, false);
  assert.ok(result.partialReasons.includes('ytdlp_exit_1'));
});


test('yt-dlp --ignore-errors output with an ERROR line is non-authoritative even when exit code is zero', async () => {
  const result = await fetchVideosFromSourceViaYtDlp(
    config(),
    { name: 'Teste', sourceKind: 'playlist' },
    'https://www.youtube.com/playlist?list=PLTEST',
    0,
    { runner: async () => ({ code: 0, timedOut: false, stdout: '{"id":"aaaaaaaaaaa","title":"A"}\n', stderr: 'ERROR: [youtube] item failed' }) }
  );
  assert.equal(result.videos.length, 1);
  assert.equal(result.authoritative, false);
  assert.ok(result.partialReasons.includes('ytdlp_reported_error'));
});

test('yt-dlp timeout and malformed JSON are non-authoritative', async () => {
  const result = await fetchVideosFromSourceViaYtDlp(
    config(),
    { name: 'Teste', sourceKind: 'playlist' },
    'https://www.youtube.com/playlist?list=PLTEST',
    0,
    { runner: async () => ({ code: 0, timedOut: true, stdout: '{"id":"aaaaaaaaaaa"}\nnot-json\n', stderr: '' }) }
  );
  assert.equal(result.videos.length, 1);
  assert.equal(result.authoritative, false);
  assert.ok(result.partialReasons.includes('timeout'));
  assert.ok(result.partialReasons.includes('invalid_json_lines'));
});

test('a successful confirmed empty yt-dlp source is authoritative', async () => {
  const result = await fetchVideosFromSourceViaYtDlp(
    config(),
    { name: 'Teste', sourceKind: 'playlist' },
    'https://www.youtube.com/playlist?list=PLTEST',
    0,
    { runner: async () => ({ code: 0, timedOut: false, stdout: '', stderr: '' }) }
  );
  assert.deepEqual(result.videos, []);
  assert.equal(result.authoritative, true);
  assert.deepEqual(result.partialReasons, []);
});

test('one failed URL makes a multi-source destination non-authoritative', async () => {
  let call = 0;
  const result = await fetchViaYtDlp(
    config(),
    {
      name: 'Multi',
      sourceKind: 'playlist',
      urls: [
        'https://www.youtube.com/playlist?list=PLA',
        'https://www.youtube.com/playlist?list=PLB'
      ]
    },
    {
      runner: async () => {
        call += 1;
        if (call === 1) return { code: 0, timedOut: false, stdout: '{"id":"aaaaaaaaaaa","title":"A"}\n', stderr: '' };
        return { code: 1, timedOut: false, stdout: '{"id":"bbbbbbbbbbb","title":"B"}\n', stderr: 'partial' };
      }
    }
  );
  assert.equal(result.videos.length, 2);
  assert.equal(result.authoritative, false);
  assert.ok(result.partialReasons.some((reason) => reason === 'source_2:ytdlp_exit_1'));
});
