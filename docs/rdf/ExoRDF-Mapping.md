# ExoRDF to RDF/RDFS Mapping Specification

**Version**: 1.0
**Last Updated**: 2025-11-12
**Status**: Specification
**Purpose**: Define semantic interoperability between Exocortex's ExoRDF framework and W3C RDF/RDFS standards

---

## 📖 Table of Contents

1. [Overview](#overview)
2. [Why Semantic Interoperability Matters](#why-semantic-interoperability-matters)
3. [Class Mappings](#class-mappings)
4. [Property Mappings](#property-mappings)
5. [URI Construction Strategy](#uri-construction-strategy)
6. [RDF Triple Examples](#rdf-triple-examples)
7. [SPARQL Query Examples](#sparql-query-examples)
8. [Inference and Reasoning](#inference-and-reasoning)
9. [Implementation Notes](#implementation-notes)
10. [References](#references)

---

## 📐 Overview

### What is ExoRDF?

**ExoRDF** (Exocortex RDF Framework) is a custom ontology for knowledge management built on semantic web principles. It extends standard RDF/RDFS with domain-specific concepts for personal knowledge management, task tracking, and information organization.

### Core Namespaces

| Prefix | Namespace IRI | Purpose |
|--------|---------------|---------|
| `exo:` | `https://exocortex.my/ontology/exo#` | Core universal properties (all assets) |
| `ems:` | `https://exocortex.my/ontology/ems#` | Effort Management System (tasks, projects) |
| `rdf:` | `http://www.w3.org/1999/02/22-rdf-syntax-ns#` | RDF core vocabulary |
| `rdfs:` | `http://www.w3.org/2000/01/rdf-schema#` | RDF Schema vocabulary |
| `owl:` | `http://www.w3.org/2002/07/owl#` | Web Ontology Language |
| `xsd:` | `http://www.w3.org/2001/XMLSchema#` | XML Schema datatypes |

### Mapping Strategy

ExoRDF classes and properties are **subclasses** and **subproperties** of standard RDF/RDFS concepts, not equivalents. This preserves:

- **Semantic extension**: ExoRDF adds domain-specific meaning
- **Backward compatibility**: Standard RDF/RDFS queries still work
- **Interoperability**: Tools understanding RDF/RDFS can process Exocortex data
- **Inference**: SPARQL can use transitive relationships (`rdfs:subClassOf*`)

---

## 🎯 Why Semantic Interoperability Matters

### Benefits for Users

1. **Standard SPARQL queries**: Use `rdf:type` instead of custom predicates
2. **Tool compatibility**: Export to semantic web tools (Protégé, OntoGraf, etc.)
3. **Reasoning support**: Infer relationships via class/property hierarchies
4. **Future-proofing**: Align with semantic web ecosystem

### Benefits for Developers

1. **Clear semantics**: Explicit relationships to W3C standards
2. **Validation**: Use standard RDF validators
3. **Reusable patterns**: Leverage existing RDF/RDFS patterns
4. **Interoperability**: Integrate with other semantic systems

### Example Use Case

**User wants all tasks (including subtypes)**:

```sparql
# ❌ WITHOUT mapping: Must know all task subtypes
SELECT ?task WHERE {
  ?task exo:Instance_class ?type .
  FILTER (?type IN (ems:Task, ems:Subtask, ems:Milestone))
}

# ✅ WITH mapping: Automatic via rdfs:subClassOf
SELECT ?task WHERE {
  ?task rdf:type/rdfs:subClassOf* ems:Task .
}
```

---

## 🏷️ Class Mappings

ExoRDF defines classes that are **subclasses** of RDF/RDFS classes.

### Core Class Hierarchy

```turtle
# ExoRDF classes extend RDF/RDFS classes
exo:Asset     rdfs:subClassOf  rdfs:Resource .
exo:Class     rdfs:subClassOf  rdfs:Class .
exo:Property  rdfs:subClassOf  rdf:Property .

# EMS classes extend exo:Asset
ems:Task      rdfs:subClassOf  exo:Asset .
ems:Project   rdfs:subClassOf  exo:Asset .
ems:Area      rdfs:subClassOf  exo:Asset .
```

### Mapping Table

| ExoRDF Class | RDF/RDFS Superclass | Relationship | Rationale |
|--------------|---------------------|--------------|-----------|
| `exo:Asset` | `rdfs:Resource` | `rdfs:subClassOf` | All Exocortex entities are RDF resources |
| `exo:Class` | `rdfs:Class` | `rdfs:subClassOf` | ExoRDF classes are also RDF classes |
| `exo:Property` | `rdf:Property` | `rdfs:subClassOf` | ExoRDF properties are also RDF properties |
| `ems:Task` | `exo:Asset` | `rdfs:subClassOf` | Tasks are specialized assets |
| `ems:Project` | `exo:Asset` | `rdfs:subClassOf` | Projects are specialized assets |
| `ems:Area` | `exo:Asset` | `rdfs:subClassOf` | Areas are specialized assets |

### Visual Hierarchy

```
rdfs:Resource
    └── exo:Asset
            ├── ems:Task
            ├── ems:Project
            └── ems:Area

rdfs:Class
    └── exo:Class

rdf:Property
    └── exo:Property
```

---

## 🔗 Property Mappings

ExoRDF properties are **subproperties** of RDF/RDFS properties.

### Core Property Mappings

| ExoRDF Property | RDF/RDFS Superproperty | Relationship | Purpose |
|-----------------|------------------------|--------------|---------|
| `exo:Instance_class` | `rdf:type` | `rdfs:subPropertyOf` | Asset type classification |
| `exo:Asset_isDefinedBy` | `rdfs:isDefinedBy` | `rdfs:subPropertyOf` | Ontology reference |
| `exo:Class_superClass` | `rdfs:subClassOf` | `rdfs:subPropertyOf` | Class hierarchy |
| `exo:Property_range` | `rdfs:range` | `rdfs:subPropertyOf` | Property value type |
| `exo:Property_domain` | `rdfs:domain` | `rdfs:subPropertyOf` | Property applies to |
| `exo:Property_superProperty` | `rdfs:subPropertyOf` | `rdfs:subPropertyOf` | Property hierarchy |

### Triples Representation

```turtle
# Property hierarchy triples (generated once at initialization)
exo:Instance_class     rdfs:subPropertyOf  rdf:type .
exo:Asset_isDefinedBy  rdfs:subPropertyOf  rdfs:isDefinedBy .
exo:Class_superClass   rdfs:subPropertyOf  rdfs:subClassOf .
exo:Property_range     rdfs:subPropertyOf  rdfs:range .
exo:Property_domain    rdfs:subPropertyOf  rdfs:domain .
exo:Property_superProperty rdfs:subPropertyOf rdfs:subPropertyOf .
```

### Dual Triple Generation

For each asset, the triple store generates **both** ExoRDF and RDF/RDFS triples:

**Input** (Obsidian frontmatter):
```yaml
exo__Instance_class: ems__Task
```

**Output** (RDF triples):
```turtle
# ExoRDF triple (custom predicate)
<asset-uri> exo:Instance_class ems:Task .

# RDF/RDFS triple (standard predicate)
<asset-uri> rdf:type ems:Task .
```

**Why both?**
- **ExoRDF triple**: Preserves original property name for tooling
- **RDF/RDFS triple**: Enables standard SPARQL queries and inference

---

## 🆔 URI Construction Strategy

### Pattern

**Format**: `http://${ontology_url}/${asset_uid}`

**Components**:
- `${ontology_url}`: From asset's `exo__Asset_isDefinedBy` ontology file
- `${asset_uid}`: Asset's `exo__Asset_uid` (UUID v4)

### Why UID-Based, Not Filename-Based?

| Approach | Stability | Uniqueness | Semantic Web Compatibility |
|----------|-----------|------------|----------------------------|
| **Filename-based** | ❌ Breaks on rename | ⚠️ Path collisions | ❌ Non-standard |
| **UID-based** | ✅ Stable across renames | ✅ Globally unique | ✅ Standard practice |

**Rationale**:
- **Stability**: UIDs never change, filenames can be renamed
- **Uniqueness**: UUID v4 provides global uniqueness (2^122 possible values)
- **Semantic Web**: Standard practice in RDF systems (DBpedia, Wikidata, etc.)

### URI Construction Algorithm

```typescript
function constructAssetURI(asset: AssetMetadata): string {
  // 1. Extract UID
  const uid = asset.frontmatter?.exo__Asset_uid;
  if (!uid) {
    throw new Error("Missing exo__Asset_uid");
  }

  // 2. Resolve ontology URL
  const ontologyRef = asset.frontmatter?.exo__Asset_isDefinedBy; // "[[Ontology/EMS]]"
  const ontologyFile = vault.getFileByPath(extractWikiLink(ontologyRef));
  const ontologyMetadata = readFrontmatter(ontologyFile);
  const ontologyURL = ontologyMetadata?.exo__Ontology_url || "https://exocortex.my/default/";

  // 3. Construct URI
  const baseURL = ontologyURL.endsWith("/") ? ontologyURL : `${ontologyURL}/`;
  return `${baseURL}${uid}`;
}
```

### Example

**Asset frontmatter**:
```yaml
exo__Asset_uid: 550e8400-e29b-41d4-a716-446655440000
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
exo__Instance_class: ems__Task
```

**Ontology frontmatter** (`Ontology/EMS.md`):
```yaml
exo__Ontology_url: https://exocortex.my/ontology/ems/
```

**Result**:
```
URI: https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000
```

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Missing `exo__Asset_uid` | **Throw error** (strict mode) or use fallback (filename) with warning |
| Missing `exo__Asset_isDefinedBy` | Use default ontology URL: `https://exocortex.my/default/` |
| Invalid ontology URL | Validate HTTP(S) protocol, throw error if invalid |
| Ontology file not found | Use default ontology URL with warning |

---

## 📊 RDF Triple Examples

### Example 1: Simple Task

**Obsidian Note** (`Review PR #365.md`):
```yaml
---
exo__Asset_uid: 550e8400-e29b-41d4-a716-446655440000
exo__Instance_class: ems__Task
exo__Asset_label: Review PR #365
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
ems__Effort_status: "[[ems__EffortStatusInProgress]]"
ems__Task_size: M
---
```

**Generated RDF Triples**:
```turtle
@prefix exo: <https://exocortex.my/ontology/exo#> .
@prefix ems: <https://exocortex.my/ontology/ems#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000>
    # ExoRDF triples
    exo:Instance_class ems:Task ;
    exo:Asset_label "Review PR #365" ;
    exo:Asset_isDefinedBy <https://exocortex.my/ontology/ems/ontology-uid> ;
    ems:Effort_status ems:EffortStatusInProgress ;
    ems:Task_size "M" ;

    # RDF/RDFS triples (additional, for interoperability)
    rdf:type ems:Task ;
    rdfs:label "Review PR #365" ;
    rdfs:isDefinedBy <https://exocortex.my/ontology/ems/ontology-uid> .
```

### Example 2: Project with Tasks

**Project Note** (`Implement SPARQL Engine.md`):
```yaml
---
exo__Asset_uid: 7c9e6679-7425-40de-944b-e07fc1f90ae7
exo__Instance_class: ems__Project
exo__Asset_label: Implement SPARQL Engine
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
---
```

**Task Note** (`Fix SPARQL Parser.md`):
```yaml
---
exo__Asset_uid: 3b241101-e2bb-4255-8caf-4136c566a964
exo__Instance_class: ems__Task
ems__Effort_parent: "[[Implement SPARQL Engine]]"
---
```

**Generated RDF Triples**:
```turtle
# Project
<https://exocortex.my/ontology/ems/7c9e6679-7425-40de-944b-e07fc1f90ae7>
    rdf:type ems:Project ;
    exo:Instance_class ems:Project ;
    rdfs:label "Implement SPARQL Engine" .

# Task
<https://exocortex.my/ontology/ems/3b241101-e2bb-4255-8caf-4136c566a964>
    rdf:type ems:Task ;
    exo:Instance_class ems:Task ;
    ems:Effort_parent <https://exocortex.my/ontology/ems/7c9e6679-7425-40de-944b-e07fc1f90ae7> .
```

---

## 🔍 SPARQL Query Examples

### Example 1: Find All Tasks

**Using ExoRDF predicates**:
```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label
WHERE {
  ?task exo:Instance_class ems:Task ;
        exo:Asset_label ?label .
}
```

**Using RDF/RDFS predicates** (after mapping):
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label
WHERE {
  ?task rdf:type ems:Task ;
        rdfs:label ?label .
}
```

### Example 2: Find All Assets (Using Inference)

**Query all asset types via `rdfs:subClassOf` inference**:
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?type ?label
WHERE {
  ?asset rdf:type ?type .
  ?type rdfs:subClassOf* exo:Asset .
  OPTIONAL { ?asset rdfs:label ?label }
}
```

**Results** (includes tasks, projects, areas):
```
asset                                                              type        label
===================================================================================================
https://exocortex.my/ontology/ems/550e8400-e29b-41d4...           ems:Task    "Review PR #365"
https://exocortex.my/ontology/ems/7c9e6679-7425-40de...           ems:Project "Implement SPARQL"
https://exocortex.my/ontology/ems/a1b2c3d4-e5f6-7890...           ems:Area    "Development"
```

### Example 3: Class Hierarchy Query

**Find all subclasses of `exo:Asset`**:
```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?subclass
WHERE {
  ?subclass rdfs:subClassOf+ exo:Asset .
}
```

**Results**:
```
subclass
==================
ems:Task
ems:Project
ems:Area
```

### Example 4: Property Hierarchy Query

**Find all superproperties of `exo:Instance_class`**:
```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?superproperty
WHERE {
  exo:Instance_class rdfs:subPropertyOf+ ?superproperty .
}
```

**Results**:
```
superproperty
========================
rdf:type
rdfs:subPropertyOf
```

### Additional Query Examples

For more RDF/RDFS query patterns and examples, see:

- **[SPARQL User Guide](../sparql/User-Guide.md)** - Section "Using Standard RDF/RDFS Vocabulary"
- **[SPARQL Query Examples](../sparql/Query-Examples.md)** - Section "RDF/RDFS Standard Queries" (10+ examples)
- **[SPARQL Developer Guide](../sparql/Developer-Guide.md)** - Section "ExoRDF to RDF/RDFS Mapping Architecture"
- **[SPARQL Performance Tips](../sparql/Performance-Tips.md)** - Section "RDF/RDFS Inference Performance"

---

## 🧠 Inference and Reasoning

### RDFS Inference Rules

When RDF/RDFS mapping is active, SPARQL queries support these inference capabilities:

#### 1. Transitive Subclass Queries

**Rule**: If `A rdfs:subClassOf B` and `B rdfs:subClassOf C`, then `A rdfs:subClassOf C`.

**Example**:
```sparql
# Find all resources (including tasks via ems:Task rdfs:subClassOf exo:Asset rdfs:subClassOf rdfs:Resource)
SELECT ?resource WHERE {
  ?resource rdf:type/rdfs:subClassOf* rdfs:Resource .
}
```

#### 2. Transitive Subproperty Queries

**Rule**: If `P rdfs:subPropertyOf Q` and `Q rdfs:subPropertyOf R`, then `P rdfs:subPropertyOf R`.

**Example**:
```sparql
# Find all instances (using exo:Instance_class → rdf:type chain)
SELECT ?instance ?type WHERE {
  ?instance ?property ?type .
  ?property rdfs:subPropertyOf rdf:type .
}
```

#### 3. Domain and Range Inference

**Rule**: If `P rdfs:domain C` and `?s P ?o`, then `?s rdf:type C`.

**Example**:
```sparql
# Automatically infer asset types from properties used
SELECT ?asset WHERE {
  ?asset ems:Effort_status ?status .  # Implies ?asset rdf:type ems:Task (if ems:Effort_status rdfs:domain ems:Task)
}
```

### Performance Considerations

| Inference Type | Complexity | Performance |
|----------------|------------|-------------|
| Direct property/class lookup | O(1) | < 1ms (index-based) |
| `rdfs:subClassOf` (1 level) | O(n) | < 10ms (n = subclasses) |
| `rdfs:subClassOf*` (transitive) | O(n²) | < 100ms (n = hierarchy depth) |
| Full graph reasoning | O(2^n) | > 1s (requires reasoning engine) |

**Recommendation**: Use `rdfs:subClassOf*` sparingly in production queries. Cache results when possible.

---

## 💡 Implementation Notes

### Storage-Agnostic Design

The mapping implementation **must not** depend on Obsidian-specific APIs. It should work in:

- ✅ Obsidian plugin (via `IFileSystemAdapter`)
- ✅ CLI tool (reading markdown files directly)
- ✅ Web interface (via API)

### Triple Generation Phases

1. **Initialization Phase** (once):
   - Generate class hierarchy triples (`exo:Asset rdfs:subClassOf rdfs:Resource`)
   - Generate property hierarchy triples (`exo:Instance_class rdfs:subPropertyOf rdf:type`)

2. **Asset Loading Phase** (per asset):
   - Generate ExoRDF triples (custom predicates)
   - Generate mapped RDF/RDFS triples (standard predicates)

### Memory Overhead

Expected memory increase: **~15-20%** (dual triples for mapped properties).

**Example**:
- 1000 assets × 10 properties each = 10,000 ExoRDF triples
- ~6 mapped properties × 1000 assets = 6,000 additional RDF/RDFS triples
- Total: 16,000 triples (~15% increase)

### Backward Compatibility

- ✅ Existing SPARQL queries using `exo:Instance_class` continue to work
- ✅ New queries can use `rdf:type` for standard compatibility
- ✅ Both predicates return same results (dual triples)

---

## 📚 References

### W3C Standards

- [RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/)
- [RDF Schema 1.1](https://www.w3.org/TR/rdf-schema/)
- [SPARQL 1.1 Query Language](https://www.w3.org/TR/sparql11-query/)
- [SPARQL 1.1 Entailment Regimes](https://www.w3.org/TR/sparql11-entailment/)

### Exocortex Documentation

- [Property Schema Reference](../PROPERTY_SCHEMA.md) - Complete frontmatter property definitions
- [SPARQL User Guide](../sparql/User-Guide.md) - Query syntax and examples
- [SPARQL Developer Guide](../sparql/Developer-Guide.md) - API and architecture

### Related Issues

- [#366: Implement UID-Based URI Construction](https://github.com/kitelev/exocortex/issues/366)
- [#367: Integrate ExoRDF to RDF/RDFS Mapping into Triple Store](https://github.com/kitelev/exocortex/issues/367)
- [#368: Add Tests for ExoRDF to RDF/RDFS Mapping](https://github.com/kitelev/exocortex/issues/368)

---

## 🔄 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-12 | Initial specification |

---

**Next Steps**: This specification defines the mapping. Implementation happens in:
1. Issue #366: URI construction utilities
2. Issue #367: Triple store integration
3. Issue #368: Comprehensive tests
