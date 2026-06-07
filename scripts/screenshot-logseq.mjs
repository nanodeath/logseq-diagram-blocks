// Tier-B captures: screenshots of the plugin rendering inside REAL Logseq via
// CDP. The realm-truth check — see docs/cdp-spike-findings.md and AGENTS.md
// PR-contract §3. Headless-capable via Xvfb (NOT xvfb-run; see spike Step 5).
//
// This script does NOT depend on a pre-registered graph. Logseq exposes no
// dialog-free way to register/open a local graph by path (getters only on
// window.logseq.api; internal repo handlers aren't exported; current-repo alone
// always resets to "local"). So instead of fighting graph registration, we work
// entirely inside Logseq's built-in demo graph and build the fixtures from
// scratch via the plugin API:
//   1. Load the plugin programmatically — window.LSPluginCore.register({ url })
//      (the same call the "Load unpacked plugin" dialog makes, minus the dialog).
//   2. Parse the committed e2e/graph/pages/fixtures.md (single source of truth)
//      and inject those blocks into a fresh `fixtures` page via the editor API.
// Both steps are dialog-free, need no profile copy / sudo / path-matching, and
// run identically on a desktop or a fresh headless server.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const PORT = Number(process.env.LOGSEQ_CDP_PORT ?? 9222)
const OUT = 'docs/screenshots/logseq'
const PLUGIN_ID = 'logseq-diagram-blocks'
const FIXTURES_PAGE = 'fixtures'
const CHECKOUT = realpathSync(resolve('.'))
const FIXTURES_MD = resolve('e2e/graph/pages/fixtures.md')
const APP = 'com.logseq.Logseq'
// LOGSEQ_APPRUN: path to an extracted AppImage's squashfs-root/AppRun. Set on
// headless hosts (the unattended bot host) — the AppImage is the only Logseq
// that runs reliably headless; the Flatpak fights Xvfb/Wayland (spike Step 5).
// When unset, we fall back to the Flatpak (desktop dev).
const APPRUN = process.env.LOGSEQ_APPRUN
const XVFB_DISPLAY = process.env.LOGSEQ_XVFB_DISPLAY ?? ':93'
const STARTUP_MS = 45_000 // spike observed ~18 s; practice shows occasional slower cold launches
const RENDER_TIMEOUT_MS = 30_000

const problems = []
let launched = null // { proc, xvfb } when we started Logseq ourselves

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

// ── Parse the committed fixtures.md into { label, content } per diagram ──────
// fixtures.md is a Logseq outline: each top-level bullet is `- **label**` and
// its single child bullet holds a ```mermaid fence. We dedent one Logseq level
// (a leading tab, then either the `- ` bullet marker or the 2-space content
// alignment) to recover the verbatim fence as the child block's content.
function parseFixtures(md) {
  const out = []
  let cur = null
  const flush = () => { if (cur) out.push({ label: cur.label, content: cur.lines.join('\n').trim() }) }
  for (const line of md.split('\n')) {
    const m = line.match(/^- \*\*(.+?)\*\*\s*$/)
    if (m) { flush(); cur = { label: m[1], lines: [] }; continue }
    if (!cur) continue
    let l = line.startsWith('\t') ? line.slice(1) : line
    l = l.startsWith('- ') ? l.slice(2) : l.replace(/^ {2}/, '')
    cur.lines.push(l)
  }
  flush()
  return out.filter((f) => f.content.length > 0)
}

async function cdpAlive() {
  try { return (await fetch(`http://localhost:${PORT}/json/version`)).ok } catch { return false }
}

