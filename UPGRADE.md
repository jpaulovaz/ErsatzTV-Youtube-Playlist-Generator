# Atualização para 3.4.14

A versão 3.4.14 adiciona um **navegador somente de leitura para o conteúdo das Bibliotecas** e remove da **Ajuda -> Queries** a observação interna sobre Remote Streams. O Universal permanece v1.3.1 e não há mudança no schema principal, na fila de downloads nem no formato dos projetos.

## O que muda

- cada Biblioteca recebe **Conteúdo -> Ver conteúdo**;
- o navegador abre dentro da própria área de Bibliotecas, sem transformar a sanfona de configuração em uma grade de thumbnails;
- a estrutura exibida vem do caminho real relativo dos arquivos, preservando naturalmente os layouts Genérico, Filmes e Clipes musicais;
- apenas itens concluídos/com mídia local conhecida entram no acervo;
- NFOs existentes são lidos em modo read-only e têm prioridade para título, artista do Show, temporada/episódio e data quando esses campos existem; o estado do downloader continua como fallback;
- a pesquisa localiza por título, artista, `SxxExx`, Video ID e caminho relativo;
- os vídeos são carregados em páginas de 60 itens e as thumbnails usam carregamento preguiçoso;
- clicar em um vídeo abre um painel de detalhes somente de leitura;
- o navegador nunca devolve caminhos absolutos do servidor e a rota de thumbnail só resolve arquivos conhecidos pelo estado e contidos na raiz da Biblioteca;
- a seção **Remote Streams** foi removida da Ajuda -> Queries; os campos e exemplos de Query permanecem.

## Compatibilidade

- aplicação: **v3.4.14**;
- Universal: **v1.3.1**;
- `configVersion`: **8**;
- schema de Scripted Schedules: **1**;
- estado da fila de downloads: **4**.

Configuração, autenticação, dados, downloads, NFOs, thumbnails e projetos existentes não precisam de migração. O navegador de conteúdo não regrava nenhum desses arquivos.

## Atualização

1. Pare o aplicativo.
2. Faça backup da instalação atual, como de costume.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.14-update.zip` sobre uma instalação v3.4.13.
4. Inicie o aplicativo novamente.
5. Faça um recarregamento completo do navegador (`Ctrl+F5`) para descartar JavaScript/CSS em cache.

## Verificação rápida

1. Abra **Bibliotecas** e expanda uma biblioteca que já possua vídeos concluídos.
2. Em **Conteúdo**, clique em **Ver conteúdo**.
3. Confirme que a primeira tela mostra as pastas do acervo e suas quantidades.
4. Entre em uma pasta/temporada e confira cards, thumbnails e metadata.
5. Pesquise um título, artista, `SxxExx` ou Video ID.
6. Clique em um card e confira o painel de detalhes.
7. Abra **Programação -> Ajuda -> Queries** e confirme que a lista de campos continua presente sem o bloco Remote Streams.

- upgrade esperado: **v3.4.13 -> v3.4.14**;
- nenhuma republicação dos Scripted Schedules é necessária;
- nenhum Reset Playout é necessário.
