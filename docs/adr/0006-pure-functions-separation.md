# ADR-0006: Separate Pure Functions from Obsidian-Coupled Code

## Status

✅ **Accepted** (Partially Implemented)

## Context

As the codebase grows, we need clear separation between:
- **Pure business logic**: Testable, reusable, framework-agnostic
- **Framework integration**: Obsidian-specific, UI-coupled

This separation enables:
- Easier testing (pure functions need no mocks)
- Code reuse (CLI, Web, other adapters)
- Future refactoring (Issue #122: Core extraction)

### Problem

Current state: Business logic mixed with Obsidian API calls

```typescript
// TaskCreationService - mixed concerns
export class TaskCreationService {
  constructor(private vault: Vault) {}  // ❌ Obsidian-coupled

  // ✅ PURE - can be extracted
  generateTaskFrontmatter(metadata, name, ...): Record<string, any> {
    return { ... };  // No side effects
  }

  // ❌ COUPLED - uses Vault directly
  async createTask(sourceFile: TFile, ...): Promise<TFile> {
    const frontmatter = this.generateTaskFrontmatter(...);  // ✅ Pure
    await this.vault.create(path, content);  // ❌ Obsidian
  }
}
```

## Decision

**Identify and document pure functions explicitly**:

### Naming Convention

Mark pure functions with comments or separate into dedicated utilities:

```typescript
// Option 1: Mark with comment
/**
 * Generate task frontmatter
 * @pure No side effects, deterministic
 */
generateTaskFrontmatter(...): Record<string, any>

// Option 2: Separate file
// FrontmatterGenerators.ts
export class TaskFrontmatterGenerator {
  static generate(...): Record<string, any> {
    // All methods here are pure
  }
}
```

### Utility Classes (100% Pure)

These utilities contain ONLY pure functions:

- `FrontmatterService` ✅
- `DateFormatter` ✅
- `WikiLinkHelpers` ✅
- `MetadataHelpers` ✅
- `EffortSortingHelpers` ✅
- `CommandVisibility` (all 25+ functions) ✅

### Service Classes (Mixed)

Services contain both pure and impure methods:

```typescript
export class TaskCreationService {
  // ✅ PURE - extract to Core
  generateTaskFrontmatter(...): Record<string, any>
  extractH2Section(...): string | null
  addRelationToFrontmatter(...): Record<string, any>

  // ❌ IMPURE - needs Vault adapter
  async createTask(...): Promise<TFile>
  async createRelatedTask(...): Promise<TFile>
}
```

## Consequences

### Positive ✅

- **Testability**: Pure functions trivial to test (no mocks)
- **Reusability**: Pure functions work in any context
- **Documentation**: Clear which functions are safe to extract
- **Refactoring**: Easy to move pure functions to Core (Issue #122)
- **Confidence**: Pure functions can't break other code

### Negative ❌

- **Code organization**: More files/modules to manage
- **Learning curve**: Developers must understand pure vs impure
- **Documentation burden**: Must mark pure functions explicitly

### Mitigations

1. **API_CONTRACTS.md**: Documents which functions are pure (✅ PURE marker)
2. **Tests**: Pure functions have 100% coverage (easy to achieve)
3. **Naming**: Pure utility classes clearly separated
4. **Issue #122**: Will formalize this with IFileSystemAdapter

## Examples

### Pure Function (Testable)

```typescript
// ✅ PURE
generateTaskFrontmatter(
  sourceMetadata: Record<string, any>,
  sourceName: string,
  sourceClass: string,
  label?: string,
  uid?: string,
  taskSize?: string | null,
): Record<string, any> {
  const frontmatter: Record<string, any> = {};
  frontmatter.exo__Asset_uid = uid || uuidv4();
  frontmatter.exo__Asset_label = label || `Task from ${sourceName}`;
  frontmatter.exo__Asset_createdAt = DateFormatter.toLocalTimestamp(new Date());
  // ... more pure logic
  return frontmatter;
}

// Test (no mocks needed!)
test('generateTaskFrontmatter creates valid frontmatter', () => {
  const result = generateTaskFrontmatter({ ... }, 'Area', 'ems__Area');
  expect(result.exo__Instance_class).toContain('"[[ems__Task]]"');
  expect(result.exo__Asset_uid).toMatch(/^[0-9a-f-]{36}$/);
});
```

### Impure Function (Needs Mocks)

```typescript
// ❌ IMPURE - reads/writes files
async createTask(
  sourceFile: TFile,
  sourceMetadata: Record<string, any>,
  sourceClass: string,
  label?: string,
  taskSize?: string | null,
): Promise<TFile> {
  const frontmatter = this.generateTaskFrontmatter(...);  // ✅ Pure call
  const content = MetadataHelpers.buildFileContent(frontmatter);  // ✅ Pure call
  const createdFile = await this.vault.create(path, content);  // ❌ Side effect
  return createdFile;
}

// Test (requires Vault mock)
test('createTask creates file', async () => {
  const mockVault = { create: jest.fn() };
  const service = new TaskCreationService(mockVault);
  await service.createTask(...);
  expect(mockVault.create).toHaveBeenCalled();
});
```

## Related

- **Issue #122**: Will extract all pure functions to `exocortex`
- **Issue #123**: Pure functions achieve 100% coverage easily
- **API_CONTRACTS.md**: Documents which functions are pure

## Future

After Issue #122, architecture will be:

```typescript
// exocortex (100% pure)
export class TaskFrontmatterGenerator {
  static generate(...): Record<string, any>  // ✅ PURE
}

// exocortex (adapter)
export class TaskCreationService {
  constructor(private fs: IFileSystemAdapter) {}  // Interface, not Vault

  async createTask(...): Promise<string> {
    const frontmatter = TaskFrontmatterGenerator.generate(...);  // Call core
    await this.fs.createFile(path, content);  // Use adapter
  }
}
```

---

**Date**: 2025-10-26
**Author**: @kitelev
**Related Issues**: #122 (Core Extraction), #124 (Architecture Documentation)