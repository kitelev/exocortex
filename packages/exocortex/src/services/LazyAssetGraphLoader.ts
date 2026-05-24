import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { IFileResolver } from "../interfaces/IFileResolver";
import type { IFile } from "../interfaces/IVaultAdapter";
import type { Triple } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { Namespace } from "../domain/models/rdf/Namespace";

/**
 * Maximum recursion depth for class + prototype chain traversal.
 *
 * Matches `MAX_PROTOTYPE_DEPTH` in `PrototypeChainMaterializer` for
 * consistency: 10 levels is generous for any real ontology and bounded
 * enough to protect against pathological cycles that slip past the
 * loaded-set guard (e.g. an asset that references itself via a
 * non-canonical IRI variant).
 */
export const MAX_LAZY_DEPTH = 10;

/**
 * Narrow interface over `NoteToRDFConverter` that the loader depends on.
 * Lets tests pass a structural fake without instantiating the full
 * converter or its `IVaultAdapter` dependency tree.
 */
export interface INoteConverter {
  convertNote(file: IFile): Promise<Triple[]>;
  notePathToIRI(path: string): IRI;
}

/**
 * On-demand asset-graph expansion (RFC `c7da0bca` Phase 2).
 *
 * Replaces the cold-start `convertVault()` full-walk with a per-render
 * lazy strategy: when a layout renders asset N, the loader ensures that
 * N + its class chain + its prototype chain are materialised in the
 * triple store, then the existing `PreconditionEvaluator` runs against
 * the now-up-to-date store.
 *
 * # Loading algorithm
 *
 * For each new file:
 * 1. Call `INoteConverter.convertNote(file)` to obtain the file's
 *    triples; add them to the store.
 * 2. Inspect the loaded triples for `exo:Instance_class`,
 *    `exo:Class_superClass`, and `exo:Asset_prototype` objects.
 * 3. For each IRI object referenced via those predicates, resolve it
 *    to an `IFile` via `IFileResolver.resolveByIRI`, then recursively
 *    ensure-load it.
 *
 * Recursion through `ensureLoadedByIRI` naturally produces the
 * transitive closure: a class's `exo:Class_superClass` triples become
 * visible only after the class file is loaded, so super-classes are
 * walked one BFS level at a time.
 *
 * # Idempotency + cycle safety
 *
 * - `loadedIRIs` Set tracks every IRI ever loaded in this session;
 *   `ensureFileLoaded` and `ensureLoadedByIRI` early-return when their
 *   target is already in the set.
 * - A self-cycle (`A → A`), mutual cycle (`A → B → A`), or longer
 *   cycle is broken at the second visit because the set already
 *   contains the IRI.
 * - `MAX_LAZY_DEPTH` is a defence-in-depth bound: if a pathological
 *   non-canonical IRI variant defeats the set (e.g. case difference,
 *   URL-encoding difference), the depth check still terminates the
 *   recursion.
 *
 * # Out of scope for Phase 2
 *
 * - **`forget(iri)` + `clearAll()` exist but are not yet wired.**
 *   Phase 3b-prep (this PR) ships the API; Phase 3b-main wires
 *   `forget` to `metadataCache.on("changed")` and `clearAll` next
 *   to every `VaultRDFIndexer.refresh()` call site. Until 3b-main
 *   lands, the loader is still write-only at startup (Phase 3a
 *   bootstrap) and renders bypass it — so invalidation is moot
 *   on production at the moment.
 * - **No TBox preload.** Phase 3 wires startup bootstrap of
 *   `assetspaces/{exo,ems,ims,exocmd}` by calling `ensureFileLoaded`
 *   on each ontology asset upfront.
 * - **No SPARQL-AST inspection for data-driven preconditions.** Phase 1
 *   audit (`9271ef44`) found zero data-driven preconditions in the
 *   in-scope vaults, so AST-walk-then-retry is deferred per RFC
 *   `c7da0bca` Q4 decision.
 *
 * @see RFC c7da0bca, Phase 1 audit 9271ef44
 */
