const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const translationConfig = require('../src/subtitleTranslation/translationConfig');
const translationState = require('../src/subtitleTranslation/translationState');
const validator = require('../src/subtitleTranslation/translationValidator');
const gemini = require('../src/subtitleTranslation/providers/geminiTranslator');
const translationService = require('../src/subtitleTranslation/translationService');
const translationQueue = require('../src/subtitleTranslation/translationQueue');
const managerState = require('../src/subtitleManager/subtitleManagerState');
const { parseSrt } = require('../src/subtitleManager/subtitleFormats');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-translation-'));
  const media = path.join(root, 'Artist - Song.mp4');
  const source = path.join(root, 'Artist - Song.en.srt');
  await fs.writeFile(media, 'video');
  await fs.writeFile(source, '1\n00:00:01,000 --> 00:00:03,500\n<i>Hello world</i>\n\n2\n00:00:04,000 --> 00:00:06,000\n♪\n');
  const item = { id: 'item-1', videoId: 'abc', title: 'Song', trackTitle: 'Song', artist: 'Artist', targetPath: media, status: 'completed', storageState: 'active', sourceActive: true, subtitles: { status: 'complete', foundLanguages: ['en'] } };
  const destination = { id: 'library', rootPath: root, displayName: 'Library', mediaProfile: 'music-clips' };
  const downloadManager = { getDestinationItems: () => [item], saveNow: async () => {} };
  return { root, media, source, item, destination, downloadManager };
}

test('translation config stores secret server-side and public status never returns the key', async () => {
  const saved = await translationConfig.save({ apiKey: 'secret-key', model: 'gemini-3.6-flash', batchSize: 250, concurrency: 2 });
  assert.equal(saved.apiKey, 'secret-key');
  const publicValue = translationConfig.publicStatus(saved);
  assert.equal(publicValue.configured, true);
  assert.equal('apiKey' in publicValue, false);
  assert.equal(publicValue.batchSize, 250);
  const stat = await fs.stat(translationConfig.CONFIG_PATH);
  assert.equal(stat.mode & 0o077, 0);
});

test('translation validator accepts numeric/string IDs and rejects missing or duplicate cues', () => {
  const map = validator.normalizeTranslations({ translations: [{ id: 1, text: 'Um' }, { id: '2', text: 'Dois' }] }, ['1', '2']);
  assert.equal(map.get('1'), 'Um');
  assert.throws(() => validator.normalizeTranslations({ translations: [{ id: 1, text: 'Um' }] }, ['1', '2']), /omitiu/);
  assert.throws(() => validator.normalizeTranslations({ translations: [{ id: 1, text: 'Um' }, { id: '1', text: 'Outro' }] }, ['1']), /duplicado/);
});

test('translated and bilingual output preserve cue count and exact timeline', () => {
  const source = [{ startMs: 1000, endMs: 2000, text: 'Hello' }, { startMs: 3000, endMs: 4000, text: '♪' }];
  const translations = new Map([['1', 'Olá']]);
  const translated = validator.renderValidatedSrt(source, translations, 'translated').cues;
  const bilingual = validator.renderValidatedSrt(source, translations, 'bilingual').cues;
  assert.deepEqual(translated.map(({ startMs, endMs }) => [startMs, endMs]), [[1000, 2000], [3000, 4000]]);
  assert.equal(bilingual[0].text, 'Hello\nOlá');
  assert.equal(bilingual[1].text, '♪');
});

test('Gemini provider sends API key in header and consumes structured JSON', async () => {
  const previous = global.fetch;
  let seen;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ id: '1', text: 'Olá' }] }) }] } }] }) };
  };
  try {
    const result = await gemini.translate({ apiKey: 'abc', model: 'gemini-3.6-flash', timeoutSeconds: 10, maxAttempts: 1 }, { sourceLanguage: 'en', targetLanguage: 'pt-BR', context: {}, cues: [{ id: '1', text: 'Hello' }] });
    assert.equal(seen.options.headers['x-goog-api-key'], 'abc');
    assert.doesNotMatch(seen.url, /abc/);
    const body = JSON.parse(seen.options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(result.translations[0].text, 'Olá');
  } finally { global.fetch = previous; }
});

