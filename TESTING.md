# Testing Guide

Comprehensive documentation for testing the Exocortex monorepo. This guide covers all test types, frameworks, patterns, and best practices.

> **📐 Test Pyramid Policy**: For formal test architecture strategy, coverage thresholds, and CI enforcement mechanisms, see **[docs/TEST-PYRAMID.md](./docs/TEST-PYRAMID.md)**.

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

# Run with coverage
npm run test:coverage

# BDD coverage check
npm run bdd:check       # Enforced in CI (≥80%)
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

| Pattern | Location | Runner |
|---------|----------|--------|
| `*.test.ts` | `packages/*/tests/unit/` | Jest |
| `*.test.ts` | `packages/*/tests/ui/` | Jest (jsdom) |
| `*.spec.tsx` | `packages/obsidian-plugin/tests/component/` | Playwright CT |
| `*.spec.ts` | `packages/obsidian-plugin/tests/e2e/specs/` | Playwright |
| `*.feature` | `packages/obsidian-plugin/specs/features/` | Cucumber |

---

## Test Types

### Unit Tests

**Purpose**: Test business logic in isolation using mocks for external dependencies.

**Framework**: Jest + ts-jest

**Location**:
- `packages/exocortex/tests/` - Core business logic
- `packages/obsidian-plugin/tests/unit/` - Plugin-specific logic
- `packages/cli/tests/unit/` - CLI commands and utilities

**Configuration**: `packages/*/jest.config.js`

**Command**:
```bash
npm run test:unit

# Run single test file
npx jest packages/exocortex/tests/utilities/FrontmatterService.test.ts --no-coverage

# Run with watch mode (development)
npx jest --watch packages/exocortex/tests/utilities/FrontmatterService.test.ts
```

**Example**:
```typescript
import { StatusTimestampService } from "../../src/services/StatusTimestampService";
import { createMockVault, createMockFile } from "../helpers/mockFactory";

describe("StatusTimestampService", () => {
  let service: StatusTimestampService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = createMockVault();
    service = new StatusTimestampService(mockVault);
  });

  describe("recordStatusChange", () => {
    it("should add timestamp for new status", async () => {
      // Arrange
      const file = createMockFile("task.md");
      mockVault.read.mockResolvedValue("---\nstatus: draft\n---\n# Task");

      // Act
      await service.recordStatusChange(file, "draft", "doing");

      // Assert
      expect(mockVault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("ems__doing_timestamp")
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
├── test-vault/              # Test Obsidian vault
│   ├── .obsidian/          # Obsidian config
│   ├── Daily Notes/        # DailyNote fixtures
│   └── Tasks/              # Task fixtures
├── utils/                   # Test utilities
│   └── obsidian-launcher.ts # Obsidian launcher helper
└── specs/                   # Test specs
    └── daily-note-tasks.spec.ts
```

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

### BDD Tests

**Purpose**: Document and test behavior using Gherkin syntax.

**Framework**: Cucumber with jest-cucumber

**Location**: `packages/obsidian-plugin/specs/features/`

**Configuration**: `cucumber.js` (in package root)

**Commands**:
```bash
# Run BDD tests
npm run bdd:test

# Dry run (validate syntax)
npm run bdd:test:dry

# Coverage report
npm run bdd:coverage

# Check coverage threshold (≥80%)
npm run bdd:check
```

**Example Feature File** (`daily-tasks.feature`):
```gherkin
Feature: Daily Tasks Table in Layout
  As a user viewing a pn__DailyNote
  I want to see all tasks scheduled for that day
  So that I can manage my daily tasks efficiently

  Background:
    Given Dataview plugin is installed and active
    And I am viewing a note with UniversalLayout

  Scenario: Display tasks for DailyNote with tasks
    Given I have a pn__DailyNote for "2025-10-16"
    And the note has "pn__DailyNote_day" property set to "[[2025-10-16]]"
    And there are 3 tasks with "ems__Effort_day" property set to "[[2025-10-16]]"
    When I view the daily note
    Then I should see a "Tasks" section
    And I should see 3 tasks in the table

  Scenario: Tasks sorted by votes within same status
    Given I have a pn__DailyNote for "2025-10-16"
    And task "High Priority" has status "[[ems__EffortStatusDoing]]" and "ems__Effort_votes" set to 5
    And task "Low Priority" has status "[[ems__EffortStatusDoing]]" and "ems__Effort_votes" set to 1
    When I view the daily note
    Then tasks should be sorted in order: "High Priority", "Low Priority"
```

