/**
 * The garden's tending script. Lives inside the Google Sheet
 * (Extensions → Apps Script). Runs every hour, or from Garden ▸ Tend now.
 *
 * What a tend does:
 *   1. stamps new rows with an id and a planted date, updates tended dates
 *   2. turns any un-mentioned image in the images folder into a row of its own
 *   3. files new/changed thoughts: title, topic, nearby, alt text
 *      (with Claude or Gemini if a key is set; otherwise by simple rules,
 *      and the thought's own words decide where it lands)
 *   4. applies renames and merges from the topics tab, keeps that tab current
 *   5. pushes garden.json (+ new images) to the GitHub repo, which rebuilds the site
 *
 * Settings live in Script Properties (set once via Garden ▸ Set up):
 *   GITHUB_TOKEN, GITHUB_REPO (owner/repo),
 *   optional: ANTHROPIC_API_KEY or GEMINI_API_KEY (either, both, or neither),
 *   CLAUDE_MODEL, GEMINI_MODEL, IMAGES_FOLDER_ID, MAX_FILINGS_PER_RUN
 */

const SHEET_THOUGHTS = 'thoughts';
const SHEET_TOPICS = 'topics';
const SHEET_SETTINGS = 'settings';
const HIDDEN = ['_hash', '_link', '_alt', '_textHash'];
const TOPIC_HIDDEN = ['_aliases'];
const IMAGE_RE = /^[\w.\- ()]+\.(jpe?g|png|gif|webp|heic|heif)$/i;
const URL_RE = /^https?:\/\/\S+$/i;
const DEFAULT_ABOUT = "A digital garden is a personal website for collecting ideas and letting them grow. It's closer to a notebook than a blog: nothing here is finished, nothing is sorted by date, and most of it is still changing.\n\nThoughts start small. A sentence, a photo from a walk, a link and what I made of it. Some of them get revisited and grow into something bigger; most stay seedlings, and that's fine. The point isn't the size of any one thought. It's that they're planted somewhere I can come back to.\n\nInstead of a feed, the garden is organized by connection. Every thought is filed next to the ones it's related to, and the topics grow out of the thoughts rather than the other way around. You're meant to wander: follow a nearby thought, follow another, end up somewhere you didn't mean to go.\n\nIt's also a way of thinking in public without performing. There are no likes here and nothing to chase. Publishing a half-formed idea is allowed, encouraged even, because the alternative is that it gets said once and lost. This is where I'm learning out loud.";

// ---------------------------------------------------------------- menu
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Garden')
    .addItem('Tend now', 'tendNow')
    .addSeparator()
    .addItem('Set up (first time)', 'setup')
    .addItem('Check connections', 'checkConnections')
    .addToUi();
}

function tendNow() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = tend();
    ui.alert('Tended', `${r.filed} filed · ${r.newImages} new images · ${r.pushed ? 'site rebuilding' : 'nothing new to publish'}`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Something went wrong', String(e && e.message || e), ui.ButtonSet.OK);
    throw e;
  }
}

// ---------------------------------------------------------------- setup
function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const ask = (title, text, key) => {
    const cur = props.getProperty(key);
    const r = ui.prompt(title, text + (cur ? '\n\n(already set; leave blank to keep)' : ''), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) throw new Error('Set-up cancelled');
    const v = r.getResponseText().trim();
    if (v) props.setProperty(key, v);
  };
  ask('1 of 3 · AI (optional)', 'Paste an API key for the filing step, or leave blank to file by simple rules.\nAnthropic keys start with sk-ant-; Google Gemini keys start with AIza (free tier works).', 'AI_KEY_INPUT');
  const k = props.getProperty('AI_KEY_INPUT');
  if (k) { props.setProperty(k.startsWith('sk-ant-') ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY', k); props.deleteProperty('AI_KEY_INPUT'); }
  ask('2 of 3 · GitHub', 'Paste a GitHub token with "Contents: read and write" on the garden repository.', 'GITHUB_TOKEN');
  ask('3 of 3 · Repository', 'The repository, as owner/name (e.g. glee2345/digital-garden).', 'GITHUB_REPO');
  ensureStructure_();
  ensureTrigger_();
  ui.alert('Set up', 'Done. The garden now tends itself every hour. Use Garden ▸ Tend now to run it immediately.', ui.ButtonSet.OK);
}

function ensureTrigger_() {
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'tend');
  if (!has) ScriptApp.newTrigger('tend').timeBased().everyHours(1).create();
}

