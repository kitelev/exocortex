# Exocortex Ontology Reference

**Version**: 1.0
**Last Updated**: 2025-11-30
**Purpose**: Complete reference of predicates and URIs for SPARQL queries

---

## Table of Contents

1. [Namespaces](#namespaces)
2. [Asset Classes](#asset-classes)
3. [Core Predicates (exo:)](#core-predicates-exo)
4. [Effort Management Predicates (ems:)](#effort-management-predicates-ems)
5. [Status Values](#status-values)
6. [URI Patterns](#uri-patterns)
7. [Example Queries by Class](#example-queries-by-class)

---

## Namespaces

### Standard Prefixes

Use these PREFIX declarations in your SPARQL queries:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
```

### Namespace URIs

| Prefix | Full URI | Purpose |
|--------|----------|---------|
| `rdf:` | `http://www.w3.org/1999/02/22-rdf-syntax-ns#` | RDF standard vocabulary |
| `rdfs:` | `http://www.w3.org/2000/01/rdf-schema#` | RDF Schema vocabulary |
| `xsd:` | `http://www.w3.org/2001/XMLSchema#` | XML Schema datatypes |
| `exo:` | `https://exocortex.my/ontology/exo#` | Exocortex core vocabulary |
| `ems:` | `https://exocortex.my/ontology/ems#` | Effort Management System |

---

## Asset Classes

### Class URIs

| Class | URI | Frontmatter Value |
|-------|-----|-------------------|
| Task | `ems:Task` | `ems__Task` |
| Project | `ems:Project` | `ems__Project` |
| Area | `ems:Area` | `ems__Area` |
| Meeting | `ems:Meeting` | `ems__Meeting` |
| Initiative | `ems:Initiative` | `ems__Initiative` |
| TaskPrototype | `ems:TaskPrototype` | `ems__TaskPrototype` |
| MeetingPrototype | `ems:MeetingPrototype` | `ems__MeetingPrototype` |

### Query Examples

```sparql
# Find all tasks
SELECT ?task WHERE { ?task exo:Instance_class ems:Task }

# Find all projects
SELECT ?project WHERE { ?project exo:Instance_class ems:Project }

# Find all areas
SELECT ?area WHERE { ?area exo:Instance_class ems:Area }

# Find all prototypes
SELECT ?proto WHERE {
  { ?proto exo:Instance_class ems:TaskPrototype }
  UNION
  { ?proto exo:Instance_class ems:MeetingPrototype }
}
```

---

## Core Predicates (exo:)

These predicates apply to ALL asset types.

### exo:Asset_uid

**UUID identifier for the asset**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/exo#Asset_uid` |
| Frontmatter | `exo__Asset_uid` |
| Type | Literal (UUID v4 string) |
| Required | Yes |

```sparql
SELECT ?asset ?uid WHERE {
  ?asset exo:Asset_uid ?uid .
}
```

### exo:Asset_label

**Human-readable name**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/exo#Asset_label` |
| Frontmatter | `exo__Asset_label` |
| Type | Literal (string) |
| Required | Yes |

```sparql
SELECT ?asset ?label WHERE {
  ?asset exo:Asset_label ?label .
  FILTER(CONTAINS(?label, "Review"))
}
```

### exo:Asset_createdAt

**Creation timestamp**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/exo#Asset_createdAt` |
| Frontmatter | `exo__Asset_createdAt` |
| Type | Literal (ISO 8601 timestamp) |
| Required | Yes |

```sparql
SELECT ?asset ?created WHERE {
  ?asset exo:Asset_createdAt ?created .
  FILTER(STR(?created) >= "2025-11-01")
}
ORDER BY DESC(?created)
```

### exo:Instance_class

**Asset type classification**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/exo#Instance_class` |
| Frontmatter | `exo__Instance_class` |
| Type | IRI (class reference) |
| Required | Yes |

```sparql
SELECT ?asset ?class WHERE {
  ?asset exo:Instance_class ?class .
}
```

### exo:Asset_isArchived

**Archive status**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/exo#Asset_isArchived` |
| Frontmatter | `exo__Asset_isArchived` |
| Type | Literal (boolean) |
| Required | No |

```sparql
SELECT ?asset ?label WHERE {
  ?asset exo:Asset_label ?label .
  ?asset exo:Asset_isArchived "true" .
}
```

### exo:Asset_prototype

**Reference to template/prototype**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/exo#Asset_prototype` |
| Frontmatter | `exo__Asset_prototype` |
| Type | IRI (reference to prototype note) |
| Required | For instances from prototypes |

```sparql
SELECT ?task ?label ?prototype WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task exo:Asset_prototype ?prototype .
}
```

### exo:Asset_isDefinedBy

**Ontology reference**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/exo#Asset_isDefinedBy` |
| Frontmatter | `exo__Asset_isDefinedBy` |
| Type | IRI (reference to ontology note) |
| Required | Yes |

```sparql
SELECT ?asset ?ontology WHERE {
  ?asset exo:Asset_isDefinedBy ?ontology .
}
```

---

## Effort Management Predicates (ems:)

These predicates apply to efforts (Tasks, Projects, Meetings).

### ems:Effort_status

**Current workflow status**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_status` |
| Frontmatter | `ems__Effort_status` |
| Type | IRI (status class reference) |
| Values | See [Status Values](#status-values) |

```sparql
SELECT ?task ?label ?status WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_status ?status .
  FILTER(CONTAINS(STR(?status), "Doing"))
}
```

### ems:Effort_area

**Parent area reference**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_area` |
| Frontmatter | `ems__Effort_area` |
| Type | IRI (reference to area note) |
| Required | For tasks created from areas |

```sparql
SELECT ?task ?label ?area WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_area ?area .
}
```

### ems:Effort_parent

**Parent project/initiative reference**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_parent` |
| Frontmatter | `ems__Effort_parent` |
| Type | IRI (reference to project/initiative note) |
| Required | For tasks/projects with parent |

```sparql
SELECT ?task ?label ?project WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_parent ?project .
}
```

### ems:Effort_votes

**Priority vote count**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_votes` |
| Frontmatter | `ems__Effort_votes` |
| Type | Literal (integer) |
| Default | 0 |

```sparql
SELECT ?task ?label ?votes WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_votes ?votes .
  FILTER(?votes > 0)
}
ORDER BY DESC(?votes)
```

### ems:Effort_day

**Planned execution day**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_day` |
| Frontmatter | `ems__Effort_day` |
| Type | IRI or Literal (date reference) |
| Format | WikiLink to date: `[[YYYY-MM-DD]]` |

```sparql
SELECT ?task ?label ?day WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_day ?day .
  FILTER(CONTAINS(STR(?day), "2025-11-30"))
}
```

### ems:Effort_startTimestamp

**When effort started (entered Doing)**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_startTimestamp` |
| Frontmatter | `ems__Effort_startTimestamp` |
| Type | Literal (ISO 8601 timestamp) |

```sparql
SELECT ?task ?label ?started WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_startTimestamp ?started .
}
ORDER BY DESC(?started)
```

### ems:Effort_endTimestamp

**When effort paused/stopped**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_endTimestamp` |
| Frontmatter | `ems__Effort_endTimestamp` |
| Type | Literal (ISO 8601 timestamp) |

```sparql
SELECT ?task ?label ?ended WHERE {
  ?task ems:Effort_endTimestamp ?ended .
  ?task exo:Asset_label ?label .
}
```

### ems:Effort_resolutionTimestamp

**When effort completed (moved to Done)**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_resolutionTimestamp` |
| Frontmatter | `ems__Effort_resolutionTimestamp` |
| Type | Literal (ISO 8601 timestamp) |

```sparql
SELECT ?task ?label ?completed WHERE {
  ?task ems:Effort_resolutionTimestamp ?completed .
  ?task exo:Asset_label ?label .
  FILTER(STR(?completed) >= "2025-11-25")
}
ORDER BY DESC(?completed)
```

### ems:Effort_plannedStartTimestamp

**Planned start time (for scheduling)**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Effort_plannedStartTimestamp` |
| Frontmatter | `ems__Effort_plannedStartTimestamp` |
| Type | Literal (ISO 8601 timestamp) |

```sparql
SELECT ?task ?label ?planned WHERE {
  ?task ems:Effort_plannedStartTimestamp ?planned .
  ?task exo:Asset_label ?label .
}
ORDER BY ?planned
```

### ems:Task_size

**Task size estimate**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Task_size` |
| Frontmatter | `ems__Task_size` |
| Type | Literal (S, M, L, XL) |
| Applies to | Tasks only |

```sparql
SELECT ?task ?label ?size WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Task_size ?size .
}
```

### ems:Area_parent

**Parent area (for area hierarchy)**

| Property | Value |
|----------|-------|
| URI | `https://exocortex.my/ontology/ems#Area_parent` |
| Frontmatter | `ems__Area_parent` |
| Type | IRI (reference to parent area note) |
| Applies to | Areas only |

```sparql
SELECT ?area ?label ?parent WHERE {
  ?area exo:Instance_class ems:Area .
  ?area exo:Asset_label ?label .
  OPTIONAL { ?area ems:Area_parent ?parent }
}
```

---

## Status Values

### Status URIs

| Status | URI | Frontmatter Value |
|--------|-----|-------------------|
| Draft | `ems:EffortStatusDraft` | `ems__EffortStatusDraft` |
| Backlog | `ems:EffortStatusBacklog` | `ems__EffortStatusBacklog` |
| Analysis | `ems:EffortStatusAnalysis` | `ems__EffortStatusAnalysis` |
| ToDo | `ems:EffortStatusToDo` | `ems__EffortStatusToDo` |
| Doing | `ems:EffortStatusDoing` | `ems__EffortStatusDoing` |
| Done | `ems:EffortStatusDone` | `ems__EffortStatusDone` |
| Trashed | `ems:EffortStatusTrashed` | `ems__EffortStatusTrashed` |

### Status Workflow

```
Draft → Backlog → Analysis → ToDo → Doing → Done
          ↓                            ↓
        Trashed ←──────────────────────┘
```

### Query by Status

```sparql
# Tasks in Backlog
SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_status ?status .
  FILTER(CONTAINS(STR(?status), "Backlog"))
}

# Tasks NOT done or trashed
SELECT ?task ?label ?status WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_status ?status .
  FILTER(!CONTAINS(STR(?status), "Done"))
  FILTER(!CONTAINS(STR(?status), "Trashed"))
}
```

---

## URI Patterns

### Note URIs

Notes are represented as IRIs with the `obsidian://vault/` scheme:

```
obsidian://vault/{encoded-path}
```

Example:
- Note path: `Tasks/Review PR #123.md`
- URI: `obsidian://vault/Tasks%2FReview%20PR%20%23123.md`

### Predicate URIs

Predicates follow the pattern:
```
https://exocortex.my/ontology/{namespace}#{PropertyName}
```

Examples:
- `https://exocortex.my/ontology/exo#Asset_label`
- `https://exocortex.my/ontology/ems#Effort_status`

### Class URIs

Classes follow the pattern:
```
https://exocortex.my/ontology/ems#{ClassName}
```

Examples:
- `https://exocortex.my/ontology/ems#Task`
- `https://exocortex.my/ontology/ems#Project`

---

## Example Queries by Class

### Tasks

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?status ?area ?votes ?size WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  OPTIONAL { ?task ems:Effort_status ?status }
  OPTIONAL { ?task ems:Effort_area ?area }
  OPTIONAL { ?task ems:Effort_votes ?votes }
  OPTIONAL { ?task ems:Task_size ?size }
}
ORDER BY DESC(?votes) ?label
```

### Projects

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?project ?label ?status ?area ?votes WHERE {
  ?project exo:Instance_class ems:Project .
  ?project exo:Asset_label ?label .
  OPTIONAL { ?project ems:Effort_status ?status }
  OPTIONAL { ?project ems:Effort_area ?area }
  OPTIONAL { ?project ems:Effort_votes ?votes }
}
ORDER BY ?label
```

### Areas

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

### All Efforts (Tasks + Projects + Meetings)

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?effort ?label ?class ?status WHERE {
  ?effort exo:Instance_class ?class .
  ?effort exo:Asset_label ?label .
  OPTIONAL { ?effort ems:Effort_status ?status }
  FILTER(
    ?class = ems:Task ||
    ?class = ems:Project ||
    ?class = ems:Meeting
  )
}
ORDER BY ?class ?label
```

---

## Related Documentation

- [SPARQL Guide](SPARQL_GUIDE.md) - Complete query reference
- [SPARQL Cookbook](SPARQL_COOKBOOK.md) - Practical examples
- [Property Schema](../../../docs/PROPERTY_SCHEMA.md) - Frontmatter properties

---

**Maintainer**: @kitelev
**Related Issues**: #492 (SPARQL Documentation)
