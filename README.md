# ErsatzTV YML Syncer 0.0.1

Conversao do script Python `sync-playlist.py` para Node.js, com interface web simples, logs e agendador interno.

## O que esta incluido

- Conversao da rotina principal para Node.js.
- Interface web para editar configuracao, playlists, limpeza e agendamento.
- Botao para executar manualmente.
- Logs em tela e em `data/app.log`.
- Agendador por intervalo em minutos.
- Arquitetura separada em servicos para facilitar novas funcoes.

## Requisitos

- Node.js 18 ou superior.
- `yt-dlp` instalado no caminho configurado, por padrao `/usr/local/bin/yt-dlp`.
- ErsatzTV acessivel pela URL configurada, por padrao `http://localhost:8409`.
- O script de stream existente em `streamScriptPath`, por padrao `/home/joaopaulovaz/comerciais/videclipes/youtube/stream-yt.sh`.

## Como iniciar

```bash
cd ersatztv-yml-syncer-0.0.1
npm install
npm start
```

Depois acesse:

```text
http://localhost:3099
```

## Execucao manual sem interface

```bash
npm run sync
```

## Validacao basica de sintaxe

```bash
npm run check
```

## Configuracao

A configuracao fica em:

```text
config/config.json
```

A interface edita esse arquivo. Alteracoes de host e porta da interface exigem reiniciar o processo Node.js.

## Cuidado com limpeza automatica

A opcao `cleanup.removeDisabledPlaylistFolders` replica o comportamento do script Python: pastas dentro de `baseDir` que nao correspondem a playlists ativas podem ser removidas.

Use um `baseDir` exclusivo para este app. Nao aponte para uma pasta generica com outros arquivos importantes.

## Estrutura

```text
src/main.js          # bootstrap da aplicacao
src/server.js        # servidor HTTP e API da interface
src/scheduler.js     # agendador por intervalo
src/syncService.js   # rotina de sincronizacao YML + API ErsatzTV
src/config.js        # carga e persistencia da configuracao
src/logger.js        # logs em memoria e arquivo
src/utils.js         # funcoes auxiliares
public/              # interface web
config/              # configuracao JSON
```

## Endpoints internos

- `GET /api/config`
- `PUT /api/config`
- `POST /api/run`
- `GET /api/status`
- `GET /api/logs?limit=250`
- `POST /api/logs/clear`

## Notas da versao 0.0.1

- O agendador vem desativado por padrao para evitar uma execucao automatica antes de revisar caminhos e limpeza.
- A limpeza interna de YML e ignorada quando `yt-dlp` falha ou retorna zero videos, para proteger os arquivos existentes.
- O app impede execucoes sobrepostas.
