# Atualização para 3.0.0

A versão 3.0.0 é compatível com a configuração da v2.8.0. O carregamento migra o schema para `configVersion: 5` e cria um backup automático do `config.json` anterior.

## Antes de atualizar

```bash
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## Aplicar o pacote update

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.0.0-update.zip` por cima da instalação e valide:

```bash
npm run verify
```

Depois reinicie o processo normalmente. O pacote update não contém `config/config.json`, `config/auth.json` nem a pasta `data`.

## Novos campos

- `paths.channelsBaseDir`: pasta base independente para o módulo Canais. Quando ausente, é derivada ao lado de `paths.baseDir` como `youtube-channels`.
- `channels`: lista de canais cadastrados; inicia vazia.
- `channelScheduler`: agendador independente; inicia desativado.

Bibliotecas atuais, autenticação, fila persistente e arquivos locais são preservados.

## Primeiro uso de Canais

1. Abra **Canais**.
2. Clique em **Adicionar canal**.
3. Informe a URL e clique em **Analisar**. A análise não baixa nada.
4. Selecione fontes globais e/ou playlists.
5. Para playlists, defina o perfil e, quando necessário, Library ID/Playout ID, legendas e demais opções.
6. Salve o canal.
7. Use **Atualizar agora** quando quiser iniciar a primeira sincronização.

## Rollback

Antes de qualquer download de Canais, basta restaurar o código da v2.8.0 e o backup do `config.json`. Depois que Canais já tiver baixado mídia, o rollback do código continua possível, mas os arquivos novos devem ser preservados/manuseados manualmente; não há rollback destrutivo automático.
