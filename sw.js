/**
 * sw.js — Service Worker
 * -----------------------
 * O Service Worker é um script que o browser executa em segundo
 * plano, separado da página em si (não tem acesso ao DOM), e que
 * funciona como um "proxy" entre a aplicação e a rede. É a peça
 * central que torna o ShareBox uma PWA (Progressive Web App) capaz
 * de funcionar offline e de receber notificações push.
 *
 * Responsabilidades deste ficheiro:
 *   1. INSTALL    → pré-carregar (cachear) os ficheiros essenciais
 *                   da aplicação (o "app shell") na primeira visita.
 *   2. ACTIVATE   → limpar caches antigos de versões anteriores.
 *   3. FETCH      → intercetar todas as pedidos de rede da app e
 *                   decidir, por tipo de recurso, se deve responder
 *                   a partir da cache ou da rede (estratégias de
 *                   cache diferentes por categoria de ficheiro).
 *   4. PUSH       → receber notificações push do servidor e mostrá-las
 *                   ao utilizador mesmo que a aplicação esteja fechada.
 *   5. NOTIFICATIONCLICK → reagir ao clique numa notificação,
 *                   focando ou abrindo a janela da aplicação.
 */


const CACHE_NAME  = 'sharebox-v3';
const OFFLINE_URL = 'offline.html';

// "App shell": lista de todos os ficheiros essenciais da aplicação
// (HTML, CSS, JS, fontes e ícones) que são pré-cacheados no momento
// da instalação do Service Worker, garantindo que a app continua a
// abrir e a navegar mesmo sem ligação à internet.
const APP_SHELL = [
  'index.html',
  'offline.html',
  'home.html',
  'login.html',
  'register.html',
  'communities.html',
  'community_detail.html',
  'messages.html',
  'chat.html',
  'item_detail.html',
  'add_item.html',
  'add_community.html',
  'profile.html',
  'edit_profile.html',
  'change_password.html',
  'notifications.html',
  'privacy.html',
  'help.html',
  'report.html',
  'terms.html',
  'my_items.html',
  'my_communities.html',
  'view_profile.html',
  'favorites.html',
  'forgot_password.html',
  'reset_password.html',
  'manifest.json',

  // CSS
  'css/global.css',
  'css/animations.css',
  'css/components.css',
  'css/index.css',
  'css/home.css',
  'css/communities.css',
  'css/community_detail.css',
  'css/messages.css',
  'css/item_detail.css',
  'css/add_item.css',
  'css/add_community.css',
  'css/profile.css',
  'css/login.css',
  'css/register.css',
  'css/my_items.css',

  // JS
  'js/supabase.js',
  'js/auth.js',
  'js/home.js',
  'js/communities.js',
  'js/community_detail.js',
  'js/messages.js',
  'js/chat.js',
  'js/item_detail.js',
  'js/add_item.js',
  'js/add_community.js',
  'js/profile.js',
  'js/my_items.js',
  'js/my_communities.js',
  'js/view_profile.js',

  // Fontes
  'fonts/BRLNSR.TTF',

  // Ícones
  'images/Icons/family_home.png',
  'images/Icons/icone2@4x-8.png',
  'images/Icons/add_circle.png',
  'images/Icons/business_messages.png',
  'images/Icons/icone5@4x-8.png',
  'images/Icons/favorite.png',

  // Logo
  'images/Logo/logoinicial.png',
  'images/Logo/logo_white.png',
];

