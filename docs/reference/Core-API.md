# Core API Reference

**exocortex - Storage-agnostic business logic package**

> Generated against `packages/core/src` at commit `507b3bbb` (2026-06-10). Every signature below is verified against the source; see `packages/core/src/index.ts` for the full export map.

---

## Overview

The `exocortex` package provides storage-independent business logic:

```typescript
import {
  GenericAssetCreationService,
  EffortStatusWorkflow,
  RDFSerializer,
} from "@kitelev/exocortex-core";
```

**Key benefits:**

- No Obsidian dependencies (works in CLI, other UIs)
- Pure TypeScript business logic
- Comprehensive test coverage

**Dependency injection:** services are `tsyringe` `@injectable()` classes. Vault access is injected as `IVaultAdapter` via `DI_TOKENS.IVaultAdapter`. The package exports `container`, `registerCoreServices`, and `DI_TOKENS` for DI-based wiring; plain `new Service(vault)` construction also works and is used in the examples below.

---

## Services

### Generic Asset Creation Service

```typescript
import { GenericAssetCreationService } from "@kitelev/exocortex-core";

class GenericAssetCreationService {
  constructor(vault: IVaultAdapter);

  /** Override clock / uid generator for deterministic tests (fluent). */
  withDeterminism(options: {
    clock?: IClock;
    uidGenerator?: IUidGenerator;
  }): this;

  /** Create an asset of any class type. Writes `<folderPath>/<uuid>.md`. */
  createAsset(
    config: GenericAssetCreationConfig,
    propertyDefinitions?: AssetPropertyDefinition[],
  ): Promise<IFile>;

  /** Pure (no-write) assembly — used by `cli create --dry-run`. */
  buildAsset(
    config: GenericAssetCreationConfig,
    propertyDefinitions?: AssetPropertyDefinition[],
  ): AssetBuildResult;
}
```

Core fields of `GenericAssetCreationConfig` (all optional except `className`):

```typescript
interface GenericAssetCreationConfig {
  className: string; // e.g. "ems__Task"
  label?: string;
  folderPath?: string;
  propertyValues?: Record<string, unknown>;
  parentFile?: IFile;
  parentMetadata?: Record<string, unknown>;
  classResolver?: ClassRefResolver; // (uuid: string) => string | null | undefined
  // Opt-in domain fields (used by `cli create`):
  classRefForm?: "label" | "uuid";
  classUid?: string;
  createdBy?: string;
  aliases?: string[];
  timezone?: string;
  body?: string;
  shapeRegistry?: ShapeRegistry;
}
```

**Example — creating a task**:

```typescript
const service = new GenericAssetCreationService(vault);

const file = await service.createAsset({
  className: "ems__Task",
  label: "Build API endpoint",
  propertyValues: {
    ems__Effort_status: '"[[ems__EffortStatusToDo]]"',
  },
});

// Result: IFile { path: "<folder>/<uuid>.md", basename: "<uuid>", ... }
```

**Example — dry-run preview (no vault write)**:

```typescript
const preview = service.buildAsset({
  className: "ems__Project",
  label: "API Server",
});

// AssetBuildResult { uid, folderPath, path, frontmatter, content }
// `content` is byte-for-byte what createAsset would write.
```

### Effort Status Workflow

Facade over `WorkflowEngine` for effort status rollback logic. Note: there are **no** `canTransition` / `transition` methods on this class — forward transitions are executed elsewhere (groundings / `TaskStatusService`); this facade answers "what was the previous status?".

```typescript
import { EffortStatusWorkflow } from "@kitelev/exocortex-core";

class EffortStatusWorkflow {
  constructor(); // parameterless; legacy empty-store resolver installed

  /** Swap in a production triple-store-backed WorkflowResolver. */
  setResolver(resolver: WorkflowResolver): void;

  /**
   * Previous status for rollback.
   * - initial state (Draft) → null
   * - Trashed / unknown     → undefined
   * - otherwise             → wrapped wikilink, e.g. '"[[ems__EffortStatusBacklog]]"'
   */
  getPreviousStatus(
    currentStatus: string,
    instanceClass: string | string[] | null,
  ): string | null | undefined;

  /** '"[[ems__EffortStatusDoing]]"' → 'ems__EffortStatusDoing' */
  normalizeStatus(status: string): string;

  /** 'ems__EffortStatusDoing' → '"[[ems__EffortStatusDoing]]"' */
  wrapStatus(status: string): string;
}
```

