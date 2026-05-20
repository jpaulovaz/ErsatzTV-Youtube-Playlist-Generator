# ErsatzTV YML Syncer 0.0.9

Gerador de arquivos YML para Remote Streams do ErsatzTV usando playlists do YouTube, com interface web, logs, agendador interno e execucao individual por biblioteca/playlist.

## O que mudou na 0.0.9

- Adicionado o campo `Perfil de codec/container`:
  - `auto`: comportamento atual do yt-dlp.
  - `mp4_h264_aac`: tenta preferir MP4/H.264 para video e AAC/M4A para audio.
- Nao foi criada opcao para MP3 por padrao: para YouTube, MP3 normalmente exigiria transcodificacao de audio, o que aumentaria custo e latencia. Para o ErsatzTV, AAC/M4A e a alternativa mais compativel e eficiente.
- O seletor `-f` gerado automaticamente agora considera modo de qualidade, resolucao maxima e perfil de codec.
- Mudancas no perfil de codec alteram a assinatura do script e fazem os YML serem reavaliados na proxima execucao.

## O que mudou na 0.0.8

- Adicionadas opcoes avancadas para resolver desafios JavaScript do YouTube no `yt-dlp`:
  - `Runtime JS do yt-dlp`: `disabled`, `deno`, `node` ou `custom`.
  - `Caminho do runtime JS`: por padrao `/usr/local/bin/deno`.
  - `Componentes EJS remotos`: `none`, `ejs:github` ou `ejs:npm`.
- A configuracao inicial agora usa `Deno` + `/usr/local/bin/deno` + `ejs:github`, combinacao que corrigiu erros como `Signature solving failed`, `n challenge solving failed` e `Only images are available` no ambiente de teste.
- As opcoes de runtime JS/EJS entram tanto na leitura da playlist quanto no `stream-yt.sh` gerado dentro de cada biblioteca.
- Mudancas nessas opcoes alteram a assinatura do script e fazem os YML serem reavaliados na proxima execucao.

## O que mudou na 0.0.7

- O campo `plot` do YML agora recebe exatamente o mesmo texto usado em `title`. Na pratica, a Description do ErsatzTV passa a ficar igual ao titulo do item.
- A limpeza manual agora remove tambem as pastas vazias deixadas depois da exclusao dos YML ausentes.
- Corrigida a rotina de remocao de pastas vazias: ela agora percorre as subpastas da playlist e preserva apenas a pasta raiz da biblioteca.

## O que mudou na 0.0.6

- Os YML gerados agora incluem metadados basicos reconhecidos pelo ErsatzTV:
  - `title`: titulo limpo do video do YouTube.
  - `plot`: o mesmo texto usado em `title`, para que a Description do ErsatzTV fique igual ao titulo do item.
- Como os YML passam a ter novo conteudo, a proxima execucao atualizara os arquivos existentes e disparara scan da biblioteca quando houver mudanca.
- O campo `subtitle` nao foi incluido porque ele nao e um campo confirmado para Remote Stream Definition no YAML do ErsatzTV Legacy.

## O que mudou na 0.0.5

- Adicionado `Modo de qualidade` para o script de stream:
  - `Compativel`: usa apenas formatos com video e audio juntos. E mais estavel, mas pode cair em 360p quando o YouTube nao oferece formato unico em 720p+.
  - `Alta qualidade`: tenta combinar `bestvideo + bestaudio`, respeitando a resolucao maxima configurada. Pode entregar 720p/1080p, mas depende mais de ffmpeg/yt-dlp e deve ser testado no ErsatzTV.
  - `Personalizado`: permite informar manualmente o seletor `-f` do yt-dlp.
- Adicionada configuracao de `Resolucao maxima`, com suporte a 360p, 480p, 720p, 1080p, 1440p e 2160p pela interface.
- Adicionadas opcoes para `-S` do yt-dlp, `--merge-output-format` e formato de merge.
- A assinatura do script agora tambem considera modo de qualidade, resolucao, ordenacao e merge. Mudancas nesses campos regravam os YML e disparam scan da biblioteca quando houver alteracao.

