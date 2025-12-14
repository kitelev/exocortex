# Testing Guide for Exocortex Plugin

## Overview

The Exocortex plugin uses a comprehensive testing strategy with multiple layers:

1. **Unit Tests** - Fast, isolated tests for business logic
2. **UI Integration Tests** - Tests for UI rendering with mocked Obsidian API
3. **Component Tests** - Playwright Component Testing for React components
4. **E2E Tests** - End-to-end tests with real Obsidian instance

## Test Types

### Unit Tests

**Location**:
- Core: `packages/exocortex/tests/`
- Plugin: `packages/obsidian-plugin/tests/unit/`
- CLI: `packages/cli/tests/`

**Runner**: Jest
**Command**: `npm run test:unit` (runs tests across all packages)

Unit tests verify business logic in isolation using mocks for external dependencies.

```bash
npm run test:unit
```

### UI Integration Tests

**Location**: `packages/obsidian-plugin/tests/ui/`
**Runner**: Jest with jest-environment-obsidian
**Command**: `npm run test:ui --workspace=@exocortex/obsidian-plugin`

UI tests verify that components render correctly with mocked Obsidian API.

```bash
npm run test:ui
```

### Component Tests

**Location**: `packages/obsidian-plugin/tests/component/`
**Runner**: Playwright Component Testing
**Command**: `npm run test:component --workspace=@exocortex/obsidian-plugin`

Component tests verify React components in isolation with real browser rendering.

```bash
npm run test:component

npm run test:component:ui
```

### E2E Tests

**Location**: `packages/obsidian-plugin/tests/e2e/`
**Runner**: Playwright with Electron
**Command**: `npm run test:e2e` (local) or `npm run test:e2e:docker` (Docker)

E2E tests verify the plugin works correctly with a real Obsidian instance.

#### Running E2E Tests Locally

**Option 1: Direct execution** (requires Obsidian installed):

```bash
export OBSIDIAN_PATH="/Applications/Obsidian.app/Contents/MacOS/Obsidian"
npm run test:e2e
```

**Option 2: Docker execution** (recommended):

```bash
npm run test:e2e:docker
```

This builds a Docker image with xvfb (headless X server) and Obsidian, then runs the tests inside the container.

#### E2E Test Structure

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

#### Writing E2E Tests

```typescript
import { test, expect } from '@playwright/test';
import { ObsidianLauncher } from '../utils/obsidian-launcher';

test.describe('My Feature', () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    launcher = new ObsidianLauncher();
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test('should display my feature', async () => {
    await launcher.openFile('Daily Notes/2025-10-16.md');
    const window = await launcher.getWindow();

    await launcher.waitForElement('.my-feature', 30000);

    const element = window.locator('.my-feature');
    await expect(element).toBeVisible();
  });
});
```

## Running All Tests

```bash
npm test

npm run test:all
```

**Note**: `npm test` runs unit + UI + component tests. Use `npm run test:all` to include E2E tests.

## CI/CD Testing

GitHub Actions runs all tests automatically on every push:

1. Type checking
2. Linting
3. Build
4. Unit tests
5. UI integration tests
6. Component tests
7. BDD coverage check
8. E2E tests (in Docker)

**Release is blocked if ANY test fails**.

## BDD Coverage

The project uses BDD (Behavior-Driven Development) with feature files:

```bash
npm run bdd:coverage

npm run bdd:report

npm run bdd:check
```

Minimum BDD coverage: **80%**

## Test Fixtures

### Test Vault Structure

```
packages/obsidian-plugin/tests/e2e/test-vault/
├── .obsidian/
│   └── app.json           # Obsidian settings
├── Daily Notes/
│   └── 2025-10-16.md      # DailyNote fixture
└── Tasks/
    ├── morning-standup.md      # Task for 2025-10-16
    ├── code-review.md          # Task for 2025-10-16
    └── different-day-task.md   # Task for different day (control)
```

### Creating Test Fixtures

1. Add files to `packages/obsidian-plugin/tests/e2e/test-vault/`
2. Include proper frontmatter with Exocortex properties
3. Reference fixtures in test specs

Example task fixture:

```yaml
---
exo__Instance_class: "[[ems__Task]]"
exo__Asset_label: "Morning standup"
exo__Asset_uid: test-task-001
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_day: "[[2025-10-16]]"
ems__Effort_startTimestamp: "2025-10-16T09:00:00"
---
# Morning standup

Daily team sync meeting.
```

## Troubleshooting

### E2E Tests Timeout

Increase timeout in `playwright-e2e.config.ts`:

```typescript
timeout: 120000, // 2 minutes
```

### Obsidian Not Found

Set the `OBSIDIAN_PATH` environment variable:

```bash
export OBSIDIAN_PATH="/Applications/Obsidian.app/Contents/MacOS/Obsidian"
```

Or use Docker: `npm run test:e2e:docker`

### Docker Build Fails

Ensure Docker is running and you have internet access to download Obsidian:

```bash
docker ps
```

### xvfb Not Starting

Check the Docker entrypoint script is executable:

```bash
chmod +x docker-entrypoint-e2e.sh
```

## Best Practices

### Test Pyramid

- **Many** unit tests (fast, isolated)
- **Some** component tests (medium speed, isolated React)
- **Few** UI integration tests (slower, mocked Obsidian)
- **Few** E2E tests (slowest, real Obsidian)

### What to Test Where

**Unit tests**: Business logic, algorithms, data transformations
**Component tests**: React component behavior, user interactions
**UI integration tests**: Obsidian API integration, layout rendering
**E2E tests**: Critical user workflows, regression testing

### Test Behavior, Not Implementation

❌ Bad: `expect(mockDataviewApi.pages).not.toHaveBeenCalled()`
✅ Good: `expect(taskRows.length).toBe(2)`

### Keep E2E Tests Stable

- Use explicit waits: `await launcher.waitForElement(selector, timeout)`
- Avoid flaky selectors: prefer data attributes or stable classes
- Clean up state: close Obsidian in `afterEach`

## Quality Gates

Before committing:

```bash
npm test                # All tests except E2E
npm run bdd:check       # BDD coverage ≥80%
npm run build           # Build succeeds
```

Before release:

```bash
npm run test:all        # All tests including E2E
```

CI enforces all quality gates automatically.