**Example**:

```typescript
const workflow = new EffortStatusWorkflow();

workflow.getPreviousStatus('"[[ems__EffortStatusDraft]]"', "ems__Task");
// null — Draft is the initial state, no rollback

workflow.normalizeStatus('"[[ems__EffortStatusDoing]]"');
// 'ems__EffortStatusDoing'
```

### Effort Voting Service

Increments the `ems__Effort_votes` frontmatter property on a Task/Project file.

```typescript
import { EffortVotingService } from "@kitelev/exocortex-core";

class EffortVotingService {
  constructor(vault: IVaultAdapter);

  /** Reads current count (0 if absent), writes count + 1, returns new count. */
  incrementEffortVotes(effortFile: IFile): Promise<number>;
}
```

**Example**:

```typescript
const voting = new EffortVotingService(vault);
const newCount = await voting.incrementEffortVotes(taskFile);
```

### Area Hierarchy Builder

Builds an `ems__Area` tree rooted at a given area file.

```typescript
import {
  AreaHierarchyBuilder,
  type AssetRelation,
} from "@kitelev/exocortex-core";
import type { AreaNode } from "@kitelev/exocortex-core";

class AreaHierarchyBuilder {
  constructor(vault: IVaultAdapter);

  /**
   * Returns the subtree rooted at currentAreaPath, or null when the path
   * does not resolve to an ems__Area file. Children are sorted by label.
   * The current implementation derives the tree by scanning all vault
   * files; the relations argument is accepted for API compatibility.
   */
  buildHierarchy(
    currentAreaPath: string,
    relations: AssetRelation[],
  ): AreaNode | null;
}
```

**Example**:

```typescript
const builder = new AreaHierarchyBuilder(vault);
const tree = builder.buildHierarchy("areas/work.md", []);

if (tree) {
  console.log(tree.title, tree.children.length);
}
```

### Planning Service

```typescript
import { PlanningService } from "@kitelev/exocortex-core";

class PlanningService {
  constructor(vault: IVaultAdapter);

  /**
   * Sets ems__Effort_plannedStartTimestamp to today at 00:00:00 local time.
   * Throws when taskPath does not resolve to a file.
   */
  planOnToday(taskPath: string): Promise<void>;
}
```

---

## RDF/SPARQL System

### RDF Terms

RDF terms are **classes**, not plain objects:

```typescript
import {
  IRI,
  Literal,
  BlankNode,
  Triple,
  Namespace,
} from "@kitelev/exocortex-core";

type Subject = IRI | BlankNode | QuotedTriple;
type Predicate = IRI;
type Object = IRI | BlankNode | Literal | QuotedTriple; // exported as `Object`

class Triple {
  constructor(subject: Subject, predicate: Predicate, object: Object);
  get subject(): Subject;
  get predicate(): Predicate;
  get object(): Object;
  equals(other: Triple): boolean;
  toString(): string; // N-Triples-ish: "<s> <p> <o> ."
}
```

`Namespace` provides well-known vocabularies (`Namespace.RDF`, `Namespace.RDFS`, `Namespace.OWL`, `Namespace.XSD`, `Namespace.EXO`, `Namespace.EMS`, `Namespace.EXOCMD`, ...) with `term(localName): IRI`.

### Triple Store