function checkConnections() {
  const ui = SpreadsheetApp.getUi();
  const out = [];
  const prov = aiProvider_();
  if (prov === 'none') out.push('AI: none set, filing by simple rules');
  else { try { ai_('Reply with the single word ok.', [], 20); out.push(prov + ': ok'); } catch (e) { out.push(prov + ': ' + e.message); } }
  try { const r = github_('GET', ''); out.push('GitHub: ok (' + r.full_name + ')'); } catch (e) { out.push('GitHub: ' + e.message); }
  try { out.push('Images folder: ' + imagesFolder_().getName()); } catch (e) { out.push('Images folder: ' + e.message); }
  ui.alert('Connections', out.join('\n'), ui.ButtonSet.OK);
}

// ---------------------------------------------------------------- structure
function ensureStructure_() {
  const ss = SpreadsheetApp.getActive();
  const th = ss.getSheetByName(SHEET_THOUGHTS);
  if (!th) throw new Error('No "thoughts" tab found');
  addHiddenColumns_(th, HIDDEN);
  let tp = ss.getSheetByName(SHEET_TOPICS);
  if (!tp) { tp = ss.insertSheet(SHEET_TOPICS); tp.appendRow(['topic', 'thoughts', 'first planted', 'rename to', 'merge into', 'garden suggests', 'note']); }
  addHiddenColumns_(tp, TOPIC_HIDDEN);
  let st = ss.getSheetByName(SHEET_SETTINGS);
  if (!st) {
    st = ss.insertSheet(SHEET_SETTINGS);
    st.getRange(1, 1, 6, 2).setValues([['setting', 'value'], ['site name', 'digital garden'], ['author', ''], ['tagline', 'welcome to my digital garden!'], ['welcome', "explore what I'm thinking and learning about in this little corner of the internet."], ['about', DEFAULT_ABOUT]]);
    st.getRange(6, 2).setWrap(true); st.setRowHeight(6, 220);
    st.setColumnWidth(2, 360);
  }
}

function addHiddenColumns_(sheet, names) {
  const headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  for (const n of names) {
    if (headers.indexOf(n) === -1) {
      const col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(n).setFontColor('#bbbbbb');
      sheet.hideColumns(col);
      headers.push(n);
    }
  }
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { if (h) map[String(h).trim().toLowerCase()] = i; });
  return map;
}

