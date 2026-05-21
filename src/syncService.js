const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const logger = require('./logger');
const {
  sanitizeName,
  extractArtistAndTitle,
  secondsToDuration,
  yamlDoubleQuoted,
  shellCommandQuote,
  pathExists,
  walkFiles,
  removeEmptyDirectories
} = require('./utils');

const state = {
  running: false,
  currentStep: 'idle',
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null
};

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      shell: false
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer = null;

    const timeoutMs = Number(options.timeoutMs) || 0;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function parseYtDlpJsonLines(stdout) {
  const videos = [];
  const errors = [];

  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      videos.push(JSON.parse(trimmed));
    } catch (error) {
      errors.push({ line: trimmed.slice(0, 200), error: error.message });
    }
  }

  return { videos, errors };
}

async function apiRequest(url, method = 'POST', timeoutSeconds = 10) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const response = await fetch(url, {
      method,
      body: '',
      signal: controller.signal
    });

    return {
      ok: [200, 202, 204].includes(response.status),
      status: response.status,
      statusText: response.statusText
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error.name === 'AbortError' ? 'Timeout' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getPlaylistUrls(playlist) {
  const values = [];

  if (playlist && typeof playlist.url === 'string') {
    values.push(playlist.url);
  }

  if (playlist && Array.isArray(playlist.urls)) {
    values.push(...playlist.urls);
  }

  const seen = new Set();
  const urls = [];

  for (const value of values) {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function getPlaylistsWithFolders(config, options = {}) {
  const includeDisabled = Boolean(options.includeDisabled);

  return (config.playlists || [])
    .filter((playlist) => includeDisabled || playlist.enabled !== false)
    .map((playlist) => {
      const urls = getPlaylistUrls(playlist);
      return {
        ...playlist,
        url: urls[0] || '',
        urls,
        folderName: sanitizeName(playlist.name)
      };
    })
    .filter((playlist) => playlist.folderName && playlist.urls.length > 0);
}

function getEffectiveCookiesPath(config, playlist) {
  return String((playlist && playlist.cookiesPath) || config.paths.cookiesPath || '').trim();
}

function getPlaylistDir(config, playlist) {
  return path.join(config.paths.baseDir, playlist.folderName);
}

function getPlaylistScriptPath(config, playlist) {
  return path.join(getPlaylistDir(config, playlist), config.paths.streamScriptName || 'stream-yt.sh');
}

function findPlaylist(config, identifier) {
  const decoded = decodeURIComponent(String(identifier || ''));
  const targetFolder = sanitizeName(decoded);
  const playlists = getPlaylistsWithFolders(config, { includeDisabled: true });

  return playlists.find((playlist) => (
    playlist.name === decoded ||
    playlist.folderName === decoded ||
    playlist.folderName === targetFolder
  ));
}

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function getYtDlpJsRuntimeArg(config) {
  const stream = config.stream || {};
  const mode = String(stream.jsRuntimeMode || 'disabled').trim();

  if (!mode || mode === 'disabled') return '';

  const runtimeName = mode === 'custom'
    ? sanitizeJsRuntimeName(stream.jsRuntimeCustomName)
    : sanitizeJsRuntimeName(mode);

  if (!runtimeName) return '';

  const runtimePath = String(stream.jsRuntimePath || '').trim();
  return runtimePath ? `${runtimeName}:${runtimePath}` : runtimeName;
}

function getYtDlpEjsComponentsArg(config) {
  if (!getYtDlpJsRuntimeArg(config)) return '';

  const components = String((config.stream && config.stream.ejsComponents) || 'none').trim();
  return components && components !== 'none' ? components : '';
}

function buildYtDlpCommonArgs(config, playlist) {
  const args = [];
  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const jsRuntimeArg = getYtDlpJsRuntimeArg(config);
  const ejsComponentsArg = getYtDlpEjsComponentsArg(config);

  if (jsRuntimeArg) {
    args.push('--js-runtimes', jsRuntimeArg);
  }

  if (ejsComponentsArg) {
    args.push('--remote-components', ejsComponentsArg);
  }

  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  if (config.stream && config.stream.userAgent) {
    args.push('--add-header', `User-Agent: ${config.stream.userAgent}`);
  }

  return args;
}

function buildStreamScriptContent(config, playlist) {
  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const jsRuntimeArg = getYtDlpJsRuntimeArg(config);
  const ejsComponentsArg = getYtDlpEjsComponentsArg(config);
  const useFormatSort = Boolean(config.stream.useFormatSort && config.stream.formatSort);
  const useMergeOutputFormat = Boolean(config.stream.useMergeOutputFormat && config.stream.mergeOutputFormat);

  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'URL="${1:?URL obrigatoria}"',
    `YT_DLP=${shellCommandQuote(config.paths.ytDlpPath)}`,
    `USER_AGENT=${shellCommandQuote(config.stream.userAgent)}`,
    `FORMAT=${shellCommandQuote(config.stream.format)}`
  ];

  if (jsRuntimeArg) {
    lines.push(`JS_RUNTIMES=${shellCommandQuote(jsRuntimeArg)}`);
  }

  if (ejsComponentsArg) {
    lines.push(`EJS_COMPONENTS=${shellCommandQuote(ejsComponentsArg)}`);
  }

  if (useFormatSort) {
    lines.push(`FORMAT_SORT=${shellCommandQuote(config.stream.formatSort)}`);
  }

  if (useMergeOutputFormat) {
    lines.push(`MERGE_OUTPUT_FORMAT=${shellCommandQuote(config.stream.mergeOutputFormat)}`);
  }

  if (cookiesPath) {
    lines.push(`COOKIES=${shellCommandQuote(cookiesPath)}`);
  }

  lines.push('', 'exec "$YT_DLP" \\');

  if (jsRuntimeArg) {
    lines.push('  --js-runtimes "$JS_RUNTIMES" \\');
  }

  if (ejsComponentsArg) {
    lines.push('  --remote-components "$EJS_COMPONENTS" \\');
  }

  if (cookiesPath) {
    lines.push('  --cookies "$COOKIES" \\');
  }

  lines.push(
    '  --no-playlist \\',
    '  --no-progress \\',
    '  --quiet \\'
  );

  if (config.stream.useHlsMpegTs !== false) {
    lines.push('  --hls-use-mpegts \\');
  }

  lines.push('  --add-header "User-Agent: ${USER_AGENT}" \\');

  if (useFormatSort) {
    lines.push('  -S "$FORMAT_SORT" \\');
  }

  if (useMergeOutputFormat) {
    lines.push('  --merge-output-format "$MERGE_OUTPUT_FORMAT" \\');
  }

  lines.push(
    '  -f "$FORMAT" \\',
    '  -o - \\',
    '  "$URL"',
    ''
  );

  return lines.join('\n');
}

async function ensurePlaylistStreamScript(config, playlist) {
  const scriptPath = getPlaylistScriptPath(config, playlist);
  const content = buildStreamScriptContent(config, playlist);
  const hash = hashString(content);

  let existed = false;
  let changed = true;

  try {
    const previousContent = await fs.readFile(scriptPath, 'utf8');
    existed = true;
    changed = previousContent !== content;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (changed) {
    await fs.writeFile(scriptPath, content, 'utf8');
    await logger.info(`Script de stream ${existed ? 'atualizado' : 'criado'}: ${scriptPath}`);
  } else {
    await logger.info(`Script de stream sem alteracoes: ${scriptPath}`);
  }

  await fs.chmod(scriptPath, 0o755);

  return {
    scriptPath,
    hash,
    changed,
    existed
  };
}

function cleanMetadataText(value, fallback = '') {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

function limitMetadataText(value, maxLength = 1200) {
  const text = cleanMetadataText(value);
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function buildVideoTitle(rawTitle) {
  return cleanMetadataText(rawTitle, 'Sem Titulo');
}

function buildVideoPlot(title) {
  return cleanMetadataText(title, 'Sem Titulo');
}

function buildYmlContent(config, playlist, videoId, durationSeconds, streamScriptHash, metadata = {}) {
  const scriptPath = getPlaylistScriptPath(config, playlist);
  const command = `${shellCommandQuote(scriptPath)} https://www.youtube.com/watch?v=${videoId}`;
  const title = buildVideoTitle(metadata.rawTitle);
  const plot = buildVideoPlot(title);

  return [
    '# generated_by: ErsatzTV Youtube Playlist Generator',
    `# stream_script_hash: ${streamScriptHash || 'unknown'}`,
    `script: "${yamlDoubleQuoted(command)}"`,
    'is_live: false',
    `duration: "${secondsToDuration(durationSeconds)}"`,
    `title: "${yamlDoubleQuoted(title)}"`,
    `plot: "${yamlDoubleQuoted(plot)}"`,
    ''
  ].join('\n');
}

async function fetchPlaylistVideosFromUrl(config, playlist, sourceUrl, sourceIndex) {
  const label = `${playlist.folderName} fonte ${sourceIndex + 1}`;
  const cmdArgs = [
    ...buildYtDlpCommonArgs(config, playlist),
    '--dump-json',
    '--flat-playlist',
    sourceUrl
  ];

  const result = await runCommand(config.paths.ytDlpPath, cmdArgs);

  if (result.stderr && result.stderr.trim()) {
    await logger.warn(`yt-dlp stderr (${label}): ${result.stderr.trim().slice(0, 1200)}`);
  }

  if (result.code !== 0) {
    const error = new Error(`yt-dlp falhou para ${label} com codigo ${result.code}.`);
    error.code = 'YTDLP_FAILED';
    error.stderr = result.stderr;
    error.sourceUrl = sourceUrl;
    throw error;
  }

  const { videos, errors } = parseYtDlpJsonLines(result.stdout);
  for (const error of errors) {
    await logger.warn(`Linha JSON ignorada em ${label}: ${error.error}`);
  }

  if (videos.length === 0) {
    const error = new Error(`Nenhum video retornado para ${label}.`);
    error.code = 'NO_VIDEOS';
    error.sourceUrl = sourceUrl;
    throw error;
  }

  return videos.map((video) => ({
    ...video,
    sourceUrl,
    sourceIndex
  }));
}

async function fetchPlaylistVideos(config, playlist) {
  const urls = getPlaylistUrls(playlist);
  if (urls.length === 0) {
    const error = new Error(`Nenhuma URL de playlist configurada para ${playlist.folderName}.`);
    error.code = 'NO_PLAYLIST_URLS';
    throw error;
  }

  const byVideoId = new Map();
  const videosWithoutId = [];
  const duplicates = [];
  const sourceResults = [];

  for (let index = 0; index < urls.length; index += 1) {
    const sourceUrl = urls[index];
    await logger.info(`Lendo fonte ${index + 1}/${urls.length} para ${playlist.folderName}: ${sourceUrl}`);
    const sourceVideos = await fetchPlaylistVideosFromUrl(config, playlist, sourceUrl, index);
    let uniqueFromSource = 0;
    let duplicateFromSource = 0;

    for (const video of sourceVideos) {
      const videoId = video && video.id;
      if (!videoId) {
        videosWithoutId.push(video);
        uniqueFromSource += 1;
        continue;
      }

      if (byVideoId.has(videoId)) {
        const first = byVideoId.get(videoId);
        const duplicate = {
          id: videoId,
          title: video.title || first.title || '',
          firstSourceIndex: first.sourceIndex,
          firstSourceUrl: first.sourceUrl,
          duplicateSourceIndex: index,
          duplicateSourceUrl: sourceUrl
        };
        duplicates.push(duplicate);
        duplicateFromSource += 1;
        await logger.info(`Video duplicado ignorado em ${playlist.folderName}: ${videoId} ja veio da fonte ${first.sourceIndex + 1}; repetido na fonte ${index + 1}.`);
        continue;
      }

      byVideoId.set(videoId, video);
      uniqueFromSource += 1;
    }

    sourceResults.push({
      index,
      url: sourceUrl,
      fetched: sourceVideos.length,
      unique: uniqueFromSource,
      duplicates: duplicateFromSource
    });
  }

  return {
    videos: [...byVideoId.values(), ...videosWithoutId],
    duplicates,
    sourceResults,
    sourceCount: urls.length,
    fetchedCount: sourceResults.reduce((total, source) => total + source.fetched, 0)
  };
}


function truncateText(value, maxLength = 2200) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.floor(maxLength / 2)).trim()}\n...\n${text.slice(-Math.floor(maxLength / 2)).trim()}`;
}

function classifyYtDlpCookieTest(stderr, stdout) {
  const output = `${stderr || ''}\n${stdout || ''}`;

  if (/sign in to confirm.*not a bot|confirm you.?re not a bot|use --cookies|use --cookies-from-browser|authentication|login required|not logged in/i.test(output)) {
    return {
      status: 'invalid-cookie',
      message: 'O YouTube recusou o acesso com estes cookies. Reexporte o cookies.txt, confira se ele esta atualizado e se o usuario do ErsatzTV consegue ler o arquivo.'
    };
  }

  if (/cookie.*expired|expired.*cookie|invalid cookie/i.test(output)) {
    return {
      status: 'invalid-cookie',
      message: 'O yt-dlp indicou cookie expirado ou invalido. Reexporte o cookies.txt em formato Netscape.'
    };
  }

  if (/signature solving failed|n challenge solving failed|only images are available/i.test(output)) {
    return {
      status: 'youtube-js-challenge',
      message: 'O YouTube respondeu com desafio JavaScript/signature. Verifique se Deno/Node, --js-runtimes e --remote-components estao configurados corretamente.'
    };
  }

  if (/requested format is not available|no video formats found|no formats found/i.test(output)) {
    return {
      status: 'format-unavailable',
      message: 'O YouTube foi acessado, mas nenhum formato de video compativel foi liberado para o teste. Isso pode ser seletor -f, bloqueio do video ou cookie/runtime JS.'
    };
  }

  if (/http error 429|too many requests|rate-limit|ratelimit/i.test(output)) {
    return {
      status: 'rate-limited',
      message: 'O YouTube limitou temporariamente as requisicoes desse IP/sessao. Aguarde, renove cookies ou reduza a frequencia de testes/streams.'
    };
  }

  return {
    status: 'yt-dlp-failed',
    message: 'O yt-dlp falhou no teste ativo. Veja stderr/stdout retornados para identificar se e cookie, runtime JS, formato ou bloqueio do video.'
  };
}

async function inspectCookieFile(cookiesPath) {
  const result = {
    path: cookiesPath,
    configured: Boolean(cookiesPath),
    exists: false,
    readable: false,
    sizeBytes: 0,
    modifiedAt: null,
    error: null
  };

  if (!cookiesPath) {
    result.error = 'Nenhum caminho de cookies.txt foi configurado para esta playlist nem no campo global.';
    return result;
  }

  try {
    const stats = await fs.stat(cookiesPath);
    result.exists = true;
    result.sizeBytes = stats.size;
    result.modifiedAt = stats.mtime.toISOString();
    await fs.access(cookiesPath, fsConstants.R_OK);
    result.readable = true;
    if (stats.size <= 0) {
      result.error = 'O arquivo cookies.txt existe, mas esta vazio.';
    }
  } catch (error) {
    result.error = error.code === 'ENOENT'
      ? 'O arquivo cookies.txt nao existe nesse caminho.'
      : `Nao foi possivel ler o cookies.txt: ${error.message}`;
  }

  return result;
}

function getVideoIdFromUrl(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ''));
    const videoId = parsed.searchParams.get('v');
    if (videoId) return videoId;

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname.includes('youtu.be') && parts[0]) return parts[0];
    if (parts[0] === 'shorts' && parts[1]) return parts[1];
  } catch {
    // Ignora URLs fora do formato padrao; o yt-dlp tentara lidar com elas abaixo.
  }

  return '';
}

async function resolveCookieTestTarget(config, playlist) {
  const urls = getPlaylistUrls(playlist);

  for (let index = 0; index < urls.length; index += 1) {
    const directVideoId = getVideoIdFromUrl(urls[index]);
    if (directVideoId) {
      return {
        source: 'playlist-url-video-id',
        sourceIndex: index,
        sourceUrl: urls[index],
        videoId: directVideoId,
        url: `https://www.youtube.com/watch?v=${directVideoId}`,
        title: null
      };
    }
  }

  if (urls.length === 0) {
    const error = new Error('Nenhuma URL de playlist configurada para escolher o video de teste.');
    error.status = 'target-error';
    throw error;
  }

  const sourceUrl = urls[0];
  const listArgs = [
    ...buildYtDlpCommonArgs(config, playlist),
    '--dump-json',
    '--flat-playlist',
    '--playlist-items',
    '1',
    sourceUrl
  ];

  const result = await runCommand(config.paths.ytDlpPath, listArgs, { timeoutMs: 60000 });
  if (result.code !== 0 || result.timedOut) {
    const classification = classifyYtDlpCookieTest(result.stderr, result.stdout);
    const error = new Error(result.timedOut ? 'Timeout ao consultar a playlist para escolher o video de teste.' : classification.message);
    error.status = result.timedOut ? 'timeout' : classification.status;
    error.ytDlp = {
      code: result.code,
      signal: result.signal || null,
      timedOut: Boolean(result.timedOut),
      stdout: truncateText(result.stdout),
      stderr: truncateText(result.stderr)
    };
    throw error;
  }

  const { videos } = parseYtDlpJsonLines(result.stdout);
  const first = videos.find((video) => video && video.id);
  if (first) {
    return {
      source: 'playlist-first-item',
      sourceIndex: 0,
      sourceUrl,
      videoId: first.id,
      url: `https://www.youtube.com/watch?v=${first.id}`,
      title: first.title || null
    };
  }

  return {
    source: 'playlist-url-fallback',
    sourceIndex: 0,
    sourceUrl,
    videoId: null,
    url: sourceUrl,
    title: null
  };
}

