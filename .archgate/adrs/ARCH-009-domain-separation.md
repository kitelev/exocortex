---
id: ARCH-009
title: Domain Separation Strategy
domain: architecture
rules: false
---

# Domain Separation Strategy

Three autonomous packages with clear boundaries: `exocortex` (core), `obsidian-plugin` (presentation), `cli` (CLI).

Package boundary enforcement is covered by ARCH-008 rule `no-core-consumer-imports`.
