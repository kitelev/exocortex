import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

/**
 * Issue #3242: when `exo__Instance_class` references a UUID-named class file
 * that lacks `exo__Asset_label`, the previous behaviour fell through to
 * `Literal(cleanValue)`. The validator only processes IRI-typed
 * `exo:Instance_class` triples (ShaclLiteValidator.ts:182), so the entire
 * class assertion was discarded — assets typed via label-less class files
 * appeared classless and produced false `sh:class` violations downstream.
 *
 * Fix: in `valueToClassURI`, when the UUID resolves to a real file but no
 * ontology IRI can be derived (no namespace-prefixed basename and no
 * namespace-prefixed `exo__Asset_label`), fall back to the resolved file IRI
 * (`notePathToIRI(resolvedFile.path)`). This keeps Issue #663's preference
 * for ontology URIs whenever a label is present, and supplies a graph-traversable
 * IRI when it is not — `TripleClassHierarchy` then resolves the chain via
 * `exo__Class_superClass`.
 */
describe("Issue #3242: UUID class file without exo__Asset_label", () => {
  let mockVault: jest.Mocked<IVaultAdapter>;
  let converter: NoteToRDFConverter;

  const CLASS_UID = "3b9a54df-8a38-4717-85cb-5a3be429a629";
  const CLASS_PATH = `03 Knowledge/period/${CLASS_UID}.md`;
  const INSTANCE_UID = "6b73e473-70c0-4fc6-afd4-658b590f0664";
  const INSTANCE_PATH = `03 Knowledge/kitelev/${INSTANCE_UID}.md`;

  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const EXO_INSTANCE_CLASS = "https://exocortex.my/ontology/exo#Instance_class";

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn().mockResolvedValue(""),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    converter = new NoteToRDFConverter(mockVault);
  });

  function makeInstanceFile(): IFile {
    return {
      path: INSTANCE_PATH,
      basename: INSTANCE_UID,
      name: `${INSTANCE_UID}.md`,
      extension: "md",
      parent: null,
    } as unknown as IFile;
  }

  function makeClassFile(): IFile {
    return {
      path: CLASS_PATH,
      basename: CLASS_UID,
      name: `${CLASS_UID}.md`,
      extension: "md",
      parent: null,
    } as unknown as IFile;
  }

  it("emits an IRI-typed exo:Instance_class triple even when class file lacks exo__Asset_label", async () => {
    const instanceFile = makeInstanceFile();
    const classFile = makeClassFile();

    mockVault.getFrontmatter.mockImplementation((file: IFile) => {
      if (file.path === INSTANCE_PATH) {
        return {
          exo__Asset_uid: INSTANCE_UID,
          exo__Asset_label: "2026",
          exo__Instance_class: [`[[${CLASS_UID}]]`],
        };
      }
      if (file.path === CLASS_PATH) {
        // Class file frontmatter without exo__Asset_label
        return {
          exo__Asset_uid: CLASS_UID,
          // exo__Asset_label intentionally absent
          exo__Class_superClass: ["[[2971f433-719f-4231-b36a-9e29d1881a68]]"],
        };
      }
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === CLASS_UID) return classFile;
      return null;
    });

    const triples = await converter.convertNote(instanceFile);

    const instanceClassObjects = triples
      .filter(
        (t) =>
          t.predicate instanceof IRI &&
          t.predicate.value === EXO_INSTANCE_CLASS,
      )
      .map((t) => t.object);

    // Bug pre-fix: this was a Literal `[[<uuid>]]`. Post-fix: must be an IRI.
    expect(instanceClassObjects.length).toBeGreaterThan(0);
    for (const obj of instanceClassObjects) {
      expect(obj).toBeInstanceOf(IRI);
      // The IRI must point to the class file, not be a stringified UUID Literal
      expect((obj as IRI).value).toBe(
        `obsidian://vault/03%20Knowledge/period/${CLASS_UID}.md`,
      );
    }

    // rdf:type must also be emitted (line 196-203 gate `instanceof IRI`)
    const rdfTypeObjects = triples
      .filter(
        (t) => t.predicate instanceof IRI && t.predicate.value === RDF_TYPE,
      )
      .map((t) => t.object);

    expect(rdfTypeObjects.length).toBeGreaterThan(0);
    expect(
      rdfTypeObjects.some(
        (o) =>
          o instanceof IRI &&
          o.value ===
            `obsidian://vault/03%20Knowledge/period/${CLASS_UID}.md`,
      ),
    ).toBe(true);
  });

  it("still prefers ontology URI when class file has a namespace-prefixed label", async () => {
    const instanceFile = makeInstanceFile();
    const classFile = makeClassFile();

    mockVault.getFrontmatter.mockImplementation((file: IFile) => {
      if (file.path === INSTANCE_PATH) {
        return {
          exo__Asset_uid: INSTANCE_UID,
          exo__Asset_label: "2026",
          exo__Instance_class: [`[[${CLASS_UID}]]`],
        };
      }
      if (file.path === CLASS_PATH) {
        return {
          exo__Asset_uid: CLASS_UID,
          exo__Asset_label: "period__Year",
        };
      }
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === CLASS_UID) return classFile;
      return null;
    });

    const triples = await converter.convertNote(instanceFile);

    const instanceClassObjects = triples
      .filter(
        (t) =>
          t.predicate instanceof IRI &&
          t.predicate.value === EXO_INSTANCE_CLASS,
      )
      .map((t) => t.object);

    // With a usable label, behaviour must remain unchanged: ontology URI
    expect(instanceClassObjects.length).toBeGreaterThan(0);
    for (const obj of instanceClassObjects) {
      expect(obj).toBeInstanceOf(IRI);
      expect((obj as IRI).value).toBe(
        "https://exocortex.my/ontology/period#Year",
      );
    }
  });

  it("preserves Literal fallback when UUID does not resolve to any file", async () => {
    const instanceFile = makeInstanceFile();
    const unknownUuid = "00000000-1111-2222-3333-444444444444";

    mockVault.getFrontmatter.mockImplementation((file: IFile) => {
      if (file.path === INSTANCE_PATH) {
        return {
          exo__Asset_uid: INSTANCE_UID,
          exo__Asset_label: "2026",
          exo__Instance_class: [`[[${unknownUuid}]]`],
        };
      }
      return null;
    });

    mockVault.getFirstLinkpathDest.mockReturnValue(null);

    const triples = await converter.convertNote(instanceFile);

    // The exo:Instance_class triple still appears, but as Literal — no file to
    // synthesise an IRI from. This preserves the original wikilink form so
    // downstream consumers can attempt their own resolution.
    const instanceClassObjects = triples
      .filter(
        (t) =>
          t.predicate instanceof IRI &&
          t.predicate.value === EXO_INSTANCE_CLASS,
      )
      .map((t) => t.object);

    expect(instanceClassObjects.length).toBeGreaterThan(0);
    expect(instanceClassObjects.every((o) => o instanceof Literal)).toBe(true);
  });
});
