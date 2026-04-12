# Getting Started with Exocortex

**Set up Exocortex — an ontology-driven knowledge management plugin for Obsidian. Requires: Obsidian desktop, basic terminal knowledge.**

---

## Requirements

Exocortex has been verified to work with the following minimum versions. Older versions are known to miss critical fixes for grounding, createAsset, and IRI resolution.

| Component                 | Minimum version | Recommended    | Why                                                   |
| ------------------------- | --------------- | -------------- | ----------------------------------------------------- |
| **Obsidian**              | 1.5.0           | 1.7.0 or newer | Plugin uses APIs available since 1.5.                 |
| **Exocortex plugin**      | v15.90.9        | Latest release | Fixes for createAsset, IRI resolution, targetValue.   |
| **Exocortex Starter Kit** | v1.3.4          | Latest release | $input → service_call conversions for Set/Shift/Plan. |
| **BRAT**                  | Latest          | Latest         | Delivers plugin updates automatically.                |

### How to check your versions

- **Obsidian**: Settings → About → "Current version".
- **Exocortex plugin**: Settings → Community plugins → Exocortex → "Installed" line. You can also open `.obsidian/plugins/exocortex/manifest.json` in your vault — the `version` field is authoritative.
- **Starter Kit**: the starter kit does not ship a version file; verify you downloaded `exocortex-starter-kit.zip` from the **latest** release at `https://github.com/kitelev/exocortex-starter-kit/releases/latest`. If buttons do not appear or dialogs write literal `$input`, re-download the latest zip.

If any component is below the minimum, update it before continuing.

---

## Table of Contents

