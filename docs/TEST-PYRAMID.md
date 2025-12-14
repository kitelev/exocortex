# Test Pyramid Policy

> **Formal test architecture strategy and coverage gates for the Exocortex project.**
>
> This document establishes the test pyramid structure, coverage requirements, and CI enforcement mechanisms.

---

## Overview

The Exocortex project follows the **Test Pyramid** architecture pattern, which prioritizes:
1. Many fast, isolated **unit tests** at the base
2. Fewer **component/integration tests** in the middle
3. Minimal **end-to-end tests** at the top

```
           /\
          /  \      E2E Tests (5%)
         /----\     ~20 specs, critical paths only
        /      \
       /--------\   Component Tests (15%)
      /          \  ~30 specs, UI behavior
     /------------\
    /              \ Unit Tests (80%)
   /                \ 2500+ tests, business logic
  /__________________\
```

---

## Test Layers

### Layer 1: Unit Tests (80% of test effort)

**Purpose**: Test business logic, services, and utilities in isolation.

**Characteristics**:
- Fast execution (<100ms per test)
- No external dependencies (mocked)
- Deterministic (no flakiness)
- High coverage of edge cases

**Framework**: Jest + ts-jest

**Locations**:
- `packages/exocortex/tests/unit/` - Core business logic
- `packages/obsidian-plugin/tests/unit/` - Plugin-specific logic
- `packages/cli/tests/unit/` - CLI commands and utilities

**Coverage Targets** (enforced in CI):

| Package | Statements | Branches | Functions | Lines |
|---------|------------|----------|-----------|-------|
| obsidian-plugin | 80% | 70% | 73% | 80% |
| core | 95% | 95% | 95% | 95% |
| cli | 65% | 60% | 70% | 65% |

---

### Layer 2: Component Tests (15% of test effort)

**Purpose**: Test React components in isolation with real browser rendering.

**Characteristics**:
- Medium execution speed (~1-5s per test)
- Real browser environment (Chromium)
- Visual regression testing
- Component isolation (no full app)

**Framework**: Playwright Component Testing

**Location**: `packages/obsidian-plugin/tests/component/`

**Scope**:
- All major UI components
- User interaction flows
- Visual regression snapshots
- State management within components

**CI Gate**: All component tests must pass (no coverage threshold, but 100% test pass rate required)

---

### Layer 3: E2E Tests (5% of test effort)

**Purpose**: Test critical user journeys in real Obsidian instance.

**Characteristics**:
- Slow execution (~30-60s per test)
- Real Obsidian environment (via Docker)
- Tests full integration
- Limited to critical paths only

**Framework**: Playwright E2E

**Location**: `packages/obsidian-plugin/tests/e2e/`

**Critical Paths Covered**:
1. Plugin activation and initialization
2. Daily note rendering with tasks
3. Task status transitions
4. Layout switching
5. SPARQL query execution

**CI Gate**: All E2E tests must pass (100% pass rate required)

---

### Layer 4: BDD/Acceptance Tests (Documentation layer)

**Purpose**: Document and validate business requirements in Gherkin syntax.

**Characteristics**:
- Human-readable scenarios
- Living documentation
- Acceptance criteria validation
- Stakeholder communication

**Framework**: Cucumber

**Location**: `packages/obsidian-plugin/specs/features/`

**CI Gate**: `bdd:check` must pass with ≥80% scenario coverage

---

## Coverage Gates

### CI Pipeline Enforcement

The CI pipeline enforces coverage thresholds at multiple levels:

```yaml
# Coverage verification in test-coverage job
test-coverage:
  steps:
    - Run unit tests with coverage
    - Check per-package thresholds
    - Generate coverage artifacts
    - Fail if below thresholds
```

### Current Thresholds (December 2025)

#### obsidian-plugin Package

| Metric | Required | Current | Status |
|--------|----------|---------|--------|
| Statements | 80% | 82.64% | ✅ |
| Branches | 70% | 72.32% | ✅ |
| Functions | 73% | 75.76% | ✅ |
| Lines | 80% | 82.91% | ✅ |

#### core Package

| Metric | Required | Current | Status |
|--------|----------|---------|--------|
| Statements | 95% | TBD | 🎯 |
| Branches | 95% | TBD | 🎯 |
| Functions | 95% | TBD | 🎯 |
| Lines | 95% | TBD | 🎯 |

#### cli Package

| Metric | Required | Current | Status |
|--------|----------|---------|--------|
| Statements | 65% | 69.29% | ✅ |
| Branches | 60% | 62.97% | ✅ |
| Functions | 70% | 77.43% | ✅ |
| Lines | 65% | 68.99% | ✅ |

