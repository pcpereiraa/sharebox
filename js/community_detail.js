/* ─────────────────────────────────────────────────────
   ShareBox — community_detail.js
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async function () {

  console.log('[CommDetail] URL:', window.location.href);
  console.log('[CommDetail] Params:', window.location.search);

  const session = await requireAuth();
  console.log('[CommDetail] Session:', session?.user?.id);
  if (!session) return;

  const params = new URLSearchParams(window.location.search);
  const commId = params.get('id');
  console.log('[CommDetail] commId:', commId);
  if (!commId) { window.location.href = 'communities.html'; return; }

  await Promise.all([
    loadCommunity(commId, session.user.id),
    loadCommunityItems(commId),
    loadCommunityMembers(commId)
  ]);
});

async function loadCommunity(commId, userId) {
  const { data: comm, error } = await supabaseClient
    .from('communities')
    .select('id, name, description, image_url, location, is_private, created_at, owner_id')
    .eq('id', commId)
    .maybeSingle();

  if (error || !comm) { window.location.href = 'communities.html'; return; }

  // Buscar owner separadamente
  const { data: owner } = await supabaseClient
    .from('profiles').select('id, full_name').eq('id', comm.owner_id).maybeSingle();

  // Contar membros
  const { count: membersCount } = await supabaseClient
    .from('communities_members')
    .select('*', { count: 'exact', head: true })
    .eq('community_id', commId);

  // ── Hero
  const heroBg = document.querySelector('.hero-bg');
  if (heroBg && comm.image_url) heroBg.src = comm.image_url;

  const heroTitle = document.querySelector('.hero-title');
  if (heroTitle) heroTitle.textContent = comm.name || '—';

  const heroLoc = document.querySelector('.hero-location');
  if (heroLoc) heroLoc.textContent = comm.location || '';
  const statEls = document.querySelectorAll('.stat-value');
  if (statEls[0]) statEls[0].textContent = membersCount || 0;
  if (statEls[1]) {
    // Conta anúncios desta comunidade
    const { count } = await supabaseClient
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('community_id', commId);
    statEls[1].textContent = count || 0;
  }
  if (statEls[2]) {
    const date = new Date(comm.created_at);
    statEls[2].textContent = date.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
  }

  // ── Descrição
  const descEl = document.querySelector('.desc-box');
  if (descEl) descEl.textContent = comm.description || '—';

  // ── Localização
  const locText = document.querySelector('.location-text');
  if (locText) locText.textContent = comm.location || '—';

  // ── Admin
  if (owner) {
    const adminName = document.querySelector('.member-name');
    if (adminName) adminName.textContent = owner.full_name || '—';
    const adminAvatar = document.querySelector('.admin-box .member-avatar');
    if (adminAvatar) adminAvatar.textContent = owner.full_name?.charAt(0) || '?';
  }

  // ── Botão aderir — verifica se já é membro
  const { data: membership } = await supabaseClient
    .from('communities_members')
    .select('role')
    .eq('community_id', commId)
    .eq('user_id', userId)
    .maybeSingle();

  const joinBtn = document.querySelector('.btn-aderir');
  if (joinBtn) {
    if (membership) {
      joinBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Já és membro';
      joinBtn.style.background = 'rgba(1,110,88,0.3)';
      joinBtn.style.pointerEvents = 'none';
    } else {
      joinBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const { error } = await supabaseClient
          .from('communities_members')
          .upsert({ community_id: commId, user_id: userId, role: 'member' });
        if (!error) {
          joinBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Já és membro';
          joinBtn.style.background = 'rgba(1,110,88,0.3)';
          joinBtn.style.pointerEvents = 'none';
        }
      });
    }
  }
}

async function loadCommunityItems(commId) {
  const { data: items } = await supabaseClient
    .from('items')
    .select(`
      id, title, location,
      profiles!owner_id (full_name),
      item_images (image_url, position)
    `)
    .eq('community_id', commId)
    .eq('status', 'disponivel')
    .limit(6);

  const container = document.querySelector('.items-scroll');
  if (!container) return;

  if (!items?.length) {
    container.innerHTML = '<p style="padding:16px;color:rgba(23,42,58,0.4);font-family:\'Berlin\',sans-serif;font-size:14px">Sem itens ainda nesta comunidade.</p>';
    return;
  }

  container.innerHTML = items.map(item => {
    const img = item.item_images?.sort((a, b) => a.position - b.position)[0]?.image_url
      || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=200&h=140&fit=crop';
    const ownerName = item.profiles?.full_name || 'Utilizador';
    const initial   = ownerName.charAt(0).toUpperCase();

    return `
      <div class="item-card" onclick="window.location.href='item_detail.html?id=${item.id}'">
        <div class="item-card-img">
          <img src="${img}" alt="${item.title}">
        </div>
        <div class="item-card-info">
          <div class="item-card-name">${item.title}</div>
          <div class="item-card-meta">
            <div class="item-user">
              <div class="user-avatar-sm">${initial}</div>
              <span>por ${ownerName.split(' ')[0]}</span>
            </div>
            <div class="item-dist">
              <svg viewBox="0 0 10 13" width="8" height="10" style="width:8px;height:10px;flex-shrink:0">
                <path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S4.17 3.5 5 3.5 6.5 4.17 6.5 5 5.83 6.5 5 6.5z" fill="currentColor"/>
              </svg>
              
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadCommunityMembers(commId) {
  const { data: members } = await supabaseClient
    .from('communities_members')
    .select(`
      role, joined_at,
      profiles!user_id (id, full_name, avatar_url)
    `)
    .eq('community_id', commId)
    .order('joined_at', { ascending: true })
    .limit(4);

  const container = document.querySelector('.members-group');
  if (!container || !members?.length) return;

  const colors = ['#c8e6d4', '#d4e4f0', '#e8d5e8', '#f0e4d4'];

  const membersHTML = members.map((m, i) => {
    const profile = m.profiles;
    const name    = profile?.full_name || 'Utilizador';
    const role    = m.role === 'admin' ? 'Admin' : 'Membro';
    const date    = new Date(m.joined_at).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
    const divider = i < members.length - 1 ? '<div class="member-divider"></div>' : '';

    return `
      <div class="member-row">
        <div class="member-avatar" style="background:${colors[i % colors.length]};display:flex;align-items:center;justify-content:center;font-family:'Berlin',sans-serif;font-size:18px;color:var(--blue)">
          ${name.charAt(0).toUpperCase()}
        </div>
        <div class="member-info">
          <div class="member-name">${name}</div>
          <div class="member-sub">${role} · desde ${date}</div>
        </div>
        <span class="badge ${m.role === 'admin' ? 'admin' : 'membro'}">${role}</span>
      </div>
      ${divider}
    `;
  }).join('');

  // Preservar o link "Ver todos"
  const verTodosLink = container.querySelector('.ver-todos-link');
  container.innerHTML = membersHTML;
  if (verTodosLink) container.appendChild(verTodosLink);
}