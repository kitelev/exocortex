# ExoQL Specification

> **Version**: 1.0  
> **Status**: Living document  
> **Audience**: Developers, AI agents, plugin users

---

## 1. Overview

ExoQL is the query language of the Exocortex knowledge management system. It is a superset of **SPARQL 1.1** extended with Exocortex-specific capabilities for working with ontology-driven knowledge graphs stored in Obsidian vaults.

### 1.1 Relationship to SPARQL

ExoQL accepts any valid SPARQL 1.1 query and adds the following extensions:

| Extension             | Purpose                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| OWN() filter          | Distinguish own (directly asserted) vs inherited (prototype-materialized) properties |
| `_source` annotation  | Automatic provenance binding (`"own"` or `"inherited"`) on query results             |
| `exoql` code block    | Vault-native query rendering alongside the existing `sparql` code block              |
| CLI alias             | `exoql` primary command with `sparql` as a deprecated alias                          |
| Auto-prefix injection | Exocortex ontology prefixes injected automatically into queries                      |

### 1.2 Design Principles

1. **Backward compatible** -- every existing `sparql` query works unchanged under `exoql`.
2. **Prototype-aware** -- first-class support for the Exocortex prototype chain (inherited properties).
3. **Multi-surface** -- identical semantics across Obsidian code blocks, CLI, and programmatic API.

---

## 2. Query Syntax

ExoQL supports the three core SPARQL query forms.

### 2.1 SELECT

Returns tabular solution mappings (variable bindings).

```exoql
SELECT ?project ?label
WHERE {
  ?project a <ems:Project> .
  ?project <exo:Asset_label> ?label .
}
ORDER BY ?label
LIMIT 10
```

Supported clauses: `WHERE`, `FILTER`, `OPTIONAL`, `ORDER BY`, `LIMIT`, `OFFSET`, `DISTINCT`, `UNION`.

### 2.2 ASK

Returns a boolean indicating whether any match exists.

```exoql
ASK WHERE {
  ?s a <ems:Task> .
  ?s <ems:Effort_status> <ems:EffortStatusDoing> .
}
```

### 2.3 CONSTRUCT

Produces new RDF triples from a template.

```exoql
CONSTRUCT {
  ?task <ex:assignedTo> "active" .
}
WHERE {
  ?task a <ems:Task> .
  ?task <ems:Effort_status> <ems:EffortStatusDoing> .
}
```

---

## 3. OWN() Function

The Exocortex prototype chain materializer copies inheritable properties from prototypes to instances, storing materialized triples in the `exo:inferred` named graph. The OWN() function filters query results to return only **directly asserted** (non-inherited) properties.

### 3.1 Mechanism

1. A standard SELECT query executes against the full triple store (own + inherited triples).
2. The `SourceAnnotator` checks each result triple against the `exo:inferred` named graph.
3. Triples present in `exo:inferred` are classified as `"inherited"` and filtered out.
4. Only `"own"` triples are returned.

### 3.2 Named Graph

Materialized triples live in:

```
https://exocortex.my/ontology/exo#inferred
```

A triple is **own** if it exists in the default graph but NOT in the inferred graph.  
A triple is **inherited** if it exists in both the default graph and the inferred graph.

### 3.3 API Usage

```typescript
// Default variable names: ?s, ?p, ?o
const own = await ExoQL.queryOwn(`SELECT ?s ?p ?o WHERE { ?s ?p ?o }`, store);

// Custom variable names
const own = await ExoQL.queryOwn(
  `SELECT ?subject ?predicate ?value WHERE { ?subject ?predicate ?value }`,
  store,
  { subjectVar: "subject", predicateVar: "predicate", objectVar: "value" },
);
```

### 3.4 Single-Triple Check

```typescript
const isOwn = await ExoQL.isOwn(subject, predicate, object, store);
// Returns: true (own) or false (inherited)
```

---

## 4. Source Annotation (`_source` Binding)

