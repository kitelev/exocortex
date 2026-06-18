# Cross-Runtime Parity Contract (P1.13)

> **Scope note.** This document describes **one specific enforcement instance** of the broader **UI/CLI Parity Invariant** — namely, the SHACL-lite *validator* parity contract between the CLI and plugin runtimes. It is not the definition of the invariant. For the principle itself (every user-facing capability must be invokable from both the Obsidian plugin and the CLI, enforced via a shared platform-agnostic core behind ports), see [VISION.md](../../VISION.md#uicli-parity-invariant) and the enforced ports/adapters statement in [ARCHITECTURE.md](../../ARCHITECTURE.md). This file stays focused on the validator contract.

## Overview

The Exocortex SHACL-lite validator runs in two runtimes:

| Runtime                                                              | Entry point                                       | Shape loading                  | Hierarchy                                           | Triple conversion                 |
| -------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------ | --------------------------------------------------- | --------------------------------- |
| **CLI** (`npx @kitelev/exocortex-cli validate schema --shapes-mode`) | `packages/cli/src/commands/validate-schema.ts`    | `ShapeLoader.loadFromVaultFS`  | `TripleClassHierarchy` (rdfs:subClassOf BFS)        | `domainToAlgebraTriples()` helper |
| **Plugin** (`ExocortexPlugin.scheduleValidation`)                    | `packages/obsidian-plugin/src/ExocortexPlugin.ts` | `ShapeLoader.loadFromRDFGraph` | `{ isSubClassOf: (c, p) => c === p }` (exact match) | Inline loop                       |

Both paths call the **same** shared engine function `shaclValidate` from the `exocortex` core package (`packages/exocortex`), which guarantees a common foundation.

## Parity Contract

> For any vault where no `rdfs:subClassOf` hierarchy is used in shapes, both runtimes MUST produce a **byte-identical** `ValidationReport` (violations array sorted canonically by `focusNode` then `propertyPath`).

This is the **R2 mitigation**: any divergence in engine behaviour (triple-conversion bugs, hierarchy discrepancies, sorting differences) is caught by the parity test before it reaches production.

## Known Differences

### 1. Hierarchy implementation

| CLI                                                                                                                          | Plugin                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `TripleClassHierarchy` — reads `rdfs:subClassOf` triples from the vault and performs BFS to determine subclass relationships | `{ isSubClassOf: (c, p) => c === p }` — only matches if classes are identical (no inheritance) |

**Impact**: vaults that declare class hierarchies via `exo__Class_superClass` will produce different results. The parity test uses a fixture without hierarchy — both implementations behave identically there.

### 2. Shape loading

| CLI                                                                                                                                                        | Plugin                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ShapeLoader.loadFromVaultFS` — reads `exo__Property*.md` files from the filesystem directly; resolves wikilinks without needing the target files to exist | `ShapeLoader.loadFromRDFGraph` — queries the in-memory RDF triple store for `rdf:type exo:Property` nodes; requires the wikilink targets (class definition files) to exist in the vault |

**Impact**: in practice the production vault is complete, so both loaders produce the same shapes. The `ShapeLoader` unit tests cover both paths independently.

## Parity Test

**File**: `packages/cli/tests/integration/cross-runtime-parity.test.ts`

**Fixture**: `packages/cli/tests/fixtures/shacl-integration/` (same as P1.7 golden file test)

**Scenarios tested**:

1. CLI engine produces violations from fixture
2. Plugin-style engine produces same violations
3. Violation counts match
4. `violations` arrays are deep-equal after canonical sort
5. JSON-serialized reports are byte-identical
6. `conforms` field matches
7. Both violation arrays are already sorted (canonical sort invariant)
8. CLI `domainToAlgebraTriples()` and plugin inline conversion produce the same number of algebra triples

**Run locally**:

```bash
NODE_OPTIONS="--experimental-vm-modules" \
  npx jest --config packages/cli/jest.config.js \
  tests/integration/cross-runtime-parity.test.ts
```

## CI Integration

The parity test runs as part of the standard `test-coverage` CI check (all `packages/cli/tests/**/*.test.ts` are included automatically via `jest.config.js`). No additional CI configuration is required.

An adjacent parity contract is enforced by the dedicated **`parity-gate`** required CI check (`.github/workflows/ci.yml`, RFC `94e520da` Phase 3): it runs the CLI ↔ plugin **triple-parity** integration test in isolation (diff = 0 across 5 reference vaults), so a triple-conversion divergence surfaces as a named check instead of being absorbed into the broader CLI coverage job.

## Regenerating the Golden File

The underlying fixture golden file (`golden-report.json`) is shared with P1.7:

```bash
UPDATE_GOLDEN=1 NODE_OPTIONS="--experimental-vm-modules" \
  npx jest --config packages/cli/jest.config.js \
  tests/integration/validate-schema-shapes.integration.test.ts
```
