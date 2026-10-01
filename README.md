# ErsatzTV YouTube Downloader 3.4.13

Aplicativo Node.js para descobrir conteúdo do YouTube, manter uma fila persistente de downloads locais e entregar mídia pronta ao ErsatzTV.

A versão 3.4.13 amplia a **Ajuda de Scripted Schedules** com uma aba dedicada a Queries do ErsatzTV. Ela reúne, em grupos coerentes, todos os campos de pesquisa documentados para Movies, Shows, Seasons, Episodes, Artists, Music Videos, Other Videos, Songs e Images, além dos campos especiais de data e exemplos de sintaxe. O Universal permanece v1.3.1 e não há alteração no comportamento de geração/publicação dos scripts.

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
- Metadata temporal do YouTube preservada no estado (`publishedAt`/`uploadDate`, `releaseDate`, origem e ano) para novos downloads.
- NFOs novos incluem `year` + `premiered` em Movies e `aired` em episódios de Clipes musicais.
- Ação temporária **Atualizar datas e episódios** para completar datas ausentes e, em Clipes musicais, reorganizar S01E01, S01E02... pela cronologia sem reconstruir os demais metadados do NFO.
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
- Interface profissional com navegação lateral no desktop e barra móvel inferior em carrossel horizontal, com ocultação automática e reaparecimento por interação.
- Painel móvel de ações rápidas para descoberta, fila, atualização e encerramento da sessão.
- Lista de downloads convertida automaticamente em cartões no celular, sem tabela horizontal.
- Login administrativo local com senha derivada por scrypt, sessão HttpOnly, CSRF e bloqueio de tentativas.
- Scan automático da biblioteca quando a fila entra em repouso, com suporte ao header `X-Etv-Api-Key`. Reset de Playout somente por ação manual confirmada.
- Seleção de Canal do ErsatzTV por nome, carregada automaticamente por `GET /api/channels`; o número do canal fica interno.
- Integração com Smart Collections: criar nova, agregar `library_id` a uma query existente ou substituir a query.
- Validação automática da API Key do ErsatzTV por `GET /api/version`, com exibição compacta da versão conectada em Configurações.
- Área **Scripted Schedules** com vários projetos independentes, **18 tipos de módulo**, Filler opcional, motor Universal versionado e geração de Python sem edição manual de código.
- Publicação atômica dos scripts em pasta configurável, com validação, SHA-256, backup e histórico para restauração.
- Menu **Ajuda** com explicações simples, exemplos de módulos, combinações sugeridas, glossário e um guia completo de Queries do ErsatzTV.
- Limpeza manual de órfãos.
- Migração automática da configuração da versão 1.

## Requisitos

- Linux recomendado.
- Node.js 18 ou superior.
- `yt-dlp` atualizado.
- `ffmpeg` e `ffprobe`.
- Acesso de gravação à pasta definida em `paths.baseDir`.
- ErsatzTV acessível pela rede para scan automático e ações manuais da API.
- API Key do ErsatzTV quando a versão instalada exigir autenticação em `/api` (`X-Etv-Api-Key`).
- Opcional: Deno para os desafios JavaScript atuais do YouTube.
- Para usar **Scripted Schedules**: Python 3 recomendado no host do aplicativo para validar o arquivo gerado; o processo do ErsatzTV precisa conseguir executar o script e gravar seu arquivo de estado.
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

As fontes globais usam o perfil Genérico. Playlists selecionadas podem usar os mesmos três perfis de mídia de Bibliotecas e podem ter `Library ID`, **Canal no ErsatzTV** selecionado por nome, resolução, cookies e legendas próprios. Uma playlist é tratada como unidade editorial completa, inclusive quando contém vídeos publicados por outros canais.

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

Aponte o `Library ID` do aplicativo para a biblioteca local que deve receber o scan. Quando a conexão com o ErsatzTV estiver disponível, o campo **Canal no ErsatzTV** lista os canais por nome e guarda internamente o número necessário ao **Reset Playout**.

Na API do ErsatzTV v26.10.0, o aplicativo usa:

