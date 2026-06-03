/* ─────────────────────────────────────────────────────
   ShareBox — service-worker.js
   Estratégia:
   - App shell (HTML, CSS, fontes, ícones) → Cache First
   - Imagens externas (Unsplash) → Network First com fallback
   - API Supabase → Network Only (dados sempre frescos)
───────────────────────────────────────────────────── */

const CACHE_NAME = 'sharebox-v1';
const OFFLINE_PAGE = '/home.html';

// Ficheiros do app shell — cacheados na instalação
const APP_SHELL = [
  '/home.html',
  '/communities.html',
  '/community-detail.html',
  '/create-community.html',
  '/messages.html',
  '/chat.html',
  '/item-detail.html',
  '/add-item.html',
  '/profile.html',
  '/login.html',
  '/register.html',
  '/manifest.json',

  // CSS
  '/css/global.css',
  '/css/home.css',
  '/css/communities.css',
  '/css/community-detail.css',
  '/css/create-community.css',
  '/css/messages.css',
  '/css/item-detail.css',
  '/css/add-item.css',
  '/css/profile.css',
  '/css/login.css',

  // Fonts
  '/fonts/BRLNSR.TTF',

  // Ícones
  '/images/Icons/family_home.png',
  '/images/Icons/icone2@4x-8.png',
  '/images/Icons/add_circle.png',
  '/images/Icons/business_messages.png',
  '/images/Icons/icone5@4x-8.png',
  '/images/Icons/favorite.png',
  '/images/Icons/arrow_circle_up.png',
  '/images/Icons/topic.png',
  '/images/Icons/icone4@4x-8.png',
  '/images/Icons/notifications_unread.png',
  '/images/Icons/apparel.png',
  '/images/Icons/auto_stories.png',
  '/images/Icons/bed.png',
  '/images/Icons/desktop_windows.png',
  '/images/Icons/sports_football.png',
  '/images/Icons/Ativo 11@4x-8.png',
  '/images/Icons/Icone3@4x-8.png',
  '/images/Icons/icone7@4x-8.png',
  '/images/Icons/icone10@4x-8.png',

  // Logo
  '/images/Logo/logoinicial.png',
  '/images/Logo/logo_white.png',
  '/images/Logo/Logo2@4x-8.png',

  // Banner
  '/images/Banner/Billboard.png',
];

// ── INSTALL — pré-cache do app shell ────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // activa imediatamente sem esperar fechar tabs
  );
});

// ── ACTIVATE — limpa caches antigos ─────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim()) // controla tabs abertas imediatamente
  );
});

// ── FETCH — estratégias por tipo de pedido ───────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Supabase API → Network Only (nunca cachear dados de API)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Imagens externas (Unsplash, etc.) → Network First, cache como fallback
  if (url.hostname.includes('unsplash.com') || url.hostname.includes('images.unsplash')) {
    event.respondWith(networkFirstWithCache(request, 'sharebox-images-v1'));
    return;
  }

  // 3. App shell (HTML, CSS, fontes, ícones locais) → Cache First
  if (request.method === 'GET') {
    event.respondWith(cacheFirstWithNetwork(request));
    return;
  }
});

// ── Cache First: serve do cache, actualiza em background
async function cacheFirstWithNetwork(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Actualiza o cache em background sem bloquear a resposta
    fetchAndCache(request, CACHE_NAME);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline e não está em cache → página offline
    const offlinePage = await caches.match(OFFLINE_PAGE);
    return offlinePage || new Response('Sem ligação à internet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// ── Network First: tenta rede, usa cache se falhar
async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503 });
  }
}

// ── Actualiza cache em background sem bloquear
async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
  } catch {
    // Silencioso — já estamos a servir do cache
  }
}

// ── SYNC — sincroniza mensagens pendentes quando volta online
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  // Quando ligarmos ao Supabase, aqui processamos mensagens
  // que ficaram pendentes enquanto estava offline
  const db = await openIndexedDB();
  const pending = await db.getAll('pending-messages');
  // Por implementar quando integrarmos o Supabase
  console.log('[SW] Sync: mensagens pendentes:', pending.length);
}

// ── IndexedDB helper (para fila offline futura) ──────
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sharebox-offline', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('pending-messages', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve({
      getAll: store => new Promise((res, rej) => {
        const tx = e.target.result.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      })
    });
    req.onerror = () => reject(req.error);
  });
}

// ── PUSH — notificações push (preparado para Supabase Realtime)
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'ShareBox', body: event.data.text() };
  }

  const options = {
    body: data.body || 'Nova notificação',
    icon: '/images/Logo/logoinicial.png',
    badge: '/images/Logo/logoinicial.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/home.html' },
    actions: [
      { action: 'open', title: 'Ver' },
      { action: 'close', title: 'Fechar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ShareBox', options)
  );
});

// ── NOTIFICATION CLICK — abre a página certa ao clicar
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') return;

  const url = event.notification.data?.url || '/home.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Se já tem uma tab aberta, foca-a
        for (const client of clientList) {
          if (client.url.includes(url) && 'focus' in client) {
            return client.focus();
          }
        }
        // Senão, abre uma nova tab
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});