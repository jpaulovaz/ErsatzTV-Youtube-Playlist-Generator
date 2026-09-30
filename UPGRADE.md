# Atualização para 3.4.10

A versão 3.4.10 adiciona metadata temporal aos downloads do YouTube e aos NFOs sem alterar o motor de Scripted Schedule.

## O que muda

- Downloads novos passam a armazenar `publishedAt` quando a API fornece timestamp, `uploadDate` no fallback do yt-dlp, `releaseDate`, `releaseDateSource=youtube` e `year`.
- Genérico/Filmes gravam `year` + `premiered` no NFO quando existe data disponível.
- Clipes musicais (Seriados) gravam `aired` no NFO do episódio.
- Se a descoberta inicial não trouxer a data exata, o aplicativo tenta enriquecê-la antes de escrever o NFO. Uma falha nessa consulta não cancela nem invalida o MP4 concluído.
- A biblioteca recebe temporariamente o botão **Atualizar datas dos NFOs** para o acervo existente.

## Proteção dos NFOs já editados

O backfill temporário não reconstrói os NFOs. Ele lê o arquivo atual e insere somente os campos de data ausentes.

- `music_clips`: acrescenta `aired` somente se ainda não existir.
- `generic`/`movie`: acrescenta `year` + `premiered` somente se o NFO não contiver nenhum desses campos.
- título, plot, artista, gênero, tags, temporada, episódio e quaisquer outras alterações manuais permanecem intocados.
- uma data já existente no NFO é tratada como escolha manual/autoridade local e nunca é substituída pela data do YouTube.

Quando algum NFO for alterado e a biblioteca tiver Library ID, o aplicativo solicita um scan do ErsatzTV ao final.

O botão é deliberadamente temporário e deve ser removido na próxima versão, depois da migração das bibliotecas atuais. Downloads novos já ficam enriquecidos automaticamente.

## Compatibilidade técnica

- aplicação: **v3.4.10**;
- Universal permanece **v1.3.1**;
- `configVersion` permanece **8**;
- schema de Scripted Schedules permanece **1**;
- estado da fila permanece na versão existente; os novos campos são aditivos;
- deduplicação, fila persistente, órfãos, layout dos arquivos, legendas, thumbnails e download/transcode não mudam.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.10-update.zip` sobre a instalação v3.4.9.
4. Inicie novamente o serviço e faça um recarregamento completo do navegador.
5. Em cada biblioteca antiga que quiser enriquecer, use **Atualizar datas dos NFOs** uma única vez.
6. Revise o resumo retornado pela ação. NFOs com datas já existentes serão preservados.

## Gate esperado

- upgrade esperado: **v3.4.9 -> v3.4.10**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
