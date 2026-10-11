import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { iriToObsidianName } from "../../../src/utilities/iriToObsidianName";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";

/**
 * req e750782f — the `skos` prefix resolves to the W3C SKOS namespace
 * `http://www.w3.org/2004/02/skos/core#` (RFC 14217015 §5, founder decision №6).
 *
 * The author-comparison desk records a mapping as an `exo__Statement`
 * [author term, `skos__exactMatch`, neutral concept]; the predicate is written as
 * a bare-UID link to the property asset labelled `skos__exactMatch`. Before the
 * change that label emitted `https://exocortex.my/ontology/skos#exactMatch`, so a
 * query written against W3C SKOS found nothing (RFC CQ1, AC8).
 *
 * Production shape: UID-named class / property files with `prefix__Local` labels,
 * bare-UID links (UUID-canon), the live `exo__Statement` class UID. Only the vault
 * adapter is a double; the converter, the store and the SPARQL engine are real.
 *
 * Axis ids come FIRST in each title (the mutant driver keys on them).
 */

const REQ = "@req:e750782f-907b-4573-99ce-f9a5e3150418";
const W3C_SKOS = "http://www.w3.org/2004/02/skos/core#";
const ADHOC_SKOS = "https://exocortex.my/ontology/skos#";

const STMT_UID = "7920028c-8613-4756-9761-95846155ce9c"; // exo__Statement (live UID)
const ASSET_UID = "e7500000-0000-4000-8000-000000000001"; // exo__Asset
const SKOS_CONCEPT_UID = "e7500000-0000-4000-8000-000000000002"; // skos__Concept stub
const EXACT_UID = "e7500000-0000-4000-8000-000000000003"; // skos__exactMatch property
const TERM_UID = "e7500000-0000-4000-8000-000000000010"; // author term
const NEUTRAL_UID = "e7500000-0000-4000-8000-000000000011"; // neutral concept
const PMBOK_UID = "e7500000-0000-4000-8000-000000000012"; // instance of the skos__Concept stub
const MAP_UID = "e7500000-0000-4000-8000-000000000020"; // the mapping statement

function classFm(uid: string, label: string, superUid?: string): IFrontmatter {
  const fm: IFrontmatter = {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    aliases: [label],
    exo__Instance_class: ["[[exo__Class]]"],
  };
  if (superUid) fm.exo__Class_superClass = `[[${superUid}]]`;
  return fm;
}

function fixture(): Record<string, IFrontmatter> {
  return {
    [STMT_UID]: classFm(STMT_UID, "exo__Statement", ASSET_UID),
    [ASSET_UID]: classFm(ASSET_UID, "exo__Asset"),
    [SKOS_CONCEPT_UID]: classFm(SKOS_CONCEPT_UID, "skos__Concept", ASSET_UID),
    [EXACT_UID]: {
      exo__Asset_uid: EXACT_UID,
      exo__Asset_label: "skos__exactMatch",
      aliases: ["skos__exactMatch"],
      exo__Instance_class: ["[[exo__ObjectProperty]]"],
    },
    [TERM_UID]: {
      exo__Asset_uid: TERM_UID,
      exo__Asset_label: "Растворение «я»",
    },
    [NEUTRAL_UID]: {
      exo__Asset_uid: NEUTRAL_UID,
      exo__Asset_label: "Растворение эго",
    },
    [PMBOK_UID]: {
      exo__Asset_uid: PMBOK_UID,
      exo__Asset_label: "Риск",
      exo__Instance_class: [`[[${SKOS_CONCEPT_UID}]]`],
    },
    [MAP_UID]: {
      exo__Asset_uid: MAP_UID,
      exo__Instance_class: [`[[${STMT_UID}]]`],
      exo__Statement_subject: `[[${TERM_UID}]]`,
      exo__Statement_predicate: `[[${EXACT_UID}]]`,
      exo__Statement_object: `[[${NEUTRAL_UID}]]`,
    },
  };
}

function fileOf(uid: string): IFile {
  return {
    path: `assetspaces/t/${uid}.md`,
    basename: uid,
    name: `${uid}.md`,
    parent: null,
  };
}

function makeVault(fm: Record<string, IFrontmatter>): IVaultAdapter {
  const vault: Partial<IVaultAdapter> = {
    getAllFiles: jest.fn(() => Object.keys(fm).map(fileOf)),
    getFrontmatter: jest.fn((file: IFile) => fm[file.basename] ?? null),
    read: jest.fn().mockResolvedValue(""),
    getFirstLinkpathDest: jest.fn((linkpath: string) => {
      const ref = linkpath.split("|")[0];
      if (fm[ref]) return fileOf(ref);
      const hit = Object.entries(fm).find(
        ([, f]) => Array.isArray(f.aliases) && f.aliases.includes(ref),
      );
      return hit ? fileOf(hit[0]) : null;
    }),
  };
  return vault as IVaultAdapter;
}

function makeLogger(): ILogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as ILogger;
}

async function convertAll(): Promise<Triple[]> {
  const fm = fixture();
  const converter = new NoteToRDFConverter(makeVault(fm), makeLogger());
  const out: Triple[] = [];
  for (const uid of Object.keys(fm))
    out.push(...(await converter.convertNote(fileOf(uid))));
  return out;
}

