# Command Reference

**Complete documentation of all 32 Exocortex commands.**

---

## Table of Contents

1. [Creation Commands](#creation-commands)
2. [Status Management Commands](#status-management-commands)
3. [Planning Commands](#planning-commands)
4. [Maintenance Commands](#maintenance-commands)
5. [View Commands](#view-commands)
6. [Utility Commands](#utility-commands)

---

## Creation Commands

Commands for creating new assets.

### Create Task

**Command ID**: `create-task`
**Button**: "Create Task" (appears on project and daily notes)
**Keyboard**: Cmd/Ctrl + P → "Create Task"

**Purpose**: Create a new task note with proper frontmatter and relationships.

**Usage**:
1. Open parent project or daily note
2. Click "Create Task" button
3. Fill form:
   - **Label**: Task name
   - **Status**: Workflow status (default: ToDo)
   - **Area**: Auto-filled from parent
4. Click OK

**Result**: Creates `tasks/task-[uid].md` with:
```yaml
---
exo__Instance_class: ems__Task
exo__Asset_label: [Label]
ems__Effort_area: "[[Area]]"
ems__Effort_project: "[[Project]]"
ems__Effort_status: "[[ems__EffortStatusToDo]]"
---
```

**Visibility**: Available when current note is `ems__Project` or `pn__DailyNote`.

---

### Create Related Task

**Command ID**: `create-related-task`
**Button**: "Create Related Task"
**Keyboard**: Cmd/Ctrl + P → "Create Related Task"

**Purpose**: Create a task linked to current task as sub-task.

**Usage**:
1. Open parent task note
2. Click "Create Related Task" button
3. Fill form (same as Create Task)

**Result**: Creates task with `ems__Effort_parent: "[[Current Task]]"`.

**Visibility**: Available when current note is `ems__Task`.

---

### Create Project

**Command ID**: `create-project`
**Button**: "Create Project"
**Keyboard**: Cmd/Ctrl + P → "Create Project"

**Purpose**: Create a new project note within an area.

**Usage**:
1. Open area note
2. Click "Create Project" button
3. Fill form:
   - **Label**: Project name
   - **Status**: Default Backlog
   - **Area**: Auto-filled

**Result**: Creates `projects/project-[uid].md` with:
```yaml
---
exo__Instance_class: ems__Project
exo__Asset_label: [Label]
ems__Effort_area: "[[Area]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---
```

**Visibility**: Available when current note is `ems__Area`.

---

### Create Instance

**Command ID**: `create-instance`
**Keyboard**: Cmd/Ctrl + P → "Create Instance"

**Purpose**: Create a new note of any class type (Area, Task, Project, etc.).

**Usage**:
1. Cmd/Ctrl + P → "Create Instance"
2. Select class from dropdown
3. Fill form fields (varies by class)

**Visibility**: Always available.

---

### Create Fleeting Note

**Command ID**: `create-fleeting-note`
**Button**: "Create Fleeting Note"
**Keyboard**: Cmd/Ctrl + P → "Create Fleeting Note"

**Purpose**: Quick capture note for ideas.

**Usage**:
1. Cmd/Ctrl + P → "Create Fleeting Note"
2. Enter title
3. Note created in fleeting notes folder

**Visibility**: Always available.

---

### Add Supervision

**Command ID**: `add-supervision`
**Button**: "Add Supervision"
**Keyboard**: Cmd/Ctrl + P → "Add Supervision"

**Purpose**: Create a structured CBT (Cognitive Behavioral Therapy) diary record for self-reflection.

**Usage**:
1. Cmd/Ctrl + P → "Add Supervision"
2. Fill form with CBT fields:
   - **Situation/trigger**: What happened
   - **Emotions**: How you felt
   - **Thoughts**: What you were thinking
   - **Behavior**: What you did
   - **Short-term consequences**: Immediate effects
   - **Long-term consequences**: Future implications
3. Click OK

**Result**: Creates specialized fleeting note in `01 Inbox/` with:
```yaml
---
exo__Instance_class: ztlk__FleetingNote
ztlk__FleetingNote_type: "[[CBT-Diary Record]]"
---

- Ситуация/триггер: [situation]
- Эмоции: [emotions]
- Мысли: [thoughts]
- Поведение: [behavior]
- Краткосрочные последствия поведения: [short-term]
- Долгосрочные последствия поведения: [long-term]
```

**Visibility**: Always available.

**Note**: This is a specialized fleeting note for CBT self-reflection. For simple quick-capture notes, use [Create Fleeting Note](#create-fleeting-note).

---

## Status Management Commands

Commands for moving efforts through workflow.

### Set Draft Status

**Command ID**: `set-draft-status`
**Button**: "Set Draft Status"
**Keyboard**: Cmd/Ctrl + P → "Set Draft Status"

**Purpose**: Mark effort as draft (initial idea).

**Status Change**: Any → `ems__EffortStatusDraft`

**Timestamps**: Adds status change entry.

**Visibility**: Available on efforts not already in Draft.

---

### Move to Backlog

**Command ID**: `move-to-backlog`
**Button**: "Move to Backlog"
**Keyboard**: Cmd/Ctrl + P → "Move to Backlog"

**Purpose**: Commit effort to backlog (awaiting analysis).

**Status Change**: Draft → `ems__EffortStatusBacklog`

**Visibility**: Available on Draft efforts.

---

### Move to Analysis

**Command ID**: `move-to-analysis`
**Button**: "Move to Analysis"
**Keyboard**: Cmd/Ctrl + P → "Move to Analysis"

**Purpose**: Start analyzing/planning effort.

**Status Change**: Backlog → `ems__EffortStatusAnalysis`

**Visibility**: Available on Backlog efforts.

---

### Move to ToDo

**Command ID**: `move-to-todo`
**Button**: "Move to ToDo"
**Keyboard**: Cmd/Ctrl + P → "Move to ToDo"

**Purpose**: Mark effort as ready to start.

**Status Change**: Analysis or Doing → `ems__EffortStatusToDo`

**Visibility**: Available on Analysis or Doing efforts.

---

### Start Effort

**Command ID**: `start-effort`
**Button**: "Start Effort"
**Keyboard**: Cmd/Ctrl + P → "Start Effort"

**Purpose**: Begin active work on effort.

**Status Change**: ToDo → `ems__EffortStatusDoing`

**Timestamps**: Sets `ems__Effort_startTimestamp` to current ISO 8601 timestamp.

**Visibility**: Available on ToDo efforts.

---

### Mark Done

**Command ID**: `mark-done`
**Button**: "Mark Done"
**Keyboard**: Cmd/Ctrl + P → "Mark Done"

**Purpose**: Complete effort.

**Status Change**: Doing → `ems__EffortStatusDone`

**Timestamps**: Sets `ems__Effort_endTimestamp` to current ISO 8601 timestamp.

**Visibility**: Available on Doing efforts.

---

## Planning Commands

Commands for scheduling and organizing efforts.

### Plan on Today

**Command ID**: `plan-on-today`
**Button**: "Plan on Today"
**Keyboard**: Cmd/Ctrl + P → "Plan on Today"

**Purpose**: Schedule effort for today.

**Updates**:
```yaml
ems__Effort_day: "[[2025-11-10]]"  # Wiki-link to today's date
```

**Visibility**: Available on efforts (tasks/projects).

---

### Plan for Evening

**Command ID**: `plan-for-evening`
**Button**: "Plan for Evening"
**Keyboard**: Cmd/Ctrl + P → "Plan for Evening"

**Purpose**: Schedule effort for today's evening (18:00).

**Updates**:
```yaml
ems__Effort_day: "[[2025-11-10]]"
ems__Effort_plannedStartTimestamp: "2025-11-10T19:00:00.000Z"  # ISO 8601 timestamp
```

**Visibility**: Available on efforts.

---

### Shift Day Forward

**Command ID**: `shift-day-forward`
**Button**: "▶" (right arrow)
**Keyboard**: Cmd/Ctrl + P → "Shift Day Forward"

**Purpose**: Reschedule effort to next day.

**Updates**: Increments `ems__Effort_day` by 1 day.

**Example**: 2025-11-10 → 2025-11-11

**Visibility**: Available on scheduled efforts.

---

### Shift Day Backward

**Command ID**: `shift-day-backward`
**Button**: "◀" (left arrow)
**Keyboard**: Cmd/Ctrl + P → "Shift Day Backward"

**Purpose**: Reschedule effort to previous day.

**Updates**: Decrements `ems__Effort_day` by 1 day.

**Example**: 2025-11-10 → 2025-11-09

**Visibility**: Available on scheduled efforts.

---

### Set Focus Area

**Command ID**: `set-focus-area`
**Button**: "Set Focus Area"
**Keyboard**: Cmd/Ctrl + P → "Set Focus Area"

**Purpose**: Filter daily note to show only tasks from specific area.

**Usage**:
1. Open daily note
2. Click "Set Focus Area" button
3. Select area from dropdown
4. Daily Tasks section filters to that area

**Clear focus**: Select "(No focus)" option.

**Visibility**: Available on `pn__DailyNote`.

---

## Maintenance Commands

Commands for asset management and cleanup.

### Archive Task

**Command ID**: `archive-task`
**Button**: "Archive"
**Keyboard**: Cmd/Ctrl + P → "Archive Task"

**Purpose**: Archive task (hide from active views).

**Updates**:
```yaml
exo__Asset_archived: true
```

**Effect**:
- Hidden from daily note (unless "Show Archived" toggled)
- Hidden from relations
- Still searchable

**Visibility**: Available on tasks not already archived.

---

### Trash Effort

**Command ID**: `trash-effort`
**Button**: "Trash"
**Keyboard**: Cmd/Ctrl + P → "Trash Effort"

**Purpose**: Delete effort permanently (move to Obsidian trash).

**Warning**: Cannot be undone easily. Archive is usually better.

**Visibility**: Available on efforts.

---

### Vote on Effort

**Command ID**: `vote-on-effort`
**Button**: "Vote"
**Keyboard**: Cmd/Ctrl + P → "Vote on Effort"

**Purpose**: Increment vote count for prioritization.

**Updates**:
```yaml
ems__Effort_votes: 5  # Increments by 1
```

**Visibility**: Available on efforts (tasks/projects).

---

### Clean Properties

**Command ID**: `clean-properties`
**Button**: "Clean Properties"
**Keyboard**: Cmd/Ctrl + P → "Clean Properties"

**Purpose**: Remove empty/invalid properties from frontmatter.

**Actions**:
- Removes properties with empty values
- Removes properties with `null` or `undefined`
- Formats inconsistent values
- Fixes malformed wiki-links

**Visibility**: Always available.

---

### Copy Label to Aliases

**Command ID**: `copy-label-to-aliases`
**Button**: "Copy Label to Aliases"
**Keyboard**: Cmd/Ctrl + P → "Copy Label to Aliases"

**Purpose**: Sync `exo__Asset_label` to Obsidian `aliases` property.

**Updates**:
```yaml
exo__Asset_label: "My Task"
aliases:
  - "My Task"
```

**Use case**: Improve search/linking with Obsidian's built-in alias system.

**Visibility**: Available on assets with `exo__Asset_label`.

---

### Rename to UID

**Command ID**: `rename-to-uid`
**Button**: "Rename to UID"
**Keyboard**: Cmd/Ctrl + P → "Rename to UID"

**Purpose**: Rename file to match UID property.

**Example**: `My Task.md` → `task-abc123.md`

**Use case**: Standardize filenames for consistency.

**Behavior**:
- Renames file: `old-name.md` → `{exo__Asset_uid}.md`
- Updates `exo__Asset_label` if missing (uses old filename)
- For **non-archived assets**: Adds old filename to `aliases` for searchability
- For **archived assets** (`exo__Asset_isArchived: true` or `archived: true`): Does NOT add aliases (reduces namespace clutter)

**Visibility**: Available on notes with UID property.

---

### Repair Folder

**Command ID**: `repair-folder`
**Keyboard**: Cmd/Ctrl + P → "Repair Folder"

**Purpose**: Fix folder structure and file locations.

**Actions**:
- Moves files to correct folders based on class
- Fixes missing folder structure
- Reports moved files

**Visibility**: Always available.

---

### Convert Task to Project

**Command ID**: `convert-task-to-project`
**Button**: "Convert to Project"
**Keyboard**: Cmd/Ctrl + P → "Convert Task to Project"

**Purpose**: Upgrade task to project (when scope grows).

**Updates**:
```yaml
exo__Instance_class: ems__Project
# Removes task-specific properties
# Keeps area, status, label
```

**Visibility**: Available on `ems__Task`.

---

### Convert Project to Task

**Command ID**: `convert-project-to-task`
**Button**: "Convert to Task"
**Keyboard**: Cmd/Ctrl + P → "Convert Project to Task"

**Purpose**: Downgrade project to task (when scope reduces).

**Updates**:
```yaml
exo__Instance_class: ems__Task
# Adds task-specific properties if needed
```

**Visibility**: Available on `ems__Project`.

---

## View Commands

Commands for controlling layout display.

### Toggle Layout Visibility

**Command ID**: `toggle-layout-visibility`
**Button**: "Toggle Layout"
**Keyboard**: Cmd/Ctrl + P → "Toggle Layout Visibility"

**Purpose**: Show/hide entire Exocortex layout.

**Use case**: Temporarily hide layout for cleaner note view.

**Visibility**: Always available (in Reading Mode).

---

### Toggle Properties Visibility

**Command ID**: `toggle-properties-visibility`
**Button**: "Toggle Properties"
**Keyboard**: Cmd/Ctrl + P → "Toggle Properties Visibility"

**Purpose**: Show/hide Properties Table section.

**Use case**: Hide properties when focusing on other sections.

**Visibility**: Always available (in Reading Mode).

---

### Toggle Archived Assets Visibility

**Command ID**: `toggle-archived-assets-visibility`
**Button**: "Show/Hide Archived" (in Daily Tasks and Daily Projects tables)
**Keyboard**: Cmd/Ctrl + P → "Exocortex: Toggle archived assets visibility"

**Purpose**: Toggle visibility of archived assets across all layout tables.

**What are "Archived Assets"?**

Assets (tasks, projects) can be marked as archived in two ways:
```yaml
exo__Asset_isArchived: true
# or
archived: true
```

Archived assets represent completed or inactive items that you want to keep for reference but hide from active views.

**Effect**:
- **When OFF (default)**: Archived assets are hidden from:
  - Daily Tasks table
  - Daily Projects table
  - Asset Relations table
- **When ON**: Archived assets are shown with:
  - Reduced opacity (greyed out styling)
  - Full functionality preserved

**Notification**: Shows "Archived assets shown" or "Archived assets hidden" after toggle.

**Persisted**: Setting saves to plugin configuration and persists across sessions.

**Use cases**:
- **Daily planning**: Hide completed tasks to focus on active work
- **Review mode**: Show archived to review past completions
- **Cleanup**: Identify archived items that can be permanently deleted

**Alternative Access**:
- Settings → Exocortex → "Show Archived Assets" toggle
- "Show/Hide Archived" button in Daily Tasks and Daily Projects tables

**Visibility**: Always available via Command Palette.

---

### Reload Layout

**Command ID**: `reload-layout`
**Button**: "Reload Layout"
**Keyboard**: Cmd/Ctrl + P → "Reload Layout"

**Purpose**: Force refresh of Exocortex layout.

**Use case**:
- After bulk changes to frontmatter
- If layout appears stale
- Troubleshooting display issues

**Visibility**: Always available (in Reading Mode).

---

## Utility Commands

Special-purpose commands.

### Edit Properties

**Command ID**: `edit-properties`
**Keyboard**: Cmd/Ctrl + P → "Edit Properties"

**Purpose**: Open a dedicated modal for editing frontmatter properties of the current note.

**Usage**:
1. Open any note with frontmatter
2. Cmd/Ctrl + P → "Edit Properties"
3. Modal shows all editable properties for the note's class
4. Modify values using appropriate field types (text, datetime, toggles)
5. Click Save to apply changes

**Features**:
- Class-aware property display (shows relevant properties for the note type)
- Type-specific editors (datetime picker, text input, toggles)
- Wiki-link property support
- Validation before save
- Layout auto-refresh after save

**Visibility**: Available on notes with frontmatter.

---

### Open Query Builder

**Command ID**: `open-query-builder`
**Button**: "Open Query Builder"
**Keyboard**: Cmd/Ctrl + P → "Open Query Builder"

**Purpose**: Open visual SPARQL query builder interface.

**Usage**:
1. Cmd/Ctrl + P → "Open Query Builder"
2. Build SPARQL query visually
3. Copy generated query to markdown

**See**: [SPARQL Query Builder Guide](sparql/User-Guide.md#query-builder)

**Visibility**: Always available.

---

## Command Quick Reference Table

| Command | Category | Keyboard Shortcut | Button Available |
|---------|----------|-------------------|------------------|
| Create Task | Creation | Cmd/Ctrl+P | Yes (Project/Daily) |
| Create Related Task | Creation | Cmd/Ctrl+P | Yes (Task) |
| Create Project | Creation | Cmd/Ctrl+P | Yes (Area) |
| Create Instance | Creation | Cmd/Ctrl+P | No |
| Create Fleeting Note | Creation | Cmd/Ctrl+P | Yes |
| Add Supervision | Creation | Cmd/Ctrl+P | Yes |
| Set Draft Status | Status | Cmd/Ctrl+P | Yes |
| Move to Backlog | Status | Cmd/Ctrl+P | Yes |
| Move to Analysis | Status | Cmd/Ctrl+P | Yes |
| Move to ToDo | Status | Cmd/Ctrl+P | Yes |
| Start Effort | Status | Cmd/Ctrl+P | Yes |
| Mark Done | Status | Cmd/Ctrl+P | Yes |
| Plan on Today | Planning | Cmd/Ctrl+P | Yes |
| Plan for Evening | Planning | Cmd/Ctrl+P | Yes |
| Shift Day Forward | Planning | Cmd/Ctrl+P | Yes (▶) |
| Shift Day Backward | Planning | Cmd/Ctrl+P | Yes (◀) |
| Set Focus Area | Planning | Cmd/Ctrl+P | Yes (Daily) |
| Archive Task | Maintenance | Cmd/Ctrl+P | Yes |
| Trash Effort | Maintenance | Cmd/Ctrl+P | Yes |
| Vote on Effort | Maintenance | Cmd/Ctrl+P | Yes |
| Clean Properties | Maintenance | Cmd/Ctrl+P | Yes |
| Copy Label to Aliases | Maintenance | Cmd/Ctrl+P | Yes |
| Rename to UID | Maintenance | Cmd/Ctrl+P | Yes |
| Repair Folder | Maintenance | Cmd/Ctrl+P | No |
| Convert Task to Project | Maintenance | Cmd/Ctrl+P | Yes |
| Convert Project to Task | Maintenance | Cmd/Ctrl+P | Yes |
| Toggle Layout Visibility | View | Cmd/Ctrl+P | Yes |
| Toggle Properties Visibility | View | Cmd/Ctrl+P | Yes |
| Toggle Archived Assets Visibility | View | Cmd/Ctrl+P | Yes |
| Reload Layout | View | Cmd/Ctrl+P | Yes |
| Edit Properties | Utility | Cmd/Ctrl+P | No |
| Open Query Builder | Utility | Cmd/Ctrl+P | Yes |

---

## Command Visibility Rules

Commands appear contextually based on note type and state:

### By Note Class

| Note Class | Available Commands |
|------------|-------------------|
| `ems__Task` | Create Related Task, Status commands, Planning commands, Convert to Project |
| `ems__Project` | Create Task, Status commands, Planning commands, Convert to Task |
| `ems__Area` | Create Project |
| `pn__DailyNote` | Create Task, Set Focus Area |
| Any (with frontmatter) | Edit Properties |
| Any | Clean Properties, Reload Layout, Open Query Builder, Toggle Archived Assets Visibility |

### By Status

| Current Status | Available Status Commands |
|----------------|--------------------------|
| Draft | Move to Backlog, Archive |
| Backlog | Move to Analysis, Archive |
| Analysis | Move to ToDo, Move to Backlog |
| ToDo | Start Effort, Move to Analysis |
| Doing | Mark Done, Move to ToDo |
| Done | Archive |

### By Properties

| Property | Required Commands |
|----------|-------------------|
| `ems__Effort_day` | Shift Day Forward/Backward |
| `exo__Asset_label` | Copy Label to Aliases |
| UID property | Rename to UID |
| Not archived | Archive Task |

---

## Troubleshooting Commands

| Problem | Solution Command |
|---------|------------------|
| Layout not updating | Reload Layout |
| Wrong folder | Repair Folder |
| Empty properties | Clean Properties |
| Alias mismatch | Copy Label to Aliases |
| Button missing | Check command visibility rules |

---

**See also**:
- [Getting Started Guide](Getting-Started.md)
- [Task Workflow](workflows/Task-Workflow.md)
- [Project Workflow](workflows/Project-Workflow.md)