```typescript
import { InMemoryTripleStore } from "@kitelev/exocortex-core";

class InMemoryTripleStore implements ITripleStore {
  add(triple: Triple): Promise<void>;
  addAll(triples: Triple[]): Promise<void>;
  remove(triple: Triple): Promise<boolean>;
  removeAll(triples: Triple[]): Promise<number>;
  has(triple: Triple): Promise<boolean>;

  /** Pattern matching: omit any position to wildcard it. */
  match(
    subject?: Subject,
    predicate?: Predicate,
    object?: Object,
  ): Promise<Triple[]>;

  clear(): Promise<void>;
  count(): Promise<number>;
  subjects(): Promise<Subject[]>;
  predicates(): Promise<Predicate[]>;
  objects(): Promise<Object[]>;
  beginTransaction(): Promise<ITransaction>;

  /** O(1) lookup of subjects whose IRI contains the UUID. */
  findSubjectsByUUID(uuid: string): Promise<Subject[]>;
  findSubjectsByUUIDSync(uuid: string): Subject[];

  // Named graphs (SPARQL 1.1 datasets):
  addToGraph(triple: Triple, graph: GraphName): Promise<void>;
  removeFromGraph(triple: Triple, graph: GraphName): Promise<boolean>;
  matchInGraph(
    s?: Subject,
    p?: Predicate,
    o?: Object,
    graph?: GraphName,
  ): Promise<Triple[]>;
  getNamedGraphs(): Promise<IRI[]>;
  hasGraph(graph: IRI): Promise<boolean>;
  clearGraph(graph: GraphName): Promise<void>;
  countInGraph(graph: GraphName): Promise<number>;
}
```

There is **no** `query()` method — use `match()` for pattern access, or the SPARQL engine (`ExoQLQueryExecutor` / `ExoQL`) for query-language access.

**Example**:

```typescript
const store = new InMemoryTripleStore();

const task = new IRI("obsidian://vault/tasks/3f2a.md");
const rdfType = Namespace.RDF.term("type");

await store.add(new Triple(task, rdfType, Namespace.EMS.term("Task")));
await store.add(
  new Triple(
    task,
    Namespace.EXO.term("Asset_label"),
    new Literal("Build API endpoint"),
  ),
);

const allTasks = await store.match(
  undefined,
  rdfType,
  Namespace.EMS.term("Task"),
);
const aboutTask = await store.match(task); // all triples with this subject
const total = await store.count();
```

### SPARQL Parser

`SPARQLParser` is an alias of `ExoQLParser` (the ExoQL-extended SPARQL 1.1/1.2 parser built on `sparqljs`).

```typescript
import {
  SPARQLParser,
  SPARQLParseError,
  type SPARQLQuery,
} from "@kitelev/exocortex-core";

const parser = new SPARQLParser();

try {
  const query: SPARQLQuery = parser.parse(`
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX ems: <https://exocortex.my/ontology/ems#>
    SELECT ?task WHERE { ?task rdf:type ems:Task }
  `);
  // query is a sparqljs AST
} catch (error) {
  if (error instanceof SPARQLParseError) {
    console.error(error.message, error.line, error.column);
  }
}
```

### RDF Serializer

Format is a **positional** argument; options come second.

```typescript
import {
  RDFSerializer,
  type RDFSerializationFormat,
} from "@kitelev/exocortex-core";

type RDFSerializationFormat = "turtle" | "n-triples" | "json-ld";

class RDFSerializer {
  constructor(store: ITripleStore);

  serialize(
    format: RDFSerializationFormat,
    options?: RDFSerializeOptions,
  ): Promise<string>;

  serializeTriples(
    triples: Triple[],
    format: RDFSerializationFormat,
    options?: RDFSerializeOptions,
  ): string;

  /** Batched streaming output. */
  stream(
    format: RDFSerializationFormat,
    options?: RDFStreamOptions,
  ): AsyncIterableIterator<string>;
}
```

**Example**:

```typescript
const serializer = new RDFSerializer(store);

const turtle = await serializer.serialize("turtle");
const jsonld = await serializer.serialize("json-ld", { pretty: true });
```

---

## Utilities

### Frontmatter Service

Instance-based (not static). There is **no** `stringify` method; use `createFrontmatter` / `updateProperty` to produce content.

