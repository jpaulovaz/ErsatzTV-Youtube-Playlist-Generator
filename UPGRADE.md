# Atualização para a versão 2.4.0

Esta atualização parte da versão 2.3.1 e adiciona legendas SRT por biblioteca. O pacote `update` não contém `config/config.json`, `config/auth.json` nem `data/`, portanto preserva a configuração, autenticação, fila e histórico existentes.

Bibliotecas já existentes continuam com legendas **desativadas por padrão**. Nenhum backfill é iniciado automaticamente após a atualização.

## 1. Pare a aplicação

```bash
pm2 stop ersatztv-youtube-downloader
```

## 2. Faça backup

```bash
cd /caminho/da/aplicacao
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## 3. Extraia a atualização

```bash
cd /caminho/da/aplicacao
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.4.0-update.zip -d .
```

## 4. Valide e reinicie

```bash
npm run verify
pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
pm2 logs ersatztv-youtube-downloader --lines 100
```

## 5. Ative as legendas onde desejar

Na interface, abra **Bibliotecas**, expanda a biblioteca e habilite **Baixar legendas nesta biblioteca**.

Por padrão ficam disponíveis, todos selecionáveis em conjunto:

```text
pt-BR  Português (Brasil)
pt     Português
en     English
es     Español
```

A opção de legendas automáticas vem habilitada. O formato é sempre SRT externo.

Para os vídeos que já estavam no disco antes da atualização, clique em **Buscar legendas ausentes**. Essa ação não baixa novamente os MP4. Quando novos SRT forem criados, o aplicativo faz um único scan da biblioteca no ErsatzTV ao final.

A ausência de uma legenda não é tratada como erro do vídeo. Falhas temporárias na busca de legendas recebem retentativas independentes.
