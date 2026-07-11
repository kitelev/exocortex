# Exocortex — In-Repo Development Guide

> **Coordination rules, worktree management, and CI/CD**: See the hub `CLAUDE.md` (from a worktree: `../../CLAUDE.md`; from the main `exocortex/` checkout: `../CLAUDE.md`).
> **Universal AI agent instructions**: See `AGENTS.md`.
> **Coding patterns**: See `PATTERNS.md`.
> **Dev/CI troubleshooting**: See `DEV-TROUBLESHOOTING.md`.
> **User troubleshooting**: See `docs/how-to/Troubleshooting.md`.
> **Post-mortem templates**: See `TEMPLATES.md`.

---

## Key Rules Summary

1. **WORKTREES ONLY**: Never edit files in `exocortex/` directly. Work in `worktrees/exocortex-*`.
2. **POST-MORTEM**: Every task → post-mortem report → propose doc improvements → wait for user approval.
3. **TEST BEFORE PR**: `npm run test:all` is mandatory before creating PR.
4. **SQUASH MERGE**: Use `gh pr merge --auto --squash` (rebase not allowed).

---

## Monorepo Structure

```
packages/
├── core/               # @kitelev/exocortex-core — domain models, RDF, SPARQL, services
├── obsidian-plugin/    # @kitelev/exocortex-obsidian-plugin — UI, renderers, commands (consumer)
├── cli/                # @kitelev/exocortex-cli — CLI tooling (consumer)
├── services/           # @kitelev/exocortex-services — shared grounding-service factories
└── test-utils/         # @kitelev/exocortex-test-utils — shared test infrastructure
```

> `packages/exoas-exo` and `packages/exoas-exocmd` are data submodules
> (ontology assets), explicitly excluded from npm workspaces — not code packages.

Notable subsystems with elevated regression risk (see «Auto-merge discipline» below):

- `packages/core/src/services/sync/` — ExoSync engine: change detection, diff3/structured merge, SHACL merge gate, quarantine + watermark stores.
- `packages/obsidian-plugin/src/domain/settings/VaultSettingsRegistry.ts` + `packages/obsidian-plugin/src/infrastructure/adapters/VaultSettingsStore.ts` — homoiconic plugin settings: settings are loaded from vault `exo__Setting` assets (with one-shot migration from `data.json`), so parsing/migration bugs here corrupt user settings.

## Architecture (Clean Architecture)

```
presentation/    → UI components, renderers, React
application/     → Use cases, orchestration, commands
domain/          → Models, RDF, SPARQL, business logic
infrastructure/  → Obsidian API adapters, file system
```

## Quality Metrics

- **Tests:** 691 `*.test.ts` files (run `find packages -name '*.test.ts' | wc -l` for live count; 711 including 20 `.test.tsx`), ~11K+ individual test cases (parametrized). Run `npm run test:all` for exact count.
- **Coverage thresholds**: statements 75.5%, branches 63%
- **Required CI checks**: see [docs/reference/ci/required-checks.md](docs/reference/ci/required-checks.md) (single source; includes the live `gh api …/required_status_checks` command).
- **CI pipeline target**: post-Phase 3 baseline is ~236s avg ±50s (N=3 on main). Gate relaxed to **≤220s** per Decision B (RFC v2 relax, 2026-04-22); original ≤135s target was infeasible given setup-floor dominance. See `docs/history/ROLLBACK_CI_SPEEDUP.md` for per-phase revert procedure.

## Test Suite Awareness