**When to use BDD tests**:
- Documenting user-facing behavior
- Acceptance criteria for features
- Communication between developers and stakeholders
- High-level integration scenarios

---

## Test Architecture

### Test Pyramid Policy

The project enforces a **test pyramid architecture** to ensure fast feedback, maintainable tests, and optimal resource usage. This policy is validated automatically in CI.

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

| Layer | Target Ratio | CI Gate | Framework |
|-------|--------------|---------|-----------|
| Unit Tests | ≥70% | `npm run test:pyramid:strict` | Jest |
| Component Tests | 10-25% | All must pass | Playwright CT |
| E2E Tests | ≤10% | All must pass | Playwright E2E |
| BDD Scenarios | 100% coverage | `npm run bdd:check` | Cucumber |

#### Why This Structure?

1. **Fast Feedback**: Unit tests run in seconds, catching bugs early
2. **Cost Efficiency**: Unit tests are cheap to write and maintain
3. **Reliability**: Fewer flaky tests (E2E tests are most flaky)
4. **Comprehensive Coverage**: Each layer tests different aspects

#### Pyramid Health Check

Run the health check locally:

```bash
# Visual report
npm run test:pyramid

# Strict validation (fails if ratios violated)
npm run test:pyramid:strict

# JSON output for CI/automation
npm run test:pyramid -- --json
```

Example output:

```
🔺 Test Pyramid Health Check
════════════════════════════════════════════════════════════

📊 Test Distribution:

   Unit Tests:      244 files, 5116 cases (84%)
   Component Tests: 33 files, 530 cases (11%)
   E2E Tests:       14 files, 67 cases (5%)
   ─────────────────────────────────────
   Total:           291 files, 5713 cases

📐 Test Pyramid:

   E2E        [█                   ] 5%
   Component  [██                  ] 11%
   Unit       [████████████████    ] 84%

🏥 Pyramid Health:

   ✅ Pyramid structure is healthy
```

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

### Current Test Distribution

As of December 2025:

| Type | Files | Test Cases | Percentage |
|------|-------|------------|------------|
| Unit | ~244 | ~5116 | 84% |
| Component | ~33 | ~530 | 11% |
| E2E | ~14 | ~67 | 5% |
| **Total** | **291** | **5713** | **100%** |

This distribution is **healthy** and follows the test pyramid principles.

### Package-Specific Testing

#### exocortex

Pure business logic, storage-agnostic utilities.

**Test Focus**:
- Domain models and entities
- Business services
- Utility functions
- SPARQL engine

**Configuration**: `packages/exocortex/jest.config.js`

**Coverage Threshold**: 95% (branches, functions, lines, statements)

```bash
# Run core tests
npx jest --config packages/exocortex/jest.config.js
```

#### @exocortex/obsidian-plugin

Obsidian UI integration layer.

**Test Focus**:
- React components
- Obsidian adapter integration
- Layout renderers
- Command handlers

**Configuration**: `packages/obsidian-plugin/jest.config.js`

**Coverage Thresholds**:
- Branches: 67%
- Functions: 71%
- Lines: 78%
- Statements: 79%

```bash
# Run plugin tests
npx jest --config packages/obsidian-plugin/jest.config.js
```

#### @exocortex/cli

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

| Method | Description | Default Values |
|--------|-------------|----------------|
| `task()` | Creates a task fixture | status: "Draft", votes: 0 |
| `project()` | Creates a project fixture | status: "Draft", votes: 0 |
| `area()` | Creates an area fixture | isArchived: false |
| `meeting()` | Creates a meeting fixture | status: "Draft" |
| `concept()` | Creates a concept fixture | isArchived: false |

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

**Global Thresholds** (enforced in CI):

