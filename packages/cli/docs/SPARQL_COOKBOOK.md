# SPARQL Cookbook

**Version**: 1.0
**Last Updated**: 2025-11-30
**Purpose**: Real-world query examples for common Exocortex use cases

---

## Table of Contents

1. [Task Management](#task-management)
2. [Project Tracking](#project-tracking)
3. [Daily Planning](#daily-planning)
4. [Analytics & Reporting](#analytics--reporting)
5. [Search & Discovery](#search--discovery)
6. [Data Quality](#data-quality)

---

## Standard Prefixes

Use these prefixes in all queries:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
```

---

## Task Management

### Find All Active Tasks

Tasks that are currently in "Doing" status:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_status ?status .
  FILTER(CONTAINS(STR(?status), "EffortStatusDoing"))
}
```

### Find Tasks by Status

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?status WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_status ?status .
  FILTER(CONTAINS(STR(?status), "EffortStatusBacklog"))
}
ORDER BY ?label
```

### Find High-Priority Tasks (Most Voted)

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?votes WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_votes ?votes .
  FILTER(?votes > 0)
}
ORDER BY DESC(?votes)
LIMIT 10
```

### Find Tasks Without Votes

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  OPTIONAL { ?task ems:Effort_votes ?votes }
  FILTER(!BOUND(?votes) || ?votes = 0)
}
```

### Find Overdue Tasks

Tasks planned for past dates but not completed:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?day ?status WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_day ?day .
  ?task ems:Effort_status ?status .
  FILTER(!CONTAINS(STR(?status), "Done"))
  FILTER(!CONTAINS(STR(?status), "Trashed"))
  FILTER(STR(?day) < "2025-11-30")
}
ORDER BY ?day
```

### Find Tasks by Size

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?size WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Task_size ?size .
  FILTER(?size = "L" || ?size = "XL")
}
```

### Find Tasks with Keyword in Label

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  FILTER(CONTAINS(LCASE(?label), "review"))
}
```

---

## Project Tracking

### List All Projects with Status

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?project ?label ?status WHERE {
  ?project exo:Instance_class ems:Project .
  ?project exo:Asset_label ?label .
  ?project ems:Effort_status ?status .
}
ORDER BY ?status ?label
```

### Count Tasks per Project

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?project ?projectLabel (COUNT(?task) AS ?taskCount) WHERE {
  ?project exo:Instance_class ems:Project .
  ?project exo:Asset_label ?projectLabel .
  ?task ems:Effort_parent ?project .
  ?task exo:Instance_class ems:Task .
}
GROUP BY ?project ?projectLabel
ORDER BY DESC(?taskCount)
```

### Find Project Tasks by Status

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?project ?projectLabel ?status (COUNT(?task) AS ?count) WHERE {
  ?project exo:Instance_class ems:Project .
  ?project exo:Asset_label ?projectLabel .
  ?task ems:Effort_parent ?project .
  ?task ems:Effort_status ?status .
}
GROUP BY ?project ?projectLabel ?status
ORDER BY ?projectLabel ?status
```

### Find Projects with No Tasks

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?project ?label WHERE {
  ?project exo:Instance_class ems:Project .
  ?project exo:Asset_label ?label .
  FILTER NOT EXISTS {
    ?task ems:Effort_parent ?project .
  }
}
```

---

## Daily Planning

### Tasks Planned for Today

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?status WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_day ?day .
  ?task ems:Effort_status ?status .
  FILTER(CONTAINS(STR(?day), "2025-11-30"))
}
ORDER BY ?label
```

### Tasks with Planned Start Time

Evening tasks with specific start times:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?plannedStart WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_plannedStartTimestamp ?plannedStart .
}
ORDER BY ?plannedStart
```

### Completed Tasks This Week

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?completedAt WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_resolutionTimestamp ?completedAt .
  FILTER(STR(?completedAt) >= "2025-11-25")
}
ORDER BY DESC(?completedAt)
```

### Tasks Started But Not Completed

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?startedAt WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_startTimestamp ?startedAt .
  ?task ems:Effort_status ?status .
  FILTER(!CONTAINS(STR(?status), "Done"))
}
ORDER BY ?startedAt
```

---

## Analytics & Reporting

### Task Count by Status

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?status (COUNT(?task) AS ?count) WHERE {
  ?task exo:Instance_class ems:Task .
  ?task ems:Effort_status ?status .
}
GROUP BY ?status
ORDER BY DESC(?count)
```

### Task Count by Area

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?area (COUNT(?task) AS ?taskCount) WHERE {
  ?task exo:Instance_class ems:Task .
  ?task ems:Effort_area ?area .
}
GROUP BY ?area
ORDER BY DESC(?taskCount)
```

### Task Count by Size

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?size (COUNT(?task) AS ?count) WHERE {
  ?task exo:Instance_class ems:Task .
  ?task ems:Task_size ?size .
}
GROUP BY ?size
ORDER BY ?size
```

### Total Votes by Area

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?area (SUM(?votes) AS ?totalVotes) (AVG(?votes) AS ?avgVotes) WHERE {
  ?task exo:Instance_class ems:Task .
  ?task ems:Effort_area ?area .
  ?task ems:Effort_votes ?votes .
}
GROUP BY ?area
ORDER BY DESC(?totalVotes)
```

### Average Votes per Task Size

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?size (AVG(?votes) AS ?avgVotes) (COUNT(?task) AS ?count) WHERE {
  ?task exo:Instance_class ems:Task .
  ?task ems:Task_size ?size .
  ?task ems:Effort_votes ?votes .
}
GROUP BY ?size
ORDER BY ?size
```

### Asset Class Distribution

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?class (COUNT(?asset) AS ?count) WHERE {
  ?asset exo:Instance_class ?class .
}
GROUP BY ?class
ORDER BY DESC(?count)
```

### Creation Timeline

Assets created in the last 7 days:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label ?created WHERE {
  ?asset exo:Asset_label ?label .
  ?asset exo:Asset_createdAt ?created .
  FILTER(STR(?created) >= "2025-11-24")
}
ORDER BY DESC(?created)
```

---

## Search & Discovery

### Find Assets by Label Pattern

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label ?class WHERE {
  ?asset exo:Asset_label ?label .
  ?asset exo:Instance_class ?class .
  FILTER(REGEX(?label, "PR #\\d+", "i"))
}
```

### Find All Areas

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?area ?label WHERE {
  ?area exo:Instance_class ems:Area .
  ?area exo:Asset_label ?label .
}
ORDER BY ?label
```

### Find Area Hierarchy

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?area ?label ?parent WHERE {
  ?area exo:Instance_class ems:Area .
  ?area exo:Asset_label ?label .
  OPTIONAL { ?area ems:Area_parent ?parent }
}
ORDER BY ?parent ?label
```

### Find Task Prototypes

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?prototype ?label WHERE {
  ?prototype exo:Instance_class ems:TaskPrototype .
  ?prototype exo:Asset_label ?label .
}
ORDER BY ?label
```

### Find Tasks from Prototype

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?prototype WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task exo:Asset_prototype ?prototype .
}
ORDER BY ?prototype ?label
```

### Full-Text Search

Search across all labels:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label ?class WHERE {
  ?asset exo:Asset_label ?label .
  ?asset exo:Instance_class ?class .
  FILTER(CONTAINS(LCASE(?label), "meeting"))
}
ORDER BY ?class ?label
```

---

## Data Quality

### Find Assets Without Labels

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset WHERE {
  ?asset exo:Asset_uid ?uid .
  FILTER NOT EXISTS { ?asset exo:Asset_label ?label }
}
```

### Find Tasks Without Status

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  FILTER NOT EXISTS { ?task ems:Effort_status ?status }
}
```

### Find Tasks Without Area

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  FILTER NOT EXISTS { ?task ems:Effort_area ?area }
  FILTER NOT EXISTS { ?task ems:Effort_parent ?parent }
}
```

