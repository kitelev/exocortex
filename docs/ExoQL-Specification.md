# ExoQL Specification

> **Version**: 2.0 (RFC-013)  
> **Status**: Living document  
> **Audience**: Developers, AI agents, plugin users

---

## 1. Overview

ExoQL is the query language of the Exocortex knowledge management system. It is a superset of **SPARQL 1.1** extended with Exocortex-specific capabilities for working with ontology-driven knowledge graphs stored in Obsidian vaults.

### 1.1 Relationship to SPARQL

ExoQL accepts any valid SPARQL 1.1 query and adds the following extensions:

| Extension                 | Purpose                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| OWN() filter              | Distinguish own (directly asserted) vs inherited (prototype-materialized) properties |
| `_source` annotation      | Automatic provenance binding (`"own"` or `"inherited"`) on query results             |
| `exoql` code block        | Vault-native query rendering alongside the existing `sparql` code block              |
| CLI alias                 | `exoql` primary command with `sparql` as a deprecated alias                          |
| Auto-prefix injection     | Exocortex ontology prefixes injected automatically into queries                      |
| Property paths            | Full SPARQL 1.1 property path support with 6 operators (RFC-013)                     |
| Temporal functions        | Exocortex-specific date/time helper functions (RFC-013)                              |
| Temporal variables        | Pre-computed date boundaries like `$yesterday`, `$thisWeekStart` (RFC-013)           |
| Subqueries                | Nested SELECT queries and LATERAL correlated subqueries (RFC-013)                    |
| Multi-hop prototype chain | BFS-based inheritance with depth annotation and closest-wins semantics (RFC-013)     |

### 1.2 Design Principles

1. **Backward compatible** -- every existing `sparql` query works unchanged under `exoql`.
2. **Prototype-aware** -- first-class support for the Exocortex prototype chain (inherited properties).
3. **Multi-surface** -- identical semantics across Obsidian code blocks, CLI, and programmatic API.
4. **Temporal-first** -- built-in functions and variables for knowledge work that is inherently temporal.

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

---

## 11. Property Paths (RFC-013)

ExoQL supports the full SPARQL 1.1 property path specification, enabling traversal of complex graph patterns without explicit intermediate variables.

### 11.1 Operators

| Operator | Name        | Syntax   | Description                                     |
| -------- | ----------- | -------- | ----------------------------------------------- |
| `/`      | Sequence    | `a / b`  | Match predicate `a` then predicate `b` in order |
| `\|`     | Alternative | `a \| b` | Match predicate `a` or predicate `b`            |
| `^`      | Inverse     | `^a`     | Traverse predicate `a` in reverse direction     |
| `+`      | OneOrMore   | `a+`     | Transitive closure of `a`, at least one step    |
| `*`      | ZeroOrMore  | `a*`     | Transitive closure of `a`, including zero steps |
| `?`      | ZeroOrOne   | `a?`     | Optional single step along `a`                  |

### 11.2 Sequence Path (`/`)

Matches a chain of predicates in order, useful for multi-hop traversal without intermediate variables.

```exoql
# Find the area that a task belongs to (task -> project -> area)
SELECT ?task ?area
WHERE {
  ?task a <ems:Task> .
  ?task <ems:Effort_project> / <ems:Project_area> ?area .
}
```

Equivalent verbose form (without property paths):

```exoql
SELECT ?task ?area
WHERE {
  ?task a <ems:Task> .
  ?task <ems:Effort_project> ?project .
  ?project <ems:Project_area> ?area .
}
```

### 11.3 Alternative Path (`|`)

Matches any of the specified predicates.

```exoql
# Find assets with either a label or a title
SELECT ?asset ?name
WHERE {
  ?asset (<exo:Asset_label> | <exo:Asset_title>) ?name .
}
```

### 11.4 Inverse Path (`^`)

Reverses the direction of traversal. Instead of matching `?s predicate ?o`, it matches `?o predicate ?s`.

```exoql
# Find all tasks that belong to a specific project (reverse lookup)
SELECT ?task ?label
WHERE {
  <http://example.org/project-1> ^<ems:Effort_project> ?task .
  ?task <exo:Asset_label> ?label .
}
```

