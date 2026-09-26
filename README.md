# ErsatzTV YouTube Downloader 3.0.1

Aplicativo Node.js para descobrir conteúdo do YouTube, manter uma fila persistente de downloads locais e entregar mídia pronta ao ErsatzTV.

A versão 3.0.1 mantém os módulos **Bibliotecas** e **Canais** da v3.0.0 e corrige a experiência de acompanhamento dos canais salvos. Um canal pode expor Todos os uploads, Vídeos, Shorts, Transmissões finalizadas e playlists públicas. Cada playlist selecionada funciona como uma biblioteca embutida, com perfil de mídia, legendas e integração própria com o ErsatzTV. A deduplicação é feita por destino: o mesmo vídeo pode existir intencionalmente em destinos diferentes.

## Arquitetura

```text
Playlist ou vídeo do YouTube
          ↓
Descoberta (YouTube Data API ou yt-dlp)
          ↓
Deduplicação por destino + videoId
          ↓
Fila persistente, um item por vez
          ↓
yt-dlp + ffmpeg/ffprobe
          ↓
MP4 / H.264 / AAC + JPG/SRT + NFO conforme o perfil da biblioteca
          ↓
Biblioteca local do ErsatzTV
```

## Principais recursos

- Uma ou mais bibliotecas, cada uma com várias fontes.
- Fontes do tipo playlist e vídeo individual.
- YouTube Data API como modo preferencial, com fallback automático para `yt-dlp`.
- Fila persistente em JSON; reiniciar o aplicativo não perde os itens pendentes.
- Um download simultâneo, evitando picos de CPU, rede e disco.
- Arquivos finais padronizados em MP4, vídeo H.264 e áudio AAC.
- Resolução máxima geral ou específica por biblioteca: 360p, 480p, 720p, 1080p, 1440p e 2160p.
- Organização padrão `Biblioteca/Artista/Artista - Título.mp4`, com nome canônico de artista para evitar duplicação apenas por diferenças de maiúsculas/minúsculas.
- Modo opcional para ErsatzTV/Shows com `Biblioteca/Artista/Season 01/`, `tvshow.nfo` e NFO por episódio.
- Thumbnail do vídeo como artwork de episódio (`-thumb.jpg`) e `poster.jpg` no nível do artista/Show.
- Legendas SRT externas opcionais por biblioteca, com suporte a legendas manuais e automáticas do YouTube.
- Seleção múltipla de idiomas: `pt-BR`, `pt`, `en` e `es`.
- Ação **Buscar legendas ausentes** para o acervo já baixado, sem baixar novamente os vídeos.
- Deduplicação por ID do YouTube dentro de cada destino; o mesmo vídeo pode existir intencionalmente em destinos diferentes.
- Retentativas automáticas após 1, 5 e 15 minutos.
- Pausa automática quando o espaço livre fica abaixo da reserva configurada.
- Itens removidos de uma fonte são marcados como órfãos e nunca apagados automaticamente.
- Controles de pausar, retomar, cancelar, priorizar, remover, limpar a fila e tentar novamente.
- Resumo permanente da fila e listagem recolhível/paginada, fechada por padrão.
- Interface profissional com navegação lateral no desktop e navegação inferior no celular.
- Painel móvel de ações rápidas para descoberta, fila, atualização e encerramento da sessão.
- Lista de downloads convertida automaticamente em cartões no celular, sem tabela horizontal.
- Login administrativo local com senha derivada por scrypt, sessão HttpOnly, CSRF e bloqueio de tentativas.
- Scan da biblioteca e rebuild do playout quando a fila entra em repouso, com suporte ao header `X-Etv-Api-Key`.
- Limpeza manual de órfãos.
- Migração automática da configuração da versão 1.

## Requisitos

- Linux recomendado.
- Node.js 18 ou superior.
- `yt-dlp` atualizado.
- `ffmpeg` e `ffprobe`.
- Acesso de gravação à pasta definida em `paths.baseDir`.
- ErsatzTV acessível pela rede para scan/rebuild automáticos.
- API Key do ErsatzTV quando a versão instalada exigir autenticação em `/api` (`X-Etv-Api-Key`).
- Opcional: Deno para os desafios JavaScript atuais do YouTube.
- Opcional: uma YouTube Data API Key.
- Opcional: `cookies.txt` em formato Netscape para vídeos que exigem sessão.

