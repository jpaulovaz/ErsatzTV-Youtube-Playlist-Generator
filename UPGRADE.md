# Atualização para 3.4.11

A versão 3.4.11 ajusta o perfil **Clipes musicais (Seriados)** para que temporada/episódio acompanhem a cronologia de publicação. O motor de Scripted Schedule não muda.

## O que muda

- Em Clipes musicais, cada artista continua em `Season 01`, mas os episódios passam a ser numerados pela data: E01 é o vídeo mais antigo, E02 o seguinte e assim por diante.
- A data usada para a ordem é `aired` do NFO quando ele já existe e é válido; isso preserva correções manuais. Quando não há `aired`, usa-se a metadata de publicação armazenada pelo aplicativo.
- Novos downloads já recebem a numeração cronológica automaticamente.
- Se um vídeo novo precisar entrar antes de episódios existentes, o aplicativo pode renumerar os itens do mesmo artista para manter a sequência correta.
- Ao renumerar arquivos existentes, somente o trecho `SxxExx` do nome é trocado. MP4, NFO, thumbnail e legendas SRT sidecar permanecem associados ao mesmo vídeo.

## Botão temporário de migração

O botão da v3.4.10 passa a se chamar **Atualizar datas e episódios** e continua disponível somente para a janela de homologação.

Para Clipes musicais, ele:

- busca e acrescenta `aired` somente quando a data não existe;
- preserva um `aired` já editado manualmente e usa essa data como autoridade para a ordem;
- atualiza somente `season` e `episode` dentro do NFO;
- não reconstrói título, plot, gênero, tags nem outras edições manuais;
- renomeia MP4/NFO/thumbnail/SRT alterando apenas `SxxExx`;
- solicita um scan do ErsatzTV ao final quando a biblioteca tem Library ID e houve mudança.

Para Genérico/Filmes, o comportamento de datas da v3.4.10 permanece igual.

Recomenda-se usar o botão com a fila sem download ativo e revisar o resumo retornado. O botão fica previsto para remoção na próxima versão, depois desta migração.

## Compatibilidade técnica

- aplicação: **v3.4.11**;
- Universal permanece **v1.3.1**;
- `configVersion` permanece **8**;
- schema de Scripted Schedules permanece **1**;
- estado da fila permanece **4**;
- downloads, transcode, deduplicação, órfãos e estrutura de canais não mudam fora da renumeração do perfil Clipes musicais;
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.11-update.zip` sobre a instalação v3.4.10.
4. Inicie novamente o serviço e faça um recarregamento completo do navegador.
5. Aguarde a fila ficar sem download ativo.
6. Em cada biblioteca antiga de **Clipes musicais (Seriados)**, use **Atualizar datas e episódios** uma vez.
7. Confira o resumo e, se desejar, revise alguns artistas no ErsatzTV após o scan.

## Gate esperado

- upgrade esperado: **v3.4.10 -> v3.4.11**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
