# logseq-diagram-blocks v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Logseq plugin that renders ` ```mermaid ` fenced code blocks inline as themed SVG with a hover toolbar (fullscreen pan/zoom, copy-PNG, edit), per the approved spec at `docs/superpowers/specs/2026-06-04-diagram-blocks-design.md`.

**Architecture:** Three layers — `core/` (pure rendering, `DiagramRenderer` interface), `viewer/` (framework-free DOM UI), `adapter` (the only Logseq-coupled code, registering via `logseq.Experiments.registerFencedCodeRenderer`). Mermaid runs in the Logseq host page (loaded via `Experiments.loadScripts`); the renderer receives the mermaid API through an injected loader so core stays host-agnostic. Renderer/viewer load as lazy Vite chunks.

**Tech Stack:** TypeScript, Vite, pnpm, vitest (+ jsdom), mermaid 11 (vendored IIFE), `@logseq/libs`, `panzoom`. **Never pin versions from memory — always install via `pnpm add` and let the registry resolve.**

**Verification reality:** Unit tests cover core + viewer logic. The Logseq integration (`Experiments` APIs, theme events) cannot be automated — each integration task ends with a manual dogfood check in Max's file-based Logseq. The dev harness (`dev/`) gives fast browser verification of core+viewer without Logseq.

---

## File Structure

```
index.html                      plugin entry page (loads src/main.ts)
package.json / vite.config.ts / tsconfig.json / vitest.config.ts
src/main.ts                     adapter entry: settings schema, renderer registration, theme wiring
src/host/react.ts               shim: re-export logseq.Experiments.React (aliased as 'react' for adapter only)
src/host/mermaid-loader.ts      host-scope mermaid loader (Experiments.loadScripts + ensureHostScope)
src/adapter/block-component.ts  React bridge: mounts the DOM viewer inside the fenced-code renderer
src/adapter/styles.ts           CSS injected into host page via logseq.provideStyle
src/core/types.ts               DiagramRenderer interface, RenderResult, DiagramTheme types
src/core/theme.ts               ThemeStore + Logseq-mode→mermaid-theme mapping (pure)
src/core/mermaid/renderer.ts    MermaidRenderer (mermaid API injected via loader)
src/viewer/render-into.ts       viewer entry: render diagram into a container element, returns dispose
src/viewer/toolbar.ts           hover toolbar DOM (fullscreen / copy-PNG / edit buttons)
src/viewer/overlay.ts           fullscreen pan/zoom overlay
src/viewer/copy-png.ts          SVG→PNG clipboard with SVG-text fallback chain
src/viewer/error-card.ts        per-diagram error display
dev/index.html + dev/harness.ts + dev/fixtures.ts   standalone dev harness with fixture gallery
.github/workflows/release.yml   zip release artifact
docs/spike-findings.md          Task 2 output (host-scope composition facts)
```

Tests live next to sources as `*.test.ts`.

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `index.html`, `src/main.ts`

- [ ] **Step 1: Initialize package and install deps**

```bash
cd /mnt/Data/Projects/logseq-graph-block
pnpm init
pnpm add @logseq/libs mermaid panzoom
pnpm add -D typescript vite vitest jsdom @types/node
```

- [ ] **Step 2: Set package metadata**

Edit `package.json` — merge in (keep pnpm-resolved deps):

```json
{
  "name": "logseq-diagram-blocks",
  "version": "0.1.0",
  "description": "Mermaid diagrams in fenced code blocks: theme-synced, fullscreen pan/zoom, copy as PNG",
  "main": "dist/index.html",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "test": "vitest run"
  },
  "logseq": {
    "id": "logseq-diagram-blocks",
    "title": "Diagram Blocks",
    "icon": "./icon.png"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "types": ["vite/client"],
    "skipLibCheck": true
  },
  "include": ["src", "dev"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  // Logseq loads the plugin from dist/ via file://, so paths must be relative
  base: './',
  resolve: {
    // Adapter code says `import React from 'react'` but gets the host's React.
    // viewer/ and core/ never import react — enforced by review, keeps them host-agnostic.
    alias: { react: resolve(__dirname, 'src/host/react.ts') },
  },
  build: { target: 'es2022' },
})
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
})
```

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>logseq-diagram-blocks</title>
    <script src="./src/main.ts" type="module"></script>
  </head>
  <body></body>
</html>
```

- [ ] **Step 7: Write placeholder `src/main.ts`**

```ts
import '@logseq/libs'

function main() {
  console.info('logseq-diagram-blocks loaded')
}

logseq.ready(main).catch(console.error)
```

- [ ] **Step 8: Verify build and test runner**

Run: `pnpm build`
Expected: `dist/index.html` produced
Run: `pnpm test`
Expected: "No test files found" exit 0 (passWithNoTests) — if vitest errors on empty suite, add `passWithNoTests: true` to `vitest.config.ts` test block

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite/TypeScript plugin skeleton"
```

---

### Task 2: Spike — mermaid 11 in Logseq host scope (PRIMARY RISK)