async function testPlaylistCookies(config, identifier) {
  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Playlist nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  const cookiesPath = getEffectiveCookiesPath(config, playlist);
  const cookieFile = await inspectCookieFile(cookiesPath);
  const summary = {
    playlist: playlist.folderName,
    sourceName: playlist.name,
    ok: false,
    status: 'not-tested',
    message: '',
    cookiesPath,
    cookieFile,
    target: null,
    ytDlp: null,
    testedAt: new Date().toISOString()
  };

  if (!cookieFile.configured || !cookieFile.exists || !cookieFile.readable || cookieFile.sizeBytes <= 0) {
    summary.status = 'cookie-file-error';
    summary.message = cookieFile.error || 'Arquivo cookies.txt nao configurado, ilegivel ou vazio.';
    await logger.warn(`Teste de cookies nao executado para ${playlist.folderName}: ${summary.message}`);
    return summary;
  }

  await logger.info(`Teste ativo de cookies iniciado para ${playlist.folderName}: ${cookiesPath}`);

  let target;
  try {
    target = await resolveCookieTestTarget(config, playlist);
    summary.target = target;
  } catch (error) {
    summary.status = error.status || 'target-error';
    summary.message = error.message;
    summary.ytDlp = error.ytDlp || null;
    await logger.warn(`Teste de cookies falhou ao resolver video de teste para ${playlist.folderName}: ${error.message}`);
    return summary;
  }

  const testFormat = 'best[height<=360][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best';
  const args = [
    ...buildYtDlpCommonArgs(config, playlist),
    '--no-playlist',
    '--no-progress',
    '--no-color',
    '--simulate',
    '--skip-download',
    '-f',
    testFormat,
    '--print',
    'id=%(id)s\ntitle=%(title)s\nduration=%(duration_string)s\nresolution=%(resolution)s\nformat_id=%(format_id)s',
    target.url
  ];

  let result;
  try {
    result = await runCommand(config.paths.ytDlpPath, args, { timeoutMs: 75000 });
  } catch (error) {
    summary.status = 'spawn-error';
    summary.message = `Nao foi possivel executar o yt-dlp: ${error.message}`;
    await logger.warn(`Teste de cookies falhou para ${playlist.folderName}: ${summary.message}`);
    return summary;
  }

  summary.ytDlp = {
    code: result.code,
    signal: result.signal || null,
    timedOut: Boolean(result.timedOut),
    stdout: truncateText(result.stdout),
    stderr: truncateText(result.stderr)
  };

  if (result.timedOut) {
    summary.status = 'timeout';
    summary.message = 'O teste ativo demorou demais e foi interrompido. Pode ser rede, YouTube lento ou yt-dlp travado.';
  } else if (result.code === 0) {
    summary.ok = true;
    summary.status = 'valid';
    summary.message = 'Cookie aceito pelo YouTube no teste ativo. O yt-dlp conseguiu ler o video de teste usando esse cookies.txt.';
  } else {
    const classification = classifyYtDlpCookieTest(result.stderr, result.stdout);
    summary.status = classification.status;
    summary.message = classification.message;
  }

  const logPayload = {
    playlist: summary.playlist,
    cookiesPath: summary.cookiesPath,
    target: summary.target && summary.target.url,
    code: summary.ytDlp && summary.ytDlp.code
  };

  if (summary.ok) {
    await logger.info(`Teste de cookies finalizado para ${playlist.folderName}: ${summary.status}. ${summary.message}`, logPayload);
  } else {
    await logger.warn(`Teste de cookies finalizado para ${playlist.folderName}: ${summary.status}. ${summary.message}`, logPayload);
  }

  return summary;
}

