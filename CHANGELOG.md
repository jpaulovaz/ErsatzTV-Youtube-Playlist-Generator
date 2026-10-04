# Changelog

## 3.6.3

- O seletor **Exibir** do **Ver conteúdo** ganha as visões **Sem legendas** e **Com legendas**, disponíveis tanto para Bibliotecas quanto para Playlists selecionadas em Canais.
- **Sem legendas** mostra somente vídeos ativos sem nenhuma faixa registrada, facilitando localizar rapidamente itens que ainda precisam de tratamento.
- Ao escolher **Com legendas**, aparece ao lado o filtro **Origem da legenda** com **Todas as origens**, **YouTube**, **LRCLIB** e **Arquivo local / origem não registrada**.
- A origem é baseada no estado do Gerenciador de Legendas; arquivos antigos sem proveniência conhecida permanecem classificados com segurança como origem não registrada, sem inferir YouTube/LRCLIB.
- Vídeos com faixas de origens diferentes podem aparecer em mais de um filtro de origem, e os contadores do seletor refletem o acervo ativo.
- Aplicação **v3.6.3**; Universal **v1.3.1**; `configVersion` **9**; schema de Scripted Schedules **1**; estado persistente de downloads **5**; subtitle-manager state **1**.

## 3.6.2

- O Gerenciador de Legendas passa a destacar visualmente a legenda que está carregada em prévia no player, tanto nas faixas locais quanto nos resultados de YouTube/LRCLIB.
- O botão da faixa em teste muda de **Testar no player** para **Em teste no player**, recebe estado visual destacado e `aria-pressed=true`; ao testar outra faixa, o destaque migra imediatamente para a nova seleção.
- A linha correspondente à faixa/candidato em prévia também recebe destaque, facilitando identificar a seleção atual quando há muitos resultados abaixo do player.
- O estado visual é atualizado sem recarregar a página nem reiniciar o player ao alternar entre candidatos de pesquisa.
- Aplicação **v3.6.2**; Universal **v1.3.1**; `configVersion` **9**; schema de Scripted Schedules **1**; estado persistente de downloads **5**; subtitle-manager state **1**.

## 3.6.1

- O Gerenciador de Legendas passa a usar um seletor fechado de **Idioma desejado** com Português (Brasil) (`pt-BR`), English (`en`) e Español (`es`), eliminando a persistência acidental de novas faixas como `und`.
- A consulta manual ao YouTube respeita o idioma escolhido e filtra as faixas compatíveis antes de exibi-las; variantes regionais de inglês/espanhol são aceitas e Português (Brasil) também pode usar a faixa genérica `pt` quando necessário.
- Resultados LRCLIB continuam manuais, mas o sidecar final agora recebe sempre o idioma escolhido no seletor (`.pt-BR.srt`, `.en.srt` ou `.es.srt`), independentemente de o LRCLIB informar idioma indefinido.
- Cada legenda local ganha **Excluir legenda**. A ação remove o SRT ativo somente após confirmação e preserva antes uma cópia no histórico, permitindo restauração posterior.
- Fechar o Gerenciador de Legendas ou os detalhes do conteúdo agora pausa o player, remove sua fonte e descarrega a mídia, evitando reprodução de áudio/vídeo em segundo plano.
- **Ver conteúdo** e o Gerenciador de Legendas recebem refinamentos responsivos para mobile: cabeçalhos e ações empilhados, player limitado à altura da tela, resultados/legendas com botões adequados ao toque e controles de offset reorganizados em telas estreitas.
- Testes cobrem o idioma de destino, ausência de `.und.srt`, filtro de idiomas do YouTube, exclusão/restauração de legenda, interrupção do player e regras responsivas.
- Aplicação **v3.6.1**; Universal **v1.3.1**; `configVersion` **9**; schema de Scripted Schedules **1**; estado persistente de downloads **5**; subtitle-manager state **1**.

## 3.6.0

- **Ver conteúdo** ganha um Gerenciador de Legendas integrado com player local, disponível para Bibliotecas e Playlists selecionadas em Canais por meio do mesmo backend compartilhado.
- SRTs já existentes podem ser carregados como prévia no player, inclusive arquivos baixados anteriormente pelo fluxo do YouTube. Legendas antigas sem proveniência registrada continuam totalmente utilizáveis.
- Novo provider YouTube consulta as faixas disponíveis sob demanda e distingue legendas **enviadas pelo canal** de legendas **automáticas**; testar uma faixa não altera o sidecar ativo.
- Clipes musicais ganham provider **LRCLIB** manual, com Artista/Música/Álbum editáveis, restauração dos valores detectados, ordenação por correspondência e indicação de diferença de duração. Resultados sem letra sincronizada ou instrumentais não são aplicados.
- Preview de qualquer candidato é temporário. Somente **Aplicar** grava o SRT escolhido e a substituição de um idioma existente exige confirmação, preservando antes a versão anterior.
- Sincronização oferece offset em passos de 100 ms/1 s ou valor exato. O ajuste é imediato no player, mas somente **Salvar ajuste** regrava os timestamps do SRT.
- Novo histórico físico conserva até **cinco versões anteriores por idioma**, com restauração e criação automática de um ponto de retorno da versão atual.
- O player transmite arquivos locais por rota autenticada com suporte a **HTTP Range**. Quando o codec não é reproduzível diretamente pelo navegador, pode gerar uma prévia MP4 compatível temporária via ffmpeg.
- Novo estado independente `data/subtitle-manager-state.json` versão **1**, além de `data/subtitle-history/` e área temporária `.subtitle-preview/`; a fila de downloads continua no estado v5.
- Downloads automáticos do YouTube realizados a partir desta versão registram proveniência como **YouTube · tipo não identificado** quando o pipeline legado não consegue provar se a faixa era manual ou automática; escolhas feitas pelo novo gerenciador registram a origem precisa.
- Pesquisa YouTube continua possível quando existe `videoId` mesmo sem mídia local; preview exige mídia e aplicação exige item ativo/gravação segura. LRCLIB aparece somente no perfil Clipes musicais.
- Segurança mantém toda resolução por destino + item, impede escrita fora da raiz ativa, não expõe caminhos arbitrários ao navegador e limita/normaliza arquivos de legenda antes de processá-los.
- Aplicação **v3.6.0**; Universal **v1.3.1**; `configVersion` **9**; schema de Scripted Schedules **1**; estado persistente de downloads **5**; subtitle-manager state **1**.

## 3.5.3

