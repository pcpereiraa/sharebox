/* ─────────────────────────────────────────────────────────────────
   Estrutura quase em espelho de add_item.js: o MESMO formulário
   (add_community.html) serve para CRIAR uma comunidade nova ou
   EDITAR uma existente, dependendo de existir ou não o parâmetro
   ?edit=<id> na URL (guardado em `editCommId`).

   Responsabilidades específicas desta página (além do padrão
   criar/editar):
     - Upload de uma única foto de capa (cover) para o Storage
       (bucket "community-images").
     - Gestão de "regras" da comunidade como campos de texto
       dinâmicos, adicionados um a um pelo botão "+ Adicionar regra".
     - Lista de utilizadores a convidar diretamente na criação da
       comunidade (toggle Convidar/Convidado por utilizador).
     - Ao CRIAR uma comunidade, o criador é automaticamente inserido
       em communities_members com role 'admin', e os convidados
       selecionados são inseridos com role 'member'.
───────────────────────────────────────────────────────────────────── */

// Estado do módulo:
let coverFile    = null;   // ficheiro (File) da nova foto de capa escolhida, ou null se não foi alterada
let ruleCount    = 2;      // contador de quantos campos de "Regra N" já existem (começa em 2, presumindo que o HTML já tem 2 regras estáticas)
let invitedIds   = [];     // ids dos utilizadores selecionados para convidar (apenas relevante em modo criação)
let _submitting  = false;  // guarda anti-duplo-submit
let editCommId   = null;   // id da comunidade em edição (vindo de ?edit=...), ou null se for criação
let existingCoverUrl = null; // URL da foto de capa já existente (modo edição), mantida se o utilizador não escolher uma nova

/**
 * Ponto de entrada da página:
 *   1. Garante autenticação.
 *   2. Lê ?edit=<id> para decidir o modo.
 *   3. Carrega em paralelo as categorias e a lista de utilizadores
 *      disponíveis para convidar.
 *   4. Se for edição, carrega os dados existentes da comunidade
 *      (loadCommunityForEdit).
 *   5. Liga os botões: submeter formulário, adicionar nova regra, e
 *      copiar o link de convite.
 *   6. Liga o clique na área de upload de capa (#cover-upload) para
 *      abrir o seletor de ficheiros escondido (#cover-input),
 *      ignorando cliques feitos diretamente no próprio input.
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  // Verificar se é modo edição.
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

/**
 * loadCommunityForEdit
 * -----------------------
 * Carrega os dados de uma comunidade existente e pré-preenche o
 * formulário (transformando "Criar comunidade" em "Editar
 * Comunidade"):
 *   - busca a comunidade pelo id;
 *   - verifica AUTORIZAÇÃO: só o dono (owner_id) OU um admin global
 *     da plataforma pode editar. Note que aqui a verificação de
 *     admin só é feita SE o utilizador não for o dono — uma pequena
 *     otimização para evitar o pedido extra checkIsAdmin() quando
 *     já se sabe que é o dono;
 *   - preenche nome, descrição, localização (com o mesmo padrão de
 *     split bairro/cidade usado em add_item.js);
 *   - ajusta o toggle público/privado (`toggle-public` está marcado
 *     quando a comunidade é PÚBLICA, por isso `checked = !is_private`);
 *   - mostra a foto de capa existente, se houver, e guarda o seu URL
 *     em `existingCoverUrl` (para ser reaproveitado no submit, caso
 *     o utilizador não escolha uma foto nova).
 *
 * @param {string} commId - id da comunidade a editar.
 * @param {string} userId - id do utilizador autenticado atual.
 */
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

  // Preencher campos.
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

  // Foto de capa existente.
  if (comm.image_url) {
    existingCoverUrl = comm.image_url;
    document.getElementById('cover-preview').src = comm.image_url;
    document.getElementById('cover-preview').style.display = 'block';
    document.getElementById('cover-placeholder').style.display = 'none';
    document.getElementById('cover-upload').classList.add('has-photo');
  }
}

