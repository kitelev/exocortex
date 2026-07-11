# @kitelev/exocortex-cli

Command-line interface for the Exocortex knowledge management system. Query and mutate an Obsidian vault as an RDF knowledge graph from the terminal — no Obsidian required.

## Installation

```bash
npm install -g @kitelev/exocortex-cli
```

Or run directly with npx (recommended — always resolves the published version):

```bash
npx @kitelev/exocortex-cli <command> [options]
```

The installed binary is named `exocortex-cli`. All examples below use the npx form.

## CLI v16 Surface

Since v16.0 (RFC 8e83442b) the CLI follows a Unix-style surface built around **five core verbs** — `find`, `apply`, `query`, `index`, `validate` — plus auxiliary commands retained from v15.

The following v15 verbs were **removed**: `batch`, `batch-repair`, `command`, `dyncommand`, `exoql`, `convert`, `sparql` (deprecated alias).

| Removed verb             | v16 replacement                                                                 |
| ------------------------ | ------------------------------------------------------------------------------- |
| `sparql query` / `exoql` | `query` (top-level)                                                             |
| `sparql index`           | `index` (top-level)                                                             |
| `command <name> <path>`  | `apply <cmd> [path]` — semantics live in vault-defined `exocmd__Command` assets |
| `dyncommand list`        | `find --class exocmd__Command`                                                  |
| `dyncommand exec`        | `apply` with `--dry-run` / `--yes` / `--input`                                  |
| `batch` / `batch-repair` | pipe `find` output into `apply` (multi-target stdin)                            |
| `convert`                | `query` with a CONSTRUCT query and `--format ntriples`                          |

**Documentation:**

- [CLI API Reference](docs/CLI_API_REFERENCE.md) — pointer to this README plus exit codes and JSON response contract
- [Versioning Policy](VERSIONING.md)
- [SPARQL Guide](docs/SPARQL_GUIDE.md) — complete query reference
- [SPARQL Cookbook](docs/SPARQL_COOKBOOK.md) — real-world query examples
- [Ontology Reference](docs/ONTOLOGY_REFERENCE.md) — available predicates

## Command Overview

