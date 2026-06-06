// Tier-B captures: screenshots of the plugin rendering inside REAL Logseq via
// CDP. The realm-truth check — see docs/cdp-spike-findings.md and AGENTS.md
// PR-contract §3. Headless-capable via Xvfb (NOT xvfb-run; see spike Step 5).
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const PORT = Number(process.env.LOGSEQ_CDP_PORT ?? 9222)
const OUT = 'docs/screenshots/logseq'
const PLUGIN_ID = 'logseq-diagram-blocks'
const FIXTURES_PAGE = 'fixtures'
// realpathSync resolves symlinks — /home/max/Projects/logseq-graph-block is a
// symlink to /mnt/Data/Projects/logseq-graph-block on this machine; Logseq
// stores the graph path via the symlink, so we compare realpaths to match.
const GRAPH_DIR = realpathSync(resolve('e2e/graph'))
const APP = 'com.logseq.Logseq'
const STARTUP_MS = 45_000 // spike observed ~18 s; practice shows occasional slower cold launches
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
  let spawnEnv = null // null = inherit parent env (headed mode); set in headless path
  if (headed) {
    args = ['run', APP, `--remote-debugging-port=${PORT}`]
  } else {
    // Spike Step 5: manual Xvfb + force X11 via Electron flag (xvfb-run fails).
    // xvfb-run fails because Logseq Flatpak declares sockets=wayland; even with
    // --nosocket=wayland and WAYLAND_DISPLAY="", Electron's Ozone detection
    // tries Wayland from the sandbox env. --ozone-platform=x11 as a direct
    // Electron CLI flag forces X11 before any detection logic runs.
    const display = ':93' // arbitrary high display; if it collides, picking a free one dynamically is the fix
    xvfb = spawn('Xvfb', [display, '-screen', '0', '1920x1080x24'], { stdio: 'ignore' })
    // Wait briefly for Xvfb to be ready before flatpak tries to connect to X11.
    await new Promise((r) => setTimeout(r, 1500))
    args = ['run', '--nosocket=wayland', `--env=DISPLAY=${display}`, '--env=WAYLAND_DISPLAY=',
      '--env=ELECTRON_OZONE_PLATFORM_HINT=x11', APP, `--remote-debugging-port=${PORT}`,
      '--disable-gpu', '--ozone-platform=x11']
    // Also set DISPLAY in the Node spawn env so flatpak's own process (which
    // inspects the outer environment for the X server connection) can find it.
    // Without this, flatpak reports "No colon found in DISPLAY=" because the
    // outer env has DISPLAY="" (blank, not just unset), confusing libglib.
    spawnEnv = { ...process.env, DISPLAY: display, WAYLAND_DISPLAY: '' }
  }
  const proc = spawn('flatpak', args, { stdio: 'ignore', ...(spawnEnv ? { env: spawnEnv } : {}) })
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
    // execFileSync throws on non-zero exit (e.g. if Logseq already exited);
    // catch it so we always reach the xvfb kill.
    try { execFileSync('flatpak', ['kill', APP], { stdio: 'ignore' }) } catch { /* already gone */ }
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

  // Wait for Logseq's JS runtime to fully initialize. CDP may connect while
  // the page is still loading; window.logseq is injected after the Logseq
  // app bootstraps, which can take several seconds after the CDP endpoint
  // becomes available (especially in headless/launch mode).
  await page.waitForFunction(() => !!window.logseq?.api, { timeout: RENDER_TIMEOUT_MS })

  // Wait for the graph to finish loading. After startup, Logseq indexes the
  // graph asynchronously; push_state before the router is ready throws
  // "No protocol method Router.match-by-name". Wait for both:
  //   1. get_current_graph() returns a path (graph DB loaded)
  //   2. The main content area has rendered some DOM (router initialized)
  await page.waitForFunction(
    () => {
      try {
        if (!window.logseq.api.get_current_graph()?.path) return false
        // The main content container is present when the SPA router is ready
        return document.querySelectorAll('#main-content-container, .cp__sidebar-main-layout').length > 0
      } catch { return false }
    },
    { timeout: RENDER_TIMEOUT_MS },
  )

  // ── Ensure the e2e graph is open ──────────────────────────────────────────
  const graph = await page.evaluate(() => window.logseq.api.get_current_graph())
  // Resolve symlinks in the reported graph path before comparing: Logseq may
  // store the path via a symlink (e.g. /home/max/Projects → /mnt/Data/Projects).
  const graphRealPath = graph?.path ? realpathSync(graph.path) : null
  if (!graphRealPath || graphRealPath !== GRAPH_DIR) {
    // PROBE(a) findings (2026-06-06): probed Object.keys(window.logseq.api)
    // .filter(k => /graph|repo/i.test(k)) — result: get_current_graph,
    // get_current_graph_configs, get_current_graph_favorites,
    // get_current_graph_recent, get_current_graph_templates, force_save_graph,
    // download_graph_db, download_graph_pages. No add_graph, open_graph, or
    // switch_graph method exists. push_state('graph', { name }) navigates to
    // the graph page in the sidebar but does NOT switch the active graph —
    // get_current_graph() still returns the old graph after calling it.
    // The UI graph picker (clicking the graph name in the sidebar) triggers a
    // full app reload that disconnects CDP, making automation impractical.
    // Verdict: no working programmatic graph switch. The happy path relies on
    // Logseq reopening the last-opened graph on startup (which is the e2e
    // graph since Max just did the one-time setup). This error guards against
    // a wrong graph being open and asks for manual intervention.
    throw new Error(`e2e graph not open (current real path: ${graphRealPath ?? graph?.path ?? 'none'}; expected: ${GRAPH_DIR}).
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

  // Neutralize the mouse before the fixture capture loop so no hover UI leaks
  // into captures nondeterministically. Move to (0,0) and wait > the CSS
  // opacity transition (120ms) to ensure any hover chrome fully fades out.
  // Fixture captures are deliberately hover-free; tier-A goldens document the toolbar.
  await page.mouse.move(0, 0)
  await new Promise((r) => setTimeout(r, 300))

  // Inject CSS to deterministically suppress hover/focus chrome during fixture
  // captures. Under Xvfb the X server's real cursor position (often screen centre)
  // re-asserts :hover on the window beneath CDP synthetic mouse moves, making
  // opacity-transition-based hover suppression unreliable across runs. A forced
  // display:none on the specific chrome elements is the only fully reliable guard.
  //
  // Two sets of chrome appear:
  //   1. .diagram-blocks-toolbar — our own plugin toolbar (expand ⛶ / copy ⧉)
  //   2. .ui-fenced-code-result .actions — Logseq's native fenced-code action
  //      buttons (two blue square icons: toggle-horizontal + source-code; confirmed
  //      by DOM probe 2026-06-06: SPAN.actions inside .ui-fenced-code-result holds
  //      two BUTTON.ui__button elements overlapping the figure's top-right corner)
  //
  // The style tag is removed before the copy-toast step so our own toolbar
  // button[data-action="copy"] is clickable via hover in the normal DOM flow.
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.id = 'tier-b-capture-suppress'
    s.textContent = [
      '.diagram-blocks-toolbar{opacity:0!important;visibility:hidden!important}',
      '.ui-fenced-code-result .actions{opacity:0!important;visibility:hidden!important}',
    ].join('\n')
    document.head.appendChild(s)
  })

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

  // Remove the chrome-suppression style before the interactive copy step so the
  // real toolbar is visible/clickable (hover + button[data-action="copy"] click).
  await page.evaluate(() => document.getElementById('tier-b-capture-suppress')?.remove())

  // ── Copy-toast assertion (PR #4 class of regressions) ────────────────────
  // PROBE(b) findings (2026-06-06): logseq.UI.showMsg renders a toast into
  // the host page (electron.html). The toast container lives outside the
  // plugin iframe — it is injected by the Logseq host into the main document.
  // Actual observed DOM structure (Logseq 0.10.15, Electron 38):
  //   <div class="notifications ui__notifications">
  //     <div class="ui__notifications-content enter-done">
  //       <div class="notification-area ...">
  //         <div class="p-4">
  //           <div class="flex items-start">
  //             <span class="ui__icon ... ls-icon-circle-check text-success">...</span>
  //             <div class="ml-3 w-0 flex-1 pt-2">
  //               <div class="text-sm leading-5 font-medium whitespace-pre-line">
  //                 Diagram copied as PNG          <-- text lives here
  //               </div>
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   </div>
  // Playwright's text= selector matches on visible text content of any element,
  // so `page.locator('text=Diagram copied as PNG')` targets the innermost div
  // correctly — no need to adjust the locator from the plan's reference impl.
  //
  // Note: this branch (tier-b) does NOT contain PR #4's data:-URL fix, so the
  // copy will fall back to 'SVG text copied to clipboard'. The run exits 1 with
  // the SVG-fallback problem — that is the expected, correct outcome on this
  // branch. The golden copy-toast.png shows the SVG fallback toast by design;
  // it flips to the PNG toast once PR #4 lands.
  // Strict PNG-toast assertion — detects PR #4 class of regressions where
  // toPng fails and the plugin silently falls back to SVG copy.
  //
  // The toast auto-dismisses in ~2 s via a CSS opacity transition. Every
  // approach that waits for Playwright's waitFor() then makes additional CDP
  // roundtrips (boundingBox, screenshot) races that dismiss window and loses.
  // The only reliable strategy is to freeze the toast at the browser level the
  // instant it appears, so no amount of async overhead can make it blank:
  //
  //   1. Before clicking copy, install a MutationObserver on the notification
  //      container that fires synchronously (same JS task) when a toast text
  //      node is inserted.
  //   2. The observer callback immediately pins the entire notification card
  //      with `transition:none!important; opacity:1!important` — killing the
  //      auto-dismiss CSS transition before it can even start — then records
  //      the toast text and its bounding box in window.__toastCapture.
  //   3. After the click, we poll window.__toastCapture from Node (cheap; the
  //      observer fires synchronously so it's usually set within one poll),
  //      then take a single clip-screenshot of the frozen, pinned card.
  //
  // This is robust across any CDP latency because the freeze happens entirely
  // inside the browser JS engine with no roundtrip between detection and pin.
  const toastPath = join(OUT, 'copy-toast.png')
  const vp = page.viewportSize() ?? { width: 1920, height: 1080 }

  // Install the MutationObserver before triggering the copy action.
  await page.evaluate(() => {
    window.__toastCapture = null
    const TEXTS = ['Diagram copied as PNG', 'SVG text copied to clipboard']
    const container = document.querySelector('.notifications, .ui__notifications')
    if (!container) return
    const obs = new MutationObserver(() => {
      if (window.__toastCapture) return // already captured
      for (const text of TEXTS) {
        // Walk all text nodes to find the toast message
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          if (node.textContent.includes(text)) {
            // Pin the notification card: kill the opacity transition immediately
            // so the auto-dismiss CSS animation cannot make it invisible before
            // the Node-side screenshot CDP call arrives.
            const card = node.parentElement?.closest('.notification-area, .ui__notifications-content, [class*="notification"]') ?? container
            card.style.cssText += ';transition:none!important;opacity:1!important;animation:none!important'
            const bb = card.getBoundingClientRect()
            window.__toastCapture = {
              text,
              kind: text.includes('PNG') ? 'png' : 'svg',
              bb: { x: bb.left, y: bb.top, width: bb.width, height: bb.height },
            }
            obs.disconnect()
            return
          }
        }
      }
    })
    obs.observe(container, { childList: true, subtree: true, characterData: true })
    window.__toastObserver = obs
  })

  const flowFig = page.locator('.diagram-blocks-root .diagram-blocks-figure').first()
  await flowFig.hover()
  await flowFig.locator('button[data-action="copy"]').click()

  // Poll for the observer result (it fires synchronously in-browser, so this
  // is normally satisfied on the first or second poll).
  let toastCapture = null
  const toastDeadline = Date.now() + 10_000
  while (Date.now() < toastDeadline) {
    toastCapture = await page.evaluate(() => window.__toastCapture ?? null)
    if (toastCapture) break
    await new Promise((r) => setTimeout(r, 100))
  }
  // Clean up the observer if still attached (e.g. toast never fired)
  await page.evaluate(() => { window.__toastObserver?.disconnect(); window.__toastObserver = null })

  const toastKind = toastCapture?.kind ?? null
  {
    if (toastCapture?.bb) {
      const { x, y, width, height } = toastCapture.bb
      const pad = 32
      const clip = {
        x: Math.max(0, x - pad),
        y: Math.max(0, y - pad),
        width:  Math.min(vp.width,  x + width  + pad) - Math.max(0, x - pad),
        height: Math.min(vp.height, y + height + pad) - Math.max(0, y - pad),
      }
      await page.screenshot({ path: toastPath, clip })
    } else {
      // Toast not captured — full-page fallback (will be largely blank)
      await page.screenshot({ path: toastPath })
    }
  }
  written.push(toastPath)

  // Apply strict assertion logic — after capture so the golden is written
  // even when the run exits 1 (branch-truthful evidence).
  if (toastKind === 'svg') {
    problems.push('copy produced SVG fallback, expected PNG — toPng regression?')
  } else if (toastKind === null) {
    throw new Error('copy-toast not seen (neither PNG nor SVG) within timeout')
  }
  // toastKind === 'png' → all good, no problem pushed

  for (const f of written) {
    if (statSync(f).size === 0) problems.push(`zero-byte: ${f}`)
  }
  if (written.length < 8) problems.push(`expected ≥8 captures, wrote ${written.length}`)
  if (problems.length) throw new Error('capture problems:\n' + problems.map((p) => '  - ' + p).join('\n'))
  console.log(`wrote ${written.length} captures to ${OUT}/`)
} finally {
  await cleanup(browser)
}