Confirms the three load-bearing assumptions before any real code. Throwaway quality; findings land in `docs/spike-findings.md`.

**Files:**
- Create: `scripts/copy-vendors.mjs`, `docs/spike-findings.md`
- Modify: `src/main.ts`

- [ ] **Step 1: Confirm mermaid ships an IIFE build**

Run: `ls node_modules/mermaid/dist/ | grep -E 'mermaid\.(min\.)?js$'`
Expected: `mermaid.min.js` (and/or `mermaid.js`). **If absent:** mermaid 11 dropped the prebuilt IIFE — instead create `src/host/mermaid-entry.ts` containing `import mermaid from 'mermaid'; (globalThis as any).mermaid = mermaid` and add it as a Vite lib-mode IIFE build target in `vite.config.ts` (`build.lib = { entry: 'src/host/mermaid-entry.ts', formats: ['iife'], name: 'mermaid' }` in a second config invoked via `vite build --config vite.vendor.config.ts`), emitting `dist/vendors/mermaid.min.js`. Either way the contract is: **a self-executing script at `dist/vendors/mermaid.min.js` that sets `window.mermaid`.**

- [ ] **Step 2: Write `scripts/copy-vendors.mjs` and chain it into the build**

```js
import { copyFile, mkdir } from 'node:fs/promises'

await mkdir('dist/vendors', { recursive: true })
await copyFile('node_modules/mermaid/dist/mermaid.min.js', 'dist/vendors/mermaid.min.js')
console.log('vendored mermaid')
```

Update `package.json`: `"build": "vite build && node scripts/copy-vendors.mjs"`.
(Skip/replace per Step 1 outcome if building our own IIFE.)

- [ ] **Step 3: Spike renderer in `src/main.ts`**

Replace the body with a minimal end-to-end probe:

```ts
import '@logseq/libs'

async function main() {
  const host = logseq.Experiments.ensureHostScope()
  if (!host.mermaid) {
    await logseq.Experiments.loadScripts('./vendors/mermaid.min.js')
  }
  host.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })

  const React = logseq.Experiments.React

  function SpikeBlock(props: Record<string, unknown>) {
    // SPIKE QUESTION 3: what props do we get? (need block uuid for the Edit button)
    console.info('fenced-renderer props:', Object.keys(props), props)
    const ref = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
      const id = 'spike-' + Math.random().toString(36).slice(2)
      host.mermaid
        .render(id, String(props.content ?? ''))
        .then(({ svg }: { svg: string }) => {
          if (ref.current) ref.current.innerHTML = svg
        })
        .catch((e: unknown) => {
          if (ref.current) ref.current.textContent = 'render error: ' + String(e)
        })
    }, [props.content])
    return React.createElement('div', { ref })
  }

  logseq.Experiments.registerFencedCodeRenderer('mermaid', {
    edit: false,
    render: SpikeBlock,
  })
}

logseq.ready(main).catch(console.error)
```

- [ ] **Step 4: Build and load into Logseq**

