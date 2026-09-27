# Atualização para 3.1.1

A versão 3.1.1 refina a integração com Smart Collections e adiciona validação automática da conexão com o ErsatzTV, sem alterar o pipeline de download.

## Antes de atualizar

Mantenha backup da configuração e dos dados persistentes:

```bash
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## Aplicar o pacote update

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.1.1-update.zip` por cima da instalação **v3.1.0** e valide:

```bash
npm run check
npm test
```

Depois reinicie o processo normalmente. O pacote update não contém `config/config.json`, `config/auth.json` nem a pasta `data`.

## Mudança de configuração

O schema passa para `configVersion: 8` e registra a última Smart Collection usada por `Library ID`. A configuração existente é normalizada com backup automático; `Library ID`, Canal do ErsatzTV e demais dados da v3.1.0 são preservados.

## Smart Collections

Quando uma Biblioteca ou playlist de Canal possui `Library ID`, aparece o campo **Smart Collection**.

- **Criar nova**: cria uma coleção com query `library_id:<ID>`.
- **Agregar**: relê a query atual e acrescenta `(library_id:<ID>)` com `OR`, preservando a expressão existente.
- **Substituir**: troca a query atual por `library_id:<ID>`.
- Se a Library ID já estiver presente, **Agregar** não duplica o filtro.
- A última Smart Collection utilizada com sucesso fica armazenada por `Library ID` e aparece ao lado do seletor.

A exclusão de Smart Collections continua sendo feita no ErsatzTV.

## Validação da API Key do ErsatzTV

Em **Configurações → ErsatzTV**, quando URL e API Key estão preenchidas, o aplicativo consulta `GET /api/version` pelo backend.

- conexão válida: mostra a versão do ErsatzTV;
- 401/403: mostra **API Key inválida**;
- falha de rede/timeout: mostra **ErsatzTV indisponível**.

A chave não é devolvida pela rota de validação.

## Rollback

A primeira inicialização com schema v8 cria backup automático da configuração anterior. Para retornar à v3.1.0, restaure também o backup do `config.json` v7.