- Faxina estrutural da base sem remoção de recursos atuais: código morto, fallbacks e caminhos de compatibilidade já concluídos deixam de participar da aplicação.
- A configuração passa a aceitar somente `configVersion` 9. Compatibilidades antigas de `movieMetadata`/`showMetadata` e a opção `updateExistingThumbnails` deixam de existir no código atual.
- Scripted Schedules passa a suportar somente **Universal v1.3.1**; não há upgrade silencioso nem execução dos motores 1.1.1/1.2.0/1.3.0.
- O enriquecimento de data continua ativo, mas passa para `discovery/releaseMetadataService.js`, eliminando a dependência do serviço de migração antigo.
- Clipes musicais deixam de executar resequenciamento global. Novos episódios recebem números incrementais estáveis e, numa restauração com colisão de `SxxExx`, somente o item restaurado é remapeado para o próximo episódio livre.
- Execução de processos externos é centralizada em `processUtils`; argumentos comuns do yt-dlp e movimentação entre filesystems deixam de ter implementações paralelas.
- A montagem/parsing do download yt-dlp é separada do `downloadManager`, reduzindo responsabilidades do orquestrador da fila.
- `npm run check` e `npm test` passam a descobrir automaticamente os arquivos atuais. A suíte usa diretório temporário para logs e o stub de yt-dlp não deixa mídia residual durante probes.
- `npm run verify` deixa de alterar/apagar arquivos antes dos testes e passa a validar também a consistência de versão da release.
- O exemplo systemd é generalizado e `config/config.json` passa a constar no `.gitignore`, sem alterar a configuração real da instalação.
- O pacote completo de distribuição deixa de carregar `config/config.json` pessoal e metadados `.git`; numa instalação nova, o aplicativo cria automaticamente um `config.json` v9 no primeiro start.
- Arquivos físicos que ficaram sem referências são listados em `MANUAL_CLEANUP_3.5.3.txt` para exclusão manual após a validação da nova versão.
- Aplicação **v3.5.3**; Universal **v1.3.1**; `configVersion` **9**; schema de Scripted Schedules **1**; estado persistente **5**.

## 3.5.2

- Em **Scripted Schedules**, as ações de cada item ficam agrupadas à direita: **Duplicar item** passa a ficar imediatamente ao lado de **Remover**, mantendo a duplicação como ação neutra e a remoção como destrutiva.
- Removida a ação manual obsoleta **Atualizar thumbnails** das Bibliotecas e das Playlists de Canais. Também foram removidos seus handlers HTTP/UI e o método de manutenção `refreshThumbnails()` do downloader.
- O fluxo normal de download **continua salvando thumbnails/artwork**. A configuração **Atualizar thumbnails existentes** foi preservada porque ainda controla se uma thumbnail já existente pode ser substituída durante a finalização normal de um download.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 9, schema de Scripted Schedules 1, estado persistente 5 ou formato salvo dos projetos.

## 3.5.1

- Cada item principal dos módulos de **Scripted Schedules** passa a oferecer **Duplicar item** ao lado da ação de remoção, facilitando repetir blocos e alterar somente horário, Source, biblioteca, filtros ou outra característica necessária.
- A duplicação é profunda: estruturas internas de **Sequência programada**, **Escolha entre fontes**, **Relógio de programação** e **Faixa de horário · rotação** são copiadas integralmente sem compartilhar arrays/objetos com o item original.
- Itens que usam ID recebem automaticamente um identificador único no projeto inteiro: `id_copy`, depois `id_copy_2`, `id_copy_3` e assim por diante. Módulos simples que não possuem ID continuam sendo copiados literalmente.
- Quando existe **Nome opcional**, a cópia recebe o sufixo **(cópia)**. Horários, Sources, prioridades, recorrências, Presentation, Pad, Trim, Filler, fallback, watermarks e demais campos permanecem iguais ao original.
- A cópia é inserida imediatamente depois do item original, abre automaticamente para edição e mantém o módulo correspondente aberto. A ação **Duplicar item** é neutra à esquerda; **Remover** permanece separada como ação destrutiva à direita.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 9, schema de Scripted Schedules 1, estado persistente 5 ou formato salvo dos projetos.

## 3.5.0

- Bibliotecas e Playlists selecionadas em Canais ganham a política **Arquivos órfãos** com três modos: **Excluir automaticamente**, **Marcar como órfão** e **Mover para quarentena recuperável**.
- Destinos existentes são migrados para **Marcar como órfão**, preservando o comportamento da v3.4.17; destinos novos exigem escolha explícita antes de salvar.
- O modo de quarentena oferece retenção **Nunca / 30 / 90 / 180 dias** e move MP4, NFO, artwork e SRTs como um pacote para fora da raiz ativa do ErsatzTV. Movimentos usam rename no mesmo filesystem e fallback copy/validação/delete em `EXDEV`, sem sobrescrever conflitos de restauração.
- A reconciliação passa a distinguir descoberta **autoritativa** de resultado parcial. Timeout, saída parcial do yt-dlp, `ERROR:` em stderr, fonte/paginação incompleta ou falha em uma das fontes de um destino multi-fonte nunca podem inferir ausência, excluir ou mover conteúdo naquele ciclo.
- O estado persistente separa presença na fonte, intenção do usuário e armazenamento por meio de `sourceActive`, `userDisposition` (`managed`/`keep`/`ignored`) e `storageState` (`active`/`quarantined`/`absent`). `suppressed` continua reservado ao comportamento da fila.
- **Ver conteúdo** deixa de ser somente leitura e passa a oferecer visões **Conteúdo**, **Órfãos**, **Quarentena** e **Ignorados**, com ações contextuais como **Excluir e ignorar**, **Reativar**, **Restaurar e manter**, **Enviar para quarentena** e **Excluir definitivamente**.
- Itens ignorados mantêm um tombstone lógico mesmo depois de os bytes da quarentena expirarem, impedindo redownload até **Reativar**. Se reativados fora da fonte, podem voltar como `keep`; quando um item `keep` reaparece na fonte, retorna automaticamente a `managed`.
- **Limpar órfãos** passa para o grupo Conteúdo e só aparece em política `mark` quando existem órfãos; **Recuperar órfãos** só aparece em política `quarantine` quando há itens recuperáveis.
- Playlists de Canal reutilizam o mesmo gerenciador **Ver conteúdo** e os mesmos serviços internos; fontes globais do Canal permanecem fora da política configurável nesta versão.
- Clipes musicais preservam `tvshow.nfo`/`poster.jpg` enquanto ainda houver episódio ativo/mantido. Restaurações tratam colisões de `SxxExx` com caminho temporário seguro e resequenciamento cronológico posterior.
- A ação temporária **Atualizar datas e episódios** é removida da interface, rota e código de migração. `releaseDateService` e o resequenciamento normal de Clipes continuam no pipeline de descoberta/download e nas restaurações.
- `configVersion` sobe para **9** e o estado persistente para **5**. Universal permanece **v1.3.1** e o schema de Scripted Schedules permanece **1**.

## 3.4.17

- **Título customizado** nos Scripted Schedules ganha a opção **Agrupar itens no EPG usando este título**.
- Com a opção desligada, o comportamento anterior é preservado: `customTitle` apenas substitui o título de cada entrada individual.
- Com a opção ligada, o gerador não envia `customTitle` por item e converte a intenção para o agrupamento nativo já suportado pelo Universal: `epg_group=True`, `epg_title=<Título customizado>` e `epg_advance=True`.
- O agrupamento existente em **Presentation Profiles -> Agrupar no EPG** permanece disponível e independente.
- A validação rejeita o novo agrupamento quando o campo Título customizado está vazio.
- Universal permanece v1.3.1; `configVersion` permanece 8; schema de Scripted Schedules permanece 1; estado da fila permanece 4.

## 3.4.16

- Corrigida a regressão visual da v3.4.15 em que o título, embora presente no HTML, podia não aparecer abaixo da thumbnail. O card deixa de ser um único botão: somente a imagem é clicável e o bloco de título/metadados fica estruturalmente separado logo abaixo.
- Thumbnails dos vídeos/episódios permanecem em proporção **16:9**, inclusive no layout móvel, refletindo o frame widescreen do conteúdo.
- Posters exibidos no primeiro nível da Biblioteca passam a usar proporção vertical **2:3**, adequada ao artwork de artista/Show, sem alterar a imagem armazenada nem o `showPosterPath`.
- A validação de interface passa a conferir a separação estrutural entre botão da thumbnail e título, além das proporções 16:9 e 2:3, evitando que esse tipo de regressão volte a passar apenas por teste textual.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 8, schema de Scripted Schedules 1, estado da fila 4, APIs read-only do navegador ou mecanismo de download.

