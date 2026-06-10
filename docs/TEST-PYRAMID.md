# Test Pyramid Policy

> **Conceptual test architecture strategy for the Exocortex project.**
>
> This document explains the pyramid structure and what belongs at each layer.
> For **numbers** — coverage thresholds, CI gates, current test counts — the
> single source of truth is **[TESTING.md](../TESTING.md)** (sections
> "Coverage Gates" and "Current Test Distribution"), which mirrors
> `.github/workflows/ci.yml` and the per-package jest configs. Numbers are
> intentionally not duplicated here.

---

## Overview

The Exocortex project follows the **Test Pyramid** architecture pattern, which prioritizes:

1. Many fast, isolated **unit tests** at the base
2. Fewer **component/integration tests** in the middle
3. Minimal **end-to-end tests** at the top

```
           /\
          /  \      E2E Tests (≤10%)
         /----\     Critical user journeys only
        /      \
       /--------\   Component Tests (10-25%)
      /          \  Isolated React component testing
     /------------\
    /              \ Unit Tests (≥70%)
   /                \ Fast, isolated business logic
  /__________________\
```

### Enforcement status

The layer-ratio distribution is **advisory guidance**, maintained by review
judgment — the automated `test-pyramid` CI gate (and its
`scripts/check-test-pyramid.js` health-check) were removed in audit epic
#3384 (PR #3396): the strict check could not structurally fail, so it gave no
real signal. What **is** enforced in CI:

- Per-package coverage thresholds in the required `test-coverage` check
  (values in [TESTING.md → Coverage Gates](../TESTING.md#coverage-gates)).
- 100% pass rate for component tests (`test-component`) and E2E shards
  (`e2e-shard (1..6)`).
- Zero tolerated flakes for untagged E2E specs — see
  [FLAKY_POLICY.md](./FLAKY_POLICY.md).

---

## Test Layers

### Layer 1: Unit Tests (base of the pyramid)

**Purpose**: Test business logic, services, and utilities in isolation.

**Characteristics**:

- Fast execution (<100ms per test)
- No external dependencies (mocked)
- Deterministic (no flakiness)
- High coverage of edge cases

**Framework**: Jest + ts-jest

**Locations**:

- `packages/exocortex/tests/` - Core business logic
- `packages/obsidian-plugin/tests/unit/` - Plugin-specific logic
- `packages/cli/tests/unit/` - CLI commands and utilities

**CI Gate**: coverage thresholds per package — see
[TESTING.md → Coverage Gates](../TESTING.md#coverage-gates). Note that the
core (`exocortex`) package's 95% threshold is local-only; CI gates core
sources indirectly through the obsidian-plugin merged coverage.

---

### Layer 2: Component Tests (middle of the pyramid)

**Purpose**: Test React components in isolation with real browser rendering.

**Characteristics**:

- Medium execution speed (~1-5s per test)
- Real browser environment (Chromium)
- Visual regression testing
- Component isolation (no full app)

**Framework**: Playwright Component Testing (`.spec.tsx` files)

**Location**: `packages/obsidian-plugin/tests/component/`

**Scope**:

- All major UI components
- User interaction flows
- Visual regression snapshots
- State management within components

**CI Gate**: All component tests must pass (no coverage threshold, 100% pass
rate required). CT runs with `retries: 2` in CI plus a warn-only flaky-count
check.

---

### Layer 3: E2E Tests (top of the pyramid)

**Purpose**: Test critical user journeys in a real Obsidian instance.

**Characteristics**:

- Slow execution (~30-60s per test)
- Real Obsidian environment (via Docker)
- Tests full integration
- Limited to critical paths only

**Framework**: Playwright E2E, sharded across 6 CI shards
(`playwright-shard-assignments.json`)

**Location**: `packages/obsidian-plugin/tests/e2e/specs/`

**CI Gate**: All E2E tests must pass (100% pass rate required). Untagged specs
run with `retries: 0`; known flakes are opted into `retries: 1` via the
`@flaky-track` tag — see [FLAKY_POLICY.md](./FLAKY_POLICY.md).

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

## Preventing Coverage Regression

### Rules for New Code

1. **New features** must include unit tests
2. **Bug fixes** must include a regression test
3. **Refactoring** must maintain or improve coverage
4. **CI blocks merge** if coverage drops below the thresholds in
   [TESTING.md → Coverage Gates](../TESTING.md#coverage-gates)

### Coverage Review Checklist

- [ ] Unit tests cover happy path
- [ ] Unit tests cover error conditions
- [ ] Edge cases documented and tested
- [ ] No commented-out tests
- [ ] Test names describe behavior, not implementation

---

## References

- [TESTING.md](../TESTING.md) - Comprehensive testing guide (source of truth for thresholds and counts)
- [FLAKY_POLICY.md](./FLAKY_POLICY.md) - Flaky test policy
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) - CI configuration
- [packages/obsidian-plugin/jest.config.js](../packages/obsidian-plugin/jest.config.js) - Jest configuration

---

**Last Updated**: 2026-06-10