### 11.5 OneOrMore Path (`+`)

Transitive closure requiring at least one step. Follows a predicate recursively until no more matches are found.

```exoql
# Find all ancestors in a prototype chain (at least one step)
SELECT ?instance ?ancestor
WHERE {
  ?instance <exo:Asset_prototype>+ ?ancestor .
}
```

### 11.6 ZeroOrMore Path (`*`)

Transitive closure including zero steps (the node itself).

```exoql
# Find the node itself and all its ancestors
SELECT ?node ?reachable
WHERE {
  ?node <exo:Asset_prototype>* ?reachable .
}
```

### 11.7 ZeroOrOne Path (`?`)

Matches either zero or one step along the predicate.

```exoql
# Find task and optionally its project (if linked)
SELECT ?task ?projectOrSelf
WHERE {
  ?task a <ems:Task> .
  ?task <ems:Effort_project>? ?projectOrSelf .
}
```

### 11.8 Nested Paths

Operators can be combined to express complex traversals.

```exoql
# Find all labels reachable through either direct or inherited links
SELECT ?node ?label
WHERE {
  ?node (<exo:Asset_prototype>* / <exo:Asset_label>) ?label .
}
```

### 11.9 Implementation Notes

- Maximum traversal depth for `+` and `*` operators is **100** to prevent infinite loops in cyclic graphs.
- Property paths are evaluated by `PropertyPathExecutor` and can be combined with existing solution bindings.
- Nested paths (e.g., `(^a / b)+`) are fully supported via recursive evaluation.

---

## 12. Temporal Functions (RFC-013)

ExoQL provides temporal functions for date and time calculations common in knowledge management workflows (tracking effort durations, comparing timestamps, filtering by date ranges).

### 12.1 Date Difference Functions

| Function                            | Return type | Description                                           |
| ----------------------------------- | ----------- | ----------------------------------------------------- |
| `exo:dateDiffMinutes(date1, date2)` | integer     | Absolute difference between two timestamps in minutes |
| `exo:dateDiffHours(date1, date2)`   | decimal     | Absolute difference between two timestamps in hours   |

**Example: Calculate effort duration in minutes**

```exoql
SELECT ?task ?label ?durationMin
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_startTimestamp> ?start .
  ?task <ems:Effort_endTimestamp> ?end .
  BIND(exo:dateDiffMinutes(?start, ?end) AS ?durationMin)
}
ORDER BY DESC(?durationMin)
```

**Example: Calculate effort duration in hours**

```exoql
SELECT ?task ?label ?durationHrs
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_startTimestamp> ?start .
  ?task <ems:Effort_endTimestamp> ?end .
  BIND(exo:dateDiffHours(?start, ?end) AS ?durationHrs)
  FILTER(?durationHrs > 2)
}
```

### 12.2 Date Comparison Functions

| Function                                      | Return type | Description                                          |
| --------------------------------------------- | ----------- | ---------------------------------------------------- |
| `exo:dateBefore(date1, date2)`                | boolean     | True if `date1` is chronologically before `date2`    |
| `exo:dateAfter(date1, date2)`                 | boolean     | True if `date1` is chronologically after `date2`     |
| `exo:dateInRange(date, rangeStart, rangeEnd)` | boolean     | True if `date` falls within `[rangeStart, rangeEnd]` |

**Example: Find tasks started this month**

```exoql
SELECT ?task ?label ?start
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_startTimestamp> ?start .
  FILTER(exo:dateInRange(?start, "2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z"))
}
```

### 12.3 Date/Time Accessor Functions

Standard SPARQL 1.1 accessors are supported, with additional overloading for duration types.