## O que mudou na 0.0.4

- O script `stream-yt.sh` de cada playlist agora e comparado antes de ser regravado.
- Cada YML passa a receber a assinatura do script em um comentario `stream_script_hash`.
- Se voce alterar pela interface o caminho do `yt-dlp`, cookies, User-Agent, formato, runtime JS/EJS ou `--hls-use-mpegts`, a proxima execucao atualiza o script e regrava os YML daquela playlist.
- O scan automatico da biblioteca agora e chamado quando houver YML criado, movido ou atualizado. Isso cobre mudancas de configuracao do script.
- Foi adicionado um segundo botao `Salvar configuracao` ao final da area de playlists para evitar confusao quando a pagina estiver rolada para baixo.

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
- Opcionalmente, mas recomendado para YouTube atual: Deno instalado em `/usr/local/bin/deno` para o `yt-dlp` resolver desafios JavaScript/EJS.

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
- `stream.qualityMode`: `compatible`, `high` ou `custom`.
- `stream.maxHeight`: resolucao maxima desejada, por exemplo `720` ou `1080`.
- `stream.codecProfile`: `auto` ou `mp4_h264_aac`. Use `mp4_h264_aac` para tentar evitar VP9/AV1/Opus/WebM e priorizar H.264 + AAC/M4A.
- `stream.format`: seletor `-f` final usado pelo yt-dlp. Nos modos `compatible` e `high`, ele e recalculado automaticamente a partir da resolucao maxima e do perfil de codec.
- `stream.useFormatSort` e `stream.formatSort`: habilitam e configuram a ordenacao `-S`, por exemplo `res:720,fps`.
- `stream.useMergeOutputFormat` e `stream.mergeOutputFormat`: habilitam e configuram `--merge-output-format`, por exemplo `mkv`.
- `stream.jsRuntimeMode`: runtime JavaScript usado pelo `yt-dlp`; valores: `disabled`, `deno`, `node` ou `custom`.
- `stream.jsRuntimePath`: caminho do runtime JS, por exemplo `/usr/local/bin/deno`.
- `stream.jsRuntimeCustomName`: nome usado quando `stream.jsRuntimeMode` for `custom`, por exemplo `bun`, `qjs` ou `quickjs`.
- `stream.ejsComponents`: componentes EJS remotos para o `yt-dlp`; valores: `none`, `ejs:github` ou `ejs:npm`.
- `playlists[].libraryId`: ID da biblioteca do ErsatzTV referente aquela playlist.
- `playlists[].playoutId`: ID do playout do ErsatzTV referente aquela playlist.
- `playlists[].cookiesPath`: caminho especifico de cookies para a playlist; vazio usa o global.

## Cookies do YouTube

O campo de cookies nao recebe o texto bruto dos cookies. Ele recebe o caminho completo para um arquivo `cookies.txt` ja salvo no disco, por exemplo:

```text
/home/joaopaulovaz/comerciais/videclipes/youtube/cookies.txt
```

Esse arquivo deve estar no formato Netscape aceito pelo `yt-dlp --cookies`. Se uma playlist tiver `cookiesPath` especifico, ele substitui o caminho global apenas naquela playlist.

## Runtime JS/EJS do yt-dlp

Quando o YouTube muda seus desafios internos, o `yt-dlp` pode registrar erros como:

```text
Signature solving failed
n challenge solving failed
Only images are available for download
Requested format is not available
```

Para esse caso, use na interface:

```text
Runtime JS do yt-dlp: Deno
Caminho do runtime JS: /usr/local/bin/deno
Componentes EJS remotos: ejs:github
```

Com essa configuracao, o script gerado em cada playlist passa a incluir:

```bash
--js-runtimes "deno:/usr/local/bin/deno" \
--remote-components "ejs:github" \
```

Esses parametros tambem sao usados quando o app chama `yt-dlp --dump-json --flat-playlist` para ler a playlist. Se quiser voltar ao comportamento antigo, selecione `Desativado` e `Nenhum`.

## Qualidade do stream

A resolucao real depende dos formatos que o YouTube oferece para cada video.

