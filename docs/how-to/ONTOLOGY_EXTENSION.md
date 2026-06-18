# Ontology Extension Guide

> Learn how to extend the Exocortex ontology with custom properties that automatically appear in asset creation modals.

## Overview

The Exocortex ontology defines the structure of your knowledge base: what types of assets exist (Task, Project, Area, etc.) and what properties they have. The plugin reads this ontology to understand the schema of your knowledge base.

This guide shows you how to:

1. Understand the existing ontology structure
2. Add custom properties to existing classes
3. Create new classes with their own properties
4. Validate your ontology extensions

## Prerequisites

- Basic understanding of RDF/RDFS concepts
- Exocortex plugin installed and configured

## Understanding the Ontology Structure

### Where the Ontology Lives

Ontology definitions are stored in markdown notes with frontmatter. The plugin recognizes ontology files by:

```yaml
---
exo__Instance_class:
  - "[[exo__Ontology]]"
exo__Ontology_url: "https://exocortex.my/ontology/ems#"
---
```

### Class Hierarchy

The Exocortex ontology follows a class hierarchy:

```
exo__Asset (base class)
├── ems__Effort (time-tracked work)
│   ├── ems__Task (individual task)
│   ├── ems__Project (collection of tasks)
│   ├── ems__Meeting (scheduled event)
│   └── ems__Initiative (high-level goal)
├── ems__Area (organizational container)
├── pn__DailyNote (daily planning note)
└── exo__Ontology (ontology definition)
```

### Property Domains

Properties are linked to classes via `rdfs:domain`:

```turtle
# This property belongs to ems__Effort and all its subclasses
ems:Effort_status a rdf:Property ;
    rdfs:domain ems:Effort ;
    rdfs:range ems:EffortStatus .
```

When you add a property with `rdfs:domain ems:Effort`, it automatically appears in creation modals for:
- `ems__Task` (extends Effort)
- `ems__Project` (extends Effort)
- `ems__Meeting` (extends Effort)
- `ems__Initiative` (extends Effort)

## Adding Custom Properties

### Step 1: Choose the Right Domain

Decide which class(es) should have your new property:

| If you want the property on... | Set rdfs:domain to... |
|-------------------------------|----------------------|
| All assets | `exo:Asset` |
| All time-tracked work | `ems:Effort` |
| Tasks only | `ems:Task` |
| Projects only | `ems:Project` |
| Areas only | `ems:Area` |

### Step 2: Define the Property

A property is authored as a regular Markdown asset whose frontmatter uses the
**`exo__` vocabulary**. The converter (`NoteToRDFConverter` +
`RDFVocabularyMapper`) maps these keys to the standard RDFS triples that modal
discovery queries:

| Frontmatter key                             | Emitted W3C triple                          | Purpose                                  |
| ------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| `exo__Instance_class: "[[exo__Property]]"`  | `rdf:type`                                  | Marks the asset as a property definition |
| `exo__Property_domain: "[[<class>]]"`       | `rdfs:domain`                               | Which class(es) have this property       |
| `exo__Property_range`                       | `rdfs:range` (for class/wikilink ranges)    | What type of value it holds              |
| `exo__Asset_label`                          | `rdfs:label`                                | Human-readable name (shown in modal)     |
| `exo__Property_superProperty` (optional)    | `rdfs:subPropertyOf`                        | Parent property                          |

For datatype ranges, `exo__Property_range` takes a literal `xsd:` string
(`xsd:string`, `xsd:integer`, `xsd:dateTime`, `xsd:boolean`); for object
ranges it takes a wikilink to the range class.

> ⚠️ **Do not use `rdf__*` / `rdfs__*` frontmatter keys** (e.g.
> `rdf__Property_domain`, `rdfs__label`). `rdf` and `rdfs` are not registered
> namespace prefixes in the converter, so such keys resolve to ad-hoc
> `https://exocortex.my/ontology/rdf#...` IRIs — **not** the W3C vocabulary —
> and the discovery query (which matches W3C `rdfs:domain`) will never see the
> property.

#### Example: Add Priority Property to Tasks

```yaml
---
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: "Task Priority"
exo__Property_domain: "[[ems__Task]]"
exo__Property_range: xsd:integer
---

# Task Priority Property

This property defines the priority level for tasks.
```