// ---------------------------------------------------------------- tend
function tend() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { filed: 0, newImages: 0, pushed: false, note: 'already running' };
  try {
    tfidfCache_ = null;
    ensureStructure_();
    const ss = SpreadsheetApp.getActive();
    const th = ss.getSheetByName(SHEET_THOUGHTS);
    const H = headerMap_(th);
    const need = ['thought', 'id', 'planted', 'tended', 'auto title', 'auto topic', 'nearby', 'auto stage', 'status'];
    for (const n of need) if (H[n] === undefined) throw new Error(`The thoughts tab is missing a "${n}" column`);
    const col = (n) => H[n];
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    // 1. images not mentioned anywhere become rows
    const newImages = adoptImages_(th, H);

    const last = th.getLastRow();
    const width = th.getLastColumn();
    const rows = last > 1 ? th.getRange(2, 1, last - 1, width).getValues() : [];

    // 2. stamp ids and dates, detect changes
    let nextId = nextId_(rows, col('id'));
    const dirty = [];
    rows.forEach((row, i) => {
      const text = String(row[col('thought')] || '').trim();
      if (!text) return;
      if (!row[col('id')]) row[col('id')] = 'g' + String(nextId++).padStart(3, '0');
      if (!row[col('planted')]) row[col('planted')] = today;
      const hash = hash_([row[col('thought')], row[col('image or link')], row[col('title')], row[col('topic')], row[col('stage')], row[col('published')]].join('\u0001'));
      const textHash = hash_(text + '\u0001' + String(row[col('image or link')] || ''));
      if (row[col('_hash')] && row[col('_hash')] !== hash) row[col('tended')] = today;
      if (!row[col('tended')]) row[col('tended')] = row[col('planted')];
      row[col('_hash')] = hash;
      const needsFiling = !row[col('auto title')] || !row[col('auto topic')] || row[col('_texthash')] !== textHash;
      if (needsFiling) { dirty.push(i); row[col('status')] = 'filing…'; }
      else row[col('status')] = row[col('published')] === false || String(row[col('published')]).toUpperCase() === 'FALSE' ? 'off' : 'filed';
    });

    // 3. file with Claude (a bounded number per run)
    const max = Number(PropertiesService.getScriptProperties().getProperty('MAX_FILINGS_PER_RUN') || 25);
    const topicsSheet = ss.getSheetByName(SHEET_TOPICS);
    const TH = headerMap_(topicsSheet);
    const topicRows = readTopics_(topicsSheet, TH);
    let filed = 0;
    for (const i of dirty.slice(0, max)) {
      try {
        fileThought_(rows, i, col, topicRows, today);
        rows[i][col('_texthash')] = hash_(String(rows[i][col('thought')]).trim() + '\u0001' + String(rows[i][col('image or link')] || ''));
        rows[i][col('status')] = 'filed';
        filed++;
      } catch (e) {
        rows[i][col('status')] = 'filing… (' + String(e.message || e).slice(0, 60) + ')';
        console.error('filing failed for row ' + (i + 2) + ': ' + e);
      }
    }

    // 4. topics tab: renames, merges, new rows
    applyTopicEdits_(rows, col, topicRows);
    syncTopics_(rows, col, topicRows, today);
    writeTopics_(topicsSheet, TH, topicRows);

    // stages
    rows.forEach((row) => {
      if (!row[col('id')]) return;
      const you = String(row[col('stage')] || '').trim().toLowerCase();
      const near = String(row[col('nearby')] || '').split(',').filter((s) => s.trim()).length;
      row[col('auto stage')] = you === 'evergreen' ? 'evergreen' : (near >= 2 || row[col('tended')] !== row[col('planted')]) ? 'growing' : 'seedling';
    });

    if (rows.length) th.getRange(2, 1, rows.length, width).setValues(rows);

    // 5. publish
    const json = buildGardenJson_(rows, col, topicRows);
    const pushedImages = pushImages_(rows, col);
    const pushed = pushJson_(json, filed, newImages + pushedImages);
    return { filed, newImages, pushed };
  } finally {
    lock.releaseLock();
  }
}

function nextId_(rows, idCol) {
  let max = 0;
  for (const r of rows) { const m = String(r[idCol] || '').match(/^g(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
}

function hash_(s) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return b.slice(0, 8).map((x) => ('0' + ((x + 256) % 256).toString(16)).slice(-2)).join('');
}

// ---------------------------------------------------------------- images
function imagesFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('IMAGES_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    const it = p.getFoldersByName('images');
    if (it.hasNext()) return it.next();
  }
  throw new Error('No "images" folder next to the sheet (or set IMAGES_FOLDER_ID)');
}

function listImages_() {
  const out = [];
  const files = imagesFolder_().getFiles();
  while (files.hasNext()) { const f = files.next(); if (IMAGE_RE.test(f.getName())) out.push(f); }
  return out;
}

function adoptImages_(th, H) {
  let files;
  try { files = listImages_(); } catch (e) { console.warn(e.message); return 0; }
  const last = th.getLastRow();
  const texts = last > 1 ? th.getRange(2, 1, last - 1, th.getLastColumn()).getValues().map((r) => String(r[H['thought']] || '') + '\n' + String(r[H['image or link']] || '')) : [];
  const mentioned = new Set();
  for (const t of texts) for (const line of t.split('\n')) { const l = line.trim(); if (IMAGE_RE.test(l)) mentioned.add(l.toLowerCase()); }
  let added = 0;
  for (const f of files) {
    const name = f.getName();
    if (mentioned.has(name.toLowerCase())) continue;
    const row = new Array(th.getLastColumn()).fill('');
    row[H['thought']] = name;
    if (H['published'] !== undefined) row[H['published']] = true;
    th.appendRow(row);
    mentioned.add(name.toLowerCase());
    added++;
  }
  return added;
}

function imageBytes_(file, maxW) {
  // Drive renders a JPEG thumbnail at any size — this also converts HEIC.
  const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w' + (maxW || 1600);
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() === 200) return { bytes: res.getContent(), mime: 'image/jpeg', ext: 'jpg' };
  const blob = file.getBlob();
  return { bytes: blob.getBytes(), mime: blob.getContentType(), ext: file.getName().split('.').pop().toLowerCase() };
}