O campo `Perfil de codec/container` controla se o app deve deixar o yt-dlp escolher automaticamente ou se deve tentar priorizar formatos MP4/H.264 + AAC/M4A. Essa segunda opcao tende a ser mais previsivel para o ErsatzTV e evita fontes VP9/AV1/Opus/WebM quando houver alternativa no YouTube.

MP3 nao foi incluido como perfil padrao porque o YouTube normalmente nao entrega MP3 nativo. Converter para MP3 exigiria pos-processamento/transcodificacao pelo ffmpeg antes de entregar ao ErsatzTV, o que pioraria latencia e performance. Para streaming linear, AAC/M4A e a escolha mais eficiente.

O modo `Compativel` usa um seletor como:

```text
best[height<=720][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]
```

Ele pede um formato ja muxado, com video e audio no mesmo arquivo. E o modo mais seguro para pipe/stdout, mas alguns videos podem ficar em 360p. Com perfil MP4/H.264 + AAC/M4A, o seletor tenta primeiro formatos MP4 com H.264/AAC e cai para outros formatos se necessario.

O modo `Alta qualidade` usa um seletor como:

```text
bestvideo[height<=720][vcodec!=none]+bestaudio[acodec!=none]/best[height<=720][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]
```

Nesse modo, o script tambem pode usar `-S res:720,fps` e `--merge-output-format mkv`. A vantagem e tentar obter 720p/1080p quando o YouTube disponibiliza video e audio separados. A desvantagem e depender mais de ffmpeg e consumir mais CPU/rede. Com perfil MP4/H.264 + AAC/M4A, o seletor tenta combinar video H.264/MP4 com audio AAC/M4A antes de cair para formatos mais genericos.

Para testar um video fora do ErsatzTV, use o script criado dentro da pasta da playlist:

```bash
URL="https://www.youtube.com/watch?v=ID_DO_VIDEO"
timeout 60s /caminho/da/playlist/stream-yt.sh "$URL" > /tmp/etv-yt-test.mkv
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate -of json /tmp/etv-yt-test.mkv
```

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

Cada YML aponta para o script dentro da propria pasta da playlist e inclui uma assinatura do script para detectar mudancas futuras:

```yml
# generated_by: ErsatzTV Youtube Playlist Generator
# stream_script_hash: 0123456789abcdef
script: "/caminho/base/Mix_Principal/stream-yt.sh https://www.youtube.com/watch?v=VIDEO_ID"
is_live: false
duration: "00:03:40"
title: "Artista A - Musica 1"
plot: "Artista A - Musica 1"
```

Os campos `title` e `plot` sao usados pelo ErsatzTV como metadados do Remote Stream. Eles podem aparecer no XMLTV/EPG e em Graphics Elements, por exemplo em variaveis como `{{ Epg[0].Title }}` e descricao/plot quando o template do ErsatzTV expuser esse dado.

## Fluxo automatico

A execucao agendada, o botao global `Executar agora` e o botao `Executar esta biblioteca` fazem o mesmo tipo de sincronizacao: consultam a playlist no YouTube e garantem que todos os videos atuais tenham YML criado/atualizado.

O scan automatico da biblioteca do ErsatzTV e chamado quando a rodada cria, move ou atualiza algum YML naquela playlist. Se todos os arquivos ja existirem com o mesmo conteudo, o app registra nos logs que o scan foi ignorado.

## Limpeza

A execucao agendada e os botoes de execucao nao apagam YML de videos ausentes da playlist. Eles apenas garantem que os videos atuais tenham YML criado/atualizado.

Para remover YML de videos que sairam da playlist, use o botao `Limpar YML ausentes` na linha da playlist. Essa acao consulta a playlist atual no YouTube, remove apenas os YML cujo video nao aparece mais nela e, em seguida, remove as pastas vazias que sobrarem dentro da pasta da playlist.

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
- O script de stream e verificado em cada execucao e so e regravado quando o conteudo muda. Quando muda, os YML recebem uma nova assinatura e sao atualizados na rodada seguinte.
- Se uma playlist nao tiver `Library ID`, o scan automatico dessa playlist sera ignorado e registrado nos logs.