```typescript
import { FrontmatterService } from "@kitelev/exocortex-core";

interface FrontmatterParseResult {
  exists: boolean;
  content: string; // raw YAML between --- delimiters
  originalContent: string;
}

class FrontmatterService {
  /** Split a markdown file into frontmatter + original content. */
  parse(content: string): FrontmatterParseResult;

  /**
   * Parse frontmatter into key/value pairs. Handles `key: value` scalars
   * and two-space-indented `- item` arrays. Returns null when no
   * frontmatter block is present.
   */
  parseObject(content: string): Record<string, string | string[]> | null;

  /** Update or add a property (creates frontmatter block when missing). */
  updateProperty(content: string, property: string, value: unknown): string;

  /** Alias for updateProperty. */
  addProperty(content: string, property: string, value: unknown): string;

  removeProperty(content: string, property: string): string;
  hasProperty(frontmatterContent: string, property: string): boolean;
  getPropertyValue(frontmatterContent: string, property: string): string | null;

  /** Prepend a new frontmatter block (canonical property ordering applied). */
  createFrontmatter(
    content: string,
    properties: Record<string, unknown>,
  ): string;

  /** "https://exocortex.my/ontology/ems#Effort_status" → "ems__Effort_status" */
  static normalizeIRI(property: string): string;

  /** "obsidian://vault/.../X.md" → '"[[X]]"' (wikilink form) */
  static normalizeIRIValue(value: string): string;
}
```

**Example**:

```typescript
const service = new FrontmatterService();

const result = service.parse("---\nstatus: draft\n---\nBody");
// result.exists === true, result.content === 'status: draft'

const updated = service.updateProperty(
  "---\nstatus: draft\n---\nBody",
  "ems__Effort_status",
  '"[[ems__EffortStatusDone]]"',
);
```

### Date Formatter

```typescript
import { DateFormatter } from "@kitelev/exocortex-core";

class DateFormatter {
  static toISOTimestamp(date: Date): string; // "2025-10-24T14:30:45Z" (UTC)
  static toLocalTimestamp(date: Date): string; // "2025-10-24T14:30:45" (local, no zone)
  static toDateWikilink(date: Date): string; // '"[[2025-10-24]]"' (quoted)
  static getTodayWikilink(): string; // toDateWikilink(new Date())
  static toDateString(date: Date): string; // "2025-10-24"
  static parseWikilink(wikilink: string): string | null; // '"[[2025-10-24]]"' → "2025-10-24"
  static addDays(date: Date, days: number): Date;
  static isSameDay(date1: Date, date2: Date): boolean;
  static getTodayStartTimestamp(): string; // "YYYY-MM-DDT00:00:00" (today, local)
  static toTimestampAtStartOfDay(dateStr: string): string; // "2025-11-11" → "2025-11-11T00:00:00"
  static normalizeTimestamp(timestamp: string): string; // any parseable form → ISO UTC "…Z"
  static isISOTimestamp(timestamp: string): boolean; // strict "YYYY-MM-DDTHH:MM:SSZ" check
}
```

`toLocalTimestamp` is the canonical format for effort/asset lifecycle timestamps (`ems__Effort_startTimestamp`, `exo__Asset_createdAt`, ...); `toISOTimestamp` (UTC `Z`) is reserved for explicit UTC anchoring and is not a drop-in replacement.

### Wiki Link Helpers

```typescript
import { WikiLinkHelpers } from "@kitelev/exocortex-core";

class WikiLinkHelpers {
  /**
   * Normalize a wikilink to its canonical identifier:
   * - "[[ems__Area]]"           → "ems__Area"
   * - "[[<uuid>|ems__Area]]"    → "ems__Area"   (UUID target → alias is canonical)
   * - "[[Some Note|Display]]"   → "Some Note"   (non-UUID target is canonical)
   */
  static normalize(value: string | null | undefined): string;

  static normalizeArray(values: string[] | string | null | undefined): string[];

  static equals(
    a: string | null | undefined,
    b: string | null | undefined,
  ): boolean;

  static includes(
    array: string[] | string | null | undefined,
    value: string,
  ): boolean;

  /**
   * Like normalize, but resolves bare-UUID values (UID-canon form,
   * "[[<uuid>]]") to their symbolic label via the supplied resolver.
   * Returns the UUID unchanged when the resolver yields no label.
   */
  static resolveSymbolic(
    value: string | null | undefined,
    resolver: (uuid: string) => string | null | undefined,
  ): string;

  static resolveSymbolicArray(
    values: string[] | string | null | undefined,
    resolver: (uuid: string) => string | null | undefined,
  ): string[];
}
```

---

## Interfaces

### IVaultAdapter

`IVaultAdapter` is an Interface-Segregation composite of six role interfaces. Depend on the narrowest role interface(s) your consumer needs.

