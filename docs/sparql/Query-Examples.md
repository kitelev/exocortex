# SPARQL Query Examples for Exocortex

A collection of practical, ready-to-use SPARQL queries for your Obsidian vault. Copy, paste, and adapt these examples to your needs!

## Table of Contents

1. [Basic Queries](#basic-queries)
2. [Task Management](#task-management)
3. [Project Organization](#project-organization)
4. [Relationships](#relationships)
5. [Time-Based Queries](#time-based-queries)
6. [Aggregation Examples](#aggregation-examples)
7. [Graph Construction](#graph-construction)
8. [Advanced Patterns](#advanced-patterns)
9. [Advanced Features (v2)](#advanced-features-v2)
   - [BIND Expressions](#bind-expressions)
   - [EXISTS and NOT EXISTS](#exists-and-not-exists)
   - [Property Paths](#property-paths)
   - [Subqueries](#subqueries)
   - [Custom Extension Functions](#custom-extension-functions)

---

## Basic Queries

### 1. List All Assets

Get all notes in your vault:

```sparql
SELECT ?asset ?label
WHERE {
  ?asset <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
LIMIT 100
```

**Use Case**: Quick overview of vault contents.

---

### 2. List All Entity Types

Find all unique entity classes in your vault:

```sparql
SELECT DISTINCT ?class
WHERE {
  ?asset <https://exocortex.my/ontology/exo#Instance_class> ?class .
}
```

**Result Example**:
- `ems__Task`
- `ems__Project`
- `ems__Area`

---

### 3. Count Assets by Type

Count how many assets of each type you have:

```sparql
SELECT ?class (COUNT(?asset) AS ?count)
WHERE {
  ?asset <https://exocortex.my/ontology/exo#Instance_class> ?class .
}
GROUP BY ?class
ORDER BY DESC(?count)
```

**Use Case**: Vault statistics dashboard.

---

## Task Management

### 4. All Active Tasks

List all non-archived tasks:

```sparql
SELECT ?task ?label ?status
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  OPTIONAL { ?task <https://exocortex.my/ontology/ems#Task_status> ?status . }
  FILTER NOT EXISTS {
    ?task <https://exocortex.my/ontology/exo#Asset_archived> ?archived .
    FILTER(?archived = true || ?archived = "true" || ?archived = "archived")
  }
}
ORDER BY ?label
```

**Use Case**: Daily task review.

---

### 5. Tasks by Status

Get tasks grouped by their status:

```sparql
SELECT ?status (COUNT(?task) AS ?count)
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
}
GROUP BY ?status
ORDER BY DESC(?count)
```

**Use Case**: Sprint progress tracking.

---

### 6. In-Progress Tasks

Show all tasks currently being worked on:

```sparql
SELECT ?task ?label ?project
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  ?task <https://exocortex.my/ontology/ems#Task_status> "in-progress" .
  OPTIONAL {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  }
}
ORDER BY ?project ?label
```

**Use Case**: Focus list for active work.

---

### 7. High-Effort Tasks

Find tasks with significant effort votes:

```sparql
SELECT ?task ?label ?votes
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  FILTER(?votes > 5)
}
ORDER BY DESC(?votes)
```

**Use Case**: Identify tasks requiring more time/resources.

---

### 8. Tasks Without Project

Find orphaned tasks not assigned to any project:

```sparql
SELECT ?task ?label ?status
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  OPTIONAL { ?task <https://exocortex.my/ontology/ems#Task_status> ?status . }
  FILTER NOT EXISTS {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  }
}
ORDER BY ?label
```

**Use Case**: Cleanup and organization.

---

### 9. Tasks by Priority

List tasks sorted by priority:

```sparql
SELECT ?task ?label ?priority
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  OPTIONAL { ?task <https://exocortex.my/ontology/ems#Task_priority> ?priority . }
}
ORDER BY ?priority ?label
```

**Use Case**: Priority-based task planning.

---

### 10. Recently Created Tasks

Find tasks created recently (assuming you have a creation date property):

```sparql
SELECT ?task ?label ?created
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  ?task <https://exocortex.my/ontology/exo#created_at> ?created .
  FILTER(?created > "2025-01-01")
}
ORDER BY DESC(?created)
LIMIT 20
```

**Use Case**: Review recent additions.

---

## Project Organization

### 11. All Projects with Task Count

List projects and count their tasks:

```sparql
SELECT ?project ?projectLabel (COUNT(?task) AS ?taskCount)
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  OPTIONAL {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  }
}
GROUP BY ?project ?projectLabel
ORDER BY DESC(?taskCount)
```

**Use Case**: Project workload overview.

---

### 12. Projects by Area

Group projects by their parent area:

```sparql
SELECT ?area ?areaLabel ?project ?projectLabel
WHERE {
  ?area <https://exocortex.my/ontology/exo#Instance_class> "ems__Area" .
  ?area <https://exocortex.my/ontology/exo#Asset_label> ?areaLabel .
  ?project <https://exocortex.my/ontology/ems#belongs_to_area> ?area .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
}
ORDER BY ?areaLabel ?projectLabel
```

**Use Case**: Hierarchical organization view.

---

### 13. Active Projects

Find projects with at least one in-progress task:

```sparql
SELECT DISTINCT ?project ?projectLabel
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  ?task <https://exocortex.my/ontology/ems#Task_status> "in-progress" .
}
ORDER BY ?projectLabel
```

**Use Case**: Focus on active projects.

---

### 14. Projects with No Tasks

Find empty projects that might need cleanup:

```sparql
SELECT ?project ?projectLabel
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  FILTER NOT EXISTS {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  }
}
ORDER BY ?projectLabel
```

**Use Case**: Cleanup stale projects.

---

### 15. Project Completion Rate

Calculate task completion percentage per project:

```sparql
SELECT ?project ?projectLabel
       (COUNT(?task) AS ?totalTasks)
       (SUM(IF(?status = "done", 1, 0)) AS ?doneTasks)
       (SUM(IF(?status = "done", 1, 0)) * 100 / COUNT(?task) AS ?completionRate)
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
}
GROUP BY ?project ?projectLabel
HAVING (COUNT(?task) > 0)
ORDER BY DESC(?completionRate)
```

**Use Case**: Progress tracking dashboard.

---

## Relationships

### 16. Task → Project → Area Hierarchy

Show full hierarchy for each task:

```sparql
SELECT ?task ?taskLabel ?project ?projectLabel ?area ?areaLabel
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  OPTIONAL {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
    ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
    OPTIONAL {
      ?project <https://exocortex.my/ontology/ems#belongs_to_area> ?area .
      ?area <https://exocortex.my/ontology/exo#Asset_label> ?areaLabel .
    }
  }
}
ORDER BY ?areaLabel ?projectLabel ?taskLabel
```

**Use Case**: Full context view for tasks.

---

### 17. Related Assets

Find assets linked to a specific note (replace path):

```sparql
SELECT ?related ?relatedLabel ?relationType
WHERE {
  <vault://path/to/your/note.md> ?relationType ?related .
  ?related <https://exocortex.my/ontology/exo#Asset_label> ?relatedLabel .
}
```

**Use Case**: Explore connections from a specific note.

---

### 18. Bidirectional Links

Find notes that link to each other:

```sparql
SELECT ?note1 ?note1Label ?note2 ?note2Label
WHERE {
  ?note1 <https://exocortex.my/ontology/exo#Asset_label> ?note1Label .
  ?note2 <https://exocortex.my/ontology/exo#Asset_label> ?note2Label .
  ?note1 <https://exocortex.my/ontology/exo#links_to> ?note2 .
  ?note2 <https://exocortex.my/ontology/exo#links_to> ?note1 .
  FILTER(?note1 != ?note2)
}
```

**Use Case**: Find tightly coupled concepts.

---

## Time-Based Queries

### 19. Tasks by Start Time

Find tasks scheduled for today (assuming time properties):

```sparql
SELECT ?task ?taskLabel ?startTime
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#Effort_startTime> ?startTime .
  FILTER(regex(?startTime, "2025-01-09"))
}
ORDER BY ?startTime
```

**Use Case**: Daily schedule planning.

---

### 20. Tasks by Duration

Find long-running tasks (high effort time):

```sparql
SELECT ?task ?taskLabel ?duration
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#Effort_duration_minutes> ?duration .
  FILTER(?duration > 120)
}
ORDER BY DESC(?duration)
```

**Use Case**: Identify time-intensive tasks.

---

### 20a. Calculate Duration from Timestamps

Calculate duration between start and end timestamps using `dateDiffMinutes`:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label (exo:dateDiffMinutes(?start, ?end) AS ?durationMin) (exo:dateDiffHours(?start, ?end) AS ?durationHrs)
WHERE {
  ?task exo:Instance_class "ems__Task" .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_startTimestamp ?start .
  ?task ems:Effort_endTimestamp ?end .
}
ORDER BY DESC(?durationMin)
LIMIT 10
```

**Use Case**: Calculate task durations from timestamps when `Effort_duration_minutes` is not stored.

---

### 20b. Average Sleep Duration per Week

Calculate average sleep time using custom date functions:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT (SUM(?durationMin) AS ?totalMin) (COUNT(?durationMin) AS ?count)
WHERE {
  SELECT (exo:dateDiffMinutes(?start, ?end) AS ?durationMin)
  WHERE {
    ?task exo:Asset_prototype ?proto .
    ?task ems:Effort_startTimestamp ?start .
    ?task ems:Effort_endTimestamp ?end .
    FILTER(CONTAINS(STR(?proto), "sleep-prototype-uuid"))
    FILTER(CONTAINS(?start, "Nov 25 2025"))  # Filter by date
  }
}
```

**Use Case**: Calculate average duration for repeated activities (sleep, exercise, etc.). Divide `totalMin` by `count` for the average.

---

## Aggregation Examples

### 21. Total Effort by Project

Sum effort votes per project:

```sparql
SELECT ?project ?projectLabel (SUM(?votes) AS ?totalVotes)
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
}
GROUP BY ?project ?projectLabel
ORDER BY DESC(?totalVotes)
```

**Use Case**: Resource allocation planning.

---

### 22. Average Task Votes by Status

Calculate average effort per status:

```sparql
SELECT ?status (AVG(?votes) AS ?avgVotes) (COUNT(?task) AS ?taskCount)
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
}
GROUP BY ?status
ORDER BY DESC(?avgVotes)
```

**Use Case**: Effort estimation insights.

---

### 23. Tasks per Area

Count tasks across all areas (including nested projects):

```sparql
SELECT ?area ?areaLabel (COUNT(?task) AS ?taskCount)
WHERE {
  ?area <https://exocortex.my/ontology/exo#Instance_class> "ems__Area" .
  ?area <https://exocortex.my/ontology/exo#Asset_label> ?areaLabel .
  ?project <https://exocortex.my/ontology/ems#belongs_to_area> ?area .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
}
GROUP BY ?area ?areaLabel
ORDER BY DESC(?taskCount)
```

**Use Case**: Workload distribution across areas.

---

## Graph Construction

### 24. Extract Task-Project Relationships

Build a graph of task→project relationships:

```sparql
CONSTRUCT {
  ?task <http://example.org/in_project> ?project .
  ?task <http://example.org/has_label> ?taskLabel .
  ?project <http://example.org/has_label> ?projectLabel .
}
WHERE {
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
}
```

**Use Case**: Export relationships for visualization tools.

---

### 25. Inferred Area Membership

Create direct task→area relationships (bypassing projects):

```sparql
CONSTRUCT {
  ?task <http://example.org/belongs_to_area> ?area .
}
WHERE {
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  ?project <https://exocortex.my/ontology/ems#belongs_to_area> ?area .
}
```

**Use Case**: Simplify hierarchical queries.

---

### 26. Priority Classification

Add inferred priority classes based on votes:

```sparql
CONSTRUCT {
  ?task <http://example.org/priority_class> ?priorityClass .
}
WHERE {
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  BIND(
    IF(?votes > 10, "critical",
      IF(?votes > 5, "high",
        IF(?votes > 2, "medium", "low")
      )
    ) AS ?priorityClass
  )
}
```

**Use Case**: Automatic prioritization.

---

## RDF/RDFS Standard Queries

### 27. Query Assets by Type (Using rdf:type)

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?task ?label
WHERE {
  ?task rdf:type ems:Task .
  ?task exo:Asset_label ?label .
}
```

**Use Case**: Find all tasks using standard RDF vocabulary instead of ExoRDF-specific predicates.

**Performance**: O(n) - Same as exo__Instance_class queries

---

### 28. Query All Asset Subtypes (Using rdfs:subClassOf*)

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
LIMIT 100
```

**Use Case**: Find ALL assets (tasks, projects, areas) regardless of specific type, using transitive subclass inference.

**Performance**: O(n×m) where m is class hierarchy depth. Use LIMIT to avoid large result sets.

---

### 29. Query Class Hierarchy (Using rdfs:subClassOf)

```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?class ?superClass
WHERE {
  ?class rdfs:subClassOf ?superClass .
}
```

**Use Case**: Explore the Exocortex class hierarchy to understand asset type relationships.

**Result Example**:
```
ems:Task        rdfs:subClassOf exo:Asset
ems:Project     rdfs:subClassOf exo:Asset
ems:Area        rdfs:subClassOf exo:Asset
exo:Asset       rdfs:subClassOf rdfs:Resource
```

---

### 30. Query by Ontology (Using rdfs:isDefinedBy)

```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label
WHERE {
  ?asset rdfs:isDefinedBy <https://exocortex.my/ontology/ems/> .
  ?asset exo:Asset_label ?label .
}
```

**Use Case**: Find all assets defined by a specific ontology (EMS, IMS, etc.).

---

### 31. Count Assets by Type Hierarchy

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?type (COUNT(?asset) AS ?count)
WHERE {
  ?asset rdf:type ?type .
  ?type rdfs:subClassOf* exo:Asset .
}
GROUP BY ?type
ORDER BY DESC(?count)
```

**Use Case**: Statistics on asset distribution across types.

**Performance**: O(n) with grouping overhead.

---

### 32. Find All Superclasses of a Type

```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?superClass
WHERE {
  ems:Task rdfs:subClassOf+ ?superClass .
}
```

**Use Case**: Discover class hierarchy for a specific type.

**Result Example**:
```
exo:Asset
rdfs:Resource
```

---

### 33. Query with Multiple RDF/RDFS Predicates

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?task ?label ?ontology
WHERE {
  ?task rdf:type ems:Task .
  ?task rdfs:label ?label .
  ?task rdfs:isDefinedBy ?ontology .
}
LIMIT 50
```

**Use Case**: Combine multiple standard RDF/RDFS properties in one query.

---

### 34. Transitive Property Queries

```sparql
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?property ?superProperty
WHERE {
  ?property rdfs:subPropertyOf+ rdfs:label .
}
```

**Use Case**: Find all properties that are subproperties of rdfs:label (transitively).

---

### 35. Combined ExoRDF and RDF/RDFS Query

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?task ?label ?status
WHERE {
  # Use RDF/RDFS for type
  ?task rdf:type ems:Task .

  # Use ExoRDF for specific properties
  ?task exo:Asset_label ?label .
  ?task ems:Task_status ?status .

  FILTER(?status = "in-progress")
}
```

**Use Case**: Mix standard RDF/RDFS predicates with domain-specific ExoRDF predicates.

**Best Practice**: Use RDF/RDFS for interoperability, ExoRDF for performance-critical queries.

---

### 36. Validate Class Membership

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX exo: <https://exocortex.my/ontology/exo#>

ASK {
  ?task rdf:type ems:Task .
  ems:Task rdfs:subClassOf exo:Asset .
}
```

**Use Case**: Validate that tasks are properly classified as assets via class hierarchy.

**Result**: `true` or `false`

---

## Advanced Patterns

### 37. Tasks with Multiple Projects (Data Quality Check)

Find tasks incorrectly assigned to multiple projects:

```sparql
SELECT ?task ?taskLabel (COUNT(?project) AS ?projectCount)
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
}
GROUP BY ?task ?taskLabel
HAVING (COUNT(?project) > 1)
```

**Use Case**: Data validation and cleanup.

---

### 28. Transitive Relationships

Find all descendants of an area (projects + tasks):

```sparql
SELECT ?descendant ?descendantLabel ?type
WHERE {
  {
    <vault://Areas/My-Area.md> ^<https://exocortex.my/ontology/ems#belongs_to_area> ?descendant .
    ?descendant <https://exocortex.my/ontology/exo#Asset_label> ?descendantLabel .
    BIND("project" AS ?type)
  } UNION {
    <vault://Areas/My-Area.md> ^<https://exocortex.my/ontology/ems#belongs_to_area> / ^<https://exocortex.my/ontology/ems#belongs_to_project> ?descendant .
    ?descendant <https://exocortex.my/ontology/exo#Asset_label> ?descendantLabel .
    BIND("task" AS ?type)
  }
}
```

**Use Case**: Complete area breakdown.

---

### 29. Full-Text Search (Label Matching)

Search for assets by label content:

```sparql
SELECT ?asset ?label
WHERE {
  ?asset <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER(regex(?label, "machine learning", "i"))
}
LIMIT 50
```

**Use Case**: Quick search across vault.

---

### 30. Combined Filters

Complex multi-condition query:

```sparql
SELECT ?task ?taskLabel ?status ?votes ?project
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#Task_status> ?status .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .

  FILTER(?status = "in-progress" || ?status = "backlog")
  FILTER(?votes > 3)
  FILTER(regex(?taskLabel, "urgent|important", "i"))
  FILTER NOT EXISTS {
    ?task <https://exocortex.my/ontology/exo#Asset_archived> ?archived .
  }
}
ORDER BY DESC(?votes) ?taskLabel
LIMIT 20
```

**Use Case**: Highly specific task filtering.

---

## Advanced Features (v2)

The following features were added in SPARQL Engine v2 for more powerful queries.

### BIND Expressions

BIND creates computed values in your query.

#### 38. Simple BIND

Create a formatted label:

```sparql
SELECT ?task ?label ?displayLabel
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  BIND(CONCAT("Task: ", ?label) AS ?displayLabel)
}
```

**Use Case**: Format labels for display.

---

#### 39. Conditional BIND

Classify tasks by effort votes:

```sparql
SELECT ?task ?label ?votes ?priority
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  BIND(
    IF(?votes > 10, "critical",
      IF(?votes > 5, "high",
        IF(?votes > 2, "medium", "low")
      )
    ) AS ?priority
  )
}
ORDER BY DESC(?votes)
```

**Use Case**: Auto-classify tasks by urgency.

---

#### 40. BIND with String Functions

Extract parts of URIs:

```sparql
SELECT ?task ?label ?folder
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  BIND(REPLACE(STR(?task), "^.*/([^/]+)/[^/]+$", "$1") AS ?folder)
}
```

**Use Case**: Group assets by folder.

---

### EXISTS and NOT EXISTS

Test for the presence or absence of patterns.

#### 41. Find Blocked Tasks (EXISTS)

Tasks that have blockers:

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER EXISTS {
    ?task <https://exocortex.my/ontology/ems#Task_blockedBy> ?blocker .
  }
}
```

**Use Case**: Identify tasks waiting on dependencies.

---

#### 42. Find Independent Tasks (NOT EXISTS)

Tasks with no blockers:

```sparql
SELECT ?task ?label
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?label .
  FILTER NOT EXISTS {
    ?task <https://exocortex.my/ontology/ems#Task_blockedBy> ?blocker .
  }
}
ORDER BY ?label
```

**Use Case**: Find tasks ready to start.

---

#### 43. EXISTS with Conditions

Find projects that have at least one high-priority task:

```sparql
SELECT ?project ?projectLabel
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  FILTER EXISTS {
    ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
    ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
    FILTER(?votes > 5)
  }
}
```

**Use Case**: Prioritize projects with urgent tasks.

---

### Property Paths

Navigate relationships with path expressions.

#### 44. Transitive Closure (+)

Find all ancestors of a task (one or more levels):

```sparql
SELECT ?task ?taskLabel ?ancestor ?ancestorLabel
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project>+ ?ancestor .
  ?ancestor <https://exocortex.my/ontology/exo#Asset_label> ?ancestorLabel .
}
```

**Use Case**: Full hierarchy traversal.

---

#### 45. Optional Path (*)

Find all ancestors including zero levels (self):

```sparql
SELECT ?project ?related
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/ems#belongs_to_area>* ?related .
}
```

**Use Case**: Include node itself in results.

---

#### 46. Zero or One (?)

Find direct or no parent:

```sparql
SELECT ?task ?parent
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project>? ?parent .
}
```

**Use Case**: Optional single-step relationships.

---

#### 47. Alternative Paths (|)

Match tasks or projects:

```sparql
SELECT ?asset ?label
WHERE {
  ?asset (<https://exocortex.my/ontology/ems#belongs_to_project>|<https://exocortex.my/ontology/ems#belongs_to_area>) ?parent .
  ?asset <https://exocortex.my/ontology/exo#Asset_label> ?label .
}
```

**Use Case**: Match multiple relationship types.

---

#### 48. Sequence Path (/)

Find task's area via project (two-hop traversal):

```sparql
SELECT ?task ?taskLabel ?area ?areaLabel
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project>/<https://exocortex.my/ontology/ems#belongs_to_area> ?area .
  ?area <https://exocortex.my/ontology/exo#Asset_label> ?areaLabel .
}
```

**Use Case**: Multi-hop relationship navigation.

---

#### 49. Inverse Path (^)

Find all tasks belonging to a project (reverse direction):

```sparql
SELECT ?project ?projectLabel ?task ?taskLabel
WHERE {
  ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  ?project ^<https://exocortex.my/ontology/ems#belongs_to_project> ?task .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
}
```

**Use Case**: Reverse relationship traversal.

---

#### 50. Combined Property Path

Find all descendants of an area (projects and tasks):

```sparql
SELECT ?area ?areaLabel ?descendant ?descendantLabel
WHERE {
  ?area <https://exocortex.my/ontology/exo#Instance_class> "ems__Area" .
  ?area <https://exocortex.my/ontology/exo#Asset_label> ?areaLabel .
  ?area (^<https://exocortex.my/ontology/ems#belongs_to_area>/^<https://exocortex.my/ontology/ems#belongs_to_project>?)+ ?descendant .
  ?descendant <https://exocortex.my/ontology/exo#Asset_label> ?descendantLabel .
}
```

**Use Case**: Complete area breakdown.

---

### Subqueries

Use queries within queries for complex analysis.

#### 51. Simple Subquery

Find projects with task counts above average:

```sparql
SELECT ?project ?projectLabel ?taskCount
WHERE {
  {
    SELECT ?project (COUNT(?task) AS ?taskCount)
    WHERE {
      ?project <https://exocortex.my/ontology/exo#Instance_class> "ems__Project" .
      ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
    }
    GROUP BY ?project
  }
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  FILTER(?taskCount > 5)
}
ORDER BY DESC(?taskCount)
```

**Use Case**: Filter by aggregated values.

---

#### 52. Top-N per Group

Find the 3 highest-voted tasks per project:

```sparql
SELECT ?project ?projectLabel ?task ?taskLabel ?votes ?rank
WHERE {
  {
    SELECT ?project ?task ?votes (COUNT(?t2) + 1 AS ?rank)
    WHERE {
      ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
      ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
      OPTIONAL {
        ?t2 <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
        ?t2 <https://exocortex.my/ontology/ems#Effort_votes> ?v2 .
        FILTER(?v2 > ?votes)
      }
    }
    GROUP BY ?project ?task ?votes
    HAVING (COUNT(?t2) + 1 <= 3)
  }
  ?project <https://exocortex.my/ontology/exo#Asset_label> ?projectLabel .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
}
ORDER BY ?projectLabel ?rank
```

**Use Case**: Dashboard showing top priorities per project.

---

#### 53. Correlated Subquery

Find tasks with above-average votes for their project:

```sparql
SELECT ?task ?taskLabel ?votes ?projectAvg
WHERE {
  ?task <https://exocortex.my/ontology/exo#Instance_class> "ems__Task" .
  ?task <https://exocortex.my/ontology/exo#Asset_label> ?taskLabel .
  ?task <https://exocortex.my/ontology/ems#Effort_votes> ?votes .
  ?task <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
  {
    SELECT ?project (AVG(?v) AS ?projectAvg)
    WHERE {
      ?t <https://exocortex.my/ontology/ems#belongs_to_project> ?project .
      ?t <https://exocortex.my/ontology/ems#Effort_votes> ?v .
    }
    GROUP BY ?project
  }
  FILTER(?votes > ?projectAvg)
}
ORDER BY DESC(?votes)
```

**Use Case**: Find outliers within their context.

---

### Custom Extension Functions

Exocortex provides custom SPARQL functions beyond the standard specification.

#### 54. Direct UUID Resolution (exo:byUUID)

Look up an entity directly by its UUID without scanning:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label
WHERE {
  BIND(exo:byUUID("550e8400-e29b-41d4-a716-446655440000") AS ?asset)
  ?asset exo:Asset_label ?label .
}
```

**Use Case**: O(1) lookup when you know the UUID. ~100x faster than `FILTER(CONTAINS(...))`.

---

#### 55. UUID Lookup with Property Retrieval

Get all properties of a specific note:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?label ?status ?votes ?createdAt
WHERE {
  BIND(exo:byUUID("550e8400-e29b-41d4-a716-446655440000") AS ?task)
  ?task exo:Asset_label ?label .
  OPTIONAL { ?task ems:Effort_status ?status }
  OPTIONAL { ?task ems:Effort_votes ?votes }
  OPTIONAL { ?task exo:Asset_createdAt ?createdAt }
}
```

**Use Case**: Fetch complete entity details when UUID is known.

---

#### 56. UUID with Variable (Dynamic Resolution)

Use a variable containing a UUID string:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?asset ?label
WHERE {
  BIND("550e8400-e29b-41d4-a716-446655440000" AS ?uuid)
  BIND(exo:byUUID(?uuid) AS ?asset)
  ?asset exo:Asset_label ?label .
}
```

**Use Case**: Pass UUID from external source (e.g., API integration).

---

#### 57. Find Related Entities via UUID

Look up a task and find its parent project:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?taskLabel ?project ?projectLabel
WHERE {
  BIND(exo:byUUID("550e8400-e29b-41d4-a716-446655440000") AS ?task)
  ?task exo:Asset_label ?taskLabel .
  ?task ems:belongs_to_project ?project .
  ?project exo:Asset_label ?projectLabel .
}
```

**Use Case**: Navigate relationships starting from known UUID.

---

#### 58. Batch UUID Resolution

Look up multiple entities by UUID in a single query:

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>

SELECT ?entity ?label
WHERE {
  VALUES ?uuid {
    "uuid-1"
    "uuid-2"
    "uuid-3"
  }
  BIND(exo:byUUID(?uuid) AS ?entity)
  FILTER(BOUND(?entity))
  ?entity exo:Asset_label ?label .
}
```

**Use Case**: Resolve multiple UUIDs efficiently in one query.

---

## Tips for Using These Examples

### Adapting URIs

Replace URIs with your actual property names:

```sparql
<https://exocortex.my/ontology/exo#Asset_label> → Your property URI
"ems__Task" → Your class name
```

### Using LIMIT

Add `LIMIT` to large queries:

```sparql
SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
LIMIT 100
```

### Performance

- Start with specific patterns (e.g., filter by class first)
- Use `OPTIONAL` sparingly
- Avoid `FILTER NOT EXISTS` on large datasets

### Testing

Test queries in stages:

1. Get basic pattern working
2. Add filters one by one
3. Add aggregations last

---

## Next Steps

- **Learn SPARQL**: Read the [User-Guide.md](./User-Guide.md)
- **Optimize Queries**: Check [Performance-Tips.md](./Performance-Tips.md)
- **Extend Functionality**: See [Developer-Guide.md](./Developer-Guide.md)

## Resources

- [SPARQL 1.1 Query Language](https://www.w3.org/TR/sparql11-query/)
- [Exocortex Property Schema](../PROPERTY_SCHEMA.md)
- [GitHub Repository](https://github.com/kitelev/exocortex)

---

**Share Your Queries!** Submit your useful queries via [GitHub Discussions](https://github.com/kitelev/exocortex/discussions) to help the community!
