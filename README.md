# Exocortex

> "Экзокортекс — это как я хочу мыслить — не в ловушке линейных документов или иерархических папок, а в живой паутине смыслов, растущей вместе со мной."

**A cognitive infrastructure that augments human intelligence through semantic knowledge organization, ontology-driven reasoning, and AI integration.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/kitelev/exocortex/actions/workflows/ci.yml/badge.svg)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-5700%2B-success)](https://github.com/kitelev/exocortex/actions)
[![Coverage](https://img.shields.io/badge/coverage-80%25-brightgreen)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)

---

## Vision

**Exocortex** is not just a knowledge management tool — it's **a companion to consciousness**. A system designed to:

- Transform chaotic information flow into a **coherent worldview** supporting decision-making
- Help people **live more consciously** through structured management of knowledge and goals
- Augment human cognition without replacing it — **a companion, not a crutch**

> "Life is the goal. Awareness is the methodology. Exocortex is the instrument."

### The Path to Übermensch

Exocortex is an instrument for becoming **Übermensch** (Nietzsche):
- Overcoming reactive behavior through **conceptual awareness**
- **Super-individualism** — the ability to create your own values
- Striving for infinite self-improvement
- Human as a **transitional stage** between animal and superhuman

---

## Philosophy

### Core Principles

1. **Awareness as Methodology** — The system increases awareness, not replaces thinking
2. **Exocortex as Spirit Manifestation** — Not just a utility, but a way to materialize your inner world
3. **Ontological Precision** — Knowledge structured through formal ontologies
4. **Information-Centrism** — Information as the foundation of reality

### What Sets Exocortex Apart

| Traditional Tools | Exocortex |
|-------------------|-----------|
| Files and folders | **Semantic graph of knowledge** |
| Tags and links | **Ontology-driven relationships** |
| Full-text search | **SPARQL semantic queries** |
| AI chatbot | **Cognitive partner** working with your knowledge graph |
| Data storage | **Domain model of consciousness** |

### Exocortex vs Generative AI

**Key difference: Exocortex cannot hallucinate!**
- AI hallucinates (generates non-existent information)
- Exocortex operates **only with verified data** from knowledge graph
- AI is a tool of exocortex, but not a replacement for its function of **reliable knowledge storage**

---

## Unique Concepts

### Asset — The Quantum of Knowledge

**Asset** is the atomic unit of knowledge, like a quantum in physics:

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

**Key Insight**: Knowledge is an **emergent property** of the asset graph. Individual assets are just information. When connected through relationships, **knowledge emerges** — like life emerges from molecules.

### DCC — Direct Conceptual Communication

**DCC** is Exocortex's killer feature — communication **without conversion between different worldviews**.

**Problem**: Conceptual miscommunication — people use the same words but mean different things.

**Solution**: Each concept has:
- Formal definition (`ims__Concept_definition`)
- Relationships with other concepts (`ims__Concept_broader`, `ims__Concept_related`)
- Mapping between different users' ontologies

DCC = **ExoAPI** — semantic contract between exocortexes.

### Modular Ontologies

| Module | Purpose |
|--------|---------|
| **IMS** (Information Management) | Knowledge, concepts, relationships. Classes: `Simulacrum`, `Concept`, `Note`, `Person` |
| **EMS** (Effort Management) | Tasks, projects, time. Classes: `Task`, `Project`, `Meeting` |
| **ZTLK** (Zettelkasten) | Atomic notes methodology |

### STIR Model — Knowledge Coordinates

**STIR** (Space, Time, Importance, Relatedness) — universal model for information organization:

| Parameter | Question | Application |
|-----------|----------|-------------|
| **Space** | Where? | Spatial localization, context, domain |
| **Time** | When? | Temporal relevance, deadlines, validity period |
| **Importance** | How important? | Priority, impact on goals |
| **Relatedness** | What is it related to? | Connections, dependencies, cluster membership |

---

## Architecture

Exocortex is a **monorepo** with three packages sharing Clean Architecture core:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Exocortex System                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐ │
│   │  Obsidian Plugin │    │       CLI        │    │   Your App       │ │
│   │  (@exocortex/    │    │  (@kitelev/      │    │   (REST API      │ │
│   │  obsidian-plugin)│    │  exocortex-cli)  │    │   coming soon)   │ │
│   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘ │
│            │                       │                        │           │
│            └───────────────────────┼────────────────────────┘           │
│                                    │                                    │
│                       ┌────────────▼────────────┐                       │
│                       │       Core Library      │                       │
│                       │       (exocortex)       │                       │
│                       │                         │                       │
│                       │  • Domain models        │                       │
│                       │  • SPARQL engine        │                       │
│                       │  • Inference rules      │                       │
│                       │  • Storage adapters     │                       │
│                       └─────────────────────────┘                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Adapters Layer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐                 │
│  │   Obsidian  │  │     CLI     │  │  REST API       │                 │
│  │   Plugin    │  │  Interface  │  │  (planned)      │                 │
│  └─────────────┘  └─────────────┘  └─────────────────┘                 │
├─────────────────────────────────────────────────────────────────────────┤
│                       Application Layer                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │           Use Cases / Commands / Queries                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│                         Domain Layer                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐               │
│  │   IMS    │  │   EMS    │  │   ZTLK   │  │   ...   │               │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘               │
├─────────────────────────────────────────────────────────────────────────┤
│                      Infrastructure Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐                 │
│  │   Markdown  │  │    SPARQL   │  │   N-Triples     │                 │
│  │   Parser    │  │   Engine    │  │   Storage       │                 │
│  └─────────────┘  └─────────────┘  └─────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Packages

| Package | npm | Purpose |
|---------|-----|---------|
| **exocortex** | `exocortex` | Core business logic, domain models, SPARQL engine |
| **@exocortex/obsidian-plugin** | Private | Interactive UI for visual knowledge management |
| **@kitelev/exocortex-cli** | `@kitelev/exocortex-cli` | CLI for automation and AI agent integration |

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
import { SparqlService, NodeFsAdapter } from 'exocortex';

const sparql = new SparqlService(new NodeFsAdapter('/path/to/vault'));
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

### Semantic Query System (SPARQL)

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

### Knowledge Hierarchy

Organize knowledge domains hierarchically:

```
▼ Work
  ▼ Engineering
    → Backend
    → Frontend
  ▶ Design
▼ Personal
  ▶ Health
  ▶ Finance
```

### Ontology-Driven Forms

Create assets with forms generated from your RDF ontology — fields appear based on `rdfs:domain`, types detected from `rdfs:range`.

---

## Future Vision

### ExoEcoSystem — Federation of Minds

Long-term vision: **cognitive ecosystem** uniting multiple exocortexes into a semantically coherent, federated network:

```
ExoEcoSystem = Exocortex-as-agent
             + Interoperability Layer (DCC)
             + Shared Ontologies
             + Federated Reasoning
```

**Key Principles:**

| Principle | Description |
|-----------|-------------|
| **Decentralization** | Each node (exocortex) is autonomous |
| **Meaning Federation** | Personal ontologies aligned through mapping |
| **Mesh Reasoning** | Distributed logical inference between nodes |
| **Respect for Subjectivity** | Everyone defines their own access rules |

### AI-Native System (2027 Vision)

- Semantic knowledge graph will be **self-organizing** through AI analysis
- System will **anticipate user needs**
- Claude/GPT not as chatbot, but as **cognitive partner** working with your graph

### Noosphere

On **individual level** — exocortex is a consciousness agent.
On **collective level** — multiple exocortexes form **noosphere**.

> "Exocortex will fully assume consciousness responsibilities when it possesses a worldview of equal or greater precision."

---

## Technical Standards

- **Clean Architecture** — clear layer separation
- **SOLID Principles** — especially Single Responsibility
- **Domain-Driven Design** — knowledge domain as system center
- **Semantic Web** — RDF, SPARQL 1.1, OWL
- **Local-first** — your data stays local, cloud is optional

---

## Documentation

### Getting Started
- **[Installation Guide](./docs/Getting-Started.md)** — Step-by-step setup

### By Interface

**Obsidian Plugin:**
- **[Command Reference](./docs/Command-Reference.md)** — All 32 commands documented

**CLI:**
- **[CLI Command Reference](./docs/cli/Command-Reference.md)** — Complete syntax
- **[Scripting Patterns](./docs/cli/Scripting-Patterns.md)** — Automation examples

**Core Library:**
- **[Core API Reference](./docs/api/Core-API.md)** — TypeScript API
- **[Architecture Guide](./ARCHITECTURE.md)** — Clean Architecture patterns

### SPARQL & Semantic Queries
- **[SPARQL User Guide](./docs/sparql/User-Guide.md)** — Tutorial from basics to advanced
- **[Query Examples](./docs/sparql/Query-Examples.md)** — 30+ ready-to-use patterns

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

See [CLAUDE.md](./CLAUDE.md) for AI agent guidelines.

---

## License

MIT License — see [LICENSE](./LICENSE)

---

**Exocortex** — Your external brain for the semantic age.