Run: `pnpm build`
Then (manual, Max's machine): Logseq → Settings → Advanced → Developer mode on → Plugins → Load unpacked plugin → select the repo root (it reads `package.json` `main` → `dist/index.html`).

- [ ] **Step 5: Verify spike exit criteria (manual, in Logseq)**

Create a test page with: (a) one ` ```mermaid ` flowchart block, (b) two consecutive mermaid blocks, (c) one block with a syntax error. Then check ALL of:
1. Diagram renders as SVG inline
2. Both consecutive diagrams render independently
3. Page refresh (Ctrl/Cmd-R) → diagrams still render
4. Syntax-error block shows the error text, does not blank the page, siblings unaffected
5. Open devtools console → record the `fenced-renderer props:` output — **does a block uuid arrive?**

- [ ] **Step 6: Record findings in `docs/spike-findings.md`**

Write a short fact sheet: IIFE source used (prebuilt vs self-built), mermaid version rendered, exact props received by the renderer component (with the uuid answer), any console warnings, Logseq version tested. These facts gate Task 7's Edit button.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "spike: verify mermaid 11 renders via Experiments host scope"
```

**STOP if any exit criterion fails** — that's a design-level finding; bring it back to Max before proceeding.

---

### Task 3: `core/` types + theme store (TDD)

**Files:**
- Create: `src/core/types.ts`, `src/core/theme.ts`
- Test: `src/core/theme.test.ts`

- [ ] **Step 1: Write `src/core/types.ts`**

```ts
export type DiagramTheme = 'default' | 'dark' | 'forest' | 'neutral' | 'base'
export type ThemeSetting = 'auto' | DiagramTheme
export type LogseqMode = 'light' | 'dark'

export interface RenderOptions {
  theme: DiagramTheme
}

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: { message: string } }

export interface DiagramRenderer {
  /** fenced code block languages this renderer handles, e.g. ['mermaid'] */
  readonly languages: readonly string[]
  render(code: string, opts: RenderOptions): Promise<RenderResult>
}
```

- [ ] **Step 2: Write the failing test `src/core/theme.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ThemeStore, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('maps auto+light to default', () => {
    expect(resolveTheme('auto', 'light')).toBe('default')
  })
  it('maps auto+dark to dark', () => {
    expect(resolveTheme('auto', 'dark')).toBe('dark')
  })
  it('pins an explicit setting regardless of mode', () => {
    expect(resolveTheme('forest', 'dark')).toBe('forest')
  })
})

describe('ThemeStore', () => {
  it('notifies subscribers when resolved theme changes', () => {
    const store = new ThemeStore('auto', 'light')
    const cb = vi.fn()
    store.subscribe(cb)
    store.setMode('dark')
    expect(cb).toHaveBeenCalledWith('dark')
  })

  it('does not notify when resolved theme is unchanged', () => {
    const store = new ThemeStore('forest', 'light')
    const cb = vi.fn()
    store.subscribe(cb)
    store.setMode('dark') // pinned forest — resolved theme unchanged
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribes', () => {
    const store = new ThemeStore('auto', 'light')
    const cb = vi.fn()
    const off = store.subscribe(cb)
    off()
    store.setMode('dark')
    expect(cb).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/core/theme.test.ts`
Expected: FAIL — `./theme` not found

- [ ] **Step 4: Implement `src/core/theme.ts`**

```ts
import type { DiagramTheme, LogseqMode, ThemeSetting } from './types'

export function resolveTheme(setting: ThemeSetting, mode: LogseqMode): DiagramTheme {
  if (setting !== 'auto') return setting
  return mode === 'dark' ? 'dark' : 'default'
}

type Listener = (theme: DiagramTheme) => void

export class ThemeStore {
  private listeners = new Set<Listener>()

  constructor(
    private setting: ThemeSetting,
    private mode: LogseqMode,
  ) {}

  get theme(): DiagramTheme {
    return resolveTheme(this.setting, this.mode)
  }

  setMode(mode: LogseqMode): void {
    this.update(this.setting, mode)
  }

  setSetting(setting: ThemeSetting): void {
    this.update(setting, this.mode)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private update(setting: ThemeSetting, mode: LogseqMode): void {
    const before = this.theme
    this.setting = setting
    this.mode = mode
    const after = this.theme
    if (after !== before) this.listeners.forEach((fn) => fn(after))
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm vitest run src/core/theme.test.ts`
Expected: 6 passing

- [ ] **Step 6: Commit**

```bash
git add src/core && git commit -m "feat: core types and theme store"
```

---

### Task 4: `MermaidRenderer` (TDD, mermaid injected)

**Files:**
- Create: `src/core/mermaid/renderer.ts`
- Test: `src/core/mermaid/renderer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { MermaidRenderer, type MermaidApi } from './renderer'

function fakeMermaid(overrides: Partial<MermaidApi> = {}): MermaidApi {
  return {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg>ok</svg>' })),
    ...overrides,
  }
}

describe('MermaidRenderer', () => {
  it('handles the mermaid language', () => {
    const r = new MermaidRenderer(async () => fakeMermaid())
    expect(r.languages).toContain('mermaid')
  })

  it('returns ok result with svg', async () => {
    const r = new MermaidRenderer(async () => fakeMermaid())
    const result = await r.render('graph TD; A-->B', { theme: 'dark' })
    expect(result).toEqual({ ok: true, svg: '<svg>ok</svg>' })
  })

  it('initializes mermaid with the requested theme and strict security', async () => {
    const api = fakeMermaid()
    const r = new MermaidRenderer(async () => api)
    await r.render('graph TD; A-->B', { theme: 'forest' })
    expect(api.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'forest', securityLevel: 'strict', startOnLoad: false }),
    )
  })

  it('returns typed error instead of throwing on parse failure', async () => {
    const api = fakeMermaid({
      render: vi.fn(async () => {
        throw new Error('Parse error on line 2')
      }),
    })
    const r = new MermaidRenderer(async () => api)
    const result = await r.render('not mermaid', { theme: 'default' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('Parse error on line 2')
  })

  it('loads the mermaid api only once across renders', async () => {
    const loader = vi.fn(async () => fakeMermaid())
    const r = new MermaidRenderer(loader)
    await r.render('graph TD; A-->B', { theme: 'default' })
    await r.render('graph TD; B-->C', { theme: 'default' })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('generates unique element ids per render', async () => {
    const api = fakeMermaid()
    const r = new MermaidRenderer(async () => api)
    await r.render('graph TD; A-->B', { theme: 'default' })
    await r.render('graph TD; A-->B', { theme: 'default' })
    const calls = (api.render as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0]![0]).not.toBe(calls[1]![0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/mermaid/renderer.test.ts`
Expected: FAIL — `./renderer` not found

- [ ] **Step 3: Implement `src/core/mermaid/renderer.ts`**

```ts
import type { DiagramRenderer, RenderOptions, RenderResult } from '../types'

/** Minimal surface of the mermaid global we rely on. */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string): Promise<{ svg: string }>
}

export type MermaidLoader = () => Promise<MermaidApi>

export class MermaidRenderer implements DiagramRenderer {
  readonly languages = ['mermaid'] as const
  private apiPromise: Promise<MermaidApi> | undefined
  private seq = 0

  constructor(private load: MermaidLoader) {}

  async render(code: string, opts: RenderOptions): Promise<RenderResult> {
    try {
      this.apiPromise ??= this.load()
      const api = await this.apiPromise
      // mermaid's initialize is global state in the host page; setting it per
      // render keeps theme switches correct without a separate config channel.
      api.initialize({ startOnLoad: false, securityLevel: 'strict', theme: opts.theme })
      const { svg } = await api.render(`diagram-blocks-${++this.seq}`, code)
      return { ok: true, svg }
    } catch (e) {
      return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/core/mermaid/renderer.test.ts`
Expected: 6 passing

- [ ] **Step 5: Commit**

```bash
git add src/core/mermaid && git commit -m "feat: MermaidRenderer with injected mermaid api"
```

---

### Task 5: viewer — error card + copy-PNG (TDD)

**Files:**
- Create: `src/viewer/error-card.ts`, `src/viewer/copy-png.ts`
- Test: `src/viewer/copy-png.test.ts`, `src/viewer/error-card.test.ts`

- [ ] **Step 1: Write failing test `src/viewer/error-card.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { buildErrorCard } from './error-card'

describe('buildErrorCard', () => {
  it('shows the message and wires the edit button', () => {
    const onEdit = vi.fn()
    const el = buildErrorCard({ message: 'Parse error on line 2' }, onEdit)
    expect(el.textContent).toContain('Parse error on line 2')
    el.querySelector<HTMLButtonElement>('button[data-action="edit"]')!.click()
    expect(onEdit).toHaveBeenCalled()
  })

  it('omits the edit button when no handler provided', () => {
    const el = buildErrorCard({ message: 'boom' }, undefined)
    expect(el.querySelector('button[data-action="edit"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail, then implement `src/viewer/error-card.ts`**

Run: `pnpm vitest run src/viewer/error-card.test.ts` → FAIL, then:

```ts
export function buildErrorCard(
  error: { message: string },
  onEdit: (() => void) | undefined,
): HTMLElement {
  const card = document.createElement('div')
  card.className = 'diagram-blocks-error'

  const title = document.createElement('strong')
  title.textContent = 'Diagram error'
  const msg = document.createElement('pre')
  msg.textContent = error.message
  card.append(title, msg)

  if (onEdit) {
    const btn = document.createElement('button')
    btn.dataset.action = 'edit'
    btn.textContent = '✏️ Edit block'
    btn.addEventListener('click', onEdit)
    card.append(btn)
  }
  return card
}
```

Run again → 2 passing.

- [ ] **Step 3: Write failing test `src/viewer/copy-png.test.ts`**

The PNG path needs canvas + Image, which jsdom lacks — so the unit tests pin the **fallback chain logic**, with the browser path injected as a strategy.

```ts
import { describe, expect, it, vi } from 'vitest'
import { copyDiagram } from './copy-png'

const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'

describe('copyDiagram', () => {
  it('reports png on success', async () => {
    const toPng = vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
    const writePng = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})
    const result = await copyDiagram(svgText, 2, { toPng, writePng, writeText })
    expect(result).toBe('png')
    expect(toPng).toHaveBeenCalledWith(svgText, 2)
    expect(writePng).toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to svg text when png conversion fails (foreignObject taint)', async () => {
    const toPng = vi.fn(async () => {
      throw new DOMException('tainted', 'SecurityError')
    })
    const writeText = vi.fn(async () => {})
    const result = await copyDiagram(svgText, 2, { toPng, writePng: vi.fn(), writeText })
    expect(result).toBe('svg')
    expect(writeText).toHaveBeenCalledWith(svgText)
  })

  it('reports failure when both paths fail', async () => {
    const fail = async () => {
      throw new Error('nope')
    }
    const result = await copyDiagram(svgText, 2, { toPng: fail, writePng: fail, writeText: fail })
    expect(result).toBe('failed')
  })
})
```

- [ ] **Step 4: Run to verify fail, then implement `src/viewer/copy-png.ts`**

Run: `pnpm vitest run src/viewer/copy-png.test.ts` → FAIL, then:

```ts
export type CopyOutcome = 'png' | 'svg' | 'failed'

