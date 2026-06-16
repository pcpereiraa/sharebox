/* ─────────────────────────────────────────────────────
   ShareBox — community_detail.js
───────────────────────────────────────────────────── */

let _commId  = null;
let _userId  = null;
let _ownerId = null;

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;
  _userId = session.user.id;

  const params = new URLSearchParams(window.location.search);
  _commId = params.get('id');
  if (!_commId) { window.location.href = 'communities.html'; return; }

  await Promise.all([
    loadCommunity(),
    loadItems(),
    loadMembers(),
  ]);

  await setupJoinButton();
});

// ── Carrega comunidade ────────────────────────────────
async function loadCommunity() {
  const { data: comm, error } = await supabaseClient
    .from('communities')
    .select('id, name, description, image_url, location, is_private, created_at, owner_id')
    .eq('id', _commId)
    .maybeSingle();

  if (error || !comm) { window.location.href = 'communities.html'; return; }
  _ownerId = comm.owner_id;

  // Hero
  const heroBg = document.getElementById('hero-bg');
  if (heroBg && comm.image_url) heroBg.src = comm.image_url;

  document.getElementById('hero-title').textContent    = comm.name || '—';
  document.getElementById('hero-location').textContent = comm.location || '';
  document.getElementById('location-text').textContent = comm.location || '—';
  document.getElementById('desc-box').textContent      = comm.description || 'Sem descrição disponível.';

  // Data criação
  const date = new Date(comm.created_at).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
  document.getElementById('stat-date').textContent = date;

  // Admin
  const { data: owner } = await supabaseClient
    .from('profiles').select('full_name, avatar_url').eq('id', comm.owner_id).maybeSingle();

  const adminName   = document.getElementById('admin-name');
  const adminAvatar = document.getElementById('admin-avatar');
  if (adminName)   adminName.textContent = owner?.full_name || '—';
  if (adminAvatar) {
    if (owner?.avatar_url) {
      adminAvatar.innerHTML = `<img src="${owner.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      adminAvatar.textContent = (owner?.full_name || 'A').charAt(0).toUpperCase();
    }
  }
}

// ── Carrega itens da comunidade ───────────────────────
async function loadItems() {
  const container = document.getElementById('items-scroll');
  if (!container) return;

  const { data: items } = await supabaseClient
    .from('items')
    .select('id, title, location, owner_id')
    .eq('community_id', _commId)
    .eq('status', 'disponivel')
    .order('created_at', { ascending: false })
    .limit(10);

  // Atualizar stat de anúncios
  const { count } = await supabaseClient
    .from('items').select('*', { count: 'exact', head: true })
    .eq('community_id', _commId);
  const statItems = document.getElementById('stat-items');
  if (statItems) statItems.textContent = count || 0;

  if (!items?.length) {
    container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.4);padding:8px 0">Sem itens nesta comunidade.</p>';
    return;
  }

  // Buscar imagens e donos
  const ids = items.map(i => i.id);
  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];

  const [{ data: images }, { data: profiles }] = await Promise.all([
    supabaseClient.from('item_images').select('item_id, image_url').in('item_id', ids),
    supabaseClient.from('profiles').select('id, full_name').in('id', ownerIds)
  ]);

  const imgMap = {};
  (images || []).forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.image_url; });
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p.full_name; });

  container.innerHTML = items.map(item => {
    const img  = imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=200&h=140&fit=crop';
    const name = profileMap[item.owner_id] || 'Utilizador';
    return `
      <div class="item-card" onclick="window.location.href='item_detail.html?id=${item.id}'" style="cursor:pointer">
        <div class="item-card-img">
          <img src="${img}" alt="${item.title}" onerror="this.src='https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=200&h=140&fit=crop'">
        </div>
        <div class="item-card-info">
          <div class="item-card-name">${item.title}</div>
          <div class="item-card-meta">
            <div class="item-user">
              <div class="user-avatar-sm">${name.charAt(0).toUpperCase()}</div>
              <span>por ${name.split(' ')[0]}</span>
            </div>
            <div class="item-dist">${item.location?.split(',')[0] || ''}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Carrega membros ───────────────────────────────────
async function loadMembers() {
  const container = document.getElementById('members-group');
  const title     = document.getElementById('members-title');
  const statEl    = document.getElementById('stat-members');
  if (!container) return;

  const { data: memberships } = await supabaseClient
    .from('communities_members')
    .select('user_id, role, joined_at')
    .eq('community_id', _commId)
    .order('joined_at', { ascending: true })
    .limit(20);

  const count = memberships?.length || 0;
  if (statEl)  statEl.textContent = count;
  if (title)   title.textContent  = `Participantes · ${count}`;

  if (!memberships?.length) return;

  const userIds = memberships.map(m => m.user_id);
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, full_name, avatar_url').in('id', userIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  const colors = ['#c8e6d4','#d4e4f0','#e8d5e8','#f0e4d4','#d4f0e4'];

  const shown   = memberships.slice(0, 5);
  const hiddenN = count > 5 ? count - 5 : 0;

  container.innerHTML = shown.map((m, i) => {
    const p    = profileMap[m.user_id] || {};
    const name = p.full_name || 'Utilizador';
    const date = m.joined_at
      ? new Date(m.joined_at).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' })
      : '—';
    const isAdmin = m.role === 'admin';

    return `
      <div class="member-row">
        <div class="member-avatar" style="background:${colors[i % colors.length]};display:flex;align-items:center;justify-content:center;font-family:'Berlin',sans-serif;font-size:18px;color:var(--blue);overflow:hidden">
          ${p.avatar_url
            ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover">`
            : name.charAt(0).toUpperCase()}
        </div>
        <div class="member-info">
          <div class="member-name">${name}</div>
          <div class="member-sub">${isAdmin ? 'Admin' : 'Membro'} · desde ${date}</div>
        </div>
        <span class="badge ${isAdmin ? 'admin' : 'membro'}">${isAdmin ? 'Admin' : 'Membro'}</span>
      </div>
      ${i < shown.length - 1 ? '<div class="member-divider"></div>' : ''}
    `;
  }).join('');

  if (hiddenN > 0) {
    container.innerHTML += `<a class="ver-todos-link" href="#" onclick="openMembersSheet();return false;">Ver todos os ${count} participantes →</a>`;
  }
}

// ── Botão aderir / sair ───────────────────────────────
async function setupJoinButton() {
  const btn = document.querySelector('.btn-aderir');
  if (!btn) return;

  const { data: membership } = await supabaseClient
    .from('communities_members')
    .select('role')
    .eq('community_id', _commId)
    .eq('user_id', _userId)
    .maybeSingle();

  const isOwner  = _userId === _ownerId;
  const isMember = !!membership;

  if (isOwner) {
    btn.textContent = '✏️ Editar comunidade';
    btn.onclick = () => window.location.href = `add_community.html?edit=${_commId}`;
  } else if (isMember) {
    btn.textContent = 'Sair da comunidade';
    btn.style.background = 'rgba(192,57,43,0.15)';
    btn.style.color      = '#c0392b';
    btn.onclick = leaveCommunity;
  } else {
    btn.textContent = '+ Aderir à comunidade';
    btn.onclick = joinCommunity;
  }
}

async function joinCommunity() {
  const btn = document.querySelector('.btn-aderir');
  if (btn) { btn.disabled = true; btn.textContent = 'A aderir...'; }

  const { error } = await supabaseClient
    .from('communities_members')
    .upsert({ community_id: _commId, user_id: _userId, role: 'member' });

  if (!error) {
    btn.textContent   = 'Sair da comunidade';
    btn.style.background = 'rgba(192,57,43,0.15)';
    btn.style.color   = '#c0392b';
    btn.disabled      = false;
    btn.onclick       = leaveCommunity;
    showToast('✓ Entraste na comunidade!');
    loadMembers();
  }
}

async function leaveCommunity() {
  if (!confirm('Tens a certeza que queres sair desta comunidade?')) return;
  const btn = document.querySelector('.btn-aderir');
  if (btn) { btn.disabled = true; btn.textContent = 'A sair...'; }

  await supabaseClient.from('communities_members')
    .delete().eq('community_id', _commId).eq('user_id', _userId);

  window.location.href = 'communities.html';
}

// ── Toast ─────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--dark-green);color:#fff;font-family:"Berlin",sans-serif;font-size:14px;padding:12px 24px;border-radius:50px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);white-space:nowrap';
  document.body.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

// ── Sheet de membros ──────────────────────────────────
async function openMembersSheet() {
  document.getElementById('sheet-overlay').classList.add('active');
  document.getElementById('sheet-members').classList.add('active');
  document.body.style.overflow = 'hidden';

  const list  = document.getElementById('sheet-members-list');
  const title = document.getElementById('sheet-members-title');
  list.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45);text-align:center;padding:20px 0">A carregar...</p>';

  const { data: memberships } = await supabaseClient
    .from('communities_members')
    .select('user_id, role, joined_at')
    .eq('community_id', _commId)
    .order('joined_at', { ascending: true });

  if (title) title.textContent = `Participantes · ${memberships?.length || 0}`;

  if (!memberships?.length) {
    list.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45);text-align:center;padding:20px 0">Sem membros.</p>';
    return;
  }

  const userIds = memberships.map(m => m.user_id);
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, full_name, avatar_url, location').in('id', userIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  const colors = ['#c8e6d4','#d4e4f0','#e8d5e8','#f0e4d4','#d4f0e4','#f0d4d4'];

  list.innerHTML = memberships.map((m, i) => {
    const p    = profileMap[m.user_id] || {};
    const name = p.full_name || 'Utilizador';
    const date = m.joined_at
      ? new Date(m.joined_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
    const isAdmin = m.role === 'admin';

    return `
      <div class="sheet-member-row">
        <div class="sheet-member-avatar" style="background:${colors[i % colors.length]}">
          ${p.avatar_url
            ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover">`
            : name.charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div class="sheet-member-name">${name}</div>
          <div class="sheet-member-sub">${isAdmin ? '⭐ Admin' : 'Membro'} · desde ${date}</div>
        </div>
        ${isAdmin ? '<span class="badge admin" style="flex-shrink:0">Admin</span>' : ''}
      </div>`;
  }).join('');
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('active');
  document.getElementById('sheet-members').classList.remove('active');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });