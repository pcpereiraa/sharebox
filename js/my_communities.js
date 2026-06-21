/* ─────────────────────────────────────────────────────────────────
   Página "As minhas comunidades" (my_communities.html) — lista
   TODAS as comunidades de que o utilizador é membro (incluindo as
   que ele próprio administra), com filtros por papel (todas /
   admin / membro) e ações de gestão:
     - "Sair" da comunidade, se for apenas membro;
     - "Eliminar" a comunidade por completo, se for o administrador
       (note a diferença de ação consoante o papel do utilizador —
       só o admin pode apagar a comunidade inteira).

   Ao contrário de communities.js (que mostra várias secções
   diferentes — minhas/perto/sugestões — cada uma com a sua própria
   query), esta página foca-se SÓ nas comunidades do utilizador, mas
   com mais detalhe por comunidade (contagem de itens, badges de
   papel, filtros por tab).
───────────────────────────────────────────────────────────────────── */

// Estado do módulo:
let allCommunities = []; // todas as comunidades do utilizador, já combinadas com role/membros/itens
let memberCounts   = {}; // { community_id: número de membros } — cache intermédia usada durante o carregamento

/**
 * Ponto de entrada da página:
 *   1. Garante autenticação.
 *   2. Carrega a lista de comunidades do utilizador.
 *   3. Liga as "tabs" de filtro (Todas / Admin / Membro): ao clicar
 *      numa tab, marca-a como ativa (removendo a classe das outras)
 *      e volta a desenhar a lista filtrada por `dataset.role` dessa
 *      tab (que pode ser uma string vazia para "Todas").
 */
document.addEventListener('DOMContentLoaded', async function () {

  const session = await requireAuth();
  if (!session) return;

  await loadMyCommunities(session.user.id);

  // Filter tabs.
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      renderCommunities(this.dataset.role);
    });
  });

});

/**
 * loadMyCommunities
 * -------------------
 * Carrega TODAS as comunidades de que o utilizador é membro, com
 * dados agregados extra (contagem de membros e de itens
 * disponíveis), combinando 4 pedidos à BD:
 *
 *   1. communities_members (filtrado por user_id) → dá a lista de
 *      community_id + role do utilizador em cada uma. Se vier
 *      vazia, mostra o estado vazio (showEmpty) e termina.
 *   2. communities (filtrado por .in('id', commIds)) → dados
 *      principais (nome, imagem, localização, privacidade, data),
 *      ordenados pelas mais recentes primeiro.
 *   3. communities_members (de novo, mas SEM filtro de user_id,
 *      apenas .in('community_id', commIds)) → todas as linhas de
 *      membros destas comunidades específicas, para CONTAR quantos
 *      membros tem cada uma (agregação manual em memberCounts,
 *      mesmo padrão usado em vários outros ficheiros do projeto).
 *   4. items (filtrado por community_id IN commIds E status
 *      'disponivel') → para contar quantos itens disponíveis cada
 *      comunidade tem atualmente (itemCounts).
 *
 * No final, combina tudo num único array `allCommunities`, onde
 * cada comunidade ganha os campos extra: role, members, itemCount.
 * Por fim, chama renderCommunities('') para mostrar TODAS (sem
 * filtro de papel) inicialmente.
 *
 * @param {string} userId
 */
async function loadMyCommunities(userId) {
  const { data: memberships, error } = await supabaseClient
    .from('communities_members')
    .select('community_id, role')
    .eq('user_id', userId);

  if (error || !memberships?.length) {
    showEmpty();
    return;
  }

  const commIds = memberships.map(m => m.community_id);
  const roleMap = {};
  memberships.forEach(m => { roleMap[m.community_id] = m.role; });

  // Buscar dados das comunidades.
  const { data: communities } = await supabaseClient
    .from('communities')
    .select('id, name, image_url, location, is_private, created_at')
    .in('id', commIds)
    .order('created_at', { ascending: false });

  if (!communities?.length) { showEmpty(); return; }

  // Contar membros (todas as linhas de communities_members destas
  // comunidades específicas, agregadas em memória).
  const { data: members } = await supabaseClient
    .from('communities_members')
    .select('community_id')
    .in('community_id', commIds);

  memberCounts = {};
  (members || []).forEach(m => {
    memberCounts[m.community_id] = (memberCounts[m.community_id] || 0) + 1;
  });

  // Contar itens DISPONÍVEIS por comunidade.
  const { data: items } = await supabaseClient
    .from('items')
    .select('community_id')
    .in('community_id', commIds)
    .eq('status', 'disponivel');

  const itemCounts = {};
  (items || []).forEach(i => {
    itemCounts[i.community_id] = (itemCounts[i.community_id] || 0) + 1;
  });

  // Juntar tudo num único objeto por comunidade, combinando os 4
  // pedidos feitos acima.
  allCommunities = communities.map(c => ({
    ...c,
    role:      roleMap[c.id] || 'member',
    members:   memberCounts[c.id] || 0,
    itemCount: itemCounts[c.id]   || 0,
  }));

  renderCommunities('');
}

