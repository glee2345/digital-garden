// The bouquet: an animated ASCII garden on the home page where each stem is
// a topic and each flower is a thought. Shapes are drawn on a tiny offscreen
// canvas every frame, then painted cell by cell as characters chosen by how
// much ink each cell holds, colored to match, with a soft glow underneath.
// Seeded, so the same garden always grows the same way.
(function () {
  const root = document.getElementById('field');
  if (!root) return;
  const data = JSON.parse(root.dataset.garden || '{"topics":[]}');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const hits = root.querySelector('.hits');
  const labels = document.querySelector('.field-keys');
  const hover = root.querySelector('.hovercard');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // flower colors, one per topic (also used as the topic's color elsewhere)
  const PETALS = ['#E9A8A6', '#F0D9A8', '#D89C73', '#C7B3E3', '#E7C86A', '#A9C6D9', '#EFC2D6', '#B9D4A8'];
  const C = { stem: '#6E9060', stem2: '#587A4C', leaf: '#8AAE78', ruscus: '#5E8452', bud: '#B6CDA0', core: '#5A3F2A', stamen: '#F6E7B9', breath: '#F3EEE2', dust: '#4A4038' };
  const RAMP = " .'`,:;-~=+*#";

  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- layout. Geometry is in "height units": y 0 (top) .. 1 (bottom),
  // x measured in the same units from the center, converted by aspect later.
  let scene = null;
  function layout() {
    const rand = rng(23);
    const topics = data.topics.slice().sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, topics[0]?.count || 1);
    const n = topics.length;
    // fan: big stems toward the middle, small ones to the sides
    const order = []; let lo = 0, hi = n - 1;
    for (let i = 0; i < n; i++) order.push(i % 2 ? lo++ : hi--);
    const spread = Math.min(1.15, 0.35 + 0.17 * n);
    const stems = topics.map((tp, i) => {
      const f = tp.count / maxCount;
      const slot = order[i];
      const ang = n === 1 ? 0 : -spread / 2 + (spread * slot) / (n - 1) + (rand() - 0.5) * 0.08;
      const len = 0.58 + 0.42 * Math.sqrt(f) + (rand() - 0.5) * 0.05;
      const bend = (rand() - 0.5) * 0.14;
      const delay = rand() * 1.2;
      const color = PETALS[i % PETALS.length];
      const blooms = tp.thoughts.slice(0, 6).map((t, k, arr) => {
        const u = arr.length === 1 ? 1 : 0.58 + (0.42 * k) / (arr.length - 1);
        const side = k % 2 ? 1 : -1;
        const reach = k === arr.length - 1 ? 0 : 0.035 + rand() * 0.045;
        const size = t.stage === 'evergreen' ? 1 : t.stage === 'growing' ? 0.74 : 0.5;
        const open = t.stage === 'evergreen' ? 1 : t.stage === 'growing' ? 0.65 : 0.1;
        return { t, u, side, reach, size, open, phase: rand() * 6.28, delay: 3.0 + rand() * 1.6 + (1 - u) * 0.8, tilt: (rand() - 0.5) * 0.6 };
      });
      const leaves = Array.from({ length: 2 + Math.round(2 * f) }, (_, k) => ({ u: 0.28 + rand() * 0.45, side: k % 2 ? 1 : -1, len: 0.07 + rand() * 0.05, delay: 1.6 + rand() * 1.4 }));
      return { tp, ang, len, bend, delay, blooms, leaves, f, color };
    });
    // ruscus: greenery sprigs fanning around the bunch
    const nS = Math.max(4, n + 3);
    const sprigs = Array.from({ length: nS }, (_, i) => {
      const a = -spread / 2 - 0.18 + ((spread + 0.36) * i) / (nS - 1) + (rand() - 0.5) * 0.1;
      return { ang: a, len: 0.42 + rand() * 0.26, delay: 0.4 + rand() * 1.4, leaves: 5 + Math.floor(rand() * 4), phase: rand() * 6.28 };
    });
    // baby's breath: thoughts with no root yet, plus filler sprays
    const breath = (data.loose || []).map(() => ({ ang: (rand() - 0.5) * (spread + 0.3), len: 0.5 + rand() * 0.4, delay: 3.6 + rand() * 1.8, phase: rand() * 6.28, n: 4 }))
      .concat(Array.from({ length: 5 + n }, () => ({ ang: (rand() - 0.5) * (spread + 0.3), len: 0.45 + rand() * 0.45, delay: 4 + rand() * 2, phase: rand() * 6.28, n: 3 })));
    scene = { stems, sprigs, breath, base: { x: 0, y: 1.12 } };
  }

  // a stem's point at u (0 base .. 1 tip), as [xh, y] in height units
  function curvePoint(ang, len, bend, u, sway) {
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    const px = -dy, py = dx; // perpendicular
    const b = (bend + sway) * Math.sin(u * Math.PI) ;
    return [scene.base.x + dx * len * u + px * b * len, scene.base.y + dy * len * u + py * b * len];
  }

  // ---- canvases
  let cols = 0, rows = 0, off = null, octx = null, aspect = 1.7;
  const CW = 3, CHp = 6, FONT = 10, LINE = 12.5, CELLW = 6;
  function size() {
    cols = Math.max(60, Math.floor(root.clientWidth / CELLW));
    rows = Math.max(28, Math.floor(root.clientHeight / LINE));
    aspect = (cols * CELLW) / (rows * LINE);
    canvas.width = Math.round(cols * CELLW * devicePixelRatio);
    canvas.height = Math.round(rows * LINE * devicePixelRatio);
    canvas.style.width = `${cols * CELLW}px`; canvas.style.height = `${rows * LINE}px`;
    off = document.createElement('canvas'); off.width = cols * CW; off.height = rows * CHp; octx = off.getContext('2d', { willReadFrequently: true });
    placeHits();
  }
  // height-units → offscreen pixels
  const P = (xh, y) => [(0.5 + xh / aspect) * cols * CW, y * rows * CHp];
  const U = () => rows * CHp; // one height unit in offscreen px

  function drawScene(t) {
    const g = octx; g.clearRect(0, 0, off.width, off.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const T = reduce ? 0 : t;
    const u1 = U();
    // ruscus sprigs (behind)
    for (const sp of scene.sprigs) {
      const gr = ease((t - sp.delay) / 2.4); if (gr <= 0) continue;
      const sway = reduce ? 0 : Math.sin(T * 0.6 + sp.phase) * 0.025;
      g.strokeStyle = C.ruscus; g.lineWidth = 1.4; g.beginPath();
      for (let i = 0; i <= 16; i++) { const u = (i / 16) * gr; const [x, y] = P(...curvePoint(sp.ang, sp.len, 0.05, u, sway)); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
      for (let k = 1; k <= sp.leaves; k++) {
        const u = (k / (sp.leaves + 1)); if (u > gr) continue;
        const [x, y] = P(...curvePoint(sp.ang, sp.len, 0.05, u, sway));
        const side = k % 2 ? 1 : -1; const a = sp.ang + side * 1.1;
        const L = 0.045 * u1 * Math.min(1, (gr - u) * 4);
        g.fillStyle = C.ruscus; g.beginPath(); g.ellipse(x + Math.sin(a) * L * 0.5, y - Math.cos(a) * L * 0.5, L * 0.5, L * 0.16, Math.atan2(-Math.cos(a), Math.sin(a)), 0, Math.PI * 2); g.fill();
      }
    }
    // stems
    for (const s of scene.stems) {
      const gr = ease((t - s.delay) / 2.6); if (gr <= 0) continue;
      const sway = reduce ? 0 : Math.sin(T * 0.7 + s.ang * 5) * 0.02;
      g.strokeStyle = s.f > 0.6 ? C.stem : C.stem2; g.lineWidth = 1.6 + 1.6 * s.f; g.beginPath();
      for (let i = 0; i <= 28; i++) { const u = (i / 28) * gr; const [x, y] = P(...curvePoint(s.ang, s.len, s.bend, u, sway)); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
      // leaves: long, pointed, angled up the stem
      for (const l of s.leaves) {
        const lg = ease((t - l.delay) / 1.3); if (lg <= 0 || l.u > gr) continue;
        const [x, y] = P(...curvePoint(s.ang, s.len, s.bend, l.u, sway));
        const a = s.ang + l.side * (0.95 + Math.sin(T * 0.9 + l.u * 7) * 0.06);
        const L = l.len * u1 * lg;
        g.fillStyle = C.leaf; g.beginPath();
        g.moveTo(x, y); g.quadraticCurveTo(x + Math.sin(a) * L * 0.5 + Math.cos(a) * L * 0.18, y - Math.cos(a) * L * 0.5 + Math.sin(a) * L * 0.18, x + Math.sin(a) * L, y - Math.cos(a) * L);
        g.quadraticCurveTo(x + Math.sin(a) * L * 0.5 - Math.cos(a) * L * 0.18, y - Math.cos(a) * L * 0.5 - Math.sin(a) * L * 0.18, x, y); g.fill();
      }
      // blooms
      for (const b of s.blooms) {
        if (b.u > gr + 0.02) continue;
        const bg = ease((t - b.delay) / 1.4); if (bg <= 0) continue;
        const openness = b.open * ease((t - b.delay - 0.7) / 1.8);
        const [sx, sy] = curvePoint(s.ang, s.len, s.bend, b.u, sway);
        const bx = sx + b.side * b.reach * (0.5 + 0.5 * bg), by = sy - b.reach * 0.5 * bg;
        if (b.reach) { const [ax, ay] = P(sx, sy); const [cx, cy] = P(bx, by); g.strokeStyle = C.stem2; g.lineWidth = 1; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(ax, cy, cx, cy); g.stroke(); }
        const [x, y] = P(bx, by);
        const R = (0.014 + 0.034 * b.size) * u1 * bg;
        b.pos = [bx, by];
        // sepals / bud
        g.fillStyle = C.bud; g.beginPath(); g.ellipse(x, y + R * 0.1, R * 0.3, R * 0.46, 0, 0, Math.PI * 2); g.fill();
        if (openness > 0.05) {
          const petals = b.size >= 1 ? 7 : b.size >= 0.7 ? 6 : 5;
          const wob = reduce ? 0 : Math.sin(T * 1.1 + b.phase) * 0.05;
          for (let p = 0; p < petals; p++) {
            const a = (p / petals) * Math.PI * 2 + b.phase + wob;
            const len = R * (0.5 + 0.85 * openness), wid = R * (0.11 + 0.09 * openness);
            g.fillStyle = p % 2 ? s.color : shade(s.color, 0.85); g.beginPath();
            g.ellipse(x + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.6 * 0.8, len * 0.52, wid, a, 0, Math.PI * 2); g.fill();
          }
          // center + stamens
          g.fillStyle = C.core; g.beginPath(); g.ellipse(x, y, R * 0.2, R * 0.2 * 0.8, 0, 0, Math.PI * 2); g.fill();
          if (openness > 0.7) { g.fillStyle = C.stamen; for (let k = 0; k < 5; k++) { const a = b.phase + k * 1.26; g.beginPath(); g.ellipse(x + Math.cos(a) * R * 0.3, y + Math.sin(a) * R * 0.24, 1.3, 1.1, 0, 0, Math.PI * 2); g.fill(); } }
        } else {
          // closed bud shows a hint of its color at the tip
          g.fillStyle = s.color; g.beginPath(); g.ellipse(x, y - R * 0.35, R * 0.18, R * 0.22, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }
    // baby's breath (in front)
    for (const br of scene.breath) {
      const gr = ease((t - br.delay) / 1.6); if (gr <= 0) continue;
      const sway = reduce ? 0 : Math.sin(T * 0.8 + br.phase) * 0.02;
      const [tx, ty] = curvePoint(br.ang, br.len, 0.08, 1, sway);
      const [x, y] = P(tx, ty);
      g.strokeStyle = C.ruscus; g.lineWidth = 0.8; g.globalAlpha = 0.7; g.beginPath();
      const [x0, y0] = P(...curvePoint(br.ang, br.len, 0.08, 0.3, sway)); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke(); g.globalAlpha = 1;
      g.fillStyle = C.breath;
      for (let k = 0; k < br.n; k++) { const a = br.phase + k * 2.1; const d = 0.012 * u1 * gr; g.beginPath(); g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, 1.5, 1.2, 0, 0, Math.PI * 2); g.fill(); }
    }
  }

  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const r = ((n >> 16) & 255) * k, g = ((n >> 8) & 255) * k, b = (n & 255) * k; return `rgb(${r | 0},${g | 0},${b | 0})`; }

  // ---- paint: glow, then glyphs
  function paint() {
    const img = octx.getImageData(0, 0, off.width, off.height).data;
    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // glow: the tiny canvas, scaled up and blurred
    ctx.save(); ctx.globalAlpha = 0.32; ctx.filter = 'blur(9px)'; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, cols * CELLW, rows * LINE); ctx.restore();
    ctx.font = `700 ${FONT}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let a = 0, R = 0, G = 0, B = 0;
      for (let yy = 0; yy < CHp; yy++) for (let xx = 0; xx < CW; xx++) {
        const i = ((r * CHp + yy) * off.width + (c * CW + xx)) * 4;
        const al = img[i + 3]; if (!al) continue;
        a += al; R += img[i] * al; G += img[i + 1] * al; B += img[i + 2] * al;
      }
      if (!a) continue;
      const cov = a / (255 * CW * CHp);
      const idx = Math.min(RAMP.length - 1, Math.max(1, Math.round(Math.pow(cov, 0.85) * (RAMP.length - 1))));
      ctx.fillStyle = `rgb(${(R / a) | 0},${(G / a) | 0},${(B / a) | 0})`;
      ctx.fillText(RAMP[idx], c * CELLW, r * LINE + LINE / 2);
    }
  }

  // ---- hit areas and labels: real links over the picture
  const pct = (xh, y) => [`${(0.5 + xh / aspect) * 100}%`, `${y * 100}%`];
  function placeHits() {
    hits.innerHTML = ''; labels.innerHTML = '';
    for (const s of scene.stems) {
      const [tx, ty] = curvePoint(s.ang, s.len, s.bend, 1, 0);
      const lab = document.createElement('a'); lab.href = s.tp.url; lab.className = 'field-key';
      lab.innerHTML = `<i style="background:${s.color}"></i>${s.tp.name} <span>${s.tp.isNew ? 'new' : s.tp.count}</span>`;
      labels.appendChild(lab);
      for (const b of s.blooms) {
        const [sx, sy] = curvePoint(s.ang, s.len, s.bend, b.u, 0);
        const [x, y] = pct(sx + b.side * b.reach, sy - b.reach * 0.5);
        const a = document.createElement('a'); a.href = b.t.url; a.className = 'bloom-hit';
        a.setAttribute('aria-label', `${b.t.title} (${s.tp.name}, ${b.t.stage})`);
        a.dataset.title = b.t.title; a.dataset.topic = s.tp.name; a.dataset.stage = b.t.stage; a.dataset.near = b.t.near;
        a.style.left = x; a.style.top = y; a.style.setProperty('--c', s.color);
        const d = 22 + 30 * b.size; a.style.width = `${d}px`; a.style.height = `${d}px`;
        a.addEventListener('mouseenter', () => showHover(a)); a.addEventListener('focus', () => showHover(a));
        a.addEventListener('mouseleave', hideHover); a.addEventListener('blur', hideHover);
        hits.appendChild(a);
      }
    }
  }
  function showHover(a) {
    hover.querySelector('.k').textContent = `${a.dataset.topic} · ${a.dataset.stage}`;
    hover.querySelector('.t').textContent = a.dataset.title;
    hover.querySelector('.m').textContent = `${a.dataset.near} nearby · click to open`;
    let left = a.offsetLeft + 20, top = a.offsetTop - 16;
    if (left + 270 > root.clientWidth) left = a.offsetLeft - 280;
    hover.style.left = `${Math.max(8, left)}px`; hover.style.top = `${clamp(top, 8, root.clientHeight - 100)}px`; hover.dataset.open = 'true';
  }
  function hideHover() { hover.dataset.open = 'false'; }

  // ---- loop
  let start = performance.now(), last = 0;
  function frame(now) {
    const t = reduce ? 9 : (now - start) / 1000;
    if (now - last > 1000 / 30) { last = now; drawScene(t); paint(); }
    if (!reduce) requestAnimationFrame(frame);
  }
  function replay() { start = performance.now(); if (reduce) { drawScene(9); paint(); } }

  layout(); size();
  if (reduce) { drawScene(9); paint(); } else requestAnimationFrame(frame);
  addEventListener('resize', size);
  root.querySelector('.replay')?.addEventListener('click', replay);
  root.addEventListener('click', (e) => { if (e.target === canvas) replay(); });
})();
