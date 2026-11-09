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

### 1. The filing brain (optional)
The filing step (title, topic, nearby, alt text) can run three ways. Pick one:
- **No key.** Free, nothing to sign up for. Titles are the first sentence, nearby thoughts come
  from word overlap, and the topic is whatever you type in the `topic` column (otherwise it lands
  in `unsorted` for you to sort later).
- **Google Gemini, free tier.** <https://aistudio.google.com/> → Get API key (starts with `AIza`).
  No card needed. Does the full automatic filing, including looking at images.
- **Anthropic.** <https://console.anthropic.com/> → API keys → Create key (starts with `sk-ant-`).
  Add a card and set a monthly spend limit of $5; real usage is cents.

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
3. Reload the sheet. A **Garden** menu appears. Choose **Garden ▸ Set up (first time)** and paste what it asks for (the API key or blank, the GitHub token, and `owner/repo` — e.g. `glee2345/digital-garden`).
   The first run asks you to authorize the script for your Google account; approve it (it's your own script reading your own sheet and Drive folder).
4. **Garden ▸ Check connections** should say ok for GitHub and the images folder (and for the AI if you set a key).
5. **Garden ▸ Tend now**. Within a minute or two the site rebuilds.

From then on it tends itself every hour.

## Day to day

- **A thought**: type it in column A of `thoughts`. That's it.
- **A link**: paste the URL on its own line, your notes after it. The site pulls the preview. YouTube, Vimeo and TikTok links get a wide thumbnail with a play mark; Instagram links show the account name and the start of the caption. A link pasted as `[url]()` or `<url>` works too.
- **Lists and line breaks**: a new line in the cell (⌘/Ctrl+Enter) stays a new line on the site. Lines starting with `-`, `*` or `•` become a bulleted list; `1.` `2.` become a numbered one.
- **A photo**: drop it in the `images` folder (phone: share → Drive → that folder). It becomes a thought on its own; or mention the filename on its own line inside a thought to place it there. Several filenames in a row make a gallery; a line starting with `—` right after is a caption.
- **Fix the garden**: type in the cream `title` / `topic` / `stage` columns to override. Untick `published` to keep something off the site.
- **Topics**: the `topics` tab fills itself. `rename to` renames everywhere (old links redirect). `merge into` folds one into another. `garden suggests` is where it proposes merges — approve by typing the name into `merge into`.
- **Connections** go both ways: if the garden files B next to A, A's page lists B under "closest to this one" as well. Two or more connections (or an edit) move a thought from seedling to growing; type `evergreen` in `stage` yourself.
- **Site name, your name, the home-page welcome, and the "about" text**: the `settings` tab. `about` is plain text; a blank line starts a new paragraph. The "how this site was made" section under it is fixed.

## The pieces

| Where | What |
|---|---|
| `apps-script/Code.gs` | the tending script (lives in the sheet; this copy is for reference) |
| `data/garden.json` | everything the site knows, written by the script |
| `images/` | originals pushed by the script; the build resizes them |
| `src/` | the site (Astro). `src/lib/asciimap.js` draws the map |
| `public/flowers.js` | the home-page bouquet: one stem per topic, one bloom per thought, small topics hang as amaranth |
| `.github/workflows/deploy.yml` | builds and publishes on every change |

## Working on it locally (optional)

```
npm install
npm run dev      # http://localhost:4321/digital-garden/
npm run build
```
Design reference: the Claude Design canvas this was built from.
