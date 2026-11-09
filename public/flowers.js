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
  const keys = null;
  const hover = root.querySelector('.hovercard');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // flower colors, one per topic
  // dusty rose, mauve, plum and sage: muted on purpose
  const PETALS = ['#E3A4B4', '#CF8C9F', '#C197B8', '#E8B7A6', '#D9A3C4', '#B99BC9', '#E6C5BC', '#C8A0A8'];
  const SPECIES = ['peony', 'calla', 'orchid', 'peony', 'calla', 'ranunculus'];
  const PLUM = [74, 28, 44], CREAM = [243, 233, 220];
  const C = { stem: '#5C7A66', stem2: '#4A6454', leaf: '#6B8C76', ruscus: '#4E6B5A', bud: '#7F9C88', core: '#3A2616', eye: '#E9D9A8', stamen: '#F3E6C4', breath: '#E8DDD0', bg: [31, 27, 23] };
  const RAMP = " .'`,:;-~=+*#%@";

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
      const small = tp.count <= 2 && i >= 3; // the three biggest topics always get flowers
      // azimuth around the bunch, golden-angle spaced; big topics stand tall and nearly upright
      const az = i * 2.399963 + rand() * 0.3;
      const tilt = small ? 0.55 + rand() * 0.25 : 0.16 + 0.42 * (1 - f) + rand() * 0.12;
      const len = small ? 0.30 + rand() * 0.10 : 0.62 + 0.42 * Math.sqrt(f) + (rand() - 0.5) * 0.06;
      const dir = [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
      const bendDir = [Math.cos(az + 1.57), 0, Math.sin(az + 1.57)];
      const bend = (rand() - 0.5) * 0.10;
      const color = hex(tp.color || PETALS[i % PETALS.length]);
      const species = small ? 'amaranth' : SPECIES[i % SPECIES.length];
      const blooms = tp.thoughts.slice(0, species === 'amaranth' ? 4 : 3).map((t, k, arr) => {
        // the first (most connected) thought is the head of the stem; the rest are smaller side buds lower down
        const head = k === 0;
        const u = species === 'amaranth' ? 0.45 + (0.5 * k) / Math.max(1, arr.length - 1) : head ? 1 : 0.62 + 0.2 * rand();
        const a = rand() * 6.28, r = head || species === 'amaranth' ? 0 : 0.07 + rand() * 0.05;
        const size = (t.stage === 'evergreen' ? 1 : t.stage === 'growing' ? 0.74 : 0.5) * (head ? 1 : 0.62);
        const open = t.stage === 'evergreen' ? 1 : t.stage === 'growing' ? 0.62 : 0.08;
        return { t, u, off: [Math.cos(a) * r, -r * 0.5, Math.sin(a) * r], size, open, phase: rand() * 6.28, delay: 3.0 + rand() * 1.6 + (1 - u) * 0.8 };
      });
      const leaves = small ? [] : Array.from({ length: 1 + Math.round(f) }, () => ({ u: 0.30 + rand() * 0.35, a: rand() * 6.28, len: 0.08 + rand() * 0.05, delay: 1.6 + rand() * 1.4 }));
      // amaranth drapes fall from the binding point, outward then down
      // each small topic hangs from its own spot on the front-left of the bunch
      const dk = i - 3, drape = small ? { az: 0.1 - dk * 0.45 + (rand() - 0.5) * 0.2, start: 0.2 + dk * 0.09, sag: dk * 0.08, out: 0.04 + rand() * 0.03, drop: 0.62 + rand() * 0.1, swing: rand() * 6.28, strands: [0.02, -(0.03 + rand() * 0.015)] } : null;
      return { tp, i, dir, bendDir, bend, len, delay: rand() * 1.2, blooms, leaves, f, color, species, drape };
    });
    const nS = Math.max(2, Math.round(n / 2));
    const sprigs = Array.from({ length: nS }, (_, i) => {
      const az = i * 2.399963 + 1.2, tilt = 0.35 + rand() * 0.25;
      return { dir: [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)], len: 0.5 + rand() * 0.2, delay: 0.4 + rand() * 1.4, leaves: 4 + Math.floor(rand() * 3), phase: rand() * 6.28, az };
    });
    // one or two curling tendrils, the tallest things in the bunch
    const tendrils = Array.from({ length: n >= 4 ? 2 : 1 }, (_, i) => {
      const az = 0.9 + i * 2.9 + rand() * 0.4, tilt = 0.14 + rand() * 0.1;
      return { dir: [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)], len: 0.88 + rand() * 0.08, delay: 1.0 + rand(), phase: rand() * 6.28, turn: i % 2 ? -1 : 1 };
    });
    const mk = (nn) => { const az = rand() * 6.28, tilt = 0.2 + rand() * 0.35; return { dir: [Math.sin(tilt) * Math.cos(az), -Math.cos(tilt), Math.sin(tilt) * Math.sin(az)], len: 0.55 + rand() * 0.3, delay: 3.6 + rand() * 2, phase: rand() * 6.28, n: nn }; };
    const filler = Math.min(10, Math.round(Math.sqrt(data.extra || 0))); // a little breath only once the garden is big
    const breath = (data.loose || []).slice(0, 6).map(() => mk(3)).concat(Array.from({ length: filler }, () => mk(2)));
    scene = { stems, sprigs, tendrils, breath, base: [0, 1.14, 0], bind: [0, 0.58, -0.18] };
  }

  // point along a stem at u, with sway; returns [x, y, z]
  function stemPoint(s, u, sway) {
    if (s.drape) { // out over the edge, then straight down, swinging a little
      const d = s.drape, o = d.start + d.out * Math.sin(Math.min(1, u * 2.2) * 1.5708), f = Math.max(0, u - 0.06) / 0.94, fall = d.drop * Math.pow(f, 1.05);
      const sw = sway * 1.6 * u;
      return [scene.bind[0] + Math.cos(d.az) * (o + sw), scene.bind[1] + d.sag + fall + u * 0.03, scene.bind[2] + Math.sin(d.az) * (o + sw)];
    }
    const b = (s.bend + sway) * Math.sin(u * Math.PI) * s.len;
    return [scene.base[0] + s.dir[0] * s.len * u + s.bendDir[0] * b, scene.base[1] + s.dir[1] * s.len * u, scene.base[2] + s.dir[2] * s.len * u + s.bendDir[2] * b];
  }

  // ---- camera
  let yaw = 0.4, pitch = 0.18, yawV = 0, dragging = false, lastX = 0, lastY = 0, idleSince = 0;
  const CAM = 2.6; // distance in height units
  let cols = 0, rows = 0, off = null, octx = null, aspect = 1.7;
  const CW = 3, CHp = 6, FONT = 6.8, LINE = 8.2, CELLW = 4.0;
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
    if (kind !== 'amaranth') { g.fillStyle = shadeAt(hex(C.bud), z); g.beginPath(); g.ellipse(x, y + R * 0.1, R * 0.28, R * 0.42, 0, 0, Math.PI * 2); g.fill(); }
    if (open < 0.05) { g.fillStyle = petal; g.beginPath(); g.ellipse(x, y - R * 0.3, R * 0.18, R * 0.24, 0, 0, Math.PI * 2); g.fill(); return; }
    // petals are drawn a little translucent with a clear seam between them, so the
    // glyphs vary across a bloom instead of filling it solid
    let ringAlpha = 0.95;
    const seam = rgb(mix(C.bg, mix(col, PLUM, 0.85), k)); // dark petal edges, so each petal reads as a shape
    const E = (cx, cy, rx, ry, a, c) => { g.globalAlpha = ringAlpha; g.fillStyle = c; g.beginPath(); g.ellipse(cx, cy, Math.max(0.6, rx), Math.max(0.6, ry), a, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      if (rx > 2.5) { g.strokeStyle = seam; g.lineWidth = 1.3; g.stroke(); } };
    const lip = rgb(mix(C.bg, mix(col, [120, 40, 60], 0.45), k));
    const pale = rgb(mix(C.bg, mix(col, [255, 250, 240], 0.55), k));
    const plum = rgb(mix(C.bg, mix(col, PLUM, 0.72), k)), edge = rgb(mix(C.bg, mix(col, CREAM, 0.5), k));
    if (kind === 'peony') {
      // many ruffled layers; outer petals deep, inner ones paler with cream edges
      const rings = [[11, 1.0, rgb(mix(C.bg, mix(col, PLUM, 0.3), k))], [9, 0.8, petal], [7, 0.58, rgb(mix(C.bg, mix(col, CREAM, 0.35), k))], [5, 0.36, rgb(mix(C.bg, mix(col, CREAM, 0.6), k))]];
      rings.forEach(([N, f, c], ri) => { ringAlpha = [1, 0.96, 0.9, 0.84][ri]; for (let p = 0; p < N; p++) { const a = (p / N) * 6.283 + phase + wob + ri * 0.5; const L = R * f * (0.45 + 0.75 * open) * (0.92 + 0.16 * Math.sin(p * 2.3 + ri)); E(x + Math.cos(a) * L * 0.56, y + Math.sin(a) * L * 0.56 * 0.8, L * 0.46, L * 0.2, a + 0.3, c); } });
      ringAlpha = 0.95; if (open > 0.5) for (let p = 0; p < 6; p++) { const a = phase + p * 1.047; E(x + Math.cos(a) * R * 0.22, y + Math.sin(a) * R * 0.18, R * 0.07, R * 0.05, a, edge); }
    } else if (kind === 'orchid') {
      // three narrow sepals, two broad petals, a plum lip
      const L = R * (0.5 + 0.8 * open);
      for (const a of [-1.571, 0.524, 2.618]) { const aa = a + phase * 0.2 + wob; E(x + Math.cos(aa) * L * 0.55, y + Math.sin(aa) * L * 0.55 * 0.85, L * 0.5, R * 0.16, aa, petal2); }
      for (const a of [-0.35, 3.49]) { const aa = a + phase * 0.2 + wob; E(x + Math.cos(aa) * L * 0.42, y + Math.sin(aa) * L * 0.42 * 0.85, L * 0.42, R * 0.3, aa, petal); }
      E(x, y + L * 0.3, R * 0.3, L * 0.32, 0, plum); E(x, y + L * 0.12, R * 0.12, R * 0.1, 0, eye);
    } else if (kind === 'calla') {
      // a dark, sleek spathe: long furled cone, flared lip curling back, pale spadix
      const L = R * 1.45, sp = 0.5 + 0.5 * open, lean = 0.35 + wob;
      E(x, y - L * 0.3, R * 0.34 * sp, L * 0.5, lean * 0.5, plum);
      E(x - R * 0.12, y - L * 0.5, R * 0.3 * sp, L * 0.36, lean - 0.6, rgb(mix(C.bg, mix(col, PLUM, 0.55), k)));
      E(x + R * 0.2 * sp, y - L * 0.74, R * 0.34 * sp, R * 0.12, lean + 0.2, petal);
      E(x + R * 0.28 * sp, y - L * 0.8, R * 0.14 * sp, R * 0.06, lean + 0.4, edge);
      if (open > 0.5) E(x + R * 0.04, y - L * 0.56, R * 0.06, L * 0.28, lean * 0.4, eye);
    } else if (kind === 'anemone') {
      const N = 6; for (let p = 0; p < N; p++) { const a = (p / N) * 6.283 + phase + wob; const L = R * (0.5 + 0.8 * open); E(x + Math.cos(a) * L * 0.6, y + Math.sin(a) * L * 0.6 * 0.8, L * 0.5, L * 0.32, a, p % 2 ? petal : petal2); }
      E(x, y, R * 0.3, R * 0.26, 0, core);
    } else if (kind === 'ranunculus') {
      // tight spiral of many small petals
      const N = 10 + Math.round(14 * open); for (let p = N; p >= 0; p--) { ringAlpha = 0.85 + 0.15 * (p / N); const a = p * 2.399963 + phase + wob; const rr = R * (0.1 + 0.75 * open) * Math.sqrt(p / N); E(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, R * 0.22, R * 0.16, a, p % 2 ? petal : (p % 3 ? petal2 : pale)); }
    } else if (kind === 'amaranth') {
      // a knot of beads where the thought sits on the drape
      const N = 6 + Math.round(8 * open); for (let p = 0; p < N; p++) { const a = p * 2.399963 + phase; const rr = R * (0.25 + 0.5 * open) * Math.sqrt((p + 1) / N); E(x + Math.cos(a) * rr * 0.8, y + Math.sin(a) * rr, R * 0.13, R * 0.11, 0, p % 3 ? petal : plum); }
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
      const sway = reduce ? 0 : (Math.sin(T * 0.6 + sp.phase) * 0.024 + Math.sin(T * 1.7 + sp.phase) * 0.006);
      const pts = []; for (let i = 0; i <= 14; i++) { const u = (i / 14) * gr; pts.push(project([scene.base[0] + sp.dir[0] * sp.len * u + sway * u, scene.base[1] + sp.dir[1] * sp.len * u, scene.base[2] + sp.dir[2] * sp.len * u])); }
      items.push({ z: pts[Math.floor(pts.length / 2)][3], draw() {
        g.strokeStyle = shadeAt(hex(C.ruscus), pts[7][3]); g.lineWidth = 1.2 * pts[7][2]; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
        for (let k = 1; k <= sp.leaves; k++) { const u = k / (sp.leaves + 1); if (u > gr) continue; const p = pts[Math.round(u * 14)]; const side = k % 2 ? 1 : -1; const a = -1.2 + side * 1.0 + (sp.az % 1) * 0.3; const L = 0.045 * u1 * p[2] * Math.min(1, (gr - u) * 4);
          g.fillStyle = shadeAt(hex(C.ruscus), p[3]); g.beginPath(); g.ellipse(p[0] + Math.cos(a) * L * 0.5, p[1] + Math.sin(a) * L * 0.5, L * 0.5, L * 0.15, a, 0, 6.283); g.fill(); }
      } });
    }
    for (const td of scene.tendrils) {
      const gr = ease((t - td.delay) / 3.0); if (gr <= 0) continue;
      const sway = reduce ? 0 : Math.sin(T * 0.5 + td.phase) * 0.03;
      const pts = []; for (let i = 0; i <= 20; i++) { const u = (i / 20) * gr; pts.push(project([scene.base[0] + td.dir[0] * td.len * u + sway * u * u, scene.base[1] + td.dir[1] * td.len * u, scene.base[2] + td.dir[2] * td.len * u])); }
      const tip = pts[pts.length - 1];
      items.push({ z: tip[3], draw() {
        g.strokeStyle = shadeAt(hex(C.stem), tip[3]); g.lineWidth = 0.9 * tip[2]; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
        if (gr > 0.85) { // the curl: a spiral winding in at the tip
          const k = (gr - 0.85) / 0.15, r0 = 0.05 * u1 * tip[2], cx = tip[0] + td.turn * r0, cy = tip[1] - r0 * 0.2;
          g.lineWidth = 1.5 * tip[2]; g.beginPath(); g.moveTo(tip[0], tip[1]);
          for (let i = 1; i <= 48; i++) { const a = Math.PI + td.turn * (i / 48) * k * 2.4 * 6.283 * 0.5, r = r0 * (1 - 0.75 * (i / 48)); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9); }
          g.stroke();
        }
      } });
    }
    for (const s of scene.stems) {
      const gr = ease((t - s.delay) / 2.6); if (gr <= 0) continue;
      const sway = reduce ? 0 : (Math.sin(T * 0.7 + s.i) * 0.022 + Math.sin(T * 1.9 + s.i * 2.1) * 0.006);
      const pts = []; for (let i = 0; i <= 24; i++) pts.push(project(stemPoint(s, (i / 24) * gr, sway)));
      const mid = pts[12];
      items.push({ z: mid[3] + 0.02, draw() {
        if (s.drape) { // amaranth: tapering ropes of tiny beads, deep rose into plum, three strands side by side
          const bead = mix(s.color, PLUM, 0.3), dark = mix(s.color, PLUM, 0.6);
          for (const dx of s.drape.strands) {
            for (let i = 1; i < pts.length; i++) {
              const p = pts[i], prog = i / pts.length, w = (4.2 - 2.2 * prog) * p[2], ox = dx * u1 * p[2];
              g.fillStyle = rgb(mix(C.bg, i % 3 === 0 ? dark : bead, fade(p[3])));
              g.beginPath(); g.ellipse(p[0] + ox, p[1], w, w * 1.35, 0, 0, 6.283); g.fill();
              g.beginPath(); g.ellipse(p[0] + ox + w * 1.3 * (i % 2 ? 1 : -1), p[1] + w * 0.7, w * 0.75, w, 0, 0, 6.283); g.fill();
            }
          }
          return;
        }
        g.strokeStyle = shadeAt(hex(s.f > 0.6 ? C.stem : C.stem2), mid[3]); g.lineWidth = (1.3 + 1.4 * s.f) * mid[2]; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
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
        const R = (0.036 + 0.085 * b.size) * u1 * bg * p[2];
        items.push({ z: p[3], draw() {
          if (open > 0.05) { g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.beginPath(); g.ellipse(p[0], p[1], R * 1.12, R * 1.0, 0, 0, 6.283); g.fill(); g.restore(); }
          if (b.off[0] || b.off[2]) { g.strokeStyle = shadeAt(hex(C.stem2), p[3]); g.lineWidth = 1 * p[2]; g.beginPath(); g.moveTo(p0[0], p0[1]); g.quadraticCurveTo(p0[0], p[1], p[0], p[1]); g.stroke(); }
          drawFlower(g, s.species, p[0], p[1], R, open, s.color, b.phase, reduce ? 0 : Math.sin(T * 1.1 + b.phase) * 0.05, p[3], p[2]);
        } });
      }
      s.tip = project(stemPoint(s, s.drape ? 0.1 : 1, sway));
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
    ctx.save(); ctx.globalAlpha = 0.28; ctx.filter = 'blur(6px)'; ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, cols * CELLW, rows * LINE); ctx.restore();
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
    hover.querySelector('.k').textContent = `${a.dataset.topic}, ${a.dataset.stage}`;
    hover.querySelector('.t').textContent = a.dataset.title;
    hover.querySelector('.m').textContent = `${a.dataset.near} nearby. Click to open.`;
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
    if (!dragging) { yaw += yawV; yawV *= 0.95; } // it only turns when you turn it; the wind does the rest
    if (now - last > 1000 / 30) { last = now; drawScene(t); paint(); placeHits(); }
    requestAnimationFrame(frame);
  }
  function replay() { start = performance.now(); }

  layout(); size(); idleSince = performance.now();
  if (window.__gardenStartSettled) start = performance.now() - 9000; // already grown
  requestAnimationFrame(frame);
  addEventListener('resize', size);
  if ('ResizeObserver' in window) new ResizeObserver(() => size()).observe(root);
  // when the page settles, the bouquet spins a half turn as it slides to its side
  const stage = document.getElementById('stage');
  if (stage) new MutationObserver(() => { if (stage.classList.contains('settled') && !stage.classList.contains('instant')) yawV = 0.085; }).observe(stage, { attributes: true, attributeFilter: ['class'] });
  root.querySelector('.replay')?.addEventListener('click', replay);
})();
