# Getting Started with Exocortex

**Set up Exocortex — an ontology-driven knowledge management plugin for Obsidian. Requires: Obsidian desktop, git installed, basic terminal knowledge.**

---

## Requirements

Exocortex has been verified to work with the following minimum versions. Older versions are known to miss critical fixes for grounding, createAsset, and IRI resolution.

| Component            | Minimum version | Recommended    | Why                                                                |
| -------------------- | --------------- | -------------- | ------------------------------------------------------------------ |
| **Obsidian**         | 1.5.0           | 1.7.0 or newer | Plugin uses APIs available since 1.5.                              |
| **Exocortex plugin** | v15.90.9        | Latest release | Fixes for createAsset, IRI resolution, targetValue.                |
| **git** (CLI)        | 2.x             | Latest         | The «Bootstrap vault» command clones ontology AssetSpaces via git. |
| **BRAT**             | Latest          | Latest         | Delivers plugin updates automatically.                             |

### How to check your versions

- **Obsidian**: Settings → About → "Current version".
- **Exocortex plugin**: Settings → Community plugins → Exocortex → "Installed" line. You can also open `.obsidian/plugins/exocortex/manifest.json` in your vault — the `version` field is authoritative.
- **git**: run `git --version` in a terminal. If it is missing, install it (macOS: `xcode-select --install` or `brew install git`; Windows: [git-scm.com](https://git-scm.com/download/win)) before bootstrapping — the «Bootstrap vault» command shells out to `git` to clone the ontology AssetSpaces.

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

> **Important — Reading Mode is required**: every Exocortex layout (action buttons, Asset Relations, Area tree, Daily Tasks) renders **only in Obsidian's Reading Mode**. In Live Preview or Source Mode the layout is intentionally hidden — you will see only the raw frontmatter. Toggle with **Ctrl/Cmd + E** or the reading-glass icon in the top-right. This is a deliberate design choice (read vs. edit separation), not a bug.

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
4. Open BRAT settings → **Add beta plugin**
5. Enter `kitelev/exocortex` in the **GitHub repository** field. Either the `owner/repo` form or the full GitHub URL works. Leave **Personal Access Token** empty and keep **Enable after installing the plugin** checked.
6. Click **Add Plugin**
7. Go to Settings → Community plugins → enable **Exocortex**

BRAT will automatically keep the plugin updated with new releases.

### Step 2: Bootstrap your vault (the engine floor)

The plugin needs ontology files in your vault to enable layouts, action buttons, and commands. Rather than downloading anything by hand, the plugin pulls them straight from public GitHub repositories using its built-in **Bootstrap vault** command.

1. Open the command palette: **Cmd/Ctrl + P**
2. Run **"Exocortex: Bootstrap vault"**
3. In the dialog:
   - **exo ontology URL** (required): `https://github.com/kitelev/exoas-exo` — the core engine floor (classes, properties, IRI resolution).
   - **exocmd ontology URL** (optional): `https://github.com/kitelev/exoas-exocmd` — the UI command library that generates the action buttons. **Leave it blank** for a knowledge-only / SPARQL-only vault, or fill it for the full button experience.
4. Click **Bootstrap**. The plugin clones the repositories into your vault via `git` and indexes them automatically — no restart needed.

> **Notes**
>
> - The repositories are **public**, so no GitHub token is required.
> - Since plugin **v16.74.0**, only the **exo** URL is required — `exocmd` is an optional UI-command library (floor = `{exo}`). A bare engine vault is a first-class configuration; add `exocmd` later if you want the action buttons.
> - The URLs above are placeholders — you can point the fields at your own forks.

### Step 2b: Add the starter registry, then apply the starter profile (recommended)

The fastest way to get a complete, working Areas → Projects → Tasks + Daily vault — **without** loading anyone's personal notes — is the **3-step onboarding** built on the **starter registry**:

1. **Bootstrap vault** → `exoas-exo` (Step 2 above; `exocmd` optional, since the profile pulls it).
2. **Add the registry**: **Cmd/Ctrl + P → "Exocortex: Add assetspace by URL"** → enter
   `https://github.com/kitelev/exoas-starter-registry`. This is a small public registry — it declares the starter AssetSpaces and a `starter` knowledge profile; it does **not** pull them yet.
3. **Apply the profile**: **Cmd/Ctrl + P → "Exocortex: Apply profile"** → choose **`starter`**. The plugin materializes exactly the starter set — `exo`, `exocmd`, `ems`, `ems-commands`, `period`, `person` — and nothing else (no `shared-identities`, no personal data).

> **Why this path**: the `starter` profile mounts only what a fresh vault needs (floor = `{exo}`), so first-run indexing is fast and your vault stays free of unrelated assets. You can still add more AssetSpaces later via **"Add assetspace by URL"** — dependencies are **not** pulled automatically.

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

**If action buttons are missing but the layout appears:**

> **What are "action buttons"?** They are clickable controls — Create Task, Set Status Doing, Plan on Today, etc. — that the plugin generates from the **exocmd AssetSpace** you bootstrapped. They are different from the small **filter/toggle buttons** at the top of widgets (Show Effort Area, Show Votes, Hide Empty Slots), which are built into the plugin and work without any AssetSpace.

- Verify the AssetSpaces were mounted (look for an `exocmd/` folder in your vault — created by **Bootstrap vault** in Step 2)
- If the `exocmd/` folder is present and the plugin loads cleanly, fully **quit and reopen Obsidian** (cold restart) to force re-indexing
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
- **Asset Relations**: Notes that reference this area. **This section only appears once another note links to this area** — until then, the section is hidden. As soon as you create a project or task that references the area, the section will populate automatically.

**Note**: The layout only appears in Reading Mode, not in Edit Mode.

---

## Your First Project

Projects represent specific initiatives within an area.

### Create a Project Using the Button (recommended)

Since plugin **v15.92.0**, the easiest way to create a project is from the parent area's layout:

1. Open your area note (`Development.md`) in **Reading Mode**.
2. In the **COMMANDS** section, click **Create Project**.
3. Type the project name (e.g., `Build API Server`) and press **Enter** (or click OK).

The plugin creates the project note, wires `ems__Effort_area` to the active area automatically, and sets the initial status. You can then edit the note to add a description.

> **Why the button path is recommended**: it guarantees the correct frontmatter schema (class, area wiki-link, default status) and keeps area → project relationships consistent. Manual frontmatter authoring (below) remains supported for advanced cases or templating.

### Create a Project Note manually

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

1. Create a note named `2025-11-10.md` (use ISO format: YYYY-MM-DD — this is the daily-note convention)
2. Add frontmatter:

```yaml
---
exo__Instance_class:
  - "[[pn__DailyNote]]"
exo__Asset_label: "Daily 2025-11-10"
pn__DailyNote_day: "2025-11-10"
---
# Daily 2025-11-10

Today's plan.
```

> **Note — why the label is not just `"2025-11-10"`**: Obsidian's Properties widget auto-detects pure date strings (`YYYY-MM-DD`) and renders them as a date picker (`10 11 2025`). Prefixing the label with `Daily` keeps it readable as a string. The `pn__DailyNote_day` property must remain a pure date — that is the value the daily layout filters tasks by.

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
- Long property names (e.g., `exo__Instance_class`) may be visually truncated by the Properties widget. Hover over a property name to see the full version, or widen the column / panel to fit.

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

### "I don't see any action buttons on my note"

**Symptom**: The note opens but there is no properties table, no action buttons, nothing below the frontmatter.

> **Action buttons vs. filter buttons**: "Action buttons" means **Create Task / Set Status Doing / Plan on Today** and similar — generated by the plugin from the exocmd AssetSpace's `exocmd/` folder. They are different from the **filter/toggle buttons** (Show Effort Area, Show Votes, Hide Empty Slots) that sit at the top of widgets and work without the exocmd AssetSpace. If your filter buttons are present but action buttons are missing, you have an AssetSpace problem, not a plugin problem.

**Cause**: Exocortex only renders in **Reading Mode**. In Edit Mode (Live Preview or Source), the layout does not appear.

**Fix**:

1. Press **Ctrl/Cmd + E** to switch to Reading Mode.
2. If still empty, verify the note's `exo__Instance_class` resolves to a known class (`ems__Area`, `ems__Project`, `ems__Task`, `pn__DailyNote`, etc.) and that the target class file exists in the vault (it comes from the bootstrapped AssetSpaces).
3. Try **Cmd/Ctrl + P → "Reload Layout"**.

### "Wiki-links to classes are grey (broken)"

**Symptom**: `[[ems__Task]]`, `[[ems__EffortStatusBacklog]]`, or similar class references appear grey instead of blue/purple.

**Causes** (in order of likelihood):

1. The AssetSpaces have not been bootstrapped — the referenced class files do not exist in the vault.
2. The AssetSpaces have been bootstrapped but Obsidian has not indexed the new files yet.
3. You dragged files into the vault outside Obsidian and the cache is stale.

**Fix**:

1. Confirm the `exocmd/`, `ems/`, `exo/`, `pn/`, and `period/` folders exist somewhere in your vault (any location works).
2. Reload the vault: **Cmd/Ctrl + P → "Reload app without saving"**.
3. If the folders are missing, re-run **Cmd/Ctrl+P → "Exocortex: Bootstrap vault"** (or **"Exocortex: Add assetspace by URL"** for a single space) to re-clone the AssetSpace.

### "The Exocortex plugin is not loading"

**Symptom**: The plugin is enabled in settings but commands are missing, layouts never render, or the ribbon icon is absent.

**Fix**:

1. Open Settings → Community plugins and confirm Exocortex is **toggled on** (not just installed).
2. Open `exocortex-logs.txt` in your **vault root**. This file is written by the plugin and captures startup errors. Search for lines starting with `[ERROR]` or `Failed` to see why initialization failed.
3. Open Obsidian's developer console: **Ctrl/Cmd + Shift + I → Console**. Exocortex logs initialization there as well.
4. If the log mentions schema or RDF errors, a bootstrapped AssetSpace file may be corrupted — re-run **Cmd/Ctrl+P → "Exocortex: Bootstrap vault"** (or **"Exocortex: Add assetspace by URL"** for a single space) to re-clone the AssetSpace.
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

### "A button dialog writes literal `$input` or `$value` into the frontmatter"

**Symptom**: You click Set Result, Set Planned Start, or similar; the dialog accepts your input; but the property is stored as the literal string `$input` instead of your value.

**Cause**: Your exocmd AssetSpace is out of date. Older command definitions used `property_set` grounding which does not substitute `$input`.

**Fix**: Re-run **Cmd/Ctrl+P → "Exocortex: Bootstrap vault"** to pull the latest `exoas-exocmd`. Bootstrap always clones the latest `main` of the exocmd repo, so there is no zip version to pin — re-cloning overwrites the old `exocmd/` folder with the current command definitions.

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

- The exocmd AssetSpace's **Create Area** grounding is configured with `targetFolder: 01 Areas`, meaning Obsidian creates a `01 Areas/` folder at the vault root on the first run.
- If you prefer a different layout, you can edit the grounding file at `exocmd/creation/e72a5fa1-a902-4508-b671-bde8a1461a02.md` and change `exocmd__Grounding_targetFolder`.
- A configuration UI for this is on the roadmap.

### `Convert to Project` only changes `exo__Instance_class`

- It rewrites `exo__Instance_class` from `[[ems__Task]]` to `[[ems__Project]]`.
- It does **not** add project-specific properties (start/end timestamps, owner, etc.).
- After converting, review the frontmatter and add anything the project workflow needs.

### First-run indexing takes a moment

- When you bootstrap the AssetSpaces for the first time, the plugin needs a few seconds to index 150+ ontology files.
- If buttons or class links look stale on the first opening of a note, switch tabs or run **Reload Layout** once.

### `property_set` grounding does not substitute user input

- If you author custom grounding files, be aware that `property_set` only substitutes `$target`, `$now`, and `$today`. It does **not** substitute `$input` or `$value`.
- For any user-input property update, use a `service_call` grounding with `updateProperty` — see the exocmd AssetSpace's `Set Planned Start` grounding as a reference template.

---

## Feedback

Exocortex is in active development and feedback from early users is highly valuable. The **primary channel** is GitHub Issues:

- **Bug reports and feature requests**: [github.com/kitelev/exocortex/issues](https://github.com/kitelev/exocortex/issues)
- Before opening a new issue, search existing issues — you may find an active discussion.
- Include your plugin version, Obsidian version, and the relevant section of `exocortex-logs.txt`.

When reporting a broken button or grounding, the most useful data is:

1. Plugin version (`manifest.json`) and the date you last ran **Bootstrap vault** (or the cloned `exocmd/` commit).
2. The exact button label you clicked.
3. The target note's full frontmatter.
4. The last 30 lines of `exocortex-logs.txt` around the click.

This is usually enough to identify the root cause on the first pass.

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

| Problem                   | First thing to try                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout doesn't appear     | Switch to Reading Mode (Ctrl/Cmd + E)                                                                                                                                    |
| No action buttons visible | Verify the AssetSpaces are bootstrapped (`exocmd/` folder exists in vault); if the folder is present, fully quit and reopen Obsidian (cold restart) to force re-indexing |
| Action buttons don't work | Read `exocortex-logs.txt` in vault root; check console (Ctrl/Cmd + Shift + I)                                                                                            |
| Wiki-links grey           | Reload app without saving (Cmd/Ctrl + P); re-run **Exocortex: Bootstrap vault** if folders missing                                                                       |
| Daily tasks not showing   | Check task has `ems__Effort_plannedStartTimestamp` matching daily note's `pn__DailyNote_day`                                                                             |
| Literal `$input` written  | Re-run **Exocortex: Bootstrap vault** to pull the latest `exoas-exocmd`                                                                                                  |

---

## Getting Help

- **Documentation**: See [full documentation index](../README.md#documentation)
- **Report a bug or request a feature**: [GitHub Issues](https://github.com/kitelev/exocortex/issues) — see [Feedback](#feedback) for what to include
- **AssetSpace repositories**: [github.com/kitelev/exoas-exo](https://github.com/kitelev/exoas-exo) (core ontology) and [github.com/kitelev/exoas-exocmd](https://github.com/kitelev/exoas-exocmd) (command definitions)
