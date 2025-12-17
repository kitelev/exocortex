# Getting Started with Exocortex

**A beginner-friendly guide to setting up and using Exocortex for task management in Obsidian.**

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

Exocortex transforms Obsidian into a powerful task management system with:

- **Automatic layouts** that appear below your note's metadata
- **Hierarchical organization** (Areas → Projects → Tasks)
- **Daily planning** with focused task lists
- **Effort tracking** from idea to completion
- **Collaborative voting** for prioritization

**The key insight**: Instead of manually maintaining task lists, you define relationships in frontmatter, and Exocortex automatically displays relevant information based on context.

---

## Installation

### Step 1: Download the Plugin

**Option A: Community Plugins (Recommended)**
1. Open Obsidian Settings → Community plugins
2. Search for "Exocortex"
3. Click Install → Enable

**Option B: Manual Installation**
```bash
cd /your/vault/.obsidian/plugins
git clone https://github.com/kitelev/exocortex
cd exocortex
npm install && npm run build
```

### Step 2: Enable the Plugin

1. Settings → Community plugins → Installed plugins
2. Find "Exocortex" in the list
3. Toggle ON

### Step 3: Verify Installation

1. Create a test note with frontmatter:
```yaml
---
exo__Instance_class: ems__Area
exo__Asset_label: Test Area
---
```

2. Switch to **Reading Mode** (Ctrl/Cmd + E)
3. You should see the Exocortex layout below the metadata

**If the layout doesn't appear:**
- Check that the plugin is enabled (Settings → Community plugins)
- Verify you're in Reading Mode (not Live Preview or Source Mode)
- Check the console for errors (Ctrl/Cmd + Shift + I → Console tab)

---

## Your First Area

Areas represent broad domains of work (e.g., "Development", "Marketing", "Personal Projects").

### Create an Area Note

1. Create a new note called `Development.md`
2. Add frontmatter:

```yaml
---
exo__Instance_class: ems__Area
exo__Asset_label: Development
---

# Development

All software development efforts live here.
```

3. Switch to **Reading Mode**

### What You'll See

The Exocortex layout renders with these sections:

- **Properties Table**: Shows all frontmatter properties
- **Action Buttons**: Commands relevant to areas (Create Project, etc.)
- **Area Hierarchy Tree**: Parent/child area relationships (empty for now)
- **Asset Relations**: Notes referencing this area (empty for now)

**📝 Note**: The layout only appears in Reading Mode, not in Edit Mode.

---

## Your First Project

Projects represent specific initiatives within an area.

### Create a Project Note

1. Create a new note called `Build API Server.md`
2. Add frontmatter:

```yaml
---
exo__Instance_class: ems__Project
exo__Asset_label: Build API Server
ems__Effort_area: "[[Development]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---

# Build API Server

REST API for the mobile app.
```

3. Switch to **Reading Mode**

### Understanding the Frontmatter

- `exo__Instance_class: ems__Project` - Declares this note as a project
- `exo__Asset_label` - Human-readable name (displayed everywhere)
- `ems__Effort_area` - Links to the parent area (wiki-link)
- `ems__Effort_status` - Current workflow status (Backlog, Analysis, ToDo, Doing, Done)

### Available Status Values

- `ems__EffortStatusDraft` - Initial idea, not yet committed
- `ems__EffortStatusBacklog` - Committed, awaiting analysis
- `ems__EffortStatusAnalysis` - Being analyzed/planned
- `ems__EffortStatusToDo` - Ready to start
- `ems__EffortStatusDoing` - In progress
- `ems__EffortStatusDone` - Completed

### What You'll See

- **Action Buttons**: Move between statuses, vote, create tasks
- **Asset Relations**: This project will appear in the Development area's relations

---

## Your First Task

Tasks represent specific work items within a project.

### Create a Task Using the Button

1. Open the project note (`Build API Server.md`) in Reading Mode
2. Click **"Create Task"** button
3. Fill in the form:
   - **Label**: `Set up Express server`
   - **Status**: `ems__EffortStatusToDo`
   - **Area**: (auto-filled from parent project)

