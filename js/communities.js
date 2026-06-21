/* ─────────────────────────────────────────────────────────────────
   Lógica da página de listagem de comunidades (communities.html),
   dividida em 4 secções principais que aparecem na página:
     1. "As minhas comunidades"      → loadMyCommunities()
     2. "Comunidades perto de mim"   → loadNearbyCommunities()
     3. "Sugestões para ti"          → loadSuggestions()
     4. Pesquisa de comunidades      → searchCommunities() + debounce

   Tal como em home.js, o padrão de acesso a dados é sempre o mesmo:
     a) ir buscar as comunidades relevantes (filtros diferentes por secção);
     b) ir buscar a CONTAGEM de membros de cada uma, fazendo um SELECT
        de todas as linhas de communities_members para esses ids e
        agregando manualmente em memória (memberMap), porque a anon
        key não permite fazer COUNT/GROUP BY diretamente via REST;
     c) gerar o HTML dos cards.

   Há também um sistema de "bottom sheets" (modais que deslizam de
   baixo para cima) para cada secção, que mostram a LISTA COMPLETA
   quando o utilizador clica em "ver todas".
───────────────────────────────────────────────────────────────────── */

/* ── Funções genéricas de "Sheet" (bottom-sheet/modal) ──────────────
   Reutilizadas por qualquer secção: abrem/fecham o modal identificado
   por id, e bloqueiam o scroll de fundo enquanto estiver aberto.
   Aparecem ANTES do resto do ficheiro porque são usadas logo no
   DOMContentLoaded (ver mais abaixo, "Ver todas").
───────────────────────────────────────────────────────────────────── */

/**
 * openSheet
 * ---------
 * Abre o bottom-sheet identificado por `id`, mostrando também o
 * overlay escurecido de fundo (#sheet-overlay) e bloqueando o
 * scroll da página por trás.
 *
 * @param {string} id - id do elemento .bottom-sheet a mostrar.
 */
function openSheet(id) {
  document.getElementById('sheet-overlay').classList.add('active');
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

/**
 * closeSheet
 * ----------
 * Fecha QUALQUER bottom-sheet que esteja aberto (percorre todos os
 * .bottom-sheet e remove a classe "active" de todos, não só do
 * último aberto) e repõe o scroll normal da página.
 */
function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('active');
  document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('active'));
  document.body.style.overflow = '';
}

// Fechar qualquer sheet aberto com a tecla ESC.
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/**
 * Ponto de entrada da página communities.html. Corre quando o DOM
 * está pronto:
 *   1. Garante autenticação (requireAuth).
 *   2. Carrega as 3 secções principais em paralelo (Promise.all),
 *      já que são independentes umas das outras.
 *   3. Liga os links "Ver todas" de cada secção ao sheet
 *      correspondente, identificando a secção pelo TEXTO do título
 *      (.section-title) em vez de por um id fixo — uma forma simples
 *      (mas um pouco frágil, porque depende do texto exato em PT)
 *      de relacionar o link com o sheet certo.
 *   4. Regista delegação de eventos para clique nos cards de
 *      comunidade (tanto .comm-card como .my-comm-card), navegando
 *      para community_detail.html — exceto se o clique foi no ícone
 *      de aderir (.comm-add-icon) ou no botão de criar (.btn-criar).
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  const userId = session.user.id;

  await Promise.all([
    loadMyCommunities(userId),
    loadNearbyCommunities(userId),
    loadSuggestions(userId),
  ]);

  // Ver todas — abrir modais.
  // Em vez de cada link ter um id/atributo data- a indicar qual sheet
  // abrir, esta lógica lê o texto do título da secção pai e decide
  // por correspondência parcial de palavras-chave em português.
  document.querySelectorAll('.section-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const title = this.closest('.section-header')?.querySelector('.section-title')?.textContent?.trim();
      if (title?.includes('minhas')) openSheet('sheet-my-communities');
      else if (title?.includes('perto')) openSheet('sheet-nearby');
      else if (title?.includes('Sugest')) openSheet('sheet-suggestions');
      else if (title?.includes('Novas') || title?.includes('Comunidades')) openSheet('sheet-nearby');
    });
  });

  // Delegação de eventos — clique em comm-card (sugestões/perto de
  // mim) ou my-comm-card (as minhas comunidades). Não navega se o
  // clique foi no ícone de aderir ou no botão "criar comunidade".
  document.addEventListener('click', function (e) {
    const card = e.target.closest('.comm-card, .my-comm-card');
    if (card && !e.target.closest('.comm-add-icon, .btn-criar')) {
      const commId = card.dataset.id;
      if (commId) window.location.href = 'community_detail.html?id=' + commId;
    }
  });
});

/**
 * loadMyCommunities
 * -------------------
 * Carrega as comunidades de que o utilizador atual JÁ é membro
 * (independentemente de ser "member" ou "admin"), mostrando:
 *   - a sua role/badge (Admin ou Membro) em cada card;
 *   - o número de membros de cada comunidade;
 *   - tanto no carrossel principal (#my-communities) como na versão
 *     em lista completa do bottom-sheet (#sheet-my-list).
 *
 * Fluxo de dados:
 *   1. SELECT a communities_members filtrando por user_id — dá a
 *      lista de community_id + role do utilizador.
 *   2. Se não houver nenhuma (erro ou lista vazia), mostra mensagem
 *      "Ainda não fazes parte de nenhuma comunidade." e termina.
 *   3. Constrói roleMap (community_id → role) a partir do passo 1.
 *   4. SELECT aos dados das comunidades (nome, imagem, localização)
 *      cujo id esteja na lista obtida (.in('id', commIds)).
 *   5. SELECT à contagem de membros de todas essas comunidades
 *      (agregada manualmente em memberMap).
 *   6. Desenha o sheet (lista completa) e o carrossel (cards com
 *      badge de role).
 *
 * @param {string} userId
 */
