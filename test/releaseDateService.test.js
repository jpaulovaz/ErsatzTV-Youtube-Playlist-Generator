const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDateOnly,
  releaseMetadataFromVideo,
  mergeReleaseMetadata
} = require('../src/releaseMetadataUtils');
const { fetchOneViaYtDlp, fetchReleaseMetadataForItems } = require('../src/releaseDateService');

test('normalizes YouTube API timestamps and yt-dlp upload dates into release metadata', () => {
  assert.equal(normalizeDateOnly('20250612'), '2025-06-12');
  assert.equal(normalizeDateOnly('2025-06-12T14:30:00Z'), '2025-06-12');
  assert.equal(normalizeDateOnly('invalid'), null);

  const api = releaseMetadataFromVideo({ publishedAt: '2025-06-12T14:30:00Z' });
  assert.deepEqual(api, {
    publishedAt: '2025-06-12T14:30:00Z',
    uploadDate: null,
    releaseDate: '2025-06-12',
    releaseDateSource: 'youtube',
    year: 2025
  });

  const ytdlp = releaseMetadataFromVideo({ uploadDate: '20240309' });
  assert.equal(ytdlp.releaseDate, '2024-03-09');
  assert.equal(ytdlp.year, 2024);
});

test('merges new exact dates without erasing previously stored metadata', () => {
  const merged = mergeReleaseMetadata(
    { publishedAt: null, uploadDate: null, releaseDate: null, releaseDateSource: null, year: 2020 },
    { publishedAt: '2025-06-12T14:30:00Z', releaseDate: '2025-06-12', releaseDateSource: 'youtube', year: 2025 }
  );
  assert.equal(merged.publishedAt, '2025-06-12T14:30:00Z');
  assert.equal(merged.releaseDate, '2025-06-12');
  assert.equal(merged.year, 2025);
});

test('release-date enrichment prefers the configured YouTube API and falls back to yt-dlp per missing item', async () => {
  const config = {
    youtubeApi: { enabled: true, readMode: 'api', apiKey: 'test-key' },
    paths: { ytDlpPath: '/fake/yt-dlp', ffmpegPath: '/fake/ffmpeg', cookiesPath: '' },
    downloads: { jsRuntimeMode: 'disabled', ejsComponents: 'none', userAgent: '' }
  };
  const items = [
    { videoId: 'aaaaaaaaaaa', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { videoId: 'bbbbbbbbbbb', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' }
  ];
  const apiCalls = [];
  const ytdlpCalls = [];
  const result = await fetchReleaseMetadataForItems(config, {}, items, {
    fetchVideoDetails: async (_config, ids) => {
      apiCalls.push(ids);
      return {
        videosById: new Map([
          ['aaaaaaaaaaa', { id: 'aaaaaaaaaaa', publishedAt: '2025-01-02T03:04:05Z' }]
        ]),
        fetched: 1,
        fromCache: 0,
        missingIds: ['bbbbbbbbbbb']
      };
    },
    fetchOneViaYtDlp: async (_config, _source, item) => {
      ytdlpCalls.push(item.videoId);
      return releaseMetadataFromVideo({ uploadDate: '20240203' });
    }
  });

  assert.deepEqual(apiCalls, [['aaaaaaaaaaa', 'bbbbbbbbbbb']]);
  assert.deepEqual(ytdlpCalls, ['bbbbbbbbbbb']);
  assert.equal(result.byVideoId.get('aaaaaaaaaaa').releaseDate, '2025-01-02');
  assert.equal(result.byVideoId.get('bbbbbbbbbbb').releaseDate, '2024-02-03');
  assert.equal(result.apiFetched, 1);
  assert.equal(result.ytDlpFetched, 1);
});


test('yt-dlp fallback reads upload_date without downloading the video', async () => {
  const calls = [];
  const config = {
    paths: { ytDlpPath: '/fake/yt-dlp', ffmpegPath: '/usr/bin/ffmpeg', cookiesPath: '' },
    downloads: { jsRuntimeMode: 'disabled', ejsComponents: 'none', userAgent: '' }
  };
  const metadata = await fetchOneViaYtDlp(config, {}, {
    videoId: 'ccccccccccc',
    url: 'https://www.youtube.com/watch?v=ccccccccccc'
  }, {
    runner: async (command, args) => {
      calls.push({ command, args });
      return {
        code: 0,
        stdout: JSON.stringify({ id: 'ccccccccccc', title: 'Video', upload_date: '20211231' }),
        stderr: ''
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/fake/yt-dlp');
  assert.ok(calls[0].args.includes('--skip-download'));
  assert.ok(calls[0].args.includes('--dump-single-json'));
  assert.equal(metadata.releaseDate, '2021-12-31');
  assert.equal(metadata.year, 2021);
});
