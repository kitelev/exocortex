# Required CI status checks

> **Single source of truth for the branch-protection required-checks fact.** Every other
> doc references this page instead of restating the list, so the count and names cannot
> drift independently. The *live* authority is the GitHub API — this page is a
> human-readable snapshot of it.

## The list

There are **13 required status checks** on `main`:

`archgate`, `detect-changes`, `e2e-shard (1)`, `e2e-shard (2)`, `e2e-shard (3)`,
`e2e-shard (4)`, `e2e-shard (5)`, `e2e-shard (6)`, `lint`, `parity-gate`,
`test-component`, `test-coverage`, `typecheck`.

**Source of truth (run this to confirm):**

```bash
gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks \
  --jq '.contexts | sort | .[]'
```

If this page and the API disagree, the API wins — update this page.

## Gotchas

- **Matrix contexts use the parenthesised form** `<job> (<shard>)` (e.g. `e2e-shard (4)`).
  A hyphenated name like `e2e-shard-4` silently resolves to *no* required check, so a
  typo in branch protection means a shard is unguarded without any error.
- **A non-required check failure can still block Auto Release.** The release workflow keys
  off the overall CI-run conclusion, so a red *non-required* check (e.g. `docs-link-check`)
  flips the run to `failure` even when every required check is green and the PR merged. See
  [DEV-TROUBLESHOOTING.md → Auto Release Skipped After CI Failure](../../../DEV-TROUBLESHOOTING.md#auto-release-skipped-after-ci-failure).

## History (why the set looks like this)

- `parity-gate` was added post-2026-04-22 (it runs the CLI ↔ plugin triple-parity
  integration test in isolation — see
  [explanation/CROSS_RUNTIME_PARITY.md](../../explanation/CROSS_RUNTIME_PARITY.md)).
- `detect-changes` was added so the path-filter infrastructure always runs.
- The standalone `test-unit` job was dropped from the required contexts in `f235881d`
  (Phase 4 cutover) once it became a deduplicated stub, and was later repurposed to
  `test-ui` in #3396.
- The cucumber-based BDD check was retired in #3433 (no `.feature` files remain;
  BDD-parity is now gated by `parity-gate`).

The frozen Phase-3 ADR `packages/obsidian-plugin/docs/phase3/ADR_FLAKY_X11_STRATEGY.md`
and the `docs/history/` rollback logs describe *earlier* required-check sets as historical
snapshots — do not treat those as current.