### Or Create Manually

Create `Set up Express server.md`:

```yaml
---
exo__Instance_class: ems__Task
exo__Asset_label: Set up Express server
ems__Effort_area: "[[Development]]"
ems__Effort_project: "[[Build API Server]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---

# Set up Express server

Initialize Node.js project and configure Express.
```

### Understanding Task Frontmatter

- `ems__Effort_project` - Links to the parent project
- All other properties work like projects
- Tasks can have `ems__Effort_parent` for sub-tasks

---

## Daily Planning

Daily notes show all tasks scheduled for a specific date.

### Create a Daily Note

1. Create a note named `2025-11-10.md` (use ISO format: YYYY-MM-DD)
2. Add frontmatter:

```yaml
---
exo__Instance_class: pn__DailyNote
exo__Asset_label: "2025-11-10"
pn__Day_date: "2025-11-10"
---

# 2025-11-10

Today's plan.
```

### Schedule Tasks for Today

1. Open a task note in Reading Mode
2. Click **"Plan on Today"** button
3. The task's frontmatter updates with today's date:

```yaml
ems__Effort_scheduled_start_date: "2025-11-10"
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

**ems__Area**
- **Area Hierarchy Tree**: Interactive collapsible tree of parent/child areas

**pn__DailyNote**
- **Daily Tasks**: All tasks scheduled for this date
- **Daily Projects**: All projects scheduled for this date
- **Focus Area Filter**: Show only tasks from specific area

**ems__Project / ems__Task**
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
Discover all 32 commands:
- [Command Reference](Command-Reference.md)

### 5. Advanced Features
- [SPARQL Queries](sparql/User-Guide.md)
- [Effort Voting System](workflows/Effort-Voting.md)
- [Mobile/iOS Usage](Performance-Guide.md#mobile-optimization)

---

## Quick Reference Card

### Essential Frontmatter Properties

| Property | Purpose | Example Value |
|----------|---------|---------------|
| `exo__Instance_class` | Note type | `ems__Task`, `ems__Project`, `ems__Area`, `pn__DailyNote` |
| `exo__Asset_label` | Display name | `"Build API Server"` |
| `ems__Effort_area` | Parent area | `"[[Development]]"` |
| `ems__Effort_project` | Parent project (tasks only) | `"[[Build API Server]]"` |
| `ems__Effort_status` | Workflow status | `"[[ems__EffortStatusToDo]]"` |
| `ems__Effort_scheduled_start_date` | Planned date | `"2025-11-10"` |
| `pn__Day_date` | Daily note date | `"2025-11-10"` |

### Common Commands

| Action | Command |
|--------|---------|
| Create task | Click "Create Task" button or Cmd/Ctrl+P → "Create Task" |
| Move status | Use status buttons (Backlog → Analysis → ToDo → Doing → Done) |
| Plan for today | Click "Plan on Today" button |
| Shift day | Use ◀ / ▶ buttons |
| Vote on effort | Click "Vote" button |
| Reload layout | Cmd/Ctrl+P → "Reload Layout" |

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Layout doesn't appear | Switch to Reading Mode (Ctrl/Cmd + E) |
| Buttons don't work | Check console for errors (Ctrl/Cmd + Shift + I) |
| Wiki-links not resolving | Verify target note exists with correct `exo__Asset_label` |
| Daily tasks not showing | Check task has `ems__Effort_scheduled_start_date` matching daily note's `pn__Day_date` |

---

## Getting Help

- **Documentation**: See [full documentation index](../README.md#documentation)
- **Troubleshooting**: [Troubleshooting Guide](Troubleshooting.md)
- **Issues**: [GitHub Issues](https://github.com/kitelev/exocortex/issues)
- **Community**: [Obsidian Forum](https://forum.obsidian.md/)

---

**Next**: [Task Workflows →](workflows/Task-Workflow.md)