@injectable()
export class LazyAssetGraphLoader {
  private readonly loadedIRIs = new Set<string>();
  private readonly instanceClassPredicate: IRI;
  private readonly superClassPredicate: IRI;
  private readonly prototypePredicate: IRI;

  constructor(
    private readonly converter: INoteConverter,
    private readonly fileResolver: IFileResolver,
    private readonly store: ITripleStore,
  ) {
    // Pre-compute the three predicate IRIs we filter triples by.
    this.instanceClassPredicate = Namespace.EXO.term("Instance_class");
    this.superClassPredicate = Namespace.EXO.term("Class_superClass");
    this.prototypePredicate = Namespace.EXO.term("Asset_prototype");
  }

  /**
   * Idempotently ensure that the given file's triples + its class chain
   * + its prototype chain are present in the triple store.
   *
   * @param file - The file whose graph slice to load.
   * @param depth - Internal recursion-depth counter (callers should
   *                omit; defaults to 0).
   */
  async ensureFileLoaded(file: IFile, depth = 0): Promise<void> {
    if (depth >= MAX_LAZY_DEPTH) return;
    const iri = this.converter.notePathToIRI(file.path).value;
    if (this.loadedIRIs.has(iri)) return;

    // Coalesce concurrent renders: setting the loaded mark BEFORE the
    // `await` means a second `ensureFileLoaded(file)` fired in the same
    // tick short-circuits via `loadedIRIs.has`. This avoids racing two
    // `convertNote` calls for the same asset.
    this.loadedIRIs.add(iri);
    try {
      const triples = await this.converter.convertNote(file);
      await this.store.addAll(triples);
      await this.walkClassAndPrototypeRelations(triples, depth + 1);
    } catch (err) {
      // Rollback the loaded mark so the caller can retry. Without this
      // a thrown `convertNote` would poison the IRI for the session —
      // the next ensure-call would short-circuit on the loaded mark
      // while the store has zero triples for the asset.
      this.loadedIRIs.delete(iri);
      throw err;
    }
  }

  /**
   * Resolve an IRI to a file via the injected resolver, then ensure
   * it's loaded. Returns silently if the resolver returns `null`
   * (broken wikilink, IRI built from a string that doesn't correspond
   * to a real vault asset).
   *
   * @param iri - The IRI of an asset to ensure-load.
   * @param depth - Internal recursion-depth counter.
   */
  async ensureLoadedByIRI(iri: IRI, depth = 0): Promise<void> {
    if (depth >= MAX_LAZY_DEPTH) return;
    if (this.loadedIRIs.has(iri.value)) return;
    const file = this.fileResolver.resolveByIRI(iri);
    if (file === null) return;
    await this.ensureFileLoaded(file, depth);
  }

  /**
   * Has the given IRI been loaded? Exposed for tests + future hot-path
   * optimisations (e.g. Phase 3 can short-circuit redundant
   * `ensureLoadedByIRI` calls).
   */
  isLoaded(iri: IRI): boolean {
    return this.loadedIRIs.has(iri.value);
  }

