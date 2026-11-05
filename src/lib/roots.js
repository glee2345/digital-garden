// Grows a root system from the topics and renders it as characters.
// Each topic is a main root whose thickness and reach come from its count;
// side roots branch and drift down; thoughts sit in small clearings.
// Seeded, so the same garden always draws the same way.

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function growRoots(topics, opts = {}) {
  const COLS = opts.cols || 160, ROWS = opts.rows || 60;
  const CW = 6, CH = 12, SS = 3;
  const W = COLS * CW * SS, H = ROWS * CH * SS;
  const rand = rng(opts.seed ?? 8);
  const ink = new Float32Array(W * H);        // darkness
  const owner = new Int16Array(W * H).fill(-1); // which root drew here
  const strength = new Float32Array(W * H);

  function stamp(x, y, r, who) {
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx - x, yy - y);
      if (d <= r) { const i = yy * W + xx; ink[i] = 1; if (r > strength[i]) { strength[i] = r; owner[i] = who; } }
    }
  }
  function line(x0, y0, x1, y1, w, who) {
    const len = Math.hypot(x1 - x0, y1 - y0); const n = Math.max(1, Math.ceil(len / (w * 0.4)));
    for (let i = 0; i <= n; i++) stamp((x0 + (x1 - x0) * i / n) * SS, (y0 + (y1 - y0) * i / n) * SS, Math.max(0.6, w * SS / 2), who);
  }

  const nodesPx = new Map(); const tips = new Map();
  function grow(x, y, ang, length, width, depth, who, maxdepth, mainline) {
    if (depth > maxdepth || width < 0.25) { if (mainline && !tips.has(who)) tips.set(who, [x, y]); return; }
    const steps = Math.max(3, Math.floor(length / 6));
    const pts = [[x, y]]; let a = ang;
    for (let i = 0; i < steps; i++) {
      a += mainline ? (rand() * 0.18 - 0.09) : (rand() * 0.48 - 0.24);
      a += mainline ? 0 : (Math.PI / 2 - a) * 0.015;
      if (x < COLS * CW * 0.05 && Math.cos(a) < 0) a += (Math.PI / 2 - a) * 0.3;
      if (x > COLS * CW * 0.95 && Math.cos(a) > 0) a += (Math.PI / 2 - a) * 0.3;
      x += Math.cos(a) * (length / steps); y += Math.sin(a) * (length / steps);
      pts.push([x, y]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const w = Math.max(1.3, width * (1 - (i / pts.length) * 0.3));
      line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, who);
    }
    if (depth <= 2) { if (!nodesPx.has(who)) nodesPx.set(who, []); nodesPx.get(who).push(pts[Math.floor(pts.length / 2)]); }
    const n = depth < maxdepth - 1 ? [1, 2, 2, 3][Math.floor(rand() * 4)] : [1, 2][Math.floor(rand() * 2)];
    for (let k = 0; k < n; k++) {
      const spread = (0.35 + rand() * 0.75) * (rand() < 0.5 ? -1 : 1);
      const childAng = a + spread * (k === 0 ? 0.35 : 1.0);
      const wf = k === 0 ? 0.8 + rand() * 0.12 : 0.5 + rand() * 0.2;
      const lf = k === 0 ? 0.7 + rand() * 0.2 : 0.5 + rand() * 0.25;
      grow(x, y, childAng, length * lf, width * wf, depth + 1, who, maxdepth, mainline && k === 0);
    }
    const hairs = [0, 1, 2][Math.floor(rand() * 3)];
    for (let h = 0; h < hairs; h++) {
      const p = pts[1 + Math.floor(rand() * Math.max(1, pts.length - 2))]; const ha = a + (rand() * 2.8 - 1.4);
      const hl = length * (0.15 + rand() * 0.2);
      line(p[0], p[1], p[0] + Math.cos(ha) * hl, p[1] + Math.sin(ha) * hl, 1.0, who);
    }
  }

  // trunk
  const cx = COLS * CW / 2, ground = 3 * CH;
  // main roots: angle from vertical spread across the width, size from count
  const maxCount = Math.max(1, ...topics.map((t) => t.count));
  const n = topics.length;
  const angles = n === 1 ? [0] : topics.map((_, i) => -0.9 + (1.8 * i) / (n - 1));
  // interleave big and small so the heavy roots aren't all on one side
  const order = [...topics].sort((a, b) => b.count - a.count);
  const slots = []; let lo = 0, hi = n - 1;
  for (let i = 0; i < n; i++) slots.push(i % 2 === 0 ? (lo++) : (hi--));
  const mains = order.map((tp, i) => {
    const f = tp.count / maxCount;
    return { tp, ang: -angles[slots[i]], width: 2.2 + 6 * f, length: 150 + 50 * f, depth: 4 + Math.round(4 * f) };
  });
  mains.forEach((m, who) => grow(cx + m.ang * 6, ground, Math.PI / 2 + m.ang * 0.9, m.length, m.width, 0, who, m.depth, true));

  // downsample to characters
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(' '));
  const cellOwner = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
  const ramp = " .'`,:;-~=+*";
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    let sum = 0; const own = new Map();
    for (let yy = 0; yy < CH * SS; yy++) for (let xx = 0; xx < CW * SS; xx++) {
      const i = (r * CH * SS + yy) * W + (c * CW * SS + xx);
      if (ink[i]) { sum++; own.set(owner[i], (own.get(owner[i]) || 0) + 1); }
    }
    const v = Math.min(1, (sum / (CH * SS * CW * SS)) * 1.5);
    const idx = v < 0.04 ? 0 : Math.max(1, Math.round(Math.pow(v, 0.7) * (ramp.length - 1)));
    g[r][c] = ramp[idx];
    if (own.size) cellOwner[r][c] = [...own.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  for (let r = 0; r < 3; r++) { for (let c = 0; c < COLS; c++) g[r][c] = ' '; for (const c of [COLS / 2 - 1, COLS / 2, COLS / 2 + 1]) g[r][c] = '|'; }

  // thoughts: spread along each root, each in a small clearing
  const marks = new Map(); let mi = 0;
  const pick = [];
  mains.forEach((m, who) => {
    const pts = [...new Set(nodesPx.get(who) || [])].sort((a, b) => a[1] - b[1]);
    const items = m.tp.thoughts.slice(0, Math.min(m.tp.thoughts.length, 6));
    if (!pts.length) return;
    items.forEach((t, k) => {
      const p = pts[Math.min(pts.length - 1, Math.floor((pts.length * (k + 0.5)) / items.length))];
      const r = Math.min(ROWS - 1, Math.max(4, Math.floor(p[1] / CH))), c = Math.min(COLS - 1, Math.floor(p[0] / CW));
      pick.push({ r, c, t, who });
    });
  });
  for (const { r, c, t, who } of pick) {
    for (const [dr, span] of [[0, 2], [-1, 1], [1, 1]]) {
      const rr = r + dr; if (rr < 4 || rr >= ROWS) continue;
      for (let cc = c - span; cc <= c + span; cc++) if (cc >= 0 && cc < COLS) g[rr][cc] = ' ';
    }
    const m = String.fromCharCode(0xE000 + mi++); g[r][c] = m; cellOwner[r][c] = who;
    marks.set(m, { t, who });
  }
  // labels under the main line's tip
  const labs = mains.map((m, who) => { const [x, y] = tips.get(who) || [cx, ROWS * CH - 20]; return { x: x / CW, y: y / CH, text: `${m.tp.name} · ${m.tp.isNew ? 'new' : m.tp.count}`, who, href: m.tp.url }; }).sort((a, b) => a.x - b.x);
  let lastEnd = -99;
  const labelCells = [];
  for (const l of labs) {
    let c = Math.max(0, Math.min(COLS - l.text.length - 1, Math.floor(l.x) - Math.floor(l.text.length / 2)));
    c = Math.max(c, lastEnd + 2);
    const r = Math.min(ROWS - 1, Math.floor(l.y) + 2);
    for (let k = -1; k <= l.text.length; k++) if (c + k >= 0 && c + k < COLS) g[r][c + k] = ' ';
    labelCells.push({ r, c, text: l.text, who: l.who, href: l.href });
    lastEnd = c + l.text.length;
  }

  // render: group runs by owner so a root can be highlighted
  let html = '';
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    const lab = labelCells.filter((l) => l.r === r).sort((a, b) => a.c - b.c);
    let line = '';
    while (c < COLS) {
      const l = lab.find((l) => l.c === c);
      if (l) { line += `<a class="root-label" href="${esc(l.href || '#')}" data-root="${esc(mains[l.who].tp.slug)}">${esc(l.text)}</a>`; c += l.text.length; continue; }
      const ch = g[r][c];
      if (marks.has(ch)) {
        const { t, who } = marks.get(ch);
        line += `<a class="node${t.kind === 'photo' ? ' photo' : ''}" href="${esc(t.url)}" aria-label="${esc(t.title)} (${esc(t.topic)}${t.kind === 'photo' ? ', photo' : ''})" data-root="${esc(mains[who].tp.slug)}" data-id="${esc(t.id)}" data-title="${esc(t.title)}" data-topic="${esc(t.topic)}" data-stage="${esc(t.stage)}" data-near="${t.nearbyThoughts.length}">${t.kind === 'photo' ? 'o' : '@'}</a>`;
        c++; continue;
      }
      // a run of plain cells with the same owner
      const who = cellOwner[r][c]; let run = '';
      while (c < COLS && !marks.has(g[r][c]) && cellOwner[r][c] === who && !lab.find((l) => l.c === c)) { run += g[r][c]; c++; }
      line += who >= 0 ? `<span data-root="${esc(mains[who].tp.slug)}" aria-hidden="true">${esc(run)}</span>` : (run.trim() ? `<span aria-hidden="true">${esc(run)}</span>` : esc(run));
    }
    html += line.replace(/\s+$/, '') + '\n';
  }
  return { html, cols: COLS, rows: ROWS };
}

// The phone version: one short strand per topic, longer for more thoughts.
export function strandFor(tp, maxCount) {
  const f = tp.count / Math.max(1, maxCount);
  const len = Math.max(4, Math.round(4 + 12 * f));
  const chars = "=+~-:,'`";
  let a = '', b = '';
  for (let i = 0; i < len; i++) a += chars[Math.min(chars.length - 1, Math.floor((i / len) * chars.length))];
  for (let i = 0; i < Math.round(len * 0.7); i++) b += chars[Math.min(chars.length - 1, Math.floor(((i + 2) / len) * chars.length))];
  const node = tp.thoughts.some((t) => t.kind === 'photo') && tp.thoughts[0].kind === 'photo' ? 'o' : '@';
  return `${a}\n  \`${b}\n      <b>${node}</b> ':-,.`;
}
