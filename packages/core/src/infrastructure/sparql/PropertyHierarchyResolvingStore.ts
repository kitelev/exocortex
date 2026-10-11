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
import { Literal } from "../../domain/models/rdf/Literal";
import { BlankNode } from "../../domain/models/rdf/BlankNode";
import { Namespace } from "../../domain/models/rdf/Namespace";

/**
 * Composite-key separator, built at runtime. The byte must not appear as a
 * literal in this file — see scripts/check-no-nul-bytes.mjs for why, and issue
 * #4071 for what it cost.
 */
const KEY_SEP = String.fromCharCode(0);

/**
 * Query-time sub-property resolver (req `e036289d`, RFC 14217015 decision №7):
 * a triple pattern whose predicate is a property P also matches the triples whose
 * predicate is a SUB-PROPERTY of P — declared by `exo__Property_superProperty`,
 * transitively — exactly as a class query sees the instances of its subclasses
 * through {@link ClassHierarchyResolvingStore}.
 *
 * ## The seam it heals
 *
 * A frontmatter key `prefix__Local` is emitted as the SYMBOLIC predicate IRI
 * (`https://exocortex.my/ontology/<prefix>#<Local>`), while the declaration
 * `exo__Property_superProperty` lives on the property's FILE IRI subject
 * (`obsidian://vault/<uid>.md`). The engine had no inference over that edge
 * (`RDFVocabularyMapper` only mirrors it as `rdfs:subPropertyOf`;
 * `RDFSInferenceEngine` walks classes only), so `?idea eideas:ExoizationIdea_exoizable ?src`
 * missed every idea recorded through `_video` / `_book` / `_article`, and a query
 * had to join by label (CQ6's second UNION branch).
 *
 * ## What this decorator does
 *
 * `match(subject, P, object)` with a CONSTANT predicate P in the exocortex
 * ontology namespace that has sub-properties returns the UNION of the direct
 * matches and the matches of every sub-property Q of P, each Q-triple rewritten
 * to carry P — the RDFS entailment `x Q y ∧ Q ⊑ P ⊨ x P y`. A value reached by
 * more than one property is returned once (set semantics of the graph).
 * Everything else is a byte-identical pass-through.
 *
 * - **Scope gate.** Only predicates under `https://exocortex.my/ontology/` are
 *   widened. The W3C vocabulary is not: five of its terms already have native
 *   mirrors (`RDFVocabularyMapper`), `rdfs:subClassOf` would pull reified adapter
 *   edges into class walks, and the live declaration
 *   `exo__Statement_object ⊑ rdf__subject` is a data defect that would put
 *   statement objects into `rdf:subject`. The two class-bridge predicates
 *   (`exo:Class_superClass`, `exo:Instance_class`) are owned by
 *   {@link ClassHierarchyResolvingStore} and are not widened either (the live
 *   declaration `exo__Instance_class ⊑ exo__Instance_class` is a self-loop).
 * - **Edge forms.** A declaration is read from every `exo:Property_superProperty`
 *   triple. Its subject is the property FILE IRI (frontmatter) or the symbolic
 *   property IRI (a reified `exo__Statement` adapter, EKA D5); its object is the
 *   symbolic parent (a bare-UID wikilink) or the parent's FILE IRI (a label-form
 *   wikilink resolved to the file). A file IRI is turned into the predicate form
 *   through its `prefix__Local` label, which the converter already emits as the
 *   same IRI it gives a frontmatter key of that name; a file with a human label
 *   cannot be a predicate and is skipped. The `rdfs:subPropertyOf` mirror is not read: it is
 *   derived from the same frontmatter. A self-declaration (P ⊑ P) closes to an
 *   empty set and only costs the direct match.
 * - **Bounded walk.** The transitive closure of each parent is computed once per
 *   index build over the finite declaration set with a visited set, so a cycle
 *   (A ⊑ B ⊑ A) or a self-declaration terminates by construction; a property is
 *   never its own sub-property. No depth cap: the visited set already bounds the
 *   walk by the number of declared properties, and a cap would silently cut a
 *   legitimate chain.
 * - **Variable predicate** (`?s ?p ?o`) is a pass-through: the stored predicates
 *   are returned, no entailed triples are added. `GRAPH { … }` patterns route
 *   through `matchInGraph`, also a pass-through.
 * - **Zero store growth** — nothing is written to the store.
 * - **Reversible** — `resolvePropertyHierarchy: false` on `ExoQLQueryExecutor`
 *   disables the decorator.
 *
 * ## Index lifecycle (store-scoped, count-invalidated)
 *
 * Same contract as the class index: cached in a process-wide `WeakMap` keyed on
 * the ROOT store (passed as `cacheKey`, so every executor over the same store
 * shares one build even though each executor wraps it in a fresh class decorator)
 * and tagged with the store's triple count; a reindex that changes the count
 * rebuilds it. Known limit (shared with the class index): a mutation that keeps
 * the count identical is not seen until the next count-changing edit.
 */
export class PropertyHierarchyResolvingStore implements ITripleStore {
  private static readonly EXO_PROPERTY_SUPER_PROPERTY =
    Namespace.EXO.term("Property_superProperty").value;
  private static readonly EXO_ASSET_LABEL =
    Namespace.EXO.term("Asset_label").value;

  /** Only predicates of the exocortex ontologies are widened (see the class doc). */
  private static readonly ONTOLOGY_BASE = "https://exocortex.my/ontology/";

  /** Owned by {@link ClassHierarchyResolvingStore}; never widened here. */
  private static readonly CLASS_BRIDGE_PREDICATES: ReadonlySet<string> = new Set([
    Namespace.EXO.term("Class_superClass").value,
    Namespace.EXO.term("Instance_class").value,
  ]);

