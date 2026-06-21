/* ─────────────────────────────────────────────────────────────────
   Lógica da página principal (home.html), responsável por:
     1. Carregar e mostrar a lista de itens disponíveis (carrossel
        "Recomendações para ti") e a lista de comunidades sugeridas.
     2. Filtrar itens por categoria (clique nos "cat-card").
     3. Gerir favoritos (coração nos cards de item).
     4. Permitir aderir rapidamente a uma comunidade direto do card.
     5. Pesquisa global (itens + comunidades) com debounce, usada no
        overlay de pesquisa fullscreen.

   Padrão de dados usado em quase toda a app (e visível já aqui):
   como o Supabase REST (com a anon key) não suporta bem JOINs
   complexos em pedidos únicos, o padrão adotado é "fan-out manual":
     a) pedir os itens (tabela items);
     b) pedir as imagens desses itens (tabela item_images) com
        .in('item_id', [...ids]);
     c) pedir os perfis dos donos (tabela profiles) com
        .in('id', [...ownerIds]);
   e depois juntar tudo em memória usando mapas (_imgMap, _profileMap)
   antes de gerar o HTML. Este padrão repete-se em communities.js,
   item_detail.js, etc.
───────────────────────────────────────────────────────────────────── */

/* ───────────────── Estado em memória (módulo) ─────────────────────
   Estas variáveis vivem no escopo global do ficheiro (não há
   módulos ES6 aqui) e funcionam como uma "cache" simples enquanto
   o utilizador está na página home.html:
     _allItems    → os últimos 10 itens disponíveis (para a secção
                    "Recomendações para ti" e para o sheet/bottom-sheet).
     _imgMap      → { item_id: image_url } — evita repetir pedidos de
                    imagem para itens já carregados.
     _profileMap  → { user_id: full_name } — idem, para nomes de donos.
     _activecat   → id da categoria atualmente selecionada (ou null
                    se nenhuma estiver ativa); usado para o "toggle"
                    de clicar na mesma categoria para desativar o filtro.
     _currentUserId → id do utilizador autenticado, guardado para não
                    ter de voltar a chamar getSession() em todo o lado.
───────────────────────────────────────────────────────────────────── */
let _allItems   = [];
let _imgMap     = {};
let _profileMap = {};
let _activecat  = null;
let _currentUserId = null;

