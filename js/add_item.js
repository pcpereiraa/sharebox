/* ─────────────────────────────────────────────────────────────────
   Este ficheiro controla o formulário de add_item.html, que serve
   DUAS finalidades com o MESMO código/HTML:

     - CRIAR um item novo  → add_item.html (sem parâmetros)
     - EDITAR um item existente → add_item.html?edit=<itemId>

   A distinção é feita logo no arranque, lendo o parâmetro `edit` da
   query string para a variável global `editItemId`. A partir daí,
   praticamente todas as funções (textos dos botões, lógica de
   submissão) verificam `if (editItemId)` para decidir entre
   "criar" e "actualizar".

   Outras responsabilidades:
     - Carregar a lista de categorias (<select>) e as comunidades de
       que o utilizador é membro (lista de radio buttons), porque um
       item pode opcionalmente pertencer a uma comunidade.
     - Gerir até N "slots" de fotos (pré-visualização local com
       FileReader antes do upload real).
     - Validar o formulário e submeter: grava o item na tabela
       `items` e faz upload das imagens para o Supabase Storage
       (bucket "item-images"), guardando depois os URLs públicos na
       tabela `item_images`.
───────────────────────────────────────────────────────────────────── */

// Estado do módulo:
let photoFiles  = [];     // array paralelo aos "photo-slot": guarda os ficheiros (File) NOVOS escolhidos pelo utilizador, indexados pela posição do slot
let editItemId  = null;   // id do item em edição (vindo de ?edit=...), ou null se for criação
let _submitting = false;  // flag anti-duplo-submit (impede clicar 2x e criar o item duplicado)

/**
 * Ponto de entrada da página:
 *   1. Garante autenticação.
 *   2. Lê ?edit=<id> da query string para decidir o modo (criar/editar).
 *   3. Carrega em paralelo as categorias (<select>) e as comunidades
 *      do utilizador (lista de rádios) — informação necessária para
 *      desenhar o formulário, independentemente do modo.
 *   4. Se for modo edição, carrega os dados existentes do item e
 *      pré-preenche todos os campos (loadItemForEdit).
 *   5. Liga os botões de submissão (há dois — #btn-salvar e
 *      #btn-submit — provavelmente versões do botão em diferentes
 *      pontos do layout responsivo, ambos chamam o mesmo submitForm).
 *   6. Liga o clique em cada "photo-slot" para abrir o seletor de
 *      ficheiros (input[type=file] escondido dentro do slot),
 *      ignorando cliques que já tenham sido feitos diretamente no
 *      próprio input (evita abrir o picker duas vezes).
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  // Verificar se é modo edição.
  const params = new URLSearchParams(window.location.search);
  editItemId = params.get('edit') || null;

  await Promise.all([
    loadCategories(),
    loadMyCommunities(session.user.id)
  ]);

  if (editItemId) {
    await loadItemForEdit(editItemId, session);
  }

  // Botões — tanto o botão de "salvar" (provavelmente no topo/header)
  // como o de "submit" (no fundo do formulário) disparam a mesma
  // função de submissão.
  document.getElementById('btn-salvar')?.addEventListener('click', submitForm);
  document.getElementById('btn-submit')?.addEventListener('click', submitForm);

  // Photo slots: clicar em qualquer parte do slot (exceto no próprio
  // <input type="file">, para não disparar o evento duas vezes)
  // aciona o input de ficheiro escondido dentro dele.
  document.querySelectorAll('.photo-slot').forEach(slot => {
    slot.addEventListener('click', function(e) {
      if (e.target.closest('.file-input')) return;
      this.querySelector('.file-input').click();
    });
  });
});

/**
 * loadItemForEdit
 * -----------------
 * Carrega os dados de um item existente e preenche todos os campos
 * do formulário com esses valores, transformando a página de
 * "Adicionar item" em "Editar item":
 *   - troca os textos da página/botões para o modo edição;
 *   - busca o item pelo id;
 *   - verifica AUTORIZAÇÃO: só o dono do item OU um administrador
 *     pode editar — se nenhuma das condições se verificar, mostra
 *     mensagem de erro e PÁRA (não preenche nada, o formulário
 *     fica vazio/inutilizável para esse utilizador);
 *   - preenche título, descrição, localização (separando bairro e
 *     cidade, que tinham sido combinados num único campo `location`
 *     ao criar o item — ver comentário no campo `location` mais abaixo);
 *   - seleciona a categoria certa no <select>;
 *   - ativa o "chip" de condição correspondente (procurando por
 *     data-value, não por índice);
 *   - marca o rádio da comunidade certa, se o item pertencer a uma;
 *   - carrega as fotos já existentes e mostra-as nos slots (com
 *     `dataset.existingUrl` marcado, para o código de submissão
 *     saber que aquele slot já tem uma foto guardada e não precisa
 *     de novo upload se o utilizador não a alterar).
 *
 * Nota de defesa importante sobre segurança: esta verificação de
 * "é o dono ou admin" está implementada do lado do CLIENTE (aqui em
 * JS). Para ser uma garantia de segurança real (e não apenas uma
 * conveniência de UI), a tabela `items` no Supabase tem de ter uma
 * política RLS de UPDATE que exija owner_id = auth.uid() (ou
 * is_admin), porque um utilizador malicioso pode contornar este
 * código no browser e tentar o UPDATE diretamente pela API.
 *
 * @param {string} itemId - id do item a editar (vem de ?edit=).
 * @param {Object} session - sessão Supabase do utilizador atual.
 */
