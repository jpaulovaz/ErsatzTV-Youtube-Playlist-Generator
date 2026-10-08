const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const { once } = require('node:events');
const service = require('../src/subtitleManager/subtitleManagerService');
const stateStore = require('../src/subtitleManager/subtitleManagerState');
const { parseRange, streamFile } = require('../src/mediaPreviewService');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-manager-'));
  const media = path.join(root, 'video.mp4');
  await fs.writeFile(media, Buffer.from('media'));
  const sidecar = path.join(root, 'video.pt-BR.srt');
  await fs.writeFile(sidecar, '1\n00:00:01,000 --> 00:00:02,000\nOlá\n');
  const item = { id: 'library::abc', videoId: 'abc', title: 'Song', artist: 'Artist', targetPath: media, fileSizeBytes: 5, status: 'completed', storageState: 'active', mediaProfile: 'music_clips', subtitles: {} };
  const manager = { getDestinationItems: () => [item], saveNow: async () => {} };
  const destination = { id: 'library', rootPath: root, baseRootPath: root, mediaProfile: 'music_clips', sourceConfig: {} };
  const config = { paths: { ytDlpPath: '/bin/false', ffmpegPath: '/bin/false' }, downloads: { jsRuntimeMode: 'disabled' } };
  return { root, media, sidecar, item, manager, destination, config };
}

