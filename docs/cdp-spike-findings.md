# CDP Spike Findings: Real-Logseq Screenshot Capture

**Date:** 2026-06-06  
**Branch:** ai-friendly  
**Logseq version:** 0.10.15 (Flatpak, Electron 38 / Chrome 140)  
**Verdict:** GO

---

## Step 1 — CDP flag pass-through

**Conclusion: CDP passes through cleanly.**

```bash
flatpak run com.logseq.Logseq --remote-debugging-port=9222 &
sleep 10
curl -s http://localhost:9222/json/version
```

Output (trimmed):
```json
{
  "Browser": "Chrome/140.0.7339.240",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Logseq/0.10.15 Chrome/140.0.7339.240 Electron/38.4.0 Safari/537.36",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/66ed2e00-42be-4421-bd52-db9a740e6042"
}
```

The `--remote-debugging-port=9222` flag passes through the Flatpak wrapper to Electron without modification. No `--remote-allow-origins=*` needed. Flatpak app metadata does not swallow flags.

---

## Step 2 — Playwright connectOverCDP

**Conclusion: Works. Screenshot captured cleanly.**

Script at `/tmp/cdp-probe.cjs` using `require('/mnt/Data/Projects/logseq-graph-block/node_modules/playwright')`.

Key findings:
- 1 context, 1 page at `file:///app/logseq/resources/app/electron.html`, title `Logseq`
- `chromium.connectOverCDP('http://localhost:9222')` connects immediately
- `page.screenshot()` produces a valid PNG of the full Logseq UI

The screenshot showed the Logseq demo graph "Hi, welcome to Logseq!" getting started page rendered fully and correctly.

**Node import note:** The script must `require()` playwright by absolute path from the repo's `node_modules` (or be run from the repo dir with `NODE_PATH`). The file lives in `/tmp` so plain `import { chromium } from 'playwright'` fails module resolution. Use CJS (`require`) rather than ESM (`import`) — playwright's index.js is CommonJS and named ESM imports break.

---

## Step 3 — Scratch graph feasibility

**Conclusion: Manual one-time graph add required; cannot be fully scripted.**

### Filesystem permissions

```
flatpak info --show-permissions com.logseq.Logseq
```

```
[Context]
shared=ipc;network;
sockets=pulseaudio;ssh-auth;wayland;x11;
filesystems=home;/mnt/Data/Projects/logseq-graph-block:ro;
```

The Flatpak has `filesystems=home`, so it can read/write anywhere in `~`. A graph at `~/.local/share/logseq-diagram-blocks-e2e-graph/` is accessible. The repo itself is mounted `:ro` (read-only) — note this `:ro` is itself a user override (added to load the dev plugin), not part of Logseq's manifest.

**Follow-up test (same day): repo-local `e2e/graph/` is viable after all.** A more specific rw override nests correctly under the ro parent:

```bash
flatpak override --user --filesystem=/mnt/Data/Projects/logseq-graph-block/e2e/graph com.logseq.Logseq
```

Verified inside the sandbox (`flatpak run --command=sh`): `e2e/graph` is writable while the rest of the repo stays read-only. This makes repo-local `e2e/graph/` the **preferred** location — fixture pages are versioned with the branch, and captures reflect the branch state with no seed/sync step. The implementation must gitignore Logseq's volatile writes inside it (`e2e/graph/logseq/`, `bak/`, `.recycle/`) and keep only the fixture pages committed. `~/.local/share/logseq-diagram-blocks-e2e-graph/` remains the fallback on hosts where the override is undesirable.

### Graph API surface

`window.logseq.api` exposes 112 methods. Graph-related:
- `get_current_graph`, `get_current_graph_configs`, `get_current_graph_favorites`, `get_current_graph_recent`, `get_current_graph_templates`
- `force_save_graph`, `download_graph_db`, `download_graph_pages`
- `push_state`, `replace_state` (SPA navigation)

**There is no `add_graph` or `open_graph` API.** `get_current_graph()` returns `null` when the demo graph is open (expected — demo graph has no path). There is no programmatic way to add a new graph directory to Logseq's graph list or switch to an existing one via the plugin API.

### Graph open verdict

