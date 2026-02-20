# ADR-0010: Testing Strategy

## Status

✅ **Accepted** (Implemented)

## Context

The Exocortex codebase requires a comprehensive testing strategy that:
- Validates business logic independently from frameworks
- Tests UI components with real browser rendering
- Ensures end-to-end functionality in realistic environments
- Maintains high coverage without sacrificing test reliability

### Problem

Testing Obsidian plugins presents unique challenges:
1. **Obsidian API mocking**: Complex APIs that are hard to mock accurately
2. **React component testing**: Need real browser for proper rendering
3. **Plugin lifecycle**: Settings, commands, views have complex interactions
4. **E2E testing**: Obsidian doesn't run easily in CI environments

## Decision

We adopt a **Test Pyramid Strategy** with four test levels:

```
                    ┌───────────┐
                    │   E2E     │  1-5%
                    │  (Docker) │  Smoke tests
                    ├───────────┤
                    │ Component │  15-20%
                    │(Playwright)│  React UI
                ┌───┴───────────┴───┐
                │   Integration     │  20-25%
                │ (UI + Mock Vault) │
        ┌───────┴───────────────────┴───────┐
        │           Unit Tests               │  55-60%
        │    (Pure functions, Services)      │
        └────────────────────────────────────┘
```

### Test Type Definitions

**Unit Tests (Jest)**
- Test pure functions and business logic in isolation
- Mock all external dependencies
- Fast execution (~1-5ms per test)
- Location: `packages/*/tests/unit/`

**Integration Tests (Jest + Mocks)**
- Test service interactions with mocked infrastructure
- Use `jest-environment-obsidian` for plugin-specific tests
- Location: `packages/*/tests/ui/`

**Component Tests (Playwright CT)**
- Test React components with real browser rendering
- Visual regression testing with screenshots
- Location: `packages/obsidian-plugin/tests/component/`

**E2E Tests (Playwright + Docker)**
- Test full plugin in real Obsidian environment
- Run in Docker for reproducibility
- Location: `packages/obsidian-plugin/tests/e2e/`

### Test Framework Selection

```yaml
Unit Tests:
  Framework: Jest 30.x + ts-jest
  Reason: Fast, well-integrated with TypeScript, good mocking

Component Tests:
  Framework: Playwright Component Testing
  Reason: Real browser, visual regression, cross-browser support

E2E Tests:
  Framework: Playwright + Docker
  Reason: Reproducible environment, Obsidian in container

BDD:
  Framework: Cucumber (Gherkin syntax)
  Reason: Readable specs, stakeholder communication
```

### Coverage Requirements

| Package | Target | Enforcement |
|---------|--------|-------------|
| exocortex (core) | 95% | CI blocks PR below threshold |
| obsidian-plugin | 80% | CI blocks PR below threshold |
| cli | 80% | CI blocks PR below threshold |
| Overall | 80% | BDD coverage check |

### Test File Organization

```
packages/exocortex/
├── tests/
│   ├── unit/
│   │   ├── domain/           # Entity tests
│   │   ├── application/      # Service tests
│   │   └── infrastructure/   # Utility tests
│   └── integration/          # Cross-service tests

packages/obsidian-plugin/
├── tests/
│   ├── unit/
│   │   ├── services/         # Plugin service tests
│   │   └── helpers/          # Helper function tests
│   ├── ui/                   # UI integration tests
│   ├── component/            # Playwright component tests
│   └── e2e/                  # End-to-end tests
│       ├── specs/            # Test specifications
│       └── fixtures/         # Test data

packages/cli/
├── tests/
│   ├── unit/
│   │   ├── executors/        # Command executor tests
│   │   └── infrastructure/   # Adapter tests
│   └── integration/          # CLI workflow tests
```

### Mocking Strategy

**Pure Functions**: No mocks needed (ADR-0006)

```typescript
// Testing pure function - no mocks!
test('DateFormatter formats timestamp correctly', () => {
  const date = new Date('2025-10-26T14:30:00');
  expect(DateFormatter.toLocalTimestamp(date)).toBe('2025-10-26T14:30:00');
});
```

**Services with Adapters**: Mock the adapter interface

```typescript
// Testing service with mocked adapter
describe('TaskCreationService', () => {
  let service: TaskCreationService;
  let mockFs: jest.Mocked<IFileSystemAdapter>;

  beforeEach(() => {
    mockFs = {
      read: jest.fn(),
      write: jest.fn(),
      create: jest.fn(),
      exists: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    };
    service = new TaskCreationService(mockFs);
  });

  it('creates task file with correct frontmatter', async () => {
    await service.createTask('My Task');

    expect(mockFs.create).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}\.md$/),
      expect.stringContaining('exo__Asset_label: My Task')
    );
  });
});
```

**React Components**: Use test wrappers

```typescript
// Component test with mocked context
test('TaskRow renders status icon', async ({ mount }) => {
  const task = createMockTask({ status: 'Doing' });

  const component = await mount(
    <TaskRow task={task} onStatusChange={jest.fn()} />
  );

  await expect(component.locator('.status-icon')).toContainText('🔄');
});
```

## Consequences

### Positive

- **Fast feedback**: Unit tests run in seconds
- **Reliable UI testing**: Playwright provides stable component tests
- **Realistic E2E**: Docker ensures consistent environment
- **High coverage**: Pyramid ensures broad protection
- **Maintainable**: Clear separation of test types

### Negative

- **Complex setup**: Multiple test frameworks to configure
- **E2E overhead**: Docker setup required for full E2E
- **Learning curve**: Team must understand when to use which test type

### Mitigations

1. **TESTING.md**: Comprehensive guide for all test types
2. **TEST_TEMPLATES.md**: Copy-paste templates for common scenarios
3. **CI enforcement**: Automated coverage checks prevent regression
4. **Pre-commit hooks**: Run unit tests before push

## Alternatives Considered

### Alternative 1: Unit Tests Only

Rely entirely on Jest unit tests with heavy mocking.

**Rejected because**:
- UI rendering bugs would slip through
- Integration issues between components not caught
- No visual regression protection

### Alternative 2: E2E Tests Only

Skip unit tests, focus on end-to-end testing.

**Rejected because**:
- Slow feedback loop (minutes vs seconds)
- Flaky tests in CI
- Hard to pinpoint failure location
- Expensive to maintain

### Alternative 3: Snapshot Testing

Use Jest snapshots for component output.

**Rejected because**:
- Snapshots become noise (updated without review)
- Don't catch visual regressions
- Hard to maintain large snapshots

Playwright visual snapshots are used instead for intentional visual regression testing.

## Related

- **ADR-0006**: Pure Functions Separation (enables mockless testing)
- **ADR-0008**: Clean Architecture (enables layer-specific testing)
- **Documentation**: TESTING.md, TEST_TEMPLATES.md, docs/TEST-PYRAMID.md
- **CI**: `.github/workflows/ci.yml` enforces coverage thresholds

---

**Date**: 2026-02-20
**Author**: AI Development Team
**Related Issues**: #123 (Test Coverage), #2188 (ADR Documentation)
