const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(__dirname, '..');
const obsoleteFiles = [
  path.join(root, 'src', 'movieMetadataService.js'),
  path.join(root, 'test', 'movieMetadataService.test.js')
];

(async () => {
  for (const filePath of obsoleteFiles) {
    await fs.rm(filePath, { force: true });
  }
})().catch((error) => {
  console.error(`Falha ao remover arquivos legados da v2.5/v2.6: ${error.message}`);
  process.exitCode = 1;
});
