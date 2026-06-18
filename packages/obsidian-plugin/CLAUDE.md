# Exocortex Obsidian Plugin — Development Guidelines

> **Worktree rules, PR workflow, CI/CD**: See `../../CLAUDE.md` (exocortex-development root).
> **Coding patterns**: See `../../PATTERNS.md`.
> **Dev/CI troubleshooting**: See `../../DEV-TROUBLESHOOTING.md`.

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
npm run test:all   # MUST pass: unit + component + e2e
```

**Absolute prohibitions:**

- NEVER `git commit --no-verify`
- NEVER delete/skip failing tests — fix them
- NEVER create PR without tests for new code

---

## Test layers

New code MUST add tests on every applicable layer before merge.

| Layer           | Runner                       | Location                                      | Purpose                                                                                                                   |
| --------------- | ---------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Unit**        | Jest (ts-jest)               | `packages/*/tests/unit/**`                    | Services, executors, command + visibility logic, helpers — mocked boundaries.                                            |
| **Integration** | Jest + real services         | `packages/cli/tests/integration/**`           | End-to-end command flows through the real `GroundingExecutor` / adapters against fixtures (e.g. `packages/exoas-exocmd`). |
| **Component**   | Playwright CT                | `packages/obsidian-plugin/tests/component/**` | React UI components in isolation.                                                                                         |
| **E2E**         | Playwright + Docker Obsidian | `packages/obsidian-plugin/tests/e2e/specs/**` | Real plugin in Obsidian UI; golden-path smoke, sharded across `e2e-shard (1..6)`.                                        |

**Required CI checks (branch-protected):** see [docs/reference/ci/required-checks.md](../../docs/reference/ci/required-checks.md) — the single source (with the live `gh api …/required_status_checks` command).

---

## Architecture

```
packages/
  exocortex/          — exocortex (storage-agnostic core: domain logic, RDF, SPARQL)
    src/domain/        — Entities, value objects, repositories
    src/application/   — Use cases, services
    src/infrastructure — File system adapters
  obsidian-plugin/    — @exocortex/obsidian-plugin (Obsidian UI — consumer)
    src/presentation/  — UI components, modals, renderers
    src/infrastructure — Obsidian API integration
  cli/                — @kitelev/exocortex-cli (CLI tooling — consumer)
  services/           — @kitelev/exocortex-services (shared grounding-service factories)
  test-utils/         — @exocortex/test-utils (shared test infrastructure)
```

> `packages/exoas-exo` and `packages/exoas-exocmd` are data submodules (ontology
> assets), explicitly excluded from npm workspaces — not code packages.

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

- **Tests:** unit (Jest) + component (Playwright CT) + E2E (Playwright/Docker). Run `npm run test:all` for live counts.
- **Coverage:** ≥49% global, ≥78-80% domain layer
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
- `../../DEV-TROUBLESHOOTING.md` — Dev/CI issues and fixes
- `ARCHITECTURE.md` — Detailed architecture docs
- `docs/reference/PROPERTY_SCHEMA.md` — Frontmatter vocabulary
