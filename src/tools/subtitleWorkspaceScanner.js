const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.avi', '.webm', '.ts', '.m2ts', '.mpg', '.mpeg', '.wmv', '.flv']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', '.sup']);
const READ_ONLY_SUBTITLE_FORMATS = new Set(['ass', 'ssa', 'vtt', 'sub', 'idx', 'sup']);
const FLAG_TOKENS = new Set(['forced', 'sdh', 'cc', 'hi', 'hearingimpaired', 'hearing-impaired']);

function stableItemId(workspaceId, relativePath) {
  return `subtitle-workspace::${workspaceId}::${crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 24)}`;
}

function parseSidecarIdentity(mediaPath, subtitlePath) {
  const media = path.parse(mediaPath);
  const subtitle = path.parse(subtitlePath);
  const base = subtitle.base;
  const prefix = `${media.name}.`;
  let suffix = '';
  if (subtitle.name === media.name) suffix = '';
  else if (base.startsWith(prefix)) suffix = base.slice(prefix.length, base.length - subtitle.ext.length);
  else return null;
  const tokens = suffix.split('.').map((value) => value.trim()).filter(Boolean);
  const flags = [];
  const lang = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (FLAG_TOKENS.has(key)) flags.push(key === 'hearingimpaired' || key === 'hearing-impaired' ? 'hi' : key);
    else lang.push(token);
  }
  return {
    trackId: subtitle.base,
    fileName: subtitle.base,
    language: lang.join('.') || 'und',
    flags: [...new Set(flags)],
    format: subtitle.ext.slice(1).toLowerCase(),
    editable: subtitle.ext.toLowerCase() === '.srt',
    readOnly: READ_ONLY_SUBTITLE_FORMATS.has(subtitle.ext.slice(1).toLowerCase())
  };
}

async function discoverSidecarsForMedia(mediaPath) {
  let entries = [];
  try { entries = await fs.readdir(path.dirname(mediaPath), { withFileTypes: true }); }
  catch { return []; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUBTITLE_EXTENSIONS.has(ext)) continue;
    const filePath = path.join(path.dirname(mediaPath), entry.name);
    const identity = parseSidecarIdentity(mediaPath, filePath);
    if (!identity) continue;
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats) continue;
    result.push({ ...identity, filePath, sizeBytes: stats.size, mtimeMs: Math.round(stats.mtimeMs) });
  }
  result.sort((a, b) => a.fileName.localeCompare(b.fileName, 'pt-BR', { sensitivity: 'base' }));
  return result;
}

async function scanWorkspace({ workspace, onProgress }) {
  const root = path.resolve(workspace.rootPath);
  const previous = workspace.items || {};
  const items = {};
  let directoriesScanned = 0;
  let filesSeen = 0;
  let videosFound = 0;
  const stack = [root];
  const startedAt = Date.now();

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch (error) {
      if (current === root) throw error;
      continue;
    }
    directoriesScanned += 1;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (workspace.recursive !== false) stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      filesSeen += 1;
      if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stats = await fs.stat(fullPath).catch(() => null);
      if (!stats) continue;
      const relativePath = path.relative(root, fullPath);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
      const id = stableItemId(workspace.id, relativePath);
      const old = previous[id] || {};
      const unchanged = Number(old.sizeBytes) === Number(stats.size) && Number(old.mtimeMs) === Math.round(stats.mtimeMs);
      const sidecars = await discoverSidecarsForMedia(fullPath);
      items[id] = {
        id,
        relativePath,
        fileName: entry.name,
        sizeBytes: stats.size,
        mtimeMs: Math.round(stats.mtimeMs),
        sidecars: sidecars.map(({ filePath, ...sidecar }) => sidecar),
        reviewStatus: old.reviewStatus === 'reviewed' ? 'reviewed' : 'unreviewed',
        reviewedAt: old.reviewedAt || null,
        lastSeenAt: new Date().toISOString(),
        probe: unchanged ? (old.probe || null) : null,
        bazarr: old.bazarr || null
      };
      videosFound += 1;
      if (typeof onProgress === 'function' && videosFound % 25 === 0) {
        await onProgress({ directoriesScanned, filesSeen, videosFound, currentPath: relativePath });
      }
    }
  }

  const values = Object.values(items);
  const summary = {
    videosFound: values.length,
    withEditableSubtitles: values.filter((item) => item.sidecars.some((track) => track.editable)).length,
    withoutExternalSubtitles: values.filter((item) => item.sidecars.length === 0).length,
    withReadOnlySubtitles: values.filter((item) => item.sidecars.some((track) => !track.editable)).length,
    reviewed: values.filter((item) => item.reviewStatus === 'reviewed').length,
    unreviewed: values.filter((item) => item.reviewStatus !== 'reviewed').length,
    directoriesScanned,
    filesSeen,
    durationMs: Date.now() - startedAt
  };
  return { items, summary };
}

module.exports = {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  stableItemId,
  parseSidecarIdentity,
  discoverSidecarsForMedia,
  scanWorkspace
};
