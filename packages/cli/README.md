# @exocortex/cli

Command-line interface for Exocortex knowledge management system. Manage tasks, projects, and planning from the terminal without needing Obsidian.

## API Stability

**Current Version: 0.1.x (Stable API)**

This CLI follows [Semantic Versioning](https://semver.org/). The commands documented below are considered **stable** and covered by versioning guarantees.

**Documentation:**
- [CLI API Reference](docs/CLI_API_REFERENCE.md) - Formal command signatures and options
- [Versioning Policy](VERSIONING.md) - What constitutes breaking changes
- [SPARQL Guide](docs/SPARQL_GUIDE.md) - Complete query reference
- [SPARQL Cookbook](docs/SPARQL_COOKBOOK.md) - Real-world query examples
- [Ontology Reference](docs/ONTOLOGY_REFERENCE.md) - Available predicates

**For MCP Integration:**
- Pin to `^0.1.0` for stable API access
- Use exit codes for status (not console messages)
- Use `--format json` for machine-readable output

## Installation

```bash
npm install -g @exocortex/cli
```

Or use directly with npx:

```bash
npx @exocortex/cli [command]
```

## Usage

```bash
exocortex --help
```

### SPARQL Query

Execute SPARQL queries against your Obsidian vault as an RDF knowledge graph.

```bash
exocortex sparql query "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10" --vault ~/vault
```

**Options:**
- `<query>` - SPARQL query string or path to .sparql file **[required]**
- `--vault <path>` - Path to Obsidian vault (default: current directory)
- `--format <type>` - Output format: `table` (default), `json`, `csv`
- `--explain` - Show optimized query plan (for debugging)
- `--stats` - Show execution statistics (load time, query time, results count)
- `--no-optimize` - Disable query optimization

**Examples:**

```bash
# Find all tasks
exocortex sparql query \
  "PREFIX exo: <https://exocortex.my/ontology/exo#>
   PREFIX ems: <https://exocortex.my/ontology/ems#>
   SELECT ?task ?label
   WHERE {
     ?task exo:Instance_class ems:Task .
     ?task exo:Asset_label ?label .
   }" \
  --vault ~/vault

# Query from file
exocortex sparql query queries/my-query.sparql --vault ~/vault

# JSON output for automation
exocortex sparql query "SELECT ?s ?p ?o WHERE { ?s ?p ?o }" \
  --vault ~/vault \
  --format json > results.json

# Show query plan and stats
exocortex sparql query "SELECT ?task WHERE { ?task exo:Instance_class ems:Task }" \
  --vault ~/vault \
  --explain \
  --stats
```

**Sample Output (Table Format):**

```
📦 Loading vault: /Users/you/vault...
✅ Loaded 1,234 triples in 45ms

🔍 Parsing SPARQL query...
🔄 Translating to algebra...
🎯 Executing query...
✅ Found 5 result(s) in 12ms

┌────────────────────────────────────────────────────────────┐
│ ?label                    │ ?effort                      │
├────────────────────────────┼───────────────────────────────┤
│ "Implement SPARQL Engine" │ "240"                        │
│ "Write Documentation"     │ "120"                        │
│ "Design Architecture"     │ "180"                        │
└────────────────────────────────────────────────────────────┘
```

### Command Execution

Execute plugin commands on single assets. All commands follow the pattern:

```bash
exocortex command <command-name> <filepath> [options]
```

**Common Options:**
- `--vault <path>` - Path to Obsidian vault (default: current directory)
- `--dry-run` - Preview changes without modifying files

See [CLI API Reference](docs/CLI_API_REFERENCE.md) for complete command documentation.

#### Status Commands

```bash
# Start a task (ToDo → Doing)
exocortex command start "tasks/my-task.md" --vault ~/vault

# Complete a task (Doing → Done)
exocortex command complete "tasks/my-task.md" --vault ~/vault

# Move to backlog
exocortex command move-to-backlog "tasks/defer-task.md" --vault ~/vault

# Move to ToDo
exocortex command move-to-todo "tasks/ready-task.md" --vault ~/vault

# Trash a task
exocortex command trash "tasks/obsolete-task.md" --vault ~/vault

# Archive a task
exocortex command archive "tasks/old-task.md" --vault ~/vault
```

#### Creation Commands

```bash
# Create a new task
exocortex command create-task "tasks/new-task.md" \
  --label "Implement feature X" \
  --area "areas/product" \
  --vault ~/vault

# Create a new meeting
exocortex command create-meeting "meetings/standup.md" \
  --label "Daily Standup $(date +%Y-%m-%d)" \
  --prototype "prototypes/standup-template" \
  --vault ~/vault

# Create a new project
exocortex command create-project "projects/website-redesign.md" \
  --label "Website Redesign Q1 2026" \
  --vault ~/vault

# Create a new area
exocortex command create-area "areas/product.md" \
  --label "Product Development" \
  --vault ~/vault
```

#### Property Commands

```bash
# Rename file to match its UID
exocortex command rename-to-uid "tasks/My Task Name.md" --vault ~/vault

# Update asset label
exocortex command update-label "tasks/task.md" --label "New Label" --vault ~/vault

# Schedule task for a date
exocortex command schedule "tasks/feature.md" --date "2025-12-15" --vault ~/vault

# Set deadline
exocortex command set-deadline "tasks/feature.md" --date "2025-12-31" --vault ~/vault
```

## Workflow Examples

### Morning Planning

```bash
# Schedule tasks for today
exocortex command schedule "tasks/task1.md" --date "$(date +%Y-%m-%d)" --vault ~/vault
exocortex command schedule "tasks/task2.md" --date "$(date +%Y-%m-%d)" --vault ~/vault

# Move them to ToDo
exocortex command move-to-todo "tasks/task1.md" --vault ~/vault
exocortex command move-to-todo "tasks/task2.md" --vault ~/vault
```

### Creating Tasks from Project

```bash
# Create multiple tasks for a project
exocortex command create-task "tasks/update-homepage.md" \
  --label "Update homepage" \
  --parent "projects/website-redesign" \
  --vault ~/vault

exocortex command create-task "tasks/redesign-nav.md" \
  --label "Redesign navigation" \
  --parent "projects/website-redesign" \
  --vault ~/vault

exocortex command create-task "tasks/test-mobile.md" \
  --label "Test on mobile" \
  --parent "projects/website-redesign" \
  --vault ~/vault
```

### Weekly Review Workflow

```bash
# Create this week's review meeting
exocortex command create-meeting "meetings/weekly-review-$(date +%Y-%m-%d).md" \
  --label "Weekly Review $(date +%Y-%m-%d)" \
  --prototype "prototypes/weekly-review-template" \
  --vault ~/vault
```

### Task Lifecycle

```bash
# 1. Create task
exocortex command create-task "tasks/feature.md" --label "Implement feature" --vault ~/vault

# 2. Move to ToDo when ready
exocortex command move-to-todo "tasks/feature.md" --vault ~/vault

# 3. Start working
exocortex command start "tasks/feature.md" --vault ~/vault

# 4. Complete when done
exocortex command complete "tasks/feature.md" --vault ~/vault

# 5. Archive for cleanup
exocortex command archive "tasks/feature.md" --vault ~/vault
```

### Batch Operations

Execute multiple operations in a single CLI invocation for better performance:

```bash
# Execute batch from JSON input
exocortex batch --input '[
  {"command":"start","filepath":"tasks/task1.md"},
  {"command":"complete","filepath":"tasks/task2.md"},
  {"command":"trash","filepath":"tasks/task3.md"}
]' --vault ~/vault

# Execute batch from file
exocortex batch --file operations.json --vault ~/vault

# Atomic mode (all-or-nothing - rollback on any failure)
exocortex batch --file operations.json --vault ~/vault --atomic

# Dry run (preview without modifying files)
exocortex batch --input '[{"command":"start","filepath":"task.md"}]' --vault ~/vault --dry-run

# JSON output for MCP integration
exocortex batch --file operations.json --vault ~/vault --format json
```

**Batch Options:**
- `--input <json>` - JSON array of operations to execute
- `--file <path>` - Path to JSON file containing operations
- `--atomic` - All-or-nothing execution (rollback on any failure)
- `--dry-run` - Preview changes without modifying files
- `--format <type>` - Output format: `text` (default), `json`
- `--vault <path>` - Path to Obsidian vault (default: current directory)

**Operation Format:**
```json
{
  "command": "start",           // Command name (required)
  "filepath": "tasks/task.md",  // File path (required)
  "options": {                  // Optional command parameters
    "label": "New Label",
    "date": "2025-12-15"
  }
}
```

**Supported Commands:**
- `start` - Start task (ToDo → Doing)
- `complete` - Complete task (Doing → Done)
- `trash` - Trash task
- `archive` - Archive task
- `move-to-backlog` - Move to Backlog
- `move-to-analysis` - Move to Analysis
- `move-to-todo` - Move to ToDo
- `update-label` - Update label (requires `options.label`)
- `schedule` - Schedule task (requires `options.date`)
- `set-deadline` - Set deadline (requires `options.date`)

**Performance Benefits:**
- Single process execution (no repeated Node.js startup overhead)
- Vault loaded once for all operations
- Batch of 10 operations is ~10x faster than 10 separate CLI calls

**MCP Integration Example:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "total": 3,
    "succeeded": 3,
    "failed": 0,
    "results": [
      {"success": true, "command": "start", "filepath": "task1.md", "action": "Started task"},
      {"success": true, "command": "complete", "filepath": "task2.md", "action": "Completed task"},
      {"success": true, "command": "trash", "filepath": "task3.md", "action": "Trashed task"}
    ],
    "durationMs": 45,
    "atomic": false
  },
  "meta": {
    "durationMs": 45,
    "itemCount": 3
  }
}
```

## Architecture

The CLI uses `exocortex` for business logic and implements a Node.js file system adapter:

```
exocortex-cli/
├── src/
│   ├── index.ts           - Main CLI entry point
│   ├── adapters/
│   │   └── NodeFsAdapter.ts - Node.js file system implementation
│   └── commands/
│       ├── create-task.ts
│       ├── create-instance.ts
│       ├── status.ts
│       └── plan.ts
└── dist/                  - Compiled output
```

## Features

- **SPARQL Query Engine** - Execute SPARQL 1.1 queries against vault as RDF knowledge graph
  - BGP (Basic Graph Pattern) execution with variable bindings
  - Query optimization (filter push-down, join reordering)
  - Multiple output formats (table, JSON, CSV)
  - Query plan visualization (--explain flag)
  - Performance statistics (--stats flag)
- **File System Operations** - Read/write markdown files with frontmatter
- **Task Creation** - Generate tasks from areas, projects, and prototypes
- **Instance Creation** - Create instances from prototypes
- **Status Management** - Update task status through workflow
- **Planning** - Assign tasks to specific days
- **Frontmatter Support** - Full YAML frontmatter parsing and manipulation
- **Progress Indicators** - Spinners and colored output for better UX

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js --help

# Watch mode
npm run dev
```