## 3.4.15

- O navegador de conteúdo passa a exibir explicitamente o **título de cada vídeo logo abaixo da thumbnail**, mantendo o painel de detalhes no clique como complemento.
- A lista de pastas de primeiro nível passa a aproveitar o `showPosterPath` já conhecido pelo estado dos Clipes musicais e exibe o poster disponível ao lado do nome do artista.
- Posters de artistas são servidos por uma rota read-only baseada no ID de um item conhecido. O backend resolve `showPosterPath` internamente e rejeita arquivos fora da raiz da Biblioteca, sem expor caminhos absolutos ao navegador.
- Corrigida a sobreposição do placeholder **Sem imagem**: o texto desaparece assim que a thumbnail ou poster conclui o carregamento e permanece somente quando não existe imagem válida ou o carregamento falha.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 8, schema de Scripted Schedules 1, estado da fila 4 ou mecanismo de download.

## 3.4.14

- Bibliotecas passam a ter **Conteúdo -> Ver conteúdo**, abrindo um navegador de acervo dentro da própria área sem misturar thumbnails com a sanfona de configuração.
- A navegação usa o caminho real de cada vídeo relativo à raiz da Biblioteca. Assim, Clipes musicais aparecem como Artista -> Season 01 -> vídeos, Filmes como Artista -> pasta do filme -> vídeo e o perfil Genérico como Artista -> vídeos, sem criar categorias paralelas.
- O acervo mostra apenas itens concluídos/com mídia local conhecida e usa o estado persistente para identidade, duração, tamanho e Video ID.
- Quando existe NFO, o navegador o lê em modo somente de leitura e prefere seus campos para título, artista do Show, temporada/episódio e data. Correções manuais aparecem na interface sem reconstruir ou alterar o NFO.
- A pesquisa percorre toda a Biblioteca por título, artista, `SxxExx`, Video ID e caminho relativo. A listagem usa páginas de 60 vídeos e thumbnails com `loading=lazy`.
- Os cards abrem um painel de detalhes read-only com título, artista, data, episódio, duração, caminho relativo, tamanho, legendas registradas e Video ID.
- A nova rota de thumbnail recebe apenas o ID de um item conhecido, resolve o arquivo internamente e rejeita caminhos que escapem da raiz da Biblioteca. Caminhos absolutos do servidor não são enviados ao navegador.
- A Ajuda -> Queries deixa de exibir o bloco **Remote Streams**, removendo uma observação de desenvolvimento que não era útil ao usuário final. Os 46 campos documentados e os exemplos de Query permanecem.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 8, schema de Scripted Schedules 1, estado da fila 4 ou mecanismo de download.

## 3.4.13

- A Ajuda de Scripted Schedules ganha a aba **Queries**, dedicada às Sources do tipo Search.
- O guia reúne todos os campos de busca documentados pelo ErsatzTV Legacy e os separa por assunto: identidade/organização, conteúdo/classificação, pessoas/origem, séries/episódios, música, áudio/legendas, datas e características técnicas.
- Cada campo recebe uma explicação curta e a indicação dos tipos de mídia em que é aceito, evitando uma lista solta sem contexto.
- A Ajuda inclui os campos especiais `released_inthelast`, `released_notinthelast`, `released_onthisday`, `added_inthelast` e `added_notinthelast`, além de exemplos de `AND`, `OR`, `NOT`, `*`, aspas e intervalo de datas.
- O campo Query da Source Search passa a apontar diretamente para **Ajuda → Queries**.
- Remote Streams recebem uma observação própria: a documentação Legacy informa que são pesquisáveis, mas não enumera campos específicos; por isso a Ajuda não inventa parâmetros não documentados.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 8, schema de Scripted Schedules 1, estado da fila 4 ou comportamento do módulo de downloads.

## 3.4.12

- A identidade de publicação de um Scripted Schedule deixa de ser definida no momento em que o rascunho é criado. Projetos novos e duplicados ficam sem `fileName` e `state_key` definitivos até a primeira publicação.
- Na primeira publicação, o nome do arquivo `.py` é derivado do **nome atual da configuração** e cada `state_key` é derivado desse nome + canal escolhido. Assim, renomear uma cópia antes de publicar não mantém mais o nome do canal original nem o sufixo `-copia` no arquivo/state.
- Depois da primeira publicação, `fileName` e `state_key` permanecem estáveis nas publicações seguintes para não quebrar um Playout já configurado. O nome visual do projeto pode continuar sendo alterado sem renomear silenciosamente a identidade já publicada.
- Ao duplicar uma configuração, programação, Recursos e opções são copiados, mas o vínculo com o canal original é limpo. Isso evita que uma cópia destinada a outro canal carregue por engano o canal/state da origem.
- Rascunhos anteriores à v3.4.12 que ainda não foram publicados ignoram a identidade provisória antiga ao abrir: o arquivo e o `state_key` serão definidos somente na primeira publicação.
- A interface mostra uma mensagem curta enquanto o projeto é rascunho e só exibe caminho final/state_key depois que o arquivo realmente foi publicado. A mensagem desaparece após a primeira publicação.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 8, schema de Scripted Schedules 1, estado da fila 4 ou módulo consolidado de downloads. O botão temporário **Atualizar datas e episódios** permanece disponível enquanto a homologação da migração de mídia não for encerrada.

## 3.4.11

- **Clipes musicais (Seriados)** passam a numerar episódios pela cronologia de publicação de cada artista, em vez da ordem em que os vídeos foram descobertos. O mais antigo recebe E01, o seguinte E02 e assim por diante.
- Quando existe um `aired` válido já editado manualmente no NFO, essa data local é preservada e tem prioridade sobre a data do YouTube para definir a posição cronológica.
- A numeração é recalculada também para novos downloads antes da conclusão do arquivo, mantendo `season=1` e ajustando o `episode` correspondente. Itens sem data ficam depois dos itens datados e preservam a ordem anterior como desempate estável.
- Quando uma renumeração altera arquivos já existentes, MP4, NFO, thumbnail e legendas SRT sidecar são renomeados em duas fases para evitar colisões. Somente o trecho `SxxExx` do nome é modificado; o restante do nome do arquivo é preservado. Nomes manuais sem esse token não são renomeados.
- O botão temporário passa a se chamar **Atualizar datas e episódios**. Além do backfill de data da v3.4.10, ele corrige `season`/`episode` nos NFOs de Clipes musicais e renomeia os arquivos correspondentes. Para evitar disputa de arquivos, a migração recusa iniciar enquanto há download ou legenda em andamento.
- O backfill continua sem reconstruir NFOs: título, plot, gênero, tags e demais edições manuais permanecem intocados. Datas manuais existentes continuam sem ser substituídas.
- O botão temporário permanece por mais esta versão para permitir a migração da numeração cronológica e fica previsto para remoção na próxima versão após homologação.
- Nenhuma alteração no Universal v1.3.1, `configVersion` 8, schema de Scripted Schedules 1, estado da fila 4, ffmpeg/transcode, deduplicação ou política de órfãos.

