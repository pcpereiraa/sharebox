/* ─────────────────────────────────────────────────────
   ShareBox — chat.js
   Chat em tempo real com Supabase Realtime
───────────────────────────────────────────────────── */

let currentUserId  = null;
let otherUserId    = null;
let itemId         = null;
let realtimeChannel = null;

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

  // Marcar mensagens como lidas
  markAsRead();

  // Realtime — receber mensagens novas
  realtimeChannel = supabaseClient
    .channel(`chat-${[currentUserId, otherUserId].sort().join('_')}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages'
    }, payload => {
      const msg = payload.new;
      const isRelevant =
        (msg.sender_id === currentUserId && msg.receiver_id === otherUserId) ||
        (msg.sender_id === otherUserId   && msg.receiver_id === currentUserId);
      // Só adicionar via Realtime se for mensagem do outro — as nossas já aparecem ao enviar
      if (isRelevant && msg.sender_id !== currentUserId) appendMessage(msg);
    })
    .subscribe();

  // Botão enviar
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);
  document.getElementById('msg-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
});

// ── Info do outro utilizador ──────────────────────────
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

// ── Referência do item ────────────────────────────────
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

  // Buscar imagem
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

// ── Carregar mensagens ────────────────────────────────
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

  // Agrupar por dia
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
    appendMessage(msg, false);
  });

  scrollToBottom();
}

// ── Render de mensagem ────────────────────────────────
function appendMessage(msg, scroll = true) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  // Remover placeholder se existir
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

// ── Enviar mensagem ───────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text  = input?.value.trim();
  if (!text) return;

  input.value = '';
  input.focus();

  // Mostrar imediatamente sem esperar pelo Realtime
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
    input.value = text;
    // Remover mensagem temporária
    const tempEl = document.querySelector(`[data-temp-id="${tempMsg.id}"]`);
    if (tempEl) tempEl.remove();
    return;
  }

  // Disparar notificação push para o destinatário (não bloqueia o envio se falhar)
  notifyNewMessage(text).catch(err => console.warn('[Push] Não foi possível notificar:', err));
}

// ── Notificação push de nova mensagem ─────────────────
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

// ── Marcar como lidas ─────────────────────────────────
async function markAsRead() {
  await supabaseClient
    .from('messages')
    .update({ read: true })
    .eq('receiver_id', currentUserId)
    .eq('sender_id', otherUserId)
    .eq('read', false);
}

// ── Helpers ───────────────────────────────────────────
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateLabel(iso) {
  const date = new Date(iso);
  const now  = new Date();
  const diff = (now - date) / (1000 * 60 * 60 * 24);
  if (diff < 1) return 'Hoje';
  if (diff < 2) return 'Ontem';
  return date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long' });
}

// Cleanup realtime ao sair
window.addEventListener('beforeunload', () => {
  realtimeChannel?.unsubscribe();
});