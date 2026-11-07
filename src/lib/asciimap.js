// The map, drawn in characters at build time. Thoughts cluster by topic;
// the connections the garden found are dotted lines between them. Each
// thought is a link (@ for a thought, o for a photo or link) in its topic's
// color. Deterministic, so the map only moves when the garden does.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function drawMap(g, opts = {}) {
  const COLS = opts.cols || 150, ROWS = opts.rows || 52;
  const rand = rng(21);
  const topics = g.topics;
  const n = topics.length;
  // cluster centers on a loose ring; bigger topics get more room
  const centers = new Map();
  topics.forEach((tp, i) => {
    const ang = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const rad = n === 1 ? 0 : 0.30 + (rand() - 0.5) * 0.08;
    centers.set(tp.name, { x: 0.5 + Math.cos(ang) * rad * 1.15, y: 0.5 + Math.sin(ang) * rad, r: 0.06 + 0.10 * Math.sqrt(tp.count / (topics[0]?.count || 1)) });
  });
  // positions in unit space, then to cells; keep thoughts from landing on each other
  const taken = new Set();
  const pos = new Map();
  const cellOf = (x, y) => [Math.round(x * (COLS - 1)), Math.round(y * (ROWS - 1))];
  for (const t of g.thoughts) {
    const c = t.topic ? centers.get(t.topic) : { x: 0.5, y: 0.5, r: 0.12 };
    let x, y, tries = 0, cell;
    do {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * c.r;
      x = c.x + Math.cos(a) * d * 1.15; y = c.y + Math.sin(a) * d;
      for (const nb of t.nearbyThoughts) if (nb.topic && nb.topic !== t.topic) { const oc = centers.get(nb.topic); x += (oc.x - x) * 0.08; y += (oc.y - y) * 0.08; }
      x = Math.min(0.97, Math.max(0.03, x)); y = Math.min(0.95, Math.max(0.1, y));
      cell = cellOf(x, y);
      tries++;
    } while (tries < 30 && [[0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0]].some(([dx, dy]) => taken.has(`${cell[0] + dx},${cell[1] + dy}`)));
    for (const dx of [-2, -1, 0, 1, 2]) taken.add(`${cell[0] + dx},${cell[1]}`);
    pos.set(t.id, { x, y, c: cell[0], r: cell[1] });
  }

  // grid of cells: { ch, cls, color, ids }
  const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
  const put = (r, c, ch, color, cls, data) => { if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return; const cur = grid[r][c]; if (cur && cur.cls === 'node') return; grid[r][c] = { ch, color, cls, data }; };

  // edges, dotted
  const edges = []; const seen = new Set();
  for (const t of g.thoughts) for (const nb of t.nearbyThoughts) {
    const key = [t.id, nb.id].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
    edges.push([t.id, nb.id]);
  }
  for (const [a, b] of edges) {
    const A = pos.get(a), B = pos.get(b);
    const steps = Math.max(Math.abs(B.c - A.c), Math.abs(B.r - A.r) * 2, 1);
    for (let i = 1; i < steps; i += 2) {
      const c = Math.round(A.c + ((B.c - A.c) * i) / steps), r = Math.round(A.r + ((B.r - A.r) * i) / steps);
      put(r, c, '.', null, 'edge', { a, b });
    }
  }
  // cluster labels above each cluster
  const labelCells = [];
  for (const tp of topics) {
    const c = centers.get(tp.name);
    const [cc, cr] = cellOf(c.x, Math.max(0.04, c.y - c.r - 0.05));
    const text = `${tp.name}`;
    const c0 = Math.max(0, Math.min(COLS - text.length, cc - Math.floor(text.length / 2)));
    labelCells.push({ r: cr, c: c0, text, tp });
  }
  // nodes (last, so they win)
  for (const t of g.thoughts) {
    const p = pos.get(t.id);
    const tp = t.topic ? g.topicMap.get(t.topic) : null;
    grid[p.r][p.c] = { ch: t.kind === 'photo' ? 'o' : '@', color: tp ? tp.color : '#BFB2A0', cls: 'node', data: { t, tp } };
  }

  // render
  let html = '';
  for (let r = 0; r < ROWS; r++) {
    let line = ''; let c = 0;
    const labs = labelCells.filter((l) => l.r === r);
    while (c < COLS) {
      const l = labs.find((l) => l.c === c);
      if (l) { line += `<a class="map-label" href="${esc(l.tp.url)}" data-topic="${esc(l.tp.slug)}" style="color:${l.tp.color}">${esc(l.text)}</a>`; c += l.text.length; continue; }
      const cell = grid[r][c];
      if (!cell) { line += ' '; c++; continue; }
      if (cell.cls === 'node') {
        const { t, tp } = cell.data;
        line += `<a class="node${t.kind === 'photo' ? ' photo' : ''}" href="${esc(t.url)}" data-id="${esc(t.id)}" data-topic-slug="${esc(tp ? tp.slug : '')}" data-title="${esc(t.title)}" data-topic="${esc(t.topic || 'no root yet')}" data-stage="${esc(t.stage)}" data-near="${t.nearbyThoughts.length}" style="color:${cell.color}" aria-label="${esc(t.title)} (${esc(t.topic || 'no root yet')})">${cell.ch}</a>`;
        c++; continue;
      }
      line += `<span class="edge" data-a="${esc(cell.data.a)}" data-b="${esc(cell.data.b)}" aria-hidden="true">${cell.ch}</span>`; c++;
    }
    html += line.replace(/\s+$/, '') + '\n';
  }
  return { html, cols: COLS, rows: ROWS };
}