- `GET /api/version` para validar URL/API Key e mostrar a versão conectada;
- `GET /api/channels` para listar canais e mostrar seus nomes;
- `POST /api/libraries/{id}/scan` para scan da biblioteca;
- `POST /api/maintenance/empty_trash` para esvaziar a lixeira global;
- `POST /api/channels/{channelNumber}/playout/reset` para reset manual do Playout;
- `GET /api/collections/smart`, `POST /api/collections/smart/new` e `PUT /api/collections/smart/update` para Smart Collections.

Com `Library ID` preenchida, o formulário libera **Smart Collection**. É possível criar uma nova coleção com `library_id:<ID>`, agregar esse filtro à query atual ou substituir a query existente. A opção de exclusão de Smart Collection permanece fora do aplicativo. A última Smart Collection utilizada com sucesso fica armazenada por `Library ID` e aparece ao lado do seletor.

Preencha também **Configurações → ErsatzTV → API Key do ErsatzTV** quando a instalação proteger as rotas `/api`. Com URL e chave preenchidas, a tela consulta `GET /api/version` automaticamente e mostra a versão conectada ou um estado curto de falha. O aplicativo envia a chave como `X-Etv-Api-Key`.

## Scripted Schedules

A área **Scripted Schedules** é independente do downloader. Cada projeto representa um arquivo `.py` que pode ser usado por um ou mais Playouts com a mesma programação. O aplicativo salva a configuração estruturada e gera o Python a partir de um motor Universal versionado. **Novos projetos usam Universal v1.3.1**. Projetos já salvos continuam na versão de motor escolhida até o usuário usar a opção de atualização; v1.1.1, v1.2.0 e v1.3.0 permanecem disponíveis.

O editor é dividido em **Geral**, **Recursos**, **Programação**, **Revisão** e **Publicar**. Em Recursos, a ordem visual prioriza o fluxo mais comum: **Grupos de Graphics -> Presentation Profiles -> Sources -> Scripted Playlists**. O pre-roll do Presentation Profile é opcional e pode ser selecionado depois que a Scripted Playlist existir. Em Programação, o **Filler** aparece antes dos módulos porque ele é usado pelo Pad To Nearest Minute. O botão **Adicionar módulo** abre um modal com a lista de nomes à esquerda; ao selecionar um módulo, o painel direito mostra a descrição curta e as combinações sugeridas. O valor **Nenhum** nos seletores de Presentation é interno e sempre vazio; ele não aparece como perfil editável. Projetos antigos que tinham o antigo `none` vazio são limpos automaticamente ao carregar.

A **Source define o conteúdo**, não mais a ordem em que ele será percorrido. Para os tipos compatíveis com ordenação do Scripted Schedule — Smart Collection, Collection, Multi Collection, Search e Show — cada uso na Programação, no Filler, em Scripted Playlists ou como Fallback escolhe **Chronological** ou **Shuffle**. Se a mesma Source for usada com as duas ordens, o gerador registra automaticamente duas Sources internas no `.py`, uma para cada ordem, sem duplicar o cadastro na interface. **Random** e **Shuffle In Order** não são oferecidos porque a API de Scripted Schedule usada pelo projeto não suporta esses modos. Marathon continua com suas próprias opções internas de agrupamento/ordem.

Módulos disponíveis na v3.4.13:

- **Rotação por tempo**: alterna Sources por blocos de minutos.
- **Rotação por quantidade**: alterna depois de X itens.
- **Rotação por peso**: escolhe Sources por proporção.
- **Bloco contínuo por horário**: uma Source vira a programação-base a partir de um horário, sem horário de término; eventos entram no meio e depois a base volta.
- **Inserções após X itens**: exemplo 4 músicas -> 1 vinheta -> repete.
- **Encaixar até o próximo evento**: tenta ocupar o espaço disponível antes do próximo horário com itens que caibam sem corte.
- **Horário fixo · quantidade**.
- **Horário fixo · duração**.
- **Horário fixo · todos os itens**.
- **Faixa de horário · fonte única**.
- **Faixa de horário · rotação**.
- **Sequência programada**.
- **Repetição por intervalo**.
- **Escolha entre fontes**.
- **Relógio de programação**: posições repetidas em um ciclo, como :00, :15, :30 e :45.
- **Programação especial temporária**: uma Source assume entre duas datas/horas e depois a grade normal volta.
- **Evento em data específica**.
- **Janela offline**.

