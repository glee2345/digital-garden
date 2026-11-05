import { defineConfig } from 'astro/config';
import { readFileSync, existsSync } from 'node:fs';

// Site URL: a CNAME file at the repo root (custom domain) wins; otherwise GitHub Pages.
const cname = existsSync('./CNAME') ? readFileSync('./CNAME', 'utf8').trim() : '';
const repo = process.env.GITHUB_REPOSITORY || 'glee2345/digital-garden';
const [owner, name] = repo.split('/');
const site = process.env.GARDEN_SITE || (cname ? `https://${cname}` : `https://${owner}.github.io`);
const base = process.env.GARDEN_BASE || (cname ? '/' : `/${name}`);

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  build: { format: 'directory' },
});