### Find Archived Assets

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label WHERE {
  ?asset exo:Asset_label ?label .
  ?asset exo:Asset_isArchived ?archived .
  FILTER(?archived = "true" || ?archived = true)
}
```

### Find Duplicate Labels

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?label (COUNT(?asset) AS ?count) WHERE {
  ?asset exo:Asset_label ?label .
}
GROUP BY ?label
HAVING (COUNT(?asset) > 1)
ORDER BY DESC(?count)
```

---

## Tips & Best Practices

### Performance Tips

1. **Use LIMIT** for exploratory queries
2. **Add specific patterns first** to reduce intermediate results
3. **Use `--stats`** to identify slow queries
4. **Avoid `SELECT *`** in production queries

### Query Writing Tips

1. **Start simple**, then add complexity
2. **Use OPTIONAL** for nullable properties
3. **Use FILTER EXISTS/NOT EXISTS** for presence checks
4. **Test with `--explain`** to understand query plan

### Debugging Tips

```bash
# Check what predicates exist in vault
exo query 'SELECT DISTINCT ?p WHERE { ?s ?p ?o } LIMIT 100'

# Check sample values for a predicate
exo query 'SELECT ?o WHERE { ?s exo:Instance_class ?o } LIMIT 10'

# Verify namespace URIs
exo query 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5' --format json
```

---

## Related Documentation

- [SPARQL Guide](SPARQL_GUIDE.md) - Complete query reference
- [Ontology Reference](ONTOLOGY_REFERENCE.md) - Available predicates
- [Property Schema](../../../docs/reference/PROPERTY_SCHEMA.md) - Frontmatter properties

---

**Maintainer**: @kitelev
**Related Issues**: #492 (SPARQL Documentation)
