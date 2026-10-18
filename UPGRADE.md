# Atualização para 4.0.3

A versão 4.0.3 parte da **v4.0.2** e corrige o tratamento da expiração/revogação do OAuth do Google no Gerenciador do YouTube.

## Versionamento

- aplicação: **v4.0.3**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

Nenhuma migração de configuração ou estado é necessária. O YouTube Account state continua na versão 1; os novos campos são opcionais e estados antigos são reconhecidos automaticamente.

## O que muda

Antes, qualquer resposta HTTP 401 podia ser interpretada pelo navegador como “Sessão expirada”, inclusive `YOUTUBE_RECONNECT_REQUIRED`. Isso fazia a interface redirecionar para `/login` em loop quando o refresh token do Google expirava ou era revogado.

Na v4.0.3:

- somente `401 + AUTH_REQUIRED` redireciona para `/login`;
- `401 + YOUTUBE_RECONNECT_REQUIRED` mantém a sessão local e mostra **Reconexão necessária** no YouTube Manager;
- o restante do aplicativo continua utilizável;
- o botão da conta passa a oferecer **Reconectar com Google**;
- após um `invalid_grant`, o backend não insiste no mesmo refresh token até uma nova autorização concluir;
- o log de reconexão é limitado para evitar spam;
- uma autorização OAuth concluída com sucesso limpa automaticamente o estado de reconexão.

Se a instalação já estiver em loop por um token expirado, após aplicar o update e reiniciar o serviço basta abrir **Adicionar vídeos → Configurações → Conta do YouTube** e usar **Reconectar com Google**. Não é necessário apagar manualmente `data/youtube-account-state.json`.

## Atualização

Pare o serviço, faça backup normal da instalação e extraia o update por cima da v4.0.2:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.0.2-to-v4.0.3-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço e valide:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, credenciais OAuth, tokens, mídia ou sidecars.
