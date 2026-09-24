# Atualização para a versão 2.1

Este procedimento foi preparado para atualização direta da versão 2.0 e também funciona sobre uma instalação migrada da versão 1. O pacote `update` não contém `config/config.json`, `config/auth.json` nem o conteúdo de `data/`.

## 1. Pare a aplicação

Com PM2:

```bash
pm2 stop ersatztv-youtube-downloader
```

Quando o processo tiver outro nome, confira com `pm2 list` e use esse nome.

## 2. Faça backup

Dentro da pasta da aplicação:

```bash
cd /caminho/da/aplicacao
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

Quando já existir `config/auth.json`, preserve-o também:

```bash
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
```

## 3. Extraia o pacote de atualização

```bash
cd /caminho/da/aplicacao
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.1.0-update.zip -d .
```

A atualização preserva a configuração de bibliotecas, a fila, o histórico e os arquivos de mídia.

## 4. Configure o login local

Na primeira atualização para 2.1, crie o usuário administrativo:

```bash
npm run auth:set -- --username SEU_USUARIO
```

A senha é solicitada no terminal, precisa ter pelo menos 12 caracteres e não é exibida. Para uma aplicação que ficará exclusivamente atrás de um proxy reverso controlado, use:

```bash
npm run auth:set -- --username SEU_USUARIO --trust-proxy
```

Não habilite `--trust-proxy` quando clientes puderem acessar diretamente a porta do Node, pois nessa modalidade a aplicação confia nos cabeçalhos encaminhados pelo proxy.

Para trocar a senha futuramente, execute o mesmo comando e reinicie a aplicação.

## 5. Valide

```bash
node --version
/usr/local/bin/yt-dlp --version
/usr/bin/ffmpeg -version | head -n 1
/usr/bin/ffprobe -version | head -n 1
npm run verify
```

## 6. Inicie no PM2

Quando o processo ainda existe no PM2:

```bash
pm2 restart ersatztv-youtube-downloader --update-env
```

Quando ele foi removido:

```bash
APP_DIR="$(pwd)"
NODE_ENV=production pm2 start "$APP_DIR/src/main.js" \
  --name ersatztv-youtube-downloader \
  --cwd "$APP_DIR" \
  --time
```

Depois:

```bash
pm2 logs ersatztv-youtube-downloader --lines 100
pm2 save
```

## 7. Valide a interface

Acesse pelo endereço HTTPS do proxy reverso. A rota `/login` deve aparecer antes do painel.

A versão 2.1 traz:

- login local obrigatório e sessão protegida;
- botão `Limpar fila`, com escopo geral ou por biblioteca;
- preservação de vídeos concluídos ao limpar a fila;
- supressão dos itens removidos para evitar redescoberta automática;
- resumo amplo da fila sempre visível;
- listagem detalhada em sanfona, fechada por padrão e paginada;
- remoção definitiva da função de limpeza de YML.

Ao limpar uma playlist adicionada por engano, corrija ou remova também sua URL na biblioteca antes de executar uma nova descoberta.

## Proxy reverso

Quando o proxy e a aplicação estiverem no mesmo servidor, é mais seguro configurar:

```json
"server": {
  "host": "127.0.0.1",
  "port": 3099
}
```

O proxy deve encaminhar, no mínimo, `Host`, `X-Forwarded-For` e `X-Forwarded-Proto`, além de publicar apenas HTTPS. Não execute simultaneamente uma segunda instância systemd e outra no PM2.

## Retorno para a versão anterior

1. Pare a versão 2.1.
2. Restaure o backup da instalação ou os arquivos modificados.
3. Restaure `config/` e `data/` quando necessário.
4. Reinicie o processo anterior.

Os vídeos MP4 já baixados permanecem no disco.
