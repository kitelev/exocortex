# Getting Started with Exocortex

**Set up Exocortex — an ontology-driven knowledge management plugin for Obsidian. This guide is written for Obsidian desktop, the easiest place to do first-time setup; the plugin itself runs on mobile too (commands route through a git-free REST path on iOS/Android). git is recommended for git-backed vaults, but not required.**

---

## Requirements

Exocortex has been verified to work with the following minimum versions. Older versions miss the EKA setup commands this guide walks you through (and earlier fixes for grounding, createAsset, and IRI resolution).

| Component            | Minimum version | Recommended    | Why                                                                                                                                                                                                                                                                                      |
| -------------------- | --------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Obsidian**         | 1.5.0           | 1.7.0 or newer | Plugin uses APIs available since 1.5.                                                                                                                                                                                                                                                    |
| **Exocortex plugin** | v16.111.0       | Latest release | This guide's setup flow uses the EKA command names it ships («Set up the engine», «Add a knowledge pack», «Apply profile») and the Bootstrap → registry → profiles → Create Instance path. Older builds expose differently-named or missing commands, so the steps below will not match. |
| **git** (CLI)        | Optional        | Latest         | Only needed for git-backed vaults — used to register pulled AssetSpaces as git submodules. Non-git vaults work in file-only mode.                                                                                                                                                        |
| **BRAT**             | Latest          | Latest         | Delivers plugin updates automatically.                                                                                                                                                                                                                                                   |

### How to check your versions

- **Obsidian**: Settings → About → "Current version".
- **Exocortex plugin**: Settings → Community plugins → Exocortex → "Installed" line. You can also open `.obsidian/plugins/exocortex/manifest.json` in your vault — the `version` field is authoritative.
- **git** (optional): run `git --version` in a terminal. git is only used when your vault is itself a git repository — the «Set up the engine» command then registers the pulled AssetSpaces as git submodules. If your vault is not a git repository (or git is missing), the AssetSpaces are still downloaded and tracked in file-only mode.

If any component is below the minimum, update it before continuing.

---

## Table of Contents

