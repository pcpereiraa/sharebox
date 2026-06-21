/* ─────────────────────────────────────────────────────────────────
   Lógica da página de detalhe de um item (item_detail.html?id=...).
   É provavelmente a página mais "rica" da aplicação em termos de
   regras de negócio, porque a interface muda de forma significativa
   dependendo de quem está a ver a página:

     - DONO do item   → vê botões de gestão (editar, marcar como
                         doado, reativar) em vez de "contactar".
     - VISITANTE       → vê botão de favorito e botão de "Contactar
                         anunciante" (que abre o chat), e o botão de
                         contactar fica desativado se o item já foi doado.

   Outras responsabilidades:
     - Carregar e mostrar a galeria de imagens do item (com troca de
       imagem principal ao clicar nas miniaturas).
     - Mostrar dados do dono (nome, avatar, link para o perfil).
     - Mostrar dados da comunidade associada ao item, se existir
       (e escondê-la completamente se o item não pertencer a
       nenhuma comunidade).
     - Gerir favoritos (com atualização "otimista" do contador de
       likes, antes mesmo de a BD confirmar).
     - Marcar/reativar o estado de doado.
     - Partilhar o item (Web Share API, com fallback para copiar
       o link).
     - Mostrar uma lista de "Mais itens" (sugestões) no fundo da página.
───────────────────────────────────────────────────────────────────── */

/* Estado do módulo: guarda dados do item atual para serem usados
   por várias funções sem ter de os voltar a procurar no DOM ou na
   BD repetidamente (ex: _itemId é necessário em quase todas as
   funções de ação: favoritar, marcar como doado, editar, etc.). */
let _itemId    = null;  // id do item mostrado nesta página (vem da query string ?id=)
let _ownerId   = null;  // id do dono do item (para montar o link de chat)
let _userId    = null;  // id do utilizador autenticado a ver a página
let _itemTitle = null;  // título do item (usado em confirmações e partilha)

/**
 * Ponto de entrada da página:
 *   1. Garante autenticação.
 *   2. Lê o id do item a partir da query string (?id=...). Se não
 *      existir (alguém acedeu à página sem parâmetro), redireciona
 *      para home.html — não há nada para mostrar.
 *   3. Carrega o item principal (loadItem) e a lista de sugestões
 *      "Mais itens" (loadMoreItems), sequencialmente (await em
 *      cada uma, não Promise.all aqui — não é crítico para a
 *      performance porque a secção de sugestões não bloqueia a
 *      visualização do item principal, mas o código está escrito
 *      de forma sequencial mesmo assim).
 */
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

