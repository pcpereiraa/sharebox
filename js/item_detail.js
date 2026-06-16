/* ─────────────────────────────────────────────────────
   ShareBox — item_detail.js
───────────────────────────────────────────────────── */

let _itemId    = null;
let _ownerId   = null;
let _userId    = null;
let _itemTitle = null;

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  _userId = session.user.id;

  const params = new URLSearchParams(window.location.search);
  _itemId = params.get('id');
  if (!_itemId) { window.location.href = 'home.html'; return; }

  await loadItem(_itemId);
  await loadMoreItems(_itemId);
});

// ── Carrega item ──────────────────────────────────────
async function loadItem(itemId) {
  const { data: item, error } = await supabaseClient
    .from('items')
    .select('id, title, description, condition, type, status, location, owner_id, category_id, community_id, created_at')
    .eq('id', itemId)
    .single();

  if (error || !item) { console.error('[ItemDetail]', error); return; }

  _ownerId   = item.owner_id;
  _itemTitle = item.title;
  const isOwner = _userId === _ownerId;

  // Buscar imagens
  const { data: images } = await supabaseClient
    .from('item_images').select('image_url, position').eq('item_id', itemId).order('position');

  // Buscar dono
  const { data: owner } = await supabaseClient
    .from('profiles').select('id, full_name, avatar_url').eq('id', item.owner_id).single();

  // Buscar categoria
  const { data: category } = item.category_id ? await supabaseClient
    .from('categories').select('name').eq('id', item.category_id).single() : { data: null };

  // Buscar comunidade
  let community = null;
  if (item.community_id) {
    try {
      const { data: comm } = await supabaseClient
        .from('communities').select('id, name').eq('id', item.community_id).maybeSingle();
      community = comm;
    } catch {}
  }

  const mainImg = images?.[0]?.image_url || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&h=500&fit=crop';

  // ── Galeria
  const mainImgEl = document.getElementById('gallery-main-img');
  if (mainImgEl) mainImgEl.src = mainImg;

  const thumbsEl = document.querySelector('.gallery-thumbs');
  if (thumbsEl && images?.length) {
    thumbsEl.innerHTML = images.map((img, i) => `
      <div class="gallery-thumb ${i === 0 ? 'active' : ''}" onclick="switchImg(this, '${img.image_url}')">
        <img src="${img.image_url}" alt="">
      </div>`).join('');
  }

  // ── Info
  const titleEl = document.querySelector('.item-title');
  if (titleEl) titleEl.textContent = item.title || '—';

  const tagsEl = document.querySelector('.item-tags');
  if (tagsEl) {
    const statusBadge = item.status === 'doado'
      ? '<span class="tag grey">● Doado</span>'
      : '<span class="tag green">● Disponível</span>';
    tagsEl.innerHTML = `
      ${statusBadge}
      <span class="tag green">● ${item.condition || 'Bom'}</span>
      <span class="tag green">● ${item.type === 'doacao' ? 'Doação' : 'Troca'}</span>`;
  }

  const locEl = document.querySelector('.item-location span');
  if (locEl) locEl.textContent = item.location || '—';

  const descEl = document.querySelector('.desc-box');
  if (descEl) descEl.textContent = item.description || 'Sem descrição disponível.';

  // ── Detalhes
  const detailRows = document.querySelectorAll('.detail-row');
  if (detailRows[0]) detailRows[0].querySelector('.detail-value').textContent = category?.name || '—';
  if (detailRows[1]) detailRows[1].querySelector('.detail-value').textContent = item.condition || '—';
  if (detailRows[2]) detailRows[2].querySelector('.detail-value').textContent = 'À mão — encontro pessoal';

  const locTextEl = document.querySelector('.location-text');
  if (locTextEl) locTextEl.textContent = item.location || '—';

  // ── Anunciante
  if (owner) {
    const nameEl = document.querySelector('.advertiser-name');
    if (nameEl) nameEl.textContent = owner.full_name || '—';

    const avatarEl = document.querySelector('.advertiser-avatar');
    if (avatarEl) {
      if (owner.avatar_url) {
        avatarEl.innerHTML = `<img src="${owner.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      } else {
        avatarEl.textContent = (owner.full_name || 'U').charAt(0).toUpperCase();
        avatarEl.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff;font-family:"Berlin",sans-serif;';
      }
    }

    const perfilBtn = document.querySelector('.btn-ver-perfil');
    if (perfilBtn) perfilBtn.href = `profile.html?id=${owner.id}`;
  }

  // ── Comunidade
  const commBox = document.querySelector('.community-box');
  if (commBox) {
    if (community) {
      const commName = commBox.querySelector('.community-name');
      if (commName) commName.textContent = community.name;
      commBox.style.cursor = 'pointer';
      commBox.onclick = () => window.location.href = `community_detail.html?id=${community.id}`;
    } else {
      const commSection = commBox.closest('section, .section-block, div[class*="section"]');
      if (commSection) commSection.style.display = 'none';
      else commBox.style.display = 'none';
    }
  }

  // ── Bottom bar — diferente para dono vs visitante
  renderBottomBar(isOwner, item.status, owner);

  // ── Favorito (só para visitantes)
  if (!isOwner) {
    const { data: fav } = await supabaseClient
      .from('favorites').select('item_id')
      .eq('user_id', _userId).eq('item_id', itemId).maybeSingle();

    if (fav) {
      document.querySelectorAll('#fav-toggle, #bottom-fav').forEach(btn => btn.classList.add('active'));
      updateFavIcon(true);
    }
  }
}

// ── Bottom bar dinâmica ───────────────────────────────
function renderBottomBar(isOwner, status, owner) {
  const bar = document.getElementById('bottom-bar');
  if (!bar) return;

  if (isOwner) {
    // Dono — botões de gestão do item
    if (status === 'doado') {
      bar.innerHTML = `
        <div style="flex:1;text-align:center;font-family:'Berlin',sans-serif;font-size:15px;color:rgba(255,255,255,0.6)">
          ✓ Este item foi doado
        </div>
        <button class="btn-contactar" style="background:rgba(255,255,255,0.15)" onclick="reactivateItem()">
          Reativar
        </button>`;
    } else {
      bar.innerHTML = `
        <button class="btn-contactar" style="background:rgba(255,255,255,0.15);flex:0 0 auto;padding:0 20px" onclick="editItem()">
          ✏️ Editar
        </button>
        <button class="btn-contactar btn-donate" onclick="markAsDonated()">
          ✓ Marcar como doado
        </button>`;
    }
  } else {
    // Visitante — favorito + contactar
    bar.innerHTML = `
      <button class="bottom-fav" id="bottom-fav" onclick="toggleFav(this)">
        <img src="images/Icons/favorite.png" alt="Favorito">
      </button>
      <a class="btn-contactar ${status === 'doado' ? 'btn-disabled' : ''}"
         id="btn-contactar"
         href="${status !== 'doado' ? `chat.html?with=${_ownerId}&item=${_itemId}` : '#'}">
        ${status === 'doado' ? 'Item já doado' : 'Contactar anunciante'}
      </a>`;
  }
}

// ── Marcar como doado ─────────────────────────────────
async function markAsDonated() {
  if (!confirm(`Confirmas que o item "${_itemTitle}" foi doado?`)) return;

  const btn = document.querySelector('.btn-donate');
  if (btn) { btn.disabled = true; btn.textContent = 'A guardar...'; }

  const { error } = await supabaseClient
    .from('items').update({ status: 'doado' }).eq('id', _itemId);

  if (error) {
    alert('Erro ao actualizar o item: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = '✓ Marcar como doado'; }
  } else {
    // Actualizar badge e bottom bar
    const tagsEl = document.querySelector('.item-tags');
    if (tagsEl) {
      const availTag = tagsEl.querySelector('.tag.green');
      if (availTag) availTag.outerHTML = '<span class="tag grey">● Doado</span>';
    }
    renderBottomBar(true, 'doado', null);
    showToast('✓ Item marcado como doado!');
  }
}

// ── Reativar item ─────────────────────────────────────
async function reactivateItem() {
  if (!confirm('Queres tornar este item disponível novamente?')) return;

  const { error } = await supabaseClient
    .from('items').update({ status: 'disponivel' }).eq('id', _itemId);

  if (!error) {
    renderBottomBar(true, 'disponivel', null);
    showToast('✓ Item disponível novamente!');
  }
}

// ── Editar item ───────────────────────────────────────
function editItem() {
  window.location.href = `add_item.html?edit=${_itemId}`;
}

// ── Toggle favorito ───────────────────────────────────
async function toggleFav(btn) {
  const isFaved = btn.classList.contains('active');

  document.querySelectorAll('#fav-toggle, #bottom-fav').forEach(b => {
    b.classList.toggle('active', !isFaved);
  });
  updateFavIcon(!isFaved);

  if (isFaved) {
    await supabaseClient.from('favorites').delete()
      .eq('user_id', _userId).eq('item_id', _itemId);
  } else {
    await supabaseClient.from('favorites').upsert({ user_id: _userId, item_id: _itemId });
  }
}

function updateFavIcon(faved) {
  document.querySelectorAll('#fav-toggle img, #bottom-fav img').forEach(img => {
    img.style.filter = faved
      ? 'invert(27%) sepia(97%) saturate(1600%) hue-rotate(336deg) brightness(95%) contrast(95%)'
      : '';
  });
}

// ── Toast ─────────────────────────────────────────────
function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--dark-green);color:#fff;font-family:"Berlin",sans-serif;font-size:14px;padding:12px 24px;border-radius:50px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);white-space:nowrap';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ── Galeria ───────────────────────────────────────────
function switchImg(thumb, url) {
  document.getElementById('gallery-main-img').src = url;
  document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
}

// ── Mais itens ────────────────────────────────────────
async function loadMoreItems(currentItemId) {
  const container = document.querySelector('.more-items-scroll');
  if (!container) return;

  const { data: items } = await supabaseClient
    .from('items').select('id, title, location, owner_id')
    .eq('status', 'disponivel').neq('id', currentItemId).limit(6);

  if (!items?.length) return;

  const ids = items.map(i => i.id);
  const { data: images } = await supabaseClient
    .from('item_images').select('item_id, image_url').in('item_id', ids);

  const imgMap = {};
  (images || []).forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.image_url; });

  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, full_name').in('id', ownerIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p.full_name; });

  container.innerHTML = items.map(item => {
    const img       = imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=200&h=140&fit=crop';
    const ownerName = profileMap[item.owner_id] || 'Utilizador';
    return `
      <div class="item-card" onclick="window.location.href='item_detail.html?id=${item.id}'">
        <div class="item-card-img"><img src="${img}" alt="${item.title}"></div>
        <div class="item-card-info">
          <div class="item-card-name">${item.title}</div>
          <div class="item-card-meta">
            <div class="item-user">
              <div class="user-avatar-sm">${ownerName.charAt(0).toUpperCase()}</div>
              <span>por ${ownerName.split(' ')[0]}</span>
            </div>
            <div class="item-dist">${item.location?.split(',')[0] || ''}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}