async function readExistingYmlIndex(playlistDir) {
  const files = await walkFiles(playlistDir);
  const byVideoId = new Map();
  const byPath = new Map();
  const ymlFiles = [];

  for (const filePath of files) {
    if (!filePath.endsWith('.yml')) continue;

    ymlFiles.push(filePath);

    const content = await fs.readFile(filePath, 'utf8');
    const match = content.match(/watch\?v=([a-zA-Z0-9_-]+)/);
    const videoId = match ? match[1] : null;
    byPath.set(path.resolve(filePath), videoId);

    if (videoId && !byVideoId.has(videoId)) {
      byVideoId.set(videoId, filePath);
    }
  }

  return { byVideoId, byPath, ymlFiles };
}

function getCollisionSafeYmlPath(baseFilePath, existingIndex, videoId) {
  const parsed = path.parse(baseFilePath);
  let candidate = baseFilePath;
  let counter = 1;

  while (true) {
    const key = path.resolve(candidate);
    if (!existingIndex.byPath.has(key)) return candidate;

    const ownerId = existingIndex.byPath.get(key);
    if (ownerId === videoId) return candidate;

    const suffix = counter === 1 ? videoId : `${videoId}-${counter}`;
    candidate = path.join(parsed.dir, `${parsed.name} [${suffix}]${parsed.ext}`);
    counter += 1;
  }
}

