# logseq-diagram-blocks — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorming session with Max)
**Working name:** `logseq-diagram-blocks` (Max picks the final name before marketplace submission; repo is currently `logseq-graph-block`)

## Context & Motivation

Logseq has no native mermaid support. The de-facto community solution, `xyhp915/logseq-fenced-code-plus`, is effectively unmaintained (last commit Oct 2024, 32 open issues, unmerged community PRs) and has structural defects:

- Theme chosen from the **OS** `prefers-color-scheme`, not Logseq's theme setting (issue #59); initialized once, never updated
- Deprecated global `mermaid.init()` causes re-render flakiness: diagrams lost on page refresh (#56), breakage with consecutive diagrams (#30), block render errors (#42)
- No zoom, fullscreen, or export (#46, #44, #36)
- Vendored mermaid 10.9.1 (current is 11.x)

Backlog analysis showed community demand concentrates on **diagram UX** (copy-as-PNG, styling, theming) rather than breadth of languages. The strongest language ask is PlantUML (5 reactions); Kroki support (3 reactions) would cover it plus ~20 other formats in one integration.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Audience | Marketplace, after dogfooding on Max's graph | fenced-code-plus user base is stranded; prove it personally first |
| Logseq target | File-based (0.10.x) now, DB-aware | Most users on file-based; DB version ships a proper editor block-renderer plugin API we adapt to later behind the adapter layer |
| Integration | `logseq.Experiments.registerFencedCodeRenderer` for ` ```mermaid ` blocks (Approach A) | Notes stay portable standard markdown; macro syntax (`{{renderer}}`) rejected as non-portable |
| Viewer UX | Static inline SVG + hover toolbar + fullscreen pan/zoom modal (Option A) | Predictable page scrolling; discoverable actions; matches top community asks |
| v1 scope | Mermaid only; PlantUML/Kroki behind a renderer seam in v2 | YAGNI; PlantUML engine choice (embedded plantuml.js vs local jar vs Kroki) deserves its own evaluation |
| echarts | Dropped | ~3 issues in 4 years on fenced-code-plus; real chart demand is query-driven visualization — a different product |

## Goals (v1)

1. Render ` ```mermaid ` fenced code blocks inline as SVG in file-based Logseq 0.10.x
2. Mermaid 11.x via per-diagram `mermaid.render()` (modern API; error-isolated)
3. Theme follows **Logseq's** theme setting, live-updating on toggle
4. Per-diagram hover toolbar: fullscreen, copy-as-PNG, jump-to-edit
5. Fullscreen overlay with cursor-anchored scroll-zoom and drag-pan
6. Per-diagram graceful error display; one bad diagram never affects others or the page
7. Fully offline; mermaid vendored in the plugin bundle

## Non-Goals (v1)

- PlantUML / Kroki / other languages — v2, via the `DiagramRenderer` seam
- echarts or per-language support — not planned
- Query-driven charts — out of scope entirely
- DB-version support — verified before marketplace submission; full support when its renderer API stabilizes

## Architecture

Three layers; Logseq coupling quarantined in one adapter.

```
┌─────────────────────────────────────────────┐
│ logseq-adapter/        (thin, replaceable)  │
│  registers via Experiments.registerFenced-  │
│  CodeRenderer · maps Logseq theme events ·  │
│  mounts viewer per block                    │
├─────────────────────────────────────────────┤
│ viewer/                (UI, host-agnostic)  │
│  inline SVG container · hover toolbar ·     │
│  fullscreen pan/zoom overlay · error card   │
├─────────────────────────────────────────────┤
│ core/                  (pure rendering)     │
│  DiagramRenderer interface:                 │
│    language → render(code, opts) → SVG/err  │
│  MermaidRenderer (v1) · KrokiRenderer (v2)  │
└─────────────────────────────────────────────┘
```

- **`core/`** — no Logseq knowledge. `DiagramRenderer` is the extension seam: a v2 backend (PlantUML via Kroki, local server, or embedded engine) implements the interface and registers its languages. Adding a backend requires only new code, never modification of existing renderers or consumers.
- **`viewer/`** — takes an SVG (or typed error) and renders the interaction layer. Logseq-free, enabling a standalone dev harness.
- **`logseq-adapter/`** — the only code touching `logseq.*`. If the experimental API breaks, or when targeting the DB version's official block-renderer API, this layer is replaced; core and viewer are untouched.

## Rendering Pipeline

1. Logseq displays a ` ```mermaid ` block in view mode → adapter's renderer component mounts with the block's code
2. Component calls `MermaidRenderer.render(code, { theme })` → `mermaid.render(uniqueId, code)` → returns a typed result: `{ ok: true, svg }` | `{ ok: false, error }`. Never throws into Logseq's React tree.
3. SVG injected into the viewer container; toolbar attaches on hover

Correctness properties (each maps to an observed fenced-code-plus failure):

- **Per-diagram render with unique IDs** — no global page scan; fixes consecutive-diagram (#30) and refresh (#56) bug classes
- **Stateless re-render** on code or theme change — no `dataset.processed`-style bookkeeping
- **`securityLevel: 'strict'`** mermaid default (XSS-safe; a relaxation setting can come later if click-interactions are requested)
- Per-diagram `%%{init: …}%%` directives pass through untouched

Diagrams render with **transparent backgrounds** to sit on Logseq's own background (fixes the #33 "weird in light theme" class). *Flagged for validation during dogfooding; revisit if custom themes make diagrams illegible.* The fullscreen overlay supplies its own theme-matched backdrop.

## Theme Sync

- On start: `logseq.App.getUserConfigs()` → `preferredThemeMode` (`'light' | 'dark'`)
- Subscribe `logseq.App.onThemeModeChanged` → shared theme store → all mounted diagrams re-render. No render caching in v1; re-render is cheap and correct.
- Mapping: light → mermaid `default`, dark → mermaid `dark`
- Setting `theme: auto | default | dark | forest | neutral | base` (default `auto` = follow Logseq) for users whose custom Logseq themes clash with the auto mapping

## Viewer UX

**Inline:** rendered SVG, max-width 100%, centered. Clicking the diagram does nothing (no accidental modals; preserves the option of mermaid click-interactions later). Hover fades in a compact top-right toolbar:

- **⛶ Fullscreen** — opens overlay
- **⧉ Copy as PNG** — see export below
- **✏️ Edit** — `logseq.Editor.editBlock(uuid)`; fixes the fenced-renderer papercut where the rendered block can't be clicked into for editing

**Fullscreen overlay:** fixed full-viewport in host page, theme-matched backdrop, diagram re-rendered at full size. Cursor-anchored scroll-zoom, drag-pan, reset button; close via ✕ / Esc / backdrop click. Pan/zoom via a small maintained library (candidate: `panzoom`; exact dependency and version resolved at implementation time via package manager) or hand-rolled if the dependency doesn't pull its weight.

**Copy as PNG:** SVG → canvas at `pngScale` (default 2×) → clipboard `ClipboardItem`; success toast. Known limitation: diagrams using HTML labels embed `<foreignObject>`, which taints the canvas. Fallback chain: try PNG → on failure copy SVG text with an explanatory toast. No silent failure; no global `htmlLabels: false` (would degrade fidelity for everyone to serve an export edge case).

## Error Handling

- Render failure → compact error card in place of the diagram: mermaid's parse message (includes line info) + the ✏️ edit button. Never a blank block; never collateral damage to sibling diagrams.
- Transiently-invalid diagrams while typing show the error card briefly — acceptable in v1; keep-last-good-render is a polish candidate if dogfooding finds it annoying.
- Mermaid bundle load failure → single console error + small inline notice.

## Settings

Via `logseq.useSettingsSchema`, deliberately minimal:

| Key | Values | Default |
|---|---|---|
| `theme` | `auto / default / dark / forest / neutral / base` | `auto` |
| `pngScale` | number (PNG export multiplier) | `2` |

## Testing

- **Unit (vitest):** `core/` result types, theme-store transitions and mapping, SVG→PNG fallback logic with mocked canvas
- **Dev harness:** standalone HTML page running core + viewer in a browser with a fixture gallery (flowchart, sequence, ER, mindmap, HTML-labels case) for fast manual verification without restarting Logseq
- **Integration:** dogfooding on Max's graph for the `Experiments` API and theme events — automation inside Logseq's plugin host is not realistically achievable

## Packaging & Repo

- TypeScript + Vite + pnpm; mermaid 11 vendored as the IIFE build (version resolved at install time via package manager, never hard-coded from memory)
- GitHub Actions release workflow producing the zip artifact Logseq installs
- Marketplace submission deferred until dogfooding signals ready; pre-submission checklist includes a verification pass on the Logseq DB beta

## Risks & Spikes

1. **Spike #1 (first implementation task):** confirm mermaid 11 IIFE + `Experiments.loadScripts` + `registerFencedCodeRenderer` compose — the renderer component runs in the host page context, not the plugin sandbox. This is the primary technical risk; the fenced-code-plus precedent proves the pattern for mermaid 10 only.
2. `Experiments` API is unofficial and could change — mitigated by the adapter layer; worst case is rewriting one thin layer.
3. Transparent backgrounds vs custom Logseq themes — dogfooding validation item.
4. PNG export limitations with `foreignObject` — mitigated by the SVG fallback chain.

## v2 Direction (door open, not commitments)

- **PlantUML:** new `DiagramRenderer` backend. Engine options under evaluation (deep-research report pending as of this writing): embedded plantuml.js (official but dormant since ~2023, large bundle, frozen at an old engine version) vs user-run local server (`plantuml.jar` / native binary / Docker Kroki) vs remote kroki.io. PlantUML core itself is healthy (monthly releases, v1.2026.5 in May 2026).
- **Kroki backend** would also unlock graphviz, d2, and ~20 formats with one integration (top non-PlantUML community asks).
- **DB-version adapter** targeting its official editor block-renderer API.
