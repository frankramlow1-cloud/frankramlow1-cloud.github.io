/* =====================================================================
   PDF-Werkstatt – Hauptprogramm
   Lesen · PDF erstellen · PDF trennen · Unterschrift einfügen
   Alles läuft auf dem Handy, nichts wird hochgeladen.
   ===================================================================== */
import * as pdfjsLib from './lib/pdf.min.js';

const APP_VERSION = 4;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.js', import.meta.url).href;
const PDFOPT = {
  standardFontDataUrl: new URL('./lib/standard_fonts/', import.meta.url).href,
  wasmUrl: new URL('./lib/wasm/', import.meta.url).href,
  iccUrl: new URL('./lib/iccs/', import.meta.url).href,
  isEvalSupported: false,
  enableXfa: false
};
const { PDFDocument, degrees } = PDFLib;

/* ---------------- kleine Helfer ---------------- */
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DPR = () => Math.min(window.devicePixelRatio || 1, 2.5);
const baseName = (n) => n.replace(/\.[^.]+$/, '');
const safeName = (n) => (n || 'Dokument').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Dokument';
const naturalSort = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function busy(text) { $('busyText').textContent = text || 'Bitte warten …'; $('busy').classList.add('open'); }
function busyText(text) { $('busyText').textContent = text; }
function done() { $('busy').classList.remove('open'); }
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

let modalResolve = null;
function modal(title, text, buttons) {
  $('mTitle').textContent = title;
  $('mText').innerHTML = text;
  const box = $('mBtns'); box.innerHTML = '';
  return new Promise(res => {
    modalResolve = res;
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.green ? ' green' : '') + (b.full ? ' full' : '');
      el.textContent = b.label;
      el.onclick = () => { closeModal(); res(b.value); };
      box.appendChild(el);
    });
    $('modal').classList.add('open');
  });
}
function closeModal(value) {
  $('modal').classList.remove('open');
  if (modalResolve && value !== undefined) modalResolve(value);
  modalResolve = null;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* Dateiauswahl */
function pick(inputId, accept) {
  const inp = $(inputId);
  if (accept !== undefined) inp.accept = accept;
  inp.value = '';
  return new Promise(res => {
    const ok = () => { cleanup(); res(Array.from(inp.files || [])); };
    const cancel = () => { cleanup(); res([]); };
    const cleanup = () => { inp.removeEventListener('change', ok); inp.removeEventListener('cancel', cancel); };
    inp.addEventListener('change', ok);
    inp.addEventListener('cancel', cancel);
    inp.click();
  });
}

/* Speichern (Download-Ordner) und Teilen */
function download(bytes, name, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
async function shareFile(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  toast('Teilen ist hier nicht möglich – die Datei liegt im Ordner „Download“.');
}

/* PDF mit pdf.js öffnen (inkl. Passwortabfrage) */
async function openPdfJs(bytes) {
  const task = pdfjsLib.getDocument(Object.assign({ data: bytes.slice(0) }, PDFOPT));
  task.onPassword = (cb, reason) => {
    const pw = prompt(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
      ? 'Falsches Passwort. Bitte noch einmal eingeben:'
      : 'Dieses PDF ist mit einem Passwort geschützt.\nBitte Passwort eingeben:');
    if (pw === null) task.destroy(); else cb(pw);
  };
  try { return await task.promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw friendly('Ohne Passwort kann dieses PDF nicht geöffnet werden.');
    if (task.destroyed) throw friendly('Abgebrochen.');
    throw friendly('Dieses PDF ist beschädigt und kann nicht geöffnet werden.');
  }
}
function closePdf(doc) { try { if (doc && doc.loadingTask) doc.loadingTask.destroy(); else if (doc && doc.destroy) doc.destroy(); } catch (e) {} }
function friendly(msg) { const e = new Error(msg); e.friendly = true; return e; }
const errMsg = (e) => (e && e.friendly) ? e.message : 'Da ist leider etwas schiefgegangen. (' + ((e && e.message) || e) + ')';

/* PDF mit pdf-lib laden – bei Verschlüsselung Hinweis zurückgeben */
async function loadPdfLib(bytes) {
  try {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { doc: d, encrypted: d.isEncrypted };
  } catch (e) {
    return { doc: null, encrypted: true };
  }
}
/* Seiten als Bilder übernehmen (Notlösung für geschützte PDFs) */
async function rasterInto(outDoc, pdfjsDoc, indices, progress) {
  for (let k = 0; k < indices.length; k++) {
    const page = await pdfjsDoc.getPage(indices[k] + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, 2600 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const img = await outDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const p = outDoc.addPage([vp1.width, vp1.height]);
    p.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    c.width = c.height = 0;
    if (progress) progress(k + 1, indices.length);
    page.cleanup();
  }
}

/* ---------------- Navigation (Zurück-Taste des Handys) ---------------- */
let current = null;
const cleaners = {};
function openScreen(id) {
  for (const s of document.querySelectorAll('.screen')) if (s.id !== id) { s.classList.remove('open'); if (cleaners[s.id] && current === s.id) cleaners[s.id](); }
  $(id).classList.add('open');
  if (current === null) history.pushState({ s: id }, ''); else history.replaceState({ s: id }, '');
  current = id;
}
function closeScreen() {
  if (!current) return;
  $(current).classList.remove('open');
  if (cleaners[current]) cleaners[current]();
  current = null;
}
window.addEventListener('popstate', () => {
  if ($('modal').classList.contains('open')) { closeModal(null); if (current) history.pushState({ s: current }, ''); return; }
  closeScreen();
});
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => history.back()));

/* ---------------- Startseite ---------------- */
function fitStage() {
  // Bild füllt den ganzen Bildschirm (wie „cover“); die Schubladen bleiben immer ganz sichtbar
  const W = 768, H = 1376, vw = window.innerWidth, vh = window.innerHeight;
  let s = Math.max(vw / W, vh / H);
  let sx = s, sy = s;
  if (W * s > vw && vw / 520 < s) { // Schubladen (x 176–670) dürfen nicht abgeschnitten werden → notfalls leicht strecken
    sx = Math.min(s, vw / 560); sy = vh / H;
  }
  $('stage').style.setProperty('--sx', sx);
  $('stage').style.setProperty('--sy', sy);
}
window.addEventListener('resize', fitStage);
fitStage();
$('tRead').onclick = async () => { const f = await pick('pickAny', ''); if (f[0]) openViewer(f[0]); };
$('tCreate').onclick = () => openCreate([], true);
$('tSplit').onclick = async () => { const f = await pick('pickPdf'); if (f[0]) openSplit(f[0]); };
$('tSign').onclick = async () => { const f = await pick('pickPdf'); if (f[0]) openSign(f[0]); };

/* =====================================================================
   1) LESEN
   ===================================================================== */
const view = { file: null, kind: null, zoom: 1, pdf: null, pages: [], obs: null, renderQ: [], rendering: false, token: 0 };
const ZMIN = 1, ZMAX = 5;

async function openViewer(file) {
  closeModal(null);
  openScreen('viewer');
  cleanupViewer();
  const tok = ++view.token;
  view.file = file; view.kind = Docs.kindOf(file); view.zoom = 1;
  $('viewTitle').textContent = file.name;
  const body = $('viewBody');
  body.className = 'body'; body.innerHTML = ''; body.scrollTop = 0; body.scrollLeft = 0;
  const foot = $('viewFoot'); foot.innerHTML = '';
  const addBtn = (label, fn, green) => { const b = document.createElement('button'); b.className = 'btn' + (green ? ' green' : ''); b.textContent = label; b.onclick = fn; foot.appendChild(b); };

  try {
    if (view.kind === 'pdf') {
      busy('PDF wird geöffnet …');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await openPdfJs(bytes);
      if (tok !== view.token) return;
      view.pdf = doc;
      body.classList.add('pdf');
      await buildPdfPages(doc, tok);
      addBtn('✂ Trennen', () => openSplit(file));
      addBtn('✒ Unterschrift', () => openSign(file));
      addBtn('⤴ Senden', () => shareFile(file), true);
    } else if (view.kind === 'image') {
      body.classList.add('image');
      const url = URL.createObjectURL(file);
      view.imgUrl = url;
      const wrap = document.createElement('div'); wrap.className = 'img-view';
      const img = document.createElement('img');
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(friendly('Dieses Bild kann nicht angezeigt werden.')); });
      wrap.appendChild(img); body.appendChild(wrap);
      view.img = img;
      layoutImage();
      addBtn('Als PDF speichern', () => openCreate([file], false));
      addBtn('⤴ Senden', () => shareFile(file), true);
    } else {
      busy('Dokument wird gelesen …');
      await frame();
      const model = await Docs.parse(file);
      if (tok !== view.token) return;
      view.model = model;
      const d = document.createElement('div');
      d.className = 'paper doc' + (model.book ? ' book' : '');
      d.innerHTML = Docs.toHTML(model);
      body.appendChild(d);
      view.fz = 1;
      addBtn('Als PDF speichern', () => openCreate([file], false));
      addBtn('⤴ Senden', () => shareFile(file), true);
    }
  } catch (e) {
    if (!e.friendly) console.error(e);
    body.innerHTML = `<div class="paper err-box"><b>Kann nicht geöffnet werden</b>${esc(errMsg(e))}</div>`;
  } finally { done(); }
}

