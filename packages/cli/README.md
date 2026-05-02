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

### RDF Convert (Vault Dump)

Dump the entire vault graph as Turtle, N-Triples, or JSON-LD for backup,
offline analysis, or feeding external SHACL/RDF validators.

```bash
exocortex convert --format turtle --out vault.ttl --vault ~/vault
```

**Options:**

- `--format <type>` — Serialization format: `turtle` (default), `ntriples`, `jsonld`
- `--out <path>` — Write to file (omit to print to stdout)
- `--filter <class>` — Keep only instances of a class (e.g. `ems__Task`, `ems:Task`, or full IRI)
- `--vault <path>` — Path to Obsidian vault (default: current directory)

**Examples:**

```bash
# Dump full vault as Turtle
exocortex convert --format turtle --out vault.ttl --vault ~/vault

# Dump to stdout, pipe through external tool
exocortex convert --format ntriples --vault ~/vault | wc -l

# JSON-LD with @context for known namespaces
exocortex convert --format jsonld --out vault.jsonld --vault ~/vault

# Subset: only ems__Task instances
exocortex convert --format turtle --filter ems__Task --out tasks.ttl --vault ~/vault
```

**Use cases:**

- Backup / snapshot of the vault graph at a point in time.
- Offline analysis with Apache Jena, Protégé, or other RDF tooling.
- Feeding external SHACL engines (e.g. `shacl-engine`, `rdf-validate-shacl`)
  for validation outside the plugin.
- Diffing two `.ttl` snapshots to surface graph drift between runs.

### Universal Asset Creation

Create any vault asset with a single command. Auto-generates UUID, timestamp, frontmatter, resolves class names, and validates wikilinks.

```bash
# Create a permanent note
exocortex create --class ztlk__PermanentNote --label "My Note" --vault ~/vault

# With custom properties
exocortex create --class ztlk__PermanentNote \
  --label "My Note" \
  --property "ztlk__Note_developedFrom=[[uuid|Source Note]]" \
  --vault ~/vault

# With body content
exocortex create --class ztlk__PermanentNote \
  --label "My Note" \
  --body "# Content\n\nBody text here." \
  --vault ~/vault

# Body from file
exocortex create --class ztlk__PermanentNote \
  --label "My Note" \
  --body-file /tmp/content.md \
  --vault ~/vault

# Body from stdin
echo "# Content" | exocortex create --class ztlk__PermanentNote \
  --label "My Note" \
  --body - \
  --vault ~/vault

# Dry run (preview without writing)
exocortex create --class ztlk__PermanentNote --label "Test" --dry-run --vault ~/vault

# With aliases
exocortex create --class ztlk__PermanentNote \
  --label "My Note" \
  --aliases "Alias 1" "Alias 2" \
  --vault ~/vault

# Skip wikilink validation
exocortex create --class ztlk__PermanentNote \
  --label "My Note" \
  --property "prop=[[uuid|Label]]" \
  --skip-wikilink-validation \
  --vault ~/vault
```

**Options:**

- `--class <name>` - Class short name (e.g. `ztlk__PermanentNote`) or UUID **[required]**
- `--label <text>` - Human-readable label **[required]**
- `--vault <path>` - Path to Obsidian vault (default: current directory)
- `--aliases <names...>` - Additional aliases
- `--property <key=value>` - Property key-value pairs (repeatable)
- `--body <text>` - Markdown body content (use `-` for stdin)
- `--body-file <path>` - Read body from file
- `--dry-run` - Preview frontmatter without writing
- `--created-by <uuid>` - Creator UUID (default: ExoAssistant)
- `--timezone <tz>` - Timezone for timestamps (default: Asia/Almaty)
- `--skip-wikilink-validation` - Skip wikilink existence checks

**Output (JSON to stdout):**

