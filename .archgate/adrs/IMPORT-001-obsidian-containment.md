---
id: IMPORT-001
title: Obsidian API Containment
domain: frontend
rules: true
files:
  [
    "packages/obsidian-plugin/src/**/*.ts",
    "packages/obsidian-plugin/src/**/*.tsx",
  ]
---

# Obsidian API Containment

## Context

Obsidian API imports must be contained in presentation and infrastructure layers. Application and domain layers in the plugin package must remain framework-agnostic.

This complements ARCH-008 (which protects packages/exocortex) by protecting layers within the obsidian-plugin package itself.

## Decision

- `import from "obsidian"` allowed ONLY in:
  - `packages/obsidian-plugin/src/presentation/` (UI components, modals, renderers)
  - `packages/obsidian-plugin/src/infrastructure/` (adapters)
  - `packages/obsidian-plugin/src/main.ts` (plugin entry point)
- Forbidden in:
  - `packages/obsidian-plugin/src/application/` (use cases)
  - `packages/obsidian-plugin/src/domain/` (business rules)

## References

- [ADR-0008: Clean Architecture](../../docs/adr/0008-clean-architecture-adoption.md)
- ARCH-008 Archgate rules (core package protection)
