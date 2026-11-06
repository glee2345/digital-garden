// The bouquet: an animated, turnable ASCII garden on the home page where
// each stem is a topic and each flower is a thought. The scene is 3D: stems
// fan out in a cone, a simple camera projects them, and depth sets size and
// brightness. Every frame the shapes are drawn on a tiny offscreen canvas
// and painted cell by cell as characters chosen by ink coverage, with a glow
// underneath. Seeded, so the same garden always grows the same way.
(function () {
  const root = document.getElementById('field');
  if (!root) return;
  const data = JSON.parse(root.dataset.garden || '{"topics":[]}');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const hits = root.querySelector('.hits');
  const tags = root.querySelector('.tags');
  const keys = document.querySelector('.field-keys');
  const hover = root.querySelector('.hovercard');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // flower colors, one per topic
  const PETALS = ['#FF9FA3', '#FFE08A', '#FFB070', '#C9A8FF', '#8FD9FF', '#FFC2E8', '#B8F0A0', '#FFD1A8'];
  const SPECIES = ['peony', 'orchid', 'calla', 'anemone', 'ranunculus'];
  const C = { stem: '#4E7A42', stem2: '#3E6436', leaf: '#5E9050', ruscus: '#3F6B3B', bud: '#86B274', core: '#3A2616', eye: '#FFE58A', stamen: '#FFF2C4', breath: '#F6F1E6', bg: [31, 27, 23] };
  const RAMP = " .'`,:;-~=+*#";

  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  // ---- layout, in height units: y 0 top .. 1 bottom, x and z around the center
  let scene = null;
  function layout() {
    const rand = rng(23);
    const topics = data.topics.slice().sort((a, b) => b.count - a.count);
    const maxCount = Math.max(1, topics[0]?.count || 1);
    const n = topics.length;
    const stems = topics.map((tp, i) => {
      const f = tp.count / maxCount;
      // azimuth around the bunch, golden-angle spaced; tilt from vertical grows for smaller topics
      const az = i * 2.399963 + rand() * 0.3;
      const tilt = 0.22 + 0.5 * (1 - f) + rand() * 0.12;
      const len = 0.56 + 0.40 * Math.sqrt(f) + (rand() - 0.5) * 0.05;
      const dir = [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
      const bendDir = [Math.cos(az + 1.57), 0, Math.sin(az + 1.57)];
      const bend = (rand() - 0.5) * 0.12;
      const color = hex(PETALS[i % PETALS.length]);
      const species = tp.count <= 2 ? 'breath' : SPECIES[i % SPECIES.length];
      const blooms = tp.thoughts.slice(0, species === 'breath' ? 6 : 4).map((t, k, arr) => {
        const u = arr.length === 1 ? 1 : 0.6 + (0.4 * k) / (arr.length - 1);
        const a = rand() * 6.28, r = k === arr.length - 1 ? 0 : 0.035 + rand() * 0.045;
        const size = t.stage === 'evergreen' ? 1 : t.stage === 'growing' ? 0.74 : 0.5;
        const open = t.stage === 'evergreen' ? 1 : t.stage === 'growing' ? 0.62 : 0.08;
        return { t, u, off: [Math.cos(a) * r, -r * 0.5, Math.sin(a) * r], size, open, phase: rand() * 6.28, delay: 3.0 + rand() * 1.6 + (1 - u) * 0.8 };
      });
      const leaves = Array.from({ length: 2 + Math.round(2 * f) }, () => ({ u: 0.28 + rand() * 0.45, a: rand() * 6.28, len: 0.08 + rand() * 0.05, delay: 1.6 + rand() * 1.4 }));
      return { tp, i, dir, bendDir, bend, len, delay: rand() * 1.2, blooms, leaves, f, color, species };
    });
    const nS = Math.max(5, n + 4);
    const sprigs = Array.from({ length: nS }, (_, i) => {
      const az = i * 2.399963 + 1.2, tilt = 0.5 + rand() * 0.35;
      return { dir: [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)], len: 0.42 + rand() * 0.24, delay: 0.4 + rand() * 1.4, leaves: 5 + Math.floor(rand() * 4), phase: rand() * 6.28, az };
    });
    const mk = (nn) => { const az = rand() * 6.28, tilt = 0.25 + rand() * 0.5; return { dir: [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)], len: 0.5 + rand() * 0.42, delay: 3.6 + rand() * 2, phase: rand() * 6.28, n: nn }; };
    const breath = (data.loose || []).map(() => mk(4)).concat(Array.from({ length: 4 + n }, () => mk(3)));
    scene = { stems, sprigs, breath, base: [0, 1.14, 0] };
  }

  // point along a stem at u, with sway; returns [x, y, z]
  function stemPoint(s, u, sway) {
    const b = (s.bend + sway) * Math.sin(u * Math.PI) * s.len;
    return [scene.base[0] + s.dir[0] * s.len * u + s.bendDir[0] * b, scene.base[1] + s.dir[1] * s.len * u, scene.base[2] + s.dir[2] * s.len * u + s.bendDir[2] * b];
  }

  // ---- camera
  let yaw = 0.4, pitch = 0.18, yawV = 0, dragging = false, lastX = 0, lastY = 0, idleSince = 0;
  const CAM = 2.6; // distance in height units
  let cols = 0, rows = 0, off = null, octx = null, aspect = 1.7;
  const CW = 3, CHp = 6, FONT = 8.5, LINE = 10.5, CELLW = 5.1;
  function size() {
    cols = Math.max(60, Math.floor(root.clientWidth / CELLW));
    rows = Math.max(28, Math.floor(root.clientHeight / LINE));
    aspect = (cols * CELLW) / (rows * LINE);
    canvas.width = Math.round(cols * CELLW * devicePixelRatio);
    canvas.height = Math.round(rows * LINE * devicePixelRatio);
    canvas.style.width = `${cols * CELLW}px`; canvas.style.height = `${rows * LINE}px`;
    off = document.createElement('canvas'); off.width = cols * CW; off.height = rows * CHp; octx = off.getContext('2d', { willReadFrequently: true });
    buildHits();
  }
  const U = () => rows * CHp;
  // world → [px, py, depthScale]; rotation about the bunch's center
  function project(p) {
    const cy = 0.62;
    let x = p[0], y = p[1] - cy, z = p[2];
    const c1 = Math.cos(yaw), s1 = Math.sin(yaw);
    let x1 = x * c1 - z * s1, z1 = x * s1 + z * c1;
    const c2 = Math.cos(pitch), s2 = Math.sin(pitch);
    let y2 = y * c2 - z1 * s2, z2 = y * s2 + z1 * c2;
    const sc = CAM / (CAM + z2);
    return [(0.5 + (x1 * sc) / aspect) * cols * CW, (cy + y2 * sc) * rows * CHp, sc, z2];
  }
  // depth → how much a color fades toward the background
  const fade = (z) => clamp(1.0 - z * 1.3, 0.28, 1);
  const shadeAt = (col, z) => rgb(mix(C.bg, col, fade(z)));

  // ---- flower species. Each draws at (x,y) with radius R, openness 0..1
  function drawFlower(g, kind, x, y, R, open, col, phase, wob, z, sc) {
    const k = fade(z);
    const petal = rgb(mix(C.bg, col, k)), petal2 = rgb(mix(C.bg, mix(col, [255, 255, 255], 0.25), k));
    const core = rgb(mix(C.bg, hex(C.core), k)), eye = rgb(mix(C.bg, hex(C.eye), k));
    // sepals
    g.fillStyle = shadeAt(hex(C.bud), z); g.beginPath(); g.ellipse(x, y + R * 0.1, R * 0.28, R * 0.42, 0, 0, Math.PI * 2); g.fill();
    if (open < 0.05) { g.fillStyle = petal; g.beginPath(); g.ellipse(x, y - R * 0.3, R * 0.18, R * 0.24, 0, 0, Math.PI * 2); g.fill(); return; }
    const E = (cx, cy, rx, ry, a, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(cx, cy, Math.max(0.6, rx), Math.max(0.6, ry), a, 0, Math.PI * 2); g.fill(); };
    const lip = rgb(mix(C.bg, mix(col, [120, 40, 60], 0.45), k));
    const pale = rgb(mix(C.bg, mix(col, [255, 250, 240], 0.55), k));
    if (kind === 'peony') {
      // layered round petals, outer ring largest, inner ring paler
      const rings = [[9, 1.0, petal], [7, 0.7, petal2], [5, 0.42, pale]];
      rings.forEach(([N, f, c], ri) => { for (let p = 0; p < N; p++) { const a = (p / N) * 6.283 + phase + wob + ri * 0.4; const L = R * f * (0.45 + 0.75 * open); E(x + Math.cos(a) * L * 0.58, y + Math.sin(a) * L * 0.58 * 0.8, L * 0.44, L * 0.22, a, c); } });
      E(x, y, R * 0.12 * open, R * 0.1 * open, 0, eye);
    } else if (kind === 'orchid') {
      // three narrow sepals, two broad petals, a darker lip
      const L = R * (0.5 + 0.8 * open);
      for (const a of [-1.571, 0.524, 2.618]) { const aa = a + phase * 0.2 + wob; E(x + Math.cos(aa) * L * 0.55, y + Math.sin(aa) * L * 0.55 * 0.85, L * 0.5, R * 0.16, aa, petal2); }
      for (const a of [-0.35, 3.49]) { const aa = a + phase * 0.2 + wob; E(x + Math.cos(aa) * L * 0.42, y + Math.sin(aa) * L * 0.42 * 0.85, L * 0.42, R * 0.3, aa, petal); }
      E(x, y + L * 0.3, R * 0.3, L * 0.32, 0, lip); E(x, y + L * 0.12, R * 0.12, R * 0.1, 0, eye);
    } else if (kind === 'calla') {
      // one furled spathe with a flared lip and a spadix
      const L = R * 1.3, sp = 0.5 + 0.5 * open;
      E(x, y - L * 0.35, R * 0.42 * sp, L * 0.55, 0.18, petal); E(x - R * 0.15, y - L * 0.5, R * 0.36 * sp, L * 0.38, -0.5, petal2);
      E(x + R * 0.18 * sp, y - L * 0.72, R * 0.3 * sp, R * 0.14, 0.3, pale);
      if (open > 0.5) E(x + R * 0.05, y - L * 0.55, R * 0.07, L * 0.3, 0.1, eye);
    } else if (kind === 'anemone') {
      const N = 6; for (let p = 0; p < N; p++) { const a = (p / N) * 6.283 + phase + wob; const L = R * (0.5 + 0.8 * open); E(x + Math.cos(a) * L * 0.6, y + Math.sin(a) * L * 0.6 * 0.8, L * 0.5, L * 0.32, a, p % 2 ? petal : petal2); }
      E(x, y, R * 0.3, R * 0.26, 0, core); if (open > 0.6) for (let q = 0; q < 8; q++) { const a = phase + q * 0.785; E(x + Math.cos(a) * R * 0.34, y + Math.sin(a) * R * 0.28, 1.1, 1.0, 0, rgb(mix(C.bg, [60, 40, 50], k))); }
    } else if (kind === 'ranunculus') {
      // tight spiral of many small petals
      const N = 10 + Math.round(14 * open); for (let p = N; p >= 0; p--) { const a = p * 2.399963 + phase + wob; const rr = R * (0.1 + 0.75 * open) * Math.sqrt(p / N); E(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, R * 0.22, R * 0.16, a, p % 2 ? petal : (p % 3 ? petal2 : pale)); }
    } else { // breath: a spray of tiny blossoms in the topic's tint
      const N = 5 + Math.round(6 * open); for (let p = 0; p < N; p++) { const a = p * 2.399963 + phase; const rr = R * (0.3 + 0.9 * open) * Math.sqrt((p + 1) / N); E(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, R * 0.12, R * 0.1, 0, p % 2 ? pale : petal2); }
    }
  }

  // ---- draw one frame
  const items = []; // for depth sorting
  function drawScene(t) {
    const g = octx; g.clearRect(0, 0, off.width, off.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const T = reduce ? 0 : t, u1 = U();
    items.length = 0;
    for (const sp of scene.sprigs) {
      const gr = ease((t - sp.delay) / 2.4); if (gr <= 0) continue;
      const sway = reduce ? 0 : Math.sin(T * 0.6 + sp.phase) * 0.02;
      const pts = []; for (let i = 0; i <= 14; i++) { const u = (i / 14) * gr; pts.push(project([scene.base[0] + sp.dir[0] * sp.len * u + sway * u, scene.base[1] + sp.dir[1] * sp.len * u, scene.base[2] + sp.dir[2] * sp.len * u])); }
      items.push({ z: pts[Math.floor(pts.length / 2)][3], draw() {
        g.strokeStyle = shadeAt(hex(C.ruscus), pts[7][3]); g.lineWidth = 1.2 * pts[7][2]; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
        for (let k = 1; k <= sp.leaves; k++) { const u = k / (sp.leaves + 1); if (u > gr) continue; const p = pts[Math.round(u * 14)]; const side = k % 2 ? 1 : -1; const a = -1.2 + side * 1.0 + (sp.az % 1) * 0.3; const L = 0.045 * u1 * p[2] * Math.min(1, (gr - u) * 4);
          g.fillStyle = shadeAt(hex(C.ruscus), p[3]); g.beginPath(); g.ellipse(p[0] + Math.cos(a) * L * 0.5, p[1] + Math.sin(a) * L * 0.5, L * 0.5, L * 0.15, a, 0, 6.283); g.fill(); }
      } });
    }
    for (const s of scene.stems) {
      const gr = ease((t - s.delay) / 2.6); if (gr <= 0) continue;
      const sway = reduce ? 0 : Math.sin(T * 0.7 + s.i) * 0.02;
      const pts = []; for (let i = 0; i <= 24; i++) pts.push(project(stemPoint(s, (i / 24) * gr, sway)));
      const mid = pts[12];
      items.push({ z: mid[3] + 0.02, draw() {
        g.strokeStyle = shadeAt(hex(s.f > 0.6 ? C.stem : C.stem2), mid[3]); g.lineWidth = (1.5 + 1.6 * s.f) * mid[2]; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
        for (const l of s.leaves) { const lg = ease((t - l.delay) / 1.3); if (lg <= 0 || l.u > gr) continue; const p = pts[Math.round(l.u * 24)]; const a = l.a + (reduce ? 0 : Math.sin(T * 0.9 + l.u * 7) * 0.06); const L = l.len * u1 * lg * p[2];
          g.fillStyle = shadeAt(hex(C.leaf), p[3]); g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[0] + Math.cos(a) * L * 0.5 - Math.sin(a) * L * 0.18, p[1] + Math.sin(a) * L * 0.5 * 0.7 + Math.cos(a) * L * 0.12, p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L * 0.7); g.quadraticCurveTo(p[0] + Math.cos(a) * L * 0.5 + Math.sin(a) * L * 0.18, p[1] + Math.sin(a) * L * 0.5 * 0.7 - Math.cos(a) * L * 0.12, p[0], p[1]); g.fill(); }
      } });
      for (const b of s.blooms) {
        if (b.u > gr + 0.02) continue;
        const bg = ease((t - b.delay) / 1.4); if (bg <= 0) continue;
        const open = b.open * ease((t - b.delay - 0.7) / 1.8);
        const sp = stemPoint(s, b.u, sway);
        const wp = [sp[0] + b.off[0] * bg, sp[1] + b.off[1] * bg, sp[2] + b.off[2] * bg];
        const p0 = project(sp), p = project(wp); b.screen = p;
        const R = (0.03 + 0.062 * b.size) * u1 * bg * p[2];
        items.push({ z: p[3], draw() {
          if (b.off[0] || b.off[2]) { g.strokeStyle = shadeAt(hex(C.stem2), p[3]); g.lineWidth = 1 * p[2]; g.beginPath(); g.moveTo(p0[0], p0[1]); g.quadraticCurveTo(p0[0], p[1], p[0], p[1]); g.stroke(); }
          drawFlower(g, s.species, p[0], p[1], R, open, s.color, b.phase, reduce ? 0 : Math.sin(T * 1.1 + b.phase) * 0.05, p[3], p[2]);
        } });
      }
      s.tip = project(stemPoint(s, 1, sway));
    }
    for (const br of scene.breath) {
      const gr = ease((t - br.delay) / 1.6); if (gr <= 0) continue;
      const sway = reduce ? 0 : Math.sin(T * 0.8 + br.phase) * 0.015;
      const P = (u) => project([scene.base[0] + br.dir[0] * br.len * u + sway * u, scene.base[1] + br.dir[1] * br.len * u, scene.base[2] + br.dir[2] * br.len * u]);
      const a0 = P(0.35), a1 = P(1);
      items.push({ z: a1[3], draw() {
        g.strokeStyle = shadeAt(hex(C.ruscus), a1[3]); g.lineWidth = 0.8 * a1[2]; g.beginPath(); g.moveTo(a0[0], a0[1]); g.lineTo(a1[0], a1[1]); g.stroke();
        g.fillStyle = shadeAt(hex(C.breath), a1[3]); for (let k = 0; k < br.n; k++) { const a = br.phase + k * 2.1, d = 0.012 * u1 * gr * a1[2]; g.beginPath(); g.ellipse(a1[0] + Math.cos(a) * d, a1[1] + Math.sin(a) * d * 0.7, 1.4 * a1[2], 1.1 * a1[2], 0, 0, 6.283); g.fill(); }
      } });
    }
    items.sort((a, b) => b.z - a.z); // far first
    for (const it of items) it.draw();
  }

  // ---- paint: glow, then glyphs
  function paint() {
    const img = octx.getImageData(0, 0, off.width, off.height).data;
    const dpr = devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.globalAlpha = 0.4; ctx.filter = 'blur(9px)'; ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, cols * CELLW, rows * LINE); ctx.restore();
    ctx.font = `700 ${FONT}px "IBM Plex Mono", ui-monospace, Menlo, monospace`; ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let a = 0, R = 0, G = 0, B = 0;
      for (let yy = 0; yy < CHp; yy++) for (let xx = 0; xx < CW; xx++) { const i = ((r * CHp + yy) * off.width + (c * CW + xx)) * 4; const al = img[i + 3]; if (!al) continue; a += al; R += img[i] * al; G += img[i + 1] * al; B += img[i + 2] * al; }
      if (!a) continue;
      const cov = a / (255 * CW * CHp);
      const idx = Math.min(RAMP.length - 1, Math.max(1, Math.round(Math.pow(cov, 0.9) * (RAMP.length - 1))));
      ctx.fillStyle = `rgb(${(R / a) | 0},${(G / a) | 0},${(B / a) | 0})`;
      ctx.fillText(RAMP[idx], c * CELLW, r * LINE + LINE / 2);
    }
  }

  // ---- links over the picture (moved every frame) and the key underneath
  const hitEls = new Map();
  function buildHits() {
    hits.innerHTML = ''; tags.innerHTML = ''; if (keys) keys.innerHTML = ''; hitEls.clear();
    for (const s of scene.stems) {
      const col = rgb(s.color);
      if (keys) { const k = document.createElement('a'); k.href = s.tp.url; k.innerHTML = `<i style="background:${col}"></i>${s.tp.name} <span>${s.tp.isNew ? 'new' : s.tp.count}</span>`; keys.appendChild(k); }
      const tag = document.createElement('a'); tag.href = s.tp.url; tag.className = 'field-tag'; tag.style.color = col; tag.textContent = s.tp.name; tags.appendChild(tag); s.tagEl = tag;
      for (const b of s.blooms) {
        const a = document.createElement('a'); a.href = b.t.url; a.className = 'bloom-hit';
        a.setAttribute('aria-label', `${b.t.title} (${s.tp.name}, ${b.t.stage})`);
        a.dataset.title = b.t.title; a.dataset.topic = s.tp.name; a.dataset.stage = b.t.stage; a.dataset.near = b.t.near; a.style.setProperty('--c', col);
        a.addEventListener('mouseenter', () => showHover(a)); a.addEventListener('focus', () => showHover(a));
        a.addEventListener('mouseleave', hideHover); a.addEventListener('blur', hideHover);
        hits.appendChild(a); hitEls.set(b, a);
      }
    }
  }
  function placeHits() {
    const kx = CELLW / CW, ky = LINE / CHp;
    for (const s of scene.stems) {
      if (s.tip && s.tagEl) { const [x, y, sc, z] = s.tip; s.tagEl.style.left = `${x * kx}px`; s.tagEl.style.top = `${y * ky - 22 * sc}px`; s.tagEl.style.opacity = String(0.35 + 0.65 * fade(z)); s.tagEl.style.fontSize = `${12 + 5 * sc}px`; }
      for (const b of s.blooms) { const a = hitEls.get(b); if (!a || !b.screen) { if (a) a.style.display = 'none'; continue; } const [x, y, sc] = b.screen; const d = (22 + 30 * b.size) * sc; a.style.display = ''; a.style.left = `${x * kx}px`; a.style.top = `${y * ky}px`; a.style.width = `${d}px`; a.style.height = `${d}px`; }
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

  // ---- turning it: drag / swipe, with a slow drift when idle
  root.addEventListener('pointerdown', (e) => { if (e.target.closest('a, button')) return; dragging = true; lastX = e.clientX; lastY = e.clientY; yawV = 0; root.setPointerCapture(e.pointerId); });
  root.addEventListener('pointermove', (e) => { if (!dragging) return; const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; yaw += dx * 0.008; yawV = dx * 0.008; pitch = clamp(pitch + dy * 0.004, -0.2, 0.6); idleSince = performance.now(); });
  const stop = () => { dragging = false; };
  root.addEventListener('pointerup', stop); root.addEventListener('pointercancel', stop);
  root.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { yaw -= 0.15; idleSince = performance.now(); } if (e.key === 'ArrowRight') { yaw += 0.15; idleSince = performance.now(); } });

  // ---- loop
  let start = performance.now(), last = 0;
  function frame(now) {
    const t = reduce ? 9 : (now - start) / 1000;
    if (!dragging) { yaw += yawV; yawV *= 0.92; if (!reduce && now - idleSince > 2500 && hover.dataset.open !== 'true') yaw += 0.0025; }
    if (now - last > 1000 / 30) { last = now; drawScene(t); paint(); placeHits(); }
    requestAnimationFrame(frame);
  }
  function replay() { start = performance.now(); }

  layout(); size(); idleSince = performance.now();
  requestAnimationFrame(frame);
  addEventListener('resize', size);
  root.querySelector('.replay')?.addEventListener('click', replay);
})();