## Requirements

- Node.js >= 18.0.0
- A vault with Exocortex-compatible markdown files

## Vault Structure

Your vault should follow Exocortex conventions:

```
vault/
├── areas/
│   ├── work.md
│   └── personal.md
├── projects/
│   └── website-redesign.md
├── tasks/
│   ├── abc-123.md
│   └── def-456.md
└── prototypes/
    ├── weekly-review.md
    └── standup.md
```

Each file should have YAML frontmatter with Exocortex properties:

```yaml
---
exo__Asset_isDefinedBy: my-ontology
exo__Asset_uid: abc-123
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDraft]]"
---
```

## Roadmap

### Implemented Commands

**SPARQL Query:**
- `exocortex sparql query` - Execute SPARQL queries against vault

**Status Transitions:**
- `exocortex command start` - Start effort (ToDo → Doing)
- `exocortex command complete` - Complete effort (Doing → Done)
- `exocortex command trash` - Trash effort
- `exocortex command archive` - Archive effort
- `exocortex command move-to-backlog` - Move to Backlog
- `exocortex command move-to-analysis` - Move to Analysis
- `exocortex command move-to-todo` - Move to ToDo

**Asset Creation:**
- `exocortex command create-task` - Create new task
- `exocortex command create-meeting` - Create new meeting
- `exocortex command create-project` - Create new project
- `exocortex command create-area` - Create new area

**Property Mutations:**
- `exocortex command rename-to-uid` - Rename file to match UID
- `exocortex command update-label` - Update asset label
- `exocortex command schedule` - Set planned start date
- `exocortex command set-deadline` - Set planned end date

**Batch Operations:**
- `exocortex batch` - Execute multiple operations in single invocation

### Planned Commands

- `exocortex command rollback-status` - Rollback to previous status
- `exocortex command shift-schedule` - Shift planned date forward/backward
- `exocortex list tasks` - List all tasks (with filters)
- `exocortex list today` - List today's scheduled tasks
- `exocortex report weekly` - Generate weekly effort report

## License

MIT
