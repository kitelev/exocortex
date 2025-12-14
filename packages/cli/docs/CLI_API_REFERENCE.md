# CLI API Reference

> **API Stability**: This document defines the **stable API surface** for @exocortex/cli v0.1.x. Commands and options documented here are considered stable and follow semantic versioning guarantees. See [VERSIONING.md](../VERSIONING.md) for versioning policy.

---

## Table of Contents

- [SPARQL Query](#sparql-query)
- [Watch Command](#watch-command)
- [Command Execution](#command-execution)
  - [Status Commands](#status-commands)
  - [Creation Commands](#creation-commands)
  - [Property Commands](#property-commands)
  - [Planning Commands](#planning-commands)
- [Exit Codes](#exit-codes)
- [Structured Error Responses (MCP Compatible)](#structured-error-responses-mcp-compatible)
- [Common Options](#common-options)
- [Stability Guarantees](#stability-guarantees)

---

## SPARQL Query

Execute SPARQL queries against your Obsidian vault as an RDF knowledge graph.

### Signature

```bash
exocortex sparql query <query> [options]
```

### Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `<query>` | string | Yes | SPARQL query string or path to `.sparql` file |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--vault <path>` | string | `process.cwd()` | Path to Obsidian vault |
| `--format <type>` | enum | `table` | Output format: `table`, `json`, `csv` |
| `--output <type>` | enum | `text` | Response format: `text`, `json` (for MCP tools) |
| `--explain` | boolean | `false` | Show optimized query plan |
| `--stats` | boolean | `false` | Show execution statistics |
| `--no-optimize` | boolean | `false` | Disable query optimization |

### Output

- **Table format**: ASCII table with headers and aligned columns
- **JSON format**: Array of solution mappings with variable bindings
- **CSV format**: Comma-separated values with header row

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Query executed successfully |
| `1` | General error (parse error, vault not found, etc.) |

### Examples

```bash
# Inline query with table output
exocortex sparql query "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10" --vault ~/vault

# Query from file with JSON output
exocortex sparql query queries/tasks.sparql --vault ~/vault --format json

# Query with execution stats
exocortex sparql query "SELECT ?task WHERE { ?task exo:Instance_class ems:Task }" \
  --vault ~/vault --stats

# Query with plan visualization
exocortex sparql query queries/complex.sparql --vault ~/vault --explain
```

---

## Watch Command

Monitor vault file changes and emit structured events in NDJSON format. Designed for integration with MCP resource subscriptions and automation pipelines.

### Signature

```bash
exocortex watch [options]
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--vault <path>` | string | `process.cwd()` | Path to Obsidian vault to watch |
| `--pattern <glob>` | string | `**/*.md` | Glob pattern to filter files (e.g., `*.md`, `tasks/**`) |
| `--asset-type <type>` | string | - | Filter by asset type from frontmatter (e.g., `ems__Task`, `ems__Project`) |
| `--debounce <ms>` | number | `100` | Debounce interval in milliseconds |

### Output Format

The watch command outputs events to **stdout** in NDJSON format (one JSON object per line). Each event has the following structure:

```typescript
interface WatchEvent {
  type: "create" | "modify" | "delete";  // Event type
  path: string;                           // Absolute path to file
  relativePath: string;                   // Path relative to vault root
  timestamp: string;                      // ISO 8601 timestamp
  assetType?: string;                     // Asset type from frontmatter (for .md files)
}
```

### Event Types

| Type | Description |
|------|-------------|
| `create` | File was created (detected via birthtime < 1 second) |
| `modify` | File was modified (existing file changed) |
| `delete` | File was deleted (file no longer exists) |

### Startup Messages

Startup and status messages are emitted to **stderr** to avoid interfering with NDJSON output on stdout:

```
Watching vault: /path/to/vault
  Pattern filter: *.md
  Asset type filter: ems__Task
  Debounce: 100ms
Press Ctrl+C to stop
```

### Error Events

Watcher errors are emitted to stdout as JSON objects:

```json
{"type":"error","message":"Watch error: ENOENT","timestamp":"2025-12-06T10:30:00.000Z"}
```

### Signal Handling

- **SIGINT** (Ctrl+C): Graceful shutdown with exit code 0
- **SIGTERM**: Graceful shutdown with exit code 0

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Graceful shutdown (SIGINT/SIGTERM) |
| `2` | Invalid arguments (bad path, invalid debounce) |
| `3` | Vault path does not exist |

### Examples

```bash
# Watch entire vault with default settings
exocortex watch --vault ~/vault

# Watch only markdown files in tasks directory
exocortex watch --vault ~/vault --pattern "tasks/**/*.md"

# Watch only task files (filter by asset type)
exocortex watch --vault ~/vault --asset-type "ems__Task"

# Custom debounce for rapid file changes
exocortex watch --vault ~/vault --debounce 500

# Combine pattern and asset type filters
exocortex watch --vault ~/vault --pattern "*.md" --asset-type "ems__Meeting"

# Pipe to jq for processing
exocortex watch --vault ~/vault | jq -c 'select(.type == "modify")'

# Log events to file
exocortex watch --vault ~/vault >> events.ndjson

# Use in MCP resource subscription
exocortex watch --vault ~/vault --asset-type "ems__Task" | while read -r event; do
  echo "Task changed: $event"
done
```

### Integration with MCP

The watch command is designed for MCP (Model Context Protocol) resource subscriptions. Example integration:

```typescript
import { spawn } from "child_process";

const watcher = spawn("exocortex", [
  "watch",
  "--vault", "/path/to/vault",
  "--asset-type", "ems__Task"
]);

watcher.stdout.on("data", (data) => {
  const lines = data.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    const event = JSON.parse(line);
    // Notify MCP clients about resource update
    mcpServer.notify("resources/updated", {
      uri: `exocortex://task/${event.relativePath}`
    });
  }
});
```

### Debouncing

The watcher implements per-file debouncing to prevent event storms:

- Each file has its own debounce timer
- Rapid changes to the same file are coalesced into a single event
- Changes to different files are tracked independently
- Default debounce of 100ms works well for most editors

### Pattern Matching

Pattern matching uses [minimatch](https://github.com/isaacs/minimatch) glob syntax:

| Pattern | Description |
|---------|-------------|
| `*.md` | All markdown files in root |
| `**/*.md` | All markdown files (recursive) |
| `tasks/**` | All files in tasks directory |
| `*.{md,txt}` | Markdown and text files |
| `!archive/**` | Exclude archive directory (negation) |

---

## Command Execution

Execute plugin commands on single assets via CLI.

### Base Signature

```bash
exocortex command <command-name> <filepath> [options]
```

### Common Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `<command-name>` | string | Yes | Command to execute (see specific commands below) |
| `<filepath>` | string | Yes | Path to asset file (relative to vault root or absolute) |

### Common Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--vault <path>` | string | `process.cwd()` | Path to Obsidian vault |
| `--dry-run` | boolean | `false` | Preview changes without modifying files |

---

## Status Commands

Commands that transition effort status (tasks, projects, meetings).

### start

Transitions task from ToDo to Doing status and records start timestamp.

```bash
exocortex command start <filepath> [--vault <path>]
```

**Side Effects**:
- Sets `ems__Effort_status` to `"[[ems__EffortStatusDoing]]"`
- Sets `ems__Effort_startTimestamp` to current ISO timestamp

**Example**:
```bash
exocortex command start "tasks/implement-feature.md" --vault ~/vault
```

---

### complete

Transitions task from Doing to Done status and records completion timestamps.

```bash
exocortex command complete <filepath> [--vault <path>]
```

**Side Effects**:
- Sets `ems__Effort_status` to `"[[ems__EffortStatusDone]]"`
- Sets `ems__Effort_endTimestamp` to current ISO timestamp
- Sets `ems__Effort_resolutionTimestamp` to current ISO timestamp

**Example**:
```bash
exocortex command complete "tasks/implement-feature.md" --vault ~/vault
```

---

### trash

Transitions task to Trashed status from any current status.

```bash
exocortex command trash <filepath> [--vault <path>]
```

**Side Effects**:
- Sets `ems__Effort_status` to `"[[ems__EffortStatusTrashed]]"`
- Sets `ems__Effort_resolutionTimestamp` to current ISO timestamp

**Example**:
```bash
exocortex command trash "tasks/obsolete-task.md" --vault ~/vault
```

---

### archive

Sets archived property to true and removes aliases.

```bash
exocortex command archive <filepath> [--vault <path>]
```

**Side Effects**:
- Sets `archived` to `true`
- Removes `aliases` property

**Example**:
```bash
exocortex command archive "tasks/old-completed-task.md" --vault ~/vault
```

---

### move-to-backlog

Transitions task to Backlog status.

```bash
exocortex command move-to-backlog <filepath> [--vault <path>]
```

**Side Effects**:
- Sets `ems__Effort_status` to `"[[ems__EffortStatusBacklog]]"`

**Example**:
```bash
exocortex command move-to-backlog "tasks/defer-task.md" --vault ~/vault
```

---

### move-to-analysis

Transitions project to Analysis status.

```bash
exocortex command move-to-analysis <filepath> [--vault <path>]
```

**Side Effects**:
- Sets `ems__Effort_status` to `"[[ems__EffortStatusAnalysis]]"`

**Example**:
```bash
exocortex command move-to-analysis "projects/new-initiative.md" --vault ~/vault
```

---

### move-to-todo

Transitions task/project to ToDo status.

```bash
exocortex command move-to-todo <filepath> [--vault <path>]
```

**Side Effects**:
- Sets `ems__Effort_status` to `"[[ems__EffortStatusToDo]]"`

**Example**:
```bash
exocortex command move-to-todo "tasks/ready-task.md" --vault ~/vault
```

---

## Creation Commands

Commands that create new asset files.

### create-task

Creates new task file with complete frontmatter initialization.

```bash
exocortex command create-task <filepath> --label <label> [options]
```

**Required Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--label <value>` | string | Task label (required) |

**Optional Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--prototype <uid>` | string | Prototype UID for inheritance |
| `--area <uid>` | string | Area UID for effort linkage |
| `--parent <uid>` | string | Parent UID for effort linkage |

**Generated Frontmatter**:
- `exo__Asset_isDefinedBy`: `"[[Ontology/EMS]]"`
- `exo__Asset_uid`: Generated UUID v4
- `exo__Asset_label`: From `--label`
- `exo__Asset_createdAt`: ISO timestamp
- `exo__Instance_class`: `["[[ems__Task]]"]`
- `ems__Effort_status`: `"[[ems__EffortStatusDraft]]"`
- `aliases`: Array containing label

**Example**:
```bash
exocortex command create-task "tasks/new-task.md" \
  --label "Implement search feature" \
  --area "areas/product" \
  --vault ~/vault
```

---

### create-meeting

Creates new meeting file with complete frontmatter initialization.

```bash
exocortex command create-meeting <filepath> --label <label> [options]
```

**Required Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--label <value>` | string | Meeting label (required) |

**Optional Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--prototype <uid>` | string | Prototype UID for inheritance |
| `--area <uid>` | string | Area UID for effort linkage |
| `--parent <uid>` | string | Parent UID for effort linkage |

**Generated Frontmatter**:
- `exo__Asset_isDefinedBy`: `"[[Ontology/EMS]]"`
- `exo__Asset_uid`: Generated UUID v4
- `exo__Asset_label`: From `--label`
- `exo__Asset_createdAt`: ISO timestamp
- `exo__Instance_class`: `["[[ems__Meeting]]"]`
- `ems__Effort_status`: `"[[ems__EffortStatusDraft]]"`
- `aliases`: Array containing label

**Example**:
```bash
exocortex command create-meeting "meetings/standup.md" \
  --label "Daily Standup 2025-12-02" \
  --prototype "prototypes/standup-template" \
  --vault ~/vault
```

---

### create-project

Creates new project file with complete frontmatter initialization.

```bash
exocortex command create-project <filepath> --label <label> [options]
```

**Required Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--label <value>` | string | Project label (required) |

**Optional Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--prototype <uid>` | string | Prototype UID for inheritance |
| `--area <uid>` | string | Area UID for effort linkage |
| `--parent <uid>` | string | Parent UID for effort linkage |

**Generated Frontmatter**:
- `exo__Asset_isDefinedBy`: `"[[Ontology/EMS]]"`
- `exo__Asset_uid`: Generated UUID v4
- `exo__Asset_label`: From `--label`
- `exo__Asset_createdAt`: ISO timestamp
- `exo__Instance_class`: `["[[ems__Project]]"]`
- `ems__Effort_status`: `"[[ems__EffortStatusDraft]]"`
- `aliases`: Array containing label

**Example**:
```bash
exocortex command create-project "projects/website-redesign.md" \
  --label "Website Redesign Q1 2026" \
  --area "areas/product" \
  --vault ~/vault
```

---

### create-area

Creates new area file with complete frontmatter initialization.

```bash
exocortex command create-area <filepath> --label <label> [options]
```

**Required Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--label <value>` | string | Area label (required) |

**Optional Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--prototype <uid>` | string | Prototype UID for inheritance |
| `--area <uid>` | string | Parent area UID |
| `--parent <uid>` | string | Parent UID |

**Generated Frontmatter**:
- `exo__Asset_isDefinedBy`: `"[[Ontology/EMS]]"`
- `exo__Asset_uid`: Generated UUID v4
- `exo__Asset_label`: From `--label`
- `exo__Asset_createdAt`: ISO timestamp
- `exo__Instance_class`: `["[[ems__Area]]"]`
- `aliases`: Array containing label

> **Note**: Areas do NOT have `ems__Effort_status` property (only efforts: tasks, projects, meetings).

**Example**:
```bash
exocortex command create-area "areas/product.md" \
  --label "Product Development" \
  --vault ~/vault
```

---

## Property Commands

Commands that modify asset properties.

### rename-to-uid

Renames file to match its `exo__Asset_uid` property value. If label is missing, sets it to the original filename.

```bash
exocortex command rename-to-uid <filepath> [--vault <path>]
```

**Side Effects**:
- Renames file from `<current-name>.md` to `<uid>.md`
- If `exo__Asset_label` is empty, sets it to original filename
- If not archived, adds original filename to `aliases`

**Error Conditions**:
- Exit code `1` if `exo__Asset_uid` property is missing

**Example**:
```bash
exocortex command rename-to-uid "tasks/My Task Name.md" --vault ~/vault
# Result: File renamed to "tasks/a1b2c3d4-e5f6-7890-abcd-ef1234567890.md"
```

---

### update-label

Updates `exo__Asset_label` property and synchronizes aliases array.

```bash
exocortex command update-label <filepath> --label <value> [--vault <path>] [--dry-run]
```

**Required Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--label <value>` | string | New label value (required) |

**Side Effects**:
- Sets `exo__Asset_label` to new value
- Adds new label to `aliases` array if not already present

**Dry Run Mode**:
- With `--dry-run`: Shows preview of changes without modifying files
- Without `--dry-run`: Applies changes to file

**Example**:
```bash
# Preview changes
exocortex command update-label "tasks/task.md" --label "New Label" --dry-run

# Apply changes
exocortex command update-label "tasks/task.md" --label "New Label" --vault ~/vault
```

---

## Planning Commands

Commands that set planning dates for efforts.

### schedule

Sets planned start timestamp for an effort (task/project/meeting).

```bash
exocortex command schedule <filepath> --date <YYYY-MM-DD> [--vault <path>]
```

**Required Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--date <value>` | string | Date in YYYY-MM-DD format (required) |

**Side Effects**:
- Sets `ems__Effort_plannedStartTimestamp` to timestamp at start of specified day

**Date Format**:
- Must be `YYYY-MM-DD` (e.g., `2025-12-02`)
- Invalid formats result in exit code `1`

**Example**:
```bash
exocortex command schedule "tasks/feature.md" --date "2025-12-15" --vault ~/vault
```

---

### set-deadline

Sets planned end timestamp for an effort (task/project/meeting).

```bash
exocortex command set-deadline <filepath> --date <YYYY-MM-DD> [--vault <path>]
```

**Required Options**:

| Option | Type | Description |
|--------|------|-------------|
| `--date <value>` | string | Date in YYYY-MM-DD format (required) |

**Side Effects**:
- Sets `ems__Effort_plannedEndTimestamp` to timestamp at start of specified day

**Date Format**:
- Must be `YYYY-MM-DD` (e.g., `2025-12-02`)
- Invalid formats result in exit code `1`

**Example**:
```bash
exocortex command set-deadline "tasks/feature.md" --date "2025-12-31" --vault ~/vault
```

---

## Exit Codes

All commands use standardized exit codes following Unix conventions:

| Code | Constant | Description |
|------|----------|-------------|
| `0` | `SUCCESS` | Command completed successfully |
| `1` | `GENERAL_ERROR` | General error (catch-all for non-specific errors) |
| `2` | `INVALID_ARGUMENTS` | Invalid command-line arguments or options |
| `3` | `FILE_NOT_FOUND` | File or directory not found |
| `4` | `PERMISSION_DENIED` | Permission denied (file system access) |
| `5` | `OPERATION_FAILED` | Command execution failed (business logic error) |
| `6` | `INVALID_STATE_TRANSITION` | Invalid asset state transition (e.g., status change not allowed) |
| `7` | `TRANSACTION_FAILED` | Transaction failed (atomic operation could not complete) |
| `8` | `CONCURRENT_MODIFICATION` | Concurrent modification detected (file changed during operation) |

---

## Structured Error Responses (MCP Compatible)

For programmatic integration with MCP tools and automation, use `--format json` (for `command`) or `--output json` (for `sparql query`) to receive structured JSON responses.

### Response Format

**Success Response:**

```json
{
  "success": true,
  "data": {
    "command": "start",
    "filePath": "tasks/my-task.md",
    "action": "started",
    "changes": ["Set status to Doing", "Set startTimestamp"]
  },
  "meta": {
    "timestamp": "2025-12-06T10:30:00.000Z",
    "durationMs": 45
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FILE_NOT_FOUND",
    "category": "validation",
    "message": "File not found: tasks/missing.md",
    "exitCode": 3,
    "recoveryHint": {
      "message": "The file does not exist at the specified path",
      "suggestion": "Verify the file path and ensure it exists within the vault"
    }
  },
  "meta": {
    "timestamp": "2025-12-06T10:30:00.000Z"
  }
}
```

### Error Categories

Errors are organized into four categories to help MCP tools and automation handle them appropriately:

| Category | Description | Typical Action |
|----------|-------------|----------------|
| `validation` | Input validation failures (missing files, invalid arguments) | Fix input and retry |
| `permission` | Access control violations (file permissions) | Request appropriate access |
| `state` | Business logic violations (invalid state transitions) | Change current state first |
| `internal` | Unexpected errors (system failures) | Report bug or retry |

### Error Codes Reference

#### Validation Errors

| Code | Exit | Description | Recovery Suggestion |
|------|------|-------------|---------------------|
| `VALIDATION_FILE_NOT_FOUND` | 3 | File not found at path | Verify path exists in vault |
| `VALIDATION_INVALID_ARGUMENTS` | 2 | Invalid command arguments | Check --help for correct usage |
| `VALIDATION_VAULT_NOT_FOUND` | 3 | Vault directory not found | Verify --vault path exists |

#### Permission Errors

| Code | Exit | Description | Recovery Suggestion |
|------|------|-------------|---------------------|
| `PERMISSION_DENIED` | 4 | File system access denied | Check file permissions |

#### State Errors

| Code | Exit | Description | Recovery Suggestion |
|------|------|-------------|---------------------|
| `STATE_INVALID_TRANSITION` | 6 | Invalid status transition | Check current status first |
| `STATE_CONCURRENT_MODIFICATION` | 8 | File changed during operation | Retry after reload |
| `STATE_OPERATION_FAILED` | 5 | Operation could not complete | Check preconditions |

#### Internal Errors

| Code | Exit | Description | Recovery Suggestion |
|------|------|-------------|---------------------|
| `INTERNAL_UNKNOWN` | 1 | Unexpected internal error | Report issue with stack trace |
| `INTERNAL_TRANSACTION_FAILED` | 7 | Atomic operation failed | Retry or check system state |

### Usage Examples

**Command with JSON output:**

```bash
# Success case
exocortex command start "tasks/task.md" --vault ~/vault --format json
# Returns: {"success":true,"data":{...},"meta":{...}}

# Error case
exocortex command start "missing.md" --vault ~/vault --format json
# Returns: {"success":false,"error":{"code":"VALIDATION_FILE_NOT_FOUND",...},"meta":{...}}
```

**SPARQL query with JSON output (for MCP tools):**

```bash
exocortex sparql query "SELECT ?s WHERE { ?s ?p ?o }" --vault ~/vault --output json
```

**Script integration:**

```bash
#!/bin/bash
result=$(exocortex command start "tasks/task.md" --vault ~/vault --format json)
success=$(echo "$result" | jq -r '.success')
if [ "$success" = "true" ]; then
  echo "Task started successfully"
else
  error_code=$(echo "$result" | jq -r '.error.code')
  case $error_code in
    VALIDATION_FILE_NOT_FOUND) echo "File not found - check path" ;;
    STATE_INVALID_TRANSITION) echo "Cannot start - check current status" ;;
    *) echo "Error: $error_code" ;;
  esac
fi
```

**MCP tool integration:**

```typescript
interface CLIResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    category: "validation" | "permission" | "state" | "internal";
    message: string;
    exitCode: number;
    recoveryHint?: {
      message: string;
      suggestion: string;
      docUrl?: string;
    };
  };
  meta: {
    timestamp: string;
    durationMs?: number;
  };
}

async function executeCommand(command: string): Promise<CLIResponse> {
  const result = await exec(`exocortex ${command} --format json`);
  return JSON.parse(result.stdout);
}

### Usage in Scripts

```bash
exocortex command start "tasks/task.md" --vault ~/vault
exit_code=$?

case $exit_code in
  0) echo "Success" ;;
  2) echo "Invalid arguments" ;;
  3) echo "File not found" ;;
  *) echo "Error: $exit_code" ;;
esac
```

---

## Common Options

These options are available for all commands:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--vault <path>` | string | `process.cwd()` | Path to Obsidian vault |
| `--format <type>` | enum | `text` | Output format: `text`, `json` (for MCP tools/automation) |
| `--dry-run` | boolean | `false` | Preview changes without modifying files (supported by some commands) |
| `--help` | boolean | - | Show help for command |
| `--version` | boolean | - | Show CLI version |

### Path Resolution

- **Relative paths**: Resolved relative to vault root
- **Absolute paths**: Used as-is but validated against vault root
- **Path validation**: Ensures path is within vault boundaries (prevents path traversal)

---

## Stability Guarantees

### Stable (v0.1.x)

The following are considered **stable** and covered by semantic versioning:

1. **Command names** - `sparql query`, `command start`, `command create-task`, etc.
2. **Argument positions** - First argument is always `<query>` for SPARQL, `<command-name>` then `<filepath>` for commands
3. **Required options** - `--label` for creation commands, `--date` for planning commands
4. **Exit codes** - Codes 0-8 as documented above
5. **Output formats** - `table`, `json`, `csv` for SPARQL queries

### Experimental

The following may change between minor versions:

1. **Output message text** - Console log messages (success/error formatting)
2. **Additional optional flags** - New non-breaking options may be added
3. **Performance characteristics** - Query optimization strategies

### Breaking Change Policy

Breaking changes will:
1. Only occur in major version bumps (v0.x → v1.0)
2. Be announced at least one minor version in advance
3. Provide migration guidance in release notes

See [VERSIONING.md](../VERSIONING.md) for complete versioning policy.