## 3.4.10

- Downloads novos passam a preservar metadata temporal do YouTube no estado local: `publishedAt` quando disponível, `uploadDate` no fallback do yt-dlp, `releaseDate`, `releaseDateSource` e `year`.
- A data de publicação é normalizada como `releaseDate` sem tratá-la como uma verdade editorial externa: a origem fica marcada como `youtube`.
- NFOs novos passam a gravar `year` + `premiered` nos perfis Genérico/Filmes e `aired` em Clipes musicais (Seriados), permitindo que o ErsatzTV tenha uma data utilizável para ordenação cronológica.
- Quando a descoberta não trouxe uma data exata, o fluxo de download consulta a metadata antes de escrever o NFO: YouTube Data API quando o modo API está ativo, com fallback para yt-dlp. Falha nesse enriquecimento não transforma o download do vídeo em falha.
- Bibliotecas recebem temporariamente a ação **Atualizar datas dos NFOs** para o acervo já existente. A ação busca a data e acrescenta somente os campos de data ausentes; não regrava título, plot, artista, gênero, temporada, episódio nem outras edições manuais.
- Se um NFO já contém `aired`, `year` ou `premiered` inserido manualmente, o backfill preserva essa informação e não substitui pela data do YouTube.
- O backfill altera somente NFOs de vídeos concluídos da biblioteca escolhida, persiste a nova metadata no estado e solicita um scan do ErsatzTV quando a biblioteca possui Library ID configurado.
- O botão de backfill é deliberadamente temporário e deve ser removido na versão seguinte, depois da janela de homologação/migração.
- Nenhuma alteração no motor Universal v1.3.1, `configVersion` 8, schema de Scripted Schedules 1, fila, deduplicação ou política de órfãos.

## 3.4.9

- Adiciona o motor **Universal v1.3.1** com política configurável para eventos com horário marcado.
- **Usar o horário mais próximo** consulta `peek_next` antes de iniciar o próximo item. Se o item cruzaria o horário do evento, compara o adiantamento com o atraso e escolhe o menor desvio.
- O limite **Pode adiantar até (min)** vem com 40 minutos e pode ser alterado pelo usuário. Se adiantar excederia esse limite, o conteúdo segue e o evento aguarda.
- Quando o próximo item cabe antes do evento, o motor adiciona somente esse item e reavalia a fronteira depois, evitando perder o controle dentro de uma operação longa do ErsatzTV.
- A estimativa inclui pre-roll quando a Scripted Playlist pode ser medida com segurança; em cenários que não podem ser estimados com fidelidade, o motor preserva o comportamento anterior em vez de adivinhar.
- A decisão é aplicada às programações de fundo e às tarefas não atômicas que podem alcançar um evento futuro de prioridade maior. Blocos atômicos continuam sem preempção.
- **Trim** e **Deixar o vídeo terminar** tornam-se mutuamente exclusivos na interface, no gerador e no runtime; Trim força `allow_overrun=false`.
- Pad To Nearest limitado por um evento marcado força `allow_overrun=false` no Filler para não empurrar o evento além da fronteira.
- `STATE_VERSION` do Universal v1.3.1 passa para 12. Universal v1.1.1, v1.2.0 e v1.3.0 permanecem disponíveis sem alteração e sem upgrade silencioso.
- `configVersion` permanece 8 e o schema de armazenamento de Scripted Schedules permanece 1.

## 3.4.8

- A ordem de reprodução deixa de pertencer ao cadastro da Source e passa a ser definida em cada uso da Source na Programação, Filler, Scripted Playlists e Fallbacks.
- Smart Collection, Collection, Multi Collection, Search e Show oferecem **Chronological** ou **Shuffle** diretamente no bloco em que são usados. A mesma Source pode usar ordens diferentes em momentos diferentes sem precisar ser duplicada na interface.
- O gerador compila cada combinação Source + ordem em uma Source interna independente para o ErsatzTV, por exemplo `MOVIES__CHRONOLOGICAL` e `MOVIES__SHUFFLE`, somente quando aquela variante é realmente necessária.
- O campo genérico de ordem é removido do cadastro das Sources. Marathon continua com suas opções próprias de ordem/agrupamento, pois é um tipo de Source separado.
- Projetos de homologação que ainda tenham `source.order` antigo não preservam essa configuração como regra de reprodução: o campo é descartado e usos sem ordem explícita passam a **Shuffle**. Isso evita manter uma segunda arquitetura obsoleta em paralelo.
- A interface e a Ajuda explicam que a Source define **qual conteúdo** será usado e a Programação define **como ele será percorrido**.
- Random e Shuffle In Order continuam fora da interface porque não são modos suportados pela API de Scripted Schedule usada pelo projeto.
- Universal permanece v1.3.0; `configVersion` e o schema de armazenamento de Scripted Schedules não mudam.

## 3.4.7

- Corrige Graphics Elements que não apareciam quando o caminho havia sido salvo com `/` no início, como `/image/watermark.yml`.
- O aplicativo passa a normalizar automaticamente caminhos de Graphics de grupos e de Presentation Profiles para o formato relativo usado pelo ErsatzTV, como `image/watermark.yml`. A normalização ocorre ao carregar/salvar o projeto e também na geração do script como proteção extra.
- Barras invertidas também são convertidas para `/`, evitando diferenças de formato entre ambientes.
- A Ajuda contextual e a área Ajuda deixam explícito que o caminho do Graphics Element não deve começar com `/`.
- Projetos já existentes não precisam ser editados manualmente: ao abrir, os caminhos já são normalizados em memória e, no próximo salvamento, ficam gravados no formato correto.
- Nenhuma alteração em `configVersion`, schema de projetos, Universal v1.3.0, módulos, Pad, Filler, Canais, Bibliotecas, fila ou downloads.

## 3.4.6

- O Presentation Profile interno `none` deixa de aparecer na lista de perfis. Para o usuário, **Nenhum** continua disponível somente nos seletores de Presentation.
- Novos Scripted Schedules não armazenam mais um cartão `none`; o gerador cria automaticamente um perfil vazio e imutável para o motor.
- Projetos antigos com o `none` padrão são normalizados sem intervenção. Se uma versão anterior tiver permitido configurar conteúdo dentro de `none`, essas configurações são preservadas em um Presentation Profile visível chamado **Perfil antigo**, e as referências existentes são atualizadas para ele.
- A chave `none` passa a ser reservada de verdade: um perfil criado pelo usuário não pode usar essa chave.
- Contadores de Presentation Profiles passam a mostrar apenas os perfis realmente criados pelo usuário.
- A Ajuda explica de forma curta que **Nenhum** significa simplesmente não aplicar um Presentation Profile.
- Nenhuma alteração em `configVersion`, schema de projetos, Universal v1.3.0, Pad, Filler, Canais, Bibliotecas, fila ou downloads.

## 3.4.5

