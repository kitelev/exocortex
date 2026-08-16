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
  labelToSymbolicIRI,
  predicateKeyFromLabelObjects,
  reifiedPredicateFrontmatterKey,
  symbolicIriToPropertyKey,
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

/**
 * ems__Bug `dcb9ed83` — reify predicate-def resolution dropped every clean-prefix
 * predicate because a property-definition's `exo__Asset_label` is emitted by the
 * converter as a symbolic IRI (dual-IRI), not a Literal. These functions recover
 * the frontmatter key from BOTH forms. Revert-verify: removing the IRI branch of
 * `predicateKeyFromLabelObjects` makes the "IRI-form label" cases below go RED
 * (the exact production shape — `exo__Asset_relates` reify then fails).
 */
describe("symbolicIriToPropertyKey (inverse of labelToSymbolicIRI)", () => {
  it("recovers <prefix>__<LocalName> from an ontology symbolic IRI", () => {
    expect(
      symbolicIriToPropertyKey("https://exocortex.my/ontology/exo#Asset_relates"),
    ).toBe("exo__Asset_relates");
    expect(
      symbolicIriToPropertyKey("https://exocortex.my/ontology/ems#Effort_area"),
    ).toBe("ems__Effort_area");
    expect(
      symbolicIriToPropertyKey("https://exocortex.my/ontology/concept#Concept_broader"),
    ).toBe("concept__Concept_broader");
  });

  it("round-trips with labelToSymbolicIRI for clean-prefix keys", () => {
    for (const key of [
      "exo__Asset_relates",
      "ems__Effort_area",
      "aiKnow__Memory_aboutConcept",
    ]) {
      const iri = labelToSymbolicIRI(key);
      expect(iri).not.toBeNull();
      expect(symbolicIriToPropertyKey(iri!.value)).toBe(key);
    }
  });

  it("returns null for a non-ontology IRI (path-form ref, unregistered host, empty)", () => {
    expect(
      symbolicIriToPropertyKey("obsidian://vault/assetspaces/x/1234.md"),
    ).toBeNull();
    // An UNREGISTERED external vocabulary still yields null (SKOS is not in
    // KNOWN_NAMESPACES) — the exemption is per-registered-namespace, not
    // "anything on w3.org".
    expect(
      symbolicIriToPropertyKey("http://www.w3.org/2004/02/skos/core#broader"),
    ).toBeNull();
    expect(symbolicIriToPropertyKey("https://exocortex.my/ontology/exo#")).toBeNull();
    expect(symbolicIriToPropertyKey("")).toBeNull();
  });

  /**
   * @req:aceaa2cc-15b6-4e1c-bf63-72c7c209de51
   *
   * INTENDED BEHAVIOUR CHANGE. This case previously asserted
   * `symbolicIriToPropertyKey("http://www.w3.org/2002/07/owl#sameAs") === null`,
   * pinning the state where the five W3C prefixes were NOT registered.
   *
   * Once the forward path emits `owl__sameAs` as the canonical
   * `http://www.w3.org/2002/07/owl#sameAs`, a null here means the de-reify
   * resolution loses every W3C-prefixed predicate-def — re-opening
   * `ems__Bug f68bf750` / #3904 ("could not be mapped back to a frontmatter key"),
   * which this very function exists to fix. The IRI below is not hypothetical:
   * `exo__Statement_predicate → owl#sameAs` is present in vault-my, vault-tbank
   * and vault-exodev.
   */
  it("@req:aceaa2cc-15b6-4e1c-bf63-72c7c209de51 recovers the key from a REGISTERED external vocabulary IRI (de-reify must not lose W3C predicates)", () => {
    expect(
      symbolicIriToPropertyKey("http://www.w3.org/2002/07/owl#sameAs"),
    ).toBe("owl__sameAs");
    expect(
      symbolicIriToPropertyKey(
        "http://www.w3.org/2000/01/rdf-schema#subClassOf",
      ),
    ).toBe("rdfs__subClassOf");
  });

  it("@req:aceaa2cc-15b6-4e1c-bf63-72c7c209de51 round-trips for W3C-prefixed keys, upholding the invariant this function documents", () => {
    for (const key of [
      "owl__sameAs",
      "rdfs__subClassOf",
      "rdf__type",
      "xsd__date",
      "sh__severity",
    ]) {
      const iri = labelToSymbolicIRI(key);
      expect(iri).not.toBeNull();
      // The documented invariant: symbolicIriToPropertyKey(labelToSymbolicIRI(k)) === k
      expect(symbolicIriToPropertyKey(iri!.value)).toBe(key);
    }
  });
});