// ── INSTALL ───────────────────────────────────────────
/**
 * Evento 'install'
 * ----------------
 * Disparado uma única vez quando o browser instala uma nova versão
 * do Service Worker (ex: primeira visita ao site, ou quando o
 * conteúdo deste ficheiro sw.js muda).
 *
 * `event.waitUntil()` diz ao browser para não considerar a instalação
 * terminada até a promessa indicada resolver — isto garante que a
 * cache fica completamente preparada antes do SW passar a controlar
 * a página.
 */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // addAll individualmente para não falhar tudo se um ficheiro não existir
        // Ao contrário de `cache.addAll(APP_SHELL)` (que falha por
        // completo se QUALQUER um dos ficheiros não existir/der erro),
        // aqui faz-se um `cache.add()` por ficheiro dentro de um
        // `Promise.allSettled()`. Isto torna a instalação resiliente:
        // se um ficheiro estiver em falta ou o caminho estiver errado,
        // só esse ficheiro fica sem cache (com um aviso na consola),
        // e todos os outros continuam a ser cacheados normalmente.
        return Promise.allSettled(
          APP_SHELL.map(url => cache.add(url).catch(() => console.warn('[SW] Não cacheado:', url)))
        );
      })
      // `self.skipWaiting()` faz com que este novo Service Worker
      // passe a ativo imediatamente, sem esperar que todas as
      // páginas/abas abertas do site sejam fechadas (comportamento
      // padrão do browser seria esperar por isso).
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────
/**
 * Evento 'activate'
 * ------------------
 * Disparado depois do 'install', quando o novo Service Worker passa
 * a controlar a página. É o momento ideal para limpar caches de
 * versões antigas (ex: 'sharebox-v2'), libertando espaço e evitando
 * que ficheiros desatualizados continuem a ser servidos.
 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      // Filtra todas as caches cujo nome NÃO corresponde à versão
      // atual (CACHE_NAME) e apaga-as.
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      // `self.clients.claim()` faz com que o Service Worker assuma
      // imediatamente o controlo de todas as páginas já abertas
      // (sem isto, só passaria a controlar páginas abertas DEPOIS
      // desta ativação).
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────
/**
 * Evento 'fetch'
 * --------------
 * Disparado para CADA pedido de rede feito pela página (imagens,
 * scripts, CSS, chamadas à API, navegação entre páginas, etc.).
 * Aqui decide-se, com base no destino do pedido (hostname/tipo),
 * qual estratégia de cache aplicar.
 */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API → Network Only
  // Pedidos à API do Supabase (dados em tempo real, autenticação) e
  // ao CDN do jsDelivr NÃO devem ser intercetados — saindo deste
  // listener sem chamar `event.respondWith()`, o pedido segue o
  // comportamento normal do browser (vai sempre à rede). Cachear
  // estes pedidos seria perigoso: dados podiam ficar desatualizados
  // (ex: ver um item já doado como se ainda estivesse disponível).
  if (url.hostname.includes('supabase.co') || url.hostname.includes('cdn.jsdelivr.net')) {
    return;
  }

  // Imagens Unsplash → Network First
  // As imagens de itens (vindas do Unsplash, usadas nos dados
  // sintéticos) tentam ir primeiro à rede para obter a versão mais
  // recente, mas caem para a cache se não houver ligação.
  if (url.hostname.includes('unsplash.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Navegação entre páginas (mudar de URL/abrir link) → tratamento especial
  // `mode === 'navigate'` identifica pedidos de navegação completa
  // (o utilizador a abrir/mudar de página), distintos de pedidos de
  // sub-recursos (imagens, scripts). Estes têm uma lógica própria
  // (ver `navigationHandler`) que cai para `offline.html` em último
  // recurso.
  if (event.request.mode === 'navigate') {
    event.respondWith(navigationHandler(event.request));
    return;
  }

  // Tudo o resto (CSS, JS, imagens locais) → Cache First
  // Só se intercetam pedidos GET (POST/PUT/DELETE não fazem sentido
  // cachear). Ficheiros estáticos da própria app mudam raramente,
  // por isso prioriza-se a velocidade da cache sobre a rede.
  if (event.request.method === 'GET') {
    event.respondWith(cacheFirst(event.request));
  }
});

