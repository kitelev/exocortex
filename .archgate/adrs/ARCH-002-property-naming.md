---
id: ARCH-002
title: Property Naming Convention
domain: data
rules: true
files: ["packages/exocortex/src/domain/**/*.ts"]
---

# Property Naming Convention

## Context

Exocortex uses an ontology-driven property system. All frontmatter properties must follow a strict naming convention to maintain consistency across the knowledge graph.

## Decision

Properties follow the format: `namespace__Class_property`

### Approved Namespaces

| Namespace | Domain                             |
| --------- | ---------------------------------- |
| `exo__`   | Core Exocortex                     |
| `ems__`   | Effort Management System           |
| `ims__`   | Information Management System      |
| `ztlk__`  | Zettelkasten                       |
| `ptms__`  | Personality Type Management System |
| `lit__`   | Literature                         |
| `inbox__` | Inbox                              |
| `req__`   | Requirements management (RFC 0003) |

## Do's and Don'ts

### Do

- Use approved namespace prefixes
- Follow `namespace__Class_property` format exactly
- Define new properties in domain constants

### Don't

- Invent custom namespace prefixes
- Use camelCase or snake_case for property names without namespace
- Mix naming conventions

## References

- [PROPERTY_SCHEMA.md](../../docs/reference/PROPERTY_SCHEMA.md)
