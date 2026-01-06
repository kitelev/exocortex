# Exocortex Property Schema Reference

**Version**: 1.0
**Last Updated**: 2025-10-26
**Purpose**: Complete reference for all frontmatter properties used by Exocortex

---

## 📖 Table of Contents

1. [Property Naming Convention](#property-naming-convention)
2. [Core Properties (exo__ prefix)](#core-properties-exo-prefix)
3. [Effort Management Properties (ems__ prefix)](#effort-management-properties-ems-prefix)
4. [Information Management Properties (ims__ prefix)](#information-management-properties-ims-prefix)
5. [Personal Notes Properties (pn__ prefix)](#personal-notes-properties-pn-prefix)
6. [Obsidian Standard Properties](#obsidian-standard-properties)
7. [Property Inheritance Rules](#property-inheritance-rules)
8. [Validation Rules](#validation-rules)
9. [Examples](#examples)

---

## 🏷️ Property Naming Convention

### Format

All Exocortex custom properties follow this pattern:

```
[prefix]__[EntityType]_[propertyName]
```

**Components**:
- **prefix**: Namespace identifier (2-4 characters)
- **EntityType**: Entity class (Asset, Effort, Task, etc.)
- **propertyName**: Property name in camelCase

### Prefixes

| Prefix | Namespace | Purpose | Example |
|--------|-----------|---------|---------|
| `exo__` | Exocortex Universal | Properties common to ALL assets | `exo__Asset_uid` |
| `ems__` | Effort Management System | Task/project management | `ems__Effort_status` |
| `ims__` | Information Management | Concepts, knowledge | `ims__Concept_broader` |
| `pn__` | Personal Notes | Daily notes, journals | `pn__DailyNote_date` |
| `ztlk__` | Zettelkasten | Note-taking system | `ztlk__Note_type` |

### Examples

```yaml
# Core property (all assets)
exo__Asset_uid: 550e8400-e29b-41d4-a716-446655440000

# Effort property (tasks/projects)
ems__Effort_status: "[[ems__EffortStatusDraft]]"

# Task-specific property
ems__Task_size: M

# Area-specific property
ems__Area_parent: "[[Parent Area]]"

# Concept property
ims__Concept_broader: "[[Programming]]"
```

---

## 📦 Core Properties (exo__ prefix)

These properties are **required for ALL assets** (tasks, projects, areas, concepts, etc.).

### exo__Asset_uid

**Unique asset identifier (UUID v4)**

| Attribute | Value |
|-----------|-------|
| **Type** | String |
| **Required** | ✅ Yes (ALL assets) |
| **Format** | UUID v4: `550e8400-e29b-41d4-a716-446655440000` |
| **Purpose** | Stable, unique identifier across renames |
| **Generated** | Auto (on asset creation via `uuid.v4()`) |
| **Mutable** | ❌ No (NEVER change after creation) |
| **Used For** | Filename, cross-references, deduplication |

**Example**:
```yaml
exo__Asset_uid: 550e8400-e29b-41d4-a716-446655440000
```

**Validation**:
- Must match UUID v4 format: `[hex]{8}-[hex]{4}-4[hex]{3}-[89ab][hex]{3}-[hex]{12}`
- Must be unique across all assets
- Must be lowercase

---

### exo__Asset_label

**Human-readable asset name**

| Attribute | Value |
|-----------|-------|
| **Type** | String |
| **Required** | ✅ Yes (ALL assets) |
| **Format** | Free text (any valid YAML string) |
| **Purpose** | Display name for UI, search, navigation |
| **Generated** | User input or auto-generated (e.g., meetings) |
| **Mutable** | ✅ Yes (can be renamed) |
| **Used For** | UI display, aliases, search |
| **Also Added To** | `aliases` array (Obsidian standard) |

**Example**:
```yaml
exo__Asset_label: Review PR #123
aliases:
  - Review PR #123
```

**Validation**:
- Must not be empty
- Should be descriptive (recommended 3-50 characters)

---

### exo__Asset_createdAt

**Asset creation timestamp**

| Attribute | Value |
|-----------|-------|
| **Type** | String |
| **Required** | ✅ Yes (ALL assets) |
| **Format** | ISO 8601 local time: `YYYY-MM-DDTHH:mm:ss` |
| **Purpose** | Track when asset was created |
| **Generated** | Auto (via `DateFormatter.toLocalTimestamp(new Date())`) |
| **Mutable** | ❌ No (immutable creation time) |
| **Timezone** | Local timezone (not UTC) |

**Example**:
```yaml
exo__Asset_createdAt: 2025-10-26T14:30:45
```

**Validation**:
- Must match ISO 8601 format
- Must not have timezone offset (local time only)
- Must be valid date/time

---

### exo__Asset_isDefinedBy

**Ontology reference (which system defines this asset)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink) |
| **Required** | ✅ Yes (ALL assets) |
| **Format** | Quoted WikiLink: `"[[Path/FileName]]"` |
| **Purpose** | Link asset to defining ontology |
| **Generated** | Inherited from parent or set explicitly |
| **Mutable** | Rarely (usually stays constant) |
| **Common Values** | `"[[Ontology/EMS]]"`, `"[[!concepts]]"` |

**Example**:
```yaml
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
```

**Inheritance Rules**:
- Tasks inherit from Area/Project/Prototype
- Projects inherit from Area/Initiative
- Concepts inherit from parent Concept or use `"[[!concepts]]"`

---

### exo__Instance_class

**Asset type classification (one or more types)**

| Attribute | Value |
|-----------|-------|
| **Type** | Array of WikiLinks |
| **Required** | ✅ Yes (ALL assets) |
| **Format** | `['"[[AssetClassValue]]"']` (quoted WikiLinks in array) |
| **Purpose** | Determine asset type for UI rendering and commands |
| **Generated** | Based on creation context (see `INSTANCE_CLASS_MAP`) |
| **Mutable** | Rarely (type usually fixed at creation) |
| **Valid Values** | See `AssetClass` enum |

**Example**:
```yaml
exo__Instance_class:
  - "[[ems__Task]]"

# Or multiple classes
exo__Instance_class:
  - "[[ems__Task]]"
  - "[[ims__Concept]]"
```

**Valid Asset Classes**:
- `ems__Area` - Organizational container
- `ems__Task` - Work item with status
- `ems__Project` - Multi-task initiative
- `ems__Meeting` - Special task type
- `ems__Initiative` - Long-term goal
- `ems__TaskPrototype` - Reusable template
- `ems__MeetingPrototype` - Meeting template
- `ims__Concept` - Knowledge base entry
- `pn__DailyNote` - Daily planning note

---

### exo__Asset_isArchived

**Archive status flag**

| Attribute | Value |
|-----------|-------|
| **Type** | Boolean or String |
| **Required** | No (default: `false`) |
| **Format** | `true`, `1`, `"true"`, `"yes"` (any truthy) |
| **Purpose** | Mark asset as archived/completed |
| **Generated** | Manual or via "Archive" command |
| **Mutable** | ✅ Yes |
| **Effect** | Hides from active views (if toggle enabled) |
| **Alternatives** | `archived` (Obsidian standard, also checked) |

**Example**:
```yaml
exo__Asset_isArchived: true
# Or
archived: true
# Or both
```

**Multi-Format Support**:
```typescript
// All these are treated as archived:
exo__Asset_isArchived: true
exo__Asset_isArchived: 1
exo__Asset_isArchived: "true"
exo__Asset_isArchived: "yes"
archived: true
```

---

## ⚡ Effort Management Properties (ems__ prefix)

Properties for **tasks**, **projects**, and **meetings** (collectively called "efforts").

### ems__Effort_status

**Current effort status in workflow**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink) |
| **Required** | Yes (for efforts) |
| **Format** | `"[[ems__EffortStatus{Value}]]"` |
| **Purpose** | Track progress through workflow |
| **Generated** | Default: `Draft` on creation |
| **Mutable** | ✅ Yes (via status commands) |
| **Valid Values** | See status workflow below |

**Status Workflow**:
```
Draft → Backlog → Analysis → ToDo → Doing → Done
          ↓                            ↓
        Trashed ←──────────────────────┘
```

**Valid Status Values**:
- `ems__EffortStatusDraft` - Initial state
- `ems__EffortStatusBacklog` - Queued for future
- `ems__EffortStatusAnalysis` - Being analyzed/planned
- `ems__EffortStatusToDo` - Ready to start
- `ems__EffortStatusDoing` - Currently active
- `ems__EffortStatusDone` - Completed
- `ems__EffortStatusTrashed` - Cancelled/deleted

**Example**:
```yaml
ems__Effort_status: "[[ems__EffortStatusDraft]]"
```

**Workflow Rules**:
- **Tasks**: Can skip Analysis and go Backlog → Doing
- **Projects**: Must go through ToDo before Doing
- **Trashed**: Can transition from any state

---

### ems__Effort_area

**Parent area reference (for tasks)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink) |
| **Required** | For tasks created from areas |
| **Format** | `"[[Area Name]]"` |
| **Purpose** | Link task to organizational area |
| **Generated** | When creating task from area |
| **Mutable** | Rarely (usually fixed) |

**Example**:
```yaml
ems__Effort_area: "[[Work]]"
```

---

### ems__Effort_parent

**Parent project/initiative reference**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink) |
| **Required** | For tasks/projects with parent |
| **Format** | `"[[Parent Name]]"` |
| **Purpose** | Link to parent project or initiative |
| **Generated** | When creating from project/initiative |
| **Mutable** | Rarely |

**Example**:
```yaml
# Task within project
ems__Effort_parent: "[[Website Redesign]]"

# Project within initiative
ems__Effort_parent: "[[Q4 Goals]]"
```

---

### exo__Asset_prototype

**Prototype template reference (for instances)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink) |
| **Required** | For instances created from prototypes |
| **Format** | `"[[Prototype Name]]"` |
| **Purpose** | Link instance to template |
| **Generated** | When creating instance from prototype |
| **Mutable** | ❌ No (immutable reference) |
| **Inherits**: Algorithm section from prototype (if exists) |

**Example**:
```yaml
exo__Asset_prototype: "[[Breakfast]]"
```

---

### ems__Effort_votes

**Priority vote count**

| Attribute | Value |
|-----------|-------|
| **Type** | Number (integer) |
| **Required** | No (default: 0) |
| **Format** | Non-negative integer |
| **Purpose** | Collaborative prioritization |
| **Generated** | Starts at 0, incremented by "Vote" command |
| **Mutable** | ✅ Yes (increment only) |
| **Sorting** | Higher votes = higher priority |

**Example**:
```yaml
ems__Effort_votes: 5
```

**Sorting Rules**:
1. Non-trashed before trashed
2. Not-done before done
3. **Higher votes before lower votes** ⭐
4. Earlier start time before later

---

### ems__Effort_day

**Planned day for effort execution**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink to date) |
| **Required** | No |
| **Format** | `"[[YYYY-MM-DD]]"` |
| **Purpose** | Schedule task for specific day |
| **Generated** | By "Plan on Today" or "Plan for Evening" command |
| **Mutable** | ✅ Yes (can reschedule) |
| **Used For** | Daily task aggregation view |

**Example**:
```yaml
ems__Effort_day: "[[2025-10-26]]"
```

**Commands that set this**:
- "Plan on Today" → Sets to today's date
- "Plan for Evening" → Sets to today + adds plannedStartTimestamp
- "Shift Day Forward" → Adds 1 day
- "Shift Day Backward" → Subtracts 1 day

---

### ems__Effort_startTimestamp

**When effort started (entered Doing status)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (ISO 8601 timestamp) |
| **Required** | No |
| **Format** | `YYYY-MM-DDTHH:mm:ss` |
| **Purpose** | Track when work began |
| **Generated** | Auto when status → Doing |
| **Mutable** | ✅ Yes (if status changes back and forth) |
| **Cleared** | No (preserved for history) |

**Example**:
```yaml
ems__Effort_startTimestamp: 2025-10-26T09:15:30
```

---

### ems__Effort_endTimestamp

**When effort ended (left Doing status)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (ISO 8601 timestamp) |
| **Required** | No |
| **Format** | `YYYY-MM-DDTHH:mm:ss` |
| **Purpose** | Track when work paused/stopped |
| **Generated** | Auto when status changes from Doing |
| **Mutable** | ✅ Yes |
| **Used For** | Duration calculation |

**Example**:
```yaml
ems__Effort_endTimestamp: 2025-10-26T17:30:00
```

---

### ems__Effort_resolutionTimestamp

**When effort completed (moved to Done)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (ISO 8601 timestamp) |
| **Required** | No |
| **Format** | `YYYY-MM-DDTHH:mm:ss` |
| **Purpose** | Track completion time |
| **Generated** | Auto when status → Done |
| **Mutable** | ✅ Yes (if reopened and completed again) |

**Example**:
```yaml
ems__Effort_resolutionTimestamp: 2025-10-26T17:45:00
```

---

### ems__Effort_plannedStartTimestamp

**Planned start time (for evening planning)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (ISO 8601 timestamp) |
| **Required** | No |
| **Format** | `YYYY-MM-DDTHH:mm:ss` |
| **Purpose** | Schedule specific start time |
| **Generated** | By "Plan for Evening" command (sets to 19:00) |
| **Mutable** | ✅ Yes |
| **Default Time** | 19:00:00 (7 PM) |

**Example**:
```yaml
ems__Effort_plannedStartTimestamp: 2025-10-26T19:00:00
```

---

### ems__Task_size

**Task size estimate**

| Attribute | Value |
|-----------|-------|
| **Type** | String (enum) |
| **Required** | No |
| **Format** | Single letter: `S`, `M`, `L`, `XL` |
| **Purpose** | Effort estimation |
| **Generated** | User input during task creation (default: `M`) |
| **Mutable** | ✅ Yes |
| **Valid Values** | `S` (Small), `M` (Medium), `L` (Large), `XL` (Extra Large) |

**Example**:
```yaml
ems__Task_size: M
```

**Interpretation**:
- `S` - Quick task (<30 min)
- `M` - Standard task (30 min - 2 hours)
- `L` - Large task (2-4 hours)
- `XL` - Very large task (>4 hours)

---

### ems__Area_parent

**Parent area reference (for child areas)**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink) |
| **Required** | For child areas only |
| **Format** | `"[[Parent Area Name]]"` |
| **Purpose** | Build area hierarchy |
| **Generated** | When creating child area |
| **Mutable** | Rarely |
| **Used For** | Hierarchy visualization |

**Example**:
```yaml
ems__Area_parent: "[[Work]]"
```

---

### ems__Effort_archived_date

**When effort was archived**

| Attribute | Value |
|-----------|-------|
| **Type** | String (ISO 8601 timestamp) |
| **Required** | No |
| **Format** | `YYYY-MM-DDTHH:mm:ss` |
| **Purpose** | Track archive date |
| **Generated** | When archiving asset |
| **Mutable** | Yes |

**Example**:
```yaml
ems__Effort_archived_date: 2025-10-15T10:00:00
```

---

## 🧠 Information Management Properties (ims__ prefix)

Properties for **concepts** and knowledge management.

### ims__Concept_broader

**Parent concept reference**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink) |
| **Required** | For narrower concepts |
| **Format** | `"[[Parent Concept]]"` |
| **Purpose** | Build concept hierarchy (broader/narrower) |
| **Generated** | When creating narrower concept |
| **Mutable** | Rarely |

**Example**:
```yaml
ims__Concept_broader: "[[Programming]]"
```

**Hierarchy Example**:
```
Programming (broader)
  ├─ TypeScript (narrower)
  ├─ JavaScript (narrower)
  └─ Python (narrower)
      └─ Django (even narrower)
```

---

### ims__Concept_definition

**Concept definition text**

| Attribute | Value |
|-----------|-------|
| **Type** | String |
| **Required** | For concepts (recommended) |
| **Format** | Free text |
| **Purpose** | Define what the concept means |
| **Generated** | User input |
| **Mutable** | ✅ Yes (can refine definition) |

**Example**:
```yaml
ims__Concept_definition: A typed superset of JavaScript that compiles to plain JavaScript
```

---

## 📝 Personal Notes Properties (pn__ prefix)

Properties for daily notes and personal journaling.

### pn__DailyNote_date

**Date for daily note**

| Attribute | Value |
|-----------|-------|
| **Type** | String (WikiLink to date) |
| **Required** | For daily notes |
| **Format** | `"[[YYYY-MM-DD]]"` |
| **Purpose** | Identify daily note date |
| **Generated** | Auto from filename or user input |
| **Mutable** | Rarely |

**Example**:
```yaml
pn__DailyNote_date: "[[2025-10-26]]"
```

---

## 📋 Obsidian Standard Properties

Properties that Obsidian recognizes natively.

### aliases

**Alternative names for note**

| Attribute | Value |
|-----------|-------|
| **Type** | Array of strings |
| **Required** | No |
| **Format** | YAML array |
| **Purpose** | Enable search/linking by alternative names |
| **Auto-Populated** | With `exo__Asset_label` value |
| **Mutable** | ✅ Yes |

**Example**:
```yaml
aliases:
  - Review PR #123
  - PR 123 Review
```

---

### archived

**Obsidian's native archive property**

| Attribute | Value |
|-----------|-------|
| **Type** | Boolean or String |
| **Required** | No |
| **Format** | `true` or `"true"` |
| **Purpose** | Obsidian's standard archival system |
| **Also Checked** | As fallback for `exo__Asset_isArchived` |

**Example**:
```yaml
archived: true
```

---

## 🔄 Property Inheritance Rules

### When Creating Child Assets

#### Rule 1: Always Inherited

| Property | From Parent | To Child |
|----------|-------------|----------|
| `exo__Asset_isDefinedBy` | ✅ Copied | Same value |

**Example**:
```yaml
# Parent Area
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"

# Child Task (inherits)
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
```

#### Rule 2: Never Inherited

| Property | Reason |
|----------|--------|
| `exo__Asset_uid` | Always new UUID |
| `exo__Asset_createdAt` | Always current timestamp |
| `exo__Asset_label` | User input or generated |
| `ems__Effort_status` | Always starts at Draft |
| `ems__Effort_votes` | Always starts at 0 |

#### Rule 3: Conditionally Inherited (via Property Maps)

**EFFORT_PROPERTY_MAP** (determines parent relationship):

| Source Class | Property Added | Value |
|--------------|----------------|-------|
| `ems__Area` | `ems__Effort_area` | `"[[{area-name}]]"` |
| `ems__Project` | `ems__Effort_parent` | `"[[{project-name}]]"` |
| `ems__TaskPrototype` | `exo__Asset_prototype` | `"[[{prototype-name}]]"` |
| `ems__MeetingPrototype` | `exo__Asset_prototype` | `"[[{prototype-name}]]"` |
| `ems__Initiative` | `ems__Effort_parent` | `"[[{initiative-name}]]"` |

**INSTANCE_CLASS_MAP** (determines child type):

| Source Class | Child Instance Class |
|--------------|----------------------|
| `ems__Area` | `ems__Task` |
| `ems__Project` | `ems__Task` |
| `ems__TaskPrototype` | `ems__Task` |
| `ems__MeetingPrototype` | `ems__Meeting` |

**Example**:
```yaml
# Creating task from Area "Work"
# Input: sourceClass = "ems__Area", sourceName = "Work"
# Output frontmatter:
exo__Instance_class:
  - "[[ems__Task]]"          # From INSTANCE_CLASS_MAP
ems__Effort_area: "[[Work]]"  # From EFFORT_PROPERTY_MAP
```

---

## ✅ Validation Rules

### Required Properties (ALL Assets)

Every asset MUST have these 4 properties:
```yaml
exo__Asset_uid: <uuid-v4>
exo__Asset_label: <string>
exo__Asset_createdAt: <iso-8601-timestamp>
exo__Instance_class: [<wikilink-array>]
```

**Validation**:
```typescript
function validateAsset(metadata: Record<string, any>): boolean {
  return (
    !!metadata.exo__Asset_uid &&
    !!metadata.exo__Asset_label &&
    !!metadata.exo__Asset_createdAt &&
    !!metadata.exo__Instance_class
  );
}
```

### Format Validation

#### UUIDs
```regex
^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

#### ISO 8601 Timestamps
```regex
^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$
```

#### WikiLinks (in YAML)
```regex
^"?\[\[.+\]\]"?$
```

Must be quoted in frontmatter:
```yaml
# ✅ Correct
ems__Effort_status: "[[ems__EffortStatusDraft]]"

# ❌ Wrong
ems__Effort_status: [[ems__EffortStatusDraft]]
```

#### Task Size
```regex
^(S|M|L|XL)$
```

### Business Rules

#### Status Transitions

```typescript
// Valid transitions (enforced by TaskStatusService)
const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Backlog', 'Trashed'],
  Backlog: ['Draft', 'Analysis', 'Doing', 'Trashed'],
  Analysis: ['Backlog', 'ToDo', 'Trashed'],
  ToDo: ['Analysis', 'Doing', 'Trashed'],
  Doing: ['Backlog', 'ToDo', 'Done', 'Trashed'],
  Done: ['Doing', 'Trashed'],
  Trashed: [], // Terminal state
};
```

#### Vote Constraints

```typescript
// Votes must be non-negative
ems__Effort_votes >= 0
```

#### Effort Day

```typescript
// Must be valid date in format YYYY-MM-DD
/^\d{4}-\d{2}-\d{2}$/
```

---

## 📚 Examples

### Complete Task Frontmatter

```yaml
---
exo__Asset_uid: 550e8400-e29b-41d4-a716-446655440000
exo__Asset_label: Review PR #123
exo__Asset_createdAt: 2025-10-26T14:30:45
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_area: "[[Work]]"
ems__Effort_votes: 3
ems__Effort_day: "[[2025-10-26]]"
ems__Effort_startTimestamp: 2025-10-26T09:15:30
ems__Task_size: M
aliases:
  - Review PR #123
