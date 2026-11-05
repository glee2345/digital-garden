import { loadGarden, fmtDate } from '../lib/garden.js';
export function GET() {
  const g = loadGarden();
  const idx = g.thoughts.filter((t) => !t.filing).map((t) => ({
    id: t.id, url: t.url, title: t.title, topic: t.topic, planted: fmtDate(t.planted),
    text: String(t.text || '').replace(/\s+/g, ' ').slice(0, 600),
  }));
  return new Response(JSON.stringify(idx), { headers: { 'content-type': 'application/json' } });
}
