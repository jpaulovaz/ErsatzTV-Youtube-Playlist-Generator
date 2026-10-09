# Atualização para 3.9.4

A versão 3.9.4 é uma atualização incremental sobre a **v3.9.3** focada em tornar visível, no próprio Acervo local, cada etapa da migração entre identidade, playlist do YouTube e destinos gerenciados. Não há migração de configuração nem alteração de schema.

## Versionamento

- aplicação: **v3.9.4**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account state/config: **1**;
- Adoption transaction state: **1**.

## Antes de atualizar

1. Pare o serviço/aplicativo.
2. Faça o backup normal de `config/` e `data/`.
3. Preserve `config/youtube-account.json`, `data/youtube-account-state.json` e os estados do Gerenciador do YouTube.

## Aplicar o pacote update

Extraia o ZIP sobre uma instalação v3.9.3:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.3-to-v3.9.4-update.zip -d /caminho/da/aplicacao
```

O pacote update não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem mídia.

Reinicie o serviço depois da atualização.

## Estados independentes no Acervo local

A partir desta versão, **Confirmado** não é substituído quando o vídeo avança no fluxo. Ele continua significando exclusivamente que a identidade local ↔ YouTube foi validada.

Cada item passa a exibir também:

- **YouTube**: playlist, estado em fila/adicionando, Adicionado, Já estava na playlist, Falha ou Cancelado;
- **Biblioteca**: todas as Bibliotecas, Playlists de Canal ou Fontes de Canal em que o mesmo Video ID já existe como item ativo, indicando se aguarda mídia, já possui mídia ou foi adotado.

A presença em Biblioteca é calculada diretamente do Download State atual. Quando um Video ID exato foi recuperado de filename, NFO, `.info.json` ou metadata embedded, essa presença já pode ser mostrada antes da confirmação; isso é apenas informação e não transforma o ID recuperado em match confirmado.

## Rastreamento de inserções em playlists

Itens enviados pelo Acervo local agora registram o resultado da fila por playlist. O histórico existente da fila também é usado para reconstruir estados de operações anteriores quando possível.

Quando o preflight constata que um vídeo **já estava na playlist**, esse fato também é persistido no item local mesmo que nenhuma inserção precise ser criada.

## Novos filtros

O Acervo local ganha:

- **Biblioteca**: Todos / Já presente / Ainda não presente;
- **Playlist**: Todos / Adicionado / Ainda não adicionado / Erro.

Os filtros funcionam junto com Fonte, Status e pesquisa textual e também são respeitados por **Selecionar todos confirmados**.

## Atualização automática

Enquanto a tela do Acervo local estiver aberta, mudanças das filas de playlist e de adoção atualizam os estados exibidos sem alterar a seleção atual. Assim, um item pode permanecer **Confirmado** e, ao mesmo tempo, passar de **Em fila** para **Adicionado**, depois aparecer como **Item sincronizado** e finalmente **Adotado**.

## Validação

Para validar o pacote localmente:

```bash
npm run verify
```