Exemplo de verificação:

```bash
node --version
/usr/local/bin/yt-dlp --version
/usr/bin/ffmpeg -version | head -n 1
/usr/bin/ffprobe -version | head -n 1
/usr/local/bin/deno --version
```

## Instalação nova

1. Extraia o pacote completo em uma pasta permanente.
2. Ajuste `config/config.json` pela interface ou use `config/config.example.json` como referência.
3. Crie o único usuário administrativo local:

```bash
npm run auth:set -- --username SEU_USUARIO
```

Quando a aplicação ficar exclusivamente atrás de um proxy reverso confiável, use `--trust-proxy` ou responda `sim` à pergunta do assistente. A senha não é gravada em texto puro.

4. Valide o projeto:

```bash
npm run verify
```

5. Inicie:

```bash
npm start
```

6. Acesse:

```text
http://ENDERECO_DO_SERVIDOR:3099
```

O projeto não usa dependências npm externas nesta versão; `npm install` não é necessário para a execução normal.

## Atualização

Use o pacote `update`, extraindo-o por cima da instalação atual. Esse pacote não contém `config/config.json`, `config/auth.json` nem o conteúdo de `data/`, portanto preserva configuração, autenticação e estado operacional.

Ao carregar uma configuração anterior, o aplicativo normaliza o schema atual e cria um backup do `config.json` antes de gravar a versão migrada. Consulte [UPGRADE.md](UPGRADE.md).

## Estrutura dos arquivos

Com uma biblioteca chamada `Mix_Principal`, o resultado é semelhante a:

```text
/srv/media/youtube/
├── .youtube-downloader-work/        # arquivos temporários; não é biblioteca
└── Mix_Principal/
    ├── Queen/
    │   ├── Queen - Bohemian Rhapsody.mp4
    │   ├── Queen - Bohemian Rhapsody.jpg
    │   └── Queen - Bohemian Rhapsody.nfo
    └── Outros/
        ├── Vídeo sem separador de artista.mp4
        ├── Vídeo sem separador de artista.jpg
        └── Vídeo sem separador de artista.nfo
```

O aplicativo divide o título no primeiro separador ` - ` (com espaços), preservando hífens que façam parte do artista ou da música. Quando não consegue determinar o artista, usa a pasta `Outros`. Nomes simples de artista com duas ou mais palavras totalmente em maiúsculas ou minúsculas são normalizados para capitalização legível; grafias estilizadas são preservadas.

Em caso de colisão de nome, o ID do YouTube é acrescentado ao arquivo. O índice interno continua sendo o `videoId`.

O nome da biblioteca também é sua identidade interna e define a pasta física. Renomeá-la depois que a fila já possui itens é tratado como a criação de outra biblioteca; não use uma simples renomeação para mover arquivos existentes. Mudanças de `paths.baseDir` também devem ser feitas com a fila parada e com migração planejada dos arquivos e do estado.

## Canais

A área **Canais** é separada de **Bibliotecas**. O fluxo começa por **Adicionar canal → Analisar**. A análise apenas identifica o canal, fontes globais e playlists; ela não cria downloads.

Fontes disponíveis:

- Todos os uploads;
- Vídeos;
- Shorts;
- Transmissões finalizadas;
- playlists públicas, listadas individualmente por nome.

As fontes globais usam o perfil Genérico. Playlists selecionadas podem usar os mesmos três perfis de mídia de Bibliotecas e podem ter `Library ID`, `Playout ID`, resolução, cookies e legendas próprios. Uma playlist é tratada como unidade editorial completa, inclusive quando contém vídeos publicados por outros canais.

A identidade persistente é baseada em `channelId`, `playlistId` e `destinationId`. Renomes no YouTube atualizam o nome exibido, mas não movem automaticamente a pasta física. Itens removidos remotamente viram órfãos e só são excluídos após preview e confirmação manual.

Por padrão, os arquivos de Canais ficam abaixo de `paths.channelsBaseDir`:

