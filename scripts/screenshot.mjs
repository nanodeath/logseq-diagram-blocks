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

let browser, server, sectionCount
try {
  server = await createServer({ logLevel: 'silent' })
  await server.listen()
  const base = server.resolvedUrls.local[0] // e.g. http://localhost:5173/

  browser = await chromium.launch()
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

  sectionCount = await page.locator('#gallery section.fixture').count()

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
  // sequence svg. Catches "renders inline but drops content in copied PNGs"
  // regressions — SVG-as-image loads no external resources.
  // Note: uses `sequence` (not `flowchart`) because mermaid's flowchart SVG
  // contains <foreignObject>, which Chrome taints the canvas on even with a
  // blob-URL src; sequence diagrams are foreignObject-free and exercise the
  // same toPng path.
  const pngBase64 = await page.evaluate(
    async ({ scale }) => {
      const { browserStrategies } = await import('/src/viewer/copy-png.ts')
      const section = [...document.querySelectorAll('#gallery section.fixture')].find(
        (s) => s.querySelector('h3')?.textContent?.trim() === 'sequence',
      )
      const svg = section?.querySelector('.diagram-blocks-figure svg')
      if (!svg) throw new Error('sequence svg not found')
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
    const path = join(OUT, 'copy-sequence.png')
    writeFileSync(path, Buffer.from(pngBase64, 'base64'))
    written.push(path)
  }
} finally {
  await browser?.close()
  await server?.close()
}

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
