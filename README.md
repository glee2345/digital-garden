# digital garden

A personal digital garden that files itself. You type thoughts into a Google Sheet (or drop
photos in a Drive folder); a script in the sheet names them, finds their neighbors, and
publishes the site. Nothing here needs editing day to day.

**How it flows**

```
Google Sheet  ──(hourly "tend", or Garden ▸ Tend now)──▶  data/garden.json + images/
                                                                   │
                                                        GitHub Actions builds the site
                                                                   │
                                                              GitHub Pages
```

## One-time setup

You'll do these once. Each is a copy-paste, no coding.

### 1. An Anthropic API key (the filing brain)
1. Go to <https://console.anthropic.com/> → API keys → Create key. Copy it (starts with `sk-ant-`).
2. Under Billing, add a payment method and set a **monthly spend limit of $5**. Real usage is cents.

### 2. A GitHub token (lets the sheet publish)
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate.
2. Name: `garden`. Expiration: 1 year (you'll make a new one then). Repository access: **Only select repositories** → this one.
3. Permissions → Repository → **Contents: Read and write**. Generate, copy the token.

### 3. Turn on GitHub Pages
Repository → Settings → Pages → Build and deployment → Source: **GitHub Actions**. That's all.
When you have a domain: add it under Custom domain there, and add a file named `CNAME` at the
repo root containing just the domain (Settings → Pages does this for you when you save the domain).

### 4. Put the script in the sheet
1. Open the sheet → Extensions → **Apps Script**.
2. Delete whatever is in `Code.gs`, paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs), save (💾), close the tab.
3. Reload the sheet. A **Garden** menu appears. Choose **Garden ▸ Set up (first time)** and paste the three things it asks for (the API key, the GitHub token, and `owner/repo` — e.g. `glee2345/digital-garden`).
   The first run asks you to authorize the script for your Google account; approve it (it's your own script reading your own sheet and Drive folder).
4. **Garden ▸ Check connections** should say ok three times.
5. **Garden ▸ Tend now**. Within a minute or two the site rebuilds.

From then on it tends itself every hour.

## Day to day

- **A thought**: type it in column A of `thoughts`. That's it.
- **A link**: paste the URL on its own line, your notes after it. The site pulls the preview.
- **A photo**: drop it in the `images` folder (phone: share → Drive → that folder). It becomes a thought on its own; or mention the filename on its own line inside a thought to place it there. Several filenames in a row make a gallery; a line starting with `—` right after is a caption.
- **Fix the garden**: type in the cream `title` / `topic` / `stage` columns to override. Untick `published` to keep something off the site.
- **Topics**: the `topics` tab fills itself. `rename to` renames everywhere (old links redirect). `merge into` folds one into another. `garden suggests` is where it proposes merges — approve by typing the name into `merge into`.
- **Site name, your name, the tagline, and the intro on the home page**: the `settings` tab. The intro is plain text; a blank line starts a new paragraph.

## The pieces

| Where | What |
|---|---|
| `apps-script/Code.gs` | the tending script (lives in the sheet; this copy is for reference) |
| `data/garden.json` | everything the site knows, written by the script |
| `images/` | originals pushed by the script; the build resizes them |
| `src/` | the site (Astro). `src/lib/roots.js` grows the roots drawing |
| `.github/workflows/deploy.yml` | builds and publishes on every change |

## Working on it locally (optional)

```
npm install
npm run dev      # http://localhost:4321/digital-garden/
npm run build
```
Design reference: the Claude Design canvas this was built from.
