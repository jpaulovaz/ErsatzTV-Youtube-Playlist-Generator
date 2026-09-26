const { loadConfig } = require('./config');
const { runChannelSync } = require('./discovery/channelSyncService');
const logger = require('./logger');

class ChannelScheduler {
  constructor() {
    this.timer = null;
    this.enabled = false;
    this.intervalMinutes = 360;
    this.nextRunAt = null;
    this.running = false;
  }

  start(config) { this.configure(config, { runStartup: true }); }

  configure(config, options = {}) {
    this.stopTimer();
    this.enabled = Boolean(config.channelScheduler && config.channelScheduler.enabled);
    this.intervalMinutes = Math.max(1, Number(config.channelScheduler && config.channelScheduler.intervalMinutes) || 360);
    if (!this.enabled) { this.nextRunAt = null; return; }
    const runStartup = Boolean(options.runStartup && config.channelScheduler.runOnStartup);
    this.schedule(runStartup ? 3000 : this.intervalMinutes * 60 * 1000);
  }

  schedule(delayMs) {
    this.stopTimer();
    this.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.timer = setTimeout(() => this.executeScheduledRun(), delayMs);
    this.timer.unref();
  }

  stopTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  async executeScheduledRun() {
    this.stopTimer();
    this.nextRunAt = null;
    this.running = true;
    try {
      const config = await loadConfig();
      if (!config.channelScheduler.enabled) { this.configure(config); return; }
      await runChannelSync(config, { trigger: 'channel-scheduler' });
    } catch (error) {
      await logger.error(`Sincronizacao agendada de Canais falhou: ${error.message}`);
    } finally {
      this.running = false;
      try { this.configure(await loadConfig()); }
      catch (error) { await logger.error(`Nao foi possivel reagendar Canais: ${error.message}`); }
    }
  }

  getStatus() {
    return { enabled: this.enabled, running: this.running, intervalMinutes: this.intervalMinutes, nextRunAt: this.nextRunAt };
  }
}

module.exports = new ChannelScheduler();
