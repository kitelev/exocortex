# Getting Started with Exocortex

**Set up Exocortex — an ontology-driven knowledge management plugin for Obsidian. Requires: Obsidian desktop, basic terminal knowledge.**

---

## Table of Contents

1. [What is Exocortex?](#what-is-exocortex)
2. [Installation](#installation)
3. [Your First Area](#your-first-area)
4. [Your First Project](#your-first-project)
5. [Your First Task](#your-first-task)
6. [Daily Planning](#daily-planning)
7. [Understanding the Layout](#understanding-the-layout)
8. [Next Steps](#next-steps)

---

## What is Exocortex?

Exocortex is an Obsidian plugin that lets you **define custom entity types, their properties, and UI — all as data, not code**. Think of it as Notion databases, but with an ontology layer and fully offline.

You describe your entities (tasks, projects, areas, or any custom type) in YAML frontmatter, and the plugin automatically generates layouts, action buttons, and workflows based on those definitions. No server, no vendor lock-in — your data lives as Markdown files in your git repository.

### What You Get

- **Automatic layouts** that render below your note's metadata in Reading Mode
- **Hierarchical organization** (Areas → Projects → Tasks)
- **Dynamic action buttons** that appear based on entity type and state
- **Daily planning** with focused task lists
- **Effort tracking** from idea to completion
- **Collaborative voting** for prioritization

**The key insight**: You define relationships in frontmatter, and Exocortex automatically displays relevant information based on context. Create a new entity type — and the UI adapts without changing any code.

---

## Installation

### Step 1: Install via BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is a plugin that lets you install beta plugins from GitHub.

1. Open Obsidian Settings → Community plugins → Browse
2. Search for **"BRAT"** (full name: "Obsidian42 - BRAT")
3. Click Install → Enable
4. Open BRAT settings → **Add Beta Plugin**
5. Enter repository: `kitelev/exocortex`
6. Click **Add Plugin**
7. Go to Settings → Community plugins → enable **Exocortex**

BRAT will automatically keep the plugin updated with new releases.

### Step 2: Install Starter Kit

The plugin needs ontology files in your vault to enable buttons and commands. Download and extract the Starter Kit:

1. Go to the [Starter Kit Release](https://github.com/kitelev/exocortex-starter-kit/releases/latest)
2. Download `exocortex-starter-kit.zip`
3. Extract the ZIP into your vault (any folder works — the plugin scans the entire vault)
   - Recommended: extract into a folder like `Knowledge/` or at the vault root
   - The ZIP contains `exocmd/` (command definitions), `pn/` (DailyNote properties), `exo/` (core ontology), `ems/` (effort classes and statuses), and `period/` (time periods)

The plugin detects new files automatically — no restart needed.

### Step 3: Verify Installation

1. Create a new note with this frontmatter:

```yaml
---
exo__Instance_class:
  - "[[ems__Area]]"
exo__Asset_label: Test Area
---
```

2. Switch to **Reading Mode** (Ctrl/Cmd + E)
3. You should see the Exocortex layout with **action buttons** below the metadata

**If the layout doesn't appear:**

- Verify you're in **Reading Mode** (not Live Preview or Source Mode)
- Check that the plugin is enabled (Settings → Community plugins)
- Check the console for errors (Ctrl/Cmd + Shift + I → Console tab)

**If buttons are missing but the layout appears:**

- Verify the Starter Kit files are in your vault (look for an `exocmd/` folder)
- Try Cmd/Ctrl+P → "Reload Layout"

---

## Your First Area

Areas represent broad domains of work (e.g., "Development", "Marketing", "Personal Projects").

### Create an Area Note

1. Create a new note called `Development.md`
2. Add frontmatter:

```yaml
---
exo__Instance_class:
  - "[[ems__Area]]"
exo__Asset_label: Development
---
# Development

All software development efforts live here.
```

3. Switch to **Reading Mode**

### What You'll See

The Exocortex layout renders with these sections:

- **Properties Table**: Shows all frontmatter properties
- **Action Buttons**: Commands relevant to areas (Create Project, Create Task, etc.)
- **Area Hierarchy Tree**: Parent/child area relationships (empty for now)
- **Asset Relations**: Notes referencing this area (empty for now)

**Note**: The layout only appears in Reading Mode, not in Edit Mode.

---

## Your First Project

Projects represent specific initiatives within an area.

### Create a Project Note

1. Create a new note called `Build API Server.md`
2. Add frontmatter:

```yaml
---
exo__Instance_class:
  - "[[ems__Project]]"
exo__Asset_label: Build API Server
ems__Effort_area: "[[Development]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---
# Build API Server

REST API for the mobile app.
```

3. Switch to **Reading Mode**

### Understanding the Frontmatter

| Property              | Purpose                                    | Human name   |
| --------------------- | ------------------------------------------ | ------------ |
| `exo__Instance_class` | Declares this note as a project            | Note type    |
| `exo__Asset_label`    | Human-readable name (displayed everywhere) | Display name |
| `ems__Effort_area`    | Links to the parent area (wiki-link)       | Parent area  |
| `ems__Effort_status`  | Current workflow status                    | Status       |

### Available Status Values

- `ems__EffortStatusDraft` - Initial idea, not yet committed
- `ems__EffortStatusBacklog` - Committed, awaiting analysis
- `ems__EffortStatusAnalysis` - Being analyzed/planned
- `ems__EffortStatusToDo` - Ready to start
- `ems__EffortStatusDoing` - In progress
- `ems__EffortStatusDone` - Completed

### What You'll See

- **Action Buttons**: Create tasks, set planned dates, convert to task
- **Asset Relations**: This project will appear in the Development area's relations

---

## Your First Task

Tasks represent specific work items within a project.

### Create a Task Using the Button

1. Open the project note (`Build API Server.md`) in Reading Mode
2. Click **"Create Task"** button
3. Fill in the form:
   - **Label**: `Set up Express server`

### Or Create Manually

Create `Set up Express server.md`:

```yaml
---
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: Set up Express server
ems__Effort_area: "[[Development]]"
ems__Effort_parent: "[[Build API Server]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
# Set up Express server

Initialize Node.js project and configure Express.
```

### Understanding Task Frontmatter

- `ems__Effort_parent` - Links to the parent project (or parent task for sub-tasks)
- All other properties work like projects

---

## Daily Planning

Daily notes show all tasks scheduled for a specific date.

### Create a Daily Note

1. Create a note named `2025-11-10.md` (use ISO format: YYYY-MM-DD)
2. Add frontmatter:

```yaml
---
exo__Instance_class:
  - "[[pn__DailyNote]]"
exo__Asset_label: "2025-11-10"
pn__DailyNote_day: "2025-11-10"
---
# 2025-11-10

Today's plan.
```

### Schedule Tasks for Today

1. Open a task note in Reading Mode
2. Click **"Plan on Today"** button
3. The task's frontmatter updates with today's date:

```yaml
ems__Effort_plannedStartTimestamp: "2025-11-10"
```

### View Today's Tasks

1. Open today's daily note in Reading Mode
2. The **Daily Tasks** section shows all scheduled tasks:
   - Grouped by area
   - Sorted by project
   - Shows status, votes, and action buttons
   - Toggle "Show Archived" to hide/show completed tasks

### Shift Scheduling

Use arrow buttons (◀ / ▶) to move tasks between days:

- ◀ Shift Day Backward (reschedule to yesterday)
- ▶ Shift Day Forward (reschedule to tomorrow)

---

## Understanding the Layout

The Exocortex layout renders automatically in Reading Mode based on the note's `exo__Instance_class`:

### Common Sections

**1. Properties Table**

- Shows all frontmatter properties
- Resolves wiki-links to display labels
- Sortable columns (click headers)
- Toggle visibility with "Toggle Properties" button

**2. Action Buttons**

- Grouped by function:
  - **Creation**: Create Task, Create Project
  - **Status**: Move to Backlog, Move to ToDo, Start Effort, Mark Done
  - **Planning**: Plan on Today, Shift Day Forward/Backward
  - **Maintenance**: Archive, Trash, Vote, Clean Properties
- Only relevant buttons shown (based on note type and state)

**3. Asset Relations**

- Lists all notes that reference this note
- Grouped by property (e.g., all tasks with this project as parent)
- Sortable by name, class, status
- Click rows to navigate

### Class-Specific Sections

**ems\_\_Area**

- **Area Hierarchy Tree**: Interactive collapsible tree of parent/child areas

**pn\_\_DailyNote**

- **Daily Tasks**: All tasks scheduled for this date
- **Daily Projects**: All projects scheduled for this date
- **Focus Area Filter**: Show only tasks from specific area

**ems\_\_Project** / **ems\_\_Task**

- Standard layout (Properties + Buttons + Relations)

---

## Next Steps

Now that you have the basics, explore advanced features:

### 1. Workflow Management

Learn the complete effort lifecycle:

- [Task Workflows](workflows/Task-Workflow.md)
- [Project Workflows](workflows/Project-Workflow.md)

### 2. Daily Planning

Master daily note organization:

- [Daily Planning Guide](workflows/Daily-Planning.md)

### 3. Area Hierarchies

Build knowledge domains:

- [Area Organization Guide](workflows/Area-Organization.md)

### 4. Command Reference

Discover all commands:

- [Plugin Commands](Plugin-Commands.md)

### 5. Advanced Features

- [SPARQL Queries](sparql/User-Guide.md)
- [Effort Voting System](workflows/Effort-Voting.md)

---

## Quick Reference Card

### Essential Frontmatter Properties

| Property                            | Human name          | Example Value                                             |
| ----------------------------------- | ------------------- | --------------------------------------------------------- |
| `exo__Instance_class`               | Note type           | `ems__Task`, `ems__Project`, `ems__Area`, `pn__DailyNote` |
| `exo__Asset_label`                  | Display name        | `"Build API Server"`                                      |
| `ems__Effort_area`                  | Parent area         | `"[[Development]]"`                                       |
| `ems__Effort_parent`                | Parent project/task | `"[[Build API Server]]"`                                  |
| `ems__Effort_status`                | Workflow status     | `"[[ems__EffortStatusToDo]]"`                             |
| `ems__Effort_plannedStartTimestamp` | Planned start date  | `"2025-11-10"`                                            |
| `pn__DailyNote_day`                 | Daily note date     | `"2025-11-10"`                                            |

### Common Commands

| Action         | Command                                                       |
| -------------- | ------------------------------------------------------------- |
| Create task    | Click "Create Task" button or Cmd/Ctrl+P → "Create Task"      |
| Move status    | Use status buttons (Backlog → Analysis → ToDo → Doing → Done) |
| Plan for today | Click "Plan on Today" button                                  |
| Shift day      | Use ◀ / ▶ buttons                                             |
| Vote on effort | Click "Vote" button                                           |
| Reload layout  | Cmd/Ctrl+P → "Reload Layout"                                  |

### Troubleshooting

| Problem                  | Solution                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Layout doesn't appear    | Switch to Reading Mode (Ctrl/Cmd + E)                                                        |
| No buttons visible       | Verify Starter Kit is installed (exocmd/ folder exists in vault)                             |
| Buttons don't work       | Check console for errors (Ctrl/Cmd + Shift + I)                                              |
| Wiki-links not resolving | Verify target note exists with correct `exo__Asset_label`                                    |
| Daily tasks not showing  | Check task has `ems__Effort_plannedStartTimestamp` matching daily note's `pn__DailyNote_day` |

---

## Getting Help

- **Documentation**: See [full documentation index](../README.md#documentation)
- **Issues**: [GitHub Issues](https://github.com/kitelev/exocortex/issues)

---

**Next**: [Task Workflows →](workflows/Task-Workflow.md)
