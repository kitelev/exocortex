# exocortex

Core engine of the Exocortex knowledge management system: RDF triple store, SPARQL/ExoQL query engine, SHACL-lite validation, vault-declared (homoiconic) commands, GitHub-backed sync, and AssetSpace/profile machinery — all in platform-agnostic TypeScript with **zero Obsidian dependency**.

Platform specifics (Obsidian API, Node `fs`, network transports) are injected through interfaces (`IVaultAdapter`, `IFileSystemAdapter`, transport ports), so the same logic runs inside the Obsidian plugin, the CLI, and tests.

## Installation

This is a workspace package of the [exocortex monorepo](../../README.md). It is consumed in-repo by the other packages (`"exocortex": "*"` / `file:../exocortex`), not installed standalone:

```bash
# From the monorepo root
npm install        # installs all workspace packages
npm run build -w exocortex
```

## Subsystems

| Subsystem | Where | What it does |
| --- | --- | --- |
| RDF core | `src/domain/models/rdf/`, `src/infrastructure/rdf/` | `IRI` / `Literal` / `BlankNode` / `Triple` (incl. RDF-Star `QuotedTriple`), `InMemoryTripleStore` (6-way indexed, named graphs, UUID index), `RDFSerializer`, `RDFSInferenceEngine` |
| SPARQL / ExoQL engine | `src/infrastructure/sparql/`, `src/exoql/` | Parser → algebra translator → executors pipeline; `ExoQL` facade (`query` / `ask` / `construct`); aggregates, query-plan & result caches, optimizers |
| Vault → RDF conversion | `src/services/NoteToRDFConverter.ts` | Converts markdown frontmatter into triples; folder exclusions, invariant-violation reporting |
| SHACL-lite validation | `src/services/ShaclLiteValidator.ts`, `ShapeLoader`, `ShapeRegistry`, `ValidatorDaemon` | Validates triples against shapes (required properties, cardinality, class membership with subclass closure) |
| Homoiconic commands | `src/services/CommandResolver.ts`, `PreconditionEvaluator`, `GroundingExecutor`, `CommandExecutionFlow` | Resolves `exocmd__Command` / `Precondition` / `Grounding` assets declared in the vault into executable UI commands |
| Sync (ExoSync) | `src/services/sync/`, `src/infrastructure/github/` | `detectChanges` + `SyncEngine` (pull → merge → push over the `restCreateCommit` Git Data API core), `StructuredMerger` (3-way frontmatter/body merge), `MergeShaclGate`, quarantine & watermark stores |
| AssetSpace & profile | `src/services/assetspace/`, `src/domain/profile/`, `src/services/profile/` | `mountAssetSpaceFiles` mount pipeline + `.gitmodules` transforms, tarball parser, `assertTsFloor` floor guard, `IConfirmGate` apply-plan contract |
| Asset & status services | `src/services/` | `TaskStatusService`, `PlanningService`, `EffortStatusWorkflow`, `GenericAssetCreationService`, `ArchiveAssetService`, `FolderRepairService`, `RenameToUidService`, and more |
| Layout | `src/domain/layout/`, `src/application/services/` | `exo__Layout` / `LayoutBlock` / `RelationColumnSet` models, `LayoutSelector`, `RelationColumnSetResolver` |
| Utilities & DI | `src/utilities/`, `src/interfaces/`, `src/infrastructure/container.ts` | `FrontmatterService`, `DateFormatter`, `WikiLinkHelpers`, `MetadataHelpers`, `FilenameValidator`; adapter interfaces and the DI container |

Detailed API documentation lives in [`docs/api/Core-API.md`](../../docs/api/Core-API.md).

## Examples

### Triple store + SPARQL

```typescript
import { ExoQL, InMemoryTripleStore, IRI, Literal, Triple } from "exocortex";

const store = new InMemoryTripleStore();

await store.add(
  new Triple(
    new IRI("obsidian://vault/tasks/123.md"),
    new IRI("https://exocortex.my/ontology/exo#Asset_label"),
    new Literal("Write the README"),
  ),
);

// match(subject?, predicate?, object?) — omitted positions are wildcards
const labelTriples = await store.match(
  undefined,
  new IRI("https://exocortex.my/ontology/exo#Asset_label"),
);
console.log(labelTriples[0].object.toString());

// Or query it with SPARQL via the ExoQL facade
const rows = await ExoQL.query(
  "SELECT ?s ?label WHERE { ?s <https://exocortex.my/ontology/exo#Asset_label> ?label }",
  store,
);
```

### Frontmatter manipulation

```typescript
import { FrontmatterService } from "exocortex";

const fm = new FrontmatterService();
const doc = "---\nexo__Asset_label: Demo\n---\nBody";

const parsed = fm.parse(doc); // { exists: true, content: "exo__Asset_label: Demo", ... }

const updated = fm.updateProperty(
  doc,
  "ems__Effort_status",
  '"[[ems__EffortStatusDone]]"',
);

const removed = fm.removeProperty(updated, "ems__Effort_status");
```

## Consumers

| Package | How it uses this package |
| --- | --- |
| [`@exocortex/obsidian-plugin`](../obsidian-plugin/) | Implements `IVaultAdapter` over the Obsidian API; renders layouts, command buttons, and SPARQL blocks driven by this engine |
| [`@kitelev/exocortex-cli`](../cli/) | Implements the adapters over Node `fs`; exposes `query`, `validate schema`, `apply`, `audit`, and other commands |

## Development

```bash
npm run build    # tsc → dist/
npm test         # jest
npm run lint     # eslint src --ext .ts
```

## License

MIT
