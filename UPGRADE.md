# Atualização para 3.1.0

A versão 3.1.0 amplia a integração com o ErsatzTV v26.10.0 sem alterar o pipeline de download.

## Antes de atualizar

Mantenha backup da configuração e dos dados persistentes:

```bash
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## Aplicar o pacote update

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.1.0-update.zip` por cima da instalação v3.0.3 e valide:

```bash
npm run check
npm test
```

Depois reinicie o processo normalmente. O pacote update não contém `config/config.json`, `config/auth.json` nem a pasta `data`.

## Mudança de configuração

O schema passa para `configVersion: 7`. O aplicativo preserva `Library ID` e Número do canal já configurados. Ao selecionar um Canal do ErsatzTV na nova lista por nome, também passa a persistir o nome para exibição.

## Canais do ErsatzTV por nome

A interface consulta `GET /api/channels` pelo backend do aplicativo. O usuário escolhe o canal pelo nome; o `channelNumber` continua armazenado apenas como identificador interno para `POST /api/channels/{channelNumber}/playout/reset`.

A API Key nunca é enviada diretamente ao navegador.

## Smart Collections

Quando uma Biblioteca ou playlist de Canal possui `Library ID`, aparece o campo **Smart Collection**.

- **Criar nova**: cria uma coleção com query `library_id:<ID>`.
- **Agregar**: relê a query atual e acrescenta `(library_id:<ID>)` com `OR`, preservando a expressão existente.
- **Substituir**: troca a query atual por `library_id:<ID>`.
- Se a Library ID já estiver presente, **Agregar** não duplica o filtro.

O aplicativo usa as rotas oficiais da v26.10.0:

- `GET /api/collections/smart`
- `POST /api/collections/smart/new`
- `PUT /api/collections/smart/update`

A exclusão de Smart Collections continua sendo feita no ErsatzTV.

## Rollback

A primeira inicialização com schema v7 cria backup automático da configuração anterior. Para retornar à v3.0.3, restaure também o backup do `config.json` v6.