/**
 * Ponto de entrada da página. Corre quando o DOM está pronto:
 *   1. Garante que há sessão (requireAuth) — senão, redireciona para
 *      login.html e para aqui (return).
 *   2. Carrega em paralelo (Promise.all) os itens, as comunidades e
 *      o perfil do próprio utilizador — três pedidos independentes,
 *      por isso não há razão para serem sequenciais (mais rápido).
 *   3. Carrega os favoritos do utilizador (loadUserFavorites) DEPOIS
 *      dos itens, porque precisa que os cards (.donation-card) já
 *      estejam no DOM para lhes poder marcar o coração ativo.
 *   4. Regista um único listener de clique no `document` (em vez de
 *      um listener por card) que usa `e.target.closest(...)` para
 *      descobrir em que tipo de elemento se clicou. Isto é
 *      "delegação de eventos": funciona mesmo para cards que sejam
 *      inseridos dinamicamente depois (ex: após uma pesquisa/filtro),
 *      porque não é preciso voltar a ligar listeners a cada novo card.
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return; // requireAuth já redirecionou para login.html
  _currentUserId = session.user.id;

  await Promise.all([
    loadItems(),
    loadCommunities(),
    loadUserProfile(session.user.id)
  ]);
  await loadUserFavorites(session.user.id);

  // ── Clique em categoria ──────────────────────────────
  // Delegação de eventos: um único listener no document trata
  // cliques em qualquer .cat-card, .donation-card ou .comm-card,
  // mesmo que esses elementos sejam recriados dinamicamente.
  document.addEventListener('click', async function (e) {
    const catCard = e.target.closest('.cat-card');
    if (catCard) {
      const catId   = catCard.dataset.id   || null;
      const catName = catCard.dataset.name || null;

      // Toggle — clicar na MESMA categoria já ativa remove o filtro
      // e volta a mostrar a lista geral de recomendações.
      if (_activecat === catId) {
        _activecat = null;
        document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
        renderItems(_allItems, 'Recomendações para ti');
        return;
      }

      _activecat = catId;
      document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
      catCard.classList.add('active');

      if (!catId) {
        renderItems(_allItems, 'Recomendações para ti');
        return;
      }

      // Buscar TODOS os itens desta categoria diretamente da BD
      // (não filtrar localmente, pois _allItems só tem os 10 mais
      // recentes — filtrar em memória deixaria de fora itens mais
      // antigos que pertencem à categoria escolhida).
      const container = document.getElementById('items-row');
      if (container) container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:13px;color:rgba(23,42,58,0.4);padding:8px 4px">A carregar...</p>';

      const { data: catItems, error: catErr } = await supabaseClient
        .from('items')
        .select('id, title, location, condition, type, owner_id, category_id, created_at')
        .eq('status', 'disponivel')      // só itens ainda disponíveis (não doados/reservados)
        .eq('category_id', catId)         // filtro pela categoria clicada
        .neq('owner_id', _currentUserId)  // não mostrar os próprios itens do utilizador
        .order('created_at', { ascending: false });

      if (catErr) { console.error('[Home] Erro filtro categoria:', catErr); return; }

      if (catItems?.length) {
        // Buscar imagens e perfis SÓ dos itens que ainda não estão
        // em cache (_imgMap / _profileMap) — evita pedidos repetidos
        // para dados já conhecidos de uma pesquisa/filtro anterior.
        const newIds = catItems.map(i => i.id).filter(id => !_imgMap[id]);
        if (newIds.length) {
          const { data: images } = await supabaseClient
            .from('item_images').select('item_id, image_url, position').in('item_id', newIds);
          (images || []).forEach(img => { if (!_imgMap[img.item_id]) _imgMap[img.item_id] = img.image_url; });
        }
        const ownerIds = [...new Set(catItems.map(i => i.owner_id).filter(id => id && !_profileMap[id]))];
        if (ownerIds.length) {
          const { data: profiles } = await supabaseClient
            .from('profiles').select('id, full_name').in('id', ownerIds);
          (profiles || []).forEach(p => { _profileMap[p.id] = p.full_name; });
        }
      }

      renderItems(catItems || [], catName || 'Recomendações para ti');
      return;
    }

    // ── Clique em donation-card (item) ───────────────────
    // O `!e.target.closest('.fav-btn')` garante que clicar no
    // botão de favorito (coração) DENTRO do card não navega para
    // a página de detalhe — só clicar no resto do card é que abre
    // item_detail.html.
    const donationCard = e.target.closest('.donation-card');
    if (donationCard && !e.target.closest('.fav-btn')) {
      const itemId = donationCard.dataset.id;
      if (itemId) window.location.href = 'item_detail.html?id=' + itemId;
    }

    // ── Clique em comm-card (comunidade) ─────────────────
    // Mesma lógica: clicar no ícone de "aderir" (.comm-add-icon)
    // não deve navegar para a página da comunidade.
    const commCard = e.target.closest('.comm-card');
    if (commCard && !e.target.closest('.comm-add-icon')) {
      const commId = commCard.dataset.id;
      if (commId) window.location.href = 'community_detail.html?id=' + commId;
    }
  });

});

/**
 * loadItems
 * ---------
 * Carrega os 10 itens mais recentes com status "disponivel" que NÃO
 * pertencem ao utilizador atual (não faz sentido recomendar ao
 * próprio utilizador um item que ele criou), e prepara tudo o que é
 * preciso para os desenhar: imagens (item_images) e nomes dos donos
 * (profiles).
 *
 * Fluxo:
 *   1. SELECT a items (com filtros status + neq owner_id, ordenado
 *      por mais recente, limitado a 10 — só para a home, não é a
 *      lista completa).
 *   2. Guarda o resultado em _allItems (cache de módulo, reutilizada
 *      pelo filtro de categorias e pelo "sheet" de recomendações).
 *   3. Busca em paralelo conceptual (dois pedidos, um a seguir ao
 *      outro mas sem depender um do outro) as imagens e os perfis
 *      associados a estes itens.
 *   4. Preenche os mapas globais _imgMap / _profileMap.
 *   5. Chama renderItems() para desenhar os cards e
 *      updateSheetItems() para preencher a versão do bottom-sheet
 *      (provavelmente um modal de "ver tudo").
 */