export interface CopyStrategies {
  toPng(svgText: string, scale: number): Promise<Blob>
  writePng(blob: Blob): Promise<void>
  writeText(text: string): Promise<void>
}

export async function copyDiagram(
  svgText: string,
  scale: number,
  s: CopyStrategies = browserStrategies,
): Promise<CopyOutcome> {
  try {
    const blob = await s.toPng(svgText, scale)
    await s.writePng(blob)
    return 'png'
  } catch {
    try {
      await s.writeText(svgText)
      return 'svg'
    } catch {
      return 'failed'
    }
  }
}

/** Real browser implementations; exercised via the dev harness, not unit tests. */
export const browserStrategies: CopyStrategies = {
  async toPng(svgText, scale) {
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    try {
      const img = await loadImage(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth * scale
      canvas.height = img.naturalHeight * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  },
  async writePng(blob) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  },
  async writeText(text) {
    await navigator.clipboard.writeText(text)
  },
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('svg image load failed'))
    img.src = url
  })
}
```

Run again → 3 passing.

- [ ] **Step 5: Run the full suite, then commit**

Run: `pnpm test` → all green

```bash
git add src/viewer && git commit -m "feat: viewer error card and copy-png fallback chain"
```

---

### Task 6: viewer — toolbar, overlay, render-into

**Files:**
- Create: `src/viewer/toolbar.ts`, `src/viewer/overlay.ts`, `src/viewer/render-into.ts`
- Test: `src/viewer/render-into.test.ts`

- [ ] **Step 1: Implement `src/viewer/toolbar.ts`**

```ts
export interface ToolbarActions {
  onFullscreen(): void
  onCopy(): void
  /** absent when the host can't give us a block uuid (per spike findings) */
  onEdit?: () => void
}