1. [Requirements](#requirements)
2. [What is Exocortex?](#what-is-exocortex)
3. [Installation](#installation)
4. [Your First Area](#your-first-area)
5. [Your First Project](#your-first-project)
6. [Your First Task](#your-first-task)
7. [Daily Planning](#daily-planning)
8. [Understanding the Layout](#understanding-the-layout)
9. [Troubleshooting](#troubleshooting)
10. [Known Limitations](#known-limitations)
11. [Feedback](#feedback)
12. [Next Steps](#next-steps)

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

> **Note — Restricted Mode**: A brand-new vault starts in **Restricted Mode**. If you open Settings → Community plugins and see a **"Turn on community plugins"** button instead of **"Browse"**, click that first, then continue with Step 1.

1. Open Obsidian Settings → Community plugins → Browse
2. Search for **"BRAT"** (full name: "Obsidian42 - BRAT")
3. Click Install → Enable
4. Open BRAT settings → **Add Beta Plugin**
5. Enter `kitelev/exocortex` in the **GitHub repository** field. Either the `owner/repo` form or the full GitHub URL works. Leave **Personal Access Token** empty and keep **Enable after installing the plugin** checked.
6. Click **Add Plugin**
7. Go to Settings → Community plugins → enable **Exocortex**

BRAT will automatically keep the plugin updated with new releases.

### Step 2: Install Starter Kit

The plugin needs ontology files in your vault to enable buttons and commands. Download and extract the Starter Kit:

1. Go to the [Starter Kit Release](https://github.com/kitelev/exocortex-starter-kit/releases/latest)
2. Download `exocortex-starter-kit.zip`
3. Extract the ZIP into your vault (any folder works — the plugin scans the entire vault)
   - Recommended: extract into a folder like `Knowledge/` or at the vault root
   - The ZIP contains **seven** folders: `exocmd/` (command definitions), `pn/` (DailyNote properties), `exo/` (core ontology), `ems/` (effort classes and statuses), `ims/` (information-management concepts), `period/` (time periods), and `ztlk/` (Zettelkasten notes). It also contains a top-level `README.md`.

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

> **Note — pasting frontmatter**: Obsidian's Live Preview silently captures the `---` markers when you paste YAML, so the frontmatter can end up inside the note body instead of at the top. If the preview swallows the first `---`, switch to **Source Mode** first (**Cmd/Ctrl+P → "Toggle Live Preview / Source mode"**), paste the frontmatter, then switch back. Alternatively, type the `---` markers manually before pasting the rest.

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

The Exocortex layout renders with these sections (header labels match the on-screen UI):

- **Properties**: Shows all frontmatter properties
- **COMMANDS**: Action buttons relevant to areas (Create Project, Create Task, Create Sub Area, etc.)
- **Area tree**: Parent/child area relationships (empty until you create sub-areas)
- **Asset Relations**: Notes that reference this area. Populates automatically when another note links to it via a wiki-link.

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

- **COMMANDS**: Create Task, Set Planned Start, Start Effort, Convert to Task, and other action buttons
- **Asset Relations**: Tasks and notes that reference this project. Your project will also show up in the **Asset Relations** section of the parent area (`Development`) once you open it.

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

**1. Properties**

- Shows all frontmatter properties
- Resolves wiki-links to display labels
- Sortable columns (click headers)
- Toggle visibility with "Toggle Properties" button

**2. COMMANDS**

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

- **Area tree**: Interactive collapsible tree of parent/child areas

**pn\_\_DailyNote**

- **Daily Tasks**: All tasks scheduled for this date
- **Focus Area Filter**: Show only tasks from specific area

**ems\_\_Project** / **ems\_\_Task**

- Standard layout (Properties + Buttons + Relations)

---

## Troubleshooting

These are the most common problems encountered by first-time users. Start here before opening an issue.

### "I don't see any buttons on my note"

**Symptom**: The note opens but there is no properties table, no action buttons, nothing below the frontmatter.

**Cause**: Exocortex only renders in **Reading Mode**. In Edit Mode (Live Preview or Source), the layout does not appear.

**Fix**:

1. Press **Ctrl/Cmd + E** to switch to Reading Mode.
2. If still empty, verify the note's `exo__Instance_class` resolves to a known class (`ems__Area`, `ems__Project`, `ems__Task`, `pn__DailyNote`, etc.) and that the target class file exists in the vault (it comes from the Starter Kit).
3. Try **Cmd/Ctrl + P → "Reload Layout"**.

### "Wiki-links to classes are grey (broken)"

**Symptom**: `[[ems__Task]]`, `[[ems__EffortStatusBacklog]]`, or similar class references appear grey instead of blue/purple.

**Causes** (in order of likelihood):

1. The Starter Kit is not installed — the referenced class files do not exist in the vault.
2. The Starter Kit is installed but Obsidian has not indexed the new files yet.
3. You dragged files into the vault outside Obsidian and the cache is stale.

**Fix**:

1. Confirm the `exocmd/`, `ems/`, `exo/`, `pn/`, and `period/` folders exist somewhere in your vault (any location works).
2. Reload the vault: **Cmd/Ctrl + P → "Reload app without saving"**.
3. If the folders are missing, re-download `exocortex-starter-kit.zip` from the latest release and extract into your vault.

### "The Exocortex plugin is not loading"

**Symptom**: The plugin is enabled in settings but commands are missing, layouts never render, or the ribbon icon is absent.

**Fix**:

1. Open Settings → Community plugins and confirm Exocortex is **toggled on** (not just installed).
2. Open `exocortex-logs.txt` in your **vault root**. This file is written by the plugin and captures startup errors. Search for lines starting with `[ERROR]` or `Failed` to see why initialization failed.
3. Open Obsidian's developer console: **Ctrl/Cmd + Shift + I → Console**. Exocortex logs initialization there as well.
4. If the log mentions schema or RDF errors, a Starter Kit file may be corrupted — re-download the zip.
5. As a last resort, disable the plugin, restart Obsidian, re-enable it.

### "BRAT URL `obsidian://brat?plugin=...` does nothing (Windows)"

**Symptom**: You click a BRAT link expecting the "Add beta plugin" modal to open, and nothing happens. This is most common on Windows where the `obsidian://` URL handler is sometimes not registered.

**Fix** (fallback path, does not require the URL handler):

1. Open Obsidian → Settings → **Community plugins** → Installed plugins → **BRAT** → **Options**.
2. Click **Add Beta Plugin**.
3. Paste `kitelev/exocortex` (or the full GitHub URL) and confirm.
4. Enable Exocortex from Community plugins.

### "Create Task creates the file in an unexpected folder"

**Symptom**: You click **Create Task** on a project or area, and the new task note appears in the wrong folder.

**Cause**: `createAsset` uses the **parent folder of the currently active file** as the default location. This is deliberate (tasks live alongside their projects), but it surprises users who expect a central "Inbox" folder.

**Fix**:

- Open the target project in the folder you want the task to be created in, then click Create Task.
- Or, move the task manually after creation (Obsidian updates all wiki-links automatically).
- Or, create the task manually with the required frontmatter — see the "Your First Task" section above.

### "Set Status Doing shows a UUID next to the status name"

**Symptom**: After clicking **Set Status Doing** (or similar), the properties table displays something like `ems__EffortStatusDoing 027e78f4-6e16-4b36-b8fb-5510507d5745`, leaking the UUID.

**Status**: Known cosmetic issue. The status is set correctly — only the UI label is duplicated. A fix is tracked separately and does not affect functionality.

### "A button dialog writes literal `$input` or `$value` into the frontmatter"

**Symptom**: You click Set Result, Set Planned Start, or similar; the dialog accepts your input; but the property is stored as the literal string `$input` instead of your value.

**Cause**: You are running a Starter Kit older than **v1.3.4**. Earlier versions used `property_set` grounding which does not substitute `$input`.

**Fix**: Update the Starter Kit to v1.3.4 or newer. Download the latest `exocortex-starter-kit.zip` and extract into your vault, overwriting the old `exocmd/` folder.

### General diagnostic: `exocortex-logs.txt`

Whenever something feels wrong, the **first file to read** is `exocortex-logs.txt` in your vault root. It contains:

- Plugin initialization
- Every DynamicCommands execution (button click)
- IRI resolution results
- Failed grounding calls

Quick grep to find failures:

```
grep -iE "Failed|Error" exocortex-logs.txt
```

Include this file (or the relevant lines) when reporting problems — it saves hours of back-and-forth.

---

## Known Limitations

These are design decisions or rough edges that are **expected** in the current release. Knowing about them up front prevents frustration.

### Create-commands respect the active note's folder

- `createAsset` places the new file in the **parent folder of the active note**.
- There is no global "Inbox" target folder yet.
- Workaround: organize your vault so that active notes already live in the folder you want children to land in.

### `Create Area` requires an `01 Areas/` folder

- The Starter Kit's **Create Area** grounding is configured with `targetFolder: 01 Areas`, meaning Obsidian creates a `01 Areas/` folder at the vault root on the first run.
- If you prefer a different layout, you can edit the grounding file at `exocmd/creation/e72a5fa1-a902-4508-b671-bde8a1461a02.md` and change `exocmd__Grounding_targetFolder`.
- A configuration UI for this is on the roadmap.

### `Convert to Project` only changes `exo__Instance_class`

- It rewrites `exo__Instance_class` from `[[ems__Task]]` to `[[ems__Project]]`.
- It does **not** add project-specific properties (start/end timestamps, owner, etc.).
- After converting, review the frontmatter and add anything the project workflow needs.

### Status display may show a UUID next to the label

- As noted in Troubleshooting, certain status transitions render the metaclass UUID alongside the status name.
- This is cosmetic — the underlying RDF is correct. Tracked as a known issue.

### First-run indexing takes a moment

- When you install the Starter Kit for the first time, the plugin needs a few seconds to index 150+ ontology files.
- If buttons or class links look stale on the first opening of a note, switch tabs or run **Reload Layout** once.

### `property_set` grounding does not substitute user input

- If you author custom grounding files, be aware that `property_set` only substitutes `$target`, `$now`, and `$today`. It does **not** substitute `$input` or `$value`.
- For any user-input property update, use a `service_call` grounding with `updateProperty` — see the Starter Kit's `Set Planned Start` grounding as a reference template.

---

## Feedback

Exocortex is in active development and feedback from early users is highly valuable. The **primary channel** is GitHub Issues:

- **Bug reports and feature requests**: [github.com/kitelev/exocortex/issues](https://github.com/kitelev/exocortex/issues)
- Before opening a new issue, search existing issues — you may find an active discussion.
- Include your plugin version, Obsidian version, and the relevant section of `exocortex-logs.txt`.

When reporting a broken button or grounding, the most useful data is:

1. Plugin version (`manifest.json`) and Starter Kit zip date.
2. The exact button label you clicked.
3. The target note's full frontmatter.
4. The last 30 lines of `exocortex-logs.txt` around the click.

This is usually enough to identify the root cause on the first pass.

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

| Action         | Command                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Create task    | Click the **Create Task** button inside the layout (in-layout only; not wired into the command palette yet) |
| Move status    | Use status buttons (Backlog → Analysis → ToDo → Doing → Done)                                               |
| Plan for today | Click "Plan on Today" button                                                                                |
| Shift day      | Use ◀ / ▶ buttons                                                                                           |
| Vote on effort | Click "Vote" button                                                                                         |
| Reload layout  | Cmd/Ctrl+P → "Reload Layout"                                                                                |

### Troubleshooting at a glance

For the full diagnostic walkthrough see [Troubleshooting](#troubleshooting) above.

| Problem                  | First thing to try                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout doesn't appear    | Switch to Reading Mode (Ctrl/Cmd + E)                                                                                                                            |
| No buttons visible       | Verify Starter Kit is installed (`exocmd/` folder exists in vault); if the folder is present, fully quit and reopen Obsidian (cold restart) to force re-indexing |
| Buttons don't work       | Read `exocortex-logs.txt` in vault root; check console (Ctrl/Cmd + Shift + I)                                                                                    |
| Wiki-links grey          | Reload app without saving (Cmd/Ctrl + P); re-extract Starter Kit zip if folders missing                                                                          |
| Daily tasks not showing  | Check task has `ems__Effort_plannedStartTimestamp` matching daily note's `pn__DailyNote_day`                                                                     |
| Literal `$input` written | Update Starter Kit to v1.3.4 or newer                                                                                                                            |

---

## Getting Help

- **Documentation**: See [full documentation index](../README.md#documentation)
- **Report a bug or request a feature**: [GitHub Issues](https://github.com/kitelev/exocortex/issues) — see [Feedback](#feedback) for what to include
- **Starter Kit releases**: [github.com/kitelev/exocortex-starter-kit/releases](https://github.com/kitelev/exocortex-starter-kit/releases)

---

**Next**: [Task Workflows →](workflows/Task-Workflow.md)