/**
 * loadItem
 * --------
 * Função central da página: carrega TODOS os dados necessários para
 * desenhar o detalhe de um item e preenche o DOM diretamente
 * (não usa um template/render separado — manipula elementos
 * existentes no HTML por seletor).
 *
 * Sequência de pedidos à BD (a maioria não pode ser paralelizada
 * de forma trivial porque alguns dependem do resultado do item,
 * como o community_id ou category_id):
 *   1. items (dados principais do item).
 *   2. item_images (galeria) — ordenadas por `position`.
 *   3. profiles (dados do dono).
 *   4. categories (nome da categoria, só se item.category_id existir).
 *   5. communities + contagem de membros (só se item.community_id
 *      existir) — dentro de um try/catch porque é um bloco "best
 *      effort": se falhar, a página continua a funcionar sem secção
 *      de comunidade.
 *   6. favorites — contagem total de likes do item (count exact).
 *   7. favorites — verificação se O PRÓPRIO utilizador já favoritou
 *      este item (só quando não é o dono, porque o dono não
 *      favorita os seus próprios itens na UI).
 *
 * Depois de obter os dados, a função escreve tudo no DOM: galeria,
 * título, tags de estado/condição/tipo, localização, descrição,
 * detalhes (categoria/condição/forma de entrega), bloco do
 * anunciante, bloco da comunidade, e por fim decide o conteúdo da
 * barra inferior (renderBottomBar) consoante isOwner.
 *
 * @param {string} itemId
 */
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

  // Buscar imagens (ordenadas pela coluna `position`, para a galeria
  // aparecer sempre na mesma ordem definida ao criar o item).
  const { data: images } = await supabaseClient
    .from('item_images').select('image_url, position').eq('item_id', itemId).order('position');

  // Buscar dono.
  const { data: owner } = await supabaseClient
    .from('profiles').select('id, full_name, avatar_url').eq('id', item.owner_id).single();

  // Buscar categoria — só faz o pedido se o item tiver category_id
  // (operador ternário evita um pedido inútil .eq('id', null)).
  const { data: category } = item.category_id ? await supabaseClient
    .from('categories').select('name').eq('id', item.category_id).single() : { data: null };

  // Buscar comunidade associada ao item (se existir) e o respetivo
  // número de membros. Tudo dentro de um try/catch porque é
  // informação "extra" — se esta parte falhar por algum motivo, não
  // deve impedir o resto da página de carregar.
  let community = null;
  let communityMembers = 0;
  if (item.community_id) {
    try {
      // maybeSingle() em vez de single(): não dá erro se não
      // encontrar nenhuma linha (ex: comunidade apagada depois do
      // item ter sido criado) — simplesmente devolve null.
      const { data: comm } = await supabaseClient
        .from('communities').select('id, name, location').eq('id', item.community_id).maybeSingle();
      community = comm;

      if (community) {
        // count: 'exact', head: true → pede só a contagem de linhas,
        // sem trazer os dados (mais rápido/eficiente do que
        // descarregar todas as linhas só para fazer .length).
        const { count } = await supabaseClient
          .from('communities_members')
          .select('*', { count: 'exact', head: true })
          .eq('community_id', community.id);
        communityMembers = count || 0;
      }
    } catch {}
  }

  const mainImg = images?.[0]?.image_url || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&h=500&fit=crop';

  // ── Galeria ───────────────────────────────────────────
  const mainImgEl = document.getElementById('gallery-main-img');
  if (mainImgEl) mainImgEl.src = mainImg;

  const thumbsEl = document.querySelector('.gallery-thumbs');
  if (thumbsEl && images?.length) {
    // A primeira miniatura começa marcada como "active" (corresponde
    // à imagem principal mostrada inicialmente).
    thumbsEl.innerHTML = images.map((img, i) => `
      <div class="gallery-thumb ${i === 0 ? 'active' : ''}" onclick="switchImg(this, '${img.image_url}')">
        <img src="${img.image_url}" alt="">
      </div>`).join('');
  }

  // ── Info principal ────────────────────────────────────
  const titleEl = document.querySelector('.item-title');
  if (titleEl) titleEl.textContent = item.title || '—';

  // Contagem real de favoritos (likes) — pedido separado, igual à
  // técnica usada para contar membros de comunidade (count exact,
  // head true).
  const { count: likesCount } = await supabaseClient
    .from('favorites')
    .select('*', { count: 'exact', head: true })
    .eq('item_id', itemId);

  const likesEl = document.getElementById('item-likes-count');
  if (likesEl) likesEl.textContent = likesCount || 0;

  // Tags/badges de estado (disponível/doado), condição e tipo
  // (doação/troca) — geradas dinamicamente com base nos dados do item.
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

  // ── Detalhes (linha a linha, por posição no DOM) ─────
  // Nota: estas linhas assumem uma ordem FIXA de 3 .detail-row no
  // HTML (categoria, condição, forma de entrega) — não há
  // identificação por id/data-attribute, é mesmo por índice.
  const detailRows = document.querySelectorAll('.detail-row');
  if (detailRows[0]) detailRows[0].querySelector('.detail-value').textContent = category?.name || '—';
  if (detailRows[1]) detailRows[1].querySelector('.detail-value').textContent = item.condition || '—';
  if (detailRows[2]) detailRows[2].querySelector('.detail-value').textContent = 'À mão — encontro pessoal';

  const locTextEl = document.querySelector('.location-text');
  if (locTextEl) locTextEl.textContent = item.location || '—';

  // ── Bloco do anunciante (dono do item) ───────────────
  if (owner) {
    const nameEl = document.querySelector('.advertiser-name');
    if (nameEl) nameEl.textContent = owner.full_name || '—';

    const avatarEl = document.querySelector('.advertiser-avatar');
    if (avatarEl) {
      avatarEl.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#e8eef0;overflow:hidden;border-radius:50%';
      // avatarHTML() vem de auth.js — gera <img> ou ícone placeholder.
      avatarEl.innerHTML = avatarHTML(owner.avatar_url);
    }

    const perfilBtn = document.querySelector('.btn-ver-perfil');
    if (perfilBtn) perfilBtn.href = `view_profile.html?id=${owner.id}`;
  }

  // ── Bloco da comunidade ───────────────────────────────
  const commBox = document.querySelector('.community-box');
  if (commBox) {
    if (community) {
      const commName = commBox.querySelector('.community-name');
      if (commName) commName.textContent = community.name;

      const commMeta = commBox.querySelector('.community-meta');
      if (commMeta) {
        const loc = community.location || 'Portugal';
        commMeta.textContent = `${loc} · ${communityMembers} membro${communityMembers !== 1 ? 's' : ''}`;
      }

      commBox.style.cursor = 'pointer';
      commBox.onclick = () => window.location.href = `community_detail.html?id=${community.id}`;
    } else {
      // Item sem comunidade associada: esconde a secção toda (não
      // só a box), procurando o contentor de secção mais próximo;
      // se não encontrar nenhum (estrutura HTML diferente do
      // esperado), esconde pelo menos a própria commBox como fallback.
      const commSection = commBox.closest('section, .section-block, div[class*="section"]');
      if (commSection) commSection.style.display = 'none';
      else commBox.style.display = 'none';
    }
  }

  // ── Bottom bar — diferente para dono vs visitante ────
  renderBottomBar(isOwner, item.status, owner);

  // ── Favorito (só relevante para visitantes, não para o dono) ──
  if (!isOwner) {
    // maybeSingle() porque pode não existir nenhuma linha (item
    // ainda não favoritado por este utilizador) — não é um erro.
    const { data: fav } = await supabaseClient
      .from('favorites').select('item_id')
      .eq('user_id', _userId).eq('item_id', itemId).maybeSingle();

    if (fav) {
      document.querySelectorAll('#fav-toggle, #bottom-fav').forEach(btn => btn.classList.add('active'));
      updateFavIcon(true);
    }
  }
}