test('translation preflight counts eligible, existing target and missing source without API calls', async (t) => {
  const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  let plan = await translationService.buildPlan({ destination: f.destination, downloadManager: f.downloadManager, payload: { sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'translated', existingPolicy: 'skip', scope: 'all' } });
  assert.equal(plan.counts.eligible, 1);
  assert.equal(plan.totals.totalCues, 2);
  await fs.writeFile(path.join(f.root, 'Artist - Song.pt-BR.srt'), '1\n00:00:01,000 --> 00:00:02,000\nVelho\n');
  plan = await translationService.buildPlan({ destination: f.destination, downloadManager: f.downloadManager, payload: { sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'translated', existingPolicy: 'skip', scope: 'all' } });
  assert.equal(plan.counts.targetExists, 1);
  assert.equal(plan.counts.eligible, 0);
});

test('translation item preserves source, tags and timeline and registers Gemini provenance', async (t) => {
  const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await translationConfig.save({ apiKey: 'secret-key', model: 'gemini-3.6-flash', batchSize: 300, concurrency: 1, maxAttempts: 1 });
  const original = await fs.readFile(f.source, 'utf8');
  const previous = global.fetch;
  global.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    assert.match(prompt, /__ETV_TAG_1_0__/);
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ id: '1', text: '__ETV_TAG_1_0__Olá mundo__ETV_TAG_1_1__' }] }) }] } }] }) };
  };
  try {
    await translationService.translateItem({ jobId: 'job-1', destination: f.destination, downloadManager: f.downloadManager, itemId: f.item.id, options: { sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'translated', existingPolicy: 'replace' } });
  } finally { global.fetch = previous; }
  assert.equal(await fs.readFile(f.source, 'utf8'), original);
  const output = await fs.readFile(path.join(f.root, 'Artist - Song.pt-BR.srt'), 'utf8');
  const sourceCues = parseSrt(original); const outputCues = parseSrt(output);
  assert.equal(outputCues.length, sourceCues.length);
  assert.deepEqual(outputCues.map((c) => [c.startMs, c.endMs]), sourceCues.map((c) => [c.startMs, c.endMs]));
  assert.match(output, /<i>Olá mundo<\/i>/);
  const state = await managerState.load();
  assert.equal(state.items[f.item.id].tracks['pt-BR'].provider, 'gemini');
  assert.equal(state.items[f.item.id].tracks['pt-BR'].metadata.sourceLanguage, 'en');
  assert.match(state.items[f.item.id].tracks['pt-BR'].metadata.sourceHash, /^sha256:/);
});