function cleanupViewer() {
  if (view.obs) view.obs.disconnect();
  view.obs = null;
  closePdf(view.pdf);
  view.pdf = null; view.pages = []; view.renderQ = [];
  if (view.imgUrl) URL.revokeObjectURL(view.imgUrl);
  view.imgUrl = null; view.img = null; view.model = null;
  $('pageInfo').classList.remove('show');
}
cleaners.viewer = () => { view.token++; cleanupViewer(); $('viewBody').innerHTML = ''; };

async function buildPdfPages(doc, tok) {
  const body = $('viewBody');
  const wrap = document.createElement('div'); wrap.className = 'pages';
  body.appendChild(wrap);
  view.pages = [];
  const n = doc.numPages;
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    if (tok !== view.token) return;
    const vp = page.getViewport({ scale: 1 });
    const div = document.createElement('div'); div.className = 'pg';
    div.innerHTML = `<span class="num">${i}</span>`;
    wrap.appendChild(div);
    view.pages.push({ i, page, ratio: vp.height / vp.width, w1: vp.width, div, canvas: null, renderedAt: 0 });
    if (i === 1) { layoutPdf(); done(); }
    if (i % 20 === 0) await frame();
  }
  layoutPdf();
  view.obs = new IntersectionObserver(entries => {
    for (const en of entries) {
      const p = view.pages[+en.target.dataset.idx];
      if (!p) continue;
      p.visible = en.isIntersecting;
      if (en.isIntersecting) queueRender(p);
      else if (p.canvas && Math.abs(en.boundingClientRect.top) > window.innerHeight * 4) { p.canvas.width = p.canvas.height = 0; p.canvas.remove(); p.canvas = null; p.renderedAt = 0; }
    }
  }, { root: body, rootMargin: '900px 0px' });
  view.pages.forEach((p, k) => { p.div.dataset.idx = k; view.obs.observe(p.div); });
}
function layoutPdf() {
  const body = $('viewBody');
  const baseW = Math.min(body.clientWidth - 16, 1000);
  const w = Math.round(baseW * view.zoom);
  for (const p of view.pages) {
    p.div.style.width = w + 'px';
    p.div.style.height = Math.round(w * p.ratio) + 'px';
  }
  const wrap = body.querySelector('.pages');
  if (wrap) wrap.style.width = Math.max(body.clientWidth - 16, w) + 'px';
}
function queueRender(p) {
  if (!view.renderQ.includes(p)) view.renderQ.push(p);
  pumpRender();
}
async function pumpRender() {
  if (view.rendering) return;
  view.rendering = true;
  try {
    while (view.renderQ.length) {
      // sichtbare Seiten zuerst
      view.renderQ.sort((a, b) => (b.visible ? 1 : 0) - (a.visible ? 1 : 0));
      const p = view.renderQ.shift();
      const cssW = parseFloat(p.div.style.width);
      if (p.canvas && p.renderedAt === cssW) continue;
      let scale = cssW / p.w1 * DPR();
      const maxPx = 14e6;
      if (p.w1 * scale * p.w1 * p.ratio * scale > maxPx) scale = Math.sqrt(maxPx / (p.w1 * p.w1 * p.ratio));
      const vp = p.page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const tok = view.token;
      try {
        await p.page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      } catch (e) { continue; }
      if (tok !== view.token) return;
      if (p.canvas) { p.canvas.width = p.canvas.height = 0; p.canvas.remove(); }
      p.div.prepend(c);
      p.canvas = c; p.renderedAt = cssW;
    }
  } finally { view.rendering = false; }
}
function layoutImage() {
  const body = $('viewBody'), img = view.img;
  if (!img) return;
  const baseW = body.clientWidth - 16;
  const fit = Math.min(baseW, (body.clientHeight - 24) * img.naturalWidth / img.naturalHeight, img.naturalWidth > baseW ? baseW : img.naturalWidth * 2);
  img.style.width = Math.round(Math.max(fit, 40) * view.zoom) + 'px';
}
function setZoom(z, anchor) {
  const body = $('viewBody');
  if (view.kind !== 'pdf' && view.kind !== 'image') {
    view.fz = Math.max(.7, Math.min(2.4, z));
    const d = body.querySelector('.doc'); if (d) d.style.setProperty('--fz', view.fz);
    return;
  }
  const old = view.zoom;
  z = Math.max(ZMIN, Math.min(ZMAX, z));
  if (Math.abs(z - old) < .001) return;
  const ax = anchor ? anchor.x : body.clientWidth / 2, ay = anchor ? anchor.y : body.clientHeight / 2;
  const cx = (body.scrollLeft + ax) / old, cy = (body.scrollTop + ay) / old;
  view.zoom = z;
  if (view.kind === 'pdf') layoutPdf(); else layoutImage();
  body.scrollLeft = cx * z - ax; body.scrollTop = cy * z - ay;
  if (view.kind === 'pdf') view.pages.filter(p => p.visible).forEach(queueRender);
}
const ZSTEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
$('zoomIn').onclick = () => {
  if (view.kind === 'pdf' || view.kind === 'image') setZoom(ZSTEPS.find(s => s > view.zoom + .01) || ZMAX);
  else setZoom((view.fz || 1) + .15);
};
$('zoomOut').onclick = () => {
  if (view.kind === 'pdf' || view.kind === 'image') setZoom([...ZSTEPS].reverse().find(s => s < view.zoom - .01) || ZMIN);
  else setZoom((view.fz || 1) - .15);
};
// Zwei-Finger-Zoom im Leser
(function pinch() {
  const body = $('viewBody');
  const pts = new Map();
  let start = null;
  body.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const r = body.getBoundingClientRect();
      start = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, zoom: view.kind === 'pdf' || view.kind === 'image' ? view.zoom : (view.fz || 1), ratio: 1 };
    }
  });
  body.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && start) {
      const [a, b] = [...pts.values()];
      start.ratio = Math.hypot(a.x - b.x, a.y - b.y) / start.d;
      const el = body.firstElementChild;
      if (el && (view.kind === 'pdf' || view.kind === 'image')) {
        el.style.transformOrigin = `${body.scrollLeft + start.cx}px ${body.scrollTop + start.cy}px`;
        el.style.transform = `scale(${start.ratio})`;
      }
    }
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (start && pts.size < 2) {
      const el = body.firstElementChild;
      if (el) el.style.transform = '';
      if (Math.abs(start.ratio - 1) > .03) setZoom(start.zoom * start.ratio, { x: start.cx, y: start.cy });
      start = null;
    }
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
  // Seitenanzeige beim Blättern
  let t;
  body.addEventListener('scroll', () => {
    if (view.kind !== 'pdf' || !view.pages.length) return;
    const mid = body.getBoundingClientRect().top + body.clientHeight / 2;
    let cur = 1;
    for (const p of view.pages) { const r = p.div.getBoundingClientRect(); if (r.top <= mid) cur = p.i; else break; }
    const pi = $('pageInfo');
    pi.textContent = `Seite ${cur} / ${view.pages.length}`;
    pi.classList.add('show');
    clearTimeout(t); t = setTimeout(() => pi.classList.remove('show'), 1400);
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (current !== 'viewer') return;
    if (view.kind === 'pdf') { layoutPdf(); view.pages.filter(p => p.visible).forEach(queueRender); }
    else if (view.kind === 'image') layoutImage();
  });
})();

