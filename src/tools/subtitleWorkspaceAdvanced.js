const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { runCommand } = require('../processUtils');
const { isPathInside, pathExists } = require('../utils');
const mediaPreview = require('../mediaPreviewService');
const subtitleCore = require('../subtitleManager/subtitleCore');
const subtitleManagerState = require('../subtitleManager/subtitleManagerState');
const { parseTextSubtitle, writeSrt } = require('../subtitleManager/subtitleFormats');
const pgsOcr = require('../subtitleManager/pgsOcr');
const translationService = require('../subtitleTranslation/translationService');
const translationConfig = require('../subtitleTranslation/translationConfig');

const jobs = new Map();
const JOB_TTL_MS = 6 * 60 * 60 * 1000;

function nowIso() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function purgeJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.finishedAtMs && now - job.finishedAtMs > JOB_TTL_MS) jobs.delete(id);
  }
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    itemId: job.itemId,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: clone(job.progress || {}),
    result: job.result ? clone(job.result) : null,
    error: job.error || null,
    code: job.code || null
  };
}

function startJob(kind, itemId, runner) {
  purgeJobs();
  const id = crypto.randomUUID();
  const job = {
    id, kind, itemId,
    status: 'queued', createdAt: nowIso(), startedAt: null, finishedAt: null, finishedAtMs: null,
    progress: { percent: 0, message: 'Preparando...' }, result: null, error: null, code: null
  };
  jobs.set(id, job);
  setImmediate(async () => {
    job.status = 'running';
    job.startedAt = nowIso();
    const setProgress = (progress = {}) => {
      job.progress = { ...job.progress, ...progress };
      if (job.progress.percent != null) job.progress.percent = Math.max(0, Math.min(100, Math.round(Number(job.progress.percent) || 0)));
    };
    try {
      job.result = await runner(setProgress);
      job.status = 'completed';
      setProgress({ percent: 100, message: 'Concluido.' });
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message || error).slice(0, 3000);
      job.code = error?.code || null;
    }
    job.finishedAt = nowIso();
    job.finishedAtMs = Date.now();
  });
  return publicJob(job);
}

function getJob(jobId) {
  purgeJobs();
  return publicJob(jobs.get(String(jobId || '').trim()));
}

function normalizeLanguage(value, fallback = '') {
  const raw = String(value || fallback || '').trim().replace(/_/g, '-');
  if (!raw || raw.toLowerCase() === 'und') {
    const error = new Error('Informe o idioma desta legenda antes de continuar.');
    error.statusCode = 400;
    error.code = 'SUBTITLE_LANGUAGE_REQUIRED';
    throw error;
  }
  if (!/^[A-Za-z0-9-]{2,24}$/.test(raw)) {
    const error = new Error('Codigo de idioma invalido. Use algo como pt-BR, en ou es.');
    error.statusCode = 400;
    throw error;
  }
  return raw;
}

function safeFlags(flags = []) {
  return [...new Set((Array.isArray(flags) ? flags : []).map((flag) => String(flag || '').toLowerCase()).filter((flag) => ['forced', 'sdh', 'hi', 'cc'].includes(flag)))];
}

function sidecarPathFor(mediaPath, language, flags, extension) {
  const media = path.parse(mediaPath);
  const suffix = [language, ...safeFlags(flags)].filter(Boolean).join('.');
  return path.join(media.dir, `${media.name}${suffix ? `.${suffix}` : ''}.${String(extension || 'srt').replace(/^\./, '')}`);
}

async function assertOutputPath(context, outputPath) {
  const mediaDir = path.dirname(context.mediaPath);
  const resolved = path.resolve(outputPath);
  if (!isPathInside(mediaDir, resolved) || !isPathInside(context.workspace.rootPath, resolved)) {
    const error = new Error('O arquivo de saida ficaria fora da pasta autorizada.');
    error.statusCode = 403;
    throw error;
  }
  return resolved;
}

