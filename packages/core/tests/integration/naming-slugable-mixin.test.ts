/**
 * Production-shape integration test for the exo naming-capability TBox layer
 * (RFC 78572fa9 Candidate B Phase 1, req ec019a32).
 *
 * The store is built by the REAL {@link NoteToRDFConverter} over a fixture exo-TBox
 * (NOT hand-authored triples), so the `exo__Class_superClass` → `exo__Slugable`
 * metaclass-level mixin is converted exactly as it is in production (dual-IRI seam
 * included). The subsumption is then resolved by the real {@link ClassHierarchy}
 * (the same BFS `audit ontology-membership` uses).
 *
 * Revert-verify axis = the mixin edge itself (a fixture WITHOUT the
 * `exo__Class → exo__Slugable` superClass link): with the mixin the subsumption
 * reaches exo__Slugable (GREEN); without it, no such edge exists (RED).
 * See ~/dotfiles/.claude/rules/integration-test-revert-verify.md.
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

// UID-named class files (TBox convention); labels parse as prefix__Local → symbolic IRIs.
const ASSET = "exo__Asset";
const SLUGABLE = "exo__Slugable";
const CLASS = "exo__Class";
const PROPERTY = "exo__Property";

function classNote(uid: string, label: string, superClasses: string[]): FixtureNote {
  return {
    uid,
    frontmatter: {
      exo__Asset_label: label,
      exo__Instance_class: [`[[${CLASS}]]`], // every class-def is an instance of exo__Class
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
function edge(subs: AlgebraTriple[], childBasename: string, parentLocalName: string): { child: string; parent: string } | null {
  const t = subs.find(
    (x) =>
      x.subject.type === "iri" &&
      x.object.type === "iri" &&
      x.subject.value.includes(childBasename) &&
      (x.object.value.endsWith(`#${parentLocalName}`) || x.object.value.includes(parentLocalName)),
  );
  return t && t.subject.type === "iri" && t.object.type === "iri"
    ? { child: t.subject.value, parent: t.object.value }
    : null;
}

describe("exo naming-capability TBox layer — exo__Slugable metaclass mixin (@req:ec019a32)", () => {
  it("@req:ec019a32 exo__Class subsumes exo__Slugable via the metaclass-level superClass mixin", async () => {
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

  it("@req:ec019a32 exo__Property subsumes exo__Slugable via the metaclass-level superClass mixin", async () => {
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

  it("@req:ec019a32 REVERT-VERIFY: without the mixin, exo__Class has NO superClass edge to exo__Slugable", async () => {
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
