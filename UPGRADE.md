# Atualização para 3.9.1

A versão 3.9.1 é um hotfix sobre a **v3.9.0**. Ela corrige o retorno do Google OAuth após a autorização da conta. Na v3.9.0, a sessão administrativa usava `SameSite=Strict`; navegadores não enviam esse cookie no retorno cross-site vindo de `accounts.google.com`, então o callback era interceptado pelo servidor com `AUTH_REQUIRED` antes de o código OAuth validar o `state` e trocar o authorization code por tokens.

## Versionamento

- aplicação: **v3.9.1**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account state/config: **1**;
- Adoption transaction state: **1**.

Não existe migração de configuração ou de estado.

## Antes de atualizar

1. Pare o serviço/aplicativo.
2. Faça backup normal de `config/` e `data/`.
3. Não altere nem apague `config/youtube-account.json` ou `data/youtube-account-state.json`.

## Aplicar o pacote update

Extraia o ZIP sobre a instalação v3.9.0:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.0-to-v3.9.1-update.zip -d /caminho/da/aplicacao
```

O pacote update não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem mídia.

Reinicie o serviço depois da atualização. O login administrativo existente continua válido somente enquanto o processo não for reiniciado; após reiniciar, faça login novamente normalmente.

## Correção OAuth

O cookie da sessão passa a usar:

```text
SameSite=Lax
```

Isso permite o envio da sessão no GET de retorno do Google OAuth. A alteração não remove as proteções existentes:

- operações `POST`/`PUT`/`PATCH`/`DELETE` continuam exigindo token CSRF válido;
- a origem da requisição continua validada;
- o callback OAuth continua exigindo o `state` aleatório criado no início da conexão;
- Client Secret, authorization code e tokens permanecem somente no backend.

O callback continua exatamente:

```text
https://yt.johnflix.com.br/api/youtube-manager/oauth/callback
```

## Validação

Depois de atualizar:

1. faça login na interface;
2. abra **YouTube -> Gerenciador do YouTube -> Conta**;
3. confirme Client ID, Client Secret e o callback exibido;
4. clique em **Conectar conta**;
5. autorize no Google;
6. o retorno deve voltar à interface do Gerenciador do YouTube, sem JSON `AUTH_REQUIRED`;
7. confirme que a conta aparece como conectada e teste a conexão.

Para validar o pacote localmente:

```bash
npm run verify
```
