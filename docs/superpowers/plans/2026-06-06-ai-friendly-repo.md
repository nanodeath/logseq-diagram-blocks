# AI-Friendly PR Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automated agents able (and required) to produce screenshot evidence on PRs: a deterministic harness-screenshot command, an agent-facing PR contract (AGENTS.md), CI, a PR template, and a spike toward real-Logseq capture.

**Architecture:** Tier A = Playwright (headless Chromium) drives the existing vite dev harness (`dev/index.html`) and writes committed goldens to `docs/screenshots/`. Tier B (spike-gated, this plan only spikes it) = CDP-attach to Flatpak Logseq for realm-true captures. AGENTS.md is the canonical agent guide; CLAUDE.md is an `@AGENTS.md` pointer.

**Tech Stack:** Playwright (devDependency, Chromium only), vite JS API, GitHub Actions, pnpm. Spec: `docs/superpowers/specs/2026-06-06-ai-friendly-repo-design.md`.

**Reviewer-facing context:** goldens are human-reviewed image diffs, NOT CI-compared baselines. Cross-machine font drift is expected; the contract forbids regenerating goldens in PRs that don't intentionally change rendered output.

---

### Task 1: Tier A screenshot script + goldens

**Files:**
- Create: `scripts/screenshot.mjs`
- Create: `docs/screenshots/*.png` (generated)
- Modify: `package.json` (via `pnpm pkg set`, plus `pnpm add`)

