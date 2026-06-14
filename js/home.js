/* ─────────────────────────────────────────────────────
   ShareBox — home.js
   Carrega dados reais do Supabase na página home
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async function () {

  // Verifica autenticação
  const session = await requireAuth();
  if (!session) return;

  console.log('[Home] Sessão OK, user:', session.user.id);

  try {
    await Promise.all([
      loadItems(),
      loadCommunities(),
      loadUserProfile(session.user.id)
    ]);
    console.log('[Home] Dados carregados com sucesso');
  } catch (err) {
    console.error('[Home] Erro ao carregar dados:', err);
  }

  // Delegação de eventos — funciona para cards estáticos E dinâmicos
  document.addEventListener('click', function (e) {
    // Clique em donation card
    const donationCard = e.target.closest('.donation-card');
    if (donationCard && !e.target.closest('.fav-btn')) {
      const itemId = donationCard.dataset.id;
      if (itemId) window.location.href = 'item_detail.html?id=' + itemId;
    }

    // Clique em comm card
    const commCard = e.target.closest('.comm-card');
    if (commCard && !e.target.closest('.comm-add-icon')) {
      const commId = commCard.dataset.id;
      if (commId) window.location.href = 'community_detail.html?id=' + commId;
    }
  });

});

// ── Carrega itens recomendados ────────────────────────
async function loadItems() {
  const container = document.getElementById('items-row');
  console.log('[Home] items-row container:', container);
  if (!container) return;

  const { data: items, error } = await supabaseClient
    .from('items')
    .select('id, title, location, condition, type, owner_id, created_at')
    .eq('status', 'disponivel')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) { console.error('[Home] Erro items:', error); return; }
  console.log('[Home] Items carregados:', items?.length, items);
  if (!items?.length) return;

  // Buscar imagens separadamente
  const itemIds = items.map(i => i.id);
  const { data: images } = await supabaseClient
    .from('item_images')
    .select('item_id, image_url, position')
    .in('item_id', itemIds);

  // Buscar perfis dos owners
  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];
  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, full_name')
    .in('id', ownerIds);

  // Mapear para lookup rápido
  const imgMap     = {};
  const profileMap = {};
  (images   || []).forEach(img => { if (!imgMap[img.item_id])     imgMap[img.item_id]         = img.image_url; });
  (profiles || []).forEach(p   => { profileMap[p.id] = p.full_name; });

  container.innerHTML = items.map(item => {
    const img       = imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=300&h=200&fit=crop';
    const ownerName = profileMap[item.owner_id] || 'Utilizador';
    const initial   = ownerName.charAt(0).toUpperCase();
    const location  = item.location || '';
    const dist      = location ? '1,' + Math.floor(Math.random() * 9) + ' km' : '';

    return `
      <div class="donation-card" data-id="${item.id}" style="cursor:pointer">
        <div class="donation-card-img">
          <img src="${img}" alt="${item.title}" onerror="this.src='https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=300&h=200&fit=crop'">
          <button class="fav-btn" onclick="toggleFav(event, '${item.id}', this)">
            <img src="images/Icons/favorite.png" alt="Favorito">
          </button>
        </div>
        <div class="donation-card-info">
          <div class="donation-name">${item.title}</div>
          <div class="donation-meta-row">
            <div class="donation-user">
              <div class="user-avatar">${initial}</div>
              <span class="user-name">por ${ownerName.split(' ')[0]}</span>
            </div>
            ${dist ? `<div class="donation-dist">
              <svg viewBox="0 0 10 13" width="8" height="10" style="width:8px;height:10px;flex-shrink:0">
                <path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S4.17 3.5 5 3.5 6.5 4.17 6.5 5 5.83 6.5 5 6.5z" fill="currentColor"/>
              </svg>${dist}
            </div>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Atualiza sheet de recomendações com cards sem largura fixa
  const sheetContainer = document.querySelector('#sheet-recomendacoes .sheet-grid-donations');
  if (sheetContainer) {
    sheetContainer.innerHTML = items.map(item => {
      const img       = imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=300&h=200&fit=crop';
      const ownerName = profileMap[item.owner_id] || 'Utilizador';
      const initial   = ownerName.charAt(0).toUpperCase();
      const dist      = item.location ? '1,' + Math.floor(Math.random() * 9) + ' km' : '';
      return `
        <div class="donation-card" data-id="${item.id}" style="width:100%;cursor:pointer">
          <div class="donation-card-img">
            <img src="${img}" alt="${item.title}" onerror="this.src='https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=300&h=200&fit=crop'">
            <button class="fav-btn" onclick="toggleFav(event,'${item.id}',this)">
              <img src="images/Icons/favorite.png" alt="Favorito">
            </button>
          </div>
          <div class="donation-card-info">
            <div class="donation-name">${item.title}</div>
            <div class="donation-meta-row">
              <div class="donation-user">
                <div class="user-avatar">${initial}</div>
                <span class="user-name">por ${ownerName.split(' ')[0]}</span>
              </div>
              ${dist ? `<div class="donation-dist">
                <svg viewBox="0 0 10 13" width="8" height="10" style="width:8px;height:10px;flex-shrink:0">
                  <path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S4.17 3.5 5 3.5 6.5 4.17 6.5 5 5.83 6.5 5 6.5z" fill="currentColor"/>
                </svg>${dist}
              </div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ── Carrega comunidades ───────────────────────────────
async function loadCommunities() {
  const container = document.getElementById('communities-row');
  console.log('[Home] communities-row container:', container);
  if (!container) return;

  const { data: communities, error } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, is_private, created_at')
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) { console.error('[Home] Erro communities:', error); return; }
  console.log('[Home] Communities carregadas:', communities?.length, communities);
  if (!communities?.length) return;

  // Buscar contagem de membros
  const commIds = communities.map(c => c.id);
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  container.innerHTML = communities.map(comm => {
    const img     = comm.image_url || 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=200&fit=crop';
    const members = memberMap[comm.id] || 0;

    return `
      <div class="comm-card" data-id="${comm.id}" style="cursor:pointer">
        <div class="comm-card-img">
          <img src="${img}" alt="${comm.name}" onerror="this.src='https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=200&fit=crop'">
        </div>
        <div class="comm-card-info">
          <div class="comm-card-name">${comm.name}</div>
          <div class="comm-card-meta">
            <span class="comm-people">
              <img src="images/Icons/icone2@4x-8.png" style="width:13px;height:13px;object-fit:contain">
              ${members} pessoa${members !== 1 ? 's' : ''}
            </span>
          </div>
          <img class="comm-add-icon" src="images/Icons/add_circle.png" alt="Aderir"
               onclick="joinCommunity(event, '${comm.id}', this)">
        </div>
      </div>
    `;
  }).join('');

  // Atualiza sheet de comunidades
  const sheetContainer = document.querySelector('#sheet-comunidades .sheet-list-comms');
  if (sheetContainer) {
    sheetContainer.innerHTML = communities.map(comm => {
      const img     = comm.image_url || 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=100&h=100&fit=crop';
      const members = memberMap[comm.id] || 0;
      return `
        <div class="comm-list-item" onclick="window.location.href='community_detail.html?id=${comm.id}'">
          <div class="comm-list-thumb"><img src="${img}" alt="${comm.name}"></div>
          <div class="comm-list-info">
            <div class="comm-list-name">${comm.name}</div>
            <div class="comm-list-meta"><span>👥 ${members} pessoa${members !== 1 ? 's' : ''}</span></div>
          </div>
          <img class="comm-add-icon-sm" src="images/Icons/add_circle.png" alt="Aderir">
        </div>
      `;
    }).join('');
  }
}

// ── Carrega perfil do utilizador ──────────────────────
async function loadUserProfile(userId) {
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', userId)
    .single();

  if (!profile) return;

  // Atualiza notificações / saudação se houver elemento
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = profile.full_name?.split(' ')[0] || '';
}

// ── Toggle favorito ───────────────────────────────────
async function toggleFav(event, itemId, btn) {
  event.stopPropagation();

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const userId = session.user.id;
  const isFaved = btn.classList.contains('faved');

  if (isFaved) {
    await supabaseClient.from('favorites').delete()
      .eq('user_id', userId).eq('item_id', itemId);
    btn.classList.remove('faved');
    btn.style.opacity = '1';
  } else {
    await supabaseClient.from('favorites').upsert({ user_id: userId, item_id: itemId });
    btn.classList.add('faved');
    btn.style.filter = 'none';
    btn.style.opacity = '1';
  }
}

// ── Aderir a comunidade ───────────────────────────────
async function joinCommunity(event, communityId, btn) {
  event.stopPropagation();

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { error } = await supabaseClient
    .from('communities_members')
    .upsert({ community_id: communityId, user_id: session.user.id, role: 'member' });

  if (!error) {
    btn.style.filter = 'hue-rotate(120deg)';
    btn.title = 'Já és membro!';
  }
}