/* =====================================================================
   2) PDF ERSTELLEN – alles automatisch in ein PDF
   ===================================================================== */
const create = { items: [] };
const BADGE = { docx: ['W', '#2b579a'], xlsx: ['X', '#217346'], pptx: ['P', '#c43e1c'], odf: ['O', '#1e6aa8'], epub: ['E', '#7a4a1a'], csv: ['X', '#217346'], rtf: ['T', '#666'], doc: ['W', '#2b579a'], html: ['H', '#e44d26'], text: ['T', '#666'] };

function defaultName() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `Dokument_${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}_${p(d.getHours())}${p(d.getMinutes())}`;
}
async function openCreate(files, autoPick) {
  closeModal(null);
  openScreen('create');
  create.items.forEach(it => it.url && URL.revokeObjectURL(it.url));
  create.items = [];
  $('outName').value = files.length === 1 ? safeName(baseName(files[0].name)) : defaultName();
  addFiles(files);
  if (autoPick && !files.length) {
    const f = await pick('pickMany', '');
    if (f.length) addFiles(f.sort(naturalSort));
  }
}
cleaners.create = () => { create.items.forEach(it => it.url && URL.revokeObjectURL(it.url)); create.items = []; $('flist').innerHTML = ''; };
$('createPick').onclick = $('createAdd').onclick = async () => {
  const f = await pick('pickMany', '');
  if (f.length) {
    if (!create.items.length) $('outName').value = f.length === 1 ? safeName(baseName(f[0].name)) : defaultName();
    addFiles(f.sort(naturalSort));
  }
};
function addFiles(files) {
  for (const file of files) {
    const kind = Docs.kindOf(file);
    const it = { file, kind, id: Math.random().toString(36).slice(2) };
    if (Docs.UNSUPPORTED_MSG[kind] && kind !== 'unknown') it.error = kind === 'heic' ? 'iPhone-Format HEIC – nicht möglich' : 'Format nicht unterstützt';
    create.items.push(it);
  }
  renderList();
}
function renderList() {
  const ul = $('flist');
  ul.innerHTML = '';
  const n = create.items.length;
  $('createEmpty').style.display = n ? 'none' : '';
  $('createHint').style.display = n > 1 ? '' : 'none';
  $('createGo').disabled = !create.items.some(i => !i.error);
  create.items.forEach((it, k) => {
    const li = document.createElement('li'); li.className = 'paper';
    const th = document.createElement('div'); th.className = 'thumb';
    if (it.kind === 'image') { it.url = it.url || URL.createObjectURL(it.file); th.style.backgroundImage = `url("${it.url}")`; }
    else if (it.kind === 'pdf') { th.style.background = '#fff'; pdfThumb(it, th); }
    else { const b = BADGE[it.kind] || ['?', '#8a7a62']; th.textContent = b[0]; th.style.background = b[1]; th.style.fontSize = '22px'; }
    const info = document.createElement('div'); info.className = 'finfo';
    const kindName = Docs.KIND_NAME[it.kind] || 'Datei';
    info.innerHTML = `<b>${k + 1}. ${esc(it.file.name)}</b><small class="${it.error ? 'err' : ''}">${it.error ? '⚠ ' + esc(it.error) + ' – wird übersprungen' : esc(kindName) + ' · ' + fmtSize(it.file.size) + (it.pages ? ' · ' + it.pages + (it.pages === 1 ? ' Seite' : ' Seiten') : '')}</small>`;
    const btns = document.createElement('div'); btns.className = 'fbtns';
    btns.innerHTML = `<button aria-label="nach oben" ${k === 0 ? 'disabled' : ''}>▲</button><button aria-label="nach unten" ${k === n - 1 ? 'disabled' : ''}>▼</button><button aria-label="entfernen">✕</button>`;
    const [up, dn, rm] = btns.children;
    up.onclick = () => { [create.items[k - 1], create.items[k]] = [create.items[k], create.items[k - 1]]; renderList(); };
    dn.onclick = () => { [create.items[k + 1], create.items[k]] = [create.items[k], create.items[k + 1]]; renderList(); };
    rm.onclick = () => { if (it.url) URL.revokeObjectURL(it.url); create.items.splice(k, 1); renderList(); };
    li.append(th, info, btns);
    ul.appendChild(li);
  });
}
async function pdfThumb(it, th) {
  try {
    if (!it.thumb) {
      const doc = await openPdfJs(new Uint8Array(await it.file.arrayBuffer()));
      it.pages = doc.numPages;
      const page = await doc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 140 / vp1.height });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      it.thumb = c.toDataURL('image/jpeg', .8);
      closePdf(doc);
      renderList();
      return;
    }
    th.style.backgroundImage = `url("${it.thumb}")`;
  } catch (e) { if (!it.thumbFail) { it.thumbFail = true; console.warn(e); } th.textContent = 'PDF'; th.style.background = '#8b1d10'; }
}