A one-time manual step by Max is required: open `~/.local/share/logseq-diagram-blocks-e2e-graph/` via "Add a graph" in the Logseq UI. After that, the script can switch to it via `push_state` navigation or simply rely on it being the last-opened graph on startup (Logseq reopens the last graph by default). **Manual-once is acceptable per the spike brief.**

Preferred graph location: `~/.local/share/logseq-diagram-blocks-e2e-graph/` (within home, writable by Logseq, clearly namespaced).

---

## Step 4 — Plugin reload scriptability

**Conclusion: Plugin is installed and loaded; reload works via `LSPluginCore.reload()`.**

### Plugin globals found

```js
Object.keys(window).filter(k => /lsp|plugin/i.test(k))
// ["__LSP__HOST__", "LSPlugin", "LSPluginCore", "__debugPluginsPerfInfo"]
```

- `window.__LSP__HOST__` — boolean, `true` (this is the plugin host process)
- `window.LSPlugin` — `{ PluginLocal, pluginHelpers, setupPluginCore }`
- `window.LSPluginCore` — plugin lifecycle manager (EventEmitter-based)
- `window.logseq` — `{ sdk, api }` — the main SDK surface

### Plugin registration

`LSPluginCore._registeredPlugins` is a `Map`. `logseq-diagram-blocks` is present with status `"loaded"`. Its `_localRoot` is:
```
/run/user/1000/doc/106ce11f/logseq-graph-block
```
(This is the Flatpak portal path for the repo, which was added as a dev plugin.)

### Reload

```js
// LSPluginCore.reload source (decompiled):
async reload(e) {
  if (Array.isArray(e)) for (const t of e) try {
    const e = this.ensurePlugin(t); await e.reload()
  } catch(e) { dr(e) }
  else await this.reload([e]);
}
```

`await window.LSPluginCore.reload('logseq-diagram-blocks')` — resolved successfully (no error). The plugin iframe reloads at:
```
file:///run/user/1000/doc/106ce11f/logseq-graph-block/dist/index.html?__v__=0.1.0
```

### Plugin presence signals

- `.diagram-blocks-root` elements: **0** on the demo graph's welcome page (no diagram blocks on that page — expected)
- The plugin iframe is present as `#logseq-diagram-blocks_iframe.lsp-iframe-sandbox`
- Render-complete signals to watch for after reload: `.diagram-blocks-root .diagram-blocks-figure svg` (success) or `.diagram-blocks-error` (error)

### Electron IPC

`window.require` is not available (contextIsolation is on). No `window.electron` or `window.electronAPI` exposed. Electron's IPC is not accessible from the renderer via CDP. This is fine — the plugin API and `LSPluginCore` cover everything needed.

---

## Step 5 — Headless (Xvfb) variant

**Conclusion: Works. Xvfb renders Logseq identically to the live display.**

### What failed first

```bash
xvfb-run -a flatpak run --nosocket=wayland --env=ELECTRON_OZONE_PLATFORM_HINT=x11 \
  com.logseq.Logseq --remote-debugging-port=9222 --disable-gpu
```
```
ERROR:ui/ozone/platform/wayland/host/wayland_connection.cc:197] Failed to connect to Wayland display
ERROR:ui/aura/env.cc:257] The platform failed to initialize. Exiting.
```

Root cause: The Logseq Flatpak declares `sockets=wayland` in its permissions. Even with `--nosocket=wayland` override and `WAYLAND_DISPLAY=""`, Electron's Ozone platform selection code detects the Wayland socket via the sandbox environment and tries it first. `ELECTRON_OZONE_PLATFORM_HINT=x11` alone is insufficient.

### What works

Passing `--ozone-platform=x11` as a direct Electron CLI flag forces X11 before any detection logic:

```bash
Xvfb :99 -screen 0 1920x1080x24 &
DISPLAY=:99 WAYLAND_DISPLAY="" flatpak run \
  --nosocket=wayland \
  --env=DISPLAY=:99 \
  --env=WAYLAND_DISPLAY="" \
  --env=ELECTRON_OZONE_PLATFORM_HINT=x11 \
  com.logseq.Logseq \
  --remote-debugging-port=9222 \
  --disable-gpu \
  --ozone-platform=x11 &
sleep 18
curl -s http://localhost:9222/json/version
```

