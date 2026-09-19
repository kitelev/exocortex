# Changelog

All notable changes to @kitelev/exocortex-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

**Persistent triple cache — delta on an unchanged-projection TBox-form asset; a reader's rebuild inherits the inferred layer (#4277, req 1117f9fe)**

- A MODIFIED TBox-form asset (`prefix__Name` label or alias — e.g. an `exo__SettingKey*`
  definition an `exosync pull` rewrote) no longer forces a full rebuild by itself. `planDelta`
  re-parses the changed file through the converter and compares its referrer-visible
  projection with the cached entry — the own `exo:Asset_label` IRI object (the symbolic IRI
  every `[[uid]]` referrer emits), the TBox-form `exo:Asset_aliases` set (what a
  `[[prefix__Name]]` link resolves through) and the `exo:Instance_class` objects (the type
  triples `emitTypeTripleForEnumInstance` co-emits into the referrer). Unchanged → an ordinary
  delta (only that file re-parsed, the inferred layer kept or re-materialized as before);
  any change to it, a TBox-form file added or removed, a label-NAMED (`prefix__Name.md`) file,
  or a converter-skipped entry (no readable projection) → the full rebuild exactly as before,
  with the same `rebuildReason` strings (`TBox-form asset changed` / `asset lost its TBox-form
label` / `TBox-form alias`) plus `TBox-form asset class changed` for the class case. The
  write-through (`--write-through`) folds the same change in as a delta instead of skipping it.
- A `--use-cache` reader that has to rebuild (rebuild-class diff, failed walk, over-threshold)
  now inherits the inferred layer of the cache it displaces: when that cache had
  `inferenceEnabled: true` the new cache is written with a freshly materialized layer and the
  flag kept, and the returned triples are explicit + inferred (`explicitCount` = explicit) —
  so a consumer that ran `index` once no longer has to run `index --force` again after every
  rebuild-class change. No readable cache, a legacy cache or `inferenceEnabled: false` keep
  the layer-less rebuild; `index` (`--no-inference` included) is unchanged.
- Measured on a copy of `vault-bot-kitelev` (16 687 files): touching one `exo__SettingKey*`
  file's `setting__SettingKey_datatype` turned the next `query --use-cache` from a full rebuild
  (18.1 s wall, 169 559 file reads, layer dropped) into a delta — numbers in PR #4277.

**Persistent triple cache — per-file manifest validity + delta refresh (#4263, req 42812747)**

- `CacheManager` no longer validates `.exocortex/cache/triples.json` by the vault root
  directory's mtime (which a nested `assetspaces/**` edit never touched, so `--use-cache`
  could serve stale triples). The cache now persists, per indexed `.md` file, its
  `{mtimeMs, size}` stamp and the triples it contributed; validity is a stat-walk diff
  against that manifest.
- A non-empty diff is refreshed incrementally: only the changed files — plus the files that
  refer to an added / removed target or to a target whose `aliases:` changed (by file-IRI and
  by lower-cased linkpath, which also matches the bare literal of an unresolved body
  `[[uid]]`) — are re-parsed via `NoteToRDFConverter.convertNote`, removed files' triples
  are dropped, and the inferred layer `index` materialized (RDFS + prototype chain) is
  re-materialized when one of the touched files feeds an inference engine
  (`exo__Instance_class` / `exo__Class_superClass` / `rdf:type` / `exo__Asset_prototype`),
  otherwise kept verbatim. A change to a TBox-form asset (`prefix__Name` label or alias,
  including a skipped zero-triple file), a FileSpace declaration added / edited / removed,
  a legacy or corrupt cache, a failed walk or a diff above 50 % of the vault falls back to
  a full rebuild.
- The cache file is written atomically (`triples.json.<pid>.<rand>.tmp` + rename), so
  concurrent `--use-cache` processes never read a torn file; orphaned temp files older than
  10 minutes are swept on the next write and on `index --force`.