  /**
   * Mark a single IRI as no-longer-loaded so the next ensure-call for
   * this asset re-walks frontmatter + chains afresh.
   *
   * # When to call
   *
   * Wire this to `metadataCache.on("changed")` so an asset edit
   * invalidates the loader's monotonic load-mark. The underlying
   * triple-store cleanup is already handled by
   * `VaultRDFIndexer.updateFile()` (which does
   * `removeFileTriples` + re-convert + re-add), so this method ONLY
   * manages the `loadedIRIs` set — it does NOT touch the store, and
   * it does NOT cascade to the asset's downstream class / prototype
   * chain (those entries are still valid until they too are edited).
   *
   * No-op when the IRI was never loaded.
   *
   * # IRI canonical form (REQUIRED)
   *
   * The IRI MUST be in the canonical form returned by
   * `INoteConverter.notePathToIRI(file.path)` — callers wiring this
   * to file events should construct the IRI via the same converter
   * the loader was instantiated with. A non-canonical IRI (e.g.
   * `new IRI("obsidian://vault/" + file.path)` without `encodeURI`
   * for spaces/unicode) silently no-ops on a mismatch.
   *
   * # Race with in-flight `ensureFileLoaded` (Phase 3b-main concern)
   *
   * `ensureFileLoaded` sets the load-mark BEFORE its
   * `await convertNote()`, which acts as a concurrent-render
   * coalesce-guard. If `forget(iri)` fires during that await window,
   * the mark is removed but the success branch does NOT re-add it.
   * The subsequent ensure-call then re-invokes `convertNote` — which
   * races with `VaultRDFIndexer.updateFile()` (which fires for the
   * same `metadataCache.on("changed")` event). Result: store may
   * contain pre- and post-edit triples briefly, both written by
   * different code paths. This is acceptable in the additive-Phase
   * 3a state (the loader is not render-authoritative) but Phase
   * 3b-main wire-up MUST coordinate the ordering. The right fix is
   * generation-counter detection in `ensureFileLoaded` (option a in
   * the PR #3256 reviewer report) — deferred until 3b-main reveals
   * concrete ordering requirements.
   *
   * @param iri - Canonical-form IRI of the asset to drop from the
   *              loaded-set. See "IRI canonical form" above.
   */
  forget(iri: IRI): void {
    this.loadedIRIs.delete(iri.value);
  }

  /**
   * Wipe the entire loaded-set.
   *
   * # When to call
   *
   * Wire this alongside any `tripleStore.clear()` call — most
   * importantly `VaultRDFIndexer.refresh()`, which clears the store
   * and re-runs `convertVault()`. After such a refresh the store is
   * re-populated by the existing chain, but the loader still believes
   * every IRI in `loadedIRIs` is covered. The next render's
   * `ensureFileLoaded` would short-circuit on the stale mark while
   * the lazy walker has lost its incremental coverage. `clearAll()`
   * resets that invariant.
   *
   * Like `forget`, this method does NOT touch the triple store —
   * store-side cleanup is the caller's responsibility.
   *
   * # Ordering requirement
   *
   * Call `clearAll()` AFTER the synchronous portion of any store-
   * rebuilding operation has resolved — most importantly, AFTER
   * `VaultRDFIndexer.refresh()`'s entire await chain (`clear()` →
   * `convertVault()` → `addAll()` → `runInference()`) has completed.
   * Calling clearAll before the rebuild completes opens a window
   * where concurrent renders can re-populate `loadedIRIs` for assets
   * whose triples are about to be re-added by the bulk rebuild,
   * leading to stale marks. Sequence as:
   *
   *     await sparqlApi.refresh();   // store-side rebuild
   *     lazyLoader.clearAll();       // then reset loader state
   */
  clearAll(): void {
    this.loadedIRIs.clear();
  }

  /**
   * Count of distinct IRIs loaded so far. Useful for observability +
   * test assertions ("did the chain walk reach all 3 expected files?").
   */
  get loadedCount(): number {
    return this.loadedIRIs.size;
  }

  /**
   * Test-only hook to reset the loaded set. Production callers must
   * never call this — the set is intentionally append-only for the
   * session.
   */
  clearForTests(): void {
    this.loadedIRIs.clear();
  }

  /**
   * Scan the newly-loaded triples for class + prototype links and
   * recursively ensure each referenced asset is loaded.
   */
  private async walkClassAndPrototypeRelations(
    triples: ReadonlyArray<Triple>,
    depth: number,
  ): Promise<void> {
    const targets: IRI[] = [];
    for (const t of triples) {
      if (!(t.object instanceof IRI)) continue;
      const predicateValue = t.predicate.value;
      if (
        predicateValue === this.instanceClassPredicate.value ||
        predicateValue === this.superClassPredicate.value ||
        predicateValue === this.prototypePredicate.value
      ) {
        targets.push(t.object);
      }
    }

    for (const target of targets) {
      await this.ensureLoadedByIRI(target, depth);
    }
  }
}