The `SourceAnnotator` service enriches query results with a `_source` variable indicating provenance.

### 4.1 Values

| `_source` value | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `"own"`         | Triple is directly asserted on the subject                       |
| `"inherited"`   | Triple was materialized from a prototype via the prototype chain |

### 4.2 Annotation Modes

**Triple-level annotation** (requires `?s`, `?p`, `?o` bindings):

```typescript
const annotator = new SourceAnnotator(store);
const annotated = await annotator.annotate(solutions, "s", "p", "o");
// Each solution now has a "_source" binding
```

**Subject-level annotation** (batch mode, checks if ANY triple for a subject is inferred):

```typescript
const annotated = await annotator.annotateBySubject(solutions, "s");
```

### 4.3 Graceful Degradation

If the triple store does not support named graphs (`matchInGraph` is undefined), all triples default to `"own"`.

---

## 5. Code Block Usage

ExoQL queries can be embedded directly in Obsidian vault notes using fenced code blocks.

### 5.1 Primary Syntax

````markdown
```exoql
SELECT ?task ?label
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
}
```
````

### 5.2 Legacy Syntax (Supported)

````markdown
```sparql
SELECT ?task ?label
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
}
```
````

Both `exoql` and `sparql` code block languages are registered and execute identically through the `SPARQLCodeBlockProcessor`.

### 5.3 Behavior

- The vault is converted to an RDF triple store on first query execution.
- Results render as interactive tables or triple views within the note.
- Results auto-refresh when vault metadata changes (debounced at 500ms).
- Active queries have a 5-minute TTL; stale queries are cleaned up automatically.

---

## 6. CLI Usage

The CLI provides the `exoql` command as the primary entry point, with `sparql` retained as a deprecated alias.

### 6.1 Query Execution

```bash
# Primary command
npx @kitelev/exocortex-cli exoql query "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10"

# With vault path
npx @kitelev/exocortex-cli exoql query "SELECT ?s WHERE { ?s a <ems:Task> }" --vault ~/vault-2025

# Output formats
npx @kitelev/exocortex-cli exoql query "..." --format table   # default
npx @kitelev/exocortex-cli exoql query "..." --format json
npx @kitelev/exocortex-cli exoql query "..." --format csv
npx @kitelev/exocortex-cli exoql query "..." --format ntriples
```

### 6.2 Additional Subcommands

```bash
npx @kitelev/exocortex-cli exoql index       # Manage triple store index/cache
npx @kitelev/exocortex-cli exoql templates   # Manage query templates
```

### 6.3 Query Options

| Flag                     | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `--vault <path>`         | Path to Obsidian vault                            |
| `--also <path>`          | Additional vault(s) to include                    |
| `--format <fmt>`         | Output format: `table`, `json`, `csv`, `ntriples` |
| `--explain`              | Show query execution plan (algebra)               |
| `--dry-run`              | Parse and validate without executing              |
| `--stats`                | Show execution statistics                         |
| `--no-optimize`          | Disable algebra optimization                      |
| `--cache` / `--no-cache` | Enable/disable result caching                     |
| `--cache-ttl <seconds>`  | Cache time-to-live (default: 300s)                |
| `--timeout <ms>`         | Query timeout (default: 30000ms)                  |
| `--template <name>`      | Use a named query template                        |
| `--param <key=value>`    | Template parameter substitution                   |

### 6.4 Deprecated Alias

```bash
# Still works, prints deprecation warning to stderr
npx @kitelev/exocortex-cli sparql query "..."
# stderr: "sparql" is deprecated. Use "exoql" instead.
```

---

## 7. Public API

The `ExoQL` class is exported from `@exocortex/core` (`exocortex` package) and provides a static facade over the internal SPARQL engine.

### 7.1 `ExoQL.query(sparql, store, config?)`

Execute a SELECT query.

```typescript
import { ExoQL } from "exocortex";

const results: SolutionMapping[] = await ExoQL.query(
  `SELECT ?s ?label WHERE { ?s <exo:Asset_label> ?label }`,
  store,
);
```

