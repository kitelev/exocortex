# SPARQL Developer Guide for Exocortex

This guide is for plugin developers who want to integrate SPARQL queries into their Obsidian plugins or extend Exocortex's SPARQL functionality.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Triple Store API](#triple-store-api)
3. [Query Execution Pipeline](#query-execution-pipeline)
4. [Custom Executors](#custom-executors)
5. [Extension Points](#extension-points)
6. [Testing Strategies](#testing-strategies)

---

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Obsidian Note (Frontmatter + Content)                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ NoteToRDFConverter (packages/exocortex)                          │
│ - Extracts frontmatter properties                           │
│ - Converts to RDF triples                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ InMemoryTripleStore (packages/exocortex)                         │
│ - Stores triples with 6-index scheme (SPO/SOP/PSO/POS/OSP/OPS)│
│ - O(1) lookup for all 2-known-term patterns                 │
│ - LRU query result cache (1000 entries)                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ SPARQL Query Execution Pipeline                             │
│                                                              │
│  SPARQLParser → AlgebraTranslator → AlgebraOptimizer        │
│       ↓               ↓                    ↓                 │
│     AST          Algebra Tree        Optimized Algebra      │
│                                             ↓                │
│                              ┌──────────────┴──────────────┐│
│                              ↓              ↓               ↓│
│                          QueryExecutor  PropertyPath   Filter│
│                              │          Executor       Executor│
│                              ↓                              │
│                         BGPExecutor / ConstructExecutor     │
│                              │                              │
│                              ↓                              │
│                      QueryPlanCache (LRU, 100 plans)        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Results Rendering (packages/obsidian-plugin)                │
│ - SPARQLResultViewer (table/list/graph views)               │
│ - SPARQLErrorView (error display with hints)                │
└─────────────────────────────────────────────────────────────┘
```

### Package Structure

```
exocortex (storage-agnostic)
├── domain/
│   ├── Triple.ts                  # RDF triple representation
│   ├── TripleStore.ts              # Interface for triple storage
│   └── InMemoryTripleStore.ts      # In-memory implementation
├── application/
│   ├── SPARQLParser.ts             # Query parsing
│   ├── AlgebraTranslator.ts        # AST → Algebra conversion
│   ├── AlgebraOptimizer.ts         # Query optimization
│   ├── BGPExecutor.ts              # Basic Graph Pattern execution
│   └── ConstructExecutor.ts        # CONSTRUCT query execution
└── infrastructure/
    └── NoteToRDFConverter.ts       # Markdown → RDF conversion

@exocortex/obsidian-plugin (Obsidian UI)
├── application/
│   ├── api/
│   │   └── SPARQLApi.ts            # Public API for plugins
│   ├── processors/
│   │   └── SPARQLCodeBlockProcessor.ts  # Code block rendering
│   └── services/
│       └── SPARQLQueryService.ts   # Query service wrapper
└── presentation/
    └── components/sparql/
        ├── SPARQLResultViewer.tsx  # Result display
        └── SPARQLErrorView.tsx     # Error display
```

### Core Concepts

#### 1. Triple Store

The `InMemoryTripleStore` uses a **6-index scheme** for optimal query performance:

- **SPO Index**: Subject → Predicate → Object (forward lookups)
- **SOP Index**: Subject → Object → Predicate
- **PSO Index**: Predicate → Subject → Object
- **POS Index**: Predicate → Object → Subject (property-value lookups)
- **OSP Index**: Object → Subject → Predicate (reverse lookups)
- **OPS Index**: Object → Predicate → Subject

**Lookup Complexity**: O(1) for all 2-known-term patterns. Only full wildcard `(?, ?, ?)` requires O(n) scan.

**Additional Features**:
- **LRU Query Cache**: 1000-entry cache for `match()` results
- **Automatic cache invalidation**: Cache clears on `add()` or `remove()`
- **Transaction support**: Atomic batch operations via `beginTransaction()`

#### 2. SPARQL Algebra

SPARQL queries are translated into algebraic operations:

```typescript
{
  type: "bgp",
  triples: [
    { subject: "?task", predicate: IRI("exo__Instance_class"), object: Literal("ems__Task") }
  ]
}
```

**Operations**:
- `bgp` - Basic Graph Pattern (triple matching)
- `slice` - LIMIT/OFFSET
- `distinct` - DISTINCT results
- `filter` - FILTER conditions
- `construct` - CONSTRUCT template
- `join` - Joining multiple patterns
- `leftjoin` - OPTIONAL patterns
- `union` - UNION patterns
- `project` - Variable projection (SELECT)
- `orderby` - ORDER BY sorting
- `path` - Property path expressions (v2)
- `exists` - EXISTS/NOT EXISTS patterns (v2)
- `bind` - BIND expressions (v2)
- `subquery` - Nested subqueries (v2)

#### 3. Query Execution

Queries execute asynchronously using iterators:

```typescript
async *execute(algebra: AlgebraOperation): AsyncIterableIterator<SolutionMapping>
```

**Benefits**:
- Memory efficient (streaming results)
- Cancelable mid-execution
- Composable operators

---

## Triple Store API

### Accessing the Triple Store

#### From Plugin Code

```typescript
import type ExocortexPlugin from "exocortex-obsidian-plugin";

const plugin: ExocortexPlugin = this.app.plugins.getPlugin("exocortex");
const tripleStore = plugin.sparql.getTripleStore();
```

#### From SPARQLApi

```typescript
import { SPARQLApi } from "exocortex-obsidian-plugin";

const sparqlApi = new SPARQLApi(plugin);
const tripleStore = sparqlApi.getTripleStore();
```

### InMemoryTripleStore Interface

```typescript
interface ITripleStore {
  add(triple: Triple): void;
  remove(triple: Triple): void;
  clear(): void;
  size(): number;

  match(
    subject?: Term | null,
    predicate?: Term | null,
    object?: Term | null
  ): Triple[];
}
```

### Basic Operations

#### Adding Triples

```typescript
import { Triple, IRI, Literal } from "exocortex";

const triple = new Triple(
  IRI("vault://Notes/My-Note.md"),
  IRI("https://exocortex.my/ontology/exo#Asset_label"),
  Literal("My Note")
);

tripleStore.add(triple);
```

#### Querying Triples

```typescript
const allTasks = tripleStore.match(
  null,  // Any subject
  IRI("https://exocortex.my/ontology/exo#Instance_class"),
  Literal("ems__Task")
);

console.log(`Found ${allTasks.length} tasks`);
```

#### Pattern Matching

```typescript
const taskProperties = tripleStore.match(
  IRI("vault://Tasks/My-Task.md"),  // Specific subject
  null,  // Any predicate
  null   // Any object
);

taskProperties.forEach(triple => {
  console.log(`${triple.predicate} = ${triple.object}`);
});
```

### Performance Considerations

**Index Selection**:

```typescript
tripleStore.match(subject, predicate, object)
```

| Pattern | Index Used | Complexity |
|---------|------------|------------|
| `(s, p, o)` | SPO | O(1) |
| `(s, p, ?)` | SPO | O(1) |
| `(s, ?, o)` | None | O(n) |
| `(?, p, o)` | POS | O(1) |
| `(?, ?, o)` | OSP | O(1) |
| `(?, p, ?)` | None | O(n) |
| `(?, ?, ?)` | None | O(n) |

**Optimization Tip**: Design queries to use indexed patterns (provide at least 2 of 3 terms).

---

## Query Execution Pipeline

### Pipeline Stages

#### 1. Parsing

**Input**: SPARQL query string

**Output**: Abstract Syntax Tree (AST)

```typescript
import { SPARQLParser } from "exocortex";

const parser = new SPARQLParser();
const ast = parser.parse(`
  SELECT ?task ?label
  WHERE {
    ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
    ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  }
`);
```

**Error Handling**:

```typescript
try {
  const ast = parser.parse(queryString);
} catch (error) {
  if (error instanceof SPARQLParseError) {
    console.error(`Parse error at line ${error.line}, column ${error.column}`);
    console.error(error.message);
  }
}
```

#### 2. Algebra Translation

**Input**: AST

**Output**: Algebra tree

```typescript
import { AlgebraTranslator } from "exocortex";

const translator = new AlgebraTranslator();
const algebra = translator.translate(ast);
```

**Algebra Structure**:

```typescript
{
  type: "project",
  variables: ["?task", "?label"],
  input: {
    type: "bgp",
    triples: [...]
  }
}
```

#### 3. Optimization

**Input**: Algebra tree

**Output**: Optimized algebra tree

```typescript
import { AlgebraOptimizer } from "exocortex";

const optimizer = new AlgebraOptimizer();
const optimizedAlgebra = optimizer.optimize(algebra);
```

**Optimizations Applied**:
- Triple pattern reordering (most selective first)
- Constant propagation
- Dead code elimination
- Join reordering

#### 4. Execution

**Input**: Optimized algebra

**Output**: Solution mappings (bindings)

```typescript
import { BGPExecutor } from "exocortex";

const executor = new BGPExecutor(tripleStore);
const results: SolutionMapping[] = [];

for await (const binding of executor.execute(algebra)) {
  results.push(binding);
}
```

### Complete Example

```typescript
import {
  SPARQLParser,
  AlgebraTranslator,
  AlgebraOptimizer,
  BGPExecutor,
  InMemoryTripleStore
} from "exocortex";

async function executeQuery(queryString: string, tripleStore: InMemoryTripleStore) {
  const parser = new SPARQLParser();
  const ast = parser.parse(queryString);

  const translator = new AlgebraTranslator();
  let algebra = translator.translate(ast);

  const optimizer = new AlgebraOptimizer();
  algebra = optimizer.optimize(algebra);

  const executor = new BGPExecutor(tripleStore);
  const results: SolutionMapping[] = [];

  for await (const binding of executor.execute(algebra)) {
    results.push(binding);
  }

  return results;
}
```

---

## v2 Executors

SPARQL Engine v2 introduces specialized executors for advanced features.

### PropertyPathExecutor

Handles property path expressions (`+`, `*`, `?`, `^`, `/`, `|`).

```typescript
import { PropertyPathExecutor } from "exocortex";

const pathExecutor = new PropertyPathExecutor(tripleStore);

// Execute a property path pattern
for await (const binding of pathExecutor.execute(subject, path, object)) {
  console.log(binding);
}
```

**Supported Path Types**:

| Path Type | Symbol | Description | Max Depth |
|-----------|--------|-------------|-----------|
| Sequence | `/` | Match predicates in order | Unlimited |
| Alternative | `\|` | Match any alternative | Unlimited |
| Inverse | `^` | Reverse direction | Unlimited |
| OneOrMore | `+` | At least one step | 100 |
| ZeroOrMore | `*` | Zero or more steps | 100 |
| ZeroOrOne | `?` | Optional single step | 1 |

**Cycle Detection**: Uses BFS traversal with visited-node tracking to prevent infinite loops. Maximum depth of 100 for transitive closures.

### FilterExecutor with EXISTS

Handles FILTER expressions including EXISTS/NOT EXISTS.

```typescript
import { FilterExecutor, ExistsEvaluator } from "exocortex";

const filterExecutor = new FilterExecutor();

// Set up EXISTS evaluator (connects to QueryExecutor for subqueries)
filterExecutor.setExistsEvaluator(async (pattern, solution) => {
  // Execute pattern with current bindings
  const results = await queryExecutor.executePattern(pattern, solution);
  return results.length > 0; // true if any results found
});

// Execute filter
for await (const binding of filterExecutor.execute(filterOp, inputSolutions)) {
  console.log(binding);
}
```

**Supported Functions**:
- **String**: `STR()`, `STRLEN()`, `UCASE()`, `LCASE()`, `CONTAINS()`, `STRSTARTS()`, `STRENDS()`, `REPLACE()`, `REGEX()`
- **Type checking**: `BOUND()`, `ISIRI()`, `ISBLANK()`, `ISLITERAL()`, `DATATYPE()`, `LANG()`
- **Date**: `parseDate()`, `dateBefore()`, `dateAfter()`, `dateInRange()`, `exo:dateDiffMinutes()`, `exo:dateDiffHours()`
- **Logical**: `&&`, `||`, `!`
- **Comparison**: `=`, `!=`, `<`, `>`, `<=`, `>=`

### AlgebraOptimizer

Automatically optimizes query plans.

```typescript
import { AlgebraOptimizer } from "exocortex";

const optimizer = new AlgebraOptimizer();
const optimizedPlan = optimizer.optimize(algebraTree);
```

**Optimizations Applied**:

1. **Filter Pushdown**: Moves filters closer to data source
2. **Join Reordering**: Orders joins by estimated selectivity
3. **Empty BGP Elimination**: Removes unnecessary empty patterns

**Cost Estimation**:
```typescript
const cost = optimizer.estimateCost(operation);
// Returns numeric cost estimate
// Lower cost = faster execution
```

### QueryPlanCache

Caches optimized query plans for repeated queries.

```typescript
import { QueryPlanCache } from "exocortex";

const cache = new QueryPlanCache(100); // max 100 plans

// Check cache
const cachedPlan = cache.get(queryString);
if (cachedPlan) {
  // Use cached plan
} else {
  // Parse, translate, optimize
  const plan = optimizer.optimize(translator.translate(parser.parse(query)));
  cache.set(queryString, plan);
}

// Get statistics
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Hits: ${stats.hits}, Misses: ${stats.misses}`);

// Clear on data change
cache.clear();
```

---

## Custom Executors

### Implementing a Custom Operator

#### Example: LIMIT Operator

```typescript
import { SolutionMapping, AlgebraOperation } from "exocortex";

class LimitOperator {
  private limit: number;
  private inputIterator: AsyncIterableIterator<SolutionMapping>;

  constructor(limit: number, input: AsyncIterableIterator<SolutionMapping>) {
    this.limit = limit;
    this.inputIterator = input;
  }

  async *execute(): AsyncIterableIterator<SolutionMapping> {
    let count = 0;

    for await (const binding of this.inputIterator) {
      if (count >= this.limit) {
        break;
      }
      yield binding;
      count++;
    }
  }
}
```

**Usage**:

```typescript
const bgpResults = executor.execute(bgpAlgebra);
const limitedResults = new LimitOperator(10, bgpResults).execute();

for await (const binding of limitedResults) {
  console.log(binding);
}
```

#### Example: FILTER Operator

```typescript
class FilterOperator {
  private condition: (binding: SolutionMapping) => boolean;
  private inputIterator: AsyncIterableIterator<SolutionMapping>;

  constructor(
    condition: (binding: SolutionMapping) => boolean,
    input: AsyncIterableIterator<SolutionMapping>
  ) {
    this.condition = condition;
    this.inputIterator = input;
  }

  async *execute(): AsyncIterableIterator<SolutionMapping> {
    for await (const binding of this.inputIterator) {
      if (this.condition(binding)) {
        yield binding;
      }
    }
  }
}
```

**Usage**:

```typescript
const filterFn = (binding: SolutionMapping) => {
  const votes = binding.get("votes");
  return votes && parseInt(votes.value) > 5;
};

const filteredResults = new FilterOperator(filterFn, bgpResults).execute();
```

### Extending BGPExecutor

```typescript
import { BGPExecutor, InMemoryTripleStore, SolutionMapping } from "exocortex";

class CustomBGPExecutor extends BGPExecutor {
  constructor(tripleStore: InMemoryTripleStore) {
    super(tripleStore);
  }

  async *execute(algebra: any): AsyncIterableIterator<SolutionMapping> {
    console.log("[CustomBGPExecutor] Executing query...");

    const startTime = Date.now();
    let count = 0;

    for await (const binding of super.execute(algebra)) {
      count++;
      yield binding;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[CustomBGPExecutor] Returned ${count} results in ${elapsed}ms`);
  }
}
```

---

## ExoRDF to RDF/RDFS Mapping Architecture

### Overview

Exocortex generates BOTH ExoRDF custom triples AND standard RDF/RDFS vocabulary triples for semantic interoperability.

### Triple Generation Strategy

When an asset is indexed, the triple store generates:

1. **ExoRDF Triples** (custom vocabulary)
   - `<asset> exo:Instance_class "ems__Task"`
   - `<asset> exo:Asset_label "Review PR"`
   - etc.

2. **RDF/RDFS Triples** (standard vocabulary)
   - `<asset> rdf:type ems:Task`
   - `ems:Task rdfs:subClassOf exo:Asset`
   - `exo:Asset rdfs:subClassOf rdfs:Resource`

This dual-generation ensures:
- **Backward compatibility**: ExoRDF queries still work
- **Semantic interoperability**: RDF/RDFS queries work
- **Inference capabilities**: Transitive class/property queries

### URI Construction

Assets use UID-based URIs following the pattern:

```
http://${ontology_url}/${asset_uid}
```

**Example**:
```
https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000
```

**Why UID-based?**
- **Stability**: UIDs never change, filenames can be renamed
- **Uniqueness**: UUID v4 provides global uniqueness
- **Semantic Web**: Standard practice in RDF systems

See [ExoRDF Mapping Specification](../rdf/ExoRDF-Mapping.md) for complete details.

### Inference Engine

SPARQL queries support:
- `rdfs:subClassOf*` - Transitive class hierarchy queries
- `rdfs:subPropertyOf*` - Transitive property hierarchy queries

Implementation uses cached transitive closures for performance.

### Performance Considerations

- **RDF/RDFS triple generation**: <5ms overhead per asset
- **Memory increase**: ~15-20% compared to ExoRDF-only
- **Transitive closure queries**: O(n×m) where m is hierarchy depth
- **Use LIMIT** to avoid large result sets in transitive queries

### Property Mappings

| ExoRDF Property | RDF/RDFS Equivalent | Purpose |
|-----------------|---------------------|---------|
| `exo:Instance_class` | `rdf:type` | Asset type classification |
| `exo:Asset_isDefinedBy` | `rdfs:isDefinedBy` | Ontology reference |
| `exo:Class_superClass` | `rdfs:subClassOf` | Class hierarchy |
| `exo:Property_range` | `rdfs:range` | Property value type |
| `exo:Property_domain` | `rdfs:domain` | Property applies to |

---

## Extension Points

### 1. Custom Code Block Processors

**Register a custom SPARQL processor**:

```typescript
export class CustomSPARQLProcessor extends SPARQLCodeBlockProcessor {
  async process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    el.classList.add("custom-sparql-block");

    const results = await super.executeQuery(source);

    this.renderCustomView(results, el);
  }

  private renderCustomView(results: SolutionMapping[] | Triple[], el: HTMLElement) {
    const container = el.createDiv({ cls: "custom-results" });
    container.textContent = `Found ${results.length} results`;
  }
}
```

**Register in plugin**:

```typescript
this.registerMarkdownCodeBlockProcessor("sparql-custom", (source, el, ctx) => {
  const processor = new CustomSPARQLProcessor(this);
  return processor.process(source, el, ctx);
});
```

### 2. Custom Result Renderers

**Create a custom result viewer**:

```typescript
import React from "react";
import { SPARQLResultViewerProps } from "exocortex-obsidian-plugin";

