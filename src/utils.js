const fs = require('fs/promises');
const fsSync = require('fs');
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

function normalizeArtistDisplayName(value) {
  const artist = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Outros';
  if (artist.toLocaleLowerCase('pt-BR') === 'outros') return 'Outros';

  // Corrige apenas casing claramente ruidoso em nomes simples com duas ou mais palavras.
  // Nomes estilizados (AC/DC, P!NK, deadmau5, blink-182, CHVRCHES) sao preservados.
  const simpleMultiWord = /^[\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+)+$/u.test(artist);
  if (!simpleMultiWord) return artist;

  const upper = artist.toLocaleUpperCase('pt-BR');
  const lower = artist.toLocaleLowerCase('pt-BR');
  if (artist !== upper && artist !== lower) return artist;

  return lower
    .split(/\s+/)
    .map((word) => {
      const chars = Array.from(word);
      if (chars.length === 0) return word;
      return `${chars[0].toLocaleUpperCase('pt-BR')}${chars.slice(1).join('')}`;
    })
    .join(' ');
}

function findCaseInsensitiveDirectoryName(parentDir, desiredName) {
  const desired = String(desiredName || '').trim();
  if (!desired) return null;

  try {
    const entries = fsSync.readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const exact = entries.find((name) => name === desired);
    if (exact) return exact;
    return entries.find((name) => name.localeCompare(desired, 'pt-BR', { sensitivity: 'accent' }) === 0) || null;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function extractArtistAndTitle(rawTitle) {
  const cleanName = sanitizeFileComponent(rawTitle || 'Sem Titulo');
  const separator = /\s+-\s+/;
  const match = separator.exec(cleanName);
  if (match) {
    const separatorIndex = match.index;
    const artistPart = cleanName.slice(0, separatorIndex);
    const titlePart = cleanName.slice(separatorIndex + match[0].length);
    const artist = normalizeArtistDisplayName(artistPart);
    const title = sanitizeFileComponent(titlePart, 'Sem Titulo', 170);
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

module.exports = {
  sanitizeName,
  sanitizeFileComponent,
  truncateComponent,
  normalizeArtistDisplayName,
  findCaseInsensitiveDirectoryName,
  extractArtistAndTitle,
  pathExists,
  removeEmptyDirectories,
  isPathInside,
  isDangerousBaseDir
};
