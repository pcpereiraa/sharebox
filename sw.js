/* ─────────────────────────────────────────────────────
   ShareBox — sw.js
───────────────────────────────────────────────────── */

const CACHE_NAME  = 'sharebox-v3';
const OFFLINE_URL = 'offline.html';

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
  'css/home.css',
  'css/communities.css',
  'css/community_detail.css',
  'css/messages.css',
  'css/item_detail.css',
  'css/add_item.css',
  'css/add_community.css',
  'css/profile.css',
  'css/login.css',
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
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // addAll individualmente para não falhar tudo se um ficheiro não existir
        return Promise.allSettled(
          APP_SHELL.map(url => cache.add(url).catch(() => console.warn('[SW] Não cacheado:', url)))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API → Network Only
  if (url.hostname.includes('supabase.co') || url.hostname.includes('cdn.jsdelivr.net')) {
    return;
  }

  // Imagens Unsplash → Network First
  if (url.hostname.includes('unsplash.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Navegação entre páginas (mudar de URL/abrir link) → tratamento especial
  if (event.request.mode === 'navigate') {
    event.respondWith(navigationHandler(event.request));
    return;
  }

  // Tudo o resto (CSS, JS, imagens locais) → Cache First
  if (event.request.method === 'GET') {
    event.respondWith(cacheFirst(event.request));
  }
});

// ── Navegação: tenta rede, cai para cache, cai para offline.html ────
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
      return response;
    }
    throw new Error('Resposta inválida');
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Sem ligação à internet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

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
    return caches.match(OFFLINE_URL);
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open('sharebox-images-v2');
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return caches.match(request) || new Response('', { status: 503 });
  }
}

// ── PUSH ──────────────────────────────────────────────
self.addEventListener('push', event => {
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
      data:    { url: data.url || 'home.html' },
    })
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || 'home.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});