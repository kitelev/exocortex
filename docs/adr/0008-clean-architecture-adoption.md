# ADR-0008: Adopt Clean Architecture

## Status

✅ **Accepted** (Implemented)

## Context

The Exocortex codebase needs a scalable architecture that:
- Separates business logic from infrastructure concerns
- Enables testability through dependency injection
- Supports multiple interfaces (CLI, Obsidian plugin, potential Web/Mobile)
- Maintains long-term maintainability as the project grows

### Problem

Early versions of the Obsidian plugin mixed business logic directly with Obsidian API calls:

```typescript
// OLD: Tightly coupled code
export class TaskService {
  constructor(private vault: Vault) {}  // Obsidian-specific

  async createTask(label: string): Promise<TFile> {
    const uid = uuidv4();
    const content = `---\nexo__Asset_uid: ${uid}\n---\n`;
    return await this.vault.create(`${uid}.md`, content);  // Direct Obsidian call
  }
}
```

This caused several problems:
1. **Untestable**: Required full Obsidian environment for testing
2. **Not reusable**: Business logic locked inside plugin
3. **Hard to maintain**: Changes to Obsidian API required changes throughout codebase
4. **No CLI support**: Could not automate tasks via command line

## Decision

We adopt **Clean Architecture** with four distinct layers:

```
┌─────────────────────────────────────────────────┐
│        PRESENTATION (Obsidian Plugin)           │
│  React components, Renderers, Modals, Views     │
├─────────────────────────────────────────────────┤
│            APPLICATION (exocortex)              │
│  CommandManager, Services, Use Cases            │
├─────────────────────────────────────────────────┤
│              DOMAIN (exocortex)                 │
│  Entities, Constants, Business Rules            │
├─────────────────────────────────────────────────┤
│           INFRASTRUCTURE (adapters)             │
│  ObsidianVaultAdapter, NodeFsAdapter, etc.      │
└─────────────────────────────────────────────────┘
```

### The Dependency Rule

**Inner layers NEVER depend on outer layers.**

- Domain knows nothing about Application, Infrastructure, or Presentation
- Application knows Domain but not Infrastructure or Presentation
- Infrastructure implements interfaces defined by Application
- Presentation uses Application services through DI

### Implementation

**Monorepo Structure:**

```
packages/
├── exocortex/                 # Core (Domain + Application)
│   └── src/
│       ├── domain/            # Business entities, constants
│       ├── application/       # Use cases, services
│       └── infrastructure/    # Interfaces, pure utilities
├── obsidian-plugin/           # Presentation + Obsidian adapters
│   └── src/
│       ├── presentation/      # React components, UI
│       └── infrastructure/    # ObsidianVaultAdapter
└── cli/                       # CLI Presentation + Node adapters
    └── src/
        ├── executors/         # CLI commands
        └── infrastructure/    # NodeFsAdapter
```

**Dependency Injection with TSyringe:**

```typescript
// Domain Layer (no dependencies)
export interface IFileSystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
}

// Application Layer (uses interface)
@injectable()
export class TaskCreationService {
  constructor(
    @inject("IFileSystemAdapter") private fs: IFileSystemAdapter
  ) {}

  async createTask(label: string): Promise<string> {
    const frontmatter = this.generateTaskFrontmatter(label);  // Pure
    const content = MetadataHelpers.buildFileContent(frontmatter);  // Pure
    await this.fs.createFile(path, content);  // Via interface
    return path;
  }
}

// Infrastructure Layer (implements interface)
@injectable()
export class ObsidianVaultAdapter implements IFileSystemAdapter {
  constructor(private vault: Vault) {}

  async createFile(path: string, content: string): Promise<void> {
    await this.vault.create(path, content);
  }
}
```

## Consequences

### Positive

- **Testability**: Business logic tests require no Obsidian mocks
- **Reusability**: Core logic works in CLI, plugin, and future adapters
- **Maintainability**: Changes isolated to specific layers
- **Parallel development**: Teams can work on different adapters independently
- **Framework agnostic**: Business logic survives framework changes
- **Clear boundaries**: Easy to understand what belongs where

### Negative

- **More abstractions**: Additional interfaces, adapters, DI containers
- **Learning curve**: Developers must understand Clean Architecture concepts
- **Initial overhead**: Setting up DI and monorepo structure takes time
- **More files**: Layer separation results in more source files

### Mitigations

1. **Documentation**: ARCHITECTURE.md explains layer responsibilities
2. **TSyringe**: Lightweight DI (~2KB) with minimal boilerplate
3. **Templates**: Standard patterns for new services documented in PATTERNS.md
4. **Code review**: Enforce layer boundaries in PR reviews

## Alternatives Considered

### Alternative 1: Traditional Layered Architecture

```
Presentation → Business Logic → Data Access
```

**Rejected because**:
- Business logic layer can become coupled to data access
- Testing still requires mocking database/storage
- No clear separation for multiple adapters

### Alternative 2: No Architecture (Pragmatic)

Keep business logic mixed with framework code, refactor only when needed.

**Rejected because**:
- CLI requirement made refactoring inevitable
- Testing pain was already significant
- Future Web/Mobile adapters would be impossible

### Alternative 3: Hexagonal Architecture (Ports & Adapters)

Very similar to Clean Architecture but with different terminology.

**Why we chose Clean Architecture instead**:
- Better documentation and community resources
- More explicit layer names (Domain, Application, Infrastructure)
- Same benefits as Hexagonal with clearer structure

## Related

- **ADR-0006**: Pure Functions Separation (predecessor)
- **ADR-0009**: Domain Separation Strategy (detailed domain boundaries)
- **Issue #122**: Core Extraction (implementation)
- **Documentation**: ARCHITECTURE.md

---

**Date**: 2026-02-20
**Author**: AI Development Team
**Related Issues**: #122 (Core Extraction), #2188 (ADR Documentation)
