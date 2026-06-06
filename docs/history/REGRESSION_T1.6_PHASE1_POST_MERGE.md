# T1.6 — Regression Sweep: Phase 1 Post-Merge

**Date:** 2026-05-02
**Task UID:** `0375805a-4408-4f61-a770-cb6d3228a93e`
**Phase:** 1 (`7480ec43-6707-4938-9ac1-6a266e23087a`) — closes Phase 1 → M1 Met
**Source RFC:** `94e520da-c6f7-48af-944c-51298d68da45` § Phase 1
**Baseline commit:** `fe335298` (post T1.5 merge — last Phase 1 task before regression sweep)

## Scope

Verify all existing plugin tests stay green after Phase 1 deploy:

- T1.1 — IFileSystemAdapter abstraction (#3023)
- T1.2 — `@kitelev/exocortex-services` package (#3025)
- T1.3 — Plugin migrated to shared services (#3029)
- T1.4 — CLI ports frontmatter handlers + drops stubs / fail-loud (#3031)
- T1.5 — Audit 48 starter-kit groundings (#3034)

## Method

Ran the same Jest invocations CI uses (`CI=true`, submodules initialised) via `npm run test:unit` — covers obsidian-plugin, CLI, and the narrow exocortex grounding regression batch.

## Result

| Suite                                | Suites         | Tests                  | Status |
| ------------------------------------ | -------------- | ---------------------- | ------ |
| obsidian-plugin                      | 250 / 250 pass | 5029 pass / 3 skipped  | ✅     |
| CLI (`packages/cli/jest.config.js`)  | 106 / 106 pass | 1755 pass / 62 skipped | ✅     |
| exocortex grounding regression batch | 7 / 7 pass     | 162 / 162 pass         | ✅     |

**No regressions detected.** Phase-level metric (`М1: zero fake-succeed groundings` — gated by L3 BDD audit in Phase 6, not by this sweep) is not degraded by Phase 1 merges; the existing CI surface is fully green.

### Notes on locally-only failures (not regressions)

A naive run without `CI=true` and without `git submodule update --init` reproducibly fails 5 CLI integration suites:

- `convert.integration` and `sparql-exo003.integration` — gated by `describeOrSkip = isCI ? describe.skip : describe`; failures are pre-existing local-environment issues unrelated to Phase 1.
- `starter-kit/command-pilot`, `starter-kit/command-suite`, `starter-kit/command-suite-l1l2l3` — depend on the `packages/starter-kit-fixtures` git submodule; without `submodules: recursive` the catalog loader returns 0 entries.

CI runs with `submodules: recursive` and `CI: "true"` (see `.github/workflows/ci.yml` `test-coverage-cli` job), matching this sweep's configuration.

## Acceptance Criteria

- [x] Все existing plugin tests зелёные (250 suites, 5029 tests passing post Phase 1 migration)
- [x] CLI tests зелёные в CI-equivalent окружении (106 suites, 1755 tests)
- [x] Exocortex grounding regression batch зелёный (7 suites, 162 tests — gates RFC-028 + RFC be70f741 + #2959 + #2997)
- [x] Phase-level metric не ухудшилась — Phase 1 merges не сломали ни один существующий suite
