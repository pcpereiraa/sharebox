/* ─────────────────────────────────────────────────────────────────
   Lógica da página de detalhe de uma comunidade
   (community_detail.html?id=...). Mostra:
     - cabeçalho "hero" com imagem de capa, nome, localização e
       estatísticas (data de criação, nº de itens, nº de membros);
     - dados do administrador (dono) da comunidade;
     - carrossel de itens disponíveis pertencentes a esta comunidade;
     - lista dos primeiros 5 membros, com link para ver todos num
       bottom-sheet;
     - um botão de ação principal cujo comportamento muda de acordo
       com a relação do utilizador com a comunidade:
         * é o DONO            → "Editar comunidade"
         * já é MEMBRO          → "Sair da comunidade"
         * não é membro ainda   → "+ Aderir à comunidade"

   Tal como em item_detail.js, este é um exemplo claro de UI
   condicionada pelo papel do utilizador (dono / membro / visitante).
───────────────────────────────────────────────────────────────────── */

// Estado do módulo:
let _commId  = null; // id da comunidade mostrada (vem de ?id=)
let _userId  = null; // id do utilizador autenticado atual
let _ownerId = null; // id do dono/admin desta comunidade (preenchido por loadCommunity)

/**
 * Ponto de entrada da página:
 *   1. Garante autenticação.
 *   2. Lê o id da comunidade da query string; se não existir,
 *      redireciona para communities.html.
 *   3. Carrega em paralelo (Promise.all) os 3 blocos de dados
 *      independentes: dados da comunidade, lista de itens e lista
 *      de membros.
 *   4. SÓ DEPOIS configura o botão de ação principal
 *      (setupJoinButton), porque essa função precisa de saber
 *      `_ownerId` (preenchido dentro de loadCommunity) para decidir
 *      se o utilizador é o dono — por isso corre depois do
 *      Promise.all, não dentro dele.
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;
  _userId = session.user.id;

  const params = new URLSearchParams(window.location.search);
  _commId = params.get('id');
  if (!_commId) { window.location.href = 'communities.html'; return; }

  await Promise.all([
    loadCommunity(),
    loadItems(),
    loadMembers(),
  ]);

  await setupJoinButton();
});

/**
 * loadCommunity
 * ---------------
 * Carrega os dados principais da comunidade e preenche o cabeçalho
 * "hero" da página (imagem de fundo, título, localização,
 * descrição, data de criação formatada em português) e o bloco de
 * informação do administrador (nome + avatar).
 *
 * Se a comunidade não existir (id inválido), redireciona de volta
 * para communities.html em vez de mostrar uma página vazia/com erro.
 *
 * `maybeSingle()` é usado em vez de `single()` porque é esperado
 * (e tratado explicitamente, com o `if (error || !comm)`) que possa
 * não haver nenhuma linha correspondente — não é tratado como uma
 * situação excecional/anómala do ponto de vista do Supabase.
 */
async function loadCommunity() {
  const { data: comm, error } = await supabaseClient
    .from('communities')
    .select('id, name, description, image_url, location, is_private, created_at, owner_id')
    .eq('id', _commId)
    .maybeSingle();

  if (error || !comm) { window.location.href = 'communities.html'; return; }
  _ownerId = comm.owner_id;

  // Hero.
  const heroBg = document.getElementById('hero-bg');
  if (heroBg && comm.image_url) heroBg.src = comm.image_url;

  document.getElementById('hero-title').textContent    = comm.name || '—';
  document.getElementById('hero-location').textContent = comm.location || '';
  document.getElementById('location-text').textContent = comm.location || '—';
  document.getElementById('desc-box').textContent      = comm.description || 'Sem descrição disponível.';

  // Data de criação formatada em português (ex: "jun. 2026").
  const date = new Date(comm.created_at).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
  document.getElementById('stat-date').textContent = date;

  // Admin (dono da comunidade).
  const { data: owner } = await supabaseClient
    .from('profiles').select('full_name, avatar_url').eq('id', comm.owner_id).maybeSingle();

  const adminName   = document.getElementById('admin-name');
  const adminAvatar = document.getElementById('admin-avatar');
  if (adminName)   adminName.textContent = owner?.full_name || '—';
  if (adminAvatar) {
    adminAvatar.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#e8eef0;overflow:hidden';
    adminAvatar.innerHTML = avatarHTML(owner?.avatar_url);
  }
}

