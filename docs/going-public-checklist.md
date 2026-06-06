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

Repo flipped public 2026-06-06; all items completed the same day:

- [x] **Secret scanning + push protection** — both enabled.
- [x] **Branch protection on `main`** — requires `test` + `gitleaks` status checks,
      force-pushes and deletion blocked. `enforce_admins` off so Max's direct
      pushes still work (the bot never pushes main).
- [x] **Actions approval for outside contributors** — verified:
      `first_time_contributors` policy active.
- [x] **Dependabot alerts** — enabled. Automatic security updates left off;
      the bot loop handles bumps via `ai-ready` issues instead.

## Explicitly deferred to the marketplace gate

- Placeholder `icon.png` (128×128 stand-in)
- DB-version compatibility check
- Marketplace listing PR + repo screenshot in README header
- Version/release hygiene for the listed zip