**Parameters:**

- `sparql: string` -- SPARQL SELECT query
- `store: ITripleStore` -- Triple store instance
- `config?: QueryExecutorConfig` -- Optional executor settings

**Returns:** `Promise<SolutionMapping[]>`

### 7.2 `ExoQL.ask(sparql, store, config?)`

Execute an ASK query.

```typescript
const exists: boolean = await ExoQL.ask(`ASK WHERE { ?s a <ems:Task> }`, store);
```

**Returns:** `Promise<boolean>`  
**Throws:** `ExoQLError` if the query is not an ASK query.

### 7.3 `ExoQL.construct(sparql, store, config?)`

Execute a CONSTRUCT query.

```typescript
const triples: Triple[] = await ExoQL.construct(
  `CONSTRUCT { ?s <ex:type> "task" } WHERE { ?s a <ems:Task> }`,
  store,
);
```

**Returns:** `Promise<Triple[]>`  
**Throws:** `ExoQLError` if the query is not a CONSTRUCT query.

### 7.4 `ExoQL.queryOwn(sparql, store, ownConfig?, config?)`

Execute a SELECT query and return only own (non-inherited) results.

```typescript
const ownResults: SolutionMapping[] = await ExoQL.queryOwn(
  `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
  store,
);
```

**Parameters:**

- `ownConfig?: OwnFilterConfig` -- Custom variable name mapping (default: `s`, `p`, `o`)

**Returns:** `Promise<SolutionMapping[]>` -- Only own (directly asserted) results.

### 7.5 `ExoQL.isOwn(subject, predicate, object, store)`

Check whether a specific triple is own or inherited.

```typescript
const own: boolean = await ExoQL.isOwn(
  new IRI("http://example.org/task1"),
  new IRI("http://example.org/name"),
  new Literal("My Task"),
  store,
);
```

**Returns:** `Promise<boolean>` -- `true` if own, `false` if inherited.

### 7.6 Types

```typescript
// Configuration for variable name mapping in queryOwn()
interface OwnFilterConfig {
  subjectVar?: string; // default: "s"
  predicateVar?: string; // default: "p"
  objectVar?: string; // default: "o"
}

// Error thrown for query type mismatches
class ExoQLError extends Error {
  name: "ExoQLError";
}
```

---

## 8. Migration Guide (sparql to exoql)

### 8.1 Code Blocks

No changes required. Both `sparql` and `exoql` code blocks work identically. To adopt the new name:

**Before:**

````markdown
```sparql
SELECT ?s WHERE { ?s a <ems:Task> }
```
````

**After:**

````markdown
```exoql
SELECT ?s WHERE { ?s a <ems:Task> }
```
````

### 8.2 CLI Commands

Replace `sparql` with `exoql` in all CLI invocations:

| Before                                          | After                                          |
| ----------------------------------------------- | ---------------------------------------------- |
| `npx @kitelev/exocortex-cli sparql query "..."` | `npx @kitelev/exocortex-cli exoql query "..."` |
| `npx @kitelev/exocortex-cli sparql index`       | `npx @kitelev/exocortex-cli exoql index`       |
| `npx @kitelev/exocortex-cli sparql templates`   | `npx @kitelev/exocortex-cli exoql templates`   |

The `sparql` alias continues to work but prints a deprecation warning to stderr.

### 8.3 Programmatic API

The import path and class name have not changed:

```typescript
// Works in both old and new versions
import { ExoQL } from "exocortex";
```

New capabilities available after migration:

```typescript
// NEW: Filter to own properties only
const ownResults = await ExoQL.queryOwn(query, store);