async function writeVideoYml(config, playlist, playlistDir, existingIndex, video, summary, streamScriptHash) {
  const videoId = video.id;
  const rawTitle = video.title || 'Sem_Titulo';
  const duration = Number(video.duration);

  if (!videoId || !Number.isFinite(duration) || duration <= 0) {
    summary.videosSkipped += 1;
    return;
  }

  const { artist, title } = extractArtistAndTitle(rawTitle);
  const artistDir = path.join(playlistDir, artist);
  await fs.mkdir(artistDir, { recursive: true });

  const baseFileName = artist !== 'Outros' ? `${artist} - ${title}.yml` : `${title}.yml`;
  const baseFilePath = path.join(artistDir, baseFileName);
  const filePath = getCollisionSafeYmlPath(baseFilePath, existingIndex, videoId);
  const existingPath = existingIndex.byVideoId.get(videoId);
  const ymlContent = buildYmlContent(config, playlist, videoId, duration, streamScriptHash, {
    rawTitle,
    artist,
    title,
    description: video.description || ''
  });

  if (path.resolve(filePath) !== path.resolve(baseFilePath)) {
    await logger.warn(`Nome de YML duplicado detectado em ${playlist.folderName}; usando arquivo unico para ${videoId}: ${path.basename(filePath)}`);
  }

  if (existingPath && path.resolve(existingPath) !== path.resolve(filePath)) {
    await fs.rm(existingPath, { force: true });
    existingIndex.byPath.delete(path.resolve(existingPath));
    summary.filesMoved += 1;
    await logger.info(`YML movido/renomeado: ${path.basename(existingPath)} -> ${path.basename(filePath)}`);
  }

  const alreadyExists = await pathExists(filePath);
  const previousContent = alreadyExists ? await fs.readFile(filePath, 'utf8') : null;

  if (previousContent === ymlContent) {
    summary.filesUnchanged += 1;
    existingIndex.byVideoId.set(videoId, filePath);
    existingIndex.byPath.set(path.resolve(filePath), videoId);
    return;
  }

  await fs.writeFile(filePath, ymlContent, 'utf8');
  existingIndex.byVideoId.set(videoId, filePath);
  existingIndex.byPath.set(path.resolve(filePath), videoId);

  if (alreadyExists) {
    summary.filesUpdated += 1;
  } else {
    summary.filesCreated += 1;
  }
}

