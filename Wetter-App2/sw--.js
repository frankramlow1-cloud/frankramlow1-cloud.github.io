// Wetter-App – speichert nur die App selbst; Wetterdaten kommen immer frisch aus dem Internet
const CACHE = 'wetter-v4';
const FILES = ['index.html', 'icons.js', 'holz.jpg', 'karte.jpg', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(FILES.map(async f => {
      const res = await fetch(f, { cache: 'reload' });
      if (res.ok) await c.put(new URL(f, self.registration.scope).href, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('wetter-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;          // Wetterdaten: nicht anfassen
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (e.request.mode === 'navigate') {
      const page = await c.match(new URL('index.html', self.registration.scope).href);
      if (page) return page;
    }
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