// ── Navegação: tenta rede, cai para cache, cai para offline.html ────
/**
 * navigationHandler
 * ------------------
 * Estratégia "Network First com fallback duplo" para pedidos de
 * navegação (mudança de página):
 *   1. Tenta sempre a rede primeiro (para garantir conteúdo
 *      atualizado da página HTML).
 *   2. Se a rede responder com sucesso, guarda uma cópia na cache
 *      (`cache.put`) para uso futuro offline, e devolve a resposta.
 *   3. Se a rede falhar (sem ligação) ou responder mal, tenta
 *      encontrar essa página já guardada na cache.
 *   4. Se nem isso existir, devolve a página `offline.html` como
 *      último recurso — garantindo que o utilizador nunca vê o erro
 *      genérico do browser ("sem ligação"), mas sim uma página
 *      personalizada da própria app.
 *
 * @param {Request} request - O pedido de navegação interceptado.
 * @returns {Promise<Response>}
 */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      // `.clone()` é necessário porque o corpo (body) de uma Response
      // só pode ser lido uma vez — uma cópia vai para a cache, a
      // original é devolvida ao browser para renderizar a página.
      cache.put(request, response.clone());
      return response;
    }
    throw new Error('Resposta inválida');
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    // Último fallback absoluto: se nem a página offline.html estiver
    // em cache (situação extrema, ex: falha na instalação), devolve
    // uma resposta de texto simples em vez de deixar o pedido falhar
    // sem resposta nenhuma.
    return new Response('Sem ligação à internet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

/**
 * cacheFirst
 * ----------
 * Estratégia "Cache First": tenta primeiro responder a partir da
 * cache (resposta instantânea, funciona offline); só se o recurso
 * não estiver em cache é que vai à rede — e, nesse caso, guarda o
 * resultado em cache para a próxima vez.
 *
 * Ideal para ficheiros estáticos (CSS, JS, imagens locais) que mudam
 * raramente: prioriza velocidade e disponibilidade offline sobre
 * "frescura" do conteúdo.
 *
 * @param {Request} request - O pedido a responder.
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Se o recurso não estiver em cache E não houver rede, cai-se
    // para a página offline (ainda que, estritamente, este fallback
    // faça mais sentido para pedidos de página do que para um
    // ficheiro CSS/JS isolado — é uma simplificação aceitável aqui).
    return caches.match(OFFLINE_URL);
  }
}

/**
 * networkFirst
 * ------------
 * Estratégia "Network First": tenta sempre a rede primeiro (para
 * obter a versão mais atual), e só recorre à cache se a rede falhar.
 * Usa uma cache SEPARADA (`sharebox-images-v2`) da cache principal do
 * app shell, isolando as imagens externas (Unsplash) do versionamento
 * do resto da aplicação.
 *
 * @param {Request} request - O pedido a responder.
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open('sharebox-images-v2');
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sem rede: tenta a cache; se também não existir, devolve uma
    // resposta vazia com status 503 em vez de deixar a imagem
    // simplesmente falhar a carregar sem resposta alguma.
    return caches.match(request) || new Response('', { status: 503 });
  }
}

// ── PUSH ──────────────────────────────────────────────
/**
 * Evento 'push'
 * --------------
 * Disparado quando o navegador recebe uma notificação push enviada
 * pelo servidor (neste projeto, despachada através de uma Edge
 * Function do Supabase — ver `notifyNewMessage()` em chat.js). Isto
 * funciona mesmo que a aplicação esteja completamente fechada, porque
 * o Service Worker corre em segundo plano de forma independente da
 * página.
 */
self.addEventListener('push', event => {
  // Sem corpo de dados na mensagem push não há nada a mostrar.
  if (!event.data) return;
  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'ShareBox', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'ShareBox', {
      body:    data.body || 'Nova notificação',
      icon:    'images/Logo/logoinicial.png',
      badge:   'images/Logo/logoinicial.png',
      vibrate: [100, 50, 100],
      // Guarda o URL de destino dentro dos dados da própria
      // notificação, para ser lido mais tarde no evento
      // 'notificationclick' (saber para onde navegar ao clicar).
      data:    { url: data.url || 'home.html' },
    })
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────
/**
 * Evento 'notificationclick'
 * ---------------------------
 * Disparado quando o utilizador clica numa notificação push mostrada
 * pelo evento 'push' acima. Em vez de abrir sempre uma nova janela,
 * tenta primeiro reutilizar uma aba/janela já aberta do ShareBox
 * (comportamento mais natural, semelhante a apps nativas).
 */
self.addEventListener('notificationclick', event => {
  // Fecha a notificação visualmente assim que é clicada.
  event.notification.close();
  const url = event.notification.data?.url || 'home.html';
  event.waitUntil(
    // `includeUncontrolled: true` inclui também páginas que, por
    // algum motivo, não estão atualmente sob o controlo deste
    // Service Worker (ex: abertas antes da primeira ativação).
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Procura uma janela já aberta cujo URL contenha o destino
      // pretendido, e simplesmente foca-a em vez de abrir duplicado.
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      // Nenhuma janela existente corresponde → abre uma nova.
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
