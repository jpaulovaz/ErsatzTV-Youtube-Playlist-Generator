# Atualização para 3.5.0

A versão 3.5.0 introduz políticas explícitas de arquivos órfãos, quarentena recuperável e controle manual do acervo em **Bibliotecas** e **Playlists de Canais**. Também remove a ação temporária **Atualizar datas e episódios**, já desnecessária no fluxo normal.

## O que muda

- cada Biblioteca/Playlist de Canal passa a ter `Arquivos órfãos`: **Excluir automaticamente**, **Marcar como órfão** ou **Mover para quarentena recuperável**;
- no modo Quarentena, a retenção pode ser **Nunca**, 30, 90 ou 180 dias;
- `Ver conteúdo` passa a gerenciar **Conteúdo**, **Órfãos**, **Quarentena** e **Ignorados**;
- itens ativos podem usar **Excluir e ignorar**; itens ignorados podem ser **Reativados**;
- órfãos em quarentena podem ser **Restaurados e mantidos** fora da fonte ou excluídos definitivamente;
- descobertas parciais nunca podem inferir ausência nem executar ações destrutivas;
- Playlists dentro de Canais recebem a mesma política e o mesmo gerenciador de conteúdo;
- fontes globais de Canal (Todos os uploads, Vídeos, Shorts e Transmissões) permanecem com o comportamento anterior nesta versão;
- a ação temporária **Atualizar datas e episódios** é removida da interface, API e código de migração. O pipeline normal de datas e sequenciamento continua ativo.

## Migração automática

- aplicação: **v3.5.0**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- schema de Scripted Schedules: **1**;
- estado persistente de downloads: **5**.

Ao carregar dados anteriores:

- `configVersion 8 -> 9`: Bibliotecas e Playlists de Canal existentes recebem `orphanPolicy="mark"` e `quarantineRetentionDays=null`;
- `state 4 -> 5`: itens existentes recebem `userDisposition="managed"` e um `storageState` compatível com o estado atual;
- `suppressed` continua com sua semântica de fila e **não** vira item Ignorado;
- órfãos já existentes continuam onde estão; o upgrade não move nem apaga mídia retroativamente;
- a quarentena começa vazia.

Novas Bibliotecas/Playlists criadas depois do upgrade exigem escolha explícita da política de órfãos.

## Antes de atualizar

Pare o aplicativo e faça backup de configuração e estado. Como esta versão pode mover/excluir mídia depois de uma descoberta ou ação explícita, também é recomendável snapshot/backup das raízes de mídia antes da primeira execução.

```bash
cd /caminho/da/aplicacao
pm2 stop ersatztv-youtube-downloader

cp config/config.json \
  "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"

[ ! -f config/auth.json ] || \
  cp config/auth.json \
  "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"

cp -a data \
  "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## Aplicar o update

Extraia `ErsatzTV-YouTube-Downloader-v3.5.0-update.zip` sobre uma instalação v3.4.17:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.5.0-update.zip -d .
npm run verify
pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
```

O pacote `update` não contém `config/config.json`, `config/auth.json` nem o conteúdo operacional de `data/`.

Depois do primeiro acesso, faça `Ctrl+F5`. Destinos antigos aparecerão em **Marcar como órfão**. Novos destinos pedirão a política antes de salvar.

## Verificação rápida

1. Abra uma Biblioteca existente e confirme `Arquivos órfãos = Marcar como órfão`.
2. Crie/edite um destino de teste e confirme os três modos e a retenção condicional da quarentena.
3. Abra **Ver conteúdo** e confirme os filtros de estados especiais quando houver itens correspondentes.
4. Confirme que **Atualizar datas e episódios** não existe mais.
5. Rode `npm run verify` e confira que a suíte termina sem falhas.

## Rollback

Se nenhum arquivo tiver sido movido para quarentena nem excluído após o upgrade, o rollback é o fluxo usual: restaurar o código anterior e os backups de configuração/estado.

Depois que a v3.5.0 mover mídia para quarentena, **voltar somente o código não é suficiente**. A versão antiga não entende `state 5` nem a estrutura de quarentena; para rollback consistente, restaure também o backup do estado/configuração e, se necessário, o snapshot das mídias ou restaure os itens pela v3.5.0 antes de voltar.
