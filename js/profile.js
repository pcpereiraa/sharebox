/* ─────────────────────────────────────────────────────
   ShareBox — profile.js
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  const userId = session.user.id;

  await Promise.all([
    loadProfile(userId),
    loadStats(userId),
    setupLogout()
  ]);

});

// ── Carrega perfil ────────────────────────────────────
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
  const { data: { user } } = await supabaseClient.auth.getUser();
  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.textContent = user?.email || '';

  // Avatar — inicial do nome
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    if (profile.avatar_url) {
      const img = document.getElementById('profile-avatar-img');
      if (img) {
        img.src = profile.avatar_url;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.filter = 'none';
        img.style.opacity = '1';
      }
    } else {
      // Mostrar inicial
      const initial = (profile.full_name || 'U').charAt(0).toUpperCase();
      avatarEl.innerHTML = `<span style="font-family:'Berlin',sans-serif;font-size:36px;color:#fff;font-weight:600">${initial}</span>`;
    }
  }
}

// ── Carrega estatísticas ──────────────────────────────
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
  const statItems = document.getElementById('stat-items');
  if (statItems) statItems.textContent = total;

  const statDonations = document.getElementById('stat-donations');
  if (statDonations) statDonations.textContent = donated;

  // ── Atualiza menu subs
  const subActive = document.getElementById('sub-active');
  if (subActive) subActive.textContent = active === 1 ? '1 publicação' : `${active} publicações`;

  const subPending = document.getElementById('sub-pending');
  if (subPending) subPending.textContent = pending === 1 ? '1 em revisão' : `${pending} em revisão`;

  const subExpired = document.getElementById('sub-expired');
  if (subExpired) subExpired.textContent = expired === 1 ? '1 publicação' : `${expired} publicações`;

  const subDonationsMade = document.getElementById('sub-donations-made');
  if (subDonationsMade) subDonationsMade.textContent = donated === 1 ? '1 item doado' : `${donated} itens doados`;

  const subDonationsReceived = document.getElementById('sub-donations-received');
  if (subDonationsReceived) subDonationsReceived.textContent = receivedCount === 1 ? '1 item recebido' : `${receivedCount} itens recebidos`;

  const subComm = document.getElementById('sub-communities');
  if (subComm) subComm.textContent = commCount === 1 ? '1 comunidade' : `${commCount || 0} comunidades`;

  const subCommAdmin = document.getElementById('sub-communities-admin');
  if (subCommAdmin) subCommAdmin.textContent = adminCount === 1 ? '1 comunidade' : `${adminCount || 0} comunidades`;
}

// ── Logout ────────────────────────────────────────────
async function setupLogout() {
  const logoutBtn = document.querySelector('.logout-btn');
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', async function (e) {
    e.preventDefault();
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
  });
}