```json
{
  "uuid": "generated-uuid",
  "path": "01 Inbox/generated-uuid.md",
  "label": "My Note"
}
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

### Dynamic Commands (RFC-009)

Execute **vault-defined commands** through a single generic interpreter. Any
`exocmd:Command` asset in the vault — defined entirely in RDF (precondition +
grounding + bindings) — can be invoked from CLI, Telegram bot, plugin button,
or `cron`, without writing TypeScript.

This is the **killer feature** of Exocortex: a uniform runtime for vault-defined
commands across plugin / CLI / scripts / Claude sessions. Source of truth is
the RDF graph in your vault, not hardcoded TS logic. Architectural contract:
RFC-009 (Dynamic Command System) and the umbrella RFC
`94e520da-c6f7-48af-944c-51298d68da45` for the production-ready roadmap.
Working command definitions live in
[`docs/examples/rfc-009/`](../../docs/examples/rfc-009/).

#### Subcommands

| Subcommand | Purpose |
|------------|---------|
| `dyncommand list` | Discover all `exocmd:Command` assets in vault |
| `dyncommand show <uid>` | Show full details: precondition, grounding, bindings |
| `dyncommand exec <uid> --target <path>` | Execute the command on a target asset |
| `dyncommand validate` | Validate all command definitions; surface duplicate UIDs |

```bash
# 1. Discover what commands the vault defines
exocortex dyncommand list --vault ~/vault

# 2. Filter to commands applicable to a specific asset
exocortex dyncommand list --target obsidian://vault/tasks/abc-123.md --vault ~/vault

# 3. Inspect a command (precondition SPARQL ASK + grounding)
exocortex dyncommand show 6e050240-58e9-4695-9dce-d73fc32cc1d7 --vault ~/vault

# 4. Execute (precondition is evaluated; non-passing ASK aborts before grounding)
exocortex dyncommand exec 6e050240-58e9-4695-9dce-d73fc32cc1d7 \
  --target tasks/abc-123.md \
  --vault ~/vault

# 5. Preview without writing
exocortex dyncommand exec <uid> --target tasks/abc-123.md --dry-run --vault ~/vault

# 6. Pass userInput to a service_call grounding
exocortex dyncommand exec <uid> \
  --target daily/2026-05-02.md \
  --input '{"label":"Lunch — vegetable soup"}' \
  --vault ~/vault

# 7. Validate vault-wide command definitions
exocortex dyncommand validate --vault ~/vault --output json
```

**Common options for all subcommands:**

- `--vault <path>` — Path to Obsidian vault (default: current directory)
- `--output <text|json>` — Response format (default: `text`)

**Additional options for `exec`:**

- `--target <filepath>` — Path to target asset, relative to vault **[required]**
- `--dry-run` — Evaluate precondition + print grounding plan; do not mutate files
- `--input <json>` — JSON object forwarded to `service_call` groundings as `userInput`

**Exit codes (exec / validate):**

- `0` — Success (executed or precondition passed in dry-run)
- `1` — Operation failed (precondition not satisfied, grounding error)
- `2` — File not found (target or vault)
- `3` — Invalid arguments (missing `--target`, malformed `--input`)

#### Example 1 — Telegram bot: complete a task by UID

A Telegram bot routes the user phrase «закрой задачу abc-123» to a single
`dyncommand exec` invocation. The bot does **not** know what "complete" means —
the semantics live entirely in the vault command asset (e.g.
`ems__Effort_status` transition `Doing → Done` plus `endTimestamp`):

```bash
TASK_UID="abc-123"
COMPLETE_CMD_UID="6e050240-58e9-4695-9dce-d73fc32cc1d7"   # from dyncommand list

exocortex dyncommand exec "$COMPLETE_CMD_UID" \
  --target "tasks/${TASK_UID}.md" \
  --vault ~/vault \
  --output json
```

Why this matters: adding a new vault-defined command (e.g. «отправить в backlog»,
«rollback to ToDo») requires **zero bot code changes** — only a new
`exocmd:Command` asset in the vault. This is Homoiconicity Q1 in practice
(see RFC `c78cc5c8-076c-4509-9e22-6f0257c51df4`).

#### Example 2 — CLI / Claude session: bulk-apply a command across a class

A Claude session needs to mark every `ems__Task` resolved in 2025 as archived.
Discover the command UID once, then loop over targets selected by SPARQL:

```bash
ARCHIVE_CMD_UID=$(exocortex dyncommand list --vault ~/vault --output json \
  | jq -r '.data[] | select(.label == "Archive Asset") | .uid')

exocortex sparql query \
  "PREFIX ems: <https://exocortex.my/ontology/ems#>
   SELECT ?path WHERE {
     ?s a ems:Task ;
        ems:Effort_status ems:EffortStatusDone ;
        ems:Effort_endTimestamp ?ts .
     FILTER(STRSTARTS(STR(?ts), '2025'))
     BIND(STRAFTER(STR(?s), 'obsidian://vault/') AS ?path)
   }" \
  --vault ~/vault --format json \
  | jq -r '.results.bindings[].path.value' \
  | while read -r path; do
      exocortex dyncommand exec "$ARCHIVE_CMD_UID" \
        --target "$path" \
        --vault ~/vault \
        --output json
    done
