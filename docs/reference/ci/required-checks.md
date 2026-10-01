# Required CI status checks

> **Single entry point for the branch-protection required-checks fact.** Every other doc
> references this page instead of restating the list. The authority is the GitHub API, and
> this page's job is to hand you the command that prints it — not to carry a copy. A copy
> is what drifted before (see below).

## The list

⛔ **Neither the names nor the count are written down here any more.** Both drifted, and the
drift was invisible: until #4494 this page — the repo's own declared single source — said
**13** and omitted `requirements-trace`, while the live set had 14 contexts and a comment in
`.github/workflows/ci.yml` said 14. An enumeration nobody compares with the API is a
signature sitting next to the mechanism, so this page now carries only the command that
produces the fact.

**Print the live set** (needs admin):

```bash
gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks \
  --jq '.contexts | sort | .[]'
```

**Without admin** — the same set is readable from the branch object (this is the path the
default job token has, measured 2026-10-02; `/protection*` returns 403 for it):

```bash
gh api repos/kitelev/exocortex/branches/main \
  --jq '.protection.required_status_checks.contexts | sort | .[]'
```

Append `| wc -l` for the count, or use `--jq '.protection.required_status_checks.contexts | length'`.

⚠ **Dated measurement, not the authority:** on 2026-10-02 the set had **14** contexts. If
that disagrees with the command above, the command wins — re-date or drop this line, never
edit the number from memory.

## ⛔ What `typecheck` actually covers (it is narrower than the name)

`typecheck` runs `npm run check:types` → `tsc --noEmit -p tsconfig.json` (root). Measured
2026-08-19 against `origin/main`, that config covers **`packages/<non-cli>/src` and nothing
else**:

| tsconfig                      | `include`             | `exclude`                                                            |
| ----------------------------- | --------------------- | -------------------------------------------------------------------- |
| root `tsconfig.json`          | `packages/**/*.ts(x)` | `packages/**/tests/**/*`, **`packages/cli/**/*`**, `packages/*/dist` |
| `packages/core/tsconfig.json` | `src/**/*`            | `node_modules`, `dist`, **`tests`**                                  |
| `packages/cli/tsconfig.json`  | `src/**/*`            | (tests simply not included)                                          |
| `packages/obsidian-plugin/`   | —                     | _(no package tsconfig at all)_                                       |

So a green `typecheck` says **nothing** about:

- **`packages/cli/src`** — excluded from the root config. Gated separately by
  `scripts/check-cli-types.mjs` (ratchet, issue #4074). It had accumulated 24 unseen errors,
  one of which — a `BlankNode.value` read — shipped through two review rounds of #4070 while
  the compiler had been flagging it the whole time.
- **`packages/**/tests/**`** — all 975 test files. Gated separately by
  `scripts/check-test-types.mjs` (ratchet, issue #4084; baseline 433 `(file, code)` pairs /
  2396 diagnostics at introduction).

  ⛔ That gate is a **stricter superset** of what ts-jest checks, not a reproduction of it —
  `main` is green today with all 2396 diagnostics present, so a red there does **not** mean a
  suite fails at run time. What it uniquely covers: `tests/component/**` runs under Playwright
  CT (bundler transpile) and is type-checked by **nothing** otherwise; and a **type-only**
  import is _erased_ by ts-jest without ever being resolved, so a test importing a module that
  has since MOVED still passes green while its annotation silently degrades to `any`.

⇒ When reporting gate results on a PR, state **what the run covered**, not just its exit
code: `typecheck rc=0 (⚠ does not cover test files or packages/cli)`. A bare "typecheck
green" reads as "the whole diff was checked" and is false for any PR whose main artefact is
a test.

## Gotchas

- **Matrix contexts use the parenthesised form** `<job> (<shard>)` (e.g. `e2e-shard (4)`).
  A hyphenated name like `e2e-shard-4` silently resolves to _no_ required check, so a
  typo in branch protection means a shard is unguarded without any error.
- **A non-required check failure can still block Auto Release.** The release workflow keys
  off the overall CI-run conclusion, so a red _non-required_ check (e.g. `docs-link-check`)
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
and the `docs/history/` rollback logs describe _earlier_ required-check sets as historical
snapshots — do not treat those as current.
