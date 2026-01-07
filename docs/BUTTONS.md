# RDF-Driven Buttons Reference

> Complete reference for Exocortex's 29 built-in buttons. All buttons are defined in RDF ontologies and can be customized without TypeScript code.

## Overview

Exocortex provides a declarative button system where:
- **Buttons** are UI elements that trigger actions
- **Actions** define what happens when clicked (update property, create asset, navigate, etc.)
- **Conditions** control when buttons are visible
- **Groups** organize buttons into logical categories

```
┌────────────┐    ┌────────────┐    ┌────────────┐
│   Button   │───▶│   Action   │───▶│  Service   │
│ (UI/RDF)   │    │  (What)    │    │  (How)     │
└────────────┘    └────────────┘    └────────────┘
      │
      ▼
┌────────────┐
│ Condition  │
│ (When)     │
└────────────┘
```

## Button Groups

### Creation Group

Buttons for creating new assets from the current context.

| Button | ID | Icon | Variant | Visible When |
|--------|-----|------|---------|--------------|
| **Create Task** | `create-task` | — | primary | Asset is Area, Project, or Task |
| **Create Project** | `create-project` | — | primary | Asset is Area or Project |
| **Create Area** | `create-area` | — | primary | Asset is Area |
| **Create Instance** | `create-instance` | — | primary | Asset is Prototype (Task/Meeting) |
| **Create Related Task** | `create-related-task` | — | primary | Asset is Concept |
| **Create Narrower Concept** | `create-narrower-concept` | — | primary | Asset is Concept |
| **Create Subclass** | `create-subclass` | — | primary | Asset is Class |
| **Create Task (DailyNote)** | `create-task-for-dailynote` | — | primary | Asset is DailyNote |

**Example — Create Task Button:**
```turtle
ems-ui:CreateTaskButton a exo-ui:Button ;
    rdfs:label "Create Task" ;
    exo-ui:Button_variant "primary" ;
    exo-ui:Button_group exo-ui:CreationButtonGroup ;
    exo-ui:Button_action ems-ui:CreateTaskAction ;
    exo-ui:Button_condition ems-ui:CanCreateTaskCondition .
```

### Status Group

Buttons for transitioning task lifecycle status.

| Button | ID | Icon | Variant | Visible When |
|--------|-----|------|---------|--------------|
| **Set Draft Status** | `set-draft-status` | — | secondary | Task/Project not Draft, not archived |
| **Move to Backlog** | `move-to-backlog` | — | secondary | Task/Project in Draft |
| **Move to Analysis** | `move-to-analysis` | — | secondary | Task/Project in Backlog |
| **Move to ToDo** | `move-to-todo` | — | secondary | Task/Project in Backlog or Analysis |
| **Start Effort** | `start-effort` | — | secondary | Task/Project in ToDo |
| **Mark Done** | `mark-done` | — | success | Task/Project in Doing |
| **Rollback Status** | `rollback-status` | — | warning | Has previous status to rollback to |

**Status Lifecycle:**
```
Draft → Backlog → Analysis → ToDo → Doing → Done
                     │
                     └──────────→ Trashed
```

**Example — Mark Done Button:**
```turtle
ems-ui:DoneButton a exo-ui:Button ;
    rdfs:label "Mark Done" ;
    exo-ui:Button_variant "success" ;
    exo-ui:Button_group exo-ui:StatusButtonGroup ;
    exo-ui:Button_action ems-ui:MarkDoneAction ;
    exo-ui:Button_condition ems-ui:IsDoingCondition .
```

### Planning Group

Buttons for time-based planning and prioritization.

| Button | ID | Icon | Variant | Visible When |
|--------|-----|------|---------|--------------|
| **Set Active Focus** | `set-active-focus` | — | warning | Asset is Area |
| **Plan on Today** | `plan-on-today` | — | warning | Task/Project in ToDo/Doing |
| **Plan for Evening** | `plan-for-evening` | — | warning | Task/Project in ToDo/Doing |
| **Shift Day ◀** | `shift-day-backward` | — | warning | Task/Project with planned date |
| **Shift Day ▶** | `shift-day-forward` | — | warning | Task/Project with planned date |
| **Vote** | `vote-on-effort` | — | warning | Asset is Effort (Task/Project/Meeting) |