const iriOf = (uid: string) => `obsidian://vault/assetspaces/t/${uid}.md`;

function objectsOf(
  triples: Triple[],
  subjectUid: string,
  predicate: string,
): string[] {
  return triples
    .filter(
      (t) =>
        t.subject instanceof IRI &&
        t.subject.value === iriOf(subjectUid) &&
        t.predicate.value === predicate,
    )
    .map((t) => (t.object as { value: string }).value);
}

async function select(triples: Triple[], query: string): Promise<string[][]> {
  const store = new InMemoryTripleStore();
  await store.addAll(triples);
  const algebra = new ExoQLAlgebraTranslator().translate(
    new SPARQLParser().parse(query),
  );
  const rows = await new ExoQLQueryExecutor(store).executeAll(algebra);
  return rows.map((r) => [
    (r.get("a") as IRI | undefined)?.value ?? "",
    (r.get("n") as IRI | undefined)?.value ?? "",
  ]);
}

const CQ1 = (skosBase: string) => `PREFIX skos: <${skosBase}>
SELECT ?a ?n WHERE { ?a skos:exactMatch ?n }`;

describe(`the skos prefix emits the W3C SKOS namespace (${REQ})`, () => {
  it(`S1 ${REQ} the label skos__exactMatch emits the W3C IRI, not the ad-hoc one`, async () => {
    const triples = await convertAll();
    const label = objectsOf(
      triples,
      EXACT_UID,
      Namespace.EXO.term("Asset_label").value,
    );
    expect(label).toEqual([`${W3C_SKOS}exactMatch`]);
    expect(label.join()).not.toContain(ADHOC_SKOS);
  });

  it(`S2 ${REQ} an instance of the skos__Concept stub (bare-UID class link) carries the W3C class IRI`, async () => {
    const triples = await convertAll();
    expect(
      objectsOf(triples, PMBOK_UID, Namespace.EXO.term("Instance_class").value),
    ).toEqual([`${W3C_SKOS}Concept`]);
  });

  it(`S3 ${REQ} a mapping statement materialises its edge under the W3C predicate`, async () => {
    const triples = await convertAll();
    expect(objectsOf(triples, TERM_UID, `${W3C_SKOS}exactMatch`)).toEqual([
      iriOf(NEUTRAL_UID),
    ]);
    expect(objectsOf(triples, TERM_UID, `${ADHOC_SKOS}exactMatch`)).toEqual([]);
  });

  it(`S4 ${REQ} CQ1 with the W3C prefix finds the mapping; the same query with the exocortex.my prefix finds 0`, async () => {
    const triples = await convertAll();
    expect(await select(triples, CQ1(W3C_SKOS))).toEqual([
      [iriOf(TERM_UID), iriOf(NEUTRAL_UID)],
    ]);
    // Address check (RFC AC8): the other form of the predicate returns nothing.
    expect(await select(triples, CQ1(ADHOC_SKOS))).toEqual([]);
  });

  it(`S5 ${REQ} Namespace.forPrefix("skos") is the canonical singleton`, () => {
    expect(Namespace.forPrefix("skos")).toBe(Namespace.SKOS);
    expect(Namespace.SKOS.prefix).toBe("skos");
    expect(Namespace.SKOS.iri.value).toBe(W3C_SKOS);
  });

  it(`S6 ${REQ} the inverse reads the W3C SKOS IRIs back to frontmatter names`, () => {
    for (const local of [
      "exactMatch",
      "closeMatch",
      "broadMatch",
      "narrowMatch",
      "relatedMatch",
      "Concept",
    ]) {
      expect(iriToObsidianName(`${W3C_SKOS}${local}`)).toBe(`skos__${local}`);
      expect(Namespace.fromTermIRI(`${W3C_SKOS}${local}`)!.namespace).toBe(
        Namespace.SKOS,
      );
    }
  });

  /**
   * Review round 1 (MEDIUM): two plugin readers turned a range / ancestor IRI into
   * a CLASS only for the exocortex base, i.e. "registered W3C ⇒ schema term". That
   * stopped being true with skos — `skos:Concept` is the desk's mapping range — so
   * the schema group is named explicitly and SKOS sits outside it.
   */
  it(`S7 ${REQ} SKOS is registered but is NOT a schema vocabulary (RDF/RDFS/OWL/XSD/SHACL are)`, () => {
    for (const ns of [
      Namespace.RDF,
      Namespace.RDFS,
      Namespace.OWL,
      Namespace.XSD,
      Namespace.SHACL,
    ]) {
      expect(Namespace.isSchemaVocabulary(ns)).toBe(true);
    }
    expect(Namespace.isSchemaVocabulary(Namespace.SKOS)).toBe(false);
    // Canaries: the exocortex namespaces, registered and ad-hoc, are domain ones.
    expect(Namespace.isSchemaVocabulary(Namespace.EXO)).toBe(false);
    expect(Namespace.isSchemaVocabulary(Namespace.forPrefix("concept")!)).toBe(false);
    // Equality is by namespace IRI, not by object identity.
    expect(
      Namespace.isSchemaVocabulary(
        Namespace.fromTermIRI("http://www.w3.org/2001/XMLSchema#string")!.namespace,
      ),
    ).toBe(true);
  });
});
