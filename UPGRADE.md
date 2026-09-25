# Atualização para a versão 2.6.0

Esta atualização parte da versão 2.5.0 e padroniza o nome do artista usado em novos destinos e nos metadados NFO.

O pacote `update` não contém `config/config.json`, `config/auth.json` nem `data/`, portanto preserva configuração, autenticação, fila e histórico existentes. A atualização também **não move nem renomeia automaticamente vídeos já concluídos**.

## O que muda

Quando o YouTube fornece variações como:

```text
TWENTY ONE PILOTS
twenty one pilots
Twenty One Pilots
```

o aplicativo passa a usar, para novos destinos:

```text
Twenty One Pilots
```

A consolidação também é case-insensitive dentro de cada biblioteca, evitando pastas separadas que diferem apenas por maiúsculas/minúsculas. Nomes estilizados são tratados de forma conservadora e não são alterados quando a capitalização pode ser intencional.

A separação de artista e título agora usa o primeiro separador ` - ` com espaços. Isso evita quebrar nomes como `blink-182`.

## Atualização

```bash
cd /caminho/da/aplicacao

pm2 stop ersatztv-youtube-downloader

cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"

unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.6.0-update.zip -d .

npm run verify

pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
pm2 logs ersatztv-youtube-downloader --lines 100
```

O resultado esperado da validação desta release é:

```text
tests 38
pass 38
fail 0
```

## Sobre o acervo que já existe

Não foi adicionada uma ação de normalização por biblioteca. Isso evita poluir a interface com uma ferramenta de migração de uso pontual.

Se quiser refazer o acervo neste estágio inicial do projeto, remova os arquivos usando o procedimento que já utiliza e faça nova descoberta. Quando um item conhecido estiver sem o arquivo físico, a 2.6.0 recalcula o destino antes do novo download, aplicando a regra atual de artista.

Arquivos concluídos que continuam presentes no disco permanecem exatamente onde estão.