  /**
   * Store-scoped, count-invalidated cache of `parent predicate IRI value → its
   * transitive sub-properties`. Keyed on the root store; a `WeakMap` entry is
   * collected with its store.
   */
  private static readonly INDEX_CACHE = new WeakMap<
    ITripleStore,
    { count: number; subProperties: Map<string, IRI[]> }
  >();

  // ===== Optional ITripleStore surface — mirrored from the wrapped store =====
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

  /**
   * @param real     the store to delegate to (usually the class-hierarchy decorator)
   * @param cacheKey the ROOT store the index cache is keyed on (defaults to `real`)
   */
  constructor(
    private readonly real: ITripleStore,
    private readonly cacheKey: ITripleStore = real,
  ) {
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
    if (
      predicate &&
      predicate.value.startsWith(PropertyHierarchyResolvingStore.ONTOLOGY_BASE) &&
      !PropertyHierarchyResolvingStore.CLASS_BRIDGE_PREDICATES.has(predicate.value)
    ) {
      const subProperties = (await this.getIndex()).get(predicate.value);
      if (subProperties) {
        return this.matchWithSubProperties(subject, predicate, object, subProperties);
      }
    }
    return this.real.match(subject, predicate, object);
  }

  /**
   * Direct matches of P plus the matches of each sub-property Q, rewritten to P.
   * Direct triples come first, then the sub-properties in index order, so the
   * result is deterministic for a given store.
   */
  private async matchWithSubProperties(
    subject: Subject | undefined,
    predicate: Predicate,
    object: RDFObject | undefined,
    subProperties: IRI[],
  ): Promise<Triple[]> {
    // A COPY: the in-memory store returns its cached result array, which must not
    // grow with the rewritten sub-property triples.
    const out = [...(await this.real.match(subject, predicate, object))];
    for (const sub of subProperties) {
      const triples = await this.real.match(subject, sub, object);
      for (const t of triples) {
        out.push(new Triple(t.subject, predicate, t.object));
      }
    }
    // A value reached through P and a sub-property, or two sub-properties, is the
    // same entailed triple once rewritten to P.
    return PropertyHierarchyResolvingStore.dedupTriples(out);
  }

  private static dedupTriples(triples: Triple[]): Triple[] {
    const seen = new Set<string>();
    const out: Triple[] = [];
    for (const t of triples) {
      const key = `${PropertyHierarchyResolvingStore.termKey(t.subject)}${KEY_SEP}${PropertyHierarchyResolvingStore.termKey(
        t.object,
      )}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  private static termKey(term: Subject | RDFObject): string {
    if (term instanceof IRI) return `I:${term.value}`;
    if (term instanceof Literal) {
      return `L:${term.value}^${term.datatype?.value ?? ""}@${term.language ?? ""}`;
    }
    if (term instanceof BlankNode) return `B:${term.id}`;
    return `?:${term.toString()}`;
  }

  private async getIndex(): Promise<Map<string, IRI[]>> {
    const count = await this.real.count();
    const cached = PropertyHierarchyResolvingStore.INDEX_CACHE.get(this.cacheKey);
    if (cached && cached.count === count) {
      return cached.subProperties;
    }
    const subProperties = await this.buildIndex();
    PropertyHierarchyResolvingStore.INDEX_CACHE.set(this.cacheKey, {
      count,
      subProperties,
    });
    return subProperties;
  }

  /**
   * Read every `exo:Property_superProperty` declaration, normalise both ends to the
   * predicate form, and close each parent transitively. A predicate that is no
   * declaration's parent is absent from the map (the hot path is one map miss).
   */
  private async buildIndex(): Promise<Map<string, IRI[]>> {
    const declarations = await this.real.match(
      undefined,
      new IRI(PropertyHierarchyResolvingStore.EXO_PROPERTY_SUPER_PROPERTY),
      undefined,
    );

    const direct = new Map<string, Set<string>>();
    for (const d of declarations) {
      const child = await this.toPredicateForm(d.subject);
      const parent = await this.toPredicateForm(d.object);
      if (!child || !parent) continue;
      let children = direct.get(parent);
      if (!children) {
        children = new Set<string>();
        direct.set(parent, children);
      }
      children.add(child);
    }

    const subProperties = new Map<string, IRI[]>();
    for (const parent of direct.keys()) {
      const closure: IRI[] = [];
      const visited = new Set<string>([parent]);
      const queue = [...(direct.get(parent) ?? [])];
      while (queue.length > 0) {
        const next = queue.shift() as string;
        if (visited.has(next)) continue;
        visited.add(next);
        closure.push(new IRI(next));
        for (const grandChild of direct.get(next) ?? []) {
          if (!visited.has(grandChild)) queue.push(grandChild);
        }
      }
      subProperties.set(parent, closure);
    }
    return subProperties;
  }

  /**
   * The predicate IRI a declaration end stands for: a symbolic / W3C IRI as is, a
   * property FILE IRI through its label, anything else null. The converter emits a
   * `prefix__Local` `exo__Asset_label` as the very IRI a frontmatter key of that
   * name becomes (`Namespace.fromPropertyKey`), so the label triple's IRI object IS
   * the predicate form; a human label stays a literal and cannot be a predicate.
   */
  private async toPredicateForm(term: Subject | RDFObject): Promise<string | null> {
    if (!(term instanceof IRI)) return null;
    if (!term.value.startsWith("obsidian://")) return term.value;
    const labels = await this.real.match(
      term,
      new IRI(PropertyHierarchyResolvingStore.EXO_ASSET_LABEL),
      undefined,
    );
    for (const label of labels) {
      if (label.object instanceof IRI) return label.object.value;
    }
    return null;
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
