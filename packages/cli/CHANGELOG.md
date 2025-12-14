# Changelog

All notable changes to @exocortex/cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

| Version | Release Date | Breaking Changes |
|---------|--------------|------------------|
| 0.1.0 | 2025-12-02 | Initial stable API |

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
