/* ─────────────────────────────────────────────────────
   ShareBox — view_profile.js
   Perfil público de outro utilizador (read-only)
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async function () {
  const session = await requireAuth();
  if (!session) return;

  const params = new URLSearchParams(window.location.search);
  const profileId = params.get('id');

  if (!profileId) {
    window.location.href = 'home.html';
    return;
  }

  // Se for o próprio utilizador, redirecciona para o perfil privado
  if (profileId === session.user.id) {
    window.location.href = 'profile.html';
    return;
  }

  await loadProfile(profileId, session.user.id);
});

async function loadProfile(profileId, currentUserId) {
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('id, full_name, avatar_url, location, bio')
    .eq('id', profileId)
    .maybeSingle();

  if (error || !profile) {
    document.getElementById('profile-name').textContent = 'Utilizador não encontrado';
    return;
  }

  // ── Hero
  document.getElementById('profile-name').textContent = profile.full_name || 'Utilizador';
  document.getElementById('profile-location').textContent = profile.location || 'Portugal';

  const avatarImg = document.getElementById('profile-avatar-img');
  if (profile.avatar_url) {
    avatarImg.src = profile.avatar_url;
  }

  if (profile.bio) {
    document.getElementById('bio-section').style.display = 'block';
    document.getElementById('profile-bio').textContent = profile.bio;
  }

  // ── Botão contactar → vai para o chat
  const contactBtn = document.getElementById('btn-contact');
  if (contactBtn) {
    contactBtn.href = `chat.html?with=${profile.id}`;
  }

  // ── Itens publicados
  const { data: items } = await supabaseClient
    .from('items')
    .select('id, title, status, location')
    .eq('owner_id', profileId)
    .order('created_at', { ascending: false });

  const itemsList  = document.getElementById('items-list');
  const itemsEmpty = document.getElementById('items-empty');

  document.getElementById('stat-items').textContent = items?.length || 0;
  document.getElementById('stat-donations').textContent = items?.filter(i => i.status === 'doado').length || 0;

  if (!items?.length) {
    itemsEmpty.style.display = 'block';
  } else {
    const ids = items.map(i => i.id);
    const { data: images } = await supabaseClient
      .from('item_images').select('item_id, image_url').in('item_id', ids);
    const imgMap = {};
    (images || []).forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.image_url; });

    itemsList.innerHTML = items.map(item => {
      const img = imgMap[item.id] || 'images/Icons/add_circle.png';
      const statusCls   = item.status === 'doado' ? 'donated' : 'available';
      const statusLabel = item.status === 'doado' ? 'Doado' : 'Disponível';
      return `
        <div class="vp-item-card" onclick="window.location.href='item_detail.html?id=${item.id}'">
          <img class="vp-item-img" src="${img}" alt="${item.title}" onerror="this.src='images/Icons/add_circle.png'">
          <div class="vp-item-info">
            <div class="vp-item-title">${item.title}</div>
            <div class="vp-item-meta">📍 ${item.location?.split(',')[0] || 'Portugal'}</div>
          </div>
          <span class="vp-item-status ${statusCls}">${statusLabel}</span>
        </div>`;
    }).join('');
  }

  // ── Comunidades
  const { data: memberships } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .eq('user_id', profileId);

  const commsList  = document.getElementById('comms-list');
  const commsEmpty = document.getElementById('comms-empty');

  document.getElementById('stat-communities').textContent = memberships?.length || 0;

  if (!memberships?.length) {
    commsEmpty.style.display = 'block';
  } else {
    const commIds = memberships.map(m => m.community_id);
    const { data: communities } = await supabaseClient
      .from('communities')
      .select('id, name, image_url, location')
      .in('id', commIds);

    if (communities?.length) {
      // Contar membros de cada comunidade
      const { data: allMembers } = await supabaseClient
        .from('communities_members').select('community_id').in('community_id', commIds);
      const memberCount = {};
      (allMembers || []).forEach(m => { memberCount[m.community_id] = (memberCount[m.community_id] || 0) + 1; });

      commsList.innerHTML = communities.map(comm => `
        <div class="vp-comm-card" onclick="window.location.href='community_detail.html?id=${comm.id}'">
          ${comm.image_url
            ? `<img class="vp-comm-img" src="${comm.image_url}" alt="${comm.name}">`
            : `<div class="vp-comm-img"></div>`}
          <div style="flex:1">
            <div class="vp-comm-name">${comm.name}</div>
            <div class="vp-comm-meta">📍 ${comm.location || 'Portugal'} · ${memberCount[comm.id] || 0} membros</div>
          </div>
        </div>`).join('');
    } else {
      commsEmpty.style.display = 'block';
    }
  }
}