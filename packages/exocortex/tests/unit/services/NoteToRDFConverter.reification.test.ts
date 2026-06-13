import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";

/**
 * EKA D5 — Engine reification support.
 *
 * A reified `exo__Statement {subject, predicate, object}` living in a junction
 * ontology decouples the import edge `$ontoA → $ontoB`, but the relationship
 * `A --rel--> B` must STILL be visible to SPARQL queries. This suite verifies
 * the materialize-at-index approach: NoteToRDFConverter detects a reified
 * `exo__Statement` and emits an additional LOGICAL EDGE triple
 * `<resolved(subject)> <resolved(predicate)> <resolved(object)>` alongside the
 * raw statement triples — so BGP matching and property paths traverse the
 * relationship transparently, with zero changes to the SPARQL engine.
 *
 * Mirrors the real `$kitelev-class-relations` junction shape (UID `7920028c`
 * exo__Statement, subjects/objects are CLASSES → symbolic IRIs, predicate
 * `adapter-exo-ims__relatesToConcept` has a hyphenated prefix → resolves to a
 * file IRI exactly as the raw `exo__Statement_predicate` triple does).
 */

// Reified statement class — UID + alias as stored in $kitelev-class-relations
const STMT_CLASS_UID = "7920028c-8613-4756-9761-95846155ce9c";

// Subjects / objects are CLASSES (label-form expands to symbolic class IRI)
const A_UID = "a1111111-1111-4111-8111-111111111111"; // ims__ConceptA
const B_UID = "b2222222-2222-4222-8222-222222222222"; // ims__ConceptB
const C_UID = "c3333333-3333-4333-8333-333333333333"; // ims__ConceptC

// Predicate asset — hyphenated prefix label → NOT symbol-expandable → file IRI
const P_UID = "00000000-0000-4000-8000-000000000abc"; // adapter-exo-ims__relatesToConcept

// Junction reified-statement assets
const J1_UID = "10000000-0000-4000-8000-000000000001"; // A --rel--> B
const J2_UID = "20000000-0000-4000-8000-000000000002"; // B --rel--> C

function mkFile(uid: string, dir: string): IFile {
  return {
    path: `${dir}/${uid}.md`,
    basename: uid,
    name: `${uid}.md`,
    parent: null,
  };
}

const A_FILE = mkFile(A_UID, "assetspaces/ims");
const B_FILE = mkFile(B_UID, "assetspaces/ims");
const C_FILE = mkFile(C_UID, "assetspaces/ims");
const P_FILE = mkFile(P_UID, "assetspaces/adapters");
const J1_FILE = mkFile(J1_UID, "assetspaces/relations");
const J2_FILE = mkFile(J2_UID, "assetspaces/relations");

const FM_BY_PATH: Record<string, IFrontmatter> = {
  [A_FILE.path]: {
    exo__Asset_uid: A_UID,
    exo__Asset_label: "ims__ConceptA",
    exo__Instance_class: ["[[exo__Class]]"],
  },
  [B_FILE.path]: {
    exo__Asset_uid: B_UID,
    exo__Asset_label: "ims__ConceptB",
    exo__Instance_class: ["[[exo__Class]]"],
  },
  [C_FILE.path]: {
    exo__Asset_uid: C_UID,
    exo__Asset_label: "ims__ConceptC",
    exo__Instance_class: ["[[exo__Class]]"],
  },
  [P_FILE.path]: {
    exo__Asset_uid: P_UID,
    // Hyphenated prefix — fromPropertyKey rejects it → resolves to file IRI
    exo__Asset_label: "adapter-exo-ims__relatesToConcept",
  },
  [J1_FILE.path]: {
    exo__Asset_uid: J1_UID,
    exo__Asset_isDefinedBy: "[[55a0f8b9-e908-45bf-9c16-763589f04f16]]",
    exo__Instance_class: [`[[${STMT_CLASS_UID}|exo__Statement]]`],
    exo__Statement_subject: `[[${A_UID}]]`,
    exo__Statement_predicate: `[[${P_UID}]]`,
    exo__Statement_object: `[[${B_UID}]]`,
  },
  [J2_FILE.path]: {
    exo__Asset_uid: J2_UID,
    exo__Asset_isDefinedBy: "[[55a0f8b9-e908-45bf-9c16-763589f04f16]]",
    exo__Instance_class: [`[[${STMT_CLASS_UID}|exo__Statement]]`],
    exo__Statement_subject: `[[${B_UID}]]`,
    exo__Statement_predicate: `[[${P_UID}]]`,
    exo__Statement_object: `[[${C_UID}]]`,
  },
};

