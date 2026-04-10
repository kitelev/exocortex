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
