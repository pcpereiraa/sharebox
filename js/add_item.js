/* ─────────────────────────────────────────────────────
   ShareBox — add_item.js
   Modo duplo: criar novo item ou editar existente
───────────────────────────────────────────────────── */

let photoFiles  = [];
let editItemId  = null;
let _submitting = false;

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  // Verificar se é modo edição
  const params = new URLSearchParams(window.location.search);
  editItemId = params.get('edit') || null;

  await Promise.all([
    loadCategories(),
    loadMyCommunities(session.user.id)
  ]);

  if (editItemId) {
    await loadItemForEdit(editItemId, session);
  }

  // Botões
  document.getElementById('btn-salvar')?.addEventListener('click', submitForm);
  document.getElementById('btn-submit')?.addEventListener('click', submitForm);

  // Photo slots
  document.querySelectorAll('.photo-slot').forEach(slot => {
    slot.addEventListener('click', function(e) {
      if (e.target.closest('.file-input')) return;
      this.querySelector('.file-input').click();
    });
  });
});

// ── Carregar item para edição ─────────────────────────
async function loadItemForEdit(itemId, session) {
  // Mudar títulos
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.textContent = 'Editar item';
  const submitBtn = document.getElementById('btn-submit');
  if (submitBtn) submitBtn.textContent = 'Guardar alterações';
  const savarBtn = document.getElementById('btn-salvar');
  if (savarBtn) savarBtn.textContent = 'Guardar';

  const { data: item, error } = await supabaseClient
    .from('items')
    .select('id, title, description, condition, type, status, location, category_id, community_id, owner_id')
    .eq('id', itemId)
    .single();

  if (error || !item) {
    showMsg('item-feedback', 'Item não encontrado.', 'error');
    return;
  }

  // Verificar que é o dono OU um admin
  const isAdmin = await checkIsAdmin(session.user.id);
  console.log('[AddItem] owner_id:', item.owner_id, '| current user:', session.user.id, '| isAdmin:', isAdmin);
  if (item.owner_id !== session.user.id && !isAdmin) {
    showMsg('item-feedback', 'Não tens permissão para editar este item.', 'error');
    return;
  }

  // Preencher campos
  document.getElementById('item-title').value = item.title || '';
  document.getElementById('item-desc').value  = item.description || '';

  // Localização — separar bairro e cidade
  if (item.location) {
    const parts = item.location.split(',');
    if (parts.length > 1) {
      document.getElementById('item-neighborhood').value = parts[0].trim();
      document.getElementById('item-city').value         = parts[1].trim();
    } else {
      document.getElementById('item-city').value = item.location.trim();
    }
  }

  // Categoria
  const catSelect = document.getElementById('item-category');
  if (catSelect && item.category_id) catSelect.value = item.category_id;

  // Chips de estado - activar o correcto por data-value
  const condChips = document.querySelectorAll('#condition-chips .chip');
  condChips.forEach(c => {
    c.classList.toggle('active', c.dataset.value === item.condition);
  });

  // Comunidade
  if (item.community_id) {
    const radio = document.querySelector(`input[name="community"][value="${item.community_id}"]`);
    if (radio) radio.checked = true;
  }

  // Carregar fotos existentes
  const { data: images } = await supabaseClient
    .from('item_images')
    .select('image_url, position')
    .eq('item_id', itemId)
    .order('position');

  if (images?.length) {
    const slots = document.querySelectorAll('.photo-slot');
    images.forEach((img, i) => {
      if (i >= slots.length) return;
      const slot    = slots[i];
      const preview = slot.querySelector('.photo-preview');
      const placeholder = slot.querySelector('.photo-placeholder');
      if (preview) {
        preview.src = img.image_url;
        preview.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
      slot.classList.add('has-photo');
      slot.dataset.existingUrl = img.image_url;
    });
  }
}

// ── Categorias ────────────────────────────────────────
async function loadCategories() {
  const select = document.getElementById('item-category');
  if (!select) return;

  const { data: categories } = await supabaseClient
    .from('categories').select('id, name').order('name');

  if (!categories?.length) return;
  select.innerHTML = '<option value="" disabled selected>Selecciona uma categoria</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  });
}

// ── Comunidades do utilizador ─────────────────────────
async function loadMyCommunities(userId) {
  const container = document.querySelector('.community-list');
  if (!container) return;

  const { data: memberships } = await supabaseClient
    .from('communities_members').select('community_id, role').eq('user_id', userId);

  if (!memberships?.length) {
    container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45);padding:8px 0">Ainda não fazes parte de nenhuma comunidade.</p>';
    return;
  }

  const commIds = memberships.map(m => m.community_id);
  const { data: communities } = await supabaseClient
    .from('communities').select('id, name, image_url').in('id', commIds);

  if (!communities?.length) return;

  const colors = ['#c8e6d4','#d4e4f0','#e8d5e8','#f0e4d4'];
  container.innerHTML = communities.map((comm, i) => `
    <label class="community-option">
      <div class="community-thumb" style="background:${colors[i % colors.length]};overflow:hidden">
        ${comm.image_url ? `<img src="${comm.image_url}" style="width:100%;height:100%;object-fit:cover">` : ''}
      </div>
      <div class="community-info">
        <div class="community-name">${comm.name}</div>
        <div class="community-meta">Comunidade</div>
      </div>
      <input type="radio" name="community" class="radio-input" value="${comm.id}">
      <div class="radio-custom"></div>
    </label>
    ${i < communities.length - 1 ? '<div class="comm-divider"></div>' : ''}
  `).join('');
}