async function resolveDescriptor(context, trackId) {
  const id = String(trackId || '').trim();
  const tracks = await context.listTrackDescriptors();
  const track = tracks.find((entry) => String(entry.trackId || entry.fileName || '') === id);
  if (!track) {
    const error = new Error('Faixa de legenda nao encontrada. Atualize a varredura e tente novamente.');
    error.statusCode = 404;
    throw error;
  }
  return track;
}

function codecExtension(format) {
  const key = String(format || '').toLowerCase();
  if (['subrip', 'srt'].includes(key)) return 'srt';
  if (key === 'ass') return 'ass';
  if (key === 'ssa') return 'ssa';
  if (['webvtt', 'vtt'].includes(key)) return 'vtt';
  if (key === 'hdmv_pgs_subtitle' || key === 'pgs' || key === 'sup') return 'sup';
  return '';
}

function isTextSubtitleFormat(format) {
  return ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'mov_text', 'text'].includes(String(format || '').toLowerCase());
}

async function maybeBackupSrt(context, outputPath, replace, reason) {
  if (!await pathExists(outputPath)) return;
  if (!replace) {
    const error = new Error('Ja existe uma legenda com esse idioma. Confirme a substituicao para continuar.');
    error.statusCode = 409;
    error.code = 'SUBTITLE_TARGET_EXISTS';
    throw error;
  }
  if (path.extname(outputPath).toLowerCase() === '.srt') {
    await subtitleCore.backupTrack(context, path.basename(outputPath), reason).catch(() => {});
  }
}

