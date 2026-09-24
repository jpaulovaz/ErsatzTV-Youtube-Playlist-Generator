#!/usr/bin/env node
const fs = require('fs/promises');
const readline = require('readline');
const {
  AUTH_CONFIG_PATH,
  buildAuthConfig,
  writeAuthConfig
} = require('./auth');

function parseArgs(argv) {
  const result = { username: '', force: false, trustProxy: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--username') result.username = String(argv[index += 1] || '').trim();
    else if (arg === '--force') result.force = true;
    else if (arg === '--trust-proxy') result.trustProxy = true;
    else if (arg === '--no-trust-proxy') result.trustProxy = false;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return result;
}

function printHelp() {
  console.log(`Uso:\n  npm run auth:set -- --username SEU_USUARIO\n\nOpcoes:\n  --username NOME        Usuario local\n  --trust-proxy          Confiar nos cabecalhos do proxy reverso\n  --no-trust-proxy       Ignorar cabecalhos de proxy\n  --force                Substituir auth.json sem confirmacao extra\n  -h, --help             Mostrar ajuda\n\nA senha e solicitada de forma interativa e nao aparece no terminal.`);
}

function promptLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('A senha precisa ser configurada em um terminal interativo.');
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    const previousRaw = stdin.isRaw;
    const previousEncoding = stdin.readableEncoding;

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(Boolean(previousRaw));
      stdin.pause();
      if (previousEncoding) stdin.setEncoding(previousEncoding);
    };

    const onData = (chunk) => {
      const text = String(chunk);
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          const error = new Error('Operacao cancelada.');
          error.cancelled = true;
          reject(error);
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (char >= ' ' && char !== '\u007f') {
          value += char;
          process.stdout.write('•');
        }
      }
    };

    process.stdout.write(question);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

function yes(value) {
  return /^(s|sim|y|yes)$/i.test(String(value || '').trim());
}

async function readExistingConfig() {
  try {
    return JSON.parse(await fs.readFile(AUTH_CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Nao foi possivel ler ${AUTH_CONFIG_PATH}: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const existing = await readExistingConfig();
  if (existing && !options.force) {
    const confirmation = await promptLine(`O arquivo ${AUTH_CONFIG_PATH} ja existe. Atualizar usuario e senha? [s/N] `);
    if (!yes(confirmation)) {
      console.log('Nenhuma alteracao realizada.');
      return;
    }
  }

  const username = options.username || await promptLine('Usuario local: ');
  const password = await promptHidden('Senha (minimo 12 caracteres): ');
  const confirmation = await promptHidden('Repita a senha: ');
  if (password !== confirmation) throw new Error('As senhas informadas nao conferem.');

  let trustProxy = options.trustProxy;
  if (trustProxy === null) {
    const currentDefault = existing && existing.security && existing.security.trustProxy ? 'S/n' : 's/N';
    const answer = await promptLine(`A aplicacao ficara exclusivamente atras de um proxy reverso confiavel? [${currentDefault}] `);
    trustProxy = answer.trim()
      ? yes(answer)
      : Boolean(existing && existing.security && existing.security.trustProxy);
  }

  const config = await buildAuthConfig({ username, password, existing });
  config.security.trustProxy = Boolean(trustProxy);
  await writeAuthConfig(config, AUTH_CONFIG_PATH);

  console.log('\nAutenticacao configurada com sucesso.');
  console.log(`Arquivo: ${AUTH_CONFIG_PATH}`);
  console.log(`Usuario: ${config.username}`);
  console.log(`Proxy confiavel: ${config.security.trustProxy ? 'sim' : 'nao'}`);
  console.log('Permissoes aplicadas: 600');
  console.log('Reinicie a aplicacao para carregar a nova configuracao.');
}

main().catch((error) => {
  if (!error.cancelled) console.error(`Erro: ${error.message}`);
  process.exitCode = error.cancelled ? 130 : 1;
});
