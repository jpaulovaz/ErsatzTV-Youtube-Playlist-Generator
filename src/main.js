const { loadConfig } = require('./config');
const { startServer } = require('./server');
const downloadManager = require('./downloadManager');
const scheduler = require('./scheduler');
const logger = require('./logger');
const auth = require('./auth');

let server = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  await logger.info(`Encerramento solicitado por ${signal}.`);
  scheduler.stopTimer();
  await downloadManager.stop({ terminateCurrent: true });
  auth.stop();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  process.exit(0);
}

async function main() {
  const config = await loadConfig();
  await downloadManager.start(config);
  server = await startServer(config);
  scheduler.start(config);

  if (config.scheduler.enabled) {
    const status = scheduler.getStatus();
    await logger.info(`Agendador ativo: descoberta a cada ${status.intervalMinutes} minuto(s). Proxima execucao: ${status.nextRunAt}.`);
  } else {
    await logger.info('Agendador inativo. Novos videos podem ser descobertos manualmente pela interface.');
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM').catch(() => process.exit(1)));
process.on('SIGINT', () => shutdown('SIGINT').catch(() => process.exit(1)));
process.on('unhandledRejection', (error) => logger.error(`Unhandled rejection: ${error.message}`));
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`).finally(() => process.exit(1));
});

main().catch(async (error) => {
  await logger.error(`Falha ao iniciar aplicacao: ${error.message}`);
  process.exit(1);
});
