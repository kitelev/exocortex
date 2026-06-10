# CLI API Reference

> **Canonical per-command documentation lives in the [package README](../README.md).** Since CLI v16.0 (RFC 8e83442b) the surface is five core verbs — `find`, `apply`, `query`, `index`, `validate` — plus auxiliary commands. The v15 verbs `batch`, `batch-repair`, `command`, `dyncommand`, `exoql`, `convert`, and the `sparql` alias were removed; see the README migration table.
>
> This document keeps only the **machine contracts** that automation and MCP tools depend on: exit codes, the structured JSON response envelope, and the `watch` NDJSON event contract.

---

## Table of Contents

- [Exit Codes](#exit-codes)
- [Structured JSON Responses (MCP Compatible)](#structured-json-responses-mcp-compatible)
- [Watch NDJSON Event Contract](#watch-ndjson-event-contract)
- [Common Options](#common-options)
- [Stability](#stability)

---

## Exit Codes

All commands use standardized exit codes following Unix conventions (defined in `src/utils/ExitCodes.ts`):

| Code | Constant | Description |
|------|----------|-------------|
| `0` | `SUCCESS` | Command completed successfully |
| `1` | `GENERAL_ERROR` | General error (catch-all for non-specific errors) |
| `2` | `INVALID_ARGUMENTS` | Invalid command-line arguments or options |
| `3` | `FILE_NOT_FOUND` | File or directory not found |
| `4` | `PERMISSION_DENIED` | Permission denied (file system access) |
| `5` | `OPERATION_FAILED` | Command execution failed (business logic error) |
| `6` | `INVALID_STATE_TRANSITION` | Invalid asset state transition |
| `7` | `TRANSACTION_FAILED` | Transaction failed (atomic operation could not complete) |
| `8` | `CONCURRENT_MODIFICATION` | Concurrent modification detected (file changed during operation) |

Validation-style commands (`validate iri`, `validate schema`, `audit co-location`, `archive --verify`) exit `1` when issues or violations are found, so they can gate CI and pre-commit pipelines.

### Usage in Scripts

```bash
npx @kitelev/exocortex-cli validate schema --shapes-mode --vault ~/vault
exit_code=$?

case $exit_code in
  0) echo "Clean" ;;
  1) echo "Violations found" ;;
  2) echo "Invalid arguments" ;;
  3) echo "Vault not found" ;;
  *) echo "Error: $exit_code" ;;
esac
```

---

## Structured JSON Responses (MCP Compatible)

Commands that accept `--output json` (e.g. `query`, `ask`, `classes`, `resolve`, `index`, `validate`, `workflow`, `audit`) emit a structured response envelope. Types are defined in `src/responses/StructuredResponse.ts`.

### Success Response

```json
{
  "success": true,
  "data": { },
  "meta": { "durationMs": 45, "itemCount": 3 }
}
```

`meta` is optional; when present it may carry `durationMs`, `itemCount`, and command-specific keys.

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FILE_NOT_FOUND",
    "category": "validation",
    "message": "File not found: tasks/missing.md",
    "exitCode": 3,
    "recovery": {
      "message": "The file does not exist at the specified path",
      "suggestion": "Verify the file path and ensure it exists within the vault"
    },
    "context": { }
  }
}
```

`recovery` (optional) carries `message`, `suggestion?`, and `docUrl?`. `context` (optional) carries debugging details. `exitCode` mirrors the exit code the process would use in non-JSON mode.

### Error Categories

| Category | Description | Typical Action |
|----------|-------------|----------------|
| `validation` | Input validation failures (missing files, invalid arguments) | Fix input and retry |
| `permission` | Access control violations (file permissions) | Request appropriate access |
| `state` | Business logic violations (invalid state transitions) | Change current state first |
| `internal` | Unexpected errors (system failures) | Report bug or retry |

### Error Codes

| Category | Codes |
|----------|-------|
| `validation` | `VALIDATION_FILE_NOT_FOUND`, `VALIDATION_INVALID_PATH`, `VALIDATION_INVALID_ARGUMENTS`, `VALIDATION_MISSING_REQUIRED`, `VALIDATION_INVALID_FORMAT`, `VALIDATION_VAULT_NOT_FOUND` |
| `permission` | `PERMISSION_DENIED`, `PERMISSION_READ_ONLY` |
| `state` | `STATE_INVALID_TRANSITION`, `STATE_CONCURRENT_MODIFICATION`, `STATE_ASSET_NOT_TASK`, `STATE_ALREADY_EXISTS` |
| `internal` | `INTERNAL_TRANSACTION_FAILED`, `INTERNAL_OPERATION_FAILED`, `INTERNAL_QUERY_TIMEOUT`, `INTERNAL_UNKNOWN` |

### Script Integration

```bash
#!/bin/bash
result=$(npx @kitelev/exocortex-cli resolve "$UUID" --vault ~/vault --output json)
success=$(echo "$result" | jq -r '.success')
if [ "$success" = "true" ]; then
  echo "Resolved"
else
  error_code=$(echo "$result" | jq -r '.error.code')
  case $error_code in
    VALIDATION_FILE_NOT_FOUND) echo "UUID not found" ;;
    VALIDATION_VAULT_NOT_FOUND) echo "Check --vault path" ;;
    *) echo "Error: $error_code" ;;
  esac
