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
 * Composite-key separator, built at runtime. The byte must not appear as a
 * literal in this file — see scripts/check-no-nul-bytes.mjs for why, and issue
 * #4071 for what it cost.
 */
const KEY_SEP = String.fromCharCode(0);

/**
 * Thrown when a symbolic `prefix#Local` class reference in a query resolves
 * AMBIGUOUSLY — two or more DISTINCT class files derive the same symbolic form (a
 * cross-ontology prefix collision; RFC 78572fa9 v3 point 9: a prefix is a per-user
 * alias, not identity, so identity is the uid and the prefix may collide). Rather
 * than silently resolve to one, the query-time resolver surfaces the ambiguity so
 * the author disambiguates (by uid, or by narrowing the ontology). Verified zero
 * collisions on the real vaults today — this guards against future authored
 * collisions.
 *
 * ⚠ Scope of the throw: raised inside `resolveSymbolicToFileIri`, which is shared by
 * BOTH the class-hierarchy SUBJECT path (pre-existing, req 9fddda62) and the new
 * membership OBJECT path — so an ambiguous collision changes BOTH (a hierarchy walk
 * over an ambiguous symbolic subject, which previously resolved last-write-wins, now
 * throws too). This is contingent on the empty-ambiguous-set invariant; while it
 * holds, both paths stay byte-identical.
 *
 * ⚠ Where the hint reaches: a SELECT / a direct `executeAsk` caller receives the
 * error. A vault SPARQL PRECONDITION does NOT — `PreconditionEvaluator` swallows an
 * ASK error into `false` (fail-CLOSED: an unevaluable gate hides the command), so the
 * disambiguation hint is not user-visible for the precondition surface.
 */
export class SymbolicClassAmbiguityError extends Error {
  constructor(public readonly symbolic: string) {
    super(
      `Ambiguous class reference '${symbolic}' — two or more class files derive ` +
        `this symbolic form (a prefix collision). The prefix is an alias, not ` +
        `identity: reference the class by its uid, or narrow the ontology.`,
    );
    this.name = "SymbolicClassAmbiguityError";
  }
}

