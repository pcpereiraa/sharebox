// ── Sheet functions ───────────────────────────────────
function openSheet(id) {
  document.getElementById('sheet-overlay').classList.add('active');
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('active');
  document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('active'));
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ─────────────────────────────────────────────────────
   ShareBox — communities.js
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  const userId = session.user.id;

  await Promise.all([
    loadMyCommunities(userId),
    loadNearbyCommunities(userId),
    loadSuggestions(userId),
  ]);

  // Ver todas — abrir modais
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

  // Delegação de eventos — clique em comm-card
  document.addEventListener('click', function (e) {
    const card = e.target.closest('.comm-card, .my-comm-card');
    if (card && !e.target.closest('.comm-add-icon, .btn-criar')) {
      const commId = card.dataset.id;
      if (commId) window.location.href = 'community_detail.html?id=' + commId;
    }
  });
});

// ── As minhas comunidades ─────────────────────────────
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

  // Contar membros
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  if (!communities?.length) return;

  // Popula sheet
  const sheetList = document.getElementById('sheet-my-list');
  if (sheetList) {
    sheetList.innerHTML = communities.map(comm => {
      const members = memberMap[comm.id] || 0;
      return renderCommListItem(comm, members, true, userId);
    }).join('');
  }

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

// ── Comunidades perto de mim ─────────────────────────
async function loadNearbyCommunities(userId) {
  const container = document.getElementById('nearby-scroll');
  if (!container) return;

  // Buscar todas as comunidades públicas
  const { data: communities } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, location')
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(8);

  if (!communities?.length) return;

  // Verificar quais o utilizador já faz parte
  const commIds = communities.map(c => c.id);
  const { data: myMemberships } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .eq('user_id', userId)
    .in('community_id', commIds);

  const myCommIds = new Set((myMemberships || []).map(m => m.community_id));

  // Contar membros
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  // Popula sheet
  const sheetNearby = document.getElementById('sheet-nearby-list');
  if (sheetNearby) {
    sheetNearby.innerHTML = communities.map(comm => {
      const members  = memberMap[comm.id] || 0;
      const isMember = myCommIds.has(comm.id);
      return renderCommListItem(comm, members, isMember, userId);
    }).join('');
  }

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

// ── Sugestões para ti ────────────────────────────────
async function loadSuggestions(userId) {
  const container = document.getElementById('suggestions-scroll');
  if (!container) return;

  // Buscar comunidades que o utilizador NÃO faz parte
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

  // Contar membros
  const commIds = communities.map(c => c.id);
  const { data: memberCounts } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  const memberMap = {};
  (memberCounts || []).forEach(m => {
    memberMap[m.community_id] = (memberMap[m.community_id] || 0) + 1;
  });

  // Popula sheet
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

// ── Aderir a comunidade ───────────────────────────────
async function joinCommunity(event, communityId, btn) {
  event.stopPropagation();

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { error } = await supabaseClient
    .from('communities_members')
    .upsert({ community_id: communityId, user_id: session.user.id, role: 'member' });

  if (!error) {
    // Substituir botão por "Membro"
    btn.style.opacity = '0.3'; btn.style.pointerEvents = 'none';
    // Recarregar "as minhas comunidades"
    const { data: { session: s } } = await supabaseClient.auth.getSession();
    loadMyCommunities(s.user.id);
  }
}


// ── Helper: renderiza item de lista para sheet ────────
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