export const CustomResultViewer: React.FC<SPARQLResultViewerProps> = ({
  results,
  queryString,
  onAssetClick,
  app
}) => {
  return (
    <div className="custom-result-viewer">
      <h3>Custom View: {results.length} results</h3>
      {/* Custom visualization logic */}
    </div>
  );
};
```

**Use in processor**:

```typescript
this.reactRenderer.render(
  container,
  React.createElement(CustomResultViewer, {
    results,
    queryString,
    app: this.plugin.app,
    onAssetClick: (path) => this.plugin.app.workspace.openLinkText(path, "", false, { active: true })
  })
);
```

### 3. Query Hooks

**Pre-execution hook**:

```typescript
class HookedSPARQLApi extends SPARQLApi {
  async query(sparql: string): Promise<QueryResult> {
    console.log(`[Query Hook] Executing: ${sparql}`);

    const result = await super.query(sparql);

    console.log(`[Query Hook] Returned ${result.count} results`);
    return result;
  }
}
```

### 4. Triple Store Extensions

**Custom triple store with persistence**:

```typescript
import { InMemoryTripleStore, Triple } from "exocortex";
import { TFile, Vault } from "obsidian";

class PersistentTripleStore extends InMemoryTripleStore {
  private vault: Vault;
  private cacheFile: TFile;