| Function      | Operand types                           | Description                           |
| ------------- | --------------------------------------- | ------------------------------------- |
| `YEAR(v)`     | `xsd:dateTime`, `xsd:yearMonthDuration` | Year component                        |
| `MONTH(v)`    | `xsd:dateTime`, `xsd:yearMonthDuration` | Month component (1-12)                |
| `DAY(v)`      | `xsd:dateTime`, `xsd:dayTimeDuration`   | Day component (1-31 or duration days) |
| `HOURS(v)`    | `xsd:dateTime`, `xsd:dayTimeDuration`   | Hours component (0-23)                |
| `MINUTES(v)`  | `xsd:dateTime`, `xsd:dayTimeDuration`   | Minutes component (0-59)              |
| `SECONDS(v)`  | `xsd:dateTime`, `xsd:dayTimeDuration`   | Seconds component (0-59, decimal)     |
| `TIMEZONE(v)` | `xsd:dateTime`                          | Timezone as `xsd:dayTimeDuration`     |
| `TZ(v)`       | `xsd:dateTime`                          | Timezone as string (e.g., `"+05:00"`) |
| `NOW()`       | --                                      | Current dateTime as ISO string        |

### 12.4 Date/Time Arithmetic

ExoQL supports arithmetic on date, dateTime, time, and duration types via standard SPARQL operators.

| Expression                                        | Result type             | Example                                  |
| ------------------------------------------------- | ----------------------- | ---------------------------------------- |
| `xsd:date - xsd:date`                             | `xsd:dayTimeDuration`   | `"2026-04-06" - "2026-03-23"` = `"P14D"` |
| `xsd:dateTime - xsd:dateTime`                     | `xsd:dayTimeDuration`   | Difference including time component      |
| `xsd:time - xsd:time`                             | `xsd:dayTimeDuration`   | `"14:30:00" - "10:00:00"` = `"PT4H30M"`  |
| `xsd:date +/- xsd:dayTimeDuration`                | `xsd:date`              | Date shifted by days                     |
| `xsd:date +/- xsd:yearMonthDuration`              | `xsd:date`              | Date shifted by months/years             |
| `xsd:dateTime +/- xsd:dayTimeDuration`            | `xsd:dateTime`          | DateTime shifted by duration             |
| `xsd:dateTime +/- xsd:yearMonthDuration`          | `xsd:dateTime`          | DateTime shifted by months/years         |
| `xsd:dayTimeDuration +/- xsd:dayTimeDuration`     | `xsd:dayTimeDuration`   | Duration sum/difference                  |
| `xsd:yearMonthDuration +/- xsd:yearMonthDuration` | `xsd:yearMonthDuration` | YearMonth duration sum/difference        |
| `xsd:dayTimeDuration * number`                    | `xsd:dayTimeDuration`   | Duration scaled                          |
| `xsd:dayTimeDuration / number`                    | `xsd:dayTimeDuration`   | Duration divided                         |

### 12.5 Duration Conversion Functions

| Function                 | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `durationToDays(dur)`    | Total days as decimal from `xsd:dayTimeDuration` |
| `durationToHours(dur)`   | Total hours as decimal                           |
| `durationToMinutes(dur)` | Total minutes as decimal                         |
| `durationToSeconds(dur)` | Total seconds as decimal                         |
| `msToMinutes(ms)`        | Milliseconds to minutes                          |
| `msToHours(ms)`          | Milliseconds to hours                            |
| `msToSeconds(ms)`        | Milliseconds to seconds                          |

### 12.6 Type Casting Functions

| Function                   | Description                                  |
| -------------------------- | -------------------------------------------- |
| `xsd:dateTime(str)`        | Cast string to `xsd:dateTime` Literal        |
| `xsd:integer(str)`         | Cast string to `xsd:integer` Literal         |
| `xsd:decimal(str)`         | Cast string to `xsd:decimal` Literal         |
| `xsd:dayTimeDuration(str)` | Cast string to `xsd:dayTimeDuration` Literal |

### 12.7 ADJUST Function (SPARQL 1.2)

Adjusts a dateTime to a target timezone while preserving the instant in time.

```exoql
# Convert UTC timestamp to UTC+5 (Almaty)
SELECT ?task ?label ?localTime
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_startTimestamp> ?utcTime .
  BIND(ADJUST(?utcTime, "PT5H") AS ?localTime)
}
```

---

## 13. Temporal Variables (RFC-013)

ExoQL provides pre-computed temporal variables that resolve to date boundaries at query execution time. These eliminate the need for manual date string construction in common temporal filters.

