/* ─────────────────────────────────────────────────────
   ShareBox — my_items.js
───────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {

    const session = await requireAuth();
    if (!session) return;

    await loadMyItems(session.user.id);

});

async function loadMyItems(userId) {

    const container = document.getElementById('items-container');
    const emptyState = document.getElementById('empty-state');

    try {

        const { data: items, error } = await supabaseClient
            .from('items')
            .select(`
                *,
                categories(name),
                item_images(
                    image_url,
                    position
                )
            `)
            .eq('owner_id', userId)
            .order('created_at', {
                ascending: false
            });

        if (error) throw error;

        if (!items || items.length === 0) {
            container.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        container.innerHTML = '';

        items.forEach(item => {

            const image =
                item.item_images?.length > 0
                    ? item.item_images.sort((a,b) => a.position - b.position)[0].image_url
                    : 'images/Icons/add_circle.png';

            const card = document.createElement('div');

            card.className = 'item-card';

            card.innerHTML = `
                <img
                    src="${image}"
                    class="item-image"
                    alt="${item.title}"
                >

                <div class="item-content">

                    <div class="item-header">

                        <h3 class="item-title">
                            ${item.title}
                        </h3>

                        <span class="item-status ${getStatusClass(item.status)}">
                            ${formatStatus(item.status)}
                        </span>

                    </div>

                    <p class="item-category">
                        ${item.categories?.name || 'Sem categoria'}
                    </p>

                    <p class="item-date">
                        Publicado em ${formatDate(item.created_at)}
                    </p>

                    <div class="item-actions">

                        <button
                            class="btn-edit"
                            onclick="editItem('${item.id}')">
                            Editar
                        </button>

                        ${item.status === 'doado' ? `
                        <button
                            class="btn-edit"
                            style="background:rgba(23,42,58,0.08);color:var(--blue)"
                            onclick="reactivateItem('${item.id}', this)">
                            Reativar
                        </button>` : `
                        <button
                            class="btn-edit"
                            style="background:var(--dark-green)"
                            onclick="markAsDonated('${item.id}', this)">
                            ✓ Doado
                        </button>`}

                        <button
                            class="btn-delete"
                            onclick="deleteItem('${item.id}', this)">
                            Remover
                        </button>

                    </div>

                </div>
            `;

            container.appendChild(card);

        });

    } catch (err) {

        console.error(err);

        container.innerHTML = `
            <p style="
                text-align:center;
                padding:30px;
                color:#c0392b;
            ">
                Erro ao carregar os teus itens.
            </p>
        `;
    }
}

function formatDate(dateString) {

    return new Date(dateString)
        .toLocaleDateString('pt-PT', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
}

function formatStatus(status) {

    const map = {
        disponivel: 'Disponível',
        reservado: 'Reservado',
        doado: 'Doado',
        removido: 'Removido'
    };

    return map[status] || status;
}

function getStatusClass(status) {

    const map = {
        disponivel: 'available',
        reservado: 'reserved',
        doado: 'donated'
    };

    return map[status] || '';
}

function editItem(itemId) {
  window.location.href = `add_item.html?edit=${itemId}`;
}

async function markAsDonated(itemId, btn) {
  if (!confirm('Confirmas que este item foi doado?')) return;

  btn.disabled = true;
  btn.textContent = 'A guardar...';

  const { error } = await supabaseClient
    .from('items').update({ status: 'doado' }).eq('id', itemId);

  if (error) {
    alert('Erro ao atualizar o item: ' + error.message);
    btn.disabled = false;
    btn.textContent = '✓ Doado';
    return;
  }

  // Atualizar badge de estado e troca o botão para "Reativar"
  const card = btn.closest('.item-card');
  const statusBadge = card.querySelector('.item-status');
  if (statusBadge) {
    statusBadge.className = `item-status ${getStatusClass('doado')}`;
    statusBadge.textContent = formatStatus('doado');
  }
  btn.outerHTML = `<button class="btn-edit" style="background:rgba(23,42,58,0.08);color:var(--blue)" onclick="reactivateItem('${itemId}', this)">Reativar</button>`;
}

async function reactivateItem(itemId, btn) {
  if (!confirm('Queres tornar este item disponível novamente?')) return;

  btn.disabled = true;
  btn.textContent = 'A reativar...';

  const { error } = await supabaseClient
    .from('items').update({ status: 'disponivel' }).eq('id', itemId);

  if (error) {
    alert('Erro ao atualizar o item: ' + error.message);
    btn.disabled = false;
    btn.textContent = 'Reativar';
    return;
  }

  const card = btn.closest('.item-card');
  const statusBadge = card.querySelector('.item-status');
  if (statusBadge) {
    statusBadge.className = `item-status ${getStatusClass('disponivel')}`;
    statusBadge.textContent = formatStatus('disponivel');
  }
  btn.outerHTML = `<button class="btn-edit" style="background:var(--dark-green)" onclick="markAsDonated('${itemId}', this)">✓ Doado</button>`;
}

async function deleteItem(itemId, btn) {

    const confirmDelete =
        confirm('Tens a certeza que queres remover este item?');

    if (!confirmDelete) return;

    if (btn) { btn.disabled = true; btn.textContent = 'A remover...'; }

    // Apagar dependências primeiro (FK constraints)
    await supabaseClient.from('item_images').delete().eq('item_id', itemId);
    await supabaseClient.from('favorites').delete().eq('item_id', itemId);
    await supabaseClient.from('requests').delete().eq('item_id', itemId);
    // Mensagens referenciam o item mas não devem ser apagadas (histórico de chat) —
    // apenas desligamos a referência para não bloquear o delete
    await supabaseClient.from('messages').update({ item_id: null }).eq('item_id', itemId);

    const { error } = await supabaseClient
        .from('items')
        .delete()
        .eq('id', itemId);

    if (error) {
        console.error('[MyItems] Erro ao remover:', error);
        alert('Erro ao remover item: ' + error.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Remover'; }
        return;
    }

    location.reload();
}