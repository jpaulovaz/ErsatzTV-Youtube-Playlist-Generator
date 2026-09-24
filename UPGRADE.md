# Atualização para a versão 2.3

Este procedimento atualiza diretamente a versão 2.2. O pacote `update` não contém `config/config.json`, `config/auth.json` nem o conteúdo de `data/`, portanto preserva API Key, bibliotecas, credenciais, fila, histórico e arquivos de mídia.

## 1. Pare a aplicação

```bash
pm2 stop ersatztv-youtube-downloader
```

Quando o processo tiver outro nome, confira com `pm2 list`.

## 2. Faça backup

Dentro da pasta da aplicação:

```bash
cd /caminho/da/aplicacao
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## 3. Extraia a atualização

```bash
cd /caminho/da/aplicacao
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.3.0-update.zip -d .
```

## 4. Valide

```bash
npm run verify
```

## 5. Reinicie

```bash
pm2 restart ersatztv-youtube-downloader --update-env
pm2 logs ersatztv-youtube-downloader --lines 100
pm2 save
```

Quando o processo não existir mais no PM2:

```bash
APP_DIR="$(pwd)"
NODE_ENV=production pm2 start "$APP_DIR/src/main.js" \
  --name ersatztv-youtube-downloader \
  --cwd "$APP_DIR" \
  --time
pm2 save
```

## 6. Valide a interface

Acesse a aplicação e confirme:

- login e logout normais;
- navegação lateral entre Visão geral, Downloads, Bibliotecas, Configurações e Logs no desktop;
- navegação inferior e painel de ações rápidas no celular;
- fila detalhada fechada por padrão;
- bibliotecas fechadas por padrão e abertas individualmente;
- todas as áreas de configuração em sanfona;
- API Key e demais valores previamente salvos ainda preenchidos;
- ações de salvar, buscar novidades, pausar e retomar sem erros.

## Alterações visuais da 2.3

- desktop preservado com navegação lateral e a mesma identidade visual;
- navegação inferior dedicada no celular;
- cabeçalho móvel compacto e painel deslizante de ações rápidas;
- downloads exibidos como cartões no celular, eliminando rolagem horizontal da tabela;
- filtros, formulários, bibliotecas, configurações e diálogos adaptados para toque;
- suporte a safe areas e posicionamento correto de toast acima da navegação móvel;
- tela de login preservada.

## Retorno para a versão anterior

1. Pare a versão 2.3.
2. Restaure os arquivos do backup da instalação.
3. Restaure `config/` e `data/` somente quando necessário.
4. Reinicie o processo anterior.

Os vídeos MP4 permanecem no disco.
