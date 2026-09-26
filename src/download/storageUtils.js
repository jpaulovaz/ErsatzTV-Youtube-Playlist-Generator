const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

function nowIso() { return new Date().toISOString(); }

function runDf(targetPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/df', ['-Pk', targetPath], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `df terminou com codigo ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function getDiskStats(targetPath) {
  if (typeof fs.statfs === 'function') {
    const stats = await fs.statfs(targetPath);
    const blockSize = Number(stats.bsize || stats.frsize || 0);
    const totalBytes = blockSize * Number(stats.blocks || 0);
    const freeBytes = blockSize * Number(stats.bfree || 0);
    const availableBytes = blockSize * Number(stats.bavail || stats.bfree || 0);
    return {
      path: targetPath,
      totalBytes,
      freeBytes,
      availableBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      checkedAt: nowIso(),
      error: null
    };
  }

  const output = await runDf(targetPath);
  const lines = output.trim().split(/\r?\n/);
  const fields = String(lines[lines.length - 1] || '').trim().split(/\s+/);
  if (fields.length < 6) throw new Error('Saida inesperada do comando df.');
  const totalBytes = Number(fields[1]) * 1024;
  const usedBytes = Number(fields[2]) * 1024;
  const availableBytes = Number(fields[3]) * 1024;
  return {
    path: targetPath,
    totalBytes,
    freeBytes: Math.max(0, totalBytes - usedBytes),
    availableBytes,
    usedBytes,
    checkedAt: nowIso(),
    error: null
  };
}

async function moveAcrossFileSystems(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    const tempTarget = `${targetPath}.importing-${process.pid}`;
    await fs.copyFile(sourcePath, tempTarget);
    await fs.rename(tempTarget, targetPath);
    await fs.rm(sourcePath, { force: true });
  }
}

async function downloadRemoteFile(url, targetPath, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(targetPath, buffer);
    return buffer.length;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { getDiskStats, moveAcrossFileSystems, downloadRemoteFile };