export function buildToolbar(actions: ToolbarActions): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'diagram-blocks-toolbar'

  bar.append(button('fullscreen', '⛶', 'Fullscreen', actions.onFullscreen))
  bar.append(button('copy', '⧉', 'Copy as PNG', actions.onCopy))
  if (actions.onEdit) bar.append(button('edit', '✏️', 'Edit block', actions.onEdit))
  return bar
}

function button(action: string, glyph: string, label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button')
  b.dataset.action = action
  b.textContent = glyph
  b.title = label
  b.setAttribute('aria-label', label)
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}
```

- [ ] **Step 2: Implement `src/viewer/overlay.ts`**

```ts
import panzoom from 'panzoom'

/** Opens a fullscreen overlay containing the svg; returns a close function. */
export function openOverlay(svgText: string): () => void {
  const backdrop = document.createElement('div')
  backdrop.className = 'diagram-blocks-overlay'

  const stage = document.createElement('div')
  stage.className = 'diagram-blocks-overlay-stage'
  stage.innerHTML = svgText
  const svg = stage.querySelector('svg')
  if (svg) {
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.maxWidth = 'none'
  }

  const closeBtn = document.createElement('button')
  closeBtn.className = 'diagram-blocks-overlay-close'
  closeBtn.textContent = '✕'
  closeBtn.setAttribute('aria-label', 'Close')

  backdrop.append(stage, closeBtn)
  document.body.append(backdrop)

  const pz = panzoom(stage, { maxZoom: 10, minZoom: 0.1 })

  const close = () => {
    pz.dispose()
    backdrop.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  closeBtn.addEventListener('click', close)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })
  document.addEventListener('keydown', onKey)
  return close
}
```

- [ ] **Step 3: Write failing test `src/viewer/render-into.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ThemeStore } from '../core/theme'
import type { DiagramRenderer } from '../core/types'
import { renderInto } from './render-into'

const okRenderer: DiagramRenderer = {
  languages: ['mermaid'],
  render: vi.fn(async (_code, opts) => ({ ok: true as const, svg: `<svg data-theme="${opts.theme}"></svg>` })),
}

function tick() {
  return new Promise((r) => setTimeout(r, 0))
}

describe('renderInto', () => {
  it('renders svg and toolbar into the container', async () => {
    const el = document.createElement('div')
    renderInto(el, 'graph TD; A-->B', {
      renderer: okRenderer,
      themeStore: new ThemeStore('auto', 'dark'),
      pngScale: 2,
    })
    await tick()
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelector('.diagram-blocks-toolbar')).not.toBeNull()
  })

  it('re-renders when the theme changes', async () => {
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    renderInto(el, 'graph TD; A-->B', { renderer: okRenderer, themeStore: store, pngScale: 2 })
    await tick()
    store.setMode('dark')
    await tick()
    expect(el.querySelector('svg')!.getAttribute('data-theme')).toBe('dark')
  })

  it('shows error card on failure and stops listening after dispose', async () => {
    const failing: DiagramRenderer = {
      languages: ['mermaid'],
      render: async () => ({ ok: false, error: { message: 'bad syntax' } }),
    }
    const el = document.createElement('div')
    const store = new ThemeStore('auto', 'light')
    const dispose = renderInto(el, 'x', { renderer: failing, themeStore: store, pngScale: 2 })
    await tick()
    expect(el.querySelector('.diagram-blocks-error')!.textContent).toContain('bad syntax')
    dispose()
    store.setMode('dark') // must not throw or touch the removed node
  })
})
```

- [ ] **Step 4: Run to verify fail, then implement `src/viewer/render-into.ts`**

Run: `pnpm vitest run src/viewer/render-into.test.ts` → FAIL, then:

```ts
import type { ThemeStore } from '../core/theme'
import type { DiagramRenderer } from '../core/types'
import { buildErrorCard } from './error-card'
import { buildToolbar } from './toolbar'
import { copyDiagram } from './copy-png'
import { openOverlay } from './overlay'

