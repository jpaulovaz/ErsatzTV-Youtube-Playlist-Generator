const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const lrclib = require('../src/subtitleProviders/lrclibProvider');
const youtube = require('../src/subtitleProviders/youtubeProvider');
const { scoreCandidate } = require('../src/subtitleProviders/matchScore');

function configWithYtDlp(executable) {
  return { paths: { ytDlpPath: executable, ffmpegPath: '/usr/bin/ffmpeg' }, downloads: { jsRuntimeMode: 'disabled', ejsComponents: 'none', userAgent: '' } };
}

test('scoreCandidate favorece artista/título exatos', () => {
  const exact = scoreCandidate({ artist: 'Artist', track: 'Song', album: '' }, { artistName: 'Artist', trackName: 'Song', duration: 200 }, 201);
  const other = scoreCandidate({ artist: 'Artist', track: 'Song', album: '' }, { artistName: 'Other', trackName: 'Song Live', duration: 280 }, 201);
  assert.ok(exact.score > other.score);
  assert.equal(exact.label, 'Excelente');
});

test('LRCLIB normaliza resultado sincronizado', () => {
  const item = lrclib.normalizeRecord({ id: 42, trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 200, syncedLyrics: '[00:01.00]x' }, { artist: 'Artist', track: 'Song', album: 'Album' }, 201);
  assert.equal(item.candidateId, '42');
  assert.equal(item.canApply, true);
});

test('LRCLIB mantém resultado sem sincronização apenas para consulta', () => {
  const item = lrclib.normalizeRecord({ id: 43, trackName: 'Song', artistName: 'Artist', plainLyrics: 'x' }, { artist: 'Artist', track: 'Song' }, 200);
  assert.equal(item.canApply, false);
  assert.ok(item.warnings.some((value) => /sem letra sincronizada/i.test(value)));
});

test('LRCLIB search usa API sob demanda e materialize converte syncedLyrics', async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const payload = String(url).includes('/api/search')
      ? [{ id: 99, trackName: 'Song', artistName: 'Artist', duration: 10, syncedLyrics: '[00:01.00]A' }]
      : { id: 99, trackName: 'Song', artistName: 'Artist', duration: 10, syncedLyrics: '[00:01.00]A\n[00:03.00]B' };
    return { ok: true, status: 200, headers: new Map(), json: async () => payload };
  };
  try {
    const found = await lrclib.search({ durationSeconds: 10 }, { artist: 'Artist', track: 'Song' });
    assert.equal(found.candidates.length, 1);
    const materialized = await lrclib.materialize({ durationSeconds: 10 }, { candidateId: '99' }, { language: 'pt-BR' });
    assert.equal(materialized.language, 'pt-BR');
    assert.equal(materialized.cues.length, 2);
    assert.ok(calls.some((url) => url.includes('/api/search')));
    assert.ok(calls.some((url) => url.includes('/api/get/99')));
  } finally { global.fetch = previous; }
});

test('YouTube search distingue faixa manual e automática', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-provider-'));
  const stub = path.join(dir, 'yt-dlp');
  await fs.writeFile(stub, `#!/usr/bin/env node\nconsole.log(JSON.stringify({subtitles:{'pt-BR':[ {ext:'vtt',name:'Português'} ]},automatic_captions:{en:[{ext:'vtt'}]}}));\n`, { mode: 0o755 });
  try {
    const result = await youtube.search({ config: configWithYtDlp(stub), sourceConfig: {}, videoId: 'abc' });
    assert.ok(result.candidates.some((item) => item.sourceType === 'manual' && item.language === 'pt-BR'));
    assert.ok(result.candidates.some((item) => item.sourceType === 'automatic' && item.language === 'en'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('YouTube materialize aceita seleção automática exata', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-provider-'));
  const stub = path.join(dir, 'yt-dlp');
  await fs.writeFile(stub, `#!/usr/bin/env node\nconst fs=require('fs'); const path=require('path'); const args=process.argv.slice(2); const out=args[args.indexOf('-o')+1]; const target=out.replace('%(ext)s','en.srt'); fs.writeFileSync(target,'1\\n00:00:01,000 --> 00:00:02,000\\nHello\\n');\n`, { mode: 0o755 });
  try {
    const result = await youtube.materialize({ config: configWithYtDlp(stub), sourceConfig: {}, videoId: 'abc' }, { candidateId: 'auto:en' }, {});
    assert.equal(result.sourceType, 'automatic');
    assert.equal(result.cues[0].text, 'Hello');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('LRCLIB propaga 429 e Retry-After sem retry agressivo', async () => {
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: false, status: 429, headers: new Map([['retry-after', '12']]), json: async () => ({}) };
  };
  try {
    await assert.rejects(
      () => lrclib.search({ durationSeconds: 10 }, { track: 'Song' }),
      (error) => error.statusCode === 429 && error.retryAfterSeconds === 12
    );
    assert.equal(calls, 1);
  } finally { global.fetch = previous; }
});

test('LRCLIB materialize rejeita instrumental e resultado sem syncedLyrics', async () => {
  const previous = global.fetch;
  const records = new Map([
    ['1', { id: 1, instrumental: true, trackName: 'Instrumental' }],
    ['2', { id: 2, instrumental: false, trackName: 'Plain', plainLyrics: 'texto', syncedLyrics: null }]
  ]);
  global.fetch = async (url) => {
    const id = String(url).split('/').pop();
    return { ok: true, status: 200, headers: new Map(), json: async () => records.get(id) };
  };
  try {
    await assert.rejects(() => lrclib.materialize({}, { candidateId: '1' }, {}), /instrumental/i);
    await assert.rejects(() => lrclib.materialize({}, { candidateId: '2' }, {}), /nao possui letra sincronizada/i);
  } finally { global.fetch = previous; }
});
