/* ─────────────────────────────────────────────────────
   ShareBox — home.js
───────────────────────────────────────────────────── */

let _allItems   = [];
let _imgMap     = {};
let _profileMap = {};
let _activecat  = null;

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  await Promise.all([
    loadItems(),
    loadCommunities(),
    loadUserProfile(session.user.id)
  ]);

  // ── Clique em categoria
  document.addEventListener('click', function (e) {
    const catCard = e.target.closest('.cat-card');
    if (catCard) {
      const catId   = catCard.dataset.id   || null;
      const catName = catCard.dataset.name || null;

      // Toggle — clicar na mesma categoria remove o filtro
      if (_activecat === catId) {
        _activecat = null;
        document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
        renderItems(_allItems, 'Recomendações para ti');
      } else {
        _activecat = catId;
        document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
        catCard.classList.add('active');
        const filtered = catId
          ? _allItems.filter(i => i.category_id === catId)
          : _allItems;
        renderItems(filtered, catName || 'Recomendações para ti');
      }
      return;
    }

    // ── Clique em donation-card
    const donationCard = e.target.closest('.donation-card');
    if (donationCard && !e.target.closest('.fav-btn')) {
      const itemId = donationCard.dataset.id;
      if (itemId) window.location.href = 'item_detail.html?id=' + itemId;
    }

    // ── Clique em comm-card
    const commCard = e.target.closest('.comm-card');
    if (commCard && !e.target.closest('.comm-add-icon')) {
      const commId = commCard.dataset.id;
      if (commId) window.location.href = 'community_detail.html?id=' + commId;
    }
  });

});

// ── Carrega itens ─────────────────────────────────────
async function loadItems() {
  const container = document.getElementById('items-row');
  if (!container) return;

  const { data: items, error } = await supabaseClient
    .from('items')
    .select('id, title, location, condition, type, owner_id, category_id, created_at')
    .eq('status', 'disponivel')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) { console.error('[Home] Erro items:', error); return; }
  if (!items?.length) return;

  // Guardar globalmente
  _allItems = items;

  // Buscar imagens
  const itemIds = items.map(i => i.id);
  const { data: images } = await supabaseClient
    .from('item_images')
    .select('item_id, image_url, position')
    .in('item_id', itemIds);

  // Buscar perfis
  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];
  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, full_name')
    .in('id', ownerIds);

  (images   || []).forEach(img => { if (!_imgMap[img.item_id]) _imgMap[img.item_id] = img.image_url; });
  (profiles || []).forEach(p   => { _profileMap[p.id] = p.full_name; });

  renderItems(_allItems, 'Recomendações para ti');

  // Sheet recomendações
  updateSheetItems(_allItems);
}

// ── Render de items ───────────────────────────────────
function renderItems(items, title) {
  const container = document.getElementById('items-row');
  if (!container) return;

  // Actualizar só o título das recomendações (não o de Categorias)
  const sectionEl = document.getElementById('recomendacoes-title');
  if (sectionEl && title) sectionEl.textContent = title;

  if (!items.length) {
    container.innerHTML = '<p style="padding:16px;font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45)">Sem itens nesta categoria.</p>';
    return;
  }

  container.innerHTML = items.map(item => {
    const img       = _imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=300&h=200&fit=crop';
    const ownerName = _profileMap[item.owner_id] || 'Utilizador';
    const initial   = ownerName.charAt(0).toUpperCase();
    const dist      = item.location ? '1,' + Math.floor(Math.random() * 9) + ' km' : '';

    return `
      <div class="donation-card" data-id="${item.id}" style="cursor:pointer">
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
      </div>`;
  }).join('');
}

// ── Actualiza sheet ───────────────────────────────────
function updateSheetItems(items) {
  const sheetContainer = document.querySelector('#sheet-recomendacoes .sheet-grid-donations');
  if (!sheetContainer) return;

  sheetContainer.innerHTML = items.map(item => {
    const img       = _imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=300&h=200&fit=crop';
    const ownerName = _profileMap[item.owner_id] || 'Utilizador';
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
            <div class="donation-user"><div class="user-avatar">${initial}</div><span class="user-name">por ${ownerName.split(' ')[0]}</span></div>
            ${dist ? `<div class="donation-dist"><svg viewBox="0 0 10 13" width="8" height="10" style="width:8px;height:10px;flex-shrink:0"><path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S4.17 3.5 5 3.5 6.5 4.17 6.5 5 5.83 6.5 5 6.5z" fill="currentColor"/></svg>${dist}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Carrega comunidades ───────────────────────────────
async function loadCommunities() {
  const container = document.getElementById('communities-row');
  if (!container) return;

  const { data: communities, error } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, is_private, created_at')
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error || !communities?.length) return;

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
               onclick="joinCommunity(event,'${comm.id}',this)">
        </div>
      </div>`;
  }).join('');

  // Sheet comunidades
  const sheetContainer = document.querySelector('#sheet-comunidades .sheet-list-comms');
  if (sheetContainer) {
    sheetContainer.innerHTML = communities.map(comm => {
      const img     = comm.image_url || 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=100&h=100&fit=crop';
      const members = memberMap[comm.id] || 0;
      return `
        <div class="comm-list-item" data-id="${comm.id}">
          <div class="comm-list-thumb"><img src="${img}" alt="${comm.name}"></div>
          <div class="comm-list-info">
            <div class="comm-list-name">${comm.name}</div>
            <div class="comm-list-meta"><span>👥 ${members} pessoa${members !== 1 ? 's' : ''}</span></div>
          </div>
          <img class="comm-add-icon-sm" src="images/Icons/add_circle.png" alt="Aderir">
        </div>`;
    }).join('');
  }
}

// ── Perfil do utilizador ──────────────────────────────
async function loadUserProfile(userId) {
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', userId)
    .single();

  if (!profile) return;
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
    await supabaseClient.from('favorites').delete().eq('user_id', userId).eq('item_id', itemId);
    btn.classList.remove('faved');
  } else {
    await supabaseClient.from('favorites').upsert({ user_id: userId, item_id: itemId });
    btn.classList.add('faved');
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
    btn.style.opacity = '0.3';
    btn.style.pointerEvents = 'none';
  }
}