# Testing Guide

Comprehensive documentation for testing the Exocortex monorepo. This guide covers all test types, frameworks, patterns, and best practices.

> **📐 Test Pyramid Policy**: for formal test architecture strategy, coverage thresholds, and CI enforcement mechanisms, see **[Test Architecture → Test Pyramid Policy](#test-architecture)** below. This guide is the single canonical testing doc; `docs/TEST-PYRAMID.md`, `.github/TESTING.md`, and `packages/obsidian-plugin/docs/TESTING.md` are now pointer stubs.

## Table of Contents

- [Quick Start](#quick-start)
- [Test Types](#test-types)
- [Test Architecture](#test-architecture)
- [Patterns & Best Practices](#patterns--best-practices)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)
- [Resources](#resources)

---

## Quick Start

### Running Tests

```bash
# Run all tests (unit + UI + component)
npm test

# Run all tests including E2E (requires Docker)
npm run test:all

# Run specific test suites
npm run test:unit       # Jest unit tests (batched for stability)
npm run test:ui         # UI integration tests
npm run test:component  # Playwright component tests
npm run test:e2e:docker # E2E tests in Docker

# Run with coverage (core package only — the root package.json has no test:coverage script)
npm run test:coverage -w @kitelev/exocortex-core
```

### Writing Your First Test

1. Create a test file with `.test.ts` extension in the appropriate `tests/` directory
2. Import the module under test and test utilities
3. Write tests using the AAA pattern (Arrange, Act, Assert)

```typescript
import { FrontmatterService } from "../../src/utilities/FrontmatterService";

describe("FrontmatterService", () => {
  let service: FrontmatterService;

  beforeEach(() => {
    service = new FrontmatterService();
  });

  it("should parse existing frontmatter", () => {
    // Arrange
    const content = "---\nfoo: bar\n---\nBody content";

    // Act
    const result = service.parse(content);

    // Assert
    expect(result.exists).toBe(true);
    expect(result.content).toBe("foo: bar");
  });
});
```

### Test File Naming Conventions

| Pattern      | Location                                    | Runner                           |
| ------------ | ------------------------------------------- | -------------------------------- |
| `*.test.ts`  | `packages/*/tests/unit/`                    | Jest                             |
| `*.test.ts`  | `packages/*/tests/ui/`                      | Jest (jest-environment-obsidian) |
| `*.spec.tsx` | `packages/obsidian-plugin/tests/component/` | Playwright CT                    |
| `*.spec.ts`  | `packages/obsidian-plugin/tests/e2e/specs/` | Playwright                       |

---

## Test Types

### Unit Tests

**Purpose**: Test business logic in isolation using mocks for external dependencies.

**Framework**: Jest + ts-jest

**Location**:

- `packages/core/tests/` - Core business logic
- `packages/obsidian-plugin/tests/unit/` - Plugin-specific logic
- `packages/cli/tests/unit/` - CLI commands and utilities

**Configuration**: `packages/*/jest.config.js`

**Command**:

```bash
npm run test:unit

# Run single test file
npx jest packages/core/tests/utilities/FrontmatterService.test.ts --no-coverage

# Run with watch mode (development)
npx jest --watch packages/core/tests/utilities/FrontmatterService.test.ts
```

**Example**:

```typescript
import { StatusTimestampService } from "../../src/services/StatusTimestampService";
import type { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";

describe("StatusTimestampService", () => {
  let service: StatusTimestampService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;
    service = new StatusTimestampService(mockVault);
  });

  describe("addStartTimestamp", () => {
    it("should write ems__Effort_startTimestamp into frontmatter", async () => {
      // Arrange
      const file = { path: "task.md" } as IFile;
      mockVault.read.mockResolvedValue("---\nstatus: draft\n---\n# Task");

      // Act
      await service.addStartTimestamp(file);

      // Assert
      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("ems__Effort_startTimestamp"),
      );
    });
  });
});
```

**When to use unit tests**:

- Testing pure functions and business logic
- Testing data transformations
- Testing service methods in isolation
- Testing algorithms and utilities

---

### Component Tests

**Purpose**: Test React components in isolation with real browser rendering.

**Framework**: Playwright Component Testing

**Location**: `packages/obsidian-plugin/tests/component/`

**Configuration**: `packages/obsidian-plugin/playwright-ct.config.ts`

**Command**:

```bash
npm run test:component

# With UI mode for debugging
npm run test:component:ui

# Update visual snapshots
npx playwright test -c packages/obsidian-plugin/playwright-ct.config.ts --update-snapshots
```

**Example**:

```typescript
import { test, expect } from "@playwright/experimental-ct-react";
import { TaskRow } from "./TaskRow";

test.describe("TaskRow", () => {
  test("renders task with correct status icon", async ({ mount }) => {
    const task = {
      name: "My Task",
      status: "Doing",
      label: "Test Task",
    };

    const component = await mount(<TaskRow task={task} />);

    await expect(component).toContainText("Test Task");
    await expect(component.locator(".status-icon")).toHaveText("🔄");
  });

  test("visual regression", async ({ mount }) => {
    const component = await mount(<TaskRow task={mockTask} />);
    await expect(component).toHaveScreenshot("task-row-doing.png");
  });
});
```

**Visual Regression Testing**:

- Snapshots stored in `tests/component/__snapshots__/`
- Threshold: 20% pixel difference allowed (for anti-aliasing)
- Update baselines: `npx playwright test --update-snapshots`

**When to use component tests**:

- Testing React component rendering
- Testing user interactions (clicks, inputs)
- Visual regression testing
- Testing component state changes

---

### UI Integration Tests

**Purpose**: Test UI components with mocked Obsidian API.

**Framework**: Jest with jest-environment-obsidian

**Location**: `packages/obsidian-plugin/tests/ui/`

**Configuration**: `packages/obsidian-plugin/jest.ui.config.js`

**Command**:

```bash
npm run test:ui
```

**When to use UI tests**:

- Testing Obsidian API integration points
- Testing layout rendering logic
- Testing with mocked Obsidian environment

---

### E2E Tests

**Purpose**: Test the plugin in a real Obsidian instance.

**Framework**: Playwright with Electron

**Location**: `packages/obsidian-plugin/tests/e2e/`

**Configuration**: `packages/obsidian-plugin/playwright-e2e.config.ts`

**Command**:

```bash
# Docker execution (recommended)
npm run test:e2e:docker

# Local execution (requires Obsidian installed)
export OBSIDIAN_PATH="/Applications/Obsidian.app/Contents/MacOS/Obsidian"
npm run test:e2e
```

**Test Structure**:

```
packages/obsidian-plugin/tests/e2e/
├── test-vault/              # Test Obsidian vault (fixtures)
├── utils/                   # Test utilities (obsidian-launcher.ts, …)
├── reporters/               # Custom Playwright reporters
├── specs/                   # Main smoke suite (sharded e2e-shard 1..6)
├── eka-gui/                 # GUI-BDD create-instance-button suite
└── eka/                     # EKA Obsidian-leg suite
```

#### E2E Suites (enumerated)

The plugin has **three** distinct E2E suites with separate configs and CI jobs:

| Suite                | Location                                                                        | Config                         | CI job / workflow                                | Gating                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Main smoke**       | `tests/e2e/specs/**`                                                            | `playwright-e2e.config.ts`     | `e2e-shard (1..6)` in `.github/workflows/ci.yml` | **Required** (6 of the [required checks](docs/reference/ci/required-checks.md)); sharded via `playwright-shard-assignments.json`                                                                   |
| **EKA GUI-BDD**      | `tests/e2e/eka-gui/create-instance-buttons.spec.ts` (+ `eka-gui-helpers.ts`)    | `playwright-eka-gui.config.ts` | `.github/workflows/eka-gui-e2e.yml`              | **Non-blocking** release-gate: nightly cron + `push:[main]` + `workflow_dispatch`. Drives the real create-instance buttons (Create Task/Project/Area/Meeting) against published `exoas-*` content. |
| **EKA Obsidian-leg** | `tests/e2e/eka/eka-obsidian-leg.spec.ts` (+ `scripts/test-eka-obsidian-leg.sh`) | run via the script             | `.github/workflows/eka-obsidian-leg-e2e.yml`     | **Non-blocking**: nightly cron + `push:[main]` (paths-filtered) + `workflow_dispatch`. Exercises the EKA bootstrap/apply-profile leg in real Obsidian.                                             |

> On Apple Silicon the Docker e2e runs under amd64 QEMU emulation; the EKA suites are intentionally kept **out** of the required `e2e-shard` set so emulation flake never blocks merges. Verify EKA-suite changes via their CI workflow (native amd64 runner), not local Docker.

**Example**:

```typescript
import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";

test.describe("Daily Tasks", () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    launcher = new ObsidianLauncher();
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("should display tasks for daily note", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");
    const window = await launcher.getWindow();

    await launcher.waitForElement(".tasks-section", 30000);

    const tasksSection = window.locator(".tasks-section");
    await expect(tasksSection).toBeVisible();
  });
});
```

**When to use E2E tests**:

- Testing critical user workflows
- Testing full plugin integration with Obsidian
- Regression testing for major features
- Testing file operations and vault modifications

---

## Test Architecture

### Test Pyramid Policy

The project follows a **test pyramid architecture** to ensure fast feedback, maintainable tests, and optimal resource usage. This is advisory guidance maintained by review judgment; the automated `test-pyramid` CI gate was removed (see "Pyramid Health (advisory)" below). Line/branch coverage thresholds remain enforced by the required `test-coverage` job.

#### Pyramid Structure

```
          ╱╲
         ╱  ╲        E2E Tests (≤10%)
        ╱────╲       Critical user journeys only
       ╱      ╲
      ╱────────╲     Component Tests (10-25%)
     ╱          ╲    Isolated React component testing
    ╱────────────╲
   ╱              ╲  Unit Tests (≥70%)
  ╱────────────────╲ Fast, isolated business logic
 ╱__________________╲
```

#### Ratios and Enforcement

| Layer           | Target Ratio | CI Gate           | Framework      |
| --------------- | ------------ | ----------------- | -------------- |
| Unit Tests      | ≥70%         | Advisory (review) | Jest           |
| Component Tests | 10-25%       | All must pass     | Playwright CT  |
| E2E Tests       | ≤10%         | All must pass     | Playwright E2E |

#### Why This Structure?

1. **Fast Feedback**: Unit tests run in seconds, catching bugs early
2. **Cost Efficiency**: Unit tests are cheap to write and maintain
3. **Reliability**: Fewer flaky tests (E2E tests are most flaky)
4. **Comprehensive Coverage**: Each layer tests different aspects

#### Pyramid Health (advisory)

The distribution above is **advisory guidance**, not an automated CI gate. The
`test:pyramid` health-check script (and its `test-pyramid` CI job) were removed
in audit epic #3384: the strict check could not structurally fail — a ~91% unit
share against a 90% cap produced a warning, never a non-zero exit — so it gave
no real signal. Layer ratios are now maintained by review judgment; line/branch
coverage thresholds remain enforced by the required `test-coverage` job.

#### When to Add Each Test Type

**Add Unit Tests when**:

- Testing pure functions and algorithms
- Testing business logic in services
- Testing data transformations
- Testing edge cases and error handling
- Fast iteration is needed

**Add Component Tests when**:

- Testing React component behavior
- Testing user interactions (clicks, inputs)
- Testing visual appearance (snapshots)
- Testing component state changes

**Add E2E Tests when**:

- Testing critical user workflows
- Testing full integration with Obsidian
- Regression testing major features
- Testing file operations and vault modifications

**Avoid adding E2E tests when**:

- The scenario can be tested at unit level
- Testing implementation details
- Testing non-critical paths
- Tests would be flaky or slow

#### Preventing Coverage Regression

Rules for new code:

1. **New features** must include unit tests
2. **Bug fixes** must include a regression test
3. **Refactoring** must maintain or improve coverage
4. **CI blocks merge** if coverage drops below the thresholds in [Coverage Gates](#coverage-gates)

Coverage review checklist:

- [ ] Unit tests cover the happy path
- [ ] Unit tests cover error conditions
- [ ] Edge cases documented and tested
- [ ] No commented-out tests
- [ ] Test names describe behavior, not implementation

### Current Test Distribution

As of June 2026 (file counts; re-derive with the commands below rather than trusting this table):

| Type                | Files | How to count                                                                |
| ------------------- | ----- | --------------------------------------------------------------------------- |
| Jest (`*.test.ts`)  | 691   | `find packages -name '*.test.ts' -not -path '*/node_modules/*' \| wc -l`    |
| Jest (`*.test.tsx`) | 20    | `find packages -name '*.test.tsx' -not -path '*/node_modules/*' \| wc -l`   |
| Component (CT)      | 34    | `find packages/obsidian-plugin/tests/component -name '*.spec.tsx' \| wc -l` |
| E2E specs           | 20    | `find packages/obsidian-plugin/tests/e2e/specs -name '*.spec.ts' \| wc -l`  |

Jest files span unit, UI, integration, and performance suites across all packages. The distribution remains strongly unit-heavy, in line with the pyramid guidance above.

### Package-Specific Testing

#### exocortex

Pure business logic, storage-agnostic utilities.

**Test Focus**:

- Domain models and entities
- Business services
- Utility functions
- SPARQL engine

**Configuration**: `packages/core/jest.config.js`

**Coverage Threshold**: 95% statements / branches / functions / lines — **local-only** (`packages/core/jest.config.js`). CI does **not** collect coverage for this package: the `test-coverage-exocortex` job runs an allowlist of regression suites _without_ `--coverage` (see `.github/workflows/ci.yml`). Core sources do, however, count toward the obsidian-plugin merged coverage gate (the plugin jest config collects coverage from `packages/core/src/**` too).

```bash
# Run core tests
npx jest --config packages/core/jest.config.js

# Run core tests with the local 95% coverage gate
npm run test:coverage -w @kitelev/exocortex-core
```

#### @kitelev/exocortex-obsidian-plugin

Obsidian UI integration layer.

**Test Focus**:

- React components
- Obsidian adapter integration
- Layout renderers
- Command handlers

**Configuration**: `packages/obsidian-plugin/jest.config.js`

**Coverage Thresholds** (enforced both locally in `jest.config.js` and in CI on coverage merged across shards):

- Statements: 75.5%
- Branches: 63%
- Functions: 69%
- Lines: 76%

```bash
# Run plugin tests
npx jest --config packages/obsidian-plugin/jest.config.js
```

#### @kitelev/exocortex-cli

Command-line automation tool.

**Test Focus**:

- CLI command execution
- File system operations
- Batch processing
- Error handling

**Configuration**: `packages/cli/jest.config.js`

```bash
# Run CLI tests
npx jest --config packages/cli/jest.config.js
```

---

## Patterns & Best Practices

### Test Data Management

#### TestFixtureBuilder

Factory methods for creating deterministic test data:

```typescript
import { TestFixtureBuilder } from "../helpers/testHelpers";

describe("MyTest", () => {
  beforeEach(() => {
    TestFixtureBuilder.resetFixtureCounter();
  });

  it("should work with task fixture", () => {
    const task = TestFixtureBuilder.task({
      label: "My Task",
      status: "Doing",
      size: "M",
      votes: 3,
    });

    expect(task.label).toBe("My Task");
    expect(task.status).toBe("Doing");
  });
});
```

**Available Factory Methods**:

| Method      | Description               | Default Values            |
| ----------- | ------------------------- | ------------------------- |
| `task()`    | Creates a task fixture    | status: "Draft", votes: 0 |
| `project()` | Creates a project fixture | status: "Draft", votes: 0 |
| `area()`    | Creates an area fixture   | isArchived: false         |
| `meeting()` | Creates a meeting fixture | status: "Draft"           |
| `concept()` | Creates a concept fixture | isArchived: false         |

#### Creating Metadata

```typescript
const task = TestFixtureBuilder.task({ label: "Test", status: "Doing" });
const metadata = TestFixtureBuilder.toMetadata(task, "ems__Task");

// metadata contains:
// {
//   exo__Instance_class: "[[ems__Task]]",
//   exo__Asset_label: "Test",
//   ems__Effort_status: "[[ems__EffortStatusDoing]]",
//   ...
// }
```

#### Creating Mock Vaults

```typescript
// Simple vault with basic relationships
const vault = TestFixtureBuilder.simpleVault();
// Contains: 1 area, 1 project, 3 tasks (1 archived)

// Complex vault with hierarchy
const vault = TestFixtureBuilder.complexVault();
// Contains: 3 areas (with parent), 3 projects, 6 tasks, 2 meetings, 2 concepts
```

### Mocking

#### When to Mock

- **DO mock**: External dependencies (Obsidian API, file system, network)
- **DO mock**: Services at boundaries (vault adapter, event bus)
- **DON'T mock**: Internal business logic
- **DON'T mock**: The module under test

#### Mocking Obsidian App

```typescript
import { createMockApp, createMockTFile } from "../helpers/testHelpers";

const mockApp = createMockApp({
  vault: {
    getMarkdownFiles: jest.fn().mockReturnValue([mockFile]),
  },
});
```

#### Mocking Plugin

```typescript
import { createMockPlugin } from "../helpers/testHelpers";

const mockPlugin = createMockPlugin({
  settings: {
    currentOntology: "my-ontology",
    showArchivedAssets: true,
  },
});
```

#### Mocking Vault Adapter

```typescript
function createMockVault(): jest.Mocked<IVaultAdapter> {
  return {
    read: jest.fn(),
    modify: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getFiles: jest.fn(),
    getAbstractFileByPath: jest.fn(),
  } as jest.Mocked<IVaultAdapter>;
}
```

#### Mocking Metadata

```typescript
import { createMockMetadata } from "../helpers/testHelpers";

// With defaults
const metadata = createMockMetadata();

// With overrides
const metadata = createMockMetadata({
  exo__Asset_label: "Custom Label",
  ems__Effort_status: "[[ems__EffortStatusDoing]]",
});

// Testing null/undefined values (important!)
const metadata = createMockMetadata({ exo__Asset_label: null });
```

### Async Testing

#### Testing Promises

```typescript
it("should resolve with data", async () => {
  const result = await service.fetchData();
  expect(result).toEqual(expectedData);
});

it("should reject with error", async () => {
  await expect(service.failingOperation()).rejects.toThrow("Expected error");
});
```

#### Testing Timers

```typescript
jest.useFakeTimers();

it("should debounce calls", () => {
  const callback = jest.fn();
  const debounced = debounce(callback, 100);

  debounced();
  debounced();
  debounced();

  expect(callback).not.toHaveBeenCalled();

  jest.advanceTimersByTime(100);

  expect(callback).toHaveBeenCalledTimes(1);
});
```

#### Retries for Flaky Operations

```typescript
// In Playwright component tests
test("should eventually show content", async ({ mount }) => {
  const component = await mount(<AsyncComponent />);

  // Use polling for eventual assertions
  await expect.poll(
    async () => component.locator(".content").textContent(),
    { timeout: 5000 }
  ).toBe("Expected content");
});
```

### Error Testing

#### Expected Errors

```typescript
it("should throw on invalid input", () => {
  expect(() => service.process(null)).toThrow("Input cannot be null");
});

it("should throw specific error type", () => {
  expect(() => service.process(null)).toThrow(ValidationError);
});
```

#### Error Messages

```typescript
it("should provide helpful error message", async () => {
  try {
    await service.failingOperation();
    fail("Expected error to be thrown");
  } catch (error) {
    expect(error.message).toContain("specific context");
    expect(error.code).toBe("ERR_VALIDATION");
  }
});
```

### Best Practices Summary

1. **Reset State Before Each Test**

   ```typescript
   beforeEach(() => {
     TestFixtureBuilder.resetFixtureCounter();
     jest.clearAllMocks();
   });
   ```

2. **Test Edge Cases**

   ```typescript
   it("should handle null label", () => {
     const metadata = createMockMetadata({ exo__Asset_label: null });
     const result = getDisplayLabel(metadata, "fallback");
     expect(result).toBe("fallback");
   });
   ```

3. **Use Specific Assertions**

   ```typescript
   // Prefer
   expect(task.status).toBe("Doing");
   expect(tasks).toHaveLength(3);

   // Avoid
   expect(task.status).toBeTruthy();
   expect(tasks.length).toBeGreaterThan(0);
   ```

4. **Test Behavior, Not Implementation**

   ```typescript
   // Bad: Testing implementation details
   expect(mockDataviewApi.pages).toHaveBeenCalled();

   // Good: Testing observable behavior
   expect(taskRows.length).toBe(2);
   ```

5. **Avoid Test Interdependence**
   - Each test should be independent
   - Use `beforeEach` to set up fresh state
   - Don't rely on test execution order

---

## CI/CD Integration

### Coverage Gates

This is the **single source of truth** for coverage thresholds in this guide. Values below mirror `.github/workflows/ci.yml` and the per-package jest configs — if they disagree, the configs win.

| Package                  | Statements | Branches | Functions | Lines | Enforced where                                                                                          |
| ------------------------ | ---------- | -------- | --------- | ----- | ------------------------------------------------------------------------------------------------------- |
| obsidian-plugin (merged) | 75.5%      | 63%      | 69%       | 76%   | `test-coverage` CI job (merges shard coverage) + `packages/obsidian-plugin/jest.config.js`              |
| cli                      | 65%        | 60%      | 70%       | 65%   | `test-coverage-cli` CI job                                                                              |
| exocortex (core)         | 95%        | 95%      | 95%       | 95%   | **Local-only** (`packages/core/jest.config.js`, via `npm run test:coverage -w @kitelev/exocortex-core`) |

Notes:

- The obsidian-plugin merged coverage also includes `packages/core/src/**` sources (see `collectCoverageFrom` in the plugin jest config), so core code is indirectly gated in CI through the plugin thresholds.
- CI does **not** collect coverage for the exocortex package itself: the `test-coverage-exocortex` job runs an allowlist of regression suites without `--coverage`. The 95% gate fires only on local `npm run test:coverage -w @kitelev/exocortex-core` runs.

### Test Jobs in CI

The required status checks on `main` are listed in **[docs/reference/ci/required-checks.md](docs/reference/ci/required-checks.md)** — the single source for that fact (with the live `gh api` command). The test-related jobs that feed those checks are described below.

Test-related jobs in the pipeline:

1. **typecheck / lint / archgate** - static gates
2. **test-coverage-shard** - Jest unit tests with coverage, sharded; merged and threshold-checked by **test-coverage**
3. **test-coverage-cli** - CLI Jest tests with coverage (65/60/70/65 gate)
4. **test-coverage-exocortex** - allowlisted core regression suites (no coverage collection)
5. **test-ui** - Jest with **jest-environment-obsidian** (`jest.ui.config.js`)
6. **test-component** - Playwright CT (Chromium, `retries: 2` in CI)
7. **e2e-shard (1..6)** - Playwright E2E in Docker with Obsidian, sharded per `playwright-shard-assignments.json`
8. **parity-gate** - CLI ↔ plugin triple-parity integration test

**Release is blocked if ANY required check fails.**

### Flaky Policy & Sharding

See [docs/FLAKY_POLICY.md](./docs/contributing/FLAKY_POLICY.md) for the full policy. Summary of the current (post-#3396) mechanics:

- **Zero-retry default**: E2E specs run with `retries: 0` — a flake fails the run immediately instead of being masked.
- **`@flaky-track` tag opt-in**: `playwright-e2e.config.ts` defines two projects — `e2e` (untagged specs, `grepInvert: /@flaky-track/`, retries 0) and `e2e-flaky-track` (`grep: /@flaky-track/`, `retries: 1`). Tagging a spec `@flaky-track` is the documented, reviewable way to tolerate a known flake while its root cause is being fixed (Issue #3350 / PR #3355). Removing the tag restores strict discipline automatically.
- **NoFlakyReporter**: `packages/obsidian-plugin/playwright-no-flaky-reporter.ts` fails CI on any test that passed only after a retry — but is tag-aware and skips `@flaky-track` tests so the project-level `retries: 1` is not neutralized.
- **Sharding**: E2E specs are distributed across 6 shards via `packages/obsidian-plugin/playwright-shard-assignments.json` (weighted LPT bin-packing). `playwright-shard-config-factory.ts` mirrors the two-project `@flaky-track` routing inside every shard. When adding a new spec, extend exactly one shard array (validator: `scripts/validate-shard-assignments.mjs`).
- **Retry observability**: a `playwright-retry-summary-reporter.ts` writes per-shard `retry-summary.json`; CI aggregates them into the GitHub Actions job summary ("E2E retry summary"). Pure observability, never fails the run.
- **Component tests**: CT runs with `retries: 2` in CI (`playwright-ct.config.ts`); a warn-only "Track Flaky Tests (Component)" CI step surfaces flaky CT counts without failing the job.
- **Quarantine**: `tests/quarantine.ts` lists deliberately skipped/tolerated tests (`QuarantinedTest`: `file`, `name`, plus optional `issue`, `reason`, `quarantinedAt`, `expiresAt`, `owner`). Currently empty by design.
- **Desktop smoke**: a separate `E2E Desktop Smoke` workflow (`.github/workflows/e2e-desktop.yml`) runs a plugin-load smoke spec on real macOS/Windows runners — on the `e2e-desktop` PR label, nightly cron, or manual dispatch. It never blocks regular PRs.

### Coverage Reports

Coverage reports are automatically generated:

- **lcov** - For CI integration and badges
- **json-summary** - Machine-readable summary
- **text-summary** - Console output
- **html** - Local development (when not in CI)

Reports are available as CI artifacts on every run.

---

## Troubleshooting

### Common Issues

#### Test Timeouts

**Symptoms**: Tests fail with timeout errors, especially in CI.

**Solutions**:

1. Increase timeout in test configuration:

   ```javascript
   // jest.config.js
   testTimeout: process.env.CI ? 300000 : 60000;
   ```

2. For Playwright tests:

   ```typescript
   // playwright.config.ts
   timeout: 90000;
   ```

3. For specific tests:
   ```typescript
   test("slow operation", async () => {
     // ...
   }, 60000);
   ```

#### Flaky Tests

**Symptoms**: Tests pass locally but fail intermittently in CI.

**Solutions**:

1. Use explicit waits instead of arbitrary delays:

   ```typescript
   await launcher.waitForElement(".my-element", 30000);
   ```

2. Use polling assertions:

   ```typescript
   await expect
     .poll(async () => component.locator(".status").textContent())
     .toBe("Ready");
   ```

3. Disable animations in visual tests:

   ```typescript
   expect: {
     toHaveScreenshot: {
       animations: "disabled";
     }
   }
   ```

4. For a known-flaky E2E spec whose root cause is still being fixed, do **not** raise `retries` in the config — tag the spec `@flaky-track` instead (it then runs in the `e2e-flaky-track` project with `retries: 1`, and `NoFlakyReporter` skips it):

   ```typescript
   test(
     "should eventually render layout",
     { tag: "@flaky-track" }, // tracked in a GitHub issue; remove tag once fixed
     async () => {
       // ...
     },
   );
   ```

   See [docs/FLAKY_POLICY.md](./docs/contributing/FLAKY_POLICY.md) for the tagging rules.

#### Mock Leaks

**Symptoms**: Tests pass individually but fail when run together.

**Solutions**:

1. Clear mocks in `beforeEach`:

   ```typescript
   beforeEach(() => {
     jest.clearAllMocks();
     jest.restoreAllMocks();
   });
   ```

2. Reset module state:

   ```typescript
   beforeEach(() => {
     jest.resetModules();
   });
   ```

3. Use `restoreMocks: true` in jest config.

#### Mock Default Values Masking Bugs

**Problem**: `createMockMetadata()` provides defaults, hiding null-handling bugs.

**Solution**: Always explicitly test null cases:

```typescript
// Bad: Test passes but bug exists
const metadata = createMockMetadata();
// exo__Asset_label defaults to "Test Asset"

// Good: Explicitly test null
const metadata = createMockMetadata({ exo__Asset_label: null });
```

#### Playwright Dev Server Stale

**Symptoms**: Component tests use old code after switching worktrees.

**Solution**:

```bash
pkill -f vite
npm run test:component
```

#### E2E Tests Timeout

**Symptoms**: E2E tests fail to launch Obsidian.

**Solutions**:

1. Increase timeout in config:

   ```typescript
   timeout: 120000;
   ```

2. Set OBSIDIAN_PATH environment variable:

   ```bash
   export OBSIDIAN_PATH="/Applications/Obsidian.app/Contents/MacOS/Obsidian"
   ```

3. Use Docker for consistent environment:
   ```bash
   npm run test:e2e:docker
   ```

### Debugging

#### Debug Mode (Jest)

```bash
# Run with Node debugger
node --inspect-brk node_modules/.bin/jest --runInBand tests/unit/mytest.test.ts
```

#### VS Code Integration

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Jest Tests",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-coverage", "${file}"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

#### Playwright Debug Mode

```bash
# UI mode for visual debugging
npm run test:component:ui

# Debug specific test
npx playwright test --debug tests/component/MyComponent.spec.tsx
```

#### Log Output

Enable verbose logging in tests:

```typescript
// Jest
console.log("Debug info:", data);

// Playwright
await page.evaluate(() => console.log("Debug from browser"));
```

### Coverage Threshold Failures

**Problem**: New code drops coverage below threshold.

**Solutions**:

1. Write tests for new code
2. Extract testable utilities from complex components:

   ```typescript
   // Before: Private method not testable
   class MyComponent {
     private formatValue(value: unknown): string { ... }
   }

   // After: Exported utility function
   export function formatValue(value: unknown): string { ... }
   ```

3. Temporarily lower thresholds (with documented plan to restore)

---

## Resources

### Framework Documentation

- [Jest](https://jestjs.io/docs/getting-started) - Unit testing framework
- [Playwright](https://playwright.dev/docs/intro) - E2E and component testing
- [Playwright Component Testing](https://playwright.dev/docs/test-components)

### Internal References

- [docs/FLAKY_POLICY.md](./docs/contributing/FLAKY_POLICY.md) - Flaky test policy (@flaky-track, quarantine)
- [docs/TEST-PYRAMID.md](./docs/TEST-PYRAMID.md) - _(stub → this guide)_ pyramid concepts now live in [Test Architecture](#test-architecture)
- [packages/obsidian-plugin/docs/TESTING.md](./packages/obsidian-plugin/docs/TESTING.md) - _(stub → this guide)_ plugin-specific patterns consolidated here

### Code Examples

- `packages/core/tests/` - Core package test examples
- `packages/obsidian-plugin/tests/unit/` - Unit test patterns
- `packages/obsidian-plugin/tests/component/` - Component test patterns

---

## Quick Reference

### Commands

| Command                   | Purpose                     | Speed |
| ------------------------- | --------------------------- | ----- |
| `npm test`                | Unit + UI + Component tests | ~30s  |
| `npm run test:all`        | All tests including E2E     | ~5min |
| `npm run test:unit`       | Unit tests only             | ~8s   |
| `npm run test:component`  | Component tests             | ~30s  |
| `npm run test:e2e:docker` | E2E in Docker               | ~3min |

### Coverage Targets (CI gates)

See [Coverage Gates](#coverage-gates) above for the authoritative table. Summary:

| Package                  | Statements | Branches | Functions | Lines |
| ------------------------ | ---------- | -------- | --------- | ----- |
| obsidian-plugin (merged) | 75.5%      | 63%      | 69%       | 76%   |
| cli                      | 65%        | 60%      | 70%       | 65%   |
| exocortex (local-only)   | 95%        | 95%      | 95%       | 95%   |

### Test Pyramid Targets (advisory)

| Layer           | Target Ratio |
| --------------- | ------------ |
| Unit Tests      | ≥70%         |
| Component Tests | 10-25%       |
| E2E Tests       | ≤10%         |

### Test Count (June 2026)

| Type                       | Files |
| -------------------------- | ----- |
| Jest (`*.test.ts/.tsx`)    | 711   |
| Component tests (CT specs) | 34    |
| E2E specs                  | 20    |

---

## Label parity E2E

**Spec**: `packages/obsidian-plugin/tests/e2e/specs/wikilink-label-parity.spec.ts`

**Purpose**: Regression guard for the "Wikilink Read View Label Restoration" fix (task `bde3a1d3`). Verifies that bare `[[uuid]]` wikilinks are rendered using `exo__Asset_label` in **both** Reading View and Live Preview — not the raw filename/UUID.

**What it covers**:

- Reading View: Obsidian renders `<a class="internal-link">` with alias from `aliases` frontmatter
- Live Preview: `WikilinkLabelViewPlugin` (CodeMirror extension) decorates bare `[[target]]` with `span.exocortex-wikilink-label[data-target-path="target"]`
- Parity assertion: both modes show identical human-readable labels
- 3 asset types: `ems__Task`, `ems__Project`, `ims__Concept`

**Fixtures** (`packages/obsidian-plugin/tests/e2e/test-vault/label-parity/`):
| File | Class | Label |
|------|-------|-------|
| `label-parity-task.md` | `ems__Task` | `LP Task Label` |
| `label-parity-project.md` | `ems__Project` | `LP Project Label` |
| `lp-concept.md` | `ims__Concept` | `LP Concept Label` |
| `lp-host.md` | host file | contains all 3 bare wikilinks |

**CI shard**: shard 6 (see `packages/obsidian-plugin/playwright-shard-assignments.json`)

**Relevant source paths** (spec will fail if these regress):

- `packages/obsidian-plugin/src/presentation/editor-extensions/WikilinkLabelViewPlugin.ts`
- `packages/obsidian-plugin/src/domain/display-name/`
- `packages/obsidian-plugin/src/presentation/body/`

---

**Last updated**: 2026-06-10