/* Bild für PDF vorbereiten: richtig herum drehen, sehr große Fotos verkleinern */
function exifOrientation(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return 1;
  let off = 2;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xFF) return 1;
    const marker = buf[off + 1], len = dv.getUint16(off + 2);
    if (marker === 0xE1 && dv.getUint32(off + 4) === 0x45786966) {
      const t = off + 10, le = dv.getUint16(t) === 0x4949;
      const ifd = t + dv.getUint32(t + 4, le);
      const n = dv.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (dv.getUint16(e, le) === 0x0112) return dv.getUint16(e + 8, le);
      }
      return 1;
    }
    if (marker === 0xDA) return 1;
    off += 2 + len;
  }
  return 1;
}
async function prepareImage(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isJpg = buf[0] === 0xFF && buf[1] === 0xD8, isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (isJpg && exifOrientation(buf) <= 1 && file.size < 12e6) return { bytes: buf, type: 'jpg' };
  if (isPng && file.size < 12e6) return { bytes: buf, type: 'png' };
  return await reencode(file);
}
async function reencode(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { throw friendly('Bild kann nicht gelesen werden'); }
  const max = 4200;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  c.width = c.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' };
}
async function addImagePage(out, file) {
  let prep = await prepareImage(file), img;
  try { img = prep.type === 'jpg' ? await out.embedJpg(prep.bytes) : await out.embedPng(prep.bytes); }
  catch (e) { prep = await reencode(file); img = await out.embedJpg(prep.bytes); }
  // DIN A4, Hoch- oder Querformat passend zum Bild
  const land = img.width > img.height * 1.05;
  const PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89;
  const page = out.addPage([PW, PH]);
  const { width, height } = img.scaleToFit(PW, PH);
  page.drawImage(img, { x: (PW - width) / 2, y: (PH - height) / 2, width, height });
}

async function buildPdf(items, title) {
  const out = await PDFDocument.create();
  const problems = [];
  const list = items.filter(i => !i.error);
  for (let k = 0; k < list.length; k++) {
    const it = list[k];
    busyText(`Verarbeite ${k + 1} von ${list.length}:\n${it.file.name}`);
    await frame();
    try {
      if (it.kind === 'pdf') {
        const bytes = new Uint8Array(await it.file.arrayBuffer());
        const { doc, encrypted } = await loadPdfLib(bytes);
        if (doc && !encrypted) {
          const pages = await out.copyPages(doc, doc.getPageIndices());
          pages.forEach(p => out.addPage(p));
        } else {
          const pj = await openPdfJs(bytes);
          await rasterInto(out, pj, [...Array(pj.numPages).keys()], (a, b) => busyText(`Geschütztes PDF wird übernommen … Seite ${a} von ${b}`));
          closePdf(pj);
        }
      } else if (it.kind === 'image') {
        await addImagePage(out, it.file);
      } else {
        const model = await Docs.parse(it.file);
        await Docs.toPDF(model, out, async () => { await frame(); });
      }
    } catch (e) {
      console.error(e);
      problems.push(`${it.file.name}: ${errMsg(e)}`);
    }
  }
  if (!out.getPageCount()) throw friendly('Es konnte keine Seite erstellt werden.' + (problems.length ? '<br><br>' + problems.map(esc).join('<br>') : ''));
  out.setTitle(title); out.setCreator('PDF-Werkstatt'); out.setProducer('PDF-Werkstatt');
  busyText('PDF wird gespeichert …');
  await frame();
  const bytes = await out.save();
  return { bytes, pages: out.getPageCount(), problems };
}

