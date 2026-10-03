const path = require('path');

function sanitizeJsRuntimeName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function getYtDlpJsRuntimeArg(config) {
  const downloads = config && config.downloads || {};
  const mode = String(downloads.jsRuntimeMode || 'disabled').trim();
  if (!mode || mode === 'disabled') return '';

  const runtimeName = mode === 'custom'
    ? sanitizeJsRuntimeName(downloads.jsRuntimeCustomName)
    : sanitizeJsRuntimeName(mode);
  if (!runtimeName) return '';

  const runtimePath = String(downloads.jsRuntimePath || '').trim();
  return runtimePath ? `${runtimeName}:${runtimePath}` : runtimeName;
}

function getEffectiveCookiesPath(config, source) {
  return String((source && source.cookiesPath) || (config && config.paths && config.paths.cookiesPath) || '').trim();
}

function buildYtDlpCommonArgs(config, source = {}) {
  const downloads = config && config.downloads || {};
  const paths = config && config.paths || {};
  const args = [];
  const cookiesPath = getEffectiveCookiesPath(config, source);
  const runtimeArg = getYtDlpJsRuntimeArg(config);
  const ejsComponents = runtimeArg ? String(downloads.ejsComponents || '').trim() : '';

  if (runtimeArg) args.push('--js-runtimes', runtimeArg);
  if (ejsComponents && ejsComponents !== 'none') args.push('--remote-components', ejsComponents);
  if (cookiesPath) args.push('--cookies', cookiesPath);
  if (downloads.userAgent) args.push('--add-header', `User-Agent: ${downloads.userAgent}`);
  if (paths.ffmpegPath) args.push('--ffmpeg-location', path.dirname(paths.ffmpegPath));
  args.push('--no-color');
  return args;
}

module.exports = {
  sanitizeJsRuntimeName,
  getYtDlpJsRuntimeArg,
  getEffectiveCookiesPath,
  buildYtDlpCommonArgs
};
