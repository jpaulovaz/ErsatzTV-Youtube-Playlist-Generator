const { loadConfig } = require('./config');
const { startServer } = require('./server');
const scheduler = require('./scheduler');
const logger = require('./logger');

async function main() {
  const config = await loadConfig();
  await startServer(config);
  scheduler.start(config);

  if (config.scheduler.enabled) {
    const status = scheduler.getStatus();
    await logger.info(`Agendador ativo: intervalo de ${status.intervalMinutes} minuto(s). Proxima execucao: ${status.nextRunAt}.`);
  } else {
    await logger.info('Agendador inativo. Ative pela interface quando quiser executar periodicamente.');
  }
}

process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled rejection: ${error.message}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`).finally(() => process.exit(1));
});

main().catch(async (error) => {
  await logger.error(`Falha ao iniciar aplicacao: ${error.message}`);
  process.exit(1);
});
