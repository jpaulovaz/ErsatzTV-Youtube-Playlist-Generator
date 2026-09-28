# Changelog

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
