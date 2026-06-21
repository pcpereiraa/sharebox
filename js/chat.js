/* ─────────────────────────────────────────────────────────────────
   Chat em tempo real com Supabase Realtime
   ───────────────────────────────────────────────────────────────────
   Página de conversa 1-para-1 (chat.html?with=<userId>&item=<itemId>)
   entre o utilizador atual e outro utilizador (normalmente o dono de
   um item, a propósito de uma doação — daí o parâmetro opcional `item`).

   Conceitos centrais a explicar na defesa:

   1. MENSAGENS PERSISTIDAS — todas as mensagens são guardadas na
      tabela `messages` (sender_id, receiver_id, item_id opcional,
      content, read, created_at). loadMessages() busca o HISTÓRICO
      completo entre os dois utilizadores ao abrir a página.

   2. REALTIME — para a conversa parecer "ao vivo" sem necessidade de
      recarregar a página, a app subscreve um canal do Supabase
      Realtime que escuta INSERTs na tabela `messages` (Postgres
      Changes / replicação lógica do Postgres exposta pelo Supabase).
      Sempre que QUALQUER mensagem nova é inserida na BD (de qualquer
      conversa, de qualquer utilizador), o canal recebe o evento, e o
      código filtra localmente (`isRelevant`) se essa mensagem
      pertence à conversa atual entre currentUserId e otherUserId.

   3. UI OTIMISTA — quando o PRÓPRIO utilizador envia uma mensagem,
      ela é desenhada no ecrã IMEDIATAMENTE (appendMessage com um id
      temporário "temp_..."), sem esperar a confirmação da BD nem o
      evento Realtime — por isso o listener do Realtime ignora
      explicitamente mensagens cujo sender_id seja o próprio
      currentUserId (`msg.sender_id !== currentUserId`), para não
      duplicar a mensagem que já foi mostrada otimisticamente.

   4. NOTIFICAÇÕES PUSH — depois de gravar a mensagem com sucesso, é
      invocada uma Supabase Edge Function ('send-push-notification')
      para notificar o destinatário, mesmo que ele não esteja com a
      app aberta. Este passo é "fire and forget": se falhar, é só
      registado um aviso na consola, NÃO impede a mensagem de ter
      sido enviada (a falha de notificação não deve bloquear o chat).
───────────────────────────────────────────────────────────────────── */

// Estado do módulo:
let currentUserId  = null; // id do utilizador autenticado (quem está a ver a página)
let otherUserId    = null; // id do interlocutor (vem de ?with=)
let itemId         = null; // id do item relacionado com esta conversa, se houver (vem de ?item=)
let realtimeChannel = null; // referência ao canal Realtime subscrito, para poder cancelar a subscrição ao sair da página

