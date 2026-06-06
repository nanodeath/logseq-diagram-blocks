# Spike findings: fenced-code renderer + mermaid in host scope

Validated 2026-06-05 against Logseq **0.10.15** (Flathub Flatpak, `com.logseq.Logseq`)
with mermaid **11.15.0** (IIFE build) on branch `v1` at `eacc159`.

## Exit criteria — all pass

- [x] Single ```mermaid block renders as SVG via `registerFencedCodeRenderer`
- [x] Two consecutive diagrams render independently (distinct render ids, no cross-talk)
- [x] Diagrams survive page refresh (Ctrl-R)
- [x] Broken syntax produces a self-contained `render error: Error: parse error on line 2:`
      text in that block only — no page breakage, sibling diagrams unaffected

## Findings

### 1. `loadScripts` resolves against the PLUGIN ROOT, and resolves even on 404

- The path passed to `logseq.Experiments.loadScripts('./vendors/mermaid.min.js')` is
  resolved relative to the **plugin root** (the directory containing `package.json`),
  *not* the entry-html dir (`dist/`). Confirmed by `ERR_FILE_NOT_FOUND` when the file
  only existed at `dist/vendors/`.
- The returned promise **resolves successfully even when the script 404s** — it cannot
  be trusted as an execution signal. Mitigation: poll for the expected global
  (`waitFor(() => host.mermaid)` in `src/main.ts`).
- Consequence: `scripts/copy-vendors.mjs` vendors mermaid to BOTH `dist/vendors/`
  (published-zip layout, where the zip root is the plugin root) and `./vendors/`
  (dev layout, where the repo root is the plugin root), keeping one runtime path.

### 2. mermaid 11 IIFE + host scope works

- `node_modules/mermaid/dist/mermaid.min.js` (~3.2 MB IIFE) sets `globalThis.mermaid`
  in the host page; reachable via `logseq.Experiments.ensureHostScope()`.
- Modern per-diagram `mermaid.render(id, code)` API works with
  `securityLevel: 'strict'`; rejected promises carry usable parse errors.

### 3. Renderer props are `{ content }` ONLY — no block uuid

- The component registered with `registerFencedCodeRenderer` receives exactly one
  prop: `content` (the fenced block body). Logged keys: `['content']`.
- **Impact on Task 8 (Edit button):** no uuid in props. Planned approach: the
  component renders inside the block's DOM, so walk up from the mounted element to
  the nearest ancestor carrying a `blockid` attribute to recover the uuid. If that
  lookup fails (undocumented DOM, may change), `onEdit` stays `undefined` and the
  toolbar hides the Edit button — the plumbing already tolerates this.

### 4. Renderer components run in the HOST React tree

- Components must be built with `logseq.Experiments.React` (typed `unknown` in
  `@logseq/libs` — cast required). The Vite `react` alias shim
  (`src/host/react.ts`) covers this for the real implementation.

### 5. Theme mismatch confirmed as a real failure mode

- The spike hardcodes `theme: 'dark'`; on Max's light Logseq theme this produced
  dark shapes / dark-gray text on a white page — the same illegibility class as
  fenced-code-plus #59. Validates the Task 8 theme-sync design
  (`getUserConfigs().preferredThemeMode` + `onThemeModeChanged` → re-render).

### 6. Realm semantics (Task 8 dogfood findings)

The plugin's module graph — including lazy viewer chunks — executes in the
hidden plugin-sandbox iframe even though rendered elements live in the host
page. Three bug classes followed; all fixed, recorded here for v2 work:

- **Bare `document`/`navigator` are the iframe's.** Anything appended to
  `document.body` lands in the invisible iframe (the fullscreen overlay bug);
  clipboard calls run without focus or user activation and always reject (the
  "Copy failed" bug). Rule: derive realm objects from the mounted element
  (`el.ownerDocument`, `.defaultView`) — never from module globals.
- **Third-party libs inherit the same trap.** panzoom attaches drag listeners
  to *its* `document` (the iframe's), so panning silently did nothing.
  Replaced with pointer-capture pan/zoom local to the host element; prefer
  element-scoped listeners (`setPointerCapture`) over document-level ones.
- **Host CSS bleeds into `foreignObject` HTML labels.** Logseq's direct
  `p { color }` rule beats mermaid's inherited label color (gray-on-green in
  pinned forest theme on a dark page). Fixed with a scoped
  `color: inherit !important` backstop in viewer.css. Do NOT reach for
  `htmlLabels: false` instead — mermaid then mis-measures SVG text and labels
  overflow their nodes.
- **Pinned themes that contradict the page mode** (light-designed forest on a
  dark page) get an opaque theme-matched backing via `themeBackground()`;
  matching combinations stay transparent.

### 7. Flatpak dev-loading notes

- Sandboxed Logseq needs `flatpak override --user
  --filesystem=/mnt/Data/Projects/logseq-graph-block:ro`; the plugin path appears
  in-app via the document portal (`/run/user/1000/doc/<id>/...`).
- Load the **repo root** as the unpacked plugin (not `dist/` —
  `IllegalPluginPackageError` otherwise, since `package.json` lives at the root).
