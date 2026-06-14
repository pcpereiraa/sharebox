/* ─────────────────────────────────────────────────────
   ShareBox — add_item.js
───────────────────────────────────────────────────── */

let photoFiles = []; // máx 4 fotos

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  await Promise.all([
    loadCategories(),
    loadMyCommunities(session.user.id)
  ]);

  // Botões Salvar e Adicionar item
  document.getElementById('btn-salvar')?.addEventListener('click', submitForm);
  document.getElementById('btn-submit')?.addEventListener('click', submitForm);

});

// ── Carrega categorias da BD ──────────────────────────
async function loadCategories() {
  const select = document.getElementById('item-category');
  if (!select) return;

  const { data: categories } = await supabaseClient
    .from('categories')
    .select('id, name')
    .order('name');

  if (!categories?.length) return;

  // Limpar opções estáticas e adicionar as reais
  select.innerHTML = '<option value="" disabled selected>Selecciona uma categoria</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  });
}

// ── Carrega comunidades do utilizador ─────────────────
async function loadMyCommunities(userId) {
  const container = document.querySelector('.community-list');
  if (!container) return;

  const { data: memberships } = await supabaseClient
    .from('communities_members')
    .select('community_id, role')
    .eq('user_id', userId);

  if (!memberships?.length) {
    container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45);padding:8px 0">Ainda não fazes parte de nenhuma comunidade.</p>';
    return;
  }

  const commIds = memberships.map(m => m.community_id);
  const { data: communities } = await supabaseClient
    .from('communities')
    .select('id, name, image_url')
    .in('id', commIds);

  if (!communities?.length) return;

  const colors = ['#c8e6d4', '#d4e4f0', '#e8d5e8', '#f0e4d4'];

  container.innerHTML = communities.map((comm, i) => `
    <label class="community-option">
      <div class="community-thumb" style="background:${colors[i % colors.length]};overflow:hidden">
        ${comm.image_url
          ? `<img src="${comm.image_url}" style="width:100%;height:100%;object-fit:cover">`
          : ''}
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

// ── Preview de fotos ──────────────────────────────────
function triggerUpload(slot) {
  slot.querySelector('.file-input').click();
}

document.querySelectorAll('.photo-slot').forEach(slot => {
  slot.addEventListener('click', function(e) {
    if (e.target.closest('.file-input')) return; // já foi o input
    this.querySelector('.file-input').click();
  });
});

function previewPhoto(input) {
  const slot = input.closest('.photo-slot');
  const file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showMsg('item-feedback', 'Cada foto não pode ter mais de 5MB.', 'error');
    return;
  }

  // Guardar ficheiro no array
  const slotIndex = Array.from(document.querySelectorAll('.photo-slot')).indexOf(slot);
  photoFiles[slotIndex] = file;

  const reader = new FileReader();
  reader.onload = e => {
    slot.querySelector('.photo-preview').src = e.target.result;
    slot.querySelector('.photo-preview').style.display = 'block';
    slot.querySelector('.photo-placeholder').style.display = 'none';
    slot.classList.add('has-photo');
  };
  reader.readAsDataURL(file);
}

// ── Chip selection ────────────────────────────────────
function selectChip(btn, group) {
  btn.closest('.chips-wrap').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
}

// ── Submit ────────────────────────────────────────────
let _submitting = false;
async function submitForm() {
  if (_submitting) return;
  _submitting = true;
  const title    = document.getElementById('item-title')?.value.trim();
  const desc     = document.getElementById('item-desc')?.value.trim();
  const catId    = document.getElementById('item-category')?.value;
  const city     = document.getElementById('item-city')?.value.trim();
  const neighborhood = document.getElementById('item-neighborhood')?.value.trim();
  const condition = document.querySelector('.chips-wrap .chip.active[onclick*="estado"]')?.textContent.split('—')[0].trim();
  const delivery  = document.querySelector('.chips-wrap .chip.active[onclick*="entrega"]')?.textContent.trim();
  const communityId = document.querySelector('input[name="community"]:checked')?.value || null;

  // Validações
  if (!title) { showMsg('item-feedback', 'O nome do item é obrigatório.', 'error'); return; }
  if (!catId) { showMsg('item-feedback', 'Selecciona uma categoria.', 'error'); return; }
  if (!city) { showMsg('item-feedback', 'Indica a cidade.', 'error'); return; }
  if (photoFiles.filter(Boolean).length === 0) {
    showMsg('item-feedback', 'Adiciona pelo menos uma foto.', 'error');
    return;
  }

  const btn = document.querySelector('.btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'A publicar...'; }
  const btnSave = document.querySelector('.btn-salvar');
  if (btnSave) { btnSave.disabled = true; }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const userId = session.user.id;

    const location = neighborhood ? `${neighborhood}, ${city}` : city;

    // 1. Criar item
    const { data: item, error: itemError } = await supabaseClient
      .from('items')
      .insert({
        owner_id:     userId,
        category_id:  catId,
        title,
        description:  desc || null,
        condition:    condition || 'Bom',
        type:         'doacao',
        status:       'disponivel',
        location,
        community_id: communityId,
      })
      .select('id')
      .single();

    if (itemError) throw itemError;

    // 2. Upload de fotos para o Storage
    const validPhotos = photoFiles.filter(Boolean);
    for (let i = 0; i < validPhotos.length; i++) {
      const file     = validPhotos[i];
      const ext      = file.name.split('.').pop();
      const filePath = `${item.id}/${i + 1}.${ext}`;

      const { error: uploadError } = await supabaseClient.storage
        .from('item_images')
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        console.warn('[AddItem] Erro upload foto:', uploadError.message);
        continue;
      }

      const { data: urlData } = supabaseClient.storage
        .from('item-images')
        .getPublicUrl(filePath);

      // 3. Guardar URL na tabela item_images
      await supabaseClient
        .from('item_images')
        .insert({ item_id: item.id, image_url: urlData.publicUrl, position: i + 1 });
    }

    showMsg('item-feedback', '✓ Item publicado com sucesso!', 'success');
    setTimeout(() => window.location.href = 'home.html', 1500);

  } catch (err) {
    console.error('[AddItem] Erro:', err);
    showMsg('item-feedback', 'Erro ao publicar: ' + err.message, 'error');
    _submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Adicionar item'; }
    if (btnSave) { btnSave.disabled = false; }
  }
}

// ── Helper UI ─────────────────────────────────────────
function showMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.cssText = `display:block;padding:12px 16px;border-radius:10px;margin-bottom:12px;font-family:"Berlin",sans-serif;font-size:14px;color:${type === 'error' ? '#c0392b' : '#016e58'};background:${type === 'error' ? 'rgba(192,57,43,0.08)' : 'rgba(1,110,88,0.08)'};`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}