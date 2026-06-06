# AI-friendly PR workflow — design

**Date:** 2026-06-06
**Status:** design approved in conversation; this document pending Max's review
**Context:** Max wants automated agents (his issue-loop running Claude Code locally, authoring as nanodeath-ai[bot]) to produce PRs against this repo. The core requirement: agents must take screenshots of their work and know that this is expected and required for PR work. Repo is private on GitHub (nanodeath/logseq-diagram-blocks); labels `ai-ready`/`ai-triaged`/`ai-wip` already exist.

## Goals

1. A mechanical, repeatable screenshot command any agent (or Max) can run — no reliance on machine-local skills.
2. A written PR contract agents discover automatically (AGENTS.md / CLAUDE.md) that makes screenshot evidence non-optional.
3. Objective red/green feedback on PRs without Max (CI: tests + build).
4. A path to real-Logseq verification for changes where harness evidence doesn't transfer (realm-dependent fixes — see "Why two screenshot tiers").

## Non-goals

- Pixel-diff visual regression in CI (cross-machine font drift makes this flaky; goldens are for human review).
- Screenshot-freshness enforcement in CI (declined; crude heuristic, false-positives on refactors).
- Creating labels or bot identity (already exist; this design only documents their use).
- Marketplace prep (separate effort: README screenshot, icon, DB-version check).

## Why two screenshot tiers

The dev harness is **single-realm**: plugin code, mermaid, and the display DOM share one document. Real Logseq is **multi-realm**: plugin modules run in a hidden sandbox iframe while rendering happens in the host page (docs/spike-findings.md §6). A whole class of plausible fixes — anything injecting stylesheets/fonts/listeners via bare `document` — passes in the harness and fails in Logseq. Issue #1 (Font Awesome icons) is the canonical example: a stylesheet-injection fix would false-pass tier A, while a `registerIconPacks` (inlined-SVG) fix would genuinely pass. Tier A is therefore *required but not always sufficient*; tier B exists for the realm-dependent residue.

## Component 1: `pnpm screenshot` — harness goldens (tier A)

`scripts/screenshot.mjs`, run via a `screenshot` npm script. `playwright` becomes a devDependency (Chromium only; agents run `npx playwright install chromium` once per machine — AGENTS.md documents this).

Behavior:
- Boots the vite dev server programmatically (vite JS API, ephemeral port) serving `dev/index.html`.
- Runs fully headless (Playwright default) — works on displayless hosts. No real clipboard use anywhere in the script.
- For each fixture in `dev/fixtures.ts` × {light, dark}: hover the figure (toolbar becomes visible), element-screenshot it → `docs/screenshots/<fixture>-<theme>.png`. The `broken` fixture documents the error card. (~12 PNGs.)
- One fullscreen-overlay capture: open ⛶ on the flowchart fixture in dark mode, viewport screenshot → `docs/screenshots/overlay-dark.png`.
- One SVG→PNG export golden: run the `toPng` pipeline (the copy-as-PNG path, bypassing the clipboard) on the **sequence** fixture, write the bytes → `docs/screenshots/copy-sequence.png`. This catches "renders inline but drops content in copied PNGs" regressions (external resources never load inside SVG-as-image). *(Amended during implementation: originally specified the flowchart fixture, but mermaid flowchart SVGs contain `<foreignObject>`, which taints the canvas in Chromium — `SecurityError` at `toBlob`. Verified independently. Product implication: in the real plugin, copy-as-PNG on htmlLabels diagrams falls back to SVG-text copy; tracked separately.)*
- Exits non-zero on: unexpected console errors, a fixture that fails to render (except `broken`, which must show the error card), or zero-byte output.

Goldens are **committed**. A PR that changes rendered output regenerates them; GitHub's Files Changed shows before/after image diffs. Conventions:
- Goldens are human-reviewed evidence, not CI-compared baselines.
- Font drift: goldens regenerated on a different machine will diff at the pixel level even with no code change. Rule: **never regenerate goldens in a PR that doesn't intentionally change rendered output.**

## Component 2: `pnpm screenshot:logseq` — real-Logseq capture (tier B)

**Built** (see `docs/superpowers/plans/2026-06-06-tier-b-screenshot-logseq.md`); spike checklist below retained for the record.

Captures the plugin running in actual Logseq via Chrome DevTools Protocol:
- Launch (or attach to) Flatpak Logseq with `--remote-debugging-port=<port>`; on displayless hosts, a manually started `Xvfb` + `--ozone-platform=x11` Electron flag (Electron cannot run truly headless; Xvfb suffices — CDP capture never needs a visible window). *(Corrected from the original `xvfb-run` wording: the spike proved `xvfb-run` fails — see `docs/cdp-spike-findings.md` Step 5.)*
- Connect via Playwright `connectOverCDP`.
- Open a dedicated page in a scratch graph containing the same fixture blocks as the harness.
- Reload the plugin, wait for renders, element-screenshot each block → `docs/screenshots/logseq/<fixture>.png` (committed, same review channel as tier A).