/**
 * renderCommunities
 * -------------------
 * Desenha os cards de comunidade (versão "completa", com capa
 * grande e várias linhas de meta-informação), filtrando
 * opcionalmente por papel (`roleFilter`: '', 'admin' ou 'member').
 *
 * Se a lista filtrada vier vazia (ex: o utilizador não é admin de
 * nenhuma comunidade e a tab "Admin" está selecionada), mostra o
 * estado vazio (#empty-state) em vez da lista.
 *
 * Cada card mostra: imagem de capa (ou placeholder se não houver),
 * nome, badge de papel (Admin/Membro), localização, nº de membros,
 * nº de itens disponíveis, e data de criação formatada em
 * português. No rodapé do card há 2 ações:
 *   - "Ver comunidade" → link normal para community_detail.html;
 *   - botão de ação secundária, que MUDA de comportamento conforme
 *     o papel do utilizador nessa comunidade específica:
 *       * role !== 'admin' → "Sair" (leaveCommunity)
 *       * role === 'admin' → "Eliminar" (deleteCommunity) — só o
 *         administrador pode apagar a comunidade inteira.
 *
 * O bloco de ações (.comm-card-actions) tem
 * `onclick="event.stopPropagation()"` porque o CARD INTEIRO também
 * tem um onclick de navegação (clicar em qualquer parte do card vai
 * para o detalhe da comunidade) — sem este stopPropagation, clicar
 * em "Sair" ou "Eliminar" também acionaria a navegação do card.
 *
 * @param {string} roleFilter - '' (todas), 'admin' ou 'member'.
 */
