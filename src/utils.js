const fs = require('fs/promises');
const path = require('path');

function sanitizeName(value) {
  return String(value || '')
    .replace(/[\\/*?:"<>|]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
}

function truncateComponent(value, maxLength = 180) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(1, maxLength)).trim().replace(/[. ]+$/g, '');
}

function sanitizeFileComponent(value, fallback = 'Sem Titulo', maxLength = 180) {
  return truncateComponent(sanitizeName(value) || fallback, maxLength) || fallback;
}

function extractArtistAndTitle(rawTitle) {
  const cleanName = sanitizeFileComponent(rawTitle || 'Sem Titulo');
  if (cleanName.includes('-')) {
    const [artistPart, ...titleParts] = cleanName.split('-');
    const artist = sanitizeFileComponent(artistPart, 'Outros', 100);
    const title = sanitizeFileComponent(titleParts.join('-'), 'Sem Titulo', 170);
    return { artist, title };
  }

  return {
    artist: 'Outros',
    title: sanitizeFileComponent(cleanName, 'Sem Titulo', 180)
  };
}

function pathExists(targetPath) {
  return fs.access(targetPath).then(() => true).catch(() => false);
}

async function walkFiles(targetPath) {
  const result = [];

  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  }

  await walk(targetPath);
  return result;
}

async function removeEmptyDirectories(targetPath, stopAtPath, logger) {
  const normalizedStop = path.resolve(stopAtPath);
  const normalizedTarget = path.resolve(targetPath);

  let removed = 0;
  let entries = [];
  try {
    entries = await fs.readdir(normalizedTarget, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      removed += await removeEmptyDirectories(path.join(normalizedTarget, entry.name), normalizedStop, logger);
    }
  }

  try {
    const after = await fs.readdir(normalizedTarget);
    if (after.length === 0 && normalizedTarget !== normalizedStop) {
      await fs.rmdir(normalizedTarget);
      removed += 1;
      if (logger) await logger.info(`Pasta vazia removida: ${normalizedTarget}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return removed;
}

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isDangerousBaseDir(baseDir) {
  const resolved = path.resolve(baseDir || '');
  const parsed = path.parse(resolved);
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;

  if (!baseDir || resolved === parsed.root) return true;
  if (home && resolved === home) return true;
  if (resolved === '/home' || resolved === '/Users' || resolved === '/var' || resolved === '/opt') return true;

  const parts = resolved.split(path.sep).filter(Boolean);
  return parts.length < 2;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** exponent);
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

module.exports = {
  sanitizeName,
  sanitizeFileComponent,
  truncateComponent,
  extractArtistAndTitle,
  pathExists,
  walkFiles,
  removeEmptyDirectories,
  isPathInside,
  isDangerousBaseDir,
  formatBytes,
  sleep
};
