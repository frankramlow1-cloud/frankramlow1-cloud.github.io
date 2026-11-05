// PDF-Werkstatt – speichert die App im Handy und nimmt geteilte Dateien entgegen
const CACHE = 'pdfw-v4';
const FILES = [
  'index.html', 'app.js', 'docs.js', 'manifest.json', 'holz.jpg', 'szene.jpg', 'icon-192.png', 'icon-512.png',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js', 'lib/jszip.min.js',
  'lib/standard_fonts/FoxitDingbats.pfb', 'lib/standard_fonts/FoxitFixed.pfb', 'lib/standard_fonts/FoxitFixedBold.pfb',
  'lib/standard_fonts/FoxitFixedBoldItalic.pfb', 'lib/standard_fonts/FoxitFixedItalic.pfb', 'lib/standard_fonts/FoxitSerif.pfb',
  'lib/standard_fonts/FoxitSerifBold.pfb', 'lib/standard_fonts/FoxitSerifBoldItalic.pfb', 'lib/standard_fonts/FoxitSerifItalic.pfb',
  'lib/standard_fonts/FoxitSymbol.pfb', 'lib/standard_fonts/LiberationSans-Bold.ttf', 'lib/standard_fonts/LiberationSans-BoldItalic.ttf',
  'lib/standard_fonts/LiberationSans-Italic.ttf', 'lib/standard_fonts/LiberationSans-Regular.ttf',
  'lib/wasm/jbig2.wasm', 'lib/wasm/openjpeg.wasm', 'lib/wasm/qcms_bg.wasm', 'lib/wasm/jbig2_nowasm_fallback.js', 'lib/wasm/openjpeg_nowasm_fallback.js',
  'lib/iccs/CGATS001Compat-v2-micro.icc'
];

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
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pdfw-v') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Datei wurde aus einer anderen App hierher „geteilt“
  if (e.request.method === 'POST' && url.pathname.endsWith('/teilen')) {
    e.respondWith((async () => {
      try {
        const data = await e.request.formData();
        const files = data.getAll('dateien').filter(f => f && typeof f !== 'string');
        const cache = await caches.open('pdfw-geteilt');
        for (const k of await cache.keys()) await cache.delete(k);
        let i = 0;
        for (const f of files) {
          await cache.put(new URL('geteilt/' + (i++) + '-' + Date.now(), self.registration.scope).href,
            new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'Datei') } }));
        }
      } catch (err) { /* trotzdem App öffnen */ }
      return Response.redirect(new URL('index.html?geteilt=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
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