/**
 * renderBottomBar
 * -----------------
 * Gera o conteúdo da barra fixa no fundo da página (#bottom-bar),
 * que muda completamente dependendo de quem está a ver a página:
 *
 *   - isOwner = true, status = 'doado'   → mostra mensagem "Este
 *     item foi doado" + botão "Reativar".
 *   - isOwner = true, status != 'doado'  → mostra botão "Editar"
 *     (vai para add_item.html em modo edição) + botão "Marcar como
 *     doado".
 *   - isOwner = false                     → mostra botão de
 *     favorito + botão "Contactar anunciante" (que abre o chat com
 *     o dono, passando o id do item); se o item já foi doado, o
 *     botão fica visualmente desativado (classe btn-disabled) e o
 *     texto muda para "Item já doado", e o href aponta para '#'
 *     em vez do link de chat (não é possível contactar para um
 *     item que já foi doado).
 *
 * @param {boolean} isOwner
 * @param {string} status - 'disponivel' | 'doado'
 * @param {Object|null} owner - (recebido mas não usado diretamente
 *        aqui — mantido na assinatura por simetria com loadItem, que
 *        já tem os dados do dono carregados nesse ponto).
 */
function renderBottomBar(isOwner, status, owner) {
  const bar = document.getElementById('bottom-bar');
  if (!bar) return;

  if (isOwner) {
    // Dono — botões de gestão do item.
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
    // Visitante — favorito + contactar.
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

/**
 * markAsDonated
 * ---------------
 * Ação do dono para marcar o item como doado (status → 'doado').
 * Pede confirmação ao utilizador (confirm() nativo do browser) antes
 * de avançar, mostra estado de "A guardar..." no botão enquanto o
 * pedido está em curso, e em caso de sucesso:
 *   - troca a tag de estado (verde "Disponível" → cinzento "Doado");
 *   - reconstrói a bottom bar para a versão "doado" do dono;
 *   - mostra um toast de confirmação.
 * Em caso de erro, mostra um alert() com a mensagem e repõe o botão.
 */
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
    // Atualizar badge e bottom bar sem ter de recarregar a página inteira.
    const tagsEl = document.querySelector('.item-tags');
    if (tagsEl) {
      const availTag = tagsEl.querySelector('.tag.green');
      if (availTag) availTag.outerHTML = '<span class="tag grey">● Doado</span>';
    }
    renderBottomBar(true, 'doado', null);
    showToast('✓ Item marcado como doado!');
  }
}