async function loadItems() {
  const container = document.getElementById('items-row');
  if (!container) return; // página sem esta secção — não faz nada

  const { data: items, error } = await supabaseClient
    .from('items')
    .select('id, title, location, condition, type, owner_id, category_id, created_at')
    .eq('status', 'disponivel')
    .neq('owner_id', _currentUserId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) { console.error('[Home] Erro items:', error); return; }
  if (!items?.length) return;

  // Guardar globalmente — usado depois no filtro por categoria
  // (para o "desativar filtro") e no sheet de recomendações.
  _allItems = items;

  // Buscar imagens de todos os itens carregados de uma só vez,
  // usando .in('item_id', [...]) em vez de N pedidos individuais
  // (1 pedido para N itens, não N pedidos).
  const itemIds = items.map(i => i.id);
  const { data: images } = await supabaseClient
    .from('item_images')
    .select('item_id, image_url, position')
    .in('item_id', itemIds);

  // Buscar perfis (nomes) dos donos, também em lote. Set() remove
  // owner_ids duplicados (vários itens podem ter o mesmo dono).
  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];
  const { data: profiles } = await supabaseClient
    .from('profiles')
    .select('id, full_name')
    .in('id', ownerIds);

  // Mapeia item_id → primeira imagem encontrada (se um item tiver
  // várias imagens, fica só com a primeira que aparecer na resposta;
  // o `if (!_imgMap[...])` evita sobrescrever).
  (images   || []).forEach(img => { if (!_imgMap[img.item_id]) _imgMap[img.item_id] = img.image_url; });
  (profiles || []).forEach(p   => { _profileMap[p.id] = p.full_name; });

  renderItems(_allItems, 'Recomendações para ti');

  // Preenche também a versão "sheet" (modal/bottom-sheet) com os
  // mesmos itens, para quando o utilizador expandir essa vista.
  updateSheetItems(_allItems);
}

/**
 * renderItems
 * -----------
 * Gera o HTML dos cards de item (carrossel "items-row") a partir de
 * uma lista de itens já carregada, usando os mapas _imgMap e
 * _profileMap para resolver imagem e nome do dono.
 *
 * Também atualiza o título da secção (ex: troca "Recomendações para
 * ti" pelo nome da categoria selecionada), exceto quando o título
 * não é passado (não toca no DOM nesse caso).
 *
 * Detalhes de implementação:
 *   - usa um onerror inline na <img> para trocar para uma imagem de
 *     fallback (Unsplash) se a URL guardada falhar a carregar —
 *     evita ícones de imagem partida.
 *   - a "distância" (dist) é só decorativa/simulada: gera um valor
 *     aleatório de "1,X km" sempre que há location, não é uma
 *     distância real calculada por geolocalização.
 *   - o botão de favorito chama toggleFav(event, itemId, this) com
 *     `event` para poder fazer stopPropagation() dentro da função e
 *     não acionar a navegação do card pai.
 *
 * @param {Array<Object>} items - itens a desenhar (já com title,
 *        location, owner_id, id, etc.)
 * @param {string} [title] - novo título para a secção (opcional).
 */