  constructor(vault: Vault, cacheFile: TFile) {
    super();
    this.vault = vault;
    this.cacheFile = cacheFile;
  }

  async load(): Promise<void> {
    const content = await this.vault.read(this.cacheFile);
    const triples = JSON.parse(content);

    triples.forEach((t: any) => this.add(Triple.fromJSON(t)));
  }

  async save(): Promise<void> {
    const triples = Array.from(this.getAllTriples());
    const json = JSON.stringify(triples.map(t => t.toJSON()));

    await this.vault.modify(this.cacheFile, json);
  }

  add(triple: Triple): void {
    super.add(triple);
    this.save();  // Auto-save on modification
  }
}
```

---

## Testing Strategies

### Unit Testing Triple Store

```typescript
import { InMemoryTripleStore, Triple, IRI, Literal } from "exocortex";

describe("InMemoryTripleStore", () => {
  let store: InMemoryTripleStore;

  beforeEach(() => {
    store = new InMemoryTripleStore();
  });

  it("should add and retrieve triples", () => {
    const triple = new Triple(
      IRI("vault://test.md"),
      IRI("https://exocortex.my/ontology/exo#Asset_label"),
      Literal("Test")
    );

    store.add(triple);

    const results = store.match(
      IRI("vault://test.md"),
      null,
      null
    );

    expect(results).toHaveLength(1);
    expect(results[0].object.value).toBe("Test");
  });

  it("should use SPO index for (s, p, ?) pattern", () => {
    const triple = new Triple(
      IRI("vault://test.md"),
      IRI("https://exocortex.my/ontology/exo#Asset_label"),
      Literal("Test")
    );

    store.add(triple);

    const results = store.match(
      IRI("vault://test.md"),
      IRI("https://exocortex.my/ontology/exo#Asset_label"),
      null
    );

    expect(results).toHaveLength(1);
  });
});
```

### Unit Testing Query Execution

```typescript
import { SPARQLParser, BGPExecutor, InMemoryTripleStore } from "exocortex";

