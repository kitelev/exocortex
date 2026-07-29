import type {
  ITripleStore,
  ITransaction,
  GraphName,
} from "../../interfaces/ITripleStore";
import {
  Triple,
  type Subject,
  type Predicate,
  type Object as RDFObject,
} from "../../domain/models/rdf/Triple";
import { IRI } from "../../domain/models/rdf/IRI";
import { Namespace } from "../../domain/models/rdf/Namespace";

/**
 * Query-time class-hierarchy resolver (RFC 78572fa9 Candidate B Phase 0,
 * req `9fddda62`) — the QUERY-TIME replacement for the abandoned A2
 * store-materialization approach.
 *
 * ## The dual-IRI seam it heals
 *
 * `NoteToRDFConverter` emits an asset's `exo__Instance_class` as the SYMBOLIC
 * class IRI (`https://exocortex.my/ontology/<prefix>#<Local>`), while the class
 * file's `exo__Class_superClass` / `rdfs:subClassOf` hierarchy edges key on the
 * class file's FILE IRI subject (`obsidian://vault/<uid>.md`). So a pure-SPARQL
 * transitive walk
 *
 * ```sparql
 * ?s exo:Instance_class ?c . ?c exo:Class_superClass* <X>
 * ```
 *
 * truncates at the first symbolic node: `match(<symbolic-class>, Class_superClass,
 * undefined)` returns nothing because the edges live on the file IRI. TS consumers
 * (`CommandResolver.getClassAncestorsWithDepth`, SHACL `TripleClassHierarchy`)
 * bridge this internally; vault-declared pure-SPARQL preconditions / Competency
 * Queries / analytics cannot.
 *
 * ## What this decorator does
 *
 * A thin `ITripleStore` decorator injected ONCE inside `ExoQLQueryExecutor`'s
 * constructor, so both `BGPExecutor` and `PropertyPathExecutor` (which share the
 * single `store.match` call) inherit it — ASK preconditions AND SELECT analytics
 * are fixed by one mechanism.
 *
 * `match(subject, predicate, object)` is a **pure pass-through** for every
 * predicate except `exo__Class_superClass` and its `rdfs:subClassOf` mirror
 * (RFC 871 vocabulary map). For a hierarchy predicate queried with a symbolic
 * class subject that has no direct edges, it lazily builds a memoized
 * `symbolic-IRI → file-IRI` class index, delegates to the underlying store using
 * the file IRI, and rewrites the returned triples' subject back to the symbolic
 * form the caller queried (so `PropertyPathExecutor`'s per-node visited-set stays
 * consistent across the bridge).
 *
 * - **Predicate-scoped** — non-hierarchy queries are byte-identical pass-through
 *   → zero behaviour change for the rest of the engine. Only the DEFAULT-graph,
 *   FORWARD transitive walk is bridged: `GRAPH { … }` named-graph hierarchy walks
 *   (they route through `matchInGraph`, a pass-through here) and inverse
 *   `^exo:Class_superClass` (find-subclasses; `match(undefined, pred, start)` →
 *   variable subject → pass-through) are out of scope — the RFC targets the
 *   default-graph forward walk.
 * - **Symmetric** — a file-IRI subject with native edges short-circuits (its first
 *   hop is direct); only symbolic subjects are bridged. So it heals BOTH the
 *   symbolic-form and the file-IRI-form instances (whose first hop is native and
 *   whose subsequent symbolic ancestor hops are bridged).
 * - **Zero store growth** — the resolution is per-match and discarded; nothing is
 *   written to the store, so `RDFSInferenceEngine` is never fed (the anti-A2
 *   guarantee — A2 grew the store +22-27% via materialized ancestor triples).
 * - **Reversible** — the `resolveClassHierarchy` config toggle on
 *   `ExoQLQueryExecutor` disables the decorator entirely → baseline behaviour.
 *
 * ## Index lifecycle (store-scoped, count-invalidated)
 *
 * The `symbolic → file-IRI` index is built lazily on the first hierarchy match and
 * cached in a process-wide `WeakMap` keyed on the WRAPPED STORE INSTANCE (not the
 * decorator / executor), tagged with the store's triple count at build time. This
 * matters because `ExoQLQueryExecutor` — hence this decorator — can outlive a
 * reindex: the plugin's `SPARQLQueryService` constructs the executor ONCE and holds
 * it for the whole session while `VaultRDFIndexer.refresh()` / `updateFile()` /
 * `reindexPathsFromDisk()` mutate the SAME `InMemoryTripleStore` in place
 * (`clear()`/`removeAll()` + `addAll()`). Keying on the store instance + its count:
 *   - a reindex that adds/removes triples (class created/deleted, any file change)
 *     changes `count()` → the next hierarchy match rebuilds the index (no staleness);
 *   - all executors over the SAME store (e.g. `PreconditionEvaluator`'s fresh
 *     per-evaluation executor) share the one built index → no per-evaluation
 *     O(#classes) rebuild.
 *
 * Cost: one O(#classes) build per store-content change, then per-hop O(1) lookup +
 * one cheap `count()` per hierarchy match. Known limit (rare): a mutation that keeps
 * the triple count IDENTICAL (e.g. relabelling a class in place) is not detected
 * until the next count-changing edit or a plugin reload — `count()` is the store's
 * only cheap content fingerprint (no mutation/version signal is exposed).
 */
