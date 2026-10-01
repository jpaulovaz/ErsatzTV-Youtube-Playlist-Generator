(() => {
  const MODULE_META = {
    rotation: { label: 'Rotação por tempo', hint: 'Alterna Sources por blocos de minutos.', combines: 'Eventos fixos e Filler.', pad: 'none', padNote: 'Não se aplica aqui: este módulo entrega um período inteiro ao ErsatzTV, sem uma pausa segura entre os itens.' },
    countRotation: { label: 'Rotação por quantidade', hint: 'Alterna Sources depois de tocar uma quantidade de itens.', combines: 'Eventos fixos e Filler. Use como alternativa à Rotação por tempo.', pad: 'direct', padNote: 'Disponível. O Filler entra depois de cada item.' },
    weightedRotation: { label: 'Rotação por peso', hint: 'Escolhe Sources por proporção, sem uma ordem rígida.', combines: 'Eventos fixos e Filler. Use como programação-base quando quiser variedade por proporção.', pad: 'direct', padNote: 'Disponível. Cada item pode ser alinhado antes da próxima escolha.' },
    continuousBlocks: { label: 'Bloco contínuo por horário', hint: 'A partir de um horário, toca uma Source sem duração final.', combines: 'Eventos fixos: eles entram e, ao terminar, o bloco contínuo volta.', pad: 'none', padNote: 'Não se aplica aqui, porque este bloco não termina sozinho.' },
    contentBreaks: { label: 'Inserções após X itens', hint: 'Toca uma inserção depois de uma quantidade de itens principais.', combines: 'Eventos fixos e Filler. Ele próprio faz a sequência principal → inserção → principal.', pad: 'direct', padNote: 'Disponível. O alinhamento acontece depois de cada item tocado.' },
    fitToWindow: { label: 'Encaixar até o próximo evento', hint: 'Tenta usar conteúdo que caiba no tempo disponível antes do próximo horário.', combines: 'Eventos fixos e Filler para fechar pequenos espaços.', pad: 'none', padNote: 'Não se aplica aqui, porque este módulo já trabalha até o próximo evento e pode usar Filler para a sobra.' },
    fixedEvents: { label: 'Horário fixo · quantidade', hint: 'Em um horário, toca uma quantidade definida de itens.', combines: 'Bloco contínuo, rotações e Pad To Nearest.', pad: 'direct', padNote: 'Disponível. Se tocar 3 itens: item → Pad → item → Pad → item → Pad.' },
    fixedDurationEvents: { label: 'Horário fixo · duração', hint: 'Em um horário, toca por X minutos e guarda o saldo se for interrompido.', combines: 'Bloco contínuo e eventos de prioridade maior.', pad: 'none', padNote: 'Não se aplica aqui: o ErsatzTV monta esse período de duração em uma única operação.' },
    fixedAllEvents: { label: 'Horário fixo · todos os itens', hint: 'Em um horário, toca todos os itens da Source antes de liberar outro módulo.', combines: 'Especiais e maratonas completas.', pad: 'none', padNote: 'Não se aplica aqui: o ErsatzTV recebe “todos os itens” de uma vez, sem um ponto seguro para inserir Pad entre eles.' },
    fixedWindowEvents: { label: 'Faixa de horário · fonte única', hint: 'Toca uma Source somente dentro de uma faixa de horário.', combines: 'Programação por turnos e eventos fixos.', pad: 'none', padNote: 'Não se aplica aqui: a faixa inteira é preenchida pelo ErsatzTV em uma única operação.' },
    windowRotations: { label: 'Faixa de horário · rotação', hint: 'Alterna Sources somente dentro de uma faixa de horário.', combines: 'Manhã/tarde/noite com estilos diferentes.', pad: 'none', padNote: 'Não se aplica aqui: cada etapa é definida por duração, não por quantidade de itens.' },
    sequenceEvents: { label: 'Sequência programada', hint: 'Executa vários passos na ordem que você montar.', combines: 'Vinheta + programa + intervalo + Pad.', pad: 'conditional', padNote: 'Disponível quando os passos de conteúdo usam Quantidade. Se houver Duração ou Todos os itens, a opção não aparece.' },
    intervalEvents: { label: 'Repetição por intervalo', hint: 'Repete um evento a cada X minutos dentro de uma faixa.', combines: 'Station IDs, promos e chamadas periódicas.', pad: 'conditional', padNote: 'Disponível quando o modo for Quantidade.' },
    choiceEvents: { label: 'Escolha entre fontes', hint: 'No horário marcado, escolhe uma das Sources disponíveis.', combines: 'Sessões de filme, sorteios de faixa e programação variada.', pad: 'conditional', padNote: 'Disponível quando o modo for Quantidade.' },
    clockTemplates: { label: 'Relógio de programação', hint: 'Repete posições dentro de um ciclo, como :00, :15, :30 e :45.', combines: 'Rádio/TV linear, IDs, promos e blocos de conteúdo.', pad: 'conditional', padNote: 'Em cada posição, o Pad aparece quando o modo for Quantidade.' },
    temporaryOverrides: { label: 'Programação especial temporária', hint: 'Uma Source assume entre uma data/hora inicial e final e depois a grade normal volta.', combines: 'Natal, maratonas, eventos e semanas temáticas.', pad: 'none', padNote: 'Não se aplica aqui: o período inteiro é preenchido como uma faixa de duração.' },
    dateEvents: { label: 'Evento em data específica', hint: 'Executa uma vez em uma data e hora exatas.', combines: 'Especiais, estreias e eventos únicos.', pad: 'conditional', padNote: 'Disponível em Quantidade. Em Sequência, funciona quando os passos de conteúdo usam Quantidade.' },
    offlineWindows: { label: 'Janela offline', hint: 'Reserva uma faixa de horário sem programação.', combines: 'Manutenção e períodos em que o canal deve ficar sem conteúdo.', pad: 'none', padNote: 'Não se aplica aqui, porque esta janela existe para deixar o canal sem programação.' }
  };

  const DAY_OPTIONS = [
    ['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom']
  ];
  const LATEST_TEMPLATE_VERSION = '1.3.1';
  const PAD_TO_NEAREST_OPTIONS = [5, 10, 15, 30];
  const FILLER_KIND_OPTIONS = [
    ['postroll', 'Post-roll', 'Depois do conteúdo. É a opção recomendada para preencher lacunas e para o Pad.'],
    ['preroll', 'Pre-roll', 'Antes do próximo conteúdo. Útil para vinhetas ou chamadas que pertencem ao que vai começar.'],
    ['midroll', 'Mid-roll', 'Como uma interrupção no meio do conteúdo. Use quando esse for realmente o papel do filler.'],
    ['none', 'Nenhum', 'Não marca como filler. O conteúdo pode aparecer como uma entrada própria no EPG.']
  ];

  const SOURCE_TYPES = [
    ['smart_collection', 'Smart Collection'], ['collection', 'Collection'], ['multi_collection', 'Multi-Collection'],
    ['playlist', 'Playlist'], ['search', 'Search'], ['show', 'Show'], ['marathon', 'Marathon']
  ];
  const ORDERABLE_SOURCE_TYPES = new Set(['smart_collection', 'collection', 'multi_collection', 'search', 'show']);

  const HELP_TEXT = {
    settingsOutputRoot: 'Pasta onde os arquivos .py serão salvos. Exemplo: /srv/ersatztv/scripts. O ErsatzTV precisa conseguir acessar esse mesmo caminho.',
    historyLimit: 'Quantas versões antigas você quer guardar para poder voltar atrás. Exemplo: 10 mantém as 10 publicações mais recentes.',
    projectName: 'Nome que você verá no aplicativo. Pode ser algo simples, como JohnFlix Filmes.',
    fileName: 'O nome do arquivo é criado automaticamente na primeira publicação usando o nome atual desta configuração. Depois disso, ele fica estável para não quebrar o vínculo com o ErsatzTV.',
    templateVersion: 'Versão do motor usada por este projeto. Projetos antigos só mudam de versão quando você pedir.',
    outputRootReadOnly: 'Pasta onde este projeto será publicado. Ela é definida na tela inicial de Scripted Schedules.',
    channel: 'Canal do ErsatzTV que vai usar este script. O aplicativo guarda o número do canal para fazer o vínculo.',
    stateKey: 'Identificador usado pelo script para lembrar rotação, saldos e eventos pendentes. Ele é criado automaticamente na primeira publicação usando o nome atual e o canal escolhido.',
    friendlyName: 'Nome fácil de reconhecer na tela. Pode ter espaços e não precisa ser igual à chave interna.',
    key: 'Nome interno usado pelo script para encontrar este item. Deve ser único e, de preferência, não mudar depois. Exemplo: MOVIES_PRIME.',
    graphicsElements: 'Arquivos YAML de Graphics Elements que fazem parte deste grupo, um por linha. Use image/icon.yml; se colocar / no início, o aplicativo corrige automaticamente.',
    includeGraphicsGroups: 'Use quando este grupo também deve ligar outros grupos já cadastrados. Exemplo: MUSIC_GRAPHICS pode incluir COMMON_GRAPHICS.',
    sourceType: 'Escolha de onde o ErsatzTV vai buscar o conteúdo: Smart Collection, Collection, Playlist, Search, Show ou Marathon.',
    playbackOrder: 'Escolha a ordem para este uso da Source. Chronological segue a ordem natural; Shuffle embaralha. A mesma Source pode usar ordens diferentes em outros blocos.',
    sourcePresentation: 'Presentation usada por padrão quando esta Source toca. Um módulo pode escolher outro perfil quando precisar.',
    smartCollection: 'Smart Collection do ErsatzTV usada como fonte. Quando o catálogo estiver disponível, basta escolher pelo nome.',
    ersatzName: 'Nome exato da Collection ou Multi-Collection no ErsatzTV.',
    playlist: 'Nome da Playlist no ErsatzTV.',
    playlistGroup: 'Grupo da Playlist no ErsatzTV. Ele ajuda o Scripted Schedule a encontrar a playlist certa.',
    searchQuery: 'Busca usada pelo ErsatzTV para encontrar mídia. Exemplo: type:movie AND tag:"comedia".',
    marathonGroupBy: 'Escolha como separar a maratona em grupos: show, temporada, artista, álbum ou diretor.',
    marathonItemOrder: 'Ordem dos itens dentro de cada grupo: cronológica ou embaralhada.',
    marathonPlayAll: 'Quando ligado, termina todos os itens do grupo atual antes de passar para o próximo.',
    marathonShuffleGroups: 'Embaralha a ordem dos grupos. A ordem dos itens dentro de cada grupo continua sendo a escolhida acima.',
    marathonSearches: 'Buscas usadas para montar a maratona, uma por linha. Exemplo: type:music_video.',
    guidProvider: 'Provedor do identificador. Exemplos comuns: tmdb e tvdb.',
    guidValue: 'Número ou texto do identificador nesse provedor. Exemplo: 12345.',
    playlistItemSource: 'Source usada neste passo da Scripted Playlist.',
    playlistItemCount: 'Quantos itens dessa Source entram antes de passar para o próximo passo. Exemplo: 2 toca dois itens.',
    preRoll: 'Scripted Playlist que toca antes dos itens deste perfil. É opcional; se ela ainda não existir, deixe vazio e volte depois.',
    epgGroup: 'Junta o conteúdo deste bloco em uma única entrada no EPG, em vez de mostrar cada item separado.',
    epgTitle: 'Título que aparece no EPG quando o agrupamento está ligado. Exemplo: Sessão Prime.',
    epgAdvance: 'Quando ligado, começa um novo grupo no EPG. Desligado, continua o grupo que já estiver aberto.',
    directGraphics: 'Graphics Elements que este perfil liga diretamente. Use um YAML por linha, como image/icon.yml; se colocar / no início, o aplicativo corrige automaticamente.',
    nativeWatermarks: 'Watermarks cadastrados no ErsatzTV. Eles são diferentes dos arquivos YAML de Graphics Elements.',
    graphicsGroupSelection: 'Escolha quais Grupos de Graphics serão ligados enquanto este perfil estiver ativo.',
    graphicsVariables: 'Valores personalizados enviados aos Graphics Elements. A chave precisa ter o mesmo nome usado no seu YAML. Não existe uma lista fixa: cada YAML pode criar as próprias variáveis.',
    graphicsVariableKey: 'Nome da variável usada no YAML. Exemplo: se o YAML usa {{ promo_text }}, a chave aqui é promo_text.',
    graphicsVariableValue: 'Valor que será colocado nessa variável. Exemplo: Hoje às 20h.',
    defaultRotationDuration: 'Tempo usado pela Rotação por tempo quando um item não informa a própria duração. Exemplo: 60 significa uma hora.',
    defaultPriority: 'Prioridade usada quando um evento não informa outra. Número maior tem preferência quando dois eventos disputam o mesmo momento.',
    httpTimeout: 'Quanto tempo o script espera uma resposta do ErsatzTV antes de considerar que a chamada falhou.',
    occurrenceRetention: 'Por quantos dias o script lembra eventos já processados. Isso evita repetir eventos antigos depois de um rebuild ou reinício.',
    allowOverrunGlobal: 'Deixa o vídeo atual terminar mesmo que passe do horário planejado. Use quando você prefere não cortar vídeos.',
    modulePicker: 'Escolha o tipo de programação que quer adicionar. Você só precisa dos módulos que realmente usa.',
    source: 'Source que fornece o conteúdo deste bloco. Ela precisa existir em Recursos.',
    presentation: 'Perfil visual usado neste bloco. Se ficar no padrão, vale a Presentation escolhida na Source.',
    duration: 'Tempo planejado para este bloco. Se o vídeo não puder ser cortado, o último item pode passar um pouco desse tempo.',
    id: 'Nome único deste evento dentro do projeto. O script usa esse ID para reconhecer a ocorrência e lembrar seu estado.',
    optionalName: 'Nome só para facilitar a leitura na tela e nos logs. Não muda o funcionamento do evento.',
    time: 'Horário em que este evento deve começar. Se um vídeo anterior estiver terminando e não puder ser cortado, o evento entra assim que ele acabar.',
    quantity: 'Quantidade de itens que serão tocados neste evento.',
    priority: 'Define qual evento tem preferência. Número maior vence; em empate, o que já está ativo continua.',
    startTime: 'Horário a partir do qual esta regra vale.',
    endTime: 'Horário em que esta regra deixa de valer. Se o fim for menor que o início, a faixa atravessa a meia-noite.',
    blockMinutes: 'Tempo padrão de cada etapa da rotação nesta faixa. Um item pode usar outro valor.',
    atomic: 'Mantém a sequência inteira junta antes de deixar outro módulo assumir. Use quando os passos não podem ser separados.',
    everyMinutes: 'De quanto em quanto tempo o evento se repete. Exemplo: 30 significa a cada 30 minutos.',
    mode: 'Escolha como o conteúdo será tocado: por quantidade, por duração, todos os itens ou, quando disponível, uma sequência.',
    latePolicy: 'O que fazer quando o horário já passou: deixar o evento esperando ou ignorá-lo se o atraso ficar grande demais.',
    maxLateness: 'Quanto atraso ainda é aceitável antes de ignorar o evento. Exemplo: 10 aceita até 10 minutos.',
    startPolicy: 'Escolha o que fazer quando o próximo conteúdo passaria do horário marcado para este evento.',
    maxEarlyMinutes: 'Quanto este evento pode começar antes do horário quando adiantar for mais próximo do que atrasar. O padrão é 40 minutos.',
    dateTime: 'Data e hora exatas de um evento que acontece uma vez. Exemplo: 24/12/2026 às 20:00.',
    eventEnabled: 'Liga ou desliga este evento sem precisar apagá-lo.',
    days: 'Dias da semana em que este evento pode acontecer. Sem dias marcados, não há limite por dia da semana.',
    startDate: 'Primeiro dia em que esta regra pode acontecer. Deixe vazio se não quiser limitar o início.',
    endDate: 'Último dia em que esta regra pode acontecer. Deixe vazio se não quiser limitar o fim.',
    onlyDates: 'Se preencher esta lista, o evento só acontece nessas datas. Use uma data por linha.',
    excludeDates: 'Datas que devem ser ignoradas mesmo quando as outras regras permitirem o evento. Use uma por linha.',
    customTitle: 'Troca o título mostrado no EPG para este conteúdo. Deixe vazio para usar o título normal.',
    fillerKind: 'Diz ao ErsatzTV como este conteúdo deve ser tratado no EPG. Post-roll é a escolha mais comum para preencher lacunas e para o Pad.',
    fallback: 'Source de reserva que o ErsatzTV pode usar para completar o tempo restante em operações de duração ou pad. É diferente do Filler geral do projeto.',
    discardAttempts: 'Quando Trim está desligado, diz quantos itens o ErsatzTV pode pular procurando um que caiba no tempo restante. Exemplo: 3 permite tentar três alternativas.',
    disableWatermarks: 'Desliga os watermarks do ErsatzTV só para este conteúdo. Não desliga os Graphics Elements em YAML.',
    trim: 'Permite cortar o fim do item para respeitar o limite de tempo. Ao ligar, “Deixar o vídeo terminar” é desligado automaticamente.',
    offlineTail: 'Depois de tocar tudo que couber, deixa o restante do tempo sem programação.',
    allowOverrun: 'Deixa o último vídeo terminar mesmo que passe do limite. Ao ligar, o Trim é desligado automaticamente.',
    padToNearest: 'Depois de cada item, usa o Filler até a próxima marca escolhida. Exemplo: com 15, um filme que termina 10:07 recebe Filler até 10:15. Um evento com horário marcado continua entrando no horário dele.',
    sequenceStepMode: 'Escolha o que este passo faz: quantidade, duração, todos os itens, preencher até a próxima marca ou esperar offline.',
    sequenceStepSource: 'Source usada só neste passo.',
    sequenceStepCount: 'Quantos itens este passo toca antes de seguir.',
    sequenceStepDuration: 'Quanto tempo este passo deve durar.',
    sequenceStepMark: 'Marca de relógio usada em “Até próxima marca”. Exemplo: 30 leva 10:07 até 10:30 usando a Source escolhida.',
    sequenceStepPresentation: 'Presentation usada só neste passo.',
    recurrenceType: 'Use para regras como primeira segunda-feira do mês ou a cada 14 dias. Se não precisar, deixe em “Sem recorrência extra”.',
    recurrenceOrdinal: 'Escolha qual ocorrência do dia no mês. Exemplo: 1ª segunda-feira ou última sexta-feira.',
    recurrenceWeekday: 'Dia da semana usado nessa recorrência mensal.',
    recurrenceEveryDays: 'Repete a regra a cada N dias. Exemplo: 14 cria uma programação quinzenal.',
    recurrenceAnchorDate: 'Data usada como ponto de partida para a repetição a cada N dias.',
    weight: 'Controla a frequência relativa desta Source. Exemplo: peso 60 contra 20 faz a primeira aparecer cerca de três vezes mais.',
    avoidRepeat: 'Evita escolher a mesma Source duas vezes seguidas quando houver outra disponível.',
    everyItems: 'Quantos itens principais tocam antes da inserção. Exemplo: 4 significa “depois de quatro músicas, faça a pausa”.',
    breakSource: 'Source que toca na inserção. Exemplo: STATION_IDS ou PROMOS.',
    breakCount: 'Quantos itens da Source de inserção tocam antes de voltar ao conteúdo principal.',
    breakPresentation: 'Presentation usada só durante a inserção.',
    lookAhead: 'Quanto tempo antes do próximo evento este módulo começa a procurar algo que caiba. Exemplo: 45 olha os próximos 45 minutos.',
    fitDiscard: 'Quantos itens podem ser pulados enquanto o ErsatzTV procura um que caiba no tempo restante.',
    fitFiller: 'Usa o Filler geral para completar um pequeno espaço antes do próximo evento. O Filler precisa estar configurado.',
    selection: 'Escolha como selecionar uma Source. “Por peso” segue as proporções; “Em rodízio” passa pelas opções em ordem.',
    choiceWeight: 'Peso desta opção quando a escolha estiver usando “Por peso”.',
    cycleMinutes: 'Tamanho do ciclo que se repete. Exemplo: 60 cria um relógio de uma hora.',
    offsetMinutes: 'Posição dentro do ciclo. Num ciclo de 60 minutos, 15 significa :15.',
    startDatetime: 'Data e hora em que a programação especial começa.',
    endDatetime: 'Data e hora em que a programação especial termina e a programação normal volta.',
    moduleDescription: 'Resumo rápido do módulo. A Ajuda tem exemplos e combinações quando você quiser ver mais detalhes.',
    fillerSource: 'Source usada para preencher lacunas. Ela também é usada pelo Pad To Nearest Minute.',
    fillerPresentation: 'Presentation usada enquanto o Filler estiver tocando.'
  };

  const state = {
    deps: null,
    settings: null,
    projects: [],
    catalog: { channels: [], smartCollections: [] },
    current: null,
    tab: 'general',
    validation: null,
    preview: '',
    history: [],
    openAccordions: new Set(),
    modulePickerOpen: false,
    modulePickerSelection: '',
    loading: false
  };

  const root = () => document.querySelector('#scriptedSchedulesRoot');
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function help(key) {
    const text = HELP_TEXT[key] || '';
    if (!text) return '';
    return `<span class="ss-help" tabindex="0" aria-label="Ajuda: ${esc(text)}" data-ss-help="${esc(text)}">?</span>`;
  }

  function labelTitle(text, key, extra = '') {
    return `<span class="ss-label-title">${esc(text)}${help(key)}${extra}</span>`;
  }

  let helpPopover = null;
  function ensureHelpPopover() {
    if (helpPopover?.isConnected) return helpPopover;
    helpPopover = document.createElement('div');
    helpPopover.className = 'ss-help-popover';
    helpPopover.setAttribute('role', 'tooltip');
    helpPopover.hidden = true;
    document.body.appendChild(helpPopover);
    return helpPopover;
  }

  function hideHelpPopover() {
    if (!helpPopover) return;
    helpPopover.hidden = true;
    helpPopover.textContent = '';
  }

  function showHelpPopover(target) {
    const text = target?.dataset?.ssHelp;
    if (!text) return;
    const popover = ensureHelpPopover();
    popover.textContent = text;
    popover.hidden = false;
    popover.style.left = '12px';
    popover.style.top = '12px';
    const targetRect = target.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    let left = targetRect.left + (targetRect.width / 2) - (popRect.width / 2);
    left = Math.max(12, Math.min(left, window.innerWidth - popRect.width - 12));
    let top = targetRect.bottom + 8;
    if (top + popRect.height > window.innerHeight - 12 && targetRect.top - popRect.height - 8 >= 12) {
      top = targetRect.top - popRect.height - 8;
    }
    top = Math.max(12, Math.min(top, window.innerHeight - popRect.height - 12));
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function helpTarget(event) {
    return event.target?.closest?.('[data-ss-help]') || null;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pathParts(path) { return String(path || '').split('.').filter(Boolean).map((part) => /^\d+$/.test(part) ? Number(part) : part); }
  function getPath(obj, path) { let cur = obj; for (const p of pathParts(path)) cur = cur?.[p]; return cur; }
  function setPath(obj, path, value) {
    const parts = pathParts(path); let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
  }
  function listValue(value) { return Array.isArray(value) ? value.join('\n') : ''; }
  function parseList(value) { return String(value || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean); }
  function normalizeGraphicsElementPath(value) { return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, ''); }
  function normalizeGraphicsList(value) { return (Array.isArray(value) ? value : []).map(normalizeGraphicsElementPath).filter(Boolean); }
  function isGraphicsListPath(path) { return /^graphicsGroups\.\d+\.graphics$/.test(path) || /^presentationProfiles\.\d+\.graphics$/.test(path); }
  function slug(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_') || 'schedule';
  }
  function sourceOptions(selected = '', includeBlank = true) {
    const options = state.current?.sources || [];
    return `${includeBlank ? '<option value="">Selecione...</option>' : ''}${options.map((item) => `<option value="${esc(item.key)}" ${String(item.key) === String(selected) ? 'selected' : ''}>${esc(item.key)}${item.name ? ` — ${esc(item.name)}` : ''}</option>`).join('')}`;
  }
  function visibleProfiles() {
    return (state.current?.presentationProfiles || []).filter((item) => String(item?.key || '').trim().toLowerCase() !== 'none');
  }
  function profileOptions(selected = '', includeBlank = true) {
    const options = visibleProfiles();
    const noneSelected = String(selected || '').trim().toLowerCase() === 'none';
    return `${includeBlank ? '<option value="">Padrão da Source</option>' : ''}<option value="none" ${noneSelected ? 'selected' : ''}>Nenhum</option>${options.map((item) => `<option value="${esc(item.key)}" ${String(item.key) === String(selected) ? 'selected' : ''}>${esc(item.label || item.key)}</option>`).join('')}`;
  }
  function playlistOptions(selected = '') {
    return `<option value="">Sem pre-roll</option>${(state.current?.scriptedPlaylists || []).map((item) => `<option value="${esc(item.key)}" ${String(item.key) === String(selected) ? 'selected' : ''}>${esc(item.key)}</option>`).join('')}`;
  }
  function smartCollectionOptions(selected = '') {
    const items = state.catalog.smartCollections || [];
    if (!items.length) return '';
    return `<option value="">Selecione...</option>${items.map((item) => `<option value="${esc(item.name)}" ${String(item.name) === String(selected) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}`;
  }
  function channelOptions(selected = '') {
    return `<option value="">Selecione...</option>${(state.catalog.channels || []).map((item) => `<option value="${esc(item.number)}" data-name="${esc(item.name)}" ${String(item.number) === String(selected) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}`;
  }

  async function init(deps) {
    state.deps = deps;
    const el = root();
    if (!el) return;
    bindRoot();
    await reloadCatalog(false);
    await reloadList();
  }

  async function reloadCatalog(showErrors = false) {
    try {
      const response = await state.deps.api('/api/ersatztv/catalog');
      state.catalog = response.catalog || state.catalog;
    } catch (error) {
      state.catalog = { channels: [], smartCollections: [] };
      if (showErrors) state.deps.showToast(`ErsatzTV: ${error.message}`, true);
    }
  }

  async function reloadList() {
    state.loading = true; render();
    try {
      const [projectsResponse, settingsResponse] = await Promise.all([
        state.deps.api('/api/scripted-schedules'),
        state.deps.api('/api/scripted-schedules/settings')
      ]);
      state.projects = projectsResponse.projects || [];
      state.settings = settingsResponse.settings || null;
    } finally {
      state.loading = false; render();
    }
  }

  async function openProject(id) {
    state.loading = true; render();
    try {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(id)}`);
      state.current = clone(response.project);
      state.tab = 'general'; state.validation = null; state.preview = ''; state.history = []; state.openAccordions.clear();
      await reloadCatalog(false);
    } finally { state.loading = false; render(); }
  }

  function bindRoot() {
    const el = root();
    el.addEventListener('click', (event) => {
      const target = helpTarget(event);
      if (target) showHelpPopover(target);
      handleClick(event).catch((error) => state.deps.showToast(error.message, true));
    });
    el.addEventListener('mouseover', (event) => { const target = helpTarget(event); if (target) showHelpPopover(target); });
    el.addEventListener('mouseout', (event) => {
      const target = helpTarget(event);
      if (target && !target.contains(event.relatedTarget)) hideHelpPopover();
    });
    el.addEventListener('focusin', (event) => { const target = helpTarget(event); if (target) showHelpPopover(target); });
    el.addEventListener('focusout', (event) => { const target = helpTarget(event); if (target) hideHelpPopover(); });
    el.addEventListener('input', handleInput);
    el.addEventListener('change', handleInput);
    el.addEventListener('toggle', handleAccordionToggle, true);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.modulePickerOpen) {
        event.preventDefault();
        state.modulePickerOpen = false;
        state.modulePickerSelection = '';
        render();
        window.requestAnimationFrame(() => root()?.querySelector('[data-ss-action="open-module-picker"]')?.focus());
      }
    });
    window.addEventListener('resize', hideHelpPopover);
    window.addEventListener('scroll', hideHelpPopover, true);
  }

  function handleAccordionToggle(event) {
    const details = event.target;
    if (!details?.matches?.('details[data-ss-accordion]')) return;
    const key = details.dataset.ssAccordion;
    if (!key) return;
    if (details.open) state.openAccordions.add(key);
    else state.openAccordions.delete(key);
  }

  function accordionAttrs(key) {
    return `data-ss-accordion="${esc(key)}"${state.openAccordions.has(key) ? ' open' : ''}`;
  }

  function openAccordion(key) {
    state.openAccordions.add(key);
  }

  function clearAccordionPrefix(prefix) {
    for (const key of [...state.openAccordions]) {
      if (key.startsWith(prefix)) state.openAccordions.delete(key);
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (!state.current) {
      if (target.matches('[data-ss-settings="outputRoot"]')) state.settings.outputRoot = target.value;
      if (target.matches('[data-ss-settings="historyLimit"]')) state.settings.historyLimit = Number(target.value) || 10;
      return;
    }
    const path = target.dataset.bind;
    if (path) {
      let value;
      if (target.type === 'checkbox') value = target.checked;
      else if (target.dataset.type === 'number') value = target.value === '' ? '' : Number(target.value);
      else if (target.dataset.type === 'list') {
        value = parseList(target.value);
        if (event.type === 'change' && isGraphicsListPath(path)) {
          value = normalizeGraphicsList(value);
          target.value = listValue(value);
        }
      } else value = target.value;
      setPath(state.current, path, value);
      if (target.type === 'checkbox' && value === true && path.endsWith('.trim')) {
        setPath(state.current, `${path.slice(0, path.lastIndexOf('.'))}.allowOverrun`, false);
      }
      if (target.type === 'checkbox' && value === true && path.endsWith('.allowOverrun')) {
        setPath(state.current, `${path.slice(0, path.lastIndexOf('.'))}.trim`, false);
      }
      state.validation = null;
      if (target.dataset.rerender === 'true') render();
    }

    if (target.dataset.channelIndex !== undefined) {
      const index = Number(target.dataset.channelIndex);
      const link = state.current.channelLinks[index];
      const selected = target.selectedOptions?.[0];
      link.channelNumber = target.value;
      link.channelName = selected?.dataset.name || '';
      if (state.current.publishedAt && (!link.stateKey || /^schedule(?:_\d+)?$/.test(link.stateKey))) link.stateKey = `${slug(state.current.name)}_${String(target.value || index + 1)}`;
      render();
    }

    if (target.dataset.arrayToggle) {
      const arr = getPath(state.current, target.dataset.arrayToggle) || [];
      const value = target.value;
      const next = target.checked ? [...new Set([...arr, value])] : arr.filter((item) => item !== value);
      setPath(state.current, target.dataset.arrayToggle, next);
    }
  }

  async function handleClick(event) {
    const button = event.target.closest('[data-ss-action]');
    if (!button) return;
    const action = button.dataset.ssAction;

    if (action === 'new-project') {
      const decision = await state.deps.showDialog({ eyebrow: 'Scripted Schedules', title: 'Novo projeto', message: 'Informe um nome para esta programação.', input: true, inputRequired: true, inputLabel: 'Nome', confirmLabel: 'Criar' });
      if (!decision.confirmed) return;
      const response = await state.deps.api('/api/scripted-schedules', { method: 'POST', body: JSON.stringify({ name: decision.value }) });
      await openProject(response.project.id); return;
    }
    if (action === 'refresh-catalog') { await reloadCatalog(true); render(); return; }
    if (action === 'save-settings') {
      const response = await state.deps.api('/api/scripted-schedules/settings', { method: 'PUT', body: JSON.stringify(state.settings) });
      state.settings = response.settings; state.deps.showToast('Pasta de scripts atualizada.'); render(); return;
    }
    if (action === 'edit') return openProject(button.dataset.id);
    if (action === 'open-preview') { await openProject(button.dataset.id); await loadPreview(); state.tab = 'publish'; render(); return; }
    if (action === 'open-history') { await openProject(button.dataset.id); await loadHistory(); state.tab = 'publish'; render(); return; }
    if (action === 'open-reset') {
      await openProject(button.dataset.id);
      if (state.current.channelLinks.length === 1) return resetPlayout(state.current.channelLinks[0].channelNumber);
      state.tab = 'publish'; render(); state.deps.showToast('Escolha o canal no Assistente de vínculo.'); return;
    }
    if (action === 'duplicate') {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(button.dataset.id)}/duplicate`, { method: 'POST', body: '{}' });
      state.deps.showToast('Projeto duplicado. Renomeie e escolha o novo canal antes de publicar.'); await openProject(response.project.id); return;
    }
    if (action === 'delete') {
      const item = state.projects.find((p) => p.id === button.dataset.id);
      const decision = await state.deps.showDialog({
        eyebrow: 'Scripted Schedules', title: 'Excluir projeto', message: `Excluir ${item?.name || 'este projeto'}?`,
        warning: 'A opção principal mantém o arquivo Python publicado. Use a segunda opção apenas se também quiser remover o arquivo.',
        confirmLabel: 'Excluir projeto', danger: true, secondaryLabel: 'Excluir projeto e arquivo', secondaryDanger: true
      });
      if (!decision.confirmed && !decision.secondary) return;
      await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', body: JSON.stringify({ removePublished: decision.secondary }) });
      state.deps.showToast('Projeto removido.'); await reloadList(); return;
    }
    if (action === 'back') { state.current = null; state.validation = null; state.preview = ''; state.history = []; await reloadList(); return; }
    if (action === 'tab') { state.tab = button.dataset.tab; render(); return; }
    if (action === 'publish') { await publishCurrent(); return; }
    if (action === 'validate') { await validateCurrent(); return; }
    if (action === 'preview') { await loadPreview(); state.tab = 'publish'; render(); return; }
    if (action === 'history') { await loadHistory(); state.tab = 'publish'; render(); return; }
    if (action === 'restore') { await restoreRevision(button.dataset.revision); return; }
    if (action === 'copy-path') { await copyText(button.dataset.value || ''); return; }
    if (action === 'reset-playout') { await resetPlayout(button.dataset.channel); return; }

    if (!state.current) return;
    if (action === 'upgrade-template') { state.current.templateVersion = LATEST_TEMPLATE_VERSION; state.validation = null; state.deps.showToast(`Motor atualizado para ${LATEST_TEMPLATE_VERSION}. A alteração será efetivada ao salvar e publicar.`); render(); return; }
    if (action === 'add-channel') {
      state.current.channelLinks.push({ channelNumber: '', channelName: '', stateKey: '', status: 'local' }); render(); return;
    }
    if (action === 'remove-channel') { state.current.channelLinks.splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'add-resource') { const kind = button.dataset.kind; const index = addResource(kind); openAccordion(`resources:${kind}`); if (index >= 0) openAccordion(`resource:${kind}:${index}`); render(); return; }
    if (action === 'remove-resource') { const kind = button.dataset.kind; removeResource(kind, Number(button.dataset.index)); clearAccordionPrefix(`resource:${kind}:`); render(); return; }
    if (action === 'add-playlist-item') { state.current.scriptedPlaylists[Number(button.dataset.index)].items.push({ source: firstSource(), order: 'shuffle', count: 1 }); render(); return; }
    if (action === 'remove-playlist-item') { state.current.scriptedPlaylists[Number(button.dataset.index)].items.splice(Number(button.dataset.itemIndex), 1); render(); return; }
    if (action === 'move-playlist-item') { moveItem(state.current.scriptedPlaylists[Number(button.dataset.index)].items, Number(button.dataset.itemIndex), Number(button.dataset.delta)); render(); return; }
    if (action === 'add-guid') { getPath(state.current, button.dataset.path).push({ provider: 'tmdb', value: '' }); render(); return; }
    if (action === 'remove-guid') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'add-variable') { getPath(state.current, button.dataset.path).push({ key: '', value: '' }); render(); return; }
    if (action === 'remove-variable') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'open-module-picker') { state.modulePickerOpen = true; state.modulePickerSelection = ''; render(); window.requestAnimationFrame(() => root()?.querySelector('.ss-module-picker-item')?.focus()); return; }
    if (action === 'close-module-picker') { state.modulePickerOpen = false; state.modulePickerSelection = ''; render(); window.requestAnimationFrame(() => root()?.querySelector('[data-ss-action="open-module-picker"]')?.focus()); return; }
    if (action === 'select-module') { state.modulePickerSelection = button.dataset.module || ''; render(); window.requestAnimationFrame(() => root()?.querySelector(`[data-ss-action="select-module"][data-module="${state.modulePickerSelection}"]`)?.focus()); return; }
    if (action === 'add-module') { const type = button.dataset.module || state.modulePickerSelection; if (!type) return; addModule(type); state.modulePickerOpen = false; state.modulePickerSelection = ''; openAccordion(`module:${type}`); openAccordion(`module-entry:${type}:0`); render(); return; }
    if (action === 'remove-module') { const type = button.dataset.module; state.current.modules[type] = []; state.openAccordions.delete(`module:${type}`); clearAccordionPrefix(`module-entry:${type}:`); render(); return; }
    if (action === 'add-module-entry') { const type = button.dataset.module; const index = state.current.modules[type].length; state.current.modules[type].push(defaultModuleEntry(type)); openAccordion(`module:${type}`); openAccordion(`module-entry:${type}:${index}`); render(); return; }
    if (action === 'remove-module-entry') { const type = button.dataset.module; state.current.modules[type].splice(Number(button.dataset.index), 1); clearAccordionPrefix(`module-entry:${type}:`); render(); return; }
    if (action === 'add-window-item') { state.current.modules.windowRotations[Number(button.dataset.index)].items.push({ source: firstSource(), order: 'shuffle', presentation: '', durationMinutes: '' }); render(); return; }
    if (action === 'remove-window-item') { state.current.modules.windowRotations[Number(button.dataset.index)].items.splice(Number(button.dataset.itemIndex), 1); render(); return; }
    if (action === 'add-step') { getPath(state.current, button.dataset.path).push({ mode: 'count', source: firstSource(), order: 'shuffle', count: 1, presentation: '' }); render(); return; }
    if (action === 'remove-step') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'add-choice') { getPath(state.current, button.dataset.path).push({ source: firstSource(), order: 'shuffle', presentation: '', weight: 1 }); render(); return; }
    if (action === 'remove-choice') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'add-clock-slot') { getPath(state.current, button.dataset.path).push({ offsetMinutes: 0, mode: 'count', source: firstSource(), order: 'shuffle', count: 1, durationMinutes: '', presentation: '', priority: '', padToNearestMinutes: '' }); render(); return; }
    if (action === 'remove-clock-slot') { getPath(state.current, button.dataset.path).splice(Number(button.dataset.index), 1); render(); return; }
    if (action === 'toggle-filler') {
      if (state.current.filler) {
        const cleared = clearPadToNearestSettings();
        state.current.filler = null;
        if (cleared) state.deps.showToast(`Filler desativado; ${cleared} alinhamento(s) Pad To Nearest Minute também foram desativados.`);
      } else {
        state.current.filler = { source: firstSource(), order: 'shuffle', presentation: '', fillerKind: 'postroll' };
        openAccordion('programming:filler');
      }
      state.validation = null; render(); return;
    }
  }

  async function publishCurrent() {
    try {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}`, { method: 'PUT', body: JSON.stringify(state.current) });
      state.current = clone(response.project); state.validation = response.validation || null;
      state.preview = ''; state.history = [];
      state.deps.showToast('Script publicado com sucesso.');
      state.tab = 'publish'; render();
    } catch (error) {
      if (error.payload?.validation) state.validation = error.payload.validation;
      state.tab = 'review'; render(); throw error;
    }
  }

  async function validateCurrent() {
    try {
      const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/validate`, { method: 'POST', body: JSON.stringify(state.current) });
      state.validation = response.validation; state.deps.showToast('Configuração válida.');
    } catch (error) {
      state.validation = error.payload?.validation || { ok: false, errors: [{ path: '', message: error.message }], warnings: [] };
    }
    render();
  }

  async function loadPreview() {
    const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/preview`, { method: 'POST', body: JSON.stringify(state.current) });
    state.preview = response.script || '';
  }
  async function loadHistory() {
    const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/history`);
    state.history = response.history || [];
  }
  async function restoreRevision(revisionId) {
    const decision = await state.deps.showDialog({ eyebrow: 'Histórico', title: 'Restaurar revisão', message: 'A revisão escolhida será restaurada e o arquivo Python será publicado novamente.', warning: 'A versão atual também será preservada no histórico.', confirmLabel: 'Restaurar' });
    if (!decision.confirmed) return;
    const response = await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/restore`, { method: 'POST', body: JSON.stringify({ revisionId }) });
    state.current = clone(response.project); state.preview = ''; await loadHistory(); state.deps.showToast('Revisão restaurada.'); render();
  }
  async function resetPlayout(channelNumber) {
    const link = state.current.channelLinks.find((item) => String(item.channelNumber) === String(channelNumber));
    const decision = await state.deps.showDialog({
      eyebrow: 'ErsatzTV', title: 'Reset Playout',
      message: `Reconstruir o Playout de ${link?.channelName || 'este canal'}?`,
      warning: 'Esta ação é destrutiva: o ErsatzTV reconstruirá o Playout e o progresso atual pode ser perdido.',
      confirmLabel: 'Reset Playout', danger: true
    });
    if (!decision.confirmed) return;
    await state.deps.api(`/api/scripted-schedules/${encodeURIComponent(state.current.id)}/reset-playout`, { method: 'POST', body: JSON.stringify({ channelNumber }) });
    state.deps.showToast('Reset Playout enviado ao ErsatzTV.');
  }
  async function copyText(value) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    state.deps.showToast('Copiado.');
  }

  function firstSource() { return state.current?.sources?.[0]?.key || ''; }
  function nextKey(prefix, items) {
    let i = items.length + 1; let key = `${prefix}_${i}`;
    const existing = new Set(items.map((x) => x.key)); while (existing.has(key)) { i += 1; key = `${prefix}_${i}`; } return key;
  }
  function addResource(kind) {
    const map = { graphics: 'graphicsGroups', source: 'sources', playlist: 'scriptedPlaylists', profile: 'presentationProfiles' };
    const list = state.current[map[kind]];
    if (!list) return -1;
    if (kind === 'graphics') list.push({ key: nextKey('GRAPHICS', list), label: 'Novo grupo', graphics: [], includes: [] });
    if (kind === 'source') list.push({ key: nextKey('SOURCE', list), label: 'Nova Source', type: 'smart_collection', name: '', presentation: 'none', guids: [], searches: [] });
    if (kind === 'playlist') list.push({ key: nextKey('PLAYLIST', list), label: 'Nova Scripted Playlist', items: [{ source: firstSource(), count: 1 }] });
    if (kind === 'profile') list.push({ key: nextKey('profile', list).toLowerCase(), label: 'Novo perfil', graphicsGroups: [], graphics: [], graphicsVariables: [], watermarks: [], preRoll: null, epgGroup: false, epgTitle: '', epgAdvance: true });
    return list.length - 1;
  }
  function removeResource(kind, index) {
    const map = { graphics: 'graphicsGroups', source: 'sources', playlist: 'scriptedPlaylists', profile: 'presentationProfiles' };
    state.current[map[kind]].splice(index, 1);
  }
  function moveItem(items, index, delta) {
    const target = index + delta; if (target < 0 || target >= items.length) return;
    const [item] = items.splice(index, 1); items.splice(target, 0, item);
  }
  function addModule(type) {
    if (!type || !state.current.modules[type] || state.current.modules[type].length) return;
    state.current.modules[type].push(defaultModuleEntry(type));
  }
  function defaultFilters() {
    return {
      days: [], startDate: '', endDate: '', dates: [], excludeDates: [], enabled: true,
      recurrenceType: 'none', recurrenceOrdinal: 1, recurrenceWeekday: 0,
      recurrenceEveryDays: 14, recurrenceAnchorDate: new Date().toISOString().slice(0, 10)
    };
  }
  function defaultBase(id) { return { id, label: '', priority: state.current.options.defaultFixedPriority || 100, presentation: '', ...defaultFilters() }; }
  function defaultStartTiming() { return { startPolicy: 'closest', maxEarlyMinutes: 40 }; }
  function defaultModuleEntry(type) {
    const s = firstSource(); const p = state.current.options.defaultFixedPriority || 100; const n = (state.current.modules[type]?.length || 0) + 1;
    if (type === 'rotation') return { source: s, order: 'shuffle', presentation: '', durationMinutes: state.current.options.defaultRotationDurationMinutes || 60 };
    if (type === 'countRotation') return { source: s, order: 'shuffle', presentation: '', count: 3, padToNearestMinutes: '' };
    if (type === 'weightedRotation') return { source: s, order: 'shuffle', presentation: '', weight: 1, avoidRepeat: true, padToNearestMinutes: '' };
    if (type === 'continuousBlocks') return { ...defaultBase(`continuous_${n}`), startTime: '06:00', source: s, order: 'shuffle', priority: p };
    if (type === 'contentBreaks') return { ...defaultBase(`breaks_${n}`), source: s, order: 'shuffle', everyItems: 4, breakSource: s, breakOrder: 'shuffle', breakCount: 1, breakPresentation: '', breakPlayback: {}, priority: p, padToNearestMinutes: '' };
    if (type === 'fitToWindow') return { ...defaultBase(`fit_${n}`), startTime: '00:00', endTime: '00:00', source: s, order: 'shuffle', lookAheadMinutes: 45, discardAttempts: 5, useFillerRemainder: true, priority: p };
    if (type === 'fixedEvents') return { ...defaultBase(`fixed_${n}`), ...defaultStartTiming(), time: '10:00', source: s, order: 'shuffle', count: 1, priority: p, padToNearestMinutes: '' };
    if (type === 'fixedDurationEvents') return { ...defaultBase(`duration_${n}`), ...defaultStartTiming(), time: '20:00', source: s, order: 'shuffle', durationMinutes: 60, priority: p };
    if (type === 'fixedAllEvents') return { ...defaultBase(`all_${n}`), ...defaultStartTiming(), time: '14:00', source: s, order: 'shuffle', priority: p };
    if (type === 'fixedWindowEvents') return { ...defaultBase(`window_${n}`), startTime: '06:00', endTime: '10:00', source: s, order: 'shuffle', priority: p };
    if (type === 'windowRotations') return { ...defaultBase(`window_rotation_${n}`), startTime: '12:00', endTime: '18:00', blockMinutes: 30, priority: p, items: [{ source: s, order: 'shuffle', presentation: '', durationMinutes: '' }] };
    if (type === 'sequenceEvents') return { ...defaultBase(`sequence_${n}`), ...defaultStartTiming(), time: '19:55', priority: p, atomic: false, steps: [{ mode: 'count', source: s, order: 'shuffle', count: 1, presentation: '' }], padToNearestMinutes: '' };
    if (type === 'intervalEvents') return { ...defaultBase(`interval_${n}`), ...defaultStartTiming(), startTime: '00:00', endTime: '00:00', everyMinutes: 30, source: s, order: 'shuffle', mode: 'count', count: 1, durationMinutes: '', priority: p, latePolicy: 'skip', maxLatenessMinutes: 10, padToNearestMinutes: '' };
    if (type === 'choiceEvents') return { ...defaultBase(`choice_${n}`), ...defaultStartTiming(), time: '20:00', mode: 'count', count: 1, durationMinutes: '', selection: 'weighted', choices: [{ source: s, order: 'shuffle', presentation: '', weight: 1 }], priority: p, padToNearestMinutes: '' };
    if (type === 'clockTemplates') return { ...defaultBase(`clock_${n}`), ...defaultStartTiming(), startTime: '00:00', endTime: '00:00', cycleMinutes: 60, priority: p, slots: [{ offsetMinutes: 0, mode: 'count', source: s, order: 'shuffle', count: 1, durationMinutes: '', presentation: '', priority: '', padToNearestMinutes: '' }] };
    if (type === 'temporaryOverrides') return { ...defaultBase(`override_${n}`), startDatetime: `${new Date().toISOString().slice(0, 10)} 18:00`, endDatetime: `${new Date().toISOString().slice(0, 10)} 23:59`, source: s, order: 'shuffle', priority: 500 };
    if (type === 'dateEvents') return { ...defaultBase(`date_${n}`), ...defaultStartTiming(), datetime: `${new Date().toISOString().slice(0, 10)} 20:00`, source: s, order: 'shuffle', mode: 'count', count: 1, durationMinutes: '', priority: p, steps: [], padToNearestMinutes: '' };
    if (type === 'offlineWindows') return { ...defaultBase(`offline_${n}`), startTime: '03:00', endTime: '05:00', priority: 1000 };
    return {};
  }

  function render() {
    const el = root();
    if (!el) return;
    hideHelpPopover();
    if (state.loading) {
      el.innerHTML = '<section class="card ss-loading"><strong>Carregando Scripted Schedules...</strong></section>';
      return;
    }
    el.innerHTML = state.current ? renderEditor() : renderList();
  }

  function renderList() {
    const cards = state.projects.length ? state.projects.map(renderProjectCard).join('') : `
      <section class="card ss-empty">
        <span class="eyebrow">Programação</span>
        <h3>Nenhum Scripted Schedule criado</h3>
        <p>Crie um projeto para montar a programação pela interface e publicar o arquivo Python usado pelo ErsatzTV.</p>
        <button type="button" class="primary" data-ss-action="new-project">Novo Scripted Schedule</button>
      </section>`;
    return `
      <div class="page-header ss-page-header">
        <div><span class="page-kicker">Programação</span><h2>Scripted Schedules</h2></div>
        <button type="button" class="primary" data-ss-action="new-project">Novo Scripted Schedule</button>
      </div>
      ${renderSettingsCard()}
      <div class="ss-project-grid">${cards}</div>`;
  }

  function renderSettingsCard() {
    const settings = state.settings || { outputRoot: '', historyLimit: 10 };
    return `
      <details class="card ss-settings-card">
        <summary><strong>Pasta de saída dos scripts</strong><span>${esc(settings.outputRoot || 'Não configurada')}</span></summary>
        <div class="ss-settings-body">
          <label class="wide">${labelTitle('Pasta absoluta', 'settingsOutputRoot')}
            <input type="text" data-ss-settings="outputRoot" value="${esc(settings.outputRoot || '')}" placeholder="/srv/ersatztv/scripts">
          </label>
          <label>${labelTitle('Versões no histórico', 'historyLimit')}
            <input type="number" min="1" max="50" data-ss-settings="historyLimit" value="${esc(settings.historyLimit || 10)}">
          </label>
          <button type="button" data-ss-action="save-settings">Salvar pasta</button>
        </div>
      </details>`;
  }

  function renderProjectCard(project) {
    const links = (project.channelLinks || []).map((link) => link.channelName || link.channelNumber).filter(Boolean);
    return `
      <article class="card ss-project-card">
        <div class="ss-card-head">
          <div><span class="eyebrow">Scripted Schedule</span><h3>${esc(project.name)}</h3></div>
          <span class="status-pill ${project.publishedAt ? 'ok' : 'warn'}">${project.publishedAt ? 'Publicado' : 'Rascunho'}</span>
        </div>
        <div class="ss-card-meta">
          <span><strong>Arquivo</strong>${project.publishedAt ? esc(project.fileName || '-') : 'Será criado na publicação'}</span>
          <span><strong>Motor</strong>${esc(project.templateVersion || '1.1.1')}</span>
          <span><strong>Atualizado</strong>${esc(formatDate(project.updatedAt))}</span>
        </div>
        <div class="ss-card-channels"><strong>Canais</strong><span>${links.length ? esc(links.join(', ')) : 'Nenhum vínculo local'}</span></div>
        <div class="ss-card-actions">
          <button type="button" class="primary" data-ss-action="edit" data-id="${esc(project.id)}">Editar</button>
          <button type="button" data-ss-action="open-preview" data-id="${esc(project.id)}">Prévia</button>
          <button type="button" data-ss-action="open-history" data-id="${esc(project.id)}">Histórico</button>
          <button type="button" data-ss-action="duplicate" data-id="${esc(project.id)}">Duplicar</button>
          ${links.length ? `<button type="button" class="danger ghost" data-ss-action="open-reset" data-id="${esc(project.id)}">Reset Playout</button>` : ''}
          <button type="button" class="danger ghost" data-ss-action="delete" data-id="${esc(project.id)}">Excluir</button>
        </div>
      </article>`;
  }

  function renderEditor() {
    const tabs = [
      ['general', 'Geral'], ['resources', 'Recursos'], ['programming', 'Programação'], ['review', 'Revisão'], ['publish', 'Publicar']
    ];
    return `
      <div class="page-header ss-page-header">
        <div>
          <button type="button" class="text-button ss-back" data-ss-action="back">← Scripted Schedules</button>
          <span class="page-kicker">Editor</span><h2>${esc(state.current.name || 'Scripted Schedule')}</h2>
        </div>
        <div class="header-actions">
          <button type="button" data-ss-action="validate">Validar</button>
          <button type="button" class="primary" data-ss-action="publish">Salvar e publicar</button>
        </div>
      </div>
      <nav class="ss-editor-tabs" aria-label="Etapas do editor">
        ${tabs.map(([key, label]) => `<button type="button" class="${state.tab === key ? 'active' : ''}" data-ss-action="tab" data-tab="${key}">${label}</button>`).join('')}
      </nav>
      <div class="ss-editor-body">
        ${state.tab === 'general' ? renderGeneral() : ''}
        ${state.tab === 'resources' ? renderResources() : ''}
        ${state.tab === 'programming' ? renderProgramming() : ''}
        ${state.tab === 'review' ? renderReview() : ''}
        ${state.tab === 'publish' ? renderPublish() : ''}
      </div>`;
  }

  function renderGeneral() {
    const p = state.current;
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><span class="eyebrow">01 · Geral</span><h3>Projeto</h3></div></div>
        <div class="form-grid two">
          <label>${labelTitle('Nome do projeto', 'projectName')}<input data-bind="name" value="${esc(p.name)}"></label>
          ${p.publishedAt
            ? `<label>${labelTitle('Arquivo Python', 'fileName')}<input data-bind="fileName" value="${esc(p.fileName)}" placeholder="johnflix-music.py"></label>`
            : `<label>${labelTitle('Arquivo Python', 'fileName')}<input value="Será criado ao publicar" disabled></label>`}
          <label>${labelTitle('Motor', 'templateVersion')}<input value="${esc(p.templateVersion)}" disabled></label>
          <label>${labelTitle('Pasta de saída', 'outputRootReadOnly')}<input value="${esc(state.settings?.outputRoot || '')}" disabled></label>
        </div>
        ${!p.publishedAt ? '<div class="ss-callout">Renomeie e escolha o canal normalmente. O arquivo e o identificador do canal serão criados na primeira publicação usando esses dados.</div>' : ''}
        ${p.templateVersion !== LATEST_TEMPLATE_VERSION ? `<div class="ss-callout">Este projeto usa o motor ${esc(p.templateVersion)}. Os novos módulos e recursos estão disponíveis no motor ${LATEST_TEMPLATE_VERSION}. <button type="button" data-ss-action="upgrade-template">Atualizar motor</button></div>` : ''}
      </section>
      <section class="card ss-section-card">
        <div class="section-heading">
          <div><span class="eyebrow">ErsatzTV</span><h3>Vínculos com canais</h3><p>Aqui você escolhe o canal que usa este script. Na primeira vez, cadastre o caminho do script no Playout do ErsatzTV.</p></div>
          <div class="header-actions"><button type="button" data-ss-action="refresh-catalog">Atualizar catálogo</button><button type="button" data-ss-action="add-channel">Adicionar canal</button></div>
        </div>
        <div class="ss-stack">${p.channelLinks.length ? p.channelLinks.map(renderChannelLink).join('') : '<div class="empty-state">Nenhum canal vinculado.</div>'}</div>
      </section>`;
  }

  function renderChannelLink(link, index) {
    return `
      <div class="ss-row-card ss-channel-link">
        <label>${labelTitle('Canal no ErsatzTV', 'channel')}<select data-channel-index="${index}">${channelOptions(link.channelNumber)}</select></label>
        ${state.current.publishedAt
          ? `<label>${labelTitle('state_key', 'stateKey')}<input data-bind="channelLinks.${index}.stateKey" value="${esc(link.stateKey || '')}" placeholder="music_420"></label>`
          : `<label>${labelTitle('state_key', 'stateKey')}<input value="Será definido ao publicar" disabled></label>`}
        <button type="button" class="danger ghost" data-ss-action="remove-channel" data-index="${index}">Remover</button>
      </div>`;
  }

  function renderResources() {
    return `
      ${renderGraphicsGroups()}
      ${renderProfiles()}
      ${renderSources()}
      ${renderScriptedPlaylists()}
      ${renderEditorSaveBar('Recursos')}`;
  }

  function renderGraphicsGroups() {
    return resourceSection('Grupos de Graphics', 'Agrupe arquivos YAML que normalmente ficam ativos juntos.', 'graphics',
      state.current.graphicsGroups.map((group, index) => {
        const otherGroups = state.current.graphicsGroups.filter((_, i) => i !== index);
        return `
          <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:graphics:${index}`)}>
            <summary class="ss-accordion-summary"><strong>${esc(group.label || group.key)}</strong><span>${esc(group.key)}</span></summary>
            <div class="ss-accordion-body">
              <div class="ss-accordion-actions"><button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="graphics" data-index="${index}">Remover</button></div>
              <div class="form-grid two">
                <label>${labelTitle('Nome amigável', 'friendlyName')}<input data-bind="graphicsGroups.${index}.label" value="${esc(group.label || '')}"></label>
                <label>${labelTitle('Chave', 'key')}<input data-bind="graphicsGroups.${index}.key" value="${esc(group.key)}"></label>
                <label class="wide">${labelTitle('Graphics Elements', 'graphicsElements', '<small>Um caminho por linha</small>')}<textarea rows="4" data-bind="graphicsGroups.${index}.graphics" data-type="list">${esc(listValue(group.graphics))}</textarea></label>
              </div>
              ${otherGroups.length ? `<div class="ss-check-group"><span class="ss-check-group-title">Incluir outros grupos${help('includeGraphicsGroups')}</span>${otherGroups.map((item) => `<label class="check-row"><input type="checkbox" value="${esc(item.key)}" data-array-toggle="graphicsGroups.${index}.includes" ${(group.includes || []).includes(item.key) ? 'checked' : ''}><span>${esc(item.label || item.key)}</span></label>`).join('')}</div>` : ''}
            </div>
          </details>`;
      }).join(''));
  }

  function renderSources() {
    return resourceSection('Sources', 'Cadastre as fontes de conteúdo uma vez. Os módulos usam a chave da Source.', 'source',
      state.current.sources.map((source, index) => renderSourceCard(source, index)).join(''));
  }

  function renderSourceCard(source, index) {
    const typeLabel = SOURCE_TYPES.find(([value]) => value === source.type)?.[1] || source.type || 'Source';
    return `
      <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:source:${index}`)}>
        <summary class="ss-accordion-summary"><strong>${esc(source.label || source.key)}</strong><span>${esc(typeLabel)}</span></summary>
        <div class="ss-accordion-body">
          <div class="ss-accordion-actions"><button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="source" data-index="${index}">Remover</button></div>
          <div class="form-grid three">
            <label>${labelTitle('Nome amigável', 'friendlyName')}<input data-bind="sources.${index}.label" value="${esc(source.label || '')}"></label>
            <label>${labelTitle('Chave', 'key')}<input data-bind="sources.${index}.key" value="${esc(source.key)}"></label>
            <label>${labelTitle('Tipo', 'sourceType')}<select data-bind="sources.${index}.type" data-rerender="true">${SOURCE_TYPES.map(([value, label]) => `<option value="${value}" ${source.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            ${renderSourceTypeFields(source, index)}
            <label>${labelTitle('Presentation padrão', 'sourcePresentation')}<select data-bind="sources.${index}.presentation">${profileOptions(source.presentation, true)}</select></label>
          </div>
        </div>
      </details>`;
  }

  function renderSourceTypeFields(source, index) {
    const base = `sources.${index}`;
    if (source.type === 'smart_collection') {
      if (state.catalog.smartCollections?.length) return `<label class="wide">${labelTitle('Smart Collection', 'smartCollection')}<select data-bind="${base}.name">${smartCollectionOptions(source.name)}</select></label>`;
      return `<label class="wide">${labelTitle('Smart Collection', 'smartCollection')}<input data-bind="${base}.name" value="${esc(source.name || '')}" placeholder="Nome exato no ErsatzTV"><small>Catálogo indisponível; o nome pode ser informado manualmente.</small></label>`;
    }
    if (['collection', 'multi_collection'].includes(source.type)) return `<label class="wide">${labelTitle('Nome no ErsatzTV', 'ersatzName')}<input data-bind="${base}.name" value="${esc(source.name || '')}"></label>`;
    if (source.type === 'playlist') return `<label>${labelTitle('Playlist', 'playlist')}<input data-bind="${base}.playlist" value="${esc(source.playlist || '')}"></label><label>${labelTitle('Playlist Group', 'playlistGroup')}<input data-bind="${base}.playlistGroup" value="${esc(source.playlistGroup || '')}"></label>`;
    if (source.type === 'search') return `<label class="wide">${labelTitle('Query', 'searchQuery')}<textarea rows="3" data-bind="${base}.query">${esc(source.query || '')}</textarea></label>`;
    if (source.type === 'show') return `<div class="wide">${renderGuidEditor(source.guids || [], `${base}.guids`)}</div>`;
    if (source.type === 'marathon') return `
      <label>${labelTitle('Agrupar por', 'marathonGroupBy')}<select data-bind="${base}.groupBy"><option value="show" ${source.groupBy === 'show' ? 'selected' : ''}>Show</option><option value="season" ${source.groupBy === 'season' ? 'selected' : ''}>Season</option><option value="artist" ${source.groupBy === 'artist' ? 'selected' : ''}>Artist</option><option value="album" ${source.groupBy === 'album' ? 'selected' : ''}>Album</option><option value="director" ${source.groupBy === 'director' ? 'selected' : ''}>Director</option></select></label>
      <label>${labelTitle('Ordem dos itens', 'marathonItemOrder')}<select data-bind="${base}.itemOrder"><option value="chronological" ${source.itemOrder === 'chronological' ? 'selected' : ''}>Chronological</option><option value="shuffle" ${source.itemOrder === 'shuffle' ? 'selected' : ''}>Shuffle</option></select></label>
      <label class="check-row"><input type="checkbox" data-bind="${base}.playAllItems" ${source.playAllItems ? 'checked' : ''}><span>Tocar todos os itens do grupo${help('marathonPlayAll')}</span></label>
      <label class="check-row"><input type="checkbox" data-bind="${base}.shuffleGroups" ${source.shuffleGroups ? 'checked' : ''}><span>Embaralhar grupos${help('marathonShuffleGroups')}</span></label>
      <label class="wide">${labelTitle('Searches', 'marathonSearches', '<small>Uma query por linha</small>')}<textarea rows="3" data-bind="${base}.searches" data-type="list">${esc(listValue(source.searches))}</textarea></label>
      <div class="wide">${renderGuidEditor(source.guids || [], `${base}.guids`)}</div>`;
    return '';
  }

  function renderGuidEditor(items, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>GUIDs</strong><span class="ss-mini-help">Identificadores externos${help('guidProvider')}</span><button type="button" data-ss-action="add-guid" data-path="${esc(path)}">Adicionar GUID</button></div>${items.length ? items.map((item, index) => `<div class="ss-inline-row"><label class="ss-inline-field">${labelTitle('Provedor', 'guidProvider')}<input data-bind="${path}.${index}.provider" value="${esc(item.provider || '')}" placeholder="tmdb"></label><label class="ss-inline-field">${labelTitle('Valor', 'guidValue')}<input data-bind="${path}.${index}.value" value="${esc(item.value || '')}" placeholder="12345"></label><button type="button" class="danger ghost" data-ss-action="remove-guid" data-path="${esc(path)}" data-index="${index}">×</button></div>`).join('') : '<small>Nenhum GUID.</small>'}</div>`;
  }

  function renderScriptedPlaylists() {
    return resourceSection('Scripted Playlists', 'Monte pequenas sequências reutilizáveis. Elas podem ser usadas como pre-roll nos perfis.', 'playlist',
      state.current.scriptedPlaylists.map((playlist, index) => `
        <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:playlist:${index}`)}>
          <summary class="ss-accordion-summary"><strong>${esc(playlist.label || playlist.key)}</strong><span>${(playlist.items || []).length} item(ns)</span></summary>
          <div class="ss-accordion-body">
            <div class="ss-accordion-actions"><button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="playlist" data-index="${index}">Remover</button></div>
            <div class="form-grid two"><label>${labelTitle('Nome amigável', 'friendlyName')}<input data-bind="scriptedPlaylists.${index}.label" value="${esc(playlist.label || '')}"></label><label>${labelTitle('Chave', 'key')}<input data-bind="scriptedPlaylists.${index}.key" value="${esc(playlist.key)}"></label></div>
            <div class="ss-mini-editor"><div class="ss-mini-head"><strong>Itens</strong><span class="ss-mini-help">Ordem de execução${help('playlistItemSource')}</span><button type="button" data-ss-action="add-playlist-item" data-index="${index}">Adicionar item</button></div>
              ${(playlist.items || []).map((item, itemIndex) => { const base = `scriptedPlaylists.${index}.items.${itemIndex}`; return `<div class="ss-inline-row ss-playlist-row">${sourceOrderPair(base, item, { helpKey: 'playlistItemSource', inline: true })}<label class="ss-inline-field">${labelTitle('Quantidade', 'playlistItemCount')}<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label><div class="ss-order-buttons"><button type="button" data-ss-action="move-playlist-item" data-index="${index}" data-item-index="${itemIndex}" data-delta="-1" aria-label="Mover item para cima">↑</button><button type="button" data-ss-action="move-playlist-item" data-index="${index}" data-item-index="${itemIndex}" data-delta="1" aria-label="Mover item para baixo">↓</button><button type="button" class="danger ghost" data-ss-action="remove-playlist-item" data-index="${index}" data-item-index="${itemIndex}" aria-label="Remover item">×</button></div></div>`; }).join('') || '<small>Adicione itens à sequência.</small>'}
            </div>
          </div>
        </details>`).join(''));
  }

  function renderProfiles() {
    const profiles = (state.current.presentationProfiles || [])
      .map((profile, index) => ({ profile, index }))
      .filter(({ profile }) => String(profile?.key || '').trim().toLowerCase() !== 'none');
    return resourceSection('Presentation Profiles', 'Combine Graphics, pre-roll, watermarks e opções de EPG para reutilizar nos módulos.', 'profile',
      profiles.map(({ profile, index }) => `
        <details class="ss-resource-card ss-accordion-card" ${accordionAttrs(`resource:profile:${index}`)}>
          <summary class="ss-accordion-summary"><strong>${esc(profile.label || profile.key)}</strong><span>${esc(profile.key)}</span></summary>
          <div class="ss-accordion-body">
            <div class="ss-accordion-actions"><button class="danger ghost" type="button" data-ss-action="remove-resource" data-kind="profile" data-index="${index}">Remover</button></div>
            <div class="form-grid two">
              <label>${labelTitle('Nome amigável', 'friendlyName')}<input data-bind="presentationProfiles.${index}.label" value="${esc(profile.label || '')}"></label>
              <label>${labelTitle('Chave', 'key')}<input data-bind="presentationProfiles.${index}.key" value="${esc(profile.key)}"></label>
              <label class="check-row"><input type="checkbox" data-bind="presentationProfiles.${index}.epgGroup" data-rerender="true" ${profile.epgGroup ? 'checked' : ''}><span>Agrupar no EPG${help('epgGroup')}</span></label>
              ${profile.epgGroup ? `<label>${labelTitle('Título no EPG', 'epgTitle')}<input data-bind="presentationProfiles.${index}.epgTitle" value="${esc(profile.epgTitle || '')}"></label><label class="check-row"><input type="checkbox" data-bind="presentationProfiles.${index}.epgAdvance" ${profile.epgAdvance !== false ? 'checked' : ''}><span>Iniciar novo grupo no EPG${help('epgAdvance')}</span></label>` : ''}
              <label class="wide">${labelTitle('Graphics diretos', 'directGraphics', '<small>Um YAML por linha</small>')}<textarea rows="3" data-bind="presentationProfiles.${index}.graphics" data-type="list">${esc(listValue(profile.graphics))}</textarea></label>
              <label class="wide">${labelTitle('Watermarks nativos', 'nativeWatermarks', '<small>Um nome por linha</small>')}<textarea rows="2" data-bind="presentationProfiles.${index}.watermarks" data-type="list">${esc(listValue(profile.watermarks))}</textarea></label>
            </div>
            ${renderGroupChoices(profile.graphicsGroups || [], `presentationProfiles.${index}.graphicsGroups`)}
            <details class="ss-advanced"><summary><span>Variáveis dos Graphics${help('graphicsVariables')}</span></summary>${renderPairEditor(profile.graphicsVariables || [], `presentationProfiles.${index}.graphicsVariables`)}</details>
            <details class="ss-advanced"><summary><span>Pre-roll opcional${help('preRoll')}</span></summary><div class="ss-advanced-body form-grid two"><label>${labelTitle('Scripted Playlist', 'preRoll')}<select data-bind="presentationProfiles.${index}.preRoll">${playlistOptions(profile.preRoll)}</select>${state.current.scriptedPlaylists.length ? '' : '<small>Se precisar de pre-roll, crie a Scripted Playlist depois e volte aqui para selecioná-la.</small>'}</label></div></details>
          </div>
        </details>`).join(''));
  }

  function renderGroupChoices(selected, path) {
    if (!state.current.graphicsGroups.length) return '';
    return `<div class="ss-check-group"><span class="ss-check-group-title">Grupos de Graphics${help('graphicsGroupSelection')}</span>${state.current.graphicsGroups.map((group) => `<label class="check-row"><input type="checkbox" value="${esc(group.key)}" data-array-toggle="${esc(path)}" ${selected.includes(group.key) ? 'checked' : ''}><span>${esc(group.label || group.key)}</span></label>`).join('')}</div>`;
  }
  function renderPairEditor(items, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><span>Chave = valor</span><button type="button" data-ss-action="add-variable" data-path="${esc(path)}">Adicionar</button></div>${items.map((item, index) => `<div class="ss-inline-row"><label class="ss-inline-field">${labelTitle('Chave', 'graphicsVariableKey')}<input data-bind="${path}.${index}.key" value="${esc(item.key || '')}" placeholder="chave"></label><label class="ss-inline-field">${labelTitle('Valor', 'graphicsVariableValue')}<input data-bind="${path}.${index}.value" value="${esc(item.value || '')}" placeholder="valor"></label><button type="button" class="danger ghost" data-ss-action="remove-variable" data-path="${esc(path)}" data-index="${index}" aria-label="Remover variável">×</button></div>`).join('') || '<small>Nenhuma variável.</small>'}</div>`;
  }

  function resourceSection(title, subtitle, kind, content) {
    const countMap = { graphics: state.current.graphicsGroups.length, source: state.current.sources.length, playlist: state.current.scriptedPlaylists.length, profile: visibleProfiles().length };
    return `
      <details class="card ss-section-card ss-section-accordion" ${accordionAttrs(`resources:${kind}`)}>
        <summary class="ss-section-summary"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><span>${countMap[kind] || 0} item(ns)</span></summary>
        <div class="ss-section-accordion-body">
          <div class="ss-section-actions"><button type="button" data-ss-action="add-resource" data-kind="${kind}">Adicionar</button></div>
          <div class="ss-stack">${content || '<div class="empty-state">Nenhum item cadastrado.</div>'}</div>
        </div>
      </details>`;
  }

  function renderProgramming() {
    const active = Object.entries(MODULE_META).filter(([key]) => state.current.modules[key]?.length);
    const inactive = Object.entries(MODULE_META).filter(([key]) => !state.current.modules[key]?.length);
    return `
      <details class="card ss-section-card ss-section-accordion" ${accordionAttrs('programming:options')}>
        <summary class="ss-section-summary"><div><span class="eyebrow">Opções globais</span><h3>Comportamento padrão</h3><p>Valores usados quando um módulo não informa uma opção própria.</p></div><span>Configuração</span></summary>
        <div class="ss-section-accordion-body">
          <div class="form-grid four">
            <label>${labelTitle('Duração padrão da Rotation (min)', 'defaultRotationDuration')}<input type="number" min="1" data-type="number" data-bind="options.defaultRotationDurationMinutes" value="${esc(state.current.options.defaultRotationDurationMinutes)}"></label>
            <label>${labelTitle('Prioridade padrão', 'defaultPriority')}<input type="number" data-type="number" data-bind="options.defaultFixedPriority" value="${esc(state.current.options.defaultFixedPriority)}"></label>
            <label>${labelTitle('Timeout HTTP (s)', 'httpTimeout')}<input type="number" min="1" data-type="number" data-bind="options.httpTimeoutSeconds" value="${esc(state.current.options.httpTimeoutSeconds)}"></label>
            <label>${labelTitle('Retenção de ocorrências (dias)', 'occurrenceRetention')}<input type="number" min="1" data-type="number" data-bind="options.seenOccurrenceRetentionDays" value="${esc(state.current.options.seenOccurrenceRetentionDays)}"></label>
            <label class="check-row wide"><input type="checkbox" data-bind="options.allowOverrun" ${state.current.options.allowOverrun !== false ? 'checked' : ''}><span>Não cortar o vídeo atual para cumprir o horário exato${help('allowOverrunGlobal')}</span></label>
          </div>
        </div>
      </details>
      ${renderFiller()}
      <section class="card ss-section-card">
        <div class="section-heading">
          <div><span class="eyebrow">Módulos</span><h3>Programação</h3><p>Adicione somente os módulos que este canal precisa.</p></div>
          ${inactive.length ? `<div class="ss-add-module"><button type="button" class="primary" data-ss-action="open-module-picker">Adicionar módulo</button></div>` : ''}
        </div>
        <div class="ss-stack">${active.length ? active.map(([key]) => renderModule(key)).join('') : '<div class="empty-state">Nenhum módulo ativo. Adicione um módulo ou use somente o Filler.</div>'}</div>
      </section>
      ${renderEditorSaveBar('Programação')}
      ${state.modulePickerOpen ? renderModulePickerModal(inactive) : ''}`;
  }

  function renderModulePickerModal(inactive) {
    const entries = inactive || Object.entries(MODULE_META).filter(([key]) => !(state.current.modules[key] || []).length);
    const selected = state.modulePickerSelection;
    const meta = selected ? MODULE_META[selected] : null;
    return `<div class="ss-module-modal-backdrop" data-ss-action="close-module-picker">
      <section class="ss-module-modal" role="dialog" aria-modal="true" aria-label="Adicionar módulo" onclick="event.stopPropagation()">
        <div class="section-heading"><div><span class="eyebrow">Programação</span><h3>Adicionar módulo</h3><p>Escolha o tipo de programação. Clique em um nome para ver um resumo antes de adicionar.</p></div><button type="button" class="ghost" data-ss-action="close-module-picker">Fechar</button></div>
        <div class="ss-module-picker-layout">
          <div class="ss-module-picker-list" aria-label="Tipos de módulo">${entries.map(([key, item]) => `<button type="button" class="ss-module-picker-item ${selected === key ? 'active' : ''}" data-ss-action="select-module" data-module="${key}"><strong>${esc(item.label)}</strong></button>`).join('')}</div>
          <div class="ss-module-picker-description">${meta ? `<span class="eyebrow">Como funciona</span><h3>${esc(meta.label)}</h3><p>${esc(meta.hint)}</p><div class="ss-callout"><strong>Combina bem com</strong><br>${esc(meta.combines || 'Outros eventos da programação.')}</div>${meta.pad === 'none' || meta.padNote ? `<div class="ss-callout"><strong>Pad To Nearest Minute</strong><br>${esc(meta.padNote || 'Disponível neste módulo.')}</div>` : ''}<p class="muted">A Ajuda de Scripted Schedules possui explicações e exemplos mais completos.</p>` : '<div class="empty-state">Selecione um módulo à esquerda para ver a descrição.</div>'}</div>
        </div>
        <div class="modal-actions"><button type="button" data-ss-action="close-module-picker">Cancelar</button><button type="button" class="primary" data-ss-action="add-module" ${selected ? '' : 'disabled'}>Adicionar módulo</button></div>
      </section>
    </div>`;
  }

  function renderModule(type) {
    const meta = MODULE_META[type]; const items = state.current.modules[type] || [];
    return `
      <details class="ss-module-card ss-accordion-card" ${accordionAttrs(`module:${type}`)}>
        <summary class="ss-accordion-summary ss-module-summary"><div><span class="eyebrow">${esc(meta.label)}</span><strong>${esc(meta.hint)}</strong></div><span>${items.length} item(ns)</span></summary>
        <div class="ss-accordion-body">
          <div class="ss-module-actions header-actions"><button type="button" data-ss-action="add-module-entry" data-module="${type}">Adicionar item</button><button type="button" class="danger ghost" data-ss-action="remove-module" data-module="${type}">Remover módulo</button></div>
          <div class="ss-stack">${items.map((item, index) => renderModuleEntry(type, item, index)).join('')}</div>
        </div>
      </details>`;
  }

  function renderModuleEntry(type, item, index) {
    if (type === 'rotation') return moduleEntryShell(type, index, `Bloco ${index + 1}`, `
      <div class="form-grid three">
        ${sourceOrderPair(`modules.rotation.${index}`, item)}
        ${profileSelect(`modules.rotation.${index}.presentation`, item.presentation)}
        <label>${labelTitle('Duração (min)', 'duration')}<input type="number" min="1" data-type="number" data-bind="modules.rotation.${index}.durationMinutes" value="${esc(item.durationMinutes ?? '')}" placeholder="${esc(state.current.options.defaultRotationDurationMinutes || 60)}"></label>
      </div>${renderPlaybackAdvanced(`modules.rotation.${index}`, item)}`);

    if (type === 'countRotation') return moduleEntryShell(type, index, `Bloco ${index + 1}`, `<div class="form-grid three">${sourceOrderPair(`modules.countRotation.${index}`, item)}${profileSelect(`modules.countRotation.${index}.presentation`, item.presentation)}<label>${labelTitle('Quantidade', 'quantity')}<input type="number" min="1" data-type="number" data-bind="modules.countRotation.${index}.count" value="${esc(item.count || 1)}"></label></div>${renderPadToNearest(`modules.countRotation.${index}`, item)}${renderPlaybackAdvanced(`modules.countRotation.${index}`, item)}`);
    if (type === 'weightedRotation') return moduleEntryShell(type, index, `Opção ${index + 1}`, `<div class="form-grid three">${sourceOrderPair(`modules.weightedRotation.${index}`, item)}${profileSelect(`modules.weightedRotation.${index}.presentation`, item.presentation)}<label>${labelTitle('Peso', 'weight')}<input type="number" min="0.1" step="0.1" data-type="number" data-bind="modules.weightedRotation.${index}.weight" value="${esc(item.weight || 1)}"></label><label class="check-row"><input type="checkbox" data-bind="modules.weightedRotation.${index}.avoidRepeat" ${item.avoidRepeat !== false ? 'checked' : ''}><span>Evitar repetir a mesma Source${help('avoidRepeat')}</span></label></div>${renderPadToNearest(`modules.weightedRotation.${index}`, item)}${renderPlaybackAdvanced(`modules.weightedRotation.${index}`, item)}`);

    const base = `modules.${type}.${index}`;
    let body = '';
    if (type === 'continuousBlocks') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${sourceOrderPair(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div><div class="ss-callout">Não existe horário de fim. Este bloco continua até outro Bloco Contínuo assumir ou um evento programado entrar temporariamente.</div>${renderCommonAdvanced(base, item, true)}`;
    if (type === 'contentBreaks') body = `<div class="form-grid four">${commonIdFields(base, item)}${sourceOrderPair(base, item)}<label>${labelTitle('A cada itens', 'everyItems')}<input type="number" min="1" data-type="number" data-bind="${base}.everyItems" value="${esc(item.everyItems || 4)}"></label>${sourceOrderPair(base, item, { sourceField: 'breakSource', orderField: 'breakOrder', helpKey: 'breakSource', orderLabel: 'Ordem da inserção' })}<label>${labelTitle('Itens na inserção', 'breakCount')}<input type="number" min="1" data-type="number" data-bind="${base}.breakCount" value="${esc(item.breakCount || 1)}"></label>${profileSelect(`${base}.presentation`, item.presentation)}${profileSelect(`${base}.breakPresentation`, item.breakPresentation, 'breakPresentation')}${priorityInput(base, item)}</div><div class="ss-callout">Exemplo: 4 músicas → 1 vinheta → 4 músicas → 1 vinheta.</div>${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'fitToWindow') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}${sourceOrderPair(base, item)}<label>${labelTitle('Olhar adiante (min)', 'lookAhead')}<input type="number" min="1" data-type="number" data-bind="${base}.lookAheadMinutes" value="${esc(item.lookAheadMinutes || 45)}"></label><label>${labelTitle('Tentativas', 'fitDiscard')}<input type="number" min="0" data-type="number" data-bind="${base}.discardAttempts" value="${esc(item.discardAttempts ?? 5)}"></label>${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}<label class="check-row"><input type="checkbox" data-bind="${base}.useFillerRemainder" ${item.useFillerRemainder !== false ? 'checked' : ''}><span>Completar sobra com Filler${help('fitFiller')}</span></label></div><div class="ss-callout">Este módulo não corta o conteúdo para caber: ele pede ao ErsatzTV para procurar itens adequados antes do próximo evento.</div>${renderDateFilters(base, item)}`;
    if (type === 'fixedEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${sourceOrderPair(base, item)}<label>${labelTitle('Quantidade', 'quantity')}<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label>${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderStartTiming(base, item)}${renderPadToNearest(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'fixedDurationEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${sourceOrderPair(base, item)}<label>${labelTitle('Duração (min)', 'duration')}<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(item.durationMinutes || 60)}"></label>${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderStartTiming(base, item)}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'fixedAllEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${sourceOrderPair(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderStartTiming(base, item)}<div class="ss-callout">Depois que este bloco começar, todos os itens da Source terminam antes de outro módulo assumir.</div>${renderCommonAdvanced(base, item, true)}`;
    if (type === 'fixedWindowEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}${sourceOrderPair(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderCommonAdvanced(base, item, true)}`;
    if (type === 'windowRotations') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}<label>${labelTitle('Bloco padrão (min)', 'blockMinutes')}<input type="number" min="1" data-type="number" data-bind="${base}.blockMinutes" value="${esc(item.blockMinutes || 30)}"></label>${priorityInput(base, item)}</div>${renderWindowRotationItems(item, index)}${renderCommonAdvanced(base, item, false)}`;
    if (type === 'sequenceEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}<label class="check-row"><input type="checkbox" data-bind="${base}.atomic" ${item.atomic ? 'checked' : ''}><span>Sequência atômica${help('atomic')}</span></label></div>${renderStartTiming(base, item)}${renderSequenceSteps(item.steps || [], `${base}.steps`)}${sequenceSupportsItemPad(item.steps) ? renderPadToNearest(base, item) : ''}${renderCommonAdvanced(base, item, false)}`;
    if (type === 'intervalEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}<label>${labelTitle('A cada (min)', 'everyMinutes')}<input type="number" min="1" data-type="number" data-bind="${base}.everyMinutes" value="${esc(item.everyMinutes || 30)}"></label>${modeSelect(`${base}.mode`, item.mode, false)}${intervalModeFields(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}<label>${labelTitle('Se atrasar', 'latePolicy')}<select data-bind="${base}.latePolicy" data-rerender="true"><option value="queue" ${item.latePolicy === 'queue' ? 'selected' : ''}>Esperar na fila</option><option value="skip" ${item.latePolicy === 'skip' ? 'selected' : ''}>Ignorar se atrasar demais</option></select></label>${item.latePolicy === 'skip' ? `<label>${labelTitle('Atraso máximo (min)', 'maxLateness')}<input type="number" min="0" data-type="number" data-bind="${base}.maxLatenessMinutes" value="${esc(item.maxLatenessMinutes ?? 10)}"></label>` : ''}</div>${renderStartTiming(base, item)}${item.mode === 'count' ? renderPadToNearest(base, item) : ''}${renderCommonAdvanced(base, item, true)}`;
    if (type === 'choiceEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.time`, item.time, 'Horário')}${modeSelect(`${base}.mode`, item.mode, false)}${item.mode === 'duration' ? `<label>${labelTitle('Duração (min)', 'duration')}<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(item.durationMinutes || 60)}"></label>` : item.mode === 'count' ? `<label>${labelTitle('Quantidade', 'quantity')}<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label>` : ''}${priorityInput(base, item)}<label>${labelTitle('Escolha', 'selection')}<select data-bind="${base}.selection"><option value="weighted" ${item.selection !== 'round_robin' ? 'selected' : ''}>Por peso</option><option value="round_robin" ${item.selection === 'round_robin' ? 'selected' : ''}>Em rodízio</option></select></label></div>${renderStartTiming(base, item)}${renderChoiceItems(item.choices || [], `${base}.choices`)}${item.mode === 'count' ? renderPadToNearest(base, item) : ''}${renderCommonAdvanced(base, item, false)}`;
    if (type === 'clockTemplates') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}<label>${labelTitle('Ciclo (min)', 'cycleMinutes')}<input type="number" min="1" data-type="number" data-bind="${base}.cycleMinutes" value="${esc(item.cycleMinutes || 60)}"></label>${priorityInput(base, item)}</div>${renderStartTiming(base, item)}${renderClockSlots(item.slots || [], `${base}.slots`)}${renderDateFilters(base, item)}`;
    if (type === 'temporaryOverrides') body = `<div class="form-grid four">${commonIdFields(base, item)}<label>${labelTitle('Começa em', 'startDatetime')}<input data-bind="${base}.startDatetime" value="${esc(item.startDatetime || '')}" placeholder="2026-12-24 18:00"></label><label>${labelTitle('Termina em', 'endDatetime')}<input data-bind="${base}.endDatetime" value="${esc(item.endDatetime || '')}" placeholder="2026-12-26 06:00"></label>${sourceOrderPair(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div><div class="ss-callout">Durante este período a Source especial assume. Quando o período termina, a programação normal volta automaticamente.</div>${renderPlaybackAdvanced(base, item)}`;
    if (type === 'dateEvents') body = `<div class="form-grid four">${commonIdFields(base, item)}<label>${labelTitle('Data e hora', 'dateTime')}<input data-bind="${base}.datetime" value="${esc(item.datetime || '')}" placeholder="2026-12-24 20:00"></label>${modeSelect(`${base}.mode`, item.mode, true)}${dateModeFields(base, item)}${priorityInput(base, item)}${profileSelect(`${base}.presentation`, item.presentation)}</div>${renderStartTiming(base, item)}${item.mode === 'sequence' ? renderSequenceSteps(item.steps || [], `${base}.steps`) : ''}${modeSupportsItemPad(item.mode, item.steps) ? renderPadToNearest(base, item) : ''}${renderPlaybackAdvanced(base, item)}`;
    if (type === 'offlineWindows') body = `<div class="form-grid four">${commonIdFields(base, item)}${timeInput(`${base}.startTime`, item.startTime, 'Início')}${timeInput(`${base}.endTime`, item.endTime, 'Fim')}${priorityInput(base, item)}</div>${renderDateFilters(base, item)}`;
    return moduleEntryShell(type, index, item.label || item.id || `Item ${index + 1}`, body);
  }

  function moduleEntryShell(type, index, title, body) {
    return `<details class="ss-event-card ss-accordion-card ss-nested-accordion" ${accordionAttrs(`module-entry:${type}:${index}`)}><summary class="ss-accordion-summary ss-event-summary"><strong>${esc(title)}</strong><span>Editar</span></summary><div class="ss-accordion-body"><div class="ss-accordion-actions"><button type="button" class="danger ghost" data-ss-action="remove-module-entry" data-module="${type}" data-index="${index}">Remover</button></div>${body}</div></details>`;
  }
  function commonIdFields(base, item) {
    return `<label>${labelTitle('ID', 'id')}<input data-bind="${base}.id" value="${esc(item.id || '')}"></label><label>${labelTitle('Nome opcional', 'optionalName')}<input data-bind="${base}.label" value="${esc(item.label || '')}" placeholder="Ex.: Especial da noite"></label>`;
  }
  function sourceByKey(key) { return (state.current?.sources || []).find((source) => String(source.key) === String(key)) || null; }
  function sourceSupportsOrder(key) { return ORDERABLE_SOURCE_TYPES.has(String(sourceByKey(key)?.type || '')); }
  function sourceSelect(path, value, helpKey = 'source', inline = false) { return `<label${inline ? ' class="ss-inline-field"' : ''}>${labelTitle('Source', helpKey)}<select data-bind="${path}" data-rerender="true">${sourceOptions(value)}</select></label>`; }
  function sourceOrderSelect(path, sourceKey, value, inline = false, label = 'Ordem') {
    if (!sourceSupportsOrder(sourceKey)) return '';
    const current = String(value || 'shuffle').toLowerCase() === 'chronological' ? 'chronological' : 'shuffle';
    return `<label${inline ? ' class="ss-inline-field"' : ''}>${labelTitle(label, 'playbackOrder')}<select data-bind="${path}"><option value="chronological" ${current === 'chronological' ? 'selected' : ''}>Chronological</option><option value="shuffle" ${current === 'shuffle' ? 'selected' : ''}>Shuffle</option></select></label>`;
  }
  function sourceOrderPair(base, item, options = {}) {
    const sourceField = options.sourceField || 'source';
    const orderField = options.orderField || 'order';
    const sourceKey = item?.[sourceField];
    return `${sourceSelect(`${base}.${sourceField}`, sourceKey, options.helpKey || 'source', Boolean(options.inline))}${sourceOrderSelect(`${base}.${orderField}`, sourceKey, item?.[orderField], Boolean(options.inline), options.orderLabel || 'Ordem')}`;
  }
  function profileSelect(path, value, helpKey = 'presentation') { return `<label>${labelTitle('Presentation', helpKey)}<select data-bind="${path}">${profileOptions(value)}</select></label>`; }
  function priorityInput(base, item) { return `<label>${labelTitle('Prioridade', 'priority')}<input type="number" data-type="number" data-bind="${base}.priority" value="${esc(item.priority ?? state.current.options.defaultFixedPriority ?? 100)}"></label>`; }
  function timeInput(path, value, label) {
    const helpKey = label === 'Início' ? 'startTime' : (label === 'Fim' ? 'endTime' : 'time');
    return `<label>${labelTitle(label, helpKey)}<input type="time" data-bind="${path}" value="${esc(value || '')}"></label>`;
  }
  function modeSelect(path, value, sequence) { return `<label>${labelTitle('Modo', 'mode')}<select data-bind="${path}" data-rerender="true"><option value="count" ${value === 'count' ? 'selected' : ''}>Quantidade</option><option value="duration" ${value === 'duration' ? 'selected' : ''}>Duração</option><option value="all" ${value === 'all' ? 'selected' : ''}>Todos os itens</option>${sequence ? `<option value="sequence" ${value === 'sequence' ? 'selected' : ''}>Sequência</option>` : ''}</select></label>`; }
  function intervalModeFields(base, item) {
    if (item.mode === 'duration') return `${sourceOrderPair(base, item)}<label>${labelTitle('Duração (min)', 'duration')}<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(item.durationMinutes || 60)}"></label>`;
    if (item.mode === 'all') return sourceOrderPair(base, item);
    return `${sourceOrderPair(base, item)}<label>${labelTitle('Quantidade', 'quantity')}<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label>`;
  }
  function dateModeFields(base, item) {
    if (item.mode === 'sequence') return '';
    if (item.mode === 'duration') return `${sourceOrderPair(base, item)}<label>${labelTitle('Duração (min)', 'duration')}<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(item.durationMinutes || 60)}"></label>`;
    if (item.mode === 'all') return sourceOrderPair(base, item);
    return `${sourceOrderPair(base, item)}<label>${labelTitle('Quantidade', 'quantity')}<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(item.count || 1)}"></label>`;
  }

  function renderChoiceItems(items, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>Sources que podem ser escolhidas</strong><span class="ss-mini-help">Uma delas será usada em cada ocorrência${help('selection')}</span><button type="button" data-ss-action="add-choice" data-path="${esc(path)}">Adicionar Source</button></div>${items.map((entry, index) => { const base = `${path}.${index}`; return `<div class="ss-inline-row">${sourceOrderPair(base, entry, { inline: true })}<label class="ss-inline-field">${labelTitle('Presentation', 'presentation')}<select data-bind="${base}.presentation">${profileOptions(entry.presentation)}</select></label><label class="ss-inline-field">${labelTitle('Peso', 'choiceWeight')}<input type="number" min="0.1" step="0.1" data-type="number" data-bind="${base}.weight" value="${esc(entry.weight || 1)}"></label><button type="button" class="danger ghost" data-ss-action="remove-choice" data-path="${esc(path)}" data-index="${index}" aria-label="Remover Source">×</button></div>`; }).join('')}</div>`;
  }

  function renderClockSlots(slots, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>Posições do relógio</strong><span class="ss-mini-help">Ex.: 0=:00, 15=:15 em ciclo de 60 min${help('offsetMinutes')}</span><button type="button" data-ss-action="add-clock-slot" data-path="${esc(path)}">Adicionar posição</button></div>${slots.map((slot, index) => { const base = `${path}.${index}`; return `<div class="ss-sequence-step"><div class="ss-inline-row"><label class="ss-inline-field">${labelTitle('Minuto no ciclo', 'offsetMinutes')}<input type="number" min="0" data-type="number" data-bind="${base}.offsetMinutes" value="${esc(slot.offsetMinutes ?? 0)}"></label>${modeSelect(`${base}.mode`, slot.mode || 'count', false)}${slot.mode === 'duration' ? `<label class="ss-inline-field">${labelTitle('Duração', 'duration')}<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(slot.durationMinutes || 30)}"></label>` : slot.mode === 'count' ? `<label class="ss-inline-field">${labelTitle('Quantidade', 'quantity')}<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(slot.count || 1)}"></label>` : ''}${sourceOrderPair(base, slot, { inline: true })}<label class="ss-inline-field">${labelTitle('Presentation', 'presentation')}<select data-bind="${base}.presentation">${profileOptions(slot.presentation)}</select></label><label class="ss-inline-field">${labelTitle('Prioridade', 'priority')}<input type="number" data-type="number" data-bind="${base}.priority" value="${esc(slot.priority ?? '')}" placeholder="Do relógio"></label><button type="button" class="danger ghost" data-ss-action="remove-clock-slot" data-path="${esc(path)}" data-index="${index}" aria-label="Remover posição">×</button></div>${slot.mode === 'count' ? renderPadToNearest(base, slot) : ''}${renderPlaybackAdvanced(base, slot)}</div>`; }).join('')}</div>`;
  }

  function renderWindowRotationItems(item, index) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>Itens da rotação</strong><span class="ss-mini-help">Configuração de cada bloco${help('blockMinutes')}</span><button type="button" data-ss-action="add-window-item" data-index="${index}">Adicionar Source</button></div>${(item.items || []).map((entry, j) => {
      const base = `modules.windowRotations.${index}.items.${j}`;
      return `<div class="ss-inline-row ss-window-row">${sourceOrderPair(base, entry, { inline: true })}<label class="ss-inline-field">${labelTitle('Presentation', 'presentation')}<select data-bind="${base}.presentation">${profileOptions(entry.presentation)}</select></label><label class="ss-inline-field">${labelTitle('Duração (min)', 'duration')}<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(entry.durationMinutes ?? '')}" placeholder="Bloco padrão"></label><button type="button" class="danger ghost" data-ss-action="remove-window-item" data-index="${index}" data-item-index="${j}" aria-label="Remover item">×</button></div>`;
    }).join('')}</div>`;
  }

  function renderSequenceSteps(steps, path) {
    return `<div class="ss-mini-editor"><div class="ss-mini-head"><strong>Passos da sequência</strong><span class="ss-mini-help">Executados na ordem${help('sequenceStepMode')}</span><button type="button" data-ss-action="add-step" data-path="${esc(path)}">Adicionar passo</button></div>${steps.map((step, index) => {
      const base = `${path}.${index}`; const mode = step.mode || 'count';
      return `<div class="ss-sequence-step"><div class="ss-inline-row"><label class="ss-inline-field">${labelTitle('Modo', 'sequenceStepMode')}<select data-bind="${base}.mode" data-rerender="true"><option value="count" ${mode === 'count' ? 'selected' : ''}>Quantidade</option><option value="duration" ${mode === 'duration' ? 'selected' : ''}>Duração</option><option value="all" ${mode === 'all' ? 'selected' : ''}>Todos</option><option value="pad_to_next" ${mode === 'pad_to_next' ? 'selected' : ''}>Até próxima marca</option><option value="wait" ${mode === 'wait' ? 'selected' : ''}>Esperar/offline</option></select></label>${mode !== 'wait' ? sourceOrderPair(base, step, { helpKey: 'sequenceStepSource', inline: true }) : ''}${mode === 'count' ? `<label class="ss-inline-field">${labelTitle('Quantidade', 'sequenceStepCount')}<input type="number" min="1" data-type="number" data-bind="${base}.count" value="${esc(step.count || 1)}"></label>` : ''}${['duration', 'wait'].includes(mode) ? `<label class="ss-inline-field">${labelTitle('Minutos', 'sequenceStepDuration')}<input type="number" min="1" data-type="number" data-bind="${base}.durationMinutes" value="${esc(step.durationMinutes || 1)}"></label>` : ''}${mode === 'pad_to_next' ? `<label class="ss-inline-field">${labelTitle('Marca (min)', 'sequenceStepMark')}<input type="number" min="1" data-type="number" data-bind="${base}.minutes" value="${esc(step.minutes || 30)}"></label>` : ''}<label class="ss-inline-field">${labelTitle('Presentation', 'sequenceStepPresentation')}<select data-bind="${base}.presentation">${profileOptions(step.presentation)}</select></label><button type="button" class="danger ghost" data-ss-action="remove-step" data-path="${esc(path)}" data-index="${index}" aria-label="Remover passo">×</button></div>${renderPlaybackAdvanced(base, step)}</div>`;
    }).join('')}</div>`;
  }

  function renderStartTiming(base, item) {
    if (!versionAtLeast(state.current.templateVersion, '1.3.1')) return '';
    const policy = ['wait', 'closest'].includes(String(item.startPolicy || '').toLowerCase()) ? String(item.startPolicy).toLowerCase() : 'closest';
    const maxEarly = item.maxEarlyMinutes === '' || item.maxEarlyMinutes === undefined || item.maxEarlyMinutes === null ? 40 : item.maxEarlyMinutes;
    return `<div class="form-grid two ss-start-timing"><label>${labelTitle('Se o conteúdo passar do horário', 'startPolicy')}<select data-bind="${base}.startPolicy" data-rerender="true"><option value="closest" ${policy === 'closest' ? 'selected' : ''}>Usar o horário mais próximo</option><option value="wait" ${policy === 'wait' ? 'selected' : ''}>Esperar o conteúdo terminar</option></select></label>${policy === 'closest' ? `<label>${labelTitle('Pode adiantar até (min)', 'maxEarlyMinutes')}<input type="number" min="0" data-type="number" data-bind="${base}.maxEarlyMinutes" value="${esc(maxEarly)}"></label>` : ''}</div>`;
  }

  function renderCommonAdvanced(base, item, playback) {
    return `${renderDateFilters(base, item)}${playback ? renderPlaybackAdvanced(base, item) : ''}`;
  }
  function renderDateFilters(base, item) {
    const days = Array.isArray(item.days) ? item.days : [];
    const recurrence = item.recurrenceType || 'none';
    const recurrenceFields = recurrence === 'monthly_nth_weekday'
      ? `<label>${labelTitle('Qual semana', 'recurrenceOrdinal')}<select data-type="number" data-bind="${base}.recurrenceOrdinal"><option value="1" ${Number(item.recurrenceOrdinal || 1) === 1 ? 'selected' : ''}>1ª</option><option value="2" ${Number(item.recurrenceOrdinal) === 2 ? 'selected' : ''}>2ª</option><option value="3" ${Number(item.recurrenceOrdinal) === 3 ? 'selected' : ''}>3ª</option><option value="4" ${Number(item.recurrenceOrdinal) === 4 ? 'selected' : ''}>4ª</option><option value="-1" ${Number(item.recurrenceOrdinal) === -1 ? 'selected' : ''}>Última</option></select></label><label>${labelTitle('Dia da semana', 'recurrenceWeekday')}<select data-type="number" data-bind="${base}.recurrenceWeekday">${[['0','Segunda'],['1','Terça'],['2','Quarta'],['3','Quinta'],['4','Sexta'],['5','Sábado'],['6','Domingo']].map(([v,l]) => `<option value="${v}" ${Number(item.recurrenceWeekday ?? 0) === Number(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
      : recurrence === 'every_n_days'
        ? `<label>${labelTitle('A cada quantos dias', 'recurrenceEveryDays')}<input type="number" min="1" data-type="number" data-bind="${base}.recurrenceEveryDays" value="${esc(item.recurrenceEveryDays || 14)}"></label><label>${labelTitle('Data-base', 'recurrenceAnchorDate')}<input type="date" data-bind="${base}.recurrenceAnchorDate" value="${esc(item.recurrenceAnchorDate || new Date().toISOString().slice(0,10))}"></label>`
        : '';
    return `<details class="ss-advanced"><summary><span>Dias e datas${help('days')}</span></summary><div class="ss-advanced-body"><label class="check-row"><input type="checkbox" data-bind="${base}.enabled" ${item.enabled !== false ? 'checked' : ''}><span>Evento ativo${help('eventEnabled')}</span></label><div class="ss-day-filter-title">Dias da semana${help('days')}</div><div class="ss-day-picker">${DAY_OPTIONS.map(([value, label]) => `<label title="${esc(HELP_TEXT.days)}"><input type="checkbox" value="${value}" data-array-toggle="${base}.days" ${days.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><div class="form-grid two"><label>${labelTitle('Data inicial', 'startDate')}<input type="date" data-bind="${base}.startDate" value="${esc(item.startDate || '')}"></label><label>${labelTitle('Data final', 'endDate')}<input type="date" data-bind="${base}.endDate" value="${esc(item.endDate || '')}"></label><label>${labelTitle('Somente estas datas', 'onlyDates', '<small>Uma por linha</small>')}<textarea rows="2" data-type="list" data-bind="${base}.dates">${esc(listValue(item.dates))}</textarea></label><label>${labelTitle('Excluir estas datas', 'excludeDates', '<small>Uma por linha</small>')}<textarea rows="2" data-type="list" data-bind="${base}.excludeDates">${esc(listValue(item.excludeDates))}</textarea></label><label>${labelTitle('Recorrência avançada', 'recurrenceType')}<select data-bind="${base}.recurrenceType" data-rerender="true"><option value="none" ${recurrence === 'none' ? 'selected' : ''}>Sem recorrência extra</option><option value="monthly_nth_weekday" ${recurrence === 'monthly_nth_weekday' ? 'selected' : ''}>Uma semana do mês</option><option value="every_n_days" ${recurrence === 'every_n_days' ? 'selected' : ''}>A cada N dias</option></select></label>${recurrenceFields}</div></div></details>`;
  }
  function fillerKindInfo(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return FILLER_KIND_OPTIONS.find(([key]) => key === normalized) || null;
  }

  function renderFillerKindSelect(path, value, { defaultValue = 'none', rerender = true, recommendPostroll = false } = {}) {
    const current = String(value || defaultValue || 'none').trim().toLowerCase();
    const known = FILLER_KIND_OPTIONS.some(([key]) => key === current);
    const description = fillerKindInfo(current)?.[2] || 'Escolha como o ErsatzTV deve tratar este conteúdo no EPG.';
    const unknown = current && !known ? `<option value="${esc(current)}" selected>Valor atual: ${esc(current)}</option>` : '';
    return `<label>${labelTitle('Tipo de Filler', 'fillerKind')}<select data-bind="${esc(path)}" ${rerender ? 'data-rerender="true"' : ''}>${unknown}${FILLER_KIND_OPTIONS.map(([key, label]) => `<option value="${key}" ${current === key ? 'selected' : ''}>${esc(label)}${recommendPostroll && key === 'postroll' ? ' (recomendado)' : ''}</option>`).join('')}</select><small>${esc(description)}</small></label>`;
  }

  function renderPlaybackAdvanced(base, item, options = {}) {
    const fillerKindField = options.hideFillerKind ? '' : renderFillerKindSelect(`${base}.fillerKind`, item.fillerKind, { defaultValue: 'none' });
    return `<details class="ss-advanced"><summary><span>Reprodução avançada${help('fallback')}</span></summary><div class="ss-advanced-body form-grid three"><label>${labelTitle('Título customizado', 'customTitle')}<input data-bind="${base}.customTitle" value="${esc(item.customTitle || '')}"></label>${fillerKindField}<label>${labelTitle('Fallback Source', 'fallback')}<select data-bind="${base}.fallback" data-rerender="true">${sourceOptions(item.fallback)}</select></label>${sourceOrderSelect(`${base}.fallbackOrder`, item.fallback, item.fallbackOrder, false, 'Ordem do Fallback')}<label>${labelTitle('Tentativas descartadas', 'discardAttempts')}<input type="number" min="0" data-type="number" data-bind="${base}.discardAttempts" value="${esc(item.discardAttempts ?? '')}"></label><label class="check-row"><input type="checkbox" data-bind="${base}.disableWatermarks" ${item.disableWatermarks ? 'checked' : ''}><span>Desativar watermarks nativos${help('disableWatermarks')}</span></label><label class="check-row"><input type="checkbox" data-bind="${base}.trim" data-rerender="true" ${item.trim ? 'checked' : ''}><span>Permitir trim${help('trim')}</span></label><label class="check-row"><input type="checkbox" data-bind="${base}.offlineTail" ${item.offlineTail ? 'checked' : ''}><span>Offline tail${help('offlineTail')}</span></label><label class="check-row"><input type="checkbox" data-bind="${base}.allowOverrun" data-rerender="true" ${item.allowOverrun !== false ? 'checked' : ''}><span>Deixar o vídeo terminar${help('allowOverrun')}</span></label></div></details>`;
  }

  function versionAtLeast(value, minimum) { const a = String(value || '').split('.').map(Number); const b = String(minimum).split('.').map(Number); for (let i = 0; i < 3; i += 1) { if ((a[i] || 0) > (b[i] || 0)) return true; if ((a[i] || 0) < (b[i] || 0)) return false; } return true; }

  function sequenceSupportsItemPad(steps = []) {
    const modes = (steps || []).map((step) => String(step?.mode || 'count'));
    return modes.includes('count') && modes.every((mode) => !['duration', 'all'].includes(mode));
  }

  function modeSupportsItemPad(mode, steps = []) {
    if (String(mode || 'count') === 'count') return true;
    if (String(mode || 'count') === 'sequence') return sequenceSupportsItemPad(steps);
    return false;
  }

  function renderPadToNearest(base, item) {
    const hasFiller = Boolean(state.current.filler && String(state.current.filler.source || '').trim());
    const hasMotor = versionAtLeast(state.current.templateVersion, '1.2.0');
    const enabled = hasFiller && hasMotor;
    const current = item.padToNearestMinutes === null || item.padToNearestMinutes === undefined ? '' : String(item.padToNearestMinutes);
    const reason = !hasMotor
      ? 'Atualize o motor para 1.2.0 ou mais recente para usar esta opção.'
      : (!hasFiller ? 'Configure o Filler do projeto para liberar esta opção.' : 'Depois de cada item, o Filler completa até a próxima marca escolhida. Um evento com horário marcado continua entrando no horário dele.');
    return `<details class="ss-advanced"><summary><span>Alinhamento entre itens${help('padToNearest')}</span></summary><div class="ss-advanced-body form-grid two"><label>${labelTitle('Pad To Nearest Minute', 'padToNearest')}<select data-type="number" data-bind="${base}.padToNearestMinutes" ${enabled ? '' : 'disabled'}><option value="" ${current === '' ? 'selected' : ''}>Desativado</option>${PAD_TO_NEAREST_OPTIONS.map((minutes) => `<option value="${minutes}" ${current === String(minutes) ? 'selected' : ''}>${minutes} ${minutes === 5 ? '(:00, :05, :10, :15...)' : minutes === 10 ? '(:00, :10, :20, :30, :40, :50)' : minutes === 15 ? '(:00, :15, :30, :45)' : '(:00, :30)'}</option>`).join('')}</select><small>${esc(reason)}</small></label></div></details>`;
  }

  function clearPadToNearestSettings() {
    let cleared = 0;
    const modules = state.current.modules || {};
    for (const [type, items] of Object.entries(modules)) {
      if (type === 'offlineWindows') continue;
      for (const item of items || []) {
        if (item.padToNearestMinutes !== '' && item.padToNearestMinutes !== null && item.padToNearestMinutes !== undefined) {
          item.padToNearestMinutes = ''; cleared += 1;
        }
        const nested = type === 'windowRotations' ? item.items : type === 'choiceEvents' ? item.choices : type === 'clockTemplates' ? item.slots : [];
        for (const entry of nested || []) {
          if (entry.padToNearestMinutes !== '' && entry.padToNearestMinutes !== null && entry.padToNearestMinutes !== undefined) {
            entry.padToNearestMinutes = ''; cleared += 1;
          }
        }
      }
    }
    return cleared;
  }

  function renderFiller() {
    const filler = state.current.filler;
    return `<details class="card ss-section-card ss-section-accordion" ${accordionAttrs('programming:filler')}><summary class="ss-section-summary"><div><span class="eyebrow">Filler</span><h3>Preenchimento de lacunas</h3><p>Última camada de preenchimento quando nenhum outro conteúdo de programação está ativo.</p></div><span>${filler ? 'Ativo' : 'Desativado'}</span></summary><div class="ss-section-accordion-body"><div class="ss-section-actions"><button type="button" data-ss-action="toggle-filler">${filler ? 'Desativar Filler' : 'Ativar Filler'}</button></div>${filler ? `<div class="form-grid three">${sourceOrderPair('filler', filler, { helpKey: 'fillerSource' })}${profileSelect('filler.presentation', filler.presentation, 'fillerPresentation')}${renderFillerKindSelect('filler.fillerKind', filler.fillerKind, { defaultValue: 'postroll', recommendPostroll: true })}</div>${renderPlaybackAdvanced('filler', filler, { hideFillerKind: true })}` : '<div class="empty-state">Filler desativado. Lacunas sem outros módulos ficarão sem programação.</div>'}</div></details>`;
  }

  function renderEditorSaveBar(sectionLabel) {
    return `<div class="card ss-editor-save-bar"><span>Terminou de editar ${esc(sectionLabel.toLowerCase())}? Salve sem precisar voltar ao topo.</span><div class="header-actions"><button type="button" data-ss-action="validate">Validar</button><button type="button" class="primary" data-ss-action="publish">Salvar e publicar</button></div></div>`;
  }

  function renderReview() {
    const v = state.validation;
    const counts = Object.entries(MODULE_META).map(([key, meta]) => ({ label: meta.label, count: state.current.modules[key]?.length || 0 })).filter((item) => item.count);
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><span class="eyebrow">04 · Revisão</span><h3>Resumo da programação</h3></div><button type="button" class="primary" data-ss-action="validate">Validar agora</button></div>
        <div class="metrics metrics-wide ss-review-metrics">
          <div><span>Sources</span><strong>${state.current.sources.length}</strong></div>
          <div><span>Graphics</span><strong>${state.current.graphicsGroups.length}</strong></div>
          <div><span>Playlists</span><strong>${state.current.scriptedPlaylists.length}</strong></div>
          <div><span>Profiles</span><strong>${visibleProfiles().length}</strong></div>
          <div><span>Módulos</span><strong>${counts.length}</strong></div>
          <div><span>Canais</span><strong>${state.current.channelLinks.length}</strong></div>
        </div>
        <div class="ss-summary-list">${counts.length ? counts.map((item) => `<div><strong>${esc(item.label)}</strong><span>${item.count} item(ns)</span></div>`).join('') : '<div><span>Nenhum módulo ativo.</span></div>'}</div>
        ${renderValidation(v)}
      </section>`;
  }

  function renderValidation(validation) {
    if (!validation) return '<div class="ss-validation neutral"><strong>Aguardando validação.</strong><span>Valide antes de publicar para encontrar referências ausentes e campos inválidos.</span></div>';
    const errors = validation.errors || []; const warnings = validation.warnings || [];
    return `<div class="ss-validation ${validation.ok ? 'ok' : 'danger'}"><strong>${validation.ok ? 'Configuração válida' : `${errors.length} erro(s) encontrado(s)`}</strong>${errors.length ? `<div class="ss-validation-list">${errors.map((item) => `<div><code>${esc(item.path || 'projeto')}</code><span>${esc(item.message)}</span></div>`).join('')}</div>` : ''}${warnings.length ? `<div class="ss-validation-list warnings">${warnings.map((item) => `<div><code>${esc(item.path || 'aviso')}</code><span>${esc(item.message)}</span></div>`).join('')}</div>` : ''}</div>`;
  }

  function renderPublish() {
    const p = state.current;
    const published = Boolean(p.publishedAt && p.fileName);
    const computedPath = published ? `${String(state.settings?.outputRoot || '').replace(/\/+$/, '')}/${p.fileName}` : '';
    const pathChanged = Boolean(published && p.publishedPath && p.publishedPath !== computedPath);
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><span class="eyebrow">05 · Publicar</span><h3>Arquivo Python</h3></div><div class="header-actions"><button type="button" data-ss-action="preview">Pré-visualizar script</button><button type="button" class="primary" data-ss-action="publish">Salvar e publicar</button></div></div>
        ${published
          ? `<div class="ss-publish-path"><div><span>Caminho final</span><code>${esc(computedPath)}</code></div><button type="button" data-ss-action="copy-path" data-value="${esc(computedPath)}">Copiar</button></div>`
          : '<div class="ss-callout">Publique esta configuração para criar o arquivo. O nome será formado a partir do nome atual da configuração.</div>'}
        <div class="ss-card-meta">
          <span><strong>Estado</strong>${published ? 'Publicado' : 'Ainda não publicado'}</span>
          <span><strong>Última publicação</strong>${published ? esc(formatDate(p.publishedAt)) : '-'}</span>
          <span><strong>SHA-256</strong>${p.publishedHash ? `<code>${esc(p.publishedHash.slice(0, 16))}…</code>` : '-'}</span>
        </div>
        ${pathChanged ? `<div class="ss-callout warning"><strong>O caminho mudou.</strong> O arquivo já publicado continua em <code>${esc(p.publishedPath)}</code>. Depois de publicar com o novo nome/caminho, atualize também o Scripted Schedule no ErsatzTV.</div>` : ''}
        ${published ? '<div class="ss-callout">Na primeira vez, cadastre este caminho no Scripted Schedule do Playout no ErsatzTV. Depois, é só salvar por aqui para manter o mesmo arquivo atualizado.</div>' : ''}
      </section>
      ${renderLinksAssistant(computedPath)}
      <section class="card ss-section-card">
        <div class="section-heading"><div><h3>Prévia do script</h3><p>Somente leitura. A configuração visual continua sendo a fonte de verdade.</p></div>${state.preview ? '' : '<button type="button" data-ss-action="preview">Carregar prévia</button>'}</div>
        ${state.preview ? `<pre class="ss-code-preview">${esc(state.preview)}</pre>` : '<div class="empty-state">Carregue a prévia para conferir o Python atualmente salvo.</div>'}
      </section>
      <section class="card ss-section-card">
        <div class="section-heading"><div><h3>Histórico</h3><p>As últimas publicações podem ser restauradas sem apagar as revisões intermediárias.</p></div><button type="button" data-ss-action="history">Atualizar histórico</button></div>
        ${state.history.length ? `<div class="ss-history-list">${state.history.map((item) => `<div><span><strong>${esc(formatDate(item.revisionAt))}</strong><small>${esc(item.reason || 'publish')} · ${esc(item.publishedHash ? item.publishedHash.slice(0, 12) : 'sem hash')}</small></span><button type="button" data-ss-action="restore" data-revision="${esc(item.id)}">Restaurar</button></div>`).join('')}</div>` : '<div class="empty-state">Carregue o histórico para ver revisões anteriores.</div>'}
      </section>`;
  }

  function renderLinksAssistant(filePath) {
    if (!state.current.publishedAt) return `
      <section class="card ss-section-card"><div class="section-heading"><div><h3>Assistente de vínculo</h3><p>Depois da primeira publicação, o caminho do script e o identificador do canal aparecerão aqui.</p></div></div></section>`;
    if (!state.current.channelLinks.length) return `
      <section class="card ss-section-card"><div class="section-heading"><div><h3>Assistente de vínculo</h3><p>Adicione um canal na etapa Geral para preparar os dados de vínculo.</p></div></div></section>`;
    return `
      <section class="card ss-section-card">
        <div class="section-heading"><div><h3>Assistente de vínculo</h3><p>Use estes dados ao configurar o Scripted Schedule no Playout do ErsatzTV.</p></div></div>
        <div class="ss-stack">${state.current.channelLinks.map((link) => `<div class="ss-link-card"><div><span>Canal</span><strong>${esc(link.channelName || link.channelNumber)}</strong></div><div><span>Script</span><code>${esc(filePath)}</code></div><div><span>state_key</span><code>${esc(link.stateKey || '')}</code></div><div class="header-actions"><button type="button" data-ss-action="copy-path" data-value="${esc(filePath)}">Copiar caminho</button><button type="button" data-ss-action="copy-path" data-value="${esc(link.stateKey || '')}">Copiar state_key</button><button type="button" class="danger" data-ss-action="reset-playout" data-channel="${esc(link.channelNumber)}">Reset Playout</button></div></div>`).join('')}</div>
      </section>`;
  }

  function formatDate(value) {
    if (!value) return '-';
    try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
    catch { return String(value); }
  }

  async function home() {
    state.current = null; state.tab = 'general'; state.validation = null; state.preview = ''; state.history = [];
    state.openAccordions.clear(); state.modulePickerOpen = false; state.modulePickerSelection = '';
    await reloadList();
  }

  window.ScriptedSchedulesView = { init, refresh: reloadList, home };
})();