/**
 * loadItems
 * ---------
 * Carrega até 10 itens disponíveis pertencentes a ESTA comunidade
 * (.eq('community_id', _commId)) e desenha-os no carrossel
 * #items-scroll, usando o padrão habitual de fan-out manual
 * (item_images + profiles juntos em memória).
 *
 * Também calcula e mostra a contagem TOTAL de itens da comunidade
 * (#stat-items) — note que esta contagem é feita SEM o filtro
 * .eq('status','disponivel'), ou seja, conta TODOS os itens
 * histórico da comunidade, incluindo os já doados, ao contrário da
 * lista que só mostra os disponíveis. É uma distinção relevante a
 * explicar na defesa: a estatística é "atividade total", o
 * carrossel é "disponível agora".
 */
async function loadItems() {
  const container = document.getElementById('items-scroll');
  if (!container) return;

  const { data: items } = await supabaseClient
    .from('items')
    .select('id, title, location, owner_id')
    .eq('community_id', _commId)
    .eq('status', 'disponivel')
    .order('created_at', { ascending: false })
    .limit(10);

  // Atualizar estatística de anúncios — conta TODOS os itens da
  // comunidade (não só os disponíveis), por isso é um pedido
  // separado, sem o filtro de status.
  const { count } = await supabaseClient
    .from('items').select('*', { count: 'exact', head: true })
    .eq('community_id', _commId);
  const statItems = document.getElementById('stat-items');
  if (statItems) statItems.textContent = count || 0;

  if (!items?.length) {
    container.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.4);padding:8px 0">Sem itens nesta comunidade.</p>';
    return;
  }

  // Buscar imagens e donos em paralelo (independentes entre si).
  const ids = items.map(i => i.id);
  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))];

  const [{ data: images }, { data: profiles }] = await Promise.all([
    supabaseClient.from('item_images').select('item_id, image_url').in('item_id', ids),
    supabaseClient.from('profiles').select('id, full_name').in('id', ownerIds)
  ]);

  const imgMap = {};
  (images || []).forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.image_url; });
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p.full_name; });

  container.innerHTML = items.map(item => {
    const img  = imgMap[item.id] || 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=200&h=140&fit=crop';
    const name = profileMap[item.owner_id] || 'Utilizador';
    return `
      <div class="item-card" onclick="window.location.href='item_detail.html?id=${item.id}'" style="cursor:pointer">
        <div class="item-card-img">
          <img src="${img}" alt="${item.title}" onerror="this.src='https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=200&h=140&fit=crop'">
        </div>
        <div class="item-card-info">
          <div class="item-card-name">${item.title}</div>
          <div class="item-card-meta">
            <div class="item-user">
              <div class="user-avatar-sm">${name.charAt(0).toUpperCase()}</div>
              <span>por ${name.split(' ')[0]}</span>
            </div>
            <div class="item-dist">${item.location?.split(',')[0] || ''}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

/**
 * loadMembers
 * -----------
 * Carrega até 20 membros (ordenados pela data em que aderiram,
 * `joined_at` ascendente — os mais antigos primeiro) e mostra os
 * primeiros 5 no bloco principal da página (#members-group). Se
 * houver mais de 5, adiciona um link "Ver todos os N participantes"
 * que abre o bottom-sheet com a lista completa (openMembersSheet).
 *
 * Atualiza também o contador (#stat-members) e o título da secção
 * (#members-title), que mostra o número total de membros
 * carregados (limitado a 20 nesta consulta — para o número exato
 * acima de 20, seria necessário um count separado, mas o código
 * atual usa o tamanho da lista obtida, que está limitada por
 * .limit(20)).
 *
 * Detalhe estético: usa uma pequena paleta de cores `colors`
 * declarada mas, neste bloco específico, não chega a ser utilizada
 * diretamente no HTML gerado (os avatares usam avatarHTML(), que
 * por sua vez usa um ícone neutro se não houver foto) — pode ser
 * resquício de uma versão anterior do código.
 */
async function loadMembers() {
  const container = document.getElementById('members-group');
  const title     = document.getElementById('members-title');
  const statEl    = document.getElementById('stat-members');
  if (!container) return;

  const { data: memberships } = await supabaseClient
    .from('communities_members')
    .select('user_id, role, joined_at')
    .eq('community_id', _commId)
    .order('joined_at', { ascending: true })
    .limit(20);

  const count = memberships?.length || 0;
  if (statEl)  statEl.textContent = count;
  if (title)   title.textContent  = `Participantes · ${count}`;

  if (!memberships?.length) return;

  const userIds = memberships.map(m => m.user_id);
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, full_name, avatar_url').in('id', userIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  const colors = ['#c8e6d4','#d4e4f0','#e8d5e8','#f0e4d4','#d4f0e4'];

  // Mostra só os primeiros 5 no bloco principal da página.
  const shown   = memberships.slice(0, 5);
  const hiddenN = count > 5 ? count - 5 : 0;

  container.innerHTML = shown.map((m, i) => {
    const p    = profileMap[m.user_id] || {};
    const name = p.full_name || 'Utilizador';
    const date = m.joined_at
      ? new Date(m.joined_at).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' })
      : '—';
    const isAdmin = m.role === 'admin';

    return `
      <div class="member-row">
        <div class="member-avatar" style="background:#e8eef0;display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${avatarHTML(p.avatar_url)}
        </div>
        <div class="member-info">
          <div class="member-name">${name}</div>
          <div class="member-sub">${isAdmin ? 'Admin' : 'Membro'} · desde ${date}</div>
        </div>
        <span class="badge ${isAdmin ? 'admin' : 'membro'}">${isAdmin ? 'Admin' : 'Membro'}</span>
      </div>
      ${i < shown.length - 1 ? '<div class="member-divider"></div>' : ''}
    `;
  }).join('');

  // Se houver mais membros do que os 5 mostrados, acrescenta um
  // link para abrir a lista completa no bottom-sheet.
  if (hiddenN > 0) {
    container.innerHTML += `<a class="ver-todos-link" href="#" onclick="openMembersSheet();return false;">Ver todos os ${count} participantes →</a>`;
  }
}

/**
 * setupJoinButton
 * -----------------
 * Decide o texto/comportamento do botão de ação principal
 * (.btn-aderir) consoante a relação do utilizador atual com a
 * comunidade:
 *
 *   1. Consulta communities_members para saber se o utilizador
 *      atual já é membro (maybeSingle() — pode não existir nenhuma
 *      linha, o que é o caso normal de "ainda não é membro").
 *   2. isOwner é calculado comparando _userId com _ownerId
 *      (preenchido por loadCommunity, daí ter de correr DEPOIS do
 *      Promise.all no DOMContentLoaded).
 *   3. Define o texto e o handler de clique do botão:
 *      - dono             → "Editar comunidade" → navega para
 *        add_community.html?edit=<id>;
 *      - membro (não dono) → "Sair da comunidade" (com estilo
 *        vermelho de aviso) → chama leaveCommunity;
 *      - nem dono nem membro → "+ Aderir à comunidade" → chama
 *        joinCommunity.
 */
async function setupJoinButton() {
  const btn = document.querySelector('.btn-aderir');
  if (!btn) return;

  const { data: membership } = await supabaseClient
    .from('communities_members')
    .select('role')
    .eq('community_id', _commId)
    .eq('user_id', _userId)
    .maybeSingle();

  const isOwner  = _userId === _ownerId;
  const isMember = !!membership;

  if (isOwner) {
    btn.textContent = '✏️ Editar comunidade';
    btn.onclick = () => window.location.href = `add_community.html?edit=${_commId}`;
  } else if (isMember) {
    btn.textContent = 'Sair da comunidade';
    btn.style.background = 'rgba(192,57,43,0.15)';
    btn.style.color      = '#c0392b';
    btn.onclick = leaveCommunity;
  } else {
    btn.textContent = '+ Aderir à comunidade';
    btn.onclick = joinCommunity;
  }
}

/**
 * joinCommunity
 * --------------
 * Handler do botão quando o utilizador ainda não é membro. Faz
 * upsert em communities_members com role 'member', dá feedback
 * visual no próprio botão (passa a "Sair da comunidade", troca a
 * cor e o handler de clique para leaveCommunity — sem precisar de
 * recarregar a página), mostra um toast de confirmação, e atualiza
 * a lista de membros (loadMembers()) para o utilizador aparecer
 * imediatamente na lista.
 */
async function joinCommunity() {
  const btn = document.querySelector('.btn-aderir');
  if (btn) { btn.disabled = true; btn.textContent = 'A aderir...'; }

  const { error } = await supabaseClient
    .from('communities_members')
    .upsert({ community_id: _commId, user_id: _userId, role: 'member' });

  if (!error) {
    btn.textContent   = 'Sair da comunidade';
    btn.style.background = 'rgba(192,57,43,0.15)';
    btn.style.color   = '#c0392b';
    btn.disabled      = false;
    btn.onclick       = leaveCommunity;
    showToast('✓ Entraste na comunidade!');
    loadMembers();
  }
}

/**
 * leaveCommunity
 * ---------------
 * Handler do botão quando o utilizador já é membro. Pede
 * confirmação explícita antes de agir (ação "destrutiva" — perde a
 * adesão), e se confirmado, apaga a linha correspondente em
 * communities_members (community_id + user_id). Depois de saída,
 * redireciona diretamente para communities.html (não fica na
 * página da comunidade da qual já não faz parte).
 */
async function leaveCommunity() {
  if (!confirm('Tens a certeza que queres sair desta comunidade?')) return;
  const btn = document.querySelector('.btn-aderir');
  if (btn) { btn.disabled = true; btn.textContent = 'A sair...'; }

  await supabaseClient.from('communities_members')
    .delete().eq('community_id', _commId).eq('user_id', _userId);

  window.location.href = 'communities.html';
}

/**
 * showToast
 * ---------
 * Mesma implementação de toast usada em item_detail.js (notificação
 * flutuante temporária com fade-out automático).
 *
 * @param {string} msg
 */
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--dark-green);color:#fff;font-family:"Berlin",sans-serif;font-size:14px;padding:12px 24px;border-radius:50px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);white-space:nowrap;animation:toastIn 0.3s ease;';
  document.body.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity 0.3s, transform 0.3s'; t.style.opacity = '0'; t.style.transform = 'translate(-50%, 8px)'; setTimeout(() => t.remove(), 300); }, 2500);
}

/**
 * openMembersSheet
 * ------------------
 * Abre o bottom-sheet com a lista COMPLETA de membros (sem o limite
 * de 5 usado no bloco principal, e sem o limite de 20 usado em
 * loadMembers — esta consulta não tem .limit(), traz todos).
 *
 * Mostra um estado de "A carregar..." imediatamente ao abrir, antes
 * dos dados chegarem, e depois substitui pelo conteúdo real (ou por
 * "Sem membros." se, por algum motivo, vier vazio).
 *
 * Cada linha mostra avatar, nome, papel (com "⭐ Admin" destacado) e
 * data de adesão num formato mais detalhado que no bloco principal
 * (inclui o dia, não só mês/ano).
 */
async function openMembersSheet() {
  document.getElementById('sheet-overlay').classList.add('active');
  document.getElementById('sheet-members').classList.add('active');
  document.body.style.overflow = 'hidden';

  const list  = document.getElementById('sheet-members-list');
  const title = document.getElementById('sheet-members-title');
  list.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45);text-align:center;padding:20px 0">A carregar...</p>';

  const { data: memberships } = await supabaseClient
    .from('communities_members')
    .select('user_id, role, joined_at')
    .eq('community_id', _commId)
    .order('joined_at', { ascending: true });

  if (title) title.textContent = `Participantes · ${memberships?.length || 0}`;

  if (!memberships?.length) {
    list.innerHTML = '<p style="font-family:\'Berlin\',sans-serif;font-size:14px;color:rgba(23,42,58,0.45);text-align:center;padding:20px 0">Sem membros.</p>';
    return;
  }

  const userIds = memberships.map(m => m.user_id);
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, full_name, avatar_url, location').in('id', userIds);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  const colors = ['#c8e6d4','#d4e4f0','#e8d5e8','#f0e4d4','#d4f0e4','#f0d4d4'];

  list.innerHTML = memberships.map((m, i) => {
    const p    = profileMap[m.user_id] || {};
    const name = p.full_name || 'Utilizador';
    const date = m.joined_at
      ? new Date(m.joined_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
    const isAdmin = m.role === 'admin';

    return `
      <div class="sheet-member-row">
        <div class="sheet-member-avatar" style="background:#e8eef0;display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${avatarHTML(p.avatar_url)}
        </div>
        <div style="flex:1;min-width:0">
          <div class="sheet-member-name">${name}</div>
          <div class="sheet-member-sub">${isAdmin ? '⭐ Admin' : 'Membro'} · desde ${date}</div>
        </div>
        ${isAdmin ? '<span class="badge admin" style="flex-shrink:0">Admin</span>' : ''}
      </div>`;
  }).join('');
}

/**
 * closeSheet
 * ----------
 * Fecha o bottom-sheet de membros e o seu overlay, repondo o scroll
 * normal da página de fundo.
 */
function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('active');
  document.getElementById('sheet-members').classList.remove('active');
  document.body.style.overflow = '';
}

// Fechar o sheet de membros com a tecla ESC.
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
