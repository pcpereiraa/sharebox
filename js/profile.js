
/**
 * profile.js
 * ----------
 * Lógica da página de perfil do próprio utilizador autenticado
 * ("A minha conta"). Mostra dados pessoais, avatar e um conjunto de
 * estatísticas-resumo (nº de itens, doações, comunidades, etc.) que
 * funcionam como pontos de entrada (menu) para outras páginas.
 *
 * Nota: esta página é sobre o PRÓPRIO utilizador. Para ver o perfil
 * de OUTRO utilizador (ex: o dono de um item), ver view_profile.js,
 * que é mais simples (só leitura, sem estatísticas privadas).
 */

document.addEventListener('DOMContentLoaded', async function () {

  // Página protegida — exige sessão válida.
  const session = await requireAuth();
  if (!session) return;

  const userId = session.user.id;

  // As três tarefas (carregar perfil, carregar estatísticas e
  // preparar o botão de logout) são independentes entre si, por isso
  // correm em paralelo com Promise.all em vez de sequencialmente —
  // reduz o tempo total de carregamento da página.
  await Promise.all([
    loadProfile(userId),
    loadStats(userId),
    setupLogout()
  ]);

});

// ── Carrega perfil ────────────────────────────────────
/**
 * loadProfile
 * -----------
 * Carrega os dados básicos do perfil (nome, avatar) e o email
 * (que não está na tabela `profiles`, mas sim no objeto de
 * autenticação do Supabase) e preenche os elementos da página.
 *
 * @param {string} userId - UUID do utilizador autenticado.
 */
async function loadProfile(userId) {
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('full_name, username, bio, location, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (error || !profile) { console.error('[Profile] Erro:', error); return; }

  // Nome
  const nameEl = document.getElementById('profile-name');
  if (nameEl) nameEl.textContent = profile.full_name || 'Utilizador';

  // Email — vem da sessão auth
  // O email de login não está guardado na tabela `profiles` (essa
  // tabela só tem dados "públicos" de perfil); para o obter é
  // necessário consultar `supabaseClient.auth.getUser()`, que devolve
  // os dados do utilizador autenticado no sistema de autenticação do
  // Supabase (tabela interna `auth.users`, não acessível diretamente).
  const { data: { user } } = await supabaseClient.auth.getUser();
  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.textContent = user?.email || '';

  // Avatar — foto ou ícone placeholder
  // Mesmo padrão usado noutras páginas (ver `avatarHTML()` em auth.js):
  // se existir `avatar_url` mostra a foto, caso contrário mostra um
  // ícone SVG genérico de "pessoa" como substituto.
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    avatarEl.style.display = 'flex';
    avatarEl.style.alignItems = 'center';
    avatarEl.style.justifyContent = 'center';
    avatarEl.style.overflow = 'hidden';
    avatarEl.innerHTML = profile.avatar_url
      ? `<img src="${profile.avatar_url}" style="width:100%;height:100%;object-fit:cover">`
      : `<svg viewBox="0 0 24 24" width="55%" height="55%" fill="rgba(255,255,255,0.85)"><path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>`;
  }
}

// ── Carrega estatísticas ──────────────────────────────
/**
 * loadStats
 * ---------
 * Calcula e apresenta um conjunto de estatísticas pessoais do
 * utilizador: nº de itens por estado, doações feitas, doações
 * recebidas e nº de comunidades (totais e onde é admin).
 *
 * Nota de design: a maioria destas contagens são feitas no lado do
 * cliente (com `.filter()` sobre o array `allItems` já carregado),
 * em vez de pedir contagens separadas ao Supabase para cada estado.
 * Isto poupa chamadas à BD à custa de trazer todos os itens do
 * utilizador para o browser — aceitável aqui porque o número de itens
 * de UM utilizador é tipicamente pequeno.
 *
 * @param {string} userId - UUID do utilizador autenticado.
 */