```text
/srv/media/youtube-channels/
└── Canal/
    ├── Uploads/
    ├── Videos/
    ├── Shorts/
    ├── Streams/
    └── Playlists/
        ├── Playlist A/
        └── Playlist B/
```

O intervalo automático de Canais é configurado separadamente em `channelScheduler`. O worker/fila de downloads continua sendo único para Bibliotecas e Canais.

## Configuração no ErsatzTV

Para cada biblioteca do aplicativo, adicione ao ErsatzTV a pasta correspondente, por exemplo:

```text
/srv/media/youtube/Mix_Principal
```

Use o tipo local conforme o perfil escolhido no aplicativo:

- **Genérico**: estrutura simples; use o tipo que fizer sentido no seu fluxo, normalmente `Other Videos`.
- **Show / vídeo completo (Filmes)**: `Movies`.
- **Clipes musicais (Seriados)**: `Shows`.

Aponte o `Library ID` do aplicativo para a biblioteca local que deve receber o scan. O `Playout ID` é opcional e serve para rebuild automático depois que a fila entra em repouso.

Nas versões atuais do ErsatzTV que protegem as rotas `/api`, preencha também **Configurações → ErsatzTV → API Key do ErsatzTV**. O aplicativo envia essa chave como `X-Etv-Api-Key` nas ações `scan`, `empty-trash` e `rebuild-playout`.

## Descoberta e fila

`Buscar novidades` não baixa tudo ao mesmo tempo. A descoberta atualiza o índice e acrescenta somente itens desconhecidos à fila.

Estados principais:

- `pending`: aguardando a vez ou uma retentativa;
- `downloading`: download/processamento em andamento;
- `completed`: arquivo local validado;
- `failed`: esgotou as tentativas automáticas;
- `cancelled`: cancelado pelo operador;
- `orphaned`: não está mais nas fontes atuais, mas foi preservado;
- `removed`: retirado manualmente da fila e suprimido até uma ação de retry.

Ao reiniciar o aplicativo, um item que estava em `downloading` volta para `pending`. Arquivos temporários ficam em `.youtube-downloader-work` e não são apresentados ao ErsatzTV como itens concluídos.

### Limpar uma fila criada por engano

A ação `Limpar fila` pode atuar sobre todas as bibliotecas ou apenas uma. Ela:

- preserva todos os vídeos concluídos e seus arquivos locais;
- opcionalmente encerra o download atual;
- remove da fila ativa itens pendentes, falhos, cancelados e órfãos sem arquivo concluído;
- mantém esses itens como `removed` e `suppressed`, evitando que a mesma descoberta os recoloque automaticamente.

Antes da próxima busca, remova ou corrija a URL da playlist errada. Um item suprimido ainda pode ser reativado individualmente com `Tentar novamente`. A listagem detalhada da fila inicia fechada e carrega os itens em páginas de 100 registros.

## Legendas por biblioteca

As legendas são configuradas individualmente em **Bibliotecas**. Para bibliotecas existentes, o recurso permanece **desativado por padrão** até ser habilitado explicitamente.

Quando ativado, o aplicativo pode buscar:

- legendas publicadas pelo canal/criador;
- legendas automáticas geradas pelo YouTube;
- um ou mais dos idiomas `pt-BR`, `pt`, `en` e `es`;
- sempre em arquivo externo `.srt`.

Os arquivos usam o mesmo nome-base do vídeo, por exemplo:

```text
Artista - Musica.mp4
Artista - Musica.pt-BR.srt
Artista - Musica.en.srt
```

Para vídeos novos, a busca de legendas entra no fluxo automaticamente depois que o MP4 é concluído. A ausência de legenda não transforma o download do vídeo em falha. Se houver uma falha temporária no `yt-dlp`, o vídeo permanece `completed` e a legenda recebe retentativas independentes.

Para o acervo existente, habilite as legendas na biblioteca, selecione os idiomas e clique em **Buscar legendas ausentes**. O aplicativo verifica apenas os vídeos concluídos, não baixa o MP4 novamente e, quando novos SRT forem adicionados, dispara **um único scan da biblioteca no ErsatzTV ao final da operação**.

