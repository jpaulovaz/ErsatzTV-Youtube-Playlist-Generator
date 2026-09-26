# Atualização para a versão 2.8.0

Esta atualização parte da versão 2.7.0 e substitui o antigo modo único de metadados por três perfis selecionáveis por biblioteca.

O pacote `update` não contém `config/config.json`, `config/auth.json` nem `data/`, portanto preserva configuração, autenticação, fila e histórico. Ao iniciar, o schema de configuração é atualizado para v4 e o arquivo anterior recebe backup automático.

## Perfis

Na edição de cada biblioteca existe apenas o campo **Perfil**:

- `Genérico`
- `Show / vídeo completo (Filmes)`
- `Clipes musicais (Seriados)`

Uma configuração v2.7 com `showMetadata.enabled=true` é convertida para `Clipes musicais`. Configurações antigas com `movieMetadata.enabled=true` são convertidas para `Show / vídeo completo`.

Como o projeto ainda está no início, não há migração física entre layouts. Se for trocar o perfil de uma biblioteca que já contém arquivos, a forma mais limpa é remover o acervo e permitir novo download com o perfil correto. A deduplicação continua sendo feita pelo `videoId`; quando o arquivo físico não existe, o destino é recalculado.

## Atualização

```bash
cd /caminho/da/aplicacao

pm2 stop ersatztv-youtube-downloader

cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"

unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.8.0-update.zip -d .

npm run verify

pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
pm2 logs ersatztv-youtube-downloader --lines 100
```

Resultado esperado:

```text
tests 43
pass 43
fail 0
```
