const { spawn } = require('child_process');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      detached: Boolean(options.detached)
    });
    if (typeof options.onSpawn === 'function') options.onSpawn(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer = null;
    const timeoutMs = Number(options.timeoutMs) || 0;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
        killTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 3000);
        if (typeof killTimer.unref === 'function') killTimer.unref();
      }, timeoutMs)
      : null;
    if (timeout && typeof timeout.unref === 'function') timeout.unref();

    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process already exited.
    }
  }

  setTimeout(() => {
    try {
      if (process.platform !== 'win32') {
        process.kill(-child.pid, 'SIGKILL');
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      // Process already exited.
    }
  }, 5000).unref();
}

module.exports = { runCommand, killProcessTree };