async function extractEmbeddedTrack(context, payload = {}) {
  const track = await resolveDescriptor(context, payload.trackId);
  if (!track.embedded) {
    const error = new Error('A extracao e destinada a faixas embutidas no arquivo de video.');
    error.statusCode = 409;
    throw error;
  }
  const streamIndex = Number(track.metadata?.streamIndex);
  if (!Number.isInteger(streamIndex) || streamIndex < 0) throw new Error('Indice da faixa embutida invalido.');
  const language = normalizeLanguage(payload.language, track.language);
  const format = String(track.format || '').toLowerCase();
  const convertToSrt = payload.convertToSrt === true;
  if (convertToSrt && !isTextSubtitleFormat(format)) {
    const error = new Error('Esta faixa e baseada em imagem. Use OCR para gerar um SRT editavel.');
    error.statusCode = 409;
    error.code = 'SUBTITLE_OCR_REQUIRED';
    throw error;
  }
  const extension = convertToSrt ? 'srt' : codecExtension(format);
  if (!extension) {
    const error = new Error(`Extracao ainda nao suportada para o codec ${format || 'desconhecido'}.`);
    error.statusCode = 409;
    throw error;
  }
  const outputPath = await assertOutputPath(context, sidecarPathFor(context.mediaPath, language, track.flags, extension));
  await maybeBackupSrt(context, outputPath, payload.replace === true, 'embedded-extraction');
  const parsedOutput = path.parse(outputPath);
  const tempPath = path.join(parsedOutput.dir, `.${parsedOutput.name}.tmp-${process.pid}-${crypto.randomUUID()}${parsedOutput.ext}`);
  const args = ['-y', '-i', context.mediaPath, '-map', `0:${streamIndex}`, '-vn', '-an'];
  if (convertToSrt) args.push('-c:s', 'srt');
  else args.push('-c:s', 'copy');
  if (extension === 'sup') args.push('-f', 'sup');
  args.push(tempPath);
  const result = await runCommand(context.config.paths.ffmpegPath, args, { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    const error = new Error(String(result.stderr || '').trim().slice(-2400) || 'FFmpeg falhou ao extrair a legenda.');
    error.statusCode = 502;
    throw error;
  }
  await fs.rename(tempPath, outputPath);
  if (extension === 'srt') {
    await subtitleCore.registerTrackMetadata(context, path.basename(outputPath), {
      provider: 'local', sourceType: 'embedded-extraction', sourceLabel: 'Extraida do arquivo de video',
      metadata: { sourceStreamIndex: streamIndex, sourceCodec: format, extractedAt: nowIso() }
    });
  }
  if (typeof context.afterMutation === 'function') await context.afterMutation({ action: 'extract', trackId: path.basename(outputPath) });
  return { fileName: path.basename(outputPath), language, format: extension, convertedToSrt: convertToSrt, streamIndex };
}

async function convertTrackToSrt(context, payload = {}) {
  const track = await resolveDescriptor(context, payload.trackId);
  if (track.embedded) return extractEmbeddedTrack(context, { ...payload, convertToSrt: true });
  if (!track.filePath || !isTextSubtitleFormat(track.format)) {
    const error = new Error('Somente legendas textuais ASS/SSA/VTT podem gerar uma copia SRT diretamente.');
    error.statusCode = 409;
    throw error;
  }
  const language = normalizeLanguage(payload.language, track.language);
  const outputPath = await assertOutputPath(context, sidecarPathFor(context.mediaPath, language, track.flags, 'srt'));
  if (path.resolve(track.filePath) === path.resolve(outputPath)) {
    const error = new Error('Esta faixa ja e um SRT editavel.');
    error.statusCode = 409;
    throw error;
  }
  await maybeBackupSrt(context, outputPath, payload.replace === true, 'text-conversion');
  const source = await fs.readFile(track.filePath, 'utf8');
  const normalizedFormat = String(track.format || '').toLowerCase() === 'webvtt' ? 'vtt' : track.format;
  const cues = parseTextSubtitle(source, normalizedFormat);
  if (!cues.length) {
    const error = new Error('Nao foi possivel converter esta legenda em cues SRT validos.');
    error.statusCode = 422;
    throw error;
  }
  await subtitleCore.atomicWriteText(outputPath, writeSrt(cues));
  await subtitleCore.registerTrackMetadata(context, path.basename(outputPath), {
    provider: 'local', sourceType: 'format-conversion', sourceLabel: `${String(track.format || '').toUpperCase()} → SRT`,
    metadata: { sourceFileName: track.fileName || path.basename(track.filePath), sourceFormat: track.format, convertedAt: nowIso() }
  });
  if (typeof context.afterMutation === 'function') await context.afterMutation({ action: 'convert', trackId: path.basename(outputPath) });
  return { fileName: path.basename(outputPath), language, cues: cues.length, sourceFormat: track.format, format: 'srt' };
}

async function extractPgsBuffer(context, track) {
  if (!track.embedded) return fs.readFile(track.filePath);
  const streamIndex = Number(track.metadata?.streamIndex);
  const dir = path.join(subtitleManagerState.PREVIEW_DIR, `pgs-source-${crypto.randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'source.sup');
  const result = await runCommand(context.config.paths.ffmpegPath, ['-y', '-i', context.mediaPath, '-map', `0:${streamIndex}`, '-vn', '-an', '-c:s', 'copy', '-f', 'sup', filePath], { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    const error = new Error(String(result.stderr || '').trim().slice(-2400) || 'FFmpeg falhou ao extrair a faixa PGS para OCR.');
    error.statusCode = 502;
    throw error;
  }
  const buffer = await fs.readFile(filePath);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  return buffer;
}

function startOcrJob(context, payload = {}) {
  return startJob('ocr-pgs', context.itemId, async (setProgress) => {
    const track = await resolveDescriptor(context, payload.trackId);
    const format = String(track.format || '').toLowerCase();
    if (!['hdmv_pgs_subtitle', 'pgs', 'sup'].includes(format)) {
      const error = new Error('OCR esta disponivel para legendas PGS/SUP.');
      error.statusCode = 409;
      throw error;
    }
    const language = normalizeLanguage(payload.language, track.language);
    const outputPath = await assertOutputPath(context, sidecarPathFor(context.mediaPath, language, track.flags, 'srt'));
    await maybeBackupSrt(context, outputPath, payload.replace === true, 'pgs-ocr');
    setProgress({ percent: 2, message: 'Extraindo imagens da legenda PGS...' });
    const buffer = await extractPgsBuffer(context, track);
    const tempDir = path.join(subtitleManagerState.PREVIEW_DIR, `ocr-${crypto.randomUUID()}`);
    try {
      const result = await pgsOcr.ocrPgsBuffer({
        buffer,
        tesseractPath: context.config.paths.tesseractPath || 'tesseract',
        language,
        tempDir,
        onProgress: async (progress) => setProgress({ percent: 5 + Math.round((progress.percent || 0) * 0.9), message: `OCR ${progress.current}/${progress.total}` })
      });
      await subtitleCore.atomicWriteText(outputPath, result.srt);
      await subtitleCore.registerTrackMetadata(context, path.basename(outputPath), {
        provider: 'tesseract', sourceType: 'ocr', sourceLabel: 'OCR PGS · Tesseract',
        metadata: { sourceTrackId: track.trackId, sourceFormat: track.format, ocrLanguage: result.ocrLanguage, recognizedAt: nowIso() }
      });
      if (typeof context.afterMutation === 'function') await context.afterMutation({ action: 'ocr', trackId: path.basename(outputPath) });
      return { fileName: path.basename(outputPath), language, cues: result.cues.length, frameCount: result.frameCount, ocrLanguage: result.ocrLanguage };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

function translationOutputPath(context, language, flags = []) {
  const normalized = String(language || '').trim();
  if (normalized.toLowerCase() === 'und') {
    const media = path.parse(context.mediaPath);
    const suffix = safeFlags(flags).join('.');
    return path.join(media.dir, `${media.name}${suffix ? `.${suffix}` : ''}.srt`);
  }
  return sidecarPathFor(context.mediaPath, normalized, flags, 'srt');
}

function startTranslationJob(context, payload = {}) {
  return startJob('translate', context.itemId, async (setProgress) => {
    const track = await resolveDescriptor(context, payload.trackId);
    if (track.embedded || String(track.format || '').toLowerCase() !== 'srt' || !track.filePath) {
      const error = new Error('Traduza uma faixa SRT externa. Se ela estiver embutida, extraia primeiro.');
      error.statusCode = 409;
      throw error;
    }
    const sourceLanguage = normalizeLanguage(payload.sourceLanguage, track.language);
    const targetLanguage = String(payload.targetLanguage || 'pt-BR');
    const outputMode = ['translated', 'bilingual', 'both'].includes(payload.outputMode) ? payload.outputMode : 'translated';
    const existingPolicy = payload.replace === true ? 'replace' : 'skip';
    const sourceContent = await fs.readFile(track.filePath, 'utf8');
    setProgress({ percent: 2, message: 'Preparando traducao...' });
    const translation = await translationService.translateSrtContent({
      jobId: `workspace-${crypto.randomUUID()}`,
      checkpointItemId: `${context.itemId}:${track.trackId}`,
      sourceContent,
      sourceLanguage,
      targetLanguage,
      outputMode,
      context: { title: context.item.fileName, artist: '', mediaProfile: 'external_workspace' },
      onProgress: async (progress) => setProgress({ percent: 5 + Math.round((progress.percent || 0) * 0.85), message: `Traduzindo ${progress.current}/${progress.total}` })
    });
    const outputs = [];
    const requested = translationService.requestedOutputs(outputMode, translation.targetLanguage);
    for (const output of requested) {
      const outputPath = await assertOutputPath(context, translationOutputPath(context, output.language, track.flags));
      const exists = await pathExists(outputPath);
      if (exists && existingPolicy === 'skip') {
        outputs.push({ kind: output.kind, language: output.language, skipped: true, reason: 'target-exists', fileName: path.basename(outputPath) });
        continue;
      }
      if (exists) await subtitleCore.backupTrack(context, path.basename(outputPath), 'gemini-translation').catch(() => {});
      const rendered = translation.rendered[output.kind];
      await subtitleCore.atomicWriteText(outputPath, rendered.content);
      const bilingual = output.kind === 'bilingual';
      await subtitleCore.registerTrackMetadata(context, path.basename(outputPath), {
        provider: 'gemini', providerId: translation.model, sourceType: 'translation',
        sourceLabel: bilingual ? 'Gemini · bilingue' : 'Gemini · traduzida',
        metadata: { sourceLanguage: translation.sourceLanguage, targetLanguage: translation.targetLanguage, outputMode: output.kind, model: translation.model, sourceHash: translation.sourceHash, translatedAt: nowIso(), ersatzTvLanguage: bilingual ? 'und' : translation.targetLanguage }
      });
      outputs.push({ kind: output.kind, language: output.language, skipped: false, fileName: path.basename(outputPath) });
    }
    if (typeof context.afterMutation === 'function') await context.afterMutation({ action: 'translate', trackId: track.trackId });
    setProgress({ percent: 95, message: 'Atualizando lista de legendas...' });
    return { model: translation.model, sourceLanguage: translation.sourceLanguage, targetLanguage: translation.targetLanguage, cues: translation.cues, outputs };
  });
}

async function uniqueRemuxPath(mediaPath) {
  const parsed = path.parse(mediaPath);
  let candidate = path.join(parsed.dir, `${parsed.name}.remux.mkv`);
  let index = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}.remux-${index}.mkv`);
    index += 1;
  }
  return candidate;
}