async function scanPlaylistLibrary(config, playlist) {
  if (!playlist.libraryId) {
    await logger.warn(`Scan ignorado para ${playlist.folderName}: Library ID nao configurado.`);
    return { ok: false, status: 0, statusText: 'Library ID nao configurado' };
  }

  const baseUrl = String(config.ersatztv.url || '').replace(/\/+$/, '');
  const url = `${baseUrl}/api/libraries/${playlist.libraryId}/scan`;

  await logger.info(`Disparando scan da biblioteca ${playlist.libraryId} (${playlist.folderName})...`);
  const result = await apiRequest(url, 'POST', config.ersatztv.apiTimeoutSeconds);

  if (!result.ok) {
    await logger.warn(`Scan falhou para ${playlist.folderName}: HTTP ${result.status} ${result.statusText}`);
  }

  return result;
}

function getCountSnapshot(summary) {
  return {
    videosSkipped: summary.videosSkipped,
    filesCreated: summary.filesCreated,
    filesUpdated: summary.filesUpdated,
    filesMoved: summary.filesMoved,
    filesUnchanged: summary.filesUnchanged
  };
}

function getCountDelta(summary, before) {
  return {
    videosSkipped: summary.videosSkipped - before.videosSkipped,
    filesCreated: summary.filesCreated - before.filesCreated,
    filesUpdated: summary.filesUpdated - before.filesUpdated,
    filesMoved: summary.filesMoved - before.filesMoved,
    filesUnchanged: summary.filesUnchanged - before.filesUnchanged
  };
}