/**
 * Ponto de entrada da página:
 *   1. Garante autenticação.
 *   2. Lê `with` (obrigatório — sem ele não há com quem conversar,
 *      redireciona para messages.html) e `item` (opcional) da query string.
 *   3. Carrega em paralelo: info do outro utilizador, referência do
 *      item (se houver) e o histórico de mensagens.
 *   4. Marca como lidas todas as mensagens que o outro utilizador
 *      enviou (mark as read — relevante para os "✓✓" de leitura e
 *      para os contadores de não-lidas noutras páginas, ex: messages.js).
 *   5. Subscreve um canal Supabase Realtime para receber mensagens
 *      novas em tempo real (ver explicação detalhada acima e em
 *      cada função).
 *   6. Liga o botão de enviar e o atalho de teclado: Enter envia a
 *      mensagem, Shift+Enter permite quebra de linha sem enviar
 *      (comportamento padrão em apps de chat).
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  currentUserId = session.user.id;

  const params = new URLSearchParams(window.location.search);
  otherUserId  = params.get('with');
  itemId       = params.get('item') || null;

  if (!otherUserId) { window.location.href = 'messages.html'; return; }

  await Promise.all([
    loadOtherUserInfo(),
    loadItemReference(),
    loadMessages()
  ]);

  // Marcar mensagens (do outro para mim) como lidas.
  markAsRead();

  // Realtime — receber mensagens novas.
  // O nome do canal é construído ordenando os dois ids
  // alfabeticamente ([currentUserId, otherUserId].sort()) e juntando-os
  // com "_" — isto garante que, independentemente de quem abre a
  // conversa primeiro (A→B ou B→A), AMBOS os utilizadores acabam por
  // subscrever exatamente o MESMO nome de canal, o que normalmente
  // não é estritamente necessário no Supabase Realtime (cada cliente
  // pode ter o seu próprio canal e ainda assim receber os mesmos
  // eventos da tabela), mas ajuda a organizar/identificar canais de
  // forma consistente e previsível.
  realtimeChannel = supabaseClient
    .channel(`chat-${[currentUserId, otherUserId].sort().join('_')}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, payload => {
      const msg = payload.new;
      // Filtra localmente: o evento chega para QUALQUER INSERT na
      // tabela messages (de qualquer conversa do sistema), por isso
      // é preciso verificar se esta mensagem pertence À CONVERSA
      // ATUAL entre currentUserId e otherUserId (em qualquer direção).
      const isRelevant =
        (msg.sender_id === currentUserId && msg.receiver_id === otherUserId) ||
        (msg.sender_id === otherUserId   && msg.receiver_id === currentUserId);
      // Só adicionar via Realtime se for mensagem do OUTRO
      // utilizador — as nossas próprias mensagens já foram mostradas
      // de forma otimista em sendMessage(), antes mesmo deste evento
      // chegar; mostrá-las aqui também duplicaria a mensagem na tela.
      if (isRelevant && msg.sender_id !== currentUserId) appendMessage(msg);
    })
    .subscribe();

  // Botão enviar + atalho de teclado.
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  document.getElementById('msg-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
});

/**
 * loadOtherUserInfo
 * --------------------
 * Carrega nome e avatar do interlocutor e preenche o cabeçalho do
 * chat (#chat-name, #chat-avatar) e os links para o respetivo
 * perfil (existem dois links idênticos no HTML — #chat-profile-link
 * e #chat-profile-link-2 — provavelmente em posições diferentes do
 * layout, ambos apontados para o mesmo destino).
 *
 * `maybeSingle()` é usado porque, teoricamente, o id passado em
 * `?with=` pode não corresponder a nenhum perfil válido — nesse
 * caso a função simplesmente não preenche nada (return antecipado).
 */
async function loadOtherUserInfo() {
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', otherUserId)
    .maybeSingle();

  if (!profile) return;

  const nameEl = document.getElementById('chat-name');
  if (nameEl) nameEl.textContent = profile.full_name || 'Utilizador';

  const profileLink1 = document.getElementById('chat-profile-link');
  const profileLink2 = document.getElementById('chat-profile-link-2');
  if (profileLink1) profileLink1.href = `view_profile.html?id=${otherUserId}`;
  if (profileLink2) profileLink2.href = `view_profile.html?id=${otherUserId}`;

  const avatarEl = document.getElementById('chat-avatar');
  if (avatarEl) {
    avatarEl.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#e8eef0;overflow:hidden';
    avatarEl.innerHTML = avatarHTML(profile.avatar_url);
  }
}

/**
 * loadItemReference
 * --------------------
 * Mostra um pequeno "cartão de contexto" no topo do chat com a
 * miniatura e nome do item que motivou a conversa (relevante porque
 * o utilizador normalmente chega ao chat a partir do botão
 * "Contactar anunciante" em item_detail.html).
 *
 * Esconde completamente este bloco (#item-reference) se:
 *   - não houver `itemId` na query string, ou
 *   - o valor for literalmente a string "null" ou vazio (proteção
 *     contra o caso de o link de chat ter sido gerado com
 *     item=undefined/null convertido incorretamente para texto), ou
 *   - o item não existir mais na BD (foi apagado, por exemplo).
 *
 * Caso o item exista, mostra também o estado atual ("Disponível" ou
 * o valor cru de `status` para outros casos, ex: "doado").
 */
