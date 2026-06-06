# Tier-B Real-Logseq Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pnpm screenshot:logseq` — CDP-driven captures of the plugin rendering inside real Logseq (the realm-truth check), per the GO verdict in `docs/cdp-spike-findings.md`.

**Architecture:** A node script attaches to (or launches) Flatpak Logseq with `--remote-debugging-port`, ensures the repo-local `e2e/graph/` scratch graph is open, rebuilds + reloads the plugin, navigates to a fixtures page, element-screenshots every rendered block into `docs/screenshots/logseq/`, then clicks ⧉ on the flowchart and asserts the copy toast. Headless hosts use a manually spawned Xvfb + `--ozone-platform=x11` (spike Step 5 — `xvfb-run -a` does NOT work).

**Tech Stack:** Playwright `connectOverCDP`, Flatpak Logseq, Xvfb. Spike: `docs/cdp-spike-findings.md`. Spec: `docs/superpowers/specs/2026-06-06-ai-friendly-repo-design.md` (Component 2).

**Hard context (from the spike — do not rediscover):**
- Flatpak app id `com.logseq.Logseq`; CDP flag passes through cleanly; app page URL contains `electron.html`.
- The repo is mounted read-only in the sandbox EXCEPT `e2e/graph` (rw via nested override, already applied on this machine).
- Plugin is dev-installed from this checkout; `window.LSPluginCore.reload('logseq-diagram-blocks')` works and returns a Promise; the plugin loads `dist/index.html`, so **`pnpm build` before capture is mandatory** (branch-truth guard).
- `window.logseq.api` has 112 methods, including `get_current_graph` and `push_state`, but NO graph add/open — graph switching strategy is layered (Task 2 Step 3).
- Headless: manual `Xvfb :N`, then `flatpak run --nosocket=wayland --env=DISPLAY=:N --env=WAYLAND_DISPLAY= --env=ELECTRON_OZONE_PLATFORM_HINT=x11 com.logseq.Logseq --remote-debugging-port=<port> --disable-gpu --ozone-platform=x11`.
- Playwright is CommonJS; in standalone scripts import via the repo's node_modules (run scripts from the repo root).

**Human-in-the-loop:** After Task 1 lands, MAX must do the one-time "Add a graph" in Logseq pointing at `<repo>/e2e/graph/` (the flatpak override is already applied). Task 2 cannot be verified before that. Pause and ask.

---

### Task 1: e2e scratch graph + gitignore

**Files:**
- Create: `e2e/graph/logseq/config.edn`
- Create: `e2e/graph/pages/fixtures.md`
- Modify: `.gitignore`

- [ ] **Step 1: Create the graph skeleton**

`e2e/graph/logseq/config.edn`:

```edn
{:meta/version 1
 ;; e2e scratch graph for `pnpm screenshot:logseq` — see docs/cdp-spike-findings.md.
 ;; Committed files: this config + pages/fixtures.md. Everything else Logseq
 ;; writes here is gitignored.
 :default-templates {:journals ""}
 :journal/page-title-format "yyyy-MM-dd"}
```

`e2e/graph/pages/fixtures.md` — one mermaid block per fixture, MIRRORING `dev/fixtures.ts` exactly (same names, same code, same order). Use Logseq outline format: each fixture is a top-level bullet whose first line is the fixture name as **bold text**, with the fenced block as a child bullet (tab-indented, continuation lines tab+2-spaces). Content (transcribe the fixture bodies from `dev/fixtures.ts` — the `\n` escapes become real newlines):

````markdown
- **flowchart**
	- ```mermaid
	  graph TD
	    A[Start] --> B{Works?}
	    B -->|yes| C[Ship]
	    B -->|no| D[Fix]
	    D --> B
	  ```
- **sequence**
	- ```mermaid
	  sequenceDiagram
	    Alice->>Bob: Hello
	    Bob-->>Alice: Hi
	  ```
- **er**
	- ```mermaid
	  erDiagram
	    USER ||--o{ NOTE : writes
	    NOTE }o--|| PAGE : on
	  ```
- **mindmap**
	- ```mermaid
	  mindmap
	    root((plugin))
	      core
	      viewer
	      adapter
	  ```
- **html-labels**
	- ```mermaid
	  graph LR
	    A["<b>bold</b> label"] --> B
	  ```
