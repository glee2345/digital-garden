import { loadGarden } from '../lib/garden.js';
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function GET({ site }) {
  const g = loadGarden();
  const origin = String(site || '').replace(/\/$/, '');
  const items = g.stream.filter((t) => !t.filing).slice(0, 30).map((t) => `
    <item>
      <title>${esc(t.title)}</title>
      <link>${origin}${t.url}</link>
      <guid isPermaLink="true">${origin}${t.url}</guid>
      <pubDate>${new Date(t.planted + 'T12:00:00Z').toUTCString()}</pubDate>
      ${t.topic ? `<category>${esc(t.topic)}</category>` : ''}
      <description>${esc(t.excerpt || t.title)}</description>
    </item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${esc(g.site.name)}</title><link>${origin}/</link><description>${esc(g.site.tagline)}</description>${items}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