### 13.1 Available Variables

| Variable          | Resolves to                           | Example value (on 2026-04-06) |
| ----------------- | ------------------------------------- | ----------------------------- |
| `$yesterday`      | Start of yesterday (00:00:00Z)        | `"2026-04-05T00:00:00Z"`      |
| `$thisWeekStart`  | Monday 00:00:00Z of current week      | `"2026-04-06T00:00:00Z"`      |
| `$lastWeekStart`  | Monday 00:00:00Z of previous week     | `"2026-03-30T00:00:00Z"`      |
| `$thisMonthStart` | First day 00:00:00Z of current month  | `"2026-04-01T00:00:00Z"`      |
| `$lastMonthStart` | First day 00:00:00Z of previous month | `"2026-03-01T00:00:00Z"`      |
| `$thisYearStart`  | January 1 00:00:00Z of current year   | `"2026-01-01T00:00:00Z"`      |

### 13.2 Usage in Queries

Temporal variables are substituted before query parsing, so they can appear anywhere a date literal is expected.

**Example: Tasks completed this week**

```exoql
SELECT ?task ?label ?end
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_endTimestamp> ?end .
  ?task <ems:Effort_status> <ems:EffortStatusDone> .
  FILTER(?end >= $thisWeekStart)
}
ORDER BY ?end
```

**Example: Effort logged last month**

```exoql
SELECT ?task ?label ?start ?end
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_startTimestamp> ?start .
  ?task <ems:Effort_endTimestamp> ?end .
  FILTER(?start >= $lastMonthStart && ?start < $thisMonthStart)
}
```

### 13.3 Semantics

- Variables use **UTC** timezone with explicit `Z` suffix.
- Week boundaries use **ISO 8601** convention (Monday as first day of week).
- Variables are resolved **once** at the start of query execution (stable within a single query).
- Unknown variable names are left as-is (no error) for forward compatibility.

---

## 14. Multi-hop Prototype Chain (RFC-013)

The prototype chain enables property inheritance across a chain of linked assets. RFC-013 extends this to support multi-hop traversal with depth tracking and deterministic resolution.

### 14.1 Concept

An asset can declare a prototype via the `exo:Asset_prototype` property. The `PrototypeChainMaterializer` resolves the full chain and copies inheritable properties to the instance.

```
TaskInstance --prototype--> WeeklyTemplate --prototype--> MasterTemplate
```

If `MasterTemplate` defines `area = "Health"` and `WeeklyTemplate` defines `project = "Exercise"`, then `TaskInstance` inherits both:

- `project = "Exercise"` (from depth 1, the direct prototype)
- `area = "Health"` (from depth 2, the grandparent prototype)

### 14.2 Closest-Wins Semantics

When multiple prototypes in the chain define the same predicate, the **nearest** prototype's value wins.

```
Instance --proto--> Proto1 (status = "Doing") --proto--> Proto2 (status = "Backlog")
```

Result: Instance inherits `status = "Doing"` from Proto1 (depth 1). Proto2's value is shadowed.

### 14.3 Depth Annotation

Each materialized triple is recorded in depth-specific named graphs:

| Named Graph IRI  | Meaning                         |
| ---------------- | ------------------------------- |
| `exo:inferred`   | Union of all inherited triples  |
| `exo:inferred/1` | Inherited from direct prototype |
| `exo:inferred/2` | Inherited from grandparent      |
| `exo:inferred/N` | Inherited from depth N          |

This enables queries that distinguish inheritance depth:

```exoql
# Find properties inherited from the direct prototype only (depth 1)
SELECT ?s ?p ?o
WHERE {
  GRAPH <exo:inferred/1> { ?s ?p ?o }
}
```

### 14.4 Chain Resolution

- **Algorithm**: BFS traversal from instance through prototype links.
- **Cycle detection**: Visited set prevents infinite loops from circular prototype references.
- **Self-cycle detection**: An asset pointing to itself as prototype is skipped.
- **Maximum depth**: 10 hops (`MAX_PROTOTYPE_DEPTH`). Chains exceeding this limit are truncated.
- **Non-inheritable properties**: Certain predicates (e.g., `exo:Asset_prototype` itself, `rdf:type`) are never inherited.