- **fa-icons**
	- ```mermaid
	  flowchart TD
	    B["fab:fa-github for code"]
	    B-->C[fa:fa-ban forbidden]
	    B-->D(fa:fa-spinner)
	    B-->E(A far:fa-bell perhaps?)
	  ```
- **broken**
	- ```mermaid
	  graph TD
	    A --> --> B
	  ```
````

NOTE: `dev/fixtures.ts` stores diagram code with 2-space inner indentation after the first line (e.g. `graph TD\n  A[Start]`); preserve that relative indentation under the tab+2-space Logseq continuation prefix as shown. If `dev/fixtures.ts` has changed since this plan was written, mirror its CURRENT content and note the difference in your report.

- [ ] **Step 2: Gitignore Logseq's volatile writes**

Append to `.gitignore`:

```gitignore
# e2e scratch graph: only config.edn + pages/ are committed; Logseq writes the rest
e2e/graph/**
!e2e/graph/logseq/
!e2e/graph/logseq/config.edn
!e2e/graph/pages/
!e2e/graph/pages/**
```

Verify: `git status --short` shows only the two new files (plus .gitignore); then `mkdir -p e2e/graph/bak && touch e2e/graph/bak/x e2e/graph/logseq/graphs-txid.edn && git status --short` must show NO new entries; then `rm -r e2e/graph/bak e2e/graph/logseq/graphs-txid.edn`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore e2e/graph
git commit -m "feat: e2e scratch graph with fixture pages for tier-B captures"
```

**⛔ After this task: STOP. Max performs the one-time setup:** open Logseq → "Add a graph" → select `<repo>/e2e/graph/` → let it index → confirm the fixtures page renders diagrams → quit Logseq. Only then proceed to Task 2.

---

### Task 2: `scripts/screenshot-logseq.mjs`

**Files:**
- Create: `scripts/screenshot-logseq.mjs`
- Modify: `package.json` (via `pnpm pkg set scripts.screenshot:logseq="node scripts/screenshot-logseq.mjs"`)
- Create: `docs/screenshots/logseq/*.png` (generated)

This task REQUIRES live probing against the running app for two unknowns: (a) graph switching, (b) the toast DOM selector. The reference implementation below marks both PROBE points; resolve them against the live app and document what you found in code comments. Everything else is fixed by the spike — don't re-derive it.

- [ ] **Step 1: Write the reference implementation**

```js
// Tier-B captures: screenshots of the plugin rendering inside REAL Logseq via
// CDP. The realm-truth check — see docs/cdp-spike-findings.md and AGENTS.md
// PR-contract §3. Headless-capable via Xvfb (NOT xvfb-run; see spike Step 5).
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const PORT = Number(process.env.LOGSEQ_CDP_PORT ?? 9222)
const OUT = 'docs/screenshots/logseq'
const PLUGIN_ID = 'logseq-diagram-blocks'
const FIXTURES_PAGE = 'fixtures'
const GRAPH_DIR = resolve('e2e/graph')
const APP = 'com.logseq.Logseq'
const STARTUP_MS = 20_000
const RENDER_TIMEOUT_MS = 30_000

const problems = []
let launched = null // { proc, xvfb } when we started Logseq ourselves

// ── Branch-truth guard: the plugin loads dist/ from this checkout ───────────
execFileSync('pnpm', ['build'], { stdio: 'inherit' })
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  .split('\n').filter((l) => l && !l.includes('docs/screenshots/logseq')).length
if (dirty > 0 && !process.env.LOGSEQ_SCREENSHOT_ALLOW_DIRTY) {
  // Captures must reflect a commit, not loose disk state — otherwise the PR
  // evidence lies about what the branch renders. Set LOGSEQ_SCREENSHOT_ALLOW_DIRTY=1
  // to override during local iteration.
  console.error(`refusing to capture: working tree has ${dirty} dirty entries`)
  process.exit(1)
}

async function cdpAlive() {
  try { return (await fetch(`http://localhost:${PORT}/json/version`)).ok } catch { return false }
}

async function ensureLogseq() {
  if (await cdpAlive()) return // attach mode: a CDP-enabled Logseq is already up
  const headed = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  let xvfb = null
  let args
  if (headed) {
    args = ['run', APP, `--remote-debugging-port=${PORT}`]
  } else {
    // Spike Step 5: manual Xvfb + force X11 via Electron flag (xvfb-run fails).
    const display = ':93' // arbitrary high display; if it collides, picking a free one dynamically is the fix
    xvfb = spawn('Xvfb', [display, '-screen', '0', '1920x1080x24'], { stdio: 'ignore' })
    args = ['run', '--nosocket=wayland', `--env=DISPLAY=${display}`, '--env=WAYLAND_DISPLAY=',
      '--env=ELECTRON_OZONE_PLATFORM_HINT=x11', APP, `--remote-debugging-port=${PORT}`,
      '--disable-gpu', '--ozone-platform=x11']
  }
  const proc = spawn('flatpak', args, { stdio: 'ignore' })
  launched = { proc, xvfb }
  const deadline = Date.now() + STARTUP_MS
  while (Date.now() < deadline) {
    if (await cdpAlive()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Logseq CDP not reachable on :${PORT} after ${STARTUP_MS}ms.
If your normal Logseq is open (without the CDP flag), close it and re-run.`)
}

async function cleanup(browser) {
  await browser?.close().catch(() => {})
  if (launched) {
    execFileSync('flatpak', ['kill', APP], { stdio: 'ignore' })
    launched.xvfb?.kill()
  }
}

let browser
try {
  await ensureLogseq()
  browser = await chromium.connectOverCDP(`http://localhost:${PORT}`)
  const page = browser.contexts().flatMap((c) => c.pages())
    .find((p) => p.url().includes('electron.html'))
  if (!page) throw new Error('Logseq app page not found over CDP')

  // ── Ensure the e2e graph is open ──────────────────────────────────────────
  const graph = await page.evaluate(() => window.logseq.api.get_current_graph())
  if (!graph?.path || resolve(graph.path) !== GRAPH_DIR) {
    // PROBE(a): try API-based switching first. Inspect
    //   Object.keys(window.logseq.api).filter(k => /graph|repo/i.test(k))
    // for a switcher; if none works, drive the UI graph picker via CDP clicks;
    // document whichever works here. Until then, fail with instructions:
    throw new Error(`e2e graph not open (current: ${graph?.path ?? 'none'}).
Open Logseq once and switch to the graph at ${GRAPH_DIR} (one-time "Add a graph" if missing).`)
  }

  // ── Fresh plugin + fixtures page ──────────────────────────────────────────
  await page.evaluate((id) => window.LSPluginCore.reload(id), PLUGIN_ID)
  await page.evaluate((name) => window.logseq.api.push_state('page', { name }), FIXTURES_PAGE)

  // Expected: 7 fixture blocks total, exactly one of which (broken) errors.
  await page.waitForFunction(
    (n) => {
      const figs = document.querySelectorAll('.diagram-blocks-root .diagram-blocks-figure svg').length
      const errs = document.querySelectorAll('.diagram-blocks-root .diagram-blocks-error').length
      return figs + errs >= n && errs >= 1
    },
    7, { timeout: RENDER_TIMEOUT_MS },
  )

  mkdirSync(OUT, { recursive: true })
  const written = []

  // Screenshot each rendered block, named by its fixture bullet's bold label.
  const blocks = await page.evaluate(() => {
    // Each fixture bullet: bold name, child block holds .diagram-blocks-root.
    const out = []
    for (const root of document.querySelectorAll('.diagram-blocks-root')) {
      const el = root.querySelector('.diagram-blocks-figure, .diagram-blocks-error')
      if (!el) continue
      const bullet = root.closest('.ls-block')
      const labelEl = bullet?.parentElement?.closest('.ls-block')?.querySelector('b, strong')
      out.push(labelEl?.textContent?.trim() ?? `unnamed-${out.length}`)
    }
    return out
  })
  const els = page.locator('.diagram-blocks-root .diagram-blocks-figure, .diagram-blocks-root .diagram-blocks-error')
  for (let i = 0; i < blocks.length; i++) {
    const path = join(OUT, `${blocks[i]}.png`)
    await els.nth(i).screenshot({ path })
    written.push(path)
  }

  // ── Copy-toast assertion (PR #4 class of regressions) ────────────────────
  const flowFig = page.locator('.diagram-blocks-root .diagram-blocks-figure').first()
  await flowFig.hover()
  await flowFig.locator('button[data-action="copy"]').click()
  // PROBE(b): confirm the toast container selector in live Logseq
  // (logseq.UI.showMsg renders into the host page; inspect after clicking).
  const toast = page.locator('text=Diagram copied as PNG')
  await toast.waitFor({ timeout: 10_000 })
  {
    const path = join(OUT, 'copy-toast.png')
    await page.screenshot({ path })
    written.push(path)
  }

  for (const f of written) {
    if (statSync(f).size === 0) problems.push(`zero-byte: ${f}`)
  }
  if (written.length < 8) problems.push(`expected ≥8 captures, wrote ${written.length}`)
  if (problems.length) throw new Error('capture problems:\n' + problems.map((p) => '  - ' + p).join('\n'))
  console.log(`wrote ${written.length} captures to ${OUT}/`)
} finally {
  await cleanup(browser)
}
```

- [ ] **Step 2: Add the npm script**

```bash
pnpm pkg set scripts.screenshot:logseq="node scripts/screenshot-logseq.mjs"
```

- [ ] **Step 3: Live verification — attach mode (Max's desktop, graph already added)**

Precondition: Max's regular Logseq is CLOSED. Launch a CDP-enabled instance yourself, let it open (it reopens the last graph — if Max just did the one-time setup, that's the e2e graph), then run:

```bash
flatpak run com.logseq.Logseq --remote-debugging-port=9222 &
sleep 12
pnpm screenshot:logseq
```

Resolve PROBE(a) and PROBE(b) here against the live app. Expected: `wrote 8 captures to docs/screenshots/logseq/` (7 fixtures + copy-toast). Read `flowchart.png`, `broken.png`, `fa-icons.png`, `copy-toast.png` with the Read tool: flowchart shows a real Logseq block (bullet, Logseq theme background) with the diagram; broken shows the error card; fa-icons shows actual icons; copy-toast shows the success toast. Kill the instance after (`flatpak kill com.logseq.Logseq`).

- [ ] **Step 4: Live verification — launch + headless mode**

With NO Logseq running, run with a blanked display env to force the Xvfb path:

```bash
DISPLAY= WAYLAND_DISPLAY= pnpm screenshot:logseq
```

Expected: same 8 captures, no visible window, no leftover processes after (`flatpak ps` empty, no Xvfb). If Xvfb isn't installed, install per repo convention (`sudo -A` with the zenity askpass and a clear SUDO_REASON).

- [ ] **Step 5: Commit**

```bash
git add scripts/screenshot-logseq.mjs package.json docs/screenshots/logseq
git commit -m "feat: pnpm screenshot:logseq — tier-B captures from real Logseq via CDP"
```

---

### Task 3: AGENTS.md + spec updates

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-06-06-ai-friendly-repo-design.md`

- [ ] **Step 1: AGENTS.md command table**

Replace the `screenshot:logseq` row with:

```markdown
| `pnpm screenshot:logseq` | tier-B captures from REAL Logseq into `docs/screenshots/logseq/` (needs one-time setup: see `docs/cdp-spike-findings.md`; falls back per PR-contract #3 on unprepared hosts) |
```

- [ ] **Step 2: AGENTS.md one-time setup note**

After the existing "One-time setup:" line, add:

```markdown
Tier-B one-time setup (per machine): `flatpak override --user --filesystem=$PWD/e2e/graph com.logseq.Logseq`, then add `e2e/graph/` as a graph in Logseq once. Headless hosts also need Xvfb installed.
```

- [ ] **Step 3: Spec status note**

In the spec's Component 2 section, change "**This part is spike-gated**" to "**Built** (see `docs/superpowers/plans/2026-06-06-tier-b-screenshot-logseq.md`); spike checklist below retained for the record." Leave the rest of the section unchanged.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-06-06-ai-friendly-repo-design.md
git commit -m "docs: tier-B screenshot:logseq is built — update AGENTS.md + spec"
```

---

## Execution notes

- Sequential tasks; the ⛔ pause after Task 1 (Max's one-time graph add) is mandatory.
- Task 2's implementer should expect to iterate on the two PROBE points; everything else is settled by the spike — re-deriving it is wasted effort.
- All commits carry the standard `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Branch: `tier-b-screenshots`; finish via superpowers:finishing-a-development-branch.
