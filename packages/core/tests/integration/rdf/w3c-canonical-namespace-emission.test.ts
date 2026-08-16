/**
 * Production-shape verification for req aceaa2cc: a vault asset whose
 * `exo__Asset_label` parses as `<w3c-prefix>__<LocalName>` must emit the
 * CANONICAL vocabulary IRI, not the ad-hoc `https://exocortex.my/ontology/<prefix>#`
 * fallback.
 *
 * WHY the wiring axis matters (and a helper-only test would NOT be enough):
 * `Namespace.forPrefix` is a pure string function with ~10 call sites. Asserting
 * on it alone proves the whitelist, not that LABEL EMISSION routes through it —
 * a test calling `forPrefix` directly stays green even if the converter derived
 * IRIs some other way. So the store here is built by the REAL
 * {@link NoteToRDFConverter} over fixture notes (NOT hand-authored triples), and
 * the assertions read the emitted triples.
 *
 * The stakes: `RDFVocabularyMapper` ALREADY emits `exo__Class_superClass` as the
 * canonical `rdfs:subClassOf` predicate (319 uses in vault-my, measured
 * 2026-08-16). Before this change the ASSET DEFINING that term emitted
 * `https://exocortex.my/ontology/rdfs#subClassOf` — definition and usage sat under
 * two IRIs that never joined. The `subClassOf` case below asserts exactly that
 * join.
 *
 * @req:aceaa2cc-15b6-4e1c-bf63-72c7c209de51
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const REQ = "@req:aceaa2cc-15b6-4e1c-bf63-72c7c209de51";

const EXO_ASSET_LABEL = "https://exocortex.my/ontology/exo#Asset_label";
const ADHOC_BASE = "https://exocortex.my/ontology/";

/** Canonical W3C namespace IRIs — the values this change makes reachable from a label. */
const CANONICAL = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  sh: "http://www.w3.org/ns/shacl#",
} as const;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}

function makeFile(uid: string): IFile {
  return {
    path: `${uid}.md`,
    basename: uid,
    name: `${uid}.md`,
    extension: "md",
    parent: null,
  } as unknown as IFile;
}