async function loadMyCommunities(userId) {
  const container = document.getElementById('my-communities');
  if (!container) return;

  const { data: memberships, error } = await supabaseClient
    .from('communities_members')
    .select('role, community_id')
    .eq('user_id', userId);

  if (error || !memberships?.length) {
    container.innerHTML = '<p style="padding:16px;font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45)">Ainda não fazes parte de nenhuma comunidade.</p>';
    return;
  }

  const commIds = memberships.map(m => m.community_id);
  const roleMap = {};
  memberships.forEach(m => { roleMap[m.community_id] = m.role; });

  const { data: communities } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, location')
    .in('id', commIds);

  // Contar membros (mesma técnica de agregação manual usada em todo
  // o ficheiro: SELECT em massa + reduce/forEach em memória).
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  if (!communities?.length) return;

  // Popula a versão completa em lista (sheet).
  const sheetList = document.getElementById('sheet-my-list');
  if (sheetList) {
    sheetList.innerHTML = communities.map(comm => {
      const members = memberMap[comm.id] || 0;
      // isMember = true sempre aqui, porque esta secção É a lista
      // de comunidades de que o utilizador já é membro.
      return renderCommListItem(comm, members, true, userId);
    }).join('');
  }

  // Popula o carrossel principal, com badge "Admin"/"Membro".
  container.innerHTML = communities.map(comm => {
    const role    = roleMap[comm.id] === 'admin' ? 'Admin' : 'Membro';
    const badgeCls = roleMap[comm.id] === 'admin' ? 'admin' : 'membro';
    const members = memberMap[comm.id] || 0;
    const img     = comm.image_url || 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=120&h=120&fit=crop';

    return `
      <div class="my-comm-card" data-id="${comm.id}" style="cursor:pointer">
        <div class="my-comm-thumb">
          <img src="${img}" alt="${comm.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" onerror="this.style.display='none'">
        </div>
        <div class="my-comm-info">
          <div class="my-comm-name">${comm.name}</div>
          <div class="my-comm-location">${comm.location || ''}</div>
          <div class="my-comm-members">${members} membros</div>
        </div>
        <span class="my-comm-badge ${badgeCls}">${role}</span>
      </div>
    `;
  }).join('');
}

/**
 * loadNearbyCommunities
 * -----------------------
 * Carrega até 8 comunidades PÚBLICAS recentes (secção "Comunidades
 * perto de mim" — note-se que, tal como em home.js, a "proximidade"
 * aqui não é geográfica real, é apenas mais-recentes-primeiro).
 *
 * Diferença importante face a loadMyCommunities: aqui o utilizador
 * PODE já ser membro de algumas destas comunidades (não são
 * excluídas da query), e por isso cada card precisa de saber
 * individualmente se o utilizador já aderiu (isMember), para
 * desenhar o botão de "Aderir" desativado quando já é membro, em
 * vez de simplesmente não mostrar a comunidade.
 *
 * Fluxo:
 *   1. SELECT até 8 comunidades públicas, mais recentes primeiro.
 *   2. SELECT a communities_members para saber quais destas 8 o
 *      utilizador já integra (myCommIds, um Set para lookup rápido).
 *   3. Contar membros de cada uma (memberMap, mesmo padrão habitual).
 *   4. Desenhar sheet + carrossel, com o botão de aderir
 *      condicional a isMember.
 *
 * @param {string} userId
 */