- O **Filler geral** volta a permitir a escolha do **Tipo de Filler**, agora em um picklist compacto em vez de campo de texto livre. As opções são **Post-roll**, **Pre-roll**, **Mid-roll** e **Nenhum**.
- **Post-roll** continua sendo o padrão e aparece como recomendado para preencher lacunas e para o Pad. Projetos antigos que ainda não possuem `fillerKind` salvo continuam sendo tratados como Post-roll.
- O gerador passa a respeitar a escolha feita no Filler geral e aceita somente os quatro valores suportados pelo Scripted Schedule usado pelo projeto.
- Campos avançados de **Tipo de Filler** também usam o mesmo seletor controlado, evitando digitação de valores inválidos.
- Foram removidos textos redundantes da interface: a observação abaixo da pasta de saída, o chip de EPG no Filler e o chip **Programação-base** da aba Programação.
- Textos contextuais de Scripted Schedules foram revisados para soar mais naturais e diretos, inclusive as orientações de vínculo/publicação com o Playout.
- A Ajuda de **Variáveis dos Graphics** foi ampliada sem inventar uma lista fixa: as chaves são definidas pelo próprio YAML/Scriban. A Ajuda também diferencia essas variáveis personalizadas dos dados que o ErsatzTV já fornece ao Graphics, como `MediaItem_Title`, `MediaItem_Artist`, `MediaItem_Path` e `MediaItem_Duration`.
- Nenhuma alteração em `configVersion`, schema de projetos, Universal v1.3.0, Pad por item, Canais, Bibliotecas, fila ou downloads.

## 3.4.4

- A ordem de **Recursos** foi revisada para reduzir idas e voltas: **Grupos de Graphics -> Presentation Profiles -> Sources -> Scripted Playlists**. Presentation Profiles ficam logo após Graphics, permitindo que uma nova Source já escolha sua Presentation padrão.
- Como o pre-roll depende de uma Scripted Playlist, ele passa a ficar em uma área opcional dentro do Presentation Profile; se a playlist ainda não existir, a interface orienta a voltar depois sem bloquear a criação do perfil.
- Na aba **Programação**, o **Filler** passa a aparecer antes dos módulos, pois ele precisa existir antes de liberar Pad To Nearest Minute.
- O Filler geral é marcado automaticamente como `postroll` no payload do ErsatzTV. Assim, o conteúdo usado para preencher lacunas é tratado como filler para o EPG, em vez de criar uma entrada própria no guia.
- O campo técnico **Filler kind** deixa de aparecer no Filler geral; essa marcação passa a ser responsabilidade do aplicativo. O campo continua disponível onde faz sentido em reprodução avançada de outros conteúdos.
- O modal **Adicionar módulo** ganha espaçamento entre os cards **Combina bem com** e **Pad To Nearest Minute**, eliminando a junção visual entre os dois blocos.
- A Ajuda foi alinhada à nova ordem de configuração e ao comportamento do Filler no EPG.
- A ajuda contextual antiga do Pad foi corrigida para descrever o comportamento por item já implantado na v3.4.3.
- Nenhuma alteração em `configVersion`, schema de projetos, Universal v1.3.0, Canais, Bibliotecas, fila ou downloads.

## 3.4.3

- **Pad To Nearest Minute** passa a significar alinhamento **entre os itens**, e não depois do bloco inteiro. Exemplo: 3 filmes com Pad de 15 minutos executam filme -> Filler até a próxima marca -> filme -> Filler -> filme -> Filler.
- O Pad não ultrapassa um horário programado: se outro evento começa antes da próxima marca, o Filler para nesse horário. As regras existentes de prioridade entre tarefas permanecem inalteradas.
- A API de Scripted Schedule incluída no ErsatzTV Legacy v26.10.0 foi usada como referência. Operações de **Quantidade** podem ser executadas item a item; operações nativas de **Duração**, **Todos os itens** e preenchimento de **faixa** são enviadas como uma única operação e, por segurança, não oferecem Pad por item.
- **Horário fixo · todos os itens** deixa de mostrar Pad To Nearest. A mesma regra vale para módulos baseados em duração/faixa.
- Módulos com modo variável mostram Pad somente em **Quantidade**. Em Sequência, o Pad fica disponível quando os passos de conteúdo não usam Duração nem Todos os itens.
- O modal Adicionar módulo e a Ajuda foram atualizados com explicações curtas e simples sobre onde o Pad está disponível.
- Nenhuma alteração em configVersion, schema de projetos, Canais, Bibliotecas, fila ou downloads.

## 3.4.2

- A compatibilidade de **Pad To Nearest Minute** foi revisada nos 18 módulos do Scripted Schedules.
- O modal **Adicionar módulo** agora avisa de forma curta quando o Pad não se aplica e explica os dois casos em que a configuração fica dentro das etapas/posições: **Faixa de horário · rotação** e **Relógio de programação**.
- A Ajuda recebeu as mesmas observações em linguagem simples, sem transformar cada cartão em documentação técnica.
- **Bloco contínuo por horário**, **Encaixar até o próximo evento** e **Janela offline** continuam sem opção de Pad porque o alinhamento não se aplica ao funcionamento desses módulos.
- **Horário fixo · todos os itens** permanece compatível com Pad: o preenchimento começa somente depois que todos os itens terminarem. A característica de esse módulo poder atravessar outro horário continua separada e inalterada.
- A explicação geral do Pad agora deixa claro que ele atua ao fim do bloco configurado: se um bloco toca 3 itens, o Pad entra depois do terceiro, não entre eles.
- Nenhuma alteração no schema, Universal v1.3.0, API ou lógica de geração/execução do Pad; a correção é de apresentação, documentação e cobertura de regressão.

## 3.4.1

- A opção **Ajuda** de Scripted Schedules deixa de aparecer em **Sistema** e passa a ficar junto de **Scripted Schedules** no grupo lateral **Programação**, deixando claro que o conteúdo é específico do Builder.
- A própria tela de Ajuda passa a se identificar como **Programação · Scripted Schedules**, evitando a aparência de manual geral do aplicativo.
- O modal **Adicionar módulo** foi reorganizado: a coluna esquerda agora mostra somente os nomes dos módulos; resumo, funcionamento e combinações ficam exclusivamente no painel direito após a seleção.
- A lista de módulos ganhou largura previsível, quebra de nomes longos, rolagem apenas vertical e proteção contra overflow horizontal; o painel de detalhes ocupa o espaço restante.
- Nenhuma alteração em schema, Universal v1.3.0, gerador Python, API, fila, downloads, Canais ou Bibliotecas.
- Testes de regressão cobrem o agrupamento da Ajuda e a estrutura compacta do modal de módulos; suíte completa aprovada em **108/108 testes**.

## 3.4.0

