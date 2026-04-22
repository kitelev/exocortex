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
├── exocortex/          # @exocortex/core — domain models, RDF, SPARQL, services
├── obsidian-plugin/    # Obsidian plugin — UI, renderers, commands
└── cli/                # @kitelev/exocortex-cli — CLI tooling
```

## Architecture (Clean Architecture)

```
presentation/    → UI components, renderers, React
application/     → Use cases, orchestration, commands
domain/          → Models, RDF, SPARQL, business logic
infrastructure/  → Obsidian API adapters, file system
```

## Quality Metrics

- **Tests:** 564 test files, ~11K+ individual test cases (parametrized). Run `npm run test:all` for exact count.
- **Coverage thresholds**: statements 75.5%, branches 63%, BDD ≥80%
- **Required CI checks (13, post CI Path 2 D0 2026-04-22)**: archgate · detect-changes · e2e-shard (1..6) · lint · test-bdd · test-component · test-coverage · typecheck. Source of truth: `gh api repos/kitelev/exocortex/branches/main/protection/required_status_checks`.
- **CI pipeline target**: post-Phase 3 baseline is ~236s avg ±50s (N=3 on main). Gate relaxed to **≤220s** per Decision B (RFC v2 relax, 2026-04-22); original ≤135s target was infeasible given setup-floor dominance. See `docs/ROLLBACK_CI_SPEEDUP.md` for per-phase revert procedure.

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
gh pr merge --auto --squash                         # Wait for 11 required CI checks
```

**Task is NOT complete until**: CI green + PR merged + Auto Release succeeds + post-mortem written.

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
