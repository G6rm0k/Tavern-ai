// Minimal service worker: only there so the app can be installed to a phone's
// home screen. It deliberately does NOT cache API responses — chats and
// characters must always come from the server, and a stale cache of encrypted
// data would be worse than useless.

const SHELL = 'wesaid-shell-v1';
const ASSETS = [
  '/', '/index.html', '/css/main.css', '/icon.svg',
  '/js/util.js', '/js/i18n.js', '/js/api.js', '/js/fx.js', '/js/liquiddrop.js',
  '/js/auth.js', '/js/modelloader.js', '/js/settings.js', '/js/wizard.js',
  '/js/translator.js', '/js/charwizard.js', '/js/characters.js', '/js/discover.js',
  '/js/characters_patch.js', '/js/chat.js', '/js/app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache data

  // Network first, fall back to the cached shell when offline.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