export interface ViewerContext {
  renderer: DiagramRenderer
  themeStore: ThemeStore
  pngScale: number
  onEdit?: () => void
}

/** Render a diagram into `container`; returns a dispose function. */
export function renderInto(container: HTMLElement, code: string, ctx: ViewerContext): () => void {
  let disposed = false
  let generation = 0

  async function draw(): Promise<void> {
    const gen = ++generation
    const result = await ctx.renderer.render(code, { theme: ctx.themeStore.theme })
    if (disposed || gen !== generation) return // stale render lost the race
    container.replaceChildren()

    if (!result.ok) {
      container.append(buildErrorCard(result.error, ctx.onEdit))
      return
    }

    const figure = document.createElement('div')
    figure.className = 'diagram-blocks-figure'
    figure.innerHTML = result.svg
    const toolbar = buildToolbar({
      onFullscreen: () => openOverlay(result.svg),
      onCopy: () => void copyDiagram(result.svg, ctx.pngScale),
      onEdit: ctx.onEdit,
    })
    figure.append(toolbar)
    container.append(figure)
  }

  const unsubscribe = ctx.themeStore.subscribe(() => void draw())
  void draw()

  return () => {
    disposed = true
    unsubscribe()
    container.replaceChildren()
  }
}
```

- [ ] **Step 5: Run full suite, commit**

Run: `pnpm test` → all green

```bash
git add src/viewer && git commit -m "feat: viewer toolbar, fullscreen overlay, render-into lifecycle"
```

Note: copy feedback toast is wired in Task 8 (it uses `logseq.UI.showMsg`, an adapter concern — the viewer stays host-agnostic; for now the copy button works silently in the harness).

---

### Task 7: dev harness

**Files:**
- Create: `dev/index.html`, `dev/harness.ts`, `dev/fixtures.ts`, `src/viewer/viewer.css`

- [ ] **Step 1: Write `src/viewer/viewer.css`** (single source of truth; harness links it, adapter inlines it in Task 8)

```css
.diagram-blocks-figure { position: relative; text-align: center; }
.diagram-blocks-figure svg { max-width: 100%; height: auto; background: transparent; }
.diagram-blocks-toolbar {
  position: absolute; top: 4px; right: 4px; display: flex; gap: 4px;
  opacity: 0; transition: opacity 120ms ease-in-out;
}
.diagram-blocks-figure:hover .diagram-blocks-toolbar { opacity: 1; }
.diagram-blocks-toolbar button {
  padding: 2px 8px; border-radius: 4px; border: 1px solid var(--ls-border-color, #8884);
  background: var(--ls-secondary-background-color, #2228); cursor: pointer;
}
.diagram-blocks-error {
  border: 1px solid #c0392b66; border-radius: 6px; padding: 8px 12px;
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
}
.diagram-blocks-error pre { white-space: pre-wrap; margin: 0; font-size: 12px; }
.diagram-blocks-overlay {
  position: fixed; inset: 0; z-index: 999; overflow: hidden;
  background: var(--ls-primary-background-color, #1c1c1ce6);
}
.diagram-blocks-overlay-stage { width: 100%; height: 100%; display: grid; place-items: center; }
.diagram-blocks-overlay-close {
  position: fixed; top: 16px; right: 16px; font-size: 18px;
  padding: 6px 12px; border-radius: 6px; cursor: pointer;
}
```

- [ ] **Step 2: Write `dev/fixtures.ts`**

```ts
export const fixtures: Record<string, string> = {
  flowchart: 'graph TD\n  A[Start] --> B{Works?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n  D --> B',
  sequence: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  er: 'erDiagram\n  USER ||--o{ NOTE : writes\n  NOTE }o--|| PAGE : on',
  mindmap: 'mindmap\n  root((plugin))\n    core\n    viewer\n    adapter',
  'html-labels': 'graph LR\n  A["<b>bold</b> label"] --> B',
  broken: 'graph TD\n  A --> --> B',
}
```

- [ ] **Step 3: Write `dev/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>diagram-blocks dev harness</title>
    <link rel="stylesheet" href="../src/viewer/viewer.css" />
    <style>
      body { font-family: sans-serif; max-width: 860px; margin: 2rem auto; }
      .fixture { border: 1px solid #ccc; border-radius: 8px; margin: 1rem 0; padding: 1rem; }
      body.dark { background: #1c1c1c; color: #eee; }
    </style>
    <script src="./harness.ts" type="module"></script>
  </head>
  <body>
    <h1>diagram-blocks harness</h1>
    <button id="theme-toggle">toggle light/dark</button>
    <div id="gallery"></div>
  </body>
</html>
```

- [ ] **Step 4: Write `dev/harness.ts`**

```ts
import { MermaidRenderer, type MermaidApi } from '../src/core/mermaid/renderer'
import { ThemeStore } from '../src/core/theme'
import { renderInto } from '../src/viewer/render-into'
import { fixtures } from './fixtures'

// Harness loads mermaid as a normal ESM dep — no Logseq host involved.
const loader = async (): Promise<MermaidApi> => (await import('mermaid')).default as unknown as MermaidApi

const renderer = new MermaidRenderer(loader)
const store = new ThemeStore('auto', 'light')

document.getElementById('theme-toggle')!.addEventListener('click', () => {
  const dark = document.body.classList.toggle('dark')
  store.setMode(dark ? 'dark' : 'light')
})

const gallery = document.getElementById('gallery')!
for (const [name, code] of Object.entries(fixtures)) {
  const section = document.createElement('section')
  section.className = 'fixture'
  const h = document.createElement('h3')
  h.textContent = name
  const target = document.createElement('div')
  section.append(h, target)
  gallery.append(section)
  renderInto(target, code, { renderer, themeStore: store, pngScale: 2 })
}
```

- [ ] **Step 5: Verify in browser (manual)**

Run: `pnpm vite dev --open /dev/index.html`
Check: all fixtures render (broken one shows the error card); theme toggle re-renders all diagrams; hover shows toolbar; ⛶ opens pan/zoom overlay (scroll-zoom, drag, Esc closes); ⧉ on `flowchart` puts a PNG on the clipboard; ⧉ on `html-labels` falls back to SVG text (check clipboard contents).

- [ ] **Step 6: Commit**

```bash
git add dev src/viewer/viewer.css && git commit -m "feat: standalone dev harness with fixture gallery"
```

---

### Task 8: Logseq adapter (replaces spike main.ts)

**Files:**
- Create: `src/host/react.ts`, `src/host/mermaid-loader.ts`, `src/adapter/block-component.ts`, `src/adapter/styles.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/host/react.ts`**

```ts
// Aliased as 'react' in vite.config.ts. ONLY adapter code may import react.
// The fenced-code renderer component must be built with the HOST page's React.
const React = logseq.Experiments.React
export default React
```

- [ ] **Step 2: Write `src/host/mermaid-loader.ts`**

```ts
import type { MermaidApi, MermaidLoader } from '../core/mermaid/renderer'

export const hostMermaidLoader: MermaidLoader = async (): Promise<MermaidApi> => {
  const host = logseq.Experiments.ensureHostScope()
  if (!host.mermaid) {
    await logseq.Experiments.loadScripts('./vendors/mermaid.min.js')
  }
  if (!host.mermaid) throw new Error('mermaid failed to load into host scope')
  return host.mermaid as MermaidApi
}
```

- [ ] **Step 3: Write `src/adapter/styles.ts`**

```ts
import viewerCss from '../viewer/viewer.css?raw'

export function provideStyles(): void {
  // Viewer DOM lives in the host page, so styles must be provided there too.
  logseq.provideStyle(viewerCss)
}
```

- [ ] **Step 4: Write `src/adapter/block-component.ts`**

```ts
import React from 'react'
import { MermaidRenderer } from '../core/mermaid/renderer'
import type { ThemeStore } from '../core/theme'
import { hostMermaidLoader } from '../host/mermaid-loader'

const renderer = new MermaidRenderer(hostMermaidLoader)

export interface FencedCodeProps {
  content?: string
  // Adjust to the real prop name recorded in docs/spike-findings.md.
  // If no uuid arrives, leave undefined — the Edit button hides itself.
  uuid?: string
}

export function makeBlockComponent(themeStore: ThemeStore, getPngScale: () => number) {
  return function DiagramBlock(props: FencedCodeProps) {
    const ref = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      const el = ref.current
      const code = props.content ?? ''
      if (!el || !code.trim()) return

      let dispose: (() => void) | undefined
      // Lazy chunk: viewer (+ its imports) loads on first diagram encountered.
      void import('../viewer/render-into').then(({ renderInto }) => {
        dispose = renderInto(el, code, {
          renderer,
          themeStore,
          pngScale: getPngScale(),
          onEdit: props.uuid ? () => void logseq.Editor.editBlock(props.uuid!) : undefined,
        })
      })
      return () => dispose?.()
    }, [props.content, props.uuid])

    return React.createElement('div', { ref, className: 'diagram-blocks-root' })
  }
}
```

- [ ] **Step 5: Rewrite `src/main.ts`**

```ts
import '@logseq/libs'
import type { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'
import { ThemeStore } from './core/theme'
import type { LogseqMode, ThemeSetting } from './core/types'
import { makeBlockComponent } from './adapter/block-component'
import { provideStyles } from './adapter/styles'

const settingsSchema: SettingSchemaDesc[] = [
  {
    key: 'theme',
    type: 'enum',
    title: 'Diagram theme',
    description: "'auto' follows Logseq's light/dark mode",
    enumChoices: ['auto', 'default', 'dark', 'forest', 'neutral', 'base'],
    enumPicker: 'select',
    default: 'auto',
  },
  {
    key: 'pngScale',
    type: 'number',
    title: 'PNG export scale',
    description: 'Resolution multiplier for copy-as-PNG',
    default: 2,
  },
]

async function main() {
  const configs = await logseq.App.getUserConfigs()
  const themeStore = new ThemeStore(
    (logseq.settings?.theme as ThemeSetting) ?? 'auto',
    (configs.preferredThemeMode as LogseqMode) ?? 'light',
  )

  logseq.App.onThemeModeChanged(({ mode }) => themeStore.setMode(mode as LogseqMode))
  logseq.onSettingsChanged((settings) => {
    themeStore.setSetting((settings?.theme as ThemeSetting) ?? 'auto')
  })

  provideStyles()

  logseq.Experiments.registerFencedCodeRenderer('mermaid', {
    edit: false,
    render: makeBlockComponent(themeStore, () => Number(logseq.settings?.pngScale ?? 2)),
  })
}

logseq.useSettingsSchema(settingsSchema).ready(main).catch(console.error)
```

- [ ] **Step 6: Reconcile prop names with spike findings**

Read `docs/spike-findings.md`. If the renderer props differ from `{ content, uuid }` (e.g. uuid nested or absent), fix `FencedCodeProps` and the `onEdit` wiring in `src/adapter/block-component.ts` accordingly. If no uuid exists, delete the `uuid` prop and the Edit button stays hidden (the `onEdit?` plumbing already tolerates this).

- [ ] **Step 7: Build and dogfood in Logseq (manual)**

Run: `pnpm build && pnpm test`
In Logseq (reload plugin): repeat the Task 2 checklist (single, consecutive, refresh, broken block) **plus**: toggle Logseq light/dark → diagrams re-theme live; hover toolbar appears; fullscreen pan/zoom works over the host page; copy-PNG pastes into an image editor; settings change (`theme: forest`) re-themes without plugin reload; check diagram legibility on your custom theme (transparent-background validation item).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: Logseq adapter with theme sync and settings"
```

---

### Task 9: Packaging & release workflow

**Files:**
- Create: `.github/workflows/release.yml`, `README.md`, `icon.png`

- [ ] **Step 1: Write `README.md`**

Cover: what it does (one paragraph + screenshot placeholder you'll replace with a real capture during dogfooding — take it before marketplace submission), install (marketplace later, load-unpacked now), usage (` ```mermaid ` block), settings table (`theme`, `pngScale`), limitations (PNG copy falls back to SVG for HTML-label diagrams), roadmap line (PlantUML/Kroki v2), license note (MIT), and credit to `logseq-fenced-code-plus` as prior art.

- [ ] **Step 2: Add `icon.png`**

Any 128×128 placeholder for now (e.g. generated simple glyph); marketplace-quality icon is a pre-submission item, not a blocker.

- [ ] **Step 3: Write `.github/workflows/release.yml`**

```yaml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
      - run: cp README.md icon.png package.json dist/
      - run: cd dist && zip -r ../logseq-diagram-blocks-${{ github.ref_name }}.zip .
      - uses: softprops/action-gh-release@v2
        with:
          files: logseq-diagram-blocks-*.zip
```

- [ ] **Step 4: Verify workflow syntax locally**

Run: `pnpm dlx @action-validator/cli .github/workflows/release.yml || true`
(If the validator is unavailable, a careful read suffices — the real test is the first tag push.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: README, icon, release workflow"
```

---

### Task 10: Dogfood exit & wrap-up

- [ ] **Step 1: Dogfood checklist (Max, over days — not a coding step)**

Track in a `dogfood-notes.md` (gitignored or committed, Max's call): theme legibility on custom themes (transparent backgrounds), error-card annoyance while typing (keep-last-good-render candidate), toolbar discoverability, PNG quality at scale 2, any `Experiments` API flakiness.

- [ ] **Step 2: Pre-marketplace gate (later, separate effort)**

Verify on Logseq DB beta; real screenshot in README; final plugin name decision; marketplace PR to `logseq/marketplace`.

---

## Self-Review Notes

- **Spec coverage:** goals 1–7 map to Tasks 2–8; settings → Task 8; dev harness/testing → Tasks 5–7; packaging → Task 9; lazy chunks → Task 8 Step 4 (`import('../viewer/render-into')`); spike-first → Task 2; DB-version + marketplace deferral → Task 10. Transparent background → `viewer.css` + Task 8 Step 7 validation.
- **Known deliberate gaps:** copy-toast UX (viewer is silent; `logseq.UI.showMsg` wiring noted in Task 6 as adapter follow-up — acceptable v1 polish item), keep-last-good-render (explicitly deferred per spec).
- **Type consistency check:** `MermaidApi`/`MermaidLoader` (Task 4) used by `hostMermaidLoader` (Task 8) and harness (Task 7); `ThemeStore` API (`setMode`/`setSetting`/`subscribe`/`theme`) consistent across Tasks 3/6/8; `RenderResult` discriminated union consistent in Tasks 4/6.