const FILE_BY_UID: Record<string, IFile> = {
  [A_UID]: A_FILE,
  [B_UID]: B_FILE,
  [C_UID]: C_FILE,
  [P_UID]: P_FILE,
  [J1_UID]: J1_FILE,
  [J2_UID]: J2_FILE,
};

function makeVault(): jest.Mocked<IVaultAdapter> {
  const vault = {
    getFrontmatter: jest.fn((file: IFile) => FM_BY_PATH[file.path] ?? null),
    getAllFiles: jest.fn(),
    read: jest.fn().mockResolvedValue(""), // body has no wikilinks
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    getFirstLinkpathDest: jest.fn((linkpath: string) => {
      const uid = linkpath.includes("|") ? linkpath.split("|")[0] : linkpath;
      return FILE_BY_UID[uid] ?? null;
    }),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;
  return vault;
}

describe("NoteToRDFConverter — EKA D5 reified exo__Statement materialization", () => {
  let converter: NoteToRDFConverter;

  beforeEach(() => {
    converter = new NoteToRDFConverter(makeVault());
  });

  // Expected resolved terms (computed via the converter's own resolution)
  const subjectIRI = () => Namespace.IMS.term("ConceptA");
  const objectIRI = () => Namespace.IMS.term("ConceptB");
  const predicateIRI = () => converter.notePathToIRI(P_FILE.path);

  function hasTriple(
    triples: Triple[],
    s: IRI,
    p: IRI,
    o: IRI | Literal,
  ): boolean {
    return triples.some(
      (t) =>
        t.subject instanceof IRI &&
        t.subject.value === s.value &&
        t.predicate.value === p.value &&
        ((o instanceof IRI &&
          t.object instanceof IRI &&
          t.object.value === o.value) ||
          (o instanceof Literal &&
            t.object instanceof Literal &&
            t.object.value === o.value)),
    );
  }

  describe("converter emission", () => {
    it("emits a logical edge subject→predicate→object for a reified statement", async () => {
      const triples = await converter.convertNote(J1_FILE);

      expect(
        hasTriple(triples, subjectIRI(), predicateIRI(), objectIRI()),
      ).toBe(true);
    });

    it("round-trip: raw exo__Statement_subject/_predicate/_object triples are still emitted", async () => {
      const triples = await converter.convertNote(J1_FILE);
      const J1 = converter.notePathToIRI(J1_FILE.path);

      expect(
        hasTriple(
          triples,
          J1,
          Namespace.EXO.term("Statement_subject"),
          subjectIRI(),
        ),
      ).toBe(true);
      expect(
        hasTriple(
          triples,
          J1,
          Namespace.EXO.term("Statement_predicate"),
          predicateIRI(),
        ),
      ).toBe(true);
      expect(
        hasTriple(
          triples,
          J1,
          Namespace.EXO.term("Statement_object"),
          objectIRI(),
        ),
      ).toBe(true);
    });

    it("does NOT emit a logical edge for a non-statement asset", async () => {
      // A regular concept asset must not produce a spurious materialized edge.
      const triples = await converter.convertNote(A_FILE);
      // The only triples whose predicate is the P file IRI would be a logical
      // edge; a plain concept has none.
      const hasEdge = triples.some(
        (t) => t.predicate.value === predicateIRI().value,
      );
      expect(hasEdge).toBe(false);
    });

    it("does NOT emit a logical edge when a statement component is missing (no crash)", async () => {
      const partialFile = mkFile(
        "30000000-0000-4000-8000-000000000003",
        "assetspaces/relations",
      );
      FM_BY_PATH[partialFile.path] = {
        exo__Asset_uid: "30000000-0000-4000-8000-000000000003",
        exo__Instance_class: [`[[${STMT_CLASS_UID}|exo__Statement]]`],
        exo__Statement_subject: `[[${A_UID}]]`,
        exo__Statement_predicate: `[[${P_UID}]]`,
        // object intentionally absent
      };
      const local = new NoteToRDFConverter(makeVault());
      const triples = await local.convertNote(partialFile);
      const hasEdge = triples.some(
        (t) =>
          t.subject instanceof IRI &&
          t.subject.value === subjectIRI().value &&
          t.predicate.value === predicateIRI().value,
      );
      expect(hasEdge).toBe(false);
      delete FM_BY_PATH[partialFile.path];
    });
  });

  describe("SPARQL traversal (materialize-at-index → engine unchanged)", () => {
    let store: InMemoryTripleStore;
    let executor: ExoQLQueryExecutor;
    let parser: SPARQLParser;
    let translator: ExoQLAlgebraTranslator;

    async function loadStatements(files: IFile[]): Promise<void> {
      store = new InMemoryTripleStore();
      for (const f of files) {
        const triples = await converter.convertNote(f);
        await store.addAll(triples);
      }
      executor = new ExoQLQueryExecutor(store);
      parser = new SPARQLParser();
      translator = new ExoQLAlgebraTranslator();
    }

    async function selectPairs(
      sparql: string,
      aVar: string,
      bVar: string,
    ): Promise<Array<[string, string]>> {
      const ast = parser.parse(sparql);
      const algebra = translator.translate(ast);
      const solutions = await executor.executeAll(algebra);
      return solutions.map((s) => {
        const a = s.get(aVar);
        const b = s.get(bVar);
        return [
          a instanceof IRI ? a.value : String((a as Literal)?.value),
          b instanceof IRI ? b.value : String((b as Literal)?.value),
        ];
      });
    }

    async function selectValues(
      sparql: string,
      varName: string,
    ): Promise<string[]> {
      const ast = parser.parse(sparql);
      const algebra = translator.translate(ast);
      const solutions = await executor.executeAll(algebra);
      return solutions
        .map((s) => s.get(varName))
        .filter((v): v is IRI => v instanceof IRI)
        .map((v) => v.value);
    }

    it("BGP: ?a <rel> ?b resolves the reified relationship", async () => {
      await loadStatements([J1_FILE]);
      const pairs = await selectPairs(
        `SELECT ?a ?b WHERE { ?a <${predicateIRI().value}> ?b }`,
        "a",
        "b",
      );
      expect(pairs).toContainEqual([subjectIRI().value, objectIRI().value]);
    });

    it("property path: ?a <rel>+ ?b traverses chained reified statements", async () => {
      // A --rel--> B --rel--> C
      await loadStatements([J1_FILE, J2_FILE]);
      const reached = await selectValues(
        `SELECT ?x WHERE { <${subjectIRI().value}> <${predicateIRI().value}>+ ?x }`,
        "x",
      );
      expect(reached).toContain(Namespace.IMS.term("ConceptB").value);
      expect(reached).toContain(Namespace.IMS.term("ConceptC").value);
    });

    it("round-trip: raw exo__Statement queries still work over the store", async () => {
      await loadStatements([J1_FILE, J2_FILE]);
      const stmts = await selectValues(
        `PREFIX exo: <https://exocortex.my/ontology/exo#>
         SELECT ?j WHERE { ?j exo:Statement_subject ?a }`,
        "j",
      );
      expect(stmts).toContain(converter.notePathToIRI(J1_FILE.path).value);
      expect(stmts).toContain(converter.notePathToIRI(J2_FILE.path).value);
    });
  });
});
