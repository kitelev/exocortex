# Workflow Customization Guide

**Version**: 1.0
**Last Updated**: 2026-03-23

---

## Overview

Workflow customization lets you define custom status lifecycles for tasks, projects, and other effort assets. Instead of using the built-in Draft-Backlog-Doing-Done pipeline, you can:

- **Skip unnecessary steps** (e.g., remove Analysis for simple task workflows)
- **Add custom statuses** (e.g., "In Review" between Doing and Done)
- **Per-project overrides** (e.g., a Kanban board project uses a simplified workflow)

Workflows are defined as regular vault assets (Markdown files with frontmatter), so they live alongside your knowledge and are version-controlled.

---

## Default Workflows

### Project Workflow

```
Draft → Backlog → Analysis → ToDo → Doing → Done
                                        ↓
                                     Trashed
```

Projects include **Analysis** and **ToDo** states for planning phases before execution.

### Task Workflow

```
Draft → Backlog → Doing → Done
                    ↓
                 Trashed
```

Tasks skip Analysis and ToDo, going directly from Backlog to Doing.

Both workflows support **rollback transitions** (moving backward) at every step.

---

## How Workflows Work

### Three Asset Types

Custom workflows are built from three asset classes:

| Asset Class               | Purpose                                                            | Example                  |
| ------------------------- | ------------------------------------------------------------------ | ------------------------ |
| `ems__Workflow`           | Top-level definition (name, target class, initial/terminal states) | "Simple Kanban"          |
| `ems__WorkflowState`      | A single state within a workflow (status, order, badge color)      | "Doing" state at order 2 |
| `ems__WorkflowTransition` | An allowed transition between two states (from, to, label)         | Backlog → Doing          |

### Loading Pipeline

```
Vault .md files
    ↓
VaultRDFIndexer (parses frontmatter → RDF triples)
    ↓
TripleStore (stores all triples in memory)
    ↓
WorkflowResolver (queries triples, builds WorkflowDefinition)
    ↓
WorkflowEngine (drives transitions, validates structure)
```

### Resolution Priority

When determining which workflow applies to an asset:

1. **Asset-specific** -- the `ems__Effort_workflow` property on the asset itself
2. **Class default** -- `ems__Workflow_isDefault = true` for the asset's class
3. **Hardcoded fallback** -- built-in workflows for backward compatibility

---

## Creating a Custom Workflow (Step-by-Step)

This example creates a "Simple Kanban" workflow with three states: Draft, Doing, Done.

### Step 1: Create the Workflow Asset

Create a file (e.g., `wf-simple-kanban.md`):

```yaml
---
exo__Asset_uid: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
exo__Asset_label: Simple Kanban
exo__Asset_createdAt: 2026-03-23T10:00:00
exo__Instance_class:
  - "[[ems__Workflow]]"
ems__Workflow_targetClass: "[[ems__Task]]"
ems__Workflow_initialState: "[[ems__EffortStatusDraft]]"
ems__Workflow_terminalStates:
  - "[[ems__EffortStatusDone]]"
  - "[[ems__EffortStatusTrashed]]"
ems__Workflow_isDefault: false
aliases:
  - Simple Kanban
---
A minimal three-state workflow for lightweight task tracking.
```

### Step 2: Create State Assets

**State 1 -- Draft** (`wfs-kanban-draft.md`):

```yaml
---
exo__Asset_uid: d1111111-1111-4111-8111-111111111111
exo__Asset_label: "Kanban: Draft"
exo__Asset_createdAt: 2026-03-23T10:01:00
exo__Instance_class:
  - "[[ems__WorkflowState]]"
ems__WorkflowState_workflow: "[[a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d|Simple Kanban]]"
ems__WorkflowState_status: "[[ems__EffortStatusDraft]]"
ems__WorkflowState_order: 1
ems__WorkflowState_optional: false
aliases:
  - "Kanban: Draft"
---
```

**State 2 -- Doing** (`wfs-kanban-doing.md`):

```yaml
---
exo__Asset_uid: d2222222-2222-4222-8222-222222222222
exo__Asset_label: "Kanban: Doing"
exo__Asset_createdAt: 2026-03-23T10:02:00
exo__Instance_class:
  - "[[ems__WorkflowState]]"
ems__WorkflowState_workflow: "[[a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d|Simple Kanban]]"
ems__WorkflowState_status: "[[ems__EffortStatusDoing]]"
ems__WorkflowState_order: 2
ems__WorkflowState_optional: false
ems__WorkflowState_timestampOnEnter:
  - ems__Effort_startTimestamp
aliases:
  - "Kanban: Doing"
---
```

