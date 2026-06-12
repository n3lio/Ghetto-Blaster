// Minimal service worker — caches the SPA shell so the player UI loads even
// when the LAN is briefly unreachable. We deliberately don't cache audio
// streams (they're large and the user can't really listen offline anyway).

const CACHE = 'ghetto-blaster-v1';
const SHELL = ['/', '/index.html', '/style.css', '/visualizer.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache API calls or audio/cover streams — they need to be fresh and
  // would blow the cache budget.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/api/stream/') ||
    url.pathname.startsWith('/api/cover/')
  ) {
    return;
  }
  // Stale-while-revalidate for the shell assets.
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res && res.status === 200) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    ),
  );
});