async function processPlaylist(config, playlist, summary) {
  const playlistDir = getPlaylistDir(config, playlist);
  const playlistSummary = {
    name: playlist.folderName,
    sourceName: playlist.name,
    enabled: playlist.enabled !== false,
    libraryId: playlist.libraryId || null,
    playoutId: playlist.playoutId || null,
    sourceCount: getPlaylistUrls(playlist).length,
    sourceResults: [],
    videosFetched: 0,
    videosFound: 0,
    videosDuplicate: 0,
    duplicates: [],
    videosSkipped: 0,
    filesCreated: 0,
    filesUpdated: 0,
    filesMoved: 0,
    filesUnchanged: 0,
    streamScriptPath: null,
    streamScriptHash: null,
    streamScriptChanged: false,
    streamQualityMode: config.stream.qualityMode || 'compatible',
    streamMaxHeight: config.stream.maxHeight || null,
    streamJsRuntimeMode: config.stream.jsRuntimeMode || 'disabled',
    streamEjsComponents: config.stream.ejsComponents || 'none',
    scanRequested: false,
    scanSkippedReason: null,
    scan: null,
    failed: false,
    error: null
  };

  await fs.mkdir(playlistDir, { recursive: true });
  const streamScript = await ensurePlaylistStreamScript(config, playlist);
  playlistSummary.streamScriptPath = streamScript.scriptPath;
  playlistSummary.streamScriptHash = streamScript.hash;
  playlistSummary.streamScriptChanged = streamScript.changed;

  if (streamScript.changed) {
    await logger.info(`Alteracao no script de stream detectada para ${playlist.folderName}; os YML serao reavaliados com a nova assinatura.`);
  }

  await logger.info(`--- Processando: ${playlist.folderName} ---`);

  let fetchResult;
  try {
    fetchResult = await fetchPlaylistVideos(config, playlist);
  } catch (error) {
    summary.playlistsFailed += 1;
    playlistSummary.failed = true;
    playlistSummary.error = error.message;
    summary.playlists.push(playlistSummary);
    await logger.error(`${error.message} Nenhum arquivo sera removido automaticamente.`);
    return playlistSummary;
  }

  const videos = fetchResult.videos;
  const existingIndex = await readExistingYmlIndex(playlistDir);
  summary.videosFound += videos.length;
  summary.videosDuplicate += fetchResult.duplicates.length;
  playlistSummary.sourceResults = fetchResult.sourceResults;
  playlistSummary.videosFetched = fetchResult.fetchedCount;
  playlistSummary.videosFound = videos.length;
  playlistSummary.videosDuplicate = fetchResult.duplicates.length;
  playlistSummary.duplicates = fetchResult.duplicates.slice(0, 50);

  const before = getCountSnapshot(summary);

  for (const video of videos) {
    await writeVideoYml(config, playlist, playlistDir, existingIndex, video, summary, streamScript.hash);
  }

  Object.assign(playlistSummary, getCountDelta(summary, before));

  const hasYmlChanges = playlistSummary.filesCreated > 0 || playlistSummary.filesUpdated > 0 || playlistSummary.filesMoved > 0;
  if (hasYmlChanges) {
    const scan = await scanPlaylistLibrary(config, playlist);
    playlistSummary.scanRequested = true;
    playlistSummary.scan = scan;
    summary.api.scans.push({ playlist: playlist.folderName, libraryId: playlist.libraryId || null, ...scan });
  } else {
    const reason = 'Nenhum YML criado, atualizado ou movido nesta rodada.';
    playlistSummary.scanSkippedReason = reason;
    summary.api.scansSkipped.push({ playlist: playlist.folderName, libraryId: playlist.libraryId || null, reason });
    await logger.info(`Scan automatico ignorado para ${playlist.folderName}: ${reason}`);
  }

  summary.playlistsProcessed += 1;
  summary.playlists.push(playlistSummary);
  return playlistSummary;
}

