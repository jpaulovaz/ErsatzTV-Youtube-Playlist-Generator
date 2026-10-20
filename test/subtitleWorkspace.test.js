const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const service = require('../src/tools/subtitleWorkspaceService');
const translationConfig = require('../src/subtitleTranslation/translationConfig');

async function waitForScan(id) {
  for (let index = 0; index < 100; index += 1) {
    const status = service.getScanStatus(id);
    if (status.status === 'completed') return status;
    if (status.status === 'failed') throw new Error(status.error || 'scan failed');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('scan timeout');
}

function config() {
  return { paths: { ffprobePath: '/bin/false', ffmpegPath: '/bin/false', tesseractPath: '/bin/false' }, bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] } };
}

async function waitForAdvancedJob(id, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = service.getAdvancedJob(id);
    if (job.status === 'completed') return job;
    if (job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('advanced job timeout');
}

function pgsPacket(type, pts, payload = Buffer.alloc(0)) {
  const out = Buffer.alloc(13 + payload.length);
  out[0] = 0x50; out[1] = 0x47;
  out.writeUInt32BE(pts >>> 0, 2); out.writeUInt32BE(pts >>> 0, 6);
  out[10] = type; out.writeUInt16BE(payload.length, 11); payload.copy(out, 13);
  return out;
}

function syntheticPgsBuffer() {
  const composition = (objects = 1) => {
    const payload = Buffer.alloc(11 + (objects ? 8 : 0));
    payload.writeUInt16BE(1920, 0); payload.writeUInt16BE(1080, 2); payload[9] = 0; payload[10] = objects;
    if (objects) { payload.writeUInt16BE(1, 11); payload.writeUInt16BE(100, 15); payload.writeUInt16BE(900, 17); }
    return payload;
  };
  const palette = Buffer.from([0, 0, 0, 16, 128, 128, 0, 1, 235, 128, 128, 255]);
  const rle = Buffer.from([1, 1, 0, 0]);
  const ods = Buffer.alloc(11 + rle.length);
  ods.writeUInt16BE(1, 0); ods[3] = 0xC0; ods[6] = 8; ods.writeUInt16BE(2, 7); ods.writeUInt16BE(1, 9); rle.copy(ods, 11);
  return Buffer.concat([
    pgsPacket(0x16, 90000, composition(1)), pgsPacket(0x14, 90000, palette), pgsPacket(0x15, 90000, ods), pgsPacket(0x80, 90000), pgsPacket(0x16, 180000, composition(0))
  ]);
}

test('workspace faz varredura recursiva, ignora symlink e classifica sidecars', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-'));
  const nested = path.join(root, 'Season 01');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'Episode 01.mkv'), 'media');
  await fs.writeFile(path.join(nested, 'Episode 01.pt-BR.srt'), '1\n00:00:01,000 --> 00:00:02,000\nOi\n');
  await fs.writeFile(path.join(nested, 'Episode 01.en.ass'), '[Script Info]\n');
  await fs.symlink(path.join(nested, 'Episode 01.mkv'), path.join(root, 'linked.mkv'));
  try {
    const workspace = await service.createWorkspace({ name: 'Series', rootPath: root, recursive: true });
    await service.startScan(workspace.id);
    await waitForScan(workspace.id);
    const listed = await service.listItems(workspace.id, {});
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].sidecars.length, 2);
    assert.equal(listed.items[0].sidecars.find((track) => track.format === 'srt').editable, true);
    assert.equal(listed.items[0].sidecars.find((track) => track.format === 'ass').editable, false);
    assert.equal(listed.counts.editable, 1);
    assert.equal(listed.counts.readonly, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace reutiliza editor: preview, offset, histórico e conflito externo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-edit-'));
  const media = path.join(root, 'Movie.mp4');
  const srt = path.join(root, 'Movie.pt-BR.srt');
  await fs.writeFile(media, 'media');
  await fs.writeFile(srt, '1\n00:00:01,000 --> 00:00:02,000\nOi\n');
  try {
    const workspace = await service.createWorkspace({ name: 'Movies', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    const preview = await service.previewLocal(config(), { itemId: item.id, trackId: 'Movie.pt-BR.srt' });
    assert.equal(preview.cues[0].text, 'Oi');
    await service.applyOffset(config(), { itemId: item.id, trackId: 'Movie.pt-BR.srt', offsetMs: 500, expectedFingerprint: preview.fingerprint });
    assert.match(await fs.readFile(srt, 'utf8'), /00:00:01,500/);
    let status = await service.getItemStatus(config(), item.id);
    assert.equal(status.history['Movie.pt-BR.srt'].length, 1);

    const current = await service.previewLocal(config(), { itemId: item.id, trackId: 'Movie.pt-BR.srt' });
    await fs.writeFile(srt, '1\n00:00:03,000 --> 00:00:04,000\nMudou fora\n');
    await assert.rejects(
      () => service.applyOffset(config(), { itemId: item.id, trackId: 'Movie.pt-BR.srt', offsetMs: 100, expectedFingerprint: current.fingerprint }),
      (error) => error.code === 'SUBTITLE_CHANGED_EXTERNALLY' && error.statusCode === 409
    );
    status = await service.getItemStatus(config(), item.id);
    assert.ok(status.tracks.some((track) => track.trackId === 'Movie.pt-BR.srt'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace marca revisado sem alterar arquivo e filtros refletem estado', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-review-'));
  await fs.writeFile(path.join(root, 'A.mp4'), 'a');
  await fs.writeFile(path.join(root, 'B.mp4'), 'b');
  try {
    const workspace = await service.createWorkspace({ name: 'Review', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const items = (await service.listItems(workspace.id, {})).items;
    await service.setReviewStatus(items[0].id, true);
    assert.equal((await service.listItems(workspace.id, { filter: 'reviewed' })).total, 1);
    assert.equal((await service.listItems(workspace.id, { filter: 'unreviewed' })).total, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace pede confirmacao para raiz ampla, permite continuar e ainda rejeita symlink', async () => {
  await assert.rejects(
    () => service.createWorkspace({ name: 'root', rootPath: '/' }),
    (error) => error.code === 'SUBTITLE_WORKSPACE_BROAD_PATH_CONFIRM_REQUIRED' && error.statusCode === 409
  );
  const broad = await service.createWorkspace({ name: 'root', rootPath: '/', confirmBroadPath: true });
  assert.equal(broad.rootPath, '/');
  await service.deleteWorkspace(broad.id);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-root-'));
  const link = `${root}-link`;
  await fs.symlink(root, link);
  try {
    await assert.rejects(() => service.createWorkspace({ name: 'link', rootPath: link }), /link simbolico/);
  } finally { await fs.rm(link, { force: true }); await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace classifica mountpoint de primeiro nivel como aviso, nao bloqueio permanente', async () => {
  await assert.rejects(
    () => service.createWorkspace({ name: 'Mount', rootPath: '/tmp' }),
    (error) => error.code === 'SUBTITLE_WORKSPACE_BROAD_PATH_CONFIRM_REQUIRED' && error.statusCode === 409
  );
  const workspace = await service.createWorkspace({ name: 'Mount', rootPath: '/tmp', confirmBroadPath: true });
  assert.equal(workspace.rootPath, '/tmp');
  await service.deleteWorkspace(workspace.id);
});

test('workspace rejeita sync Bazarr de sidecar sem idioma antes de alterar o arquivo', async () => {
  const bazarrClient = require('../src/integrations/bazarrClient');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-und-'));
  const media = path.join(root, 'Movie.mp4');
  const srt = path.join(root, 'Movie.srt');
  await fs.writeFile(media, 'media');
  await fs.writeFile(srt, '1\n00:00:01,000 --> 00:00:02,000\nOi\n');
  const originalFind = bazarrClient.findMediaByPath;
  const originalSync = bazarrClient.syncSubtitle;
  let syncCalled = false;
  bazarrClient.findMediaByPath = async () => ({ type: 'movie', radarrId: 1, path: '/movies/Movie.mp4' });
  bazarrClient.syncSubtitle = async () => { syncCalled = true; };
  try {
    const workspace = await service.createWorkspace({ name: 'No language', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    await assert.rejects(
      () => service.bazarrSync({ ...config(), bazarr: { enabled: true, url: 'http://bazarr:6767', apiKey: 'x', pathMappings: [{ localRoot: root, bazarrRoot: '/movies' }] } }, { itemId: item.id, trackId: 'Movie.srt' }),
      (error) => error.code === 'BAZARR_SUBTITLE_LANGUAGE_REQUIRED' && error.statusCode === 409
    );
    assert.equal(syncCalled, false);
  } finally {
    bazarrClient.findMediaByPath = originalFind;
    bazarrClient.syncSubtitle = originalSync;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('workspace converte ASS/VTT textual em copia SRT preservando o original', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-convert-'));
  const media = path.join(root, 'Movie.mkv');
  const ass = path.join(root, 'Movie.en.ass');
  const original = '[Script Info]\nTitle: Demo\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Hello{\\i0}\\Nworld\n';
  await fs.writeFile(media, 'media');
  await fs.writeFile(ass, original);
  try {
    const workspace = await service.createWorkspace({ name: 'Convert', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    const result = await service.convertTrackToSrt(config(), { itemId: item.id, trackId: 'Movie.en.ass', language: 'en' });
    assert.equal(result.fileName, 'Movie.en.srt');
    assert.equal(await fs.readFile(ass, 'utf8'), original);
    assert.match(await fs.readFile(path.join(root, 'Movie.en.srt'), 'utf8'), /Hello\nworld/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace edita cues e aplica sincronizacao por dois pontos com historico', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-advanced-sync-'));
  const media = path.join(root, 'Movie.mp4');
  const srt = path.join(root, 'Movie.en.srt');
  await fs.writeFile(media, 'media');
  await fs.writeFile(srt, '1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:10,000 --> 00:00:11,000\nTwo\n');
  try {
    const workspace = await service.createWorkspace({ name: 'Advanced sync', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    let preview = await service.previewLocal(config(), { itemId: item.id, trackId: 'Movie.en.srt' });
    await service.replaceCues(config(), {
      itemId: item.id,
      trackId: 'Movie.en.srt',
      expectedFingerprint: preview.fingerprint,
      cues: [{ startMs: 1000, endMs: 2200, text: 'One edited' }, { startMs: 10000, endMs: 11000, text: 'Two' }]
    });
    assert.match(await fs.readFile(srt, 'utf8'), /One edited/);
    preview = await service.previewLocal(config(), { itemId: item.id, trackId: 'Movie.en.srt' });
    const testResult = await service.previewTimingTransform(config(), {
      itemId: item.id,
      trackId: 'Movie.en.srt',
      expectedFingerprint: preview.fingerprint,
      mode: 'two-point',
      pointA: { subtitleMs: 1000, mediaMs: 2000 },
      pointB: { subtitleMs: 10000, mediaMs: 12000 }
    });
    assert.equal(testResult.cues[0].startMs, 2000);
    assert.equal(testResult.cues[1].startMs, 12000);
    const applied = await service.applyTimingTransform(config(), {
      itemId: item.id,
      trackId: 'Movie.en.srt',
      expectedFingerprint: preview.fingerprint,
      mode: 'two-point',
      pointA: { subtitleMs: 1000, mediaMs: 2000 },
      pointB: { subtitleMs: 10000, mediaMs: 12000 }
    });
    assert.equal(applied.mode, 'two-point');
    assert.match(await fs.readFile(srt, 'utf8'), /00:00:12,000/);
    const status = await service.getItemStatus(config(), item.id);
    assert.ok(status.history['Movie.en.srt'].length >= 2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace detecta MKV H264+DTS como audio-transcode e cria preview AAC escolhendo a faixa', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-mkv-audio-'));
  const media = path.join(root, 'Movie.mkv');
  const ffprobe = path.join(root, 'fake-ffprobe.sh');
  const ffmpeg = path.join(root, 'fake-ffmpeg.sh');
  const argsLog = path.join(root, 'ffmpeg-args.txt');
  await fs.writeFile(media, 'original-mkv');
  await fs.writeFile(ffprobe, `#!/bin/sh\ncat <<'JSON'\n{"format":{"duration":"120.5","format_name":"matroska,webm"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264","avg_frame_rate":"24000/1001","disposition":{"default":1},"tags":{}},{"index":1,"codec_type":"audio","codec_name":"dts","channels":6,"channel_layout":"5.1","disposition":{"default":1},"tags":{"language":"eng"}}]}\nJSON\n`);
  await fs.writeFile(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsLog}'\nlast=''\nfor arg in "$@"; do last="$arg"; done\nprintf 'preview' > "$last"\n`);
  await fs.chmod(ffprobe, 0o755); await fs.chmod(ffmpeg, 0o755);
  try {
    const workspace = await service.createWorkspace({ name: 'MKV audio', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items.find((entry) => entry.fileName === 'Movie.mkv');
    const cfg = {
      paths: { ffprobePath: ffprobe, ffmpegPath: ffmpeg },
      playback: { liveCompatibilityStreaming: true, hardwareAcceleration: 'off', vaapiDevice: '/dev/dri/renderD128' },
      bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] }
    };
    const status = await service.getItemStatus(cfg, item.id);
    assert.equal(status.mediaProbe.playback.mode, 'audio-transcode');
    assert.equal(status.mediaProbe.playback.liveCompatibilityStreaming, true);
    assert.equal(status.mediaProbe.audioStreams[0].codec, 'dts');
    assert.ok(Math.abs(status.mediaProbe.frameRate - 23.976) < 0.01);
    const preview = await service.createCompatiblePreview(cfg, { itemId: item.id, audioStreamIndex: 1 });
    assert.ok(preview.token);
    const args = await fs.readFile(argsLog, 'utf8');
    assert.match(args, /0:1/);
    assert.match(args, /-c:v\ncopy/);
    assert.match(args, /-c:a\naac/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace extrai legenda textual embutida como SRT sem modificar o video', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-extract-'));
  const media = path.join(root, 'Movie.mkv');
  const ffprobe = path.join(root, 'fake-ffprobe.sh');
  const ffmpeg = path.join(root, 'fake-ffmpeg.sh');
  await fs.writeFile(media, 'ORIGINAL-BYTES');
  await fs.writeFile(ffprobe, `#!/bin/sh\ncat <<'JSON'\n{"format":{"duration":"30","format_name":"matroska,webm"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264","avg_frame_rate":"25/1","disposition":{"default":1},"tags":{}},{"index":1,"codec_type":"audio","codec_name":"aac","channels":2,"disposition":{"default":1},"tags":{"language":"eng"}},{"index":2,"codec_type":"subtitle","codec_name":"subrip","codec_long_name":"SubRip subtitle","disposition":{"default":0,"forced":0,"hearing_impaired":0},"tags":{"language":"eng","title":"English"}}]}\nJSON\n`);
  await fs.writeFile(ffmpeg, `#!/bin/sh\nlast=''\nfor arg in "$@"; do last="$arg"; done\nprintf '1\\n00:00:01,000 --> 00:00:02,000\\nHello\\n' > "$last"\n`);
  await fs.chmod(ffprobe, 0o755); await fs.chmod(ffmpeg, 0o755);
  try {
    const workspace = await service.createWorkspace({ name: 'Embedded', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items.find((entry) => entry.fileName === 'Movie.mkv');
    const cfg = { paths: { ffprobePath: ffprobe, ffmpegPath: ffmpeg }, bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] } };
    const status = await service.getItemStatus(cfg, item.id);
    assert.ok(status.tracks.some((track) => track.trackId === 'embedded:2'));
    const before = await fs.readFile(media, 'utf8');
    const result = await service.extractEmbeddedTrack(cfg, { itemId: item.id, trackId: 'embedded:2', language: 'en', convertToSrt: true });
    assert.equal(result.fileName, 'Movie.en.srt');
    assert.equal(await fs.readFile(media, 'utf8'), before);
    assert.match(await fs.readFile(path.join(root, 'Movie.en.srt'), 'utf8'), /Hello/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace classifica H264 10-bit como transcode completo em vez de copiar video incompatível', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-high10-'));
  const media = path.join(root, 'Movie.mkv');
  const ffprobe = path.join(root, 'fake-ffprobe.sh');
  await fs.writeFile(media, 'video');
  await fs.writeFile(ffprobe, `#!/bin/sh\ncat <<'JSON'\n{"format":{"duration":"20","format_name":"matroska,webm"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264","profile":"High 10","pix_fmt":"yuv420p10le","avg_frame_rate":"24000/1001","disposition":{"default":1},"tags":{}},{"index":1,"codec_type":"audio","codec_name":"aac","channels":2,"disposition":{"default":1},"tags":{"language":"eng"}}]}\nJSON\n`);
  await fs.chmod(ffprobe, 0o755);
  try {
    const workspace = await service.createWorkspace({ name: 'High10', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    const cfg = { paths: { ffprobePath: ffprobe, ffmpegPath: '/bin/false', tesseractPath: '/bin/false' }, bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] } };
    const status = await service.getItemStatus(cfg, item.id);
    assert.equal(status.mediaProbe.videoStreams[0].pixFmt, 'yuv420p10le');
    assert.equal(status.mediaProbe.playback.mode, 'full-transcode');
    assert.equal(status.mediaProbe.playback.copyVideoPossible, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace gera waveform/espectrograma usando audio padrao ou faixa escolhida sem confundir stream 0', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-visual-'));
  const media = path.join(root, 'Movie.mkv');
  const ffmpeg = path.join(root, 'fake-ffmpeg.sh');
  const argsLog = path.join(root, 'args.log');
  await fs.writeFile(media, 'video');
  await fs.writeFile(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsLog}'\nlast=''\nfor arg in "$@"; do last="$arg"; done\nprintf 'png' > "$last"\n`);
  await fs.chmod(ffmpeg, 0o755);
  try {
    const workspace = await service.createWorkspace({ name: 'Visual', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    const cfg = { paths: { ffprobePath: '/bin/false', ffmpegPath: ffmpeg, tesseractPath: '/bin/false' }, bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] } };
    const first = await service.createVisualization(cfg, { itemId: item.id, kind: 'waveform' });
    assert.ok(first.token);
    let args = await fs.readFile(argsLog, 'utf8');
    assert.match(args, /\[0:a:0\]/);
    assert.doesNotMatch(args, /\[0:0\]/);
    const second = await service.createVisualization(cfg, { itemId: item.id, kind: 'spectrogram', audioStreamIndex: 3 });
    assert.ok(second.token);
    args = await fs.readFile(argsLog, 'utf8');
    assert.match(args, /\[0:3\]/);
    assert.match(args, /showspectrumpic/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace traduz SRT com a mesma engine Gemini preservando origem, flags e nomes de saida', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-translate-'));
  const media = path.join(root, 'Movie.mkv');
  const source = path.join(root, 'Movie.en.forced.srt');
  const original = '1\n00:00:01,000 --> 00:00:03,000\nHello world\n';
  await fs.writeFile(media, 'video');
  await fs.writeFile(source, original);
  await translationConfig.save({ apiKey: 'workspace-secret', model: 'gemini-3.6-flash', batchSize: 100, concurrency: 1, maxAttempts: 1, defaultTargetLanguage: 'pt-BR', defaultOutputMode: 'both' });
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: true, status: 200, headers: new Headers(),
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ id: '1', text: 'Olá mundo' }] }) }] } }] })
  });
  try {
    const workspace = await service.createWorkspace({ name: 'Translate', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    const started = await service.startTranslationJob(config(), { itemId: item.id, trackId: 'Movie.en.forced.srt', sourceLanguage: 'en', targetLanguage: 'pt-BR', outputMode: 'both' });
    const job = await waitForAdvancedJob(started.id);
    assert.equal(job.status, 'completed', job.error || 'translation failed');
    assert.equal(await fs.readFile(source, 'utf8'), original);
    assert.match(await fs.readFile(path.join(root, 'Movie.pt-BR.forced.srt'), 'utf8'), /Olá mundo/);
    assert.match(await fs.readFile(path.join(root, 'Movie.forced.srt'), 'utf8'), /Hello world\nOlá mundo/);
    assert.equal(await fs.stat(path.join(root, 'Movie.und.forced.srt')).then(() => true).catch(() => false), false);
    assert.deepEqual(job.result.outputs.map((entry) => entry.kind).sort(), ['bilingual', 'translated']);
  } finally {
    global.fetch = previousFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('workspace executa OCR de sidecar PGS/SUP e cria SRT editavel', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-ocr-'));
  const media = path.join(root, 'Movie.mkv');
  const sup = path.join(root, 'Movie.en.sup');
  const tesseract = path.join(root, 'fake-tesseract.sh');
  await fs.writeFile(media, 'video');
  await fs.writeFile(sup, syntheticPgsBuffer());
  await fs.writeFile(tesseract, `#!/bin/sh\nif [ "$1" = "--list-langs" ]; then\n  echo 'List of available languages (1):'\n  echo eng\n  exit 0\nfi\necho 'Hello from OCR'\n`);
  await fs.chmod(tesseract, 0o755);
  try {
    const workspace = await service.createWorkspace({ name: 'OCR', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    const cfg = { paths: { ffprobePath: '/bin/false', ffmpegPath: '/bin/false', tesseractPath: tesseract }, bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] } };
    const started = await service.startOcrJob(cfg, { itemId: item.id, trackId: 'Movie.en.sup', language: 'en' });
    const job = await waitForAdvancedJob(started.id);
    assert.equal(job.status, 'completed', job.error || 'ocr failed');
    assert.equal(job.result.ocrLanguage, 'eng');
    assert.equal(job.result.cues, 1);
    assert.match(await fs.readFile(path.join(root, 'Movie.en.srt'), 'utf8'), /Hello from OCR/);
    assert.deepEqual(await fs.readFile(sup), syntheticPgsBuffer());
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace remuxa legenda externa para nova copia MKV, valida streams e preserva original', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-remux-'));
  const media = path.join(root, 'Movie.mp4');
  const subtitle = path.join(root, 'Movie.pt-BR.forced.srt');
  const ffprobe = path.join(root, 'fake-ffprobe.sh');
  const ffmpeg = path.join(root, 'fake-ffmpeg.sh');
  const argsLog = path.join(root, 'ffmpeg-args.txt');
  await fs.writeFile(media, 'ORIGINAL-MEDIA-BYTES');
  await fs.writeFile(subtitle, '1\n00:00:01,000 --> 00:00:02,000\nOi\n');
  await fs.writeFile(ffprobe, `#!/bin/sh\nlast=''\nfor arg in "$@"; do last="$arg"; done\ncase "$last" in\n  *.remux*.mkv) cat <<'JSON'\n{"format":{"duration":"30","size":"1200","format_name":"matroska,webm"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264"},{"index":1,"codec_type":"audio","codec_name":"aac"},{"index":2,"codec_type":"subtitle","codec_name":"subrip"}]}\nJSON\n  ;;\n  *) cat <<'JSON'\n{"format":{"duration":"30","size":"1000","format_name":"mov,mp4,m4a,3gp,3g2,mj2"},"streams":[{"index":0,"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p","profile":"High","avg_frame_rate":"25/1","disposition":{"default":1},"tags":{}},{"index":1,"codec_type":"audio","codec_name":"aac","channels":2,"disposition":{"default":1},"tags":{"language":"por"}}]}\nJSON\n  ;;\nesac\n`);
  await fs.writeFile(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsLog}'\nlast=''\nfor arg in "$@"; do last="$arg"; done\nprintf 'REMUXED' > "$last"\n`);
  await fs.chmod(ffprobe, 0o755); await fs.chmod(ffmpeg, 0o755);
  try {
    const workspace = await service.createWorkspace({ name: 'Remux', rootPath: root });
    await service.startScan(workspace.id); await waitForScan(workspace.id);
    const item = (await service.listItems(workspace.id, {})).items[0];
    const cfg = { paths: { ffprobePath: ffprobe, ffmpegPath: ffmpeg, tesseractPath: '/bin/false' }, bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] } };
    const started = await service.startRemuxJob(cfg, { itemId: item.id, action: 'add-subtitle', trackId: 'Movie.pt-BR.forced.srt' });
    const job = await waitForAdvancedJob(started.id);
    assert.equal(job.status, 'completed', job.error || 'remux failed');
    assert.equal(job.result.validation.streamCount, 3);
    assert.equal(await fs.readFile(media, 'utf8'), 'ORIGINAL-MEDIA-BYTES');
    assert.equal(await fs.readFile(path.join(root, job.result.fileName), 'utf8'), 'REMUXED');
    const args = await fs.readFile(argsLog, 'utf8');
    assert.match(args, /-map\n0\n-map\n1:0/);
    assert.match(args, /language=pt-BR/);
    assert.match(args, /forced/);
    assert.match(args, /-c\ncopy/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
