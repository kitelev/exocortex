# Exocortex

**A semantic knowledge management system built on RDF, SPARQL, and ontology-driven architecture. Runs as an Obsidian plugin, CLI tool, or TypeScript library.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/kitelev/exocortex/actions/workflows/ci.yml/badge.svg)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-11400%2B-success)](https://github.com/kitelev/exocortex/actions)
[![Coverage](https://img.shields.io/badge/coverage-core%2095%25%20%7C%20plugin%2076%25%20%7C%20cli%2065%25-brightgreen)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)
[![SPARQL 1.2](https://img.shields.io/badge/SPARQL-1.2-blue)](./docs/sparql/SPARQL-1.2-Features.md)

---

## What It Does

- **Semantic knowledge graph** — every piece of knowledge is an Asset with UUID, class, properties, and relationships stored as RDF triples
- **SPARQL queries** — ask complex questions across your entire knowledge base
- **Modular ontologies** — IMS (concepts, notes, people), EMS (tasks, projects, meetings), ZTLK (zettelkasten)
- **Vault-driven architecture** — commands, workflows, property schemas, and prototype chains defined as vault assets, not hardcoded
- **Ontology plugins** — extend the system with installable ontology packages (e.g. [GTD + Jedi Techniques](https://github.com/kitelev/gtd-jedi))
- **Local-first** — all data stays on your device, no cloud required

---

## Quick Start

### Option 1: Obsidian Plugin (via BRAT)

Best for: Visual knowledge management, daily planning, interactive exploration.

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from Obsidian Community Plugins
2. Open BRAT settings → **Add Beta Plugin**
3. Enter repository: `kitelev/exocortex`
4. Click **Add Plugin** and enable Exocortex in Community plugins

BRAT will automatically keep the plugin updated with new releases.

### Option 2: CLI

Best for: Automation, AI agents, batch operations.

```bash
npm install -g @kitelev/exocortex-cli

# Query your knowledge graph
exocortex-cli sparql query "SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label
}" --vault ~/vault

# Complete a task
exocortex-cli command complete "tasks/my-task.md" --vault ~/vault
```

### Option 3: Core Library

Best for: Building custom applications.

```typescript
import { SparqlService, NodeFsAdapter } from "exocortex";

const sparql = new SparqlService(new NodeFsAdapter("/path/to/vault"));
const results = await sparql.query(`
  SELECT ?concept ?definition
  WHERE {
    ?concept exo:Instance_class ims:Concept .
    ?concept ims:Concept_definition ?definition .
  }
`);
```

---

## Key Features

### Asset — The Unit of Knowledge

Every piece of knowledge is a Markdown file with YAML frontmatter:

```yaml
---
exo__Asset_uid: 965fd5c2-808e-4c7e-8242-e2e5d85bd996
exo__Instance_class: ims__Concept
exo__Asset_label: "Exocortex"
exo__Asset_relates:
  - "[[PKM]]"
  - "[[Semantic Web]]"
---
Knowledge content in Markdown...
```

Assets are connected through typed relationships. Individual assets are information; connected assets become knowledge.

### SPARQL Queries

Ask complex questions about your knowledge:

```sparql
# Find all tasks related to a specific concept
SELECT ?task ?label WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task exo:Asset_relates ?concept .
  ?concept exo:Asset_label "Machine Learning" .
}
```

### Effort Lifecycle

Complete workflow from idea to completion with automatic timestamp tracking:

```
Draft → Backlog → Analysis → ToDo → Doing → Done
                     ↓
                  Trashed
```

### Workflow Customization

Define custom status lifecycles for your tasks and projects — all using regular vault assets:

```bash
exocortex-cli workflow list --vault ~/vault
exocortex-cli workflow validate <uid> --vault ~/vault
```

See **[Workflow Customization Guide](./docs/WORKFLOW_CUSTOMIZATION.md)** for details.

### Ontology-Driven Forms

Create assets with forms generated from your RDF ontology — fields appear based on `rdfs:domain`, types detected from `rdfs:range`.

### Layout Code Blocks

Embed Layout definitions directly in your notes:

````markdown
```exo-layout
[[emslayout__UpcomingTasksLayout]]
```
````

Features: wikilink syntax, loading state, error handling, auto-refresh, interactive sortable tables with inline editing.

### Ontology Plugins

Install community ontology packages to extend your knowledge graph:

```bash
exocortex-cli assetspace add @kitelev/gtd-jedi@^0.1
```

---

## Architecture

Monorepo with five packages sharing Clean Architecture core:

```
┌─────────────────────────────────────────────────────────────┐
│                      Exocortex System                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │   Obsidian   │  │     CLI      │  │  Core Library │      │
│   │   Plugin     │  │              │  │  (TypeScript) │      │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│          └─────────────────┼─────────────────┘               │
│                            │                                  │
│               ┌────────────▼────────────┐                     │
│               │     @exocortex/core     │                     │
│               │                         │                     │
│               │  • Domain models        │                     │
│               │  • SPARQL engine        │                     │
│               │  • Inference rules      │                     │
│               │  • Storage adapters     │                     │
│               └─────────────────────────┘                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Packages

| Package                        | npm                       | Purpose                                                                     |
| ------------------------------ | ------------------------- | --------------------------------------------------------------------------- |
| **exocortex**                  | Private                   | Core business logic, domain models, SPARQL engine, 35+ services             |
| **@exocortex/obsidian-plugin** | Private                   | Interactive UI: 24+ components, 6 renderers, 34+ commands, 11 modals        |
| **@kitelev/exocortex-cli**     | `@kitelev/exocortex-cli`  | CLI for automation, archive/unarchive, SPARQL queries, AI agent integration |
| **@exocortex/test-utils**      | Private                   | Shared test utilities, mock factories, flaky test reporter                  |
| **physics-wasm**               | Private                   | WebAssembly force simulation for 3D graph visualization                     |

### Technical Standards

- **Clean Architecture** — clear layer separation (presentation, application, domain, infrastructure)
- **SOLID Principles** — especially Single Responsibility
- **Domain-Driven Design** — knowledge domain as system center
- **Semantic Web** — RDF, SPARQL 1.2, OWL, RDF-Star
- **Local-first** — your data stays local, cloud is optional

### SPARQL 1.2 Support

| Feature                       | Description                                          |
| ----------------------------- | ---------------------------------------------------- |
| **LATERAL Joins**             | Correlated subqueries for "top N per group" patterns |
| **PREFIX\***                  | Auto-import prefixes from well-known vocabularies    |
| **DESCRIBE Options**          | DEPTH and SYMMETRIC control for DESCRIBE queries     |
| **Directional Language Tags** | RTL/LTR text direction support (`@ar--rtl`)          |
| **DateTime Arithmetic**       | Native date/time subtraction and duration operations |
| **NORMALIZE/FOLD**            | Unicode normalization and case folding               |

See **[SPARQL 1.2 Features](./docs/sparql/SPARQL-1.2-Features.md)** for complete documentation.

---

## Documentation

### Getting Started

- **[Installation Guide](./docs/Getting-Started.md)** — Step-by-step setup

### By Interface

**Obsidian Plugin:**

- **[Command Reference](./docs/Command-Reference.md)** — All 34+ commands documented

**CLI:**

- **[CLI Command Reference](./docs/cli/Command-Reference.md)** — Complete syntax
- **[Scripting Patterns](./docs/cli/Scripting-Patterns.md)** — Automation examples

**Core Library:**

- **[Core API Reference](./docs/api/Core-API.md)** — TypeScript API
- **[Architecture Guide](./ARCHITECTURE.md)** — Clean Architecture patterns

### SPARQL & Semantic Queries

- **[SPARQL User Guide](./docs/sparql/User-Guide.md)** — Tutorial from basics to advanced
- **[Query Examples](./docs/sparql/Query-Examples.md)** — 30+ ready-to-use patterns
- **[SPARQL 1.2 Features](./docs/sparql/SPARQL-1.2-Features.md)** — LATERAL, PREFIX\*, directionality, and more
- **[SPARQL 1.2 Migration](./docs/sparql/SPARQL-1.2-Migration.md)** — Upgrading from SPARQL 1.1
- **[ExoQL Specification](./docs/ExoQL-Specification.md)** — Full query language specification

### Graph View & Visualization

- **[Graph View Overview](./docs/graph-view/README.md)** — Introduction to 2D and 3D graph visualization
- **[3D Visualization Guide](./docs/graph-view/guides/3d-visualization.md)** — WebGL-powered 3D graph exploration
- **[Configuration Reference](./docs/graph-view/guides/configuration.md)** — All configuration options for graph views
- **[Inference & Reasoning Guide](./docs/graph-view/guides/inference.md)** — RDFS/OWL inference, neighborhood exploration

---

## Development

```bash
git clone https://github.com/kitelev/exocortex
cd exocortex
npm install
npm run build
npm run test:all
```

This project is developed primarily by AI agents (Claude Code, GitHub Copilot) following documented patterns. Human contributions welcome!

### AI Development Resources

| Document                                                         | Purpose                             |
| ---------------------------------------------------------------- | ----------------------------------- |
| **[CLAUDE.md](./CLAUDE.md)**                                     | AI agent guidelines, worktree rules |
| **[AI Development Patterns](./docs/AI-DEVELOPMENT-PATTERNS.md)** | Lessons from 1250+ completed issues |
| **[Architecture Guide](./ARCHITECTURE.md)**                      | Clean Architecture patterns         |
| **[Architecture Decision Records](./docs/adr/)**                 | Key architectural decisions (ADRs)  |

---

## Vision

For the full philosophical vision, long-term roadmap, and 42 unique IT ideas behind the project, see **[VISION.md](./VISION.md)**.

---

## License

MIT License — see [LICENSE](./LICENSE)
