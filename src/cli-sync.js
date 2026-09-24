const { loadConfig } = require('./config');
const { runSync } = require('./syncService');
const downloadManager = require('./downloadManager');
const logger = require('./logger');

async function main() {
  const config = await loadConfig();
  await downloadManager.init(config);
  const summary = await runSync(config, { trigger: 'cli' });
  console.log(JSON.stringify({
    ...summary,
    queue: downloadManager.getQueueStatus(),
    note: 'A CLI apenas descobre e enfileira. O worker de downloads roda com npm start/systemd.'
  }, null, 2));
}

main().catch(async (error) => {
  await logger.error(`Execucao CLI falhou: ${error.message}`);
  console.error(error.message);
  process.exit(1);
});