### Step 3: Choose the Right Range Type

The `rdfs:range` determines what UI widget appears in the modal:

#### Text Input

```turtle
myns:Project_clientName a rdf:Property ;
    rdfs:domain ems:Project ;
    rdfs:range xsd:string ;
    rdfs:label "Client Name" .
```

#### Number Input

```turtle
myns:Project_budget a rdf:Property ;
    rdfs:domain ems:Project ;
    rdfs:range xsd:decimal ;
    rdfs:label "Budget" ;
    rdfs:comment "Project budget in dollars" .
```

#### DateTime Picker

```turtle
myns:Meeting_scheduledFor a rdf:Property ;
    rdfs:domain ems:Meeting ;
    rdfs:range xsd:dateTime ;
    rdfs:label "Scheduled For" .
```

#### Toggle (Boolean)

```turtle
myns:Task_requiresReview a rdf:Property ;
    rdfs:domain ems:Task ;
    rdfs:range xsd:boolean ;
    rdfs:label "Requires Review" ;
    rdfs:comment "Whether this task needs peer review before completion" .
```

#### Wikilink Reference

```turtle
myns:Task_assignee a rdf:Property ;
    rdfs:domain ems:Task ;
    rdfs:range ems:Person ;
    rdfs:label "Assignee" ;
    rdfs:comment "Person responsible for this task" .
```

### Step 4: Verify Properties

1. Navigate to a note where you can create the target asset type
2. Invoke the creation command
3. Verify your new property is recognized by the plugin via SPARQL queries

## Creating Custom Classes

### Step 1: Define the Class

```turtle
myns:Sprint a rdfs:Class ;
    rdfs:subClassOf ems:Effort ;
    rdfs:label "Sprint" ;
    rdfs:comment "A time-boxed development iteration" .
```

### Step 2: Add Class-Specific Properties

```turtle
myns:Sprint_velocity a rdf:Property ;
    rdfs:domain myns:Sprint ;
    rdfs:range xsd:integer ;
    rdfs:label "Velocity" ;
    rdfs:comment "Story points completed in this sprint" .

myns:Sprint_goal a rdf:Property ;
    rdfs:domain myns:Sprint ;
    rdfs:range xsd:string ;
    rdfs:label "Sprint Goal" .
```

### Step 3: Register for Commands

To use your custom class with Exocortex commands, instances must use the class name in frontmatter:

```yaml
---
exo__Instance_class:
  - "[[myns__Sprint]]"
exo__Asset_label: "Sprint 42"
myns__Sprint_velocity: 21
myns__Sprint_goal: "Complete user authentication"
---
```

## RDF-Driven Asset Creation

Asset creation itself is ontology-driven — the defaults and the one-click flow
are declared as vault assets, not hardcoded:

- **Universal Default Template (RFC `727572d2`).** A singleton
  `exocmd__UniversalDefaultTemplate` ABox asset declares vault-wide
  `PropertyDefault` and `InheritanceRule` entries. The engine
  (`UniversalDefaultTemplateResolver` + `CommandResolver`) merges these into
  every Grounding's `propertyDefault` / `inheritanceRule` lists at parse time;
  Grounding-local entries override Universal entries by `propertyName` /
  `targetPropertyName`. If the singleton is absent, the executor falls back to
  legacy TypeScript primitives with a warning.
- **One-click creation (RFC `ce27e55d`).** Two declarative properties remove
  the remaining manual steps:
  - `exocmd__Grounding_labelTemplate` — a template for the created asset's
    label, used when the user supplies none (before the `"Untitled"`
    fallback). Supports `$target.<prop>` (frontmatter of the current asset)
    and `$nowCompact` (filename-safe local timestamp with minute precision,
    `YYYY-MM-DD-HH-mm`) tokens.
  - `exocmd__Command_openInSameTab` — boolean; when `true`, the platform
    opener navigates the **current** tab to the newly created file instead of
    opening a new one.