async function loadNearbyCommunities(userId) {
  const container = document.getElementById('nearby-scroll');
  if (!container) return;

  // Buscar todas as comunidades públicas (mais recentes primeiro).
  const { data: communities } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, location')
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(8);

  if (!communities?.length) return;

  // Verificar de quais destas o utilizador já faz parte.
  const commIds = communities.map(c => c.id);
  const { data: myMemberships } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .eq('user_id', userId)
    .in('community_id', commIds);

  const myCommIds = new Set((myMemberships || []).map(m => m.community_id));

  // Contar membros.
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  // Popula sheet (lista completa).
  const sheetNearby = document.getElementById('sheet-nearby-list');
  if (sheetNearby) {
    sheetNearby.innerHTML = communities.map(comm => {
      const members  = memberMap[comm.id] || 0;
      const isMember = myCommIds.has(comm.id);
      return renderCommListItem(comm, members, isMember, userId);
    }).join('');
  }

  // Popula carrossel principal.
  container.innerHTML = communities.map(comm => {
    const img     = comm.image_url || 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=160&fit=crop';
    const members = memberMap[comm.id] || 0;
    const isMember = myCommIds.has(comm.id);

    return `
      <div class="comm-card" data-id="${comm.id}" style="cursor:pointer">
        <div class="comm-card-img">
          <img src="${img}" alt="${comm.name}" onerror="this.src='https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=160&fit=crop'">
        </div>
        <div class="comm-card-info">
          <div class="comm-card-name">${comm.name}</div>
          <div class="comm-card-meta">
            <span class="comm-location">
              <svg viewBox="0 0 10 13" width="10" height="12" style="flex-shrink:0"><path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S4.17 3.5 5 3.5 6.5 4.17 6.5 5 5.83 6.5 5 6.5z" fill="rgba(23,42,58,0.6)"/></svg>
              ${comm.location || 'Portugal'}
            </span>
            <span class="comm-people">
              <img src="images/Icons/icone2@4x-8.png" style="width:13px;height:13px;object-fit:contain">
              ${members} pessoa${members !== 1 ? 's' : ''}
            </span>
          </div>
          ${!isMember
            ? `<img class="comm-add-icon" src="images/Icons/add_circle.png" alt="Aderir" onclick="joinCommunity(event,'${comm.id}',this)">`
            : `<img class="comm-add-icon" src="images/Icons/add_circle.png" alt="Membro" style="opacity:0.3;pointer-events:none">`
          }
        </div>
      </div>
    `;
  }).join('');
}

/**
 * loadSuggestions
 * -----------------
 * Carrega comunidades públicas que o utilizador AINDA NÃO integra
 * (secção "Sugestões para ti") — ao contrário de loadNearbyCommunities,
 * aqui são explicitamente EXCLUÍDAS as comunidades onde já é membro
 * (usando .not('id','in', ...)), por isso todos os cards desta
 * secção mostram sempre o botão de "Aderir" ativo (isMember é
 * sempre false ao desenhar o card/sheet).
 *
 * Fluxo:
 *   1. SELECT a communities_members do utilizador → myCommIds.
 *   2. SELECT a communities públicas, excluindo myCommIds (se
 *      houver alguma), limitado a 8.
 *   3. Se não restar nenhuma comunidade (já é membro de todas),
 *      mostra mensagem "Já fazes parte de todas as comunidades
 *      disponíveis!".
 *   4. Contar membros (memberMap).
 *   5. Desenhar sheet + carrossel.
 *
 * @param {string} userId
 */