$('createGo').onclick = async () => {
  const name = safeName($('outName').value || defaultName()).replace(/\.pdf$/i, '') + '.pdf';
  busy('PDF wird erstellt …');
  try {
    const res = await buildPdf(create.items, baseName(name));
    done();
    download(res.bytes, name);
    const file = new File([res.bytes], name, { type: 'application/pdf' });
    resultDialog(file, `<b>${esc(name)}</b><br>${res.pages} ${res.pages === 1 ? 'Seite' : 'Seiten'} · wurde im Ordner „Download“ gespeichert.` +
      (res.problems.length ? `<br><br><span style="color:#8b1d10">Übersprungen:<br>${res.problems.map(esc).join('<br>')}</span>` : ''));
  } catch (e) {
    done(); console.error(e);
    modal('Hat nicht geklappt', e.friendly ? e.message : esc(errMsg(e)), [{ label: 'OK', value: 0 }]);
  }
};
async function resultDialog(file, html) {
  const v = await modal('✅ Fertig!', html, [
    { label: '👁 Ansehen', value: 'view' }, { label: '⤴ Senden', value: 'share', green: true }, { label: 'OK', value: 'ok', full: true }
  ]);
  if (v === 'view') openViewer(file);
  else if (v === 'share') shareFile(file);
}

/* =====================================================================
   3) PDF TRENNEN
   ===================================================================== */
const split = { file: null, bytes: null, doc: null, sel: new Set(), obs: null, thumbs: [] };
async function openSplit(file) {
  closeModal(null);
  openScreen('split');
  cleanupSplit();
  split.file = file;
  $('splitTitle').textContent = file.name;
  busy('PDF wird geöffnet …');
  try {
    split.bytes = new Uint8Array(await file.arrayBuffer());
    split.doc = await openPdfJs(split.bytes);
    const grid = $('grid'); grid.innerHTML = '';
    const n = split.doc.numPages;
    const cellW = (Math.min($('splitBody').clientWidth, 700) - 24 - 24) / 3;
    split.thumbs = [];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div'); d.className = 'gpage'; d.dataset.i = i;
      d.innerHTML = `<span class="n">${i + 1}</span>`;
      d.style.height = Math.round(cellW * 1.414) + 'px';
      d.onclick = () => { split.sel.has(i) ? split.sel.delete(i) : split.sel.add(i); d.classList.toggle('sel'); updateSel(); };
      grid.appendChild(d);
      split.thumbs.push({ d, done: false });
    }
    split.obs = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) splitThumb(+en.target.dataset.i, cellW); }), { root: $('splitBody'), rootMargin: '400px 0px' });
    split.thumbs.forEach(t => split.obs.observe(t.d));
    updateSel();
  } catch (e) {
    $('grid').innerHTML = `<div class="paper err-box" style="grid-column:1/-1"><b>Kann nicht geöffnet werden</b>${esc(errMsg(e))}</div>`;
  } finally { done(); }
}
const thumbQ = []; let thumbBusy = false;
function splitThumb(i, cellW) {
  const t = split.thumbs[i];
  if (!t || t.done || t.queued) return;
  t.queued = true; thumbQ.push([i, cellW]);
  pumpThumbs();
}
async function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  const doc = split.doc;
  while (thumbQ.length && doc === split.doc) {
    const [i, cellW] = thumbQ.shift();
    try {
      const page = await doc.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: cellW * DPR() / vp1.width });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      if (doc !== split.doc) break;
      const t = split.thumbs[i];
      t.d.style.height = ''; t.d.prepend(c); t.done = true;
      page.cleanup();
    } catch (e) { /* nächste Seite */ }
  }
  thumbBusy = false;
}
function updateSel() {
  const n = split.sel.size, total = split.doc ? split.doc.numPages : 0;
  $('selCount').textContent = n ? `${n} von ${total} ausgewählt` : `${total} Seiten · tippe zum Auswählen`;
  $('splitExtract').disabled = !n;
  $('splitRemove').disabled = !n || n === total;
}
function cleanupSplit() {
  if (split.obs) split.obs.disconnect();
  closePdf(split.doc);
  split.doc = null; split.sel = new Set(); split.thumbs = []; thumbQ.length = 0;
}
cleaners.split = () => { cleanupSplit(); $('grid').innerHTML = ''; };
$('selAll').onclick = () => { if (!split.doc) return; for (let i = 0; i < split.doc.numPages; i++) split.sel.add(i); split.thumbs.forEach(t => t.d.classList.add('sel')); updateSel(); };
$('selNone').onclick = () => { split.sel.clear(); split.thumbs.forEach(t => t.d.classList.remove('sel')); updateSel(); };
function ranges(idx) {
  const a = [...idx].sort((x, y) => x - y).map(i => i + 1), out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? `${a[i]}-${a[j]}` : `${a[i]}`); i = j;
  }
  return out.join('_');
}
async function pagesToPdf(indices) {
  const { doc, encrypted } = await loadPdfLib(split.bytes);
  const out = await PDFDocument.create();
  if (doc && !encrypted) {
    const pages = await out.copyPages(doc, indices);
    pages.forEach(p => out.addPage(p));
  } else {
    await rasterInto(out, split.doc, indices, (a, b) => busyText(`Geschütztes PDF … Seite ${a} von ${b}`));
  }
  out.setCreator('PDF-Werkstatt'); out.setProducer('PDF-Werkstatt');
  return await out.save();
}
async function splitSave(indices, name, label) {
  busy(label);
  try {
    const bytes = await pagesToPdf(indices);
    done();
    download(bytes, name);
    resultDialog(new File([bytes], name, { type: 'application/pdf' }), `<b>${esc(name)}</b><br>${indices.length} ${indices.length === 1 ? 'Seite' : 'Seiten'} · wurde im Ordner „Download“ gespeichert.`);
  } catch (e) { done(); modal('Hat nicht geklappt', esc(errMsg(e)), [{ label: 'OK', value: 0 }]); }
}
$('splitExtract').onclick = () => {
  const idx = [...split.sel].sort((a, b) => a - b);
  splitSave(idx, `${safeName(baseName(split.file.name))}_Seite${idx.length > 1 ? 'n' : ''}_${ranges(idx)}.pdf`, 'Neues PDF wird erstellt …');
};
$('splitRemove').onclick = () => {
  const idx = [...Array(split.doc.numPages).keys()].filter(i => !split.sel.has(i));
  splitSave(idx, `${safeName(baseName(split.file.name))}_ohne_Seite${split.sel.size > 1 ? 'n' : ''}_${ranges(split.sel)}.pdf`, 'Seiten werden entfernt …');
};
$('splitEach').onclick = async () => {
  const n = split.doc ? split.doc.numPages : 0;
  if (!n) return;
  if (n > 1) {
    const ok = await modal('Jede Seite einzeln', `Es werden <b>${n} einzelne PDF-Dateien</b> im Ordner „Download“ gespeichert.<br><br>Fragt Chrome, ob „mehrere Dateien heruntergeladen“ werden dürfen, bitte <b>Zulassen</b> tippen.`, [{ label: 'Los geht’s', value: true }, { label: 'Abbrechen', value: false, green: true }]);
    if (!ok) return;
  }
  busy('Seiten werden getrennt …');
  try {
    const base = safeName(baseName(split.file.name));
    for (let i = 0; i < n; i++) {
      busyText(`Seite ${i + 1} von ${n} wird gespeichert …`);
      const bytes = await pagesToPdf([i]);
      download(bytes, `${base}_Seite_${String(i + 1).padStart(String(n).length, '0')}.pdf`);
      await sleep(450);
    }
    done();
    modal('✅ Fertig!', `${n} einzelne Seiten wurden im Ordner „Download“ gespeichert.`, [{ label: 'OK', value: 0 }]);
  } catch (e) { done(); modal('Hat nicht geklappt', esc(errMsg(e)), [{ label: 'OK', value: 0 }]); }
};