CDP responds correctly. `page.screenshot()` produces a full 1366×768 (Electron default window size) PNG of the Logseq UI — identical in content to the live-display version. The screenshot confirmed the full Logseq chrome (sidebar, titlebar, content area) renders headlessly.

### GPU note

`--disable-gpu` causes a logged warning:
```
Automatic fallback to software WebGL has been deprecated. Please use --enable-unsafe-swiftshader
```
WebGL falls back to software rendering. For diagram screenshots this is acceptable — mermaid SVG renders are CPU-side. If WebGL-dependent features are ever needed, add `--enable-unsafe-swiftshader`.

---

## Hazards

| Hazard | Severity | Mitigation |
|--------|----------|------------|
| Xvfb `--ozone-platform=x11` must be passed as Electron flag, not just env var | Medium | Document the exact invocation; env-var-only approaches silently fail |
| `get_current_graph()` returns `null` for demo graph — cannot detect which graph is active | Low | Script waits for graph load event or checks page URL/title instead |
| `LSPluginCore.reload()` is fire-and-forget; no completion event | Medium | Poll for `.diagram-blocks-root .diagram-blocks-figure svg` or `.diagram-blocks-error` with timeout |
| Plugin not installed in a fresh Logseq | Medium | Document one-time manual dev plugin install; detect via `LSPluginCore._registeredPlugins.has('logseq-diagram-blocks')` |
| Repo mounted `:ro` in Flatpak | Medium | Resolved: nested rw override on `e2e/graph` (see Step 3 follow-up); fallback `~/.local/share/logseq-diagram-blocks-e2e-graph/` |
| Playwright CJS/ESM mismatch — playwright is CommonJS | Low | Use `.cjs` extension or `require()` |
| Port 9222 may be busy if another Chrome/Electron is running | Low | Check `ss -ltn | grep 9222`; use 9223 as fallback |

---

## Final verdict: GO

**`pnpm screenshot:logseq` is feasible with the following architecture:**

### Chosen approach

1. **Graph:** repo-local `e2e/graph/` — made writable inside the sandbox via a nested rw override (see Step 3 follow-up); fixture pages versioned with the branch, no seed/sync step. Gitignore Logseq's volatile writes (`e2e/graph/logseq/`, `bak/`, `.recycle/`); commit only fixture pages. **One-time manual setup by Max:** apply the override and open the folder via "Add a graph" in Logseq. Fallback on hosts without the override: `~/.local/share/logseq-diagram-blocks-e2e-graph/` seeded by the script.

2. **Launch mode:** Xvfb (headless), using the exact incantation from Step 5 — a manually started `Xvfb :99` (NOT `xvfb-run -a`, which failed; see "What failed first"). The script should pick a free display number rather than hardcoding `:99`. Startup wait: 18 seconds (conservative; can tune).

3. **Plugin reload:** `await window.LSPluginCore.reload('logseq-diagram-blocks')` — works. Completion signal: poll `document.querySelectorAll('.diagram-blocks-root .diagram-blocks-figure svg').length > 0` or `.diagram-blocks-error`, with a 10s timeout and 250ms interval.

4. **Graph switching:** Logseq re-opens the last graph on startup. If the e2e graph was last open, no extra switching needed. If not, `logseq.api.push_state('graph', { name: 'graph' })` may navigate to it (needs validation in implementation — and the graph's display name, derived from its directory name, needs confirming for the repo-local location).

5. **Screenshot:** `page.screenshot({ path, clip: { ... } })` targeting the `.diagram-blocks-figure` bounding rect for a tight crop.

### Required one-time manual setup by Max

1. `flatpak override --user --filesystem=<repo>/e2e/graph com.logseq.Logseq` (already applied on this machine, 2026-06-06)
2. Launch Logseq normally, click "Add a graph", select `<repo>/e2e/graph/`
3. Ensure `logseq-diagram-blocks` dev plugin is added (it already is, per Step 4)

### If not GO

Tier-B fallback (static page + Playwright Chromium without real Logseq) remains the contract per `AGENTS.md`. That path is already validated and does not depend on this spike.