### 14.5 Querying Inherited vs Own Properties

```exoql
# Get all own (directly asserted) properties of a task
SELECT ?p ?o
WHERE {
  <http://example.org/task-1> ?p ?o .
  FILTER NOT EXISTS {
    GRAPH <exo:inferred> { <http://example.org/task-1> ?p ?o }
  }
}
```

```exoql
# Get only inherited properties
SELECT ?p ?o
WHERE {
  GRAPH <exo:inferred> { <http://example.org/task-1> ?p ?o }
}
```

---

## 15. Subqueries (RFC-013)

ExoQL supports nested SELECT queries (subqueries) and correlated LATERAL subqueries for complex query patterns.

### 15.1 Standard Subqueries

A subquery is a complete SELECT query nested inside an outer query's WHERE clause. The inner query executes independently and its results are joined with the outer query.

```exoql
# Find the top-3 most active projects (by task count) and their labels
SELECT ?project ?label ?taskCount
WHERE {
  ?project a <ems:Project> .
  ?project <exo:Asset_label> ?label .
  {
    SELECT ?project (COUNT(?task) AS ?taskCount)
    WHERE {
      ?task a <ems:Task> .
      ?task <ems:Effort_project> ?project .
    }
    GROUP BY ?project
  }
}
ORDER BY DESC(?taskCount)
LIMIT 3
```

### 15.2 Subquery Variable Scoping

Variables in a subquery are independent of the outer query. Only variables explicitly projected in the inner SELECT are visible to the outer query.

```exoql
# Inner query projects ?project and ?avgDuration; outer query can use both
SELECT ?project ?label ?avgDuration
WHERE {
  ?project <exo:Asset_label> ?label .
  {
    SELECT ?project (AVG(?dur) AS ?avgDuration)
    WHERE {
      ?task <ems:Effort_project> ?project .
      ?task <ems:Effort_startTimestamp> ?start .
      ?task <ems:Effort_endTimestamp> ?end .
      BIND(exo:dateDiffMinutes(?start, ?end) AS ?dur)
    }
    GROUP BY ?project
  }
}
```

### 15.3 LATERAL Subqueries (SPARQL 1.2)

LATERAL enables **correlated** subqueries where the inner query can reference variables bound by the outer query. The inner query is re-executed for each solution from the outer query.

```exoql
# For each project, find its most recently completed task
SELECT ?project ?projectLabel ?latestTask ?taskLabel
WHERE {
  ?project a <ems:Project> .
  ?project <exo:Asset_label> ?projectLabel .
  LATERAL {
    SELECT ?latestTask ?taskLabel
    WHERE {
      ?latestTask a <ems:Task> .
      ?latestTask <ems:Effort_project> ?project .
      ?latestTask <exo:Asset_label> ?taskLabel .
      ?latestTask <ems:Effort_status> <ems:EffortStatusDone> .
      ?latestTask <ems:Effort_endTimestamp> ?endTime .
    }
    ORDER BY DESC(?endTime)
    LIMIT 1
  }
}
```

### 15.4 LATERAL vs Standard Subqueries

| Feature             | Standard subquery                | LATERAL subquery                    |
| ------------------- | -------------------------------- | ----------------------------------- |
| Execution model     | Independent, then joined         | Re-executed per outer solution      |
| Variable visibility | Inner cannot see outer variables | Inner **can** see outer variables   |
| Use case            | Aggregation, independent filters | Top-N per group, correlated lookups |
| Keyword             | `{ SELECT ... }`                 | `LATERAL { SELECT ... }`            |

### 15.5 EXISTS and NOT EXISTS

Filter-level subpatterns for existence checks.

```exoql
# Tasks with no end timestamp (still in progress)
SELECT ?task ?label
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_status> <ems:EffortStatusDoing> .
  FILTER NOT EXISTS { ?task <ems:Effort_endTimestamp> ?end }
}
```

---

## 16. Additional Example Queries (RFC-013)

### Example 12: Prototype Chain Traversal via Property Paths