function renderItems(items, title) {
  const container = document.getElementById('items-row');
  if (!container) return;

  // Atualizar só o título das recomendações (não o de Categorias,
  // que é uma secção diferente da página).
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
    // Distância "simulada" — apenas estética, não há cálculo real de geolocalização.
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

/**
 * updateSheetItems
 * -----------------
 * Igual a renderItems, mas escreve para um contentor diferente
 * (#sheet-recomendacoes .sheet-grid-donations) — provavelmente um
 * bottom-sheet/modal que mostra a mesma lista de itens numa vista
 * expandida (ex: "ver todos"). É código praticamente duplicado de
 * renderItems por design, porque a estrutura de card é a mesma mas
 * o contentor de destino é diferente.
 *
 * @param {Array<Object>} items
 */
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

/**
 * loadCommunities
 * ----------------
 * Carrega comunidades PÚBLICAS sugeridas para o utilizador,
 * excluindo:
 *   - comunidades privadas (is_private = false no filtro);
 *   - comunidades das quais o próprio utilizador já é dono
 *     (neq owner_id);
 *   - comunidades das quais o utilizador já é MEMBRO (consulta
 *     prévia a communities_members e depois `.not('id','in', ...)`).
 *
 * Depois conta quantos membros tem cada comunidade sugerida
 * (segunda query a communities_members, agregada em memória num
 * mapa `memberMap`, já que o REST do Supabase com a anon key não
 * faz facilmente um COUNT agrupado por id em pedidos simples).
 *
 * Por fim, desenha tanto o carrossel principal (#communities-row)
 * como a versão expandida no sheet (#sheet-comunidades).
 */
async function loadCommunities() {
  const container = document.getElementById('communities-row');
  if (!container) return;

  // 1) Comunidades a que o utilizador já pertence (como membro ou
  //    admin/dono que também conste em communities_members) — para
  //    poder excluí-las da lista de "sugestões".
  const { data: myMemberships } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .eq('user_id', _currentUserId);
  const myCommIds = (myMemberships || []).map(m => m.community_id);

  // 2) Query base: comunidades públicas que não são do próprio
  //    utilizador, mais recentes primeiro, limitadas a 8 (carrossel).
  let query = supabaseClient
    .from('communities')
    .select('id, name, image_url, is_private, owner_id, created_at')
    .eq('is_private', false)
    .neq('owner_id', _currentUserId)
    .order('created_at', { ascending: false })
    .limit(8);

  // 3) Se já for membro de alguma, exclui-a explicitamente da query
  //    com NOT IN (sintaxe do PostgREST: .not('id','in','(a,b,c)')).
  if (myCommIds.length) {
    query = query.not('id', 'in', `(${myCommIds.join(',')})`);
  }

  const { data: communities, error } = await query;

  if (error || !communities?.length) return;

  // 4) Contar membros por comunidade: pede TODAS as linhas de
  //    communities_members cujo community_id esteja na lista das
  //    comunidades mostradas, e agrega manualmente em memberMap.
  const commIds = communities.map(c => c.id);
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  // 5) Desenha o carrossel principal de comunidades.
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

  // 6) Desenha a mesma lista, em formato diferente, na versão
  //    "sheet" (lista vertical em vez de carrossel horizontal).
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

/**
 * loadUserProfile
 * ----------------
 * Carrega só o primeiro nome do utilizador autenticado (full_name,
 * avatar_url) e escreve-o no elemento #user-name (típico texto de
 * saudação "Olá, <nome>" no topo da home).
 *
 * `full_name?.split(' ')[0]` extrai apenas o primeiro nome de um
 * nome completo (ex: "Plinio Rodrigues" → "Plinio").
 *
 * @param {string} userId
 */
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

/* ───────────────────────────────────────────────────────────────
   Favoritos
   ─────────────────────────────────────────────────────────────── */

// Cache local (Set, para lookup O(1)) dos IDs de item que o
// utilizador atual já marcou como favorito. Evita ter de consultar
// a BD outra vez de cada vez que se quer saber se um item está
// favoritado (ex: ao desenhar novos cards).
let _userFavIds = new Set();

/**
 * loadUserFavorites
 * -------------------
 * Carrega a lista de item_ids favoritados pelo utilizador (tabela
 * `favorites`) e marca visualmente (classe "faved") os botões de
 * coração nos cards já presentes no DOM nesse momento.
 *
 * Nota: isto só marca os cards que já existem na altura em que esta
 * função corre — se depois forem criados novos cards (ex: ao
 * filtrar por categoria), o estado de favorito tem de ser tratado
 * separadamente nessa lógica (usando _userFavIds).
 *
 * @param {string} userId
 */
async function loadUserFavorites(userId) {
  const { data: favs } = await supabaseClient
    .from('favorites')
    .select('item_id')
    .eq('user_id', userId);

  _userFavIds = new Set((favs || []).map(f => f.item_id));

  // Marcar corações nos cards existentes no DOM neste momento.
  document.querySelectorAll('.donation-card').forEach(card => {
    const itemId = card.dataset.id;
    if (itemId && _userFavIds.has(itemId)) {
      const btn = card.querySelector('.fav-btn');
      if (btn) btn.classList.add('faved');
    }
  });
}

/**
 * toggleFav
 * ---------
 * Handler do clique no botão de coração (favorito) de um card de
 * item. Faz "optimistic update" na UI (muda a classe imediatamente)
 * e sincroniza com a tabela `favorites` no Supabase:
 *   - se já estava favoritado → DELETE da linha (user_id, item_id);
 *   - se não estava → upsert (INSERT ou substitui se já existir),
 *     o que evita erro de duplicado se o utilizador clicar duas
 *     vezes rapidamente.
 *
 * `event.stopPropagation()` é crucial: impede que o clique no
 * botão "borbulhe" até ao listener de clique do card pai e dispare
 * também a navegação para item_detail.html.
 *
 * @param {Event} event   - evento de clique (para stopPropagation).
 * @param {string} itemId - id do item a favoritar/desfavoritar.
 * @param {HTMLElement} btn - o próprio botão (.fav-btn) clicado.
 */
async function toggleFav(event, itemId, btn) {
  event.stopPropagation();
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const userId = session.user.id;
  const isFaved = btn.classList.contains('faved') || _userFavIds.has(itemId);
  if (isFaved) {
    await supabaseClient.from('favorites').delete().eq('user_id', userId).eq('item_id', itemId);
    btn.classList.remove('faved');
    _userFavIds.delete(itemId);
  } else {
    await supabaseClient.from('favorites').upsert({ user_id: userId, item_id: itemId });
    btn.classList.add('faved');
    _userFavIds.add(itemId);
  }
}

/**
 * joinCommunity
 * --------------
 * Handler do ícone de "+" (aderir) num card de comunidade sugerida.
 * Faz upsert na tabela communities_members com role 'member' — usa
 * upsert (em vez de insert simples) para ser seguro mesmo que o
 * utilizador já fosse, por algum motivo, membro (não dá erro de
 * chave duplicada).
 *
 * Se a operação tiver sucesso, dá feedback visual simples no botão
 * (esbatido + pointer-events:none, para parecer "já aderiu" e
 * impedir cliques repetidos) em vez de remover o card ou recarregar
 * a lista.
 *
 * @param {Event} event
 * @param {string} communityId
 * @param {HTMLElement} btn - o ícone clicado (.comm-add-icon).
 */
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

/* ───────────────────────────────────────────────────────────────
   Pesquisa global (overlay fullscreen)
   ─────────────────────────────────────────────────────────────── */

// Guarda o timer do debounce, para poder cancelá-lo (clearTimeout)
// sempre que o utilizador continua a escrever antes do tempo passar.
let _searchTimeout = null;

/**
 * openSearch
 * ----------
 * Abre o overlay de pesquisa (fullscreen) e foca automaticamente o
 * campo de input, para o utilizador poder começar a escrever de
 * imediato. O `setTimeout` de 100ms antes do focus() é uma técnica
 * comum para esperar que o browser termine de aplicar o
 * `display:flex` antes de tentar focar (focar um elemento ainda
 * "display:none" pode falhar silenciosamente).
 *
 * Também bloqueia o scroll da página de fundo
 * (`document.body.style.overflow = 'hidden'`) enquanto o overlay
 * está aberto.
 */
function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    document.getElementById('search-real-input')?.focus();
  }, 100);
}