---

Task content goes here...
```

### Complete Project Frontmatter

```yaml
---
exo__Asset_uid: 7c9e6679-7425-40de-944b-e07fc1f90ae7
exo__Asset_label: Website Redesign
exo__Asset_createdAt: 2025-10-20T10:00:00
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
ems__Effort_area: "[[Work]]"
ems__Effort_votes: 8
aliases:
  - Website Redesign
---

Project description...
```

### Complete Concept Frontmatter

```yaml
---
exo__Asset_uid: 3fa85f64-5717-4562-b3fc-2c963f66afa6
exo__Asset_label: TypeScript
exo__Asset_createdAt: 2025-10-26T15:00:00
exo__Asset_isDefinedBy: "[[!concepts]]"
exo__Instance_class:
  - "[[ims__Concept]]"
ims__Concept_broader: "[[Programming]]"
ims__Concept_definition: A typed superset of JavaScript that compiles to plain JavaScript
aliases:
  - TypeScript
  - TS
---

Additional notes about TypeScript...
```

### Instance from Prototype

```yaml
---
exo__Asset_uid: 8f7d3c5a-1b2e-4f6a-9d8c-7e6f5a4b3c2d
exo__Asset_label: 2025-10-26 Breakfast
exo__Asset_createdAt: 2025-10-26T07:00:00
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDraft]]"
exo__Asset_prototype: "[[Breakfast]]"
ems__Task_size: S
aliases:
  - 2025-10-26 Breakfast
---

## Algorithm

1. Make coffee
2. Prepare oatmeal
3. Add fruits
```

**Note**: Algorithm section inherited from prototype.

---

## 🔗 Related Documentation

- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture overview
- [API_CONTRACTS.md](./API_CONTRACTS.md) - Service interfaces
- [CommandVisibility.ts](../src/domain/commands/CommandVisibility.ts) - Visibility rules source

---

**Maintainer**: @kitelev
**Related Issues**: #122 (Core Extraction), #124 (Architecture Documentation)