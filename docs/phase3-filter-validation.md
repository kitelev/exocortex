# Phase 3 Path-Filter Validation — R4 scenario (post-fix dummy)

Docs edit + misplaced `.spec.ts` simulating the R4 failure scenario
(docs PR that inadvertently includes a spec file) for the post-fix
state after PR #2913.

Expected: `**/*.spec.{ts,tsx,js,jsx}` glob matches, `code=true`, all
gated e2e jobs run full tests.

Will be closed without merge.