/**
 * reactivateItem
 * ----------------
 * Inverso de markAsDonated: repõe o item como 'disponivel'. Também
 * pede confirmação antes de agir. Note que, ao contrário de
 * markAsDonated, esta função não trata explicitamente o caso de
 * erro (não há bloco de `else`/alert) — se o update falhar, a UI
 * simplesmente não é atualizada, mas também não há feedback de erro
 * ao utilizador (possível melhoria a apontar na defesa, se
 * perguntarem sobre tratamento de erros).
 */
async function reactivateItem() {
  if (!confirm('Queres tornar este item disponível novamente?')) return;

  const { error } = await supabaseClient
    .from('items').update({ status: 'disponivel' }).eq('id', _itemId);

  if (!error) {
    renderBottomBar(true, 'disponivel', null);
    showToast('✓ Item disponível novamente!');
  }
}

/**
 * editItem
 * --------
 * Navega para a página de criação/edição de item, em modo EDIÇÃO —
 * usa o mesmo formulário de add_item.html, mas com o parâmetro
 * ?edit=<id> que faz com que add_item.js pré-preencha os campos com
 * os dados existentes em vez de criar um item novo.
 */
function editItem() {
  window.location.href = `add_item.html?edit=${_itemId}`;
}

/**
 * toggleFav
 * ---------
 * Handler do botão de favorito nesta página (tanto o botão fixo no
 * topo #fav-toggle como o da bottom bar #bottom-fav — ambos são
 * mantidos sincronizados visualmente em conjunto).
 *
 * Faz "optimistic update": atualiza a UI (classe ativa, ícone, e
 * até o CONTADOR de likes mostrado) ANTES de esperar a resposta da
 * BD, para a interação parecer instantânea. Só depois faz o
 * delete/upsert real na tabela `favorites`.
 *
 * Nota: como o contador é atualizado de forma otimista E sem
 * reverter em caso de erro (não há tratamento de erro aqui), se o
 * pedido à BD falhar silenciosamente o contador pode ficar
 * dessincronizado da realidade até a página ser recarregada — é uma
 * simplificação aceitável para um projeto académico, mas é um ponto
 * que pode valer a pena referir na defesa como "trade-off conhecido".
 *
 * @param {HTMLElement} btn - o botão clicado (#fav-toggle ou #bottom-fav).
 */
async function toggleFav(btn) {
  const isFaved = btn.classList.contains('active');

  // Sincroniza visualmente AMBOS os botões de favorito da página
  // (pode haver dois: um no topo, outro na bottom bar).
  document.querySelectorAll('#fav-toggle, #bottom-fav').forEach(b => {
    b.classList.toggle('active', !isFaved);
  });
  updateFavIcon(!isFaved);

  // Atualizar contador localmente (otimista) — sem esperar pela BD.
  const likesEl = document.getElementById('item-likes-count');
  if (likesEl) {
    const current = parseInt(likesEl.textContent, 10) || 0;
    likesEl.textContent = isFaved ? Math.max(0, current - 1) : current + 1;
  }

  if (isFaved) {
    await supabaseClient.from('favorites').delete()
      .eq('user_id', _userId).eq('item_id', _itemId);
  } else {
    await supabaseClient.from('favorites').upsert({ user_id: _userId, item_id: _itemId });
  }
}

