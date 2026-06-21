/* ─────────────────────────────────────────────────────────────────

   Página messages.html — a "caixa de entrada" do chat: mostra uma
   linha por CONVERSA (não por mensagem individual), com a última
   mensagem trocada, hora, indicador de não-lidas, e permite
   pesquisar tanto pelo nome da pessoa como pelo CONTEÚDO de
   qualquer mensagem trocada nessa conversa (não só a última).

   Como o Supabase REST não tem um conceito nativo de "conversa"
   (só existe a tabela `messages`, linha a linha), este ficheiro
   reconstrói as conversas em memória, no lado do cliente:
     1. Busca TODAS as mensagens (enviadas ou recebidas) do utilizador.
     2. Agrupa-as por "par de utilizadores" (não importa quem
        enviou/recebeu, o que importa é com QUEM se está a conversar).
     3. Para cada par, guarda a mensagem mais recente (lastMsg, já
        que a query vem ordenada por created_at descendente — a
        primeira mensagem encontrada de cada par É a mais recente),
        conta quantas estão não lidas, e concatena TODO o texto da
        conversa (allText) para permitir pesquisa de texto completo.
───────────────────────────────────────────────────────────────────── */

// Cache em memória de todas as conversas já processadas — usada
// pela pesquisa para filtrar localmente sem ter de voltar a
// consultar a BD a cada tecla.
let _allConversations = [];

/**
 * Ponto de entrada da página:
 *   1. Garante autenticação.
 *   2. Carrega e desenha a lista de conversas.
 *   3. Subscreve um canal Realtime que escuta INSERTs na tabela
 *      `messages` filtrados por `receiver_id=eq.<meuId>` — ou seja,
 *      só dispara quando CHEGA uma mensagem nova destinada a mim
 *      (não quando EU envio, nem mensagens de outras conversas que
 *      não me envolvem). Ao disparar, simplesmente recarrega a
 *      lista completa de conversas (loadConversations) em vez de
 *      tentar atualizar só a linha afetada — mais simples de
 *      implementar, ao custo de ser menos eficiente (refaz todos os
 *      pedidos), mas garante que a lista fica sempre consistente.
 *
 * Nota: ao contrário de chat.js, este filtro `filter:` é aplicado
 * diretamente na subscrição do Supabase Realtime (filtragem no
 * lado do servidor), em vez de ser feito manualmente no callback —
 * uma abordagem mais eficiente quando o filtro é simples (igualdade
 * num único campo).
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  await loadConversations(session.user.id);

  // Realtime — atualiza a lista quando chega nova mensagem.
  supabaseClient
    .channel('messages-inbox')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `receiver_id=eq.${session.user.id}`
    }, () => loadConversations(session.user.id))
    .subscribe();
});

/**
 * loadConversations
 * -------------------
 * Função central: busca todas as mensagens do utilizador e
 * reconstrói a lista de conversas agrupadas.
 *
 * Passo a passo:
 *   1. SELECT a `messages` onde o utilizador é sender OU receiver
 *      (`.or(...)`), ordenado por created_at DESCENDENTE — esta
 *      ordem é importante: como se percorre a lista do mais recente
 *      para o mais antigo, a PRIMEIRA mensagem encontrada para cada
 *      par de utilizadores é automaticamente a mais recente dessa
 *      conversa (por isso o código só guarda lastMsg na primeira
 *      vez que vê uma chave nova, com `if (!conversationMap[key])`).
 *   2. Para cada mensagem, calcula `otherId` (o interlocutor — quem
 *      não é o próprio utilizador) e constrói uma `key` única para
 *      o par de utilizadores, ordenando os dois ids alfabeticamente
 *      e juntando-os ([userId, otherId].sort().join('_')) — assim,
 *      uma conversa entre A e B usa sempre a mesma chave,
 *      independentemente de quem é o "sender" em cada mensagem
 *      individual.
 *   3. Acumula em `allText` o conteúdo de TODAS as mensagens dessa
 *      conversa (para permitir pesquisa por qualquer palavra já
 *      trocada, não só na última mensagem).
 *   4. Conta mensagens não lidas RECEBIDAS pelo utilizador atual
 *      (`msg.receiver_id === userId && !msg.read`) — não conta
 *      mensagens enviadas por mim, mesmo que ainda não tenham sido
 *      lidas pelo outro lado.
 *   5. Depois de agrupar, busca os perfis (nome, avatar) de todos os
 *      interlocutores únicos envolvidos, num único pedido .in('id', ids).
 *   6. Combina tudo em `_allConversations` (guardado globalmente
 *      para a pesquisa) e chama renderConversations() para desenhar.
 *
 * @param {string} userId
 */