describe("BGPExecutor", () => {
  let store: InMemoryTripleStore;
  let executor: BGPExecutor;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    executor = new BGPExecutor(store);

    store.add(new Triple(
      IRI("vault://task1.md"),
      IRI("https://exocortex.my/ontology/exo#Instance_class"),
      Literal("ems__Task")
    ));
  });

  it("should execute SELECT query", async () => {
    const parser = new SPARQLParser();
    const ast = parser.parse(`
      SELECT ?task
      WHERE {
        ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
      }
    `);

    const results: SolutionMapping[] = [];
    for await (const binding of executor.execute(ast)) {
      results.push(binding);
    }

    expect(results).toHaveLength(1);
    expect(results[0].get("task")?.value).toBe("vault://task1.md");
  });
});
```

### Component Testing (Playwright)

```typescript
import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import { SPARQLErrorView, SPARQLError } from "../../../src/presentation/components/sparql/SPARQLErrorView";

test.describe("SPARQLErrorView", () => {
  test("should render parser error with line and column", async ({ mount }) => {
    const error: SPARQLError = {
      message: "Expected WHERE clause",
      line: 3,
      column: 15,
      queryString: "SELECT ?task\nWHERE {\n  ?task <status> ?status\n}",
    };

    const component = await mount(<SPARQLErrorView error={error} />);

    await expect(component.getByText(/syntax error/i)).toBeVisible();
    await expect(component.getByText(/Expected WHERE clause/)).toBeVisible();
    await expect(component.getByText(/at line 3, column 15/)).toBeVisible();
  });
});
```

### Integration Testing

```typescript
import { SPARQLApi } from "../../../src/application/api/SPARQLApi";
import type ExocortexPlugin from "../../../src/ExocortexPlugin";

