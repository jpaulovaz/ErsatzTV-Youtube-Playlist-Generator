# Atualização da versão 1 para a versão 2.0

Este procedimento preserva `config/config.json`, `data/` e os arquivos de mídia existentes.

## 1. Pare o aplicativo atual

Use o nome real do seu serviço. Exemplo:

```bash
sudo systemctl stop ersatztv-youtube-downloader
```

Quando o serviço antigo tiver outro nome, pare esse serviço em vez do exemplo acima.

## 2. Faça backup da instalação

Dentro da pasta que contém a aplicação:

```bash
cd /caminho/da/aplicacao
cd ..
tar -czf "ersatztv-youtube-backup-$(date +%Y%m%d-%H%M%S).tar.gz" "$(basename /caminho/da/aplicacao)"
```

Alternativa direta, executada dentro da aplicação:

```bash
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## 3. Extraia o pacote de atualização por cima da aplicação

O arquivo `ErsatzTV-YouTube-Downloader-v2.0.0-update.zip` contém somente arquivos substituíveis. Ele não contém `config/config.json` nem dados operacionais.

```bash
cd /caminho/da/aplicacao
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.0.0-update.zip -d .
rm -f deploy/ersatztv-yml-syncer.service.example
```

O `rm` acima elimina somente o exemplo de serviço antigo; ele não toca no unit file já instalado em `/etc/systemd/system`.

## 4. Valide

```bash
node --version
/usr/local/bin/yt-dlp --version
/usr/bin/ffmpeg -version | head -n 1
/usr/bin/ffprobe -version | head -n 1
npm run verify
```

## 5. Inicie a versão 2

```bash
sudo systemctl start ersatztv-youtube-downloader
sudo journalctl -u ersatztv-youtube-downloader -n 100 --no-pager
```

Na primeira inicialização, a aplicação:

- detecta o JSON da versão 1;
- cria `config/config.v1.backup-*.json`;
- grava o formato v2;
- mantém bibliotecas, fontes, IDs, caminhos e preferências úteis;
- não ativa automaticamente o `cookies.txt` legado.

Confirme a interface em:

```text
http://SERVIDOR:3099
```

## 6. Crie a biblioteca local no ErsatzTV

Não exclua a biblioteca Remote Streams antiga ainda.

1. Em `Media Sources > Local`, use/crie uma biblioteca do tipo `Music Videos`.
2. Adicione como path a pasta da biblioteca gerada pelo app, por exemplo:

```text
/home/joaopaulovaz/comerciais/videclipes/youtube/youtube/Mix_Principal
```

3. Salve e anote o `Library ID` correto.
4. Atualize esse ID na biblioteca correspondente do aplicativo.
5. Informe o `Playout ID` quando quiser rebuild automático.

## 7. Faça a primeira descoberta

Use `Buscar novidades`. A primeira execução da v2 pode enfileirar toda a playlist, pois os antigos YML não contam como vídeos concluídos.

Acompanhe:

- fila;
- espaço em disco;
- conversão/validação;
- scan do ErsatzTV;
- reprodução dos MP4 concluídos.

## 8. Só depois limpe os arquivos legados

Quando a biblioteca local estiver validada:

1. Use `Limpar YML antigos` na interface.
2. Confirme que os MP4 continuam reconhecidos.
3. Remova a biblioteca Remote Streams antiga no ErsatzTV.

A limpeza manual remove `.yml`, `.yaml`, `.availability.json` e `stream-yt.sh`; não remove MP4/JPG concluídos.

## Retorno para a versão anterior

1. Pare a versão 2.
2. Restaure o backup completo ou o `config.json` anterior.
3. Restaure `data/` quando necessário.
4. Reinicie o serviço antigo.

Os MP4 que já tiverem sido baixados podem permanecer no disco; a versão anterior simplesmente não os utiliza como Remote Streams.