**Example — Plan on Today Button:**
```turtle
ems-ui:PlanTodayButton a exo-ui:Button ;
    rdfs:label "Plan on Today" ;
    exo-ui:Button_variant "warning" ;
    exo-ui:Button_group exo-ui:PlanningButtonGroup ;
    exo-ui:Button_action ems-ui:PlanTodayAction ;
    exo-ui:Button_condition ems-ui:CanPlanOnTodayCondition .
```

### Maintenance Group

Buttons for asset maintenance and cleanup.

| Button | ID | Icon | Variant | Visible When |
|--------|-----|------|---------|--------------|
| **Trash** | `trash` | — | danger | Effort (Task/Project) not trashed |
| **Archive** | `archive` | — | danger | Task/Project completed, not archived |
| **Clean Properties** | `clean-properties` | — | secondary | Any asset with empty properties |
| **Repair Folder** | `repair-folder` | — | secondary | Asset in wrong folder |
| **Rename to UID** | `rename-to-uid` | — | secondary | Filename ≠ UID |
| **Copy Label to Aliases** | `copy-label-to-aliases` | — | secondary | Any asset |
| **Convert to Project** | `convert-task-to-project` | — | primary | Asset is Task |
| **Convert to Task** | `convert-project-to-task` | — | primary | Asset is Project |

**Example — Cleanup Button:**
```turtle
ems-ui:CleanupButton a exo-ui:Button ;
    rdfs:label "Clean Properties" ;
    exo-ui:Button_variant "secondary" ;
    exo-ui:Button_group exo-ui:MaintenanceButtonGroup ;
    exo-ui:Button_action ems-ui:CleanupAction ;
    exo-ui:Button_condition ems-ui:HasEmptyPropertiesCondition .
```

## Conditions Reference

Conditions control when buttons are visible. They can check:

### Asset Class Conditions

| Condition | True When |
|-----------|-----------|
| `canCreateTask` | Asset is Area, Project, or Task |
| `canCreateProject` | Asset is Area or Project |
| `canCreateChildArea` | Asset is Area |
| `canCreateInstance` | Asset is TaskPrototype or MeetingPrototype |
| `canCreateRelatedTask` | Asset is Concept |
| `canCreateNarrowerConcept` | Asset is Concept |
| `canCreateSubclass` | Asset is Class |
| `canCreateTaskForDailyNote` | Asset is DailyNote |

### Status Conditions

| Condition | True When |
|-----------|-----------|
| `canSetDraftStatus` | Task/Project, not Draft, not archived |
| `canMoveToBacklog` | Task/Project in Draft |
| `canMoveToAnalysis` | Task/Project in Backlog |
| `canMoveToToDo` | Task/Project in Backlog or Analysis |
| `canStartEffort` | Task/Project in ToDo |
| `canMarkDone` | Task/Project in Doing |
| `canRollbackStatus` | Has status history entry |

### Planning Conditions

| Condition | True When |
|-----------|-----------|
| `canPlanOnToday` | Task/Project in ToDo or Doing |
| `canPlanForEvening` | Task/Project in ToDo or Doing |
| `canShiftDayBackward` | Task/Project has plannedStartTimestamp |
| `canShiftDayForward` | Task/Project has plannedStartTimestamp |
| `canVoteOnEffort` | Asset is Effort (Task/Project/Meeting) |
| `canSetActiveFocus` | Asset is Area |

### Maintenance Conditions

| Condition | True When |
|-----------|-----------|
| `canTrashEffort` | Effort not trashed |
| `canArchiveTask` | Task/Project completed, not archived |
| `canCleanProperties` | Asset has empty property values |
| `canRepairFolder` | Current folder ≠ expected folder |
| `canRenameToUid` | Filename ≠ exo__Asset_uid |
| `canCopyLabelToAliases` | Any asset |
| `canConvertTaskToProject` | Asset is Task |
| `canConvertProjectToTask` | Asset is Project |

## Button Variants

Visual styles for buttons:

| Variant | Use Case | Color |
|---------|----------|-------|
| `primary` | Main actions (Create) | Blue |
| `secondary` | Supporting actions | Gray |
| `success` | Positive completion | Green |
| `warning` | Attention-needed actions | Orange |
| `danger` | Destructive actions | Red |