function pushImages_(rows, col) {
  let files;
  try { files = listImages_(); } catch (e) { return 0; }
  const props = PropertiesService.getScriptProperties();
  const pushed = JSON.parse(props.getProperty('PUSHED_IMAGES') || '{}');
  const wanted = new Set();
  for (const r of rows) for (const line of (String(r[col('thought')] || '') + '\n' + String(r[col('image or link')] || '')).split('\n')) { const l = line.trim(); if (IMAGE_RE.test(l)) wanted.add(l.toLowerCase()); }
  let n = 0;
  for (const f of files) {
    const name = f.getName();
    if (!wanted.has(name.toLowerCase())) continue;
    const key = name + ':' + f.getLastUpdated().getTime();
    if (pushed[name] === key) continue;
    try {
      const img = imageBytes_(f, 1200);
      const path = 'images/' + name.replace(/\.(heic|heif)$/i, '.jpg');
      putFile_(path, Utilities.base64Encode(img.bytes), 'image: ' + name);
      pushed[name] = key; n++;
    } catch (e) { console.error('image push failed: ' + name + ' ' + e); }
  }
  props.setProperty('PUSHED_IMAGES', JSON.stringify(pushed));
  return n;
}

// ---------------------------------------------------------------- filing
function readTopics_(sheet, TH) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues().map((r) => ({
    name: String(r[TH['topic']] || '').trim(), firstPlanted: String(r[TH['first planted']] || ''),
    renameTo: String(r[TH['rename to']] || '').trim(), mergeInto: String(r[TH['merge into']] || '').trim(),
    suggests: String(r[TH['garden suggests']] || ''), note: String(r[TH['note']] || ''),
    aliases: String(r[TH['_aliases']] || '').split(',').map((s) => s.trim()).filter(Boolean),
  })).filter((t) => t.name);
}

function writeTopics_(sheet, TH, topics) {
  const width = sheet.getLastColumn();
  const out = topics.map((t) => {
    const r = new Array(width).fill('');
    r[TH['topic']] = t.name; r[TH['first planted']] = t.firstPlanted; r[TH['rename to']] = ''; r[TH['merge into']] = '';
    r[TH['garden suggests']] = t.suggests || ''; r[TH['note']] = t.note || ''; r[TH['_aliases']] = t.aliases.join(', ');
    r[TH['thoughts']] = '';
    return r;
  });
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (out.length) {
    sheet.getRange(2, 1, out.length, width).setValues(out);
    // live counts
    const L = columnLetter_(headerMap_(SpreadsheetApp.getActive().getSheetByName(SHEET_THOUGHTS))['topic (used)'] + 1);
    const formulas = out.map((_, i) => [`=COUNTIF(thoughts!$${L}:$${L},A${i + 2})`]);
    sheet.getRange(2, TH['thoughts'] + 1, out.length, 1).setFormulas(formulas);
  }
}

function columnLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function usedTopic_(row, col) { return String(row[col('topic')] || row[col('auto topic')] || '').trim(); }

function applyTopicEdits_(rows, col, topics) {
  for (const t of topics) {
    const to = t.renameTo || t.mergeInto;
    if (!to || to.toLowerCase() === t.name.toLowerCase()) continue;
    for (const r of rows) {
      if (String(r[col('auto topic')] || '').trim().toLowerCase() === t.name.toLowerCase()) r[col('auto topic')] = to;
      if (String(r[col('topic')] || '').trim().toLowerCase() === t.name.toLowerCase()) r[col('topic')] = to;
    }
    const target = topics.find((x) => x.name.toLowerCase() === to.toLowerCase());
    if (target) { target.aliases = Array.from(new Set(target.aliases.concat([t.name], t.aliases))); t.name = ''; }
    else { t.aliases = Array.from(new Set(t.aliases.concat([t.name]))); t.name = to; }
    t.renameTo = ''; t.mergeInto = '';
  }
  // drop merged-away rows
  for (let i = topics.length - 1; i >= 0; i--) if (!topics[i].name) topics.splice(i, 1);
}