/**
 * loadCategories
 * ----------------
 * Preenche o <select> de categoria da comunidade (#comm-category),
 * exatamente com o mesmo padrão usado em add_item.js (placeholder
 * inicial + opções ordenadas alfabeticamente).
 */
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

/**
 * loadUsersToInvite
 * -------------------
 * Carrega até 10 outros utilizadores (excluindo o próprio, via
 * .neq('id', currentUserId)) para mostrar uma lista de "Convidar"
 * — usada só relevantemente em modo CRIAÇÃO, já que os convites só
 * são processados em submitCommunity() quando NÃO está em modo
 * edição.
 *
 * Detalhe estético: usa avatar com inicial do nome sobre uma cor de
 * fundo de uma pequena paleta cíclica, quando o utilizador não tem
 * avatar_url — mesmo padrão visto em loadMyCommunities (add_item.js).
 *
 * @param {string} currentUserId
 */
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

/**
 * toggleInvite
 * --------------
 * Liga/desliga a seleção de um utilizador para convidar, mantendo o
 * array `invitedIds` sincronizado com o estado visual do botão:
 *   - se ainda não estava convidado → adiciona ao array, muda o
 *     texto para "Convidado ✓" e aplica estilo "selecionado" (verde);
 *   - se já estava convidado → remove do array e repõe o estilo/texto
 *     original do botão.
 *
 * Note que isto só altera estado em memória (no array e no botão) —
 * os convites só são efetivamente gravados na BD quando o formulário
 * é submetido (submitCommunity), e só no caminho de CRIAÇÃO.
 *
 * @param {string} userId - id do utilizador a convidar/desconvidar.
 * @param {HTMLElement} btn - botão "Convidar"/"Convidado" clicado.
 */
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

/**
 * previewCover
 * --------------
 * Handler do <input type="file"> da foto de capa: valida tamanho
 * (máx. 5MB), guarda o ficheiro em `coverFile` para upload posterior,
 * limpa `existingCoverUrl` (uma nova escolha substitui a foto de
 * capa antiga) e mostra pré-visualização local via FileReader — o
 * mesmo padrão usado em previewPhoto (add_item.js), mas para um
 * único ficheiro em vez de vários slots.
 *
 * @param {HTMLInputElement} input
 */
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

/**
 * addRule
 * -------
 * Adiciona dinamicamente mais um campo de texto "Regra N" ao
 * formulário, INSERINDO o novo grupo de campo imediatamente ANTES
 * do próprio botão "+ Adicionar regra" (`btn.parentNode.insertBefore`),
 * de forma que o botão fique sempre no final da lista de regras,
 * por mais regras que sejam adicionadas.
 *
 * O número da regra (ruleCount) é incrementado a cada chamada, para
 * a numeração ("Regra 3", "Regra 4", ...) continuar corretamente
 * mesmo que o utilizador clique várias vezes.
 *
 * Nota: estas regras adicionais (assim como as 2 iniciais que já
 * estão fixas no HTML) não aparecem a ser explicitamente lidas em
 * submitCommunity() — ou seja, no estado atual do código, o
 * conteúdo dos campos .rule-input é recolhido no HTML mas não é
 * usado/gravado na base de dados nesta função (pode ser um ponto a
 * mencionar como funcionalidade ainda não totalmente ligada ao
 * backend, se for perguntado na defesa).
 */
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

/**
 * copyLink
 * --------
 * Copia para a área de transferência um link fixo/genérico de
 * convite ('https://sharebox.app/comunidade') e dá feedback visual
 * temporário no botão ("Copiado!" durante 2 segundos, antes de
 * repor o texto original "Copiar").
 *
 * Nota: o link copiado é estático (não inclui o id real da
 * comunidade) — não muda dependendo da comunidade que está a ser
 * criada/editada nesta sessão. Em caso de falha ao copiar (ex:
 * permissões do browser), o erro é silenciosamente ignorado
 * (catch {}), sem feedback de erro ao utilizador.
 */