```

The same `ARCHIVE_CMD_UID` works from a UI button (plugin), Telegram message,
or scheduled job — one definition, many runtimes.

#### Example 3 — `cron`: daily Lunch instance from a prototype

Production server runs `lunch-tracker.sh` at 13:00 every day. The script
materializes a fresh `Lunch` instance from a vault prototype using the generic
`Create Instance` command (a `create_instance` grounding):

```bash
#!/usr/bin/env bash
# lunch-tracker.sh — cron entry: 0 13 * * * /opt/exocortex/lunch-tracker.sh
set -euo pipefail

VAULT="$HOME/vault"
DAILY="daily/$(date +%Y-%m-%d).md"
CREATE_INSTANCE_CMD="1abe7877-a462-4bd5-9bd8-1f75fe7f50aa"  # Start Lunch (RFC 94e520da § Phase 7)

npx @kitelev/exocortex-cli dyncommand exec "$CREATE_INSTANCE_CMD" \
  --target "$DAILY" \
  --input "{\"label\":\"Lunch — $(date +%Y-%m-%d)\"}" \
  --vault "$VAULT" \
  --output json
```

If the command, its precondition, or its grounding ever change in the vault,
the cron job picks up the new behavior automatically — no redeploy.

A drop-in deployable version of this script — with crontab fragment, nightly
verifier, install instructions, and a 7-day soak protocol — lives in
[`examples/production-cron/`](../../examples/production-cron/) (RFC
`94e520da` § Phase 5).

#### Telegram bot integration (Phase 7 migration)

> **Migration target (RFC `94e520da` § Phase 7, T7.1):** Telegram bot Claude
> subprocess **must** invoke `dyncommand exec <uid>` rather than legacy
> `command start <path>`.

The legacy `exocortex command start <path-to-asset>` (`Doing` transition by
file path) is **deprecated** as part of the Phase 7 sunset of the hardcoded
plugin-command CLI surface. Equivalent vault-defined behaviour now lives
behind a stable command UID:

```bash
# ✅ NEW canonical path — vault-defined command, stable UID, runtime-agnostic:
LUNCH_CMD="1abe7877-a462-4bd5-9bd8-1f75fe7f50aa"   # "Start Lunch" command
TODAY_DAILY="03 Knowledge/daily/$(date +%Y-%m-%d).md"

exocortex dyncommand exec "$LUNCH_CMD" \
  --target "$TODAY_DAILY" \
  --vault ~/vault \
  --output json

# ⚠️ LEGACY (still works until Phase 7.3 sunset, ≥ 2 minor releases out):
# exocortex command start "tasks/<lunch-task-uid>.md" --vault ~/vault
```

**What the bot subprocess Claude does:**

1. Receives user phrase (e.g. «начать обедать»).
2. Resolves the phrase to a vault `exocmd:Command` asset by `exo__Asset_label`
   or `aliases:` (the `Start Lunch` command above carries `aliases: [начать
   обедать]` so direct lookup works).
3. Invokes `dyncommand exec <uid> --target <today-daily-note> --vault $VAULT`.
4. Surfaces the JSON `successMessage` back to the user.

**Why this is a real migration, not a rename:**

- Adding a new bot phrase (e.g. «закрой задачу», «отправь в backlog») requires
  **zero bot or CLI code changes** — only a new vault `exocmd:Command` asset.
- The same UID drives plugin UI buttons, CLI invocations, cron jobs, and
  Telegram routing. One definition, every runtime.
- Backward compat: the legacy `command start` path keeps working through
  Phase 7.2 (deprecation warning) and Phase 7.3 (sunset), so existing bot
  configurations roll over without user-visible regression (RFC § R4).

**Verification:**

```bash
# 1. Confirm command exists and precondition compiles:
exocortex dyncommand show 1abe7877-a462-4bd5-9bd8-1f75fe7f50aa --vault ~/vault

# 2. Dry-run on today's daily note (no writes):
exocortex dyncommand exec 1abe7877-a462-4bd5-9bd8-1f75fe7f50aa \
  --target "03 Knowledge/daily/$(date +%Y-%m-%d).md" \
  --dry-run --vault ~/vault --output json