async function ensureLogseq() {
  if (await cdpAlive()) return // attach mode: a CDP-enabled Logseq is already up
  const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  let xvfb = null
  let proc

  if (APPRUN) {
    // Extracted-AppImage launch (headless servers). Spin up our own Xvfb when no
    // display is present. APPDIR must point at squashfs-root so AppRun locates
    // the bundled Logseq binary. detached:true gives us a process group to kill
    // (Electron spawns helper children that a plain proc.kill() would orphan).
    let display = process.env.DISPLAY
    if (!hasDisplay) {
      display = XVFB_DISPLAY
      xvfb = spawn('Xvfb', [display, '-ac', '-screen', '0', '1920x1080x24'], { stdio: 'ignore' })
      await sleep(2000)
    }
    const env = { ...process.env, DISPLAY: display, APPDIR: dirname(realpathSync(APPRUN)) }
    proc = spawn(APPRUN, ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`],
      { stdio: 'ignore', detached: true, env })
  } else if (hasDisplay) {
    proc = spawn('flatpak', ['run', APP, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })
  } else {
    // Headless Flatpak fallback (spike Step 5): manual Xvfb + force X11 via the
    // Electron flag. Flatpak declares sockets=wayland, so we must blank
    // WAYLAND_DISPLAY and force --ozone-platform=x11 before Ozone detection runs.
    const display = XVFB_DISPLAY
    xvfb = spawn('Xvfb', [display, '-screen', '0', '1920x1080x24'], { stdio: 'ignore' })
    await sleep(1500)
    const args = ['run', '--nosocket=wayland', `--env=DISPLAY=${display}`, '--env=WAYLAND_DISPLAY=',
      '--env=ELECTRON_OZONE_PLATFORM_HINT=x11', APP, `--remote-debugging-port=${PORT}`,
      '--disable-gpu', '--ozone-platform=x11']
    proc = spawn('flatpak', args, { stdio: 'ignore', env: { ...process.env, DISPLAY: display, WAYLAND_DISPLAY: '' } })
  }

  launched = { proc, xvfb }
  const deadline = Date.now() + STARTUP_MS
  while (Date.now() < deadline) {
    if (await cdpAlive()) return
    await sleep(500)
  }
  throw new Error(`Logseq CDP not reachable on :${PORT} after ${STARTUP_MS}ms.
If your normal Logseq is open (without the CDP flag), close it and re-run.`)
}

async function cleanup(browser) {
  await browser?.close().catch(() => {})
  if (launched) {
    if (APPRUN) {
      // Kill the whole process group (Electron helpers included).
      try { process.kill(-launched.proc.pid, 'SIGTERM') } catch { /* already gone */ }
    } else {
      // execFileSync throws on non-zero exit (e.g. if Logseq already exited);
      // catch it so we always reach the xvfb kill.
      try { execFileSync('flatpak', ['kill', APP], { stdio: 'ignore' }) } catch { /* already gone */ }
    }
    launched.xvfb?.kill()
  }
}

let browser
try {
  const fixtures = parseFixtures(readFileSync(FIXTURES_MD, 'utf8'))
  if (fixtures.length === 0) throw new Error(`parsed 0 fixtures from ${FIXTURES_MD}`)
  console.log(`parsed ${fixtures.length} fixtures: ${fixtures.map((f) => f.label).join(', ')}`)

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
  // The main content container is present once the SPA router is ready; push_state
  // before that throws "No protocol method Router.match-by-name".
  await page.waitForFunction(
    () => document.querySelectorAll('#main-content-container, .cp__sidebar-main-layout').length > 0,
    { timeout: RENDER_TIMEOUT_MS },
  )

  // ── Refuse to mutate a real, file-backed graph ────────────────────────────
  // We inject a `fixtures` page below. In Logseq's built-in demo graph that page
  // is in-memory (no disk) — which is exactly the bot's fresh-profile environment.
  // But if the user has a local graph open (e.g. a dev desktop that reopened the
  // e2e graph), create_page/insert_block writes .md files and reformats committed
  // fixtures. get_current_graph() returns null / no path for the demo graph and a
  // path for a file-backed graph, so abort on the latter.
  const curGraph = await page.evaluate(() => {
    try { return window.logseq.api.get_current_graph() } catch { return null }
  })
  if (curGraph?.path) {
    throw new Error(`refusing to run: a file-backed graph is open (${curGraph.path}).
This capture injects a 'fixtures' page and would write to / reformat that graph on disk.
Run against a fresh Logseq with no local graph open (the built-in demo graph), or on the bot host.`)
  }

  // ── Load the plugin (no "Load unpacked" dialog) ───────────────────────────
  // Fresh run: register from this checkout. Re-run/attach: the plugin is already
  // registered, so reload it to pick up a fresh dist/ build instead.
  const alreadyLoaded = await page.evaluate((id) => {
    try { return Array.from(window.LSPluginCore.registeredPlugins.keys()).includes(id) } catch { return false }
  }, PLUGIN_ID)
  if (alreadyLoaded) {
    await page.evaluate((id) => window.LSPluginCore.reload(id), PLUGIN_ID)
  } else {
    const res = await page.evaluate(async (dir) => {
      try { await window.LSPluginCore.register({ url: dir }); return 'ok' }
      catch (e) { return 'ERR:' + (e?.message || String(e)) }
    }, CHECKOUT)
    if (res !== 'ok') throw new Error(`plugin register failed: ${res}`)
    await page.waitForFunction((id) => {
      try { return Array.from(window.LSPluginCore.registeredPlugins.keys()).includes(id) } catch { return false }
    }, PLUGIN_ID, { timeout: RENDER_TIMEOUT_MS })
  }
  // Give the plugin a beat to mount its macro renderer before injecting blocks.
  await sleep(1500)

  // ── Build the fixtures page from scratch via the editor API ────────────────
  const injected = await page.evaluate(async (fx) => {
    const api = window.logseq.api
    try { await api.delete_page('fixtures') } catch { /* first run: no page yet */ }
    await api.create_page('fixtures', {}, { redirect: false, createFirstBlock: false })
    let n = 0
    for (const f of fx) {
      const parent = await api.append_block_in_page('fixtures', '**' + f.label + '**')
      if (!parent?.uuid) return { ok: false, where: f.label }
      await api.insert_block(parent.uuid, f.content, { sibling: false })
      n++
    }
    return { ok: true, n }
  }, fixtures)
  if (!injected.ok) throw new Error(`block injection failed at fixture "${injected.where}"`)

  // The final insert_block leaves the last block focused in edit mode, where
  // Logseq shows its raw markdown instead of the rendered fenced-code result —
  // so the bottom fixture (the `broken` error case) never renders. Exit editing
  // and bounce through another page so every block re-mounts in display mode.
  await page.evaluate(() => { try { window.logseq.api.exit_editing_mode(true) } catch { /* not editing */ } })
  await page.evaluate(() => window.logseq.api.push_state('page', { name: 'contents' }))
  await sleep(500)
  await page.evaluate((name) => window.logseq.api.push_state('page', { name }), FIXTURES_PAGE)

  // Expected: one rendered diagram per fixture; the `broken` fixture errors.
  await page.waitForFunction(
    (n) => {
      const figs = document.querySelectorAll('.diagram-blocks-root .diagram-blocks-figure svg').length
      const errs = document.querySelectorAll('.diagram-blocks-root .diagram-blocks-error').length
      return figs + errs >= n && errs >= 1
    },
    fixtures.length, { timeout: RENDER_TIMEOUT_MS },
  )

  mkdirSync(OUT, { recursive: true })
  const written = []

  // Neutralize the mouse before the fixture capture loop so no hover UI leaks
  // into captures nondeterministically. Move to (0,0) and wait > the CSS
  // opacity transition (120ms) to ensure any hover chrome fully fades out.
  // Fixture captures are deliberately hover-free; tier-A goldens document the toolbar.
  await page.mouse.move(0, 0)
  await sleep(300)

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
    await sleep(100)
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
  if (written.length < fixtures.length + 1) problems.push(`expected ≥${fixtures.length + 1} captures, wrote ${written.length}`)
  if (problems.length) throw new Error('capture problems:\n' + problems.map((p) => '  - ' + p).join('\n'))
  console.log(`wrote ${written.length} captures to ${OUT}/`)
} finally {
  await cleanup(browser)
}
