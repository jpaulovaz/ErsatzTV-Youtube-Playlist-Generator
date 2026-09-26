# Atualização para a versão 2.7.0

Esta atualização parte da versão 2.6.0 e troca o modo opcional de metadados do ErsatzTV de **Filmes** para **Shows**.

O pacote `update` não contém `config/config.json`, `config/auth.json` nem `data/`, portanto preserva configuração, autenticação, fila e histórico. Ao iniciar a 2.7.0, o schema de configuração v2 é migrado automaticamente para v3 e uma cópia de backup do `config.json` anterior é criada.

## Mudança no ErsatzTV

A biblioteca local usada por esse acervo deve ser criada como:

```text
Media Kind: Shows
```

O diretório passa a seguir o formato:

```text
Biblioteca/
└── Artista/
    ├── tvshow.nfo
    ├── poster.jpg
    └── Season 01/
        ├── Artista - S01E01 - Musica.mp4
        ├── Artista - S01E01 - Musica.nfo
        ├── Artista - S01E01 - Musica-thumb.jpg
        └── Artista - S01E01 - Musica.pt-BR.srt
```

O artista vira o título do Show e a música vira o título do episódio. Essa estrutura permite ao ErsatzTV tratar a música como `sub-title`/episódio no EPG sem alterar o template global dos demais canais.

## Acervo antigo

A 2.7.0 não tenta reorganizar automaticamente o layout antigo de Filmes. Para o estágio atual do projeto, a migração recomendada é limpar os arquivos da biblioteca e executar novamente a descoberta.

O índice continua deduplicando por `videoId`. Quando o arquivo antigo não existe, o caminho é recalculado no novo layout de Shows antes do download.

## Atualização

```bash
cd /caminho/da/aplicacao

pm2 stop ersatztv-youtube-downloader

cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"

unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.7.0-update.zip -d .

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