describe("predicateKeyFromLabelObjects (label→key, both emitted forms)", () => {
  it("recovers the key from a symbolic-IRI label (the reify bug — clean prefix)", () => {
    // Exactly how NoteToRDFConverter emits `exo__Asset_label: exo__Asset_relates`.
    const iriLabel = Namespace.EXO.term("Asset_relates");
    expect(predicateKeyFromLabelObjects([iriLabel])).toBe("exo__Asset_relates");
  });

  it("keeps the Literal-label path (hyphen-prefix labels stay literals)", () => {
    expect(
      predicateKeyFromLabelObjects([new Literal("adapter-exo-ims__relatesToConcept")]),
    ).toBe("adapter-exo-ims__relatesToConcept");
  });

  it("prefers a Literal when both a Literal and IRI are present", () => {
    expect(
      predicateKeyFromLabelObjects([
        new Literal("adapter-exo-ims__relatesToConcept"),
        Namespace.EXO.term("Asset_relates"),
      ]),
    ).toBe("adapter-exo-ims__relatesToConcept");
  });

  it("returns null for a non-ontology IRI label / empty literal / no labels", () => {
    expect(
      predicateKeyFromLabelObjects([new IRI("obsidian://vault/x/1234.md")]),
    ).toBeNull();
    expect(predicateKeyFromLabelObjects([new Literal("   ")])).toBeNull();
    expect(predicateKeyFromLabelObjects([])).toBeNull();
  });
});

/**
 * ems__Bug `f68bf750` / #3904 — de-reify mapped the reified predicate back to a
 * frontmatter key via `uidFromIri(predicate) -> keyByDefUid`, which misses for a
 * clean-prefix predicate (its stored form is a symbolic IRI, so uidFromIri gives
 * the LOCAL NAME, not the def UID). `reifiedPredicateFrontmatterKey` tries the
 * symbolic form first. Revert-verify: removing the symbolic branch makes the
 * "symbolic-IRI predicate" case return undefined (de-reify then throws).
 */
describe("reifiedPredicateFrontmatterKey (de-reify key resolution)", () => {
  // Faithful mirror of PropertyEditorModal.uidFromIri (trim + `#`->localname +
  // path->decodeURIComponent(basename-uid)) so the fallback double can't drift.
  const uidOf = (iri: string): string | null => {
    const trimmed = iri.trim();
    const hash = trimmed.lastIndexOf("#");
    if (hash >= 0 && hash < trimmed.length - 1) return trimmed.slice(hash + 1);
    if (trimmed.includes("/")) {
      const last = trimmed.split("/").pop();
      if (!last) return null;
      return decodeURIComponent(last.replace(/\.md$/i, ""));
    }
    return trimmed.length > 0 ? trimmed : null;
  };

  it("recovers the key from a symbolic-IRI predicate (the bug) — no def-UID needed", () => {
    // Clean-prefix predicate: stored as a symbolic IRI, keyByDefUid is empty for
    // it (it is keyed by def UID, not local name) — exactly the failing shape.
    expect(
      reifiedPredicateFrontmatterKey(
        "https://exocortex.my/ontology/exo#Asset_relates",
        uidOf,
        new Map(),
      ),
    ).toBe("exo__Asset_relates");
  });

  it("falls back to the def-UID reverse map for a path-form predicate", () => {
    // Hyphen-prefix def label stays a Literal → predicate stored as path-form IRI.
    const keyByDefUid = new Map([
      ["0967a771-c5cf-4fee-9707-9837104977f3", "adapter-exo-ims__relatesToConcept"],
    ]);
    expect(
      reifiedPredicateFrontmatterKey(
        "obsidian://vault/assetspaces/x/0967a771-c5cf-4fee-9707-9837104977f3.md",
        uidOf,
        keyByDefUid,
      ),
    ).toBe("adapter-exo-ims__relatesToConcept");
  });

  it("prefers the symbolic form even when the reverse map would also miss", () => {
    expect(
      reifiedPredicateFrontmatterKey(
        "https://exocortex.my/ontology/ems#Effort_area",
        uidOf,
        new Map([["Effort_area", "WRONG"]]),
      ),
    ).toBe("ems__Effort_area");
  });

  it("returns undefined when neither form yields a key", () => {
    expect(
      reifiedPredicateFrontmatterKey(
        "obsidian://vault/x/unknown-uid.md",
        uidOf,
        new Map(),
      ),
    ).toBeUndefined();
  });
});
