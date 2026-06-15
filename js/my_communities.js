/* ─────────────────────────────────────────────────────
   ShareBox — my_communities.js
───────────────────────────────────────────────────── */

let allCommunities = [];
let memberCounts   = {};

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  await loadMyCommunities(session.user.id);

  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      renderCommunities(this.dataset.role);
    });
  });

});

async function loadMyCommunities(userId) {
  const { data: memberships, error } = await supabaseClient
    .from('communities_members')
    .select('community_id, role')
    .eq('user_id', userId);

  if (error || !memberships?.length) {
    showEmpty();
    return;
  }

  const commIds = memberships.map(m => m.community_id);
  const roleMap = {};
  memberships.forEach(m => { roleMap[m.community_id] = m.role; });

  // Buscar dados das comunidades
  const { data: communities } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, location, is_private, created_at')
    .in('id', commIds)
    .order('created_at', { ascending: false });

  if (!communities?.length) { showEmpty(); return; }

  // Contar membros
  const { data: members } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  memberCounts = {};
  (members || []).forEach(m => {
    memberCounts[m.community_id] = (memberCounts[m.community_id] || 0) + 1;
  });

  // Contar itens por comunidade
  const { data: items } = await supabaseClient
    .from('items')
    .select('community_id')
    .in('community_id', commIds)
    .eq('status', 'disponivel');

  const itemCounts = {};
  (items || []).forEach(i => {
    itemCounts[i.community_id] = (itemCounts[i.community_id] || 0) + 1;
  });

  // Juntar tudo
  allCommunities = communities.map(c => ({
    ...c,
    role:      roleMap[c.id] || 'member',
    members:   memberCounts[c.id] || 0,
    itemCount: itemCounts[c.id]   || 0,
  }));

  renderCommunities('');
}

function renderCommunities(roleFilter) {
  const container  = document.getElementById('communities-container');
  const emptyState = document.getElementById('empty-state');

  let filtered = allCommunities;
  if (roleFilter) filtered = allCommunities.filter(c => c.role === roleFilter);

  if (!filtered.length) {
    container.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  container.innerHTML = filtered.map(comm => {
    const badgeCls   = comm.role === 'admin' ? 'admin' : 'member';
    const badgeLabel = comm.role === 'admin' ? 'Admin' : 'Membro';
    const date       = new Date(comm.created_at).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });

    return `
      <div class="comm-card-full" onclick="window.location.href='community_detail.html?id=${comm.id}'">
        ${comm.image_url
          ? `<img src="${comm.image_url}" alt="${comm.name}" class="comm-card-cover">`
          : `<div class="comm-card-cover-placeholder"></div>`}
        <div class="comm-card-body">
          <div class="comm-card-top">
            <div class="comm-card-name">${comm.name}</div>
            <span class="comm-badge ${badgeCls}">${badgeLabel}</span>
          </div>
          <div class="comm-card-meta">
            <span>📍 ${comm.location || 'Portugal'}</span>
            <span>👥 ${comm.members} membro${comm.members !== 1 ? 's' : ''}</span>
            <span>📦 ${comm.itemCount} item${comm.itemCount !== 1 ? 's' : ''}</span>
            <span>📅 ${date}</span>
          </div>
          <div class="comm-card-actions" onclick="event.stopPropagation()">
            <a class="btn-ver" href="community_detail.html?id=${comm.id}">Ver comunidade</a>
            ${comm.role !== 'admin'
              ? `<button class="btn-sair" onclick="leaveCommunity('${comm.id}', this)">Sair</button>`
              : `<button class="btn-sair" onclick="deleteCommunity('${comm.id}', this)">Eliminar</button>`}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function leaveCommunity(communityId, btn) {
  if (!confirm('Tens a certeza que queres sair desta comunidade?')) return;

  btn.disabled = true;
  btn.textContent = 'A sair...';

  const { data: { session } } = await supabaseClient.auth.getSession();
  const { error } = await supabaseClient
    .from('communities_members')
    .delete()
    .eq('community_id', communityId)
    .eq('user_id', session.user.id);

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Sair';
    alert('Erro ao sair da comunidade.');
  } else {
    allCommunities = allCommunities.filter(c => c.id !== communityId);
    const activeTab = document.querySelector('.filter-tab.active');
    renderCommunities(activeTab?.dataset.role || '');
  }
}

async function deleteCommunity(communityId, btn) {
  if (!confirm('Tens a certeza que queres eliminar esta comunidade? Esta acção é irreversível.')) return;

  btn.disabled = true;
  btn.textContent = 'A eliminar...';

  await supabaseClient.from('communities_members').delete().eq('community_id', communityId);
  const { error } = await supabaseClient.from('communities').delete().eq('id', communityId);

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Eliminar';
    alert('Erro ao eliminar comunidade.');
  } else {
    allCommunities = allCommunities.filter(c => c.id !== communityId);
    const activeTab = document.querySelector('.filter-tab.active');
    renderCommunities(activeTab?.dataset.role || '');
  }
}

function showEmpty() {
  document.getElementById('communities-container').innerHTML = '';
  document.getElementById('empty-state').style.display = 'flex';
}