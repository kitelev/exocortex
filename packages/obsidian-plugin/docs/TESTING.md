# Testing Best Practices

This guide documents the testing infrastructure, patterns, and best practices for the Exocortex Obsidian plugin.

> **Pre-release manual pass**: GitHub Actions does not cover iOS/Android
> WebView. Before publishing a major release, run
> [release-checklist-mobile.md](./release-checklist-mobile.md) —
> a 10-minute manual smoke test on a real device.

## Test Structure

```
tests/
├── __mocks__/          # Global mocks (obsidian.ts)
├── component/          # Playwright component tests
│   └── __snapshots__/  # Visual regression baselines
├── e2e/                # End-to-end tests (Docker)
│   └── specs/          # E2E test specifications
├── infrastructure/     # Infrastructure tests
├── ui/                 # UI tests
│   └── helpers/        # FileBuilder for UI tests
└── unit/               # Jest unit tests
    └── helpers/        # Test helpers and fixtures
```

## Running Tests

```bash
# Run all tests
npm run test:all

# Run specific test suites
npm run test:unit       # Jest unit tests
npm run test:ui         # UI tests
npm run test:component  # Playwright component tests
npm run test:e2e:local  # E2E tests (Docker)

# Run with coverage
npm run test:coverage

# Run single test file
npx jest tests/unit/helpers/TestFixtureBuilder.test.ts --no-coverage
```

## Test Fixture Builder

The `TestFixtureBuilder` provides factory methods for creating deterministic test data.

### Basic Usage

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

### Available Factory Methods

| Method      | Description               | Default Values            |
| ----------- | ------------------------- | ------------------------- |
| `task()`    | Creates a task fixture    | status: "Draft", votes: 0 |
| `project()` | Creates a project fixture | status: "Draft", votes: 0 |
| `area()`    | Creates an area fixture   | isArchived: false         |
| `meeting()` | Creates a meeting fixture | status: "Draft"           |
| `concept()` | Creates a concept fixture | isArchived: false         |

### Creating Metadata

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

### Creating Mock Vaults

```typescript
// Simple vault with basic relationships
const vault = TestFixtureBuilder.simpleVault();
// Contains: 1 area, 1 project, 3 tasks (1 archived)

// Complex vault with hierarchy
const vault = TestFixtureBuilder.complexVault();
// Contains: 3 areas (with parent), 3 projects, 6 tasks, 2 meetings, 2 concepts
```

### Convenience Methods

```typescript
// Create tasks by status
const { tasks, metadata } = TestFixtureBuilder.withTasksByStatus([
  "Draft",
  "To Do",
  "Doing",
  "Done",
]);

// Create tasks by size
const { tasks, metadata } = TestFixtureBuilder.withTasksBySize([
  "XS",
  "S",
  "M",
  "L",
]);

// Create archived tasks
const { tasks, metadata } = TestFixtureBuilder.withArchivedTasks(5);
```

## Visual Regression Testing

Visual regression tests compare screenshots of components against baseline images.

### Configuration

Located in `playwright-ct.config.ts`:

```typescript
expect: {
  toHaveScreenshot: {
    maxDiffPixelRatio: 0.2,  // 20% tolerance for anti-aliasing
    animations: "disabled",
    scale: "css",
  },
}
```

### Writing Visual Tests

```typescript
import { test, expect } from "@playwright/experimental-ct-react";
import { MyComponent } from "./MyComponent";

test("renders correctly", async ({ mount }) => {
  const component = await mount(<MyComponent />);
  await expect(component).toHaveScreenshot("my-component.png");
});
```

### Updating Baselines

```bash
# Update all snapshots
npx playwright test --update-snapshots

# Update specific test
npx playwright test tests/component/MyComponent.spec.tsx --update-snapshots
```

### Snapshot Storage

- Baselines: `tests/component/__snapshots__/`
- Naming: `{testFileName}-snapshots/{arg}-{projectName}.png`

## Mock Patterns

### Mocking Obsidian App

```typescript
import { createMockApp, createMockTFile } from "../helpers/testHelpers";

const mockApp = createMockApp({
  vault: {
    getMarkdownFiles: jest.fn().mockReturnValue([mockFile]),
  },
});
```

