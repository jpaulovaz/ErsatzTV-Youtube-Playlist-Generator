# ErsatzTV YouTube Playlist Generator

Aplicativo para criar e manter arquivos `.yml` de Remote Streams do ErsatzTV a partir de playlists e videos avulsos do YouTube.

A partir desta versao, a rotina normal pode usar a **YouTube Data API** para listar fontes, buscar metadados, validar duracao, gerar thumbnails e montar os YML sem usar cookies e sem chamar `yt-dlp`. O `yt-dlp` continua sendo usado pelo `stream-yt.sh` quando o ErsatzTV realmente toca o video.

## Recursos principais

- Interface web para configuracao e acompanhamento.
- Uma ou mais fontes por biblioteca: playlists, videos avulsos ou ambos.
- Deduplicacao por ID do YouTube dentro da mesma biblioteca.
- Leitura via YouTube Data API, recomendada para rotina agendada.
- Fallback por `yt-dlp` para compatibilidade.
- Geração de `.yml` com `script`, `is_live`, `duration`, `title`, `plot` e `year` quando disponivel.
- Download de thumbnail local ao lado do `.yml`, com o mesmo nome base.
- Painel de saude por biblioteca: ativos, fora das fontes, suspeitos, sem duracao e thumbnails pendentes.
- Script `stream-yt.sh` criado automaticamente dentro de cada pasta.
- `Library ID` e `Playout ID` por biblioteca.
- Agendador interno por intervalo em minutos.
- Teste ativo de `cookies.txt` usando `yt-dlp`.
- Configuracoes de qualidade, resolucao maxima, codec/container e runtime JS/EJS do `yt-dlp`.
- Limpeza manual de YML ausentes, com remocao de thumbnails sidecar e pastas vazias.
- Scan automatico da biblioteca somente quando houver YML ou thumbnail criado, atualizado ou movido.

## Requisitos

- Node.js 18 ou superior.
- ErsatzTV acessivel pela rede, normalmente em `http://localhost:8409`.
- YouTube Data API Key para o modo recomendado de leitura.
- `yt-dlp` instalado, normalmente em `/usr/local/bin/yt-dlp`, para streaming e teste de cookies.
- Opcional: `cookies.txt` em formato Netscape quando o YouTube exigir login/cookies.
- Recomendado: Deno em `/usr/local/bin/deno` para ajudar o `yt-dlp` a resolver desafios recentes do YouTube.

## Como iniciar

```bash
npm install
npm start
```

Depois acesse:

```text
http://localhost:3099
```

## Validar arquivos do projeto

```bash
npm run check
```

## Executar sem abrir a interface

```bash
npm run sync
```

## Configuracao

A configuracao fica em:

```text
config/config.json
```

A interface edita esse arquivo. Mudancas de host ou porta exigem reiniciar o processo Node.js.

## YouTube API

1. Crie ou use um projeto no Google Cloud.
2. Ative a YouTube Data API v3.
3. Gere uma API Key.
4. Informe a chave na secao `YouTube API` da interface.
5. Clique em `Testar API`.
6. Mantenha o modo de leitura em `YouTube API` para que a rotina agendada nao use cookies.

A API e usada para catalogo e metadados. Ela nao entrega video/audio para streaming. O stream continua sendo feito pelo ErsatzTV chamando o `stream-yt.sh`, que usa `yt-dlp`.

## Fontes do YouTube

Cada biblioteca aceita mais de uma fonte. Exemplos:

```text
https://www.youtube.com/playlist?list=PL...
https://www.youtube.com/watch?v=ID_DO_VIDEO&list=PL...
https://www.youtube.com/watch?v=ID_DO_VIDEO
https://youtu.be/ID_DO_VIDEO
https://www.youtube.com/shorts/ID_DO_VIDEO
```

Links com `list=` sao tratados como playlist. Para usar apenas um video de uma URL com `list=`, remova o parametro `list=`.

## Thumbnails

Quando a YouTube API esta ativa, o app baixa uma imagem `.jpg` ao lado do `.yml` com o mesmo nome base:

```text
Artista - Musica.yml
Artista - Musica.jpg
```

Por padrao, imagens existentes nao sao substituidas. Use `Atualizar thumbnails existentes` ou o botao `Thumbnails` da biblioteca quando quiser forcar a atualizacao.

## Cookies do YouTube

O campo de cookies recebe o caminho de um arquivo `cookies.txt` salvo no servidor. Nao cole o conteudo bruto dos cookies na interface.

Exemplo:

```text
/home/usuario/youtube/cookies.txt
```

Use o botao `Testar cookies` da biblioteca para validar se o YouTube ainda aceita aquele arquivo. O teste executa o `yt-dlp` em modo simulado e nao baixa o video.

## Qualidade do stream

- `Compativel`: prioriza estabilidade. Usa formatos com video e audio juntos quando possivel.
- `Alta qualidade`: tenta combinar video e audio separados para conseguir resolucoes maiores.
- `Personalizado`: libera o seletor manual `-f` do `yt-dlp`.

A resolucao maxima e apenas um limite. Se o YouTube nao oferecer aquela resolucao para o video, o `yt-dlp` usara a melhor opcao disponivel abaixo dela.

## Limpeza

A execucao automatica nao remove YML antigos. Para remover arquivos que nao estao mais nas fontes da biblioteca, use o botao `Limpar YML` na propria biblioteca.

Essa acao tambem remove thumbnails sidecar correspondentes e pastas vazias deixadas apos a exclusao dos YML.

## Acoes por biblioteca

- `Executar`: atualiza apenas aquela biblioteca.
- `Testar cookies`: valida o cookies.txt com uma chamada real ao YouTube via `yt-dlp`.
- `Verificar`: atualiza o painel de saude sem apagar arquivos.
- `Thumbnails`: atualiza thumbnails usando a YouTube API.
- `Limpar YML`: remove arquivos que nao pertencem mais as fontes atuais.
- `Scan`: solicita scan da biblioteca no ErsatzTV.
- `Limpar lixo`: solicita limpeza de lixo da biblioteca no ErsatzTV.
- `Atualizar playout`: solicita rebuild do playout no ErsatzTV.
- `Remover`: remove a biblioteca da configuracao local.