/* =====================================================================
   4) UNTERSCHRIFT EINFÜGEN
   ===================================================================== */
const SIG_RAW = 'pdfw-unterschrift-roh', SIG_CLEAN = 'pdfw-unterschrift-saeubern';
const sign = { file: null, bytes: null, doc: null, page: 0, vp: null, placed: [], sig: null, live: null, liveVisible: true, liveW: .34, liveX: null, liveY: null };

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
/* Unterschrift aufbereiten: Hintergrund durchsichtig machen und knapp zuschneiden */
async function processSignature(rawUrl, clean) {
  const img = await loadImage(rawUrl);
  const s = Math.min(1, 1400 / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  if (clean) {
    // Hintergrundfarbe am Rand messen
    let br = 0, bg = 0, bb = 0, n = 0;
    const sample = (x, y) => { const k = (y * w + x) * 4; if (d[k + 3] > 200) { br += d[k]; bg += d[k + 1]; bb += d[k + 2]; n++; } };
    for (let x = 0; x < w; x += 2) { sample(x, 0); sample(x, h - 1); sample(x, Math.min(2, h - 1)); sample(x, Math.max(h - 3, 0)); }
    for (let y = 0; y < h; y += 2) { sample(0, y); sample(w - 1, y); }
    if (n) {
      br /= n; bg /= n; bb /= n;
      const bgL = (br + bg + bb) / 3;
      for (let k = 0; k < d.length; k += 4) {
        const dist = Math.max(Math.abs(d[k] - br), Math.abs(d[k + 1] - bg), Math.abs(d[k + 2] - bb));
        const lum = (d[k] + d[k + 1] + d[k + 2]) / 3;
        let a = (dist - 22) / 70;
        if (lum > bgL) a = Math.min(a, 0); // heller als Papier = Hintergrund
        a = Math.max(0, Math.min(1, a));
        d[k + 3] = Math.round(d[k + 3] * a);
        if (a > 0 && a < 1) { // Tinte von der Papierfarbe befreien
          d[k] = Math.max(0, Math.min(255, (d[k] - br * (1 - a)) / a));
          d[k + 1] = Math.max(0, Math.min(255, (d[k + 1] - bg * (1 - a)) / a));
          d[k + 2] = Math.max(0, Math.min(255, (d[k + 2] - bb * (1 - a)) / a));
        }
      }
    }
  }
  // knapp zuschneiden
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 28) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  ctx.putImageData(id, 0, 0);
  const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const url = out.toDataURL('image/png');
  const bytes = Uint8Array.from(atob(url.split(',')[1]), ch => ch.charCodeAt(0));
  return { url, bytes, aspect: out.width / out.height };
}
async function loadSavedSignature() {
  const raw = localStorage.getItem(SIG_RAW);
  if (!raw) { sign.sig = null; return; }
  const clean = localStorage.getItem(SIG_CLEAN) !== '0';
  $('sigClean').checked = clean;
  try { sign.sig = await processSignature(raw, clean); } catch (e) { sign.sig = null; }
}
async function chooseSignature() {
  const f = await pick('pickImg');
  if (!f[0]) return false;
  busy('Unterschrift wird vorbereitet …');
  try {
    let bmp;
    try { bmp = await createImageBitmap(f[0], { imageOrientation: 'from-image' }); }
    catch (e) { throw friendly('Dieses Bild kann nicht gelesen werden.'); }
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const raw = c.toDataURL('image/png');
    try { localStorage.setItem(SIG_RAW, raw); }
    catch (e) { localStorage.setItem(SIG_RAW, c.toDataURL('image/jpeg', .9)); }
    localStorage.setItem(SIG_CLEAN, $('sigClean').checked ? '1' : '0');
    await loadSavedSignature();
    showSigPreview();
    toast('Unterschrift gespeichert – beim nächsten Mal ist sie sofort da.');
    return true;
  } catch (e) { modal('Hat nicht geklappt', esc(errMsg(e)), [{ label: 'OK', value: 0 }]); return false; }
  finally { done(); }
}
function showSigPreview() {
  $('sigPrev').style.backgroundImage = sign.sig ? `url("${sign.sig.url}")` : '';
  $('sigChange').innerHTML = sign.sig ? 'Unterschrift<br>ändern' : 'Unterschrift<br>wählen';
  renderSigs();
}
$('sigChange').onclick = chooseSignature;
$('sigClean').onchange = async () => {
  localStorage.setItem(SIG_CLEAN, $('sigClean').checked ? '1' : '0');
  if (localStorage.getItem(SIG_RAW)) { await loadSavedSignature(); showSigPreview(); }
};

async function openSign(file) {
  closeModal(null);
  openScreen('sign');
  cleanupSign();
  sign.file = file; sign.page = 0; sign.placed = []; sign.liveVisible = true; sign.liveW = .34; sign.liveX = null; sign.liveY = null;
  $('signTitle').textContent = file.name;
  busy('PDF wird geöffnet …');
  try {
    sign.bytes = new Uint8Array(await file.arrayBuffer());
    sign.doc = await openPdfJs(sign.bytes);
    await loadSavedSignature();
    showSigPreview();
    await renderSignPage();
    done();
    if (!sign.sig) {
      const v = await modal('Deine Unterschrift', 'Wähle einmalig das Bild deiner Unterschrift aus.<br>Die App merkt es sich für das nächste Mal.', [{ label: 'Bild wählen', value: true }, { label: 'Später', value: false, green: true }]);
      if (v) await chooseSignature();
    }
  } catch (e) {
    done();
    $('signBody').innerHTML = `<div class="paper err-box"><b>Kann nicht geöffnet werden</b>${esc(errMsg(e))}</div>`;
  }
}
function cleanupSign() {
  closePdf(sign.doc);
  sign.doc = null;
  const body = $('signBody');
  if (!$('signPage')) body.innerHTML = '<div class="sign-page" id="signPage"><canvas id="signCanvas"></canvas></div>';
  bindSignGestures();
}
cleaners.sign = cleanupSign;

