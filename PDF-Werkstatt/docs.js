/* =====================================================================
   PDF-Werkstatt – Dokumente lesen und in ein gemeinsames Modell bringen
   Formate: Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument
   (.odt/.ods/.odp), E-Book (.epub), HTML, Text/CSV, RTF, altes Word (.doc, nur Text)
   Das Modell wird für die Anzeige (HTML) und für die PDF-Ausgabe benutzt.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- Hilfen ---------------- */
  const kids = (el, name) => el ? Array.from(el.childNodes).filter(n => n.nodeType === 1 && (!name || n.localName === name)) : [];
  const kid = (el, name) => kids(el, name)[0] || null;
  const desc = (el, name) => el ? Array.from(el.getElementsByTagNameNS('*', name)) : [];
  const attr = (el, name) => {
    if (!el) return null;
    for (const a of el.attributes) if (a.localName === name) return a.value;
    return null;
  };
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rid = (el) => el ? (el.getAttributeNS(RNS, 'id') || el.getAttribute('r:id')) : null;
  const parseXML = (txt) => {
    const d = new DOMParser().parseFromString(txt, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) {
      // manchmal stören Steuerzeichen – bereinigen und erneut versuchen
      const clean = txt.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      return new DOMParser().parseFromString(clean, 'application/xml');
    }
    return d;
  };
  const zipText = async (zip, path) => { const f = zip.file(path); return f ? f.async('string') : null; };
  const zipBytes = async (zip, path) => { const f = zip.file(path); return f ? f.async('uint8array') : null; };
  const resolvePath = (base, rel) => {
    if (!rel) return rel;
    if (rel.startsWith('/')) return rel.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const p of rel.split('/')) {
      if (p === '..') parts.pop(); else if (p !== '.' && p !== '') parts.push(p);
    }
    return parts.join('/');
  };
  const mimeOf = (path) => {
    const e = (path.split('.').pop() || '').toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' })[e] || 'application/octet-stream';
  };
  async function readRels(zip, partPath) {
    const parts = partPath.split('/'); const file = parts.pop();
    const relPath = (parts.length ? parts.join('/') + '/' : '') + '_rels/' + file + '.rels';
    const txt = await zipText(zip, relPath);
    const map = {};
    if (!txt) return map;
    for (const r of desc(parseXML(txt), 'Relationship')) {
      const mode = r.getAttribute('TargetMode');
      map[r.getAttribute('Id')] = { target: mode === 'External' ? r.getAttribute('Target') : resolvePath(partPath, r.getAttribute('Target')), type: r.getAttribute('Type') || '', external: mode === 'External' };
    }
    return map;
  }
  const P = (runs, extra = {}) => Object.assign({ type: 'p', runs }, extra);
  const R = (t, s = {}) => Object.assign({ t }, s);
  const textOfRuns = runs => runs.map(r => r.t).join('');

  /* ---------------- Word (.docx) ---------------- */
  async function parseDocx(zip) {
    const docPath = 'word/document.xml';
    const xml = await zipText(zip, docPath);
    if (!xml) throw new Error('Keine Word-Datei');
    const doc = parseXML(xml);
    const rels = await readRels(zip, docPath);

    // Formatvorlagen: Überschriften erkennen (auch deutsche Namen)
    const headingOf = {}, styleNum = {}, basedOn = {};
    const stylesTxt = await zipText(zip, 'word/styles.xml');
    if (stylesTxt) {
      for (const st of desc(parseXML(stylesTxt), 'style')) {
        const id = attr(st, 'styleId');
        const np = kid(kid(st, 'pPr'), 'numPr');
        if (np) styleNum[id] = { numId: attr(kid(np, 'numId'), 'val'), ilvl: attr(kid(np, 'ilvl'), 'val') };
        const bo = attr(kid(st, 'basedOn'), 'val'); if (bo) basedOn[id] = bo;
        const name = (attr(kid(st, 'name'), 'val') || '').toLowerCase();
        let m = name.match(/^(heading|überschrift|berschrift)\s*(\d)/);
        if (m) headingOf[id] = +m[2];
        else if (name === 'title' || name === 'titel') headingOf[id] = 1;
        else if (name === 'subtitle' || name === 'untertitel') headingOf[id] = 2;
      }
    }
    // Nummerierung: Aufzählung oder Zahlen?
    const numFmt = {}; // numId -> {lvl: fmt}
    const numTxt = await zipText(zip, 'word/numbering.xml');
    if (numTxt) {
      const nd = parseXML(numTxt);
      const abs = {};
      for (const a of desc(nd, 'abstractNum')) {
        const lv = {};
        for (const l of kids(a, 'lvl')) lv[attr(l, 'ilvl')] = attr(kid(l, 'numFmt'), 'val') || 'bullet';
        abs[attr(a, 'abstractNumId')] = lv;
      }
      for (const n of desc(nd, 'num')) numFmt[attr(n, 'numId')] = abs[attr(kid(n, 'abstractNumId'), 'val')] || {};
    }
    const counters = {};

    const blocks = [];
    const imageBlock = async (rid) => {
      const rel = rels[rid];
      if (!rel || rel.external) return null;
      const data = await zipBytes(zip, rel.target);
      return data ? { type: 'img', mime: mimeOf(rel.target), data } : null;
    };

    async function runsOf(container, base, out, imgs) {
      for (const n of kids(container)) {
        const ln = n.localName;
        if (ln === 'r') {
          const rPr = kid(n, 'rPr');
          const on = (el) => el && !['0', 'false', 'none'].includes(attr(el, 'val'));
          const st = Object.assign({}, base);
          if (rPr) {
            if (on(kid(rPr, 'b'))) st.b = true;
            if (on(kid(rPr, 'i'))) st.i = true;
            if (on(kid(rPr, 'u'))) st.u = true;
            const sz = attr(kid(rPr, 'sz'), 'val'); if (sz) st.size = +sz / 2;
            const col = attr(kid(rPr, 'color'), 'val'); if (col && col !== 'auto' && /^[0-9a-f]{6}$/i.test(col)) st.color = '#' + col;
            if (kid(rPr, 'vanish')) continue;
          }
          for (const c of kids(n)) {
            const cl = c.localName;
            if (cl === 't') out.push(R(c.textContent, st));
            else if (cl === 'tab') out.push(R('\t', st));
            else if (cl === 'br' || cl === 'cr') {
              if (attr(c, 'type') === 'page') out.push({ pagebreak: true });
              else out.push(R('\n', st));
            }
            else if (cl === 'noBreakHyphen') out.push(R('-', st));
            else if (cl === 'sym') out.push(R('•', st));
            else if (cl === 'drawing' || cl === 'pict' || cl === 'object') {
              for (const b of [...desc(c, 'blip'), ...desc(c, 'imagedata')]) {
                const rid = attr(b, 'embed') || attr(b, 'id');
                const ib = rid && await imageBlock(rid);
                if (ib) imgs.push({ at: out.length, block: ib });
              }
            }
          }
        } else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'customXml', 'sdtContent', 'bdo', 'dir'].includes(ln)) {
          await runsOf(n, base, out, imgs);
        } else if (ln === 'sdt') {
          await runsOf(kid(n, 'sdtContent'), base, out, imgs);
        } else if (ln === 'oMath' || ln === 'oMathPara') {
          out.push(R(n.textContent, base));
        }
      }
    }

    async function paragraph(p, target) {
      const pPr = kid(p, 'pPr');
      const styleId = pPr ? attr(kid(pPr, 'pStyle'), 'val') : null;
      const extra = {};
      if (pPr) {
        const jc = attr(kid(pPr, 'jc'), 'val');
        if (jc === 'center') extra.align = 'center';
        else if (jc === 'right' || jc === 'end') extra.align = 'right';
        const numPr = kid(pPr, 'numPr');
        let sNum = null;
        for (let sid = styleId, guard = 0; sid && guard < 10 && !sNum; sid = basedOn[sid], guard++) sNum = styleNum[sid];
        if (numPr || sNum) {
          const numId = (numPr && attr(kid(numPr, 'numId'), 'val')) || (sNum && sNum.numId);
          const lvl = +((numPr && attr(kid(numPr, 'ilvl'), 'val')) || (sNum && sNum.ilvl) || 0);
          if (numId && numId !== '0') {
            const fmt = (numFmt[numId] || {})[lvl] || 'bullet';
            const key = numId + ':' + lvl;
            counters[key] = (counters[key] || 0) + 1;
            for (const k in counters) if (k.startsWith(numId + ':') && +k.split(':')[1] > lvl) delete counters[k];
            extra.list = { level: lvl, ordered: fmt !== 'bullet' && fmt !== 'none', num: counters[key] };
          }
        }
        if (kid(pPr, 'pageBreakBefore')) target.push({ type: 'pagebreak' });
      }
      const runs = [], imgs = [];
      await runsOf(p, {}, runs, imgs);
      // Seitenumbrüche und Bilder an der richtigen Stelle einfügen
      let cur = [];
      const flush = () => {
        if (cur.length && textOfRuns(cur).trim() !== '') {
          const lvl = styleId && headingOf[styleId];
          target.push(lvl ? { type: 'h', level: Math.min(lvl, 4), runs: cur, align: extra.align } : P(cur, extra));
        } else if (!cur.length && !imgs.length && !target.isCell) {
          target.push(P([R('')], extra)); // Leerzeile
        }
        cur = [];
      };
      let ii = 0;
      for (let i = 0; i <= runs.length; i++) {
        while (ii < imgs.length && imgs[ii].at === i) { flush(); target.push(imgs[ii].block); ii++; }
        if (i === runs.length) break;
        if (runs[i].pagebreak) { flush(); target.push({ type: 'pagebreak' }); continue; }
        cur.push(runs[i]);
      }
      flush();
    }

    async function table(tbl, target) {
      const rows = [];
      for (const tr of kids(tbl, 'tr')) {
        const row = [];
        for (const tc of kids(tr, 'tc')) {
          const cell = []; cell.isCell = true;
          for (const c of kids(tc)) {
            if (c.localName === 'p') await paragraph(c, cell);
            else if (c.localName === 'tbl') { // verschachtelte Tabelle als Text
              const t = []; t.isCell = true; await table(c, t);
              for (const b of t) if (b.type === 'table') for (const r of b.rows) cell.push(P([R(r.map(x => x.map(p => textOfRuns(p.runs || [])).join(' ')).join(' | '))]));
            }
          }
          const span = +(attr(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val') || 1);
          row.push(cell.filter(b => b.type === 'p' || b.type === 'h'));
          for (let s = 1; s < span; s++) row.push([]);
        }
        rows.push(row);
      }
      if (rows.length) target.push({ type: 'table', rows });
    }

    async function body(el, target) {
      for (const c of kids(el)) {
        if (c.localName === 'p') await paragraph(c, target);
        else if (c.localName === 'tbl') await table(c, target);
        else if (c.localName === 'sdt') await body(kid(c, 'sdtContent'), target);
        else if (c.localName === 'customXml') await body(c, target);
      }
    }
    await body(kid(doc.documentElement, 'body'), blocks);
    // überflüssige Leerzeilen am Ende entfernen
    while (blocks.length && blocks[blocks.length - 1].type === 'p' && !textOfRuns(blocks[blocks.length - 1].runs).trim()) blocks.pop();
    return { blocks };
  }

  /* ---------------- Excel (.xlsx) ---------------- */
  const MAX_ROWS = 2000, MAX_COLS = 60;
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function excelDate(v) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    const p = n => String(n).padStart(2, '0');
    const date = `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
    const frac = v % 1;
    return frac > 0.00001 ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
  }
  const fmtNum = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return n.toLocaleString('de-DE', { maximumFractionDigits: 6, useGrouping: Math.abs(n) >= 10000 });
  };
  async function parseXlsx(zip) {
    const wbPath = 'xl/workbook.xml';
    const wb = parseXML(await zipText(zip, wbPath));
    const rels = await readRels(zip, wbPath);
    const shared = [];
    const ssTxt = await zipText(zip, 'xl/sharedStrings.xml');
    if (ssTxt) for (const si of desc(parseXML(ssTxt), 'si')) shared.push(desc(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''));
    // Datumsformate erkennen
    const dateXf = [];
    const stTxt = await zipText(zip, 'xl/styles.xml');
    if (stTxt) {
      const sd = parseXML(stTxt);
      const custom = {};
      for (const nf of desc(sd, 'numFmt')) custom[attr(nf, 'numFmtId')] = attr(nf, 'formatCode') || '';
      const cellXfs = desc(sd, 'cellXfs')[0];
      kids(cellXfs, 'xf').forEach((xf, i) => {
        const id = +attr(xf, 'numFmtId');
        const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
        dateXf[i] = (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dmy].*[dmy]|h:mm/i.test(code) && !/0\.0|#/.test(code);
      });
    }
    const blocks = [];
    let truncated = false;
    for (const sh of desc(wb, 'sheet')) {
      const name = attr(sh, 'name');
      const rel = rels[rid(sh) || attr(sh, 'id')];
      if (!rel) continue;
      const sx = await zipText(zip, rel.target);
      if (!sx) continue;
      const sd = parseXML(sx);
      const grid = [];
      let maxC = -1;
      for (const row of desc(sd, 'row')) {
        const r = (+attr(row, 'r') || grid.length + 1) - 1;
        if (r >= MAX_ROWS) { truncated = true; break; }
        for (const c of kids(row, 'c')) {
          const ci = colIndex(attr(c, 'r'));
          if (ci >= MAX_COLS) { truncated = true; continue; }
          const t = attr(c, 't');
          const vEl = kid(c, 'v');
          let val = '';
          if (t === 's') val = shared[+(vEl && vEl.textContent)] || '';
          else if (t === 'inlineStr') val = desc(c, 't').map(x => x.textContent).join('');
          else if (t === 'b') val = vEl && vEl.textContent === '1' ? 'WAHR' : 'FALSCH';
          else if (t === 'str' || t === 'e') val = vEl ? vEl.textContent : '';
          else if (vEl) {
            const s = +(attr(c, 's') || 0);
            val = dateXf[s] ? excelDate(+vEl.textContent) : fmtNum(vEl.textContent);
          }
          if (val === '') continue;
          (grid[r] = grid[r] || [])[ci] = val;
          if (ci > maxC) maxC = ci;
        }
      }
      // leere Zeilen am Anfang/Ende abschneiden
      let first = grid.findIndex(r => r && r.some(v => v));
      if (first < 0) { blocks.push({ type: 'h', level: 2, runs: [R(name)] }, P([R('(leeres Blatt)', { i: true })])); continue; }
      const rows = [];
      for (let r = first; r < grid.length; r++) {
        const src = grid[r] || [];
        rows.push(Array.from({ length: maxC + 1 }, (_, i) => src[i] ? [P([R(src[i])])] : []));
      }
      while (rows.length && rows[rows.length - 1].every(c => !c.length)) rows.pop();
      blocks.push({ type: 'h', level: 2, runs: [R(name)] }, { type: 'table', rows, sheet: true });
    }
    if (truncated) blocks.push(P([R(`Hinweis: Sehr große Tabellen werden nur bis ${MAX_ROWS} Zeilen und ${MAX_COLS} Spalten angezeigt.`, { i: true })]));
    return { blocks };
  }

  /* ---------------- PowerPoint (.pptx) ---------------- */
  async function parsePptx(zip) {
    const presPath = 'ppt/presentation.xml';
    const pres = parseXML(await zipText(zip, presPath));
    const rels = await readRels(zip, presPath);
    const blocks = [];
    let n = 0;
    for (const sid of desc(pres, 'sldId')) {
      const rel = rels[rid(sid)];
      if (!rel) continue;
      const sx = await zipText(zip, rel.target);
      if (!sx) continue;
      n++;
      const sd = parseXML(sx);
      const srels = await readRels(zip, rel.target);
      const slide = [];
      let title = '';
      const walk = async (el) => {
        for (const c of kids(el)) {
          const ln = c.localName;
          if (ln === 'sp') {
            const ph = desc(c, 'ph')[0];
            const isTitle = ph && /title|ctrTitle/i.test(attr(ph, 'type') || '');
            const txBody = kid(c, 'txBody');
            if (!txBody) continue;
            for (const p of kids(txBody, 'p')) {
              const runs = [];
              for (const r of kids(p)) {
                if (r.localName === 'r' || r.localName === 'fld') {
                  const rPr = kid(r, 'rPr'); const st = {};
                  if (rPr && attr(rPr, 'b') === '1') st.b = true;
                  if (rPr && attr(rPr, 'i') === '1') st.i = true;
                  runs.push(R(desc(r, 't').map(t => t.textContent).join(''), st));
                } else if (r.localName === 'br') runs.push(R('\n'));
              }
              const txt = textOfRuns(runs).trim();
              if (!txt) continue;
              if (isTitle && !title) { title = txt; continue; }
              const lvl = +(attr(kid(p, 'pPr'), 'lvl') || 0);
              slide.push(P(runs, isTitle ? {} : { list: { level: lvl, ordered: false } }));
            }
          } else if (ln === 'pic') {
            const blip = desc(c, 'blip')[0];
            const r = blip && srels[attr(blip, 'embed')];
            if (r && !r.external) {
              const data = await zipBytes(zip, r.target);
              if (data) slide.push({ type: 'img', mime: mimeOf(r.target), data });
            }
          } else if (ln === 'graphicFrame') {
            const tbl = desc(c, 'tbl')[0];
            if (tbl) {
              const rows = kids(tbl, 'tr').map(tr => kids(tr, 'tc').map(tc => [P([R(desc(tc, 't').map(t => t.textContent).join(' '))])]));
              if (rows.length) slide.push({ type: 'table', rows });
            }
          } else if (ln === 'grpSp' || ln === 'spTree') await walk(c);
        }
      };
      await walk(desc(sd, 'spTree')[0]);
      if (n > 1) blocks.push({ type: 'pagebreak' });
      blocks.push({ type: 'h', level: 1, runs: [R(`Folie ${n}` + (title ? ': ' + title : ''))], slide: true });
      if (!slide.length) slide.push(P([R('(nur Gestaltung, kein Text)', { i: true })]));
      blocks.push(...slide);
    }
    return { blocks };
  }

  /* ---------------- OpenDocument (.odt/.ods/.odp) ---------------- */
  async function parseOdf(zip) {
    const cx = await zipText(zip, 'content.xml');
    if (!cx) throw new Error('Keine OpenDocument-Datei');
    const doc = parseXML(cx);
    const blocks = [];
    const inline = async (el, out) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) out.push(R(n.textContent));
        else if (n.nodeType === 1) {
          const ln = n.localName;
          if (ln === 's') out.push(R(' '.repeat(+(attr(n, 'c') || 1))));
          else if (ln === 'tab') out.push(R('\t'));
          else if (ln === 'line-break') out.push(R('\n'));
          else if (ln === 'note' || ln === 'annotation') continue;
          else if (ln === 'frame') { /* Bilder werden auf Blockebene behandelt */ }
          else await inline(n, out);
        }
      }
    };
    const images = async (el, target) => {
      for (const im of desc(el, 'image')) {
        const href = attr(im, 'href');
        if (href && !/^https?:/.test(href)) {
          const data = await zipBytes(zip, href.replace(/^\.\//, ''));
          if (data) target.push({ type: 'img', mime: mimeOf(href), data });
        }
      }
    };
    const walk = async (el, target, listLevel = -1) => {
      for (const c of kids(el)) {
        const ln = c.localName;
        if (ln === 'p' || ln === 'h') {
          const runs = []; await inline(c, runs);
          const txt = textOfRuns(runs);
          if (ln === 'h') target.push({ type: 'h', level: Math.min(+(attr(c, 'outline-level') || 1), 4), runs });
          else if (listLevel >= 0 && txt.trim()) target.push(P(runs, { list: { level: listLevel, ordered: false } }));
          else target.push(P(runs.length ? runs : [R('')]));
          if (desc(c, 'frame').length) await images(c, target);
        } else if (ln === 'list') {
          for (const li of kids(c)) await walk(li, target, listLevel + 1);
        } else if (ln === 'table') {
          const rows = [];
          for (const tr of desc(c, 'table-row')) {
            const row = [];
            for (const tc of kids(tr).filter(x => x.localName === 'table-cell' || x.localName === 'covered-table-cell')) {
              const cell = []; cell.isCell = true;
              await walk(tc, cell);
              const rep = Math.min(+(attr(tc, 'number-columns-repeated') || 1), 30);
              for (let i = 0; i < rep; i++) row.push(cell.filter(b => b.type === 'p' || b.type === 'h'));
            }
            while (row.length && !row[row.length - 1].some(p => textOfRuns(p.runs).trim())) row.pop();
            const rep = Math.min(+(attr(tr, 'number-rows-repeated') || 1), 5);
            if (row.length) for (let i = 0; i < rep; i++) rows.push(row);
            if (rows.length > MAX_ROWS) break;
          }
          if (rows.length) {
            const name = attr(c, 'name');
            if (name && el.localName === 'spreadsheet') target.push({ type: 'h', level: 2, runs: [R(name)] });
            target.push({ type: 'table', rows });
          }
        } else if (ln === 'page') { // Präsentation
          if (target.length) target.push({ type: 'pagebreak' });
          target.push({ type: 'h', level: 1, runs: [R(attr(c, 'name') || 'Folie')], slide: true });
          await walk(c, target);
        } else if (ln === 'frame' || ln === 'text-box' || ln === 'g' || ln === 'custom-shape' || ln === 'section' || ln === 'list-item' || ln === 'list-header' || ln === 'table-of-content' || ln === 'index-body') {
          if (ln === 'frame' && kid(c, 'image')) await images(c, target);
          else await walk(c, target, listLevel);
        }
      }
    };
    const body = desc(doc, 'body')[0];
    const inner = body && kids(body)[0];
    await walk(inner || body, blocks);
    return { blocks };
  }

  /* ---------------- HTML → Modell (für EPUB und HTML-Dateien) ---------------- */
  async function htmlToBlocks(root, resolveImg) {
    const blocks = [];
    let cur = [];
    const flush = (extra) => {
      if (cur.length && textOfRuns(cur).replace(/\s+/g, '')) blocks.push(P(cur, extra));
      cur = [];
    };
    const BLOCK = /^(p|div|section|article|header|footer|main|aside|blockquote|figure|figcaption|address|center|dd|dt|dl|nav|body|pre)$/;
    const walk = async (n, st, ctx) => {
      if (n.nodeType === 3) {
        let t = n.textContent;
        if (!ctx.pre) t = t.replace(/\s+/g, ' ');
        if (t) cur.push(R(t, st));
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.localName.toLowerCase();
      if (/^(script|style|head|title|meta|link|noscript|svg|math|button|input|select|textarea|template)$/.test(tag)) {
        if (tag === 'svg') { const im = desc(n, 'image')[0]; if (im && resolveImg) { flush(); const b = await resolveImg(attr(im, 'href')); if (b) blocks.push(b); } }
        return;
      }
      const s = Object.assign({}, st);
      if (tag === 'b' || tag === 'strong') s.b = true;
      if (tag === 'i' || tag === 'em' || tag === 'cite') s.i = true;
      if (tag === 'u') s.u = true;
      if (/^h[1-6]$/.test(tag)) {
        flush();
        const save = cur; cur = [];
        for (const c of n.childNodes) await walk(c, Object.assign({}, s, { b: true }), ctx);
        if (textOfRuns(cur).trim()) blocks.push({ type: 'h', level: Math.min(+tag[1], 4), runs: cur });
        cur = save === cur ? [] : [];
        return;
      }
      if (tag === 'br') { cur.push(R('\n', s)); return; }
      if (tag === 'hr') { flush(); blocks.push({ type: 'hr' }); return; }
      if (tag === 'img' || tag === 'image') {
        const src = attr(n, 'src') || attr(n, 'href');
        if (src && resolveImg) { flush(); const b = await resolveImg(src); if (b) blocks.push(b); }
        return;
      }
      if (tag === 'table') {
        flush();
        const rows = [];
        for (const tr of Array.from(n.querySelectorAll('tr'))) {
          const row = Array.from(tr.children).filter(c => /^(td|th)$/i.test(c.localName)).map(c => [P([R(c.textContent.replace(/\s+/g, ' ').trim(), c.localName.toLowerCase() === 'th' ? { b: true } : {})])]);
          if (row.length) rows.push(row);
        }
        if (rows.length) blocks.push({ type: 'table', rows });
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        flush();
        let i = 0;
        for (const li of Array.from(n.children)) {
          if (li.localName.toLowerCase() !== 'li') continue;
          i++;
          cur = [];
          for (const c of li.childNodes) {
            if (c.nodeType === 1 && /^(ul|ol)$/i.test(c.localName)) { flush({ list: { level: ctx.lvl, ordered: tag === 'ol', num: i } }); await walk(c, s, Object.assign({}, ctx, { lvl: ctx.lvl + 1 })); }
            else await walk(c, s, ctx);
          }
          flush({ list: { level: ctx.lvl, ordered: tag === 'ol', num: i } });
        }
        return;
      }
      const isBlock = BLOCK.test(tag) || tag === 'li';
      if (isBlock) flush();
      const c2 = tag === 'pre' ? Object.assign({}, ctx, { pre: true }) : ctx;
      for (const c of n.childNodes) await walk(c, s, c2);
      if (isBlock) flush(tag === 'center' ? { align: 'center' } : undefined);
    };
    await walk(root, {}, { lvl: 0, pre: false });
    flush();
    return blocks;
  }

  /* ---------------- E-Book (.epub) ---------------- */
  async function parseEpub(zip) {
    const cont = parseXML(await zipText(zip, 'META-INF/container.xml'));
    const opfPath = attr(desc(cont, 'rootfile')[0], 'full-path');
    const opf = parseXML(await zipText(zip, opfPath));
    const items = {};
    for (const it of desc(opf, 'item')) items[attr(it, 'id')] = { href: resolvePath(opfPath, decodeURIComponent(attr(it, 'href'))), type: attr(it, 'media-type') };
    const title = (desc(opf, 'title')[0] || {}).textContent || '';
    const author = (desc(opf, 'creator')[0] || {}).textContent || '';
    const blocks = [];
    if (title) blocks.push({ type: 'h', level: 1, runs: [R(title)], align: 'center' });
    if (author) blocks.push(P([R(author, { i: true })], { align: 'center' }));
    let first = true;
    for (const ref of desc(opf, 'itemref')) {
      const it = items[attr(ref, 'idref')];
      if (!it || !/x?html/.test(it.type || it.href)) continue;
      const txt = await zipText(zip, it.href);
      if (!txt) continue;
      let dom = new DOMParser().parseFromString(txt, 'application/xhtml+xml');
      if (dom.getElementsByTagName('parsererror').length) dom = new DOMParser().parseFromString(txt, 'text/html');
      const bodyEl = dom.getElementsByTagName('body')[0] || dom.documentElement;
      const resolveImg = async (src) => {
        const p = resolvePath(it.href, decodeURIComponent(src.split('#')[0]));
        const data = await zipBytes(zip, p);
        return data ? { type: 'img', mime: mimeOf(p), data } : null;
      };
      const chapter = await htmlToBlocks(bodyEl, resolveImg);
      if (!chapter.length) continue;
      if (!first) blocks.push({ type: 'pagebreak', soft: true });
      first = false;
      blocks.push(...chapter);
    }
    return { blocks, book: true };
  }

  /* ---------------- Text, CSV, RTF, altes Word ---------------- */
  function decodeText(bytes) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }
  function parseCsv(text) {
    const first = text.split('\n')[0];
    const sep = (first.split(';').length > first.split(',').length) ? ';' : (first.includes('\t') ? '\t' : ',');
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; if (rows.length > MAX_ROWS) break; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return { blocks: [{ type: 'table', rows: rows.map(r => r.map(c => c ? [P([R(c)])] : [])) }] };
  }
  const textBlocks = (text) => ({ blocks: text.replace(/\r\n?/g, '\n').split('\n').map(l => P([R(l)])), mono: false });

  function parseRtf(bytes) {
    const s = new TextDecoder('latin1').decode(bytes);
    let out = '', i = 0, depth = 0, skipDepth = -1, uc = 1;
    const cp1252 = new TextDecoder('windows-1252');
    const skipDest = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|fldinst)$/;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { if (depth === skipDepth) skipDepth = -1; depth--; i++; continue; }
      if (ch === '\\') {
        const nx = s[i + 1];
        if (nx === '\\' || nx === '{' || nx === '}') { if (skipDepth < 0) out += nx; i += 2; continue; }
        if (nx === "'") { if (skipDepth < 0) out += cp1252.decode(new Uint8Array([parseInt(s.substr(i + 2, 2), 16)])); i += 4; continue; }
        if (nx === '*') { if (skipDepth < 0) skipDepth = depth; i += 2; continue; }
        const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(s.substr(i, 40));
        if (m) {
          const w = m[1];
          if (skipDest.test(w) && skipDepth < 0) skipDepth = depth;
          if (skipDepth < 0) {
            if (w === 'par' || w === 'line' || w === 'sect' || w === 'row') out += '\n';
            else if (w === 'tab' || w === 'cell') out += '\t';
            else if (w === 'u') { out += String.fromCharCode((+m[2] + 65536) % 65536); i += m[0].length + uc; continue; }
            else if (w === 'uc') uc = +m[2];
            else if (w === 'emdash') out += '—'; else if (w === 'endash') out += '–'; else if (w === 'bullet') out += '•';
            else if (w === 'lquote') out += '‘'; else if (w === 'rquote') out += '’'; else if (w === 'ldblquote') out += '„'; else if (w === 'rdblquote') out += '“';
          }
          i += m[0].length; continue;
        }
        i += 2; continue;
      }
      if (ch === '\r' || ch === '\n') { i++; continue; }
      if (skipDepth < 0) out += ch;
      i++;
    }
    return textBlocks(out.replace(/\n{3,}/g, '\n\n').trim());
  }

  // altes Word-Format (.doc): Text über die Stückliste (Piece Table) auslesen
  function readCFB(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('kein CFB');
    const ss = 1 << dv.getUint16(0x1E, true), mss = 1 << dv.getUint16(0x20, true);
    const secOff = (s) => 512 + s * ss;
    // FAT über DIFAT einsammeln
    const difat = [];
    for (let i = 0; i < 109; i++) { const v = dv.getInt32(0x4C + i * 4, true); if (v >= 0) difat.push(v); }
    let dsec = dv.getInt32(0x44, true), nd = dv.getUint32(0x48, true);
    while (dsec >= 0 && nd-- > 0 && secOff(dsec) + ss <= bytes.length) {
      for (let i = 0; i < ss / 4 - 1; i++) { const v = dv.getInt32(secOff(dsec) + i * 4, true); if (v >= 0) difat.push(v); }
      dsec = dv.getInt32(secOff(dsec) + ss - 4, true);
    }
    const fat = [];
    for (const s of difat) { const o = secOff(s); for (let i = 0; i < ss / 4 && o + i * 4 + 4 <= bytes.length; i++) fat.push(dv.getInt32(o + i * 4, true)); }
    const chain = (start, maxLen) => {
      const out = new Uint8Array(maxLen); let pos = 0, s = start, guard = 0;
      while (s >= 0 && pos < maxLen && guard++ < 1e6) {
        const o = secOff(s), n = Math.min(ss, maxLen - pos);
        out.set(bytes.subarray(o, o + n), pos); pos += n; s = fat[s];
      }
      return out.subarray(0, pos);
    };
    // Verzeichnis
    const dirStart = dv.getInt32(0x30, true);
    const dirBytes = chain(dirStart, 1 << 22);
    const entries = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
      const nlen = dirBytes[o + 64] | (dirBytes[o + 65] << 8);
      if (!nlen) continue;
      const name = new TextDecoder('utf-16le').decode(dirBytes.subarray(o, o + Math.max(0, nlen - 2)));
      const ed = new DataView(dirBytes.buffer, dirBytes.byteOffset + o, 128);
      entries.push({ name, type: dirBytes[o + 66], start: ed.getInt32(116, true), size: ed.getUint32(120, true) });
    }
    const root = entries.find(e => e.type === 5);
    const cutoff = dv.getUint32(0x38, true) || 4096;
    let mini = null, minifat = null;
    const read = (name) => {
      const e = entries.find(x => x.name === name);
      if (!e) return null;
      if (e.size >= cutoff || e.type === 5) return chain(e.start, e.size);
      if (!mini) {
        mini = chain(root.start, root.size);
        const mfStart = dv.getInt32(0x3C, true), mfN = dv.getUint32(0x40, true);
        const mf = chain(mfStart, mfN * ss), mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
        minifat = []; for (let i = 0; i + 4 <= mf.length; i += 4) minifat.push(mdv.getInt32(i, true));
      }
      const out = new Uint8Array(e.size); let pos = 0, s = e.start, guard = 0;
      while (s >= 0 && pos < e.size && guard++ < 1e6) { const n = Math.min(mss, e.size - pos); out.set(mini.subarray(s * mss, s * mss + n), pos); pos += n; s = minifat[s]; }
      return out;
    };
    return { read };
  }
  function docPieceText(bytes) {
    const cfb = readCFB(bytes);
    const wd = cfb.read('WordDocument');
    if (!wd) throw new Error('kein WordDocument');
    const w = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (w.getUint16(0, true) !== 0xA5EC) throw new Error('kein Word');
    const flags = w.getUint16(0x0A, true);
    if (flags & 0x0100) { const e = new Error('Dieses Word-Dokument ist mit einem Passwort geschützt.'); e.friendly = true; throw e; }
    const table = cfb.read((flags & 0x0200) ? '1Table' : '0Table');
    if (!table) throw new Error('keine Tabelle');
    let p = 32;
    const csw = w.getUint16(p, true); p += 2 + csw * 2;
    const cslw = w.getUint16(p, true); const lw = p + 2; p += 2 + cslw * 4;
    const ccpText = w.getInt32(lw + 3 * 4, true);
    p += 2; // cbRgFcLcb
    const fcClx = w.getUint32(p + 33 * 8, true), lcbClx = w.getUint32(p + 33 * 8 + 4, true);
    const t = new DataView(table.buffer, table.byteOffset, table.byteLength);
    let o = fcClx; const end = fcClx + lcbClx;
    while (o < end && table[o] === 1) o += 3 + t.getUint16(o + 1, true);
    if (table[o] !== 2) throw new Error('keine Stückliste');
    const lcb = t.getUint32(o + 1, true); o += 5;
    const n = (lcb - 4) / 12;
    const cps = []; for (let i = 0; i <= n; i++) cps.push(t.getUint32(o + i * 4, true));
    const pcd = o + (n + 1) * 4;
    const cp1252 = new TextDecoder('windows-1252'), u16 = new TextDecoder('utf-16le');
    let text = '';
    for (let i = 0; i < n; i++) {
      let a = cps[i], b2 = cps[i + 1];
      if (a >= ccpText) break;
      b2 = Math.min(b2, ccpText);
      const fc = t.getUint32(pcd + i * 8 + 2, true);
      const len = b2 - a;
      if (fc & 0x40000000) { const off = (fc & 0x3FFFFFFF) / 2; text += cp1252.decode(wd.subarray(off, off + len)); }
      else text += u16.decode(wd.subarray(fc, fc + len * 2));
    }
    // Steuerzeichen von Word umsetzen (Felder: nur das Ergebnis behalten)
    let out = '', depth = 0, skip = [];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c === 0x13) { depth++; skip.push(true); continue; }
      if (c === 0x14) { if (skip.length) skip[skip.length - 1] = false; continue; }
      if (c === 0x15) { depth = Math.max(0, depth - 1); skip.pop(); continue; }
      if (skip.length && skip[skip.length - 1]) continue;
      if (c === 0x0D) out += '\n';
      else if (c === 0x07) out += '\t';
      else if (c === 0x0B) out += '\n';
      else if (c === 0x0C) out += '\f';
      else if (c === 0x1E) out += '-';
      else if (c === 0x1F || c === 0x01 || c === 0x08 || c === 0x02 || c === 0x05) continue;
      else if (c < 0x09) continue;
      else out += ch;
    }
    return out;
  }
  function parseOldDoc(bytes) {
    try {
      const text = docPieceText(bytes);
      if (text.replace(/\s/g, '').length) {
        const blocks = [P([R('Altes Word-Format (.doc) – Text ohne Formatierung.', { i: true, color: '#7a4a1a' })])];
        for (const page of text.split('\f')) {
          if (blocks.length > 1) blocks.push({ type: 'pagebreak' });
          for (const line of page.replace(/\t\n/g, '\n').split('\n')) blocks.push(P([R(line.replace(/\t+$/, ''))]));
        }
        return { blocks };
      }
    } catch (e) { if (e.friendly) throw e; console.warn('doc', e); }
    return parseOldDocHeuristic(bytes);
  }
  function parseOldDocHeuristic(bytes) {
    const pick = (str) => (str.match(/[\p{L}\p{N}\p{P}\p{Zs}\r\t€]{12,}/gu) || []).filter(s => /\p{L}{3,}/u.test(s) && (s.match(/\s/g) || []).length >= 1);
    const u16 = pick(new TextDecoder('utf-16le').decode(bytes.subarray(0, bytes.length - (bytes.length % 2))));
    const ansi = pick(new TextDecoder('windows-1252').decode(bytes));
    const score = a => a.join('').length;
    let parts = score(u16) > score(ansi) ? u16 : ansi;
    parts = parts.filter(p => !/^(Microsoft|Times New Roman|Arial|Calibri|Normal|Standard|Überschrift|Heading|Default Paragraph|Table Normal|Kein Leerraum|WordDocument|SummaryInformation|DocumentSummaryInformation|Root Entry|Compobj|Word\.Document)/i.test(p.trim()));
    const text = parts.join('\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n');
    if (text.replace(/\s/g, '').length < 20) throw new Error('Text konnte nicht gelesen werden');
    const res = textBlocks(text);
    res.blocks.unshift(P([R('Vereinfachte Textansicht – dieses alte Word-Format (.doc) kann nur als reiner Text gezeigt werden.', { i: true, color: '#7a4a1a' })]));
    return res;
  }

  /* ---------------- Erkennung ---------------- */
  const ext = (name) => (name.split('.').pop() || '').toLowerCase();
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'jfif', 'ico', 'svg'];
  function kindOf(file) {
    const e = ext(file.name), t = (file.type || '').toLowerCase();
    if (e === 'pdf' || t === 'application/pdf') return 'pdf';
    if (['heic', 'heif'].includes(e) || /heic|heif/.test(t)) return 'heic';
    if (IMAGE_EXT.includes(e) || (t.startsWith('image/') && !/tiff/.test(t))) return 'image';
    if (['tif', 'tiff'].includes(e)) return 'tiff';
    if (e === 'docx' || e === 'docm' || e === 'dotx' || /wordprocessingml/.test(t)) return 'docx';
    if (e === 'xlsx' || e === 'xlsm' || /spreadsheetml/.test(t)) return 'xlsx';
    if (e === 'pptx' || e === 'ppsx' || /presentationml/.test(t)) return 'pptx';
    if (['odt', 'ods', 'odp', 'ott'].includes(e) || /opendocument/.test(t)) return 'odf';
    if (e === 'epub' || t === 'application/epub+zip') return 'epub';
    if (e === 'csv' || t === 'text/csv') return 'csv';
    if (e === 'rtf' || /rtf/.test(t)) return 'rtf';
    if (e === 'doc' || t === 'application/msword') return 'doc';
    if (['xls', 'ppt', 'pps', 'mobi', 'azw', 'azw3', 'pages', 'numbers', 'key', 'wps', 'xps'].includes(e)) return 'unsupported';
    if (['htm', 'html', 'xhtml'].includes(e) || t === 'text/html') return 'html';
    if (['txt', 'md', 'log', 'json', 'xml', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'vcf', 'ics', 'srt', 'nfo'].includes(e) || t.startsWith('text/')) return 'text';
    return 'unknown';
  }
  const KIND_NAME = { pdf: 'PDF', image: 'Bild', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', odf: 'OpenDocument', epub: 'E-Book', csv: 'Tabelle (CSV)', rtf: 'RTF-Text', doc: 'altes Word', html: 'Webseite', text: 'Text' };

  const UNSUPPORTED_MSG = {
    heic: 'Dieses Foto ist im iPhone-Format HEIC gespeichert. Das kann Android/Chrome leider nicht öffnen. Tipp: Auf dem iPhone unter Einstellungen → Kamera → Formate „Maximale Kompatibilität“ wählen, dann kommen JPEG-Fotos.',
    tiff: 'TIFF-Bilder kann Chrome leider nicht anzeigen.',
    unsupported: 'Dieses alte bzw. besondere Dateiformat kann leider nicht gelesen werden (z. B. .xls oder .ppt aus der Zeit vor 2007). Wenn möglich, die Datei als .xlsx/.pptx oder PDF schicken lassen.',
    unknown: 'Dieses Dateiformat ist unbekannt und kann nicht gelesen werden.'
  };

  async function parse(file) {
    const k = kindOf(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (UNSUPPORTED_MSG[k]) {
      if (k === 'unknown') { // vielleicht doch Text?
        const sample = bytes.subarray(0, 4000);
        const bin = sample.filter(b => b === 0 || (b < 9)).length;
        if (bin === 0 && sample.length) return Object.assign(textBlocks(decodeText(bytes)), { kind: 'text' });
      }
      const e = new Error(UNSUPPORTED_MSG[k]); e.friendly = true; throw e;
    }
    let res;
    try {
      if (['docx', 'xlsx', 'pptx', 'odf', 'epub'].includes(k)) {
        let zip;
        try { zip = await JSZip.loadAsync(bytes); }
        catch (e) { const er = new Error('Die Datei ist beschädigt oder mit einem Passwort geschützt und kann nicht geöffnet werden.'); er.friendly = true; throw er; }
        if (k === 'docx') res = await parseDocx(zip);
        else if (k === 'xlsx') res = await parseXlsx(zip);
        else if (k === 'pptx') res = await parsePptx(zip);
        else if (k === 'odf') res = await parseOdf(zip);
        else res = await parseEpub(zip);
      } else if (k === 'csv') res = parseCsv(decodeText(bytes));
      else if (k === 'rtf') res = parseRtf(bytes);
      else if (k === 'doc') {
        if (bytes[0] === 0x7B && bytes[1] === 0x5C) res = parseRtf(bytes); // eigentlich RTF
        else res = parseOldDoc(bytes);
      }
      else if (k === 'html') {
        const dom = new DOMParser().parseFromString(decodeText(bytes), 'text/html');
        res = { blocks: await htmlToBlocks(dom.body || dom.documentElement, null) };
      }
      else res = textBlocks(decodeText(bytes));
    } catch (e) {
      if (e.friendly) throw e;
      console.error(e);
      const er = new Error('Diese Datei konnte nicht gelesen werden (' + (KIND_NAME[k] || k) + '). Sie ist möglicherweise beschädigt.'); er.friendly = true; throw er;
    }
    if (!res.blocks.length) res.blocks.push(P([R('(Die Datei enthält keinen lesbaren Text.)', { i: true })]));
    res.kind = k;
    return res;
  }

  /* =====================================================================
     Anzeige als HTML
     ===================================================================== */
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const urls = [];
  function runsHTML(runs) {
    return runs.map(r => {
      let t = esc(r.t).replace(/\t/g, '&emsp;').replace(/\n/g, '<br>');
      const st = [];
      if (r.size) st.push(`font-size:${Math.max(.7, Math.min(2.6, r.size / 11)).toFixed(2)}em`);
      if (r.color && r.color.toLowerCase() !== '#000000') st.push(`color:${r.color}`);
      if (st.length) t = `<span style="${st.join(';')}">${t}</span>`;
      if (r.u) t = `<u>${t}</u>`;
      if (r.i) t = `<i>${t}</i>`;
      if (r.b) t = `<b>${t}</b>`;
      return t;
    }).join('') || '&nbsp;';
  }
  function toHTML(model) {
    urls.forEach(u => URL.revokeObjectURL(u)); urls.length = 0;
    const out = [];
    for (const b of model.blocks) {
      const al = b.align ? ` style="text-align:${b.align}"` : '';
      if (b.type === 'h') out.push(`<h${b.level}${al}${b.slide ? ' class="slide-title"' : ''}>${runsHTML(b.runs)}</h${b.level}>`);
      else if (b.type === 'p') {
        if (b.list) {
          const mark = b.list.ordered ? (b.list.num || 1) + '.' : ['•', '◦', '▪'][b.list.level % 3];
          out.push(`<p class="li" style="margin-left:${1.2 + b.list.level * 1.3}em"${b.align ? ` data-align="${b.align}"` : ''}><span class="mark">${mark}</span>${runsHTML(b.runs)}</p>`);
        } else out.push(`<p${al}>${runsHTML(b.runs)}</p>`);
      }
      else if (b.type === 'table') {
        out.push(`<div class="tbl-wrap"><table${b.sheet ? ' class="sheet"' : ''}>` + b.rows.map(r => '<tr>' + r.map(c => `<td>${c.map(p => runsHTML(p.runs || [])).join('<br>')}</td>`).join('') + '</tr>').join('') + '</table></div>');
      }
      else if (b.type === 'img') {
        if (/emf|wmf|tiff|octet/.test(b.mime)) { out.push('<p class="img-missing">[Bild in einem Format, das nicht angezeigt werden kann]</p>'); continue; }
        const u = URL.createObjectURL(new Blob([b.data], { type: b.mime }));
        urls.push(u);
        out.push(`<p class="img"><img src="${u}" alt="" loading="lazy" onerror="this.parentNode.className='img-missing';this.replaceWith('[Bild]')"></p>`);
      }
      else if (b.type === 'hr') out.push('<hr>');
      else if (b.type === 'pagebreak') out.push(b.soft ? '<div class="chapter-break">❦</div>' : '<div class="page-break"></div>');
    }
    return out.join('\n');
  }

  /* =====================================================================
     Ausgabe als PDF (echter, durchsuchbarer Text)
     ===================================================================== */
  async function toPDF(model, pdfDoc, onProgress) {
    const { StandardFonts, rgb } = PDFLib;
    const F = {
      r: await pdfDoc.embedFont(StandardFonts.Helvetica),
      b: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      i: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
      bi: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique)
    };
    const fontOf = (r) => r.b && r.i ? F.bi : r.b ? F.b : r.i ? F.i : F.r;
    // nur Zeichen, die die Standardschrift kennt
    const okCache = new Map();
    const MAP = { ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '‑': '-', '−': '-', '‐': '-', '●': '•', '▪': '•', '◦': '•', '✓': 'x', '✔': 'x', '': '•', '': '•' };
    const clean = (s) => {
      let o = '';
      for (const ch of s) {
        if (MAP[ch]) { o += MAP[ch]; continue; }
        let ok = okCache.get(ch);
        if (ok === undefined) {
          try { F.r.encodeText(ch); ok = true; } catch (e) { ok = false; }
          okCache.set(ch, ok);
        }
        if (ok) o += ch;
        else {
          const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
          let ok2 = false;
          try { if (base && base !== ch) { F.r.encodeText(base); ok2 = true; } } catch (e) {}
          o += ok2 ? base : (/\p{Emoji}/u.test(ch) ? '' : '?');
        }
      }
      return o;
    };
    const PW = 595.28, PH = 841.89, M = 54, W = PW - 2 * M;
    let page = null, y = 0;
    const newPage = () => { page = pdfDoc.addPage([PW, PH]); y = PH - M; };
    const ensure = (h) => { if (!page || y - h < M) newPage(); };
    const toRGB = (hex) => { const n = parseInt(hex.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

    // Absatz mit gemischten Schriften umbrechen und zeichnen
    function layoutRuns(runs, size, x0, width) {
      const words = []; // {text, font, size, color, u, space}
      for (const r of runs) {
        const font = fontOf(r);
        const sz = r.size ? Math.max(6, Math.min(30, r.size * size / 11)) : size;
        const parts = clean(r.t.replace(/\t/g, '    ')).split(/(\n| +)/);
        for (const p of parts) {
          if (p === '') continue;
          if (p === '\n') words.push({ br: true });
          else if (/^ +$/.test(p)) words.push({ space: true, w: font.widthOfTextAtSize(' ', sz) * p.length });
          else words.push({ text: p, font, size: sz, color: r.color, u: r.u, w: font.widthOfTextAtSize(p, sz) });
        }
      }
      const lines = []; let line = [], lw = 0;
      const push = () => { while (line.length && line[line.length - 1].space) { lw -= line[line.length - 1].w; line.pop(); } lines.push({ items: line, w: lw }); line = []; lw = 0; };
      for (const w of words) {
        if (w.br) { push(); continue; }
        if (w.space) { if (line.length) { line.push(w); lw += w.w; } continue; }
        if (lw + w.w > width && line.length) push();
        // überlange Wörter (z. B. Links) hart trennen
        if (w.w > width) {
          let rest = w.text;
          while (rest.length) {
            let n = rest.length;
            while (n > 1 && w.font.widthOfTextAtSize(rest.slice(0, n), w.size) > width - lw) n--;
            const piece = rest.slice(0, n);
            line.push(Object.assign({}, w, { text: piece, w: w.font.widthOfTextAtSize(piece, w.size) }));
            lw += line[line.length - 1].w;
            rest = rest.slice(n);
            if (rest.length) push();
          }
          continue;
        }
        line.push(w); lw += w.w;
      }
      push();
      return lines.map(l => {
        const maxSize = Math.max(size, ...l.items.filter(i => !i.space).map(i => i.size));
        return Object.assign(l, { h: maxSize * 1.38, asc: maxSize * 0.92, x0, width });
      });
    }
    function drawLines(lines, align, color0) {
      for (const l of lines) {
        ensure(l.h);
        let x = l.x0 + (align === 'center' ? (l.width - l.w) / 2 : align === 'right' ? l.width - l.w : 0);
        const base = y - l.asc;
        for (const it of l.items) {
          if (!it.space) {
            const col = it.color ? toRGB(it.color) : color0;
            page.drawText(it.text, { x, y: base, size: it.size, font: it.font, color: col });
            if (it.u) page.drawLine({ start: { x, y: base - 1.5 }, end: { x: x + it.w, y: base - 1.5 }, thickness: .6, color: col });
          }
          x += it.w;
        }
        y -= l.h;
      }
    }
    const ink = rgb(0.1, 0.08, 0.06);

    async function embedImage(b) {
      try {
        if (b.mime === 'image/jpeg') return await pdfDoc.embedJpg(b.data);
        if (b.mime === 'image/png') return await pdfDoc.embedPng(b.data);
        // andere Bildformate über die Leinwand in PNG umwandeln
        const bmp = await createImageBitmap(new Blob([b.data], { type: b.mime }));
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        return await pdfDoc.embedPng(new Uint8Array(await blob.arrayBuffer()));
      } catch (e) { return null; }
    }

    const total = model.blocks.length;
    for (let bi = 0; bi < total; bi++) {
      const b = model.blocks[bi];
      if (onProgress && bi % 40 === 0) await onProgress(bi / total);
      if (!page) newPage();
      if (b.type === 'pagebreak') { if (!b.soft || y < PH - M - 1) newPage(); continue; }
      if (b.type === 'hr') { ensure(12); page.drawLine({ start: { x: M, y: y - 6 }, end: { x: PW - M, y: y - 6 }, thickness: .6, color: rgb(.5, .45, .4) }); y -= 12; continue; }
      if (b.type === 'h') {
        const size = [0, 20, 16, 13.5, 12][b.level] || 12;
        const lines = layoutRuns(b.runs.map(r => Object.assign({}, r, { b: true, size: null })), size, M, W);
        y -= size * 0.5;
        ensure(lines[0].h + 20); // Überschrift nicht allein unten
        drawLines(lines, b.align, rgb(0.15, 0.1, 0.05));
        y -= size * 0.25;
        continue;
      }
      if (b.type === 'p') {
        if (!textOfRuns(b.runs).trim()) { y -= 11 * 0.9; if (y < M) newPage(); continue; }
        let x0 = M, width = W;
        if (b.list) {
          x0 = M + 14 + b.list.level * 16; width = PW - M - x0;
          const mark = b.list.ordered ? (b.list.num || 1) + '.' : '•';
          const lines = layoutRuns(b.runs, 11, x0, width);
          ensure(lines[0].h);
          page.drawText(mark, { x: x0 - (b.list.ordered ? F.r.widthOfTextAtSize(mark, 11) + 4 : 9), y: y - lines[0].asc, size: 11, font: F.r, color: ink });
          drawLines(lines, null, ink);
        } else {
          drawLines(layoutRuns(b.runs, 11, x0, width), b.align, ink);
        }
        y -= 3;
        continue;
      }
      if (b.type === 'img') {
        if (/emf|wmf|tiff|octet/.test(b.mime)) continue;
        const img = await embedImage(b);
        if (!img) continue;
        let w = Math.min(W, img.width * 0.75), h = img.height * (w / img.width);
        const maxH = PH - 2 * M;
        if (h > maxH) { h = maxH; w = img.width * (h / img.height); }
        ensure(h + 6);
        page.drawImage(img, { x: M + (W - w) / 2, y: y - h, width: w, height: h });
        y -= h + 8;
        continue;
      }
      if (b.type === 'table') {
        const cols = Math.max(...b.rows.map(r => r.length), 1);
        const size = cols > 8 ? 7 : cols > 5 ? 8 : 9.5;
        // Spaltenbreiten nach Inhalt
        const need = Array(cols).fill(0);
        for (const r of b.rows.slice(0, 200)) r.forEach((c, i) => {
          const t = c.map(p => textOfRuns(p.runs || [])).join(' ');
          need[i] = Math.max(need[i], Math.min(F.r.widthOfTextAtSize(clean(t), size), W * 0.6));
        });
        const minW = Math.min(30, W / cols);
        let widths = need.map(n => Math.max(minW, n + 8));
        const sum = widths.reduce((a, c) => a + c, 0);
        widths = widths.map(w => w * W / sum);
        const pad = 3;
        y -= 4;
        for (const r of b.rows) {
          const cellLines = widths.map((cw, i) => {
            const c = r[i] || [];
            const runs = [];
            c.forEach((p, k) => { if (k) runs.push(R('\n')); runs.push(...(p.runs || [])); });
            return layoutRuns(runs.length ? runs : [R('')], size, 0, cw - 2 * pad);
          });
          const rh = Math.max(...cellLines.map(ls => ls.reduce((a, l) => a + l.h, 0))) + 2 * pad;
          if (y - rh < M) newPage();
          let x = M;
          const top = y;
          cellLines.forEach((ls, i) => {
            page.drawRectangle({ x, y: top - rh, width: widths[i], height: rh, borderColor: rgb(.55, .5, .45), borderWidth: .5 });
            let yy = top - pad;
            for (const l of ls) {
              let xx = x + pad;
              for (const it of l.items) {
                if (!it.space) page.drawText(it.text, { x: xx, y: yy - l.asc, size: it.size, font: it.font, color: it.color ? toRGB(it.color) : ink });
                xx += it.w;
              }
              yy -= l.h;
              if (yy < top - rh) break;
            }
            x += widths[i];
          });
          y -= rh;
        }
        y -= 8;
      }
    }
    if (!page) newPage();
  }

  window.Docs = { parse, kindOf, toHTML, toPDF, KIND_NAME, UNSUPPORTED_MSG, ext };
})();
