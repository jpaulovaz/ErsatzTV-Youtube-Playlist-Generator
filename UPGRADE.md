# Atualização para 3.4.15

A versão 3.4.15 refina o navegador somente de leitura introduzido na v3.4.14. O título de cada vídeo passa a ficar explicitamente visível abaixo da thumbnail, a lista de artistas passa a mostrar o poster já armazenado quando ele existe e o placeholder **Sem imagem** deixa de ficar sobreposto depois que a imagem termina de carregar. O Universal permanece v1.3.1 e não há mudança no schema principal, na fila de downloads nem no formato dos projetos.

## O que muda

- cada card de vídeo mantém o título visível logo abaixo da thumbnail, independentemente do painel de detalhes aberto pelo clique;
- pastas de artista que possuem `showPosterPath` conhecido passam a exibir esse poster na listagem da Biblioteca;
- o poster do artista é servido por uma rota read-only baseada no ID de um item conhecido pelo estado, sem receber caminhos do filesystem vindos do navegador;
- o backend valida que o `showPosterPath` está dentro da raiz da Biblioteca antes de entregar a imagem;
- o placeholder **Sem imagem** é ocultado após o evento de carregamento da thumbnail/poster e reaparece somente quando não há imagem válida ou ocorre erro de carregamento;
- todo o restante do navegador de conteúdo da v3.4.14 permanece: estrutura real de pastas, NFO como fonte preferencial, pesquisa global, páginas de 60 vídeos e painel de detalhes read-only.

## Compatibilidade

- aplicação: **v3.4.15**;
- Universal: **v1.3.1**;
- `configVersion`: **8**;
- schema de Scripted Schedules: **1**;
- estado da fila de downloads: **4**.

Configuração, autenticação, dados, downloads, NFOs, thumbnails, posters e projetos existentes não precisam de migração.

## Atualização

1. Pare o aplicativo.
2. Faça backup da instalação atual, como de costume.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.15-update.zip` sobre uma instalação v3.4.14.
4. Inicie o aplicativo novamente.
5. Faça um recarregamento completo do navegador (`Ctrl+F5`) para descartar JavaScript/CSS em cache.

## Verificação rápida

1. Abra **Bibliotecas** e entre em **Conteúdo -> Ver conteúdo**.
2. Confirme que as pastas de artistas com poster armazenado mostram a imagem ao lado do nome.
3. Entre em uma temporada/pasta com vídeos e confirme que o título aparece abaixo de cada thumbnail.
4. Observe uma thumbnail durante o carregamento e confirme que **Sem imagem** desaparece assim que a imagem aparece.
5. Clique em um card e confirme que o painel de detalhes continua funcionando normalmente.
6. Teste uma busca no acervo para confirmar que os cards mantêm o mesmo comportamento fora da navegação por pastas.

- upgrade esperado: **v3.4.14 -> v3.4.15**;
- nenhuma republicação dos Scripted Schedules é necessária;
- nenhum Reset Playout é necessário.