async function renderSignPage() {
  const doc = sign.doc; if (!doc) return;
  const n = doc.numPages;
  sign.page = Math.max(0, Math.min(n - 1, sign.page));
  $('pgLabel').textContent = `${sign.page + 1}/${n}`;
  $('pgPrev').disabled = sign.page === 0; $('pgNext').disabled = sign.page === n - 1;
  const page = await doc.getPage(sign.page + 1);
  const vp1 = page.getViewport({ scale: 1 });
  const body = $('signBody');
  const w = Math.min(body.clientWidth - 16, 900);
  const h = w * vp1.height / vp1.width;
  const pg = $('signPage');
  pg.style.width = w + 'px'; pg.style.height = h + 'px';
  const vp = page.getViewport({ scale: w / vp1.width * DPR() });
  const c = $('signCanvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  sign.vp1 = vp1;
  renderSigs();
}
$('pgPrev').onclick = () => { sign.page--; renderSignPage(); };
$('pgNext').onclick = () => { sign.page++; renderSignPage(); };

function pageBox() { const pg = $('signPage'); return { w: pg.clientWidth, h: pg.clientHeight }; }
function clampLive() {
  const { w, h } = pageBox();
  if (!sign.sig || !w) return;
  sign.liveW = Math.max(.06, Math.min(.98, sign.liveW));
  const sw = sign.liveW * w, sh = sw / sign.sig.aspect;
  if (sign.liveX === null) { sign.liveX = (w - sw) * 0.82 / w; sign.liveY = Math.min(.8, (h * 0.78) / h); }
  sign.liveX = Math.max(0, Math.min((w - sw) / w, sign.liveX));
  sign.liveY = Math.max(0, Math.min(Math.max(0, (h - sh) / h), sign.liveY));
}
function renderSigs() {
  const pg = $('signPage'); if (!pg) return;
  pg.querySelectorAll('.sig').forEach(e => e.remove());
  const { w } = pageBox();
  if (!sign.sig || !w) { $('sigSize').disabled = true; return; }
  $('sigSize').disabled = !sign.liveVisible;
  for (const [k, p] of sign.placed.entries()) {
    if (p.page !== sign.page) continue;
    const el = document.createElement('div'); el.className = 'sig placed';
    el.style.left = p.x * w + 'px'; el.style.top = p.y * pageBox().h + 'px'; el.style.width = p.w * w + 'px'; el.style.height = p.w * w / p.aspect + 'px';
    el.innerHTML = `<img src="${p.url}" alt=""><button class="x" aria-label="entfernen">✕</button>`;
    el.querySelector('.x').onclick = (e) => { e.stopPropagation(); sign.placed.splice(k, 1); renderSigs(); updateSignButtons(); };
    pg.appendChild(el);
  }
  if (sign.liveVisible) {
    clampLive();
    const el = document.createElement('div'); el.className = 'sig live'; el.id = 'liveSig';
    el.innerHTML = `<img src="${sign.sig.url}" alt="">`;
    pg.appendChild(el);
    sign.live = el;
    positionLive();
  } else sign.live = null;
  $('sigSize').value = Math.round(sign.liveW * 100);
  updateSignButtons();
}
function positionLive() {
  const el = sign.live; if (!el) return;
  const { w, h } = pageBox();
  const sw = sign.liveW * w;
  el.style.left = sign.liveX * w + 'px'; el.style.top = sign.liveY * h + 'px';
  el.style.width = sw + 'px'; el.style.height = sw / sign.sig.aspect + 'px';
}
function updateSignButtons() {
  $('sigPlace').textContent = sign.liveVisible ? 'Hier einfügen' : '＋ Weitere Unterschrift';
  $('sigPlace').disabled = !sign.sig;
  $('sigSave').disabled = !sign.sig || (!sign.placed.length && !sign.liveVisible);
}
function setLiveSize(pct, keepCenter = true) {
  const { w, h } = pageBox();
  if (!sign.sig) return;
  const oldW = sign.liveW * w, oldH = oldW / sign.sig.aspect;
  const cx = sign.liveX * w + oldW / 2, cy = sign.liveY * h + oldH / 2;
  sign.liveW = pct / 100;
  clampLive();
  if (keepCenter) {
    const nw = sign.liveW * w, nh = nw / sign.sig.aspect;
    sign.liveX = (cx - nw / 2) / w; sign.liveY = (cy - nh / 2) / h;
    clampLive();
  }
  positionLive();
  $('sigSize').value = Math.round(sign.liveW * 100);
}
$('sigSize').oninput = () => setLiveSize(+$('sigSize').value);
$('szMinus').onclick = () => setLiveSize(Math.max(6, sign.liveW * 100 - 3));
$('szPlus').onclick = () => setLiveSize(Math.min(98, sign.liveW * 100 + 3));
$('sigPlace').onclick = async () => {
  if (!sign.sig) { await chooseSignature(); return; }
  if (sign.liveVisible) {
    sign.placed.push({ page: sign.page, x: sign.liveX, y: sign.liveY, w: sign.liveW, aspect: sign.sig.aspect, url: sign.sig.url, bytes: sign.sig.bytes });
    sign.liveVisible = false;
    toast('Eingefügt ✓ – jetzt „Speichern“ tippen');
  } else {
    sign.liveVisible = true;
  }
  renderSigs();
};

// Verschieben mit einem Finger, Größe mit zwei Fingern (immer gleichmäßig)
function bindSignGestures() {
  const pg = $('signPage');
  if (!pg || pg.dataset.bound) return;
  pg.dataset.bound = '1';
  const pts = new Map();
  let drag = null, pin = null;
  pg.addEventListener('pointerdown', e => {
    if (!sign.live || !sign.sig) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pg.setPointerCapture(e.pointerId);
    if (pts.size === 1) {
      const r = sign.live.getBoundingClientRect();
      const inside = e.clientX >= r.left - 20 && e.clientX <= r.right + 20 && e.clientY >= r.top - 20 && e.clientY <= r.bottom + 20;
      const { w, h } = pageBox();
      if (!inside) { // dorthin springen, wo getippt wurde
        const pr = pg.getBoundingClientRect();
        const sw = sign.liveW * w, sh = sw / sign.sig.aspect;
        sign.liveX = (e.clientX - pr.left - sw / 2) / w; sign.liveY = (e.clientY - pr.top - sh / 2) / h;
        clampLive(); positionLive();
      }
      drag = { x: e.clientX, y: e.clientY, lx: sign.liveX, ly: sign.liveY };
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pin = { d: Math.hypot(a.x - b.x, a.y - b.y), w: sign.liveW * 100 };
      drag = null;
    }
    e.preventDefault();
  });
  pg.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { w, h } = pageBox();
    if (pin && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      setLiveSize(Math.max(6, Math.min(98, pin.w * Math.hypot(a.x - b.x, a.y - b.y) / pin.d)));
    } else if (drag) {
      sign.liveX = drag.lx + (e.clientX - drag.x) / w;
      sign.liveY = drag.ly + (e.clientY - drag.y) / h;
      clampLive(); positionLive();
    }
    e.preventDefault();
  });
  const end = e => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pin = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; drag = { x: p.x, y: p.y, lx: sign.liveX, ly: sign.liveY }; }
    if (!pts.size) drag = null;
  };
  pg.addEventListener('pointerup', end);
  pg.addEventListener('pointercancel', end);
}
bindSignGestures();
window.addEventListener('resize', () => { if (current === 'sign') renderSignPage(); });

