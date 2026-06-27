import {
  InMemoryTripleStore,
  IRI,
  Literal,
  Namespace,
  Triple,
  vaultPathToIRI,
} from "@kitelev/exocortex-core";
import {
  getReifiedRelations,
  ReifiedRelation,
} from "../../src/presentation/renderers/layout/getReifiedRelations";

/**
 * RFC `93a0b2ee` Task 1.1 — production-shape unit test for `getReifiedRelations`
 * over a REAL `InMemoryTripleStore` (not a stub). Statements are seeded exactly
 * the way `NoteToRDFConverter` emits them: the raw
 * `exo__Statement_subject/_predicate/_object` triples (provenance) PLUS the
 * materialized D5 logical edge — so we also prove the helper sources from the
 * statement instances, not the bare edge.
 *
 * `@req:8d134593-3896-42d5-9436-7e994ad8fa7b`  (req-first SDD, RFC 0003).
 *   Revert-verified: forcing `assetIriForms` to return `[]` (no candidate IRI
 *   forms) makes the helper find zero statements → every "expect ≥1 relation"
 *   case below goes RED; restored → GREEN.
 */

// Mirrors NoteToRDFConverter.notePathToIRI with an empty subjectIriPrefix
// (the legacy / default mount) — the exact path-form IRI the converter emits.
const notePathToIRI = (path: string): IRI => new IRI(vaultPathToIRI(path));

const STATEMENT_SUBJECT = Namespace.EXO.term("Statement_subject");
const STATEMENT_PREDICATE = Namespace.EXO.term("Statement_predicate");
const STATEMENT_OBJECT = Namespace.EXO.term("Statement_object");
const RDF_TYPE = Namespace.RDF.term("type");
const EXO_INSTANCE_CLASS = Namespace.EXO.term("Instance_class");
const EXO_STATEMENT_CLASS = Namespace.EXO.term("Statement");

/** A relatesTo-style predicate (opaque to the helper — any IRI works). */
const RELATES_TO = new IRI("https://exocortex.my/ontology/exo-ims#relatesToConcept");
const PART_OF = new IRI("https://exocortex.my/ontology/ems#Effort_area");

/**
 * Seed one reified `exo__Statement` the way the indexer emits it:
 *  - rdf:type / exo:Instance_class → exo:Statement
 *  - the three raw slot triples (provenance lives on the statement subject)
 *  - the materialized D5 logical edge `<subject> <predicate> <object>`
 */
async function seedStatement(
  store: InMemoryTripleStore,
  statementPath: string,
  subject: IRI,
  predicate: IRI,
  object: IRI | Literal,
): Promise<void> {
  const stmt = notePathToIRI(statementPath);
  await store.add(new Triple(stmt, RDF_TYPE, EXO_STATEMENT_CLASS));
  await store.add(new Triple(stmt, EXO_INSTANCE_CLASS, EXO_STATEMENT_CLASS));
  await store.add(new Triple(stmt, STATEMENT_SUBJECT, subject));
  await store.add(new Triple(stmt, STATEMENT_PREDICATE, predicate));
  await store.add(new Triple(stmt, STATEMENT_OBJECT, object));
  // Materialized D5 edge (provenance-free, deduped) — present in the real store.
  await store.add(new Triple(subject, predicate, object));
}

// Paths chosen so the AssetSpace segment is parseable for the provenance assert.
const A_PATH = "assetspaces/kitelev/exoas-my/my/aaaaaaaa-0000-0000-0000-000000000001.md";
const B_PATH = "assetspaces/kitelev/exoas-public/concept/bbbbbbbb-0000-0000-0000-000000000002.md";
const C_PATH = "assetspaces/kitelev/exoas-public/concept/cccccccc-0000-0000-0000-000000000003.md";
const S1_PATH = "assetspaces/kitelev/exoas-class-relations/class-relations/11111111-0000-0000-0000-000000000011.md";
const S2_PATH = "assetspaces/kitelev/exoas-shared-private/relations/22222222-0000-0000-0000-000000000022.md";