```exoql
# Walk the prototype chain to find all ancestors of a task template
SELECT ?template ?ancestor ?ancestorLabel
WHERE {
  ?template a <ems:Task> .
  ?template <exo:Asset_label> "Weekly Review" .
  ?template <exo:Asset_prototype>+ ?ancestor .
  ?ancestor <exo:Asset_label> ?ancestorLabel .
}
```

### Example 13: Weekly Effort Report with Temporal Functions

```exoql
SELECT ?task ?label ?durationHrs
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_startTimestamp> ?start .
  ?task <ems:Effort_endTimestamp> ?end .
  FILTER(?start >= $thisWeekStart)
  BIND(exo:dateDiffHours(?start, ?end) AS ?durationHrs)
}
ORDER BY DESC(?durationHrs)
```

### Example 14: Top Task per Project using LATERAL

```exoql
SELECT ?project ?projectLabel ?topTask ?taskLabel ?hours
WHERE {
  ?project a <ems:Project> .
  ?project <exo:Asset_label> ?projectLabel .
  LATERAL {
    SELECT ?topTask ?taskLabel ?hours
    WHERE {
      ?topTask a <ems:Task> .
      ?topTask <ems:Effort_project> ?project .
      ?topTask <exo:Asset_label> ?taskLabel .
      ?topTask <ems:Effort_startTimestamp> ?s .
      ?topTask <ems:Effort_endTimestamp> ?e .
      BIND(exo:dateDiffHours(?s, ?e) AS ?hours)
    }
    ORDER BY DESC(?hours)
    LIMIT 1
  }
}
```

### Example 15: Find Assets via Alternative Predicates

```exoql
# Find anything that has a label or title, regardless of type
SELECT ?asset ?name ?type
WHERE {
  ?asset (<exo:Asset_label> | <exo:Asset_title>) ?name .
  ?asset a ?type .
  FILTER(?type IN (<ems:Task>, <ems:Project>, <ems:Area>))
}
ORDER BY ?type ?name
```

### Example 16: Tasks Completed Yesterday with Duration

```exoql
SELECT ?task ?label ?durationMin
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> ?label .
  ?task <ems:Effort_status> <ems:EffortStatusDone> .
  ?task <ems:Effort_endTimestamp> ?end .
  ?task <ems:Effort_startTimestamp> ?start .
  FILTER(?end >= $yesterday && ?end < $thisWeekStart)
  BIND(exo:dateDiffMinutes(?start, ?end) AS ?durationMin)
}
ORDER BY DESC(?durationMin)
```

### Example 17: Depth-Aware Inheritance Query

```exoql
# Show which properties are inherited and from what depth
SELECT ?task ?predicate ?value ?depth
WHERE {
  ?task a <ems:Task> .
  ?task <exo:Asset_label> "My Task Instance" .
  {
    GRAPH <exo:inferred/1> { ?task ?predicate ?value }
    BIND(1 AS ?depth)
  }
  UNION
  {
    GRAPH <exo:inferred/2> { ?task ?predicate ?value }
    BIND(2 AS ?depth)
  }
}
ORDER BY ?depth ?predicate
```

### Example 18: Subquery with Aggregation -- Monthly Task Summary

```exoql
SELECT ?project ?label ?totalTasks ?completedTasks
WHERE {
  ?project a <ems:Project> .
  ?project <exo:Asset_label> ?label .
  {
    SELECT ?project (COUNT(?task) AS ?totalTasks)
    WHERE {
      ?task a <ems:Task> .
      ?task <ems:Effort_project> ?project .
      ?task <ems:Effort_startTimestamp> ?start .
      FILTER(?start >= $thisMonthStart)
    }
    GROUP BY ?project
  }
  {
    SELECT ?project (COUNT(?done) AS ?completedTasks)
    WHERE {
      ?done a <ems:Task> .
      ?done <ems:Effort_project> ?project .
      ?done <ems:Effort_status> <ems:EffortStatusDone> .
      ?done <ems:Effort_endTimestamp> ?end .
      FILTER(?end >= $thisMonthStart)
    }
    GROUP BY ?project
  }
}
ORDER BY DESC(?totalTasks)
```