```typescript
import type {
  IVaultAdapter,
  IVaultFileReader,
  IVaultFileWriter,
  IVaultFileRenamer,
  IVaultFolderManager,
  IVaultFrontmatterManager,
  IVaultLinkResolver,
  IFile,
  IFolder,
  IFrontmatter,
} from "@kitelev/exocortex-core";

interface IVaultFileReader {
  read(file: IFile): Promise<string>;
  exists(path: string): Promise<boolean>;
  getAllFiles(): IFile[]; // synchronous
  getAbstractFileByPath(path: string): IFile | IFolder | null;
}

interface IVaultFileWriter {
  create(path: string, content: string): Promise<IFile>;
  modify(file: IFile, newContent: string): Promise<void>;
  delete(file: IFile): Promise<void>;
  process(file: IFile, fn: (content: string) => string): Promise<string>;
}

interface IVaultFileRenamer {
  rename(file: IFile, newPath: string): Promise<void>;
  updateLinks(
    oldPath: string,
    newPath: string,
    oldBasename: string,
  ): Promise<void>;
}

interface IVaultFolderManager {
  createFolder(path: string): Promise<void>;
  getDefaultNewFileParent(): IFolder | null;
}

interface IVaultFrontmatterManager {
  getFrontmatter(file: IFile): IFrontmatter | null; // synchronous
  updateFrontmatter(
    file: IFile,
    updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void>;
}

interface IVaultLinkResolver {
  getFirstLinkpathDest(linkpath: string, sourcePath: string): IFile | null;
}

interface IVaultAdapter
  extends
    IVaultFileReader,
    IVaultFileWriter,
    IVaultFileRenamer,
    IVaultFolderManager,
    IVaultFrontmatterManager,
    IVaultLinkResolver {}
```

Note that file operations take **`IFile` objects**, not path strings (resolve paths via `getAbstractFileByPath`), and that `getAllFiles` / `getFrontmatter` are synchronous.

### IFile

```typescript
interface IFileStat {
  ctime: number;
  mtime: number;
}

interface IFile {
  path: string;
  basename: string; // filename without extension
  name: string; // filename with extension
  parent: IFolder | null;
  stat?: IFileStat;
}

interface IFolder {
  path: string;
  name: string;
}

interface IFrontmatter {
  [key: string]: unknown;
}
```

---

## Usage Patterns

### Creating Custom Service

```typescript
import type { IVaultAdapter, IFrontmatter } from "@kitelev/exocortex-core";

class CustomService {
  constructor(private vault: IVaultAdapter) {}

  async processNotes(): Promise<void> {
    for (const file of this.vault.getAllFiles()) {
      // sync
      const frontmatter = this.vault.getFrontmatter(file); // sync, null when absent
      if (!frontmatter) continue;

      const content = await this.vault.read(file); // takes IFile, not path

      // Process...

      await this.vault.updateFrontmatter(file, (current: IFrontmatter) => ({
        ...current,
        processed: true,
      }));
    }
  }
}
```

### Implementing Vault Adapter Roles

Implementing the full `IVaultAdapter` composite is only needed for production adapters. Consumers (and their tests) should target role interfaces:

```typescript
import type {
  IVaultFileReader,
  IVaultFrontmatterManager,
  IFile,
  IFolder,
  IFrontmatter,
} from "@kitelev/exocortex-core";

class FakeVault implements IVaultFileReader, IVaultFrontmatterManager {
  constructor(
    private contents = new Map<string, string>(),
    private frontmatters = new Map<string, IFrontmatter>(),
  ) {}

  async read(file: IFile): Promise<string> {
    const content = this.contents.get(file.path);
    if (content === undefined) throw new Error(`Missing fixture: ${file.path}`);
    return content;
  }

  async exists(path: string): Promise<boolean> {
    return this.contents.has(path);
  }

  getAllFiles(): IFile[] {
    return [...this.contents.keys()].map((path) => this.toFile(path));
  }

  getAbstractFileByPath(path: string): IFile | IFolder | null {
    return this.contents.has(path) ? this.toFile(path) : null;
  }

  getFrontmatter(file: IFile): IFrontmatter | null {
    return this.frontmatters.get(file.path) ?? null;
  }

  async updateFrontmatter(
    file: IFile,
    updater: (current: IFrontmatter) => IFrontmatter,
  ): Promise<void> {
    const current = this.frontmatters.get(file.path) ?? {};
    this.frontmatters.set(file.path, updater(current));
  }

  private toFile(path: string): IFile {
    const basename = path.replace(/^.*\//, "").replace(/\.md$/, "");
    return { path, basename, name: `${basename}.md`, parent: null };
  }
}
```

