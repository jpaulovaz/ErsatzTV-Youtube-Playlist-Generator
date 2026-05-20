const { loadConfig } = require('./config');
const { runSync } = require('./syncService');
const logger = require('./logger');

async function main() {
  const config = await loadConfig();
  const summary = await runSync(config, { trigger: 'cli' });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  await logger.error(`Execucao CLI falhou: ${error.message}`);
  console.error(error.message);
  process.exit(1);
});