## Actions Reference

Actions define what happens when a button is clicked.

### Built-in Action Types

| Action Type | Description | Parameters |
|-------------|-------------|------------|
| `CreateAssetAction` | Create new asset | `targetClass`, `template`, `location` |
| `UpdatePropertyAction` | Update property value | `targetProperty`, `targetValue`, `targetAsset` |
| `NavigateAction` | Navigate to asset/SPARQL result | `target` |
| `ExecuteSPARQLAction` | Execute SPARQL query | `query`, `resultHandler` |
| `ShowModalAction` | Show interactive modal | `modalType`, `modalParams` |
| `TriggerHookAction` | Trigger webhook/hook | `hookName`, `payload` |
| `CustomHandlerAction` | Call TypeScript handler | `handler` |
| `CompositeAction` | Execute sequence | `actions` |

### Headless Support (CLI)

Actions marked with `exo-ui:Action_headless true` work in both Obsidian and CLI.

| Action | Headless? |
|--------|-----------|
| `CreateAssetAction` | Yes |
| `UpdatePropertyAction` | Yes |
| `NavigateAction` | Yes |
| `ExecuteSPARQLAction` | Yes |
| `ShowModalAction` | No |
| `TriggerHookAction` | No |
| `CustomHandlerAction` | Depends on handler |

## RDF Ontology Structure

Buttons are defined in the `ems-ui` namespace in [exocortex-public-ontologies](https://github.com/kitelev/exocortex-public-ontologies).

### Namespace

```turtle
@prefix ems-ui: <https://exocortex.my/ontology/ems-ui#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
```

### Button Definition Schema

```turtle
# Button
ems-ui:MyButton a exo-ui:Button ;
    rdfs:label "My Button"@en ;
    exo-ui:Button_icon "icon-name" ;           # Lucide icon
    exo-ui:Button_variant "primary" ;          # primary|secondary|success|warning|danger
    exo-ui:Button_group exo-ui:StatusButtonGroup ;
    exo-ui:Button_action ems-ui:MyAction ;
    exo-ui:Button_condition ems-ui:MyCondition ;
    exo-ui:Button_order "10" ;                 # Sort order within group
    exo-ui:Button_tooltip "Helpful tooltip" .

# Action
ems-ui:MyAction a exo-ui:UpdatePropertyAction ;
    exo-ui:Action_targetProperty ems:Effort_status ;
    exo-ui:Action_targetValue "[[emsstatus__Done]]" ;
    exo-ui:Action_headless true .

# Condition
ems-ui:MyCondition a exo-ui:Condition ;
    exo-ui:Condition_assetClass ems:Task ;
    exo-ui:Condition_propertyValue "[[emsstatus__Doing]]" .
```

## Customization

### Adding Custom Buttons

See **[Custom Buttons Tutorial](./tutorials/CUSTOM-BUTTONS.md)** for step-by-step guide.

Quick example:
```turtle
@prefix my: <https://my-vault.example/ontology/my#> .
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .

my:ReviewButton a exo-ui:Button ;
    rdfs:label "Request Review" ;
    exo-ui:Button_icon "eye" ;
    exo-ui:Button_variant "primary" ;
    exo-ui:Button_group exo-ui:StatusButtonGroup ;
    exo-ui:Button_action my:SetReviewStatusAction ;
    exo-ui:Button_condition my:IsDoingCondition .
```

### Disabling Built-in Buttons

To hide a built-in button, create a condition that always returns false:

```turtle
# Override the button's condition
ems-ui:CreateTaskButton exo-ui:Button_condition my:AlwaysFalseCondition .

my:AlwaysFalseCondition a exo-ui:Condition ;
    exo-ui:Condition_sparql "ASK { FILTER(false) }" .
```

## See Also

- **[Custom Buttons Tutorial](./tutorials/CUSTOM-BUTTONS.md)** — Step-by-step guide
- **[RDF-Driven Commands](./COMMANDS.md)** — Command palette commands
- **[exo-ui Ontology](https://github.com/kitelev/exocortex-public-ontologies/tree/main/exo-ui)** — Source RDF definitions
- **[ems-ui Ontology](https://github.com/kitelev/exocortex-public-ontologies/tree/main/ems-ui)** — Button instances