/** Convert fixture notes through the REAL converter (mirrors the sibling emission tests). */
async function convertNotes(notes: FixtureNote[]) {
  const files = notes.map((n) => makeFile(n.uid));
  const fmByPath = new Map<string, IFrontmatter>();
  const fileByBasename = new Map<string, IFile>();
  notes.forEach((n, i) => {
    fmByPath.set(files[i].path, n.frontmatter);
    fileByBasename.set(n.uid, files[i]);
  });

  const mockVault = {
    getAllFiles: jest.fn(() => files),
    getFrontmatter: jest.fn((f: IFile) => fmByPath.get(f.path) ?? null),
    getFirstLinkpathDest: jest.fn(
      (linkpath: string) => fileByBasename.get(linkpath) ?? null,
    ),
    read: jest.fn().mockResolvedValue(""),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;

  const converter = new NoteToRDFConverter(mockVault);
  const out = [];
  for (const file of files) {
    out.push(...(await converter.convertNote(file)));
  }
  return out;
}

/** The object of this note's `exo__Asset_label` triple, as emitted. */
async function emittedLabelObject(uid: string, label: string): Promise<string> {
  const triples = await convertNotes([
    {
      uid,
      frontmatter: {
        exo__Asset_uid: uid,
        exo__Asset_label: label,
      } as unknown as IFrontmatter,
    },
  ]);
  const labelTriple = triples.find(
    (t) => t.predicate.value === EXO_ASSET_LABEL,
  );
  if (!labelTriple) {
    throw new Error(
      `no exo__Asset_label triple emitted for ${uid} (${triples.length} triples)`,
    );
  }
  const object = labelTriple.object as { value?: unknown };
  if (typeof object.value !== "string") {
    throw new Error(
      `exo__Asset_label object for ${uid} is not a valued term: ${String(labelTriple.object)}`,
    );
  }
  return object.value;
}

const UID = {
  subClassOf: "5c1a0000-0000-4000-8000-000000000000",
  rdfType: "5d1a0000-0000-4000-8000-000000000000",
  owlClass: "5e1a0000-0000-4000-8000-000000000000",
  xsdDate: "5f1a0000-0000-4000-8000-000000000000",
  shSeverity: "5a1a0000-0000-4000-8000-000000000000",
  emsTask: "5b1a0000-0000-4000-8000-000000000000",
  aiKnow: "5abc0000-0000-4000-8000-000000000000",
} as const;

describe(`W3C vocabulary prefixes emit canonical IRIs (${REQ})`, () => {
  describe("A. wiring — the REAL converter derives the canonical IRI from a label", () => {
    it(`${REQ} rdfs__subClassOf emits the canonical RDFS IRI, joining the term's definition with its 319 predicate usages`, async () => {
      const emitted = await emittedLabelObject(
        UID.subClassOf,
        "rdfs__subClassOf",
      );

      expect(emitted).toBe(`${CANONICAL.rdfs}subClassOf`);
      expect(emitted).not.toContain(ADHOC_BASE);
      // The join that motivated the requirement: identical to what
      // RDFVocabularyMapper already emits for the predicate position.
      expect(emitted).toBe(Namespace.RDFS.term("subClassOf").value);
    });

    it(`${REQ} sh__severity emits the canonical SHACL IRI (new Namespace.SHACL constant)`, async () => {
      const emitted = await emittedLabelObject(UID.shSeverity, "sh__severity");

      expect(emitted).toBe(`${CANONICAL.sh}severity`);
      expect(emitted).not.toContain(ADHOC_BASE);
    });

    it.each([
      ["rdf__type", `${CANONICAL.rdf}type`, UID.rdfType],
      ["owl__Class", `${CANONICAL.owl}Class`, UID.owlClass],
      ["xsd__date", `${CANONICAL.xsd}date`, UID.xsdDate],
    ])(
      `${REQ} %s emits %s`,
      async (label: string, expected: string, uid: string) => {
        expect(await emittedLabelObject(uid, label)).toBe(expected);
      },
    );

    it(`${REQ} NEGATIVE CONTROL: an exocortex.my prefix is byte-identical (backward compatibility)`, async () => {
      const emitted = await emittedLabelObject(UID.emsTask, "ems__Task");

      expect(emitted).toBe("https://exocortex.my/ontology/ems#Task");
    });

    it(`${REQ} NEGATIVE CONTROL: an unregistered prefix still uses the ad-hoc fallback`, async () => {
      const emitted = await emittedLabelObject(
        UID.aiKnow,
        "aiKnow__Memory_aboutConcept",
      );

      expect(emitted).toBe(
        "https://exocortex.my/ontology/aiKnow#Memory_aboutConcept",
      );
    });
  });

  describe("B. helper — Namespace.forPrefix returns the canonical singletons", () => {
    it.each([
      ["rdf", Namespace.RDF],
      ["rdfs", Namespace.RDFS],
      ["owl", Namespace.OWL],
      ["xsd", Namespace.XSD],
      ["sh", Namespace.SHACL],
    ])(
      `${REQ} forPrefix("%s") returns the canonical singleton (reference equality)`,
      (prefix: string, expected: Namespace) => {
        expect(Namespace.forPrefix(prefix)).toBe(expected);
        expect(Namespace.forPrefix(prefix)!.iri.value).toBe(
          CANONICAL[prefix as keyof typeof CANONICAL],
        );
      },
    );

    it(`${REQ} Namespace.SHACL carries the canonical SHACL namespace`, () => {
      expect(Namespace.SHACL.prefix).toBe("sh");
      expect(Namespace.SHACL.iri.value).toBe("http://www.w3.org/ns/shacl#");
    });

    it(`${REQ} NEGATIVE CONTROL: fromPropertyKey keeps ad-hoc derivation for user namespaces`, () => {
      const parsed = Namespace.fromPropertyKey("aiKnow__Memory_aboutConcept");

      expect(parsed).not.toBeNull();
      expect(parsed!.namespace.iri.value).toBe(
        "https://exocortex.my/ontology/aiKnow#",
      );
      expect(parsed!.localName).toBe("Memory_aboutConcept");
    });
  });
});
