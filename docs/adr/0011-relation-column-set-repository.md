# ADR-0011: RelationColumnSetRepository — first class-to-config auto-binding

## Status

Accepted

## Context

RFC be70f741-a8e3-4826-aab1-d3f950068861 ("RDF-configurable columns for UniversalLayout backlinks table", v2) introduces `ui__RelationColumnSet` — the first Exocortex ontology class whose instances are **automatically discovered and bound** to a runtime component without a vault-authored layout file pointing at them.

Prior examples (`exo__TableLayout`, `exo__Layout`) are always referenced explicitly — either via codeblock `source` attribute or via a class-level layout property on the class asset. `RelationColumnSetRepository` is different: it scans every file in the vault, matches by `exo__Instance_class`, indexes by `(normalizedClass, normalizedProperty)`, and later (Phase 2 resolver + Phase 3 renderer integration) answers "which columns should the auto-backlinks table render for rows of class X referenced via property Y?"

### Problem

1. We must support **declarative, RDF-driven column configuration** for the UniversalLayout auto-backlinks table. The current hardcoded map at `RelationsRenderer.ts:160-163` makes every new per-group column requirement a code change.
2. There is **no precedent in the codebase** for a class-to-config auto-binding repository. The closest analogues — `LayoutService` + `LayoutParser.ts` (`packages/obsidian-plugin/src/application/layout/` and `infrastructure/layout/`) — always start from an explicit layout file reference; they do not own the discovery step.
3. The legacy `ui__LayoutBlock` / `ui__LayoutBlock_display_properties` feature covered an adjacent area but is **not** a migration baseline (see "Archaeology" below).
4. ISO 25010 reliability requires a rebuild strategy safe against batch-writes (e.g. Obsidian Sync), which pushes `metadataCache` events in bursts.

### Archaeology — legacy `ui__LayoutBlock` audit

- `grep -r "ui__LayoutBlock" packages/*/src/` in main (HEAD `5eba988f`, 2026-04-23) returns **zero hits** in source.
- Only matches live in `packages/exocortex/dist/domain/services/LayoutSelector.d.ts` (a _generated_ interface called `LayoutBlock`, unrelated to `ui__LayoutBlock`) and in two `CHANGELOG.md` entries: `[5.15.0] - 2025-08-24` and `[5.16.0] - 2025-08-24`.
- `git log -S "ui__LayoutBlock" --all --format="%H %ai %s"` returns two commits (`debeabd6…`, 2026-04-13; `34a76a17…`, 2025-10-02). Neither is a "removal" commit: the first re-introduces the CHANGELOG entries via a squash-merge, the second is a GH-Actions-workflow refactor with unrelated CHANGELOG churn.
- Conclusion: there is **no git SHA for legacy removal** because there was nothing physical to remove. `ui__LayoutBlock` appeared in release notes only — the production feature was either never shipped or was removed as part of the same commit that originally introduced it. The planner review of RFC v2 ("grep-r … empty. Фича удалена.") reached the same conclusion empirically.

The **empirical-audit SHA** recorded for this ADR is therefore the _reference point at which zero hits were confirmed_: `5eba988f` (`docs: fix Core-API (GenericAssetCreationService) and Plugin-Dev-Guide`, 2026-04-23) — the HEAD of `origin/main` when Phase 1 branched.

## Decision

1. Introduce a new domain model `RelationColumnSet` in `@exocortex/core` at `packages/exocortex/src/domain/layout/RelationColumnSet.ts`. Export via `domain/layout/index.ts` and the package root `index.ts`.
2. Introduce `RelationColumnSetRepository` in `packages/obsidian-plugin/src/infrastructure/repositories/` — a new subtree — with a storage-agnostic `RelationColumnSetVaultAdapter` interface and an Obsidian-specific implementation in the same directory.
3. Rebuild strategy:
   - Initial scan on `initialize()`.
   - Subscribe to `metadataCache.on('changed' | 'deleted')` and `vault.on('rename')`.
   - **150ms trailing debounce** on rebuild.
   - **Double-buffering** — construct the next `{all, byUid}` snapshot in-place and publish the frozen object atomically. Existing readers retain a stable reference.
4. Class-filter strictly by frontmatter (`exo__Instance_class` → normalized UID **or** IRI `ui__RelationColumnSet`). **Never** by file path.
5. Gate everything behind `ExocortexSettings.enableRelationColumnSetResolver` (default `true`). The flag stays `true` through Phase 1 because Phase 1 is **behaviour-neutral** — no consumer is wired. The flag exists so that Phase 3 integration can be bisected if a regression surfaces.
6. Ontology assets land in `exocortex-starter-kit` for Phases 1-3 (isolation from `exocortex-public-ontologies` release cadence). A pull-up to `exocortex-public-ontologies` is planned in Phase 4+ per RFC v2 §Resolved-open-questions.