export class ClassHierarchyResolvingStore implements ITripleStore {
  private static readonly EXO_CLASS_SUPER_CLASS =
    Namespace.EXO.term("Class_superClass").value;
  private static readonly RDFS_SUBCLASS_OF =
    Namespace.RDFS.term("subClassOf").value;
  private static readonly RDFS_LABEL = Namespace.RDFS.term("label").value;
  private static readonly EXO_ASSET_LABEL =
    Namespace.EXO.term("Asset_label").value;

  private static readonly HIERARCHY_PREDICATES: ReadonlySet<string> = new Set([
    ClassHierarchyResolvingStore.EXO_CLASS_SUPER_CLASS,
    ClassHierarchyResolvingStore.RDFS_SUBCLASS_OF,
  ]);

  /**
   * Store-scoped, count-invalidated cache of the `symbolic class IRI value → class
   * file IRI` map. Keyed on the WRAPPED store instance (so every decorator/executor
   * over the same store shares one build) and tagged with the store's triple count
   * at build time (so an in-place reindex that changes the count triggers a rebuild
   * — see the class doc's "Index lifecycle"). A `WeakMap` never leaks: an entry is
   * collected with its store.
   */
  private static readonly INDEX_CACHE = new WeakMap<
    ITripleStore,
    { count: number; index: Map<string, IRI> }
  >();

  // ===== Optional ITripleStore surface — mirrored from the wrapped store =====
  // Declared optional and assigned in the constructor only when the underlying
  // store provides them, so the decorator's method-presence exactly matches the
  // real store (callers that gate on `store.matchInGraph` / `findSubjectsByUUIDSync`
  // see identical behaviour with or without the decorator).
  findSubjectsByUUID?: (uuid: string) => Promise<Subject[]>;
  findSubjectsByUUIDSync?: (uuid: string) => Subject[];
  addToGraph?: (triple: Triple, graph: GraphName) => Promise<void>;
  removeFromGraph?: (triple: Triple, graph: GraphName) => Promise<boolean>;
  matchInGraph?: (
    subject?: Subject,
    predicate?: Predicate,
    object?: RDFObject,
    graph?: GraphName,
  ) => Promise<Triple[]>;
  getNamedGraphs?: () => Promise<IRI[]>;
  hasGraph?: (graph: IRI) => Promise<boolean>;
  clearGraph?: (graph: GraphName) => Promise<void>;
  countInGraph?: (graph: GraphName) => Promise<number>;

  constructor(private readonly real: ITripleStore) {
    // Mirror the wrapped store's optional-method presence exactly. `?.bind(real)`
    // yields the bound method when the store provides it and `undefined` when it
    // does not — behaviourally identical to the wrapped store for the codebase's
    // truthy / optional-chain gates (`if (!store.matchInGraph)`, `store.findSubjectsByUUIDSync?.(...)`).
    this.findSubjectsByUUID = real.findSubjectsByUUID?.bind(real);
    this.findSubjectsByUUIDSync = real.findSubjectsByUUIDSync?.bind(real);
    this.addToGraph = real.addToGraph?.bind(real);
    this.removeFromGraph = real.removeFromGraph?.bind(real);
    this.matchInGraph = real.matchInGraph?.bind(real);
    this.getNamedGraphs = real.getNamedGraphs?.bind(real);
    this.hasGraph = real.hasGraph?.bind(real);
    this.clearGraph = real.clearGraph?.bind(real);
    this.countInGraph = real.countInGraph?.bind(real);
  }