O `yt-dlp` usa `--write-subs`, `--write-auto-subs` quando habilitado, `--sub-langs` para os idiomas selecionados e `--convert-subs srt`. O aplicativo preserva SRT já existentes e busca somente os idiomas selecionados que ainda estiverem ausentes.

## Perfis de mídia

O perfil é escolhido diretamente na biblioteca. Não existem switches separados de Movie/Show.

### Genérico

Mantém o layout simples:

```text
Biblioteca/
└── Artista/
    ├── Artista - Titulo.mp4
    ├── Artista - Titulo.jpg
    ├── Artista - Titulo.nfo
    └── Artista - Titulo.pt-BR.srt
```

O NFO é básico e grava título, plot e `uniqueid` do YouTube.

### Show / vídeo completo (Filmes)

Preserva o modelo usado na v2.6.0:

```text
Biblioteca/
└── Artista/
    └── Artista - Titulo/
        ├── Artista - Titulo.mp4
        ├── Artista - Titulo.nfo
        ├── Artista - Titulo.pt-BR.srt
        └── poster.jpg
```

O NFO coloca o artista em `title` e o nome do vídeo em `outline`/`plot`.

### Clipes musicais (Seriados)

Preserva o modelo usado na v2.7.0:

```text
Biblioteca/
└── Twenty One Pilots/
    ├── tvshow.nfo
    ├── poster.jpg
    └── Season 01/
        ├── Twenty One Pilots - S01E01 - City Walls.mp4
        ├── Twenty One Pilots - S01E01 - City Walls.nfo
        ├── Twenty One Pilots - S01E01 - City Walls-thumb.jpg
        └── Twenty One Pilots - S01E01 - City Walls.pt-BR.srt
```

O artista vira o Show e a música vira o episódio. A numeração é estável por artista.

A normalização de nomes continua conservadora: casing claramente ruidoso é corrigido, enquanto grafias estilizadas como `AC/DC`, `P!NK`, `deadmau5`, `blink-182` e `CHVRCHES` são preservadas.

## Compatibilidade de mídia

O aplicativo tenta obter H.264/AAC diretamente quando a resolução é 1080p ou inferior. Para resoluções maiores, pode baixar codecs como VP9/AV1 e normalizar o arquivo localmente.

Antes de concluir um item:

1. `ffprobe` valida que há vídeo e áudio.
2. Quando necessário, `ffmpeg` remuxa o container.
3. Se os codecs não forem H.264/AAC, `ffmpeg` transcodifica.
4. O arquivo final é validado novamente.
5. Somente então ele é movido para o destino `.mp4`.

Um arquivo final preexistente que falhar na validação é preservado com sufixo `.invalid-TIMESTAMP` para análise, em vez de ser sobrescrito silenciosamente.

## Espaço em disco

A interface mostra total, usado e livre. Por padrão, novos downloads são bloqueados quando o espaço disponível fica abaixo de 20 GB.

A pausa por pouco espaço não exclui arquivos nem remove itens da fila. Depois de liberar espaço, o worker volta a prosseguir automaticamente.

## Órfãos

Quando um vídeo deixa de pertencer às fontes configuradas:

- o arquivo local é preservado;
- o item recebe marcação de órfão;
- não há exclusão automática;
- a interface permite visualizar e remover órfãos de forma explícita.

A limpeza de órfãos remove o MP4, a thumbnail, os SRT sidecar associados, o estado daquele item e pastas de artista que ficarem vazias.

## Autenticação e proxy reverso

A interface e todas as APIs operacionais são bloqueadas até que `config/auth.json` seja criado. Há somente um usuário local, adequado a uma instalação administrativa privada.

Crie ou troque as credenciais com:

```bash
npm run auth:set -- --username SEU_USUARIO
```

O arquivo contém apenas hash scrypt, salt e segredo aleatório de sessão; a senha não é persistida. As permissões são ajustadas para `600`. Não copie `auth.example.json` como configuração ativa: ele contém apenas marcadores ilustrativos.

Proteções incluídas:

- cookie de sessão `HttpOnly`, `SameSite=Strict` e `Secure` automaticamente sob HTTPS;
- expiração absoluta e por inatividade;
- token CSRF para ações de escrita;
- validação de origem;
- limitação e bloqueio temporário após falhas de login;
- cabeçalhos CSP, anti-frame, anti-MIME-sniffing e HSTS sob HTTPS;
- sessões somente em memória, invalidadas quando o processo reinicia.

