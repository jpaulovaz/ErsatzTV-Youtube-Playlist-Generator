const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { runCommand } = require('../processUtils');
const { buildYtDlpCommonArgs } = require('../ytDlpUtils');
const { collectStagedSubtitles } = require('../subtitleService');
const { parseSrt } = require('../subtitleManager/subtitleFormats');

function videoUrl(context) {
  return String(context.url || (context.videoId ? `https://www.youtube.com/watch?v=${context.videoId}` : '')).trim();
}

function normalizeLanguage(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'und';
}

function candidateId(type, language) {
  return `${type}:${normalizeLanguage(language)}`;
}

function parseCandidateId(value) {
  const match = /^(manual|auto):(.+)$/.exec(String(value || ''));
  if (!match) return null;
  return { type: match[1], language: normalizeLanguage(match[2]) };
}

function formatLabel(language, entries, type) {
  const name = Array.isArray(entries) ? entries.map((entry) => entry && entry.name).find(Boolean) : '';
  const typeLabel = type === 'manual' ? 'enviada pelo canal' : 'automatica';
  return `${language}${name ? ` · ${name}` : ''} · ${typeLabel}`;
}

function matchesTargetLanguage(language, targetLanguage) {
  const source = normalizeLanguage(language).toLowerCase();
  const target = String(targetLanguage || '').toLowerCase();
  if (!target) return true;
  if (target === 'pt-br') return source === 'pt-br' || source === 'pt';
  if (target === 'en') return source === 'en' || source.startsWith('en-');
  if (target === 'es') return source === 'es' || source.startsWith('es-');
  return false;
}

async function search(context, query = {}, options = {}) {
  const url = videoUrl(context);
  if (!url) {
    const error = new Error('Video ID/URL nao disponivel para consultar o YouTube.');
    error.statusCode = 400;
    throw error;
  }
  const args = [...buildYtDlpCommonArgs(context.config, context.sourceConfig), '--skip-download', '--no-playlist', '--dump-single-json', url];
  const result = await runCommand(context.config.paths.ytDlpPath, args, { timeoutMs: 90000 });
  if (result.code !== 0) {
    const error = new Error(String(result.stderr || '').trim().slice(-3000) || `yt-dlp terminou com codigo ${result.code}`);
    error.statusCode = 502;
    throw error;
  }
  let info;
  try { info = JSON.parse(String(result.stdout || '').trim()); }
  catch {
    const error = new Error('yt-dlp nao retornou metadados de legendas validos.');
    error.statusCode = 502;
    throw error;
  }
  const candidates = [];
  for (const [language, entries] of Object.entries(info.subtitles || {})) {
    candidates.push({
      provider: 'youtube', candidateId: candidateId('manual', language), providerId: candidateId('manual', language),
      language: normalizeLanguage(language), label: formatLabel(language, entries, 'manual'), sourceType: 'manual',
      canPreview: true, canApply: true, warnings: [], formats: (entries || []).map((entry) => entry.ext).filter(Boolean)
    });
  }
  for (const [language, entries] of Object.entries(info.automatic_captions || {})) {
    candidates.push({
      provider: 'youtube', candidateId: candidateId('auto', language), providerId: candidateId('auto', language),
      language: normalizeLanguage(language), label: formatLabel(language, entries, 'auto'), sourceType: 'automatic',
      canPreview: true, canApply: true, warnings: ['Legenda gerada automaticamente pelo YouTube.'], formats: (entries || []).map((entry) => entry.ext).filter(Boolean)
    });
  }
  const targetLanguage = String(options.targetLanguage || '').trim();
  const filtered = targetLanguage ? candidates.filter((candidate) => matchesTargetLanguage(candidate.language, targetLanguage)) : candidates;
  filtered.sort((a, b) => a.language.localeCompare(b.language) || a.sourceType.localeCompare(b.sourceType));
  return { candidates: filtered, requestedLanguage: targetLanguage || null };
}

async function materialize(context, candidate, options = {}) {
  const parsed = parseCandidateId(candidate.candidateId || candidate.providerId);
  if (!parsed) {
    const error = new Error('Candidato de legenda do YouTube invalido.');
    error.statusCode = 400;
    throw error;
  }
  const url = videoUrl(context);
  if (!url) { const error = new Error('Video ID/URL nao disponivel para baixar a legenda.'); error.statusCode = 400; throw error; }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-subtitle-youtube-'));
  try {
    const args = [...buildYtDlpCommonArgs(context.config, context.sourceConfig), '--skip-download', '--no-playlist'];
    if (parsed.type === 'manual') args.push('--write-subs', '--no-write-auto-subs');
    else args.push('--no-write-subs', '--write-auto-subs');
    args.push('--sub-langs', parsed.language, '--sub-format', 'srt/best', '--convert-subs', 'srt', '--newline', '-o', path.join(workDir, 'subtitle.%(ext)s'), url);
    const result = await runCommand(context.config.paths.ytDlpPath, args, { cwd: workDir, timeoutMs: 120000 });
    if (result.code !== 0) {
      const error = new Error(String(result.stderr || '').trim().slice(-3000) || `yt-dlp terminou com codigo ${result.code}`);
      error.statusCode = 502;
      throw error;
    }
    const staged = await collectStagedSubtitles(workDir);
    let file = staged.find((entry) => normalizeLanguage(entry.language) === parsed.language) || staged[0];
    if (!file) {
      const error = new Error('O YouTube nao materializou a faixa de legenda selecionada.');
      error.statusCode = 404;
      throw error;
    }
    const text = await fs.readFile(file.filePath, 'utf8');
    const cues = parseSrt(text);
    if (!cues.length) {
      const error = new Error('A faixa do YouTube nao gerou um SRT valido.');
      error.statusCode = 422;
      throw error;
    }
    return {
      provider: 'youtube', providerId: candidateId(parsed.type, parsed.language),
      sourceType: parsed.type === 'manual' ? 'manual' : 'automatic',
      sourceLabel: parsed.type === 'manual' ? 'YouTube · enviada pelo canal' : 'YouTube · automatica',
      language: normalizeLanguage(options.language || parsed.language), cues,
      metadata: { requestedLanguage: parsed.language }
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { search, materialize, parseCandidateId, candidateId, matchesTargetLanguage };