/**
 * closeSearch
 * -----------
 * Fecha o overlay de pesquisa e limpa todo o estado relacionado
 * (texto do input, resultados anteriores, botão de limpar) para que
 * a próxima vez que o utilizador abra a pesquisa comece "do zero".
 * Também repõe o scroll normal da página.
 */
function closeSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('search-real-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-clear').style.display = 'none';
}

/**
 * clearSearch
 * -----------
 * Limpa apenas o conteúdo da pesquisa (texto + resultados) SEM
 * fechar o overlay — usado pelo botão "X" dentro da caixa de
 * pesquisa, para o utilizador poder começar uma nova pesquisa sem
 * ter de reabrir o overlay.
 */
function clearSearch() {
  document.getElementById('search-real-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-clear').style.display = 'none';
  document.getElementById('search-real-input').focus();
}

/**
 * handleSearch
 * ------------
 * Chamado a cada tecla premida no campo de pesquisa (oninput). Não
 * pesquisa imediatamente — implementa "debounce" de 300ms: cada
 * nova tecla cancela o timer anterior (clearTimeout) e cria um novo,
 * de forma que performSearch() só é efetivamente chamada 300ms
 * DEPOIS da última tecla premida. Isto evita disparar um pedido à
 * BD a cada caractere digitado (importante para custo de pedidos e
 * para não sobrecarregar a BD com pesquisas parciais inúteis, como
 * pesquisar por "c", depois "ca", depois "cad"...).
 *
 * Também mostra/esconde o botão de "limpar" (X) dependendo se há
 * texto na caixa.
 *
 * @param {string} query - valor atual do campo de pesquisa.
 */
