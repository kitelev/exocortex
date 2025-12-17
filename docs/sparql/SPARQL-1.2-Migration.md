# SPARQL 1.2 Migration Guide

This guide covers upgrading from SPARQL 1.1 to SPARQL 1.2 in Exocortex, including new capabilities, recommended patterns, and migration considerations.

## Table of Contents

1. [What's New in SPARQL 1.2](#whats-new-in-sparql-12)
2. [Breaking Changes](#breaking-changes)
3. [Migration Patterns](#migration-patterns)
4. [New Capabilities](#new-capabilities)
5. [Best Practices](#best-practices)

---

## What's New in SPARQL 1.2

SPARQL 1.2 introduces several features that address common SPARQL 1.1 pain points:

| Feature | Benefit |
|---------|---------|
| LATERAL Joins | "Top N per group" patterns |
| PREFIX* | Simplified prefix management |
| DESCRIBE Options | Fine-grained DESCRIBE control |
| Directional Language Tags | Proper RTL/LTR support |
| DateTime Arithmetic | Native date/time operations |
| NORMALIZE/FOLD | Unicode-aware string handling |

---

## Breaking Changes

### No Breaking Changes

**Good news!** The SPARQL 1.2 implementation in Exocortex is **fully backward compatible** with SPARQL 1.1 queries. All existing queries will continue to work without modification.

SPARQL 1.2 features are **additive** - they extend the language without changing existing behavior.

### Potential Compatibility Considerations

While there are no breaking changes, be aware of these considerations:

1. **New Reserved Keywords**: `LATERAL` is now a reserved keyword. If you use it as a variable or prefix name, rename it.

2. **Direction in Literals**: Literals with directional language tags (`@en--ltr`) are now handled differently. The direction is preserved and affects equality comparisons.

3. **PREFIX* Availability**: The `PREFIX*` syntax requires network access to resolve vocabularies (or uses cached well-known prefixes).

---

## Migration Patterns

### Pattern 1: Replace Complex Subqueries with LATERAL

**Before (SPARQL 1.1)** - Getting top item per group was awkward:

```sparql
# Complex workaround using nested subqueries
SELECT ?project ?topTask ?maxVotes
WHERE {
  ?project a :Project .
  {
    SELECT ?project (MAX(?votes) AS ?maxVotes)
    WHERE {
      ?task :belongsTo ?project .
      ?task :votes ?votes .
    }
    GROUP BY ?project
  }
  ?topTask :belongsTo ?project .
  ?topTask :votes ?maxVotes .
}
```

**After (SPARQL 1.2)** - Clean and intuitive:

```sparql
SELECT ?project ?topTask ?votes
WHERE {
  ?project a :Project .
  LATERAL {
    SELECT ?topTask ?votes WHERE {
      ?topTask :belongsTo ?project .
      ?topTask :votes ?votes .
    }
    ORDER BY DESC(?votes)
    LIMIT 1
  }
}
```

**Benefits:**
- 40% shorter query
- Clearer intent ("top 1 per project")
- No duplicate matching issues
- Easily extend to "top N" by changing LIMIT

---

### Pattern 2: Simplify Prefix Declarations

**Before (SPARQL 1.1)**:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX schema: <http://schema.org/>

SELECT ?name WHERE {
  ?person rdf:type foaf:Person .
  ?person foaf:name ?name .
}
```

**After (SPARQL 1.2)**:

```sparql
PREFIX* <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX* <http://xmlns.com/foaf/0.1/>

SELECT ?name WHERE {
  ?person rdf:type foaf:Person .
  ?person foaf:name ?name .
}
```

**Benefits:**
- Fewer lines of boilerplate
- Automatic prefix discovery
- Consistent prefix naming

---

### Pattern 3: Use Case-Insensitive Search with FOLD

**Before (SPARQL 1.1)**:

```sparql
SELECT ?name WHERE {
  ?s :name ?name .
  FILTER(LCASE(?name) = LCASE("JOHN DOE"))
}
```

**After (SPARQL 1.2)**:

```sparql
SELECT ?name WHERE {
  ?s :name ?name .
  FILTER(FOLD(?name) = FOLD("JOHN DOE"))
}
```

**Benefits:**
- Full Unicode support (not just ASCII)
- Proper handling of German ß, Greek sigma, etc.
- Ligature handling (ﬁ = fi)

---

### Pattern 4: DESCRIBE with Depth Control

**Before (SPARQL 1.1)** - No control over DESCRIBE depth:

```sparql
# Returns unpredictable amount of data
DESCRIBE ?resource
```

**After (SPARQL 1.2)** - Precise control:

```sparql
# Only direct properties
DESCRIBE ?resource DEPTH 1

# Include one hop of related resources
DESCRIBE ?resource DEPTH 2 SYMMETRIC
```

**Benefits:**
- Predictable result size
- Better performance
- Explicit about what's included

---

## New Capabilities

### Capability 1: Top N Per Group

LATERAL enables patterns that were impossible or very complex in SPARQL 1.1:

```sparql
# Get top 3 tasks per project by votes
SELECT ?project ?task ?votes
WHERE {
  ?project a :Project .
  LATERAL {
    SELECT ?task ?votes WHERE {
      ?task :belongsTo ?project .
      ?task :votes ?votes .
    }
    ORDER BY DESC(?votes)
    LIMIT 3
  }
}
```

### Capability 2: Correlated Aggregations

Calculate aggregates that depend on outer context:

```sparql
# For each area, get its projects with task counts
SELECT ?area ?project ?taskCount
WHERE {
  ?area a :Area .
  LATERAL {
    SELECT ?project (COUNT(?task) AS ?taskCount) WHERE {
      ?project :belongsTo ?area .
      ?task :belongsTo ?project .
    }
    GROUP BY ?project
    HAVING (?taskCount > 0)
  }
}
```

### Capability 3: RTL/LTR Text Handling

Proper support for bidirectional text:

```sparql
# Create Arabic label with correct direction
SELECT (STRLANGDIR("مرحبا بك", "ar", "rtl") AS ?greeting)
WHERE {}

# Check if text has direction specified
SELECT ?label
WHERE {
  ?s :label ?label .
  FILTER(hasLANGDIR(?label))
}
```

### Capability 4: Duration Calculations

Native date/time arithmetic:

```sparql
# Calculate duration between events
SELECT ?event ?start ?end (?end - ?start AS ?duration)
WHERE {
  ?event :startTime ?start .
  ?event :endTime ?end .
}

# Get date 7 days ago
SELECT (dateSubtract("2025-01-22", "P7D") AS ?weekAgo)
WHERE {}
```

### Capability 5: Unicode-Aware String Processing

```sparql
# Normalize Unicode for comparison
SELECT ?s WHERE {
  ?s :label ?label .
  FILTER(NORMALIZE(?label) = NORMALIZE("café"))
}

# Case-folded search (handles Straße = strasse)
SELECT ?company WHERE {
  ?company :name ?name .
  FILTER(FOLD(?name) = FOLD("STRASSE"))
}
```

---

## Best Practices

### 1. Use LATERAL for "Top N Per Group"

**Don't** use complex MAX() subqueries with self-joins.
**Do** use LATERAL with ORDER BY and LIMIT.

### 2. Use FOLD Instead of LCASE for Case-Insensitive Search

LCASE only handles ASCII. FOLD provides full Unicode support.

### 3. Specify DESCRIBE DEPTH in Production

Unbounded DESCRIBE can return unexpectedly large results. Always specify DEPTH.

### 4. Use PREFIX* for Standard Vocabularies

Reduces boilerplate and ensures consistent prefix naming.

### 5. Include Direction for Multilingual Text

When working with RTL languages (Arabic, Hebrew), use directional literals:

```sparql
FILTER(LANG(?text) = "ar" || hasLANGDIR(?text))
```

### 6. Normalize Before Comparison

When comparing strings from different sources:

```sparql
FILTER(NORMALIZE(?a) = NORMALIZE(?b))
```

---

## Migration Checklist

Use this checklist when migrating queries to SPARQL 1.2:

- [ ] Review queries with complex nested subqueries for LATERAL replacement
- [ ] Check for "top N per group" patterns - prime candidates for LATERAL
- [ ] Replace LCASE() comparisons with FOLD() for Unicode support
- [ ] Add DEPTH to DESCRIBE queries for predictability
- [ ] Consider PREFIX* for standard vocabulary prefixes
- [ ] Review multilingual content for directional tag opportunities
- [ ] Check for date/time calculations that could use native arithmetic

---

## Backward Compatibility Reference

| SPARQL 1.1 Feature | SPARQL 1.2 Status |
|-------------------|------------------|
| SELECT | Unchanged |
| CONSTRUCT | Unchanged |
| DESCRIBE | Extended with DEPTH/SYMMETRIC |
| ASK | Unchanged |
| FILTER | Extended with new functions |
| OPTIONAL | Unchanged |
| UNION | Unchanged |
| MINUS | Unchanged |
| EXISTS/NOT EXISTS | Unchanged |
| Property Paths | Unchanged |
| Aggregates | Unchanged |
| Subqueries | Extended with LATERAL |
| VALUES | Unchanged |
| BIND | Unchanged |

---

## Related Documentation

- [SPARQL 1.2 Features](./SPARQL-1.2-Features.md) - Complete feature reference
- [SPARQL User Guide](./User-Guide.md) - Basic SPARQL usage
- [Query Examples](./Query-Examples.md) - Practical query patterns