fi
```

---

## Watch NDJSON Event Contract

`exocortex-cli watch` emits one JSON object per line on **stdout**; startup/status messages go to **stderr**. See the README for the option table.

### Event Shape

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
| `create` | File was created (detected via file birthtime < 1 second old) |
| `modify` | File was modified (existing file changed) |
| `delete` | File was deleted (file no longer exists) |

### Error Events

Watcher errors are emitted to stdout as structured error responses (same envelope as above, with `code: "INTERNAL_OPERATION_FAILED"`).

### Signal Handling

- **SIGINT** (Ctrl+C): graceful shutdown with exit code `0`
- **SIGTERM**: graceful shutdown with exit code `0`

### Debouncing

- Each file has its own debounce timer (default 100 ms, `--debounce <ms>`)
- Rapid changes to the same file are coalesced into a single event
- Changes to different files are tracked independently

### Pattern Matching

`--pattern` uses [minimatch](https://github.com/isaacs/minimatch) glob syntax:

| Pattern | Description |
|---------|-------------|
| `*.md` | All markdown files in root |
| `**/*.md` | All markdown files (recursive) |
| `tasks/**` | All files in tasks directory |
| `*.{md,txt}` | Markdown and text files |

### MCP Integration Example

```typescript
import { spawn } from "child_process";

const watcher = spawn("exocortex-cli", [
  "watch",
  "--vault", "/path/to/vault",
  "--asset-type", "ems__Task"
]);

watcher.stdout.on("data", (data) => {
  const lines = data.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    const event = JSON.parse(line);
    mcpServer.notify("resources/updated", {
      uri: `exocortex://task/${event.relativePath}`
    });
  }
});
```

---

## Common Options

Most commands accept:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--vault <path>` | string | `process.cwd()` (some commands require it explicitly) | Path to Obsidian vault |
| `--output <type>` | enum | `text` | Response format: `text`, `json` (for MCP tools/automation) |
| `--help` | boolean | — | Show help for command |
| `--version` | boolean | — | Show CLI version |

Per-command flags (including `--format`, `--dry-run`, `--also`, `--use-cache`) are documented in the [README](../README.md) — defaults vary by command.

---

## Stability

- The package is published as `@kitelev/exocortex-cli` and versioned in lockstep with the Exocortex monorepo (v16.x). Releases are automated on merge to `main`.
- The five core verbs (`find`, `apply`, `query`, `index`, `validate`), their argument positions, and exit codes `0`–`8` are the stable surface of CLI v16.
- Output message text (console formatting) and performance characteristics may change between minor versions; rely on exit codes and `--output json` envelopes, not console text.
- Commands under `experimental` are explicitly unstable and may change or be removed without notice.

See [VERSIONING.md](../VERSIONING.md) for the versioning policy.
