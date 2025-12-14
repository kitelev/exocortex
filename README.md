# Exocortex

**A semantic knowledge management system that gives you complete control over your knowledge through ontology-driven organization, SPARQL queries, and intelligent automation.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/kitelev/exocortex/actions/workflows/ci.yml/badge.svg)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-5700%2B-success)](https://github.com/kitelev/exocortex/actions)
[![Coverage](https://img.shields.io/badge/coverage-80%25-brightgreen)](https://github.com/kitelev/exocortex/actions/workflows/ci.yml)
[![Test Pyramid](https://img.shields.io/badge/pyramid-healthy-brightgreen)](./TESTING.md#test-pyramid-policy)

## What is Exocortex?

**Exocortex** is a system for digitizing and managing knowledge, inspired by the concept of an external brain. It transforms your notes into a semantically interconnected knowledge base with:

- **Ontology-driven structure**: Organize knowledge using Areas → Projects → Tasks hierarchy
- **Semantic queries**: Ask complex questions about your knowledge using SPARQL
- **Multi-interface access**: Work through Obsidian UI, command-line, or AI agents
- **RDF foundation**: Industry-standard semantic web technologies for data portability

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Knowledge Base** | Your collection of notes (Obsidian vault) with semantic frontmatter |
| **Ontology** | Schema defining asset types (Areas, Projects, Tasks) and their relationships |
| **Triple Store** | RDF database generated from your notes for semantic queries |
| **SPARQL** | W3C standard query language to interrogate your knowledge |

## Architecture

Exocortex is a **monorepo** with three packages sharing a common core:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Exocortex System                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐ │
│   │  Obsidian Plugin │    │       CLI        │    │   Your App       │ │
│   │  (@exocortex/    │    │  (@kitelev/      │    │   (future)       │ │
│   │  obsidian-plugin)│    │  exocortex-cli)  │    │                  │ │
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
│                       │  • Business logic       │                       │
│                       │  • Storage adapters     │                       │
│                       └─────────────────────────┘                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Packages

| Package | npm | Purpose |
|---------|-----|---------|
| **exocortex** | `exocortex` | Core business logic, domain models, SPARQL engine (storage-agnostic) |
| **@exocortex/obsidian-plugin** | Private | Interactive UI within Obsidian for visual knowledge management |
| **@kitelev/exocortex-cli** | `@kitelev/exocortex-cli` | Command-line tool for automation, scripting, and AI agent integration |

### Monorepo Structure

```
packages/
├── exocortex/               # Core library - shared business logic
│   ├── src/
│   │   ├── domain/          # Entities, value objects, business rules
│   │   ├── application/     # Services, use cases
│   │   └── infrastructure/  # Adapters (Obsidian, Node.js filesystem)
│   └── package.json
│
├── obsidian-plugin/         # Obsidian UI adapter
│   ├── src/
│   │   ├── presentation/    # React components, renderers
│   │   └── infrastructure/  # Obsidian API integration
│   └── package.json
│
├── cli/                     # Command-line interface
│   ├── src/
│   │   └── commands/        # SPARQL, status, creation commands
│   └── package.json
│
└── test-utils/              # Shared testing utilities
```

## Quick Start

### Option 1: Obsidian Plugin (Interactive UI)

Best for: Visual knowledge management, daily planning, interactive exploration.

```bash
# In your Obsidian vault
cd .obsidian/plugins
git clone https://github.com/kitelev/exocortex
cd exocortex
npm install && npm run build
```

Enable in Obsidian Settings → Community plugins → Exocortex.

### Option 2: CLI (Automation & Scripting)

Best for: Automation, CI/CD pipelines, AI agent integration, batch operations.

```bash
# Global installation
npm install -g @kitelev/exocortex-cli

# Or use directly with npx
npx @kitelev/exocortex-cli --help
```

**Quick Examples:**

```bash
# Execute SPARQL query
exocortex-cli sparql query "SELECT ?task ?label WHERE { ?task exo:Instance_class ems:Task . ?task exo:Asset_label ?label }" --vault ~/vault

# Complete a task
exocortex-cli command complete "tasks/my-task.md" --vault ~/vault

# Create a new task
exocortex-cli command create-task "tasks/new-task.md" --label "Implement feature" --vault ~/vault

# Batch operations (atomic)
exocortex-cli batch --input '[{"command":"start","filepath":"task1.md"},{"command":"complete","filepath":"task2.md"}]' --vault ~/vault --atomic
```

### Option 3: Core Library (Custom Integration)

Best for: Building custom applications on top of Exocortex.

```bash
npm install exocortex
```

```typescript
import { SparqlService, NodeFsAdapter } from 'exocortex';

const adapter = new NodeFsAdapter('/path/to/vault');
const sparql = new SparqlService(adapter);

const results = await sparql.query(`
  SELECT ?task ?label
  WHERE {
    ?task exo:Instance_class ems:Task .
    ?task exo:Asset_label ?label .
  }
`);
```

## Feature Comparison

| Feature | Obsidian Plugin | CLI | Core Library |
|---------|----------------|-----|--------------|
| **SPARQL Queries** | Live results in notes | Table/JSON/CSV output | Programmatic API |
| **Task Management** | Visual buttons & commands | All status transitions | Service methods |
| **Asset Creation** | Modal dialogs with forms | Command-line flags | Factory methods |
| **Batch Operations** | One at a time | Atomic batch execution | Transaction support |
| **Real-time Updates** | Auto-refresh on vault changes | On-demand execution | Event subscriptions |
| **AI Integration** | N/A | JSON output, exit codes | Full API access |
| **Mobile Support** | Full touch-optimized UI | N/A | N/A |

## Key Features

### SPARQL Query System

Execute semantic queries directly in markdown or from the command line:

````markdown
```sparql
SELECT ?task ?label ?status
WHERE {
  ?task exo:Instance_class ems:Task .
  ?task exo:Asset_label ?label .
  ?task ems:Effort_status ?status .
  FILTER(?status != ems:EffortStatusDone)
}
ORDER BY ?label
```
````

Results appear live below the code block with interactive table/list views, export options, and automatic updates when vault content changes.

### Effort Lifecycle Management

Complete workflow from idea to completion:

```
Draft → Backlog → Analysis → ToDo → Doing → Done
                     ↓
                  Trashed
```

Each transition automatically records timestamps for analytics.

### Area Hierarchy

Organize knowledge domains hierarchically:

```
▼ Work (root area)
  ▼ Engineering
    → Backend
    → Frontend
  ▶ Design
▼ Personal
  ▶ Health
  ▶ Finance
```

### Daily Planning

Aggregate all scheduled tasks in daily notes with:
- Focus area filtering
- Vote-based prioritization
- Archive visibility toggle

### Ontology-Driven Forms

Create assets with forms generated from your RDF ontology:
- Fields automatically appear based on `rdfs:domain`
- Property types detected from `rdfs:range`
- Deprecated properties hidden automatically

## Obsidian Plugin Features

The Obsidian plugin provides a rich visual interface:

- **32 Commands**: Full command palette integration
- **Context-aware Buttons**: Actions appear based on current note type
- **Properties Table**: Inline editing with wiki-link resolution
- **Area Tree**: Interactive hierarchy visualization
- **Relations Table**: Bidirectional link discovery
- **Mobile Support**: Touch-optimized UI

See [Plugin Documentation](./docs/obsidian/User-Guide.md) for complete feature reference.

## CLI Features

The CLI enables headless automation:

| Category | Commands | Description |
|----------|----------|-------------|
| **SPARQL** | `sparql query` | Execute SPARQL 1.1 queries with table/JSON/CSV output |
| **Status** | `start`, `complete`, `trash`, `archive`, `move-to-*` | Full task lifecycle management |
| **Creation** | `create-task`, `create-meeting`, `create-project`, `create-area` | Create assets with frontmatter |
| **Planning** | `schedule`, `set-deadline` | Set dates for efforts |
| **Maintenance** | `rename-to-uid`, `update-label` | File and property management |
| **Batch** | `batch` | Execute multiple operations atomically |

See [CLI Documentation](./docs/cli/Command-Reference.md) for complete command reference.

## Documentation

### Getting Started
- **[Installation Guide](./docs/Getting-Started.md)** - Step-by-step setup
- **[First Steps](./docs/First-Steps.md)** - Your first knowledge assets

### By Interface

**Obsidian Plugin:**
- **[Plugin User Guide](./docs/obsidian/User-Guide.md)** - Complete feature reference
- **[Command Reference](./docs/Command-Reference.md)** - All 32 commands documented

**CLI:**
- **[CLI Command Reference](./docs/cli/Command-Reference.md)** - Complete syntax
- **[Scripting Patterns](./docs/cli/Scripting-Patterns.md)** - Automation examples
- **[Integration Examples](./docs/cli/Integration-Examples.md)** - CI/CD, AI agents

**Core Library:**
- **[Core API Reference](./docs/api/Core-API.md)** - TypeScript API documentation
- **[Architecture Guide](./ARCHITECTURE.md)** - Clean Architecture patterns

### SPARQL & Semantic Queries
- **[SPARQL User Guide](./docs/sparql/User-Guide.md)** - Tutorial from basics to advanced
- **[Query Examples](./docs/sparql/Query-Examples.md)** - 30+ ready-to-use patterns
- **[Performance Tips](./docs/sparql/Performance-Tips.md)** - Optimization for large vaults
- **[ExoRDF to RDF/RDFS Mapping](./docs/rdf/ExoRDF-Mapping.md)** - Semantic interoperability

### Workflows
- **[Task Workflow](./docs/workflows/Task-Workflow.md)** - Complete task lifecycle
- **[Project Workflow](./docs/workflows/Project-Workflow.md)** - Multi-task initiatives
- **[Daily Planning](./docs/workflows/Daily-Planning.md)** - Organize your day
- **[Area Organization](./docs/workflows/Area-Organization.md)** - Knowledge domains

### Advanced Topics
- **[Dynamic Property Fields](./docs/DYNAMIC_FIELDS.md)** - Ontology-driven forms
- **[Ontology Extension](./docs/ONTOLOGY_EXTENSION.md)** - Custom properties
- **[Property Schema](./docs/PROPERTY_SCHEMA.md)** - Frontmatter reference
- **[Troubleshooting](./docs/Troubleshooting.md)** - Common issues

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Clone repository
git clone https://github.com/kitelev/exocortex
cd exocortex

# Install dependencies (monorepo root)
npm install

# Build all packages
npm run build

# Run all tests
npm run test:all
```

### Development Mode

```bash
# Watch mode for Obsidian plugin
npm run dev

# Build specific package
npm run build --workspace=@kitelev/exocortex-cli
```

### Testing

```bash
npm run test:unit       # Unit tests (jest)
npm run test:component  # Component tests (Playwright)
npm run test:e2e:local  # E2E tests (Docker required)
npm run test:coverage   # Coverage reports
```

### Quality Standards

- **Test Coverage**: ≥45% global, ≥80% domain layer
- **BDD Coverage**: ≥80% scenario coverage
- **TypeScript**: Strict mode
- **Architecture**: Clean Architecture with SOLID principles

## Contributing

This project is developed primarily by AI agents (Claude Code, GitHub Copilot, etc.) following documented patterns. Human contributions welcome!

1. Create worktree: `git worktree add ../worktrees/my-feature -b feature/my-feature`
2. Follow [CLAUDE.md](./CLAUDE.md) guidelines
3. Run `npm run test:all` before PR
4. Create PR with semantic commit message

See [AGENTS.md](./AGENTS.md) for universal AI agent guidelines.

## Roadmap

### Current Focus
- SPARQL 1.1 compliance improvements
- CLI batch operations
- Performance optimization for large vaults

### Future Vision
- **Exocortex Server**: HTTP API for multi-device sync
- **Mobile App**: Native iOS/Android clients
- **AI Integration**: Semantic reasoning with LLMs
- **Collaborative Features**: Multi-user knowledge bases

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/kitelev/exocortex/issues)
- **Releases**: [GitHub Releases](https://github.com/kitelev/exocortex/releases)
- **Documentation**: This README and [docs/](./docs/) folder

---

**Exocortex** - Your external brain for the semantic age.