- **Scripted Schedules** passa a usar o motor **Universal v1.3.0** em novos projetos e em upgrades manuais. Projetos existentes em v1.1.1/v1.2.0 continuam na versão já salva até o usuário escolher atualizar o motor.
- O Builder passa de 10 para **18 tipos de módulo**, mantendo o Filler separado e opcional.
- Novos módulos: **Rotação por quantidade**, **Rotação por peso**, **Bloco contínuo por horário**, **Inserções após X itens**, **Encaixar até o próximo evento**, **Escolha entre fontes**, **Relógio de programação** e **Programação especial temporária**.
- Filtros de dias/datas ganham **recorrência avançada**: primeira/segunda/terceira/quarta/última ocorrência de um dia da semana no mês e repetição a cada N dias.
- O novo **Bloco contínuo por horário** permite definir a programação-base somente por horários de início; eventos fixos entram temporariamente e, ao terminar, a programação-base vigente volta.
- **Encaixar até o próximo evento** usa operações suportadas pelo Scripted Schedule do ErsatzTV para tentar escolher conteúdo que caiba antes do próximo horário, sem cortar o item; o Filler pode completar o pequeno restante quando configurado.
- Os nomes mostrados na interface foram revisados para linguagem mais descritiva, mantendo as chaves internas compatíveis.
- **Adicionar módulo** agora abre um modal com a lista de módulos, resumo curto e indicação de combinações úteis antes da inclusão.
- Nova área lateral **Ajuda**, com abas Começando, Recursos, Módulos, Combinações, Publicar e Glossário, escrita em linguagem simples e com exemplos práticos.
- A Ajuda diferencia programação-base, Filler, Pad To Nearest Minute, Fallback Source, Filler kind, prioridade e demais conceitos que costumam gerar dúvida.
- Clicar em qualquer opção do menu lateral agora sempre volta ao início daquela seção. Scripted Schedules fecha o editor e volta à lista de projetos; Canais fecha a edição; Bibliotecas/Configurações recolhem sanfonas; Ajuda volta à primeira aba; Logs são recarregados.
- O seletor modal também aceita `Esc` para fechar e devolve o foco ao botão de origem.
- O validador avisa quando mais de uma programação-base é configurada ao mesmo tempo, evitando que uma base esconda outra sem o usuário perceber.
- `configVersion` permanece 8 e o schema do armazenamento de Scripted Schedules permanece 1; UPDATE continua preservando `config/` e `data/`.
- **108 testes automatizados** aprovados na árvore de desenvolvimento.

## 3.3.1

- Toda a área **Scripted Schedules** ganha ajuda contextual discreta nos campos de configuração.
- Um pequeno `?` ao lado do rótulo mostra explicações em linguagem simples ao passar o mouse, focar pelo teclado ou tocar no ícone.
- As ajudas cobrem Geral, Recursos, opções globais, módulos, filtros de dias/datas, Filler e Reprodução avançada.
- Campos técnicos como **Filler kind**, **Fallback Source**, **Tentativas descartadas**, **Trim**, **Offline tail** e **Pad To Nearest Minute** agora explicam o efeito prático e quando deixar a opção vazia/desativada.
- Campos compostos que antes apareciam apenas como controles em linha (GUIDs, itens de Scripted Playlist, rotação em janela, passos de sequência e variáveis de Graphics) passam a exibir rótulos curtos com ajuda contextual.
- Nenhuma alteração no schema, motor Universal v1.2.0, gerador Python ou comportamento da programação.
- 102 testes automatizados aprovados para a v3.3.1.

## 3.3.0

- Scripted Schedules ganha **Pad To Nearest Minute** opcional por bloco/evento nos módulos de conteúdo.
- Marcas suportadas: 5, 10, 15 e 30 minutos, sempre desativadas por padrão.
- O pós-bloco reutiliza o Filler do projeto; não exige Filler duplicado por regra de alinhamento.
- A interface só libera a configuração quando existe Filler e o motor do projeto é Universal v1.2.0.
- O backend e o próprio script gerado validam a mesma regra para impedir publicação inconsistente.
- Ao desativar o Filler, alinhamentos configurados no projeto também são desativados para manter a configuração válida.
- OFFLINE_WINDOWS e Filler continuam sem Pad To Nearest Minute.
- Projetos existentes no Universal v1.1.1 permanecem publicáveis sem atualização silenciosa; a aba Geral oferece atualização manual para v1.2.0.
- Universal v1.2.0 preserva prioridades e não usa o padding para atrasar um evento que já esteja aguardando ou comece antes da próxima marca.
- 101 testes automatizados aprovados para a v3.3.0.

## 3.2.1

- Recursos do builder de Scripted Schedules agora usam sanfonas por categoria e por item, deixando a edição de projetos grandes mais compacta.
- Programação ganhou sanfonas para opções globais, módulos, itens de módulos e Filler.
- Estado aberto/fechado das sanfonas é preservado durante rerenders da interface, inclusive em campos que alteram dinamicamente o formulário.
- Novos itens e módulos são abertos automaticamente logo após a criação.
- Abas Recursos e Programação agora têm ações de **Validar** e **Salvar e publicar** no final da tela, evitando voltar ao topo para concluir uma edição.
- Nenhuma alteração de schema, gerador Python, API ou comportamento dos downloads/canais/bibliotecas.

## 3.2.0

- Nova área isolada **Scripted Schedules** para criar e manter vários scripts sem editar Python manualmente.
- Builder baseado no motor **Scripted Schedule Universal v1.1.1**, com a configuração visual/JSON como fonte de verdade e o `.py` como artefato gerado.
- Suporte aos 10 módulos do motor: Rotation, Horário + quantidade, Horário + duração, Todos os itens, Janela, Rotação em janela, Sequência, Intervalo, Data específica e Offline, além de Filler opcional.
- Todos os módulos são opcionais e podem ser combinados conforme o canal.
- Recursos reutilizáveis para grupos de Graphics, Sources, Scripted Playlists e Presentation Profiles.
- Smart Collections e Canais do ErsatzTV são carregados pelo nome usando as integrações existentes; Collections, Multi-Collections e Playlists continuam com identificação manual quando a API pública não permite listagem.
- Vínculos locais de canal guardam `state_key` próprio e oferecem assistente com caminho do script e dados para o primeiro cadastro manual no Playout do ErsatzTV.
- **Reset Playout** permanece exclusivamente manual, com modal destrutivo; salvar/publicar um script nunca executa reset automaticamente.
- Pasta de publicação configurável, restrição contra path traversal, geração determinística, validação por Python quando disponível, escrita atômica, bit executável, SHA-256 e backup do arquivo anterior.
- Histórico de configurações com retenção configurável e restauração que republica o script.
- Persistência isolada em `data/scripted-schedules/`, com `schemaVersion: 1`; o `configVersion` principal permanece em 8.
- Pacote UPDATE continua preservando `config/config.json`, `config/auth.json` e toda a pasta `data/`.
- 95 testes automatizados aprovados.

## 3.1.1

- Smart Collection usada com sucesso passa a ser lembrada por `Library ID`.
- O seletor de Smart Collection fica mais compacto e mostra ao lado a última coleção utilizada.
- O histórico é atualizado somente após criação, agregação ou substituição concluída com sucesso.
- Se a Smart Collection for renomeada no ErsatzTV, a interface prefere o nome atual retornado pelo catálogo.
- Configurações valida automaticamente URL + API Key do ErsatzTV com `GET /api/version` e mostra a versão conectada sem expor a chave.
- Falhas de autenticação e indisponibilidade do ErsatzTV aparecem como estado compacto ao lado da API Key.
- 87 testes automatizados aprovados.

## 3.1.0

- Canais do ErsatzTV passam a ser carregados por `GET /api/channels` e exibidos pelo nome; o número fica interno para Reset Playout.
- `Library ID` continua manual, pois a v26.10.0 não expõe listagem pública de Libraries.
- Bibliotecas e playlists de Canais com `Library ID` passam a oferecer integração com Smart Collections.
- Smart Collections existentes são listadas por nome via `GET /api/collections/smart`.
- Nova Smart Collection pode ser criada com query `library_id:<ID>` via `POST /api/collections/smart/new`.
- Em coleção existente, **Agregar** relê a query atual antes do `PUT`, preserva a expressão e adiciona `OR (library_id:<ID>)`; IDs já presentes não são duplicados.
- **Substituir** troca deliberadamente a query por `library_id:<ID>` via `PUT /api/collections/smart/update`.
- API Key do ErsatzTV permanece somente no backend do aplicativo.
- Modal interno passa a suportar escolha secundária e entrada simples, mantendo o padrão visual do aplicativo.
- Schema de configuração atualizado para v7 para persistir o nome do Canal do ErsatzTV junto ao número interno.
- 82 testes automatizados aprovados.