describe("SPARQLApi Integration", () => {
  let api: SPARQLApi;
  let mockPlugin: ExocortexPlugin;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    api = new SPARQLApi(mockPlugin);
  });

  it("should execute query and return results with count", async () => {
    const result = await api.query("SELECT ?task WHERE { ?task a ems:Task }");

    expect(result.bindings).toBeDefined();
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it("should propagate errors from query service", async () => {
    await expect(api.query("INVALID QUERY")).rejects.toThrow();
  });
});
```

### E2E Testing

```typescript
import { test, expect } from "@playwright/test";

test.describe("SPARQL Code Block", () => {
  test("should render query results", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      const codeBlock = document.createElement("div");
      codeBlock.textContent = `
        SELECT ?task ?label
        WHERE {
          ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
          ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
        }
      `;
      codeBlock.classList.add("language-sparql");
      document.body.appendChild(codeBlock);
    });

    await expect(page.locator(".sparql-results-container")).toBeVisible();
    await expect(page.locator(".sparql-result-viewer")).toBeVisible();
  });
});
```

---

## API Reference

### SPARQLApi

**Public API for querying the triple store from plugins**.

#### Methods

```typescript
async query(sparql: string): Promise<QueryResult>
```

Execute a SPARQL SELECT query.

**Returns**: `{ bindings: SolutionMapping[], count: number }`

---

```typescript
getTripleStore(): InMemoryTripleStore
```

Access the underlying triple store.

**Returns**: `InMemoryTripleStore` instance

---

```typescript
async refresh(): Promise<void>
```

Refresh the triple store by re-indexing the vault.

---

```typescript
async dispose(): Promise<void>
```

Clean up resources (call on plugin unload).

---

## Best Practices

### 1. Error Handling

Always handle SPARQL parse errors:

```typescript
try {
  const results = await plugin.sparql.query(queryString);
} catch (error) {
  if (error instanceof SPARQLParseError) {
    new Notice(`SPARQL syntax error: ${error.message}`, 5000);
  } else {
    new Notice(`Query execution failed: ${error.message}`, 5000);
  }
}
```

### 2. Resource Cleanup

Dispose of SPARQL services on plugin unload:

```typescript
export class MyPlugin extends Plugin {
  sparqlApi: SPARQLApi;

