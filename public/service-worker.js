const CACHE_NAME = 'vaultpass-shell-v7';
const SHELL_FILES = [
  '/',
  '/css/style.css',
  '/js/crypto.js',
  '/js/quickunlock.js',
  '/js/api.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Solo file dell'app: le richieste verso altri domini (es. le icone dei siti) passano
  // direttamente dal browser, altrimenti la CSP (connect-src 'self') le bloccherebbe.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }
  // Network-first: garantisce che gli aggiornamenti dell'app arrivino subito,
  // usando la cache solo come fallback quando sei offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