// NEW: Check single triple provenance
const isOwn = await ExoQL.isOwn(subject, predicate, object, store);
```

---

## 9. Example Queries

### Example 1: List All Tasks

```exoql
SELECT ?task ?label
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
}
ORDER BY ?label
```

### Example 2: Find Active Projects

```exoql
SELECT ?project ?label
WHERE {
  ?project a <ems:Project> .
  ?project <exo:Asset_label> ?label .
  ?project <ems:Effort_status> <ems:EffortStatusDoing> .
}
```

### Example 3: Check if Any Task Exists

```exoql
ASK WHERE {
  ?s a <ems:Task> .
}
```

### Example 4: Count Tasks per Status

```exoql
SELECT ?status (COUNT(?task) AS ?count)
WHERE {
  ?task a <ems:Task> .
  ?task <ems:Effort_status> ?status .
}
GROUP BY ?status
```

### Example 5: Tasks with a Specific Label (FILTER)

```exoql
SELECT ?task ?label
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  FILTER(CONTAINS(?label, "Review"))
}
```

### Example 6: Construct a Simplified Task View

```exoql
CONSTRUCT {
  ?task <ex:name> ?label .
  ?task <ex:status> ?status .
}
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_status> ?status .
}
```

### Example 7: Own Properties Only (Programmatic)

```typescript
import { ExoQL } from "exocortex";

// Get only directly asserted properties (no inherited ones)
const ownProps = await ExoQL.queryOwn(
  `SELECT ?s ?p ?o WHERE {
     ?s a <ems:Task> .
     ?s ?p ?o .
   }`,
  store,
);
```

### Example 8: Tasks with Optional Description

```exoql
SELECT ?task ?label ?desc
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  OPTIONAL { ?task <exo:Asset_description> ?desc }
}
```

### Example 9: UNION of Projects and Tasks

```exoql
SELECT ?asset ?label ?type
WHERE {
  {
    ?asset a <ems:Project> .
    BIND("Project" AS ?type)
  }
  UNION
  {
    ?asset a <ems:Task> .
    BIND("Task" AS ?type)
  }
  ?asset <exo:Asset_label> ?label .
}
```

### Example 10: Paginated Results

```exoql
SELECT ?task ?label
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
}
ORDER BY ?label
LIMIT 20
OFFSET 40
```

### Example 11: Check Single Triple Provenance (Programmatic)

```typescript
import { ExoQL, IRI, Literal } from "exocortex";

const isOwn = await ExoQL.isOwn(
  new IRI("https://exocortex.my/assets/task-123"),
  new IRI("https://exocortex.my/ontology/ems#Effort_status"),
  new IRI("https://exocortex.my/ontology/ems#EffortStatusDoing"),
  store,
);

if (isOwn) {
  console.log("Status was set directly on this task");
} else {
  console.log("Status was inherited from prototype");
}
```

---

## 10. Internals (Reference)

### 10.1 Pipeline

```
SPARQL string
    |
    v
SPARQLParser        -- parse to AST
    |
    v
AlgebraTranslator   -- AST to algebraic IR
    |
    v
AlgebraOptimizer    -- filter pushdown, BGP reordering (optional)
    |
    v
QueryExecutor       -- evaluate against ITripleStore
    |
    v
SourceAnnotator     -- annotate own/inherited (optional, for queryOwn)
    |
    v
SolutionMapping[]   -- result bindings
```

### 10.2 Key Interfaces

| Interface         | Package           | Purpose                                                         |
| ----------------- | ----------------- | --------------------------------------------------------------- |
| `ITripleStore`    | `@exocortex/core` | Abstract triple store with `match()`, `add()`, `matchInGraph()` |
| `SolutionMapping` | `@exocortex/core` | Variable bindings from SELECT execution                         |
| `Triple`          | `@exocortex/core` | Subject-Predicate-Object triple                                 |
| `OwnFilterConfig` | `@exocortex/core` | Variable name mapping for `queryOwn()`                          |

### 10.3 Named Graph for Inheritance

The `PrototypeChainMaterializer` service populates the `exo:inferred` named graph during vault indexing. This graph is the sole mechanism for distinguishing own vs inherited properties at query time.

```
IRI: https://exocortex.my/ontology/exo#inferred
```
