const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ROOTS = ['src', 'public', 'scripts'];
const EXCLUDED = new Set([
  'src/cleanupLegacyFiles.js',
  'src/movieMetadataService.js',
  'src/showMetadataService.js',
  'src/releaseDateService.js'
]);

function collectJs(dir) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJs(relative));
    else if (entry.isFile() && entry.name.endsWith('.js') && !EXCLUDED.has(relative)) out.push(relative);
  }
  return out;
}

const files = ROOTS.flatMap(collectJs).sort();
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
console.log(`Sintaxe OK: ${files.length} arquivo(s) JavaScript verificados.`);
