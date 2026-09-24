# Atualização para a versão 2.3.1

Esta atualização parte da versão 2.3.0 e adiciona suporte à API Key exigida pelas versões atuais do ErsatzTV. O pacote `update` não contém `config/config.json`, `config/auth.json` nem `data/`, portanto preserva toda a configuração e o estado operacional existentes.

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
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.3.1-update.zip -d .
```

## 4. Valide e reinicie

```bash
npm run verify
pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
pm2 logs ersatztv-youtube-downloader --lines 100
```

## 5. Configure a chave do ErsatzTV

Na interface, abra **Configurações → ErsatzTV** e preencha **API Key do ErsatzTV** com a chave gerada pelo próprio ErsatzTV.

A aplicação enviará automaticamente:

```text
X-Etv-Api-Key: <sua-chave>
```

para as ações de scan de biblioteca, limpeza de lixo e rebuild de playout.

Não use a chave do Pocket ID nesse campo.
