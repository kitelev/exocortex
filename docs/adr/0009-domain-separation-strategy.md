# ADR-0009: Domain Separation Strategy

## Status

✅ **Accepted** (Implemented)

## Context

With Clean Architecture adopted (ADR-0008), we need to define clear boundaries between domain concepts and ensure the monorepo structure supports independent evolution of each package.

### Problem

The codebase manages several distinct domains:
- **Asset Management**: Tasks, Projects, Areas, Concepts, Prototypes
- **Status Workflows**: Effort lifecycle (Draft → Done)
- **Knowledge Organization**: Hierarchies, relationships, graphs
- **User Interface**: Obsidian-specific rendering
- **Automation**: CLI commands for scripting

Without clear domain boundaries:
- Code duplication across packages
- Unclear ownership of shared concepts
- Breaking changes cascade unpredictably
- Testing becomes complex

## Decision

We adopt a **Monorepo with Package Domains** strategy:

### Package Boundaries

```
packages/
├── exocortex/              # DOMAIN: Core business logic
│   ├── domain/             # Entities, constants, value objects
│   ├── application/        # Use cases, service interfaces
│   └── infrastructure/     # Pure utilities, adapter interfaces
│
├── obsidian-plugin/        # ADAPTER: Obsidian-specific integration
│   ├── presentation/       # React components, renderers
│   └── infrastructure/     # ObsidianVaultAdapter, MetadataExtractor
│
├── cli/                    # ADAPTER: Command-line automation
│   ├── executors/          # Command implementations
│   └── infrastructure/     # NodeFsAdapter, PathResolver
│
└── test-utils/             # SHARED: Testing utilities
    └── mocks/              # Shared mock factories
```

### Domain Ownership Rules

**Package `exocortex` owns:**
- Asset class definitions (`ems__Task`, `ems__Project`, etc.)
- Status workflow definitions (`EffortStatus` enum)
- Business rules (command visibility, status transitions)
- Service interfaces (`IFileSystemAdapter`, `IMetadataService`)
- Pure utilities (`DateFormatter`, `FrontmatterService`, `WikiLinkHelpers`)

**Package `obsidian-plugin` owns:**
- UI components (tables, renderers, modals)
- Obsidian API integration
- Plugin lifecycle (settings, commands, views)
- Obsidian-specific metadata extraction

**Package `cli` owns:**
- Command-line interface design
- Terminal output formatting
- File system operations via Node.js
- Batch processing workflows

### Cross-Package Communication

```typescript
// exocortex defines the interface
export interface IFileSystemAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  create(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(directory: string): Promise<string[]>;
}

// exocortex provides services that use the interface
export class TaskCreationService {
  constructor(private fs: IFileSystemAdapter) {}
  // Business logic here
}

// obsidian-plugin implements the interface
export class ObsidianVaultAdapter implements IFileSystemAdapter {
  constructor(private vault: Vault) {}
  // Obsidian-specific implementation
}

// cli implements the interface differently
export class NodeFsAdapter implements IFileSystemAdapter {
  // Node.js fs module implementation
}
```

### Import Rules

| From ↓ To → | exocortex | obsidian-plugin | cli | test-utils |
|-------------|-----------|-----------------|-----|------------|
| exocortex | ✅ | ❌ | ❌ | ❌ |
| obsidian-plugin | ✅ | ✅ | ❌ | ❌ |
| cli | ✅ | ❌ | ✅ | ❌ |
| test-utils | ✅ | ✅ | ✅ | ✅ |

**Key Rule**: `exocortex` NEVER imports from adapters (plugin/cli).

### Shared Constants Pattern

```typescript
// packages/exocortex/src/domain/constants.ts
export const AssetClass = {
  Task: "ems__Task",
  Project: "ems__Project",
  Area: "ems__Area",
  Concept: "ims__Concept",
  Prototype: "ims__Prototype",
} as const;

// packages/obsidian-plugin/src/presentation/components/TaskTable.tsx
import { AssetClass } from "exocortex";  // ✅ Correct

// packages/cli/src/executors/TaskExecutor.ts
import { AssetClass } from "exocortex";  // ✅ Correct
```

## Consequences

### Positive

- **Clear ownership**: Each package has defined responsibilities
- **Independent evolution**: CLI can be released separately from plugin
- **Testability**: Core logic tested without Obsidian
- **Reduced coupling**: Changes in one adapter don't affect others
- **Shared vocabulary**: Constants and types are single-sourced

### Negative

- **Complexity**: More packages to manage and version
- **Build coordination**: Changes to core require rebuilding adapters
- **Learning curve**: Developers must understand package boundaries

### Mitigations

1. **npm workspaces**: Handles cross-package dependencies automatically
2. **TypeScript paths**: Simplified imports (`exocortex` vs `../../..`)
3. **CI validation**: Tests run across all packages on PR
4. **Documentation**: ARCHITECTURE.md explains domain boundaries

## Alternatives Considered

### Alternative 1: Single Package (Monolith)

Keep everything in one package with folder separation.

**Rejected because**:
- CLI would pull in all Obsidian dependencies
- No independent versioning possible
- Harder to enforce layer boundaries

### Alternative 2: Separate Repositories

Split into `exocortex-core`, `exocortex-obsidian`, `exocortex-cli` repos.

**Rejected because**:
- Cross-repository changes are painful
- Version synchronization complex
- Development velocity suffers

### Alternative 3: Feature-Based Packages

One package per feature (tasks, projects, status, etc.).

**Rejected because**:
- Features are interconnected (tasks reference projects)
- Would create circular dependencies
- Too fine-grained for current team size

## Related

- **ADR-0008**: Clean Architecture (foundational decision)
- **ADR-0006**: Pure Functions Separation (technical approach)
- **Issue #122**: Core Extraction (implementation)
- **Documentation**: ARCHITECTURE.md § Monorepo Organization

---

**Date**: 2026-02-20
**Author**: AI Development Team
**Related Issues**: #122 (Core Extraction), #2188 (ADR Documentation)
