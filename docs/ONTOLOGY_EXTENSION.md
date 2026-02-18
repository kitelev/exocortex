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
- Default ontology asset set in plugin settings

## Understanding the Ontology Structure

### Where the Ontology Lives

Ontology definitions are stored in markdown notes with frontmatter. The plugin recognizes ontology files by:

```yaml
---
exo__Instance_class: exo__Ontology
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

Add the property definition to your ontology file. The property must include:

1. **URI**: Unique identifier following naming conventions
2. **rdfs:domain**: Which class(es) have this property
3. **rdfs:range**: What type of value it holds
4. **rdfs:label**: Human-readable name (shown in modal)
5. **rdfs:comment** (optional): Description (shown as tooltip)

#### Example: Add Priority Property to Tasks

```turtle
# In your ontology file body:

ems:Task_priority a rdf:Property ;
    rdfs:domain ems:Task ;
    rdfs:range xsd:integer ;
    rdfs:label "Priority" ;
    rdfs:comment "Task priority (1-5, where 1 is highest)" .
```

In markdown frontmatter format:

```yaml
---
exo__Instance_class: rdf__Property
exo__Asset_label: "Task Priority"
rdf__Property_domain: "[[ems__Task]]"
rdf__Property_range: xsd:integer
rdfs__label: "Priority"
rdfs__comment: "Task priority (1-5, where 1 is highest)"
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
exo__Instance_class: myns__Sprint
exo__Asset_label: "Sprint 42"
myns__Sprint_velocity: 21
myns__Sprint_goal: "Complete user authentication"
---
```

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
exo__Instance_class: rdfs__Class
exo__Asset_label: "Team"
rdfs__subClassOf: "[[exo__Asset]]"
rdfs__comment: "A group of people working together"
---

# Team Class

Represents a team that can be assigned to projects and tasks.
```

### 2. Add Team Property to Efforts

```yaml
---
exo__Instance_class: rdf__Property
exo__Asset_label: "Team"
rdf__Property_domain: "[[ems__Effort]]"
rdf__Property_range: "[[myns__Team]]"
rdfs__label: "Team"
rdfs__comment: "The team responsible for this effort"
---

# Team Property

Assigns a team to any effort (task, project, meeting, etc.).
```

### 3. Create Team Instances

```yaml
---
exo__Instance_class: myns__Team
exo__Asset_label: "Frontend Team"
myns__Team_memberCount: 5
---

# Frontend Team

The team responsible for UI development.
```

### 4. Use in Tasks

```yaml
---
exo__Instance_class: ems__Task
exo__Asset_label: "Implement login form"
ems__Effort_team: "[[Frontend Team]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
```

## Validation Checklist

Before expecting your property to appear in modals:

- [ ] Property has `rdfs:domain` matching target class (or parent class)
- [ ] Property has `rdfs:range` with recognized type
- [ ] Property has `rdfs:label` for display name
- [ ] Property is NOT marked `owl:deprecated true`
- [ ] Ontology file has `exo__Instance_class: exo__Ontology`
- [ ] Default ontology is set in plugin settings

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

- [SPARQL User Guide](./sparql/User-Guide.md) - Query your ontology
- [Property Schema Reference](./PROPERTY_SCHEMA.md) - Standard properties
- [ExoRDF Mapping](./rdf/ExoRDF-Mapping.md) - RDF/RDFS mapping details