describe("getReifiedRelations (Task 1.1 — read-path from exo__Statement instances)", () => {
  it("returns an outgoing reified relation (A is the statement subject) with provenance", async () => {
    const store = new InMemoryTripleStore();
    await seedStatement(store, S1_PATH, notePathToIRI(A_PATH), RELATES_TO, notePathToIRI(B_PATH));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });

    expect(relations).toHaveLength(1);
    const r = relations[0];
    expect(r.direction).toBe("outgoing");
    expect(r.subject).toBe(notePathToIRI(A_PATH).value);
    expect(r.predicate).toBe(RELATES_TO.value);
    expect(r.object).toBe(notePathToIRI(B_PATH).value);
    expect(r.objectIsLiteral).toBe(false);
    // Provenance: backed by the statement asset, NOT the bare materialized edge.
    expect(r.statementIri).toBe(notePathToIRI(S1_PATH).value);
    expect(r.statementPath).toBe(S1_PATH);
    expect(r.assetSpace).toBe("exoas-class-relations");
  });

  it("returns an incoming reified relation (A is the statement object)", async () => {
    const store = new InMemoryTripleStore();
    await seedStatement(store, S2_PATH, notePathToIRI(C_PATH), RELATES_TO, notePathToIRI(A_PATH));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });

    expect(relations).toHaveLength(1);
    const r = relations[0];
    expect(r.direction).toBe("incoming");
    expect(r.subject).toBe(notePathToIRI(C_PATH).value);
    expect(r.object).toBe(notePathToIRI(A_PATH).value);
    expect(r.assetSpace).toBe("exoas-shared-private");
  });

  it("returns both outgoing and incoming relations for the same asset", async () => {
    const store = new InMemoryTripleStore();
    await seedStatement(store, S1_PATH, notePathToIRI(A_PATH), RELATES_TO, notePathToIRI(B_PATH));
    await seedStatement(store, S2_PATH, notePathToIRI(C_PATH), PART_OF, notePathToIRI(A_PATH));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });

    expect(relations).toHaveLength(2);
    const byDir = (d: ReifiedRelation["direction"]) => relations.filter((r) => r.direction === d);
    expect(byDir("outgoing")).toHaveLength(1);
    expect(byDir("incoming")).toHaveLength(1);
    expect(byDir("outgoing")[0].object).toBe(notePathToIRI(B_PATH).value);
    expect(byDir("incoming")[0].subject).toBe(notePathToIRI(C_PATH).value);
  });

  // R5 dual-IRI union: A's label is a prefix-parseable class reference, so the
  // converter resolved A's `[[<uid>]]` in the statement to the SYMBOLIC IRI
  // (concept#Foo), NOT A's path-form. The helper must still find it by querying
  // the symbolic candidate form — otherwise prefix-labeled subjects silently
  // yield 0 (sparql-iri-form-pre-verify). This is the revert-verify anchor for
  // the dual-IRI behavior specifically.
  it("resolves a prefix-labeled subject via the symbolic IRI candidate form (dual-IRI union, not silently 0)", async () => {
    const store = new InMemoryTripleStore();
    const symbolicA = Namespace.forPrefix("concept")!.term("Foo"); // concept#Foo
    await seedStatement(store, S1_PATH, symbolicA, RELATES_TO, notePathToIRI(B_PATH));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "concept__Foo" },
      store,
      notePathToIRI,
    });

    expect(relations).toHaveLength(1);
    expect(relations[0].direction).toBe("outgoing");
    expect(relations[0].subject).toBe(symbolicA.value);
    expect(relations[0].object).toBe(notePathToIRI(B_PATH).value);
  });

  it("flags a literal object (object=Literal → routed to properties in Task 1.3, RFC R6)", async () => {
    const store = new InMemoryTripleStore();
    await seedStatement(store, S1_PATH, notePathToIRI(A_PATH), RELATES_TO, new Literal("a plain value"));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });

    expect(relations).toHaveLength(1);
    expect(relations[0].objectIsLiteral).toBe(true);
    expect(relations[0].object).toBe("a plain value");
  });

  it("does not double-count: the bare materialized edge is not surfaced as a relation", async () => {
    const store = new InMemoryTripleStore();
    // Two statements + their materialized edges. Helper must return exactly 2
    // (one per statement) — never extra rows from the bare edges.
    await seedStatement(store, S1_PATH, notePathToIRI(A_PATH), RELATES_TO, notePathToIRI(B_PATH));
    await seedStatement(store, S2_PATH, notePathToIRI(A_PATH), PART_OF, notePathToIRI(C_PATH));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });

    expect(relations).toHaveLength(2);
    expect(relations.every((r) => r.direction === "outgoing")).toBe(true);
    expect(relations.every((r) => r.statementPath !== null)).toBe(true);
  });

  it("returns [] for an asset with no reified statements", async () => {
    const store = new InMemoryTripleStore();
    // An unrelated statement about other assets must not leak into A's result.
    await seedStatement(store, S2_PATH, notePathToIRI(C_PATH), RELATES_TO, notePathToIRI(B_PATH));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });

    expect(relations).toEqual([]);
  });

  it("returns [] for an empty store", async () => {
    const store = new InMemoryTripleStore();
    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });
    expect(relations).toEqual([]);
  });

  it("skips a malformed statement missing a slot (partial → no half-edge)", async () => {
    const store = new InMemoryTripleStore();
    const stmt = notePathToIRI(S1_PATH);
    // Only _subject present (no predicate / object) — must not surface a relation.
    await store.add(new Triple(stmt, STATEMENT_SUBJECT, notePathToIRI(A_PATH)));

    const relations = await getReifiedRelations({
      file: { path: A_PATH, label: "Концепт A" },
      store,
      notePathToIRI,
    });

    expect(relations).toEqual([]);
  });
});