async function loadStats(userId) {

  // Contar itens por status
  const { data: allItems } = await supabaseClient
    .from('items')
    .select('id, status')
    .eq('owner_id', userId);

  const active   = (allItems || []).filter(i => i.status === 'disponivel').length;
  const pending  = (allItems || []).filter(i => i.status === 'pendente').length;
  const expired  = (allItems || []).filter(i => i.status === 'expirado').length;
  const total    = (allItems || []).length;

  // Contar doações feitas (itens doados = status 'doado')
  const donated  = (allItems || []).filter(i => i.status === 'doado').length;

  // Contar pedidos recebidos (itens do utilizador que foram pedidos)
  // Ao contrário das contagens anteriores, isto exige uma query
  // separada porque os "pedidos" (requests) vivem numa tabela
  // diferente, ligada aos itens por `item_id`. Usa-se `.in('item_id',
  // itemIds)` para filtrar só os pedidos referentes a itens deste
  // utilizador — outro exemplo do padrão de "fan-out manual" (ver
  // home.js) aplicado aqui de forma simplificada (só precisamos da
  // contagem, não dos dados completos, por isso usa-se
  // `{ count: 'exact', head: true }` que evita transferir as linhas).
  const itemIds = (allItems || []).map(i => i.id);
  let receivedCount = 0;
  if (itemIds.length > 0) {
    const { count } = await supabaseClient
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .in('item_id', itemIds)
      .eq('status', 'aceite');
    receivedCount = count || 0;
  }

  // Comunidades
  const { count: commCount } = await supabaseClient
    .from('communities_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { count: adminCount } = await supabaseClient
    .from('communities_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'admin');

  // ── Atualiza stats
  // Os dois números grandes em destaque no topo do perfil.
  const statItems = document.getElementById('stat-items');
  if (statItems) statItems.textContent = total;

  const statDonations = document.getElementById('stat-donations');
  if (statDonations) statDonations.textContent = donated;

  // ── Atualiza menu subs
  // Texto secundário (subtítulo) de cada item do menu do perfil.
  // Todos seguem o mesmo padrão: singular vs plural conforme a
  // contagem (concordância gramatical em português — "1 publicação"
  // vs "2 publicações").
  const subActive = document.getElementById('sub-active');
  if (subActive) subActive.textContent = active === 1 ? '1 publicação' : `${active} publicações`;

  const subPending = document.getElementById('sub-pending');
  if (subPending) subPending.textContent = pending === 1 ? '1 em revisão' : `${pending} em revisão`;

  const subExpired = document.getElementById('sub-expired');
  if (subExpired) subExpired.textContent = expired === 1 ? '1 publicação' : `${expired} publicações`;

  const subDonationsMade = document.getElementById('sub-donations-made');
  if (subDonationsMade) subDonationsMade.textContent = donated === 1 ? '1 item doado' : `${donated} itens doados`;

  // Nota: este "sub-donations-received" liga-se ao item pendente
  // mencionado na memória do projeto — a página
  // `my_donations_received.html` referenciada a partir daqui (em
  // profile.html) ainda não foi criada, sendo uma decisão pendente.
  const subDonationsReceived = document.getElementById('sub-donations-received');
  if (subDonationsReceived) subDonationsReceived.textContent = receivedCount === 1 ? '1 item recebido' : `${receivedCount} itens recebidos`;

  const subComm = document.getElementById('sub-communities');
  if (subComm) subComm.textContent = commCount === 1 ? '1 comunidade' : `${commCount || 0} comunidades`;

  const subCommAdmin = document.getElementById('sub-communities-admin');
  if (subCommAdmin) subCommAdmin.textContent = adminCount === 1 ? '1 comunidade' : `${adminCount || 0} comunidades`;
}

// ── Logout ────────────────────────────────────────────
/**
 * setupLogout
 * -----------
 * Liga o evento de clique do botão de logout (se existir na página)
 * para terminar a sessão no Supabase e redirecionar para o login.
 *
 * Nota: esta função tem uma responsabilidade semelhante à lógica de
 * logout já existente em auth.js, mas está duplicada aqui de forma
 * local porque o seletor do botão (`.logout-btn`) é específico desta
 * página.
 */
async function setupLogout() {
  const logoutBtn = document.querySelector('.logout-btn');
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', async function (e) {
    e.preventDefault();
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });
}