function renderCommunities(roleFilter) {
  const container  = document.getElementById('communities-container');
  const emptyState = document.getElementById('empty-state');

  let filtered = allCommunities;
  if (roleFilter) filtered = allCommunities.filter(c => c.role === roleFilter);

  if (!filtered.length) {
    container.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  container.innerHTML = filtered.map(comm => {
    const badgeCls   = comm.role === 'admin' ? 'admin' : 'member';
    const badgeLabel = comm.role === 'admin' ? 'Admin' : 'Membro';
    const date       = new Date(comm.created_at).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });

    return `
      <div class="comm-card-full" onclick="window.location.href='community_detail.html?id=${comm.id}'">
        ${comm.image_url
          ? `<img src="${comm.image_url}" alt="${comm.name}" class="comm-card-cover">`
          : `<div class="comm-card-cover-placeholder"></div>`}
        <div class="comm-card-body">
          <div class="comm-card-top">
            <div class="comm-card-name">${comm.name}</div>
            <span class="comm-badge ${badgeCls}">${badgeLabel}</span>
          </div>
          <div class="comm-card-meta">
            <span>📍 ${comm.location || 'Portugal'}</span>
            <span>👥 ${comm.members} membro${comm.members !== 1 ? 's' : ''}</span>
            <span>📦 ${comm.itemCount} item${comm.itemCount !== 1 ? 's' : ''}</span>
            <span>📅 ${date}</span>
          </div>
          <div class="comm-card-actions" onclick="event.stopPropagation()">
            <a class="btn-ver" href="community_detail.html?id=${comm.id}">Ver comunidade</a>
            ${comm.role !== 'admin'
              ? `<button class="btn-sair" onclick="leaveCommunity('${comm.id}', this)">Sair</button>`
              : `<button class="btn-sair" onclick="deleteCommunity('${comm.id}', this)">Eliminar</button>`}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * leaveCommunity
 * ---------------
 * Ação "Sair" disponível para membros que NÃO são admin. Pede
 * confirmação, apaga a linha do próprio utilizador em
 * communities_members, e em caso de sucesso, remove a comunidade do
 * array local `allCommunities` e volta a desenhar a lista (mantendo
 * o filtro de tab que estava ativo no momento) — sem precisar de
 * recarregar tudo da BD outra vez, já que esta operação só afeta a
 * relação do PRÓPRIO utilizador com esta comunidade.
 *
 * @param {string} communityId
 * @param {HTMLElement} btn - o botão "Sair" clicado.
 */
async function leaveCommunity(communityId, btn) {
  if (!confirm('Tens a certeza que queres sair desta comunidade?')) return;

  btn.disabled = true;
  btn.textContent = 'A sair...';

  const { data: { session } } = await supabaseClient.auth.getSession();
  const { error } = await supabaseClient
    .from('communities_members')
    .delete()
    .eq('community_id', communityId)
    .eq('user_id', session.user.id);

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Sair';
    alert('Erro ao sair da comunidade.');
  } else {
    allCommunities = allCommunities.filter(c => c.id !== communityId);
    const activeTab = document.querySelector('.filter-tab.active');
    renderCommunities(activeTab?.dataset.role || '');
  }
}

/**
 * deleteCommunity
 * -----------------
 * Ação "Eliminar" disponível apenas para o ADMINISTRADOR da
 * comunidade — apaga a comunidade INTEIRA, de forma irreversível
 * (o texto de confirmação avisa explicitamente disso).
 *
 * Sequência de eliminação:
 *   1. Apaga PRIMEIRO todas as linhas de communities_members
 *      associadas a esta comunidade (todos os membros, não só o
 *      utilizador atual) — necessário fazer isto antes de apagar a
 *      própria comunidade, provavelmente porque existe uma
 *      restrição de chave estrangeira (foreign key) entre
 *      communities_members.community_id e communities.id que
 *      impediria o DELETE da comunidade enquanto ainda houver
 *      membros associados a ela (a menos que a FK tivesse
 *      ON DELETE CASCADE configurado, o que este código parece
 *      assumir que NÃO está, daí fazer o delete manual em duas
 *      etapas).
 *   2. Só depois apaga a linha da própria comunidade em `communities`.
 *
 * Em caso de sucesso, remove a comunidade do array local e
 * re-desenha a lista (mantendo o filtro de tab ativo), tal como em
 * leaveCommunity.
 *
 * Nota: o código não elimina explicitamente os ITENS associados a
 * esta comunidade (tabela items, coluna community_id) nem as
 * mensagens relacionadas — dependendo da configuração da BD, esses
 * itens podem ficar com community_id "pendurado" (referência a uma
 * comunidade já apagada) ou a operação pode falhar se houver uma FK
 * sem CASCADE nessa relação também. É um ponto que pode ser
 * relevante mencionar/perguntar na defesa sobre integridade
 * referencial.
 *
 * @param {string} communityId
 * @param {HTMLElement} btn - o botão "Eliminar" clicado.
 */
async function deleteCommunity(communityId, btn) {
  if (!confirm('Tens a certeza que queres eliminar esta comunidade? Esta acção é irreversível.')) return;

  btn.disabled = true;
  btn.textContent = 'A eliminar...';

  await supabaseClient.from('communities_members').delete().eq('community_id', communityId);
  const { error } = await supabaseClient.from('communities').delete().eq('id', communityId);

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Eliminar';
    alert('Erro ao eliminar comunidade.');
  } else {
    allCommunities = allCommunities.filter(c => c.id !== communityId);
    const activeTab = document.querySelector('.filter-tab.active');
    renderCommunities(activeTab?.dataset.role || '');
  }
}

/**
 * showEmpty
 * ---------
 * Limpa o contentor de comunidades e mostra o estado vazio
 * (#empty-state) — usado quando o utilizador não pertence a
 * nenhuma comunidade.
 */
function showEmpty() {
  document.getElementById('communities-container').innerHTML = '';
  document.getElementById('empty-state').style.display = 'flex';
}
