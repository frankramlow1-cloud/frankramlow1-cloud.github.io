/* =====================================================================
   Wetter-Symbole – selbst gezeichnet (SVG), vollfarbig, durchsichtig
   Alle Wettercodes, die die DWD-Modelle (ICON) liefern, Tag + Nacht
   ===================================================================== */
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  // gemeinsame Farbverläufe + Filter (einmal im Dokument)
  const DEFS = `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <radialGradient id="wSunCore" cx="38%" cy="34%" r="70%">
      <stop offset="0" stop-color="#fffbd0"/><stop offset=".35" stop-color="#ffe14d"/>
      <stop offset=".75" stop-color="#ffb000"/><stop offset="1" stop-color="#ff8a00"/>
    </radialGradient>
    <radialGradient id="wSunGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffe680" stop-opacity=".95"/><stop offset=".55" stop-color="#ffc83d" stop-opacity=".45"/>
      <stop offset="1" stop-color="#ffb000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wRay" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff2a0"/><stop offset=".6" stop-color="#ffd23a" stop-opacity=".85"/>
      <stop offset="1" stop-color="#ffb800" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="wCloudW" cx="40%" cy="28%" r="75%">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#eef3f9"/>
      <stop offset=".85" stop-color="#c3d1e0"/><stop offset="1" stop-color="#a7b8cb"/>
    </radialGradient>
    <radialGradient id="wCloudG" cx="40%" cy="28%" r="75%">
      <stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#c9d0d8"/>
      <stop offset=".85" stop-color="#8f9aa7"/><stop offset="1" stop-color="#77828f"/>
    </radialGradient>
    <radialGradient id="wCloudD" cx="40%" cy="28%" r="75%">
      <stop offset="0" stop-color="#c6ccd5"/><stop offset=".5" stop-color="#7d8794"/>
      <stop offset=".85" stop-color="#4c5562"/><stop offset="1" stop-color="#3a424e"/>
    </radialGradient>
    <linearGradient id="wDrop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9fbff" stop-opacity=".6"/><stop offset=".45" stop-color="#7fd3f7"/>
      <stop offset="1" stop-color="#1b86c9"/>
    </linearGradient>
    <radialGradient id="wMoon" cx="42%" cy="38%" r="65%">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e3e8ee"/>
      <stop offset="1" stop-color="#a3adb9"/>
    </radialGradient>
    <radialGradient id="wMoonGlow" cx="50%" cy="50%" r="50%">
      <stop offset=".55" stop-color="#dfe9ff" stop-opacity=".55"/><stop offset="1" stop-color="#9fb8ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wBolt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#f1dcff"/><stop offset="1" stop-color="#b56bff"/>
    </linearGradient>
    <radialGradient id="wHail" cx="35%" cy="30%" r="70%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9fd2ee"/>
    </radialGradient>
    <linearGradient id="wFog" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7f8e9c" stop-opacity="0"/><stop offset=".2" stop-color="#aab7c3"/><stop offset=".5" stop-color="#e4eaf0"/>
      <stop offset=".8" stop-color="#9eacb9"/><stop offset="1" stop-color="#7f8e9c" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="wPole" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#9aa3ad"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#8b949e"/>
    </linearGradient>
    <linearGradient id="wSockR" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff5a4a"/><stop offset=".5" stop-color="#e01b12"/><stop offset="1" stop-color="#9c0c06"/>
    </linearGradient>
    <linearGradient id="wSockW" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#eef0f2"/><stop offset="1" stop-color="#b9bec4"/>
    </linearGradient>
    <filter id="wShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#1b1208" flood-opacity=".38"/>
    </filter>
    <filter id="wGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="wBoltGlow" x="-80%" y="-30%" width="260%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.6" result="b"/>
      <feFlood flood-color="#8a2bff" flood-opacity=".95"/><feComposite in2="b" operator="in" result="g"/>
      <feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs></svg>`;
  document.addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('afterbegin', DEFS));

  const f = n => +n.toFixed(2);

  /* ---------- Bausteine ---------- */
  function sun(cx, cy, r) {
    let rays = '';
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 3) * 0.05;
      const len = r * (i % 2 ? 0.55 : 0.95) * (1 + ((i * 7) % 5) * 0.06);
      const w = r * (i % 2 ? 0.07 : 0.1);
      const r0 = r * 0.92;
      const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
      const x1 = cx + Math.cos(a) * (r0 + len), y1 = cy + Math.sin(a) * (r0 + len);
      const px = -Math.sin(a) * w, py = Math.cos(a) * w;
      rays += `<polygon points="${f(x0 + px)},${f(y0 + py)} ${f(x1)},${f(y1)} ${f(x0 - px)},${f(y0 - py)}" fill="#ffd23a" opacity="${i % 2 ? .65 : .9}"/>`;
    }
    return `<g>
      <circle cx="${cx}" cy="${cy}" r="${f(r * 1.75)}" fill="url(#wSunGlow)"/>
      <g filter="url(#wGlow)">${rays}</g>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#wSunCore)"/>
      <ellipse cx="${f(cx - r * .3)}" cy="${f(cy - r * .35)}" rx="${f(r * .42)}" ry="${f(r * .28)}" fill="#fff" opacity=".35" transform="rotate(-30 ${f(cx - r * .3)} ${f(cy - r * .35)})"/>
    </g>`;
  }

  function star(x, y, s) {
    return `<path d="M${x} ${f(y - s)} Q${f(x + s * .18)} ${f(y - s * .18)} ${f(x + s)} ${y} Q${f(x + s * .18)} ${f(y + s * .18)} ${x} ${f(y + s)} Q${f(x - s * .18)} ${f(y + s * .18)} ${f(x - s)} ${y} Q${f(x - s * .18)} ${f(y - s * .18)} ${x} ${f(y - s)}Z" fill="#fffbe6"/>`;
  }

  function moon(cx, cy, r, stars = true) {
    const craters = [[-.35, -.2, .2], [.25, -.35, .14], [.3, .2, .22], [-.15, .4, .12], [-.45, .25, .09], [.05, .05, .1]]
      .map(([dx, dy, rr]) => `<circle cx="${f(cx + dx * r)}" cy="${f(cy + dy * r)}" r="${f(rr * r)}" fill="#7d8896" opacity=".32"/>
         <circle cx="${f(cx + dx * r - rr * r * .2)}" cy="${f(cy + dy * r - rr * r * .2)}" r="${f(rr * r * .75)}" fill="#c4ccd6" opacity=".35"/>`).join('');
    const st = stars ? star(cx - r * 1.5, cy - r * .9, r * .2) + star(cx + r * 1.45, cy - r * 1.1, r * .16) + star(cx + r * 1.2, cy + r * 1.15, r * .12) : '';
    return `<g>${st}
      <circle cx="${cx}" cy="${cy}" r="${f(r * 1.45)}" fill="url(#wMoonGlow)"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#wMoon)"/>
      ${craters}
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="${f(r * .05)}"/>
    </g>`;
  }

  // Wolke aus mehreren plastischen Bauschen
  function cloud(x, y, s, tone = 'W') {
    const g = `url(#wCloud${tone})`;
    const p = [[-24, 7, 8], [-17, 2, 10.5], [-7, -5, 14], [3, -9, 11], [11, -6, 15], [21, 1, 11], [27, 8, 7.5]];
    const puffs = p.map(([dx, dy, r]) => `<circle cx="${dx}" cy="${dy}" r="${r}" fill="${g}"/>`).join('');
    return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#wShadow)">
      ${puffs}
      <rect x="-29" y="1" width="60" height="16" rx="8" fill="${g}"/>
      <ellipse cx="1" cy="9" rx="27" ry="7" fill="${g}" opacity=".9"/>
      <ellipse cx="2" cy="14" rx="25" ry="3.2" fill="#5b6b7d" opacity="${tone === 'D' ? .35 : .16}"/>
      <circle cx="-12" cy="5" r="6" fill="#fff" opacity="${tone === 'D' ? .06 : .22}"/>
      <circle cx="12" cy="2" r="7" fill="#fff" opacity="${tone === 'D' ? .06 : .18}"/>
      <ellipse cx="-4" cy="-10" rx="7" ry="3.5" fill="#fff" opacity="${tone === 'D' ? .18 : .5}"/>
    </g>`;
  }

  function drops(list, scale = 1) {
    return list.map(([x, y]) => {
      const h = 9 * scale, w = 2.6 * scale;
      return `<path d="M${x} ${f(y - h)} C${f(x + w * .4)} ${f(y - h * .35)} ${f(x + w)} ${f(y - h * .05)} ${f(x + w)} ${f(y + w * .35)} A${w} ${w} 0 0 1 ${f(x - w)} ${f(y + w * .35)} C${f(x - w)} ${f(y - h * .05)} ${f(x - w * .4)} ${f(y - h * .35)} ${x} ${f(y - h)}Z" fill="url(#wDrop)"/>`;
    }).join('');
  }

  function dots(list, r = 2) {
    return list.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#wDrop)"/>`).join('');
  }

  function rings(list) {
    return list.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${f(r * .32)}" fill="none" stroke="#bfe9ff" stroke-width=".9" opacity=".75"/>`).join('');
  }

  function flake(x, y, r) {
    let arms = '';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const ex = x + Math.cos(a) * r, ey = y + Math.sin(a) * r;
      arms += `M${x} ${y}L${f(ex)} ${f(ey)}`;
      [0.55, 0.8].forEach(t => {
        const bx = x + Math.cos(a) * r * t, by = y + Math.sin(a) * r * t;
        const bl = r * (t === .55 ? .32 : .22);
        [-1, 1].forEach(sg => {
          const b = a + sg * Math.PI / 4;
          arms += `M${f(bx)} ${f(by)}L${f(bx + Math.cos(b) * bl)} ${f(by + Math.sin(b) * bl)}`;
        });
      });
    }
    return `<g filter="url(#wShadow)"><path d="${arms}" stroke="#2f7fb8" stroke-width="${f(r * .32)}" stroke-linecap="round" fill="none" opacity=".85"/>
      <path d="${arms}" stroke="#f2fbff" stroke-width="${f(r * .15)}" stroke-linecap="round" fill="none"/>
      <circle cx="${x}" cy="${y}" r="${f(r * .14)}" fill="#ffffff"/></g>`;
  }

  function hail(list) {
    return list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#wHail)" stroke="#6fb3dc" stroke-width=".5"/>`).join('');
  }

  function bolt(x, y, s) {
    return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#wBoltGlow)">
      <polygon points="2,0 -7,17 0,17 -5,32 10,11 3,11 9,0" fill="url(#wBolt)" stroke="#ffffff" stroke-width=".6"/>
    </g>`;
  }

  function fog(y0, n = 4) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const y = y0 + i * 8, x = 10 + (i % 2) * 6, w = 78 - (i % 2) * 10;
      s += `<rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="url(#wFog)" stroke="#6d7c8a" stroke-opacity=".35" stroke-width=".5" opacity="${1 - i * .08}"/>`;
    }
    return s;
  }

  function windsock(x, y, s) {
    // Mast + rot-weiß gestreifter Windsack
    const seg = [];
    const n = 5, x0 = 4, x1 = 30, h0 = 9, h1 = 3.2;
    for (let i = 0; i < n; i++) {
      const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n;
      const ha = h0 + (h1 - h0) * i / n, hb = h0 + (h1 - h0) * (i + 1) / n;
      const droop = i * .6;
      seg.push(`<polygon points="${f(a)},${f(-ha + droop)} ${f(b)},${f(-hb + droop + .6)} ${f(b)},${f(hb + droop + .6)} ${f(a)},${f(ha + droop)}" fill="url(#${i % 2 ? 'wSockW' : 'wSockR'})"/>`);
    }
    return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#wShadow)">
      <rect x="-1.6" y="-12" width="3.2" height="44" rx="1.6" fill="url(#wPole)"/>
      <ellipse cx="${x0}" cy="0" rx="2.2" ry="${h0}" fill="#7a0b06"/>
      ${seg.join('')}
      <line x1="0" y1="-9" x2="${x0}" y2="-${h0}" stroke="#c9ced3" stroke-width="1"/>
      <line x1="0" y1="9" x2="${x0}" y2="${h0}" stroke="#c9ced3" stroke-width="1"/>
    </g>`;
  }

  /* ---------- Zusammenstellung je Wettercode ---------- */
  const celestial = (isDay, x, y, r) => isDay ? sun(x, y, r) : moon(x, y, r * .95, false);

  function compose(code, isDay, wind) {
    let s = '';
    const D = isDay;
    switch (true) {
      case code === 0:
        s = D ? sun(50, 50, 21) : moon(50, 50, 22);
        break;
      case code === 1:
        s = celestial(D, 40, 38, 18) + cloud(62, 66, .72, 'W');
        break;
      case code === 2:
        s = celestial(D, 36, 36, 17) + cloud(56, 60, 1, 'W');
        break;
      case code === 3:
        s = (D ? '' : moon(72, 30, 12, false)) + cloud(64, 42, .78, 'G') + cloud(46, 60, 1.05, 'W');
        break;
      case code === 45 || code === 48:
        s = cloud(52, 34, .9, 'G') + fog(52, 4) + (code === 48 ? flake(84, 30, 6) : '');
        break;
      case code === 51 || code === 53:
        s = celestial(D, 32, 30, 14) + cloud(56, 46, .95, 'W') +
            dots(code === 51 ? [[42, 70], [58, 76], [72, 68]] : [[36, 70], [48, 78], [58, 69], [70, 77], [80, 70]]);
        break;
      case code === 55:
        s = cloud(50, 42, 1.05, 'G') + dots([[28, 66], [38, 74], [48, 66], [58, 76], [68, 67], [78, 75], [44, 84], [64, 86]], 1.8);
        break;
      case code === 56 || code === 57:
        s = cloud(50, 40, 1.05, 'G') + dots([[30, 68], [52, 72], [72, 66]], 1.8) + flake(41, 80, 6) + flake(64, 84, 5.5);
        break;
      case code === 61 || code === 80:
        s = celestial(D, 32, 30, 14) + cloud(56, 46, .95, 'W') + drops([[42, 76], [58, 82], [72, 74]]);
        break;
      case code === 63 || code === 81:
        s = cloud(50, 40, 1.05, 'G') + drops([[28, 70], [42, 78], [54, 70], [66, 80], [78, 71], [48, 90]]);
        break;
      case code === 65 || code === 82:
        s = cloud(50, 36, 1.12, 'D') + drops([[24, 64], [34, 74], [44, 64], [54, 76], [64, 65], [74, 75], [82, 64], [40, 86], [60, 88]], 1.05) +
            rings([[30, 95, 5], [52, 97, 6], [72, 95, 5]]);
        break;
      case code === 66 || code === 67:
        s = cloud(50, 38, 1.08, code === 67 ? 'D' : 'G') + drops([[28, 70], [50, 74], [72, 69]]) + flake(39, 84, 6.5) + flake(62, 87, 6);
        break;
      case code === 71 || code === 85:
        s = (code === 85 ? celestial(D, 32, 30, 14) : '') + cloud(54, 44, 1, 'W') + flake(40, 76, 8) + flake(66, 80, 7);
        break;
      case code === 73:
        s = cloud(50, 40, 1.05, 'G') + flake(30, 74, 8) + flake(54, 80, 9) + flake(76, 72, 7.5);
        break;
      case code === 75 || code === 86:
        s = cloud(50, 36, 1.12, 'G') + flake(24, 68, 7) + flake(44, 74, 8.5) + flake(66, 68, 7.5) + flake(34, 90, 6.5) + flake(58, 90, 7) + flake(80, 86, 6);
        break;
      case code === 77:
        s = cloud(50, 40, 1.05, 'G') + [[30, 70], [42, 78], [54, 70], [66, 79], [78, 70], [48, 88], [64, 90]]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="#ffffff" stroke="#8cc4e6" stroke-width=".6"/>`).join('');
        break;
      case code === 95:
        s = cloud(50, 34, 1.12, 'D') + drops([[24, 66], [36, 76], [70, 74], [82, 64], [30, 90]]) + bolt(52, 50, 1.25);
        break;
      case code === 96 || code === 99:
        s = cloud(50, 34, 1.12, 'D') + drops([[24, 66], [80, 66]]) + hail([[32, 78, 3.6], [72, 82, 3.8], [26, 92, 3], [84, 92, 3.2]]) + bolt(52, 50, 1.25);
        break;
      default:
        s = celestial(D, 40, 38, 18) + cloud(62, 66, .72, 'W');
    }
    if (wind >= 50) s += windsock(72, 70, .8);
    return s;
  }

  window.weatherIconSVG = function (code, isDay, wind) {
    return `<svg class="wicon" viewBox="0 0 100 100" xmlns="${NS}" overflow="visible">${compose(code, isDay, wind)}</svg>`;
  };
  window.WEATHER_CODES = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
})();