test('status detecta sidecar local antigo como origem não registrada', async () => {
  const f = await fixture();
  try {
    const status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.equal(status.tracks.length, 1);
    assert.equal(status.tracks[0].sourceType, 'unregistered');
    assert.equal(status.mediaAvailable, true);
    assert.equal(status.providers.lrclib.available, true);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('previewLocal lê inclusive legenda já existente do YouTube/legado', async () => {
  const f = await fixture();
  try {
    const preview = await service.previewLocal({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id }, { language: 'pt-BR' });
    assert.equal(preview.cues[0].text, 'Olá');
    assert.match(preview.vtt, /^WEBVTT/);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('applyOffset cria histórico e desloca SRT ativo', async () => {
  const f = await fixture();
  try {
    await service.applyOffset({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id }, { language: 'pt-BR', offsetMs: 500 });
    const text = await fs.readFile(f.sidecar, 'utf8');
    assert.match(text, /00:00:01,500 --> 00:00:02,500/);
    const status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.equal(status.history['pt-BR'].length >= 1, true);
    assert.equal(status.tracks[0].lastAppliedOffsetMs, 500);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('restoreHistory recupera a versão anterior e preserva undo', async () => {
  const f = await fixture();
  try {
    await service.applyOffset({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id }, { language: 'pt-BR', offsetMs: 500 });
    let status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    const historyId = status.history['pt-BR'][0].id;
    await service.restoreHistory({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id }, { language: 'pt-BR', historyId });
    const text = await fs.readFile(f.sidecar, 'utf8');
    assert.match(text, /00:00:01,000 --> 00:00:02,000/);
    status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.ok(status.history['pt-BR'].length >= 1);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('parseRange suporta seek e rejeita range inválido', () => {
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange('bytes=100-120', 100), { invalid: true });
});

test('preview de candidato LRCLIB não modifica sidecar ativo', async () => {
  const f = await fixture();
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ id: 77, trackName: 'Song', artistName: 'Artist', duration: 10, syncedLyrics: '[00:01.00]Novo\n[00:03.00]Texto' }) });
  try {
    const before = await fs.readFile(f.sidecar, 'utf8');
    const preview = await service.previewCandidate(
      { config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id },
      { provider: 'lrclib', candidateId: '77', language: 'pt-BR' }
    );
    const after = await fs.readFile(f.sidecar, 'utf8');
    assert.equal(after, before);
    assert.equal(preview.cues[0].text, 'Novo');
  } finally { global.fetch = previousFetch; await fs.rm(f.root, { recursive: true, force: true }); }
});

test('apply LRCLIB substitui apenas idioma escolhido e preserva outro sidecar', async () => {
  const f = await fixture();
  const en = path.join(f.root, 'video.en.srt');
  await fs.writeFile(en, '1\n00:00:00,500 --> 00:00:01,500\nEnglish\n');
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ id: 88, trackName: 'Song', artistName: 'Artist', duration: 10, syncedLyrics: '[00:02.00]Nova linha' }) });
  try {
    const enBefore = await fs.readFile(en, 'utf8');
    await service.applyCandidate(
      { config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id },
      { provider: 'lrclib', candidateId: '88', language: 'pt-BR', offsetMs: -500 }
    );
    const pt = await fs.readFile(f.sidecar, 'utf8');
    const enAfter = await fs.readFile(en, 'utf8');
    assert.match(pt, /00:00:01,500/);
    assert.equal(enAfter, enBefore);
    const status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.equal(status.tracks.find((t) => t.language === 'pt-BR').provider, 'lrclib');
  } finally { global.fetch = previousFetch; await fs.rm(f.root, { recursive: true, force: true }); }
});

test('histórico mantém no máximo cinco versões por faixa', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 6; i += 1) {
      await service.applyOffset({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id }, { language: 'pt-BR', offsetMs: 100 });
    }
    const status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.equal(status.history['pt-BR'].length, 5);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('item com caminho fora do destination não expõe mídia nem escrita', async () => {
  const f = await fixture();
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.mp4`);
  await fs.writeFile(outside, 'x');
  f.item.targetPath = outside;
  try {
    const status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.equal(status.mediaAvailable, false);
    assert.equal(status.canApply, false);
  } finally { await fs.rm(outside, { force: true }); await fs.rm(f.root, { recursive: true, force: true }); }
});

test('parseRange aceita finais abertos e suffix ranges', () => {
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
});

test('download gerenciado atualiza proveniencia quando um SRT apagado e recriado recebe nova origem', async () => {
  const f = await fixture();
  f.item.id = `library::managed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await service.registerManagedDownload(f.item, [
      { language: 'pt-BR', targetPath: f.sidecar },
      { language: 'en', targetPath: path.join(f.root, 'video.en.srt') }
    ]);
    let state = await stateStore.load();
    assert.equal(state.items[f.item.id].tracks['pt-BR'].provider, 'youtube');
    assert.equal(state.items[f.item.id].tracks['pt-BR'].sourceType, 'unknown');
    assert.equal(state.items[f.item.id].tracks['pt-BR'].sourceLabel, 'YouTube · tipo não identificado');

    state.items[f.item.id].tracks['pt-BR'] = {
      provider: 'lrclib', providerId: '99', sourceType: 'synced-lyrics', sourceLabel: 'LRCLIB · letra sincronizada', appliedAt: new Date().toISOString(), lastAppliedOffsetMs: 0
    };
    await stateStore.save(state);
    await service.registerManagedDownload(f.item, [{ language: 'pt-BR', targetPath: f.sidecar }]);
    state = await stateStore.load();
    assert.equal(state.items[f.item.id].tracks['pt-BR'].provider, 'youtube');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});


test('streamFile entrega Range 206 com o trecho exato da mídia', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-range-'));
  const media = path.join(root, 'sample.mp4');
  await fs.writeFile(media, Buffer.from('0123456789'));
  class CaptureResponse extends Writable {
    constructor() { super(); this.statusCode = 0; this.headers = {}; this.chunks = []; }
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers || {}; return this; }
    _write(chunk, encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  }
  const res = new CaptureResponse();
  const finished = once(res, 'finish');
  try {
    await streamFile({ method: 'GET', headers: { range: 'bytes=2-5' } }, res, media);
    await finished;
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['Content-Range'], 'bytes 2-5/10');
    assert.equal(res.headers['Accept-Ranges'], 'bytes');
    assert.equal(Buffer.concat(res.chunks).toString(), '2345');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('idioma de destino aceita apenas pt-BR, en e es', () => {
  assert.equal(service.normalizeTargetLanguage('pt-BR'), 'pt-BR');
  assert.equal(service.normalizeTargetLanguage('English'), 'en');
  assert.equal(service.normalizeTargetLanguage('es'), 'es');
  assert.throws(() => service.normalizeTargetLanguage('und'), /Idioma de destino invalido/);
});

test('excluir legenda remove SRT ativo e preserva cópia restaurável no histórico', async () => {
  const f = await fixture();
  f.item.id = `library::delete-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const result = await service.deleteLocalSubtitle(
      { config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id },
      { language: 'pt-BR' }
    );
    await assert.rejects(() => fs.access(f.sidecar), (error) => error.code === 'ENOENT');
    assert.equal(result.recoverable, true);
    let status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.equal(status.tracks.length, 0);
    assert.equal(status.history['pt-BR'].length, 1);
    assert.deepEqual(f.item.subtitles.foundLanguages, []);

    await service.restoreHistory(
      { config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id },
      { language: 'pt-BR', historyId: status.history['pt-BR'][0].id }
    );
    assert.match(await fs.readFile(f.sidecar, 'utf8'), /Olá/);
    status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.equal(status.tracks[0].language, 'pt-BR');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('faixa gerada UND usa sidecar sem sufixo e continua gerenciavel', async () => {
  const f = await fixture();
  f.item.id = `library::bilingual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await service.applyGeneratedSubtitle(
      { config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id },
      {
        language: 'und',
        content: '1\n00:00:01,000 --> 00:00:03,000\nHello\nOlá\n',
        replace: true,
        track: { provider: 'gemini', sourceType: 'translation', sourceLabel: 'Gemini · bilíngue', metadata: { sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'bilingual' } }
      }
    );
    const direct = path.join(f.root, 'video.srt');
    assert.match(await fs.readFile(direct, 'utf8'), /Hello\nOlá/);
    const status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    const bilingual = status.tracks.find((track) => track.language === 'und');
    assert.equal(bilingual.provider, 'gemini');
    assert.equal(bilingual.metadata.outputMode, 'bilingual');
    assert.ok(f.item.subtitles.foundLanguages.includes('und'));
    const preview = await service.previewLocal(
      { config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id },
      { language: 'und' }
    );
    assert.equal(preview.language, 'und');
    assert.match(preview.cues[0].text, /Hello\nOlá/);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('apply LRCLIB usa o idioma de destino escolhido e nunca persiste UND', async () => {
  const f = await fixture();
  f.item.id = `library::target-language-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ id: 109, trackName: 'Song', artistName: 'Artist', duration: 10, syncedLyrics: '[00:01.00]Line' }) });
  try {
    await service.applyCandidate(
      { config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id },
      { provider: 'lrclib', candidateId: '109', language: 'en', offsetMs: 0 }
    );
    assert.match(await fs.readFile(path.join(f.root, 'video.en.srt'), 'utf8'), /Line/);
    await assert.rejects(() => fs.access(path.join(f.root, 'video.und.srt')), (error) => error.code === 'ENOENT');
    const status = await service.getStatus({ config: f.config, destination: f.destination, downloadManager: f.manager, itemId: f.item.id });
    assert.ok(status.tracks.some((track) => track.language === 'en'));
    assert.ok(!status.tracks.some((track) => track.language === 'und'));
  } finally { global.fetch = previousFetch; await fs.rm(f.root, { recursive: true, force: true }); }
});
