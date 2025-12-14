# Core API Reference

**exocortex - Storage-agnostic business logic package**

---

## Overview

The `exocortex` package provides storage-independent business logic:

```typescript
import {
  TaskCreationService,
  EffortStatusWorkflow,
  RDFSerializer
} from 'exocortex';
```

**Key benefits:**
- No Obsidian dependencies (works in CLI, other UIs)
- Pure TypeScript business logic
- Comprehensive test coverage

---

## Services

### Task Creation Service

```typescript
import { TaskCreationService } from 'exocortex';

class TaskCreationService {
  createTask(params: {
    label: string;
    area: string;
    project?: string;
    status?: string;
  }): Promise<{ path: string; frontmatter: Record<string, any> }>;
}
```

**Example**:
```typescript
const service = new TaskCreationService(vaultAdapter);

const task = await service.createTask({
  label: "Build API endpoint",
  area: "[[Development]]",
  project: "[[API Server]]",
  status: "[[ems__EffortStatusToDo]]"
});

// Result: { path: "tasks/task-abc123.md", frontmatter: {...} }
```

### Project Creation Service

```typescript
import { ProjectCreationService } from 'exocortex';

class ProjectCreationService {
  createProject(params: {
    label: string;
    area: string;
    status?: string;
  }): Promise<{ path: string; frontmatter: Record<string, any> }>;
}
```

### Effort Status Workflow

```typescript
import { EffortStatusWorkflow } from 'exocortex';

class EffortStatusWorkflow {
  canTransition(from: string, to: string): boolean;
  transition(
    metadata: Record<string, any>,
    toStatus: string
  ): Record<string, any>;
}
```

**Example**:
```typescript
const workflow = new EffortStatusWorkflow();

// Check if transition allowed
if (workflow.canTransition(currentStatus, "ems__EffortStatusDoing")) {
  // Apply transition with timestamp
  const updated = workflow.transition(metadata, "ems__EffortStatusDoing");
}
```

### Effort Voting Service

```typescript
import { EffortVotingService } from 'exocortex';

class EffortVotingService {
  vote(metadata: Record<string, any>): Record<string, any>;
  getVoteCount(metadata: Record<string, any>): number;
}
```

### Area Hierarchy Builder

```typescript
import { AreaHierarchyBuilder } from 'exocortex';

interface AreaNode {
  area: string;
  label: string;
  parent: string | null;
  children: AreaNode[];
}

class AreaHierarchyBuilder {
  buildHierarchy(areas: AssetRelation[]): AreaNode[];
  findRoots(nodes: AreaNode[]): AreaNode[];
}
```

### Planning Service

```typescript
import { PlanningService } from 'exocortex';

class PlanningService {
  planOnDate(
    metadata: Record<string, any>,
    date: string
  ): Record<string, any>;

  shiftDay(
    metadata: Record<string, any>,
    direction: 'forward' | 'backward'
  ): Record<string, any>;
}
```

---

## RDF/SPARQL System

### Triple Store

```typescript
import { InMemoryTripleStore } from 'exocortex';

const store = new InMemoryTripleStore();

// Add triples
store.add({
  subject: 'ex:Task1',
  predicate: 'rdf:type',
  object: 'ems:Task'
});

// Query
const results = store.query({
  subject: null,
  predicate: 'rdf:type',
  object: 'ems:Task'
});
```

### SPARQL Parser

```typescript
import { SPARQLParser } from 'exocortex';

const parser = new SPARQLParser();

const query = parser.parse(`
  SELECT ?task ?label WHERE {
    ?task rdf:type ems:Task .
    ?task rdfs:label ?label .
  }
`);

// Result: AST structure
```

### RDF Serializer

```typescript
import { RDFSerializer } from 'exocortex';

const serializer = new RDFSerializer(tripleStore);

// Export to Turtle
const turtle = await serializer.serialize({ format: 'turtle' });

// Export to JSON-LD
const jsonld = await serializer.serialize({ format: 'json-ld' });
```

---

## Utilities

### Frontmatter Service

```typescript
import { FrontmatterService } from 'exocortex';

class FrontmatterService {
  static parse(content: string): {
    frontmatter: Record<string, any>;
    body: string;
  };

  static stringify(
    frontmatter: Record<string, any>,
    body: string
  ): string;
}
```

