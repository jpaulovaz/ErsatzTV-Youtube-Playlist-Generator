# ErsatzTV YML Syncer 0.0.2

Gerador de arquivos YML para Remote Streams do ErsatzTV usando playlists do YouTube, com interface web, logs e agendador interno.

## O que mudou na 0.0.2

- Cada playlist cria e atualiza seu proprio script `stream-yt.sh` dentro da pasta da playlist.
- Cada YML passa a apontar para o script local da propria playlist.
- O caminho global de `cookies.txt` pode ser configurado pela interface.
- Cada playlist agora tem sua propria `Library ID` e seu proprio `Playout ID`.
- A execucao automatica nao remove mais arquivos YML ausentes.
- A limpeza de YML ausentes virou acao manual por playlist.
- Foram adicionadas acoes manuais por playlist para scan da biblioteca, limpeza de lixo do ErsatzTV e rebuild do playout.
- O fluxo automatico gera/atualiza YML e solicita scan da Library ID configurada, sem espera fixa, sem empty-trash e sem rebuild automatico.

## Requisitos

- Node.js 18 ou superior.
- `yt-dlp` instalado no caminho configurado, por padrao `/usr/local/bin/yt-dlp`.
- ErsatzTV acessivel pela URL configurada, por padrao `http://localhost:8409`.
- Opcionalmente, um arquivo `cookies.txt` exportado do navegador, se o YouTube exigir cookies no seu ambiente.

## Como iniciar

```bash
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

## Configuracao principal

A configuracao fica em:

```text
config/config.json
```

A interface edita esse arquivo. Alteracoes de host e porta da interface exigem reiniciar o processo Node.js.

### Campos importantes

- `paths.baseDir`: pasta onde cada playlist/biblioteca tera sua subpasta.
- `paths.ytDlpPath`: caminho do binario `yt-dlp`.
- `paths.cookiesPath`: caminho global opcional do `cookies.txt`.
- `paths.streamScriptName`: nome do script criado dentro de cada pasta de playlist.
- `playlists[].libraryId`: ID da biblioteca do ErsatzTV referente aquela playlist.
- `playlists[].playoutId`: ID do playout do ErsatzTV referente aquela playlist.
- `playlists[].cookiesPath`: cookies especifico da playlist; vazio usa o global.

## Estrutura gerada

Para uma playlist chamada `Mix_Principal`, o app cria uma estrutura semelhante a:

```text
baseDir/
  Mix_Principal/
    stream-yt.sh
    Artista A/
      Artista A - Musica 1.yml
    Artista B/
      Artista B - Musica 2.yml
```

Cada YML aponta para o script dentro da propria pasta da playlist:

```yml
script: "/caminho/base/Mix_Principal/stream-yt.sh https://www.youtube.com/watch?v=VIDEO_ID"
is_live: false
duration: "00:03:40"
```

## Limpeza

A execucao agendada e o botao `Executar agora` nao apagam YML automaticamente. Eles apenas garantem que os videos atuais da playlist tenham YML criado/atualizado.

Para remover YML de videos que sairam da playlist, use o botao `Limpar YML ausentes` na linha da playlist. Essa acao consulta a playlist atual no YouTube e remove apenas os YML cujo video nao aparece mais nela.

## Acoes por playlist

Na interface, cada playlist tem botoes para:

- `Limpar YML ausentes`: remove arquivos locais que nao pertencem mais a playlist.
- `Scan biblioteca`: chama `POST /api/libraries/{libraryId}/scan`.
- `Limpar lixo ErsatzTV`: chama `POST /api/libraries/{libraryId}/empty-trash`.
- `Atualizar playout`: chama `POST /api/playout/{playoutId}/rebuild`.

## Endpoints internos

- `GET /api/config`
- `PUT /api/config`
- `POST /api/run`
- `GET /api/status`
- `GET /api/logs?limit=250`
- `POST /api/logs/clear`
- `POST /api/playlists/:name/cleanup`
- `POST /api/playlists/:name/scan`
- `POST /api/playlists/:name/empty-trash`
- `POST /api/playlists/:name/rebuild-playout`

## Observacoes

- O app impede operacoes locais simultaneas para evitar conflito entre sincronizacao e limpeza manual.
- O script de stream e regravado em cada execucao para refletir mudancas de `yt-dlp`, cookies, user-agent ou formato.
- Se uma playlist nao tiver `Library ID`, o scan automatico dessa playlist sera ignorado e registrado nos logs.
