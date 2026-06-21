/* ─────────────────────────────────────────────────────
   ShareBox — add_community.js
   Modo duplo: criar ou editar comunidade
───────────────────────────────────────────────────── */

let coverFile    = null;
let ruleCount    = 2;
let invitedIds   = [];
let _submitting  = false;
let editCommId   = null;
let existingCoverUrl = null;

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  // Verificar se é modo edição
  const params = new URLSearchParams(window.location.search);
  editCommId = params.get('edit') || null;

  await Promise.all([
    loadCategories(),
    loadUsersToInvite(session.user.id)
  ]);

  if (editCommId) {
    await loadCommunityForEdit(editCommId, session.user.id);
  }

  document.getElementById('btn-submit-comm')?.addEventListener('click', submitCommunity);
  document.getElementById('btn-add-rule')?.addEventListener('click', addRule);
  document.getElementById('btn-copiar')?.addEventListener('click', copyLink);

  document.getElementById('cover-upload')?.addEventListener('click', function(e) {
    if (e.target.closest('#cover-input')) return;
    document.getElementById('cover-input').click();
  });
});

// ── Carregar comunidade para edição ──────────────────
async function loadCommunityForEdit(commId, userId) {
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.textContent = 'Editar Comunidade';
  const submitBtn = document.getElementById('btn-submit-comm');
  if (submitBtn) submitBtn.textContent = 'Guardar alterações';

  const { data: comm, error } = await supabaseClient
    .from('communities')
    .select('id, name, description, image_url, location, is_private, owner_id')
    .eq('id', commId)
    .single();

  if (error || !comm) {
    showMsg('comm-feedback', 'Comunidade não encontrada.', 'error'); return;
  }
  if (comm.owner_id !== userId) {
    const isAdmin = await checkIsAdmin(userId);
    console.log('[AddCommunity] owner_id:', comm.owner_id, '| current user:', userId, '| isAdmin:', isAdmin);
    if (!isAdmin) {
      showMsg('comm-feedback', 'Não tens permissão para editar esta comunidade.', 'error'); return;
    }
  }

  // Preencher campos
  document.getElementById('comm-name').value = comm.name || '';
  document.getElementById('comm-desc').value = comm.description || '';

  if (comm.location) {
    const parts = comm.location.split(',');
    if (parts.length > 1) {
      document.getElementById('comm-neighborhood').value = parts[0].trim();
      document.getElementById('comm-city').value         = parts[1].trim();
    } else {
      document.getElementById('comm-city').value = comm.location.trim();
    }
  }

  const toggle = document.getElementById('toggle-public');
  if (toggle) toggle.checked = !comm.is_private;

  // Foto de capa existente
  if (comm.image_url) {
    existingCoverUrl = comm.image_url;
    document.getElementById('cover-preview').src = comm.image_url;
    document.getElementById('cover-preview').style.display = 'block';
    document.getElementById('cover-placeholder').style.display = 'none';
    document.getElementById('cover-upload').classList.add('has-photo');
  }
}

// ── Categorias ────────────────────────────────────────
async function loadCategories() {
  const select = document.getElementById('comm-category');
  if (!select) return;
  const { data: categories } = await supabaseClient
    .from('categories').select('id, name').order('name');
  if (!categories?.length) return;
  select.innerHTML = '<option value="" disabled selected>Selecciona uma categoria</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id; opt.textContent = cat.name;
    select.appendChild(opt);
  });
}

// ── Utilizadores para convidar ────────────────────────
async function loadUsersToInvite(currentUserId) {
  const container = document.getElementById('invite-list');
  if (!container) return;
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, full_name, avatar_url')
    .neq('id', currentUserId).limit(10);
  if (!profiles?.length) {
    container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45)">Sem utilizadores disponíveis.</p>';
    return;
  }
  const colors = ['#c8e6d4','#d4e4f0','#e8d5e8','#f0e4d4','#d4f0e4'];
  container.innerHTML = profiles.map((p, i) => `
    <div class="invite-row">
      <div class="invite-avatar" style="background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-family:'Berlin',sans-serif;font-size:18px;color:var(--blue)">
        ${p.avatar_url ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : (p.full_name||'U').charAt(0).toUpperCase()}
      </div>
      <div class="invite-info"><div class="invite-name">${p.full_name||'Utilizador'}</div></div>
      <button class="btn-convidar" id="invite-btn-${p.id}" onclick="toggleInvite('${p.id}',this)">Convidar</button>
    </div>
    ${i < profiles.length-1 ? '<div class="invite-divider"></div>' : ''}
  `).join('');
}

