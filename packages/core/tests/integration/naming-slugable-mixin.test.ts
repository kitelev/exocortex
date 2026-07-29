/**
 * Production-shape integration test for the exo naming-capability TBox layer
 * (RFC 78572fa9 Candidate B Phase 1, req ec019a32).
 *
 * The store is built by the REAL {@link NoteToRDFConverter} over a **UID-canon-faithful**
 * fixture exo-TBox (NOT hand-authored triples): class files are UUID-named (the real UIDs
 * of the shipped `exoas-exo` assets), labels carry the symbolic name, and `exo__Class_superClass`
 * uses `[[<uuid>]]` wikilinks — so the converter takes the exact production `isUUID=true`
 * branch (`valueToRDFObject` → UUID lookup → label → symbolic `.../ontology/exo#<Local>`).
 * The `exo__Class`/`exo__Property` → `exo__Slugable` metaclass-level mixin is thus emitted
 * with the real dual-IRI seam (file-IRI subject ← rdfs:subClassOf → symbolic-IRI object).
 * The subsumption is then resolved by the real {@link ClassHierarchy} (the same BFS
 * `audit ontology-membership` uses).
 *
 * Revert-verify axis = the mixin edge itself (a fixture WITHOUT the
 * `exo__Class → exo__Slugable` superClass link): with the mixin the subsumption
 * reaches exo__Slugable (GREEN); without it, no such edge exists (RED).
 * See ~/dotfiles/.claude/rules/integration-test-revert-verify.md.
 *
 * Scope note: this guards the CODE mechanism (converter + hierarchy) over the mixin's
 * triple shape — the actual mixin edge in the `exoas-exo` vault data has its own
 * SHACL / co-location / ontology-membership gating (the code-repo/data-repo split).
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../src/services/NoteToRDFConverter";
import type { IVaultAdapter, IFile, IFrontmatter } from "../../src/interfaces/IVaultAdapter";
import { ClassHierarchy } from "../../src/services/ClassHierarchy";
import { Triple, type Subject, type Object as RdfObject } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import type { Triple as AlgebraTriple } from "../../src/infrastructure/sparql/algebra/AlgebraOperation";

const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";

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

async function convertNotes(notes: FixtureNote[]): Promise<Triple[]> {
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
    getFirstLinkpathDest: jest.fn((linkpath: string) => fileByBasename.get(linkpath) ?? null),
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
  const out: Triple[] = [];
  for (const file of files) {
    out.push(...(await converter.convertNote(file)));
  }
  return out;
}

// UID-canon TBox: class files are UUID-named; label carries the symbolic name; superClass
// references are `[[<uuid>]]` wikilinks (the real production shape). UIDs are the real
// shipped exoas-exo asset UIDs so the fixture mirrors the vault exactly.
const ASSET = "493c2ae2-de56-47ec-954d-2eb8cb49bff7"; // exo__Asset
const SLUGABLE = "eaa291e7-80e9-4c53-857e-93ab61ea0025"; // exo__Slugable (new metaclass)
const CLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9"; // exo__Class metaclass
const PROPERTY = "38277bfa-d7f9-4a75-b856-b23276ab0db3"; // exo__Property metaclass

function classNote(uid: string, label: string, superClasses: string[]): FixtureNote {
  return {
    uid,
    frontmatter: {
      exo__Asset_label: label,
      exo__Instance_class: [`[[${CLASS}]]`], // every class-def is an instance of the exo__Class metaclass
      ...(superClasses.length ? { exo__Class_superClass: superClasses.map((s) => `[[${s}]]`) } : {}),
    } as unknown as IFrontmatter,
  };
}

// A subclass triple is subject=IRI, predicate=rdfs:subClassOf, object=IRI. Map the
// domain triple to the {type,value} shape ClassHierarchy consumes (dual-IRI-agnostic —
// we carry whatever IRI form the converter emitted, symbolic or file).
function iriValue(el: Subject | RdfObject): string | null {
  return el instanceof IRI ? el.value : null;
}

function subclassAlgebraTriples(triples: Triple[]): AlgebraTriple[] {
  const out: AlgebraTriple[] = [];
  for (const t of triples) {
    if (!(t.predicate instanceof IRI) || t.predicate.value !== RDFS_SUBCLASS_OF) continue;
    const s = iriValue(t.subject);
    const o = iriValue(t.object);
    if (s === null || o === null) continue;
    out.push({
      subject: { type: "iri", value: s },
      predicate: { type: "iri", value: RDFS_SUBCLASS_OF },
      object: { type: "iri", value: o },
    });
  }
  return out;
}

// Resolve the ACTUAL subject/object IRIs the converter emitted for a given class file's
// superClass edge to `parentLocalName` — production-shape (don't hardcode the dual-IRI form).
// `childUuid` is a full UUID (collision-safe substring of the file-IRI subject); the parent
// object is always the symbolic IRI (label→`...#<Local>`), matched by exact suffix.
function edge(subs: AlgebraTriple[], childUuid: string, parentLocalName: string): { child: string; parent: string } | null {
  const t = subs.find(
    (x) =>
      x.subject.type === "iri" &&
      x.object.type === "iri" &&
      x.subject.value.includes(childUuid) &&
      x.object.value.endsWith(`#${parentLocalName}`),
  );
  return t && t.subject.type === "iri" && t.object.type === "iri"
    ? { child: t.subject.value, parent: t.object.value }
    : null;
}

describe("exo naming-capability TBox layer — exo__Slugable metaclass mixin (@req:ec019a32-4116-4709-a652-fab3842fb5c1)", () => {
  it("@req:ec019a32-4116-4709-a652-fab3842fb5c1 exo__Class subsumes exo__Slugable via the metaclass-level superClass mixin", async () => {
    const triples = await convertNotes([
      classNote(SLUGABLE, "exo__Slugable", [ASSET]),
      classNote(CLASS, "exo__Class", [ASSET, SLUGABLE]), // ← the mixin
      classNote(ASSET, "exo__Asset", []),
    ]);
    const subs = subclassAlgebraTriples(triples);
    const e = edge(subs, CLASS, "Slugable");
    expect(e).not.toBeNull();
    const h = new ClassHierarchy(subs);
    expect(h.isSubClassOf(e!.child, e!.parent)).toBe(true);
  });

  it("@req:ec019a32-4116-4709-a652-fab3842fb5c1 exo__Property subsumes exo__Slugable via the metaclass-level superClass mixin", async () => {
    const triples = await convertNotes([
      classNote(SLUGABLE, "exo__Slugable", [ASSET]),
      classNote(PROPERTY, "exo__Property", [ASSET, SLUGABLE]), // ← the mixin
      classNote(ASSET, "exo__Asset", []),
    ]);
    const subs = subclassAlgebraTriples(triples);
    const e = edge(subs, PROPERTY, "Slugable");
    expect(e).not.toBeNull();
    const h = new ClassHierarchy(subs);
    expect(h.isSubClassOf(e!.child, e!.parent)).toBe(true);
  });

  it("@req:ec019a32-4116-4709-a652-fab3842fb5c1 REVERT-VERIFY: without the mixin, exo__Class has NO superClass edge to exo__Slugable", async () => {
    // Same fixture MINUS the exo__Class → exo__Slugable superClass link.
    const triples = await convertNotes([
      classNote(SLUGABLE, "exo__Slugable", [ASSET]),
      classNote(CLASS, "exo__Class", [ASSET]), // ← mixin REMOVED (baseline)
      classNote(ASSET, "exo__Asset", []),
    ]);
    const subs = subclassAlgebraTriples(triples);
    expect(edge(subs, CLASS, "Slugable")).toBeNull();
  });
});