Keep fakes faithful to the real contract: return `null` for missing frontmatter, keep `getAllFiles` / `getFrontmatter` synchronous, and take `IFile` objects where the interface does.

---

## Type Definitions

### Asset Classes

`AssetClass` is an **enum** of well-known class names (selected members shown; see `domain/constants/AssetClass.ts` for the full list, which includes prototypes, workflow classes, and `exocmd__*` command classes):

```typescript
import { AssetClass } from "@kitelev/exocortex-core";

enum AssetClass {
  AREA = "ems__Area",
  TASK = "ems__Task",
  PROJECT = "ems__Project",
  MEETING = "ems__Meeting",
  DAILY_NOTE = "pn__DailyNote",
  CONCEPT = "ims__Concept",
  CLASS = "exo__Class",
  // ... 24 members total
}
```

### Effort Status

`EffortStatus` is an **enum** with seven values:

```typescript
import { EffortStatus } from "@kitelev/exocortex-core";

enum EffortStatus {
  DRAFT = "ems__EffortStatusDraft",
  BACKLOG = "ems__EffortStatusBacklog",
  ANALYSIS = "ems__EffortStatusAnalysis",
  TODO = "ems__EffortStatusToDo",
  DOING = "ems__EffortStatusDoing",
  DONE = "ems__EffortStatusDone",
  TRASHED = "ems__EffortStatusTrashed",
}
```

These symbolic string values are the pre-UUID-canon form; new code should resolve status targets via TBox UUID lookup rather than adding dependencies on this enum (see the source JSDoc for the migration direction).

### Asset Relation

```typescript
import type { AssetRelation } from "@kitelev/exocortex-core";

interface AssetRelation {
  path: string;
  title: string;
  propertyName?: string;
  isArchived?: boolean;
  metadata: Record<string, unknown>;
}
```

### Area Node

```typescript
import type { AreaNode, AreaNodeData } from "@kitelev/exocortex-core";

interface AreaNodeData {
  path: string;
  title: string;
  label?: string;
  isArchived: boolean;
  depth: number;
  parentPath?: string;
}

interface AreaNode extends AreaNodeData {
  children: AreaNode[];
}
```

---

## Error Handling

### File System Errors

Thrown by `IFileSystemAdapter` implementations:

```typescript
import {
  FileNotFoundError,
  FileAlreadyExistsError,
} from "@kitelev/exocortex-core";

try {
  await fs.readFile("non-existent.md"); // fs: IFileSystemAdapter implementation
} catch (error) {
  if (error instanceof FileNotFoundError) {
    // Handle missing file
  }
}
```

### SPARQL Errors

```typescript
import { SPARQLParser, SPARQLParseError } from "@kitelev/exocortex-core";

const parser = new SPARQLParser();

try {
  parser.parse(invalidQuery);
} catch (error) {
  if (error instanceof SPARQLParseError) {
    console.error(error.message);
    console.error(error.line, error.column); // optional position info
  }
}
```

Triple store transactions throw `TripleAlreadyExistsError`, `TripleNotFoundError`, and `TransactionError` (exported from the package).

---

## Package Structure

```
packages/core/src/
├── application/      # Application-level services (layout selection, ...)
├── domain/           # Models (RDF terms, commands, layout), constants, errors
├── exoql/            # ExoQL public query API facade
├── infrastructure/   # RDF serializers, SPARQL engine, DI container, memory
├── interfaces/       # Adapter contracts (IVaultAdapter, ITripleStore, ...)
├── services/         # Business logic services
├── types/            # Shared type definitions
└── utilities/        # FrontmatterService, DateFormatter, WikiLinkHelpers, ...
```

---

**See also:**

- [Plugin Development Guide](../how-to/Plugin-Development-Guide.md)
- [Testing Guide](../../TESTING.md)
