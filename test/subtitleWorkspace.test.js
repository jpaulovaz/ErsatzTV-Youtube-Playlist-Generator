const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const service = require('../src/tools/subtitleWorkspaceService');

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
  return { paths: { ffprobePath: '/bin/false', ffmpegPath: '/bin/false' }, bazarr: { enabled: false, url: '', apiKey: '', pathMappings: [] } };
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

test('workspace rejeita raiz ampla e raiz que é symlink', async () => {
  await assert.rejects(() => service.createWorkspace({ name: 'root', rootPath: '/' }), /ampla demais/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-workspace-root-'));
  const link = `${root}-link`;
  await fs.symlink(root, link);
  try {
    await assert.rejects(() => service.createWorkspace({ name: 'link', rootPath: link }), /link simbolico/);
  } finally { await fs.rm(link, { force: true }); await fs.rm(root, { recursive: true, force: true }); }
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