// ── Selecção de chips (estado/entrega) ────────────────
function selectChip(chip, group) {
  const wrapper = chip.closest('.chips-wrap');
  if (!wrapper) return;
  wrapper.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
}

// ── Preview de fotos ──────────────────────────────────
function previewPhoto(input) {
  const slot = input.closest('.photo-slot');
  const file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showMsg('item-feedback', 'Cada foto não pode ter mais de 5MB.', 'error');
    return;
  }

  const slotIndex = Array.from(document.querySelectorAll('.photo-slot')).indexOf(slot);
  photoFiles[slotIndex] = file;
  delete slot.dataset.existingUrl; // nova foto substitui a existente

  const reader = new FileReader();
  reader.onload = e => {
    slot.querySelector('.photo-preview').src = e.target.result;
    slot.querySelector('.photo-preview').style.display = 'block';
    slot.querySelector('.photo-placeholder').style.display = 'none';
    slot.classList.add('has-photo');
  };
  reader.readAsDataURL(file);
}

// ── Submit ────────────────────────────────────────────
async function submitForm() {
  if (_submitting) return;

  const title        = document.getElementById('item-title')?.value.trim();
  const desc         = document.getElementById('item-desc')?.value.trim();
  const catId        = document.getElementById('item-category')?.value;
  const city         = document.getElementById('item-city')?.value.trim();
  const neighborhood = document.getElementById('item-neighborhood')?.value.trim();
  // Ler condição pelo data-value do chip activo
  const conditionChip = document.querySelector('#condition-chips .chip.active');
  const condition = conditionChip?.dataset.value || 'Bom';
  const communityId  = document.querySelector('input[name="community"]:checked')?.value || null;

  if (!title) { showMsg('item-feedback', 'O nome do item é obrigatório.', 'error'); return; }
  if (!catId)  { showMsg('item-feedback', 'Selecciona uma categoria.', 'error');  return; }
  if (!city)   { showMsg('item-feedback', 'Indica a cidade.', 'error');           return; }

  // Em modo criação exige pelo menos 1 foto nova
  const slots = document.querySelectorAll('.photo-slot');
  const hasPhoto = photoFiles.some(Boolean) ||
    [...slots].some(s => s.dataset.existingUrl);
  if (!hasPhoto) {
    showMsg('item-feedback', 'Adiciona pelo menos uma foto.', 'error');
    return;
  }

  _submitting = true;
  const btn    = document.getElementById('btn-submit');
  const btnSav = document.getElementById('btn-salvar');
  if (btn)    { btn.disabled = true;    btn.textContent = editItemId ? 'A guardar...' : 'A publicar...'; }
  if (btnSav) { btnSav.disabled = true; }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const userId   = session.user.id;
    const location = neighborhood ? `${neighborhood}, ${city}` : city;

    const itemData = {
      category_id:  catId,
      title,
      description:  desc || null,
      condition,
      type:         'doacao',
      location,
      community_id: communityId,
    };

    let itemId;

    if (editItemId) {
      // ── EDITAR
      const { error } = await supabaseClient
        .from('items').update(itemData).eq('id', editItemId);
      if (error) throw error;
      itemId = editItemId;

      // Apagar imagens antigas que foram substituídas
      const newPhotoSlots = document.querySelectorAll('.photo-slot');
      for (let i = 0; i < newPhotoSlots.length; i++) {
        if (photoFiles[i]) {
          // Há foto nova para esta posição — apagar a antiga
          await supabaseClient.from('item_images')
            .delete().eq('item_id', itemId).eq('position', i + 1);
        }
      }
    } else {
      // ── CRIAR
      const { data: item, error } = await supabaseClient
        .from('items')
        .insert({ ...itemData, owner_id: userId, status: 'disponivel' })
        .select('id').single();
      if (error) throw error;
      itemId = item.id;
    }

    // Upload fotos novas
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];
      if (!file) continue;

      const ext      = file.name.split('.').pop();
      const filePath = `${itemId}/${i + 1}.${ext}`;

      const { error: upErr } = await supabaseClient.storage
        .from('item-images').upload(filePath, file, { upsert: true, contentType: file.type });
      if (upErr) { console.warn('[AddItem] Upload erro:', upErr.message); continue; }

      const { data: urlData } = supabaseClient.storage
        .from('item-images').getPublicUrl(filePath);

      await supabaseClient.from('item_images')
        .upsert({ item_id: itemId, image_url: urlData.publicUrl + '?t=' + Date.now(), position: i + 1 });
    }

    showMsg('item-feedback', editItemId ? '✓ Item actualizado!' : '✓ Item publicado!', 'success');
    setTimeout(() => window.location.href = `item_detail.html?id=${itemId}`, 1500);

  } catch (err) {
    console.error('[AddItem]', err);
    showMsg('item-feedback', 'Erro: ' + err.message, 'error');
    _submitting = false;
    if (btn)    { btn.disabled = false;    btn.textContent = editItemId ? 'Guardar alterações' : 'Adicionar item'; }
    if (btnSav) { btnSav.disabled = false; }
  }
}

function showMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.cssText = `display:block;padding:12px 16px;border-radius:10px;margin-bottom:12px;font-family:"Berlin",sans-serif;font-size:14px;color:${type==='error'?'#c0392b':'#016e58'};background:${type==='error'?'rgba(192,57,43,0.08)':'rgba(1,110,88,0.08)'};`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}