- **Dynamic command labels.** `exocmd__Command_labelTemplate` resolves each
  `{...}` placeholder as a SPARQL SELECT query (with `$target` bound to the
  current asset's IRI), so button/command captions can be computed from the
  graph.

## Deprecating Properties

When a property is no longer recommended for use, mark it as deprecated:

```turtle
ems:Effort_oldStatus a rdf:Property ;
    rdfs:domain ems:Effort ;
    rdfs:range xsd:string ;
    rdfs:label "Old Status" ;
    owl:deprecated true .
```

Deprecated properties:
- Are hidden from creation modals
- Continue to work in existing assets
- Can be queried via SPARQL
- Should be migrated over time

## Namespace Conventions

### Standard Namespaces

| Prefix | URI | Purpose |
|--------|-----|---------|
| `exo` | `https://exocortex.my/ontology/exo#` | Core asset properties |
| `ems` | `https://exocortex.my/ontology/ems#` | Effort management system |
| `pn` | `https://exocortex.my/ontology/pn#` | Personal notes |
| `rdfs` | `http://www.w3.org/2000/01/rdf-schema#` | RDF Schema |
| `xsd` | `http://www.w3.org/2001/XMLSchema#` | XML Schema datatypes |
| `owl` | `http://www.w3.org/2002/07/owl#` | OWL ontology |

### Custom Namespace

For your own extensions, use a consistent prefix:

```turtle
# Define your namespace
@prefix myns: <https://example.com/ontology/myns#> .

# Use it for properties
myns:Task_customField a rdf:Property ;
    rdfs:domain ems:Task ;
    rdfs:range xsd:string .
```

In frontmatter, use double-underscore format:

```yaml
myns__Task_customField: "value"
```

## Complete Example: Adding a Team Property

### 1. Create the Team Class

```yaml
---
exo__Instance_class:
  - "[[exo__Class]]"
exo__Asset_label: "myns__Team"
exo__Class_superClass: "[[exo__Asset]]"
---

# Team Class

Represents a team that can be assigned to projects and tasks.
```

`exo__Class_superClass` is mapped to `rdfs:subClassOf` by the converter, so
the new class participates in domain inheritance.

### 2. Add Team Property to Efforts

```yaml
---
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: "Team"
exo__Property_domain: "[[ems__Effort]]"
exo__Property_range: "[[myns__Team]]"
---

# Team Property

Assigns a team to any effort (task, project, meeting, etc.).
```

### 3. Create Team Instances

```yaml
---
exo__Instance_class:
  - "[[myns__Team]]"
exo__Asset_label: "Frontend Team"
myns__Team_memberCount: 5
---

# Frontend Team

The team responsible for UI development.
```

### 4. Use in Tasks

```yaml
---
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: "Implement login form"
ems__Effort_team: "[[Frontend Team]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
```

## Validation Checklist

Before expecting your property to appear in modals:

- [ ] Property asset has `exo__Property_domain` matching target class (or parent class)
- [ ] Property asset has `exo__Property_range` with recognized type
- [ ] Property asset has `exo__Asset_label` for display name
- [ ] Property is NOT marked `owl:deprecated true`
- [ ] No `rdf__*` / `rdfs__*` frontmatter keys used (they do not map to W3C vocabulary)

## Troubleshooting

### Property Not Appearing in Modal

1. **Check domain**: Is `rdfs:domain` set to the correct class?
2. **Check inheritance**: Does the target class extend the domain class?
3. **Check deprecated**: Is `owl:deprecated` set to `true`?
4. **Refresh ontology**: Close and reopen the modal

### Wrong Field Type

1. **Check range**: Is `rdfs:range` using a recognized type?
2. **Use standard types**: Prefer `xsd:string`, `xsd:dateTime`, `xsd:integer`, `xsd:boolean`
3. **For dropdowns**: Range must reference a class like `ems:EffortStatus`

### SPARQL Verification

Use the Query Builder to verify your ontology:

```sparql
# List all properties for a class
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?property ?label ?range WHERE {
  ?property rdfs:domain ems:Task .
  OPTIONAL { ?property rdfs:label ?label }
  OPTIONAL { ?property rdfs:range ?range }
}
ORDER BY ?label
```

## Related Documentation

- [Property Schema Reference](../reference/PROPERTY_SCHEMA.md) - Standard properties
- [ExoRDF Mapping](../explanation/ExoRDF-Mapping.md) - RDF/RDFS mapping details
