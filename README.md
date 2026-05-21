# ErsatzTV YouTube Playlist Generator

Aplicativo para criar e manter arquivos `.yml` de Remote Streams do ErsatzTV usando playlists e videos do YouTube.

A ideia principal e simples: cada biblioteca do aplicativo cria uma pasta, gera os arquivos `.yml`, cria o `stream-yt.sh` dentro da propria pasta e avisa o ErsatzTV quando novos arquivos forem criados ou atualizados.

## Recursos principais

- Interface web para configuracao e acompanhamento.
- Uma ou mais fontes do YouTube por biblioteca.
- Suporte a playlists e links diretos de videos.
- Deduplicacao por ID do YouTube dentro da mesma biblioteca.
- Script `stream-yt.sh` criado automaticamente dentro de cada pasta.
- `Library ID` e `Playout ID` por biblioteca.
- Agendador interno por intervalo em minutos.
- Teste ativo de `cookies.txt` usando o proprio `yt-dlp`.
- Configuracoes de qualidade, resolucao maxima, codec/container e runtime JS/EJS do `yt-dlp`.
- Limpeza manual de YML ausentes, com remocao de pastas vazias.
- Scan automatico da biblioteca somente quando houver YML criado, atualizado ou movido.

## Requisitos

- Node.js 18 ou superior.
- `yt-dlp` instalado, normalmente em `/usr/local/bin/yt-dlp`.
- ErsatzTV acessivel pela rede, normalmente em `http://localhost:8409`.
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

## Como usar

1. Abra a interface web.
2. Configure a pasta base dos YML.
3. Configure o caminho do `yt-dlp`.
4. Configure o `cookies.txt` global, se necessario.
5. Crie uma biblioteca.
6. Informe o nome da pasta, Library ID e Playout ID.
7. Adicione uma ou mais fontes do YouTube: playlists, videos avulsos ou ambos.
8. Salve.
9. Use `Executar` na biblioteca ou `Executar agora` no topo.

## Fontes do YouTube

Cada biblioteca aceita mais de uma fonte. Exemplos:

```text
https://www.youtube.com/playlist?list=PL...
https://www.youtube.com/watch?v=ID_DO_VIDEO&list=PL...
https://www.youtube.com/watch?v=ID_DO_VIDEO
https://youtu.be/ID_DO_VIDEO
https://www.youtube.com/shorts/ID_DO_VIDEO
```

Links de playlist sao lidos como lista. Links diretos de video sao tratados como item unico. Se a URL de video tiver o parametro list=, ela sera tratada como playlist; para usar apenas aquele video, remova o trecho list= da URL. Se o mesmo video aparecer em mais de uma fonte da mesma biblioteca, apenas um YML sera criado.

## Cookies do YouTube

O campo de cookies recebe o caminho de um arquivo `cookies.txt` salvo no servidor. Nao cole o conteudo bruto dos cookies na interface.

Exemplo:

```text
/home/usuario/youtube/cookies.txt
```

Use o botao `Testar cookies` da biblioteca para validar se o YouTube ainda aceita aquele arquivo. O teste executa o `yt-dlp` em modo simulado e nao baixa o video.

Importante: o teste roda com o usuario que executa o app Node.js. Se o ErsatzTV roda com outro usuario, esse outro usuario tambem precisa conseguir ler o mesmo `cookies.txt`.

## Runtime JS/EJS do yt-dlp

Se aparecerem erros como estes nos logs:

```text
Signature solving failed
n challenge solving failed
Only images are available for download
Requested format is not available
```

Use esta configuracao:

```text
Runtime JS: Deno
Caminho do runtime: /usr/local/bin/deno
Componentes EJS: ejs:github
```

Essa configuracao sera usada tanto para ler as fontes quanto para gerar o script de stream de cada biblioteca.

## Qualidade do stream

- `Compativel`: prioriza estabilidade. Usa formatos com video e audio juntos quando possivel.
- `Alta qualidade`: tenta combinar video e audio separados para conseguir resolucoes maiores.
- `Personalizado`: libera o seletor manual `-f` do `yt-dlp`.

A resolucao maxima e apenas um limite. Se o YouTube nao oferecer aquela resolucao para o video, o `yt-dlp` usara a melhor opcao disponivel abaixo dela.

O perfil `Preferir MP4/H.264 + AAC` tenta evitar VP9, AV1, Opus e WebM quando houver alternativa mais compativel.

## Limpeza

A execucao automatica nao remove YML antigos. Para remover arquivos que nao estao mais nas fontes da biblioteca, use o botao `Limpar YML` na propria biblioteca.

Essa acao tambem remove pastas vazias deixadas apos a exclusao dos YML.

## Acoes por biblioteca

- `Executar`: atualiza apenas aquela biblioteca.
- `Testar cookies`: valida o cookies.txt com uma chamada real ao YouTube.
- `Limpar YML`: remove arquivos que nao pertencem mais as fontes atuais.
- `Scan`: solicita scan da biblioteca no ErsatzTV.
- `Limpar lixo`: solicita limpeza de lixo da biblioteca no ErsatzTV.
- `Atualizar playout`: solicita rebuild do playout no ErsatzTV.
- `Remover`: remove a biblioteca da configuracao local.
