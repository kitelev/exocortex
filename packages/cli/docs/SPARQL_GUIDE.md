# SPARQL Query Guide

**Version**: 1.0
**Last Updated**: 2025-11-30
**Purpose**: Complete guide to querying your Obsidian vault with SPARQL

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Basic Queries](#basic-queries)
4. [Query Reference](#query-reference)
5. [FILTER Expressions](#filter-expressions)
6. [JOIN Patterns](#join-patterns)
7. [Aggregates](#aggregates)
8. [Output Formats](#output-formats)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Your First Query

List all tasks in your vault:

```bash
exo query 'SELECT ?task ?label WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> <https://exocortex.my/ontology/ems#Task> .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
}'
```

### Using Prefixes (Recommended)

```bash
exo query 'PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
}'
```

### Query from File

Save your query to a `.sparql` file and run:

```bash
# Create query file
cat > my-query.sparql << 'EOF'
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
}
EOF

# Execute query
exo query my-query.sparql
```

---

## Installation

### Prerequisites

- Node.js 18+
- An Obsidian vault with Exocortex-formatted notes

### Install CLI

```bash
npm install -g @kitelev/exocortex-cli
```

### Verify Installation

```bash
exo --version
exo query --help
```

---

## Basic Queries

### Command Syntax

```bash
exo query <query> [options]
```

### Options

| Option            | Description                           | Default           |
| ----------------- | ------------------------------------- | ----------------- |
| `--vault <path>`  | Path to Obsidian vault                | Current directory |
| `--format <type>` | Output format: `table`, `json`, `csv` | `table`           |
| `--explain`       | Show optimized query plan             | Off               |
| `--stats`         | Show execution statistics             | Off               |
| `--no-optimize`   | Disable query optimization            | Optimized         |

### Examples

```bash
# Query with explicit vault path
exo query 'SELECT * WHERE { ?s ?p ?o } LIMIT 10' --vault ~/Obsidian/MyVault

# Output as JSON
exo query 'SELECT ?task WHERE { ?task a ems:Task }' --format json

# Show query plan
exo query 'SELECT ?task WHERE { ?task a ems:Task }' --explain

# Show execution statistics
exo query 'SELECT ?task WHERE { ?task a ems:Task }' --stats
```

---

## Query Reference

### SELECT Syntax

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT [DISTINCT] ?var1 ?var2 ...
WHERE {
  # Triple patterns
  ?subject ?predicate ?object .
}
[ORDER BY ?var [DESC(?var)]]
[LIMIT n]
[OFFSET n]
```

### Variable Binding

Variables start with `?` and bind to values matching patterns:

```sparql
# ?task binds to any subject with Instance_class = Task
?task exo:Instance_class ems:Task .

# ?label binds to the Asset_label of ?task
?task exo:Asset_label ?label .
```

### Literal Values

```sparql
# String literal
?task exo:Asset_label "My Task" .

# Numeric literal
?task ems:Effort_votes 5 .
```

### ORDER BY

```sparql
# Ascending (default)
SELECT ?task ?votes WHERE {
  ?task ems:Effort_votes ?votes .
}
ORDER BY ?votes

# Descending
ORDER BY DESC(?votes)

# Multiple criteria
ORDER BY DESC(?votes) ?label
```

### LIMIT and OFFSET

```sparql
# First 10 results
SELECT ?task WHERE { ?task a ems:Task } LIMIT 10

# Skip first 20, get next 10
SELECT ?task WHERE { ?task a ems:Task } LIMIT 10 OFFSET 20
```

### DISTINCT

```sparql
# Remove duplicate results
SELECT DISTINCT ?area WHERE {
  ?task ems:Effort_area ?area .
}
```

---

## FILTER Expressions

### Comparison Operators

```sparql
# Equal
FILTER(?votes = 5)

# Not equal
FILTER(?votes != 0)

# Greater than / Less than
FILTER(?votes > 3)
FILTER(?votes < 10)

# Greater or equal / Less or equal
FILTER(?votes >= 3)
FILTER(?votes <= 10)
```

### String Functions

```sparql
# Contains substring
FILTER(CONTAINS(?label, "Review"))

# Starts with prefix
FILTER(STRSTARTS(?label, "Meeting"))

# Ends with suffix
FILTER(STRENDS(?label, "2025"))

# Regular expression
FILTER(REGEX(?label, "^PR #\\d+"))

# Case-insensitive regex
FILTER(REGEX(?label, "meeting", "i"))
```

### String Manipulation

```sparql
# Convert to string
STR(?value)

# String length
STRLEN(?label)

# Substring (1-based index)
SUBSTR(?label, 1, 10)

# Case conversion
UCASE(?label)
LCASE(?label)

# Replace text
REPLACE(?label, "old", "new")

# Concatenate
CONCAT(?first, " ", ?last)
```

### Numeric Functions

```sparql
# Absolute value
ABS(?number)

# Ceiling (round up)
CEIL(?number)

# Floor (round down)
FLOOR(?number)

# Round to nearest
ROUND(?number)
```

### Type Checking

```sparql
# Check if variable is bound
FILTER(BOUND(?area))
FILTER(!BOUND(?parent))

# Check term type
FILTER(ISURI(?subject))
FILTER(ISIRI(?subject))
FILTER(ISLITERAL(?value))
FILTER(ISBLANK(?node))
FILTER(ISNUMERIC(?votes))
```

### Logical Operators

```sparql
# AND
FILTER(?votes > 0 && CONTAINS(?label, "Review"))

# OR
FILTER(?status = "Doing" || ?status = "ToDo")

# NOT
FILTER(!CONTAINS(?label, "Draft"))
```

### Arithmetic

```sparql
# Basic operations in SELECT
SELECT ?task ((?votes * 2) AS ?doubledVotes) WHERE {
  ?task ems:Effort_votes ?votes .
}
```

---

## JOIN Patterns

### Basic Join (AND)

Multiple patterns in the same block perform an inner join:

```sparql
SELECT ?task ?label ?status WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_status ?status .
}
```

### OPTIONAL (Left Join)

Include results even if optional pattern doesn't match:

```sparql
SELECT ?task ?label ?area WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  OPTIONAL { ?task ems:Effort_area ?area }
}
```

### UNION

Combine results from alternative patterns:

```sparql
SELECT ?item ?label WHERE {
  {
    ?item exo:Instance_class ems:Task .
    ?item exo:Asset_label ?label .
  }
  UNION
  {
    ?item exo:Instance_class ems:Project .
    ?item exo:Asset_label ?label .
  }
}
```

---

## Aggregates

### COUNT

```sparql
# Count all tasks
SELECT (COUNT(?task) AS ?total) WHERE {
  ?task exo:Instance_class ems:Task .
}

# Count distinct areas
SELECT (COUNT(DISTINCT ?area) AS ?areaCount) WHERE {
  ?task ems:Effort_area ?area .
}
```

### SUM

```sparql
# Total votes across all tasks
SELECT (SUM(?votes) AS ?totalVotes) WHERE {
  ?task ems:Effort_votes ?votes .
}
```

### AVG

```sparql
# Average votes per task
SELECT (AVG(?votes) AS ?avgVotes) WHERE {
  ?task ems:Effort_votes ?votes .
}
```

### MIN / MAX

```sparql
# Highest and lowest vote counts
SELECT (MIN(?votes) AS ?minVotes) (MAX(?votes) AS ?maxVotes) WHERE {
  ?task ems:Effort_votes ?votes .
}
```

### GROUP_CONCAT

```sparql
# List all task labels per area
SELECT ?area (GROUP_CONCAT(?label; SEPARATOR=", ") AS ?tasks) WHERE {
  ?task ems:Effort_area ?area .
  ?task exo:Asset_label ?label .
}
GROUP BY ?area
```

### GROUP BY

```sparql
# Count tasks per status
SELECT ?status (COUNT(?task) AS ?count) WHERE {
  ?task exo:Instance_class ems:Task .
  ?task ems:Effort_status ?status .
}
GROUP BY ?status
ORDER BY DESC(?count)

# Count tasks per area
SELECT ?area (COUNT(?task) AS ?taskCount) WHERE {
  ?task ems:Effort_area ?area .
}
GROUP BY ?area
```

---

## Output Formats

### Table (Default)

```bash
exo query 'SELECT ?task ?label WHERE { ... }' --format table
```

Output:

```
┌─────────────────────────────────────────────┬────────────────────┐
│ task                                        │ label              │
├─────────────────────────────────────────────┼────────────────────┤
│ obsidian://vault/Tasks/Review%20PR%20123.md │ Review PR #123     │
│ obsidian://vault/Tasks/Fix%20Bug.md         │ Fix Bug            │
└─────────────────────────────────────────────┴────────────────────┘
```

### JSON

```bash
exo query 'SELECT ?task ?label WHERE { ... }' --format json
```

Output:

```json
[
  {
    "task": "obsidian://vault/Tasks/Review%20PR%20123.md",
    "label": "Review PR #123"
  },
  {
    "task": "obsidian://vault/Tasks/Fix%20Bug.md",
    "label": "Fix Bug"
  }
]
```

### CSV

```bash
exo query 'SELECT ?task ?label WHERE { ... }' --format csv
```

Output:

```csv
task,label
obsidian://vault/Tasks/Review%20PR%20123.md,Review PR #123
obsidian://vault/Tasks/Fix%20Bug.md,Fix Bug
```

---

## Troubleshooting

### "Vault not found"

```
Error: Vault not found: /path/to/vault
```

**Solution**: Specify the correct vault path:

```bash
exo query 'SELECT ...' --vault /correct/path/to/vault
```

### "Parse error"

```
Error: Parse error on line 1: Unexpected token
```

**Solution**: Check SPARQL syntax:

- Ensure PREFIX declarations end without a period
- Triple patterns must end with a period
- Strings must be properly quoted

### Empty Results

**Possible causes**:

1. No matching data in vault
2. Incorrect predicate URIs (check namespace)
3. Filter too restrictive

**Debug steps**:

```bash
# Check what predicates exist
exo query 'SELECT DISTINCT ?p WHERE { ?s ?p ?o } LIMIT 50'

# Check specific predicate
exo query 'SELECT ?s ?o WHERE { ?s <https://exocortex.my/ontology/exo#Asset_label> ?o } LIMIT 10'
```

### Query Too Slow

**Solutions**:

1. Add LIMIT to reduce results
2. Use more specific patterns (reduce BGP size)
3. Check `--stats` for bottleneck identification

```bash
exo query 'SELECT ...' --stats
```

---

## Related Documentation

- [SPARQL Cookbook](SPARQL_COOKBOOK.md) - Practical query examples
- [Ontology Reference](ONTOLOGY_REFERENCE.md) - Available predicates
- [Property Schema](../../../docs/reference/PROPERTY_SCHEMA.md) - Frontmatter properties

---

**Maintainer**: @kitelev
**Related Issues**: #492 (SPARQL Documentation)