async function loadConversations(userId) {
  const container = document.getElementById('conv-list');
  if (!container) return;

  // Buscar todas as mensagens do utilizador (enviadas e recebidas).
  const { data: messages, error } = await supabaseClient
    .from('messages')
    .select('id, sender_id, receiver_id, content, read, created_at, item_id')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('[Messages]', error); return; }
  if (!messages?.length) {
    container.innerHTML = '<p style="padding:20px;font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45);text-align:center">Sem mensagens ainda.<br>Contacta um anunciante para começar.</p>';
    return;
  }

  // Agrupar por conversa (par de utilizadores).
  const conversationMap = {};
  messages.forEach(msg => {
    const otherId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    const key = [userId, otherId].sort().join('_');
    if (!conversationMap[key]) {
      // Primeira vez que se vê este par — como a lista vem ordenada
      // por created_at descendente, esta É a mensagem mais recente.
      conversationMap[key] = { otherId, lastMsg: msg, unread: 0, allText: '' };
    }
    // Acumular todo o conteúdo da conversa para pesquisa por palavra/sílaba.
    conversationMap[key].allText += ' ' + (msg.content || '');
    // Contar não lidas (só as que EU recebi e ainda não li).
    if (msg.receiver_id === userId && !msg.read) {
      conversationMap[key].unread++;
    }
  });

  const conversations = Object.values(conversationMap);

  // Buscar perfis dos outros utilizadores envolvidos, num único pedido.
  const otherIds = [...new Set(conversations.map(c => c.otherId))];
  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', otherIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  // Guardar conversas processadas globalmente (para a pesquisa
  // filtrar localmente, sem novos pedidos à BD).
  _allConversations = conversations.map(conv => {
    const profile = profileMap[conv.otherId] || {};
    return {
      ...conv,
      name: profile.full_name || 'Utilizador',
      avatarUrl: profile.avatar_url || null,
    };
  });

  renderConversations(_allConversations, userId);
}

/**
 * renderConversations
 * ----------------------
 * Desenha a lista de conversas (#conv-list). Cada linha é um link
 * (<a>) clicável que navega diretamente para chat.html?with=...,
 * já incluindo o item_id da última mensagem (se houver), para abrir
 * o chat já no contexto desse item.
 *
 * Lógica de "preview" inteligente quando há uma pesquisa ativa
 * (searchQuery):
 *   - se o termo pesquisado aparecer na ÚLTIMA mensagem
 *     (lastMsgMatches), mostra-a normalmente, com o prefixo "Tu: "
 *     se foi o próprio utilizador que a enviou;
 *   - se NÃO aparecer na última mensagem mas existir em algum ponto
 *     do histórico da conversa (allText), procura a posição da
 *     primeira ocorrência e extrai um TRECHO de contexto (20
 *     caracteres antes e depois do termo encontrado), com "..." nas
 *     pontas se o trecho não começar/terminar no início/fim do
 *     texto — assim, mesmo que a busca não corresponda à última
 *     mensagem, o utilizador vê ONDE na conversa o termo apareceu.
 *
 * O texto final do preview é limitado a 40 caracteres (cortado com
 * "..." se for maior) e, se houver pesquisa ativa, passa por
 * highlightMatch() para destacar visualmente o termo encontrado
 * (envolvendo-o num <mark>).
 *
 * @param {Array<Object>} conversations - lista já processada (de _allConversations ou filtrada).
 * @param {string} userId - id do utilizador atual (para saber quem enviou a última mensagem).
 * @param {string} [searchQuery] - termo de pesquisa ativo, se houver.
 */