**State 3 -- Done** (`wfs-kanban-done.md`):

```yaml
---
exo__Asset_uid: d3333333-3333-4333-8333-333333333333
exo__Asset_label: "Kanban: Done"
exo__Asset_createdAt: 2026-03-23T10:03:00
exo__Instance_class:
  - "[[ems__WorkflowState]]"
ems__WorkflowState_workflow: "[[a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d|Simple Kanban]]"
ems__WorkflowState_status: "[[ems__EffortStatusDone]]"
ems__WorkflowState_order: 3
ems__WorkflowState_optional: false
ems__WorkflowState_timestampOnEnter:
  - ems__Effort_endTimestamp
  - ems__Effort_resolutionTimestamp
aliases:
  - "Kanban: Done"
---
```

### Step 3: Create Transition Assets

**Forward: Draft to Doing** (`wft-kanban-draft-doing.md`):

```yaml
---
exo__Asset_uid: t1111111-1111-4111-8111-111111111111
exo__Asset_label: "Kanban: Draft → Doing"
exo__Asset_createdAt: 2026-03-23T10:04:00
exo__Instance_class:
  - "[[ems__WorkflowTransition]]"
ems__WorkflowTransition_workflow: "[[a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d|Simple Kanban]]"
ems__WorkflowTransition_from: "[[ems__EffortStatusDraft]]"
ems__WorkflowTransition_to: "[[ems__EffortStatusDoing]]"
ems__WorkflowTransition_label: "▶ Start"
ems__WorkflowTransition_icon: play
ems__WorkflowTransition_isRollback: false
aliases:
  - "Kanban: Draft → Doing"
---
```

**Forward: Doing to Done** (`wft-kanban-doing-done.md`):

```yaml
---
exo__Asset_uid: t2222222-2222-4222-8222-222222222222
exo__Asset_label: "Kanban: Doing → Done"
exo__Asset_createdAt: 2026-03-23T10:05:00
exo__Instance_class:
  - "[[ems__WorkflowTransition]]"
ems__WorkflowTransition_workflow: "[[a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d|Simple Kanban]]"
ems__WorkflowTransition_from: "[[ems__EffortStatusDoing]]"
ems__WorkflowTransition_to: "[[ems__EffortStatusDone]]"
ems__WorkflowTransition_label: "✓ Done"
ems__WorkflowTransition_icon: check
ems__WorkflowTransition_isRollback: false
aliases:
  - "Kanban: Doing → Done"
---
```

**Rollback: Doing to Draft** (`wft-kanban-doing-draft.md`):

```yaml
---
exo__Asset_uid: t3333333-3333-4333-8333-333333333333
exo__Asset_label: "Kanban: Doing → Draft"
exo__Asset_createdAt: 2026-03-23T10:06:00
exo__Instance_class:
  - "[[ems__WorkflowTransition]]"
ems__WorkflowTransition_workflow: "[[a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d|Simple Kanban]]"
ems__WorkflowTransition_from: "[[ems__EffortStatusDoing]]"
ems__WorkflowTransition_to: "[[ems__EffortStatusDraft]]"
ems__WorkflowTransition_label: "← Draft"
ems__WorkflowTransition_isRollback: true
aliases:
  - "Kanban: Doing → Draft"
---
```

### Step 4: Reload

Reload Obsidian (or re-open the vault) so the plugin re-indexes and picks up the
new workflow assets. The plugin validates the workflow structure on load and
falls back to the built-in workflow if the definition is malformed.

---

## Per-Project Workflow Override

To assign a specific workflow to one project (instead of using the class default), set the `ems__Effort_workflow` property:

```yaml
---
exo__Asset_uid: 7c9e6679-7425-40de-944b-e07fc1f90ae7
exo__Asset_label: Q1 Sprint Board
exo__Instance_class:
  - "[[ems__Project]]"
ems__Effort_status: "[[ems__EffortStatusDoing]]"
ems__Effort_workflow: "[[a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d|Simple Kanban]]"
---
```

The wikilink format is `[[workflow-uid|Display Name]]`. The WorkflowResolver will look up the workflow by its UID and use it instead of the class default.

---

## Property Reference

### ems\_\_Workflow Properties

