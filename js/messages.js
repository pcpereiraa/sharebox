/* ─────────────────────────────────────────────────────
   ShareBox — messages.js
   Lista de conversas
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  await loadConversations(session.user.id);

  // Realtime — actualiza quando chega nova mensagem
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

async function loadConversations(userId) {
  const container = document.getElementById('conv-list');
  if (!container) return;

  // Buscar todas as mensagens do utilizador (enviadas e recebidas)
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

  // Agrupar por conversa (par de utilizadores)
  const conversationMap = {};
  messages.forEach(msg => {
    const otherId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    const key = [userId, otherId].sort().join('_');
    if (!conversationMap[key]) {
      conversationMap[key] = { otherId, lastMsg: msg, unread: 0 };
    }
    // Contar não lidas
    if (msg.receiver_id === userId && !msg.read) {
      conversationMap[key].unread++;
    }
  });

  const conversations = Object.values(conversationMap);

  // Buscar perfis dos outros utilizadores
  const otherIds = [...new Set(conversations.map(c => c.otherId))];
  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', otherIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  container.innerHTML = conversations.map((conv, i) => {
    const profile   = profileMap[conv.otherId] || {};
    const name      = profile.full_name || 'Utilizador';
    const avatarHTML = profile.avatar_url
      ? `<img src="${profile.avatar_url}" style="width:100%;height:100%;object-fit:cover">`
      : `<svg viewBox="0 0 24 24" width="60%" height="60%" fill="rgba(23,42,58,0.35)"><path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>`;
    const preview   = conv.lastMsg.content.length > 40
      ? conv.lastMsg.content.substring(0, 40) + '...'
      : conv.lastMsg.content;
    const time      = formatTime(conv.lastMsg.created_at);
    const unread    = conv.unread > 0;
    const isSent    = conv.lastMsg.sender_id === userId;
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
          <div class="conv-preview">${isSent ? 'Tu: ' : ''}${preview}</div>
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