---

## Coverage Progression Goals

### Completed (December 2025)

- [x] obsidian-plugin: 80% statements, 70% branches (Issue #786)
- [x] Restored coverage thresholds from temporary reduction

### Short-term (Q1 2026)

- [ ] obsidian-plugin: 85% statements, 75% branches
- [ ] cli: 75% statements, 70% branches
- [ ] Core package coverage collection working in CI

### Medium-term (Q2-Q3 2026)

- [ ] obsidian-plugin: 85% statements, 80% branches
- [ ] cli: 80% statements, 75% branches
- [ ] All packages integrated in coverage report

### Long-term (2026+)

- [ ] Global minimum: 85% statements across all packages
- [ ] Domain layer: 90%+ coverage
- [ ] All critical paths covered by E2E tests

---

## Test Distribution Analysis

### Current Distribution (December 2025)

```
Test Files by Type:
├── Unit Tests:      221 files (80.1%)
├── Component Tests:   0 files (Playwright CT specs in .spec.tsx)
├── E2E Tests:        19 files (6.9%)
├── UI Tests:          2 files (0.7%)
└── Infrastructure:   34 files (12.3%)
                     ─────────────────
                     276 total files
```

### Test Count by Package

| Package | Unit | Component | E2E | Total |
|---------|------|-----------|-----|-------|
| obsidian-plugin | 2535 | N/A | N/A | 2535 |
| core | 1672+ | N/A | N/A | 1672+ |
| cli | 520 | N/A | N/A | 520 |

---

## Best Practices

### What to Test at Each Level

#### Unit Tests (Bottom of Pyramid)

**DO test**:
- Pure functions and transformations
- Business logic and domain rules
- Service methods with mocked dependencies
- Edge cases and error conditions
- Algorithm correctness

**DON'T test**:
- Private implementation details
- Simple getters/setters
- Framework code (React, Obsidian)
- Third-party library internals

#### Component Tests (Middle of Pyramid)

**DO test**:
- Component rendering and props
- User interactions (click, type, focus)
- Visual regression (screenshots)
- Component state changes
- Accessibility attributes

**DON'T test**:
- Business logic (use unit tests)
- API calls (mock them)
- Full user workflows (use E2E)

#### E2E Tests (Top of Pyramid)

**DO test**:
- Critical user journeys
- Full integration flows
- Real file operations
- Cross-component interactions

**DON'T test**:
- Every feature variation
- Edge cases (use unit tests)
- Styling details (use component tests)

---

## CI Pipeline Structure

```
┌─────────────────────────────────────────────────────────┐
│                    CI Pipeline                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │  Build  │  │TypeCheck│  │   Lint  │  │   BDD   │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │
│       │            │            │            │         │
│       └────────────┴────────────┴────────────┘         │
│                         │                              │
│  ┌──────────────────────┴──────────────────────┐      │
│  │                                              │      │
│  │  ┌───────────────┐  ┌───────────────┐       │      │
│  │  │  Unit Tests   │  │   Coverage    │       │      │
│  │  │  + UI Tests   │  │   Analysis    │       │      │
│  │  └───────────────┘  └───────────────┘       │      │
│  │                                              │      │
│  │  ┌───────────────┐  ┌───────────────┐       │      │
│  │  │   Component   │  │     E2E       │       │      │
│  │  │     Tests     │  │    Tests      │       │      │
│  │  └───────────────┘  └───────────────┘       │      │
│  │                                              │      │
│  └──────────────────────────────────────────────┘      │
│                         │                              │
│                    ┌────┴────┐                         │
│                    │ Release │                         │
│                    └─────────┘                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Preventing Coverage Regression

### Rules for New Code

1. **New features** must include unit tests with ≥80% coverage
2. **Bug fixes** must include regression test
3. **Refactoring** must maintain or improve coverage
4. **CI blocks merge** if coverage drops below thresholds

### Coverage Review Checklist

- [ ] Unit tests cover happy path
- [ ] Unit tests cover error conditions
- [ ] Edge cases documented and tested
- [ ] No commented-out tests
- [ ] Test names describe behavior, not implementation

---

## References

- [TESTING.md](../TESTING.md) - Comprehensive testing guide
- [docs/Testing-Guide.md](./Testing-Guide.md) - Quick reference
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) - CI configuration
- [packages/obsidian-plugin/jest.config.js](../packages/obsidian-plugin/jest.config.js) - Jest configuration

---

**Last Updated**: December 2025