  // ===== The one intercepted method =====

  async match(
    subject?: Subject,
    predicate?: Predicate,
    object?: RDFObject,
  ): Promise<Triple[]> {
    // Predicate-scoped early-out: only intercept the class-hierarchy predicates
    // with a concrete IRI subject. Everything else — wildcard-predicate scans,
    // non-hierarchy predicates, variable/blank/quoted subjects — is a byte-identical
    // pass-through (the decorator is invisible to the rest of the engine).
    if (
      !predicate ||
      !ClassHierarchyResolvingStore.HIERARCHY_PREDICATES.has(predicate.value) ||
      !(subject instanceof IRI)
    ) {
      return this.real.match(subject, predicate, object);
    }

    // A subject with native hierarchy edges (a class queried by its FILE IRI —
    // the file-IRI-form instances' first hop) resolves directly; no bridge needed.
    // This is what makes the decorator symmetric: file-IRI first hop is native,
    // subsequent symbolic ancestor hops are bridged below. Load-bearing invariant:
    // the converter NEVER emits a symbolic class IRI as a hierarchy-triple SUBJECT
    // (Class_superClass subjects are always the class FILE IRI), so `direct` is
    // empty for a symbolic subject — the short-circuit only fires for file-IRI
    // subjects and never suppresses a needed bridge.
    const direct = await this.real.match(subject, predicate, object);
    if (direct.length > 0) {
      return direct;
    }

    // No direct edges → the subject is a symbolic class IRI whose hierarchy edges
    // live on its file IRI. Resolve it and delegate; if the subject is not a known
    // symbolic class, the (empty) direct result stands.
    const fileIri = await this.resolveSymbolicToFileIri(subject.value);
    if (!fileIri) {
      return direct;
    }

    const bridged = await this.real.match(fileIri, predicate, object);
    if (bridged.length === 0) {
      return bridged;
    }

    // Rewrite each bridged triple's subject back to the symbolic form the caller
    // queried, so PropertyPathExecutor's per-node identity (visited-set keyed on
    // `node.toString()`) stays consistent as the transitive walk climbs symbolic
    // nodes. The predicate and object (the symbolic parent class) are preserved.
    return bridged.map((t) => new Triple(subject, t.predicate, t.object));
  }

  private async resolveSymbolicToFileIri(
    symbolicValue: string,
  ): Promise<IRI | null> {
    const index = await this.getIndex();
    return index.get(symbolicValue) ?? null;
  }

  /**
   * Return the store-scoped index, rebuilding it when the wrapped store's triple
   * count has changed since the cached build (an in-place reindex). Concurrent
   * misses may both build — the result is identical, so the redundant build is
   * harmless; within a single query the count is stable, so exactly one build runs
   * and every later hierarchy hop hits the cache.
   */
  private async getIndex(): Promise<Map<string, IRI>> {
    const count = await this.real.count();
    const cached = ClassHierarchyResolvingStore.INDEX_CACHE.get(this.real);
    if (cached && cached.count === count) {
      return cached.index;
    }
    const index = await this.buildIndex();
    ClassHierarchyResolvingStore.INDEX_CACHE.set(this.real, { count, index });
    return index;
  }

