# Exocortex

**A semantic knowledge management system built on RDF, SPARQL, and ontology-driven architecture. Runs as an Obsidian plugin, CLI tool, or TypeScript library.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/kitelev/exocortex/actions/workflows/ci.yml/badge.svg)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-11400%2B-success)](https://github.com/kitelev/exocortex/actions)
[![Coverage](https://img.shields.io/badge/coverage-core%2095%25%20%7C%20plugin%2075.5%25%20%7C%20cli%2065%25-brightgreen)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)
[![SPARQL 1.2](https://img.shields.io/badge/SPARQL-1.2-blue)](./docs/sparql/SPARQL-1.2-Features.md)

---

## Why Exocortex

Most tools separate data from configuration: you write content in one place and configure UI, workflows, and schemas in another. Exocortex takes a different approach — **Everything as Knowledge**.

Your entities, their properties, UI layouts, workflows, and commands are all described as semantic data in the same Markdown files, in the same vault. Create a new entity type — and the UI adapts automatically. Define a workflow transition — and buttons appear. No code changes, no server, no vendor lock-in.

This is an evolution of the "as Code" paradigm (Infrastructure as Code, Docs as Code):

| As Code                                  | As Knowledge (Exocortex)                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Workflow as Code** — CI/CD pipelines   | **Workflow as Knowledge** — status transitions as RDF data, UI buttons generated automatically |
| **Layout as Code** — JSON/CSS config     | **Layout as Knowledge** — columns, filters, sorting described semantically                     |
| **Schema as Code** — JSON Schema, Prisma | **Schema as Knowledge** — OWL classes and properties as files in your vault                    |

**"As Code" describes desired system state. "As Knowledge" describes what things mean and how they relate.**

Compared to existing tools:

|                           | Exocortex | Notion | Jira | Semantic MediaWiki | Protégé |
| ------------------------- | :-------: | :----: | :--: | :----------------: | :-----: |
| RDF/Semantic              |    ✅     |   —    |  —   |         ✅         |   ✅    |
| File-based (git-friendly) |    ✅     |   —    |  —   |         —          |   ✅    |
| UI from ontology          |    ✅     |   ✅   |  ~   |         ~          |   ✅    |
| Offline-first             |    ✅     |   ~    |  —   |         —          |   ✅    |
| For knowledge workers     |    ✅     |   ✅   |  ✅  |         ~          |   ��    |
| Action layer (commands)   |    ✅     |   ~    |  ✅  |         —          |    —    |

---

## What It Does

- **Semantic knowledge graph** — every piece of knowledge is an Asset with UUID, class, properties, and relationships stored as RDF triples
- **SPARQL queries** — ask complex questions across your entire knowledge base
- **Modular ontologies** — IMS (concepts, notes, people), EMS (tasks, projects, meetings), ZTLK (zettelkasten)
- **Everything as Knowledge** — commands, workflows, property schemas, and layouts defined as vault assets, not hardcoded
- **Ontology plugins** — extend the system with installable ontology packages (e.g. [GTD + Jedi Techniques](https://github.com/kitelev/gtd-jedi))
- **Local-first** — all data stays on your device, no cloud required

---

## Quick Start

### Option 1: Obsidian Plugin (via BRAT)

Best for: Visual knowledge management, daily planning, interactive exploration.

**Prerequisites:**

- **Obsidian** 1.4+

**Install Exocortex via BRAT:**

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from Obsidian Community Plugins
2. Open BRAT settings → **Add Beta Plugin**
3. Enter repository: `kitelev/exocortex`
4. Click **Add Plugin** and enable Exocortex in Community plugins

BRAT will automatically keep the plugin updated with new releases.

> **Next:** Follow the **[Getting Started Guide](./docs/Getting-Started.md)** to install the Starter Kit and create your first Area, Project, and Task.
>
> **Note:** Layouts appear in **Reading Mode** (Ctrl/Cmd + E).

### Option 2: CLI

Best for: Automation, AI agents, batch operations.

```bash
npm install -g @kitelev/exocortex-cli

# Query your knowledge graph
exocortex-cli sparql query "
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
SELECT ?task ?label WHERE {
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
  PREFIX exo: <https://exocortex.my/ontology/exo#>
  PREFIX ims: <https://exocortex.my/ontology/ims#>
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
exo__Instance_class:
  - "[[ims__Concept]]"
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
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
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

Install community ontology packages to extend your knowledge graph.

> **Note:** The `assetspace` CLI subcommand is on the roadmap and not yet available. Follow [kitelev/exocortex](https://github.com/kitelev/exocortex) for updates.

---

## Architecture

Monorepo with packages sharing a Clean Architecture core. Two runtime entry points (Obsidian Plugin and CLI) both depend on the same domain core and shared grounding-service factories; runtime-specific adapters implement common storage interfaces (`IVaultAdapter` / `IFileSystemAdapter`) so domain logic stays runtime-agnostic.

```mermaid
flowchart TB
    subgraph Runtimes["Runtime entry points"]
        Plugin["@exocortex/obsidian-plugin<br/>(Obsidian UI, renderers, commands)"]
        CLI["@kitelev/exocortex-cli<br/>(Node CLI, automation, AI agents)"]
    end

    subgraph Shared["Shared (runtime-agnostic) packages"]
        Core["@exocortex/core (exocortex)<br/>Domain models · RDF/SPARQL · Services"]
        Services["@kitelev/exocortex-services<br/>Grounding-service factories"]
        Interfaces[["IVaultAdapter · IFileSystemAdapter<br/>(ports defined in core)"]]
    end

    subgraph Adapters["Runtime adapters (implement ports)"]
        ObsAdapter["ObsidianVaultAdapter<br/>ObsidianFileSystemAdapter<br/>(app.vault API)"]
        NodeAdapter["NodeVaultAdapter<br/>NodeFileSystemAdapter<br/>(fs/promises)"]
    end

    Plugin --> Core
    Plugin --> Services
    CLI --> Core
    CLI --> Services
    Services --> Core
    Services -. depends on .-> Interfaces
    Core --- Interfaces

    Plugin --> ObsAdapter
    CLI --> NodeAdapter
    ObsAdapter -.implements.-> Interfaces
    NodeAdapter -.implements.-> Interfaces

    classDef runtime fill:#e3f2fd,stroke:#1565c0,color:#0d47a1;
    classDef shared fill:#f3e5f5,stroke:#6a1b9a,color:#4a148c;
    classDef adapter fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20;
    classDef iface fill:#fff8e1,stroke:#f9a825,color:#7d5500,stroke-dasharray: 4 3;
    class Plugin,CLI runtime;
    class Core,Services shared;
    class ObsAdapter,NodeAdapter adapter;
    class Interfaces iface;
```

### Packages

| Package                        | npm                      | Purpose                                                                     |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| **exocortex**                  | Private                  | Core business logic, domain models, SPARQL engine, 35+ services             |
| **@exocortex/obsidian-plugin** | Private                  | Interactive UI: 24+ components, 3 renderers, 33+ commands, 6 modals         |
| **@kitelev/exocortex-cli**     | `@kitelev/exocortex-cli` | CLI for automation, archive/unarchive, SPARQL queries, AI agent integration |
| **@kitelev/exocortex-services** | Private                 | Shared runtime-agnostic grounding-service factories (RFC 94e520da Phase 1)  |
| **@exocortex/test-utils**      | Private                  | Shared test utilities, mock factories, flaky test reporter                  |

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

- **[Plugin Commands](./docs/Plugin-Commands.md)** — All 33+ commands documented

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

---

## Development

```bash
git clone https://github.com/kitelev/exocortex
cd exocortex
git submodule update --init --recursive
npm install
npm run build
npm run test:all
```

The `git submodule update --init --recursive` step hydrates `packages/starter-kit-fixtures`, which mirrors the [`exocortex-starter-kit`](https://github.com/kitelev/exocortex-starter-kit) repo and is consumed by unit and E2E tests. If you forget it, tests that read fixture Commands will fail with ENOENT. See [docs/fixture-access.md](./docs/fixture-access.md) for the rationale and fallback plan.

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
