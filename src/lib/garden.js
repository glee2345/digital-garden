// Reads data/garden.json (written by the tending script in the sheet) and
// derives everything the pages need. Nothing here talks to Google or Claude;
// that all happens in apps-script/Code.gs before the data lands in the repo.

import raw from '../../data/garden.json';
import manifest from './img-manifest.js';

const IMAGE_RE = /^[\w.\- ()]+\.(jpe?g|png|gif|webp|heic|heif)$/i;
const URL_RE = /^https?:\/\/\S+$/i;

// one flower color per topic, in order of size; the bouquet and the map share these
export const TOPIC_COLORS = ['#FF9FA3', '#FFE08A', '#FFB070', '#C9A8FF', '#8FD9FF', '#FFC2E8', '#B8F0A0', '#FFD1A8'];

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : ''));
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear() && !opts.year;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

export function ago(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 9) return `${w}w ago`;
  return fmtDate(iso);
}

// ---- body parsing: column A → blocks -------------------------------------
// A filename on its own line is an image where it sits. Consecutive filenames
// become a gallery. A line starting with "—" right after an image is its
// caption. A URL on its own line is a link card. Blank lines split paragraphs.
// [[Title]] links another thought by title. **bold** and *italic* work.
export function parseBody(text, thought, byTitle) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ type: 'p', html: para.map((l) => inline(l, byTitle)).join('<br>') }); para = []; } };
  const LI = /^(?:[-*•]|\d+[.)])\s+/;
  for (let i = 0; i < lines.length; i++) {
    const line = bareUrl(lines[i].trim());
    if (!line) { flush(); continue; }
    if (IMAGE_RE.test(line)) {
      flush();
      const files = [line];
      while (i + 1 < lines.length && IMAGE_RE.test(lines[i + 1].trim())) files.push(lines[++i].trim());
      let caption = '';
      if (i + 1 < lines.length && /^[—–-]\s*/.test(lines[i + 1].trim())) caption = lines[++i].trim().replace(/^[—–-]\s*/, '');
      const images = files.map((f) => imageFor(f, thought));
      blocks.push({ type: files.length > 1 ? 'gallery' : 'image', images, caption });
      continue;
    }
    if (URL_RE.test(line)) {
      flush();
      const link = thought?.link && thought.link.url === line ? tidyLink(thought.link) : { url: line, domain: domainOf(line) };
      blocks.push({ type: 'link', link });
      continue;
    }
    if (LI.test(line)) {
      flush();
      const ordered = /^\d/.test(line);
      const items = [inline(line.replace(LI, ''), byTitle)];
      while (i + 1 < lines.length && LI.test(bareUrl(lines[i + 1].trim())) && /^\d/.test(lines[i + 1].trim()) === ordered) items.push(inline(lines[++i].trim().replace(LI, ''), byTitle));
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

// a link pasted as [url](), [text](url) or <url> still counts as a link line
export function bareUrl(line) {
  const m = line.match(/^\[([^\]]*)\]\((https?:\/\/[^)\s]*)?\)$/) || line.match(/^<(https?:\/\/[^>\s]+)>$/);
  if (!m) return line;
  if (m[2]) return m[2];
  const inner = m[1];
  return /^https?:\/\/\S+$/i.test(inner) ? inner : line;
}

