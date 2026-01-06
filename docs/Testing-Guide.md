# Testing Guide

**Testing patterns and best practices for Exocortex.**

> **📖 Comprehensive Guide**: For complete testing documentation including all test types, patterns, CI/CD integration, and troubleshooting, see the main **[TESTING.md](../TESTING.md)** guide.

---

## Quick Reference

### Run Tests

```bash
npm test              # Unit + UI + Component tests
npm run test:all      # All tests including E2E
npm run test:unit     # Unit tests only
npm run test:component # Component tests
npm run test:e2e:docker # E2E in Docker
npm run bdd:check     # BDD coverage check
```

### Test Locations

| Type | Location | Framework |
|------|----------|-----------|
| Unit | `packages/*/tests/unit/` | Jest |
| Component | `packages/obsidian-plugin/tests/component/` | Playwright CT |
| E2E | `packages/obsidian-plugin/tests/e2e/` | Playwright |
| BDD | `packages/obsidian-plugin/specs/features/` | Cucumber |

### Coverage Requirements

| Metric | Threshold |
|--------|-----------|
| Statements | 79% |
| Branches | 67% |
| Functions | 71% |
| Lines | 78% |
| BDD scenarios | 80% |

---

## Quick Start: Unit Test

```typescript
import { MyService } from '../../src/services/MyService';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    service = new MyService(mockVault);
  });

  it('should process task correctly', () => {
    const result = service.process(task);
    expect(result).toBe(expected);
  });
});
```

## Mock Helpers

**Location**: `packages/obsidian-plugin/tests/unit/helpers/testHelpers.ts`

```typescript
import {
  createMockApp,
  createMockPlugin,
  createMockMetadata,
  createMockTFile
} from './helpers/testHelpers';

const mockApp = createMockApp();
const mockPlugin = createMockPlugin();
const mockMetadata = createMockMetadata({
  exo__Asset_label: "Test Task"
});
const mockFile = createMockTFile('test.md');
```

### Override Mock Defaults

Always test null/undefined cases explicitly:

```typescript
const metadata = createMockMetadata({
  exo__Asset_label: null  // Test fallback behavior
});
```

---

## E2E Test Logging

E2E tests use a structured logging system for improved readability and debugging.

### Log Levels

Control verbosity via `E2E_LOG_LEVEL` environment variable:

| Level | Value | Description |
|-------|-------|-------------|
| ERROR | 0 | Only errors (red) |
| WARN | 1 | Errors + warnings (yellow) |
| INFO | 2 | Normal output (default) |
| DEBUG | 3 | Verbose debugging (gray) |

```bash
# Run with debug logging
E2E_LOG_LEVEL=3 npm run test:e2e

# Run with errors only (quiet mode)
E2E_LOG_LEVEL=0 npm run test:e2e
```

### Using test.step() for Clarity

Wrap major test operations in `test.step()` for hierarchical output:

```typescript
test("should display tasks", async () => {
  await test.step("Open daily note", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");
  });

  await test.step("Verify tasks visible", async () => {
    await expect(tasksTable).toBeVisible();
  });
});
```

### Custom Logger Usage

The `TestLogger` class provides structured logging for test utilities:

```typescript
import { TestLogger, LogLevel } from "./logger";

const logger = new TestLogger("MyComponent");

logger.phase("Setup");
logger.info("Starting test...");
logger.debug("Debug details", { port: 9222 });
logger.phaseEnd("Setup", true);

// Output:
// ─── Setup ─────────────────────────────────
// [MyComponent] INFO: Starting test...
// ✓ Setup completed
```

---

## Additional Resources

- **[TESTING.md](../TESTING.md)** - Comprehensive testing guide (recommended)
- **[TEST_TEMPLATES.md](../TEST_TEMPLATES.md)** - Ready-to-use test templates
- **[COVERAGE_ANALYSIS.md](../COVERAGE_ANALYSIS.md)** - Coverage analysis report
- **[Plugin Development Guide](./Plugin-Development-Guide.md)**
- **[Core API Reference](./api/Core-API.md)**