test('modo both traduz uma vez e publica traduzida e bilingue UND simultaneamente', async (t) => {
  const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.item.id = `item-both-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await translationConfig.save({ apiKey: 'secret-key', model: 'gemini-3.6-flash', batchSize: 300, concurrency: 1, maxAttempts: 1 });
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ id: '1', text: '__ETV_TAG_1_0__Olá mundo__ETV_TAG_1_1__' }] }) }] } }] }) };
  };
  try {
    const result = await translationService.translateItem({ jobId: `job-both-${Date.now()}`, destination: f.destination, downloadManager: f.downloadManager, itemId: f.item.id, options: { sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'both', existingPolicy: 'replace' } });
    assert.deepEqual(result.outputs.sort(), ['bilingual', 'translated']);
  } finally { global.fetch = previous; }
  assert.equal(calls, 1);

  const translated = await fs.readFile(path.join(f.root, 'Artist - Song.pt-BR.srt'), 'utf8');
  const bilingual = await fs.readFile(path.join(f.root, 'Artist - Song.srt'), 'utf8');
  assert.match(translated, /<i>Olá mundo<\/i>/);
  assert.match(bilingual, /<i>Hello world<\/i>\n<i>Olá mundo<\/i>/);
  const state = await managerState.load();
  assert.equal(state.items[f.item.id].tracks['pt-BR'].metadata.outputMode, 'translated');
  assert.equal(state.items[f.item.id].tracks.und.metadata.outputMode, 'bilingual');
  assert.equal(state.items[f.item.id].tracks.und.metadata.ersatzTvLanguage, 'und');
  assert.deepEqual([...f.item.subtitles.foundLanguages].sort(), ['en', 'pt-BR', 'und']);
});

test('preflight both separa existencia e geracao de traduzida e bilingue', async (t) => {
  const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(f.root, 'Artist - Song.pt-BR.srt'), '1\n00:00:01,000 --> 00:00:02,000\nVelho\n');
  let plan = await translationService.buildPlan({ destination: f.destination, downloadManager: f.downloadManager, payload: { sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'both', existingPolicy: 'skip', scope: 'all' } });
  assert.equal(plan.counts.eligible, 1);
  assert.equal(plan.counts.translatedExists, 1);
  assert.equal(plan.counts.translatedToWrite, 0);
  assert.equal(plan.counts.bilingualToWrite, 1);
  assert.equal(plan.destinationName, 'Library');

  await fs.writeFile(path.join(f.root, 'Artist - Song.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHello\nOlá\n');
  plan = await translationService.buildPlan({ destination: f.destination, downloadManager: f.downloadManager, payload: { sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'both', existingPolicy: 'skip', scope: 'all' } });
  assert.equal(plan.counts.eligible, 0);
  assert.equal(plan.counts.targetExists, 1);
  assert.equal(plan.counts.bilingualExists, 1);
});

test('translation checkpoints survive save/load and Retry-After is parsed without exposing content', async () => {
  await translationState.saveCheckpoint('job-check', 'item-check', { sourceHash: 'sha256:x', translations: [{ id: '1', text: 'ok' }] });
  const loaded = await translationState.loadCheckpoint('job-check', 'item-check');
  assert.equal(loaded.translations[0].id, '1');
  assert.equal(gemini.parseRetryAfter(new Headers({ 'retry-after': '7' })), 7);
});


test('translation queue persists progress and cancellation waits for the running item without publishing pending work', async () => {
  await translationState.save(translationState.emptyState());
  await translationConfig.save({ apiKey: 'secret-key', model: 'gemini-3.6-flash', batchSize: 300, concurrency: 1, maxAttempts: 1 });
  const config = {
    paths: { baseDir: '/tmp/translation-queue-library', channelsBaseDir: '/tmp/translation-queue-channels' },
    playlists: [{ name: 'Library', enabled: true, mediaProfile: 'music-clips', urls: [] }],
    channels: []
  };
  const downloadManager = { getDestinationItems: () => [], saveNow: async () => {} };
  translationQueue.configure({ getConfig: async () => config, downloadManager });

  const originalTranslateItem = translationService.translateItem;
  let releaseRunning;
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  translationService.translateItem = async ({ itemId }) => {
    startedResolve(itemId);
    await new Promise((resolve) => { releaseRunning = resolve; });
    return { itemId, outputPath: '/tmp/fake.srt' };
  };

  try {
    await translationQueue.init();
    const job = await translationQueue.startJob({
      destinationId: 'Library',
      sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'translated', existingPolicy: 'skip',
      scope: 'all', filter: {}, totals: {},
      eligibleItems: [{ itemId: 'one', title: 'One' }, { itemId: 'two', title: 'Two' }]
    });
    assert.equal(await started, 'one');
    await translationQueue.cancel(job.id);
    let status = await translationQueue.getStatus();
    const cancelling = status.jobs.find((entry) => entry.id === job.id);
    assert.equal(cancelling.cancelRequested, true);
    assert.equal(cancelling.counts.running, 1);
    assert.equal(cancelling.counts.cancelled, 1);

    releaseRunning();
    const deadline = Date.now() + 2000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = await translationQueue.getStatus();
      const finalJob = status.jobs.find((entry) => entry.id === job.id);
      if (finalJob && finalJob.status === 'cancelled') break;
    } while (Date.now() < deadline);

    const finalJob = status.jobs.find((entry) => entry.id === job.id);
    assert.equal(finalJob.status, 'cancelled');
    assert.equal(finalJob.counts.completed, 1);
    assert.equal(finalJob.counts.cancelled, 1);
    const persisted = await translationState.load();
    assert.equal(persisted.jobs[job.id].status, 'cancelled');
  } finally {
    translationService.translateItem = originalTranslateItem;
    await translationQueue.stop();
  }
});