$('sigSave').onclick = async () => {
  if (!sign.doc || !sign.sig) return;
  const all = [...sign.placed];
  if (sign.liveVisible) all.push({ page: sign.page, x: sign.liveX, y: sign.liveY, w: sign.liveW, aspect: sign.sig.aspect, bytes: sign.sig.bytes });
  if (!all.length) return;
  busy('Unterschrift wird eingefügt …');
  try {
    let { doc: out, encrypted } = await loadPdfLib(sign.bytes);
    let rastered = false;
    if (!out || encrypted) {
      rastered = true;
      // geschütztes PDF: Seiten als Bilder neu aufbauen, dann unterschreiben
      out = await PDFDocument.create();
      await rasterInto(out, sign.doc, [...Array(sign.doc.numPages).keys()], (a, b) => busyText(`Geschütztes PDF … Seite ${a} von ${b}`));
    }
    const embedded = new Map();
    for (const p of all) {
      let img = embedded.get(p.bytes);
      if (!img) { img = await out.embedPng(p.bytes); embedded.set(p.bytes, img); }
      const page = out.getPage(p.page);
      const pj = await sign.doc.getPage(p.page + 1);
      const vp = pj.getViewport({ scale: 1 });
      const left = p.x * vp.width, top = p.y * vp.height;
      const wv = p.w * vp.width, hv = wv / p.aspect;
      // Bildschirm-Ecke unten links → PDF-Koordinaten (berücksichtigt gedrehte Seiten)
      let X, Y, rot = 0;
      if (rastered) { X = left; Y = vp.height - (top + hv); }
      else {
        [X, Y] = vp.convertToPdfPoint(left, top + hv);
        rot = ((page.getRotation().angle % 360) + 360) % 360;
      }
      page.drawImage(img, { x: X, y: Y, width: wv, height: hv, rotate: degrees(rot) });
    }
    out.setModificationDate(new Date());
    const bytes = await out.save();
    const name = `${safeName(baseName(sign.file.name))}_unterschrieben.pdf`;
    done();
    download(bytes, name);
    resultDialog(new File([bytes], name, { type: 'application/pdf' }), `<b>${esc(name)}</b><br>wurde im Ordner „Download“ gespeichert.` + (rastered ? '<br><br><i>Hinweis: Das Original war geschützt – die Seiten wurden als Bilder übernommen.</i>' : ''));
  } catch (e) {
    done(); console.error(e);
    modal('Hat nicht geklappt', esc(errMsg(e)), [{ label: 'OK', value: 0 }]);
  }
};

/* =====================================================================
   Dateien von anderen Apps empfangen („Teilen“ bzw. „Öffnen mit“)
   ===================================================================== */
async function handleIncoming(files) {
  files = files.filter(Boolean);
  if (!files.length) return;
  if (files.length > 1) {
    const v = await modal('Dateien empfangen', `${files.length} Dateien – was möchtest du tun?`, [
      { label: 'Zu einem PDF zusammenfügen', value: 'create', full: true }, { label: 'Erste ansehen', value: 'view', green: true }, { label: 'Abbrechen', value: null, green: true }]);
    if (v === 'create') openCreate(files.sort(naturalSort), false);
    else if (v === 'view') openViewer(files[0]);
    return;
  }
  const f = files[0];
  const isPdf = Docs.kindOf(f) === 'pdf';
  const btns = [{ label: '👁 Lesen', value: 'view' }];
  if (isPdf) btns.push({ label: '✒ Unterschreiben', value: 'sign' }, { label: '✂ Trennen', value: 'split' });
  else btns.push({ label: 'Als PDF speichern', value: 'create' });
  btns.push({ label: 'Abbrechen', value: null, green: true, full: !isPdf ? false : true });
  const v = await modal('Datei empfangen', `<b>${esc(f.name)}</b><br>Was möchtest du damit machen?`, btns);
  if (v === 'view') openViewer(f);
  else if (v === 'sign') openSign(f);
  else if (v === 'split') openSplit(f);
  else if (v === 'create') openCreate([f], false);
}
async function checkShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has('geteilt')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('pdfw-geteilt');
    const reqs = await cache.keys();
    const files = [];
    for (const r of reqs) {
      const res = await cache.match(r);
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-name') || 'Datei');
      files.push(new File([blob], name, { type: blob.type }));
      await cache.delete(r);
    }
    handleIncoming(files);
  } catch (e) { toast('Die geteilte Datei konnte nicht übernommen werden.'); }
}
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const files = [];
    for (const h of params.files) { try { files.push(await h.getFile()); } catch (e) {} }
    handleIncoming(files);
  });
}

/* ---------------- Offline-Fähigkeit ---------------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
checkShared();
window.__pdfw = { version: APP_VERSION, openViewer, openCreate, openSplit, openSign, handleIncoming, sign, view, split, create, buildPdf, processSignature };
