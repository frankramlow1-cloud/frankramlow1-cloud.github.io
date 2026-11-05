// PDF-Werkstatt – Startspeicher (Service Worker), robuste Fassung
// Nimmt außerdem Dateien entgegen, die aus anderen Apps hierher „geteilt“ werden (Ablage 'pdfw-geteilt' bleibt erhalten).
// Die App startet IMMER aus dem Speicher im Handy – egal ob der Server aus ist, hängt oder Fehler meldet.
// Wichtig: Dieser Speicher räumt nur seine EIGENEN alten Fassungen auf, niemals die der anderen Apps.
const PREFIX = 'pdfw-v';
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
const SCOPE = self.registration.scope;
const PAGE = new URL('index.html', SCOPE).href;
const abs = f => new URL(f, SCOPE).href;

// Netzabruf mit Zeitlimit; Fehlerantworten (z. B. 404, 504) zählen als „kein Netz“
async function net(req, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(req, { signal: ctl.signal, cache: 'no-store' });
    return (r && r.ok) ? r : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// fehlende App-Dateien nachladen (repariert den Speicher von selbst)
async function ensureCached(force) {
  const c = await caches.open(CACHE);
  for (const f of FILES) {
    const key = abs(f);
    if (!force && await c.match(key)) continue;
    const r = await net(key, 15000);
    if (r) await c.put(key, r);
  }
}

// Anzeige in der App: ist der Speicher gefüllt?
self.addEventListener('message', e => {
  if (e.data !== 'check') return;
  e.waitUntil(caches.open(CACHE).then(c => c.match(PAGE)).then(hit => { if (e.source) e.source.postMessage({ cached: !!hit }); }));
});

self.addEventListener('install', e => {
  e.waitUntil(ensureCached(true).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Datei wurde aus einer anderen App hierher „geteilt“ (unverändert übernommen)
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/teilen')) {
    e.respondWith((async () => {
      try {
        const data = await req.formData();
        const files = data.getAll('dateien').filter(f => f && typeof f !== 'string');
        const cache = await caches.open('pdfw-geteilt');
        for (const k of await cache.keys()) await cache.delete(k);
        let i = 0;
        for (const f of files) {
          await cache.put(new URL('geteilt/' + (i++) + '-' + Date.now(), SCOPE).href,
            new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'Datei') } }));
        }
      } catch (err) { /* trotzdem App öffnen */ }
      return Response.redirect(new URL('index.html?geteilt=1', SCOPE).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin || !req.url.startsWith(SCOPE)) return;
  if (url.pathname.includes('/geteilt/')) return;
  const isPage = req.mode === 'navigate' || url.href.split(/[?#]/)[0] === SCOPE;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const key = isPage ? PAGE : url.href.split(/[?#]/)[0];
    const hit = await c.match(key);
    if (hit) {
      // sofort aus dem Speicher starten; im Hintergrund still prüfen, ob etwas fehlt
      if (isPage) e.waitUntil(ensureCached(false).catch(() => {}));
      return hit;
    }
    const r = await net(req, isPage ? 8000 : 15000);
    if (r) {
      if (FILES.some(f => abs(f) === key)) e.waitUntil(c.put(key, r.clone()).catch(() => {}));
      if (isPage) e.waitUntil(ensureCached(false).catch(() => {}));
      return r;
    }
    if (isPage) {
      return new Response('<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="margin:0;background:#1a0a03;color:#ecc56a;font:22px/1.5 Georgia,serif;padding:40px 24px;text-align:center">' +
        '<h2>PDF-Werkstatt</h2><p>Der Speicher dieser App ist leer.</p><p>Bitte <b>einmal</b> den Server im Datei-Explorer starten und die App öffnen.<br>Danach startet sie wieder immer von allein.</p>' +
        '<p><button onclick="location.reload()" style="font:bold 22px Georgia;padding:14px 28px;border-radius:14px;border:0;background:#d6b05e;color:#3b2306">Nochmal versuchen</button></p></body>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 504, statusText: 'offline' });
  })());
});
