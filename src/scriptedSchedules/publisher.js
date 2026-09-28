const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { FILE_BACKUPS_DIR } = require('./store');

const execFileAsync = promisify(execFile);

function safePublishedPath(outputRoot, fileName) {
  const rawRoot = String(outputRoot || '').trim();
  if (!rawRoot || !path.isAbsolute(rawRoot)) {
    const error = new Error('A pasta de saida precisa ser um caminho absoluto.');
    error.statusCode = 400;
    throw error;
  }
  const root = path.resolve(rawRoot);
  const name = String(fileName || '').trim();
  if (!name || path.basename(name) !== name || /[\\/]/.test(name) || name.includes('..') || !/^[A-Za-z0-9._-]+\.py$/i.test(name)) {
    const error = new Error('Nome de arquivo Python invalido.');
    error.statusCode = 400;
    throw error;
  }
  const finalPath = path.resolve(root, name);
  const relative = path.relative(root, finalPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    if (finalPath !== path.join(root, name)) {
      const error = new Error('O arquivo precisa permanecer dentro da pasta de saida configurada.');
      error.statusCode = 400;
      throw error;
    }
  }
  return { root, finalPath };
}

async function testOutputRoot(outputRoot) {
  const rawRoot = String(outputRoot || '').trim();
  if (!rawRoot || !path.isAbsolute(rawRoot)) {
    const error = new Error('Informe uma pasta de saida absoluta.');
    error.statusCode = 400;
    throw error;
  }
  const root = path.resolve(rawRoot);
  await fs.mkdir(root, { recursive: true });
  const probe = path.join(root, `.ersatztv-write-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    await fs.writeFile(probe, 'ok', { encoding: 'utf8', mode: 0o600 });
  } finally {
    await fs.unlink(probe).catch(() => {});
  }
  return root;
}

async function validateGeneratedScript(script) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ersatztv-scripted-'));
  const filePath = path.join(dir, 'schedule.py');
  await fs.writeFile(filePath, script, 'utf8');
  try {
    const result = await execFileAsync('python3', [filePath, '--validate-config'], { timeout: 15000, maxBuffer: 1024 * 1024 });
    return { available: true, ok: true, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
  } catch (error) {
    if (error.code === 'ENOENT') return { available: false, ok: true, stdout: '', stderr: 'python3 nao encontrado; validacao externa ignorada.' };
    const validationError = new Error(`O Python rejeitou o script gerado: ${String(error.stderr || error.stdout || error.message).trim()}`);
    validationError.statusCode = 400;
    validationError.code = 'PYTHON_VALIDATION_FAILED';
    throw validationError;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function backupExistingFile(projectId, finalPath, limit = 10) {
  try {
    const content = await fs.readFile(finalPath);
    const dir = path.join(FILE_BACKUPS_DIR, String(projectId));
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dir, `${stamp}-${path.basename(finalPath)}`);
    await fs.writeFile(backupPath, content, { mode: 0o700 });
    const entries = (await fs.readdir(dir)).sort().reverse();
    for (const old of entries.slice(Math.max(1, Number(limit) || 10))) await fs.unlink(path.join(dir, old)).catch(() => {});
    return backupPath;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function publishScript({ projectId, fileName, outputRoot, script, historyLimit = 10 }) {
  const { root, finalPath } = safePublishedPath(outputRoot, fileName);
  await testOutputRoot(root);
  const pythonValidation = await validateGeneratedScript(script);
  const hash = crypto.createHash('sha256').update(script).digest('hex');
  const backupPath = await backupExistingFile(projectId, finalPath, historyLimit);
  const tempPath = path.join(root, `.${fileName}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tempPath, script, { encoding: 'utf8', mode: 0o700, flag: 'wx' });
    await fs.chmod(tempPath, 0o755);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
  return { path: finalPath, hash, backupPath, pythonValidation };
}

async function removePublished(outputRoot, fileName) {
  const { finalPath } = safePublishedPath(outputRoot, fileName);
  try {
    await fs.unlink(finalPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = { safePublishedPath, testOutputRoot, validateGeneratedScript, publishScript, removePublished };