function syncTopics_(rows, col, topics, today) {
  const seen = new Map();
  for (const r of rows) { const t = usedTopic_(r, col); if (t) { const d = String(r[col('planted')] || today); if (!seen.has(t) || d < seen.get(t)) seen.set(t, d); } }
  for (const [name, first] of seen) if (!topics.find((t) => t.name.toLowerCase() === name.toLowerCase())) topics.push({ name, firstPlanted: first, renameTo: '', mergeInto: '', suggests: '', note: '', aliases: [] });
  for (const t of topics) if (!t.firstPlanted && seen.has(t.name)) t.firstPlanted = seen.get(t.name);
}

function fileThought_(rows, i, col, topics, today) {
  const row = rows[i];
  const text = String(row[col('thought')] || '').trim();
  const extra = String(row[col('image or link')] || '').trim();
  const allText = extra && !text.includes(extra) ? text + '\n' + extra : text;
  const lines = allText.split('\n').map((l) => l.trim());
  const imageNames = lines.filter((l) => IMAGE_RE.test(l));
  const urls = lines.filter((l) => URL_RE.test(l));

  // link preview
  let link = null;
  if (urls.length) { try { link = fetchLink_(urls[0]); } catch (e) { link = { url: urls[0], domain: domainOf_(urls[0]) }; } row[col('_link')] = JSON.stringify(link); }
  else row[col('_link')] = '';

  // image(s) for the model to look at
  const imageBlocks = [];
  if (imageNames.length && aiProvider_() !== 'none') {
    const folder = imagesFolder_();
    for (const name of imageNames.slice(0, 3)) {
      const it = folder.getFilesByName(name);
      if (!it.hasNext()) continue;
      const img = imageBytes_(it.next(), 1000);
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: Utilities.base64Encode(img.bytes) } });
    }
  }

  // context: topics and existing thoughts
  const counts = {};
  for (const r of rows) { const t = usedTopic_(r, col); if (t) counts[t] = (counts[t] || 0) + 1; }
  const topicList = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((t) => `${t} (${counts[t]})`);
  const others = candidates_(rows, i, col, 30)
    .map((r) => `${r[col('id')]} | ${usedTopic_(r, col) || '-'} | ${String(r[col('title')] || r[col('auto title')]).slice(0, 80)}`);

  const prompt = [
    'You file thoughts in a personal digital garden. Return ONLY a JSON object, no prose.',
    '',
    'THE THOUGHT (verbatim; filenames are images shown to you; URLs are links):',
    '"""', allText, '"""',
    link ? `\nLINK PREVIEW: ${JSON.stringify({ title: link.title, description: link.description })}` : '',
    '',
    `EXISTING TOPICS (name (count)): ${topicList.length ? topicList.join(', ') : 'none yet'}`,
    '',
    'EXISTING THOUGHTS (id | topic | title):',
    others.length ? others.join('\n') : '(none yet)',
    '',
    'Return JSON with these fields:',
    '- "title": a short natural title (max 9 words, sentence case, no trailing period). If the thought is one short line, the title can be the line itself.',
    '- "topic": the best existing topic, or a NEW one if none fits. Topic names: 1-2 lowercase words, broad enough to hold many thoughts (e.g. "design", "cooking", "walks"), never a restatement of this one thought. Prefer an existing topic when it fits reasonably; create a new one only when the thought is clearly about something else. If there are no topics yet, invent a good first one.',
    '- "is_new_topic": true/false.',
    '- "same_as": if your new topic is really the same as an existing one spelled differently (e.g. "type" vs "typography"), the existing name; else "".',
    '- "nearby": up to 5 ids of the most related existing thoughts, most related first (empty list if none are related).',
    '- "alt": for each image, a one-sentence description for someone who cannot see it, as {"filename": "..."}; {} if no images.',
    '- "excerpt": "" (reserved).',
  ].join('\n');

  let json;
  if (aiProvider_() === 'none') json = fileByRules_(rows, i, col, lines, imageNames, counts);
  else json = parseJson_(ai_(null, imageBlocks.concat([{ type: 'text', text: prompt }]), 600));

  row[col('auto title')] = String(json.title || '').trim() || lines.find((l) => l && !IMAGE_RE.test(l) && !URL_RE.test(l)) || imageNames[0] || 'untitled';
  let topic = String(json.topic || '').trim().toLowerCase();
  if (json.same_as && Object.keys(counts).some((t) => t.toLowerCase() === String(json.same_as).toLowerCase())) topic = String(json.same_as).toLowerCase();
  // match existing spelling
  const existing = Object.keys(counts).find((t) => t.toLowerCase() === topic);
  row[col('auto topic')] = existing || topic;
  const validIds = new Set(rows.map((r) => String(r[col('id')])));
  row[col('nearby')] = (Array.isArray(json.nearby) ? json.nearby : []).map(String).filter((id) => validIds.has(id) && id !== String(row[col('id')])).slice(0, 5).join(', ');
  row[col('_alt')] = JSON.stringify(json.alt && typeof json.alt === 'object' ? json.alt : {});
  if (!row[col('title')] && !row[col('auto title')]) row[col('auto title')] = row[col('id')];

  // a brand-new topic that Claude also flagged as "same as" gets a suggestion on the topics tab
  if (json.is_new_topic && !existing && json.same_as && !topic.includes(String(json.same_as).toLowerCase())) {
    const t = topics.find((x) => x.name.toLowerCase() === topic);
    if (t) t.suggests = `merge into "${json.same_as}"?`;
  }
}

