# Exocortex — In-Repo Development Guide

> **Coordination rules, worktree management, and CI/CD**: See `../CLAUDE.md` (parent directory).
> **Universal AI agent instructions**: See `AGENTS.md`.
> **Coding patterns**: See `PATTERNS.md`.
> **Troubleshooting**: See `TROUBLESHOOTING.md`.
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
├── exocortex/          # exocortex — core: domain models, RDF, SPARQL, services
├── obsidian-plugin/    # @exocortex/obsidian-plugin — UI, renderers, commands (consumer)
├── cli/                # @kitelev/exocortex-cli — CLI tooling (consumer)
├── services/           # @kitelev/exocortex-services — shared grounding-service factories
└── test-utils/         # @exocortex/test-utils — shared test infrastructure
```

> `packages/exoas-exo` and `packages/exoas-exocmd` are data submodules
> (ontology assets), explicitly excluded from npm workspaces — not code packages.

## Architecture (Clean Architecture)

```
presentation/    → UI components, renderers, React
application/     → Use cases, orchestration, commands
domain/          → Models, RDF, SPARQL, business logic
infrastructure/  → Obsidian API adapters, file system
```

## Quality Metrics

- **Tests:** 619 test files (run `find packages -name '*.test.ts' | wc -l` for live count; 642 including `.test.tsx`), ~11K+ individual test cases (parametrized). Run `npm run test:all` for exact count.
- **Coverage thresholds**: statements 75.5%, branches 63%, BDD ≥80%
- **Required CI checks (14, parity-gate added post 2026-04-22)**: archgate · detect-changes · e2e-shard (1..6) · lint · parity-gate · test-bdd · test-component · test-coverage · typecheck. Source of truth: `gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks`.
- **CI pipeline target**: post-Phase 3 baseline is ~236s avg ±50s (N=3 on main). Gate relaxed to **≤220s** per Decision B (RFC v2 relax, 2026-04-22); original ≤135s target was infeasible given setup-floor dominance. See `docs/history/ROLLBACK_CI_SPEEDUP.md` for per-phase revert procedure.

## Test Suite Awareness

The exocortex-package jest config has `roots: ['<rootDir>/tests']`, but CI's `test-coverage` step uses an allowlist regex in `scripts/test-ci-batched.sh` (see `EXOCORTEX_JEST_ARGS`). New integration suites under `packages/exocortex/tests/integration/**` are NOT picked up automatically — either add them to the allowlist or accept they can rot silently.

When fixing a bug, run the directly-affected suite locally even if it isn't gated by CI:

```bash
npm test -- packages/exocortex/tests/integration/<affected-suite>.test.ts
```

**Reference**: PR #3189 — `create-instance-grounding.test.ts` was silently red on `main` (12/12 fail, missing parent.md fixture) because the allowlist never included it. Coverage gates measure file/line %, not "did this suite pass"; orphan integration suites can rot indefinitely.

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
gh pr merge --auto --squash                         # Wait for 14 required CI checks
```

**Task is NOT complete until**: CI green + PR merged + Auto Release succeeds + post-mortem written.

## Auto-merge discipline (CRITICAL)

For PRs touching parser / TBox / schema / migration paths
(`packages/exocortex/src/services/{CommandResolver,GroundingExecutor,NoteToRDFConverter}.ts`,
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
Phase 5a BC removal as CI red (`test-bdd` 19 fail + `test-coverage-cli`),
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