async function probeStreamSummary(config, filePath) {
  const result = await runCommand(config.paths.ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name', '-of', 'json', filePath
  ], { timeoutMs: 30000 });
  if (result.code !== 0) {
    const error = new Error(String(result.stderr || '').trim().slice(-1600) || 'FFprobe nao conseguiu validar o arquivo.');
    error.statusCode = 502;
    throw error;
  }
  let parsed = {};
  try { parsed = JSON.parse(result.stdout || '{}'); } catch {
    const error = new Error('FFprobe retornou uma resposta invalida durante a validacao do remux.');
    error.statusCode = 502;
    throw error;
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  return {
    streams,
    streamCount: streams.length,
    size: Number(parsed.format?.size) || 0,
    duration: Number(parsed.format?.duration) || 0
  };
}

function startRemuxJob(context, payload = {}) {
  return startJob('remux', context.itemId, async (setProgress) => {
    const action = String(payload.action || '').trim();
    const outputPath = await assertOutputPath(context, await uniqueRemuxPath(context.mediaPath));
    const tempPath = `${outputPath}.tmp-${process.pid}-${crypto.randomUUID()}.mkv`;
    const inputSummary = await probeStreamSummary(context.config, context.mediaPath);
    const args = ['-y', '-i', context.mediaPath];
    let expectedStreamCount = inputSummary.streamCount;
    if (action === 'add-subtitle') {
      const track = await resolveDescriptor(context, payload.trackId);
      if (track.embedded || !track.filePath) {
        const error = new Error('Selecione uma legenda externa para adicionar ao novo MKV.');
        error.statusCode = 409;
        throw error;
      }
      const subtitleOrdinal = inputSummary.streams.filter((stream) => stream.codec_type === 'subtitle').length;
      args.push('-i', track.filePath, '-map', '0', '-map', '1:0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy');
      if (track.language && track.language !== 'und') args.push(`-metadata:s:s:${subtitleOrdinal}`, `language=${track.language}`);
      if (track.fileName) args.push(`-metadata:s:s:${subtitleOrdinal}`, `title=${track.fileName}`);
      const dispositions = [];
      if ((track.flags || []).includes('forced')) dispositions.push('forced');
      if ((track.flags || []).some((flag) => ['sdh', 'hi'].includes(String(flag).toLowerCase()))) dispositions.push('hearing_impaired');
      args.push(`-disposition:s:${subtitleOrdinal}`, dispositions.length ? dispositions.join('+') : '0');
      expectedStreamCount += 1;
    } else if (action === 'remove-stream') {
      const track = await resolveDescriptor(context, payload.trackId);
      if (!track.embedded) {
        const error = new Error('Somente uma faixa de legenda embutida pode ser removida da copia MKV.');
        error.statusCode = 409;
        throw error;
      }
      const streamIndex = Number(track.metadata?.streamIndex);
      if (!Number.isInteger(streamIndex) || streamIndex < 0 || (payload.streamIndex != null && Number(payload.streamIndex) !== streamIndex)) {
        const error = new Error('A faixa embutida mudou desde que a tela foi aberta. Atualize o item e tente novamente.');
        error.statusCode = 409;
        error.code = 'SUBTITLE_STREAM_CHANGED';
        throw error;
      }
      args.push('-map', '0', '-map', `-0:${streamIndex}`, '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy');
      expectedStreamCount = Math.max(0, expectedStreamCount - 1);
    } else {
      const error = new Error('Escolha adicionar uma legenda externa ou remover uma faixa embutida.');
      error.statusCode = 400;
      throw error;
    }
    args.push(tempPath);
    setProgress({ percent: 8, message: 'Criando copia MKV sem recodificar video/audio...' });
    const result = await runCommand(context.config.paths.ffmpegPath, args, { timeoutMs: 60 * 60 * 1000 });
    if (result.code !== 0) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      const error = new Error(String(result.stderr || '').trim().slice(-3000) || 'FFmpeg falhou durante o remux.');
      error.statusCode = 502;
      throw error;
    }
    const handle = await fs.open(tempPath, 'r').catch(() => null);
    if (handle) {
      try { await handle.sync(); } finally { await handle.close().catch(() => {}); }
    }
    await fs.rename(tempPath, outputPath);
    setProgress({ percent: 96, message: 'Validando streams da nova copia...' });
    let outputSummary;
    try {
      outputSummary = await probeStreamSummary(context.config, outputPath);
      if (outputSummary.size <= 0 || outputSummary.streamCount !== expectedStreamCount) {
        throw new Error(`A validacao encontrou ${outputSummary.streamCount} streams, mas eram esperados ${expectedStreamCount}.`);
      }
    } catch (error) {
      await fs.rm(outputPath, { force: true }).catch(() => {});
      const wrapped = new Error(`A copia nao passou na validacao e foi removida. O original permaneceu intacto. ${error.message}`);
      wrapped.statusCode = error.statusCode || 502;
      throw wrapped;
    }
    return {
      fileName: path.basename(outputPath),
      relativePath: path.relative(context.workspace.rootPath, outputPath),
      originalUntouched: true,
      action,
      validation: { streamCount: outputSummary.streamCount, size: outputSummary.size, duration: outputSummary.duration }
    };
  });
}