O **Filler** permanece separado dos módulos e é opcional. O **Tipo de Filler** pode ser escolhido entre Post-roll, Pre-roll, Mid-roll e Nenhum. **Post-roll** é o padrão e a opção recomendada para preencher lacunas e para o Pad; projetos antigos sem essa escolha salva continuam sendo tratados como Post-roll. Programações de fundo como rotações, Bloco contínuo e Inserções após X itens são alternativas de programação-base; o validador avisa quando várias bases são configuradas ao mesmo tempo. Eventos fixos podem ser colocados por cima da base usando prioridade e horários.

Os filtros de dias e datas também suportam **recorrência avançada**, incluindo primeira/segunda/terceira/quarta/última ocorrência de um dia da semana no mês e repetição a cada N dias.

Os eventos com horário marcado compatíveis com o Universal v1.3.1 têm a opção **Se o conteúdo passar do horário**. Em **Usar o horário mais próximo**, o motor consulta a duração do próximo item antes de iniciá-lo. Se esse item ultrapassaria o evento, compara quanto o evento teria de ser adiantado com quanto ele ficaria atrasado; o menor desvio vence, desde que o adiantamento não ultrapasse **Pode adiantar até**, cujo valor inicial é 40 minutos. Em **Esperar o conteúdo terminar**, o comportamento continua permitindo que o item em andamento termine antes de liberar o evento. Quando o próximo item ainda cabe antes do evento, o motor toca apenas esse item e reavalia a fronteira depois. O Universal também considera um pre-roll simples na estimativa quando a Scripted Playlist do pre-roll pode ser medida com segurança.

**Trim** e **Deixar o vídeo terminar** passam a ser mutuamente exclusivos. Se Trim estiver ligado, o gerador e o motor forçam `allow_overrun=false`, evitando pedir ao ErsatzTV ao mesmo tempo para cortar e para deixar ultrapassar o limite.

**Pad To Nearest Minute** pode ser habilitado nos módulos que o motor consegue executar **item por item**. Depois de cada item, o Filler completa até a próxima marca de 5, 10, 15 ou 30 minutos. Exemplo: filme termina 10:07 -> Filler até 10:15 -> próximo filme. Se existir um evento marcado para 10:10, o Pad termina em 10:10; as regras normais de prioridade do projeto continuam valendo.

A API de Scripted Schedule do ErsatzTV Legacy v26.10.0 oferece controle item a item para operações de **Quantidade**. Já **Duração**, **Todos os itens** e preenchimentos de **faixa de horário** são operações inteiras; não existe um ponto seguro para inserir Filler entre os itens sem mudar o significado dessas funções. Por isso o campo de Pad não aparece nesses casos. Em módulos com modo variável, ele aparece somente em **Quantidade**; em Sequência, somente quando os passos de conteúdo não usam Duração nem Todos os itens. O Filler não recebe Pad porque ele próprio é o conteúdo usado pelo alinhamento.

A pasta de saída é configurada na própria área. Projetos novos e duplicados ficam como rascunho sem identidade de arquivo definitiva. Na **primeira publicação**, o aplicativo usa o nome atual da configuração para criar o nome do `.py`, gera o `state_key` a partir desse nome e do canal escolhido, valida as referências, gera o script de forma determinística, tenta executar `python3 <script> --validate-config`, publica de forma atômica e registra hash/histórico. Depois dessa primeira publicação, arquivo e `state_key` permanecem estáveis para não quebrar um Playout já configurado.

Ao duplicar um Scripted Schedule, Recursos, Programação e opções são copiados, mas o vínculo com o canal original não é levado para a cópia. Renomeie a configuração, escolha o novo canal e publique; só então o caminho e o `state_key` passam a aparecer no Assistente de vínculo. O primeiro cadastro do caminho do Scripted Schedule no Playout continua manual, porque a API pública da v26.10.0 não expõe esse cadastro.

**Reset Playout** é uma ação separada e destrutiva. Publicar um script nunca dispara reset automaticamente.