// The thoughts most similar to row i by word overlap (tf-idf cosine), so the
// candidate list stays short however big the garden gets. Claude picks the
// real neighbors from these.
const STOP = new Set('the a an and or but of to in on at for with from by as is are was were be been it its this that these those i me my we our you your he she they them his her their not no yes if then than so very just about into over under out up down off more most some any all each both few such own same too can will would should could do does did have has had what which who whom when where why how'.split(' '));
let tfidfCache_ = null;
function tokens_(text) { return String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9à-ÿ' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, '')); }
function candidates_(rows, i, col, n) {
  if (!tfidfCache_ || tfidfCache_.n !== rows.length) {
    const docs = rows.map((r) => { const tf = {}; for (const w of tokens_(String(r[col('thought')] || '') + ' ' + String(r[col('auto title')] || '') + ' ' + usedTopic_(r, col))) tf[w] = (tf[w] || 0) + 1; return tf; });
    const df = {}; for (const d of docs) for (const w in d) df[w] = (df[w] || 0) + 1;
    const N = docs.length;
    const vecs = docs.map((d) => { const v = {}; let norm = 0; for (const w in d) { const x = (1 + Math.log(d[w])) * Math.log(1 + N / df[w]); v[w] = x; norm += x * x; } norm = Math.sqrt(norm) || 1; for (const w in v) v[w] /= norm; return v; });
    tfidfCache_ = { n: rows.length, vecs };
  }
  const me = tfidfCache_.vecs[i];
  const scored = [];
  rows.forEach((r, j) => {
    if (j === i || !r[col('id')] || !r[col('auto title')]) return;
    let dot = 0; const v = tfidfCache_.vecs[j]; for (const w in me) if (v[w]) dot += me[w] * v[w];
    scored.push([dot, j]);
  });
  scored.sort((a, b) => b[0] - a[0]);
  // the best matches, padded with the most recent so a new garden still has candidates
  const pick = scored.slice(0, n).map((x) => x[1]);
  const recent = rows.map((r, j) => j).filter((j) => j !== i && rows[j][col('id')] && rows[j][col('auto title')]).slice(-10);
  for (const j of recent) if (!pick.includes(j)) pick.push(j);
  return pick.map((j) => rows[j]);
}

function fetchLink_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (digital garden link preview)' } });
  const html = res.getContentText().slice(0, 200000);
  const meta = (p) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i')); return m ? decode_(m[1]) : ''; };
  const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return { url, domain: domainOf_(url), title: meta('og:title') || (t ? decode_(t[1].trim()) : ''), description: (meta('og:description') || meta('description')).slice(0, 200), image: meta('og:image') };
}
function domainOf_(u) { const m = String(u).match(/^https?:\/\/([^/]+)/i); return m ? m[1].replace(/^www\./, '') : u; }
function decode_(s) { return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' '); }

