# SPARQL User Guide for Exocortex

Welcome to the SPARQL User Guide for Exocortex! This guide will teach you how to query your Obsidian vault using SPARQL, the powerful semantic query language for RDF data.

## Table of Contents

1. [Introduction to SPARQL in Exocortex](#introduction-to-sparql-in-exocortex)
2. [Basic Queries](#basic-queries)
3. [Filtering and Conditions](#filtering-and-conditions)
4. [Working with Obsidian Properties](#working-with-obsidian-properties)
5. [Aggregations and Grouping](#aggregations-and-grouping)
6. [Graph Construction](#graph-construction)
7. [Advanced Features (v2)](#advanced-features-v2)
8. [Performance Best Practices](#performance-best-practices)
9. [Common Pitfalls and Solutions](#common-pitfalls-and-solutions)
10. [Security Considerations for Hash Functions](#security-considerations-for-hash-functions)

---

## Introduction to SPARQL in Exocortex

### What is SPARQL?

SPARQL (SPARQL Protocol and RDF Query Language) is a standardized query language for RDF (Resource Description Framework) data. It allows you to search, retrieve, and manipulate structured knowledge represented as triples (subject-predicate-object).

### Why SPARQL in Obsidian?

Exocortex converts your Obsidian notes into RDF triples, enabling:

- **Semantic Queries**: Ask complex questions about relationships between notes
- **Knowledge Discovery**: Find hidden patterns and connections in your vault
- **Dynamic Views**: Generate live reports that update automatically
- **Data Export**: Export structured data for analysis or visualization

### Triple Structure

Every note in your vault becomes a set of RDF triples:

```
<note-path> <property> "value"
```

For example, a task note becomes:

```turtle
<vault://Projects/My-Task.md> <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
<vault://Projects/My-Task.md> <https://exocortex.my/ontology/exo#Asset_label> "My Task" .
<vault://Projects/My-Task.md> <https://exocortex.my/ontology/ems#Task_status> "in-progress" .
```

### How to Write SPARQL Queries in Obsidian

Create a code block with `sparql` language identifier:

````markdown
```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```
````

The results will appear live in your note and update automatically when your vault changes!

---

## Basic Queries

### SELECT Queries

SELECT queries retrieve specific variables from your data.

#### Basic Pattern: All Tasks

```sparql
SELECT ?task
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
}
```

**Explanation**:
- `SELECT ?task` - Return the `?task` variable
- `WHERE { ... }` - Pattern to match
- Variables start with `?` (e.g., `?task`, `?label`)

#### Multiple Variables: Tasks with Labels

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

**Result**:

| task | label |
|------|-------|
| `vault://Tasks/Write-Report.md` | "Write Report" |
| `vault://Tasks/Review-Code.md` | "Review Code" |

#### Wildcard Pattern: All Triples

```sparql
SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
```

**Warning**: This returns ALL triples in your vault. Use `LIMIT` to avoid overwhelming results.

### LIMIT and OFFSET

Control result size:

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
LIMIT 10
```

Pagination:

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
LIMIT 10
OFFSET 20
```

### DISTINCT Results

Remove duplicates:

```sparql
SELECT DISTINCT ?status
WHERE {
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
}
```

**Result**: Unique list of all task statuses in your vault.

---

## Filtering and Conditions

### FILTER Clause

Filter results based on conditions:

#### String Matching

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER(regex(?label, "report", "i"))
}
```

**Explanation**:
- `regex(?label, "report", "i")` - Case-insensitive regex match
- Finds all tasks with "report" in their label

#### Numeric Comparisons

```sparql
SELECT ?task ?votes
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  FILTER(?votes > 5)
}
```

**Operators**:
- `>`, `<`, `>=`, `<=` - Numeric comparisons
- `=`, `!=` - Equality/inequality
- `&&`, `||`, `!` - Logical operators

#### Multiple Conditions

```sparql
SELECT ?task ?label ?status
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
  FILTER(?status = "in-progress" || ?status = "backlog")
  FILTER(regex(?label, "urgent", "i"))
}
```

### OPTIONAL Patterns

Match optional properties:

```sparql
SELECT ?task ?label ?priority
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  OPTIONAL {
    ?task <https://exocortex.my/ontology/ems#Task_priority> ?priority .
  }
}
```

**Result**: Includes tasks even if they don't have a `priority` property (will show `null` or empty).

### UNION Patterns

Match either pattern:

```sparql
SELECT ?asset ?label
WHERE {
  {
    ?asset <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  } UNION {
    ?asset <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  }
  ?asset <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

**Result**: All tasks and projects in your vault.

---

## Working with Obsidian Properties

### Property Namespaces

Exocortex uses two main property namespaces:

1. **`exo__`** - Core Exocortex properties (e.g., `exo__Asset_label`, `exo__Instance_class`)
2. **`ems__`** - Entity Model Schema classes (e.g., `ems__Task`, `ems__Project`, `ems__Area`)

**Full URIs**:
```
exo__Asset_label → <https://exocortex.my/ontology/exo#Asset_label>
ems__Task → "ems__Task"
```

### Common Properties

#### Core Asset Properties

```sparql
SELECT ?asset ?label ?class ?archived
WHERE {
  ?asset <https://exocortex.my/ontology/exo#Instance_class> ?class .
  ?asset <https://exocortex.my/ontology/exo#Asset_label> ?label .
  OPTIONAL {
    ?asset <https://exocortex.my/ontology/exo#Asset_archived> ?archived .
  }
}
```

**Properties**:
- `exo__Asset_label` - Display name
- `exo__Instance_class` - Entity type (Task, Project, Area)
- `exo__Asset_archived` - Archival status

#### Task-Specific Properties

```sparql
SELECT ?task ?label ?status ?priority ?votes
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  OPTIONAL { ?task <https://exocortex.my/ontology/ems#Task_status> ?status . }
  OPTIONAL { ?task <https://exocortex.my/ontology/ems#Task_priority> ?priority . }
  OPTIONAL { ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes . }
}
```

**Properties**:
- `exo__Task_status` - Task status (backlog, in-progress, done, archived)
- `exo__Task_priority` - Priority level
- `ems__Effort_votes` - Effort voting count

#### Relationship Properties

```sparql
SELECT ?task ?project ?area
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  OPTIONAL {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  }
  OPTIONAL {
    ?project <https://exocortex.my/ontology/ems#belongs_to_area> ?area .
  }
}
```

**Properties**:
- `belongs_to_project` - Task → Project relationship
- `belongs_to_area` - Project → Area relationship

### Finding Active (Non-Archived) Assets

```sparql
SELECT ?asset ?label
WHERE {
  ?asset <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?asset <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER NOT EXISTS {
    ?asset <https://exocortex.my/ontology/exo#Asset_archived> ?archived .
    FILTER(?archived = true || ?archived = "true" || ?archived = "archived")
  }
}
```

**Explanation**: Filters out assets with archived property set to `true` or `"archived"`.

---

## Aggregations and Grouping

### COUNT - Count Results

```sparql
SELECT (COUNT(?task) AS ?taskCount)
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
}
```

**Result**: Total number of tasks.

### GROUP BY - Grouping

```sparql
SELECT ?status (COUNT(?task) AS ?count)
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
}
GROUP BY ?status
```

**Result**:

| status | count |
|--------|-------|
| "backlog" | 15 |
| "in-progress" | 7 |
| "done" | 42 |

### SUM - Total Values

```sparql
SELECT ?project (SUM(?votes) AS ?totalVotes)
WHERE {
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
}
GROUP BY ?project
```

**Result**: Total effort votes per project.

### HAVING - Filter Groups

```sparql
SELECT ?project (COUNT(?task) AS ?taskCount)
WHERE {
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
}
GROUP BY ?project
HAVING (COUNT(?task) > 5)
```

**Result**: Only projects with more than 5 tasks.

### Multiple Aggregations

```sparql
SELECT ?status
       (COUNT(?task) AS ?taskCount)
       (SUM(?votes) AS ?totalVotes)
       (AVG(?votes) AS ?avgVotes)
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
}
GROUP BY ?status
```

**Functions**:
- `COUNT()` - Count items
- `SUM()` - Sum numeric values
- `AVG()` - Average values
- `MIN()`, `MAX()` - Min/max values

---

## Using Standard RDF/RDFS Vocabulary

Exocortex maps its custom ExoRDF properties to W3C standard RDF/RDFS vocabulary, enabling semantic web interoperability and inference.

### Standard Predicates Supported

| ExoRDF Property | RDF/RDFS Equivalent | Example |
|----------------|---------------------|------------|
| exo__Instance_class | rdf:type | ?asset rdf:type ems:Task |
| exo__Asset_isDefinedBy | rdfs:isDefinedBy | ?asset rdfs:isDefinedBy <ontology> |
| exo__Class_superClass | rdfs:subClassOf | ?class rdfs:subClassOf exo:Asset |
| exo__Property_range | rdfs:range | ?property rdfs:range xsd:string |
| exo__Property_domain | rdfs:domain | ?property rdfs:domain ems:Task |
| exo__Property_superProperty | rdfs:subPropertyOf | ?prop rdfs:subPropertyOf rdf:type |

### Query All Assets Using Class Hierarchy

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?type ?label
WHERE {
  ?asset rdf:type ?type .
  ?type rdfs:subClassOf* exo:Asset .
  ?asset exo:Asset_label ?label .
}
ORDER BY ?type ?label
```

This query returns ALL assets (tasks, projects, areas) by leveraging the rdfs:subClassOf* transitive property. The * means "zero or more" subclass relationships.

### Benefits of Standard Vocabulary

1. **Semantic Interoperability** - Queries work with any RDF tool
2. **Inference** - Automatic reasoning over class hierarchies
3. **Standardization** - Well-known predicates, better tooling
4. **Compatibility** - Export data to other semantic web systems

---

## Graph Construction

### CONSTRUCT Queries

CONSTRUCT queries create new RDF triples instead of returning table results.

#### Basic CONSTRUCT

```sparql
CONSTRUCT {
  ?task <http://exocortex.ai/ontology#has_label> ?label .
}
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

**Result**: Returns triples (subject-predicate-object) instead of table rows.

#### Creating Inferred Relationships

```sparql
CONSTRUCT {
  ?task <http://exocortex.ai/ontology#in_area> ?area .
}
WHERE {
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  ?project <https://exocortex.my/ontology/ems#belongs_to_area> ?area .
}
```

**Result**: Directly links tasks to their areas (skipping intermediate project).

#### Transforming Data

```sparql
CONSTRUCT {
  ?task <http://example.org/priority_level> ?priorityClass .
}
WHERE {
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  BIND(
    IF(?votes > 10, "high",
      IF(?votes > 5, "medium", "low")
    ) AS ?priorityClass
  )
}
```

**Result**: Classifies tasks into priority levels based on votes.

### Export to Turtle Format

CONSTRUCT results can be exported as Turtle (`.ttl`) files using the export button in the query result viewer.

---

## Advanced Features (v2)

SPARQL Engine v2 adds several powerful features for complex queries.

### BIND Expressions

BIND creates new variable bindings from expressions.

#### Basic BIND

```sparql
SELECT ?task ?label ?displayLabel
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  BIND(CONCAT("Task: ", ?label) AS ?displayLabel)
}
```

**Key Points**:
- BIND appears within the WHERE clause
- The bound variable can be used in later patterns
- Use for computed values, type conversions, and formatting

#### BIND with IF

Create conditional values:

```sparql
SELECT ?task ?votes ?urgency
WHERE {
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  BIND(IF(?votes > 5, "urgent", "normal") AS ?urgency)
}
```

**Supported Functions in BIND**:
- String: `CONCAT()`, `STR()`, `STRLEN()`, `UCASE()`, `LCASE()`, `REPLACE()`
- Numeric: `+`, `-`, `*`, `/`, `ABS()`, `ROUND()`, `CEIL()`, `FLOOR()`
- Conditional: `IF()`, `COALESCE()`, `BOUND()`
- Type: `DATATYPE()`, `LANG()`, `IRI()`, `BNODE()`

---

### EXISTS and NOT EXISTS

Test for pattern existence without binding variables.

#### EXISTS

Check if a pattern exists:

```sparql
SELECT ?project ?label
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER EXISTS {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
    ?task <https://exocortex.my/ontology/ems#Task_status> "in-progress" .
  }
}
```

**Result**: Projects with at least one in-progress task.

#### NOT EXISTS

Check if a pattern does NOT exist:

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER NOT EXISTS {
    ?task <https://exocortex.my/ontology/exo#Asset_archived> "true" .
  }
}
```

**Result**: All non-archived tasks.

#### EXISTS vs OPTIONAL

**Use EXISTS when**:
- You only need to check for presence/absence
- You don't need the matched values

**Use OPTIONAL when**:
- You need the matched values in results
- Missing values should be null, not filtered out

---

### Property Paths

Navigate graph relationships with path expressions.

#### Path Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `/` | Sequence | `a/b` matches `a` then `b` |
| `\|` | Alternative | `a\|b` matches `a` OR `b` |
| `^` | Inverse | `^a` matches reverse of `a` |
| `+` | One or more | `a+` matches `a`, `a/a`, `a/a/a`, ... |
| `*` | Zero or more | `a*` matches self, `a`, `a/a`, ... |
| `?` | Zero or one | `a?` matches self OR `a` |

#### Sequence Path (/)

Match predicates in order:

```sparql
SELECT ?task ?area
WHERE {
  ?task <https://exocortex.my/ontology/ems#belongs_to_project>/<https://exocortex.my/ontology/ems#belongs_to_area> ?area .
}
```

**Explanation**: Task → Project → Area in two hops.

#### Alternative Path (|)

Match any of several predicates:

```sparql
SELECT ?asset ?parent
WHERE {
  ?asset (<https://exocortex.my/ontology/ems#belongs_to_project>|<https://exocortex.my/ontology/ems#belongs_to_area>) ?parent .
}
```

#### Inverse Path (^)

Reverse the direction:

```sparql
SELECT ?project ?task
WHERE {
  ?project ^<https://exocortex.my/ontology/ems#belongs_to_project> ?task .
}
```

**Explanation**: Find tasks that belong to project (reverse of "task belongs_to project").

#### Transitive Paths (+ and *)

`+` requires at least one step:

```sparql
SELECT ?task ?ancestor
WHERE {
  ?task <https://exocortex.my/ontology/ems#belongs_to_project>+ ?ancestor .
}
```

`*` includes zero steps (self):

```sparql
SELECT ?node ?related
WHERE {
  ?node <https://exocortex.my/ontology/ems#belongs_to_area>* ?related .
}
```

**Performance Note**: Property paths use BFS traversal with cycle detection. Maximum depth is 100 to prevent infinite loops.

#### Optional Step (?)

Match zero or one step:

```sparql
SELECT ?task ?maybeProject
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project>? ?maybeProject .
}
```

**Result**: Tasks and their projects (or null if no project).

---

### Subqueries

Use queries within queries for complex operations.

#### Basic Subquery

```sparql
SELECT ?task ?taskLabel ?projectTaskCount
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  {
    SELECT ?project (COUNT(?t) AS ?projectTaskCount)
    WHERE {
      ?t <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
    }
    GROUP BY ?project
  }
}
```

**Explanation**: Each task shows its project's total task count.

#### Filtering with Subquery Results

Find tasks in projects with more than 5 tasks:

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  {
    SELECT ?project
    WHERE {
      SELECT ?project (COUNT(?t) AS ?count)
      WHERE {
        ?t <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
      }
      GROUP BY ?project
      HAVING (?count > 5)
    }
  }
}
```

#### Subquery Best Practices

1. **Keep subqueries simple** - Complex nesting hurts readability
2. **Use aggregations in subqueries** - Main use case for subqueries
3. **Avoid excessive nesting** - Two levels is usually the practical maximum
4. **Consider alternatives** - Sometimes OPTIONAL or EXISTS is cleaner

---

## Performance Best Practices

### 1. Use Specific Patterns

❌ **Slow**:
```sparql
SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
LIMIT 100
```

✅ **Fast**:
```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

**Why**: Specific patterns leverage indexing (SPO, POS, OSP indexes).

### 2. Use LIMIT

Always use `LIMIT` when exploring:

```sparql
SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
LIMIT 10
```

**Why**: Prevents overwhelming results and browser lag.

### 3. Filter Early

❌ **Slow**:
```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  FILTER(regex(?label, "report", "i"))
}
```

✅ **Fast**:
```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER(regex(?label, "report", "i"))
}
```

**Why**: Filtering on class first reduces candidate set before string matching.

### 4. Avoid OPTIONAL When Possible

❌ **Slower**:
```sparql
SELECT ?task ?label ?priority
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  OPTIONAL { ?task <https://exocortex.my/ontology/exo#Asset_label> ?label . }
  OPTIONAL { ?task <https://exocortex.my/ontology/ems#Task_priority> ?priority . }
}
```

✅ **Faster**:
```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

**Why**: OPTIONAL patterns disable some optimizations. Only use when needed.

### 5. Use DISTINCT Sparingly

`DISTINCT` has overhead. Only use when necessary:

```sparql
SELECT ?status
WHERE {
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
}
```

**When to use DISTINCT**: When you expect duplicates and need unique values.

---

## Common Pitfalls and Solutions

### Pitfall 1: Missing Brackets

❌ **Wrong**:
```sparql
SELECT ?task
WHERE
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
```

✅ **Correct**:
```sparql
SELECT ?task
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
}
```

**Error**: `Expected WHERE clause`

### Pitfall 2: Forgetting Dot Separator

❌ **Wrong**:
```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task"
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

✅ **Correct**:
```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

**Error**: Each triple pattern must end with `.` (except the last one, which is optional).

### Pitfall 3: Incorrect URI Format

❌ **Wrong**:
```sparql
SELECT ?task
WHERE {
  ?task exo__Instance_class "ems__Task" .
}
```

✅ **Correct**:
```sparql
SELECT ?task
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
}
```

**Error**: Properties must be full URIs in angle brackets.

### Pitfall 4: Case Sensitivity

SPARQL is case-sensitive:

❌ **Wrong**:
```sparql
select ?task
where {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
}
```

✅ **Correct**:
```sparql
SELECT ?task
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
}
```

**Best Practice**: Use uppercase keywords (`SELECT`, `WHERE`, `FILTER`).

### Pitfall 5: String vs Variable

❌ **Wrong**:
```sparql
SELECT ?task
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> ems__Task .
}
```

✅ **Correct**:
```sparql
SELECT ?task
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
}
```

**Error**: String literals must be quoted. `ems__Task` without quotes is treated as a variable.

### Pitfall 6: No Results?

**Debugging Checklist**:

1. **Check property URIs**:
   ```sparql
   SELECT ?s ?p ?o
   WHERE {
     ?s ?p ?o .
   }
   LIMIT 10
   ```
   Verify actual property names in your vault.

2. **Check class values**:
   ```sparql
   SELECT DISTINCT ?class
   WHERE {
     ?s <https://exocortex.my/ontology/exo#Instance_class> ?class .
   }
   ```
   Verify actual class names (`ems__Task`, not `Task`).

3. **Check property existence**:
   ```sparql
   SELECT ?task
   WHERE {
     ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
   }
   ```
   Verify tasks exist in your vault with correct frontmatter.

### Pitfall 7: Namespace URI Mismatch

**Problem**: Query executes without errors but returns 0 results.

**Root Cause**: Namespace URIs in query don't match actual URIs used in triple store.

**Diagnostic Query**:
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT ?predicate
WHERE {
  ?subject ?predicate ?object .
}
LIMIT 20
```

If you see predicates like `http://exocortex.org/ontology/Asset_label` but your query uses:
```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
```

That's a mismatch!

**Solution**:
1. Check vault ontology files (`!exo.md`, `!ems.md`) for canonical URIs in `exo__Ontology_url` property
2. Update PREFIX declarations to match:
   ```sparql
   PREFIX exo: <https://exocortex.my/ontology/exo#>
   PREFIX ems: <https://exocortex.my/ontology/ems#>
   ```
3. Use hash-style URIs (`#` at end), not slash-style (`/` at end)

**Reference**: See PR #363 for namespace unification example.

---

## Troubleshooting RDF/RDFS Queries

### Issue: "No results when using rdf:type"

**Symptom:** Query returns empty results despite assets existing.

**Cause:** RDF/RDFS triples not generated (mapping not enabled).

**Solution:**
1. Verify triple store includes RDF/RDFS triples:
   ```sparql
   SELECT * WHERE { ?s ?p ?o } LIMIT 100
   ```
2. Check for rdfs:subClassOf triples
3. Rebuild triple store: Command Palette → "Reload Layout"

---

### Issue: "rdfs:subClassOf* query very slow"

**Symptom:** Transitive queries take >1 second.

**Cause:** Large result set, no LIMIT.

**Solution:**
1. Add LIMIT clause
2. Filter by specific type before transitive closure
3. Use ExoRDF queries if performance critical

---

### Issue: "Assets have no URIs in results"

**Symptom:** Query returns blank nodes instead of URIs.

**Cause:** Assets missing exo__Asset_uid property.

**Solution:**
1. Check asset frontmatter for exo__Asset_uid
2. Run "Repair Folder" command to add missing UIDs
3. Rebuild triple store

---

### Issue: "Ontology URL not found"

**Symptom:** Error: "Invalid ontology URL"

**Cause:** Asset references non-existent ontology file.

**Solution:**
1. Verify exo__Asset_isDefinedBy references valid file
2. Check ontology file has exo__Ontology_url property
3. Use default ontology URL if needed

---

## Security Considerations for Hash Functions

### SPARQL 1.1 Hash Functions

Exocortex implements the standard SPARQL 1.1 hash functions as defined in the [W3C specification](https://www.w3.org/TR/sparql11-query/#func-hash):

| Function | Algorithm | Security Status |
|----------|-----------|-----------------|
| `MD5(str)` | MD5 | ⚠️ Cryptographically weak |
| `SHA1(str)` | SHA-1 | ⚠️ Cryptographically weak |
| `SHA256(str)` | SHA-256 | ✅ Secure |
| `SHA384(str)` | SHA-384 | ✅ Secure |
| `SHA512(str)` | SHA-512 | ✅ Secure |

### Important Security Notes

> ⚠️ **WARNING**: MD5 and SHA1 are cryptographically broken and should NOT be used for security purposes (passwords, authentication, digital signatures).

These functions exist in Exocortex **only for SPARQL 1.1 specification compliance**. They are appropriate for:

- ✅ Data deduplication (finding identical content)
- ✅ Checksums for change detection
- ✅ Query result caching keys
- ✅ Non-security fingerprinting

**DO NOT use for:**

- ❌ Password hashing
- ❌ Authentication tokens
- ❌ Cryptographic signatures
- ❌ Any security-critical purpose

### Recommended: Use SHA-256 or Stronger

When you have a choice, prefer `SHA256()`, `SHA384()`, or `SHA512()`:

```sparql
# Preferred - SHA-256 for content hashing
SELECT ?file (SHA256(?content) AS ?hash)
WHERE {
  ?file exo:Asset_content ?content .
}
```

### References

- [CWE-327: Use of Broken or Risky Cryptographic Algorithm](https://cwe.mitre.org/data/definitions/327.html)
- [SPARQL 1.1 Hash Functions Specification](https://www.w3.org/TR/sparql11-query/#func-hash)

---

## Next Steps

- **Explore Examples**: See [Query-Examples.md](./Query-Examples.md) for 20+ real-world query patterns
- **Performance Tuning**: Read [Performance-Tips.md](./Performance-Tips.md) for optimization techniques
- **Developer Guide**: Learn about the architecture in [Developer-Guide.md](./Developer-Guide.md)

## Resources

- [SPARQL 1.1 Query Language Specification](https://www.w3.org/TR/sparql11-query/)
- [RDF Primer](https://www.w3.org/TR/rdf-primer/)
- [Exocortex Property Schema](../PROPERTY_SCHEMA.md)

---

**Need Help?** Open an issue on [GitHub](https://github.com/kitelev/exocortex/issues) or ask in the community discussions!
