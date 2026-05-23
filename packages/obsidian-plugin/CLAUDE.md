# Exocortex Obsidian Plugin — Development Guidelines

> **Worktree rules, PR workflow, CI/CD**: See `../../CLAUDE.md` (exocortex-development root).
> **Coding patterns**: See `../../PATTERNS.md`.
> **Troubleshooting**: See `../../TROUBLESHOOTING.md`.

---

## Quick Commands

```bash
npm run test:all                     # ALL tests before PR (mandatory)
npm run test:unit                    # Unit tests only (~15s)
npx jest --config packages/obsidian-plugin/jest.config.js path/to/test.ts --runInBand  # Single suite
```

---

## Test Requirements

**Golden Rule:** Every new feature MUST have tests BEFORE creating PR.

| Change type             | Required tests                              |
| ----------------------- | ------------------------------------------- |
| New Service             | Unit tests (all public methods, edge cases) |
| New Visibility Function | Unit tests (all true/false branches)        |
| New UI Component        | Playwright Component Tests                  |
| New Command             | Integration via CommandManager.test.ts      |

```bash
npm run test:all   # MUST pass: unit + component + e2e + BDD ≥80%
```

**Absolute prohibitions:**

- NEVER `git commit --no-verify`
- NEVER delete/skip failing tests — fix them
- NEVER create PR without tests for new code

---

## Testing Conventions — RFC-CI-Tests L1/L2/L3 (Phase 4)

Starter-kit dynamic commands (`exocmd__Command`) are covered in three layers. New commands MUST add tests on every applicable layer before merge. Source of truth: `/Users/kitelev/Developer/rfc-ci-button-testing-2026-04-20.md` (RFC v5).

| Layer                | Runner                          | Location                                      | Purpose                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **L1 — Unit**        | Jest (ts-jest)                  | `packages/cli/tests/unit/**`                  | Helpers (`command-catalog`, `extract-target-class`, `predict-mutation`, `fixture-factory`, `user-input-factory`, `execute-command`) + per-command outcome assertions with mocked boundaries.                                                                                               |
| **L2 — Integration** | Jest + real `GroundingExecutor` | `packages/cli/tests/integration/commands/**`  | Exercise dynamic commands end-to-end through `CommandResolver` / `PreconditionEvaluator` / `GroundingExecutor` against `packages/exoas-exocmd` fixtures. The legacy parametrized-catalogue + YAML contract gate was retired 2026-05-23 (replaced by RFC v2 byte-diff testing, `aaaa2dea`). |
| **L3 — E2E**         | Playwright + Docker Obsidian    | `packages/obsidian-plugin/tests/e2e/specs/**` | Smoke subset (RFC §7.4.3) exercising the real plugin in Obsidian UI against fixture assets. Distributed across `e2e-shard-1..4`.                                                                                                                                                           |

**When to touch which layer:**

- New helper → L1 unit test in `packages/cli/tests/unit/test-helpers/`.
- New `exocmd__Command` or new grounding → L2 parametrized entry (+ contract invariants if structural) + L1 unit cases for any new dispatch branches.
- New button flow users actually click → L3 smoke spec (or extend existing smoke spec) covering the golden path.

**Required CI checks (branch-protected):** `test-unit`, `test-coverage`, `e2e-shard-1..4`, `archgate`, `test-component`, `typecheck`, `lint` (RFC v5 §8 Phase 4 amendment, 2026-04-21).

**Rollback:** if a layer becomes destabilising (flaky >5%, budget overage, submodule friction), follow the per-trigger mitigation in `docs/ROLLBACK_RFC_CI_TESTS.md` before disabling a check.

**Cross-project note (2026-04-21):** Phase 4 stability was established on top of Phase 3 EXIT (PR #2895) and benefited from the CI Speedup project (PR #2900 — `test-unit` ↔ `test-coverage` jest dedupe); both were counted toward the 5/5 pre-cutover green window.

---

## Architecture

```
packages/
  core/               — @exocortex/core (storage-agnostic domain logic)
    src/domain/        — Entities, value objects, repositories
    src/application/   — Use cases, services
    src/infrastructure — File system adapters
  obsidian-plugin/     — @exocortex/obsidian-plugin (Obsidian UI)
    src/presentation/  — UI components, modals, renderers
    src/infrastructure — Obsidian API integration
  cli/                 — @kitelev/exocortex-cli (CLI tooling)
```

**Stack:** TypeScript strict, React 19, Obsidian API, ESBuild, Jest, Playwright CT/E2E.

**ts-jest quirk:** class-level `async *` methods not transpiled. Use `AsyncIterableIterator` from helper/closure.

---

## Development Patterns (summary)

| Pattern               | Location                | Usage                          |
| --------------------- | ----------------------- | ------------------------------ |
| Repository            | `domain/repositories/`  | Data access abstraction        |
| Result                | `Result<T, E>`          | Error handling (no exceptions) |
| Service Layer         | `application/services/` | Business logic orchestration   |
| Modal Components      | See ../../PATTERNS.md   | React modals with lifecycle    |
| Table Sorting         | See ../../PATTERNS.md   | Visual indicators ▲/▼          |
| SPARQL Error Handling | See ../../PATTERNS.md   | Graceful degradation           |

---

## Quality Metrics

- **Tests:** 803 unit + 8 component + 6 E2E = 817 total
- **Coverage:** ≥49% global, ≥78-80% domain layer
- **BDD coverage:** ≥80%
- **Build:** <2 min all packages
- **Bundle:** ~206kb (React 171kb + Plugin 35kb)

---

## Business Requirements

**Functional:** RDF Triple Store (SPO/POS/OSP), Graph Query Engine, OWL Ontology, Obsidian Integration, Knowledge graph visualization.

**Non-functional:** <100ms queries (10k triples), 99.9% reliability, <30min learning curve, 70%+ coverage, privacy-first (no telemetry).

---

## E2E Testing: Docker-Only

E2E tests run ONLY in Docker (real Obsidian + plugin). Never run locally.

```bash
npm run test:e2e        # Runs Docker-based E2E
```

See ../../PATTERNS.md for Docker E2E setup, debugging, and critical lessons.

---

## Key Resources

- `../../CLAUDE.md` — Worktree coordination, PR workflow, CI checks
- `../../AGENTS.md` — Universal AI agent instructions
- `../../PATTERNS.md` — All coding patterns (50+ patterns)
- `../../TROUBLESHOOTING.md` — Common issues and fixes
- `ARCHITECTURE.md` — Detailed architecture docs
- `docs/PROPERTY_SCHEMA.md` — Frontmatter vocabulary
- `../../docs/ROLLBACK_RFC_CI_TESTS.md` — Per-trigger mitigation paths for RFC-CI-Tests suite
- `/Users/kitelev/Developer/rfc-ci-button-testing-2026-04-20.md` — RFC v5 source of truth (starter-kit L1/L2/L3 coverage)
