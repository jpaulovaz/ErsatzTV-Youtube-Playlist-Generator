(() => {
  const TABS = [
    ['start', 'Começando'],
    ['resources', 'Recursos'],
    ['modules', 'Módulos'],
    ['combinations', 'Combinações'],
    ['publish', 'Publicar'],
    ['glossary', 'Glossário']
  ];

  const MODULES = [
    ['Rotação por tempo', 'Toca uma Source por alguns minutos e depois passa para a próxima.', '60 min de músicas A → 30 min de músicas B → volta para A.', 'Eventos fixos e Filler.'],
    ['Rotação por quantidade', 'Troca de Source depois de tocar uma quantidade de itens.', '3 clipes de A → 2 clipes de B → repete.', 'Eventos fixos e Filler. Normalmente substitui, e não soma, outra rotação de fundo.'],
    ['Rotação por peso', 'Escolhe as Sources pela proporção que você indicar. A ordem não fica presa.', 'Peso 60 para músicas novas e 20 para clássicas faz as novas aparecerem mais vezes.', 'Eventos fixos e Filler. Use esta opção como programação-base quando quiser variedade por proporção.'],
    ['Bloco contínuo por horário', 'A partir de um horário, uma Source fica tocando sem tempo para acabar. Um evento fixo pode entrar no meio; depois o bloco volta.', '06:00 desenhos; 12:00 séries; 18:00 filmes. Um jornal às 22:00 entra e, ao terminar, volta aos filmes.', 'Horários fixos. É a melhor opção para criar a programação-base do dia.'],
    ['Inserções após X itens', 'Depois de uma quantidade de itens principais, toca uma pequena inserção e volta.', '4 músicas → 1 vinheta → 4 músicas → 1 vinheta.', 'Eventos fixos e Filler. Este módulo já faz a alternância principal + inserção sozinho.'],
    ['Encaixar até o próximo evento', 'Quando falta pouco tempo para um evento, tenta escolher um item que caiba nesse espaço.', 'São 19:38 e o filme começa às 20:00. O módulo tenta achar algo curto para usar esses 22 minutos.', 'Eventos fixos e Filler.'],
    ['Horário fixo · quantidade', 'Em um horário marcado, toca uma quantidade de itens.', '10:00 → tocar 1 concerto.', 'Bloco contínuo, rotações e Pad To Nearest.'],
    ['Horário fixo · duração', 'Em um horário marcado, toca por um tempo. Se uma prioridade maior interromper, guarda o tempo que faltou.', '20:00 → música por 90 minutos.', 'Eventos de prioridade maior.'],
    ['Horário fixo · todos os itens', 'Em um horário marcado, toca tudo daquela Source. Depois que começa, termina antes de liberar outro módulo.', '14:00 → tocar todos os episódios de uma coleção especial.', 'Maratonas e especiais.'],
    ['Faixa de horário · fonte única', 'Usa uma Source somente entre dois horários.', '06:00–10:00 → programação da manhã.', 'Programação por turnos.'],
    ['Faixa de horário · rotação', 'Faz uma rotação própria somente dentro de uma faixa de horário.', '12:00–18:00 → alternar três Sources a cada 30 minutos.', 'Grades de manhã/tarde/noite.'],
    ['Sequência programada', 'Executa vários passos na ordem que você montar.', 'Vinheta → programa → promo → preencher até :30.', 'Programas com abertura, intervalo e encerramento.'],
    ['Repetição por intervalo', 'Repete um evento a cada X minutos.', 'Tocar uma vinheta a cada 30 minutos.', 'Station IDs, promos e chamadas.'],
    ['Escolha entre fontes', 'No horário marcado, escolhe uma das Sources disponíveis.', '20:00 → escolher entre três coleções de filmes.', 'Sessões variadas e programação menos previsível.'],
    ['Relógio de programação', 'Repete posições dentro de um ciclo.', 'Num ciclo de 60 min: :00 conteúdo, :15 vinheta, :30 conteúdo, :55 promo.', 'Canais com estrutura de rádio/TV.'],
    ['Programação especial temporária', 'Uma Source assume entre uma data/hora de início e fim. Depois a grade normal volta sozinha.', '24/12 18:00 até 26/12 06:00 → Especial de Natal.', 'Datas comemorativas e eventos.'],
    ['Evento em data específica', 'Executa uma vez numa data e hora exatas.', '31/12/2026 23:30 → Especial de Ano Novo.', 'Estreias e eventos únicos.'],
    ['Janela offline', 'Deixa uma faixa sem programação.', 'Domingo 03:00–05:00 → manutenção.', 'Manutenção. Não combine com Filler dentro da mesma janela.']
  ];

  let tab = 'start';
  const root = () => document.querySelector('#helpRoot');
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function moduleCards() {
    return `<div class="help-module-grid">${MODULES.map(([name, what, example, combine]) => `<article class="card help-module-card"><span class="eyebrow">Módulo</span><h3>${esc(name)}</h3><p><strong>O que faz:</strong> ${esc(what)}</p><div class="help-example"><strong>Exemplo simples</strong><span>${esc(example)}</span></div><p><strong>Combina bem com:</strong> ${esc(combine)}</p></article>`).join('')}</div>`;
  }

  function renderStart() {
    return `<section class="card help-lead"><span class="eyebrow">Comece aqui</span><h3>Pense no canal como uma programação de televisão</h3><p>Primeiro você diz <strong>de onde vem o conteúdo</strong>. Depois diz <strong>como ele aparece</strong>. Por último escolhe <strong>quando ele toca</strong>.</p><div class="help-steps"><div><strong>1</strong><span>Crie as Sources: filmes, músicas, séries, vinhetas.</span></div><div><strong>2</strong><span>Crie Presentations se quiser Graphics, watermarks ou pre-roll.</span></div><div><strong>3</strong><span>Adicione somente os módulos de programação que o canal precisa.</span></div><div><strong>4</strong><span>Valide, publique o script e vincule o arquivo uma vez no ErsatzTV.</span></div></div></section>
      <section class="card help-note"><h3>Uma regra importante</h3><p>Você não precisa usar todos os módulos. Um canal de música pode usar só uma rotação. Um canal de filmes pode usar Blocos Contínuos, eventos fixos e Filler.</p></section>`;
  }

  function renderResources() {
    return `<div class="help-module-grid">
      <article class="card help-module-card"><h3>Grupos de Graphics</h3><p>São listas de elementos visuais que você costuma ligar juntos.</p><div class="help-example"><strong>Exemplo</strong><span>Logo do canal + watermark = grupo COMMON_GRAPHICS.</span></div></article>
      <article class="card help-module-card"><h3>Sources</h3><p>São as prateleiras de conteúdo que os módulos podem usar.</p><div class="help-example"><strong>Exemplo</strong><span>MOVIES pode apontar para uma Smart Collection de filmes.</span></div><p><strong>Tipos mais comuns:</strong> Smart Collection usa uma coleção inteligente; Collection usa uma coleção comum; Playlist usa uma playlist; Search usa uma busca; Show aponta para um programa; Marathon agrupa conteúdo para tocar como maratona.</p></article>
      <article class="card help-module-card"><h3>Scripted Playlists</h3><p>São pequenas sequências reutilizáveis, muito úteis como pre-roll.</p><div class="help-example"><strong>Exemplo</strong><span>1 vinheta + 2 promos antes de um programa.</span></div></article>
      <article class="card help-module-card"><h3>Presentation Profiles</h3><p>Dizem como um conteúdo aparece: Graphics, watermark, pre-roll e agrupamento no EPG.</p><div class="help-example"><strong>Exemplo</strong><span>Perfil MUSIC liga créditos de música e o logo.</span></div></article>
      <article class="card help-module-card"><h3>Filler</h3><p>É o conteúdo de preenchimento. Ele entra quando sobra espaço e também é usado pelo Pad To Nearest Minute.</p><div class="help-example"><strong>Importante</strong><span>Filler não é a programação principal. Para uma Source tocar sem fim a partir de um horário, use Bloco Contínuo.</span></div></article>
      <article class="card help-module-card"><h3>Programação-base</h3><p>É o conteúdo que sustenta o canal quando nenhum evento especial está ativo. Normalmente você escolhe uma base: Rotação por tempo, Rotação por quantidade, Rotação por peso, Bloco contínuo ou Inserções após X itens.</p><div class="help-example"><strong>Exemplo</strong><span>Um canal de música pode usar Rotação por peso como base e colocar shows ao vivo em horários fixos.</span></div></article>
    </div>`;
  }

  function renderCombinations() {
    return `<div class="help-module-grid">
      <article class="card help-module-card"><h3>Canal de filmes</h3><p><strong>Bloco contínuo</strong> como base + <strong>Horário fixo</strong> para sessões especiais + <strong>Pad To Nearest</strong> + <strong>Filler</strong>.</p></article>
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
      ['Priority', 'Quem tem o número maior tem preferência quando duas programações disputam o mesmo momento.'],
      ['Pad To Nearest Minute', 'Depois de um bloco, usa o Filler até a próxima marca de 5, 10, 15 ou 30 minutos.'],
      ['Fallback Source', 'Source de reserva usada pelo próprio ErsatzTV dentro de operações de duração/pad. Não é o Filler geral do projeto.'],
      ['Filler kind', 'Uma marca enviada ao ErsatzTV para tratar aquele conteúdo como filler no EPG. Se você não precisa disso, deixe vazio.'],
      ['Trim', 'Permite cortar um item para ele caber exatamente. Deixe desligado se você não quer cortes.'],
      ['Deixar o vídeo terminar', 'Permite o vídeo acabar naturalmente mesmo que passe alguns minutos do horário planejado.'],
      ['State key', 'Nome que separa a memória interna de cada Playout. Canais diferentes devem usar chaves diferentes.'],
      ['Recorrência avançada', 'Permite regras como primeira segunda-feira do mês ou a cada 14 dias.']
    ];
    return `<div class="help-glossary">${items.map(([term, text]) => `<article class="card"><h3>${esc(term)}</h3><p>${esc(text)}</p></article>`).join('')}</div>`;
  }

  function content() {
    if (tab === 'resources') return renderResources();
    if (tab === 'modules') return moduleCards();
    if (tab === 'combinations') return renderCombinations();
    if (tab === 'publish') return renderPublish();
    if (tab === 'glossary') return renderGlossary();
    return renderStart();
  }

  function render() {
    const el = root(); if (!el) return;
    el.innerHTML = `<div class="page-header"><div><span class="page-kicker">Manual simples</span><h2>Ajuda</h2><p>Explicações sem linguagem técnica para montar e manter sua programação.</p></div></div><nav class="help-tabs" aria-label="Assuntos da ajuda">${TABS.map(([key, label]) => `<button type="button" class="${tab === key ? 'active' : ''}" data-help-tab="${key}">${label}</button>`).join('')}</nav><div class="help-body">${content()}</div>`;
  }

  function init() {
    root()?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-help-tab]');
      if (!button) return;
      tab = button.dataset.helpTab || 'start'; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    render();
  }
  function home() { tab = 'start'; render(); }
  window.HelpView = { init, home };
})(window);