/**
 * Query-time class-reference resolver (RFC 78572fa9 Candidate B) — the QUERY-TIME
 * replacement for the abandoned A2 store-materialization approach. Started as the
 * Phase-0 class-HIERARCHY-walk bridge (req `9fddda62`); generalized in Phase 3
 * stage-1 (req `c359e3d2`) to ALSO resolve the `exo__Instance_class` OBJECT position
 * so a direct-membership query written by the readable symbolic name keeps matching
 * once the converter emits the class uid (file IRI) there. Despite the historical
 * name, it now resolves class references at two positions (hierarchy subject +
 * Instance_class object).
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
 * `match(subject, predicate, object)` is a **pure pass-through** for every query
 * except two bridged positions, both keyed off the same memoized `symbolic-IRI →
 * file-IRI` class index (built lazily, once per store-content change):
 *
 * 1. **Hierarchy SUBJECT position** (req `9fddda62`) — `exo__Class_superClass` / its
 *    `rdfs:subClassOf` mirror (RFC 871) queried with a symbolic class subject that
 *    has no direct edges: resolve subject → file IRI, delegate, rewrite the returned
 *    triples' SUBJECT back to the symbolic form (so `PropertyPathExecutor`'s per-node
 *    visited-set stays consistent across the transitive walk).
 * 2. **Instance_class OBJECT position** (RFC 78572fa9 Phase 3 stage-1, req
 *    `c359e3d2`) — `exo__Instance_class` queried with a symbolic class OBJECT: once
 *    the emission flip stores the class uid there, resolve the queried symbolic
 *    object → file IRI, UNION the direct symbolic-form matches (a MIXED store may
 *    still hold residual symbolic entries) with the bridged file-IRI-form matches,
 *    and rewrite each bridged triple's OBJECT back to the queried symbolic form.
 *    Byte-identical when the store still holds symbolic objects (flip OFF).
 *
 * The index is COMPREHENSIVE over TBox (every `prefix__Local` label, not just
 * hierarchy-edge subjects) so metaclasses (`exo__Class`) resolve for position 2.
 * A symbolic form to which two DISTINCT class files map (a prefix collision) is
 * ambiguous → a lookup throws {@link SymbolicClassAmbiguityError} (error-with-hint,
 * RFC v3 point 9) rather than silently resolving to one.
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

  private static readonly EXO_INSTANCE_CLASS =
    Namespace.EXO.term("Instance_class").value;

  private static readonly RDF_TYPE = Namespace.RDF.term("type").value;

  /**
   * Symbolic ontology IRI base (`https://exocortex.my/ontology/`). A class reference
   * in a membership OBJECT position is a symbolic class IRI iff it starts with this
   * base (a `<prefix>#<Local>` form). A file-IRI object (`obsidian://vault/<uid>.md`)
   * or a W3C IRI is never bridged — it matches the store directly / is not an
   * exocortex class ref.
   */
  private static readonly ONTOLOGY_BASE = "https://exocortex.my/ontology/";

  private static readonly HIERARCHY_PREDICATES: ReadonlySet<string> = new Set([
    ClassHierarchyResolvingStore.EXO_CLASS_SUPER_CLASS,
    ClassHierarchyResolvingStore.RDFS_SUBCLASS_OF,
  ]);

  /**
   * RFC 78572fa9 Phase 3 stage-1 — the class-MEMBERSHIP predicates whose symbolic
   * class OBJECT is bridged when the emission flip stores the class file IRI (uid)
   * there. `NoteToRDFConverter.convertLegacyNote` emits BOTH `exo__Instance_class`
   * AND `rdf:type` from the SAME flag-gated `valueToClassURI` object, so the flip
   * couples them — bridging both keeps `?s exo:Instance_class <X>` and the RDF-standard
   * `?s rdf:type <X>` membership queries working (see {@link matchMembershipObject}).
   */
  private static readonly MEMBERSHIP_PREDICATES: ReadonlySet<string> = new Set([
    ClassHierarchyResolvingStore.EXO_INSTANCE_CLASS,
    ClassHierarchyResolvingStore.RDF_TYPE,
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
    {
      count: number;
      index: Map<string, IRI>;
      /**
       * Symbolic class forms that resolve AMBIGUOUSLY — two or more distinct class
       * files derive the same `prefix#Local` (a cross-ontology prefix collision, RFC
       * v3 point 9: prefixes are aliases, not identity). A lookup of an ambiguous
       * form throws {@link SymbolicClassAmbiguityError} (error-with-hint) rather than
       * silently resolving to one. Verified empty on the real vaults today; this is
       * safe future-proofing for when prefix collisions are authored.
       */
      ambiguous: Set<string>;
    }
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

  // ===== The intercepted method =====

  async match(
    subject?: Subject,
    predicate?: Predicate,
    object?: RDFObject,
  ): Promise<Triple[]> {
    // Branch 1 — class-HIERARCHY SUBJECT-position bridge (req 9fddda62): a hierarchy
    // predicate (`Class_superClass` / `rdfs:subClassOf`) queried with a concrete IRI
    // subject. The symbolic-subject climb of a transitive walk is bridged file-side.
    if (
      predicate &&
      ClassHierarchyResolvingStore.HIERARCHY_PREDICATES.has(predicate.value) &&
      subject instanceof IRI
    ) {
      return this.matchHierarchySubject(subject, predicate, object);
    }

    // Branch 2 — class-MEMBERSHIP OBJECT-position bridge (RFC 78572fa9 Phase 3
    // stage-1): a direct-membership query `?s exo:Instance_class <symbolic-class-IRI>`
    // (or the co-emitted `?s rdf:type <symbolic-class-IRI>`) whose OBJECT is a symbolic
    // class IRI. Once the emission flip makes an asset's membership object the class
    // FILE IRI, a query written by the readable symbolic name is bridged object-side.
    // Byte-identical when the store still holds symbolic objects (flag OFF) — the
    // bridge's file-IRI match is empty then and the union collapses to the direct
    // symbolic match.
    if (
      predicate &&
      ClassHierarchyResolvingStore.MEMBERSHIP_PREDICATES.has(predicate.value) &&
      object instanceof IRI &&
      object.value.startsWith(ClassHierarchyResolvingStore.ONTOLOGY_BASE)
    ) {
      return this.matchMembershipObject(subject, predicate, object);
    }

    // Everything else — wildcard-predicate scans, non-hierarchy / non-membership
    // predicates, variable/blank/quoted subjects, file-IRI or W3C objects — is a
    // byte-identical pass-through (the decorator is invisible to the rest of the
    // engine).
    return this.real.match(subject, predicate, object);
  }

  /**
   * Class-hierarchy SUBJECT-position bridge (req 9fddda62). A subject with native
   * hierarchy edges (a class queried by its FILE IRI — the file-IRI-form instances'
   * first hop) resolves directly; no bridge needed. Load-bearing invariant: the
   * converter NEVER emits a symbolic class IRI as a hierarchy-triple SUBJECT
   * (`Class_superClass` subjects are always the class FILE IRI), so `direct` is empty
   * for a symbolic subject — the short-circuit only fires for file-IRI subjects and
   * never suppresses a needed bridge.
   */
  private async matchHierarchySubject(
    subject: IRI,
    predicate: Predicate,
    object?: RDFObject,
  ): Promise<Triple[]> {
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

    // Rewrite each bridged triple's SUBJECT back to the symbolic form the caller
    // queried, so PropertyPathExecutor's per-node identity (visited-set keyed on
    // `node.toString()`) stays consistent as the transitive walk climbs symbolic
    // nodes. The predicate and object (the symbolic parent class) are preserved.
    return bridged.map((t) => new Triple(subject, t.predicate, t.object));
  }

  /**
   * Class-MEMBERSHIP OBJECT-position bridge (RFC 78572fa9 Phase 3 stage-1). A query
   * `match(subject, <exo:Instance_class | rdf:type>, <symbolic-class-IRI>)` — direct
   * membership by the class's readable symbolic name. After the emission flip the
   * store holds the class FILE IRI as the membership object, so:
   *   - resolve the queried symbolic class IRI → its class FILE IRI (uid);
   *   - UNION the direct symbolic-form matches (residual entries a MIXED store may
   *     still hold — unresolved-ref instances keep symbolic) with the bridged
   *     file-IRI-form matches, rewriting each bridged triple's OBJECT back to the
   *     symbolic form the caller queried (so downstream comparisons / a SELECT ?c see
   *     the readable form; identity stays uid, the readable form is computed).
   * Byte-identical when the store holds symbolic objects (flag OFF): the file-IRI
   * match is empty then → the union collapses to the direct symbolic match. Zero
   * store growth. An ambiguous symbolic form throws (error-with-hint).
   */
  private async matchMembershipObject(
    subject: Subject | undefined,
    predicate: Predicate,
    object: IRI,
  ): Promise<Triple[]> {
    const fileIri = await this.resolveSymbolicToFileIri(object.value);
    const direct = await this.real.match(subject, predicate, object);
    // Not a known symbolic class (e.g. a symbolic PROPERTY IRI, or a class not in the
    // store) → only the direct result stands (usually empty).
    if (!fileIri) {
      return direct;
    }
    const bridged = await this.real.match(subject, predicate, fileIri);
    if (bridged.length === 0) {
      return direct;
    }
    // Rewrite each bridged triple's OBJECT back to the queried symbolic class IRI.
    const rewritten = bridged.map(
      (t) => new Triple(t.subject, t.predicate, object),
    );
    return ClassHierarchyResolvingStore.dedupTriples([...direct, ...rewritten]);
  }

  /**
   * Dedup a union of matched triples by (subject, predicate, object) value. The
   * direct + bridged sets are disjoint in the common case; this guards the rare
   * MIXED-store edge where one asset references the same class both by a RESOLVED
   * ref (file-IRI) and an UNRESOLVED prefix__Local ref (symbolic) — both forms then
   * surface as the same rewritten triple.
   */
  private static dedupTriples(triples: Triple[]): Triple[] {
    const seen = new Set<string>();
    const out: Triple[] = [];
    for (const t of triples) {
      const key = `${ClassHierarchyResolvingStore.termKey(t.subject)}${KEY_SEP}${ClassHierarchyResolvingStore.termKey(
        t.predicate,
      )}${KEY_SEP}${ClassHierarchyResolvingStore.termKey(t.object)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  private static termKey(term: unknown): string {
    if (term instanceof IRI) return `I:${term.value}`;
    if (term && typeof term === "object" && "value" in term) {
      const v = (term as { value: unknown }).value;
      const dt = (term as { datatype?: { value?: string } }).datatype?.value ?? "";
      return `L:${String(v)}^${dt}`;
    }
    return `?:${String(term)}`;
  }

  /**
   * Resolve a symbolic `prefix#Local` class IRI to its class FILE IRI via the
   * memoized index. Throws {@link SymbolicClassAmbiguityError} when the symbolic
   * form is ambiguous (a prefix collision); returns null when it is not a known
   * class.
   */
  private async resolveSymbolicToFileIri(
    symbolicValue: string,
  ): Promise<IRI | null> {
    const { index, ambiguous } = await this.getIndex();
    if (ambiguous.has(symbolicValue)) {
      throw new SymbolicClassAmbiguityError(symbolicValue);
    }
    return index.get(symbolicValue) ?? null;
  }

  /**
   * Return the store-scoped index, rebuilding it when the wrapped store's triple
   * count has changed since the cached build (an in-place reindex). Concurrent
   * misses may both build — the result is identical, so the redundant build is
   * harmless; within a single query the count is stable, so exactly one build runs
   * and every later hierarchy hop hits the cache.
   */
  private async getIndex(): Promise<{
    index: Map<string, IRI>;
    ambiguous: Set<string>;
  }> {
    const count = await this.real.count();
    const cached = ClassHierarchyResolvingStore.INDEX_CACHE.get(this.real);
    if (cached && cached.count === count) {
      return { index: cached.index, ambiguous: cached.ambiguous };
    }
    const { index, ambiguous } = await this.buildIndex();
    ClassHierarchyResolvingStore.INDEX_CACHE.set(this.real, {
      count,
      index,
      ambiguous,
    });
    return { index, ambiguous };
  }

  /**
   * Build the `symbolic class IRI value → class file IRI` index (+ the ambiguous
   * set) by scanning EVERY subject's label (`exo__Asset_label` + its `rdfs:label`
   * mirror) and deriving its symbolic `prefix#Local` form — mirroring exactly what
   * `NoteToRDFConverter.expandClassValue` emits for a class reference.
   *
   * COMPREHENSIVE over TBox (broader than the hierarchy-edge-subject set the
   * hierarchy bridge alone needs) so a class WITHOUT an outgoing superClass edge —
   * a metaclass like `exo__Class`, a root marker like `exo__Prototype` — still
   * resolves for the Instance_class OBJECT bridge (RFC 78572fa9 Phase 3 stage-1). It
   * remains a SUPERSET of the hierarchy-subject set, so the hierarchy bridge's
   * lookups are unaffected. Free-form ABox labels (not `prefix__Local`) yield null
   * from `labelToSymbolicIRI` → excluded. One scan, memoized per store-instance.
   *
   * Two DISTINCT class files deriving the same `prefix#Local` (a cross-ontology
   * prefix collision, RFC v3 point 9) are recorded as ambiguous → a lookup throws.
   */
  private async buildIndex(): Promise<{
    index: Map<string, IRI>;
    ambiguous: Set<string>;
  }> {
    const index = new Map<string, IRI>();
    const ambiguous = new Set<string>();

    const labelTriples = [
      ...(await this.real.match(
        undefined,
        new IRI(ClassHierarchyResolvingStore.EXO_ASSET_LABEL),
        undefined,
      )),
      ...(await this.real.match(
        undefined,
        new IRI(ClassHierarchyResolvingStore.RDFS_LABEL),
        undefined,
      )),
    ];

    for (const t of labelTriples) {
      if (!(t.subject instanceof IRI)) continue;
      const labelValue = ClassHierarchyResolvingStore.literalValue(t.object);
      if (labelValue === null) continue;
      const symbolic =
        ClassHierarchyResolvingStore.labelToSymbolicIRI(labelValue);
      if (!symbolic) continue;
      const existing = index.get(symbolic);
      if (!existing) {
        index.set(symbolic, t.subject);
      } else if (existing.value !== t.subject.value) {
        // Two DIFFERENT class files derive the same symbolic form → ambiguous. Same
        // subject via both label predicates (Asset_label + its rdfs:label mirror) is
        // NOT a collision (existing.value === subject.value → no-op).
        ambiguous.add(symbolic);
      }
    }

    return { index, ambiguous };
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