function createRunSummary(options) {
  return {
    startedAt: state.startedAt,
    finishedAt: null,
    trigger: options.trigger || 'manual',
    targetPlaylist: options.playlistName ? sanitizeName(decodeURIComponent(String(options.playlistName))) : null,
    playlistsProcessed: 0,
    playlistsFailed: 0,
    videosFound: 0,
    videosDuplicate: 0,
    videosSkipped: 0,
    filesCreated: 0,
    filesUpdated: 0,
    filesMoved: 0,
    filesUnchanged: 0,
    playlists: [],
    api: {
      scans: [],
      scansSkipped: []
    }
  };
}

async function runSync(config, options = {}) {
  const targetPlaylist = options.playlistName ? findPlaylist(config, options.playlistName) : null;
  if (options.playlistName && !targetPlaylist) {
    const error = new Error('Playlist nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  if (state.running) {
    const error = new Error('Sincronizacao ja esta em execucao.');
    error.code = 'SYNC_ALREADY_RUNNING';
    throw error;
  }

  state.running = true;
  state.currentStep = 'starting';
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;

  const summary = createRunSummary(options);

  try {
    const scope = targetPlaylist ? ` para ${targetPlaylist.folderName}` : '';
    await logger.info(`Sincronizacao iniciada (${summary.trigger})${scope}.`);

    state.currentStep = 'prepare-base-dir';
    await fs.mkdir(config.paths.baseDir, { recursive: true });

    const playlistsToProcess = targetPlaylist ? [targetPlaylist] : getPlaylistsWithFolders(config);

    for (const playlist of playlistsToProcess) {
      state.currentStep = `process-playlist:${playlist.folderName}`;
      await processPlaylist(config, playlist, summary);
    }

    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'idle';
    state.lastResult = summary;

    await logger.info('Sincronizacao finalizada.', summary);
    return summary;
  } catch (error) {
    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'error';
    state.lastError = {
      message: error.message,
      stack: error.stack
    };
    state.lastResult = summary;
    await logger.error(`Sincronizacao interrompida: ${error.message}`);
    throw error;
  } finally {
    state.running = false;
  }
}

async function manualCleanupPlaylist(config, identifier) {
  if (state.running) {
    const error = new Error('Existe uma operacao em execucao. Tente novamente quando terminar.');
    error.code = 'SYNC_ALREADY_RUNNING';
    throw error;
  }

  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Playlist nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  state.running = true;
  state.currentStep = `manual-cleanup:${playlist.folderName}`;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;

  const summary = {
    startedAt: state.startedAt,
    finishedAt: null,
    trigger: 'manual-cleanup',
    playlist: playlist.folderName,
    videosFound: 0,
    videosDuplicate: 0,
    filesChecked: 0,
    filesRemoved: 0,
    foldersRemoved: 0
  };

  try {
    await logger.info(`Limpeza manual iniciada para ${playlist.folderName}.`);

    const playlistDir = getPlaylistDir(config, playlist);
    const fetchResult = await fetchPlaylistVideos(config, playlist);
    const currentIds = new Set(fetchResult.videos.map((video) => video.id).filter(Boolean));
    const files = await walkFiles(playlistDir);

    summary.videosFound = currentIds.size;
    summary.videosDuplicate = fetchResult.duplicates.length;

    for (const filePath of files) {
      if (!filePath.endsWith('.yml')) continue;
      summary.filesChecked += 1;

      const content = await fs.readFile(filePath, 'utf8');
      const match = content.match(/watch\?v=([a-zA-Z0-9_-]+)/);

      if (!match || !currentIds.has(match[1])) {
        await fs.rm(filePath, { force: true });
        summary.filesRemoved += 1;
        await logger.info(`YML removido na limpeza manual: ${filePath}`);
      }
    }

    summary.foldersRemoved = await removeEmptyDirectories(playlistDir, playlistDir, logger);

    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'idle';
    state.lastResult = summary;

    await logger.info('Limpeza manual finalizada.', summary);
    return summary;
  } catch (error) {
    summary.finishedAt = new Date().toISOString();
    state.finishedAt = summary.finishedAt;
    state.currentStep = 'error';
    state.lastError = {
      message: error.message,
      stack: error.stack
    };
    state.lastResult = summary;
    await logger.error(`Limpeza manual interrompida: ${error.message}`);
    throw error;
  } finally {
    state.running = false;
  }
}

async function runPlaylistApiAction(config, identifier, action) {
  const playlist = findPlaylist(config, identifier);
  if (!playlist) {
    const error = new Error('Playlist nao encontrada na configuracao.');
    error.statusCode = 404;
    throw error;
  }

  const baseUrl = String(config.ersatztv.url || '').replace(/\/+$/, '');
  const timeoutSeconds = config.ersatztv.apiTimeoutSeconds;
  let url;
  let label;

  if (action === 'scan') {
    if (!playlist.libraryId) throw new Error(`Library ID nao configurado para ${playlist.folderName}.`);
    url = `${baseUrl}/api/libraries/${playlist.libraryId}/scan`;
    label = `scan da biblioteca ${playlist.libraryId}`;
  } else if (action === 'empty-trash') {
    if (!playlist.libraryId) throw new Error(`Library ID nao configurado para ${playlist.folderName}.`);
    url = `${baseUrl}/api/libraries/${playlist.libraryId}/empty-trash`;
    label = `limpeza de lixo da biblioteca ${playlist.libraryId}`;
  } else if (action === 'rebuild-playout') {
    if (!playlist.playoutId) throw new Error(`Playout ID nao configurado para ${playlist.folderName}.`);
    url = `${baseUrl}/api/playout/${playlist.playoutId}/rebuild`;
    label = `rebuild do playout ${playlist.playoutId}`;
  } else {
    const error = new Error('Acao de playlist nao suportada.');
    error.statusCode = 404;
    throw error;
  }

  await logger.info(`Disparando ${label} (${playlist.folderName})...`);
  const result = await apiRequest(url, 'POST', timeoutSeconds);

  if (result.ok) {
    await logger.info(`Acao concluida: ${label} (${playlist.folderName}).`, result);
  } else {
    await logger.warn(`Acao falhou: ${label} (${playlist.folderName}) HTTP ${result.status} ${result.statusText}.`);
  }

  return {
    ok: result.ok,
    playlist: playlist.folderName,
    action,
    libraryId: playlist.libraryId || null,
    playoutId: playlist.playoutId || null,
    result
  };
}

function getState() {
  return { ...state };
}

module.exports = {
  runSync,
  manualCleanupPlaylist,
  runPlaylistApiAction,
  testPlaylistCookies,
  findPlaylist,
  getState
};