function tidyLink(link) {
  let title = decodeEntities(link.title), description = decodeEntities(link.description);
  const ig = title.match(/^(.+?) on Instagram: ["\u201c](.*)["\u201d]?$/s);
  if (ig) { title = ig[1] + ' on Instagram'; description = ig[2]; }
  description = description.replace(/\s*#\w+/g, '').trim().slice(0, 180);
  return { ...link, title: title.slice(0, 140), description };
}

function decodeEntities(x) {
  return String(x || '').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function inline(s, byTitle) {
  let out = esc(s);
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_, t) => {
    const hit = byTitle?.get(t.trim().toLowerCase());
    return hit ? `<a href="${hit.url}" class="wiki">${esc(t.trim())}</a>` : `<span class="wiki wiki-missing">${esc(t.trim())}</span>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, pre, u) => `${pre}<a href="${u}">${domainOf(u)}</a>`);
  return out;
}

function imageFor(file, thought) {
  const meta = (thought?.images || []).find((im) => im.file === file) || {};
  const m = manifest[file];
  return {
    file,
    alt: meta.alt || thought?.title || '',
    thumb: m ? m.thumb : null,
    full: m ? m.full : null,
    width: m ? m.width : null,
    height: m ? m.height : null,
    missing: !m,
  };
}

// A title from the first line: the first sentence, or the first ~80
// characters cut at a word. Trailing period dropped.
function titleFrom(line) {
  const m = line.match(/^(.{12,110}?[.?!])(\s|$)/);
  let t = m ? m[1] : line;
  if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, '') + '…';
  return t.replace(/[.]+$/, '').trim();
}

function stripTags(h) { return h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }

// What a card shows under the title: the body minus the line the title came
// from, trimmed to a couple of sentences.
function excerptOf(t) {
  // the first few lines of the thought, shape kept (line breaks, list dashes), cut at ~260 chars
  const titleKey = t.title.toLowerCase().replace(/[.?!…]+$/, '');
  const lines = [];
  for (const b of t.body) {
    if (b.type === 'p') for (const l of b.html.split('<br>')) lines.push(stripTags(l));
    else if (b.type === 'list') for (const it of b.items) lines.push('– ' + stripTags(it));
  }
  while (lines.length && lines[0].toLowerCase().replace(/[.?!]+$/, '') === titleKey) lines.shift();
  if (lines.length && lines[0].toLowerCase().startsWith(titleKey) && lines[0].length > titleKey.length) lines[0] = lines[0].slice(t.title.length).replace(/^[.?!:,\s]+/, '');
  const out = [];
  let len = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    if (len + l.length > 260) { out.push(l.slice(0, Math.max(0, 260 - len)).replace(/\s+\S*$/, '') + '…'); len = 999; break; }
    out.push(l); len += l.length;
    if (out.length >= 6) { if (lines.length > out.length) out.push('…'); break; }
  }
  if (out.length && out[0]) out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out.join('\n');
}

// ---- the garden ----------------------------------------------------------
export function loadGarden() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = (p) => `${base}${p}`;

  const published = raw.thoughts.filter((t) => t.published !== false);
  const thoughts = published.map((t) => {
    const topic = (t.topic || '').trim();
    const firstLine = String(t.text || '').split('\n').map((l) => l.trim()).find((l) => l && !IMAGE_RE.test(l) && !URL_RE.test(l)) || '';
    const title = (t.title || '').trim() || titleFrom(firstLine);
    const images = [];
    for (const line of String(t.text || '').split('\n')) if (IMAGE_RE.test(line.trim())) images.push(line.trim());
    const kind = images.length ? 'photo' : t.link && t.link.kind === 'video' ? 'video' : t.link || String(t.text || '').split('\n').some((l) => URL_RE.test(l.trim())) ? 'link' : 'text';
    return {
      ...t,
      topic,
      topicSlug: topic ? slugify(topic) : '',
      title,
      kind,
      imageFiles: images,
      filing: t.status === 'filing' || (!topic && t.status !== 'filed'),
      url: url(`/t/${t.id}/`),
      stage: t.stage || 'seedling',
    };
  });

  const byId = new Map(thoughts.map((t) => [t.id, t]));
  const byTitle = new Map(thoughts.map((t) => [t.title.toLowerCase(), t]));
  for (const t of thoughts) {
    t.nearbyThoughts = (t.nearby || []).map((id) => byId.get(id)).filter(Boolean);
    t.body = parseBody(t.text, t, byTitle);
    t.firstImage = t.imageFiles.length ? imageFor(t.imageFiles[0], t) : null;
    t.excerpt = excerptOf(t);
    // on the thought page, don't repeat the line the title came from
    t.pageBody = t.body.slice();
    const titleKey = t.title.toLowerCase().replace(/[.?!…]+$/, '');
    const idx = t.pageBody.findIndex((b, k) => k < 3 && b.type === 'p' && stripTags(b.html).toLowerCase().replace(/[.?!]+$/, '') === titleKey);
    if (idx !== -1) t.pageBody.splice(idx, 1);
  }
  // connections go both ways: if A is filed next to B, B is next to A too
  // (also any thought that names another in [[double brackets]])
  for (const t of thoughts) t.mentionedBy = [];
  for (const t of thoughts) {
    for (const n of t.nearbyThoughts) if (!n.nearbyThoughts.includes(t) && !n.mentionedBy.includes(t)) n.mentionedBy.push(t);
    const wikis = [...String(t.text || '').matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => byTitle.get(m[1].trim().toLowerCase())).filter(Boolean);
    for (const w of wikis) if (!w.mentionedBy.includes(t) && !w.nearbyThoughts.includes(t)) w.mentionedBy.push(t);
  }
  for (const t of thoughts) { t.nearbyThoughts = [...t.nearbyThoughts, ...t.mentionedBy]; t.mentionedBy = []; }
  // stages: seedling → growing (2+ connections or edited) → evergreen (you said so)
  for (const t of thoughts) {
    if (t.stage === 'evergreen') continue;
    const connections = t.nearbyThoughts.length;
    t.stage = connections >= 2 || (t.tended && t.tended !== t.planted) ? 'growing' : 'seedling';
  }

  // topics: named by the garden; counts and relationships derived here
  const topicMap = new Map();
  for (const meta of raw.topics || []) topicMap.set(meta.name, { ...meta, slug: slugify(meta.name), thoughts: [], reaches: new Map() });
  for (const t of thoughts) {
    if (!t.topic) continue;
    if (!topicMap.has(t.topic)) topicMap.set(t.topic, { name: t.topic, slug: t.topicSlug, firstPlanted: t.planted, mergedFrom: [], thoughts: [], reaches: new Map() });
    topicMap.get(t.topic).thoughts.push(t);
  }
  const now = Date.now();
  for (const tp of topicMap.values()) {
    tp.thoughts.sort((a, b) => (b.planted || '').localeCompare(a.planted || ''));
    tp.count = tp.thoughts.length;
    tp.photos = tp.thoughts.filter((t) => t.kind === 'photo').length;
    tp.links = tp.thoughts.filter((t) => t.kind === 'link' || t.kind === 'video').length;
    tp.firstPlanted = tp.firstPlanted || tp.thoughts.at(-1)?.planted || '';
    tp.url = url(`/topic/${tp.slug}/`);
    for (const t of tp.thoughts) for (const n of t.nearbyThoughts) if (n.topic && n.topic !== tp.name) tp.reaches.set(n.topic, (tp.reaches.get(n.topic) || 0) + 1);
    tp.reachesList = [...tp.reaches.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const ageDays = tp.firstPlanted ? (now - new Date(tp.firstPlanted).getTime()) / 86400000 : 0;
    tp.isNew = ageDays <= 14 && tp.count <= 3;
  }
  const topics = [...topicMap.values()].filter((tp) => tp.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  topics.forEach((tp, i) => { tp.color = TOPIC_COLORS[i % TOPIC_COLORS.length]; });
  for (const t of thoughts) t.topicUrl = t.topic ? topicMap.get(t.topic)?.url : '';

  const stream = [...thoughts].sort((a, b) => (b.planted || '').localeCompare(a.planted || '') || b.id.localeCompare(a.id));
  const connections = thoughts.reduce((n, t) => n + t.nearbyThoughts.length, 0);

  // what's growing
  const monthAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  const newRoots = topics.filter((tp) => tp.firstPlanted >= monthAgo);
  const recentlyTended = [...thoughts].filter((t) => !t.filing).sort((a, b) => (b.tended || '').localeCompare(a.tended || '')).slice(0, 3);
  const deepest = [...thoughts].filter((t) => !t.filing).sort((a, b) => (b.nearbyThoughts.length + b.mentionedBy.length) - (a.nearbyThoughts.length + a.mentionedBy.length))[0] || null;

  return {
    site: raw.site || {},
    tended: raw.tended,
    thoughts,
    stream,
    byId,
    topics,
    topicMap,
    stats: { thoughts: thoughts.length, topics: topics.length, connections, firstPlanted: stream.at(-1)?.planted || '' },
    growing: { newRoots, recentlyTended, deepest },
    url,
  };
}