```

The canonical `Start Lunch` command lives at
`03 Knowledge/exocmd/status/1abe7877-a462-4bd5-9bd8-1f75fe7f50aa.md` in the
vault; its grounding (`93e4a830-0911-4589-91f2-49ac0acdb4d2`) is a
`service_call createAsset` materialising a fresh `ems__Task` instance from
the Lunch `TaskPrototype` (`4b571141-5fc3-4ddd-8f07-ca681fc8410a`).

#### Troubleshooting

- **`Precondition not satisfied`** — run `dyncommand show <uid>` to read the
  SPARQL ASK; verify with `sparql query` that the target asset matches the
  pattern. Common cause: target IRI mismatch (CLI ↔ plugin parity, RFC-027 in
  progress) or an unset frontmatter property the precondition requires.
- **`Command with UID "..." not found`** — `dyncommand list` returns 0 on
  UUID-wikilink-only vaults if the discovery index is stale; rebuild the
  vault cache or pass `--target <iri>` to bypass class filtering.
- **Service `…` not implemented in CLI runtime** — the grounding uses a
  `service_call` that is plugin-only (Phase 1 hard-fails such calls instead
  of silently succeeding). Run from the plugin, or implement the service in
  `@kitelev/exocortex-services`.
- **`dyncommand show` and `exec` disagree** — almost always a duplicate
  `exo__Asset_uid`; run `dyncommand validate --output json` and grep for
  `duplicateUids`. RCA: `docs/RCA_DYNCOMMAND_SHOW_VS_EXEC.md`.

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

# 5. Mark as archived
exocortex command archive "tasks/feature.md" --vault ~/vault
```

### Archive Lifecycle

```bash
# 1. Mark completed tasks as archived (sets archived: true)
exocortex command archive "tasks/old-task.md" --vault ~/vault

# 2. Bulk move archived tasks to archive vault
npx @kitelev/exocortex-cli archive \
  --vault ~/vault \
  --archive-vault ~/vault-archive \
  --class ems__Task --year 2025

# 3. Resolve dependency chains
npx @kitelev/exocortex-cli archive --cascade \
  --vault ~/vault \
  --archive-vault ~/vault-archive

# 4. Verify integrity
npx @kitelev/exocortex-cli archive --verify \
  --vault ~/vault \
  --archive-vault ~/vault-archive

# 5. Restore if needed
npx @kitelev/exocortex-cli unarchive \
  --uuid <asset-uuid> \
  --vault ~/vault \
  --archive-vault ~/vault-archive
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
  "command": "start", // Command name (required)
  "filepath": "tasks/task.md", // File path (required)
  "options": {
    // Optional command parameters
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
      {
        "success": true,
        "command": "start",
        "filepath": "task1.md",
        "action": "Started task"
      },
      {
        "success": true,
        "command": "complete",
        "filepath": "task2.md",
        "action": "Completed task"
      },
      {
        "success": true,
        "command": "trash",
        "filepath": "task3.md",
        "action": "Trashed task"
      }
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

### Archive Management

Manage the lifecycle of assets between active and archive vaults. The archive system ensures zero broken links by checking references before moving files.

#### Archive Assets

Move completed/archived assets from active vault to a separate archive vault:

```bash
# Archive all ems__Task from 2025
npx @kitelev/exocortex-cli archive \
  --vault ~/vault \
  --archive-vault ~/vault-archive \
  --class ems__Task \
  --year 2025

# Archive multiple classes
npx @kitelev/exocortex-cli archive \
  --vault ~/vault \
  --archive-vault ~/vault-archive \
  --class ems__Task,ems__Meeting \
  --year 2025

# Dry run — preview without moving files
npx @kitelev/exocortex-cli archive --dry-run \
  --vault ~/vault \
  --archive-vault ~/vault-archive \
  --class ems__Task \
  --year 2025
```

**Archive Options:**

- `--vault <path>` - Path to the active vault **[required]**
- `--archive-vault <path>` - Path to the archive vault **[required]**
- `--class <names>` - Comma-separated class short names or UUIDs (e.g. `ems__Task,ems__Meeting`) **[required for archive mode]**
- `--year <year>` - Filter by resolution/end timestamp year (e.g. `2025`) **[required for archive mode]**
- `--dry-run` - Preview without writing files
- `--no-referenced` - Skip assets that are still referenced by active (non-archived) files **(default behavior)**. Pass `--referenced` to include them anyway.

**Exit codes:**

- `0` — Success (assets archived or dry-run preview completed)
- `1` — Error (invalid options, vault not found, missing required flags)

**What archive does:**

1. Scans active vault for assets matching class + year with `archived: true` in frontmatter
2. Checks cross-references — blocks assets still referenced by active (non-archived) files
3. Creates archive ontology files (e.g. `!ems_archive.md`) if needed
4. Updates `exo__Asset_isDefinedBy` to point to archive ontology
5. Moves files to archive vault, deletes from active vault

#### Verify Archive Integrity

Check for broken cross-vault links and missing ontologies (read-only):

```bash
npx @kitelev/exocortex-cli archive --verify \
  --vault ~/vault \
  --archive-vault ~/vault-archive
