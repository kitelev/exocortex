import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";

/**
 * Issue #3121: an invalid entry in a multi-valued `exo__Instance_class`
 * array (e.g. `[[kf__Academic Discipline]]` — namespaced prefix but
 * local name with whitespace) must not drop the entire asset from the
 * triple store. Other valid entries continue to produce class-membership
 * triples (`rdf:type`, `exo__Instance_class`).
 *
 * Pre-fix behaviour: `validateExocortexAsset` returned
 * `INVALID_INSTANCE_CLASS_IRI` and `convertVaultWithValidation` skipped
 * the entire file. Result: cascading false sh:class violations against
 * every asset that referenced the dropped one (e.g. Psychology, Medicine
 * referenced by other concepts).
 */
describe("Issue #3121: multi-valued exo__Instance_class with one invalid entry", () => {
  let mockVault: jest.Mocked<IVaultAdapter>;
  let converter: NoteToRDFConverter;

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

  it("validateExocortexAsset accepts mixed array if at least one entry is valid", () => {
    const frontmatter = {
      exo__Asset_uid: "fdd8969a-dc13-475a-b044-5b56c3275ee1",
      exo__Asset_isDefinedBy: "[[!exo]]",
      exo__Instance_class: [
        "[[kf__Academic Discipline]]", // invalid: whitespace in local name
        "[[ims__Concept]]",             // valid
      ],
    };
    expect(converter.validateExocortexAsset(frontmatter)).toBeNull();
  });

  it("validateExocortexAsset still rejects when all entries are invalid", () => {
    const frontmatter = {
      exo__Asset_uid: "00000000-0000-0000-0000-000000000000",
      exo__Asset_isDefinedBy: "[[!exo]]",
      exo__Instance_class: ["[[kf__Academic Discipline]]"], // only invalid entry
    };
    expect(converter.validateExocortexAsset(frontmatter)?.code).toBe(
      "INVALID_INSTANCE_CLASS_IRI",
    );
  });

  it("convertNote emits rdf:type triples for valid entries and skips invalid ones", async () => {
    const file = {
      path: "03 Knowledge/x/fdd8969a-dc13-475a-b044-5b56c3275ee1.md",
      basename: "fdd8969a-dc13-475a-b044-5b56c3275ee1",
      name: "fdd8969a-dc13-475a-b044-5b56c3275ee1.md",
      extension: "md",
      parent: null,
    } as unknown as IFile;

    mockVault.getFrontmatter.mockReturnValue({
      exo__Asset_uid: "fdd8969a-dc13-475a-b044-5b56c3275ee1",
      exo__Asset_isDefinedBy: "[[!exo]]",
      exo__Asset_label: "Psychology",
      exo__Instance_class: [
        "[[kf__Academic Discipline]]",
        "[[ims__Concept]]",
      ],
    });

    const triples = await converter.convertNote(file);

    const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const EXO_INSTANCE_CLASS = "https://exocortex.my/ontology/exo#Instance_class";
    const IMS_CONCEPT = "https://exocortex.my/ontology/ims#Concept";

    // Valid entry produces both class-membership triples
    const rdfTypeIRIs = triples
      .filter(
        (t) =>
          t.predicate instanceof IRI &&
          t.predicate.value === RDF_TYPE &&
          t.object instanceof IRI,
      )
      .map((t) => (t.object as IRI).value);
    expect(rdfTypeIRIs).toContain(IMS_CONCEPT);

    const instanceClassValues = triples
      .filter(
        (t) =>
          t.predicate instanceof IRI &&
          t.predicate.value === EXO_INSTANCE_CLASS &&
          t.object instanceof IRI,
      )
      .map((t) => (t.object as IRI).value);
    expect(instanceClassValues).toContain(IMS_CONCEPT);

    // Invalid entry MUST NOT produce an IRI with whitespace (would be unusable)
    expect(instanceClassValues.some((v) => /\s/.test(v))).toBe(false);
    expect(rdfTypeIRIs.some((v) => /\s/.test(v))).toBe(false);
    // And MUST NOT produce an rdf:type triple at all — the line 186-194 loop
    // gates on `instanceof IRI`, so a Literal-resolved bad entry is dropped.
    expect(rdfTypeIRIs).toEqual([IMS_CONCEPT]);
  });
});
