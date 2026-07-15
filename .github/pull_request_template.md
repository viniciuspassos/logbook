## Summary
<!-- 1-3 bullets: what changed and why -->

## Test plan
- [ ] `git hook run pre-commit` passes (typecheck, lint, test)
- [ ] `npm run build` succeeds
- [ ] `/qa` run if this is a critical/breaking change (see below)

<!--
`/qa` runs a real Playwright + Claude session — it costs money and time,
and is not required to merge (only `static-gates` blocks merge).

Skip it for routine changes: docs, config, small fixes, refactors,
anything low-risk.

Run it for critical/breaking changes: anything touching core user flows,
data persistence/offline behavior, or changes you're not confident are
safe without an end-to-end pass.
-->


## Notes
<!-- anything a reviewer needs to know: scope cuts, follow-ups, screenshots -->
