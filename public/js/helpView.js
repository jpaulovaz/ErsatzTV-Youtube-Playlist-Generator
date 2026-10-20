(() => {
  const SCRIPTED_TABS = [
    ['start', 'Começando'],
    ['resources', 'Recursos'],
    ['queries', 'Queries'],
    ['modules', 'Módulos'],
    ['combinations', 'Combinações'],
    ['publish', 'Publicar'],
    ['glossary', 'Glossário']
  ];

  const MODULES = [
    ['Rotação por tempo', 'Toca uma Source por alguns minutos e depois passa para a próxima.', '60 min de músicas A → 30 min de músicas B → volta para A.', 'Eventos fixos e Filler.', 'Pad To Nearest não aparece aqui, porque este bloco trabalha por tempo, não item por item.'],
    ['Rotação por quantidade', 'Troca de Source depois de tocar uma quantidade de itens.', '3 clipes de A → 2 clipes de B → repete.', 'Eventos fixos e Filler. Normalmente substitui, e não soma, outra rotação de fundo.', 'Pad To Nearest pode entrar depois de cada item.'],
    ['Rotação por peso', 'Escolhe as Sources pela proporção que você indicar. A ordem não fica presa.', 'Peso 60 para músicas novas e 20 para clássicas faz as novas aparecerem mais vezes.', 'Eventos fixos e Filler. Use esta opção como programação-base quando quiser variedade por proporção.', 'Pad To Nearest pode entrar depois de cada item.'],
    ['Bloco contínuo por horário', 'A partir de um horário, uma Source fica tocando sem tempo para acabar. Um evento fixo pode entrar no meio; depois o bloco volta.', '06:00 desenhos; 12:00 séries; 18:00 filmes. Um jornal às 22:00 entra e, ao terminar, volta aos filmes.', 'Horários fixos. É a melhor opção para criar a programação-base do dia.', 'Pad To Nearest não se aplica aqui, porque este bloco não termina sozinho.'],
    ['Inserções após X itens', 'Depois de uma quantidade de itens principais, toca uma pequena inserção e volta.', '4 músicas → 1 vinheta → 4 músicas → 1 vinheta.', 'Eventos fixos e Filler. Este módulo já faz a alternância principal + inserção sozinho.', 'Pad To Nearest pode entrar depois de cada item tocado.'],
    ['Encaixar até o próximo evento', 'Quando falta pouco tempo para um evento, tenta escolher um item que caiba nesse espaço.', 'São 19:38 e o filme começa às 20:00. O módulo tenta achar algo curto para usar esses 22 minutos.', 'Eventos fixos e Filler.', 'Pad To Nearest não se aplica aqui, porque este módulo já trabalha até o próximo evento.'],
    ['Horário fixo · quantidade', 'Em um horário marcado, toca uma quantidade de itens. Se o conteúdo anterior cruzaria esse horário, você pode mandar o motor escolher entre adiantar ou atrasar pelo menor desvio.', '10:00 → tocar 3 filmes.', 'Bloco contínuo, rotações e Pad To Nearest.', 'Com Pad: filme → Filler até a marca → filme → Filler → filme → Filler.'],
    ['Horário fixo · duração', 'Em um horário marcado, toca por um tempo. Se o conteúdo anterior cruzaria esse horário, você pode usar o horário mais próximo. Se uma prioridade maior interromper, guarda o tempo que faltou.', '20:00 → música por 90 minutos.', 'Eventos de prioridade maior.', 'Pad To Nearest não aparece aqui, porque esse período é montado de uma vez.'],
    ['Horário fixo · todos os itens', 'Em um horário marcado, toca tudo daquela Source. Depois que começa, termina antes de liberar outro módulo.', '14:00 → tocar todos os episódios de uma coleção especial.', 'Maratonas e especiais.', 'Pad To Nearest não aparece aqui: todos os itens são enviados de uma vez, sem uma pausa segura entre eles.'],
    ['Faixa de horário · fonte única', 'Usa uma Source somente entre dois horários.', '06:00–10:00 → programação da manhã.', 'Programação por turnos.', 'Pad To Nearest não aparece aqui, porque a faixa inteira é preenchida de uma vez.'],
    ['Faixa de horário · rotação', 'Faz uma rotação própria somente dentro de uma faixa de horário.', '12:00–18:00 → alternar três Sources a cada 30 minutos.', 'Grades de manhã/tarde/noite.', 'Pad To Nearest não aparece aqui, porque cada etapa trabalha por duração.'],
    ['Sequência programada', 'Executa vários passos na ordem que você montar.', 'Vinheta → programa → promo → preencher até :30.', 'Programas com abertura, intervalo e encerramento.', 'Pad To Nearest aparece quando os passos de conteúdo usam Quantidade.'],
    ['Repetição por intervalo', 'Repete um evento a cada X minutos.', 'Tocar uma vinheta a cada 30 minutos.', 'Station IDs, promos e chamadas.', 'Pad To Nearest aparece no modo Quantidade.'],
    ['Escolha entre fontes', 'No horário marcado, escolhe uma das Sources disponíveis.', '20:00 → escolher entre três coleções de filmes.', 'Sessões variadas e programação menos previsível.', 'Pad To Nearest aparece no modo Quantidade.'],
    ['Relógio de programação', 'Repete posições dentro de um ciclo.', 'Num ciclo de 60 min: :00 conteúdo, :15 vinheta, :30 conteúdo, :55 promo.', 'Canais com estrutura de rádio/TV.', 'Pad To Nearest aparece nas posições configuradas como Quantidade.'],
    ['Programação especial temporária', 'Uma Source assume entre uma data/hora de início e fim. Depois a grade normal volta sozinha.', '24/12 18:00 até 26/12 06:00 → Especial de Natal.', 'Datas comemorativas e eventos.', 'Pad To Nearest não se aplica aqui, porque o período inteiro é preenchido como uma faixa de duração.'],
    ['Evento em data específica', 'Executa uma vez numa data e hora exatas.', '31/12/2026 23:30 → Especial de Ano Novo.', 'Estreias e eventos únicos.', 'Pad To Nearest aparece em Quantidade; em Sequência, somente quando os passos de conteúdo usam Quantidade.'],
    ['Janela offline', 'Deixa uma faixa sem programação.', 'Domingo 03:00–05:00 → manutenção.', 'Manutenção. Não combine com Filler dentro da mesma janela.', 'Pad To Nearest não se aplica aqui, porque esta faixa foi criada para ficar sem programação.']
  ];

  const QUERY_GROUPS = [
    {
      title: 'Identidade e organização',
      intro: 'Campos para localizar o item certo e limitar a busca a uma parte do catálogo.',
      fields: [
        ['title', 'Título do item. Se você não informar nenhum campo, o ErsatzTV pesquisa pelo título por padrão.', 'Todos os tipos pesquisáveis.'],
        ['type', 'Limita o tipo de mídia.', 'Valores documentados: movie, show, season, episode, artist, music_video, other_video, song e image.'],
        ['library_name', 'Nome da biblioteca que contém o item.', 'Filmes, shows, temporadas, episódios, artistas, music videos, other videos, músicas e imagens.'],
        ['collection', 'Nome da Collection que contém o item.', 'Filmes, shows, temporadas, episódios, artistas, music videos, other videos, músicas e imagens.']
      ]
    },
    {
      title: 'Conteúdo e classificação',
      intro: 'Metadados editoriais usados para filtrar por assunto, categoria ou descrição.',
      fields: [
        ['genre', 'Gênero do conteúdo.', 'Filmes, shows, artistas, music videos, other videos, músicas e imagens.'],
        ['tag', 'Tag associada ao conteúdo.', 'Filmes, shows, temporadas, episódios, music videos, other videos, músicas e imagens. Em Movies/Shows/Seasons/Episodes não está disponível com metadados Plex.'],
        ['tag_full', 'A mesma informação de tag, mas sem tokenização/análise do texto; útil quando você quer comparar a tag como valor completo.', 'Mesmos tipos de tag.'],
        ['plot', 'Sinopse ou descrição do conteúdo.', 'Filmes, shows, episódios e other videos.'],
        ['content_rating', 'Classificação indicativa. A documentação alerta que a busca é sensível a maiúsculas/minúsculas.', 'Filmes, shows e other videos.']
      ]
    },
    {
      title: 'Pessoas, estúdio e origem',
      intro: 'Campos para selecionar conteúdo por créditos ou origem editorial.',
      fields: [
        ['studio', 'Estúdio associado ao conteúdo.', 'Filmes, shows e other videos.'],
        ['network', 'Network do show conforme os metadados do Plex.', 'Shows.'],
        ['actor', 'Ator presente no conteúdo.', 'Filmes, shows e other videos.'],
        ['director', 'Diretor do conteúdo.', 'Filmes, episódios e other videos.'],
        ['writer', 'Roteirista ou crédito de escrita.', 'Filmes, episódios e other videos.']
      ]
    },
    {
      title: 'Séries, temporadas e episódios',
      intro: 'Campos próprios da hierarquia de séries.',
      fields: [
        ['season_number', 'Número da temporada.', 'Temporadas e episódios.'],
        ['episode_number', 'Número do episódio.', 'Episódios.'],
        ['show_title', 'Título do show ao qual a temporada ou episódio pertence.', 'Temporadas e episódios.'],
        ['show_genre', 'Gênero do show pai.', 'Temporadas e episódios.'],
        ['show_studio', 'Estúdio do show pai.', 'Temporadas e episódios.'],
        ['show_network', 'Network do show pai conforme os metadados do Plex.', 'Episódios.'],
        ['show_content_rating', 'Classificação indicativa do show pai.', 'Temporadas e episódios.'],
        ['show_tag', 'Tag do show pai.', 'Temporadas e episódios.']
      ]
    },
    {
      title: 'Música',
      intro: 'Campos próprios de artistas, clipes e músicas.',
      fields: [
        ['artist', 'Artista do music video ou da faixa.', 'Music videos e músicas.'],
        ['album', 'Álbum do music video ou da faixa.', 'Music videos e músicas.'],
        ['album_artist', 'Artista principal do álbum.', 'Músicas.'],
        ['style', 'Estilo associado ao artista.', 'Artistas.'],
        ['mood', 'Clima/mood associado ao artista.', 'Artistas.']
      ]
    },
    {
      title: 'Áudio e legendas',
      intro: 'Campos lidos a partir das faixas de mídia.',
      fields: [
        ['language', 'Idioma de uma faixa de áudio.', 'Filmes, shows, temporadas, episódios, artistas, music videos e other videos.'],
        ['language_tag', 'Tag completa de idioma de uma faixa de áudio.', 'Mesmos tipos de language.'],
        ['sub_language', 'Idioma de uma faixa de legenda.', 'Filmes, shows, temporadas, episódios, artistas, music videos e other videos.'],
        ['sub_language_tag', 'Tag completa de idioma de uma faixa de legenda.', 'Mesmos tipos de sub_language.']
      ]
    },
    {
      title: 'Datas',
      intro: 'As datas normais usam o formato YYYYMMDD. Os campos especiais trabalham de forma relativa ao dia atual.',
      fields: [
        ['release_date', 'Data de lançamento/publicação do conteúdo no formato YYYYMMDD.', 'Filmes, shows, episódios, music videos e other videos.'],
        ['added_date', 'Data em que o item foi adicionado ao ErsatzTV, no formato YYYYMMDD.', 'Filmes, shows, episódios, artistas, music videos, other videos, músicas e imagens.'],
        ['released_inthelast', 'Itens lançados dentro do período informado. Exemplo: released_inthelast:"1 week".', 'Qualquer tipo que suporte release_date; aceita days, weeks, months e years.'],
        ['released_notinthelast', 'Itens lançados antes do período informado. Exemplo: released_notinthelast:"6 months".', 'Qualquer tipo que suporte release_date.'],
        ['released_onthisday', 'Itens lançados no mesmo mês e dia de hoje, em anos anteriores. O valor informado é ignorado.', 'Qualquer tipo que suporte release_date.'],
        ['added_inthelast', 'Itens adicionados ao ErsatzTV dentro do período informado.', 'Qualquer tipo que suporte added_date; aceita days, weeks, months e years.'],
        ['added_notinthelast', 'Itens adicionados antes do período informado.', 'Qualquer tipo que suporte added_date.']
      ]
    },
    {
      title: 'Duração e características técnicas',
      intro: 'Úteis para montar faixas por duração, resolução ou propriedades do vídeo.',
      fields: [
        ['chapters', 'Quantidade de capítulos.', 'Filmes, episódios, music videos e other videos.'],
        ['minutes', 'Duração arredondada para cima em minutos inteiros.', 'Filmes, episódios, music videos, other videos e músicas.'],
        ['seconds', 'Duração arredondada para cima em segundos inteiros.', 'Filmes, episódios, music videos, other videos e músicas.'],
        ['height', 'Altura do vídeo em pixels.', 'Filmes, episódios, music videos e other videos.'],
        ['width', 'Largura do vídeo em pixels.', 'Filmes, episódios, music videos e other videos.'],
        ['video_codec', 'Codec do vídeo.', 'Filmes, episódios, music videos e other videos.'],
        ['video_bit_depth', 'Profundidade de bits do formato de pixels.', 'Filmes, episódios, music videos e other videos.'],
        ['video_dynamic_range', 'Faixa dinâmica do vídeo.', 'Filmes, episódios, music videos e other videos; valores documentados: sdr ou hdr.']
      ]
    }
  ];

  const APP_AREAS = [
    ['start', 'Comece aqui'], ['daily', 'Uso diário'], ['libraries', 'Bibliotecas'], ['downloads', 'Downloads'], ['channels', 'Canais'], ['youtube', 'Adicionar vídeos'], ['tools', 'Ferramentas'], ['scripted', 'Scripted Schedules'], ['troubleshooting', 'Problemas comuns']
  ];

  let area = 'start';
  let tab = 'start';
  const root = () => document.querySelector('#helpRoot');
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function moduleCards() {
    return `<div class="help-module-grid">${MODULES.map(([name, what, example, combine, padNote]) => `<article class="card help-module-card"><span class="eyebrow">Módulo</span><h3>${esc(name)}</h3><p><strong>O que faz:</strong> ${esc(what)}</p><div class="help-example"><strong>Exemplo simples</strong><span>${esc(example)}</span></div><p><strong>Combina bem com:</strong> ${esc(combine)}</p>${padNote ? `<p><strong>Pad To Nearest:</strong> ${esc(padNote.replace(/^Pad To Nearest\s*/i, ''))}</p>` : ''}</article>`).join('')}</div>`;
  }

  function renderStart() {
    return `<section class="card help-lead"><span class="eyebrow">Comece aqui</span><h3>Pense no canal como uma programação de televisão</h3><p>A tela segue a ordem mais comum: primeiro a aparência, depois as fontes de conteúdo e, por último, a programação.</p><div class="help-steps"><div><strong>1</strong><span>Crie Grupos de Graphics se você usa elementos visuais.</span></div><div><strong>2</strong><span>Crie Presentation Profiles para juntar aparência, EPG e pre-roll.</span></div><div><strong>3</strong><span>Crie as Sources e, se precisar, Scripted Playlists.</span></div><div><strong>4</strong><span>Configure o Filler, adicione os módulos, valide e publique.</span></div></div></section>
      <section class="card help-note"><h3>Uma regra importante</h3><p>Você não precisa preencher tudo de uma vez. Pre-roll, por exemplo, é opcional: você pode criar a Scripted Playlist depois e então voltar ao Presentation Profile para selecioná-la.</p></section>`;
  }

  function renderResources() {
    return `<div class="help-module-grid">
      <article class="card help-module-card"><h3>Grupos de Graphics</h3><p>São listas de elementos visuais que você costuma ligar juntos.</p><div class="help-example"><strong>Exemplo</strong><span>Logo do canal + watermark = grupo COMMON_GRAPHICS.</span></div><p>Use o caminho relativo do YAML, como <code>image/watermark.yml</code>. Se você colocar <code>/</code> no início, o aplicativo remove automaticamente.</p></article>
      <article class="card help-module-card"><h3>Presentation Profiles</h3><p>Juntam a aparência e o comportamento visual de um conteúdo: Graphics, watermark, pre-roll e EPG.</p><div class="help-example"><strong>Exemplo</strong><span>O perfil MUSIC pode ligar o logo e os créditos da música.</span></div><p>O pre-roll é opcional. Se a Scripted Playlist ainda não existir, deixe vazio e volte depois.</p><p>Ao escolher <strong>Nenhum</strong> em uma Source ou módulo, o aplicativo usa internamente um perfil vazio. Você não precisa criar nem configurar esse perfil.</p></article>
      <article class="card help-module-card"><h3>Variáveis dos Graphics</h3><p>Não existe uma lista fixa. Você cria a chave que o seu arquivo YAML espera e informa o valor que quer enviar.</p><div class="help-example"><strong>Exemplo</strong><span>Se o YAML usa <code>{{ promo_text }}</code>, cadastre a chave <code>promo_text</code> com um valor como “Hoje às 20h”.</span></div><p>Essas variáveis podem preencher textos, caminhos ou outros valores usados pelo seu Graphics Element.</p><p>O ErsatzTV também oferece dados prontos do item, como <code>MediaItem_Title</code>, <code>MediaItem_Artist</code>, <code>MediaItem_Path</code> e <code>MediaItem_Duration</code>. Eles são usados direto no YAML e não precisam ser cadastrados aqui.</p></article>
      <article class="card help-module-card"><h3>Sources</h3><p>São as prateleiras de conteúdo que os módulos podem usar. A Source diz <strong>qual conteúdo</strong> será usado; a ordem de reprodução é escolhida depois, em cada uso na Programação, no Filler ou em uma Scripted Playlist.</p><div class="help-example"><strong>Exemplo</strong><span>MOVIES pode tocar em Chronological numa programação e em Shuffle em outra, sem duplicar a Source.</span></div><p>Você ainda pode escolher uma Presentation padrão enquanto cria a Source. <strong>Tipos mais comuns:</strong> Smart Collection usa uma coleção inteligente; Collection usa uma coleção comum; Playlist usa uma playlist; Search usa uma busca; Show aponta para um programa; Marathon agrupa conteúdo para tocar como maratona.</p><p>Marathon mantém suas próprias opções internas de ordem e agrupamento, porque é um tipo de Source diferente.</p></article>
      <article class="card help-module-card"><h3>Scripted Playlists</h3><p>São pequenas sequências reutilizáveis, muito úteis como pre-roll.</p><div class="help-example"><strong>Exemplo</strong><span>1 vinheta + 2 promos antes de um programa.</span></div></article>
      <article class="card help-module-card"><h3>Filler</h3><p>É o conteúdo que preenche espaços vazios e também é usado pelo Pad To Nearest Minute.</p><div class="help-example"><strong>Tipo de Filler</strong><span>Post-roll é o mais indicado para preencher lacunas. Pre-roll e Mid-roll existem para usos mais específicos. Se escolher Nenhum, o conteúdo pode aparecer separado no EPG.</span></div><p>Filler não é a programação principal. Para uma Source tocar sem fim a partir de um horário, use Bloco Contínuo.</p></article>
      <article class="card help-module-card"><h3>Programação-base</h3><p>É o conteúdo que sustenta o canal quando nenhum evento especial está ativo. Normalmente você escolhe uma base: Rotação por tempo, Rotação por quantidade, Rotação por peso, Bloco contínuo ou Inserções após X itens.</p><div class="help-example"><strong>Exemplo</strong><span>Um canal de música pode usar Rotação por peso como base e colocar shows ao vivo em horários fixos.</span></div></article>
    </div>`;
  }

  function renderQueries() {
    const groups = QUERY_GROUPS.map((group) => `<section class="card help-query-group"><div class="help-query-group-head"><h3>${esc(group.title)}</h3><p>${esc(group.intro)}</p></div><div class="help-query-fields">${group.fields.map(([field, description, availability]) => `<div class="help-query-field"><code>${esc(field)}</code><div><p>${esc(description)}</p><small><strong>Disponível em:</strong> ${esc(availability)}</small></div></div>`).join('')}</div></section>`).join('');
    return `<section class="card help-lead"><span class="eyebrow">Source Search</span><h3>Queries do ErsatzTV</h3><p>Use estes campos na Source do tipo <strong>Search</strong>. Combine condições com <code>AND</code>, <code>OR</code>, <code>NOT</code> e parênteses. Para texto com espaços, use aspas. O curinga é <code>*</code>, não <code>%</code>.</p><div class="help-query-examples"><div><code>library_name:"21 - JOHNFLIX MUSIC" AND artist:"Madonna"</code><span>Biblioteca + artista.</span></div><div><code>title:*banana*</code><span>Título contendo “banana”.</span></div><div><code>release_date:[20000101 TO 20091231]</code><span>Intervalo de datas.</span></div><div><code>type:episode AND released_inthelast:"1 week"</code><span>Episódios lançados na última semana.</span></div></div></section>${groups}`;
  }

  function renderCombinations() {
    return `<div class="help-module-grid">
      <article class="card help-module-card"><h3>Canal de filmes</h3><p><strong>Bloco contínuo</strong> como base + <strong>Horário fixo · quantidade</strong> para sessões especiais + <strong>Pad To Nearest</strong> + <strong>Filler</strong>.</p></article>
      <article class="card help-module-card"><h3>Canal de música</h3><p>Use <strong>Rotação por tempo, quantidade ou peso</strong> para alternar Sources. Se preferir uma regra como “4 músicas + 1 vinheta”, use <strong>Inserções após X itens</strong> como programação-base. Filler é opcional se o fundo já cobre 24 horas.</p></article>
      <article class="card help-module-card"><h3>Canal com grade por turnos</h3><p><strong>Blocos contínuos</strong> às 06:00, 12:00 e 18:00. Eventos fixos entram por cima e depois a programação-base volta.</p></article>
      <article class="card help-module-card"><h3>Canal estilo TV/Rádio</h3><p><strong>Relógio de programação</strong> para posições previsíveis + <strong>Repetição por intervalo</strong> para promos + eventos fixos para programas principais.</p></article>
      <article class="card help-module-card"><h3>Datas especiais</h3><p><strong>Programação especial temporária</strong> para um período inteiro; <strong>Evento em data específica</strong> para uma ocorrência única.</p></article>
      <article class="card help-module-card"><h3>Antes de um evento fixo</h3><p><strong>Encaixar até o próximo evento</strong> tenta aproveitar o tempo disponível; o <strong>Filler</strong> pode completar o pequeno restante.</p></article>
    </div>`;
  }

  function renderPublish() {
    return `<section class="card help-lead"><h3>Publicar sem complicação</h3><div class="help-steps"><div><strong>1</strong><span>Clique em Validar. Corrija qualquer erro mostrado.</span></div><div><strong>2</strong><span>Clique em Salvar e publicar. O aplicativo atualiza o mesmo arquivo .py.</span></div><div><strong>3</strong><span>Na primeira vez, cadastre esse caminho no Scripted Schedule do Playout do ErsatzTV.</span></div><div><strong>4</strong><span>Nas próximas mudanças, basta salvar novamente. Reset Playout só é usado quando você decidir reconstruir a programação.</span></div></div></section><section class="card help-note"><h3>Reset Playout</h3><p>Reset é uma ação separada e destrutiva. Salvar um script nunca executa Reset automaticamente.</p></section>`;
  }

  function renderGlossary() {
    const items = [
      ['Source', 'Uma fonte de conteúdo. Pode ser uma Smart Collection, Collection, Playlist, Search, Show ou Marathon.'],
      ['Presentation', 'Um pacote de aparência: Graphics, watermark, pre-roll e opções de EPG.'],
      ['Ordem de reprodução', 'Escolhida onde a Source é usada. Chronological segue a ordem natural; Shuffle embaralha. A mesma Source pode usar ordens diferentes em blocos diferentes.'],
      ['Priority', 'Quem tem o número maior tem preferência quando duas programações disputam o mesmo momento.'],
      ['Pad To Nearest Minute', 'Em módulos compatíveis, usa o Filler depois de cada item até a próxima marca de 5, 10, 15 ou 30 minutos. Exemplo: filme termina 10:07 → Filler até 10:15 → próximo filme. Se houver um evento marcado antes da próxima marca, o Filler respeita essa fronteira.'],
      ['Fallback Source', 'Source de reserva usada pelo próprio ErsatzTV dentro de operações de duração/pad. Não é o Filler geral do projeto.'],
      ['Tipo de Filler', 'Diz como o ErsatzTV deve agrupar esse conteúdo no EPG. Post-roll é recomendado para lacunas e Pad; Pre-roll fica antes do próximo conteúdo; Mid-roll representa uma interrupção; Nenhum não marca o conteúdo como filler.'],
      ['Horário mais próximo', 'Quando o próximo conteúdo passaria do horário de um evento, compara o adiantamento com o atraso. Se adiantar for mais perto e estiver dentro do limite escolhido, o evento começa antes. O limite vem com 40 minutos e pode ser alterado.'],
      ['Trim', 'Permite cortar um item para ele caber exatamente. Ao ligar Trim, “Deixar o vídeo terminar” é desligado automaticamente.'],
      ['Deixar o vídeo terminar', 'Permite o vídeo acabar naturalmente mesmo que passe do limite. Ao ligar esta opção, Trim é desligado automaticamente.'],
      ['State key', 'Nome que separa a memória interna de cada Playout. Canais diferentes devem usar chaves diferentes.'],
      ['Recorrência avançada', 'Permite regras como primeira segunda-feira do mês ou a cada 14 dias.']
    ];
    return `<div class="help-glossary">${items.map(([term, text]) => `<article class="card"><h3>${esc(term)}</h3><p>${esc(text)}</p></article>`).join('')}</div>`;
  }

  function goButton(view, label, primary = false) {
    return `<button type="button" class="${primary ? 'primary' : ''}" data-help-go="${esc(view)}">${esc(label)}</button>`;
  }

  function renderAppStart() {
    return `<section class="card help-lead app-help-hero"><span class="eyebrow">Comece aqui</span><h3>O aplicativo fica simples quando você pensa em quatro tarefas</h3><p>Você não precisa conhecer todas as telas. Escolha o que quer fazer agora e o restante aparece quando for necessário.</p><div class="help-path-grid"><article><strong>1. Quero adicionar um vídeo</strong><span>Use Adicionar vídeos, escolha a Biblioteca, pesquise e confirme.</span>${goButton('youtube-manager', 'Adicionar vídeos', true)}</article><article><strong>2. Quero organizar o que já tenho</strong><span>Bibliotecas concentram conteúdo, legendas, órfãos e fontes.</span>${goButton('libraries', 'Abrir Bibliotecas')}</article><article><strong>3. Quero ver o que está acontecendo</strong><span>Downloads mostra fila, falhas e histórico. A Visão geral destaca somente o que exige atenção.</span>${goButton('downloads', 'Ver Downloads')}</article><article><strong>4. Quero montar uma grade de TV</strong><span>Scripted Schedules organiza a programação em etapas: recursos, grade, revisão e publicação.</span>${goButton('scripted-schedules', 'Abrir Scripted Schedules')}</article></div></section>
      <section class="card help-note"><h3>Se estiver em dúvida</h3><p>Volte para <strong>Visão geral</strong>. Ela mostra o estado atual, problemas e atalhos para as tarefas mais comuns.</p>${goButton('overview', 'Ir para Visão geral')}</section>`;
  }

  function renderDailyUse() {
    return `<section class="card help-lead"><span class="eyebrow">Fluxo mais comum</span><h3>Adicionar conteúdo novo</h3><div class="help-steps"><div><strong>1</strong><span>Abra <b>Adicionar vídeos</b> e escolha a Biblioteca de destino.</span></div><div><strong>2</strong><span>Pesquise por título, artista, URL ou Video ID e adicione o resultado correto.</span></div><div><strong>3</strong><span>Sincronize a Biblioteca quando o aplicativo oferecer essa ação.</span></div><div><strong>4</strong><span>Acompanhe o download em <b>Downloads</b>. Se algo falhar, a Visão geral chamará sua atenção.</span></div></div><div class="inline-actions">${goButton('youtube-manager', 'Adicionar vídeos', true)}${goButton('downloads', 'Acompanhar downloads')}</div></section>
      <section class="card help-note"><h3>Buscar novidades em tudo</h3><p>O botão <strong>Buscar novidades</strong> verifica as fontes configuradas sem alterar sua configuração. Use quando quiser antecipar a próxima busca agendada.</p></section>`;
  }

  function renderLibrariesHelp() {
    return `<div class="help-module-grid"><article class="card help-module-card"><span class="eyebrow">Biblioteca</span><h3>Quando usar</h3><p>Use Bibliotecas para destinos estáveis que recebem vídeos de uma ou mais playlists/URLs e ficam organizados em uma pasta própria.</p><div class="help-example"><strong>Uso comum</strong><span>JOHNFLIX MUSIX 00'S recebe clipes de uma playlist do YouTube e mantém vídeo, NFO, poster e legendas juntos.</span></div>${goButton('libraries', 'Abrir Bibliotecas', true)}</article><article class="card help-module-card"><h3>Gerenciar conteúdo</h3><p>É onde você vê os arquivos já conhecidos, filtra itens sem legendas, gerencia órfãos/quarentena e abre o Gerenciador de Legendas.</p><p>Os filtros são recalculados quando uma legenda é aplicada, restaurada ou excluída.</p></article><article class="card help-module-card"><h3>Biblioteca x Canal</h3><p><strong>Biblioteca</strong> é melhor para um destino definido por playlists/URLs. <strong>Canal</strong> é melhor quando você quer acompanhar a estrutura de um canal do YouTube, como uploads, Shorts, streams e playlists específicas.</p></article></div>`;
  }

  function renderDownloadsHelp() {
    return `<section class="card help-lead"><span class="eyebrow">Atividade</span><h3>Entenda a fila sem decorar estados</h3><p>A tela começa pela fila ativa. Filtros e detalhes técnicos ficam disponíveis quando você precisa investigar.</p><div class="help-status-grid"><div><strong>Pendente</strong><span>Aguardando a vez.</span></div><div><strong>Baixando</strong><span>Transferência em andamento.</span></div><div><strong>Falha</strong><span>Algo precisa de atenção; abra a ação do item.</span></div><div><strong>Concluído</strong><span>Mídia finalizada e registrada.</span></div><div><strong>Órfão</strong><span>Arquivo local cuja origem deixou de existir na fonte.</span></div></div>${goButton('downloads', 'Abrir Downloads', true)}</section><section class="card help-note"><h3>Não limpe a fila para resolver uma fonte errada</h3><p>Limpar remove os pendentes atuais, mas uma fonte ainda configurada pode descobri-los novamente. Corrija ou pause a fonte primeiro.</p></section>`;
  }

  function renderChannelsHelp() {
    return `<section class="card help-lead"><span class="eyebrow">Canais</span><h3>Monitore um canal do YouTube como estrutura</h3><div class="help-steps"><div><strong>1</strong><span>Cole a URL ou @handle e clique em Analisar canal.</span></div><div><strong>2</strong><span>Escolha apenas as fontes que realmente quer acompanhar: uploads, vídeos, Shorts, streams ou playlists.</span></div><div><strong>3</strong><span>Revise perfil, legendas e destino. Depois salve e use Atualizar agora quando quiser sincronizar.</span></div></div>${goButton('channels', 'Abrir Canais', true)}</section>`;
  }

  function renderYoutubeHelp() {
    return `<section class="card help-lead"><span class="eyebrow">Adicionar vídeos</span><h3>O caminho rápido para conteúdo novo</h3><p>A tela foi desenhada para o uso diário: <strong>Destino → Pesquisa → Adicionar</strong>. Escolher uma Biblioteca faz o aplicativo usar a playlist YouTube associada a ela e depois oferecer a sincronização.</p><div class="help-steps"><div><strong>1</strong><span>Escolha a Biblioteca ou playlist de destino.</span></div><div><strong>2</strong><span>Pesquise pelo vídeo ou cole uma URL/ID.</span></div><div><strong>3</strong><span>Adicione o resultado correto e acompanhe a fila em Atividade.</span></div></div><p><strong>Recuperar acervo</strong> agora fica em Ferramentas porque é uma tarefa eventual para arquivos que já estão no disco e perderam a referência.</p>${goButton('youtube-manager', 'Abrir Adicionar vídeos', true)}</section>`;
  }

  function renderToolsHelp() {
    return `<div class="help-module-grid"><article class="card help-module-card"><span class="eyebrow">Ferramentas</span><h3>Recuperar acervo</h3><p>Use quando arquivos que já existem no disco perderam a referência com o YouTube. A ferramenta recupera Video IDs, permite revisar correspondências e adotar mídia sem redownload.</p>${goButton('recover-archive', 'Abrir Recuperar acervo', true)}</article><article class="card help-module-card"><span class="eyebrow">Ferramentas</span><h3>Gerenciar legendas</h3><p>Cadastre uma pasta de filmes ou séries e abra cada vídeo no editor. Se um MKV tiver áudio que o navegador não entende, o aplicativo transmite uma versão compatível em tempo real: preserva o vídeo quando possível, converte apenas o áudio e permite escolher a faixa sonora sem preparar o filme inteiro antes.</p><p>Quando o vídeo também precisa ser convertido, a aplicação tenta aceleração de hardware automaticamente e volta para CPU se ela não estiver disponível. O preview completo continua como opção manual. Você também pode <strong>extrair legendas embutidas</strong>, criar uma cópia SRT de ASS/SSA/VTT, traduzir SRT com Gemini, editar cada trecho, visualizar waveform/espectrograma e corrigir sincronização por dois pontos ou FPS.</p>${goButton('subtitle-tools', 'Abrir Gerenciar legendas')}</article><article class="card help-module-card"><h3>PGS e cópias MKV</h3><p>Legendas PGS/SUP são imagens. Com Tesseract configurado, o OCR cria um SRT revisável. O menu de cada faixa também pode criar uma nova cópia MKV adicionando ou removendo uma legenda; o arquivo original não é substituído.</p>${goButton('settings', 'Conferir caminhos')}</article><article class="card help-module-card"><h3>Bazarr é opcional</h3><p>Quando configurado, ele pode pesquisar/baixar legendas e tentar sincronização automática. O scanner, o editor, a extração, a conversão e a tradução local continuam independentes do Bazarr.</p>${goButton('settings', 'Configurar integrações')}</article><article class="card help-module-card"><h3>Fluxo sugerido</h3><p>Filtre por <strong>Não revisados</strong>, abra o vídeo e confira som e legenda. Se faltar uma legenda utilizável, extraia, converta, traduza ou faça OCR. Depois ajuste o timing, salve e use <strong>Revisado e próximo</strong>.</p></article></div>`;
  }

  function renderTroubleshooting() {
    return `<div class="help-module-grid"><article class="card help-module-card"><h3>Algo parou?</h3><p>Comece pela Visão geral. Ela prioriza pouco disco, fila pausada e downloads com falha.</p>${goButton('overview', 'Ver estado do sistema', true)}</article><article class="card help-module-card"><h3>Integração não conecta</h3><p>Abra Configurações e teste YouTube Data API ou ErsatzTV. Credenciais do Gerenciador do YouTube ficam na própria área de Configurações dele.</p>${goButton('settings', 'Abrir Configurações')}</article><article class="card help-module-card"><h3>Preciso diagnosticar</h3><p>Logs é a tela técnica. Use-a quando uma mensagem de erro não for suficiente e procure o horário da ação que falhou.</p>${goButton('logs', 'Abrir Logs')}</article><article class="card help-module-card"><h3>Antes de excluir</h3><p>Ações destrutivas ficam escondidas em opções avançadas e pedem confirmação. Prefira pausar, remover configuração ou quarentena quando quiser preservar arquivos.</p></article></div>`;
  }

  function renderScriptedArea() {
    return `<section class="card help-note"><span class="eyebrow">Programação avançada</span><h3>Scripted Schedules</h3><p>Esta área tem sua própria documentação detalhada. Comece em “Começando” e avance só quando precisar.</p></section><nav class="help-tabs help-subtabs" aria-label="Assuntos da ajuda de Scripted Schedules">${SCRIPTED_TABS.map(([key, label]) => `<button type="button" class="${tab === key ? 'active' : ''}" data-help-tab="${key}">${label}</button>`).join('')}</nav><div class="help-scripted-body">${content()}</div>`;
  }

  function appContent() {
    if (area === 'daily') return renderDailyUse();
    if (area === 'libraries') return renderLibrariesHelp();
    if (area === 'downloads') return renderDownloadsHelp();
    if (area === 'channels') return renderChannelsHelp();
    if (area === 'youtube') return renderYoutubeHelp();
    if (area === 'tools') return renderToolsHelp();
    if (area === 'scripted') return renderScriptedArea();
    if (area === 'troubleshooting') return renderTroubleshooting();
    return renderAppStart();
  }

  function content() {
    if (tab === 'resources') return renderResources();
    if (tab === 'queries') return renderQueries();
    if (tab === 'modules') return moduleCards();
    if (tab === 'combinations') return renderCombinations();
    if (tab === 'publish') return renderPublish();
    if (tab === 'glossary') return renderGlossary();
    return renderStart();
  }

  function render() {
    const el = root(); if (!el) return;
    el.innerHTML = `<div class="page-header page-header-rich"><div><span class="page-kicker">Ajuda</span><h2>Como posso ajudar?</h2><p class="page-subtitle">Guias curtos para o uso diário e uma área detalhada para Scripted Schedules.</p></div></div><nav class="help-tabs help-main-tabs" aria-label="Assuntos da ajuda">${APP_AREAS.map(([key, label]) => `<button type="button" class="${area === key ? 'active' : ''}" data-help-area="${key}">${label}</button>`).join('')}</nav><div class="help-body">${appContent()}</div>`;
  }

  function init() {
    root()?.addEventListener('click', (event) => {
      const go = event.target.closest('[data-help-go]');
      if (go) {
        document.querySelector(`.nav-button[data-view="${go.dataset.helpGo}"]`)?.click();
        return;
      }
      const areaButton = event.target.closest('[data-help-area]');
      if (areaButton) {
        area = areaButton.dataset.helpArea || 'start'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
      }
      const button = event.target.closest('[data-help-tab]');
      if (!button) return;
      tab = button.dataset.helpTab || 'start'; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    render();
  }
  function home() { area = 'start'; tab = 'start'; render(); }
  function open(nextArea = 'start') { area = APP_AREAS.some(([key]) => key === nextArea) ? nextArea : 'start'; render(); }
  window.HelpView = { init, home, open };
})(window);