function renderConversations(conversations, userId, searchQuery) {
  const container = document.getElementById('conv-list');
  const emptyEl    = document.getElementById('search-empty');
  if (!container) return;

  if (!conversations.length) {
    container.innerHTML = '';
    container.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  container.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  const q = (searchQuery || '').trim().toLowerCase();

  container.innerHTML = conversations.map((conv, i) => {
    const name      = conv.name;
    const avatarHTML = conv.avatarUrl
      ? `<img src="${conv.avatarUrl}" style="width:100%;height:100%;object-fit:cover">`
      : `<svg viewBox="0 0 24 24" width="60%" height="60%" fill="rgba(23,42,58,0.35)"><path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>`;

    // Se a pesquisa não encontrar o termo na última mensagem mas
    // existir em algum ponto da conversa, mostrar um trecho relevante
    // com destaque (em vez de apenas a última mensagem, que não
    // conteria o termo procurado).
    let previewText  = conv.lastMsg.content;
    let isSentPrefix = conv.lastMsg.sender_id === userId ? 'Tu: ' : '';
    const lastMsgMatches = q && previewText.toLowerCase().includes(q);

    if (q && !lastMsgMatches && conv.allText) {
      const idx = conv.allText.toLowerCase().indexOf(q);
      if (idx !== -1) {
        const start = Math.max(0, idx - 20);
        const snippet = conv.allText.substring(start, idx + q.length + 20).trim();
        previewText = (start > 0 ? '...' : '') + snippet + (idx + q.length + 20 < conv.allText.length ? '...' : '');
        isSentPrefix = ''; // o trecho extraído já não corresponde necessariamente à última mensagem enviada por mim, por isso omite-se o prefixo "Tu:"
      }
    }

    const preview = previewText.length > 40 ? previewText.substring(0, 40) + '...' : previewText;
    const previewHTML = q
      ? highlightMatch(preview, q)
      : preview;

    const time      = formatTime(conv.lastMsg.created_at);
    const unread    = conv.unread > 0;
    const itemId    = conv.lastMsg.item_id || '';
    const divider   = i < conversations.length - 1 ? '<div class="conv-divider"></div>' : '';

    return `
      <a class="conv-item ${unread ? 'unread' : ''}"
         href="chat.html?with=${conv.otherId}&item=${itemId}"
         style="text-decoration:none">
        <div class="conv-avatar-wrap">
          <div class="conv-avatar" style="background:#e8eef0;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${avatarHTML}
          </div>
          <span class="online-dot"></span>
        </div>
        <div class="conv-info">
          <div class="conv-name">${name}</div>
          <div class="conv-preview">${isSentPrefix}${previewHTML}</div>
        </div>
        <div class="conv-meta">
          <span class="conv-time">${time}</span>
          ${unread ? '<span class="conv-unread-dot"></span>' : ''}
        </div>
      </a>
      ${divider}
    `;
  }).join('');
}

/* ── Pesquisa de conversas ───────────────────────────────
   Procura tanto no nome da pessoa como em todo o texto trocado na
   conversa (não apenas na última mensagem visível). */

/**
 * filterConversations
 * ----------------------
 * Handler chamado ao escrever na caixa de pesquisa de conversas.
 * Não consulta a BD novamente — filtra diretamente a cache local
 * `_allConversations`, comparando o termo (em minúsculas) com:
 *   - o NOME do interlocutor, ou
 *   - todo o texto acumulado da conversa (allText).
 *
 * Como `renderConversations` precisa do `userId` (para saber quem
 * enviou a última mensagem e decidir o prefixo "Tu:"), este é
 * obtido aqui via `getSession()` antes de chamar o render —
 * pequena particularidade: como esta função não é `async`
 * diretamente (usa .then() em vez de await, possivelmente para
 * poder ser chamada diretamente de um atributo `oninput` no HTML
 * sem complicações de sintaxe), o fluxo de obtenção da sessão é
 * feito com encadeamento de promises clássico.
 *
 * Se a pesquisa estiver vazia, simplesmente mostra de volta a lista
 * completa sem filtro nem destaque.
 *
 * @param {string} query
 */
function filterConversations(query) {
  const q = query.trim().toLowerCase();

  supabaseClient.auth.getSession().then(({ data }) => {
    const userId = data.session?.user?.id;
    if (!q) {
      renderConversations(_allConversations, userId);
      return;
    }
    const filtered = _allConversations.filter(c => {
      const nameMatch = c.name.toLowerCase().includes(q);
      const textMatch = (c.allText || '').toLowerCase().includes(q);
      return nameMatch || textMatch;
    });
    renderConversations(filtered, userId, q);
  });
}

/**
 * highlightMatch
 * ----------------
 * Envolve a primeira ocorrência do termo pesquisado (case
 * insensitive) num <mark> estilizado, para o destacar visualmente
 * dentro do preview da conversa.
 *
 * IMPORTANTE quanto à segurança: o texto é primeiro escapado
 * (escapeHTML) e só DEPOIS é que se procura e insere a tag <mark> —
 * ou seja, a busca pelo índice do termo é feita sobre o texto JÁ
 * escapado, o que evita que o resultado final contenha HTML não
 * controlado vindo do conteúdo da mensagem (proteção contra XSS,
 * semelhante ao escapeHtml() de chat.js, mas usando aqui a técnica
 * do textContent de um <div> temporário em vez de substituições
 * manuais de caracteres).
 *
 * @param {string} text - texto já reduzido ao tamanho do preview.
 * @param {string} query - termo a destacar.
 * @returns {string} HTML com o termo envolvido em <mark>, ou o texto
 *          escapado sem alterações se o termo não for encontrado.
 */
function highlightMatch(text, query) {
  if (!query) return escapeHTML(text);
  const escaped = escapeHTML(text);
  const idx = escaped.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escaped;
  const before = escaped.substring(0, idx);
  const match  = escaped.substring(idx, idx + query.length);
  const after  = escaped.substring(idx + query.length);
  return `${before}<mark style="background:rgba(1,110,88,0.18);color:var(--dark-green);border-radius:3px;padding:0 1px">${match}</mark>${after}`;
}

/**
 * escapeHTML
 * ------------
 * Técnica alternativa de escaping de HTML (diferente da usada em
 * chat.js): atribui o texto a `textContent` de um <div> temporário
 * (nunca inserido na página) e lê de volta o `innerHTML` resultante
 * — o browser faz automaticamente o escape de todos os caracteres
 * especiais ao fazer essa conversão, sem ser necessário escrever
 * manualmente cada substituição de caractere.
 *
 * @param {string} str
 * @returns {string} versão segura para inserir como HTML.
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * formatTime
 * ------------
 * Formata a data/hora da última mensagem de forma relativa e
 * compacta, semelhante ao que se vê em apps de mensagens populares:
 *   - há menos de 1 hora   → "Xm" (minutos exatos, arredondados por baixo)
 *   - há menos de 24 horas → hora no formato HH:MM
 *   - há menos de 7 dias   → nome abreviado do dia da semana em
 *     português (Dom, Seg, Ter, ...)
 *   - mais antigo            → data no formato DD/MM
 *
 * @param {string} iso - data ISO da última mensagem.
 * @returns {string} rótulo de tempo compacto.
 */
function formatTime(iso) {
  if (!iso) return '';
  const date  = new Date(iso);
  const now   = new Date();
  const diff  = now - date;
  const hours = diff / (1000 * 60 * 60);
  const days  = diff / (1000 * 60 * 60 * 24);

  if (hours < 1)   return Math.floor(diff / 60000) + 'm';
  if (hours < 24)  return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  if (days < 7)    return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][date.getDay()];
  return date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}