  async onload() {
    this.sparqlApi = new SPARQLApi(this);
  }

  async onunload() {
    await this.sparqlApi.dispose();
  }
}
```

### 3. Performance Monitoring

Log query performance in development:

```typescript
const startTime = Date.now();
const results = await plugin.sparql.query(queryString);
const elapsed = Date.now() - startTime;

if (elapsed > 1000) {
  console.warn(`[SPARQL] Slow query (${elapsed}ms): ${queryString}`);
}
```

### 4. Type Safety

Use TypeScript types for better developer experience:

```typescript
import type { QueryResult, SolutionMapping } from "exocortex-obsidian-plugin";

async function getTasks(): Promise<SolutionMapping[]> {
  const result: QueryResult = await plugin.sparql.query(`
    SELECT ?task ?label
    WHERE {
      ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
      ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
    }
  `);

  return result.bindings;
}
```

---

## Next Steps

- **Explore Examples**: See [Query-Examples.md](./Query-Examples.md) for real-world patterns
- **User Guide**: Read [User-Guide.md](./User-Guide.md) for SPARQL syntax
- **Performance**: Check [Performance-Tips.md](./Performance-Tips.md) for optimization

## Resources

- [Exocortex GitHub Repository](https://github.com/kitelev/exocortex-obsidian-plugin)
- [SPARQL 1.1 Specification](https://www.w3.org/TR/sparql11-query/)
- [RDF Primer](https://www.w3.org/TR/rdf-primer/)

---

**Have questions?** Open an issue or discussion on [GitHub](https://github.com/kitelev/exocortex-obsidian-plugin/issues)!