async function createVisualization(context, payload = {}) {
  const audioStreamIndex = mediaPreview.normalizeOptionalStreamIndex(payload.audioStreamIndex);
  return mediaPreview.createAudioVisualization({
    config: context.config,
    itemId: context.itemId,
    mediaPath: context.mediaPath,
    audioStreamIndex,
    kind: payload.kind === 'spectrogram' ? 'spectrogram' : 'waveform'
  });
}

async function getAdvancedStatus(config) {
  let tesseract = { available: false, languages: [] };
  try {
    const languages = await pgsOcr.listTesseractLanguages(config.paths.tesseractPath || 'tesseract');
    tesseract = { available: languages.length > 0, languages };
  } catch {}
  const translation = translationConfig.publicStatus(await translationConfig.load());
  const hardwareAcceleration = await mediaPreview.detectHardwareAcceleration(config).catch((error) => ({
    requested: String(config?.playback?.hardwareAcceleration || 'auto'),
    available: false,
    selected: 'software',
    encoder: 'libx264',
    label: 'CPU (libx264)',
    fallback: true,
    reason: String(error?.message || error)
  }));
  return {
    tesseract,
    translation,
    playback: {
      liveCompatibilityStreaming: config?.playback?.liveCompatibilityStreaming !== false,
      hardwareAcceleration
    }
  };
}

module.exports = {
  publicJob,
  startJob,
  getJob,
  normalizeLanguage,
  resolveDescriptor,
  extractEmbeddedTrack,
  convertTrackToSrt,
  startOcrJob,
  startTranslationJob,
  startRemuxJob,
  createVisualization,
  getAdvancedStatus,
  isTextSubtitleFormat,
  codecExtension
};
