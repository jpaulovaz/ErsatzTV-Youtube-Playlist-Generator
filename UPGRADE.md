# Atualização para 3.8.0

A versão 3.8.0 atualiza diretamente a **v3.7.1** e acrescenta a primeira fase do **Gerenciador do YouTube**. Não há migração do `config.json`, da fila de downloads, do Subtitle Manager, da tradução ou dos Scripted Schedules.

## Versionamento

- aplicação: **v3.8.0**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1 (novo)**;
- YouTube Account state/config: **1 (novo)**.

## Antes de atualizar

1. Pare o serviço/aplicativo.
2. Faça backup de `config/` e `data/`.
3. Preserve normalmente suas bibliotecas e sidecars de mídia.
4. Não crie manualmente `youtube-manager-state.json` nem `youtube-account-state.json`; eles serão criados sob demanda.

## Aplicar o pacote update

Extraia o ZIP sobre a instalação v3.7.1:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.8.0-update.zip -d /caminho/da/aplicacao
```

O pacote de atualização não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem arquivos de mídia.

## Gerenciador do YouTube

Após iniciar a v3.8.0, uma nova área **YouTube -> Gerenciador do YouTube** aparece na navegação. Ela possui Pesquisa, Acervo local, Minhas playlists e Conta.

A pesquisa pública usa a mesma YouTube Data API Key já configurada para o restante do aplicativo. Não é necessário conectar uma conta Google para pesquisar.

### OAuth da conta

Para listar, criar e alterar playlists próprias, crie/obtenha no Google Cloud um OAuth Client do tipo **Web application** e cadastre exatamente:

```text
Authorized redirect URI:
https://yt.johnflix.com.br/api/youtube-manager/oauth/callback
```

Na aba **Conta**, informe Client ID e Client Secret. A URL pública padrão já é:

```text
https://yt.johnflix.com.br/
```

O aplicativo solicita o escopo `https://www.googleapis.com/auth/youtube.force-ssl` e pede acesso offline para obter refresh token. A sessão administrativa do aplicativo deve continuar válida durante ida/volta ao Google, pois o callback também é protegido pela autenticação local.

Alternativamente, as credenciais podem vir do ambiente:

```text
YOUTUBE_OAUTH_CLIENT_ID
YOUTUBE_OAUTH_CLIENT_SECRET
YOUTUBE_PUBLIC_BASE_URL
```

O arquivo real `config/youtube-account.json` e os tokens de `data/youtube-account-state.json` ficam fora dos pacotes de distribuição. Ambos são gravados com permissão restrita quando criados pelo aplicativo.

> Se o projeto OAuth externo estiver em modo Testing, o Google pode limitar a duração das autorizações de usuários de teste. Para uso contínuo, configure o projeto/consentimento de acordo com as regras atuais da sua conta Google Cloud.

## Acervo local: segurança

A v3.8.0 trata as raízes cadastradas como **somente leitura**. O scanner:

- aceita somente diretórios explícitos e rejeita raízes amplas/perigosas;
- não segue symlinks;
- não renomeia, move, copia ou exclui mídia;
- usa `ffprobe` e sidecars existentes somente para leitura;
- tenta recuperar IDs confiáveis de `[videoId]`, URL/metadados, `info.json` e NFO;
- exige confirmação antes de usar matches em operações em massa.

A futura adoção sem redownload permanece fora desta versão.

## Playlists e quota

A fila de playlist é persistente. Antes de inserir, o aplicativo reconsulta a playlist e ignora Video IDs já presentes. É possível pausar, retomar e cancelar os pendentes; itens já inseridos no YouTube não são removidos pelo cancelamento.

O painel de quota é uma estimativa local. O contador de pesquisas segue o dia do Pacífico e o aplicativo não presume conhecer o saldo exato do projeto caso outros clientes também usem as mesmas credenciais.

## Validação após atualizar

Execute:

```bash
npm run verify
```

Depois:

1. abra **YouTube -> Gerenciador do YouTube**;
2. teste uma pesquisa pública;
3. em **Conta**, confira se o callback exibido é exatamente `https://yt.johnflix.com.br/api/youtube-manager/oauth/callback`;
4. configure OAuth e use **Conectar com Google**;
5. valide a conta e carregue **Minhas playlists**;
6. antes de uma migração grande, cadastre uma pasta pequena de teste em **Acervo local** e confira os matches sugeridos.

## Rollback

Para rollback do aplicativo, restaure os arquivos da v3.7.1 preservando `config/`, `data/` e mídia. A v3.7.1 simplesmente ignora os novos arquivos `youtube-account.json`, `youtube-manager-state.json` e `youtube-account-state.json`; se quiser removê-los, faça isso somente depois de desconectar/revogar a conta e confirmar que não precisa do catálogo/fila do Gerenciador do YouTube.
