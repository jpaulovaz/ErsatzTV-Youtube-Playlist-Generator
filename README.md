# ErsatzTV YML Syncer 0.0.3

Gerador de arquivos YML para Remote Streams do ErsatzTV usando playlists do YouTube, com interface web, logs, agendador interno e execucao individual por biblioteca/playlist.

## O que mudou na 0.0.3

- Mantido o botao global `Executar agora` no topo.
- Adicionado o botao `Executar esta biblioteca` em cada playlist/biblioteca.
- A execucao automatica ou manual agora dispara `scan` da biblioteca somente quando criar ou mover arquivos YML naquela playlist.
- Se nada novo for criado, o scan automatico da Library ID e ignorado para evitar chamadas desnecessarias ao ErsatzTV.
- A interface foi ajustada para ficar centralizada e evitar barra de rolagem horizontal.
- O campo de cookies foi esclarecido: ele espera o caminho de um arquivo `cookies.txt` em formato Netscape, nao o conteudo bruto colado no campo.

## O que mudou na 0.0.2

- Cada playlist cria e atualiza seu proprio script `stream-yt.sh` dentro da pasta da playlist.
- Cada YML passa a apontar para o script local da propria playlist.
- O caminho global de `cookies.txt` pode ser configurado pela interface.
- Cada playlist agora tem sua propria `Library ID` e seu proprio `Playout ID`.
- A execucao automatica nao remove mais arquivos YML ausentes.
- A limpeza de YML ausentes virou acao manual por playlist.
- Foram adicionadas acoes manuais por playlist para scan da biblioteca, limpeza de lixo do ErsatzTV e rebuild do playout.

## Requisitos

- Node.js 18 ou superior.
- `yt-dlp` instalado no caminho configurado, por padrao `/usr/local/bin/yt-dlp`.
- ErsatzTV acessivel pela URL configurada, por padrao `http://localhost:8409`.
- Opcionalmente, um arquivo `cookies.txt` exportado do navegador em formato Netscape, se o YouTube exigir cookies no seu ambiente.

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
- `paths.cookiesPath`: caminho global opcional do `cookies.txt` em formato Netscape.
- `paths.streamScriptName`: nome do script criado dentro de cada pasta de playlist.
- `playlists[].libraryId`: ID da biblioteca do ErsatzTV referente aquela playlist.
- `playlists[].playoutId`: ID do playout do ErsatzTV referente aquela playlist.
- `playlists[].cookiesPath`: caminho especifico de cookies para a playlist; vazio usa o global.

## Cookies do YouTube

O campo de cookies nao recebe o texto bruto dos cookies. Ele recebe o caminho completo para um arquivo `cookies.txt` ja salvo no disco, por exemplo:

```text
/home/joaopaulovaz/comerciais/videclipes/youtube/cookies.txt
```

Esse arquivo deve estar no formato Netscape aceito pelo `yt-dlp --cookies`. Se uma playlist tiver `cookiesPath` especifico, ele substitui o caminho global apenas naquela playlist.

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

## Fluxo automatico

A execucao agendada, o botao global `Executar agora` e o botao `Executar esta biblioteca` fazem o mesmo tipo de sincronizacao: consultam a playlist no YouTube e garantem que todos os videos atuais tenham YML criado/atualizado.

O scan automatico da biblioteca do ErsatzTV so e chamado quando a rodada cria ou move algum YML naquela playlist. Se todos os arquivos ja existirem, o app registra nos logs que o scan foi ignorado.

## Limpeza

A execucao agendada e os botoes de execucao nao apagam YML de videos ausentes da playlist. Eles apenas garantem que os videos atuais tenham YML criado/atualizado.

Para remover YML de videos que sairam da playlist, use o botao `Limpar YML ausentes` na linha da playlist. Essa acao consulta a playlist atual no YouTube e remove apenas os YML cujo video nao aparece mais nela.

## Acoes por playlist

Na interface, cada playlist tem botoes para:

- `Executar esta biblioteca`: sincroniza somente aquela playlist/biblioteca.
- `Limpar YML ausentes`: remove arquivos locais que nao pertencem mais a playlist.
- `Scan biblioteca`: chama `POST /api/libraries/{libraryId}/scan` manualmente.
- `Limpar lixo ErsatzTV`: chama `POST /api/libraries/{libraryId}/empty-trash` manualmente.
- `Atualizar playout`: chama `POST /api/playout/{playoutId}/rebuild` manualmente.

## Endpoints internos

- `GET /api/config`
- `PUT /api/config`
- `POST /api/run`
- `GET /api/status`
- `GET /api/logs?limit=250`
- `POST /api/logs/clear`
- `POST /api/playlists/:name/run`
- `POST /api/playlists/:name/cleanup`
- `POST /api/playlists/:name/scan`
- `POST /api/playlists/:name/empty-trash`
- `POST /api/playlists/:name/rebuild-playout`

## Observacoes

- O app impede operacoes locais simultaneas para evitar conflito entre sincronizacao e limpeza manual.
- O script de stream e regravado em cada execucao para refletir mudancas de `yt-dlp`, cookies, user-agent ou formato.
- Se uma playlist nao tiver `Library ID`, o scan automatico dessa playlist sera ignorado e registrado nos logs.