async function copyLink() {
  const btn = document.getElementById('btn-copiar');
  try { await navigator.clipboard.writeText('https://sharebox.app/comunidade'); } catch {}
  btn.textContent = 'Copiado!';
  setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
}

/**
 * submitCommunity
 * -----------------
 * Função central de submissão — cobre criar e editar, decidindo o
 * caminho com base em `editCommId`.
 *
 * Passo a passo:
 *   1. Guarda anti-duplo-submit.
 *   2. Lê e valida campos: nome e cidade são obrigatórios; o estado
 *      público/privado vem do toggle (is_private = !checked).
 *   3. Bloqueia o botão e mostra texto "a processar".
 *   4. Dentro de try/catch:
 *      a) se houver `coverFile` novo, faz upload para o bucket
 *         "community-images" do Storage, num caminho
 *         `covers/<timestamp>.<ext>` — usa timestamp em vez do id da
 *         comunidade (ao contrário de add_item.js) porque, no caso
 *         de CRIAÇÃO, ainda não existe um commId nesta fase (a
 *         comunidade só é inserida a seguir); se o upload falhar,
 *         simplesmente mantém `imageUrl` como estava antes (sem
 *         lançar erro nem bloquear a submissão);
 *      b) monta `commData` com os campos comuns;
 *      c) se editCommId → UPDATE na tabela communities;
 *      d) senão → INSERT de uma nova comunidade com owner_id =
 *         utilizador atual, e a seguir:
 *           - insere o próprio criador em communities_members com
 *             role 'admin' (torna-se automaticamente administrador
 *             da comunidade que acabou de criar);
 *           - se houver utilizadores selecionados em invitedIds,
 *             insere-os todos de uma vez (insert com array de
 *             objetos) em communities_members com role 'member';
 *      e) mostra mensagem de sucesso e redireciona, com um pequeno
 *         delay, para a página de detalhe da comunidade.
 *   5. Em caso de erro, mostra a mensagem, repõe _submitting=false e
 *      reativa o botão com o texto correto para o modo atual.
 */
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

    // Upload foto de capa (se nova). Caminho baseado em timestamp,
    // não no id da comunidade, porque em modo CRIAÇÃO o id ainda
    // não existe nesta fase do processo.
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
      // ── EDITAR ──────────────────────────────────────
      const { error } = await supabaseClient.from('communities').update(commData).eq('id', editCommId);
      if (error) throw error;
      commId = editCommId;
      showMsg('comm-feedback', '✓ Comunidade actualizada!', 'success');
    } else {
      // ── CRIAR ───────────────────────────────────────
      const { data: comm, error } = await supabaseClient
        .from('communities')
        .insert({ ...commData, owner_id: userId })
        .select('id').single();
      if (error) throw error;
      commId = comm.id;

      // Criador como admin — o próprio utilizador que cria a
      // comunidade torna-se automaticamente o seu primeiro membro
      // com papel de administrador.
      await supabaseClient.from('communities_members')
        .insert({ community_id: commId, user_id: userId, role: 'admin' });

      // Convidados selecionados nesta sessão de criação — inseridos
      // todos de uma vez, com role 'member'.
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

/**
 * showMsg
 * -------
 * Idêntico ao showMsg de add_item.js: escreve a mensagem de
 * feedback (com cor verde/vermelha conforme o tipo) e faz scroll
 * automático até ao elemento.
 *
 * @param {string} id
 * @param {string} msg
 * @param {'error'|'success'} type
 */
function showMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.cssText = `display:block;padding:12px 16px;border-radius:10px;margin-bottom:12px;font-family:"Berlin",sans-serif;font-size:14px;color:${type==='error'?'#c0392b':'#016e58'};background:${type==='error'?'rgba(192,57,43,0.08)':'rgba(1,110,88,0.08)'};`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
