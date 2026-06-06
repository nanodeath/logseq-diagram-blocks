## Summary

<!-- What changed and why. Link the issue (e.g. "Fixes #1"). -->

## Screenshots

<!-- REQUIRED — pick one:
     • List which goldens under docs/screenshots/ changed and what to look for
       in the image diffs (Files Changed renders before/after).
     • Or state: "No rendered output change." -->

## Verification

- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] Tier A goldens regenerated (`pnpm screenshot`) — or N/A: no rendered output change
- [ ] Tier B real-Logseq capture (`pnpm screenshot:logseq`) — only for host-integration
      changes; if unavailable, manual check requested in Summary