async function loadSuggestions(userId) {
  const container = document.getElementById('suggestions-scroll');
  if (!container) return;

  // Buscar comunidades de que o utilizador NÃO faz parte.
  const { data: myMemberships } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .eq('user_id', userId);

  const myCommIds = (myMemberships || []).map(m => m.community_id);

  let query = supabaseClient
    .from('communities')
    .select('id, name, image_url, location')
    .eq('is_private', false)
    .limit(8);

  if (myCommIds.length > 0) {
    query = query.not('id', 'in', `(${myCommIds.join(',')})`);
  }

  const { data: communities } = await query;

  if (!communities?.length) {
    container.innerHTML = '<p style="padding:16px;font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45)">Já fazes parte de todas as comunidades disponíveis!</p>';
    return;
  }

  // Contar membros.
  const commIds = communities.map(c => c.id);
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  // Popula sheet.
  const sheetSugg = document.getElementById('sheet-suggestions-list');
  if (sheetSugg) {
    sheetSugg.innerHTML = communities.map(comm => {
      const members = memberMap[comm.id] || 0;
      return renderCommListItem(comm, members, false, userId);
    }).join('');
  }

  container.innerHTML = communities.map(comm => {
    const img     = comm.image_url || 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=160&fit=crop';
    const members = memberMap[comm.id] || 0;

    return `
      <div class="comm-card" data-id="${comm.id}" style="cursor:pointer">
        <div class="comm-card-img">
          <img src="${img}" alt="${comm.name}" onerror="this.src='https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=160&fit=crop'">
        </div>
        <div class="comm-card-info">
          <div class="comm-card-name">${comm.name}</div>
          <div class="comm-card-meta">
            <span class="comm-location">
              <svg viewBox="0 0 10 13" width="10" height="12" style="flex-shrink:0"><path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S4.17 3.5 5 3.5 6.5 4.17 6.5 5 5.83 6.5 5 6.5z" fill="rgba(23,42,58,0.6)"/></svg>
              ${comm.location || 'Portugal'}
            </span>
            <span class="comm-people">
              <img src="images/Icons/icone2@4x-8.png" style="width:13px;height:13px;object-fit:contain">
              ${members} pessoa${members !== 1 ? 's' : ''}
            </span>
          </div>
          <img class="comm-add-icon" src="images/Icons/add_circle.png" alt="Aderir" onclick="joinCommunity(event,'${comm.id}',this)">
        </div>
      </div>
    `;
  }).join('');
}

/**
 * joinCommunity
 * --------------
 * Handler partilhado pelos vários botões de "Aderir" (carrosséis e
 * sheets) desta página. Faz upsert na tabela communities_members
 * com role 'member' (upsert para ser seguro contra cliques
 * duplicados / já ser membro por algum outro motivo).
 *
 * Diferença em relação ao joinCommunity de home.js: aqui, depois de
 * aderir com sucesso, RECARREGA explicitamente a secção "as minhas
 * comunidades" (loadMyCommunities) para que o novo card apareça
 * imediatamente nessa lista, já que estamos na própria página de
 * comunidades (faz sentido manter tudo sincronizado visualmente).
 *
 * @param {Event} event
 * @param {string} communityId
 * @param {HTMLElement} btn - ícone clicado.
 */
async function joinCommunity(event, communityId, btn) {
  event.stopPropagation();

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { error } = await supabaseClient
    .from('communities_members')
    .upsert({ community_id: communityId, user_id: session.user.id, role: 'member' });

  if (!error) {
    // Substituir botão por "Membro" (efeito visual imediato).
    btn.style.opacity = '0.3'; btn.style.pointerEvents = 'none';
    // Recarregar "as minhas comunidades" para refletir a nova adesão.
    const { data: { session: s } } = await supabaseClient.auth.getSession();
    loadMyCommunities(s.user.id);
  }
}


/**
 * renderCommListItem
 * --------------------
 * Helper de UI partilhado pelas 3 secções (minhas/perto/sugestões)
 * para desenhar uma linha da versão em LISTA (usada dentro dos
 * bottom-sheets, quando o utilizador clica "Ver todas"). Mostra
 * imagem, nome, localização, número de membros, e:
 *   - se isMember=false → ícone de "Aderir" (com stopPropagation
 *     extra para não disparar a navegação do onclick do contentor pai);
 *   - se isMember=true  → badge de texto "Membro" (sem ação).
 *
 * @param {Object} comm - linha da tabela communities.
 * @param {number} members - número de membros já calculado.
 * @param {boolean} isMember - se o utilizador atual já é membro.
 * @param {string} userId - (não usado diretamente no HTML gerado,
 *        mas mantido na assinatura para consistência/possível uso futuro).
 * @returns {string} HTML da linha.
 */
function renderCommListItem(comm, members, isMember, userId) {
  const img = comm.image_url || 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=100&h=100&fit=crop';
  return `
    <div class="comm-list-item" onclick="closeSheet();window.location.href='community_detail.html?id=${comm.id}'">
      <div class="comm-list-thumb"><img src="${img}" alt="${comm.name}"></div>
      <div class="comm-list-info">
        <div class="comm-list-name">${comm.name}</div>
        <div class="comm-list-meta">
          <span>📍 ${comm.location || 'Portugal'}</span>
          <span>👥 ${members} pessoa${members !== 1 ? 's' : ''}</span>
        </div>
      </div>
      ${!isMember
        ? `<img class="comm-add-icon-sm" src="images/Icons/add_circle.png" alt="Aderir" onclick="event.stopPropagation();joinCommunity(event,'${comm.id}',this)">`
        : `<span style="font-size:11px;color:var(--dark-green);font-family:'Berlin',sans-serif;white-space:nowrap;background:rgba(1,110,88,0.1);padding:4px 10px;border-radius:50px">Membro</span>`
      }
    </div>
  `;
}