```

Returns exit code 0 if healthy, 1 if issues found. JSON output includes `broken_links`, `missing_ontologies`, and vault `stats`.

#### Cascade Archive

Iteratively resolve archived-to-archived dependency chains. Useful after bulk archival when some assets were blocked because they referenced other archived assets:

```bash
# Cascade resolve (moves all unblocked archived assets)
npx @kitelev/exocortex-cli archive --cascade \
  --vault ~/vault \
  --archive-vault ~/vault-archive

# Preview cascade
npx @kitelev/exocortex-cli archive --cascade --dry-run \
  --vault ~/vault \
  --archive-vault ~/vault-archive
```

No `--class` or `--year` needed — cascade processes all eligible archived assets.

#### Unarchive (Restore) Assets

Restore a single asset from archive vault back to active vault:

```bash
# Restore asset by UUID
npx @kitelev/exocortex-cli unarchive \
  --uuid ca0d0001-1111-2222-3333-444455556666 \
  --vault ~/vault \
  --archive-vault ~/vault-archive

# Dry run — preview without restoring
npx @kitelev/exocortex-cli unarchive --dry-run \
  --uuid ca0d0001-1111-2222-3333-444455556666 \
  --vault ~/vault \
  --archive-vault ~/vault-archive
```

**Unarchive Options:**

- `--uuid <uuid>` - UUID of the asset to restore **[required]**
- `--vault <path>` - Path to the active vault **[required]**
- `--archive-vault <path>` - Path to the archive vault **[required]**
- `--dry-run` - Preview without writing files

**Exit codes:**

- `0` — Success (asset restored or dry-run preview completed)
- `1` — Error (UUID not found in archive vault, invalid UUID format, vault not found)

**What unarchive does:**

1. Finds asset by UUID in archive vault (direct filename match, then frontmatter scan)
2. Updates `exo__Asset_isDefinedBy` from archive ontology back to active ontology
3. Moves file to `<active-vault>/03 Knowledge/inbox/`
4. Preserves `archived: true` in frontmatter (user decides whether to remove it)

**Output (JSON to stdout):**

```json
{
  "success": true,
  "uuid": "ca0d0001-...",
  "movedTo": "03 Knowledge/inbox/ca0d0001-....md",
  "isDefinedBy": "[[!ems|EMS Ontology]]"
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
- **Archive Management** - Bulk archive/unarchive assets between vaults with integrity verification
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

**Universal Asset Creation:**

- `exocortex create` - Create any asset with auto UUID, frontmatter, and wikilink validation

**Asset Creation (legacy):**

- `exocortex command create-task` - Create new task
- `exocortex command create-meeting` - Create new meeting
- `exocortex command create-project` - Create new project
- `exocortex command create-area` - Create new area

**Property Mutations:**

- `exocortex command rename-to-uid` - Rename file to match UID
- `exocortex command update-label` - Update asset label
- `exocortex command schedule` - Set planned start date
- `exocortex command set-deadline` - Set planned end date

**Dynamic Commands (RFC-009):**

- `exocortex dyncommand list` - Discover vault-defined `exocmd:Command` assets
- `exocortex dyncommand show` - Show precondition / grounding / bindings for a command
- `exocortex dyncommand exec` - Execute vault-defined command on a target asset
- `exocortex dyncommand validate` - Validate command definitions; flag duplicate UIDs

**Batch Operations:**

- `exocortex batch` - Execute multiple operations in single invocation

**Archive Management:**

- `exocortex archive` - Bulk archive assets by class and year (with `--dry-run`, `--verify`, `--cascade`)
- `exocortex unarchive` - Restore single asset from archive vault by UUID (with `--dry-run`)

### Planned Commands

- `exocortex command rollback-status` - Rollback to previous status
- `exocortex command shift-schedule` - Shift planned date forward/backward
- `exocortex list tasks` - List all tasks (with filters)
- `exocortex list today` - List today's scheduled tasks
- `exocortex report weekly` - Generate weekly effort report

## License

MIT