async function loadItemReference() {
  const ref = document.getElementById('item-reference');
  if (!ref) return;

  if (!itemId || itemId === 'null' || itemId === '') {
    ref.style.display = 'none';
    return;
  }

  const { data: item } = await supabaseClient
    .from('items')
    .select('id, title, location, status')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) { ref.style.display = 'none'; return; }
  ref.classList.add('has-item');

  // Buscar imagem (só a primeira, suficiente para a miniatura).
  const { data: images } = await supabaseClient
    .from('item_images').select('image_url').eq('item_id', itemId).limit(1);

  const img = images?.[0]?.image_url;
  const statusLabel = item.status === 'disponivel' ? 'Disponível' : item.status;

  ref.innerHTML = `
    <div class="item-ref-thumb" style="background:#b2dfdb;overflow:hidden;cursor:pointer" onclick="window.location.href='item_detail.html?id=${item.id}'">
      ${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover">` : ''}
    </div>
    <div class="item-ref-info" style="cursor:pointer" onclick="window.location.href='item_detail.html?id=${item.id}'">
      <div class="item-ref-name">${item.title}</div>
      <div class="item-ref-meta">Doação · ${item.location || ''}</div>
    </div>
    <span class="item-ref-badge">${statusLabel}</span>
  `;
}

/**
 * loadMessages
 * --------------
 * Carrega o HISTÓRICO completo de mensagens entre os dois
 * utilizadores. A condição `.or(...)` constrói manualmente uma
 * cláusula OR em sintaxe PostgREST que cobre AMBAS as direções
 * possíveis da conversa:
 *   - mensagens enviadas por mim e recebidas pelo outro, OU
 *   - mensagens enviadas pelo outro e recebidas por mim.
 * (Sem isto, um simples filtro .eq('sender_id', X) só mostraria
 * metade da conversa.)
 *
 * Resultado ordenado por data de criação ascendente (mais antiga
 * primeiro), como é normal numa interface de chat.
 *
 * Depois de carregadas, as mensagens são agrupadas visualmente POR
 * DIA: sempre que a data (sem hora) muda em relação à mensagem
 * anterior, é inserido um separador "Hoje" / "Ontem" / data
 * completa (ver formatDateLabel) antes de continuar a desenhar as
 * mensagens desse novo dia.
 *
 * Se não houver mensagens, mostra "Começa a conversa!" como
 * placeholder amigável em vez de uma lista vazia.
 */
async function loadMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const { data: messages, error } = await supabaseClient
    .from('messages')
    .select('id, sender_id, content, read, created_at')
    .or(
      `and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),` +
      `and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`
    )
    .order('created_at', { ascending: true });

  if (error) { console.error('[Chat]', error); return; }

  container.innerHTML = '';

  if (!messages?.length) {
    container.innerHTML = '<p style="text-align:center;padding:20px;font-family:\'Berlin\',sans-serif;font-size:13px;color:rgba(23,42,58,0.4)">Começa a conversa!</p>';
    return;
  }

  // Agrupar por dia: compara a data (string) da mensagem atual com
  // a última processada; se mudou, insere um separador antes de
  // continuar.
  let lastDate = null;
  messages.forEach(msg => {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.innerHTML = `<span>${formatDateLabel(msg.created_at)}</span>`;
      container.appendChild(sep);
    }
    // scroll=false aqui porque, ao carregar o histórico inteiro de
    // uma vez, só queremos fazer scroll para o fundo UMA VEZ no
    // final (ver chamada a scrollToBottom() logo após o forEach),
    // não a cada mensagem individual (seria ineficiente e visualmente
    // estranho).
    appendMessage(msg, false);
  });

  scrollToBottom();
}

/**
 * appendMessage
 * ---------------
 * Cria e insere no DOM a "bolha" de uma única mensagem, com
 * aparência diferente conforme foi enviada (sent) ou recebida
 * (received) pelo utilizador atual:
 *   - sent (à direita)    → mostra o texto + hora + "ticks" de
 *     leitura (✓ enviada / ✓✓ lida);
 *   - received (à esquerda) → mostra um pequeno avatar + texto + hora
 *     (sem ticks, porque os ticks de leitura só fazem sentido do
 *     ponto de vista de quem ENVIOU).
 *
 * Remove primeiro qualquer placeholder de "Começa a conversa!" que
 * ainda possa estar no contentor (relevante quando a PRIMEIRA
 * mensagem da conversa é enviada/recebida).
 *
 * O conteúdo da mensagem passa por escapeHtml() antes de ser
 * inserido via innerHTML — proteção essencial contra XSS: sem isto,
 * um utilizador poderia enviar uma mensagem contendo HTML/JS
 * malicioso (ex: `<img src=x onerror=...>`) que seria executado no
 * browser de quem a recebesse.
 *
 * Mensagens temporárias (id a começar por "temp_", ver sendMessage)
 * recebem um atributo `data-temp-id` para poderem ser localizadas e
 * removidas mais tarde, caso o envio real à BD falhe.
 *
 * @param {Object} msg - { id, sender_id, content, read, created_at }
 * @param {boolean} [scroll=true] - se deve fazer scroll para o fundo
 *        depois de inserir esta mensagem.
 */
function appendMessage(msg, scroll = true) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  // Remover placeholder ("Começa a conversa!") se existir.
  const placeholder = container.querySelector('p');
  if (placeholder) placeholder.remove();

  const isSent = msg.sender_id === currentUserId;
  const time   = new Date(msg.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  const row = document.createElement('div');
  row.className = `msg-row ${isSent ? 'sent' : 'received'}`;
  if (msg.id?.startsWith('temp_')) row.dataset.tempId = msg.id;
  row.innerHTML = isSent
    ? `<div class="msg-bubble sent">
        <div class="msg-text">${escapeHtml(msg.content)}</div>
        <div class="msg-time-row">
          <span class="msg-time">${time}</span>
          <span class="msg-ticks">${msg.read ? '✓✓' : '✓'}</span>
        </div>
      </div>`
    : `<div class="msg-avatar" id="chat-avatar-sm" style="background:#80cbc4;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;font-family:'Berlin',sans-serif"></div>
       <div class="msg-bubble received">
        <div class="msg-text">${escapeHtml(msg.content)}</div>
        <div class="msg-time">${time}</div>
      </div>`;

  container.appendChild(row);
  if (scroll) scrollToBottom();
}

/**
 * sendMessage
 * -------------
 * Envia uma nova mensagem de texto. Passos:
 *   1. Lê e valida o texto do input (ignora se estiver vazio).
 *   2. Limpa o input imediatamente e devolve-lhe o foco (boa prática
 *      de UX, para o utilizador poder continuar a escrever sem ter
 *      de voltar a clicar no campo).
 *   3. UI OTIMISTA: cria um objeto de mensagem "falso" com um id
 *      temporário ('temp_' + timestamp) e desenha-o imediatamente no
 *      ecrã (appendMessage), antes mesmo de a BD confirmar nada —
 *      isto faz o chat parecer instantâneo, mesmo que a rede demore.
 *   4. Faz o INSERT real na tabela `messages`.
 *   5. Se o insert falhar: repõe o texto no campo de input (para o
 *      utilizador não perder o que escreveu) e remove a bolha
 *      temporária que tinha sido desenhada otimisticamente — reverte
 *      a UI para o estado anterior à tentativa de envio.
 *   6. Se tiver sucesso, dispara (sem bloquear/esperar) uma
 *      notificação push para o destinatário (notifyNewMessage),
 *      capturando e apenas avisando na consola qualquer erro dessa
 *      etapa — uma falha ao notificar NÃO deve ser tratada como
 *      falha ao enviar a mensagem.
 */
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text  = input?.value.trim();
  if (!text) return;

  input.value = '';
  input.focus();

  // Mostrar imediatamente sem esperar pelo Realtime/resposta da BD.
  const tempMsg = {
    id:         'temp_' + Date.now(),
    sender_id:  currentUserId,
    content:    text,
    read:       false,
    created_at: new Date().toISOString(),
  };
  appendMessage(tempMsg, true);

  const { data, error } = await supabaseClient
    .from('messages')
    .insert({
      sender_id:   currentUserId,
      receiver_id: otherUserId,
      item_id:     itemId && itemId !== 'null' ? itemId : null,
      content:     text,
      read:        false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Chat] Erro envio:', error);
    input.value = text; // repõe o texto, para o utilizador não o perder
    // Remover mensagem temporária — a UI tinha avançado de forma
    // otimista, mas como o envio real falhou, é preciso desfazer essa
    // suposição.
    const tempEl = document.querySelector(`[data-temp-id="${tempMsg.id}"]`);
    if (tempEl) tempEl.remove();
    return;
  }

  // Disparar notificação push para o destinatário (não bloqueia o
  // envio se falhar — é tratado como efeito secundário "best effort").
  notifyNewMessage(text).catch(err => console.warn('[Push] Não foi possível notificar:', err));
}

/**
 * notifyNewMessage
 * -------------------
 * Invoca uma Supabase Edge Function chamada 'send-push-notification'
 * (código que corre no lado do servidor, fora do browser, escrito
 * pelos autores do projeto e publicado no Supabase) para enviar uma
 * notificação push real ao destinatário (otherUserId), mesmo que ele
 * não tenha a aplicação aberta no momento.
 *
 * Antes de invocar, busca o nome do REMETENTE (o próprio utilizador
 * atual) para usar como título da notificação, e corta a mensagem a
 * 60 caracteres (com "..." se for mais longa) para servir de
 * pré-visualização (body) da notificação — é comum em apps de
 * mensagens não mostrar o texto completo na notificação.
 *
 * O `url` enviado na notificação aponta de volta para o chat —
 * note que está escrito como `chat.html?with=${currentUserId}`,
 * isto é, do ponto de vista de quem VAI RECEBER a notificação
 * (otherUserId), o "with" correto é precisamente o id de quem
 * enviou a mensagem (currentUserId) — para que, ao tocar na
 * notificação, o destinatário seja levado de volta a esta mesma
 * conversa.
 *
 * @param {string} messageText - texto da mensagem enviada (para gerar o preview).
 */
async function notifyNewMessage(messageText) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const { data: myProfile } = await supabaseClient
    .from('profiles').select('full_name').eq('id', currentUserId).maybeSingle();

  const senderName = myProfile?.full_name || 'Alguém';
  const preview = messageText.length > 60 ? messageText.substring(0, 60) + '...' : messageText;

  await supabaseClient.functions.invoke('send-push-notification', {
    body: {
      user_id: otherUserId,
      title:   senderName,
      body:    preview,
      url:     `chat.html?with=${currentUserId}`,
    },
  });
}

/**
 * markAsRead
 * ------------
 * Marca como lidas (read = true) todas as mensagens que o OUTRO
 * utilizador enviou para mim e que ainda estavam por ler
 * (.eq('read', false)) — chamado uma vez ao abrir a conversa. Isto
 * é o que permite, por exemplo, que a página messages.js mostre
 * corretamente quantas conversas têm mensagens não lidas.
 */
async function markAsRead() {
  await supabaseClient
    .from('messages')
    .update({ read: true })
    .eq('receiver_id', currentUserId)
    .eq('sender_id', otherUserId)
    .eq('read', false);
}

/* ── Helpers ──────────────────────────────────────────── */

/**
 * scrollToBottom
 * -----------------
 * Faz scroll do contentor de mensagens até ao fundo (mensagem mais
 * recente), ajustando scrollTop ao valor máximo possível
 * (scrollHeight).
 */
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

/**
 * escapeHtml
 * ------------
 * Escapa os caracteres especiais de HTML (&, <, >, ") no texto da
 * mensagem antes de ser inserido via innerHTML, prevenindo ataques
 * de XSS (Cross-Site Scripting) — sem isto, alguém poderia enviar
 * uma mensagem com código HTML/JS que seria interpretado e
 * executado no browser de quem a recebesse.
 *
 * @param {string} text - texto original da mensagem.
 * @returns {string} texto seguro para inserir como HTML.
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * formatDateLabel
 * -----------------
 * Converte uma data ISO num rótulo amigável para os separadores de
 * dia na conversa:
 *   - menos de 1 dia de diferença → "Hoje"
 *   - menos de 2 dias            → "Ontem"
 *   - caso contrário              → data completa em português
 *     (ex: "15 de junho").
 *
 * Nota: o cálculo `(now - date) / (1000*60*60*24)` dá a diferença em
 * DIAS FRACIONÁRIOS de tempo absoluto (não dias de calendário) — ou
 * seja, é uma aproximação simples e pode, em casos limite perto da
 * meia-noite, classificar como "Hoje"/"Ontem" de forma um pouco
 * diferente do que seria uma comparação estrita de datas de
 * calendário. Para o propósito da aplicação (rótulo aproximado numa
 * conversa de chat), esta simplificação é aceitável.
 *
 * @param {string} iso - data em formato ISO 8601.
 * @returns {string} rótulo a mostrar.
 */
function formatDateLabel(iso) {
  const date = new Date(iso);
  const now  = new Date();
  const diff = (now - date) / (1000 * 60 * 60 * 24);
  if (diff < 1) return 'Hoje';
  if (diff < 2) return 'Ontem';
  return date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long' });
}

// Cleanup do Realtime ao sair da página — cancela a subscrição ao
// canal para não deixar conexões "pendentes" abertas depois de o
// utilizador navegar para outra página (boa prática de gestão de
// recursos, evita fugas de memória/conexões no lado do cliente).
window.addEventListener('beforeunload', () => {
  realtimeChannel?.unsubscribe();
});
