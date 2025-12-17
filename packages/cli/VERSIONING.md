# Versioning Policy

This document defines the semantic versioning policy for **@exocortex/cli**, establishing clear stability guarantees for API consumers including MCP tools and automation scripts.

---

## Table of Contents

- [Semantic Versioning](#semantic-versioning)
- [Version Components](#version-components)
- [What Constitutes a Breaking Change](#what-constitutes-a-breaking-change)
- [What Is NOT a Breaking Change](#what-is-not-a-breaking-change)
- [Stability Tiers](#stability-tiers)
- [Deprecation Policy](#deprecation-policy)
- [Version History](#version-history)
- [MCP Integration Guidelines](#mcp-integration-guidelines)

---

## Semantic Versioning

@exocortex/cli follows [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

### Current Version: 0.1.x (Pre-release)

During the 0.x phase:
- **MINOR** bumps may contain breaking changes
- **PATCH** bumps are backward-compatible bug fixes
- API is considered **stabilizing**, not fully stable

### Post-1.0 (Future)

After 1.0 release:
- **MAJOR** bumps contain breaking changes
- **MINOR** bumps add backward-compatible features
- **PATCH** bumps are backward-compatible bug fixes

---

## Version Components

### Major Version (Breaking Changes)

Increment major version when:

1. **Command renamed or removed**
   ```bash
   # Breaking: command renamed
   exocortex command start → exocortex effort start
   ```

2. **Required argument removed or reordered**
   ```bash
   # Breaking: argument order changed
   exocortex command <name> <path> → exocortex command <path> <name>
   ```

3. **Option behavior changed incompatibly**
   ```bash
   # Breaking: --format json output structure changed
   {"results": [...]} → {"bindings": [...]}
   ```

4. **Exit code meanings changed**
   ```bash
   # Breaking: exit code 3 now means something different
   3 = FILE_NOT_FOUND → 3 = NETWORK_ERROR
   ```

5. **Required option added to existing command**
   ```bash
   # Breaking: new required option
   exocortex command start <path> → exocortex command start <path> --confirm
   ```

### Minor Version (New Features)

Increment minor version when:

1. **New command added**
   ```bash
   # New: command added
   exocortex command unarchive <path>
   ```

2. **New optional flag added**
   ```bash
   # New: optional flag
   exocortex sparql query --timeout 30000
   ```

3. **New output format added**
   ```bash
   # New: format option
   --format yaml
   ```

4. **New exit code added**
   ```bash
   # New: additional exit code
   9 = TIMEOUT_EXCEEDED
   ```

### Patch Version (Bug Fixes)

Increment patch version when:

1. **Bug fixed without API change**
2. **Documentation updated**
3. **Performance improved**
4. **Internal refactoring (no API change)**

---

## What Constitutes a Breaking Change

### Definitely Breaking

| Category | Example |
|----------|---------|
| Command removal | `exocortex plan today` removed |
| Command rename | `create-task` → `new-task` |
| Argument removal | `<filepath>` argument removed |
| Argument reorder | Positional args swapped |
| Required option added | New mandatory `--confirm` flag |
| Option removal | `--dry-run` no longer supported |
| Exit code change | Code 3 meaning changed |
| Output format change | JSON structure modified |

### Borderline (Evaluated Case-by-Case)

| Category | Approach |
|----------|----------|
| Error message text | NOT breaking (messages are informational) |
| Console output formatting | NOT breaking (visual only) |
| Default value change | BREAKING if changes behavior |
| Option renamed with alias | NOT breaking if old name still works |

---

## What Is NOT a Breaking Change

The following changes are explicitly **NOT** considered breaking:

### 1. Console Output Changes

```bash
# Before
✅ Started: tasks/task.md
   Status: Doing

# After
✅ Started task: tasks/task.md
   New status: Doing
   Timestamp: 2025-12-02T10:30:00
```

Console messages are for human consumption. Scripts should rely on exit codes.

### 2. Performance Improvements

Query optimization changes, faster loading, reduced memory usage.

### 3. New Optional Flags

Adding `--verbose`, `--quiet`, `--debug` flags.

### 4. Internal Implementation Changes

Refactoring executors, changing internal architecture.

### 5. Documentation Updates

Clarifying existing behavior, adding examples.

---

## Stability Tiers

### Tier 1: Stable (Covered by SemVer)

Commands and options documented in [CLI_API_REFERENCE.md](docs/CLI_API_REFERENCE.md):

| Command | Status |
|---------|--------|
| `exocortex sparql query` | **Stable** |
| `exocortex command start` | **Stable** |
| `exocortex command complete` | **Stable** |
| `exocortex command trash` | **Stable** |
| `exocortex command archive` | **Stable** |
| `exocortex command move-to-backlog` | **Stable** |
| `exocortex command move-to-analysis` | **Stable** |
| `exocortex command move-to-todo` | **Stable** |
| `exocortex command create-task` | **Stable** |
| `exocortex command create-meeting` | **Stable** |
| `exocortex command create-project` | **Stable** |
| `exocortex command create-area` | **Stable** |
| `exocortex command rename-to-uid` | **Stable** |
| `exocortex command update-label` | **Stable** |
| `exocortex command schedule` | **Stable** |
| `exocortex command set-deadline` | **Stable** |

### Tier 2: Experimental

Commands marked as experimental may change between minor versions:

| Command | Notes |
|---------|-------|
| (none currently) | |

### Tier 3: Internal

Internal APIs not exposed via CLI are not covered by versioning:

- `CommandExecutor` TypeScript class
- `NodeFsAdapter` implementation
- Internal utility functions

---

## Deprecation Policy

### Pre-1.0 (Current)

During 0.x development:
- Breaking changes announced in release notes
- No formal deprecation period required
- Users should pin to specific minor versions

### Post-1.0 (Future)

After 1.0 release:

1. **Deprecation Warning**: Feature marked deprecated with console warning
2. **One Minor Version**: Deprecated feature continues to work
3. **Next Major Version**: Deprecated feature removed

### Deprecation Notice Format

```bash
$ exocortex command old-name "path/to/file.md"
⚠️  WARNING: 'old-name' is deprecated and will be removed in v2.0.
    Use 'new-name' instead.
✅ Command executed successfully
```

---

## Version History

### v0.1.0 (Current)

**Initial stable API release**

Commands established:
- SPARQL query execution (`sparql query`)
- Status transitions (`start`, `complete`, `trash`, `archive`, `move-to-*`)
- Asset creation (`create-task`, `create-meeting`, `create-project`, `create-area`)
- Property mutations (`rename-to-uid`, `update-label`)
- Planning (`schedule`, `set-deadline`)

Exit codes standardized (0-8).

---

## MCP Integration Guidelines

When wrapping @exocortex/cli in MCP tools:

### 1. Use Exit Codes for Status

```typescript
const result = await exec('exocortex command start "tasks/task.md"');
if (result.exitCode === 0) {
  return { success: true };
} else if (result.exitCode === 3) {
  return { error: 'File not found' };
}
```

### 2. Pin CLI Version

```json
{
  "dependencies": {
    "@exocortex/cli": "^0.1.0"
  }
}
```

### 3. Use JSON Output for Parsing

```typescript
const result = await exec('exocortex sparql query "..." --format json');
const bindings = JSON.parse(result.stdout);
```

### 4. Don't Parse Console Messages

Console messages are for humans. Use exit codes and JSON output for automation.

### 5. Handle Deprecation Warnings

```typescript
if (result.stderr.includes('WARNING: deprecated')) {
  logger.warn('CLI command deprecated, update MCP tool');
}
```

### 6. Version Compatibility Matrix

| @exocortex/cli | MCP Tool Compatibility |
|---------------|------------------------|
| 0.1.x | MCP tools targeting 0.1.x stable API |
| 0.2.x | May require MCP tool updates |
| 1.0.x | Stable, long-term support |

---

## Stability Commitment

### Current Commitment (v0.1.x)

We commit to:
1. **No breaking changes in patch versions** (0.1.0 → 0.1.1)
2. **Announce breaking changes in release notes** for minor versions
3. **Minimum 2-week stability period** before MCP integration recommended

### Post-1.0 Commitment (Future)

We will commit to:
1. **SemVer strict compliance**
2. **Minimum 6-month deprecation period** for breaking changes
3. **LTS releases** for major versions (18 months support)

---

## Questions?

For questions about versioning or API stability:
- Open an issue: [GitHub Issues](https://github.com/kitelev/exocortex/issues)
- Tag with `cli` and `api-stability` labels
