# Going-public checklist

Scope: making the **repo** public. Marketplace submission is a separate, later gate
(DB-version check, real README screenshot, final icon, marketplace PR).

## Pre-flip audit — done 2026-06-06

- [x] **License** — MIT, present and detected by GitHub.
- [x] **Secret scan of full history** — grepped all commits for token/key patterns
      (`ghp_`, `github_pat_`, AWS, PEM, slack): nothing found. No `.env`/credential
      files ever committed. Continuous coverage: `gitleaks` job in `ci.yml` scans
      full history on every PR and push to main.
- [x] **CI is fork-safe** — `ci.yml` triggers on `pull_request` (not
      `pull_request_target`), uses no repository secrets.
- [x] **Committed e2e graph is clean** — `e2e/graph/` only contains `config.edn` +
      `pages/fixtures.md`; no personal data.
- [x] **Wiki / Discussions / Projects** already disabled.
- [x] **Personal-info sweep** — only benign mentions remain: `/home/max` symlink
      examples in `scripts/screenshot-logseq.mjs` comments, and "mini-max" host
      references in `docs/superpowers/` design docs. No IPs, no credentials.
      Decision: leave as-is (they're development-history docs).

## Before flipping the switch

- [x] **Repo description + topics** — done (Max, 2026-06-06).
- [x] **Eyeball committed screenshots** — reviewed, clean (Max, 2026-06-06).
- [x] **Skim issue/PR bodies** — reviewed, fine (Max, 2026-06-06).
- [x] **README presentable** — placeholder replaced with a light/dark golden pair
      (`docs/screenshots/flowchart-{light,dark}.png`) demonstrating theme sync and
      the toolbar. A real-Logseq hero capture can still upgrade this at the
      marketplace gate.

## Immediately after flipping

These are free-tier features that only unlock on public repos:

- [ ] **Secret scanning + push protection** — Settings → Code security; enable both.
- [ ] **Branch protection on `main`** — require CI to pass, block force-pushes.
      (403 on private/free today; available once public.)
- [ ] **Actions approval for outside contributors** — verify Settings → Actions →
      "Require approval for first-time contributors" (should be the default).
- [ ] **Dependabot alerts** — enable (security updates optional; the bot loop can
      handle bumps via `ai-ready` issues instead).

## Explicitly deferred to the marketplace gate

- Placeholder `icon.png` (128×128 stand-in)
- DB-version compatibility check
- Marketplace listing PR + repo screenshot in README header
- Version/release hygiene for the listed zip
