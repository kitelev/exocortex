# Exocortex Obsidian Plugin

**A comprehensive task management system for Obsidian with automatic layout rendering, hierarchical organization, and effort tracking.**


[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/kitelev/exocortex-obsidian-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/kitelev/exocortex-obsidian-plugin/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-5700%2B-success)](https://github.com/kitelev/exocortex-obsidian-plugin/actions)
[![Coverage](https://img.shields.io/badge/coverage-80%25-brightgreen)](https://github.com/kitelev/exocortex-obsidian-plugin/actions/workflows/ci.yml)
[![Test Pyramid](https://img.shields.io/badge/pyramid-healthy-brightgreen)](./TESTING.md#test-pyramid-policy)

## 🎯 What is Exocortex?

Exocortex is a powerful Obsidian plugin that transforms your notes into an interconnected task management and knowledge organization system. It automatically displays related notes, tracks effort across projects, manages task workflows with status transitions, and visualizes hierarchical relationships - all within your existing notes in reading mode.

### Key Features

- 📊 **Automatic Layout Rendering**: Context-aware sections displayed below metadata in reading mode
- 🎯 **Daily Task Planning**: Aggregate all tasks scheduled for specific days with active focus filtering
- 🌳 **Area Hierarchy Visualization**: Interactive collapsible tree showing organizational structure
- 🔄 **Effort Status Workflow**: Complete lifecycle from Draft → Backlog → Analysis → ToDo → Doing → Done
- ⏱️ **Automatic Time Tracking**: Timestamps recorded when efforts start and complete
- 🗳️ **Effort Voting System**: Collaborative prioritization through vote counts
- 🏷️ **Smart Properties Display**: All frontmatter in organized tables with wiki-link resolution
- 🔗 **Bidirectional Relations**: See all notes referencing current note, grouped by property
- ↕️ **Interactive Sorting**: Click table headers to sort with visual indicators (▲/▼)
- 📦 **Archive Filtering**: Toggle visibility of archived tasks and projects in DailyNote layouts (default: hidden)
- ⚡ **High Performance**: O(1) relation lookups via reverse indexing
- 📱 **Mobile Compatible**: Full touch-optimized UI for desktop and mobile
- ⌨️ **32 Commands**: Comprehensive command palette integration for all operations
- 🎨 **Action Buttons**: Context-aware UI buttons for quick access to relevant commands
- 🔍 **SPARQL Query Blocks**: Execute semantic queries directly in markdown with `sparql` code blocks - results auto-refresh on vault changes

## 📦 Monorepo Structure

This project is organized as a monorepo with multiple packages:

```
packages/
├── core/                    # exocortex - Shared business logic (storage-agnostic)
├── obsidian-plugin/         # @exocortex/obsidian-plugin - Obsidian UI integration
└── cli/                     # @exocortex/cli - Command-line automation tool
```

### Package Comparison

| Feature | Obsidian Plugin | CLI |
|---------|----------------|-----|
| **Primary Use** | Interactive UI in Obsidian | Terminal automation & scripting |
| **Installation** | Obsidian plugin manager | `npm install -g @exocortex/cli` |
| **Task Management** | ✅ Visual buttons & commands | ✅ All status transitions |
| **SPARQL Queries** | ✅ Live results in notes | ✅ Table/JSON/CSV output |
| **Asset Creation** | ✅ Modal dialogs | ✅ Command-line flags |
| **Batch Operations** | ❌ One at a time | ✅ Atomic batch execution |
| **CI/CD Integration** | ❌ Requires Obsidian | ✅ Headless execution |
| **MCP/AI Agent Integration** | ❌ N/A | ✅ JSON output, exit codes |

### CLI Package Overview

The CLI (`@exocortex/cli`) enables managing your Exocortex vault from the terminal without opening Obsidian. It's ideal for:

- **Automation scripts** - Schedule tasks, update statuses, create assets programmatically
- **CI/CD pipelines** - Integrate vault operations into GitHub Actions, GitLab CI
- **AI agent integration** - MCP-compatible JSON output for Claude, GPT, etc.
- **Batch operations** - Execute multiple commands atomically

**CLI Installation:**

```bash
# Global installation
npm install -g @exocortex/cli

# Or use directly with npx
npx @exocortex/cli --help
```

**CLI Command Categories:**

| Category | Commands | Description |
|----------|----------|-------------|
| **SPARQL** | `sparql query` | Execute SPARQL 1.1 queries with table/JSON/CSV output |
| **Status** | `start`, `complete`, `trash`, `archive`, `move-to-*` | Full task lifecycle management |
| **Creation** | `create-task`, `create-meeting`, `create-project`, `create-area` | Create assets with frontmatter |
| **Planning** | `schedule`, `set-deadline` | Set dates for efforts |
| **Maintenance** | `rename-to-uid`, `update-label` | File and property management |
| **Batch** | `batch` | Execute multiple operations atomically |

**Quick Examples:**

```bash
# Execute SPARQL query
exocortex sparql query "SELECT ?task ?label WHERE { ?task exo:Instance_class ems:Task . ?task exo:Asset_label ?label }" --vault ~/vault

# Complete a task
exocortex command complete "tasks/my-task.md" --vault ~/vault

# Create a new task
exocortex command create-task "tasks/new-task.md" --label "Implement feature" --vault ~/vault

# Batch operations (atomic)
exocortex batch --input '[{"command":"start","filepath":"task1.md"},{"command":"complete","filepath":"task2.md"}]' --vault ~/vault --atomic
```

For complete CLI documentation, see:
- [CLI Command Reference](./docs/cli/Command-Reference.md)
- [Scripting Patterns](./docs/cli/Scripting-Patterns.md)
- [Integration Examples](./docs/cli/Integration-Examples.md)

The monorepo structure enables:
- Shared core logic between UI and CLI
- Independent versioning per package
- Clear separation of concerns (business logic vs UI vs automation)

## 🏃‍♂️ Quick Start

### Installation

**Manual Installation**:
```bash
cd /your/vault/.obsidian/plugins
git clone https://github.com/kitelev/exocortex-obsidian-plugin
cd exocortex-obsidian-plugin
npm install && npm run build
```

Enable the plugin in Obsidian Settings → Community plugins → Exocortex.

### Basic Usage

The plugin automatically renders a dynamic layout below the metadata section in reading mode. The layout is context-aware and shows different sections based on the current note's class type and properties.

**Layout Sections** (rendered in order):

1. **Properties Table** - All frontmatter properties with wiki-link resolution
2. **Action Buttons** - Context-aware buttons grouped by function (Creation, Status, Planning, Maintenance)
3. **Daily Tasks** (pn__DailyNote only) - All tasks scheduled for this date with optional focus filtering
4. **Daily Projects** (pn__DailyNote only) - All projects scheduled for this date
5. **Area Hierarchy Tree** (ems__Area only) - Interactive tree of parent-child area relationships
6. **Asset Relations** - All notes referencing this note, grouped by property

### Example Workflow: Managing a Project

1. **Create an Area** for the project domain:
```yaml
---
exo__Instance_class: ems__Area
exo__Asset_label: Development
---
```

2. **Create a Project** within the area:
```yaml
---
exo__Instance_class: ems__Project
exo__Asset_label: Build New Feature
ems__Effort_area: "[[Development]]"
ems__Effort_status: "[[ems__EffortStatusBacklog]]"
---
```

3. **Create Tasks** under the project using the "Create Task" button
4. **Vote on efforts** to prioritize work: Click "Vote" button or use Command Palette
5. **Plan tasks** for specific days: Click "Plan on Today" or shift days with ◀/▶ buttons
6. **Execute workflow**: Move through statuses (Backlog → Analysis → ToDo → Doing → Done)
7. **View daily plan**: Open today's daily note to see all scheduled tasks with area context

## 📋 Available Commands

All commands accessible via Command Palette (Cmd/Ctrl+P → "Exocortex:"). Commands are context-aware and only appear when applicable to the current note.

### Creation Commands (5)

| Command | Available When | Creates | Inherited Properties |
|---------|---------------|---------|---------------------|
| **Create Task** | ems__Area, ems__Project | ems__Task | Parent reference, area, prototype |
| **Create Project** | ems__Area, ems__Initiative, ems__Project | ems__Project | Area, initiative reference |
| **Create Instance** | ems__TaskPrototype, ems__MeetingPrototype, exo__EventPrototype | ems__Task, ems__Meeting, or exo__Event | Prototype template content |
| **Create Fleeting Note** | Always available | Quick-capture note in 01 Inbox | Label from prompt |
| **Create Related Task** | ems__Project | ems__Task with project parent | Parent project, area |

### Status Transition Commands (7)

Complete workflow lifecycle with automatic timestamp tracking:

| Command | Available When | Transition | Timestamps Updated |
|---------|---------------|-----------|-------------------|
| **Set Draft Status** | Efforts with no status | → Draft | - |
| **Move to Backlog** | Draft status | Draft → Backlog | - |
| **Move to Analysis** | ems__Project with Backlog | Backlog → Analysis | - |
| **Move to ToDo** | Analysis status | Analysis → ToDo | - |
| **Start Effort** | ToDo status | ToDo → Doing | ems__Effort_startTimestamp |
| **Mark as Done** | Doing status | Doing → Done | ems__Effort_endTimestamp, ems__Effort_resolutionTimestamp |
| **Trash** | Any effort | Any → Trashed | ems__Effort_endTimestamp |

### Planning Commands (6)

Schedule and prioritize efforts:

| Command | Available When | Action | Property Modified |
|---------|---------------|--------|-------------------|
| **Plan on Today** | Any active effort | Set effort for today | ems__Effort_day |
| **Plan for Evening** | Task/Meeting with Backlog | Schedule for 19:00 | ems__Effort_plannedStartTimestamp |
| **Shift Day ◀** | Efforts with day set | Move to previous day | ems__Effort_day |
| **Shift Day ▶** | Efforts with day set | Move to next day | ems__Effort_day |
| **Vote on Effort** | Task/Project (not archived) | Increment vote counter | ems__Effort_votes |
| **Set Focus Area** | Always available | Focus daily tasks on area + children | Plugin settings (activeFocusArea) |

### Maintenance Commands (5)

Keep your vault organized:

| Command | Available When | Action |
|---------|---------------|--------|
| **Clean Empty Properties** | Any asset | Remove null/empty frontmatter properties |
| **Repair Folder** | Assets with exo__Asset_isDefinedBy | Move file to correct folder based on reference |
| **Rename to UID** | Filename ≠ exo__Asset_uid | Rename file to match UID, preserve label |
| **Archive Task** | Tasks/Projects | Set exo__Asset_isArchived to true |
| **Copy Label to Aliases** | Assets with exo__Asset_label | Copy label to YAML aliases array |

### Conversion Commands (2)

Convert between asset types:

| Command | Available When | Action |
|---------|---------------|--------|
| **Convert Task to Project** | ems__Task | Change class to ems__Project, preserve properties |
| **Convert Project to Task** | ems__Project | Change class to ems__Task, preserve properties |

### System Commands (7)

Control plugin behavior and visualization:

| Command | Always Available | Action |
|---------|-----------------|--------|
| **Reload Layout** | Yes | Manually refresh layout rendering |
| **Add Supervision** | Yes | Create CBT diary record (structured fleeting note with situation/emotions/thoughts/behavior) |
| **Toggle Layout Visibility** | Yes | Show/hide entire layout section |
| **Toggle Properties Visibility** | Yes | Show/hide properties table |
| **Toggle Archived Assets Visibility** | Yes | Show/hide archived assets in layout tables (persists in settings) |
| **Edit Properties** | With frontmatter | Open modal for editing frontmatter properties |
| **Open SPARQL Query Builder** | Yes | Visual query builder with templates, live preview, and copy-to-clipboard |

## 🏷️ Frontmatter Properties Reference

### Asset Core Properties (exo__Asset_*)

Foundation properties for all assets:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `exo__Instance_class` | Wiki-link(s) | Yes | Asset class type(s): ems__Task, ems__Project, ems__Area, etc. |
| `exo__Asset_uid` | UUID string | Recommended | Unique identifier, used for filename consistency |
| `exo__Asset_label` | String | Recommended | Human-readable display name |
| `exo__Asset_isDefinedBy` | Wiki-link | Optional | Reference to area/container for folder organization |
| `exo__Asset_relates` | List of wiki-links | Optional | Related assets for cross-referencing |
| `exo__Asset_isArchived` | Boolean | Optional | Mark asset as archived (alternative to `archived`) |

### Effort Tracking Properties (ems__Effort_*)

Complete lifecycle tracking for tasks and projects:

| Property | Type | Set By | Description |
|----------|------|--------|-------------|
| `ems__Effort_status` | Wiki-link enum | Status commands | Current workflow status (see Status Values below) |
| `ems__Effort_day` | Wiki-link date | Planning commands | Scheduled day: [[YYYY-MM-DD]] |
| `ems__Effort_startTimestamp` | ISO 8601 | "Start Effort" command | When effort moved to Doing status |
| `ems__Effort_endTimestamp` | ISO 8601 | "Mark Done"/"Trash" | When effort completed/cancelled |
| `ems__Effort_resolutionTimestamp` | ISO 8601 | Auto-synced | Copy of endTimestamp for tracking |
| `ems__Effort_plannedStartTimestamp` | ISO 8601 | "Plan Evening" command | Evening planning timestamp (19:00) |
| `ems__Effort_votes` | Integer | "Vote on Effort" command | Vote counter for prioritization |
| `ems__Effort_parent` | Wiki-link | Task creation | Parent project/effort reference |
| `ems__Effort_area` | Wiki-link | Task creation | Organizational area reference |
| `exo__Asset_prototype` | Wiki-link | Instance creation | Template prototype reference |

**Status Values** (ems__EffortStatus* enum):

- `[[ems__EffortStatusDraft]]` - Initial status, no planning
- `[[ems__EffortStatusBacklog]]` - Ready for analysis/planning
- `[[ems__EffortStatusAnalysis]]` - Under analysis (projects only)
- `[[ems__EffortStatusToDo]]` - Ready to start
- `[[ems__EffortStatusDoing]]` - Currently in progress (startTimestamp recorded)
- `[[ems__EffortStatusDone]]` - Completed successfully (endTimestamp recorded)
- `[[ems__EffortStatusTrashed]]` - Discarded/cancelled (endTimestamp recorded)

### Organizational Properties

| Property | Type | Used For | Description |
|----------|------|----------|-------------|
| `ems__Area_parent` | Wiki-link | ems__Area | Parent area for hierarchy tree visualization |
| `pn__DailyNote_day` | Wiki-link date | pn__DailyNote | Daily note date link: [[YYYY-MM-DD]] |

### Archive Property

| Property | Type | Values | Description |
|----------|------|--------|-------------|
| `archived` | Boolean/String | `true`, `"yes"`, `1` | Standard YAML archive flag (alternative to exo__Asset_isArchived) |

## 📊 Layout Sections

### Properties Table

Displays all frontmatter properties in a clean key-value format with inline editing capabilities.

**Features:**
- Wiki-links automatically resolved to display labels
- Clickable internal links for navigation
- Supports alias display: `[[target|alias]]`
- Toggle visibility via settings or "Toggle Properties Visibility" command
- **Inline property editing** for DateTime and Text properties (enabled by default)

#### Editable Properties

The Properties block supports inline editing for multiple property types:

**DateTime Properties:**
- Click the calendar icon (📅) to open a dropdown picker
- Select date and time using native HTML5 datetime-local input
- Displays in user-friendly format: "Jan 15, 2025, 10:30 AM" or "Jan 15, 2025" (date-only)
- Click "Clear" button to remove the property value
- Changes save automatically to frontmatter

**Text Properties:**
- Click any text property to edit inline
- Type to modify, press Enter to save, Escape to cancel
- Empty values automatically remove the property
- Changes save automatically on blur (clicking away)

**Auto-Detection:**
Properties are automatically detected as editable based on their values:
- ISO 8601 datetime strings → DateTime editor (e.g., `2025-01-15T10:30:00.000Z`)
- Plain text strings → Text editor
- Other types (numbers, booleans, wiki-links, arrays) → Read-only display

**Example:**
```
Key                      | Value
-------------------------|-----------------
exo__Instance_class      | ems__Task
exo__Asset_label         | Implement feature (editable)
ems__Effort_status       | ems__EffortStatusDoing
ems__Effort_day          | 📅 Jan 15, 2025 (click to edit)
ems__Effort_votes        | 5
```

### Action Buttons

Context-aware buttons grouped by semantic function, displayed above other sections.

**Button Groups:**

1. **Creation** - Create Task, Create Project, Create Instance, Create Area
2. **Status** - Set Draft, Move to Backlog, Move to Analysis, Move to ToDo, Start Effort, Mark Done, Trash, Rollback Status
3. **Planning** - Plan on Today, Plan Evening, Shift Day ◀, Shift Day ▶, Vote on Effort, Set Active Focus
4. **Maintenance** - Clean Properties, Repair Folder, Rename to UID

Buttons only appear when applicable to the current note's class and state.

### Daily Tasks Table

Visible **only** on notes with `exo__Instance_class: pn__DailyNote`.

Aggregates all tasks where `ems__Effort_day` matches the daily note's date.

**Columns:**
- Task Name (clickable)
- Status (with visual indicators)
- Effort Area (toggleable via "Show/Hide Effort Area" button)
- Votes (toggleable via "Show/Hide Votes" button - displays `ems__Effort_votes` property)
- Effort Parent (project/initiative)

**Control Buttons:**
- "Show/Hide Effort Area" - Toggle Effort Area column visibility
- "Show/Hide Votes" - Toggle Votes column visibility
- "Show/Hide Archived" - Filter archived tasks (based on `exo__Asset_isArchived` property, default: hidden)

**Active Focus Feature:**
When an area is set as "Active Focus" using the "Set Active Focus" button:
- Daily tasks filtered to show only tasks from that area
- Indicator displays: "🎯 Active Focus: [Area Name]"
- Click "Clear Active Focus" to remove filter

**Example:**
```
🎯 Active Focus: Development

Task Name              | Status      | Area        | Votes | Parent
-----------------------|-------------|-------------|-------|-------------
Implement API          | Doing       | Development | 5     | Backend Project
Write tests            | ToDo        | Development | 3     | Backend Project
```

### Daily Projects Table

Visible **only** on notes with `exo__Instance_class: pn__DailyNote`.

Shows all projects scheduled for the daily note's date (via `ems__Effort_day`).

**Columns:**
- Project Name (clickable)
- Start Time
- End Time
- Status (with visual indicators)

**Control Buttons:**
- "Show/Hide Archived" - Filter archived projects (based on `exo__Asset_isArchived` property, default: hidden)

### Area Hierarchy Tree

Visible **only** on notes with `exo__Instance_class: ems__Area`.

Interactive tree visualization of area parent-child relationships defined through `ems__Area_parent` property.

**Features:**
- **Collapsible/Expandable**: Click ▶/▼ icons to toggle child areas
- **Current Area Highlighting**: Current area shown with accent color background
- **Archived Area Styling**: Archived areas displayed with reduced opacity
- **Clickable Navigation**: Click any area name to navigate to that note
- **Keyboard Support**: Arrow keys to navigate, Enter to open
- **Automatic Root Detection**: Tree always starts from top-level parent area
- **Full Depth Display**: Shows complete hierarchy regardless of depth

**Example hierarchy:**
```
▼ Projects (root)
  ▼ Development
    ▶ Frontend
    ▼ Backend
      → API Development (current)
      → Database Design
  ▶ Research
  ▶ Documentation
```

**Setup:**
```yaml
---
exo__Instance_class: ems__Area
exo__Asset_label: API Development
ems__Area_parent: "[[Backend]]"
---
```

The tree automatically builds the complete hierarchy from all areas in the vault, traversing parent references to find the root.

### Asset Relations Table

Shows all notes that reference the current note through properties or body links.

**Columns:**
- Name (clickable)
- Instance Class
- Grouped properties (shows property values that reference this note)

**Features:**
- **Grouped by Property**: Relations organized by which property references this note (ems__Effort_parent, ems__Effort_area, etc.)
- **Body Link Detection**: Distinguishes between property references and body content links
- **Sortable Columns**: Click headers to sort with ▲/▼ indicators
- **Archive Filtering**: Toggle archived asset visibility via settings
- **Performance**: O(1) lookups via reverse index cache

**Example:**
For a Project note, relations might show:
- Tasks where `ems__Effort_parent` links to this project
- Areas where this project is mentioned in body content
- Other projects with cross-references

## 🔍 SPARQL Query System

Execute powerful semantic queries directly in your notes using SPARQL, the W3C standard query language for RDF data. Query results auto-refresh when your vault changes.

**NEW**: Supports standard RDF/RDFS vocabulary (`rdf:type`, `rdfs:subClassOf*`, etc.) for semantic web interoperability and inference queries alongside custom ExoRDF predicates. See [SPARQL Documentation](docs/sparql/User-Guide.md) for RDF/RDFS mapping details.

### Quick Start

Create a `sparql` code block in any note:

````markdown
```sparql
SELECT ?task ?label ?status
WHERE {
  ?task <http://exocortex.ai/ontology#Instance_class> "ems__Task" .
  ?task <http://exocortex.ai/ontology#Asset_label> ?label .
  ?task <http://exocortex.ai/ontology#Task_status> ?status .
}
LIMIT 10
```
````

**Results appear live below the code block** with:
- Interactive table/list/graph views
- Export to CSV, JSON, or Turtle formats
- Automatic updates when vault content changes
- Error highlighting with syntax hints

### Visual Query Builder

Open the **SPARQL Query Builder** from the command palette (`Cmd/Ctrl+P` → "Open SPARQL Query Builder") for an interactive query building experience:

- **15+ Ready-to-Use Templates**: Pre-built queries for common tasks (all assets, active tasks, project hierarchy, etc.)
- **Category Filtering**: Browse templates by Basic, Tasks, Projects, Relationships, Time-Based, and Aggregations
- **Live Preview**: See results immediately as you select templates or edit queries
- **Copy to Clipboard**: One-click copy of generated SPARQL code for use in code blocks
- **Custom Query Editing**: Full SPARQL editor with syntax support

Perfect for users new to SPARQL or those who want quick access to common query patterns.

### Common Query Patterns

**Find all tasks in a project:**
```sparql
SELECT ?task ?taskLabel
WHERE {
  ?task <http://exocortex.ai/ontology#belongs_to_project> <vault://Projects/My-Project.md> .
  ?task <http://exocortex.ai/ontology#Asset_label> ?taskLabel .
}
```

**Count tasks by status:**
```sparql
SELECT ?status (COUNT(?task) AS ?count)
WHERE {
  ?task <http://exocortex.ai/ontology#Instance_class> "ems__Task" .
  ?task <http://exocortex.ai/ontology#Task_status> ?status .
}
GROUP BY ?status
ORDER BY DESC(?count)
```

**Find high-priority tasks:**
```sparql
SELECT ?task ?label ?votes
WHERE {
  ?task <http://exocortex.ai/ontology#Instance_class> "ems__Task" .
  ?task <http://exocortex.ai/ontology#Asset_label> ?label .
  ?task <http://exocortex.ai/ontology#Effort_votes> ?votes .
  FILTER(?votes > 5)
}
ORDER BY DESC(?votes)
```

### Developer API

Access SPARQL programmatically from other plugins:

```typescript
const plugin = this.app.plugins.getPlugin("exocortex");
const result = await plugin.sparql.query(`
  SELECT ?task ?label
  WHERE {
    ?task <http://exocortex.ai/ontology#Instance_class> "ems__Task" .
    ?task <http://exocortex.ai/ontology#Asset_label> ?label .
  }
`);

console.log(`Found ${result.count} tasks`);
result.bindings.forEach(binding => {
  const label = binding.get("label")?.value;
  console.log(label);
});
```

**API Methods:**
- `await sparql.query(queryString)` - Execute SELECT query
- `sparql.getTripleStore()` - Access raw triple store
- `await sparql.refresh()` - Force re-index vault
- `await sparql.dispose()` - Cleanup (on plugin unload)

### Documentation

**Learn SPARQL**:
- 📖 [User Guide](./docs/sparql/User-Guide.md) - Complete SPARQL tutorial for Obsidian
- 💡 [30+ Query Examples](./docs/sparql/Query-Examples.md) - Ready-to-use query patterns
- ⚡ [Performance Tips](./docs/sparql/Performance-Tips.md) - Optimize queries for large vaults
- 🔧 [Developer Guide](./docs/sparql/Developer-Guide.md) - Extend SPARQL functionality
- 🌐 [ExoRDF to RDF/RDFS Mapping](./docs/rdf/ExoRDF-Mapping.md) - Semantic interoperability specification

**Quick Tips**:
- Use `LIMIT` to avoid overwhelming results
- Filter by `Instance_class` first for better performance
- Property URIs: `<http://exocortex.ai/ontology#PropertyName>`
- Vault paths: `<vault://path/to/file.md>`

## 🧩 Dynamic Property Fields (Experimental)

Automatically generate asset creation forms based on your RDF ontology definitions. Instead of fixed forms, the plugin reads your ontology to determine which fields should appear when creating assets.

### Key Features

- **Ontology-Driven Forms**: Fields generated from `rdfs:domain` property definitions
- **Property Inheritance**: Child classes inherit properties from parent classes
- **Type-Specific Widgets**: Automatic field type detection based on `rdfs:range`:
  - `xsd:string` → Text input
  - `xsd:dateTime` → DateTime picker
  - `xsd:integer` → Number input
  - `xsd:boolean` → Toggle switch
  - Asset references → Wikilink input
- **Deprecated Property Hiding**: Properties marked `owl:deprecated true` are automatically hidden
- **Graceful Fallback**: Uses basic fields when ontology is unavailable

### Enabling the Feature

1. Open Obsidian Settings
2. Navigate to **Exocortex** section
3. Enable **"Use dynamic property fields"** toggle
4. Create assets using commands like "Create Task" - the modal will show ontology-defined fields

### How It Works

When you invoke a creation command (e.g., "Create Task"):

1. The plugin queries your ontology for properties where `rdfs:domain` matches the target class
2. Traverses class hierarchy via `rdfs:subClassOf` to find inherited properties
3. Filters out deprecated properties
4. Renders appropriate field types based on `rdfs:range`

### Documentation

- **[Dynamic Fields Guide](./docs/DYNAMIC_FIELDS.md)** - Complete feature documentation
- **[Ontology Extension Guide](./docs/ONTOLOGY_EXTENSION.md)** - Add custom properties to your ontology

## ⚙️ Plugin Settings

Access via Settings → Exocortex.

| Setting | Default | Description |
|---------|---------|-------------|
| **Show Layout** | On | Display automatic layout sections in reading mode |
| **Show Properties Section** | On | Include properties table in layout |
| **Show Archived Assets** | Off | Display archived assets in relations table with reduced opacity |
| **Use Dynamic Property Fields** | Off | Generate modal fields from ontology (experimental) |

Additional internal settings:
- **Active Focus Area**: Current focus area for daily tasks filtering (set via "Set Active Focus" button)

## 🗂️ Asset Class Types

Understanding the class hierarchy:

| Class | Purpose | Common Properties |
|-------|---------|------------------|
| **ems__Area** | Organizational container | ems__Area_parent |
| **ems__Project** | Project effort | ems__Effort_status, ems__Effort_area, ems__Effort_votes |
| **ems__Task** | Task effort | ems__Effort_status, ems__Effort_parent, ems__Effort_day |
| **ems__Meeting** | Meeting effort | ems__Effort_status, ems__Effort_plannedStartTimestamp |
| **ems__Initiative** | High-level initiative | Similar to Project |
| **ems__TaskPrototype** | Task template | Used for instance creation |
| **ems__MeetingPrototype** | Meeting template | Used for instance creation |
| **exo__EventPrototype** | Event template | Used for instance creation |
| **exo__Event** | Event instance | ems__Effort_status, exo__Asset_prototype |
| **pn__DailyNote** | Daily planning note | pn__DailyNote_day |
| **ztlk__FleetingNote** | Supervision/fleeting note | Created in 01 Inbox |

## 🔄 Archive Filtering

Hide completed or archived assets to keep views focused on active work.

**Two methods:**

1. **Standard YAML:**
```yaml
---
archived: true  # or "yes", "true", 1
---
```

2. **Exocortex property:**
```yaml
---
exo__Asset_isArchived: true
---
```

**Behavior:**
- Archived assets filtered from relations table by default
- Toggle visibility: Settings → "Show Archived Assets" or Command Palette
- When visible, archived assets shown with reduced opacity
- Archive status considered in command visibility logic

## 🏗️ Architecture

Clean Architecture with domain-driven design organized in a monorepo:

```
┌───────────────────────── Monorepo Packages ─────────────────────────┐
│                                                                       │
│  📦 exocortex                  📦 @exocortex/obsidian-plugin  │
│  (Storage-agnostic logic)            (Obsidian UI)                  │
│  ┌───── Presentation ─────┐          ┌───── Presentation ─────┐     │
│  │ N/A (headless)          │          │ React Components       │     │
│  └─────────────────────────┘          │ Layout Renderers       │     │
│  ┌───── Application ──────┐          │ Tables, Trees, UI      │     │
│  │ Services (14 total)    │          └────────────────────────┘     │
│  │ Command Manager        │                     ↓                    │
│  │ Business Logic         │          Uses exocortex            │
│  └─────────────────────────┘                                         │
│  ┌───── Domain ───────────┐                                          │
│  │ Entities & Rules       │                                          │
│  │ Value Objects          │          📦 @exocortex/cli               │
│  └─────────────────────────┘          (Command-line tool)            │
│  ┌───── Infrastructure ───┐          ┌────────────────────────┐     │
│  │ IFileSystemAdapter     │          │ CLI Commands           │     │
│  │ ObsidianVaultAdapter   │          │ Automation Scripts     │     │
│  │ NodeFsAdapter          │          └────────────────────────┘     │
│  └─────────────────────────┘                     ↓                    │
│                                      Uses exocortex            │
└───────────────────────────────────────────────────────────────────────┘
```

**Key Services:**

| Service | Purpose |
|---------|---------|
| TaskCreationService | Create Task/Meeting assets with inheritance |
| ProjectCreationService | Create Project assets |
| TaskStatusService | Manage effort lifecycle and timestamps |
| EffortVotingService | Handle voting system |
| PropertyCleanupService | Remove empty properties |
| FolderRepairService | Organize files by folder structure |
| RenameToUidService | Synchronize filenames with UIDs |
| AreaHierarchyBuilder | Build area tree structure |
| SupervisionCreationService | Create CBT-format fleeting notes |

**Tech Stack**: TypeScript 4.9+, React 19.2.0, Obsidian API 1.5.0+, ESBuild

## 🚀 Performance

Optimized for large vaults with thousands of notes:

- **Reverse Index**: O(1) relation lookups instead of O(n) vault iteration
- **Smart Caching**: Intelligent cache invalidation on metadata changes only
- **Memory Management**: Proper event listener cleanup prevents memory leaks
- **Race-Free**: Promise-based locking prevents cache race conditions
- **Scroll Preservation**: Maintains scroll position during layout refreshes
- **Lazy Rendering**: Components render only when visible

**Benchmarks:**
- Relation lookup: <1ms for 10,000 notes
- Full layout render: <50ms typical
- Cache invalidation: <10ms on metadata change

## 📊 Quality & Testing

### Quality Gates (Enforced in CI)

All pull requests must pass automated quality gates:

**Code Coverage Thresholds:**
- ✅ Global coverage: ≥38-45% (branches: 38%, functions: 42%, lines: 45%, statements: 44%)
- ✅ Domain layer: ≥78-80% (higher standards for business logic)
- 🎯 Aspirational targets: 70% global / 85% domain

**Test Requirements:**
- ✅ 100% tests passing (unit + component + E2E)
- ✅ BDD scenario coverage ≥80%
- ✅ Type safety (TypeScript strict mode)
- ✅ Linting (ESLint)
- ✅ Build success

**Coverage Reports:**
- Automatically generated on every CI run
- Available as artifacts in GitHub Actions
- Includes lcov, HTML, and text-summary formats

### Test Suite

- **Unit Tests**: 10 suites, 269 tests (jest + ts-jest)
- **Component Tests**: 8 Playwright CT tests
- **E2E Tests**: 6 Docker-based integration tests
- **Total Execution**: ~8 seconds (unit) + ~3 minutes (E2E)

## 🛠️ Development

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/kitelev/exocortex-obsidian-plugin
cd exocortex-obsidian-plugin

# Install dependencies (monorepo root installs all packages)
npm install

# Build all packages
npm run build

# Build specific package
npm run build --workspace=@exocortex/obsidian-plugin

# Start development mode (watch mode for plugin)
npm run dev --workspace=@exocortex/obsidian-plugin

# Or use shorthand from root
npm run dev
```

### Development Standards

- **TypeScript**: Strict mode with comprehensive type safety
- **Performance First**: Memory-conscious development
- **Testing**: BDD with jest-cucumber + Playwright Component Testing
- **Clean Architecture**: Domain-driven design with SOLID principles

### Running Tests

```bash
# All tests (required before PR)
npm run test:all

# Individual test suites
npm run test:unit       # Unit tests (jest)
npm run test:ui         # UI integration tests
npm run test:component  # Component tests (Playwright)
npm run test:e2e:local  # E2E tests (Docker required)

# Coverage reports
npm run test:coverage

# BDD coverage check
npm run bdd:coverage
npm run bdd:check       # Enforced in CI (≥80%)

# Build verification
npm run build
```

## 📚 Documentation

### Getting Started

New to Exocortex? Start here:

- **[Getting Started Guide](./docs/Getting-Started.md)** - Step-by-step tutorial from installation to first workflow
- **[Command Reference](./docs/Command-Reference.md)** - Complete documentation of all 32 commands

### Workflow Guides

Learn common patterns and best practices:

- **[Task Workflow](./docs/workflows/Task-Workflow.md)** - Complete task lifecycle from creation to completion
- **[Project Workflow](./docs/workflows/Project-Workflow.md)** - Managing multi-task initiatives
- **[Daily Planning](./docs/workflows/Daily-Planning.md)** - Organize your day with daily notes
- **[Area Organization](./docs/workflows/Area-Organization.md)** - Structure knowledge domains hierarchically
- **[Effort Voting](./docs/workflows/Effort-Voting.md)** - Collaborative prioritization system

### SPARQL Queries

Execute semantic queries on your knowledge base:

- **[SPARQL User Guide](./docs/sparql/User-Guide.md)** - Complete tutorial for writing queries
- **[Query Examples](./docs/sparql/Query-Examples.md)** - 30+ ready-to-use query patterns
- **[Performance Tips](./docs/sparql/Performance-Tips.md)** - Optimize queries for large vaults
- **[Developer Guide](./docs/sparql/Developer-Guide.md)** - Extend SPARQL functionality

### CLI Commands

Automate Exocortex workflows from the command line:

- **[Command Reference](./docs/cli/Command-Reference.md)** - Complete syntax for all 15 CLI commands
- **[Scripting Patterns](./docs/cli/Scripting-Patterns.md)** - Bash automation examples and batch operations
- **[Integration Examples](./docs/cli/Integration-Examples.md)** - CI/CD workflows with GitHub Actions and GitLab
- **[Troubleshooting](./docs/cli/Troubleshooting.md)** - Common errors and debugging techniques

### Developer Documentation

For plugin developers and contributors:

- **[Core API Reference](./docs/api/Core-API.md)** - exocortex package documentation
- **[Plugin Development Guide](./docs/Plugin-Development-Guide.md)** - Extend Exocortex with custom functionality
- **[TESTING.md](./TESTING.md)** - Comprehensive testing guide (test types, patterns, CI/CD, troubleshooting)
- **[Testing Guide (Quick Reference)](./docs/Testing-Guide.md)** - Quick reference for common testing tasks
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System design and Clean Architecture patterns

### Advanced Topics

- **[Dynamic Property Fields Guide](./docs/DYNAMIC_FIELDS.md)** - Ontology-driven asset creation forms
- **[Ontology Extension Guide](./docs/ONTOLOGY_EXTENSION.md)** - Add custom properties to your ontology
- **[Performance Guide](./docs/Performance-Guide.md)** - Optimization tips and benchmarks
- **[Troubleshooting](./docs/Troubleshooting.md)** - Common issues and solutions
- **[Property Schema](./docs/PROPERTY_SCHEMA.md)** - Complete frontmatter property reference

### Project Information

- **[CHANGELOG.md](./CHANGELOG.md)** - Complete version history with semantic versioning
- **[CLAUDE.md](./CLAUDE.md)** - Development guidelines for AI assistants (Claude Code)
- **[AGENTS.md](./AGENTS.md)** - Universal guidelines for all AI coding assistants
- **[specs/features/](./specs/features/)** - BDD feature specifications

## ⚠️ Known Issues

### Command/Ctrl+Click Link Behavior (v12.9.10)

**Status**: Partially Working

**What works:**
- ✅ No duplicate tabs created (fixed in v12.9.10)
- ✅ Links are clickable
- ✅ Regular clicks open in current tab

**What doesn't work:**
- ❌ Command/Ctrl+Click doesn't open in new tab (opens in current tab instead)

**Root cause:**
- Obsidian's internal link handler intercepts clicks on elements with `internal-link` class
- Added `e.stopPropagation()` which fixed the duplicate tab issue
- However, Obsidian's modifier key detection still doesn't reach our handler
- Debug logging shows our onClick handlers are not being called at all

**Workaround:**
- Use standard Obsidian link opening: Right-click → "Open in new tab"
- Or use Middle-click (mouse wheel button) to open in new tab

**Future fix:**
- May need to completely remove `internal-link` class and implement custom link styling
- Or register our own Obsidian link handler instead of React onClick
- Issue tracked for future investigation

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

## 🤝 Support

- **Issues**: [GitHub Issues](https://github.com/kitelev/exocortex-obsidian-plugin/issues)
- **Releases**: [GitHub Releases](https://github.com/kitelev/exocortex-obsidian-plugin/releases)
- **Documentation**: This README and linked documentation files

---

**Built for the Obsidian community** 💜

<!-- Test branch protection settings -->
