# Exocortex — In-Repo Development Guide

> **Coordination rules, worktree management, and CI/CD**: See `../CLAUDE.md` (parent directory).
> **Universal AI agent instructions**: See `AGENTS.md`.
> **Coding patterns**: See `PATTERNS.md`.
> **Troubleshooting**: See `../TROUBLESHOOTING.md`.

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

- **11,400+ tests** across packages (core 5,777 + plugin 4,566 + CLI 1,146)
- **Coverage thresholds**: statements 75.5%, branches 63%
- **BDD coverage**: 100% required
- **8 required CI checks**: build, typecheck, test-unit, test-coverage, test-bdd, archgate, e2e-tests, test-component

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
gh pr merge --auto --squash                         # Wait for 8 CI checks
```

**Task is NOT complete until**: CI green + PR merged + Auto Release succeeds + post-mortem written.

## RFC Execution: Audit-First Strategy

Before starting any RFC Phase, audit existing codebase for pre-implemented features:

- RFC-013 found 2 of 4 Phases already implemented (property paths, subqueries)
- Saved ~60% of planned implementation time
- Always redirect to test coverage when feature already exists
- 15 min grepping > hours of redundant implementation

## ESM Packages

`packages/cli` uses ESM (`"type": "module"`). Never use `__dirname` or `require()` — use `import.meta.url` and dynamic `import()`. See PATTERNS.md for the replacement pattern.