### Mocking Plugin

```typescript
import { createMockPlugin } from "../helpers/testHelpers";

const mockPlugin = createMockPlugin({
  settings: {
    currentOntology: "my-ontology",
    showArchivedAssets: true,
  },
});
```

### Mocking Metadata

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

## Best Practices

### 1. Reset State Before Each Test

```typescript
beforeEach(() => {
  TestFixtureBuilder.resetFixtureCounter();
  jest.clearAllMocks();
});
```

### 2. Test Edge Cases

```typescript
it("should handle null label", () => {
  const task = TestFixtureBuilder.task();
  const metadata = TestFixtureBuilder.toMetadata(task, "ems__Task");
  metadata.exo__Asset_label = null; // Override to test fallback

  const result = getDisplayLabel(metadata, "fallback");
  expect(result).toBe("fallback");
});
```

### 3. Use Specific Assertions

```typescript
// Prefer
expect(task.status).toBe("Doing");
expect(tasks).toHaveLength(3);

// Avoid
expect(task.status).toBeTruthy();
expect(tasks.length).toBeGreaterThan(0);
```

### 4. Test Relationships

```typescript
it("should link task to project", () => {
  const vault = TestFixtureBuilder.simpleVault();
  const task = vault.tasks[0];
  const project = vault.projects[0];

  expect(task.parent).toBe(project.basename);
});
```

### 5. Avoid Test Interdependence

Each test should be independent and not rely on state from other tests.

## Troubleshooting

### Playwright Dev Server Stale

After switching worktrees, kill the dev server:

```bash
pkill -f vite
npm run test:component
```

### Mock Default Values Masking Bugs

The `createMockMetadata()` helper provides defaults. Always explicitly test null cases:

```typescript
// Bad: Test passes but bug exists
const metadata = createMockMetadata();
// exo__Asset_label defaults to "Test Asset"

// Good: Explicitly test null
const metadata = createMockMetadata({ exo__Asset_label: null });
```

### Flaky Component Tests

- Increase timeouts for async operations
- Disable animations in visual tests
- Use `await expect.poll()` for state changes

### Coverage Threshold Failures

Extract private methods to testable utility functions:

```typescript
// Before: Private method not testable
class MyComponent {
  private formatValue(value: unknown): string { ... }
}

// After: Exported utility function
export function formatValue(value: unknown): string { ... }
```

## Coverage Requirements

- Global: >= 49%
- Domain layer: >= 78-80%
- Functions: >= 75%

Run coverage check:

```bash
npm run test:coverage
```

## Label Parity E2E

**Spec:** `packages/obsidian-plugin/tests/e2e/specs/wikilink-label-parity.spec.ts`

**Shard:** e2e-shard-6

**Purpose:** Regression guard verifying that bare `[[uuid]]` wikilinks display `exo__Asset_label` in **both** Reading View and Live Preview — not the raw filename/UUID.

**What it tests:**

| Test                       | Mode                                | Mechanism                                                                        |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| Reading View label display | Reading View (preview)              | Obsidian native `aliases` frontmatter resolution → `a.internal-link` text        |
| Live Preview label display | Live Preview (source, source=false) | `WikilinkLabelViewPlugin` CodeMirror extension → `span.exocortex-wikilink-label` |
| Parity assertion           | Both                                | Labels in both modes are equal and neither equals the raw filename               |

**Asset types covered:** `ems__Task`, `ems__Project`, `ims__Concept`

**Fixtures:**

```
tests/e2e/test-vault/
├── Tasks/label-parity-task.md         # ems__Task with exo__Asset_label + aliases
├── Projects/label-parity-project.md   # ems__Project with exo__Asset_label + aliases
└── label-parity/
    ├── lp-concept.md                  # ims__Concept with exo__Asset_label + aliases
    └── lp-host.md                     # Host file with bare [[target]] wikilinks
```

**Invariant being guarded:** When `exo__Asset_label` is set and `aliases` is synced to match it, both rendering modes must display the label. This prevents regressions where one mode shows a UUID while the other shows the human-readable label.
