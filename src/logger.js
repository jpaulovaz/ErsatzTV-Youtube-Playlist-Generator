const fs = require('fs/promises');
const path = require('path');
const EventEmitter = require('events');
const { ROOT_DIR } = require('./config');

class AppLogger extends EventEmitter {
  constructor() {
    super();
    this.logDir = path.join(ROOT_DIR, 'data');
    this.logPath = path.join(this.logDir, 'app.log');
    this.buffer = [];
    this.maxBuffer = 800;
  }

  async write(level, message, meta = {}) {
    const item = {
      ts: new Date().toISOString(),
      level,
      message: String(message),
      meta
    };

    this.buffer.push(item);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    this.emit('log', item);

    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await fs.appendFile(this.logPath, JSON.stringify(item) + '\n', 'utf8');
    } catch (error) {
      console.error('Log write failed:', error.message);
    }
  }

  info(message, meta) {
    return this.write('info', message, meta);
  }

  warn(message, meta) {
    return this.write('warn', message, meta);
  }

  error(message, meta) {
    return this.write('error', message, meta);
  }

  debug(message, meta) {
    return this.write('debug', message, meta);
  }

  async getLogs(limit = 200) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));

    try {
      const content = await fs.readFile(this.logPath, 'utf8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-safeLimit)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return {
              ts: new Date().toISOString(),
              level: 'warn',
              message: line,
              meta: {}
            };
          }
        });
    } catch {
      return this.buffer.slice(-safeLimit);
    }
  }

  async clear() {
    await fs.mkdir(this.logDir, { recursive: true });
    await fs.writeFile(this.logPath, '', 'utf8');
    this.buffer = [];
    await this.info('Logs limpos pela interface.');
  }
}

module.exports = new AppLogger();
