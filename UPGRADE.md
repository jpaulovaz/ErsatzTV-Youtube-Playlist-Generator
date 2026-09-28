# Atualização para 3.2.0

A versão 3.2.0 adiciona o módulo independente **Scripted Schedules**. O pipeline existente de Downloads, Bibliotecas e Canais permanece compatível com a v3.1.1.

## Antes de atualizar

Mantenha backup da configuração e dos dados persistentes:

```bash
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## Aplicar o pacote UPDATE

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.2.0-update.zip` por cima da instalação **v3.1.1** e valide:

```bash
npm run check
npm test
```

Depois reinicie o processo normalmente. O pacote UPDATE não contém `config/config.json`, `config/auth.json` nem a pasta `data`.

## Configuração principal

O `configVersion` principal permanece em **8**. O novo módulo possui schema próprio (`schemaVersion: 1`) e cria seus dados somente quando utilizado, abaixo de:

```text
data/scripted-schedules/
```

Nenhuma migração das Bibliotecas, Canais, Smart Collections ou fila de downloads é necessária.

## Primeira utilização de Scripted Schedules

1. Abra **Scripted Schedules**.
2. Em **Pasta de saída dos scripts**, informe um caminho absoluto gravável pelo aplicativo.
3. Crie um projeto e configure Sources, perfis e apenas os módulos necessários.
4. Use **Validar** e depois **Salvar e publicar**.
5. No primeiro uso daquele arquivo, cadastre manualmente o caminho e o `state_key` no Scripted Schedule do Playout no ErsatzTV.

O cadastro inicial continua manual porque a API pública do ErsatzTV Legacy v26.10.0 não expõe CRUD para esse campo do Playout. Depois do vínculo, publicar novamente substitui o mesmo arquivo de forma atômica e a próxima execução do script usa o conteúdo atualizado.

## Segurança da publicação

- cada projeto publica apenas um nome de arquivo `.py` dentro da pasta configurada;
- `../` e caminhos por projeto são rejeitados;
- quando `python3` estiver disponível, o script é validado com `--validate-config` antes de substituir o arquivo atual;
- a versão anterior recebe backup;
- o arquivo final recebe permissão executável;
- salvar/publicar nunca executa Reset Playout automaticamente.

O processo do ErsatzTV precisa ter permissão para executar o script e gravar o arquivo de estado no local configurado.

## Rollback

Para retornar à v3.1.1, reinstale o pacote correspondente. Como o `configVersion` principal não mudou, `config/config.json` continua compatível. Os arquivos em `data/scripted-schedules/` podem permanecer no disco; a v3.1.1 simplesmente não os utiliza.
