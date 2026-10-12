# Atualização para 4.0.1

A versão 4.0.1 parte da **v4.0.0** e acrescenta um filtro secundário para distinguir legendas do YouTube **enviadas pelo canal** das **automáticas** em Gerenciar conteúdo.

## Versionamento

- aplicação: **v4.0.1**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

Nenhuma migração de configuração ou estado é necessária.

## O que muda

Em **Bibliotecas/Playlists de Canal → Gerenciar conteúdo → Com legendas**, o filtro **Origem da legenda** continua oferecendo YouTube, LRCLIB, Gemini e arquivo local. Ao escolher **YouTube**, surge um segundo filtro:

- **Todos os tipos**;
- **Enviada pelo canal**;
- **Automática**.

A classificação usa a proveniência que o Subtitle Manager já grava ao aplicar uma faixa do YouTube (`sourceType` manual ou automatic). O filtro permanece oculto quando a origem selecionada não é YouTube.

A tradução em massa no escopo **Resultado filtrado atual** também respeita o tipo selecionado.

## Atualização

Pare o serviço, faça backup normal da instalação e extraia o update por cima da v4.0.0:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.0.0-to-v4.0.1-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço e valide:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, credenciais OAuth, `data/`, mídia ou sidecars.
