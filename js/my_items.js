
/**
 * my_items.js
 * -----------
 * Lógica da página "Os Meus Itens" — onde o utilizador autenticado
 * gere os itens que ele próprio publicou (editar, marcar como doado,
 * reativar ou remover).
 *
 * Diferença importante em relação a home.js / item_detail.js:
 * aqui a query já filtra diretamente por `owner_id`, por isso
 * NÃO é necessário o padrão de "fan-out manual" (buscar itens e
 * depois ir buscar imagens/perfis à parte com `.in()`). Como a lista
 * é sempre pequena (itens de UM utilizador), o Supabase consegue
 * resolver o relacionamento `item_images` diretamente dentro do
 * próprio `.select()` (sintaxe de embed do PostgREST), o que simplifica
 * bastante o código face às páginas com listagens grandes/públicas.
 */

document.addEventListener('DOMContentLoaded', async () => {

    // Garante que só utilizadores autenticados acedem a esta página.
    // `requireAuth()` (definido em auth.js) redireciona para o login
    // caso não exista sessão válida, devolvendo `null` nesse caso.
    const session = await requireAuth();
    if (!session) return;

    await loadMyItems(session.user.id);

});

/**
 * loadMyItems
 * -----------
 * Vai buscar todos os itens pertencentes ao utilizador autenticado
 * e constrói os cartões (cards) na página.
 *
 * @param {string} userId - UUID do utilizador autenticado (owner_id).
 */
async function loadMyItems(userId) {

    const container = document.getElementById('items-container');
    const emptyState = document.getElementById('empty-state');

    try {

        // Query com embed direto: para além das colunas do próprio item,
        // pedimos também:
        //   - categories(name)      → nome da categoria associada (join 1:1)
        //   - item_images(...)      → todas as imagens do item (join 1:N)
        // Isto só funciona bem porque o filtro `.eq('owner_id', userId)`
        // garante um volume de dados reduzido; em listagens grandes este
        // tipo de embed pode ser mais lento ou não suportado pela anon key
        // em joins mais complexos (ver nota em home.js).
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

        // Sem itens publicados → mostra o estado vazio (empty state) em
        // vez do contentor de cartões.
        if (!items || items.length === 0) {
            container.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        container.innerHTML = '';

        items.forEach(item => {

            // Escolhe a imagem de capa: a posição mais baixa (0) é
            // tipicamente a imagem principal. Se o item não tiver
            // nenhuma imagem associada, usa um ícone de placeholder.
            const image =
                item.item_images?.length > 0
                    ? item.item_images.sort((a,b) => a.position - b.position)[0].image_url
                    : 'images/Icons/add_circle.png';

            const card = document.createElement('div');

            card.className = 'item-card';

            // Nota: o botão "Doado/Reativar" alterna de acordo com o
            // estado atual do item — só um dos dois é renderizado,
            // nunca os dois ao mesmo tempo.
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

/**
 * formatDate
 * ----------
 * Formata uma data ISO (ex: do `created_at`) para o formato
 * português abreviado, ex: "21 jun. 2026".
 *
 * @param {string} dateString - Data em formato ISO (vinda da BD).
 * @returns {string} Data formatada em pt-PT.
 */
function formatDate(dateString) {

    return new Date(dateString)
        .toLocaleDateString('pt-PT', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
}

/**
 * formatStatus
 * ------------
 * Traduz o valor interno do estado do item (guardado em inglês/
 * minúsculas na BD) para o texto apresentado ao utilizador em
 * português.
 *
 * @param {string} status - Valor bruto da coluna `items.status`.
 * @returns {string} Texto traduzido, ou o próprio valor se for
 *                    desconhecido (fallback de segurança).
 */
function formatStatus(status) {

    const map = {
        disponivel: 'Disponível',
        reservado: 'Reservado',
        doado: 'Doado',
        removido: 'Removido'
    };

    return map[status] || status;
}

/**
 * getStatusClass
 * --------------
 * Devolve a classe CSS correspondente ao estado do item, usada para
 * colorir o badge de estado (verde/amarelo/cinzento, etc., definido
 * no CSS).
 *
 * @param {string} status - Valor bruto da coluna `items.status`.
 * @returns {string} Nome da classe CSS, ou string vazia se não
 *                    houver mapeamento (ex: 'removido').
 */
function getStatusClass(status) {

    const map = {
        disponivel: 'available',
        reservado: 'reserved',
        doado: 'donated'
    };

    return map[status] || '';
}

/**
 * editItem
 * --------
 * Redireciona para a página de edição de item, reaproveitando o
 * mesmo formulário usado para criar itens novos (add_item.html),
 * mas em "modo edição" através do parâmetro `?edit=`.
 *
 * @param {string} itemId - UUID do item a editar.
 */
function editItem(itemId) {
  window.location.href = `add_item.html?edit=${itemId}`;
}

/**
 * markAsDonated
 * -------------
 * Atualiza o estado do item para 'doado' e reflete essa alteração
 * imediatamente no cartão (sem recarregar a página inteira), trocando
 * o badge de estado e substituindo o próprio botão por um de
 * "Reativar".
 *
 * @param {string} itemId - UUID do item a marcar como doado.
 * @param {HTMLElement} btn - Botão que disparou a ação (usado para
 *                            dar feedback visual e localizar o cartão).
 */
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
  // Em vez de re-renderizar o cartão inteiro, substitui-se apenas o
  // HTML do botão (outerHTML) — mais simples do que reconstruir tudo,
  // já que só este elemento muda de comportamento (onclick) e estilo.
  btn.outerHTML = `<button class="btn-edit" style="background:rgba(23,42,58,0.08);color:var(--blue)" onclick="reactivateItem('${itemId}', this)">Reativar</button>`;
}

/**
 * reactivateItem
 * --------------
 * Operação inversa de `markAsDonated`: volta a colocar o item como
 * 'disponivel' e troca o botão de volta para "✓ Doado".
 *
 * @param {string} itemId - UUID do item a reativar.
 * @param {HTMLElement} btn - Botão que disparou a ação.
 */
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

/**
 * deleteItem
 * ----------
 * Remove permanentemente um item e todas as suas dependências diretas.
 *
 * Ordem de remoção importante (por causa de constraints de chave
 * estrangeira/FK na base de dados): primeiro apagam-se as tabelas
 * "filhas" que referenciam o item (imagens, favoritos, pedidos), e só
 * depois o próprio item. Caso contrário, a base de dados rejeitaria o
 * delete do item enquanto ainda existissem registos a apontar para ele.
 *
 * Caso especial: `messages` também tem uma coluna `item_id`, mas as
 * mensagens representam histórico de conversas entre utilizadores —
 * não faz sentido apagá-las só porque o item referenciado deixou de
 * existir. Por isso, em vez de fazer DELETE, fazemos UPDATE para
 * `item_id = null`, preservando a conversa mas "desligando-a" do item
 * removido.
 *
 * @param {string} itemId - UUID do item a remover.
 * @param {HTMLElement} [btn] - Botão que disparou a ação (opcional,
 *                              usado apenas para feedback visual).
 */
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

    // Em vez de remover o cartão do DOM manualmente, recarrega-se a
    // página inteira — mais simples, e como a lista é pequena (itens
    // de um só utilizador) o custo de performance é negligível.
    location.reload();
}