1. [Requirements](#requirements)
2. [What is Exocortex?](#what-is-exocortex)
3. [Installation](#installation)
4. [Your first assets — the EMS example domain](#your-first-assets--the-ems-example-domain)
   - [Your First Area](#your-first-area) · [Your First Project](#your-first-project) · [Your First Task](#your-first-task)
5. [Daily Planning](#daily-planning)
6. [Understanding the Layout](#understanding-the-layout)
7. [Plugin Settings](#plugin-settings)
8. [Troubleshooting](#troubleshooting)
9. [Known Limitations](#known-limitations)
10. [Feedback](#feedback)
11. [Getting Help](#getting-help)

---

## What is Exocortex?

Exocortex is an Obsidian plugin that lets you **define custom entity types, their properties, and UI — all as data, not code**. Think of it as Notion databases, but with an ontology layer and fully offline.

You describe your entities (tasks, projects, areas, or any custom type) in YAML frontmatter, and the plugin automatically generates layouts, action buttons, and workflows based on those definitions. No server, no vendor lock-in — your data lives as Markdown files in your git repository.

> **About this guide.** The setup flow — install → bootstrap → registry → profiles → apply → sync — is **ontology-agnostic**: it is the engine, and it knows nothing about any particular domain. The hands-on walkthrough later (Areas → Projects → Tasks) uses the **EMS AssetSpace** (Effort Management) as one concrete example domain. EMS is not part of the engine — it is a mountable package. For the EMS domain model itself (its classes, status lifecycle, and properties) see the **[EMS AssetSpace README](https://github.com/kitelev/exoas-public)**; the same mechanism drives any ontology you mount.

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
4. Open the command palette (**Cmd/Ctrl + P**) and run **"BRAT: Plugins: Add a beta plugin for testing"**.

   > **Note — BRAT 2.x has no "Add beta plugin" button.** In current BRAT (2.0.8+), BRAT's own settings tab does _not_ have an "Add beta plugin" button at the top — adding a plugin is a **command-palette** action, not a settings-tab button. If you were looking for a button in BRAT's settings, that flow is gone.

5. In the **Add beta plugin** dialog, enter `kitelev/exocortex` in the **GitHub repository** field. Either the `owner/repo` form or the full GitHub URL works. Leave **Personal Access Token** empty.
6. **Select a release from the "Select a version…" dropdown.**

   > ⚠️ **This step is required.** The dialog will not add the plugin until you _explicitly_ pick a version from the dropdown — the implied "latest" is **not** applied automatically, and clicking **Add Plugin** with the dropdown untouched appears to do nothing. Choose the newest version (top of the list).

7. Keep **Enable after installing the plugin** checked, then click **Add Plugin**.
8. Confirm **Exocortex** is enabled under Settings → Community plugins (enable it if it isn't already).

BRAT will automatically keep the plugin updated with new releases.

### Recommended: the first-run setup wizard

The fastest way through setup is the built-in wizard. **When you enable Exocortex on a fresh vault** (empty, or only the stock `Welcome.md`), a **"Welcome to Exocortex"** panel opens automatically with a **5-step checklist** that walks you through the whole canonical path — with the recommended repository URLs pre-filled:

1. **Add your GitHub token** (optional) — only needed for **private** AssetSpaces; skip it for a fully-public vault. Includes a **Create token on GitHub** link and a **Test connection** button (see [Plugin Settings → GitHub PAT](#plugin-settings)).
2. **Set up the engine** — bootstraps the `exo` SDK floor.
3. **Add the AssetSpace registry** — `kitelev/exoas-registry` (pre-filled).
4. **Add the profiles AssetSpace** — `kitelev/exoas-profiles` (pre-filled).
5. **Apply a profile** — pick one; it mounts that profile's AssetSpaces.

Each step opens its own dialog **on top of** the panel, so the panel stays open underneath and you can come back to the next step. **Re-open the wizard any time** via **Cmd/Ctrl + P → "Exocortex: Setup (getting started)"** — handy if your vault already had notes (the wizard auto-shows only on a genuinely fresh vault, but the command always works).

> **Prefer to do it by hand?** The numbered **Step 2 / Step 2b** sections below are the same flow done manually and explained in depth. If the wizard is open, just follow it; the sections below are the reference for what each step does (and the git-commit note in Step 2b still applies to a git-backed vault before the first Apply).

### Step 2: Bootstrap your vault (the engine floor)

The plugin needs ontology files in your vault to enable layouts, action buttons, and commands. Rather than downloading anything by hand, the plugin pulls them straight from public GitHub repositories using its built-in **Set up the engine** command.

1. Open the command palette: **Cmd/Ctrl + P**
2. Run **"Exocortex: Set up the engine"**
3. In the dialog:
   - **exo ontology URL** (required): `https://github.com/kitelev/exoas-exo` — the core engine floor (classes, properties, IRI resolution). This is all a clean start needs.
4. Click **Bootstrap**. The plugin downloads the repository as a tarball via the GitHub REST API, extracts it safely into your vault, and indexes it automatically — no restart needed. In a git-backed vault the pulled AssetSpace is additionally registered as a git submodule (this is the only step that uses `git`).

> **Notes**
>
> - The repository is **public**, so no GitHub token is required.
> - A clean bootstrap is **exo-only** (floor = `{exo}`) — the misleading second «exocmd» field was removed. The `exocmd` UI-command library (which generates the action buttons) is added afterwards: either explicitly via **"Add a knowledge pack"** (Step 2b below) or transitively when you **Apply** a profile.
> - The URL above is a placeholder — you can point the field at your own fork.

### Step 2b: Add the registry + profiles, then apply a profile (recommended)

The fastest way to get a complete, working Areas → Projects → Tasks + Daily vault is the **EKA bootstrap flow** — add the public AssetSpace **registry** and **profiles**, then pick a profile to mount. (The first-run **"Exocortex: Setup (getting started)"** wizard walks you through these same steps with the URLs pre-filled.)

1. **Add your token (optional)** → only needed if you'll mount **private** AssetSpaces. **Cmd/Ctrl + P → "Exocortex: Settings"** (or the wizard's first step) to save a GitHub PAT. Skip it for a fully-public vault.
2. **Set up the engine** → `exoas-exo` (Step 2 above; the engine floor).
3. **Add the AssetSpace registry**: **Cmd/Ctrl + P → "Exocortex: Add a knowledge pack"** → enter
   `https://github.com/kitelev/exoas-registry`. This public registry declares every AssetSpace and its `dependsOn` graph — so a later **Apply profile** can resolve any profile's full dependency closure. It does **not** pull those AssetSpaces yet.
4. **Add the profiles AssetSpace**: **"Exocortex: Add a knowledge pack"** → enter
   `https://github.com/kitelev/exoas-profiles`. This public AssetSpace declares the knowledge profiles you'll pick from in the next step.
5. **Apply a profile**: **Cmd/Ctrl + P → "Exocortex: Apply profile"** → choose one. The plugin resolves that profile's `exo__AssetSpace_dependsOn` closure against the registry you added and materializes exactly its effective set. A fully-public choice is **`$$core`** (mounts only `exo`, no token needed); a personal profile (e.g. `$$kitelev-my`) needs the token from step 1 to pull its private AssetSpaces.

> **Why add the registry first**: a single **Add a knowledge pack** pulls only that one AssetSpace — it does **not** follow `dependsOn` transitively. **Apply profile** resolves the closure only over descriptors already in your vault, so the registry (all descriptors) and profiles must be present before you apply. This is the standard EKA bootstrap order.

> **⚠️ Git-backed vault? Commit before the first Apply.** If your vault is a git repository, Bootstrap + Add-AssetSpace leave the pulled `assetspaces/` as **untracked** files, and **Apply profile** refuses to unmount an AssetSpace with uncommitted changes (it never silently destroys un-pushed work) — you'll see `Apply aborted — N uncommitted file(s) …`. Before step 5, commit the vault once from a terminal at the vault root:
>
> ```bash
> # First add a .gitignore so your PAT (data.local.json) is never committed.
> # `>>` appends — if you already have a .gitignore it is preserved (just make
> # sure these two lines are present; remove any duplicates afterwards):
> printf '.obsidian/\n.exocortex/\n' >> .gitignore
> git add -A && git commit -m "vault setup"
> ```
>
> Then run **"Exocortex: Apply profile"**. (The `$$core` profile is all-public, so no PAT is needed — but gitignoring `.obsidian/` is still the right habit for when you apply a private profile later.) See [Profile → Apply on a git-backed vault](../explanation/profile.md) for details.

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

> **What are "action buttons"?** They are clickable controls — Create Task, Set Status Doing, Plan on Today, etc. — that the plugin generates from the **exocmd AssetSpace**. Since a clean bootstrap is exo-only, you get the action buttons once `exocmd` is present — added via **"Add a knowledge pack"** (Step 2b) or pulled transitively when you **Apply** a profile. They are different from the small **filter/toggle buttons** at the top of widgets (Show Effort Area, Show Votes, Hide Empty Slots), which are built into the plugin and work without any AssetSpace.

- Verify `exocmd` was mounted (look for an `exocmd` folder under `assetspaces/` in your vault — added via **"Add a knowledge pack"** or by **Apply profile**, not by the exo-only **Set up the engine**)
- If the `exocmd/` folder is present and the plugin loads cleanly, fully **quit and reopen Obsidian** (cold restart) to force re-indexing
- Try Cmd/Ctrl+P → "Reload layout"

### Your first sync: "Exocortex: Sync"

Bootstrapped AssetSpaces are GitHub-backed. To pull (and push) updates, run **Cmd/Ctrl + P → "Exocortex: Sync"**. This is the last step of the canonical setup path.

1. **Configure a GitHub PAT first** — Sync needs the fine-grained token from the section above (it pushes/pulls AssetSpace commits). Without one, the command shows a "configure PAT" notice instead of running. The engine reads the currently-stored PAT on every invocation, so a freshly-saved token works without a reload.
2. **Run "Exocortex: Sync".** One run syncs **every** materialized AssetSpace with its GitHub repository — pull → merge → push, children-before-parents, best-effort (one failing repo never blocks the rest).
3. **Read the summary notice** — it reports `pushed / pulled / merged / quarantined` counts; per-repo details go to the developer console (`[ExoSync] …`).

The **first** sync over a freshly-mounted AssetSpace just bootstraps its baseline (nothing is overwritten unless the local tree already diverged from the remote). For the full model — 3-way merge, conflict quarantine, FileSpaces, CLI usage, and troubleshooting (`full-conflict`, `auth-required`, rate limits) — see [ExoSync](../how-to/exosync.md).

---

## Your first assets — the EMS example domain

> **From here on, the walkthrough uses the EMS AssetSpace as a concrete example.** EMS (Effort Management) ships the classes you see below — Area, Project, Task — plus a status lifecycle. It is one mountable domain among many, not part of the engine. The steps demonstrate the **mechanism** (define an asset in frontmatter → the layout, buttons, and workflows follow); to apply it to a different domain, mount that domain's AssetSpace and use its classes instead. The full EMS reference (every class, the status lifecycle, all properties) lives in the **[EMS AssetSpace README](https://github.com/kitelev/exoas-public)** — it is intentionally not duplicated here.
>
> **Tip:** the **recommended** path below is the in-layout **buttons** (Create Project, Create Task). They write the correct, canonical (UID-form) frontmatter for you, so you never have to type wikilinks by hand. The manual-frontmatter examples are shown for reference; when you type a class label like `[[ems__Area]]`, the plugin resolves it so the link works — only the **buttons** write the canonical UID-form frontmatter to disk for you.

### Your First Area

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

### Your First Project

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

EMS ships a status lifecycle — `Draft → Backlog → Analysis → ToDo → Doing → Done` (plus `Trashed`). The individual status values (`ems__EffortStatusBacklog`, `ems__EffortStatusToDo`, …) and their exact meaning are part of the **EMS domain model**, documented in the **[EMS AssetSpace README](https://github.com/kitelev/exoas-public)** — kept there (not duplicated here) so the two never drift.

### What You'll See

- **COMMANDS**: Create Task, Set Planned Start, Start Effort, Convert to Task, and other action buttons
- **Asset Relations**: Tasks and notes that reference this project. Your project will also show up in the **Asset Relations** section of the parent area (`Development`) once you open it.

---

### Your First Task

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

> **Note — the `[[pn__DailyNote]]` link may stay grey**: the starter AssetSpaces do not ship a `pn__DailyNote` class file, so the wiki-link may show as unresolved. Daily notes still work — `pn__DailyNote` support is built into the plugin itself.

### Schedule Tasks for Today

1. Open a task note in Reading Mode
2. Click **"Plan on Today"** button
3. The task's frontmatter updates with a start-of-day timestamp for today:

```yaml
ems__Effort_plannedStartTimestamp: "2025-11-10T00:00:00"
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

## Plugin Settings

Open **Settings → Exocortex** to configure the plugin. Three things worth knowing up front:

- **Settings live in your vault.** After updating the plugin you will see an `exocortex-settings/` folder appear, with one `exo__Setting` note per setting. This is a one-shot migration (the plugin shows a Notice like _"Exocortex: migrated N setting(s) to vault assets"_); editing those notes is equivalent to changing the setting in the UI. See [Settings Homoiconization](../explanation/settings-homoiconization.md).
- **Excluded folders**: folder prefixes listed in this setting (default: `09 Templates/`) are skipped by RDF indexing and SHACL-lite validation — useful for template folders whose frontmatter is incomplete by design. Reload Obsidian after editing the list; the indexer snapshots it at startup.
- **GitHub PAT** (Settings → Exocortex → _Profile: GitHub PAT_): a fine-grained Personal Access Token used to **push** AssetSpace changes and to **pull private** AssetSpaces. You do **not** need it for the public starter onboarding (Steps 2–2b are all public, no token). Set it only when you run **"Exocortex: Sync"** (push), the **"Push current knowledge pack"** command, or **"Apply profile"** on a profile that includes a private repository. It is stored in `data.local.json` (not `data.json`), so Obsidian Sync **excludes it from network replication**. Use **"Save PAT"** / **"Test connection"** to store and verify it; leave the field blank and click Save to clear it.

### Adding your own / private AssetSpaces

The starter onboarding (Step 2b) pulls only **public** repositories, so no token is involved. To add **your own** or a **private** AssetSpace:

1. **Create a fine-grained GitHub PAT.** This is the single fiddliest setup step, so the plugin scaffolds it: both the first-run wizard's step 1 and _Settings → Exocortex → GitHub PAT_ show a **Create token on GitHub** link that deep-links straight to GitHub's **fine-grained** token page — [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). Use the **fine-grained** page (not the classic `/settings/tokens/new` one), scope the token to your `exoas-*` repositories with a per-repository allowlist, and grant exactly these permissions:

   | Permission   | Access         | Why                                                                                        |
   | ------------ | -------------- | ------------------------------------------------------------------------------------------ |
   | **Contents** | Read and write | Push AssetSpace commits to your `exoas-*` repos (and pull private ones)                    |
   | **Metadata** | Read-only      | Mandatory baseline (GitHub auto-selects it); also lets **Test connection** list your repos |

   Paste the token into the PAT field and click **Save PAT**, then **Test connection** to verify it reaches GitHub before you rely on it. (The token is stored device-local in `data.local.json`, never synced — see the bullet above.)

2. Declare the AssetSpace in a profile (an `exo__Profile` asset that lists it under `exo__Profile_includes`) and run **"Exocortex: Apply profile"**. Apply uses your PAT to materialize private AssetSpaces.

> **Under-scoped fine-grained PAT?** GitHub returns **404** (not 403) for a private repo the token's allowlist doesn't cover — so a "repo does not exist" error during Apply/Sync usually means the token is missing that repo, not that the repo is gone. Check the token's repository allowlist first.

> The **"Add a knowledge pack"** command is for a single **public** repository (no token), and it does **not** pull that repo's dependencies automatically. For private content, or for a complete dependency-resolved set, prefer the profile path (**Apply profile**) over **Add a knowledge pack**.

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
3. Try **Cmd/Ctrl + P → "Reload layout"**.

### "Wiki-links to classes are grey (broken)"

**Symptom**: `[[ems__Task]]`, `[[ems__EffortStatusBacklog]]`, or similar class references appear grey instead of blue/purple.

**Causes** (in order of likelihood):

1. The AssetSpaces have not been bootstrapped — the referenced class files do not exist in the vault.
2. The AssetSpaces have been bootstrapped but Obsidian has not indexed the new files yet.
3. You dragged files into the vault outside Obsidian and the cache is stale.

**Fix**:

1. Confirm the `exocmd/`, `ems/`, `exo/`, and `period/` folders exist somewhere in your vault (any location works).
2. Reload the vault: **Cmd/Ctrl + P → "Reload app without saving"**.
3. If the folders are missing, re-run **Cmd/Ctrl+P → "Exocortex: Set up the engine"** (or **"Exocortex: Add a knowledge pack"** for a single space) to re-download the AssetSpace.

### "The Exocortex plugin is not loading"

**Symptom**: The plugin is enabled in settings but commands are missing, layouts never render, or the ribbon icon is absent.

**Fix**:

1. Open Settings → Community plugins and confirm Exocortex is **toggled on** (not just installed).
2. Run **Cmd/Ctrl+P → "Exocortex: Open log file (saved)"** to view `exocortex-logs.txt` and its real location. The file lives in the **plugin's data folder** (`<vault>/.obsidian/plugins/exocortex/exocortex-logs.txt`), _not_ the vault root — the command shows the exact path and content so you never have to hunt for it. Search for lines starting with `[ERROR]` or `Failed` to see why initialization failed. (By default only warnings and errors are written to the file; for a live stream of everything the plugin is doing, run **"Exocortex: Open activity log (live)"**.)
3. Open Obsidian's developer console: **Ctrl/Cmd + Shift + I → Console**. Exocortex logs initialization there as well.
4. If the log mentions schema or RDF errors, a bootstrapped AssetSpace file may be corrupted — re-run **Cmd/Ctrl+P → "Exocortex: Set up the engine"** (or **"Exocortex: Add a knowledge pack"** for a single space) to re-download the AssetSpace.
5. As a last resort, disable the plugin, restart Obsidian, re-enable it.

### "BRAT URL `obsidian://brat?plugin=...` does nothing (Windows)"

**Symptom**: You click a BRAT link expecting the "Add beta plugin" modal to open, and nothing happens. This is most common on Windows where the `obsidian://` URL handler is sometimes not registered.

**Fix** (fallback path, does not require the URL handler):

1. Open the command palette (**Cmd/Ctrl + P**) and run **"BRAT: Plugins: Add a beta plugin for testing"** (in BRAT 2.x there is no "Add Beta Plugin" button — see [Installation Step 1](#step-1-install-via-brat)).
2. Paste `kitelev/exocortex` (or the full GitHub URL) into the **GitHub repository** field.
3. **Pick a version from the "Select a version…" dropdown** (required — the dialog ignores **Add Plugin** until a version is selected), then click **Add Plugin**.
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

**Cause**: Your plugin is out of date. Current plugin versions substitute `$input` / `$value` directly in `property_set` groundings, and fail with an explicit error instead of silently writing the literal when no input was provided.

**Fix**: Update the plugin (BRAT: **Cmd/Ctrl+P → "BRAT: Check for updates to all beta plugins"**) and restart Obsidian. If the problem persists, re-run **Cmd/Ctrl+P → "Exocortex: Set up the engine"** to refresh the exocmd command definitions.

### General diagnostic: `exocortex-logs.txt`

Whenever something feels wrong, the **first place to look** is `exocortex-logs.txt`. The quickest way to it is **Cmd/Ctrl+P → "Exocortex: Open log file (saved)"** — that opens the file's content _and_ shows its exact path. The file is written to the **plugin's data folder**, not the vault root:

```
<vault>/.obsidian/plugins/exocortex/exocortex-logs.txt
```

(The `.obsidian` part follows your Obsidian config folder — if you customised it, the path adjusts accordingly. The file is **not** part of your notes and is **not** indexed by SPARQL.) It contains:

- Plugin initialization
- Every DynamicCommands execution (button click)
- IRI resolution results
- Failed grounding calls

By default only **warnings and errors** are written to the file. To capture everything, enable the **Info** row under **Settings → Exocortex → Log channels**. For a live, no-setup stream of plugin activity, run **"Exocortex: Open activity log (live)"** instead.

Quick grep to find failures (run from the folder above, or pass the full path):

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

### `Convert to Project` only changes `exo__Instance_class`

- It rewrites `exo__Instance_class` from `[[ems__Task]]` to `[[ems__Project]]`.
- It does **not** add project-specific properties (start/end timestamps, owner, etc.).
- After converting, review the frontmatter and add anything the project workflow needs.

### First-run indexing takes a moment

- When you bootstrap the AssetSpaces for the first time, the plugin needs a few seconds to index 150+ ontology files.
- During that window the action-buttons area shows an **"indexing… buttons will appear shortly"** placeholder instead of a blank layout; the real buttons replace it automatically once indexing finishes.
- If buttons or class links still look stale after indexing, switch tabs or run **Reload layout** once.

---

## Feedback

Exocortex is in active development and feedback from early users is highly valuable. The **primary channel** is GitHub Issues:

- **Bug reports and feature requests**: [github.com/kitelev/exocortex/issues](https://github.com/kitelev/exocortex/issues)
- Before opening a new issue, search existing issues — you may find an active discussion.
- Include your plugin version, Obsidian version, and the relevant section of `exocortex-logs.txt`.

When reporting a broken button or grounding, the most useful data is:

1. Plugin version (`manifest.json`) and the date you last ran **Set up the engine** (or the pulled `exocmd/` commit).
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
| Reload layout  | Cmd/Ctrl+P → "Reload layout"                                                                                |

### Troubleshooting at a glance

For the full diagnostic walkthrough see [Troubleshooting](#troubleshooting) above.

| Problem                   | First thing to try                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout doesn't appear     | Switch to Reading Mode (Ctrl/Cmd + E)                                                                                                                                    |
| No action buttons visible | Verify the AssetSpaces are bootstrapped (`exocmd/` folder exists in vault); if the folder is present, fully quit and reopen Obsidian (cold restart) to force re-indexing |
| Action buttons don't work | Run **Exocortex: Open log file (saved)** (file lives in the plugin data folder, not vault root); check console (Ctrl/Cmd + Shift + I)                                    |
| Wiki-links grey           | Reload app without saving (Cmd/Ctrl + P); re-run **Exocortex: Set up the engine** if folders missing                                                                     |
| Daily tasks not showing   | Check task has `ems__Effort_plannedStartTimestamp` matching daily note's `pn__DailyNote_day`                                                                             |
| Literal `$input` written  | Update the plugin via BRAT — current versions substitute `$input`/`$value` in `property_set` groundings                                                                  |

---

## Getting Help

- **Documentation**: See [full documentation index](../../README.md#documentation)
- **Report a bug or request a feature**: [GitHub Issues](https://github.com/kitelev/exocortex/issues) — see [Feedback](#feedback) for what to include
- **AssetSpace repositories**: [github.com/kitelev/exoas-exo](https://github.com/kitelev/exoas-exo) (core ontology) and [github.com/kitelev/exoas-exocmd](https://github.com/kitelev/exoas-exocmd) (command definitions)