function parseJson_(s) {
  const m = String(s).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in reply');
  return JSON.parse(m[0]);
}

// ---------------------------------------------------------------- filing without a key
// Title: the first line of text. Nearby: the closest thoughts by word overlap.
// Topic: whatever the user typed in the topic column; failing that, the topic
// of the closest existing thought when it is close enough; failing that
// "unsorted" so it is easy to find and fix on the sheet.
function fileByRules_(rows, i, col, lines, imageNames, counts) {
  const row = rows[i];
  const firstText = lines.find((l) => l && !IMAGE_RE.test(l) && !URL_RE.test(l) && !l.startsWith('—')) || '';
  const clean = firstText.replace(/[#*_>]/g, '').trim();
  const sentence = (clean.match(/^(.+?[.!?])(\s|$)/) || [, clean])[1].trim();
  const words = (sentence.split(/\s+/).length <= 12 ? sentence : clean).split(/\s+/).filter(Boolean);
  let title = words.slice(0, 12).join(' ').replace(/[.,;:]+$/, '');
  if (!title) title = imageNames.length ? imageNames[0].replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') : '';
  const scored = candidatesScored_(rows, i, col, 8);
  const nearby = scored.filter((x) => x.score > 0.12).slice(0, 5).map((x) => String(x.row[col('id')]));
  let topic = String(row[col('topic')] || '').trim().toLowerCase();
  if (!topic) {
    const best = scored.find((x) => x.score > 0.2 && usedTopic_(x.row, col));
    topic = best ? usedTopic_(best.row, col).toLowerCase() : 'unsorted';
  }
  const alt = {};
  for (const n of imageNames) alt[n] = n.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return { title, topic, is_new_topic: !counts[topic], same_as: '', nearby, alt };
}

function candidatesScored_(rows, i, col, n) {
  candidates_(rows, i, col, 1); // warms the cache
  const me = tfidfCache_.vecs[i];
  const out = [];
  rows.forEach((r, j) => {
    if (j === i || !r[col('id')] || !r[col('auto title')]) return;
    let dot = 0; const v = tfidfCache_.vecs[j]; for (const w in me) if (v[w]) dot += me[w] * v[w];
    out.push({ score: dot, row: r });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

// ---------------------------------------------------------------- AI providers
function aiProvider_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('ANTHROPIC_API_KEY')) return 'Claude';
  if (p.getProperty('GEMINI_API_KEY')) return 'Gemini';
  return 'none';
}

function ai_(text, content, maxTokens) {
  const prov = aiProvider_();
  if (prov === 'Claude') return claude_(text, content, maxTokens);
  if (prov === 'Gemini') return gemini_(text, content, maxTokens);
  throw new Error('No AI key set');
}

function claude_(text, content, maxTokens) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL') || 'claude-haiku-4-5';
  const body = { model, max_tokens: maxTokens || 600, messages: [{ role: 'user', content: text ? [{ type: 'text', text }] : content }] };
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(body),
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude ' + code + ': ' + res.getContentText().slice(0, 200));
  const data = JSON.parse(res.getContentText());
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

// Google's Gemini API has a free tier that is plenty for a garden
// (get a key at aistudio.google.com). Same prompt, different envelope.
function gemini_(text, content, maxTokens) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  const model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const parts = text ? [{ text }] : content.map((c) => c.type === 'image'
    ? { inline_data: { mime_type: c.source.media_type, data: c.source.data } }
    : { text: c.text });
  // thinkingBudget 0: the answer is a small JSON object, no need to spend the output budget thinking
  const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens || 600, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } } };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body) });
    if (res.getResponseCode() !== 429 && res.getResponseCode() < 500) break;
    Utilities.sleep(15000 * (attempt + 1)); // free tier: a handful of requests a minute
  }
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Gemini ' + code + ': ' + res.getContentText().slice(0, 200));
  const data = JSON.parse(res.getContentText());
  const cand = (data.candidates || [])[0];
  Utilities.sleep(6500); // stay under the free tier's requests-per-minute limit
  return cand && cand.content ? (cand.content.parts || []).map((p) => p.text || '').join('') : '';
}