- Cache format v2 (`metadata.formatVersion = 2`, `files[]`, `inferred[]`,
  `metadata.inferenceEnabled`, `fileSpacePrefixes` / `fileSpaceDeclarations`). Entries with
  an absolute / `..` path or a malformed stamp are rejected. A pre-existing cache is treated
  as invalid once and rebuilt; no migration.
- `query`, `classes`, `run-query` and `validate-schema` load the vault through one shared
  `loadVaultTriples(vaultPath, { useCache })` helper and report the mode: `query` / `classes`
  print "♻️ Cache refreshed incrementally (N file(s) re-parsed)" on a delta instead of
  "🚀 Cache hit!"; `meta.cacheHit` in the JSON output stays "full parse avoided" (true for
  a hit and for a delta).
- `index` persists only the inferred layer after materialization (`saveInferredTriples`,
  also when the layer is empty — that is what enables the delta path to materialize a
  prototype added later) instead of overwriting the whole cache with a flat, file-less
  triple list.
- Not incremental yet (follow-up #4267): the delta still rewrites the whole cache file and
  the adapter rebuilds its linkpath index on the first non-UUID link.

### Added

**`--use-cache` on `apply` / `resolve-inline-buttons` / `create`; write-through opt-in via `--write-through` (#4264, req cb707868)**

- `apply`, `resolve-inline-buttons` (alias `resolve-buttons`) and `create` accept `--use-cache`
  (default off). With it the triple store is built through the shared `loadVaultTriples()`
  loader — cache hit / delta / rebuild — instead of an unconditional full vault parse;
  `create` loads a triple store only under `--validate`, so that is where its flag applies
  (SHACL shape loading is a separate path, not covered). Without the flag the three commands
  are byte-identical to before: no cache read, no cache write.
- Two modes for a mutating `apply` / `create` under `--use-cache` (decision ae0b4fce, by
  measurement on a copy of the bot vault): `--use-cache` alone is **delta-only** — the
  writer never touches the cache file and the next `--use-cache` process folds the change
  in as its own delta (its preconditions see the write); `--use-cache --write-through` makes
  the writer pay that delta itself so the next process is a plain hit. Delta-only is the
  default because on the bot's 3-writer chain it is 1–3 s cheaper and 0.2–0.6 GB lighter in
  the writer; write-through only wins when readers outnumber writers — the consumer's call.
  `--write-through` without `--use-cache` is refused (exit 2, one stderr line) before
  anything is read or written.
- Write-through (`--write-through`): once an `apply` grounding has executed (or `create` has
  written its asset), the files it changed are folded into the persisted cache — the same
  delta as a reading process would run (only the changed files + their referrers re-parsed,
  atomic tmp+rename), so the next `--use-cache` process is a plain hit. A change the delta cannot express
  (TBox-form asset, FileSpace declaration, > 50 % of the vault) is left to the next reader's
  rebuild; an absent cache is never built by a mutating command. Best-effort by
  construction: a persist failure is one `⚠ triple cache:` stderr line, the command's exit
  code and stdout do not change, and the next reader refreshes the cache itself.
- Concurrency: the write-through diffs the vault against the cache state this process
  loaded and trusts that snapshot only while the cache FILE's `{mtimeMs,size}` stamp is the
  one it was read from — a concurrent `index` (inferred layer + `inferenceEnabled`) or
  another process's delta is re-read and folded into, never overwritten.
- One stderr line per cache phase (`⚡ triple cache: hit` / `♻️ … delta (N file(s)
re-parsed)` / `🔨 … rebuild`, and `💾 triple cache: write-through persisted (N file(s)
re-parsed)` / `— nothing changed` / `skipped (reason)` / `⚠ … failed (reason)`); stdout
  (`--json` envelopes, `create`'s `{uuid,path,label}`) is untouched.
- Documented divergence: on a cache that `index` built the flagged store additionally
  carries the inferred layer (RDFS `Instance_class` closure + prototype-chain inheritance),
  exactly as `query --use-cache` does — a precondition on an inherited/inferred triple can
  therefore evaluate differently than under the no-flag full parse. `index --no-inference`
  gives the explicit graph.

**RDF Convert / Vault Dump (#2832)**

- New `exocortex convert` subcommand to dump vault graph in RDF serialization formats.
- `--format turtle|ntriples|jsonld` — pick serialization (Turtle is default).
- `--out <path>` — write to file (default: stdout).
- `--filter <class>` — subset to instances of a class (`ems__Task`, `ems:Task`, or full IRI).
- Reuses existing `RDFSerializer` (`TurtleSerializer` / `NTriplesSerializer` / `JSONLDSerializer`)
  with default Exocortex namespace prefixes (`exo`, `ems`, plus `rdf`/`rdfs`/`owl`/`xsd`).
- Use cases: backup, offline analysis (Apache Jena, Protégé), feeding external
  SHACL engines, diffing two snapshots to surface graph drift.

## [0.1.0] - 2025-12-02

### Added

**API Stability Guarantees**

- Formal API reference documentation ([CLI_API_REFERENCE.md](docs/CLI_API_REFERENCE.md))
- Semantic versioning policy ([VERSIONING.md](VERSIONING.md))
- Stability tiers (Stable, Experimental, Internal)
- MCP integration guidelines

**SPARQL Query System**

- `exocortex sparql query` - Execute SPARQL 1.1 queries against vault
- Multiple output formats: `table`, `json`, `csv`
- Query plan visualization with `--explain`
- Performance statistics with `--stats`
- Query optimization (can be disabled with `--no-optimize`)

**Status Transition Commands**

- `exocortex command start` - Transition ToDo → Doing with timestamp
- `exocortex command complete` - Transition Doing → Done with timestamps
- `exocortex command trash` - Transition to Trashed status
- `exocortex command archive` - Set archived flag and remove aliases
- `exocortex command move-to-backlog` - Transition to Backlog status
- `exocortex command move-to-analysis` - Transition to Analysis status
- `exocortex command move-to-todo` - Transition to ToDo status

**Asset Creation Commands**

- `exocortex command create-task` - Create task with frontmatter
- `exocortex command create-meeting` - Create meeting with frontmatter
- `exocortex command create-project` - Create project with frontmatter
- `exocortex command create-area` - Create area with frontmatter
- Options: `--label`, `--prototype`, `--area`, `--parent`
- Auto-generated UUID v4 for `exo__Asset_uid`
- ISO timestamp for `exo__Asset_createdAt`

**Property Mutation Commands**

- `exocortex command rename-to-uid` - Rename file to match UID
- `exocortex command update-label` - Update label and sync aliases
- `exocortex command schedule` - Set planned start date
- `exocortex command set-deadline` - Set planned end date
- Support for `--dry-run` preview mode

**Infrastructure**

- Standardized exit codes (0-8) following Unix conventions
- Path validation with security checks
- Error handling with descriptive messages
- Node.js file system adapter

### Changed

- Updated README with current command structure
- Documented all implemented commands (previously some were in roadmap)

### Deprecated

- None

### Removed

- None

### Fixed

- None

### Security

- Path traversal prevention in `PathResolver`
- Vault boundary validation for all file operations

---

## Version History Summary

| Version | Release Date | Breaking Changes   |
| ------- | ------------ | ------------------ |
| 0.1.0   | 2025-12-02   | Initial stable API |

## Stability Notes

### Commands Marked Stable (v0.1.0)

The following commands are covered by semantic versioning guarantees:

- `exocortex sparql query`
- `exocortex command start`
- `exocortex command complete`
- `exocortex command trash`
- `exocortex command archive`
- `exocortex command move-to-backlog`
- `exocortex command move-to-analysis`
- `exocortex command move-to-todo`
- `exocortex command create-task`
- `exocortex command create-meeting`
- `exocortex command create-project`
- `exocortex command create-area`
- `exocortex command rename-to-uid`
- `exocortex command update-label`
- `exocortex command schedule`
- `exocortex command set-deadline`

See [VERSIONING.md](VERSIONING.md) for stability policy details.