/**
 * updateFavIcon
 * ---------------
 * Aplica (ou remove) um filtro CSS sobre os ícones de coração para
 * os tingir de vermelho/rosa quando o item está favoritado — em vez
 * de trocar a imagem por outra versão "preenchida", usa
 * `filter: invert(...) sepia(...) hue-rotate(...)` sobre o mesmo
 * ícone PNG (truque comum para colorir um ícone monocromático sem
 * precisar de duas versões do ficheiro de imagem).
 *
 * @param {boolean} faved - true para aplicar a cor de "favoritado".
 */
function updateFavIcon(faved) {
  document.querySelectorAll('#fav-toggle img, #bottom-fav img').forEach(img => {
    img.style.filter = faved
      ? 'invert(27%) sepia(97%) saturate(1600%) hue-rotate(336deg) brightness(95%) contrast(95%)'
      : '';
  });
}

/**
 * showToast
 * ---------
 * Cria e mostra uma pequena notificação flutuante temporária
 * ("toast") no fundo do ecrã, com animação de entrada (definida em
 * CSS via a classe/keyframe "toastIn") e desaparecimento suave
 * (fade-out + leve deslocamento) depois de 2.5 segundos, sendo
 * removida do DOM no final da transição.
 *
 * O elemento é criado dinamicamente (createElement) e anexado ao
 * <body> — não depende de nenhum elemento fixo já existente no HTML.
 *
 * @param {string} msg - texto a mostrar no toast.
 */
function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--dark-green);color:#fff;font-family:"Berlin",sans-serif;font-size:14px;padding:12px 24px;border-radius:50px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);white-space:nowrap;animation:toastIn 0.3s ease;';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 8px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* ── Galeria / Partilhar item ──────────────────────────── */

/**
 * shareItem
 * ---------
 * Implementa a partilha do item usando a Web Share API nativa
 * (navigator.share), disponível principalmente em browsers móveis —
 * permite ao utilizador escolher uma app (WhatsApp, Mail, etc.) para
 * partilhar o link.
 *
 * Se a API não existir no browser atual (ex: alguns browsers de
 * desktop), faz fallback para copiar o link para a área de
 * transferência (navigator.clipboard) e mostra um toast a confirmar.
 *
 * Trata especificamente o erro "AbortError", que ocorre quando o
 * PRÓPRIO UTILIZADOR cancela a folha de partilha nativa — nesse
 * caso não há nada de errado a reportar, por isso o erro é
 * silenciosamente ignorado (só é feito console.warn para outros
 * tipos de erro, não para cancelamentos).
 */
async function shareItem() {
  const url = window.location.href;
  const title = _itemTitle || 'ShareBox';
  const text = `Vê este item no ShareBox: ${title}`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
    } catch (err) {
      // Utilizador cancelou ou erro — ignorar silenciosamente o
      // cancelamento (AbortError); outros erros ainda são logados.
      if (err.name !== 'AbortError') console.warn('[Share]', err);
    }
  } else {
    // Fallback: copiar link.
    try {
      await navigator.clipboard.writeText(url);
      showToast('🔗 Link copiado!');
    } catch {
      showToast('Não foi possível copiar o link.');
    }
  }
}

/**
 * switchImg
 * ---------
 * Troca a imagem principal da galeria para a imagem clicada numa
 * miniatura, e atualiza qual miniatura está marcada como "active"
 * (remove de todas, adiciona só à clicada).
 *
 * @param {HTMLElement} thumb - elemento .gallery-thumb clicado.
 * @param {string} url - URL da imagem a mostrar como principal.
 */
function switchImg(thumb, url) {
  document.getElementById('gallery-main-img').src = url;
  document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
}

/**
 * loadMoreItems
 * ---------------
 * Carrega uma lista de até 6 outros itens disponíveis (excluindo o
 * item atual, .neq('id', currentItemId)) para a secção "Mais itens"
 * no fundo da página de detalhe — uma forma simples de manter o
 * utilizador a navegar dentro da app depois de ver um item.
 *
 * Segue exatamente o mesmo padrão de fan-out manual (items →
 * item_images → profiles, juntos em memória) já visto em home.js e
 * communities.js.
 *
 * @param {string} currentItemId - id do item atualmente em
 *        visualização, para não o sugerir a ele próprio.
 */
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