**Branch-truth guard (sharp edge):** Logseq loads the plugin from this checkout's path. The script must `pnpm build` first and refuse to capture if the working tree state doesn't match what's loaded (at minimum: build before capture; fail if the build fails or the repo has unexpected staged state). Otherwise the screenshot lies about which branch it shows.

**Spike checklist (must pass before the script is written for real):**
1. Flatpak Logseq accepts `--remote-debugging-port` (flag pass-through to Electron) and exposes CDP.
2. Playwright can `connectOverCDP` and reach the main window's page.
3. A scratch graph with fixture pages can be set up once and reused. Preferred location: repo-local `e2e/graph/` (committed, versioned with the fixtures); the spike decides whether Logseq tolerates a graph inside the plugin's own directory, falling back to `~/.local/share/logseq-diagram-blocks-e2e-graph/` seeded from repo files.
4. Plugin reload before capture is scriptable (CDP-evaluated `logseq` API call, or full app restart as fallback).
5. All of the above also works on a displayless host (target: mini-max-class Ubuntu box). *(Outcome: yes, but via manual `Xvfb` — `xvfb-run` itself fails; spike Step 5.)*

If the spike fails or proves too flaky, tier B's contract falls back to: the PR explicitly states real-Logseq verification was not performed and requests Max's manual check (see PR contract).

## Component 3: AGENTS.md (canonical) + CLAUDE.md (pointer)

`AGENTS.md` at repo root is the canonical agent guide. `CLAUDE.md` contains only an `@AGENTS.md` import so Claude Code picks it up automatically.

Contents of AGENTS.md:
- **Project map:** three-layer architecture (`src/core/` pure, `src/viewer/` framework-free DOM, `src/adapter|host|main.ts` Logseq-coupled); test/build commands; dev harness.
- **Required reading rule:** before touching `src/adapter/`, `src/host/`, `src/main.ts`, or `viewer.css`, read `docs/spike-findings.md` §6 (iframe realm semantics). State the rule's payoff: bare `document`/`window` is the sandbox iframe, not the page the user sees.
- **PR contract** (the heart of the doc):
  1. Tests and build must pass (`pnpm test`, `pnpm build`) — CI enforces.
  2. **Render-affecting change ⇒ regenerate tier-A goldens (`pnpm screenshot`), commit them, and reference what changed in the PR body.** A PR that changes rendered output without updated goldens is incomplete.
  3. **Host-integration change** (the required-reading paths above, or any realm-adjacent behavior) **⇒ additionally run tier B** (`pnpm screenshot:logseq`). If tier B is unavailable on the host, the PR body must say so explicitly and request a manual Logseq check.
  4. Never regenerate goldens in a PR that doesn't intentionally change rendered output (font drift ≠ change).
  5. One-time setup note: `npx playwright install chromium`.
- **Label workflow:** implement issues labeled `ai-ready`; keep `ai-wip` on the issue while a branch/PR is open; `ai-triaged` marks triage-only passes. Automation authors as nanodeath-ai[bot].

## Component 4: CI — `.github/workflows/ci.yml`

Triggers: `pull_request`, `push` to `main`. Single job mirroring release.yml's toolchain: pnpm/action-setup@v4 → setup-node@v4 (Node 22, pnpm cache) → `pnpm install --frozen-lockfile` → `pnpm test` → `pnpm build`. No screenshot steps.

## Component 5: PR template — `.github/pull_request_template.md`

Sections:
- **Summary** — what and why.
- **Screenshots** — required: either list which goldens changed (and what to look for in the image diffs) or state "no rendered output change."
- **Verification checklist** — tests pass; build passes; tier-A goldens regenerated or N/A with reason; tier-B run or fallback note (manual check requested).

## Build order

1. Tier A script + goldens (first real artifact; everything else references it)
2. AGENTS.md + CLAUDE.md pointer
3. CI workflow
4. PR template
5. Tier B spike → script if spike passes, fallback wording confirmed in AGENTS.md either way

Items 1–4 land regardless of the spike outcome.

## Testing

- Tier A script: smoke-tested by running it — goldens exist, non-empty, count matches fixtures × themes + overlay + copy PNG; deliberate breakage (bad fixture) exits non-zero. No unit tests for the script itself (it's a thin orchestrator; its output is reviewed by humans every PR).
- CI: validated by the first PR that runs it.
- Tier B: spike checklist above is the test.