Harness facts the script relies on (verified against current source):
- `dev/index.html` has `<button id="theme-toggle">` and `<div id="gallery">`; `dev/harness.ts` appends one `section.fixture` per entry in `dev/fixtures.ts`, each containing an `h3` (fixture name) and a render target.
- A successful render produces `.diagram-blocks-figure` containing the `svg` plus a `.diagram-blocks-toolbar` (opacity 0 until figure `:hover`; buttons have `data-action="fullscreen"` / `data-action="copy"`).
- A failed render (the `broken` fixture) produces `.diagram-blocks-error`.
- The fullscreen overlay is `.diagram-blocks-overlay` on `document.body`; Escape closes it.
- Theme toggling re-renders every figure asynchronously (ThemeStore subscription replaces each figure's `svg`), so "old svg gone" is the reliable re-render signal.
- `src/viewer/copy-png.ts` exports `browserStrategies.toPng(svgText, scale): Promise<Blob>` — the copy-as-PNG pipeline minus the clipboard. Vite dev serves it at `/src/viewer/copy-png.ts` with on-the-fly TS transform, so `page.evaluate` can dynamic-import it.

- [ ] **Step 1: Add Playwright devDependency and Chromium**

```bash
pnpm add -D playwright
pnpm exec playwright install chromium
```

Expected: `package.json` devDependencies gains `playwright` (registry-resolved version — do NOT hand-write a version), and Chromium downloads (~150MB, one-time per machine).

- [ ] **Step 2: Write the script**

Create `scripts/screenshot.mjs`:

```js
// Regenerates the committed screenshot goldens in docs/screenshots/ from the
// dev harness. Headless-safe: no display server, no clipboard. See
// docs/superpowers/specs/2026-06-06-ai-friendly-repo-design.md (tier A).
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const OUT = 'docs/screenshots'
const TOOLBAR_FADE_MS = 250 // viewer.css opacity transition is 120ms; double it
const PNG_SCALE = 2 // matches the plugin's default pngScale setting

// Console noise the broken fixture is EXPECTED to produce (mermaid parse
// failure). Anything else fails the run.
const ALLOWED_CONSOLE_ERRORS = [/parse error/i, /syntax error/i]

const problems = []
const written = []

const server = await createServer({ logLevel: 'silent' })
await server.listen()
const base = server.resolvedUrls.local[0] // e.g. http://localhost:5173/

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2, // crisp goldens; doubles as README screenshot source
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  if (ALLOWED_CONSOLE_ERRORS.some((re) => re.test(m.text()))) return
  problems.push(`console.error: ${m.text()}`)
})

mkdirSync(OUT, { recursive: true })
await page.goto(base + 'dev/index.html')

// Every fixture section must settle into a figure (svg) or an error card.
await page.waitForFunction(() => {
  const sections = [...document.querySelectorAll('#gallery section.fixture')]
  return (
    sections.length > 0 &&
    sections.every((s) => s.querySelector('.diagram-blocks-figure svg, .diagram-blocks-error'))
  )
})

const sectionCount = await page.locator('#gallery section.fixture').count()

/** Element-screenshot every fixture (figure or error card) in the current theme. */
async function captureAll(theme) {
  for (const section of await page.locator('#gallery section.fixture').all()) {
    const name = (await section.locator('h3').innerText()).trim()
    const isFigure = (await section.locator('.diagram-blocks-figure').count()) > 0
    const el = section.locator('.diagram-blocks-figure, .diagram-blocks-error').first()
    if (isFigure) {
      await el.hover() // reveal the toolbar so goldens document it
      await page.waitForTimeout(TOOLBAR_FADE_MS)
    }
    const path = join(OUT, `${name}-${theme}.png`)
    await el.screenshot({ path })
    written.push(path)
  }
}

await captureAll('light')

// Toggle to dark. Mark the current svgs; re-render replaces them, so the
// marker vanishing means every figure has re-rendered in the new theme.
await page.evaluate(() => {
  for (const svg of document.querySelectorAll('#gallery .diagram-blocks-figure svg')) {
    svg.setAttribute('data-stale', '1')
  }
  document.getElementById('theme-toggle').click()
})
await page.waitForFunction(() => !document.querySelector('#gallery svg[data-stale]'))

await captureAll('dark')

// Fullscreen overlay golden (flowchart, dark).
const flowchart = page
  .locator('#gallery section.fixture')
  .filter({ has: page.locator('h3', { hasText: 'flowchart' }) })
await flowchart.locator('.diagram-blocks-figure').hover()
await page.waitForTimeout(TOOLBAR_FADE_MS)
await flowchart.locator('button[data-action="fullscreen"]').click()
await page.locator('.diagram-blocks-overlay').waitFor()
await page.waitForTimeout(TOOLBAR_FADE_MS)
{
  const path = join(OUT, 'overlay-dark.png')
  await page.screenshot({ path })
  written.push(path)
}
await page.keyboard.press('Escape')
await page.locator('.diagram-blocks-overlay').waitFor({ state: 'hidden' })

// Copy-as-PNG golden: run the real toPng pipeline (clipboard excluded) on the
// flowchart svg. Catches "renders inline but drops content in copied PNGs"
// regressions — SVG-as-image loads no external resources.
const pngBase64 = await page.evaluate(
  async ({ scale }) => {
    const { browserStrategies } = await import('/src/viewer/copy-png.ts')
    const section = [...document.querySelectorAll('#gallery section.fixture')].find(
      (s) => s.querySelector('h3')?.textContent?.trim() === 'flowchart',
    )
    const svg = section?.querySelector('.diagram-blocks-figure svg')
    if (!svg) throw new Error('flowchart svg not found')
    const blob = await browserStrategies.toPng(svg.outerHTML, scale)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(bin)
  },
  { scale: PNG_SCALE },
)
{
  const path = join(OUT, 'copy-flowchart.png')
  writeFileSync(path, Buffer.from(pngBase64, 'base64'))
  written.push(path)
}

await browser.close()
await server.close()

// ── Validation ──────────────────────────────────────────────────────────────
const expected = sectionCount * 2 + 2 // fixtures × {light,dark} + overlay + copy
if (written.length !== expected) {
  problems.push(`expected ${expected} screenshots, wrote ${written.length}`)
}
for (const f of written) {
  if (statSync(f).size === 0) problems.push(`zero-byte output: ${f}`)
}

if (problems.length > 0) {
  console.error('screenshot run FAILED:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`wrote ${written.length} screenshots to ${OUT}/`)
```

- [ ] **Step 3: Add the npm script**

```bash
pnpm pkg set scripts.screenshot="node scripts/screenshot.mjs"
```

- [ ] **Step 4: Run it and inspect**

```bash
pnpm screenshot && ls -la docs/screenshots/
```

Expected: `wrote 14 screenshots to docs/screenshots/` (6 fixtures × 2 themes + overlay-dark + copy-flowchart), exit 0. Open 2–3 PNGs (Read tool renders them) and verify: light/dark themes differ, toolbar visible on hovered figures, `broken-*.png` shows the error card, `overlay-dark.png` shows the fullscreen overlay, `copy-flowchart.png` is the diagram on its own.

If the run flags console errors beyond the parse-error allowlist, investigate before widening the allowlist — widen only for noise provably caused by the intentionally-broken fixture.

- [ ] **Step 5: Verify the failure mode**

Temporarily break a good fixture, confirm the script fails, revert:

```bash
sed -i "s/graph TD\\\\n  A\\[Start\\]/graph XX TD/" dev/fixtures.ts
pnpm screenshot; echo "exit: $?"
git checkout dev/fixtures.ts
```

Expected: non-zero exit (the `flowchart` section settles into an error card, so the overlay/copy steps can't find its figure, and/or the new parse failure changes the count). The point is: a regression that breaks rendering cannot silently produce goldens. After revert, `pnpm screenshot` passes again.

- [ ] **Step 6: Commit**

```bash
git add scripts/screenshot.mjs package.json pnpm-lock.yaml docs/screenshots/
git commit -m "feat: pnpm screenshot — committed harness goldens via headless Playwright"
```

---

### Task 2: AGENTS.md + CLAUDE.md pointer

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Write AGENTS.md**

Create `AGENTS.md` with exactly this content:

```markdown
# AGENTS.md — guide for AI agents working on this repo

Logseq plugin rendering ```mermaid fenced blocks as interactive diagrams.
Read this before making any change; the PR contract below is not optional.

## Architecture (three layers — keep them separated)

- `src/core/` — pure logic, no DOM, no Logseq. Types, `ThemeStore`, `MermaidRenderer` (injected `MermaidApi`).
- `src/viewer/` — framework-free DOM: figure/toolbar/error card (`render-into.ts`), fullscreen overlay (`overlay.ts`), copy-as-PNG (`copy-png.ts`), `viewer.css`.
- `src/adapter/` + `src/host/` + `src/main.ts` — the ONLY Logseq-coupled code.

## ⚠️ Required reading before touching adapter/host code

Before modifying `src/adapter/`, `src/host/`, `src/main.ts`, or `src/viewer/viewer.css`:
**read `docs/spike-findings.md` §6 (iframe realm semantics).**

The plugin's modules execute in a hidden sandbox iframe; rendering happens in the
host page. Bare `document` / `window` / `navigator` are the IFRAME's — code using
them works in the dev harness (single realm) and silently breaks in Logseq.
Derive realm objects from mounted elements (`el.ownerDocument`, `.defaultView`).
This bug class shipped six times during initial development. Don't be seven.

## Commands

| Command | What |
| --- | --- |
| `pnpm test` | vitest unit tests |
| `pnpm build` | typecheck + production build |
| `pnpm dev:harness` | interactive dev harness (browser, no Logseq) |
| `pnpm screenshot` | regenerate tier-A goldens in `docs/screenshots/` (headless) |
| `pnpm screenshot:logseq` | tier-B real-Logseq captures (NOT YET BUILT — spike pending; use PR-contract #3's fallback) |

One-time setup: `pnpm install && pnpm exec playwright install chromium`.

## PR contract

Every PR must satisfy ALL of:

1. **Tests and build pass.** `pnpm test` and `pnpm build` locally; CI re-runs both.
2. **Screenshot evidence is required, not optional.** If the change affects
   rendered output (diagrams, toolbar, overlay, error card, themes, CSS):
   run `pnpm screenshot`, commit the changed goldens, and say in the PR body
   which goldens changed and what to look for in the image diffs.
   A render-affecting PR without updated goldens is incomplete.
3. **Host-integration changes need tier B too.** If the change touches
   `src/adapter/`, `src/host/`, `src/main.ts`, `viewer.css`, or any
   realm-adjacent behavior: also run `pnpm screenshot:logseq` (real Logseq).
   If tier B is unavailable on this host, the PR body MUST say so explicitly
   and request a manual Logseq check from the maintainer.
4. **No golden churn.** Never regenerate goldens in a PR that doesn't
   intentionally change rendered output — cross-machine font drift produces
   pixel diffs that are noise, not signal.
5. **Honest reporting.** If verification was skipped or failed, the PR says so.

## Issue workflow (labels)

- `ai-ready` — maintainer-approved for AI implementation; pick these up.
- `ai-wip` — an automation branch/PR exists for this issue; set it when you
  start, so other agents skip it.
- `ai-triaged` — an AI triage pass commented on the issue without implementing.
- Automation authors commits/PRs as **nanodeath-ai[bot]**, not a personal account.

## Conventions

- TypeScript: no `any`; prefer structured types over stringly-typed code.
- Dependencies: only via `pnpm add` / `pnpm remove` — never hand-edit versions
  into `package.json` (training-data versions are stale).
- `src/core/` stays Logseq-free and DOM-free; `src/viewer/` stays Logseq-free.
  New Logseq API surface goes in `src/adapter/` or `src/host/` only.
```

- [ ] **Step 2: Write CLAUDE.md**

Create `CLAUDE.md` containing exactly:

```markdown
@AGENTS.md
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs: AGENTS.md PR contract for AI agents; CLAUDE.md pointer"
```

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml` (toolchain mirrors `release.yml`):

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
```

Note: no screenshot steps in CI by design (goldens are human-reviewed; pixel
output is machine-dependent).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run tests + build on PRs and main"
```

- [ ] **Step 3: Verify on GitHub (after the branch is pushed)**

Once this plan's branch is pushed (or merged), confirm the workflow runs green:

```bash
gh run list --workflow=ci --limit 1
```

Expected: a `ci` run with conclusion `success`. (If executing on an unpushed
local branch, defer this step to the finishing phase and note it.)

---

### Task 4: PR template

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Write the template**

Create `.github/pull_request_template.md` with exactly:

```markdown
## Summary

<!-- What changed and why. Link the issue (e.g. "Fixes #1"). -->

## Screenshots

<!-- REQUIRED — pick one:
     • List which goldens under docs/screenshots/ changed and what to look for
       in the image diffs (Files Changed renders before/after).
     • Or state: "No rendered output change." -->

## Verification

- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] Tier A goldens regenerated (`pnpm screenshot`) — or N/A: no rendered output change
- [ ] Tier B real-Logseq capture (`pnpm screenshot:logseq`) — only for host-integration
      changes; if unavailable, manual check requested in Summary
```

- [ ] **Step 2: Commit**

```bash
git add .github/pull_request_template.md
git commit -m "docs: PR template with required screenshots section"
```

---

### Task 5: Tier B spike — CDP into Flatpak Logseq

**Files:**
- Create: `docs/cdp-spike-findings.md`

Goal: validate (or refute) each spike-checklist item from the spec, write findings, and reach a go/no-go on building `pnpm screenshot:logseq`. **This task produces a findings doc, not the script** — the script gets its own follow-up plan informed by the findings.

⚠️ This spike launches/restarts Max's Logseq. **Coordinate with Max before starting** — his Logseq may be open with unsaved state, and a second instance can conflict on the graph lock.

- [ ] **Step 1: CDP flag pass-through**

```bash
flatpak run com.logseq.Logseq --remote-debugging-port=9222 &
sleep 8
curl -s http://localhost:9222/json/version
```

Expected if pass-through works: JSON containing `"webSocketDebuggerUrl"`.
If empty/refused: try `--remote-debugging-port=9222 --remote-allow-origins=*`, and check whether the Flatpak wraps args (`flatpak info --show-metadata com.logseq.Logseq`, look at the command/wrapper). Record exactly what worked or failed.

- [ ] **Step 2: Playwright connectOverCDP**

```bash
node -e "
import('playwright').then(async ({ chromium }) => {
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const pages = browser.contexts().flatMap((c) => c.pages())
  for (const p of pages) console.log('PAGE:', p.url())
  const app = pages.find((p) => p.url().includes('index.html') || p.url().startsWith('app://'))
  if (!app) throw new Error('no app page found — record the URL list above')
  await app.screenshot({ path: '/tmp/logseq-cdp.png' })
  console.log('screenshot ok')
  await browser.close()
})"
```

Expected: page URLs listed, `/tmp/logseq-cdp.png` shows the Logseq window. Read the PNG to confirm.

- [ ] **Step 3: Scratch graph feasibility**

Preferred: repo-local `e2e/graph/` containing `pages/fixtures.md` with the same fixture blocks as `dev/fixtures.ts`. Test: add that directory as a graph in Logseq (requires one manual Max action via UI — Flatpak needs filesystem access to the repo path; check `flatpak info --file-access=host com.logseq.Logseq`). Record: can Logseq open a graph inside the plugin's own repo without the plugin's file watcher or Logseq's indexer misbehaving? Fallback if not: `~/.local/share/logseq-diagram-blocks-e2e-graph/` seeded by script from repo files.

- [ ] **Step 4: Plugin reload scriptability**

In the CDP-connected app page, try in order and record which works:

```js
// (a) SDK reload, if exposed on the host page:
await app.evaluate(() => window.LSPluginCore?.reload('logseq-diagram-blocks'))
// (b) fallback: full app restart (kill + relaunch flatpak) — slower but always works
```

Also record how to detect "plugin finished re-rendering" (presence of `.diagram-blocks-figure svg` inside the rendered block on the fixtures page).

- [ ] **Step 5: Headless (Xvfb) variant**

```bash
pkill -f com.logseq.Logseq; sleep 2
xvfb-run -a flatpak run com.logseq.Logseq --remote-debugging-port=9222 --disable-gpu &
sleep 10
curl -s http://localhost:9222/json/version
```

Expected: same CDP JSON as Step 1, with no visible window. Repeat Step 2's screenshot to confirm rendering works under Xvfb. (Requires `xorg-x11-server-Xvfb` — `sudo dnf install xorg-x11-server-Xvfb` if missing; on the eventual mini-max host it's `apt`.)

- [ ] **Step 6: Write findings + go/no-go**

Write `docs/cdp-spike-findings.md`: one section per step above with the exact commands that worked/failed and observed output; end with a **Go / No-go** verdict for building `pnpm screenshot:logseq` and (if go) the chosen graph location + reload mechanism. If no-go: confirm AGENTS.md's tier-B fallback wording stands (it already covers "unavailable on this host").

- [ ] **Step 7: Commit**

```bash
git add docs/cdp-spike-findings.md
git commit -m "docs: CDP spike findings for real-Logseq screenshot capture"
```

---

## Execution notes

- Tasks 1–4 are independent of the spike and land regardless of its outcome; execute in order (AGENTS.md references the script name from Task 1).
- Work on a branch (e.g. `ai-friendly`); push and verify CI (Task 3 Step 3) during finishing.
- Task 5 requires coordination with Max (Logseq restart) — schedule it last and ask first.
```
