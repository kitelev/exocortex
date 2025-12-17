# SPARQL 1.2 Features in Exocortex

Exocortex implements key features from the SPARQL 1.2 specification, extending the standard SPARQL 1.1 functionality with modern capabilities for RDF data management.

## Table of Contents

1. [Overview](#overview)
2. [LATERAL Joins](#lateral-joins)
3. [PREFIX* Declarations](#prefix-declarations)
4. [DESCRIBE Options](#describe-options)
5. [Directional Language Tags](#directional-language-tags)
6. [DateTime Arithmetic](#datetime-arithmetic)
7. [String Functions](#string-functions)
8. [RDF-Star Support](#rdf-star-support)

---

## Overview

SPARQL 1.2 is the next evolution of the SPARQL query language, adding features that address common pain points in SPARQL 1.1. Exocortex implements the most impactful features:

| Feature | Status | Description |
|---------|--------|-------------|
| LATERAL Joins | ✅ Full | Correlated subqueries for "top N per group" |
| PREFIX* | ✅ Full | Auto-import well-known prefixes |
| DESCRIBE Options | ✅ Full | DEPTH and SYMMETRIC control |
| Directional Language Tags | ✅ Full | RTL/LTR text direction support |
| DateTime Arithmetic | ✅ Full | Date/time subtraction and duration operations |
| NORMALIZE/FOLD | ✅ Full | Unicode normalization and case folding |
| RDF-Star | ⚠️ Partial | Quoted triple data model support |

---

## LATERAL Joins

LATERAL joins enable **correlated subqueries** where the inner query can reference variables from the outer query. This enables patterns like "top N per group" that are not possible with standard subqueries.

### Syntax

```sparql
SELECT ?outer ?inner
WHERE {
  ?outer a :SomeClass .
  LATERAL {
    SELECT ?inner WHERE {
      ?outer :relates ?inner .  # References outer variable
    }
    ORDER BY DESC(?score)
    LIMIT 1
  }
}
```

### Key Features

- Inner query can reference variables bound in the outer query
- Works with ORDER BY and LIMIT for "top N per group" patterns
- Executed once per outer binding (correlated evaluation)
- Inner join semantics (rows with no inner matches are excluded)

### Example: Top Friend Per Person

Find each person's highest-scoring friend:

```sparql
PREFIX : <http://example.org/>

SELECT ?person ?topFriend ?score
WHERE {
  ?person a :Person .
  LATERAL {
    SELECT ?topFriend ?score WHERE {
      ?person :knows ?topFriend .
      ?topFriend :score ?score .
    }
    ORDER BY DESC(?score)
    LIMIT 1
  }
}
```

**Result:**

| person | topFriend | score |
|--------|-----------|-------|
| :alice | :charlie | 95 |
| :eve | :grace | 90 |

### Example: Top N Per Category

Get the top 2 tasks by votes for each project:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?project ?task ?votes
WHERE {
  ?project exo:Instance_class "ems__Project" .
  LATERAL {
    SELECT ?task ?votes WHERE {
      ?task ems:belongs_to_project ?project .
      ?task ems:Effort_votes ?votes .
    }
    ORDER BY DESC(?votes)
    LIMIT 2
  }
}
```

### Multiple LATERAL Patterns

You can chain multiple LATERAL patterns:

```sparql
SELECT ?person ?friend ?project
WHERE {
  ?person a :Person .
  LATERAL {
    SELECT ?friend WHERE {
      ?person :knows ?friend .
    }
    LIMIT 1
  }
  LATERAL {
    SELECT ?project WHERE {
      ?person :worksOn ?project .
    }
    LIMIT 1
  }
}
```

---

## PREFIX* Declarations

PREFIX* allows auto-importing prefixes from well-known vocabularies without manually declaring them.

### Syntax

```sparql
PREFIX* <http://schema.org/>
PREFIX* <http://xmlns.com/foaf/0.1/>

SELECT ?name WHERE {
  ?person schema:name ?name .
  ?person foaf:knows ?friend .
}
```

### Supported Vocabularies

| Vocabulary | Namespace | Auto-Prefix |
|------------|-----------|-------------|
| Schema.org | `http://schema.org/` | `schema:` |
| FOAF | `http://xmlns.com/foaf/0.1/` | `foaf:` |
| Dublin Core | `http://purl.org/dc/elements/1.1/` | `dc:`, `dcterms:` |
| RDF | `http://www.w3.org/1999/02/22-rdf-syntax-ns#` | `rdf:` |
| RDFS | `http://www.w3.org/2000/01/rdf-schema#` | `rdfs:` |
| OWL | `http://www.w3.org/2002/07/owl#` | `owl:` |
| XSD | `http://www.w3.org/2001/XMLSchema#` | `xsd:` |
| SKOS | `http://www.w3.org/2004/02/skos/core#` | `skos:` |
| PROV | `http://www.w3.org/ns/prov#` | `prov:` |
| GEO | `http://www.w3.org/2003/01/geo/wgs84_pos#` | `geo:` |
| DCAT | `http://www.w3.org/ns/dcat#` | `dcat:` |

### Unknown Vocabularies

For unknown vocabularies, a fallback prefix is generated from the URI path:

```sparql
PREFIX* <http://example.org/custom/ontology/>
# Generates: PREFIX ontology: <http://example.org/custom/ontology/>
```

---

## DESCRIBE Options

SPARQL 1.2 adds DEPTH and SYMMETRIC options to DESCRIBE queries for fine-grained control over result generation.

### Syntax

```sparql
DESCRIBE ?resource DEPTH 2
DESCRIBE ?resource SYMMETRIC
DESCRIBE ?resource DEPTH 1 SYMMETRIC
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `DEPTH n` | Limit description to n hops from resource | Unlimited (direct triples only) |
| `SYMMETRIC` | Include both incoming and outgoing triples | Already includes both |

### Example: Limited Depth

Describe a task with only direct properties:

```sparql
DESCRIBE <vault://Tasks/My-Task.md> DEPTH 1
```

### Example: Extended Description

Describe a task and related entities up to 2 hops:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

DESCRIBE ?task DEPTH 2
WHERE {
  ?task exo:Instance_class "ems__Task" .
  ?task exo:Asset_label "My Important Task" .
}
```

---

## Directional Language Tags

SPARQL 1.2 supports **directional language tags** for bidirectional text (RTL/LTR).

### Syntax

Language tags can include a direction suffix using `--ltr` or `--rtl`:

```turtle
"مرحبا"@ar--rtl    # Arabic, right-to-left
"Hello"@en--ltr    # English, left-to-right
"שלום"@he--rtl     # Hebrew, right-to-left
```

### LANGDIR Function

Get the complete language tag including direction:

```sparql
SELECT ?text (LANGDIR(?text) AS ?langdir)
WHERE {
  ?s :label ?text .
}
```

**Examples:**

| Input | LANGDIR Result |
|-------|----------------|
| `"مرحبا"@ar--rtl` | `"ar--rtl"` |
| `"Hello"@en--ltr` | `"en--ltr"` |
| `"Hello"@en` | `"en"` |
| `"Hello"` | `""` |

### hasLANGDIR Function

Check if a literal has a direction:

```sparql
SELECT ?text
WHERE {
  ?s :label ?text .
  FILTER(hasLANGDIR(?text))
}
```

**Examples:**

| Input | hasLANGDIR Result |
|-------|-------------------|
| `"مرحبا"@ar--rtl` | `true` |
| `"Hello"@en` | `false` |
| `"Hello"` | `false` |

### STRLANGDIR Function

Create a directional literal:

```sparql
SELECT (STRLANGDIR("مرحبا", "ar", "rtl") AS ?arabic)
WHERE {}
```

**Signature:** `STRLANGDIR(lexicalForm, language, direction)`

- `lexicalForm`: The string value
- `language`: Language tag (e.g., "ar", "en-US")
- `direction`: "ltr" or "rtl"

**Examples:**

```sparql
STRLANGDIR("Hello", "en", "ltr")  # → "Hello"@en--ltr
STRLANGDIR("مرحبا", "ar", "rtl")  # → "مرحبا"@ar--rtl
```

---

## DateTime Arithmetic

SPARQL 1.2 adds native support for date/time subtraction and duration operations.

### Date/DateTime Subtraction

Subtract two dates or datetimes to get a duration:

```sparql
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?start ?end (?end - ?start AS ?duration)
WHERE {
  ?task :startTime ?start .
  ?task :endTime ?end .
}
```

### Duration Types

The system supports ISO 8601 duration formats:

| Type | Format | Example |
|------|--------|---------|
| `xsd:dayTimeDuration` | `P[n]DT[n]H[n]M[n]S` | `P1DT2H30M` |
| `xsd:yearMonthDuration` | `P[n]Y[n]M` | `P1Y6M` |

### Duration Arithmetic Functions

**dateSubtract** - Subtract a duration from a date:

```sparql
SELECT (dateSubtract("2025-01-22", "P7D") AS ?weekAgo)
WHERE {}
# Result: "2025-01-15"
```

**dateSubtractYearMonth** - Subtract year/month duration:

```sparql
SELECT (dateSubtractYearMonth("2025-06-15", "P6M") AS ?sixMonthsAgo)
WHERE {}
# Result: "2024-12-15"
```

### Real-World Example: Sleep Duration

Calculate average sleep duration from Exocortex data:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?label ?start ?end
       (HOURS(?end) - HOURS(?start) +
        (MINUTES(?end) - MINUTES(?start)) / 60 AS ?hours)
WHERE {
  ?s exo:Asset_label ?label .
  FILTER(STRSTARTS(?label, "Поспать"))
  ?s ems:Effort_startTimestamp ?start .
  ?s ems:Effort_endTimestamp ?end .
}
```

---

## String Functions

### NORMALIZE Function

Unicode normalization for consistent string comparison:

```sparql
SELECT (NORMALIZE("café") AS ?normalized)
WHERE {}
```

**Normalization Forms:**

| Form | Description |
|------|-------------|
| `NFC` | Canonical Composition (default) |
| `NFD` | Canonical Decomposition |
| `NFKC` | Compatibility Composition |
| `NFKD` | Compatibility Decomposition |

**Examples:**

```sparql
NORMALIZE("café")           # NFC normalized
NORMALIZE("ﬁ", "NFKC")      # → "fi" (ligature decomposed)
NORMALIZE("Ω", "NFD")       # NFD normalized omega
```

### FOLD Function

Unicode case folding for case-insensitive comparison:

```sparql
SELECT ?name
WHERE {
  ?s :name ?name .
  FILTER(FOLD(?name) = FOLD("HELLO"))
}
```

**Key Features:**

- Full Unicode case folding (not just ASCII)
- Handles special cases like German ß → ss
- Handles Greek sigma variations (Σ → σ)
- Decomposes ligatures (ﬁ → fi)

**Examples:**

```sparql
FOLD("Hello")    # → "hello"
FOLD("Straße")   # → "strasse"
FOLD("ΣΕΛΛΑΣ")   # → "σελλασ"
FOLD("ﬁle")      # → "file"
```

---

## RDF-Star Support

Exocortex includes foundational support for RDF-Star (statements about statements).

### QuotedTriple Data Model

The `QuotedTriple` class represents triples that can appear in subject or object position:

```typescript
import { QuotedTriple, IRI } from 'exocortex';

// Create a quoted triple representing "Alice knows Bob"
const quotedTriple = new QuotedTriple(
  new IRI('http://example.org/alice'),
  new IRI('http://example.org/knows'),
  new IRI('http://example.org/bob')
);

// Serialize to RDF-Star Turtle syntax
console.log(quotedTriple.toString());
// Output: << <http://example.org/alice> <http://example.org/knows> <http://example.org/bob> >>
```

### Intended Usage

RDF-Star enables metadata about statements:

```turtle
# Standard RDF-Star syntax (planned)
<< :Alice :knows :Bob >> :source :Wikipedia .
<< :Alice :knows :Bob >> :confidence "0.95"^^xsd:decimal .
```

### Current Status

**Implemented:**
- `QuotedTriple` domain model class
- Structural equality checking
- Turtle serialization
- Nested quoted triple support

**Planned (Future Releases):**
- SPARQL functions: `TRIPLE()`, `SUBJECT()`, `PREDICATE()`, `OBJECT()`, `isTRIPLE()`
- Parser support for `<< s p o >>` syntax in SPARQL
- Triple store support for quoted triples

---

## Implementation Notes

### Parser Pipeline

SPARQL 1.2 features that sparqljs doesn't support natively are handled via transformers:

1. **LateralTransformer** - Converts `LATERAL { ... }` to marked subqueries
2. **PrefixStarTransformer** - Expands `PREFIX*` to standard `PREFIX` declarations
3. **DescribeOptionsTransformer** - Extracts `DEPTH`/`SYMMETRIC` options
4. **DirectionalLangTagTransformer** - Processes `@lang--dir` syntax

### Performance Considerations

- LATERAL joins execute the inner query once per outer binding
- PREFIX* resolution is cached for well-known vocabularies
- DateTime arithmetic uses native JavaScript Date operations
- NORMALIZE/FOLD use native JavaScript string methods with Unicode support

---

## Related Documentation

- [SPARQL User Guide](./User-Guide.md) - Basic SPARQL usage in Exocortex
- [Query Examples](./Query-Examples.md) - 30+ ready-to-use query patterns
- [Performance Tips](./Performance-Tips.md) - Query optimization techniques

## External References

- [SPARQL 1.2 Specification (W3C Draft)](https://w3c.github.io/sparql-12/spec/)
- [RDF-Star Specification](https://w3c.github.io/rdf-star/cg-spec/)
- [RDF Directional Literals](https://w3c.github.io/rdf-dir-literal/)
