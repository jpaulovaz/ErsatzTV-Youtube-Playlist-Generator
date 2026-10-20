const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const service = require('../src/mediaPreviewService');

test('live compatibility stream keeps H264 video untouched at the beginning and converts only audio', () => {
  const built = service.buildLiveStreamArgs({
    mediaPath: '/media/Movie.mkv',
    audioStreamIndex: 2,
    startSeconds: 0,
    copyVideo: true,
    hardware: { selected: 'software' },
    config: { playback: { vaapiDevice: '/dev/dri/renderD128' } }
  });
  const joined = built.args.join(' ');
  assert.equal(built.mode, 'audio-transcode-live');
  assert.match(joined, /-map 0:v:0 -map 0:2\?/);
  assert.match(joined, /-c:v copy/);
  assert.match(joined, /-c:a aac/);
  assert.match(joined, /frag_keyframe\+default_base_moof/);
  assert.doesNotMatch(joined, /libx264|h264_nvenc/);
});

test('seeking a live compatibility stream uses precise video transcode and can use hardware encoding', () => {
  const built = service.buildLiveStreamArgs({
    mediaPath: '/media/Movie.mkv',
    audioStreamIndex: 1,
    startSeconds: 3600,
    copyVideo: true,
    hardware: { selected: 'nvenc', encoder: 'h264_nvenc' },
    config: { playback: { vaapiDevice: '/dev/dri/renderD128' } }
  });
  const joined = built.args.join(' ');
  assert.equal(built.preciseSeek, true);
  assert.equal(built.mode, 'hardware-transcode-live');
  assert.match(joined, /-ss 3595\.000 -i \/media\/Movie\.mkv -ss 5\.000/);
  assert.match(joined, /-c:v h264_nvenc/);
  assert.doesNotMatch(joined, /-c:v copy/);
});

test('hardware acceleration off always reports the CPU fallback without probing ffmpeg', async () => {
  const result = await service.detectHardwareAcceleration({
    paths: { ffmpegPath: '/path/that/does/not/exist' },
    playback: { hardwareAcceleration: 'off', vaapiDevice: '/dev/dri/renderD128' }
  }, { refresh: true });
  assert.equal(result.selected, 'software');
  assert.equal(result.encoder, 'libx264');
  assert.equal(result.available, false);
  assert.match(result.reason, /desativada/i);
});

test('automatic hardware detection validates an advertised encoder before selecting it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-hw-detect-'));
  const ffmpeg = path.join(root, 'ffmpeg');
  await fs.writeFile(ffmpeg, `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "-encoders" ]; then\n    echo ' V..... h264_nvenc NVIDIA NVENC H.264 encoder'\n    exit 0\n  fi\ndone\nexit 0\n`);
  await fs.chmod(ffmpeg, 0o755);
  try {
    const result = await service.detectHardwareAcceleration({
      paths: { ffmpegPath: ffmpeg },
      playback: { hardwareAcceleration: 'auto', vaapiDevice: '/dev/dri/renderD128' }
    }, { refresh: true });
    assert.equal(result.selected, 'nvenc');
    assert.equal(result.available, true);
    assert.equal(result.encoder, 'h264_nvenc');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