| Command                                   | Purpose                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| [`find`](#find)                           | Select vault assets via SPARQL or class filter; prints file paths one per line     |
| [`apply`](#apply)                         | Apply a vault-defined `exocmd__Command` to one or more assets                      |
| [`query`](#query)                         | Execute a SPARQL query against the vault                                           |
| [`index`](#index)                         | Build or refresh the persistent triple cache                                       |
| [`validate`](#validate)                   | Validate vault files: `iri`, `schema`, `frontmatter`                               |
| [`classes`](#classes)                     | List vault classes or describe one class                                           |
| [`create`](#create)                       | Create a new vault asset with auto-generated UUID and frontmatter                  |
| [`resolve`](#resolve)                     | Resolve a UUID (full or partial) to a file path                                    |
| [`workflow`](#workflow)                   | List / show / validate workflow definitions                                        |
| [`recover`](#recover)                     | Detect and recover orphaned claude-child tmux sessions                             |
| [`scaffold`](#scaffold)                   | Scaffold homoiconic configuration assets (validation-check settings)               |
| [`audit`](#audit)                         | Regression-pattern audits (`co-location`, `ontology-imports`)                      |
| [`apply-profile`](#apply-profile)         | Apply an `exo__Profile` (mount-state filesystem mutation)                          |
| [`bootstrap`](#bootstrap)                 | Bootstrap a vault with the SDK floor AssetSpace                                    |
| [`assetspace-add`](#assetspace-add)       | Add a single AssetSpace to a vault by GitHub URL                                   |
| [`assetspace-remove`](#assetspace-remove) | Unmount a single AssetSpace from a vault (inverse of `assetspace-add`)             |
| [`exosync`](#exosync)                     | Sync / pull / push the materialized AssetSpace set over the GitHub REST API        |
| [`exosync-parity`](#exosync-parity)       | Read-only ExoSync divergence report (M1/M2 parity check)                           |
| [`resolve-deps`](#resolve-deps)           | Resolve an AssetSpace's transitive `dependsOn` closure from the registry (CI gate) |
| [`requirements`](#requirements)           | Requirements↔test traceability checker (RFC 0003)                                  |

---

## Core Verbs

### find

Find vault assets via SPARQL — outputs vault-relative file paths one per line on stdout. Designed to compose with `xargs`, `apply`, or any other Unix tool.

```bash
npx @kitelev/exocortex-cli find --class ems__Task --vault ~/vault
```

**Options:**

| Option             | Default | Description                                                                                   |
| ------------------ | ------- | --------------------------------------------------------------------------------------------- |
| `--vault <path>`   | cwd     | Path to Obsidian vault                                                                        |
| `--also <path>`    | —       | Additional vault to include (repeatable)                                                      |
| `--sparql <query>` | —       | SPARQL SELECT query (must bind `?path`)                                                       |
| `--class <value>`  | —       | Filter by class label via the vault's `find__Alias` asset labelled `class` (e.g. `ems__Task`) |

Exactly one of `--sparql` or `--class` is required; they are mutually exclusive. `--class` requires a `find__Alias` asset with `exo__Asset_label: class` in the vault.

**Examples:**

```bash
# All tasks, raw SPARQL form
npx @kitelev/exocortex-cli find --vault ~/vault --sparql "
  SELECT ?path WHERE {
    ?s exo:Instance_class ems:Task .
    BIND(?s AS ?path)
  }"

# Compose with apply: archive every matching asset
npx @kitelev/exocortex-cli find --class ems__Task --vault ~/vault \
  | npx @kitelev/exocortex-cli apply <archive-command-uuid> --vault ~/vault --yes
```

### apply

Apply a vault-defined `exocmd__Command` to one or more vault assets. The command's semantics (precondition SPARQL ASK + grounding) live entirely in RDF assets in the vault.

```bash
npx @kitelev/exocortex-cli apply <cmd> [path] [options]
```

**Arguments:**

| Argument | Description                                                                           |
| -------- | ------------------------------------------------------------------------------------- |
| `<cmd>`  | UUID of an `exocmd__Command` asset, or its `exocmd__Command_cliName` slug             |
| `[path]` | Vault-relative path to the target asset; omit to read paths from stdin (one per line) |

**Options:**

| Option                 | Default | Description                                                       |
| ---------------------- | ------- | ----------------------------------------------------------------- |
| `--vault <path>`       | cwd     | Path to Obsidian vault                                            |
| `--dry-run`            | off     | Evaluate precondition and preview; do not write                   |
| `--yes`                | off     | Skip destructive-command confirmation                             |
| `--input <json>`       | —       | JSON object forwarded to `service_call` groundings as `userInput` |
| `--seed <uuid>`        | —       | Deterministic UID seed for test/replay                            |
| `--frozen-clock <iso>` | —       | Freeze clock to an ISO timestamp for test/replay                  |

**Behavior:**

- The precondition is evaluated per target; a non-passing ASK aborts before the grounding runs.
- Commands marked `exocmd__Command_destructive: true` refuse to run without `--dry-run` or `--yes`.
- Multi-target runs (stdin) use continue-on-error semantics and print a `N/M` summary; the exit code is `5` if any target failed.

**Examples:**

```bash
# Single target
npx @kitelev/exocortex-cli apply 6e050240-58e9-4695-9dce-d73fc32cc1d7 \
  "tasks/abc-123.md" --vault ~/vault

# Preview without writing
npx @kitelev/exocortex-cli apply <uuid> "tasks/abc-123.md" --dry-run --vault ~/vault

# Pass userInput to a service_call grounding
npx @kitelev/exocortex-cli apply <uuid> "daily/2026-05-02.md" \
  --input '{"label":"Lunch — vegetable soup"}' --vault ~/vault

# Bulk: pipe a find selection through apply
npx @kitelev/exocortex-cli find --class ems__Task --vault ~/vault \
  | npx @kitelev/exocortex-cli apply <uuid> --vault ~/vault
```

### query

Execute a SPARQL query against the vault. Supports SELECT, ASK, and CONSTRUCT forms.

```bash
npx @kitelev/exocortex-cli query "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10" --vault ~/vault
```

**Arguments:**

| Argument  | Description                                                                        |
| --------- | ---------------------------------------------------------------------------------- |
| `[query]` | SPARQL query string or path to a `.sparql` file (optional if `--template` is used) |

**Options:**

| Option                  | Default | Description                                                                                  |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `--vault <path>`        | cwd     | Path to Obsidian vault                                                                       |
| `--also <path>`         | —       | Additional vault to include in the query (repeatable)                                        |
| `--format <type>`       | `table` | Output format: `table`, `json`, `csv`, `ntriples`                                            |
| `--output <type>`       | `text`  | Response format: `text` or `json` (for MCP tools)                                            |
| `--timeout <duration>`  | `30s`   | Query timeout (e.g. `30s`, `5000ms`); env fallback `EXOCORTEX_SPARQL_TIMEOUT`                |
| `--dry-run`             | off     | Validate query syntax without executing (no vault loading)                                   |
| `--explain`             | off     | Show the optimized query plan                                                                |
| `--stats`               | off     | Show execution statistics                                                                    |
| `--no-optimize`         | —       | Disable query optimization                                                                   |
| `--use-cache`           | off     | Use the persistent triple cache (faster vault loading)                                       |
| `--cache-ttl <seconds>` | `300`   | Query result cache TTL in seconds                                                            |
| `--no-cache`            | —       | Bypass the query result cache                                                                |
| `--template <name>`     | —       | Use a predefined query template                                                              |
| `--param <params>`      | —       | Template parameters (`key=value,key2=value2`)                                                |
| `--strict`              | off     | Fail on unresolved label-form wikilinks in property paths (sets `EXOCORTEX_SPARQL_STRICT=1`) |

**Built-in templates:** `tasks-by-date`, `tasks-by-status`, `projects-active`, `concepts-by-domain`, `sleep-analysis`.

**Examples:**

```bash
# Find all tasks
npx @kitelev/exocortex-cli query \
  "PREFIX exo: <https://exocortex.my/ontology/exo#>
   PREFIX ems: <https://exocortex.my/ontology/ems#>
   SELECT ?task ?label WHERE {
     ?task exo:Instance_class ems:Task .
     ?task exo:Asset_label ?label .
   }" --vault ~/vault

# Cross-vault query (repeatable --also)
npx @kitelev/exocortex-cli query "SELECT ?s WHERE { ?s ?p ?o }" \
  --vault ~/vault --also ~/vault-archive

# Template with parameters
npx @kitelev/exocortex-cli query --template tasks-by-date --param date=2026-01-15 --vault ~/vault

# Graph dump (CONSTRUCT) as N-Triples
npx @kitelev/exocortex-cli query "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }" \
  --format ntriples --vault ~/vault > vault.nt
```

### index

Build or refresh the persistent triple cache used by `--use-cache` consumers. The cache lives at `<vault>/.exocortex/cache/triples.json`.

```bash
npx @kitelev/exocortex-cli index --vault ~/vault --stats
```

**Options:**

| Option            | Default | Description                                                    |
| ----------------- | ------- | -------------------------------------------------------------- |
| `--vault <path>`  | cwd     | Path to Obsidian vault                                         |
| `--also <path>`   | —       | Additional vault to include in the combined index (repeatable) |
| `--output <type>` | `text`  | Response format: `text` or `json`                              |
| `--stats`         | off     | Show cache statistics after building                           |
| `--force`         | off     | Force rebuild even if the cache is valid                       |
| `--strict`        | off     | Fail on the first invalid IRI instead of skipping              |
| `--no-inference`  | —       | Disable RDFS `subClassOf` inference materialization            |

### validate

Validate vault files. Parent command with `schema` and `vault` subcommands.

```bash
npx @kitelev/exocortex-cli validate <schema|vault> [options]
```

#### validate schema

Check frontmatter properties against the ontology (schema linting), or run SHACL-lite shapes validation with `--shapes-mode`. Exits `1` if violations are found.

| Option            | Default | Description                                                                            |
| ----------------- | ------- | -------------------------------------------------------------------------------------- |
| `--vault <path>`  | cwd     | Path to Obsidian vault                                                                 |
| `--also <path>`   | —       | Additional vault merged into the validation graph (repeatable; disables `--use-cache`) |
| `--output <type>` | `text`  | Response format: `text` or `json`                                                      |
| `--staged`        | off     | Only validate git-staged `.md` files (for pre-commit hooks)                            |
| `--use-cache`     | off     | Use the persistent triple cache (ignored when `--also` is set)                         |
| `--shapes-mode`   | off     | Run SHACL-lite shapes validation instead of schema linting                             |
| `--format <type>` | `text`  | Shapes-mode output format: `text`, `json`, `earl`                                      |
| `--class <iri>`   | —       | Only validate assets whose `exo__Instance_class` matches this IRI/slug                 |

```bash
# Strict SHACL-lite validation of the whole vault
npx @kitelev/exocortex-cli validate schema --shapes-mode --vault ~/vault

# Pre-commit: lint only staged files
npx @kitelev/exocortex-cli validate schema --staged --vault ~/vault
```

---

## Auxiliary Commands

### classes

List all classes in the vault, or show details of one class. Alias: `describe-class`.

```bash
npx @kitelev/exocortex-cli classes --vault ~/vault
npx @kitelev/exocortex-cli classes ems__Task --vault ~/vault
```

| Argument / Option | Default | Description                                            |
| ----------------- | ------- | ------------------------------------------------------ |
| `[class-name]`    | —       | Optional class name to show details (e.g. `ems__Task`) |
| `--vault <path>`  | cwd     | Path to Obsidian vault                                 |
| `--format <type>` | `table` | Output format: `table` or `json`                       |
| `--output <type>` | `text`  | Response format: `text` or `json` (for MCP tools)      |
| `--use-cache`     | off     | Use the persistent cache (faster for repeated queries) |

### create

Create a new vault asset with auto-generated UUID, timestamps, and frontmatter. Resolves class short names to UUIDs and validates wikilinks in property values. New assets are written to the vault's `01 Inbox/` folder as `<uuid>.md`. On success a JSON object `{uuid, path, label}` is printed to stdout.

```bash
npx @kitelev/exocortex-cli create --class ztlk__PermanentNote --label "My Note" --vault ~/vault
```

| Option                       | Default       | Description                                             |
| ---------------------------- | ------------- | ------------------------------------------------------- |
| `--class <name>`             | **required**  | Class short name (e.g. `ztlk__PermanentNote`) or UUID   |
| `--label <text>`             | **required**  | Human-readable label for the asset                      |
| `--vault <path>`             | cwd           | Path to Obsidian vault                                  |
| `--aliases <names...>`       | —             | Additional aliases for the asset                        |
| `--property <key=value...>`  | —             | Property key-value pairs (repeatable)                   |
| `--body <text>`              | —             | Markdown body content (use `-` to read from stdin)      |
| `--body-file <path>`         | —             | Read body content from a file                           |
| `--dry-run`                  | off           | Preview the exact file content (stderr) without writing |
| `--created-by <uuid>`        | —             | Creator UUID                                            |
| `--timezone <tz>`            | `Asia/Almaty` | Timezone for timestamps                                 |
| `--skip-wikilink-validation` | off           | Skip wikilink existence validation                      |

```bash
# With custom properties and body from stdin
echo "# Content" | npx @kitelev/exocortex-cli create \
  --class ztlk__PermanentNote \
  --label "My Note" \
  --property "ztlk__Note_developedFrom=[[<uuid>]]" \
  --body - \
  --vault ~/vault
```

### resolve

Resolve a UUID (full or partial, minimum 4 hex characters) to a file path. Exits `1` if the UUID is not found.

```bash
npx @kitelev/exocortex-cli resolve a1b2c3d4-e5f6-7890-abcd-ef1234567890 --vault ~/vault
npx @kitelev/exocortex-cli resolve a1b2 --partial --format path --vault ~/vault
```

| Argument / Option | Default      | Description                                       |
| ----------------- | ------------ | ------------------------------------------------- |
| `<uuid>`          | **required** | Full or partial UUID to resolve                   |
| `--vault <path>`  | cwd          | Path to Obsidian vault                            |
| `--format <type>` | `uri`        | Output format: `uri`, `path`, or `json`           |
| `--output <type>` | `text`       | Response format: `text` or `json` (for MCP tools) |
| `--partial`       | off          | Match partial UUIDs (returns all matches)         |

### recover

Detect and recover orphaned `claude-child` tmux sessions. A session is orphaned when its corresponding vault task is not in Doing status. Default mode is dry-run.

```bash
npx @kitelev/exocortex-cli recover --vault ~/vault-2025
npx @kitelev/exocortex-cli recover --apply --vault ~/vault-2025
```

| Option           | Default                              | Description                                              |
| ---------------- | ------------------------------------ | -------------------------------------------------------- |
| `--vault <path>` | `$EXOCORTEX_VAULT` or `~/vault-2025` | Path to Obsidian vault                                   |
| `--dry-run`      | —                                    | List orphans without applying changes (default behavior) |
| `--apply`        | off                                  | Apply recovery: set Failed + kill the tmux session       |

### scaffold

Scaffold homoiconic configuration assets. Currently exposes one subcommand, `validation-settings`, which materializes the four validation-check `setting__Setting` instances (`uid-uniqueness=true`, the rest `false`) co-located in the chosen ontology's folder, so `validate vault` has an enabled-set to read (RFC f402002b).

```bash
npx @kitelev/exocortex-cli scaffold validation-settings \
  --vault ~/vault-2025 \
  --ontology <ontology-uid>
```

| Option             | Default      | Description                                                           |
| ------------------ | ------------ | --------------------------------------------------------------------- |
| `--vault <path>`   | **required** | Vault root directory                                                  |
| `--ontology <uid>` | **required** | UID of the ontology whose folder the check settings are co-located in |
| `--output <type>`  | `text`       | Response format: `text` \| `json`                                     |

---

## Vault Management Commands

### audit

Audit the vault for regression patterns. Parent command with subcommands.

#### audit co-location

Detect asset–ontology co-location violations: any asset not located in the folder of its `exo__Asset_isDefinedBy` ontology file. Fail-open with skip accounting — exits `0` when there are no violations (skips are still reported), `1` when one or more violations exist.

```bash
npx @kitelev/exocortex-cli audit co-location --vault ~/vault
```

Both subcommands: `--vault <path>` (**required**), `--output text|json` (default: `text`).

### apply-profile

Apply the specified `exo__Profile` (mount-state filesystem mutation): materialize the profile's effective AssetSpace set and tear down the rest. Requires `--yes` in headless mode — without it the command prints the plan decision and exits `0` without mutating.

```bash
npx @kitelev/exocortex-cli apply-profile <profile-uid> --vault ~/vault --yes --verbose
```

| Argument / Option | Default      | Description                                                                      |
| ----------------- | ------------ | -------------------------------------------------------------------------------- |
| `<profile-uid>`   | **required** | Target Profile UID                                                               |
| `--vault <path>`  | **required** | Path to Obsidian vault                                                           |
| `--yes`           | off          | Confirm apply (headless safety override)                                         |
| `--verbose`       | off          | Print the plan summary to stderr before deciding                                 |
| `--ref <branch>`  | `main`       | Git ref to pull when materializing AssetSpaces                                   |
| `--token <pat>`   | —            | GitHub PAT for private-repo materialization (or env `GITHUB_TOKEN` / `GH_TOKEN`) |

Refuses (exit `5`) when profile resolution is degraded or the plan would strip the TS-floor AssetSpaces. Use `find --class exo__Profile` to list available profiles.

### bootstrap

Bootstrap a vault with the SDK floor AssetSpace (`exo`). Pulls tarballs from public GitHub repos, extracts to `assetspaces/`, and writes `.gitmodules`. Only `--exo` is required; `--exocmd` (the optional UI-command library) is opt-in.

```bash
npx @kitelev/exocortex-cli bootstrap \
  --vault ~/new-vault \
  --exo https://github.com/kitelev/exoas-exo \
  --exocmd https://github.com/kitelev/exoas-exocmd
```

| Option           | Default      | Description                                                                                 |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `--vault <path>` | **required** | Path to the target vault                                                                    |
| `--exo <url>`    | **required** | Public GitHub URL of the exo TBox AssetSpace                                                |
| `--exocmd <url>` | —            | Optional GitHub URL of the exocmd UI-command AssetSpace; omit for a bare SDK/headless vault |
| `--ref <branch>` | `main`       | Branch ref to pull from                                                                     |
| `--token <pat>`  | —            | GitHub PAT for private repos (or env `GITHUB_TOKEN` / `GH_TOKEN`)                           |
| `--json`         | off          | Emit result as JSON                                                                         |

### assetspace-add

Add a single AssetSpace to an existing vault by public GitHub URL. Pulls a tarball, extracts to `assetspaces/<folder>/`, and updates `.gitmodules`. The default folder name is derived from the URL (`exoas-pmbok` → `pmbok`).

```bash
npx @kitelev/exocortex-cli assetspace-add \
  --vault ~/vault \
  --url https://github.com/kitelev/exoas-pmbok-ontology
```

| Option            | Default      | Description                                                       |
| ----------------- | ------------ | ----------------------------------------------------------------- |
| `--vault <path>`  | **required** | Path to the target vault                                          |
| `--url <url>`     | **required** | Public GitHub URL of the AssetSpace                               |
| `--folder <name>` | URL-derived  | Local folder name under `assetspaces/`                            |
| `--ref <branch>`  | `main`       | Branch ref to pull from                                           |
| `--token <pat>`   | —            | GitHub PAT for private repos (or env `GITHUB_TOKEN` / `GH_TOKEN`) |
| `--json`          | off          | Emit result as JSON                                               |

### assetspace-remove

Unmount a single AssetSpace from a vault — the inverse of [`assetspace-add`](#assetspace-add). Strips the AssetSpace's `.gitmodules` stanza and deletes its mount folder. TS-floor AssetSpaces (`{exo}`) are refused (removing the floor would self-brick the engine).

```bash
npx @kitelev/exocortex-cli assetspace-remove \
  --vault ~/vault \
  --folder assetspaces/kitelev/exoas-pmbok-ontology
```

| Option            | Default      | Description                                                                                                            |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `--vault <path>`  | **required** | Path to the target vault                                                                                               |
| `--folder <path>` | —            | Vault-relative mount path to unmount (e.g. `assetspaces/kitelev/exoas-pmbok-ontology`). Takes precedence over `--url`. |
| `--url <url>`     | —            | Public GitHub URL of the AssetSpace — derives the canonical mount path (parity with `assetspace-add`).                 |
| `--json`          | off          | Emit result as JSON                                                                                                    |

Provide exactly one of `--folder` or `--url`.

### exosync

ExoSync over the GitHub REST API — the CLI counterpart of the plugin's **`Exocortex: Sync`** command (RFC `4e4dc453` Phase B). Syncs the **materialized** AssetSpace/FileSpace set against each space's GitHub repository; no `git` binary required. Three direction subcommands share the same options. See [docs/exosync.md](../../docs/how-to/exosync.md) for the full sync model, merge layer, and conflict quarantine.

```bash
npx @kitelev/exocortex-cli exosync sync --vault ~/vault --token-from-gh   # full pull→merge→push
npx @kitelev/exocortex-cli exosync pull --vault ~/vault --token-from-gh   # apply remote only
npx @kitelev/exocortex-cli exosync push --vault ~/vault --token-from-gh   # send local delta only
```

| Subcommand | Description                                                                       |
| ---------- | --------------------------------------------------------------------------------- |
| `sync`     | Full pull → merge → push cycle for every materialized repo                        |
| `pull`     | Apply remote changes only (nothing leaves the device; local changes re-derive)    |
| `push`     | Send the local delta only (remote changes pin to re-derive on the next pull/sync) |

All three accept:

| Option                    | Default      | Description                                                                             |
| ------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `--vault <path>`          | **required** | Vault root path                                                                         |
| `--config-dir <name>`     | `.obsidian`  | Obsidian config dir name (watermark location)                                           |
| `--quarantine-repo <url>` | —            | Quarantine repo URL (`https://github.com/<owner>/<repo>`) — **required for FileSpaces** |
| `--token <pat>`           | —            | GitHub PAT (or env `GITHUB_TOKEN` / `GH_TOKEN`). Prefer `--token-from-gh`.              |
| `--token-from-gh`         | off          | Resolve the PAT via `gh auth token`                                                     |
| `--json`                  | off          | Print the full per-repo result array as JSON                                            |
| `--api-base <url>`        | —            | GitHub API base (testing)                                                               |

Exit codes: `0` all clean · `1` at least one repo unresolved/errored · `2` vacuous (no materialized AssetSpaces found).

> ⚠ Do not run the CLI sync while the plugin is mid-sync on the same vault — the in-flight guard is per-process (watermark write is last-writer-wins across processes).

### exosync-parity

Read-only ExoSync divergence report (RFC `4e4dc453` Phase E, M1/M2). Compares the materialized sync units against their remote heads **without writing** — useful for verifying that a vault is in sync, or auditing a parallel-run.

```bash
npx @kitelev/exocortex-cli exosync-parity --vault ~/vault --token-from-gh
```

| Option                | Default      | Description                                                                |
| --------------------- | ------------ | -------------------------------------------------------------------------- |
| `--vault <path>`      | **required** | Vault root path                                                            |
| `--config-dir <name>` | `.obsidian`  | Obsidian config dir name (watermark location)                              |
| `--token <pat>`       | —            | GitHub PAT (or env `GITHUB_TOKEN` / `GH_TOKEN`). Prefer `--token-from-gh`. |
| `--token-from-gh`     | off          | Resolve the PAT via `gh auth token`                                        |
| `--json`              | off          | Print the full round record as JSON                                        |
| `--api-base <url>`    | —            | GitHub API base (testing)                                                  |

Exit codes: `0` in parity · `1` divergence found · `2` vacuous (no materialized sync units).

### resolve-deps

Resolve an AssetSpace repo's transitive `dependsOn` closure from the central registry and print dependency clone URLs (issue #3513). Primarily used by the **per-AssetSpace SHACL CI gate** to materialize dependent TBox before validation.

```bash
npx @kitelev/exocortex-cli resolve-deps \
  --registry ./exoas-registry \
  --self kitelev/exoas-ems-ontology
```

| Option              | Default      | Description                                                                                                                    |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `--registry <path>` | **required** | Path to a checked-out central registry (`kitelev/exoas-registry`)                                                              |
| `--self <id>`       | **required** | Identity of the calling repo: an `owner/repo` slug (matches GitHub's `github.repository`), a full git URL, or a bare namespace |
| `--format <type>`   | `urls`       | Output format: `urls` (one clone URL per line) or `json` (full diagnostics)                                                    |
| `--strict`          | off          | Exit non-zero (`2`) when `self` is not registered, instead of validating standalone                                            |

### requirements

Requirements-management tooling (RFC 0003). The `requirements audit` subcommand checks requirement↔test traceability — orphan requirements, dangling `@req:<uid>` tags, duplicate bindings, the binding-class floor, coverage, and P0 ramp-readiness. Used by the `requirements-trace` CI job.

```bash
npx @kitelev/exocortex-cli requirements audit \
  --reqs ./exoas-exo-reqs \
  --tests .
```

| Option            | Default      | Description                                                                            |
| ----------------- | ------------ | -------------------------------------------------------------------------------------- |
| `--reqs <path>`   | **required** | Directory tree containing `req__Requirement` assets (a vault or a reqs assetspace)     |
| `--tests <path>`  | `.`          | Test-corpus root scanned for `@req:<uid>` tags                                         |
| `--output <type>` | `text`       | Response format: `text` \| `json`                                                      |
| `--strict`        | off          | Also exit `1` on orphan requirements                                                   |
| `--gate <mode>`   | `soft`       | Gate mode: `soft` (warn only) \| `hard` (also block when the P0 checklist isn't ready) |

---

## Exit Codes

All commands use standardized exit codes following Unix conventions (`src/utils/ExitCodes.ts`):

| Code | Constant                   | Description                                     |
| ---- | -------------------------- | ----------------------------------------------- |
| `0`  | `SUCCESS`                  | Command completed successfully                  |
| `1`  | `GENERAL_ERROR`            | General error (catch-all)                       |
| `2`  | `INVALID_ARGUMENTS`        | Invalid command-line arguments or options       |
| `3`  | `FILE_NOT_FOUND`           | File or directory not found                     |
| `4`  | `PERMISSION_DENIED`        | Permission denied (file system access)          |
| `5`  | `OPERATION_FAILED`         | Command execution failed (business logic error) |
| `6`  | `INVALID_STATE_TRANSITION` | Invalid asset state transition                  |
| `7`  | `TRANSACTION_FAILED`       | Atomic operation could not complete             |
| `8`  | `CONCURRENT_MODIFICATION`  | File changed during operation                   |

Validation commands (`validate schema`, `validate vault`, `audit co-location`, `audit ontology-imports`) exit `1` when issues/violations are found, for CI/pre-commit integration.

## Structured JSON Responses

Commands that accept `--output json` (e.g. `query`, `classes`, `resolve`, `index`, `validate`, `workflow`, `audit`) emit a structured response envelope for MCP tools and automation:

```json
{
  "success": true,
  "data": {},
  "meta": { "durationMs": 45, "itemCount": 3 }
}
```

On error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FILE_NOT_FOUND",
    "category": "validation",
    "message": "File not found: tasks/missing.md",
    "exitCode": 3,
    "recovery": { "message": "...", "suggestion": "..." }
  }
}
```

Error categories: `validation`, `permission`, `state`, `internal`. The full `ErrorCode` enum and response interfaces live in `src/responses/StructuredResponse.ts`; see [CLI API Reference](docs/CLI_API_REFERENCE.md) for the code tables.

## Architecture

The CLI is an ESM package (`"type": "module"`) that consumes the `exocortex` core package (RDF, SPARQL, services) through Node.js adapters:

```
packages/cli/
├── src/
│   ├── index.ts                 - Commander program: registers all commands
│   ├── adapters/                - FileSystemVaultAdapter, NodeFsAdapter
│   ├── commands/                - One module per command (find, apply, sparql-query, ...)
│   ├── services/                - CLI-side services (class resolution, archive, profile apply)
│   ├── cache/                   - Persistent triple cache (.exocortex/cache/triples.json)
│   ├── templates/               - Built-in SPARQL query templates
│   └── utils/                   - ErrorHandler, ExitCodes, prefix injection
└── dist/                        - Bundled output (esbuild)
```

## Requirements

- Node.js >= 18.0.0
- A vault with Exocortex-compatible markdown files (YAML frontmatter with `exo__*` properties)

## Development

```bash
# Install dependencies (run from the monorepo root)
npm install

# Build
npm run build

# Run locally
node dist/index.js --help

# Watch mode
npm run dev
```

## License

MIT
