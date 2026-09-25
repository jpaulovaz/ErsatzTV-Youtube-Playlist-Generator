# Atualização para a versão 2.5.0

Esta atualização parte da versão 2.4.0 e adiciona metadados NFO/artwork opcionais por biblioteca para o cenário em que os videoclipes são cadastrados no ErsatzTV como **Filmes**.

O pacote `update` não contém `config/config.json`, `config/auth.json` nem `data/`, portanto preserva configuração, autenticação, fila e histórico existentes.

Bibliotecas existentes permanecem com **Metadados para ErsatzTV (Filmes)** desativados até ativação explícita. A atualização não reorganiza nenhum arquivo automaticamente.

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

Como a ação de preparação pode reorganizar MP4/SRT/JPG já existentes, faça também um backup da biblioteca de mídia antes de executar **Preparar NFOs existentes** pela primeira vez.

## 3. Extraia a atualização

```bash
cd /caminho/da/aplicacao
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v2.5.0-update.zip -d .
```

## 4. Valide e reinicie

```bash
npm run verify
pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
pm2 logs ersatztv-youtube-downloader --lines 100
```

## 5. Ative somente nas bibliotecas desejadas

Na interface:

```text
Bibliotecas
  → abra a biblioteca
  → Metadados para ErsatzTV (Filmes)
  → Preparar novos vídeos para biblioteca do tipo Filmes
  → Salvar
```

Para vídeos futuros, a estrutura passa a ser semelhante a:

```text
Biblioteca/
└── Artista/
    └── Artista - Música (Official Video)/
        ├── Artista - Música (Official Video).mp4
        ├── Artista - Música (Official Video).nfo
        ├── Artista - Música (Official Video).pt-BR.srt
        └── poster.jpg
```

O nome físico é preservado. No NFO, sufixos de apresentação do YouTube são removidos, resultando por exemplo em:

```xml
<movie>
  <title>Twenty One Pilots</title>
  <sorttitle>Twenty One Pilots - City Walls</sorttitle>
  <outline>City Walls</outline>
  <plot>City Walls</plot>
  <genre>Music</genre>
  <tag>Music Video</tag>
  <uniqueid type="youtube" default="true">VIDEO_ID</uniqueid>
</movie>
```

## 6. Preparar vídeos já existentes

Depois de salvar a opção, use **Preparar NFOs existentes**.

A ação:

- não baixa novamente MP4;
- cria uma subpasta individual por vídeo;
- move o MP4 e as legendas SRT sidecar para a nova pasta;
- transforma o JPG já controlado pelo aplicativo em `poster.jpg`;
- baixa a thumbnail somente se o poster estiver ausente e houver URL conhecida;
- cria/atualiza o NFO;
- atualiza os caminhos persistidos pelo aplicativo;
- dispara um único scan do ErsatzTV ao final, quando Library ID estiver configurado.

A ação pede confirmação antes de reorganizar os arquivos.
