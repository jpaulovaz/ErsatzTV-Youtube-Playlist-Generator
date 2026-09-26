const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(__dirname, '..');
const obsoleteFiles = [
  path.join(root, 'src', 'movieMetadataService.js'),
  path.join(root, 'test', 'movieMetadataService.test.js'),
  path.join(root, 'src', 'showMetadataService.js'),
  path.join(root, 'test', 'showMetadataService.test.js')
];

(async () => {
  for (const filePath of obsoleteFiles) {
    await fs.rm(filePath, { force: true });
  }
})().catch((error) => {
  console.error(`Falha ao remover arquivos legados de metadados: ${error.message}`);
  process.exitCode = 1;
});
