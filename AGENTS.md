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
| `pnpm screenshot:logseq` | tier-B captures from REAL Logseq into `docs/screenshots/logseq/` (self-contained — see below; falls back per PR-contract #3 on unprepared hosts) |

One-time setup: `pnpm install && pnpm exec playwright install chromium`.

Tier-B needs **no graph setup**. The script loads the plugin via `LSPluginCore.register`
and injects the `e2e/graph/pages/fixtures.md` blocks into Logseq's built-in demo graph
over CDP (Logseq exposes no dialog-free way to open a graph by path, so we don't try).
On a desktop it drives the installed Flatpak automatically. On a **headless host** (the
unattended bot server): install an extracted Logseq AppImage and point the script at it
with `LOGSEQ_APPRUN=/path/to/squashfs-root/AppRun`, and install Xvfb. The AppImage is
required headless — the Flatpak fights Xvfb/Wayland (see `docs/cdp-spike-findings.md`).

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
