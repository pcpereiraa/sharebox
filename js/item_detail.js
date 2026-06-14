/* ─────────────────────────────────────────────────────
   ShareBox — item_detail.js
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  const params = new URLSearchParams(window.location.search);
  const itemId = params.get('id');
  if (!itemId) { window.location.href = 'home.html'; return; }

  await loadItem(itemId, session.user.id);
  await loadMoreItems(itemId);
});

async function loadItem(itemId, userId) {
  // Query simples sem joins
  const { data: item, error } = await supabaseClient
    .from('items')
    .select('id, title, description, condition, type, status, location, owner_id, category_id, community_id, created_at')
    .eq('id', itemId)
    .single();

  if (error || !item) { console.error('[ItemDetail] Erro:', error); return; }

  // Buscar imagens
  const { data: images } = await supabaseClient
    .from('item_images')
    .select('image_url, position')
    .eq('item_id', itemId)
    .order('position');

  // Buscar dono
  const { data: owner } = await supabaseClient
    .from('profiles')
    .select('id, full_name, avatar_url')
    .eq('id', item.owner_id)
    .single();

  // Buscar categoria
  const { data: category } = item.category_id ? await supabaseClient
    .from('categories')
    .select('name')
    .eq('id', item.category_id)
    .single() : { data: null };

  // Buscar comunidade — ignorar erros silenciosamente
  let community = null;
  if (item.community_id) {
    try {
      const { data: comm } = await supabaseClient
        .from('communities')
        .select('id, name, location')
        .eq('id', item.community_id)
        .maybeSingle();
      community = comm;
    } catch (e) { /* silencioso */ }
  }

  const mainImg = images?.[0]?.image_url
    || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&h=500&fit=crop';

  // ── Galeria principal
  const mainImgEl = document.getElementById('gallery-main-img');
  if (mainImgEl) mainImgEl.src = mainImg;

  // ── Thumbnails
  const thumbsEl = document.querySelector('.gallery-thumbs');
  if (thumbsEl && images?.length) {
    thumbsEl.innerHTML = images.map((img, i) => `
      <div class="gallery-thumb ${i === 0 ? 'active' : ''}" onclick="switchImg(this, '${img.image_url}')">
        <img src="${img.image_url}" alt="">
      </div>
    `).join('');
  }

  // ── Título
  const titleEl = document.querySelector('.item-title');
  if (titleEl) titleEl.textContent = item.title || '—';

  // ── Tags
  const tagsEl = document.querySelector('.item-tags');
  if (tagsEl) {
    tagsEl.innerHTML = `
      <span class="tag green">● ${item.condition || 'Bom'}</span>
      <span class="tag green">● ${item.type === 'doacao' ? 'Doação' : 'Troca'}</span>
    `;
  }

  // ── Localização header
  const locEl = document.querySelector('.item-location span');
  if (locEl) locEl.textContent = item.location || '—';

  // ── Descrição
  const descEl = document.querySelector('.desc-box');
  if (descEl) descEl.textContent = item.description || 'Sem descrição disponível.';

  // ── Detalhes
  const detailRows = document.querySelectorAll('.detail-row');
  if (detailRows[0]) detailRows[0].querySelector('.detail-value').textContent = category?.name || '—';
  if (detailRows[1]) detailRows[1].querySelector('.detail-value').textContent = item.condition || '—';
  if (detailRows[2]) detailRows[2].querySelector('.detail-value').textContent = 'À mão — encontro pessoal';

  // ── Localização box
  const locTextEl = document.querySelector('.location-text');
  if (locTextEl) locTextEl.textContent = item.location || '—';

  // ── Anunciante
  if (owner) {
    const nameEl = document.querySelector('.advertiser-name');
    if (nameEl) nameEl.textContent = owner.full_name || '—';

    const avatarEl = document.querySelector('.advertiser-avatar');
    if (avatarEl) {
      avatarEl.textContent = owner.full_name?.charAt(0).toUpperCase() || '?';
      avatarEl.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;font-family:sans-serif;';
    }

    const perfilBtn = document.querySelector('.btn-ver-perfil');
    if (perfilBtn) perfilBtn.href = `profile.html?id=${owner.id}`;
  }

  // ── Comunidade
  const commBox = document.querySelector('.community-box');
  if (commBox) {
    if (community) {
      const commName = commBox.querySelector('.community-name');
      const commMeta = commBox.querySelector('.community-meta');
      if (commName) commName.textContent = community.name;
      if (commMeta) commMeta.textContent = '';
      commBox.style.cursor = 'pointer';
      commBox.onclick = () => window.location.href = `community_detail.html?id=${community.id}`;
    } else {
      commBox.closest('div')?.previousElementSibling?.remove();
      commBox.closest('div')?.remove();
    }
  }

  // ── Botão contactar
  const contactBtn = document.querySelector('.btn-contactar');
  if (contactBtn && owner) {
    contactBtn.href = `messages.html?owner=${owner.id}&item=${itemId}`;
  }

  // ── Favorito
  const { data: fav } = await supabaseClient
    .from('favorites')
    .select('item_id')
    .eq('user_id', userId)
    .eq('item_id', itemId)
    .maybeSingle();

  if (fav) {
    document.querySelectorAll('#fav-toggle, #bottom-fav').forEach(btn => btn.classList.add('active'));
  }
}

async function loadMoreItems(currentItemId) {
  const { data: items } = await supabaseClient
    .from('items')
    .select('id, title, location, owner_id')
    .eq('status', 'disponivel')
    .neq('id', currentItemId)
    .limit(6);

  if (!items?.length) return;

  // Buscar imagens
  const ids = items.map(i => i.id);
  const { data: images } = await supabaseClient
    .from('item_images').select('item_id, image_url').in('item_id', ids);

  const imgMap = {};
  (images || []).forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.image_url; });

  // Buscar donos
  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, full_name').in('id', ownerIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p.full_name; });

  const container = document.querySelector('.more-items-scroll');
  if (!container) return;

  container.innerHTML = items.map(item => {
    const img       = imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=200&h=140&fit=crop';
    const ownerName = profileMap[item.owner_id] || 'Utilizador';
    const initial   = ownerName.charAt(0).toUpperCase();
    return `
      <div class="item-card" onclick="window.location.href='item_detail.html?id=${item.id}'">
        <div class="item-card-img"><img src="${img}" alt="${item.title}"></div>
        <div class="item-card-info">
          <div class="item-card-name">${item.title}</div>
          <div class="item-card-meta">
            <div class="item-user"><div class="user-avatar-sm">${initial}</div><span>por ${ownerName.split(' ')[0]}</span></div>
            <div class="item-dist">${item.location?.split(',')[0] || ''}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}