A opção lateral **Ajuda** possui explicações simples de Recursos, Queries, todos os módulos, combinações sugeridas, publicação e termos técnicos. A aba **Queries** organiza os campos oficiais por assunto (identidade, classificação, créditos, séries, música, idiomas, datas e características técnicas), indica em quais tipos de mídia cada campo é aceito e mostra exemplos com `AND`, `OR`, `NOT`, `*`, aspas e intervalos. Os `?` contextuais continuam disponíveis diretamente ao lado dos campos; a ajuda da Source Search aponta para essa aba completa. Em **Variáveis dos Graphics**, a Ajuda deixa claro que não existe uma lista fixa: a chave deve ser a mesma usada pelo YAML/Scriban. Dados que o ErsatzTV já fornece ao Graphics, como `MediaItem_Title`, `MediaItem_Artist`, `MediaItem_Path` e `MediaItem_Duration`, são usados diretamente no YAML e não precisam ser cadastrados como variáveis personalizadas. Para os próprios Graphics Elements, use caminhos relativos como `image/watermark.yml`; se um projeto antigo tiver salvo `/image/watermark.yml`, o aplicativo remove a barra inicial automaticamente.

Os dados do builder ficam em `data/scripted-schedules/` e não alteram o `configVersion` principal da aplicação.

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

O NFO grava título, plot, `uniqueid` do YouTube e, quando disponível, `year` + `premiered` derivados da data de publicação.

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

O NFO coloca o artista em `title`, o nome do vídeo em `outline`/`plot` e, quando disponível, grava `year` + `premiered` derivados da data de publicação.

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

O artista vira o Show e a música vira o episódio. A partir da v3.4.11, a numeração por artista segue a data de publicação: o vídeo mais antigo recebe E01, o seguinte E02 e assim por diante. Quando dois vídeos têm a mesma data, o timestamp de publicação é usado quando disponível; sem data, a ordem anterior é mantida como desempate estável. O NFO do episódio recebe `aired` quando essa informação existe.

A normalização de nomes continua conservadora: casing claramente ruidoso é corrigido, enquanto grafias estilizadas como `AC/DC`, `P!NK`, `deadmau5`, `blink-182` e `CHVRCHES` são preservadas.

## Atualização temporária de datas e episódios

Na v3.4.13, cada biblioteca ainda mantém temporariamente a ação **Atualizar datas e episódios**. Ela migra o acervo anterior para a nova numeração cronológica sem recriar os NFOs.

A operação é conservadora:

- usa a YouTube Data API quando esse modo está ativo e tenta yt-dlp como fallback;
- atualiza `publishedAt`/`uploadDate`, `releaseDate`, origem e ano no estado local;
- em Clipes musicais, acrescenta `aired` somente quando ele não existe; se o NFO já possui um `aired` manual válido, essa data é preservada e passa a ter prioridade para definir a ordem;
- em Clipes musicais, corrige somente `season` e `episode` para refletir a cronologia por artista; as demais tags do NFO são preservadas;
- quando a numeração muda, renomeia MP4, NFO, thumbnail e legendas sidecar alterando apenas o trecho `SxxExx` do nome. O restante do nome do arquivo é mantido; se um nome manual não possui esse token, ele permanece intacto;
- em Genérico/Filmes, continua acrescentando `year` e `premiered` somente quando o NFO não possui nenhum desses campos de data;
- título, descrição, artista, gênero, tags e demais edições manuais não são reconstruídos nem substituídos;
- para evitar renomear arquivos enquanto o worker os manipula, a ação só inicia quando não há download ou legenda em andamento;
- quando houver Library ID configurado e algum NFO/arquivo for alterado, solicita um scan da biblioteca no ErsatzTV ao final.

O botão continua temporário enquanto a homologação da migração de mídia estiver aberta. Esta versão altera somente Scripted Schedules, portanto ele não é removido aqui para não misturar uma mudança já consolidada de downloads com este ajuste. Downloads novos já recebem a numeração cronológica automaticamente.

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
2. solicita apenas o scan usando `Library ID`, quando o scan automático está habilitado;
3. registra o resultado no estado da biblioteca.

O aplicativo não executa Reset de Playout automaticamente. **Reset Playout** é uma ação manual e destrutiva, protegida por modal de confirmação. A ação **Buscar legendas ausentes** também agrupa o trabalho e executa somente um scan ao final quando algum SRT novo foi criado.

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
data/scripted-schedules/             projetos, histórico e metadados do gerador de Scripted Schedules
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
