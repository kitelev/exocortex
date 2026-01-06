# RDF-Driven Commands System

> **Milestone v1.3** — Commands Migration to RDF Architecture

This document describes the RDF-driven command system introduced in Exocortex v1.3. Commands are now defined declaratively in RDF, enabling consistent behavior across the Obsidian plugin and CLI.

---

## Table of Contents

- [Overview](#overview)
- [RDF Command Structure](#rdf-command-structure)
- [All 36 Commands](#all-36-commands)
- [Condition System](#condition-system)
- [Hotkey Reference](#hotkey-reference)
- [CLI Usage](#cli-usage)
- [Extending Commands](#extending-commands)

---

## Overview

### What is RDF-Driven Architecture?

In v1.3, Exocortex commands are defined in RDF (Resource Description Framework) rather than hardcoded in TypeScript. This provides:

- **Single source of truth** — Command definitions live in the ontology
- **Declarative conditions** — Visibility rules expressed as SPARQL queries
- **CLI/Plugin parity** — Same commands work headlessly and interactively
- **Extensibility** — Add new commands without modifying core code

### Architecture Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RDF Triple Store                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Command Definitions (exo-ui:Command instances)                │  │
│  │  - ID, Name, Icon, Hotkey                                      │  │
│  │  - Action URI                                                  │  │
│  │  - Condition (SPARQL ASK query)                                │  │
│  │  - Headless flag                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │                                      │
            ▼                                      ▼
┌───────────────────────┐              ┌───────────────────────┐
│   RdfCommandRegistry  │              │   CLI CommandExecutor │
│   (Obsidian Plugin)   │              │   (Headless)          │
├───────────────────────┤              ├───────────────────────┤
│ • Loads from SPARQL   │              │ • Executes commands   │
│ • Registers with      │              │ • JSON/text output    │
│   Obsidian            │              │ • MCP integration     │
│ • Evaluates conditions│              │                       │
│ • Caches results      │              │                       │
└───────────────────────┘              └───────────────────────┘
```

---

## RDF Command Structure

### Ontology Namespace

Commands are defined using the `exo-ui` namespace:

```turtle
PREFIX exo-ui: <https://exocortex.my/ontology/exo-ui#>
```

### Command Class Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `exo-ui:Command_id` | `xsd:string` | Yes | Unique command identifier (kebab-case) |
| `exo-ui:Command_name` | `xsd:string` | Yes | Human-readable name for command palette |
| `exo-ui:Command_icon` | `xsd:string` | No | Lucide icon name |
| `exo-ui:Command_hotkey` | `xsd:string` | No | Keyboard shortcut (e.g., "Mod+Shift+T") |
| `exo-ui:Command_action` | `xsd:anyURI` | No | URI of action to execute |
| `exo-ui:Command_condition` | `xsd:string` | No | SPARQL ASK query for visibility |
| `exo-ui:Command_headless` | `xsd:boolean` | No | Whether command can run via CLI |

### Example RDF Definition

```turtle
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix ems-ui: <https://exocortex.my/ontology/ems-ui#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ems-ui:CreateTaskCommand a exo-ui:Command ;
    exo-ui:Command_id "create-task" ;
    exo-ui:Command_name "Create Task" ;
    exo-ui:Command_icon "plus-circle" ;
    exo-ui:Command_hotkey "Mod+Shift+T" ;
    exo-ui:Command_headless "true"^^xsd:boolean .
```

### SPARQL Query for Loading Commands

The `RdfCommandRegistry` uses this query to load all commands:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX exo-ui: <https://exocortex.my/ontology/exo-ui#>

SELECT ?cmd ?id ?name ?icon ?hotkey ?action ?condition ?headless
WHERE {
  ?cmd a exo-ui:Command .
  ?cmd exo-ui:Command_id ?id .
  ?cmd exo-ui:Command_name ?name .
  OPTIONAL { ?cmd exo-ui:Command_icon ?icon }
  OPTIONAL { ?cmd exo-ui:Command_hotkey ?hotkey }
  OPTIONAL { ?cmd exo-ui:Command_action ?action }
  OPTIONAL { ?cmd exo-ui:Command_condition ?condition }
  OPTIONAL { ?cmd exo-ui:Command_headless ?headless }
}
```

---

## All 36 Commands

### Command Categories

| Category | Count | Description |
|----------|-------|-------------|
| Create | 6 | Create new assets (Task, Project, Area, etc.) |
| Status | 13 | Manage effort lifecycle states |
| Maintenance | 5 | Asset repair and cleanup operations |
| UI Toggle | 4 | Control UI visibility and layout |
| Conversion | 2 | Convert between asset types |
| Navigation | 3 | Navigate asset hierarchy |
| Special | 3 | Focus management and query tools |

### Create Commands (6)

| Command ID | Name | Hotkey | Icon | Headless |
|------------|------|--------|------|----------|
| `create-task` | Create Task | `Mod+Shift+T` | plus-circle | Yes |
| `create-project` | Create Project | `Mod+Shift+P` | folder-plus | Yes |
| `create-area` | Create Area | `Mod+Shift+A` | map | Yes |
| `create-instance` | Create Instance | — | copy | Yes |
| `create-fleeting-note` | Create Fleeting Note | — | file-plus | Yes |
| `create-related-task` | Create Related Task | — | git-branch | Yes |

**CLI Examples:**

```bash
# Create a new task
exocortex-cli command create-task "03 Knowledge/tasks/new-task.md" \
  --label "Implement feature X" \
  --vault ~/vault

# Create with prototype inheritance
exocortex-cli command create-task "03 Knowledge/tasks/coding-session.md" \
  --label "Coding Session" \
  --prototype "2d369bb0-159f-4639-911d-ec2c585e8d00" \
  --vault ~/vault

# Create project linked to area
exocortex-cli command create-project "03 Knowledge/projects/my-project.md" \
  --label "My Project" \
  --area "area-uid-here" \
  --vault ~/vault
```

### Status Commands (13)

| Command ID | Name | Hotkey | Icon | Headless |
|------------|------|--------|------|----------|
| `set-draft-status` | Set Draft Status | — | file-edit | Yes |
| `move-to-backlog` | Move to Backlog | — | archive | Yes |
| `move-to-analysis` | Move to Analysis | — | search | Yes |
| `move-to-todo` | Move to ToDo | — | list-todo | Yes |
| `start-effort` | Start Effort | `Mod+S` | play | Yes |
| `plan-on-today` | Plan on Today | — | calendar | Yes |
| `plan-for-evening` | Plan for Evening | — | moon | Yes |
| `shift-day-backward` | Shift Day Backward | — | arrow-left | Yes |
| `shift-day-forward` | Shift Day Forward | — | arrow-right | Yes |
| `mark-done` | Mark Done | `Mod+D` | check-circle | Yes |
| `trash-effort` | Trash Effort | — | trash | Yes |
| `archive-task` | Archive Task | — | archive | Yes |
| `vote-on-effort` | Vote on Effort | — | thumbs-up | Yes |

**Effort Lifecycle:**

```
     ┌─────────────────────────────────────────────────────────┐
     │                     EFFORT LIFECYCLE                     │
     └─────────────────────────────────────────────────────────┘

     ┌──────────┐    move-to-    ┌──────────┐    move-to-    ┌──────────┐
     │  Draft   │───────────────▶│ Backlog  │───────────────▶│ Analysis │
     └──────────┘    backlog     └──────────┘    analysis    └──────────┘
           │                           │                           │
           │                           │                           │
           │                           │ (Task/Meeting)            │ (Project)
           │                           ▼                           ▼
           │                    ┌──────────┐              ┌──────────┐
           │                    │  Doing   │◀─────────────│   ToDo   │
           │                    └──────────┘ start-effort └──────────┘
           │                           │
           │                           │ mark-done
           │                           ▼
           │                    ┌──────────┐
           │                    │   Done   │
           │                    └──────────┘
           │
           │ trash-effort
           ▼
     ┌──────────┐
     │ Trashed  │
     └──────────┘
```

**CLI Examples:**

```bash
# Start working on a task
exocortex-cli command start "03 Knowledge/tasks/my-task.md" --vault ~/vault

# Complete a task
exocortex-cli command complete "03 Knowledge/tasks/my-task.md" --vault ~/vault

# Move to backlog
exocortex-cli command move-to-backlog "03 Knowledge/tasks/my-task.md" --vault ~/vault

# Archive completed task
exocortex-cli command archive "03 Knowledge/tasks/old-task.md" --vault ~/vault
```

### Maintenance Commands (5)

| Command ID | Name | Icon | Headless |
|------------|------|------|----------|
| `clean-properties` | Clean Properties | eraser | Yes |
| `repair-folder` | Repair Folder | folder-sync | Yes |
| `rename-to-uid` | Rename to UID | hash | Yes |
| `copy-label-to-aliases` | Copy Label to Aliases | copy | Yes |
| `add-supervision` | Add Supervision | eye | No |

**CLI Examples:**

```bash
# Rename file to UUID-based name
exocortex-cli command rename-to-uid "03 Knowledge/tasks/my-task.md" --vault ~/vault

# Move asset to correct folder based on class
exocortex-cli command repair-folder "03 Knowledge/wrong-location/task.md" --vault ~/vault
# Output: ✅ Moved to correct folder: 03 Knowledge/tasks/965fd5c2-808e-4c7e-8242-e2e5d85bd996.md
```

### UI Toggle Commands (4)

| Command ID | Name | Icon | Headless |
|------------|------|------|----------|
| `reload-layout` | Reload Layout | refresh-cw | No |
| `toggle-properties-visibility` | Toggle Properties Visibility | eye-off | No |
| `toggle-layout-visibility` | Toggle Layout Visibility | layout | No |
| `toggle-archived-assets` | Toggle Archived Assets | archive | No |

> **Note:** UI Toggle commands are not available via CLI (`headless: false`).

### Conversion Commands (2)

| Command ID | Name | Icon | Headless |
|------------|------|------|----------|
| `convert-task-to-project` | Convert Task to Project | folder | Yes |
| `convert-project-to-task` | Convert Project to Task | check-square | Yes |

### Navigation Commands (3)

| Command ID | Name | Hotkey | Icon | Condition | Headless |
|------------|------|--------|------|-----------|----------|
| `go-to-parent` | Go to Parent | `Mod+Up` | arrow-up | HasParent | No |
| `go-to-project` | Go to Project | `Mod+P` | folder | HasProject | No |
| `go-to-area` | Go to Area | `Mod+A` | map-pin | HasArea | No |

> **Note:** Navigation commands require UI context and are not available via CLI.

### Special Commands (3)

| Command ID | Name | Icon | Headless |
|------------|------|------|----------|
| `set-focus-area` | Set Focus Area | target | No |
| `open-query-builder` | Open Query Builder | search | No |
| `edit-properties` | Edit Properties | edit | No |

---

## Condition System

### Overview

Conditions control when commands appear in the command palette. They are expressed as **SPARQL ASK queries** or **TypeScript visibility rules**.

### Condition Types

#### 1. SPARQL-Based Conditions (RDF)

For RDF-driven commands, conditions are SPARQL URIs pointing to named queries:

```turtle
ems-ui:GoToParentCommand a exo-ui:Command ;
    exo-ui:Command_id "go-to-parent" ;
    exo-ui:Command_condition "https://exocortex.my/ontology/ems-ui#HasParent" .
```

The registry evaluates this by executing the referenced SPARQL ASK query against the current file context.

#### 2. TypeScript Visibility Rules (Legacy)

For existing commands, visibility is determined by domain rules:

```typescript
// packages/exocortex/src/domain/commands/visibility/

// Task visibility rules
export function canCreateTask(context: CommandVisibilityContext): boolean {
  return isAreaOrProject(context.instanceClass);
}

// Effort visibility rules
export function canStartEffort(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  if (hasClass(context.instanceClass, AssetClass.TASK) ||
      hasClass(context.instanceClass, AssetClass.MEETING)) {
    return hasStatus(context.currentStatus, EffortStatus.BACKLOG);
  }

  if (hasClass(context.instanceClass, AssetClass.PROJECT)) {
    return hasStatus(context.currentStatus, EffortStatus.TODO);
  }

  return false;
}
```

### CommandVisibilityContext

The context object passed to visibility rules:

```typescript
interface CommandVisibilityContext {
  /** Current asset's instance class (e.g., "ems__Task") */
  instanceClass: string | null;

  /** Current effort status (e.g., "Backlog", "Doing") */
  currentStatus: string | string[] | null;

  /** Whether asset is archived */
  isArchived: boolean;

  /** Asset metadata from frontmatter */
  metadata: Record<string, unknown>;

  /** Expected folder path for asset class */
  expectedFolder: string | null;
}
```

### Condition Caching

The `RdfCommandRegistry` caches condition results for performance:

- **TTL:** 1 second (configurable)
- **Cache key:** `${commandUri}:${conditionQuery}`
- **Invalidation:** Call `clearConditionCache()` when data changes

```typescript
// Force condition re-evaluation
registry.clearConditionCache();
```

---

## Hotkey Reference

### Modifier Keys

| Key | macOS | Windows/Linux |
|-----|-------|---------------|
| `Mod` | `Cmd` | `Ctrl` |
| `Shift` | `Shift` | `Shift` |
| `Alt` | `Option` | `Alt` |

### All Hotkeys

| Hotkey | Command | Description |
|--------|---------|-------------|
| `Mod+Shift+T` | create-task | Create new task |
| `Mod+Shift+P` | create-project | Create new project |
| `Mod+Shift+A` | create-area | Create new area |
| `Mod+S` | start-effort | Start working on task |
| `Mod+D` | mark-done | Complete current task |
| `Mod+Up` | go-to-parent | Navigate to parent asset |
| `Mod+P` | go-to-project | Navigate to linked project |
| `Mod+A` | go-to-area | Navigate to linked area |

### Hotkey Format in RDF

Hotkeys use Obsidian's format with `+` separator:

```
Mod+Shift+T     → Cmd/Ctrl + Shift + T
Mod+Up          → Cmd/Ctrl + ArrowUp
Alt+Shift+D     → Alt/Option + Shift + D
```

Arrow keys are normalized:
- `Up` → `ArrowUp`
- `Down` → `ArrowDown`
- `Left` → `ArrowLeft`
- `Right` → `ArrowRight`

---

## CLI Usage

### Basic Syntax

```bash
exocortex-cli command <command-name> <filepath> [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--vault <path>` | Path to Obsidian vault | Current directory |
| `--label <value>` | Asset label (required for creation) | — |
| `--prototype <uid>` | Prototype UID for inheritance | — |
| `--area <uid>` | Area UID for linkage | — |
| `--parent <uid>` | Parent UID for linkage | — |
| `--date <value>` | Date in YYYY-MM-DD format | — |
| `--dry-run` | Preview without modifying | `false` |
| `--format <type>` | Output format: `text` or `json` | `text` |

### JSON Output for MCP Integration

Use `--format json` for machine-readable output:

```bash
exocortex-cli command start "tasks/my-task.md" --vault ~/vault --format json
```

```json
{
  "success": true,
  "result": {
    "command": "start",
    "filepath": "tasks/my-task.md",
    "action": "Started task"
  }
}
```

### Complete CLI Command Reference

```bash
# Maintenance
exocortex-cli command rename-to-uid <filepath>
exocortex-cli command update-label <filepath> --label "<value>"
exocortex-cli command repair-folder <filepath>

# Status Transitions
exocortex-cli command start <filepath>
exocortex-cli command complete <filepath>
exocortex-cli command trash <filepath>
exocortex-cli command archive <filepath>
exocortex-cli command move-to-backlog <filepath>
exocortex-cli command move-to-analysis <filepath>
exocortex-cli command move-to-todo <filepath>

# Creation
exocortex-cli command create-task <filepath> --label "<value>" [--prototype <uid>] [--area <uid>] [--parent <uid>]
exocortex-cli command create-meeting <filepath> --label "<value>" [--prototype <uid>] [--area <uid>] [--parent <uid>]
exocortex-cli command create-project <filepath> --label "<value>" [--prototype <uid>] [--area <uid>] [--parent <uid>]
exocortex-cli command create-area <filepath> --label "<value>" [--prototype <uid>] [--area <uid>] [--parent <uid>]

# Planning
exocortex-cli command schedule <filepath> --date "YYYY-MM-DD"
exocortex-cli command set-deadline <filepath> --date "YYYY-MM-DD"
```

---

## Extending Commands

### Adding a New Command

1. **Define in RDF ontology:**

```turtle
@prefix exo-ui: <https://exocortex.my/ontology/exo-ui#> .
@prefix my-ui: <https://example.com/my-ontology/ui#> .

my-ui:MyCustomCommand a exo-ui:Command ;
    exo-ui:Command_id "my-custom-command" ;
    exo-ui:Command_name "My Custom Command" ;
    exo-ui:Command_icon "star" ;
    exo-ui:Command_headless "true"^^xsd:boolean .
```

2. **Add visibility rule (if needed):**

```typescript
// packages/exocortex/src/domain/commands/visibility/CustomVisibilityRules.ts
export function canExecuteMyCommand(context: CommandVisibilityContext): boolean {
  // Your visibility logic
  return context.instanceClass === "my_custom_class";
}
```

3. **Implement action handler:**

```typescript
// packages/cli/src/executors/CommandExecutor.ts
case "my-custom-command":
  await this.executeMyCustomCommand(filepath);
  outputResult(format, commandName, filepath, "Executed my custom command");
  break;
```

### Best Practices

- Use **kebab-case** for command IDs: `my-custom-command`
- Use **Lucide icons** from [lucide.dev](https://lucide.dev)
- Set `headless: true` only for commands that make sense without UI
- Add hotkey only for frequently-used commands (max 8 with hotkeys)
- Write visibility rules that fail fast (check cheapest conditions first)

---

## Related Documentation

- **[CLI Command Reference](./cli/Command-Reference.md)** — Complete CLI syntax
- **[Architecture Guide](../ARCHITECTURE.md)** — Clean Architecture patterns
- **[SPARQL User Guide](./sparql/User-Guide.md)** — Query language basics
- **[Property Schema](./PROPERTY_SCHEMA.md)** — Frontmatter vocabulary

---

## Version History

| Version | Changes |
|---------|---------|
| **1.3.0** | Initial RDF-driven commands system (36 commands) |
| **1.2.x** | Legacy TypeScript-only command definitions |
