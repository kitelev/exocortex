---
id: DOC-001
title: Documentation Consistency
domain: documentation
rules: true
files: ["**/*.md", "packages/*/src/**/*.ts"]
---

# Documentation Consistency

## Context

AI-driven development at high velocity (10+ PRs/day) creates "documentation debt" — features are added, refactored, or removed faster than docs are updated. This leads to phantom features documented in README/ARCHITECTURE that no longer exist in code.

**Incident (2026-03-23)**: Deep audit found 9 phantom features in README.md including non-existent 3D Graph Visualization, broken Core Library API example, and references to unimplemented modules (PTMS, Simulacrum). Fixed in PRs #2393-#2410.

## Decision

### Feature-to-Doc Traceability

When source files defining a feature are created, modified, or deleted, all `.md` documentation files must be checked for references to that feature.

### What Counts as a Feature Change

- **Created**: New command, renderer, service, or module added
- **Renamed**: File or export renamed
- **Deleted**: File removed or feature deprecated
- **Moved**: File relocated to different path

### Documentation Files to Check

- `README.md` — User-facing features, packages table, examples
- `ARCHITECTURE.md` — Components, services, layers
- `VISION.md` — Implementation status column
- `docs/` — Feature-specific guides
- `CLAUDE.md` — Agent instructions with file paths and metrics

## Do's and Don'ts

### Do

- Update README.md when adding/removing user-facing features
- Update ARCHITECTURE.md when component counts change (commands, services, renderers, modals)
- Mark removed feature docs with deprecation notice instead of silent deletion
- Keep VISION.md status column current when features move from Planned → Implemented

### Don't

- Claim features exist in README that have no source code
- Leave docs for removed features without deprecation notice
- Reference file paths in .md files without verifying they exist
- Use "coming soon" for features with no planned implementation work