Para um proxy no mesmo servidor, prefira `server.host = 127.0.0.1` e publique apenas o proxy em HTTPS. Ative `trustProxy` somente quando a aplicação receber tráfego exclusivamente de um proxy controlado, pois nessa modalidade ela confia em `X-Forwarded-For`, `X-Forwarded-Host` e `X-Forwarded-Proto`.

Depois de mudar `config/auth.json`, reinicie o processo.

## Cookies

Cookies são opcionais. Deixe ambos os campos vazios para executar sem `--cookies`:

- `paths.cookiesPath`: padrão global;
- `cookiesPath` dentro de uma biblioteca: sobrescreve o padrão global.

O botão `Testar cookies` realiza uma consulta simulada por `yt-dlp`. Um arquivo antigo pode expirar ou ser rotacionado pelo YouTube; nesse caso, substitua-o por uma exportação nova ou deixe o campo vazio quando o conteúdo for público.

Nunca armazene o conteúdo dos cookies diretamente no JSON; informe somente o caminho do arquivo e restrinja suas permissões:

```bash
chmod 600 /caminho/cookies.txt
```

## YouTube Data API

Quando habilitada no modo `api`, a API é usada para descobrir IDs e metadados. Se a API falhar ou receber uma fonte não suportada, o aplicativo tenta `yt-dlp` para aquela descoberta.

A API não substitui o `yt-dlp` para baixar vídeo e áudio.

## Agendador

O intervalo recomendado é 360 minutos. O agendador apenas procura novidades e alimenta a fila; o worker continua processando itens independentemente do agendador.

`runOnStartup` dispara uma descoberta logo após a inicialização. Em uma migração com uma playlist grande, isso pode enfileirar imediatamente todos os vídeos ainda não registrados.

## Ações do ErsatzTV

Quando a fila fica sem item executável e existem arquivos novos:

1. o aplicativo espera `idleActionDelaySeconds`;
2. solicita scan usando `Library ID`, se configurado;
3. solicita rebuild usando `Playout ID`, se configurado;
4. registra o resultado no estado da biblioteca.

Isso evita um scan para cada vídeo individual. A ação manual **Buscar legendas ausentes** também agrupa o trabalho e executa somente um scan ao final quando algum SRT novo foi criado.

## Remoção de bibliotecas

- `Remover configuração` retira a biblioteca do JSON e preserva todos os arquivos.
- `Excluir biblioteca e arquivos` exige digitar exatamente o nome e remove a pasta, os itens do índice e os temporários relacionados.

A segunda ação é destrutiva e não possui restauração automática.

## Arquivos de estado

```text
config/config.json                  configuração ativa
config/auth.json                    credencial derivada e parâmetros de sessão
data/download-state.json            fila, histórico e índice por videoId
data/app.log                        log operacional
.youtube-downloader-work/           arquivos temporários dentro da pasta base
```

Faça backup de `config/` e `data/`. A mídia pode ser copiada separadamente conforme sua política de armazenamento.

## Comandos

```bash
npm start          # interface + worker + agendador
npm run auth:set   # criar ou trocar usuário/senha local
npm run sync       # uma descoberta pelo terminal
npm run check      # valida sintaxe JavaScript
npm test           # testes automatizados
npm run verify     # sintaxe + testes
```

## Serviço systemd

Há um exemplo em:

```text
deploy/ersatztv-youtube-downloader.service.example
```

Ajuste `User`, `Group` e `WorkingDirectory`, copie para `/etc/systemd/system/ersatztv-youtube-downloader.service` e execute:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ersatztv-youtube-downloader
sudo journalctl -u ersatztv-youtube-downloader -f
```

## Segurança operacional

- Publique a interface externa somente por HTTPS e mantenha a porta do Node restrita ao proxy/rede confiável.
- Proteja `config/auth.json`, API Keys, cookies e backups da configuração.
- O processo precisa escrever apenas na pasta da aplicação, na pasta base e nos arquivos de log/estado.
- Antes de usar exclusões, mantenha um backup ou snapshot do armazenamento.
