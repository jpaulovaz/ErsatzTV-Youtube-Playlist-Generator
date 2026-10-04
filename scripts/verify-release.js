const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const failures = [];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function expect(relative, pattern, description) {
  const content = read(relative);
  if (!pattern.test(content)) failures.push(`${relative}: ${description}`);
}

function reject(relative, pattern, description) {
  const content = read(relative);
  if (pattern.test(content)) failures.push(`${relative}: ${description}`);
}

expect('public/index.html', new RegExp(`v${version.replaceAll('.', '\\.')}`), `versao visual deve ser v${version}`);
expect('public/index.html', new RegExp(`\\?v=${version.replaceAll('.', '\\.')}`), `cache-busting deve usar ${version}`);
expect('public/login.html', new RegExp(`\\?v=${version.replaceAll('.', '\\.')}`), `cache-busting deve usar ${version}`);
expect('README.md', new RegExp(`^# ErsatzTV YouTube Downloader ${version.replaceAll('.', '\\.')}`, 'm'), `cabecalho deve usar ${version}`);
expect('UPGRADE.md', new RegExp(`^# Atualização para ${version.replaceAll('.', '\\.')}`, 'm'), `guia de upgrade deve usar ${version}`);
expect('CHANGELOG.md', new RegExp(`^## ${version.replaceAll('.', '\\.')}$`, 'm'), `changelog deve conter ${version}`);
expect('UPDATE_CONTENTS.txt', new RegExp(`ErsatzTV YouTube Downloader ${version.replaceAll('.', '\\.')} - pacote de atualização`), `conteudo do update deve usar ${version}`);
expect('MODIFIED_FILES.txt', new RegExp(`^ErsatzTV YouTube Downloader ${version.replaceAll('.', '\\.')}$`, 'm'), `lista de arquivos deve usar ${version}`);
expect('config/config.example.json', /\"configVersion\"\s*:\s*9/, 'config de exemplo deve usar configVersion 9');
reject('config/config.example.json', /updateExistingThumbnails|showMetadata|movieMetadata/, 'config de exemplo nao deve conter campos removidos');
expect('src/scriptedSchedules/schema.js', /TEMPLATE_VERSION\s*=\s*'1\.3\.1'/, 'Universal atual deve ser 1.3.1');
expect('src/scriptedSchedules/schema.js', /SUPPORTED_TEMPLATE_VERSIONS\s*=\s*\[TEMPLATE_VERSION\]/, 'somente o Universal atual deve ser suportado');
reject('src/config.js', /showMetadata|movieMetadata|updateExistingThumbnails/, 'compatibilidade de metadata/thumbnail antiga nao deve permanecer');
reject('src/downloadManager.js', /showMetadata|movieMetadata|updateExistingThumbnails|releaseDateService/, 'download manager nao deve depender do legado removido');
reject('public/js/scriptedSchedulesView.js', /upgrade-template|LATEST_TEMPLATE_VERSION/, 'editor nao deve oferecer upgrade de motores antigos');

if (failures.length) {
  console.error('Verificacao de release falhou:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Release ${version} consistente.`);