| Property                       | Type       | Required | Description                                                                    |
| ------------------------------ | ---------- | -------- | ------------------------------------------------------------------------------ |
| `ems__Workflow_targetClass`    | WikiLink   | Yes      | Asset class this workflow applies to (`"[[ems__Task]]"`, `"[[ems__Project]]"`) |
| `ems__Workflow_initialState`   | WikiLink   | Yes      | Starting status for new assets (`"[[ems__EffortStatusDraft]]"`)                |
| `ems__Workflow_terminalStates` | WikiLink[] | Yes      | Statuses that end the workflow (array)                                         |
| `ems__Workflow_isDefault`      | Boolean    | Yes      | Whether this is the default workflow for the target class                      |

### ems\_\_WorkflowState Properties

| Property                              | Type     | Required | Description                                             |
| ------------------------------------- | -------- | -------- | ------------------------------------------------------- |
| `ems__WorkflowState_workflow`         | WikiLink | Yes      | Parent workflow this state belongs to                   |
| `ems__WorkflowState_status`           | WikiLink | Yes      | The EffortStatus value (`"[[ems__EffortStatusDoing]]"`) |
| `ems__WorkflowState_order`            | Number   | Yes      | Display order (lower = earlier in workflow)             |
| `ems__WorkflowState_optional`         | Boolean  | No       | Whether this state can be skipped (default: `false`)    |
| `ems__WorkflowState_timestampOnEnter` | String[] | No       | Property names to set when entering state               |
| `ems__WorkflowState_badgeColor`       | String   | No       | CSS color for badge display                             |

### ems\_\_WorkflowTransition Properties

| Property                             | Type     | Required | Description                                              |
| ------------------------------------ | -------- | -------- | -------------------------------------------------------- |
| `ems__WorkflowTransition_workflow`   | WikiLink | Yes      | Parent workflow this transition belongs to               |
| `ems__WorkflowTransition_from`       | WikiLink | Yes      | Source status                                            |
| `ems__WorkflowTransition_to`         | WikiLink | Yes      | Target status                                            |
| `ems__WorkflowTransition_label`      | String   | No       | Button label text (default: `"from → to"`)               |
| `ems__WorkflowTransition_icon`       | String   | No       | Lucide icon name for the button                          |
| `ems__WorkflowTransition_isRollback` | Boolean  | No       | Whether this is a rollback transition (default: `false`) |

### Effort Override Property

| Property               | Type     | Required | Description                                       |
| ---------------------- | -------- | -------- | ------------------------------------------------- |
| `ems__Effort_workflow` | WikiLink | No       | Override default workflow for this specific asset |

---

## Validation

The plugin validates workflow structure automatically when it loads the vault.
A malformed workflow (see the checks below) is ignored and the built-in workflow
is used as a fallback, so a broken custom workflow never bricks the UI.

Validation checks:

- At least one state exists
- Initial state is in the states list
- All terminal states are in the states list
- All transition endpoints reference existing states
- Non-terminal states have at least one outgoing forward transition
- No duplicate transitions (same from/to pair)

---

## Troubleshooting

### No workflow assets found

**Symptom**: The plugin uses the built-in workflow instead of a custom one.

**Cause**: No files with `exo__Instance_class: ["[[ems__Workflow]]"]` in the vault.

**Solution**: This is expected behavior. The system uses hardcoded fallback workflows (see Default Workflows above) when no custom workflows exist. Create workflow assets only when you need to customize.

### Validation errors

**Symptom**: On load, the plugin ignores the custom workflow and reports validation errors like "State X has no outgoing forward transitions" (developer console / notice).

**Common causes**:

- Missing transition assets -- every non-terminal state needs at least one forward transition
- Typo in status wikilinks -- must exactly match `ems__EffortStatusDraft`, `ems__EffortStatusDoing`, etc.
- Wrong workflow reference -- state/transition `_workflow` property must point to the correct workflow UID

**Solution**: Check that all state and transition files reference the same workflow UID, and that status wikilinks match the valid `EffortStatus` values:

- `ems__EffortStatusDraft`
- `ems__EffortStatusBacklog`
- `ems__EffortStatusWaiting`
- `ems__EffortStatusDoing`
- `ems__EffortStatusDone`
- `ems__EffortStatusTrashed`

### Workflow not applied to asset

**Symptom**: Asset still shows the default workflow transitions despite `ems__Effort_workflow` being set.

**Possible causes**:

1. The wikilink UID in `ems__Effort_workflow` does not match any workflow asset's `exo__Asset_uid`
2. The workflow asset has `ems__Workflow_isDefault: false` and is not referenced by the asset
3. Cache not invalidated -- restart the plugin or CLI to clear the WorkflowResolver cache

---

## Related Documentation

- [Property Schema Reference](../reference/PROPERTY_SCHEMA.md) -- All frontmatter properties
- [Architecture Guide](../../ARCHITECTURE.md) -- System architecture