  /**
   * Build the `symbolic class IRI value → class file IRI` index by scanning the
   * store's hierarchy triples for class file-IRI subjects, then deriving each
   * class's symbolic form from its label — mirroring exactly what
   * `NoteToRDFConverter.expandClassValue` emits for the instance/superclass
   * references the walk queries.
   */
  private async buildIndex(): Promise<Map<string, IRI>> {
    const index = new Map<string, IRI>();

    const superPred = new IRI(ClassHierarchyResolvingStore.EXO_CLASS_SUPER_CLASS);
    const subClassPred = new IRI(ClassHierarchyResolvingStore.RDFS_SUBCLASS_OF);
    const hierarchyTriples = [
      ...(await this.real.match(undefined, superPred, undefined)),
      ...(await this.real.match(undefined, subClassPred, undefined)),
    ];

    // Class file IRIs = the subjects of hierarchy edges (a class with an OUTGOING
    // superclass edge is the only kind of node the transitive walk ever needs to
    // bridge — a leaf ancestor with no outgoing edge is reached as an object and
    // never re-queried as a subject).
    const classFileIris = new Set<string>();
    for (const t of hierarchyTriples) {
      if (t.subject instanceof IRI) {
        classFileIris.add(t.subject.value);
      }
    }

    for (const fileIriValue of classFileIris) {
      const fileIri = new IRI(fileIriValue);
      const symbolic = await this.deriveSymbolicForm(fileIri);
      if (symbolic) {
        index.set(symbolic, fileIri);
      }
    }

    return index;
  }

  /**
   * Derive the symbolic ontology IRI for a class file IRI from its label
   * (`rdfs:label` preferred, `exo__Asset_label` fallback — both emitted by the
   * converter for a class asset). Uses the SAME `prefix__Local → base/prefix#Local`
   * rule as `NoteToRDFConverter.expandClassValue`, so the derived key exactly
   * equals the symbolic form the walk queries.
   */
  private async deriveSymbolicForm(fileIri: IRI): Promise<string | null> {
    const labelTriples = [
      ...(await this.real.match(
        fileIri,
        new IRI(ClassHierarchyResolvingStore.RDFS_LABEL),
        undefined,
      )),
      ...(await this.real.match(
        fileIri,
        new IRI(ClassHierarchyResolvingStore.EXO_ASSET_LABEL),
        undefined,
      )),
    ];

    for (const t of labelTriples) {
      const value = ClassHierarchyResolvingStore.literalValue(t.object);
      if (value === null) continue;
      const symbolic = ClassHierarchyResolvingStore.labelToSymbolicIRI(value);
      if (symbolic) return symbolic;
    }
    return null;
  }

  private static literalValue(object: RDFObject): string | null {
    // A label object is a Literal — read its `.value` without importing Literal
    // (avoids a circular-ish coupling; the decorator only needs the string).
    if (
      typeof object === "object" &&
      object !== null &&
      "value" in object &&
      !(object instanceof IRI) &&
      typeof (object as { value: unknown }).value === "string"
    ) {
      return (object as { value: string }).value;
    }
    return null;
  }

  /**
   * `prefix__Local` label → `https://exocortex.my/ontology/prefix#Local`.
   * Mirrors `NoteToRDFConverter.expandClassValue` exactly (same
   * `Namespace.fromPropertyKey` + whitespace/paren guard) so the index key equals
   * the converter's emitted class IRI.
   */
  private static labelToSymbolicIRI(label: string): string | null {
    const parsed = Namespace.fromPropertyKey(label);
    if (!parsed) return null;
    if (/[\s()]/.test(parsed.localName)) return null;
    return parsed.namespace.term(parsed.localName).value;
  }

  // ===== Required ITripleStore surface — pure pass-through =====

  add(triple: Triple): Promise<void> {
    return this.real.add(triple);
  }

  remove(triple: Triple): Promise<boolean> {
    return this.real.remove(triple);
  }

  has(triple: Triple): Promise<boolean> {
    return this.real.has(triple);
  }

  addAll(triples: Triple[]): Promise<void> {
    return this.real.addAll(triples);
  }

  removeAll(triples: Triple[]): Promise<number> {
    return this.real.removeAll(triples);
  }

  clear(): Promise<void> {
    return this.real.clear();
  }

  count(): Promise<number> {
    return this.real.count();
  }

  subjects(): Promise<Subject[]> {
    return this.real.subjects();
  }

  predicates(): Promise<Predicate[]> {
    return this.real.predicates();
  }

  objects(): Promise<RDFObject[]> {
    return this.real.objects();
  }

  beginTransaction(): Promise<ITransaction> {
    return this.real.beginTransaction();
  }
}
