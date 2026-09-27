# Atualização para 3.0.3

A versão 3.0.3 corrige a integração com a API do ErsatzTV e padroniza as confirmações da interface.

## Antes de atualizar

Mantenha backup da configuração e dos dados persistentes:

```bash
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## Aplicar o pacote update

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.0.3-update.zip` por cima da instalação v3.0.2 e valide:

```bash
npm run check
npm test
```

Depois reinicie o processo normalmente. O pacote update não contém `config/config.json`, `config/auth.json` nem a pasta `data`.

## Mudança de configuração

O schema passa para `configVersion: 6`. Na primeira inicialização, a configuração antiga recebe backup automático antes da normalização.

O campo **Playout ID** foi substituído por **Número do canal** do ErsatzTV. Os valores são identificadores diferentes, portanto a v3.0.3 **não converte automaticamente** um Playout ID antigo em Número do canal. Após atualizar, preencha o Número do canal nas Bibliotecas e playlists de Canais que usarão **Reset Playout**.

O antigo `downloads.rebuildPlayoutOnQueueIdle` é removido. O aplicativo continua podendo executar scan automático quando a fila entra em repouso, mas nunca executa Reset de Playout automaticamente.

## Integração ErsatzTV v26.10.0

- Scan: `POST /api/libraries/{id}/scan`
- Limpar lixo: `POST /api/maintenance/empty_trash`
- Reset Playout: `POST /api/channels/{channelNumber}/playout/reset`
- Autenticação: `X-Etv-Api-Key`

O Reset Playout é manual e protegido por confirmação própria do aplicativo.

## Modais

Confirmações destrutivas e confirmações digitadas deixaram de usar caixas nativas do navegador. O comportamento de segurança permanece, mas agora usa o tema e os controles do aplicativo.

## Rollback

O carregamento da v3.0.3 cria backup da configuração anterior ao migrar para schema v6. Para retornar à v3.0.2, restaure também o backup do `config.json` v5; não reutilize o schema v6 diretamente na versão anterior.