### Date Formatter

```typescript
import { DateFormatter } from 'exocortex';

class DateFormatter {
  static toISODate(date: Date): string;  // "2025-11-10"
  static fromISODate(iso: string): Date;
  static toDisplayDate(date: Date): string;  // "Nov 10, 2025"
}
```

### Wiki Link Helpers

```typescript
import { WikiLinkHelpers } from 'exocortex';

class WikiLinkHelpers {
  static extractTarget(link: string): string;  // "[[Page]]" → "Page"
  static createLink(target: string): string;   // "Page" → "[[Page]]"
  static isWikiLink(text: string): boolean;
}
```

---

## Interfaces

### IVaultAdapter

Storage abstraction for vault operations:

```typescript
interface IVaultAdapter {
  // File operations
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;

  // Metadata operations
  getFrontmatter(path: string): Promise<Record<string, any>>;
  updateFrontmatter(
    path: string,
    frontmatter: Record<string, any>
  ): Promise<void>;

  // Query operations
  getAllFiles(): Promise<IFile[]>;
  getFilesByClass(className: string): Promise<IFile[]>;
}
```

### IFile

```typescript
interface IFile {
  path: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number };
}
```

---

## Usage Patterns

### Creating Custom Service

```typescript
import { IVaultAdapter } from 'exocortex';

class CustomService {
  constructor(private vault: IVaultAdapter) {}

  async processNotes(): Promise<void> {
    const files = await this.vault.getAllFiles();

    for (const file of files) {
      const content = await this.vault.read(file.path);
      const frontmatter = await this.vault.getFrontmatter(file.path);

      // Process...

      await this.vault.updateFrontmatter(file.path, updated);
    }
  }
}
```

### Implementing Vault Adapter

```typescript
import { IVaultAdapter, IFile } from 'exocortex';

class MyVaultAdapter implements IVaultAdapter {
  async read(path: string): Promise<string> {
    // Implementation
  }

  async write(path: string, content: string): Promise<void> {
    // Implementation
  }

  // ... other methods
}
```

---

## Type Definitions

### Asset Classes

```typescript
type AssetClass =
  | 'ems__Task'
  | 'ems__Project'
  | 'ems__Area'
  | 'pn__DailyNote'
  | string;
```

### Effort Status

```typescript
type EffortStatus =
  | 'ems__EffortStatusDraft'
  | 'ems__EffortStatusBacklog'
  | 'ems__EffortStatusAnalysis'
  | 'ems__EffortStatusToDo'
  | 'ems__EffortStatusDoing'
  | 'ems__EffortStatusDone';
```

### Asset Relation

```typescript
interface AssetRelation {
  file: IFile;
  path: string;
  title: string;
  metadata: Record<string, any>;
  relationType: string;
}
```

---

## Error Handling

### Core Errors

```typescript
import { FileNotFoundError, FileAlreadyExistsError } from 'exocortex';

try {
  await vault.read('non-existent.md');
} catch (error) {
  if (error instanceof FileNotFoundError) {
    // Handle missing file
  }
}
```

### SPARQL Errors

```typescript
import { SPARQLParseError } from 'exocortex';

try {
  parser.parse(invalidQuery);
} catch (error) {
  if (error instanceof SPARQLParseError) {
    console.error(error.message);  // Detailed parse error
    console.error(error.location);  // Line/column
  }
}
```

---

## Testing

### Mocking Vault Adapter

```typescript
import { IVaultAdapter } from 'exocortex';

class MockVaultAdapter implements IVaultAdapter {
  private files: Map<string, string> = new Map();

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) throw new FileNotFoundError(path);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  // ... other methods
}
```

---

## Package Structure

```
exocortex/
├── domain/           # Entities, value objects
├── services/         # Business logic services
├── infrastructure/   # RDF, SPARQL, storage
├── utilities/        # Helper functions
└── interfaces/       # Type definitions
```

---

**See also:**
- [Plugin Development Guide](../Plugin-Development-Guide.md)
- [Testing Guide](../Testing-Guide.md)
- [SPARQL Developer Guide](../sparql/Developer-Guide.md)
