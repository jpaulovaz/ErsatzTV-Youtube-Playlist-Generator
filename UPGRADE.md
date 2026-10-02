# Atualização para 3.4.16

A versão 3.4.16 corrige a apresentação do navegador de conteúdo da v3.4.15. O título passa a ficar em um bloco próprio abaixo da thumbnail, fora do botão usado para abrir os detalhes. As imagens de vídeos/episódios permanecem widescreen em 16:9, enquanto os posters do primeiro nível de artistas passam a ser apresentados verticalmente em 2:3. O Universal permanece v1.3.1 e não há mudança no schema principal, na fila de downloads nem no formato dos projetos.

## O que muda

- somente a thumbnail é o botão que abre os detalhes do vídeo; título, artista e metadados ficam em um bloco separado imediatamente abaixo;
- a estrutura evita que o texto seja cortado pela renderização do próprio botão, corrigindo o comportamento observado na v3.4.15;
- thumbnails de vídeos/episódios usam proporção fixa **16:9** também no celular;
- posters do primeiro nível da Biblioteca usam proporção vertical **2:3**, própria de capa de artista/Show;
- a alteração é somente de apresentação: nenhuma thumbnail ou poster é recortado/regravado no disco e o `showPosterPath` existente continua sendo usado;
- o comportamento read-only, pesquisa, paginação, NFO como fonte preferencial, segurança das imagens e painel de detalhes permanecem inalterados.

## Compatibilidade

- aplicação: **v3.4.16**;
- Universal: **v1.3.1**;
- `configVersion`: **8**;
- schema de Scripted Schedules: **1**;
- estado da fila de downloads: **4**.

Configuração, autenticação, dados, downloads, NFOs, thumbnails, posters e projetos existentes não precisam de migração.

## Atualização

1. Pare o aplicativo.
2. Faça backup da instalação atual, como de costume.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.16-update.zip` sobre uma instalação v3.4.15.
4. Inicie o aplicativo novamente.
5. Faça um recarregamento completo do navegador (`Ctrl+F5`) para descartar JavaScript/CSS em cache.

## Verificação rápida

1. Abra **Bibliotecas** e entre em **Conteúdo -> Ver conteúdo**.
2. No primeiro nível, confirme que os posters dos artistas aparecem em formato vertical 2:3.
3. Entre em uma temporada/pasta e confirme que as thumbnails dos episódios permanecem widescreen 16:9.
4. Confirme que o título está sempre visível imediatamente abaixo de cada thumbnail, antes de clicar no vídeo.
5. Clique somente na imagem e confirme que o painel de detalhes continua abrindo normalmente.
6. Teste uma busca no acervo e confirme que os cards preservam o mesmo formato.

- upgrade esperado: **v3.4.15 -> v3.4.16**;
- nenhuma republicação dos Scripted Schedules é necessária;
- nenhum Reset Playout é necessário.
