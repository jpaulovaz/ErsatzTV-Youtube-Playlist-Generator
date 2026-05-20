const { loadConfig } = require('./config');
const { runSync } = require('./syncService');
const logger = require('./logger');

class Scheduler {
  constructor() {
    this.timer = null;
    this.enabled = false;
    this.intervalMinutes = 60;
    this.nextRunAt = null;
  }

  start(config) {
    this.configure(config, { runStartup: true });
  }

  configure(config, options = {}) {
    this.stopTimer();
    this.enabled = Boolean(config.scheduler && config.scheduler.enabled);
    this.intervalMinutes = Math.max(1, Number(config.scheduler && config.scheduler.intervalMinutes) || 60);

    if (!this.enabled) {
      this.nextRunAt = null;
      return;
    }

    const runStartup = Boolean(options.runStartup && config.scheduler.runOnStartup);
    const delayMs = runStartup ? 2000 : this.intervalMinutes * 60 * 1000;
    this.schedule(delayMs);
  }

  schedule(delayMs) {
    this.stopTimer();
    this.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.timer = setTimeout(() => this.executeScheduledRun(), delayMs);
  }

  stopTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async executeScheduledRun() {
    this.stopTimer();
    this.nextRunAt = null;

    try {
      const config = await loadConfig();
      if (!config.scheduler.enabled) {
        this.configure(config);
        return;
      }

      await runSync(config, { trigger: 'scheduler' });
    } catch (error) {
      await logger.error(`Execucao agendada falhou: ${error.message}`);
    } finally {
      try {
        const freshConfig = await loadConfig();
        this.configure(freshConfig);
      } catch (error) {
        await logger.error(`Nao foi possivel reagendar: ${error.message}`);
      }
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      intervalMinutes: this.intervalMinutes,
      nextRunAt: this.nextRunAt
    };
  }
}

module.exports = new Scheduler();