async function loadItemForEdit(itemId, session) {
  // Mudar títulos/textos da página para refletir o modo edição.
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

  // Verificar que é o dono OU um admin antes de permitir a edição.
  const isAdmin = await checkIsAdmin(session.user.id);
  console.log('[AddItem] owner_id:', item.owner_id, '| current user:', session.user.id, '| isAdmin:', isAdmin);
  if (item.owner_id !== session.user.id && !isAdmin) {
    showMsg('item-feedback', 'Não tens permissão para editar este item.', 'error');
    return;
  }

  // Preencher campos de texto simples.
  document.getElementById('item-title').value = item.title || '';
  document.getElementById('item-desc').value  = item.description || '';

  // Localização — separar bairro e cidade.
  // A coluna `location` guarda um único texto combinado (ex:
  // "Bonfim, Porto"). Aqui faz-se split por vírgula para repor os
  // DOIS campos do formulário (bairro/freguesia + cidade) a partir
  // desse texto único — o inverso da junção feita em submitForm().
  if (item.location) {
    const parts = item.location.split(',');
    if (parts.length > 1) {
      document.getElementById('item-neighborhood').value = parts[0].trim();
      document.getElementById('item-city').value         = parts[1].trim();
    } else {
      document.getElementById('item-city').value = item.location.trim();
    }
  }

  // Categoria.
  const catSelect = document.getElementById('item-category');
  if (catSelect && item.category_id) catSelect.value = item.category_id;

  // Chips de estado — ativar o chip correto comparando o atributo
  // data-value de cada chip com a condição guardada no item (não é
  // por índice/posição, é por correspondência de valor).
  const condChips = document.querySelectorAll('#condition-chips .chip');
  condChips.forEach(c => {
    c.classList.toggle('active', c.dataset.value === item.condition);
  });

  // Comunidade — marcar o rádio cujo value coincide com o
  // community_id do item, se existir.
  if (item.community_id) {
    const radio = document.querySelector(`input[name="community"][value="${item.community_id}"]`);
    if (radio) radio.checked = true;
  }

  // Carregar fotos existentes (ordenadas por posição) e mostrá-las
  // nos respetivos slots.
  const { data: images } = await supabaseClient
    .from('item_images')
    .select('image_url, position')
    .eq('item_id', itemId)
    .order('position');

  if (images?.length) {
    const slots = document.querySelectorAll('.photo-slot');
    images.forEach((img, i) => {
      if (i >= slots.length) return; // mais imagens do que slots disponíveis — ignora o excesso
      const slot    = slots[i];
      const preview = slot.querySelector('.photo-preview');
      const placeholder = slot.querySelector('.photo-placeholder');
      if (preview) {
        preview.src = img.image_url;
        preview.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
      slot.classList.add('has-photo');
      // Marca este slot como já tendo uma foto GUARDADA na BD —
      // usado em submitForm() para saber que não é obrigatório fazer
      // novo upload se o utilizador não trocar esta foto.
      slot.dataset.existingUrl = img.image_url;
    });
  }
}

/**
 * loadCategories
 * ----------------
 * Preenche o <select> de categorias (#item-category) com todas as
 * linhas da tabela `categories`, ordenadas alfabeticamente pelo
 * nome. Insere também uma opção inicial desativada/pré-selecionada
 * ("Selecciona uma categoria") como placeholder, para forçar o
 * utilizador a escolher ativamente uma categoria.
 */
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

/**
 * loadMyCommunities
 * -------------------
 * Preenche a lista de rádios de comunidades (.community-list) com
 * as comunidades de que o utilizador é membro — um item pode
 * opcionalmente ser associado a UMA dessas comunidades (input
 * type="radio", seleção única), através do campo community_id.
 *
 * Se o utilizador não pertencer a nenhuma comunidade, mostra uma
 * mensagem em vez da lista de rádios.
 *
 * Detalhe estético: usa uma pequena paleta fixa de 4 cores
 * (`colors`) repetida em ciclo (i % colors.length) como fundo da
 * miniatura quando a comunidade não tem imagem — dá variedade
 * visual sem precisar de imagens reais para todas as comunidades.
 *
 * @param {string} userId
 */
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

/**
 * selectChip
 * ----------
 * Handler genérico para "chips" de seleção única dentro de um grupo
 * (ex: condição do item: Novo/Bom/Usado). Remove a classe "active"
 * de todos os chips dentro do mesmo .chips-wrap (o contentor pai
 * mais próximo) e ativa apenas o que foi clicado — comportamento
 * equivalente a um grupo de radio buttons, mas implementado com
 * <div>/<button> e classes CSS em vez de <input type="radio">.
 *
 * @param {HTMLElement} chip - o chip clicado.
 * @param {string} group - (recebido mas não usado dentro da função;
 *        provavelmente mantido para identificar visualmente, no
 *        HTML, a que grupo cada chip pertence, já que a lógica real
 *        de agrupamento usa .closest('.chips-wrap') em vez do
 *        parâmetro `group`).
 */
function selectChip(chip, group) {
  const wrapper = chip.closest('.chips-wrap');
  if (!wrapper) return;
  wrapper.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
}

/**
 * previewPhoto
 * --------------
 * Handler do evento "change" de um <input type="file"> dentro de um
 * photo-slot. NÃO faz upload imediato — apenas:
 *   1. Valida o tamanho do ficheiro (máx. 5MB), mostrando erro e
 *      abortando se for maior.
 *   2. Descobre o ÍNDICE do slot (posição na lista de
 *      .photo-slot), para guardar o ficheiro escolhido no array
 *      paralelo `photoFiles` nessa mesma posição — importante para
 *      depois, no submit, se conseguir fazer o upload de cada foto
 *      para a posição correta (1.ext, 2.ext, etc.).
 *   3. Remove `dataset.existingUrl` (se existisse) — uma foto nova
 *      escolhida substitui qualquer foto antiga que estivesse
 *      previamente guardada nesse slot (relevante em modo edição).
 *   4. Usa FileReader para ler o ficheiro como Data URL e mostrar
 *      uma pré-visualização imediata na <img> do slot, SEM precisar
 *      de enviar nada para o servidor — é só uma representação
 *      local em base64 do ficheiro, válida até a página recarregar.
 *
 * @param {HTMLInputElement} input - o <input type="file"> que disparou o change.
 */
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

/**
 * submitForm
 * ----------
 * Função central de submissão do formulário — cobre TANTO criação
 * como edição, decidindo internamente qual caminho seguir conforme
 * `editItemId`.
 *
 * Passo a passo:
 *   1. Guarda anti-duplo-submit: se já estiver a submeter
 *      (_submitting === true), ignora cliques repetidos.
 *   2. Lê e valida os campos do formulário:
 *      - título obrigatório;
 *      - categoria obrigatória;
 *      - cidade obrigatória;
 *      - condição lida pelo chip ativo (data-value), com fallback
 *        para 'Bom' se nenhum estiver ativo (não devia acontecer
 *        na prática, mas é uma rede de segurança);
 *      - comunidade é OPCIONAL (pode não haver rádio marcado).
 *   3. Valida que existe PELO MENOS uma foto — quer seja uma foto
 *      NOVA escolhida (photoFiles.some(Boolean)) quer seja uma foto
 *      JÁ EXISTENTE mantida (slot com dataset.existingUrl, relevante
 *      em modo edição onde o utilizador pode não alterar nenhuma foto).
 *   4. Bloqueia os botões e mostra texto de "a processar" (anti-clique
 *      duplo + feedback visual).
 *   5. Dentro de um try/catch (para capturar qualquer erro e repor o
 *      formulário no estado editável em caso de falha):
 *      a) monta o objeto `itemData` com os campos comuns a criar/editar
 *         (a localização é reconstruída juntando bairro+cidade, o
 *         inverso do split feito em loadItemForEdit);
 *      b) se editItemId existir → UPDATE na tabela items, e apaga as
 *         imagens antigas das posições onde existe uma foto NOVA
 *         (para não ficarem fotos órfãs/duplicadas na mesma posição);
 *      c) senão → INSERT um novo item com owner_id = utilizador atual
 *         e status inicial 'disponivel';
 *      d) faz upload de cada ficheiro novo em `photoFiles` para o
 *         Supabase Storage (bucket 'item-images'), num caminho
 *         `<itemId>/<posição>.<extensão>`, com upsert:true (substitui
 *         se já existir um ficheiro nesse caminho exato);
 *      e) obtém o URL público de cada imagem carregada e grava-o na
 *         tabela `item_images` (upsert, incluindo um parâmetro
 *         `?t=timestamp` no URL — técnica de "cache busting": força
 *         o browser a não usar uma versão antiga em cache da mesma
 *         imagem, já que a URL "base" seria sempre igual ao
 *         re-publicar uma foto na mesma posição);
 *      f) mostra mensagem de sucesso e redireciona, após um pequeno
 *         delay, para a página de detalhe do item (criado ou editado).
 *   6. Em caso de erro em qualquer ponto do try, mostra a mensagem de
 *      erro, repõe `_submitting = false` e reativa os botões com o
 *      texto original.
 */
async function submitForm() {
  if (_submitting) return;

  const title        = document.getElementById('item-title')?.value.trim();
  const desc         = document.getElementById('item-desc')?.value.trim();
  const catId        = document.getElementById('item-category')?.value;
  const city         = document.getElementById('item-city')?.value.trim();
  const neighborhood = document.getElementById('item-neighborhood')?.value.trim();
  // Ler condição pelo data-value do chip ativo.
  const conditionChip = document.querySelector('#condition-chips .chip.active');
  const condition = conditionChip?.dataset.value || 'Bom';
  const communityId  = document.querySelector('input[name="community"]:checked')?.value || null;

  if (!title) { showMsg('item-feedback', 'O nome do item é obrigatório.', 'error'); return; }
  if (!catId)  { showMsg('item-feedback', 'Selecciona uma categoria.', 'error');  return; }
  if (!city)   { showMsg('item-feedback', 'Indica a cidade.', 'error');           return; }

  // Em modo criação (e também em edição, se todas as fotos forem
  // removidas) exige pelo menos 1 foto: ou nova (photoFiles) ou já
  // existente e mantida (slot.dataset.existingUrl).
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
    // Reconstrói o campo location combinando bairro + cidade (o
    // inverso do split feito em loadItemForEdit). Se não houver
    // bairro, usa só a cidade.
    const location = neighborhood ? `${neighborhood}, ${city}` : city;

    const itemData = {
      category_id:  catId,
      title,
      description:  desc || null,
      condition,
      type:         'doacao', // tipo fixo nesta versão do formulário — sempre "doação" (não há opção de "troca" no UI atual, apesar de a coluna suportar esse valor, como visto em item_detail.js)
      location,
      community_id: communityId,
    };

    let itemId;

    if (editItemId) {
      // ── EDITAR ──────────────────────────────────────
      const { error } = await supabaseClient
        .from('items').update(itemData).eq('id', editItemId);
      if (error) throw error;
      itemId = editItemId;

      // Apagar imagens antigas que foram substituídas: para cada
      // slot que tenha um ficheiro NOVO escolhido (photoFiles[i]),
      // apaga a linha correspondente em item_images (mesma posição,
      // i+1, porque as posições são 1-indexed na BD).
      const newPhotoSlots = document.querySelectorAll('.photo-slot');
      for (let i = 0; i < newPhotoSlots.length; i++) {
        if (photoFiles[i]) {
          // Há foto nova para esta posição — apagar a antiga.
          await supabaseClient.from('item_images')
            .delete().eq('item_id', itemId).eq('position', i + 1);
        }
      }
    } else {
      // ── CRIAR ───────────────────────────────────────
      const { data: item, error } = await supabaseClient
        .from('items')
        .insert({ ...itemData, owner_id: userId, status: 'disponivel' })
        .select('id').single();
      if (error) throw error;
      itemId = item.id;
    }

    // Upload das fotos NOVAS (photoFiles) para o Supabase Storage.
    // Percorre o array por índice para saber a "posição" (i+1) de
    // cada foto, que é usada tanto no caminho do ficheiro no Storage
    // como na coluna `position` da tabela item_images.
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];
      if (!file) continue; // sem foto nova nesta posição — não faz nada (mantém a existente, se houver)

      const ext      = file.name.split('.').pop();
      const filePath = `${itemId}/${i + 1}.${ext}`;

      const { error: upErr } = await supabaseClient.storage
        .from('item-images').upload(filePath, file, { upsert: true, contentType: file.type });
      if (upErr) { console.warn('[AddItem] Upload erro:', upErr.message); continue; } // erro numa foto não interrompe o upload das restantes

      const { data: urlData } = supabaseClient.storage
        .from('item-images').getPublicUrl(filePath);

      // Guarda o URL público na tabela item_images, com upsert
      // (substitui se já existir uma linha com este item_id+position).
      // O sufixo "?t=" + timestamp é cache-busting: como o filePath
      // (e portanto o URL base) é sempre o mesmo ao reenviar uma foto
      // para a mesma posição, sem este truque o browser poderia
      // continuar a mostrar a imagem antiga em cache.
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

/**
 * showMsg
 * -------
 * Helper de feedback de UI usado em todo o formulário: escreve a
 * mensagem no elemento indicado, aplica um estilo inline (verde para
 * sucesso, vermelho para erro) e faz scroll automático até ao
 * elemento (scrollIntoView) para garantir que a mensagem é vista,
 * mesmo que o formulário seja longo e a mensagem apareça fora da
 * área visível atual.
 *
 * @param {string} id - id do elemento de feedback.
 * @param {string} msg - texto a mostrar.
 * @param {'error'|'success'} type - determina a cor usada.
 */
function showMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.cssText = `display:block;padding:12px 16px;border-radius:10px;margin-bottom:12px;font-family:"Berlin",sans-serif;font-size:14px;color:${type==='error'?'#c0392b':'#016e58'};background:${type==='error'?'rgba(192,57,43,0.08)':'rgba(1,110,88,0.08)'};`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
