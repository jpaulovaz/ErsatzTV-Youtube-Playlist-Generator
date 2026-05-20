const fs = require('fs/promises');
const path = require('path');

function sanitizeName(value) {
  return String(value || '')
    .replace(/[\\/*?:"<>|]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArtistAndTitle(rawTitle) {
  const cleanName = sanitizeName(rawTitle || 'Sem_Titulo');
  if (cleanName.includes('-')) {
    const [artistPart, ...titleParts] = cleanName.split('-');
    const artist = sanitizeName(artistPart) || 'Outros';
    const title = sanitizeName(titleParts.join('-')) || 'Sem_Titulo';
    return { artist, title };
  }

  return { artist: 'Outros', title: cleanName || 'Sem_Titulo' };
}

function secondsToDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function yamlDoubleQuoted(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listDirectories(targetPath) {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
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

  if (normalizedTarget === normalizedStop) return;

  let entries = [];
  try {
    entries = await fs.readdir(normalizedTarget, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await removeEmptyDirectories(path.join(normalizedTarget, entry.name), normalizedStop, logger);
    }
  }

  try {
    const after = await fs.readdir(normalizedTarget);
    if (after.length === 0 && normalizedTarget !== normalizedStop) {
      await fs.rmdir(normalizedTarget);
      if (logger) await logger.info(`GC Pasta Artista: Removido ${normalizedTarget}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function isDangerousBaseDir(baseDir) {
  const resolved = path.resolve(baseDir || '');
  const parsed = path.parse(resolved);
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;

  if (!baseDir || resolved === parsed.root) return true;
  if (home && resolved === home) return true;
  if (resolved === '/home' || resolved === '/Users' || resolved === '/var' || resolved === '/opt') return true;

  const parts = resolved.split(path.sep).filter(Boolean);
  return parts.length < 3;
}

module.exports = {
  sanitizeName,
  extractArtistAndTitle,
  secondsToDuration,
  yamlDoubleQuoted,
  pathExists,
  listDirectories,
  walkFiles,
  removeEmptyDirectories,
  isDangerousBaseDir
};