The exocortex-package jest config has `roots: ['<rootDir>/tests']`. The `test-coverage-exocortex` job in `.github/workflows/ci.yml` now runs the **FULL** `packages/core/jest.config.js` — every suite under `roots`, with only `--testPathIgnorePatterns '/node_modules/' '/tests/performance/'` (performance micro-benchmarks are excluded from the hard gate; they flake under parallel-worker contention). **There is no longer a `--testPathPatterns` allowlist** — the previous inline allowlist gated only ~55 of the ~319 suites and let un-listed suites rot silently (Issue #3189, #3506). `scripts/test-ci-batched.sh` is only the local `npm run test:unit` mirror; no workflow invokes it.

**Consequence:** new suites under `packages/core/tests/**` (including `tests/integration/**`) **ARE** picked up automatically and CI-gated — you no longer add them to an allowlist. A suite that reads external/pinned data (e.g. a submodule) can still appear green only because the pinned data is stale; bumping the pointer surfaces the real state (see the sibling rule `cross-repo-submodule-sync.md` §stale-walker).

When fixing a bug, still run the directly-affected suite locally for a fast loop:

```bash
npm test -- packages/core/tests/integration/<affected-suite>.test.ts
```

**Reference (historical, allowlist era):** PR #3189 — `create-instance-grounding.test.ts` was silently red on `main` (12/12 fail, missing parent.md fixture) because the allowlist never included it. That failure mode is now closed by the full-config gate; the lesson (coverage gates measure file/line %, not "did this suite pass") remains why the allowlist was dropped.

## TypeScript Tooling

- `ts-jest` cannot transpile class-level `async *` generator methods — use `AsyncIterableIterator` from a helper/closure instead.

## Quick Audit Before Implementation

```bash
grep -r "feature_keyword" packages/*/src/ | grep -v node_modules  # Search existing code
grep -r "FeatureHelpers" packages/*/src/                          # Find utilities
npm run test -- --testNamePattern="feature keyword"               # Run related tests
```

**Key insight**: 5 min grepping before implementation > 1 hour redundant coding.

## PR Workflow

```bash
npm run test:all                                    # Test first
git commit -am "feat: user-facing description"
git push origin feature/my-feature
gh pr create --title "feat: description" --body "..."
gh pr merge --auto --squash                         # Wait for the required CI checks
```

**Task is NOT complete until**: CI green + PR merged + Auto Release succeeds + post-mortem written.

## Auto-merge discipline (CRITICAL)

For PRs touching parser / TBox / schema / migration paths
(`packages/core/src/services/{CommandResolver,GroundingExecutor,NoteToRDFConverter}.ts`,
`packages/core/src/services/sync/` — ExoSync merge/sync engine (SyncEngine, StructuredMerger, GatedStructuredMerger, MergeShaclGate, diff3),
`packages/obsidian-plugin/src/**/VaultSettings*` — homoiconic settings loader (VaultSettingsRegistry, VaultSettingsStore: vault `exo__Setting` parsing + one-shot migration),
`assetspaces/*/*.md` in any cloned ontology repo):

⛔ **Do NOT use `gh pr merge --auto`.**

Required workflow:

1. Push PR
2. Wait for CI green AND code-reviewer agent complete (run via Agent tool, `subagent_type=code-reviewer`)
3. Apply CRITICAL / HIGH fixes
4. Call `advisor()` AFTER applying fixes — round-2 catches cross-finding
   interactions that the reviewer documented as «deferred / low risk»
5. Apply advisor catches
6. THEN `gh pr merge --squash --delete-branch` (manual, no `--auto`)

**Empirical reference (RFC 31c1a0be Phase 3):** PR #3197 auto-merged before
code-reviewer finished → 2 HIGH fail-open paths shipped → required hotfix
PR #3198 (fail-loud guards) + root-cause PR #3199 (predicate-scoped bypass
in `NoteToRDFConverter.valueToRDFObject:953-983`). Two-iteration discipline
on subsequent PRs (#3201, #3203, #3204) caught issues pre-merge — zero
follow-up hotfixes needed.

## Cross-repo migration RFC checklist

For RFCs migrating vault data (typed predicates, property renames,
value-format shifts) — pre-flight audit MUST enumerate ALL repos with
affected assets:

```bash
for repo in exocortex exocortex-starter-kit exocortex-public-ontologies; do
  echo "=== $repo ==="
  cd ~/Developer/exocortex-development/$repo 2>/dev/null || continue
  grep -rln '<deprecated-predicate>:' . 2>/dev/null | head -20
done
```

If any repo has matches → its migration is in scope. **Don't assume
«pilot/sample/getting-started repo isn't real production data»** — empirical
signal: RFC 31c1a0be Phase 2 missed starter-kit; surface bug appeared during
Phase 5a BC removal as CI red (the since-removed CLI BDD gate 19 fail +
`test-coverage-cli`),
required fix-forward cascade (PR #98 starter-kit Phase 2 + PR #99 dangling
binding + CLI helpers + 5 e2e fixture migrations + 2 submodule bumps).

Add cross-repo audit results to the RFC body BEFORE Phase 1 starts. Saves a
fix-forward session 3 phases later.

## RFC Execution: Audit-First Strategy

Before starting any RFC Phase, audit existing codebase for pre-implemented features:

- RFC-013 found 2 of 4 Phases already implemented (property paths, subqueries)
- Saved ~60% of planned implementation time
- Always redirect to test coverage when feature already exists
- 15 min grepping > hours of redundant implementation

## RFC Scope: Additive vs Transformative

When a session prompt says "do not touch file X — that's Phase N+1 scope", read the intent before treating it as a hard block. Scope fences are usually aimed at **transformative** changes (rename, delete, rewrite, migration of existing values) — not **additive** changes (new variant in a union, new CSS class, new optional setting field).

Before escalating as a blocker, verify three things against the RFC itself:

1. Does the current Phase's acceptance criteria literally require a new value or new file to be added?
2. Is the addition documented in the RFC's architectural principles (e.g. "whitelist расширяется, никогда не удаляется")?
3. Is the physical change additive only — one new union member, one new CSS class — without altering existing values or behaviour?

If all three are yes, the change belongs to the current Phase even if the touched file is nominally "upstream scope". RFC-024 Phase 0 (#2833) example: the `muted` button variant had to be added to `ActionButtonsGroup.tsx` and `styles.css` to satisfy AC2 — both files were prompt-marked "do not touch (Phase 1)", but the addition is additive (whitelist extension), not transformative (WCAG recalibration, which is what Phase 1 actually scopes).

When the RFC acceptance criteria and prompt scope fences conflict, stop and ask the user with three clearly separated options (additive / downgrade / defer). Do not silently pick.

## ESM Packages

`packages/cli` uses ESM (`"type": "module"`). Never use `__dirname` or `require()` — use `import.meta.url` and dynamic `import()`. See PATTERNS.md for the replacement pattern.