function toggleInvite(userId, btn) {
  const idx = invitedIds.indexOf(userId);
  if (idx === -1) {
    invitedIds.push(userId);
    btn.textContent = 'Convidado ✓';
    btn.style.cssText += ';background:var(--dark-green);color:#fff;border-color:var(--dark-green)';
  } else {
    invitedIds.splice(idx, 1);
    btn.textContent = 'Convidar';
    btn.style.background = btn.style.color = btn.style.borderColor = '';
  }
}

function previewCover(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5*1024*1024) { showMsg('comm-feedback','A foto não pode ter mais de 5MB.','error'); return; }
  coverFile = file;
  existingCoverUrl = null;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('cover-preview').src = e.target.result;
    document.getElementById('cover-preview').style.display = 'block';
    document.getElementById('cover-placeholder').style.display = 'none';
    document.getElementById('cover-upload').classList.add('has-photo');
  };
  reader.readAsDataURL(file);
}

function addRule() {
  ruleCount++;
  const btn = document.getElementById('btn-add-rule');
  const group = document.createElement('div');
  group.className = 'field-group';
  group.innerHTML = `
    <div class="field-label-row">
      <label class="field-label">Regra ${ruleCount}</label>
      <span class="field-optional">Opcional</span>
    </div>
    <input class="field-input rule-input" type="text" placeholder="Ex: Sem fins comerciais">`;
  btn.parentNode.insertBefore(group, btn);
}

async function copyLink() {
  const btn = document.getElementById('btn-copiar');
  try { await navigator.clipboard.writeText('https://sharebox.app/comunidade'); } catch {}
  btn.textContent = 'Copiado!';
  setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
}

// ── Submit ────────────────────────────────────────────
async function submitCommunity() {
  if (_submitting) return;

  const name         = document.getElementById('comm-name')?.value.trim();
  const desc         = document.getElementById('comm-desc')?.value.trim();
  const city         = document.getElementById('comm-city')?.value.trim();
  const neighborhood = document.getElementById('comm-neighborhood')?.value.trim();
  const isPrivate    = !document.getElementById('toggle-public')?.checked;

  if (!name) { showMsg('comm-feedback','O nome é obrigatório.','error'); return; }
  if (!city)  { showMsg('comm-feedback','Indica a cidade.','error'); return; }

  _submitting = true;
  const btn = document.getElementById('btn-submit-comm');
  if (btn) { btn.disabled = true; btn.textContent = editCommId ? 'A guardar...' : 'A criar...'; }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const userId  = session.user.id;
    const location = neighborhood ? `${neighborhood}, ${city}` : city;

    // Upload foto de capa (se nova)
    let imageUrl = existingCoverUrl;
    if (coverFile) {
      const ext = coverFile.name.split('.').pop();
      const filePath = `covers/${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseClient.storage
        .from('community-images').upload(filePath, coverFile, { upsert: true, contentType: coverFile.type });
      if (!upErr) {
        const { data: urlData } = supabaseClient.storage.from('community-images').getPublicUrl(filePath);
        imageUrl = urlData.publicUrl;
      }
    }

    const commData = { name, description: desc || null, image_url: imageUrl, location, is_private: isPrivate };

    let commId;

    if (editCommId) {
      // ── EDITAR
      const { error } = await supabaseClient.from('communities').update(commData).eq('id', editCommId);
      if (error) throw error;
      commId = editCommId;
      showMsg('comm-feedback', '✓ Comunidade actualizada!', 'success');
    } else {
      // ── CRIAR
      const { data: comm, error } = await supabaseClient
        .from('communities')
        .insert({ ...commData, owner_id: userId })
        .select('id').single();
      if (error) throw error;
      commId = comm.id;

      // Criador como admin
      await supabaseClient.from('communities_members')
        .insert({ community_id: commId, user_id: userId, role: 'admin' });

      // Convidados
      if (invitedIds.length > 0) {
        await supabaseClient.from('communities_members')
          .insert(invitedIds.map(uid => ({ community_id: commId, user_id: uid, role: 'member' })));
      }
      showMsg('comm-feedback', '✓ Comunidade criada!', 'success');
    }

    setTimeout(() => window.location.href = `community_detail.html?id=${commId}`, 1500);

  } catch (err) {
    console.error('[AddCommunity]', err);
    showMsg('comm-feedback', 'Erro: ' + err.message, 'error');
    _submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = editCommId ? 'Guardar alterações' : 'Criar comunidade'; }
  }
}

function showMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.cssText = `display:block;padding:12px 16px;border-radius:10px;margin-bottom:12px;font-family:"Berlin",sans-serif;font-size:14px;color:${type==='error'?'#c0392b':'#016e58'};background:${type==='error'?'rgba(192,57,43,0.08)':'rgba(1,110,88,0.08)'};`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}