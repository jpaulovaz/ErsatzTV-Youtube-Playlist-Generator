# Atualização para 3.9.6

A versão 3.9.6 é uma atualização incremental sobre a **v3.9.5**, focada na recuperação e reconciliação da fila de inserção em playlists do YouTube. Não há migração de configuração nem alteração de schema.

## Versionamento

- aplicação: **v3.9.6**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- Download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

## Atualização

Pare o serviço, faça backup da instalação e extraia o pacote incremental sobre a instalação v3.9.5:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.5-to-v3.9.6-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço. O pacote não substitui `config/config.json`, `config/auth.json`, `config/youtube-account.json`, `data/` nem arquivos de mídia.

## Recuperação de filas antigas paradas por quota

Na inicialização, a v3.9.6 procura jobs antigos da fila de playlist que estejam simultaneamente:

- com `status = failed`;
- com erro compatível com quota do YouTube;
- e ainda possuam itens pendentes ou itens que foram marcados como falha exclusivamente pelo mesmo erro de quota.

Esses jobs são recuperados para `queued`, seus itens recuperáveis voltam para `pending` e a fila global inicia **pausada por quota**. Nenhuma inserção é enviada automaticamente apenas por instalar ou reiniciar a aplicação.

Depois da atualização, abra **YouTube → Gerenciador do YouTube → Minhas playlists**. A fila recuperada deve aparecer com os contadores preservados. Quando a quota já tiver sido renovada, clique em **Retomar**.

Antes de qualquer nova inserção, o worker relê a playlist completa com `playlistItems.list`. Se um Video ID pendente já estiver presente, ele é classificado como **já existente** e não é inserido novamente. Isso protege inclusive playlists antigas que já continham parte do mesmo acervo.

## Pausas operacionais

A fila não transforma mais em falha terminal um problema recuperável ocorrido durante a reconstrução do índice ou durante uma inserção. São pausas operacionais:

- quota esgotada;
- conta/autorização que exige reconexão;
- playlist removida ou indisponível;
- timeout/falha temporária de rede ou API.

Os itens pendentes permanecem preservados. Um erro realmente específico e permanente de um vídeo continua falhando somente aquele item, sem encerrar o lote inteiro.

## Conferir com o YouTube

A área **Minhas playlists → Fila de inserção** passa a mostrar **Conferir com o YouTube**. Essa ação:

1. lê a playlist real e completa;
2. compara os Video IDs com os jobs locais da mesma playlist;
3. transforma pendentes já presentes em **já existentes**;
4. atualiza no Acervo local a verificação de presença por playlist;
5. sinaliza históricos que diziam Adicionado/Já existente, mas que não são mais encontrados na playlist.

Os filtros de Playlist do Acervo local passam a respeitar uma conferência autoritativa quando ela existe.

## Contadores com múltiplos jobs

Quando mais de um job da mesma operação permanece retomável, a interface soma os contadores dos jobs `queued/running`. Assim, um histórico dividido em dois jobs não aparece artificialmente como apenas o job mais recente.

## Validação após atualizar

1. Reinicie a aplicação.
2. Abra **YouTube → Gerenciador do YouTube → Minhas playlists**.
3. Se houver fila recuperada por quota, confirme que aparece **Pausada por quota**, com os pendentes preservados.
4. Opcionalmente clique em **Conferir com o YouTube** para reconciliar a playlist antes da retomada.
5. Quando a quota estiver disponível, clique em **Retomar**.
6. Confirme que vídeos já existentes são contabilizados em **já existentes** e somente os realmente ausentes são inseridos.

Não é necessário recriar OAuth, revarrer o acervo, refazer matches confirmados ou editar arquivos de estado manualmente.
