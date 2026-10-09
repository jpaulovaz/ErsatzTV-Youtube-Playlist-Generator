# Atualização para 3.9.3

A versão 3.9.3 é uma atualização incremental sobre a **v3.9.2** focada em clareza do fluxo de migração e seleção em massa do Acervo local. Não há migração de configuração nem de estado.

## Versionamento

- aplicação: **v3.9.3**;
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

Extraia o ZIP sobre uma instalação v3.9.2:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.2-to-v3.9.3-update.zip -d /caminho/da/aplicacao
```

O pacote update não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem mídia.

Reinicie o serviço depois da atualização.

## Diferença entre as duas ações do Acervo local

**Adicionar à playlist YouTube** insere os Video IDs selecionados na playlist da conta Google escolhida. Essa ação não copia arquivos e não cria diretamente mídia na pasta da Biblioteca interna. Se essa playlist estiver configurada como fonte de uma Biblioteca/Playlist de Canal, a próxima sincronização fará o aplicativo reconhecer os vídeos e eles poderão entrar no fluxo normal de download.

**Adotar na biblioteca** reutiliza o arquivo que já existe no Acervo local. Ela só oferece Bibliotecas/Playlists de Canal/Fonte de Canal nas quais os Video IDs já existam como itens ativos. Depois do preflight, Hardlink/Copy/Move coloca a mídia no caminho gerenciado e evita o redownload.

Para um vídeo que acabou de ser migrado para uma playlist da sua conta, o fluxo típico é:

```text
Adicionar à playlist YouTube
        ↓
Sincronizar a Biblioteca/Playlist de Canal que usa essa playlist
        ↓
Adotar na biblioteca
```

Se você quiser baixar normalmente pelo aplicativo, não precisa adotar: basta sincronizar e deixar o Download Manager processar o item.

## Selecionar todos confirmados

O novo botão **Selecionar todos confirmados** percorre todo o resultado correspondente aos filtros atuais — inclusive itens ainda não carregados pelo botão **Carregar mais** — e seleciona apenas matches com status Confirmado.

A interface exibe a quantidade total selecionada e oferece **Limpar seleção**. Paginar ou receber uma atualização interna do catálogo preserva os IDs selecionados; trocar de fonte ou aplicar um novo filtro limpa a seleção para evitar operações sobre itens ocultos.

Para permitir centenas de itens na adoção sem ultrapassar limites de URL do proxy/navegador, a consulta de destinos para adoção passa a usar POST com corpo JSON.

## Clareza do destino gerenciado

Ao abrir **Adotar na biblioteca**, o seletor identifica o tipo de destino (Biblioteca, Playlist de canal ou Fonte de canal). Depois de escolher um destino, a interface mostra a pasta raiz gerenciada; o preflight continua mostrando o caminho final de cada arquivo antes do commit.

## Validação

Para validar o pacote localmente:

```bash
npm run verify
```