## 3.0.3

- Integração com ErsatzTV alinhada à API oficial da v26.10.0.
- A ação manual de Playout passa a usar `POST /api/channels/{channelNumber}/playout/reset`.
- O campo **Playout ID** é substituído por **Número do canal** nas Bibliotecas e playlists de Canais.
- O antigo valor de Playout ID não é convertido automaticamente para Número do canal, evitando reset no canal errado.
- O reset automático de Playout ao esvaziar a fila foi removido; a automação de repouso mantém apenas o scan da biblioteca.
- **Reset Playout** passa a exigir confirmação em modal próprio do aplicativo e informa que o progresso pode ser perdido.
- **Limpar lixo** passa a usar `POST /api/maintenance/empty_trash`, ação global da API do ErsatzTV.
- Confirmações nativas do navegador (`confirm`/`prompt`) foram substituídas por modais internos, incluindo confirmações digitadas para exclusões destrutivas.
- Schema de configuração atualizado para v6.
- 75 testes automatizados aprovados.

## 3.0.2

- Navegação inferior no celular passa a usar uma única linha horizontal em formato de carrossel, sem quebra de itens.
- A barra móvel se oculta ao rolar a página para baixo e reaparece ao rolar para cima.
- Toques e gestos que não continuam a rolagem para baixo tornam a barra visível novamente.
- Após alguns segundos sem interação, a barra volta a se ocultar automaticamente.
- O item de navegação ativo é centralizado no carrossel quando necessário.
- Mantido o espaço seguro no rodapé e o suporte a `safe-area`, evitando sobreposição de conteúdo.
- Nenhuma alteração em schema, fila, worker, regras de download ou armazenamento.
- 68 testes automatizados aprovados, incluindo validação estrutural da navegação móvel.

## 3.0.1

- Cards de Canais salvos passam a exibir um resumo compacto, somente leitura, do conteúdo selecionado e das estatísticas por destino.
- Fontes globais e playlists selecionadas ficam organizadas em sanfonas fechadas por padrão, preservando a interface clean.
- A atualização automática de status preserva o estado aberto/fechado das sanfonas de Canais, inclusive grupos e playlists internas.
- Nenhuma alteração em schema, fila, worker, regras de download ou armazenamento.
- 67 testes automatizados aprovados, incluindo validação da preservação de estado das sanfonas.

## 3.0.0

- Novo módulo **Canais**, separado de Bibliotecas, com análise por URL antes de qualquer persistência ou download.
- Descoberta de Todos os uploads, Vídeos, Shorts, Transmissões finalizadas e playlists públicas.
- Playlists de Canais funcionam como bibliotecas embutidas, com perfis `generic`, `movie` e `music_clips`, Library ID, Playout ID, resolução, cookies, legendas e ações do ErsatzTV.
- Duplicidade permitida entre destinos e deduplicação apenas por `destinationId + videoId`.
- Playlists aceitam vídeos de outros criadores sem filtro por proprietário.
- Fontes globais usam perfil Genérico, configuração comum de legendas e limpeza segura de órfãos.
- Novo `paths.channelsBaseDir` e `channelScheduler` independente.
- Conteúdo removido remotamente é marcado como órfão; nenhuma exclusão automática destrutiva foi adicionada.
- Renomes de canal/playlist atualizam o nome exibido e preservam `folderName`.
- Novo `DestinationContext`, descoberta compartilhada e extração de fila/storage/rotas para reduzir acoplamento nos módulos monolíticos.
- Interface de Canais reutiliza o mesmo componente de destino usado pelas Bibliotecas.
- Clean UI: tela de login simplificada e remoção de textos redundantes na interface principal.
- Schema de configuração v5 e estado da fila v4.
- Testes automatizados ampliados de 43 para 56 casos.

## 2.8.0

- Cada biblioteca passa a ter um único **Perfil** de mídia: `Genérico`, `Show / vídeo completo (Filmes)` ou `Clipes musicais (Seriados)`.
- A interface foi simplificada: o perfil fica em um único seletor na biblioteca, sem bloco adicional de explicações.
- **Genérico** mantém o layout simples por artista, cria JPG sidecar quando habilitado e grava um NFO básico com título, plot e `uniqueid` do YouTube.
- **Show / vídeo completo (Filmes)** preserva o modelo da v2.6.0: uma subpasta individual por vídeo, `poster.jpg` e NFO de filme com artista em `title` e nome do vídeo em `outline`/`plot`.
- **Clipes musicais (Seriados)** preserva o modelo da v2.7.0: artista como Show, `Season 01`, música como episódio, `tvshow.nfo`, NFO de episódio, `-thumb.jpg` e `poster.jpg` do Show.
- O campo único `mediaProfile` substitui as flags `movieMetadata`/`showMetadata` no schema v4. Configurações v2.7 com Shows habilitado são convertidas para `music_clips`; configurações antigas de Filmes habilitadas são convertidas para `movie`.
- Normalização de artista, legendas SRT, deduplicação por `videoId`, API Key do ErsatzTV e ações de scan/rebuild permanecem inalteradas.
- 43 testes automatizados aprovados.

## 2.7.0

- O modo de metadados do ErsatzTV passa de **Filmes** para **Shows**. No ErsatzTV, a biblioteca local correspondente deve usar `Media Kind = Shows`.
- Cada artista é gravado como um Show em `Biblioteca/Artista/`, com `tvshow.nfo`.
- Cada música é gravada como episódio em `Season 01`, usando nomes como `Artista - S01E01 - Musica.mp4`.
- Cada episódio recebe NFO próprio com `title` igual ao nome da música, `season=1`, `episode=N` e `plot` igual ao nome da música.
- Numeração de episódios é persistente e incremental por artista; novos vídeos recebem o próximo número sem renumerar itens já conhecidos.
- Legendas SRT continuam usando o mesmo nome-base do vídeo e permanecem ao lado do episódio.
- Thumbnails passam a usar o padrão de artwork de episódio `-thumb.jpg`; a primeira imagem disponível também é copiada como `poster.jpg` no nível do Show.
- Sufixos comuns como `(Official Video)` e `[Official Music Video]` são removidos do título lógico da música e do novo nome físico em modo Shows.
- Quando um título não contém `Artista - Musica`, o canal/uploader do YouTube é usado como fallback para o artista quando disponível.
- Configuração sobe para schema v3. O antigo `movieMetadata.enabled` é migrado automaticamente para `showMetadata.enabled`, com backup automático do `config.json` anterior.
- A ação antiga **Preparar NFOs existentes** foi removida da interface, pois a estrutura Filmes -> Shows não é migrada automaticamente.
- 38 testes automatizados aprovados.

## 2.6.0