function handleSearch(query) {
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

  clearTimeout(_searchTimeout);
  if (!query.trim()) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }
  // Debounce de 300ms — só pesquisa depois do utilizador parar de escrever.
  _searchTimeout = setTimeout(() => performSearch(query.trim()), 300);
}

/**
 * performSearch
 * --------------
 * Executa a pesquisa efetiva (depois do debounce) em DUAS tabelas
 * em paralelo (Promise.all): items e communities, usando `ilike`
 * (LIKE case-insensitive do PostgreSQL) com `%query%` — isto é,
 * procura a substring em qualquer posição do título/nome, não
 * exige que comece por ela.
 *
 * Depois de obter os itens, faz mais um pedido para buscar as suas
 * imagens (item_images), à semelhança do padrão usado em loadItems.
 *
 * Por fim, desenha os resultados agrupados em duas secções ("Itens"
 * e "Comunidades"), ou uma mensagem de "sem resultados" se ambas as
 * pesquisas vierem vazias. Cada resultado, ao ser clicado, fecha o
 * overlay (closeSearch()) e navega para a página de detalhe
 * correspondente.
 *
 * @param {string} query - termo de pesquisa já sem espaços nas pontas.
 */
async function performSearch(query) {
  const container = document.getElementById('search-results');
  container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(255,255,255,0.5);text-align:center;padding:32px 0">A pesquisar...</p>';

  const q = query.toLowerCase(); // (não usado diretamente no ilike, mas mantido para referência/legibilidade)

  // Pesquisar itens e comunidades em paralelo — independentes uma
  // da outra, por isso não há necessidade de esperar pela primeira
  // antes de disparar a segunda.
  const [{ data: items }, { data: communities }] = await Promise.all([
    supabaseClient
      .from('items')
      .select('id, title, location, category_id, owner_id')
      .eq('status', 'disponivel')
      .ilike('title', `%${query}%`)
      .limit(10),
    supabaseClient
      .from('communities')
      .select('id, name, image_url, location')
      .ilike('name', `%${query}%`)
      .limit(5)
  ]);

  // Buscar imagens dos itens encontrados (só se houver itens, para
  // não fazer um pedido .in('item_id', []) inútil com lista vazia).
  const itemIds = (items || []).map(i => i.id);
  const { data: images } = itemIds.length
    ? await supabaseClient.from('item_images').select('item_id, image_url').in('item_id', itemIds)
    : { data: [] };
  const imgMap = {};
  (images || []).forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.image_url; });

  const totalResults = (items?.length || 0) + (communities?.length || 0);

  if (!totalResults) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 20px">
        <div style="font-size:48px;margin-bottom:12px">🔍</div>
        <p style="font-family:'Berlin',sans-serif;font-size:16px;color:rgba(255,255,255,0.6)">Sem resultados para "${query}"</p>
        <p style="font-family:'Berlin',sans-serif;font-size:13px;color:rgba(255,255,255,0.35);margin-top:8px">Tenta palavras diferentes</p>
      </div>`;
    return;
  }

  let html = '';

  // Secção "Itens" — só aparece se houver pelo menos um resultado.
  if (items?.length) {
    html += `<div style="font-family:'Berlin',sans-serif;font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px">Itens (${items.length})</div>`;
    html += items.map(item => {
      const img = imgMap[item.id];
      return `
        <div onclick="closeSearch();window.location.href='item_detail.html?id=${item.id}'"
             style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.07);border-radius:14px;margin-bottom:8px;cursor:pointer;transition:background 0.15s"
             onmouseover="this.style.background='rgba(255,255,255,0.12)'"
             onmouseout="this.style.background='rgba(255,255,255,0.07)'">
          <div style="width:52px;height:52px;border-radius:10px;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,0.1)">
            ${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover">` : ''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-family:'Berlin',sans-serif;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.title}</div>
            <div style="font-family:'Berlin',sans-serif;font-size:12px;color:rgba(255,255,255,0.45);margin-top:3px">📍 ${item.location || 'Portugal'}</div>
          </div>
          <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)" width="18" height="18"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </div>`;
    }).join('');
  }

  // Secção "Comunidades" — idem, só aparece se houver resultados.
  if (communities?.length) {
    html += `<div style="font-family:'Berlin',sans-serif;font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:20px 0 10px">Comunidades (${communities.length})</div>`;
    html += communities.map(comm => {
      return `
        <div onclick="closeSearch();window.location.href='community_detail.html?id=${comm.id}'"
             style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.07);border-radius:14px;margin-bottom:8px;cursor:pointer;transition:background 0.15s"
             onmouseover="this.style.background='rgba(255,255,255,0.12)'"
             onmouseout="this.style.background='rgba(255,255,255,0.07)'">
          <div style="width:52px;height:52px;border-radius:10px;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,0.1)">
            ${comm.image_url ? `<img src="${comm.image_url}" style="width:100%;height:100%;object-fit:cover">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px">👥</div>'}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-family:'Berlin',sans-serif;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${comm.name}</div>
            <div style="font-family:'Berlin',sans-serif;font-size:12px;color:rgba(255,255,255,0.45);margin-top:3px">📍 ${comm.location || 'Portugal'}</div>
          </div>
          <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)" width="18" height="18"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </div>`;
    }).join('');
  }

  container.innerHTML = html;
}

// Fechar o overlay de pesquisa ao premir a tecla ESC — pequena
// melhoria de usabilidade/acessibilidade, comum em overlays modais.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearch();
});