| Metric | Threshold | Current |
|--------|-----------|---------|
| Branches | 67% | ~68% |
| Functions | 71% | ~72% |
| Lines | 78% | ~79% |
| Statements | 79% | ~79% |

**Domain Layer Targets** (aspirational):
- Branches: 78%
- Functions: 80%
- Lines: 79%
- Statements: 78%

### BDD Coverage

**Minimum**: 80% of feature scenarios must have step definitions.

```bash
# Check BDD coverage
npm run bdd:check

# Generate BDD report
npm run bdd:report
```

### Test Jobs in CI

The CI pipeline runs tests in this order:

1. **Type checking** - `tsc --noEmit`
2. **Linting** - ESLint with TypeScript rules
3. **Build** - Full production build
4. **Unit tests** - Jest with coverage (batched for stability)
5. **UI tests** - Jest with jsdom environment
6. **Component tests** - Playwright CT (Chromium)
7. **BDD coverage check** - Cucumber scenario coverage
8. **E2E tests** - Playwright in Docker with Obsidian

**Release is blocked if ANY test fails.**

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
   testTimeout: process.env.CI ? 300000 : 60000
   ```

2. For Playwright tests:
   ```typescript
   // playwright.config.ts
   timeout: 90000
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
   await expect.poll(
     async () => component.locator(".status").textContent()
   ).toBe("Ready");
   ```

3. Disable animations in visual tests:
   ```typescript
   expect: {
     toHaveScreenshot: {
       animations: "disabled"
     }
   }
   ```

4. Add retries for E2E tests:
   ```typescript
   retries: process.env.CI ? 2 : 0
   ```

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
   timeout: 120000
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
- [Cucumber](https://cucumber.io/docs/guides/) - BDD framework

### Internal References

- [TEST_TEMPLATES.md](./TEST_TEMPLATES.md) - Ready-to-use test code templates
- [COVERAGE_ANALYSIS.md](./COVERAGE_ANALYSIS.md) - Detailed coverage analysis
- [COVERAGE_QUICK_REFERENCE.md](./COVERAGE_QUICK_REFERENCE.md) - Quick coverage summary
- [packages/obsidian-plugin/docs/TESTING.md](./packages/obsidian-plugin/docs/TESTING.md) - Plugin-specific testing patterns

### Code Examples

- `packages/exocortex/tests/` - Core package test examples
- `packages/obsidian-plugin/tests/unit/` - Unit test patterns
- `packages/obsidian-plugin/tests/component/` - Component test patterns
- `packages/obsidian-plugin/specs/features/` - BDD feature files

---

## Quick Reference

### Commands

| Command | Purpose | Speed |
|---------|---------|-------|
| `npm test` | Unit + UI + Component tests | ~30s |
| `npm run test:all` | All tests including E2E | ~5min |
| `npm run test:unit` | Unit tests only | ~8s |
| `npm run test:component` | Component tests | ~30s |
| `npm run test:e2e:docker` | E2E in Docker | ~3min |
| `npm run bdd:check` | BDD coverage check | ~5s |
| `npm run test:pyramid` | Test pyramid health check | ~2s |
| `npm run test:pyramid:strict` | Pyramid check (fails on violation) | ~2s |

### Coverage Targets

| Layer | Target | Current |
|-------|--------|---------|
| Global (statements) | 75% | ✅ 80% |
| Global (branches) | 67% | ✅ 71% |
| Global (functions) | 70% | ✅ 73% |
| Global (lines) | 75% | ✅ 81% |
| BDD scenarios | 100% | ✅ |
| Domain layer | 78% | 🎯 |

### Test Pyramid Targets

| Layer | Target Ratio | Current |
|-------|--------------|---------|
| Unit Tests | ≥70% | ✅ 84% |
| Component Tests | 10-25% | ✅ 11% |
| E2E Tests | ≤10% | ✅ 5% |

### Test Count

| Type | Files | Test Cases |
|------|-------|------------|
| Unit tests | ~244 | ~5116 |
| Component tests | ~33 | ~530 |
| E2E tests | ~14 | ~67 |
| BDD scenarios | 14 | ~50 |

---

**Last updated**: 2025-12-11