/* ───────────────────────────────────────────────────────────────
   Pesquisa de comunidades (overlay fullscreen)
   ─────────────────────────────────────────────────────────────── */

// Timer do debounce (igual ao padrão usado em home.js).
let _searchTimeout = null;

/**
 * openSearch
 * ----------
 * Abre o overlay de pesquisa e foca o campo de input (com pequeno
 * delay, igual ao home.js, para garantir que o display já mudou
 * antes de tentar focar).
 */
function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('search-real-input')?.focus(), 100);
}

/**
 * closeSearch
 * -----------
 * Fecha o overlay e limpa todo o estado (texto, resultados, botão
 * de limpar), repondo o scroll normal da página.
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
 * Limpa apenas o texto/resultados, mantendo o overlay aberto (botão
 * "X" dentro da caixa de pesquisa).
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
 * Debounce de 300ms (igual ao de home.js), mas aqui dispara
 * searchCommunities() em vez de performSearch() — esta pesquisa só
 * cobre comunidades, não itens (faz sentido, já que estamos na
 * página dedicada a comunidades).
 *
 * @param {string} query
 */
function handleSearch(query) {
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
  clearTimeout(_searchTimeout);
  if (!query.trim()) { document.getElementById('search-results').innerHTML = ''; return; }
  _searchTimeout = setTimeout(() => searchCommunities(query.trim()), 300);
}

/**
 * searchCommunities
 * -------------------
 * Pesquisa comunidades pelo nome (ilike, case-insensitive,
 * substring), até 20 resultados. Note que, ao contrário das outras
 * secções desta página, esta pesquisa NÃO filtra por is_private —
 * mostra tanto públicas como privadas nos resultados (mas indica
 * visualmente "🔒 Privada" / "🌐 Pública" em cada resultado).
 *
 * Depois de obter os resultados, faz mais um pedido para contar
 * membros de todas as comunidades encontradas (memberMap, mesmo
 * padrão de sempre) e desenha a lista de resultados clicáveis.
 *
 * @param {string} query
 */
async function searchCommunities(query) {
  const container = document.getElementById('search-results');
  container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(255,255,255,0.5);text-align:center;padding:32px 0">A pesquisar...</p>';

  const { data: communities } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, location, is_private')
    .ilike('name', `%${query}%`)
    .limit(20);

  if (!communities?.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 20px">
        <div style="font-size:48px;margin-bottom:12px">🔍</div>
        <p style="font-family:'Berlin',sans-serif;font-size:16px;color:rgba(255,255,255,0.6)">Sem resultados para "${query}"</p>
      </div>`;
    return;
  }

  const ids = communities.map(c => c.id);
  const { data: members } = await supabaseClient
    .from('communities_members').select('community_id').in('community_id', ids);
  const memberMap = {};
  (members || []).forEach(m => { memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1; });

  container.innerHTML = `
    <div style="font-family:'Berlin',sans-serif;font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px">
      ${communities.length} resultado${communities.length !== 1 ? 's' : ''}
    </div>
    ${communities.map(comm => `
      <div onclick="closeSearch();window.location.href='community_detail.html?id=${comm.id}'"
           style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.07);border-radius:14px;margin-bottom:8px;cursor:pointer"
           onmouseover="this.style.background='rgba(255,255,255,0.12)'"
           onmouseout="this.style.background='rgba(255,255,255,0.07)'">
        <div style="width:52px;height:52px;border-radius:10px;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,0.1)">
          ${comm.image_url ? `<img src="${comm.image_url}" style="width:100%;height:100%;object-fit:cover">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px">👥</div>'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-family:'Berlin',sans-serif;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${comm.name}</div>
          <div style="font-family:'Berlin',sans-serif;font-size:12px;color:rgba(255,255,255,0.45);margin-top:3px">
            📍 ${comm.location || 'Portugal'} · 👥 ${memberMap[comm.id] || 0} membros · ${comm.is_private ? '🔒 Privada' : '🌐 Pública'}
          </div>
        </div>
        <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)" width="18" height="18"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </div>
    `).join('')}
  `;
}

// Fechar overlay de pesquisa com ESC.
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });
