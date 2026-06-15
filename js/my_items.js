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
                    : 'images/placeholder-item.jpg';

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

                        <button
                            class="btn-delete"
                            onclick="deleteItem('${item.id}')">
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

    window.location.href =
        `edit_item.html?id=${itemId}`;
}

async function deleteItem(itemId) {

    const confirmDelete =
        confirm('Tens a certeza que queres remover este item?');

    if (!confirmDelete) return;

    const { error } = await supabaseClient
        .from('items')
        .delete()
        .eq('id', itemId);

    if (error) {
        alert('Erro ao remover item.');
        return;
    }

    location.reload();
}