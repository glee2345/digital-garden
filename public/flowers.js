// The field: an animated ASCII garden where each stem is a topic and each
// bloom is a thought. Drawn as shapes on a tiny offscreen canvas every frame,
// then painted cell by cell as characters chosen by coverage. Seeded, so the
// same garden always grows the same way.
(function () {
  const root = document.getElementById('field');
  if (!root) return;
  const data = JSON.parse(root.dataset.garden || '{"topics":[]}');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const hits = root.querySelector('.hits');
  const labels = root.querySelector('.labels');
  const hover = root.querySelector('.hovercard');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const C = { stem: '#5F6E52', leaf: '#7E8B6E', bud: '#98A58C', petal: '#8C7158', petal2: '#A08B74', core: '#2A231D', coreLight: '#E6DCC8', breath: '#B8C2A9', dust: '#C9B99E' };
  const RAMP = " .'`,:;-~=+*#";

  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- layout (in unit coordinates: x 0..1 across, y 0 top .. 1 bottom)
  let scene = null;
  function layout() {
    const rand = rng(17);
    const topics = data.topics.slice().sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, topics[0]?.count || 1);
    const n = topics.length;
    // deal big/small from the edges inward so heavy stems don't crowd one side
    const slots = []; let lo = 0, hi = n - 1;
    for (let i = 0; i < n; i++) slots.push(i % 2 ? hi-- : lo++);
    const stems = topics.map((tp, i) => {
      const f = tp.count / maxCount;
      const x = n === 1 ? 0.5 : 0.13 + (0.74 * slots[i]) / (n - 1) + (rand() - 0.5) * 0.03;
      const height = 0.30 + 0.42 * Math.sqrt(f);
      const lean = (rand() - 0.5) * 0.10;
      const curve = (rand() - 0.5) * 0.16;
      const delay = rand() * 1.2;
      const blooms = tp.thoughts.slice(0, 7).map((t, k, arr) => {
        const u = arr.length === 1 ? 1 : 0.45 + (0.55 * k) / (arr.length - 1); // position up the stem
        const side = k % 2 ? 1 : -1;
        const reach = k === arr.length - 1 ? 0 : 0.03 + rand() * 0.05;
        const size = t.stage === 'evergreen' ? 1.0 : t.stage === 'growing' ? 0.72 : 0.5;
        const open = t.stage === 'evergreen' ? 1 : t.stage === 'growing' ? 0.6 : 0.12;
        return { t, u, side, reach, size, open, phase: rand() * 6.28, delay: 3.2 + rand() * 1.6 + (1 - u) * 0.6 };
      });
      const leaves = Array.from({ length: 2 + Math.round(3 * f) }, (_, k) => ({ u: 0.15 + rand() * 0.6, side: k % 2 ? 1 : -1, len: 0.05 + rand() * 0.05, delay: 1.8 + rand() * 1.4 }));
      return { tp, x, height, lean, curve, delay, blooms, leaves, f };
    });
    // baby's-breath for thoughts with no topic yet, and a little ground dust
    const loose = (data.loose || []).map(() => ({ x: 0.08 + rand() * 0.84, y: 0.55 + rand() * 0.35, phase: rand() * 6.28, delay: 4 + rand() * 2 }));
    const dust = Array.from({ length: 60 }, () => ({ x: rand(), y: 0.90 + rand() * 0.04, delay: rand() * 2 }));
    scene = { stems, loose, dust };
  }

  // a point along a stem at height u (0 base .. 1 tip), with sway
  function stemPoint(s, u, sway) {
    const x = s.x + s.lean * u + s.curve * Math.sin(u * Math.PI) + sway * u * u;
    const y = 1 - 0.08 - s.height * u;
    return [x, y];
  }

  // ---- drawing (offscreen, in pixels; one cell = CW x CH px)
  let cols = 0, rows = 0, off = null, octx = null;
  const CW = 3, CHp = 6, FONT = 10, LINE = 12.5, CELLW = 6;
  function size() {
    const w = root.clientWidth;
    cols = Math.max(60, Math.floor(w / CELLW));
    rows = Math.max(28, Math.floor(root.clientHeight / LINE));
    canvas.width = Math.round(cols * CELLW * devicePixelRatio);
    canvas.height = Math.round(rows * LINE * devicePixelRatio);
    canvas.style.width = `${cols * CELLW}px`; canvas.style.height = `${rows * LINE}px`;
    off = document.createElement('canvas'); off.width = cols * CW; off.height = rows * CHp; octx = off.getContext('2d', { willReadFrequently: true });
    placeHits();
  }
  const px = (x, y) => [x * cols * CW, y * rows * CHp];
  const S = () => (cols * CW) / 1000; // scale for sizes given in 1000-wide units

  function drawScene(t) {
    const g = octx; g.clearRect(0, 0, off.width, off.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const swayT = reduce ? 0 : t;
    // ground dust
    for (const d of scene.dust) { if (t < d.delay) continue; const [x, y] = px(d.x, d.y); g.fillStyle = C.dust; g.globalAlpha = 0.5; g.fillRect(x, y, 2.2, 2.2); }
    g.globalAlpha = 1;
    for (const s of scene.stems) {
      const grow = ease((t - s.delay) / 2.6);
      if (grow <= 0) continue;
      const sway = reduce ? 0 : Math.sin(swayT * 0.7 + s.x * 9) * 0.012 * (1 + s.height);
      // stem
      g.strokeStyle = C.stem; g.lineWidth = 1.5 + 1.7 * s.f;
      g.beginPath();
      for (let i = 0; i <= 24; i++) { const u = (i / 24) * grow; const [x, y] = px(...stemPoint(s, u, sway)); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
      // leaves
      for (const l of s.leaves) {
        const lg = ease((t - l.delay) / 1.2); if (lg <= 0 || l.u > grow) continue;
        const [x, y] = px(...stemPoint(s, l.u, sway));
        const ang = l.side * (-0.9 + Math.sin(swayT * 0.9 + l.u * 7) * 0.08);
        g.fillStyle = C.leaf; g.beginPath();
        g.ellipse(x + Math.cos(ang) * l.len * cols * CW * lg * 0.5, y + Math.sin(ang) * l.len * rows * CHp * lg * 0.5 * 0.5, l.len * cols * CW * 0.5 * lg, 1.8 + 1.4 * lg, ang, 0, Math.PI * 2); g.fill();
      }
      // blooms
      for (const b of s.blooms) {
        if (b.u > grow + 0.02) continue;
        const bg = ease((t - b.delay) / 1.4); if (bg <= 0) continue;
        const openness = b.open * ease((t - b.delay - 0.8) / 1.8);
        const [sx, sy] = stemPoint(s, b.u, sway);
        // a short side branch to the bloom
        const bx = sx + b.side * b.reach * (0.6 + 0.4 * bg), by = sy - b.reach * 0.6 * bg;
        if (b.reach) { g.strokeStyle = C.stem; g.lineWidth = 1; g.beginPath(); const [ax, ay] = px(sx, sy); const [cx, cy] = px(bx, by); g.moveTo(ax, ay); g.quadraticCurveTo(ax, cy, cx, cy); g.stroke(); }
        const [x, y] = px(bx, by);
        const R = (7 + 15 * b.size) * bg; // radius in px of the tiny canvas
        b.pos = [bx, by];
        // bud
        g.fillStyle = C.bud; g.beginPath(); g.ellipse(x, y, R * 0.28, R * 0.42, 0, 0, Math.PI * 2); g.fill();
        // petals open outward
        if (openness > 0.05) {
          const petals = 5 + (b.size >= 1 ? 2 : 0);
          for (let p = 0; p < petals; p++) {
            const a = (p / petals) * Math.PI * 2 + b.phase + Math.sin(swayT * 1.1 + b.phase) * 0.04;
            const len = R * (0.45 + 0.75 * openness), wid = R * (0.13 + 0.10 * openness);
            g.fillStyle = p % 2 ? C.petal2 : C.petal; g.beginPath();
            g.ellipse(x + Math.cos(a) * len * 0.62, y + Math.sin(a) * len * 0.62 * 0.7, len * 0.5, wid, a, 0, Math.PI * 2); g.fill();
          }
          g.fillStyle = C.core; g.beginPath(); g.ellipse(x, y, R * 0.22, R * 0.22 * 0.75, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }
    // baby's breath: thoughts without a root yet
    for (const l of scene.loose) {
      const lg = ease((t - l.delay) / 1.5); if (lg <= 0) continue;
      const [x, y] = px(l.x + (reduce ? 0 : Math.sin(swayT * 0.8 + l.phase) * 0.004), l.y);
      g.fillStyle = C.breath; for (let k = 0; k < 4; k++) { const a = l.phase + k * 1.7; g.beginPath(); g.ellipse(x + Math.cos(a) * 2.2 * lg, y + Math.sin(a) * 1.4 * lg, 1.2, 0.9, 0, 0, Math.PI * 2); g.fill(); }
    }
  }

  // ---- paint: cells → glyphs
  function paint() {
    const img = octx.getImageData(0, 0, off.width, off.height).data;
    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `700 ${FONT}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let a = 0, R = 0, G = 0, B = 0, n = 0;
      for (let yy = 0; yy < CHp; yy++) for (let xx = 0; xx < CW; xx++) {
        const i = ((r * CHp + yy) * off.width + (c * CW + xx)) * 4;
        const al = img[i + 3]; if (!al) continue;
        a += al; R += img[i] * al; G += img[i + 1] * al; B += img[i + 2] * al; n++;
      }
      if (!a) continue;
      const cov = a / (255 * CW * CHp);
      const idx = Math.min(RAMP.length - 1, Math.max(1, Math.round(Math.pow(cov, 0.7) * (RAMP.length - 1))));
      ctx.fillStyle = `rgb(${(R / a) | 0},${(G / a) | 0},${(B / a) | 0})`;
      ctx.fillText(RAMP[idx], c * CELLW, r * LINE + LINE / 2);
    }
  }

  // ---- hit areas and labels (real links, positioned over the picture)
  function placeHits() {
    hits.innerHTML = ''; labels.innerHTML = '';
    for (const s of scene.stems) {
      const [x, y] = stemPoint(s, 0, 0);
      const lab = document.createElement('a'); lab.href = s.tp.url; lab.className = 'field-label'; lab.textContent = s.tp.isNew ? `${s.tp.name} · new` : `${s.tp.name} · ${s.tp.count}`;
      lab.style.left = `${x * 100}%`; lab.style.top = `${y * 100}%`; labels.appendChild(lab);
      for (const b of s.blooms) {
        // settle position without sway, fully grown
        const [sx, sy] = stemPoint(s, b.u, 0);
        const bx = sx + b.side * b.reach, by = sy - b.reach * 0.6;
        const a = document.createElement('a'); a.href = b.t.url; a.className = 'bloom-hit';
        a.setAttribute('aria-label', `${b.t.title} (${s.tp.name}, ${b.t.stage})`);
        a.dataset.title = b.t.title; a.dataset.topic = s.tp.name; a.dataset.stage = b.t.stage; a.dataset.near = b.t.near;
        a.style.left = `${bx * 100}%`; a.style.top = `${by * 100}%`;
        const d = 22 + 26 * b.size; a.style.width = `${d}px`; a.style.height = `${d}px`;
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
    let left = a.offsetLeft + 18, top = a.offsetTop - 14;
    if (left + 270 > root.clientWidth) left = a.offsetLeft - 276;
    hover.style.left = `${Math.max(8, left)}px`; hover.style.top = `${clamp(top, 8, root.clientHeight - 100)}px`; hover.dataset.open = 'true';
  }
  function hideHover() { hover.dataset.open = 'false'; }

  // ---- loop
  let start = performance.now(), raf = 0, last = 0;
  function frame(now) {
    const t = reduce ? 9 : (now - start) / 1000;
    if (now - last > 1000 / 30) { last = now; drawScene(t); paint(); }
    if (!(reduce && t >= 9)) raf = requestAnimationFrame(frame);
  }
  function replay() { start = performance.now(); if (reduce) { drawScene(9); paint(); } }

  layout(); size(); frame(performance.now());
  addEventListener('resize', () => { size(); });
  root.querySelector('.replay')?.addEventListener('click', replay);
  if (reduce) { drawScene(9); paint(); }
})();