- Normalizacao automatica e conservadora do nome do artista para novos destinos: nomes simples com duas ou mais palavras totalmente em maiusculas ou minusculas passam para capitalizacao legivel, por exemplo `TWENTY ONE PILOTS` e `twenty one pilots` viram `Twenty One Pilots`.
- Nomes estilizados ou potencialmente intencionais, como `AC/DC`, `P!NK`, `deadmau5`, `blink-182` e `CHVRCHES`, sao preservados no metadado do artista.
- Consolidacao case-insensitive por biblioteca impede a criacao de pastas duplicadas que diferem apenas por maiusculas/minusculas.
- O NFO usa o mesmo nome canonico de artista, mantendo pasta, estado interno e metadados do ErsatzTV consistentes.
- Separacao `Artista - Titulo` passa a usar o primeiro separador com espacos (` - `), preservando hifens que fazem parte do nome do artista ou da musica.
- Quando um arquivo concluido foi removido do disco e o item volta para download, o caminho de destino e recalculado com as regras atuais de artista; nao e necessario manter uma funcao de migracao por biblioteca.
- Nenhum arquivo concluido existente e movido ou renomeado automaticamente durante a atualizacao.
- 38 testes automatizados aprovados.

## 2.5.0

- Metadados NFO opcionais por biblioteca para uso das bibliotecas locais como **Filmes** no ErsatzTV.
- Recurso desativado por padrão para bibliotecas existentes; ativação explícita pela interface.
- Novos vídeos de bibliotecas habilitadas usam uma subpasta individual por item, compatível com o layout documentado de Movies do ErsatzTV.
- NFO grava artista em `title`, música em `outline`/`plot`, `sorttitle` como `Artista - Música`, gênero `Music`, tag `Music Video` e `uniqueid` do YouTube.
- Sufixos comuns do YouTube como `(Official Video)`, `(Official Music Video)`, `(Official Audio)`, `(Lyric Video)` e `(Visualizer)` são removidos apenas dos metadados da música; o nome físico original é preservado.
- Artwork passa a usar `poster.jpg` dentro da pasta individual do vídeo. O JPG já existente é reaproveitado/movido; se estiver ausente e houver URL de thumbnail, o aplicativo tenta baixá-lo.
- Nova ação **Preparar NFOs existentes** reorganiza somente vídeos concluídos, movendo MP4/SRT/JPG relacionados sem baixar novamente os vídeos.
- A preparação existente executa no máximo um scan da biblioteca no ErsatzTV ao final quando houve alterações.
- Limpeza de órfãos passa a remover também o NFO associado.
- Novos vídeos habilitados geram NFO automaticamente ao concluir o download.

## 2.4.0

- Legendas SRT opcionais e configuráveis por biblioteca.
- Bibliotecas existentes permanecem com legendas desativadas até ativação explícita pela interface.
- Suporte simultâneo aos idiomas `pt-BR`, `pt`, `en` e `es`, com seleção múltipla.
- Legendas manuais e automáticas do YouTube, usando `yt-dlp` sem baixar novamente o vídeo.
- Arquivos sidecar seguem o mesmo nome-base do MP4, por exemplo `Video.pt-BR.srt`.
- Novos vídeos recebem a busca de legendas depois que o MP4 é concluído; falta de legenda não falha o vídeo.
- Falhas temporárias de legenda têm fila e retentativas independentes do download do vídeo.
- Nova ação **Buscar legendas ausentes** para bibliotecas já existentes.
- Backfill preserva MP4/JPG, baixa somente SRT ausentes e executa um único scan do ErsatzTV ao final quando houve alteração.
- Limpeza de órfãos passa a remover também os SRT sidecar associados.
- 25 testes automatizados cobrindo configuração, argumentos do yt-dlp, sidecars, backfill, retry e scan único.

## 2.3.1

- Suporte à autenticação da API do ErsatzTV por `X-Etv-Api-Key`.
- Novo campo protegido `Configurações → ErsatzTV → API Key do ErsatzTV`.
- A chave é enviada em scan de biblioteca, limpeza de lixo e rebuild de playout.
- Respostas HTTP 401/403 da API agora indicam chave ausente ou inválida.
- Configurações existentes continuam compatíveis; nenhuma chave é inventada ou migrada automaticamente.
- Novos testes automatizados para envio do header e falhas de autorização.

## 2.3.0

- Interface móvel dedicada sem alterar a experiência consolidada do desktop.
- Navegação inferior fixa com cinco áreas e suporte a safe areas de iOS/Android.
- Cabeçalho mobile compacto com estado operacional e painel deslizante de ações rápidas.
- Controles móveis para buscar novidades, pausar/retomar fila, atualizar dados e encerrar sessão.
- Tabela de downloads transformada em cartões responsivos no celular.
- Filtros, formulários, bibliotecas, sanfonas, logs, diálogos e notificações revisados para toque.
- Campos com tamanho adequado para evitar zoom automático em navegadores móveis.
- Melhorias de acessibilidade, foco, fechamento por Escape e bloqueio de rolagem no painel móvel.
- Nenhuma alteração no formato da configuração, autenticação, fila ou arquivos de mídia.

## 2.2.0

- Interface administrativa redesenhada com linguagem visual mais sóbria e profissional.
- Navegação lateral por Visão geral, Downloads, Bibliotecas, Configurações e Logs.
- Novo símbolo vetorial da aplicação, substituindo o ícone textual `YT`.
- Configurações reorganizadas integralmente em sanfonas fechadas por padrão.
- Bibliotecas convertidas em sanfonas individuais com resumo, estado e métricas.
- Fila e histórico preservados em sanfona, com visual mais compacto.
- Revisão de espaçamentos, tipografia, métricas, tabelas, ações e comportamento responsivo.
- Tela de login mantida e integrada ao novo símbolo.
- Nenhuma alteração no formato da configuração, fila, autenticação ou arquivos de mídia.

## 2.1.0

- Login administrativo local obrigatório, sem dependências externas.
- Senha derivada por scrypt e armazenada somente em `config/auth.json` com permissão `600`.
- Sessões assinadas em memória, cookie HttpOnly/SameSite, CSRF, validação de origem e bloqueio temporário de força bruta.
- Suporte seguro a proxy reverso confiável e cookie `Secure` automático sob HTTPS.
- Nova tela de login responsiva com estado de configuração inicial.
- Nova ação para limpar toda a fila ou apenas uma biblioteca.
- Limpeza preserva arquivos concluídos e suprime itens removidos para impedir redescoberta automática.
- Resumo ampliado da fila, incluindo espaço, tamanho local, retries, velocidade e último item concluído.
- Lista de downloads movida para sanfona fechada por padrão.
- Paginação e filtros por status e biblioteca para filas extensas.
- Remoção da função e das rotas de limpeza de YML legado.
- Cabeçalhos de segurança para a interface web.
- Novos testes automatizados de autenticação, CSRF, lockout, limpeza e paginação da fila.

## 2.0.0

- Substituição de Remote Streams/YML por downloads locais.
- Novo worker persistente com concorrência fixa em 1.
- Estados de fila, histórico, retry, cancelamento, prioridade e supressão manual.
- Retentativas automáticas em 1, 5 e 15 minutos.
- Arquivos finais MP4/H.264/AAC validados por ffprobe.
- Remux ou transcodificação automática por ffmpeg quando necessário.
- Thumbnails JPG locais.
- Controle de espaço livre e reserva mínima configurável.
- Marcação e limpeza manual de órfãos.
- Scan/rebuild do ErsatzTV quando a fila entra em repouso.
- Migração automática de configuração v1 com backup.
- Cookies opcionais e sem ativação implícita por configuração legada.
- Interface reformulada para download, armazenamento, fila e histórico.
- Testes automatizados de migração, persistência, supressão, argumentos do yt-dlp e normalização real por ffmpeg.
