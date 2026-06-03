# Exocortex Property Schema Reference

**Version**: 1.0
**Last Updated**: 2025-10-26
**Purpose**: Complete reference for all frontmatter properties used by Exocortex

---

## 📖 Table of Contents

1. [Property Naming Convention](#property-naming-convention)
2. [Core Properties (exo\_\_ prefix)](#core-properties-exo-prefix)
3. [Effort Management Properties (ems\_\_ prefix)](#effort-management-properties-ems-prefix)
4. [Information Management Properties (ims\_\_ prefix)](#information-management-properties-ims-prefix)
5. [Property Cardinality Declarations](#property-cardinality-declarations)
6. [Personal Notes Properties (pn\_\_ prefix)](#personal-notes-properties-pn-prefix)
7. [Obsidian Standard Properties](#obsidian-standard-properties)
8. [Property Inheritance Rules](#property-inheritance-rules)
9. [Validation Rules](#validation-rules)
10. [Examples](#examples)

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

| Prefix   | Namespace                | Purpose                         | Example                |
| -------- | ------------------------ | ------------------------------- | ---------------------- |
| `exo__`  | Exocortex Universal      | Properties common to ALL assets | `exo__Asset_uid`       |
| `ems__`  | Effort Management System | Task/project management         | `ems__Effort_status`   |
| `ims__`  | Information Management   | Concepts, knowledge             | `ims__Concept_broader` |
| `pn__`   | Personal Notes           | Daily notes, journals           | `pn__DailyNote_date`   |
| `ztlk__` | Zettelkasten             | Note-taking system              | `ztlk__Note_type`      |

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

## 📦 Core Properties (exo\_\_ prefix)

These properties are **required for ALL assets** (tasks, projects, areas, concepts, etc.).

### exo\_\_Asset_uid

**Unique asset identifier (UUID v4)**

| Attribute     | Value                                           |
| ------------- | ----------------------------------------------- |
| **Type**      | String                                          |
| **Required**  | ✅ Yes (ALL assets)                             |
| **Format**    | UUID v4: `550e8400-e29b-41d4-a716-446655440000` |
| **Purpose**   | Stable, unique identifier across renames        |
| **Generated** | Auto (on asset creation via `uuid.v4()`)        |
| **Mutable**   | ❌ No (NEVER change after creation)             |
| **Used For**  | Filename, cross-references, deduplication       |

**Example**:

```yaml
exo__Asset_uid: 550e8400-e29b-41d4-a716-446655440000
```

**Validation**:

- Must match UUID v4 format: `[hex]{8}-[hex]{4}-4[hex]{3}-[89ab][hex]{3}-[hex]{12}`
- Must be unique across all assets
- Must be lowercase

---

### exo\_\_Asset_label

**Human-readable asset name**

| Attribute         | Value                                         |
| ----------------- | --------------------------------------------- |
| **Type**          | String                                        |
| **Required**      | ✅ Yes (ALL assets)                           |
| **Format**        | Free text (any valid YAML string)             |
| **Purpose**       | Display name for UI, search, navigation       |
| **Generated**     | User input or auto-generated (e.g., meetings) |
| **Mutable**       | ✅ Yes (can be renamed)                       |
| **Used For**      | UI display, aliases, search                   |
| **Also Added To** | `aliases` array (Obsidian standard)           |

**Example**:

```yaml
exo__Asset_label: Review PR #123
aliases:
  - Review PR #123
```

**Validation**:

- Must not be empty
- Should be descriptive (recommended 3-50 characters)

**Property-asset exception (filename → label fallback)**:

Property-definition assets (those whose `exo__Instance_class` references `exo__Property` or `exo__ObjectProperty`) may omit `exo__Asset_label` when the **filename basename matches the canonical property key** (e.g. `ems__Effort_status.md`). In that case the SHACL-lite shape loader (`ShapeLoader.processFile`) infers the label from the basename — this matches the long-standing convention used by hand-authored ontology files in `03 Knowledge/ems/`, `03 Knowledge/exo/`, etc.

The fallback is intentionally narrow:

- Only triggers when `exo__Asset_label` is absent or empty.
- Only triggers when the basename parses as `<prefix>__<localName>` via `Namespace.fromPropertyKey`.
- Does not affect non-property assets.

For all new property assets, **prefer explicit `exo__Asset_label`** — the fallback exists to keep legacy ontology files working without forcing a vault-wide migration.

---

### exo\_\_Asset_createdAt

**Asset creation timestamp**

| Attribute     | Value                                                   |
| ------------- | ------------------------------------------------------- |
| **Type**      | String                                                  |
| **Required**  | ✅ Yes (ALL assets)                                     |
| **Format**    | ISO 8601 local time: `YYYY-MM-DDTHH:mm:ss`              |
| **Purpose**   | Track when asset was created                            |
| **Generated** | Auto (via `DateFormatter.toLocalTimestamp(new Date())`) |
| **Mutable**   | ❌ No (immutable creation time)                         |
| **Timezone**  | Local timezone (not UTC)                                |

**Example**:

```yaml
exo__Asset_createdAt: 2025-10-26T14:30:45
```

**Validation**:

- Must match ISO 8601 format
- Must not have timezone offset (local time only)
- Must be valid date/time

---

### exo\_\_Asset_isDefinedBy

**Ontology reference (which system defines this asset)**

| Attribute         | Value                                   |
| ----------------- | --------------------------------------- |
| **Type**          | String (WikiLink)                       |
| **Required**      | ✅ Yes (ALL assets)                     |
| **Format**        | Quoted WikiLink: `"[[Path/FileName]]"`  |
| **Purpose**       | Link asset to defining ontology         |
| **Generated**     | Inherited from parent or set explicitly |
| **Mutable**       | Rarely (usually stays constant)         |
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

### exo\_\_Instance_class

**Asset type classification (one or more types)**

| Attribute          | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| **Type**           | Array of WikiLinks                                                       |
| **Required**       | ✅ Yes (ALL assets)                                                      |
| **Canonical form** | **Form C — bare UUID** `"[[<class-uuid>]]"` (see _Canonical form_ below) |
| **Purpose**        | Determine asset type for UI rendering and commands                       |
| **Generated**      | Based on creation context (see `INSTANCE_CLASS_MAP`)                     |
| **Mutable**        | Rarely (type usually fixed at creation)                                  |
| **Valid Values**   | See `AssetClass` enum                                                    |

#### Canonical form (decided 2026-05-16, issue #3123)

For new assets the canonical encoding of `exo__Instance_class` values is **Form C — bare UUID wikilink**:

```yaml
exo__Instance_class:
  - "[[1b20a8f0-d745-4e93-91db-4531b3df120e]]" # ems__Task
```

Two non-canonical legacy forms are still accepted by the converter and are **semantically equivalent** for RDF/SHACL purposes — see `TROUBLESHOOTING.md` § _exo\_\_Instance_class wikilink form mismatch — all forms RDF-equivalent_ — but new assets must not emit them:

| Form | Example                                                 | Status        |
| ---- | ------------------------------------------------------- | ------------- |
| A    | `"[[ems__Task]]"`                                       | Legacy (warn) |
| B    | `"[[1b20a8f0-d745-4e93-91db-4531b3df120e\|ems__Task]]"` | Legacy (warn) |
| C    | `"[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"`            | **Canonical** |

**Why Form C:**

1. **Symbolic stability** — UUID is immutable; renaming the class file (label change) never breaks the wikilink.
2. **Storage consistency** — every class asset is already stored under its UUID filename (`<UUID>.md`); Form C navigates directly to the canonical file with no shim required.
3. **Zero RDF semantic difference** — `NoteToRDFConverter.valueToClassURI` resolves all three forms to the same namespace IRI via `Namespace.fromPropertyKey`; file existence is _not_ consulted for class wikilinks. Empirically confirmed in the 2026-05-16 SHACL deep-dive (n=305 files migrated A → C, total SHACL violations 307 → 307).
4. **No shim files needed** — Form A requires a label-named `<ClassName>.md` shim alongside the UUID-named original for Obsidian navigation; Form C avoids that duplication entirely.

**Enforcement:**

- Pre-write hook `~/.claude/hooks/validate-wikilinks.sh` emits a `warn` (not block) when an asset write contains a non-Form-C `exo__Instance_class` entry. Pre-existing files are untouched; the warning fires only on new content.
- The `/exocortex-asset` skill template emits Form C for all `exo__Instance_class` examples and references.

**Multiple classes example**:

```yaml
exo__Instance_class:
  - "[[1b20a8f0-d745-4e93-91db-4531b3df120e]]" # ems__Task
  - "[[08691c91-3d64-4f6c-a475-ec46daa1c1fb]]" # ims__Concept
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

### exo\_\_Asset_isArchived

**Archive status flag**

| Attribute        | Value                                        |
| ---------------- | -------------------------------------------- |
| **Type**         | Boolean or String                            |
| **Required**     | No (default: `false`)                        |
| **Format**       | `true`, `1`, `"true"`, `"yes"` (any truthy)  |
| **Purpose**      | Mark asset as archived/completed             |
| **Generated**    | Manual or via "Archive" command              |
| **Mutable**      | ✅ Yes                                       |
| **Effect**       | Hides from active views (if toggle enabled)  |
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
exo__Asset_isArchived: true;
exo__Asset_isArchived: 1;
exo__Asset_isArchived: "true";
exo__Asset_isArchived: "yes";
archived: true;
```

---

## ⚡ Effort Management Properties (ems\_\_ prefix)

Properties for **tasks**, **projects**, and **meetings** (collectively called "efforts").

### ems\_\_Effort_status

**Current effort status in workflow**

| Attribute        | Value                            |
| ---------------- | -------------------------------- |
| **Type**         | String (WikiLink)                |
| **Required**     | Yes (for efforts)                |
| **Format**       | `"[[ems__EffortStatus{Value}]]"` |
| **Purpose**      | Track progress through workflow  |
| **Generated**    | Default: `Draft` on creation     |
| **Mutable**      | ✅ Yes (via status commands)     |
| **Valid Values** | See status workflow below        |

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

### ems\_\_Effort_area

**Parent area reference (for tasks)**

| Attribute     | Value                            |
| ------------- | -------------------------------- |
| **Type**      | String (WikiLink)                |
| **Required**  | For tasks created from areas     |
| **Format**    | `"[[Area Name]]"`                |
| **Purpose**   | Link task to organizational area |
| **Generated** | When creating task from area     |
| **Mutable**   | Rarely (usually fixed)           |

**Example**:

```yaml
ems__Effort_area: "[[Work]]"
```

---

### ems\_\_Effort_parent

**Parent project/initiative reference**

| Attribute     | Value                                 |
| ------------- | ------------------------------------- |
| **Type**      | String (WikiLink)                     |
| **Required**  | For tasks/projects with parent        |
| **Format**    | `"[[Parent Name]]"`                   |
| **Purpose**   | Link to parent project or initiative  |
| **Generated** | When creating from project/initiative |
| **Mutable**   | Rarely                                |

**Example**:

```yaml
# Task within project
ems__Effort_parent: "[[Website Redesign]]"

# Project within initiative
ems__Effort_parent: "[[Q4 Goals]]"
```

---

### exo\_\_Asset_prototype

**Prototype template reference (for instances)**

| Attribute                                                  | Value                                 |
| ---------------------------------------------------------- | ------------------------------------- |
| **Type**                                                   | String (WikiLink)                     |
| **Required**                                               | For instances created from prototypes |
| **Format**                                                 | `"[[Prototype Name]]"`                |
| **Purpose**                                                | Link instance to template             |
| **Generated**                                              | When creating instance from prototype |
| **Mutable**                                                | ❌ No (immutable reference)           |
| **Inherits**: Algorithm section from prototype (if exists) |

**Example**:

```yaml
exo__Asset_prototype: "[[Breakfast]]"
```

---

### ems\_\_Effort_votes

**Priority vote count**

| Attribute     | Value                                      |
| ------------- | ------------------------------------------ |
| **Type**      | Number (integer)                           |
| **Required**  | No (default: 0)                            |
| **Format**    | Non-negative integer                       |
| **Purpose**   | Collaborative prioritization               |
| **Generated** | Starts at 0, incremented by "Vote" command |
| **Mutable**   | ✅ Yes (increment only)                    |
| **Sorting**   | Higher votes = higher priority             |

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

### ems\_\_Effort_day

**User-facing day tag for SPARQL search**

| Attribute     | Value                                                |
| ------------- | ---------------------------------------------------- |
| **Type**      | String (WikiLink to date)                            |
| **Required**  | No                                                   |
| **Format**    | `"[[YYYY-MM-DD]]"`                                   |
| **Purpose**   | Optional user-managed tag for SPARQL day queries     |
| **Generated** | Manually by user or via SPARQL/Dataview queries      |
| **Mutable**   | ✅ Yes                                               |
| **Used For**  | SPARQL filtering only (not read by plugin renderers) |

**Example**:

```yaml
ems__Effort_day: "[[2025-10-26]]"
```

**Notes**:

- Plugin daily-note aggregation filters tasks by `ems__Effort_startTimestamp`, `ems__Effort_endTimestamp`, `ems__Effort_plannedStartTimestamp`, and `ems__Effort_plannedEndTimestamp` — NOT by `ems__Effort_day`.
- Planning commands (`Plan on Today`, `Plan for Evening`, `Shift Day Forward/Backward`) update `ems__Effort_plannedStartTimestamp`, not `ems__Effort_day`.
- This property remains part of the public `ems:` SPARQL vocabulary (see `cli/docs/ONTOLOGY_REFERENCE.md`) — set it manually if you need day-tagging for custom queries.

---

### ems\_\_Effort_startTimestamp

**When effort started (entered Doing status)**

| Attribute     | Value                                     |
| ------------- | ----------------------------------------- |
| **Type**      | String (ISO 8601 timestamp)               |
| **Required**  | No                                        |
| **Format**    | `YYYY-MM-DDTHH:mm:ss`                     |
| **Purpose**   | Track when work began                     |
| **Generated** | Auto when status → Doing                  |
| **Mutable**   | ✅ Yes (if status changes back and forth) |
| **Cleared**   | No (preserved for history)                |

**Example**:

```yaml
ems__Effort_startTimestamp: 2025-10-26T09:15:30
```

---

### ems\_\_Effort_endTimestamp

**When effort ended (left Doing status)**

| Attribute     | Value                               |
| ------------- | ----------------------------------- |
| **Type**      | String (ISO 8601 timestamp)         |
| **Required**  | No                                  |
| **Format**    | `YYYY-MM-DDTHH:mm:ss`               |
| **Purpose**   | Track when work paused/stopped      |
| **Generated** | Auto when status changes from Doing |
| **Mutable**   | ✅ Yes                              |
| **Used For**  | Duration calculation                |

**Example**:

```yaml
ems__Effort_endTimestamp: 2025-10-26T17:30:00
```

---

### ems\_\_Effort_resolutionTimestamp

**When effort completed (moved to Done)**

| Attribute     | Value                                    |
| ------------- | ---------------------------------------- |
| **Type**      | String (ISO 8601 timestamp)              |
| **Required**  | No                                       |
| **Format**    | `YYYY-MM-DDTHH:mm:ss`                    |
| **Purpose**   | Track completion time                    |
| **Generated** | Auto when status → Done                  |
| **Mutable**   | ✅ Yes (if reopened and completed again) |

**Example**:

```yaml
ems__Effort_resolutionTimestamp: 2025-10-26T17:45:00
```

---

### ems\_\_Effort_plannedStartTimestamp

**Planned start time (for evening planning)**

| Attribute        | Value                                         |
| ---------------- | --------------------------------------------- |
| **Type**         | String (ISO 8601 timestamp)                   |
| **Required**     | No                                            |
| **Format**       | `YYYY-MM-DDTHH:mm:ss`                         |
| **Purpose**      | Schedule specific start time                  |
| **Generated**    | By "Plan for Evening" command (sets to 19:00) |
| **Mutable**      | ✅ Yes                                        |
| **Default Time** | 19:00:00 (7 PM)                               |

**Example**:

```yaml
ems__Effort_plannedStartTimestamp: 2025-10-26T19:00:00
```

---

### ems\_\_Task_size

**Task size estimate**

| Attribute        | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| **Type**         | String (enum)                                              |
| **Required**     | No                                                         |
| **Format**       | Single letter: `S`, `M`, `L`, `XL`                         |
| **Purpose**      | Effort estimation                                          |
| **Generated**    | User input during task creation (default: `M`)             |
| **Mutable**      | ✅ Yes                                                     |
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

### ems\_\_Area_parent

**Parent area reference (for child areas)**

| Attribute     | Value                    |
| ------------- | ------------------------ |
| **Type**      | String (WikiLink)        |
| **Required**  | For child areas only     |
| **Format**    | `"[[Parent Area Name]]"` |
| **Purpose**   | Build area hierarchy     |
| **Generated** | When creating child area |
| **Mutable**   | Rarely                   |
| **Used For**  | Hierarchy visualization  |

**Example**:

```yaml
ems__Area_parent: "[[Work]]"
```

---

### ems\_\_Effort_archived_date

**When effort was archived**

| Attribute     | Value                       |
| ------------- | --------------------------- |
| **Type**      | String (ISO 8601 timestamp) |
| **Required**  | No                          |
| **Format**    | `YYYY-MM-DDTHH:mm:ss`       |
| **Purpose**   | Track archive date          |
| **Generated** | When archiving asset        |
| **Mutable**   | Yes                         |

**Example**:

```yaml
ems__Effort_archived_date: 2025-10-15T10:00:00
```

---

### ems\_\_Effort_workflow

**Override default workflow for this specific asset**

| Attribute      | Value                                        |
| -------------- | -------------------------------------------- |
| **Type**       | String (WikiLink, optional)                  |
| **Required**   | No                                           |
| **Format**     | `"[[workflow-uid\|Custom Workflow Name]]"`   |
| **Purpose**    | Override the default workflow for this asset |
| **Applied to** | Any effort (Task, Project, Meeting)          |
| **Generated**  | Manually by user                             |
| **Mutable**    | Yes                                          |

**Resolution priority**:

1. Asset-specific workflow (`ems__Effort_workflow` property on the asset)
2. Class default workflow (`ems__Workflow_isDefault = true` for the asset class)
3. Hardcoded fallback (backward compatibility)

**Example**:

```yaml
ems__Effort_workflow: "[[wf-kanban-uid|Kanban Workflow]]"
```

**Use cases**:

- A specific project needs a simplified Draft → Done workflow
- A meeting type requires different status transitions
- Experimental workflows on selected assets without changing the class default

---

### ems\_\_Workflow_targetClass

**Target asset class for this workflow**

| Attribute    | Value                                              |
| ------------ | -------------------------------------------------- |
| **Type**     | String (WikiLink)                                  |
| **Required** | Yes (for ems\_\_Workflow assets)                   |
| **Format**   | `"[[ems__Task]]"` or `"[[ems__Project]]"`          |
| **Purpose**  | Specify which asset class this workflow applies to |
| **Mutable**  | Rarely                                             |

**Example**:

```yaml
ems__Workflow_targetClass: "[[ems__Task]]"
```

---

### ems\_\_Workflow_initialState

**Starting status for new assets using this workflow**

| Attribute    | Value                                   |
| ------------ | --------------------------------------- |
| **Type**     | String (WikiLink)                       |
| **Required** | Yes (for ems\_\_Workflow assets)        |
| **Format**   | `"[[ems__EffortStatus{Value}]]"`        |
| **Purpose**  | Define which status new assets start in |
| **Default**  | `ems__EffortStatusDraft`                |

**Example**:

```yaml
ems__Workflow_initialState: "[[ems__EffortStatusDraft]]"
```

---

### ems\_\_Workflow_terminalStates

**Statuses that end the workflow**

| Attribute    | Value                                   |
| ------------ | --------------------------------------- |
| **Type**     | Array of WikiLinks                      |
| **Required** | Yes (for ems\_\_Workflow assets)        |
| **Format**   | `["[[ems__EffortStatus{Value}]]"]`      |
| **Purpose**  | Define which statuses end the lifecycle |
| **Default**  | `[Done, Trashed]`                       |

**Example**:

```yaml
ems__Workflow_terminalStates:
  - "[[ems__EffortStatusDone]]"
  - "[[ems__EffortStatusTrashed]]"
```

---

### ems\_\_Workflow_isDefault

**Whether this is the default workflow for the target class**

| Attribute    | Value                            |
| ------------ | -------------------------------- |
| **Type**     | Boolean                          |
| **Required** | Yes (for ems\_\_Workflow assets) |
| **Format**   | `true` or `false`                |
| **Purpose**  | Mark as class default workflow   |

**Example**:

```yaml
ems__Workflow_isDefault: true
```

---

### ems\_\_WorkflowState_workflow

**Parent workflow reference**

| Attribute    | Value                                 |
| ------------ | ------------------------------------- |
| **Type**     | String (WikiLink)                     |
| **Required** | Yes (for ems\_\_WorkflowState assets) |
| **Format**   | `"[[workflow-uid\|Workflow Name]]"`   |
| **Purpose**  | Link state to its parent workflow     |

**Example**:

```yaml
ems__WorkflowState_workflow: "[[a1b2c3d4-uid|My Workflow]]"
```

---

### ems\_\_WorkflowState_status

**EffortStatus this state represents**

| Attribute    | Value                                 |
| ------------ | ------------------------------------- |
| **Type**     | String (WikiLink)                     |
| **Required** | Yes (for ems\_\_WorkflowState assets) |
| **Format**   | `"[[ems__EffortStatus{Value}]]"`      |
| **Purpose**  | Map state to a valid EffortStatus     |

**Example**:

```yaml
ems__WorkflowState_status: "[[ems__EffortStatusDoing]]"
```

---

### ems\_\_WorkflowState_order

**Display order within the workflow**

| Attribute    | Value                                 |
| ------------ | ------------------------------------- |
| **Type**     | Number (integer)                      |
| **Required** | Yes (for ems\_\_WorkflowState assets) |
| **Format**   | Positive integer                      |
| **Purpose**  | Define state order (lower = earlier)  |

**Example**:

```yaml
ems__WorkflowState_order: 3
```

---

### ems\_\_WorkflowState_optional

**Whether this state can be skipped**

| Attribute    | Value                          |
| ------------ | ------------------------------ |
| **Type**     | Boolean                        |
| **Required** | No (default: `false`)          |
| **Purpose**  | Allow users to skip this state |

**Example**:

```yaml
ems__WorkflowState_optional: true
```

---

### ems\_\_WorkflowState_timestampOnEnter

**Timestamp properties to set when entering this state**

| Attribute    | Value                                               |
| ------------ | --------------------------------------------------- |
| **Type**     | Array of Strings                                    |
| **Required** | No                                                  |
| **Format**   | Property names (e.g., `ems__Effort_startTimestamp`) |
| **Purpose**  | Automatically record timestamps on state entry      |

**Example**:

```yaml
ems__WorkflowState_timestampOnEnter:
  - ems__Effort_startTimestamp
```

---

### ems\_\_WorkflowState_badgeColor

**CSS color for badge display**

| Attribute    | Value                                  |
| ------------ | -------------------------------------- |
| **Type**     | String                                 |
| **Required** | No                                     |
| **Format**   | Any valid CSS color (`#ff0000`, `red`) |
| **Purpose**  | Customize state badge appearance       |

**Example**:

```yaml
ems__WorkflowState_badgeColor: "#4CAF50"
```

---

### ems\_\_WorkflowTransition_workflow

**Parent workflow reference for this transition**

| Attribute    | Value                                      |
| ------------ | ------------------------------------------ |
| **Type**     | String (WikiLink)                          |
| **Required** | Yes (for ems\_\_WorkflowTransition assets) |
| **Format**   | `"[[workflow-uid\|Workflow Name]]"`        |
| **Purpose**  | Link transition to its parent workflow     |

**Example**:

```yaml
ems__WorkflowTransition_workflow: "[[a1b2c3d4-uid|My Workflow]]"
```

---

### ems\_\_WorkflowTransition_from

**Source status of this transition**

| Attribute    | Value                                           |
| ------------ | ----------------------------------------------- |
| **Type**     | String (WikiLink)                               |
| **Required** | Yes (for ems\_\_WorkflowTransition assets)      |
| **Format**   | `"[[ems__EffortStatus{Value}]]"`                |
| **Purpose**  | Define which status this transition starts from |

**Example**:

```yaml
ems__WorkflowTransition_from: "[[ems__EffortStatusDraft]]"
```

---

### ems\_\_WorkflowTransition_to

**Target status of this transition**

| Attribute    | Value                                        |
| ------------ | -------------------------------------------- |
| **Type**     | String (WikiLink)                            |
| **Required** | Yes (for ems\_\_WorkflowTransition assets)   |
| **Format**   | `"[[ems__EffortStatus{Value}]]"`             |
| **Purpose**  | Define which status this transition leads to |

**Example**:

```yaml
ems__WorkflowTransition_to: "[[ems__EffortStatusDoing]]"
```

---

### ems\_\_WorkflowTransition_label

**Button label text for this transition**

| Attribute    | Value                                       |
| ------------ | ------------------------------------------- |
| **Type**     | String                                      |
| **Required** | No (default: `"from → to"`)                 |
| **Purpose**  | Human-readable label for transition buttons |

**Example**:

```yaml
ems__WorkflowTransition_label: "▶ Start"
```

---

### ems\_\_WorkflowTransition_icon

**Lucide icon name for the transition button**

| Attribute    | Value                                    |
| ------------ | ---------------------------------------- |
| **Type**     | String                                   |
| **Required** | No                                       |
| **Format**   | Lucide icon name (e.g., `play`, `check`) |
| **Purpose**  | Visual icon for transition buttons       |

**Example**:

```yaml
ems__WorkflowTransition_icon: play
```

---

### ems\_\_WorkflowTransition_isRollback

**Whether this is a rollback (undo) transition**

| Attribute    | Value                                         |
| ------------ | --------------------------------------------- |
| **Type**     | Boolean                                       |
| **Required** | No (default: `false`)                         |
| **Purpose**  | Mark transition as rollback for UI separation |

**Example**:

```yaml
ems__WorkflowTransition_isRollback: true
```

---

## 🧠 Information Management Properties (ims\_\_ prefix)

Properties for **concepts** and knowledge management.

### ims\_\_Concept_broader

**Parent concept reference**

| Attribute     | Value                                      |
| ------------- | ------------------------------------------ |
| **Type**      | String (WikiLink)                          |
| **Required**  | For narrower concepts                      |
| **Format**    | `"[[Parent Concept]]"`                     |
| **Purpose**   | Build concept hierarchy (broader/narrower) |
| **Generated** | When creating narrower concept             |
| **Mutable**   | Rarely                                     |

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

### ims\_\_Concept_definition

**Concept definition text**

| Attribute     | Value                          |
| ------------- | ------------------------------ |
| **Type**      | String                         |
| **Required**  | For concepts (recommended)     |
| **Format**    | Free text                      |
| **Purpose**   | Define what the concept means  |
| **Generated** | User input                     |
| **Mutable**   | ✅ Yes (can refine definition) |

**Example**:

```yaml
ims__Concept_definition: A typed superset of JavaScript that compiles to plain JavaScript
```

---

## 🔢 Property Cardinality Declarations

Property-definition assets may declare their cardinality via `exo__Property_cardinality`. This drives SHACL-lite validation and cardinality-aware serialization in `exocortex-cli create` (see issues #3099, #3179).

### exo\_\_Property_cardinality

**Multiplicity constraint for a property**

| Attribute    | Value                                                                                |
| ------------ | ------------------------------------------------------------------------------------ |
| **Type**     | WikiLink                                                                             |
| **Required** | No (omission ≡ scalar — vault convention default per issue #3179)                    |
| **Domain**   | Asset of class `exo__Property` or `exo__ObjectProperty`                              |
| **Range**    | `exo__PropertyCardinalitySingle` or `exo__PropertyCardinalityMultiple`               |
| **Purpose**  | SHACL-lite cardinality validation; CLI scalar-vs-array YAML serialization            |
| **Mutable**  | ✅ Yes — adding/changing the declaration takes effect on the next CLI/validator load |

**Example — single-valued property**:

```yaml
# /Users/.../03 Knowledge/ems/ems__Effort_status.md
---
exo__Asset_uid: 44c6e9e3-955f-4afc-9ca5-b4bd70667051
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Property_domain: "[[ems__Effort]]"
exo__Property_range: "[[ems__EffortStatus]]"
exo__Property_cardinality: "[[exo__PropertyCardinalitySingle]]"
---
```

With this declaration (or when the property has no cardinality declaration at all), `exocortex-cli create --property ems__Effort_status=[[…]]` emits the value as a scalar:

```yaml
ems__Effort_status: "[[ems__EffortStatusBacklog]]" # ✅ scalar (vault convention default)
```

Only properties explicitly declared with `PropertyCardinalityMultiple` are wrapped in a YAML array:

```yaml
# When the property's TBox file declares exo__Property_cardinality: "[[exo__PropertyCardinalityMultiple]]"
some__Multi_field:
  - "[[uuid-a]]"
  - "[[uuid-b]]"
```

**Migration guidance**: declare `PropertyCardinalityMultiple` on properties that genuinely accept multiple values (e.g., bag-style relations, tag lists). Omission and `PropertyCardinalitySingle` both produce scalar emission per the prevailing vault convention (4000+ instances of `exo__Asset_isDefinedBy`, `exo__Asset_prototype`, `ems__Effort_status`, `ems__Effort_area`). System-property arrays — `exo__Instance_class`, `aliases` — are emitted via dedicated code paths in `AssetCreationService.buildFrontmatter` and are not affected by this rule.

> **Behavior change (issue #3179, June 2026)**: prior to this fix, undeclared cardinality silently fell back to single-entry array form, contradicting the vault convention and forcing post-processing (e.g., the `week-planner` skill's `flatten_singles_in_file()` helper). Existing vault content using array form for single-cardinality predicates continues to be read correctly by Obsidian — only newly-created assets follow the new default.

---

## 📝 Personal Notes Properties (pn\_\_ prefix)

Properties for daily notes and personal journaling.

### pn\_\_DailyNote_date

**Date for daily note**

| Attribute     | Value                            |
| ------------- | -------------------------------- |
| **Type**      | String (WikiLink to date)        |
| **Required**  | For daily notes                  |
| **Format**    | `"[[YYYY-MM-DD]]"`               |
| **Purpose**   | Identify daily note date         |
| **Generated** | Auto from filename or user input |
| **Mutable**   | Rarely                           |

**Example**:

```yaml
pn__DailyNote_date: "[[2025-10-26]]"
```

---

## 📋 Obsidian Standard Properties

Properties that Obsidian recognizes natively.

### aliases

**Alternative names for note**

| Attribute          | Value                                      |
| ------------------ | ------------------------------------------ |
| **Type**           | Array of strings                           |
| **Required**       | No                                         |
| **Format**         | YAML array                                 |
| **Purpose**        | Enable search/linking by alternative names |
| **Auto-Populated** | With `exo__Asset_label` value              |
| **Mutable**        | ✅ Yes                                     |

**Example**:

```yaml
aliases:
  - Review PR #123
  - PR 123 Review
```

---

### archived

**Obsidian's native archive property**

| Attribute        | Value                                   |
| ---------------- | --------------------------------------- |
| **Type**         | Boolean or String                       |
| **Required**     | No                                      |
| **Format**       | `true` or `"true"`                      |
| **Purpose**      | Obsidian's standard archival system     |
| **Also Checked** | As fallback for `exo__Asset_isArchived` |

**Example**:

```yaml
archived: true
```

---

## 🔄 Property Inheritance Rules

### When Creating Child Assets

#### Rule 1: Always Inherited

| Property                 | From Parent | To Child   |
| ------------------------ | ----------- | ---------- |
| `exo__Asset_isDefinedBy` | ✅ Copied   | Same value |

**Example**:

```yaml
# Parent Area
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"

# Child Task (inherits)
exo__Asset_isDefinedBy: "[[Ontology/EMS]]"
```

#### Rule 2: Never Inherited

| Property               | Reason                   |
| ---------------------- | ------------------------ |
| `exo__Asset_uid`       | Always new UUID          |
| `exo__Asset_createdAt` | Always current timestamp |
| `exo__Asset_label`     | User input or generated  |
| `ems__Effort_status`   | Always starts at Draft   |
| `ems__Effort_votes`    | Always starts at 0       |

#### Rule 3: Conditionally Inherited (via Property Maps)

**EFFORT_PROPERTY_MAP** (determines parent relationship):

| Source Class            | Property Added         | Value                     |
| ----------------------- | ---------------------- | ------------------------- |
| `ems__Area`             | `ems__Effort_area`     | `"[[{area-name}]]"`       |
| `ems__Project`          | `ems__Effort_parent`   | `"[[{project-name}]]"`    |
| `ems__TaskPrototype`    | `exo__Asset_prototype` | `"[[{prototype-name}]]"`  |
| `ems__MeetingPrototype` | `exo__Asset_prototype` | `"[[{prototype-name}]]"`  |
| `ems__Initiative`       | `ems__Effort_parent`   | `"[[{initiative-name}]]"` |

**INSTANCE_CLASS_MAP** (determines child type):

| Source Class            | Child Instance Class |
| ----------------------- | -------------------- |
| `ems__Area`             | `ems__Task`          |
| `ems__Project`          | `ems__Task`          |
| `ems__TaskPrototype`    | `ems__Task`          |
| `ems__MeetingPrototype` | `ems__Meeting`       |

**Example**:

```yaml
# Creating task from Area "Work"
# Input: sourceClass = "ems__Area", sourceName = "Work"
# Output frontmatter:
exo__Instance_class:
  - "[[ems__Task]]" # From INSTANCE_CLASS_MAP
ems__Effort_area: "[[Work]]" # From EFFORT_PROPERTY_MAP
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
  Draft: ["Backlog", "Trashed"],
  Backlog: ["Draft", "Analysis", "Doing", "Trashed"],
  Analysis: ["Backlog", "ToDo", "Trashed"],
  ToDo: ["Analysis", "Doing", "Trashed"],
  Doing: ["Backlog", "ToDo", "Done", "Trashed"],
  Done: ["Doing", "Trashed"],
  Trashed: [], // Terminal state
};
```

#### Vote Constraints

```typescript
// Votes must be non-negative
ems__Effort_votes >= 0;
```

#### Effort Day

```typescript
// Must be valid date in format YYYY-MM-DD
/^\d{4}-\d{2}-\d{2}$/;
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
- [CommandVisibility.ts](../src/domain/commands/CommandVisibility.ts) - Visibility rules source

---

**Maintainer**: @kitelev
**Related Issues**: #122 (Core Extraction), #124 (Architecture Documentation)