// ---------------------------------------------------------------- GitHub
function github_(method, path, payload) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN'), repo = props.getProperty('GITHUB_REPO');
  if (!token || !repo) throw new Error('GitHub not set up. Run Garden ▸ Set up');
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + path, {
    method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: payload ? JSON.stringify(payload) : undefined,
  });
  const code = res.getResponseCode();
  if (code === 404 && method === 'GET') return null;
  if (code >= 300) throw new Error('GitHub ' + code + ': ' + res.getContentText().slice(0, 200));
  return res.getContentText() ? JSON.parse(res.getContentText()) : {};
}

function putFile_(path, base64, message) {
  const cur = github_('GET', '/contents/' + encodeURI(path));
  if (cur && cur.content && cur.content.replace(/\n/g, '') === base64) return false;
  github_('PUT', '/contents/' + encodeURI(path), { message, content: base64, sha: cur ? cur.sha : undefined });
  return true;
}

function pushJson_(json, filed, images) {
  const text = JSON.stringify(json, null, 2) + '\n';
  // only push when something other than the timestamp changed
  const props = PropertiesService.getScriptProperties();
  const sig = hash_(JSON.stringify(Object.assign({}, json, { tended: '' })));
  if (props.getProperty('LAST_SIG') === sig && !images) return false;
  putFile_('data/garden.json', Utilities.base64Encode(Utilities.newBlob(text).getBytes()), `tend: ${filed} filed, ${images} images`);
  props.setProperty('LAST_SIG', sig);
  return true;
}

// ---------------------------------------------------------------- garden.json
function buildGardenJson_(rows, col, topics) {
  const ss = SpreadsheetApp.getActive();
  const st = ss.getSheetByName(SHEET_SETTINGS);
  const settings = {};
  if (st && st.getLastRow() > 1) for (const [k, v] of st.getRange(2, 1, st.getLastRow() - 1, 2).getValues()) settings[String(k).trim().toLowerCase()] = String(v).trim();
  const fmt = (d) => d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(d || '');
  const thoughts = rows.filter((r) => r[col('id')] && String(r[col('thought')] || '').trim()).map((r) => {
    const pub = !(r[col('published')] === false || String(r[col('published')]).toUpperCase() === 'FALSE');
    const text = String(r[col('thought')] || '');
    const extra = String(r[col('image or link')] || '').trim();
    const full = extra && !text.includes(extra) ? extra + '\n' + text : text;
    let alt = {}; try { alt = JSON.parse(r[col('_alt')] || '{}'); } catch (e) {}
    let link = null; try { link = r[col('_link')] ? JSON.parse(r[col('_link')]) : null; } catch (e) {}
    const images = full.split('\n').map((l) => l.trim()).filter((l) => IMAGE_RE.test(l)).map((f) => ({ file: f.replace(/\.(heic|heif)$/i, '.jpg'), alt: alt[f] || '' }));
    const text2 = full.replace(/\.(heic|heif)$/gim, '.jpg');
    return {
      id: String(r[col('id')]), text: text2, title: String(r[col('title')] || r[col('auto title')] || '').trim(),
      topic: usedTopic_(r, col), planted: fmt(r[col('planted')]), tended: fmt(r[col('tended')]),
      stage: String(r[col('auto stage')] || 'seedling'), nearby: String(r[col('nearby')] || '').split(',').map((s) => s.trim()).filter(Boolean),
      status: String(r[col('status')] || '').startsWith('filing') ? 'filing' : 'filed', published: pub,
      titleBy: r[col('title')] ? 'you' : 'garden', topicBy: r[col('topic')] ? 'you' : 'garden', stageBy: String(r[col('stage')] || '').trim() ? 'you' : 'garden',
      images: images.length ? images : undefined, link: link || undefined,
    };
  });
  return {
    tended: new Date().toISOString(),
    site: { name: settings['site name'] || 'digital garden', author: settings['author'] || '', tagline: settings['tagline'] || 'welcome to my digital garden!', welcome: settings['welcome'] || '', about: settings['about'] || DEFAULT_ABOUT },
    thoughts,
    topics: topics.map((t) => ({ name: t.name, firstPlanted: fmt(t.firstPlanted), mergedFrom: t.aliases, suggested: t.suggests || '' })),
  };
}
