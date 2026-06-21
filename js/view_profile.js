/**
 * ---------------
 * Mostra o perfil PÚBLICO de outro utilizador (ex: ao clicar no nome
 * do dono de um item). É só de leitura — ao contrário de profile.js
 * (perfil próprio), aqui não há estatísticas privadas nem opções de
 * edição, apenas informação pública: nome, localização, bio, itens
 * publicados e comunidades a que pertence.
 *
 * Recebe o id do utilizador a visualizar através do parâmetro de URL
 * `?id=<uuid>` (ex: view_profile.html?id=72eee056-...).
 */

document.addEventListener('DOMContentLoaded', async function () {
  // Página protegida — só utilizadores autenticados podem ver perfis
  // de outros (evita exposição pública total dos dados).
  const session = await requireAuth();
  if (!session) return;

  const params = new URLSearchParams(window.location.search);
  const profileId = params.get('id');

  // Sem id na URL não há nada para mostrar — volta à home.
  if (!profileId) {
    window.location.href = 'home.html';
    return;
  }

  // Se for o próprio utilizador, redirecciona para o perfil privado
  // Evita que o utilizador veja a versão "pública/read-only" de si
  // próprio quando deveria ver a página completa de gestão da conta
  // (profile.html, com estatísticas e definições).
  if (profileId === session.user.id) {
    window.location.href = 'profile.html';
    return;
  }

  await loadProfile(profileId, session.user.id);
});

/**
 * loadProfile
 * -----------
 * Carrega e apresenta toda a informação pública do perfil indicado:
 * dados básicos (nome, localização, bio, avatar), lista de itens
 * publicados e lista de comunidades a que pertence.
 *
 * @param {string} profileId - UUID do perfil a visualizar.
 * @param {string} currentUserId - UUID do utilizador autenticado
 *                                 (recebido mas não usado diretamente
 *                                 nesta função — mantido na assinatura
 *                                 para eventual uso futuro, ex: bloquear
 *                                 utilizador, denunciar, etc.).
 */
async function loadProfile(profileId, currentUserId) {
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('id, full_name, avatar_url, location, bio')
    .eq('id', profileId)
    .maybeSingle();

  if (error || !profile) {
    document.getElementById('profile-name').textContent = 'Utilizador não encontrado';
    return;
  }

  // ── Hero
  // Cabeçalho do perfil: nome, localização e avatar (mesmo padrão
  // de fallback SVG usado em profile.js quando não há avatar_url).
  document.getElementById('profile-name').textContent = profile.full_name || 'Utilizador';
  document.getElementById('profile-location').textContent = profile.location || 'Portugal';

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

  // Secção de bio só é mostrada se o utilizador a tiver preenchido
  // (evita uma caixa vazia/sem sentido no perfil).
  if (profile.bio) {
    document.getElementById('bio-section').style.display = 'block';
    document.getElementById('profile-bio').textContent = profile.bio;
  }

  // ── Botão contactar → vai para o chat
  // Ponto de entrada direto para iniciar uma conversa com este
  // utilizador, reutilizando chat.html com o parâmetro `?with=`.
  const contactBtn = document.getElementById('btn-contact');
  if (contactBtn) {
    contactBtn.href = `chat.html?with=${profile.id}`;
  }

  // ── Itens publicados
  const { data: items } = await supabaseClient
    .from('items')
    .select('id, title, status, location')
    .eq('owner_id', profileId)
    .order('created_at', { ascending: false });

  const itemsList  = document.getElementById('items-list');
  const itemsEmpty = document.getElementById('items-empty');

  document.getElementById('stat-items').textContent = items?.length || 0;
  document.getElementById('stat-donations').textContent = items?.filter(i => i.status === 'doado').length || 0;

  if (!items?.length) {
    itemsEmpty.style.display = 'block';
  } else {
    // Padrão de "fan-out manual" (já visto em home.js): primeiro
    // busca-se a lista de itens, depois — numa segunda query — as
    // imagens correspondentes via `.in('item_id', ids)`, e o
    // mapeamento entre os dois é feito em memória (`imgMap`).
    const ids = items.map(i => i.id);
    const { data: images } = await supabaseClient
      .from('item_images').select('item_id, image_url').in('item_id', ids);
    const imgMap = {};
    // Só guarda a PRIMEIRA imagem encontrada por item (não importa a
    // ordem/posição aqui — é só para a miniatura da lista).
    (images || []).forEach(img => { if (!imgMap[img.item_id]) imgMap[img.item_id] = img.image_url; });

    itemsList.innerHTML = items.map(item => {
      const img = imgMap[item.id] || 'images/Icons/add_circle.png';
      const statusCls   = item.status === 'doado' ? 'donated' : 'available';
      const statusLabel = item.status === 'doado' ? 'Doado' : 'Disponível';
      return `
        <div class="vp-item-card" onclick="window.location.href='item_detail.html?id=${item.id}'">
          <img class="vp-item-img" src="${img}" alt="${item.title}" onerror="this.src='images/Icons/add_circle.png'">
          <div class="vp-item-info">
            <div class="vp-item-title">${item.title}</div>
            <div class="vp-item-meta">📍 ${item.location?.split(',')[0] || 'Portugal'}</div>
          </div>
          <span class="vp-item-status ${statusCls}">${statusLabel}</span>
        </div>`;
    }).join('');
  }

  // ── Comunidades
  // Primeiro descobre-se a QUE comunidades o utilizador pertence
  // (tabela de junção `communities_members`), e só depois se busca
  // os dados dessas comunidades — mesma lógica de duas queries
  // separadas usada acima para os itens/imagens.
  const { data: memberships } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .eq('user_id', profileId);

  const commsList  = document.getElementById('comms-list');
  const commsEmpty = document.getElementById('comms-empty');

  document.getElementById('stat-communities').textContent = memberships?.length || 0;

  if (!memberships?.length) {
    commsEmpty.style.display = 'block';
  } else {
    const commIds = memberships.map(m => m.community_id);
    const { data: communities } = await supabaseClient
      .from('communities')
      .select('id, name, image_url, location')
      .in('id', commIds);

    if (communities?.length) {
      // Contar membros de cada comunidade
      // Terceira query: para mostrar "X membros" em cada cartão de
      // comunidade, é preciso contar TODOS os membros de cada uma das
      // comunidades encontradas (não só os do perfil que se está a
      // visitar). Os resultados são depois agregados em memória com
      // um objeto `memberCount` (chave = community_id, valor = total).
      const { data: allMembers } = await supabaseClient
        .from('communities_members').select('community_id').in('community_id', commIds);
      const memberCount = {};
      (allMembers || []).forEach(m => { memberCount[m.community_id] = (memberCount[m.community_id] || 0) + 1; });

      commsList.innerHTML = communities.map(comm => `
        <div class="vp-comm-card" onclick="window.location.href='community_detail.html?id=${comm.id}'">
          ${comm.image_url
            ? `<img class="vp-comm-img" src="${comm.image_url}" alt="${comm.name}">`
            : `<div class="vp-comm-img"></div>`}
          <div style="flex:1">
            <div class="vp-comm-name">${comm.name}</div>
            <div class="vp-comm-meta">📍 ${comm.location || 'Portugal'} · ${memberCount[comm.id] || 0} membros</div>
          </div>
        </div>`).join('');
    } else {
      commsEmpty.style.display = 'block';
    }
  }
}