### Implementation sketch

```typescript
export interface RelationColumnSetVaultAdapter {
  getAllMarkdownPaths(): readonly string[];
  getFrontmatter(path: string): Record<string, unknown> | null;
  on(
    event: "changed" | "deleted" | "renamed",
    handler: (p: { path: string }) => void,
  ): () => void;
}

class RelationColumnSetRepository {
  initialize(): void; // subscribe + full rebuild
  dispose(): void; // unsubscribe + cancel pending timer
  getSnapshot(): RelationColumnSetSnapshot; // frozen {all, byUid}
  rebuildNow(): void; // test hook — cancels debounce
}
```

## Consequences

### Positive

- Adds a **reusable pattern** (class-to-config auto-binding) that future RFCs can reach for without re-inventing debounce + double-buffering.
- Behaviour-neutral Phase 1: snapshot-identical rendering and empty-vault smoke are satisfied by construction (no consumer), which makes the exit-criteria objective rather than subjective.
- Class-filter by frontmatter keeps the Repository agnostic to vault folder structure; starter-kit `ui/` convention is advisory only.
- Injecting `setTimer` / `clearTimer` keeps the debounce unit-testable without relying on real-wall-clock delays.

### Negative

- Adds a vault-scan on plugin startup. For Phase 1 the scan is O(markdown-files × frontmatter-check); optimisation deferred — the RFC's M4 benchmark protocol lands in Phase 2.
- One more settings-flag the user can toggle. Mitigated by `default true` and a brief in-settings tooltip (Phase 3 UI work).
- The new `infrastructure/repositories/` subtree might be confused with `domain/repositories/` (which does not exist in obsidian-plugin). The folder is deliberately plural for symmetry with future per-domain repositories; if no second repository lands by Phase 4 we revisit.

### Mitigations

- Double-buffering + debounce + `dispose()` path covered by 19 unit-tests (`RelationColumnSetRepository.test.ts`).
- The domain model has a dedicated normaliser (`normalizeRef`) covered by a wikilink↔raw roundtrip test — the RFC-mandated **normalization-roundtrip** unit guarantee.
- Feature-flag allows instant bisect in Phase 3 if auto-backlinks regress.

## Alternatives Considered

### Alternative 1: Reuse `LayoutService` + add a "backlinks-source" mode

**Rejected because**: RFC v2 already considered this as "Вариант B" and deferred it to Phase 5+ with explicit revisit-criteria (convergence of `ui__RelationColumnSet_columns` and `exo__LayoutColumn`, lifting of resolver into `LayoutService`). Reusing it in Phase 1 would force a `sourceMode` refactor on a hot path — two moves at once, zero behavioural isolation.

### Alternative 2: Revive `ui__LayoutBlock_display_properties`

**Rejected because**: the archaeology above confirms the feature never really shipped; reviving it would replace a per-note mixing-layers anti-pattern with nothing new. RFC v2 rejects this explicitly (variant C).

### Alternative 3: Keep the logic in `RelationsRenderer` — no Repository, inline scan

**Rejected because**: the renderer runs on every open-asset change; a full vault scan per render is a performance regression. A live-cached Repository amortises the cost.

## Related

- **RFC**: be70f741-a8e3-4826-aab1-d3f950068861 — "RDF-configurable columns for UniversalLayout backlinks table (v2)"
- **Parent project**: `489e297d-069f-4144-a538-dce81da18d0f` — _RDF-configurable UniversalLayout columns (ui\_\_RelationColumnSet)_
- **Phase 1 task**: `6533ca08-5e9a-435d-9d3a-be69b872eba9`
- **Starter-kit PR**: `kitelev/exocortex-starter-kit` — branch `feature/relcolset-ontology`
- **Precedent** (closest): `packages/obsidian-plugin/src/application/layout/LayoutService.ts`, `packages/obsidian-plugin/src/infrastructure/layout/LayoutParser.ts`
- **Archaeology reference SHA** (empirical zero-hits baseline): `5eba988f`

---

**Date**: 2026-04-24
**Author**: @kitelev (via child Claude Code session)
**Related Issues**: n/a (RFC-tracked via Exocortex Project asset 489e297d-…)
