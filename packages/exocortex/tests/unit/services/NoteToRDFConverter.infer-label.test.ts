import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { Literal } from "../../../src/domain/models/rdf/Literal";

/**
 * Issue #3101: Tests for inferring exo__Asset_label from filename for
 * non-UIDified ontology class files (e.g. exo__Class.md, ems__Area.md).
 */
describe("Issue #3101: Infer exo__Asset_label from filename", () => {
  let mockVault: jest.Mocked<IVaultAdapter>;
  let converter: NoteToRDFConverter;

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
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

  describe("inferLabelFromBasename", () => {
    it("should return basename for valid prefix__LocalName pattern", () => {
      expect(NoteToRDFConverter.inferLabelFromBasename("exo__Class")).toBe("exo__Class");
      expect(NoteToRDFConverter.inferLabelFromBasename("ems__Area")).toBe("ems__Area");
      expect(NoteToRDFConverter.inferLabelFromBasename("ztlk__Note")).toBe("ztlk__Note");
    });

    it("should return null for regular UIDified files", () => {
      expect(NoteToRDFConverter.inferLabelFromBasename("8619c4fc-64f1-4869-b17e-e34186cacca9")).toBeNull();
    });

    it("should return null for plain names without namespace separator", () => {
      expect(NoteToRDFConverter.inferLabelFromBasename("my-note")).toBeNull();
      expect(NoteToRDFConverter.inferLabelFromBasename("README")).toBeNull();
    });

    it("should return null for invalid prefix (starts with uppercase)", () => {
      expect(NoteToRDFConverter.inferLabelFromBasename("Exo__Class")).toBeNull();
    });
  });

  describe("validateExocortexAsset with basename", () => {
    it("should not require exo__Asset_label when basename is inferrable", () => {
      const frontmatter = {
        exo__Asset_uid: "8619c4fc-64f1-4869-b17e-e34186cacca9",
        exo__Asset_isDefinedBy: "[[!exo]]",
        // no exo__Asset_label
        exo__Instance_class: ["[[exo__Class]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "exo__Class");
      expect(result).toBeNull();
    });

    it("should still require exo__Asset_label when basename is not inferrable", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_isDefinedBy: "[[!exo]]",
        // no exo__Asset_label
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "plain-file-name");
      expect(result).not.toBeNull();
      expect(result?.code).toBe("MISSING_PROPERTY");
      expect(result?.property).toBe("exo__Asset_label");
    });

    it("should still require exo__Asset_label when no basename provided", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_isDefinedBy: "[[!exo]]",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter);
      expect(result).not.toBeNull();
      expect(result?.code).toBe("MISSING_PROPERTY");
      expect(result?.property).toBe("exo__Asset_label");
    });
  });

  describe("convertNote with inferred label", () => {
    it("should emit rdfs:label and exo:Asset_label triples when label inferred from basename", async () => {
      const file: IFile = {
        path: "03 Knowledge/exo/exo__Class.md",
        basename: "exo__Class",
        name: "exo__Class.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "8619c4fc-64f1-4869-b17e-e34186cacca9",
        exo__Asset_isDefinedBy: "[[!exo]]",
        // no exo__Asset_label — should be inferred from "exo__Class"
        exo__Instance_class: ["[[exo__Class]]"],
      });
      mockVault.read.mockResolvedValue("");
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);

      const rdfsLabelIRI = Namespace.RDFS.term("label").value;
      const exoAssetLabelIRI = Namespace.EXO.term("Asset_label").value;

      const rdfsLabelTriples = triples.filter(
        (t) => t.predicate.value === rdfsLabelIRI
      );
      const exoLabelTriples = triples.filter(
        (t) => t.predicate.value === exoAssetLabelIRI
      );

      expect(rdfsLabelTriples.length).toBeGreaterThanOrEqual(1);
      expect(exoLabelTriples.length).toBeGreaterThanOrEqual(1);

      const rdfsLabelValue = rdfsLabelTriples.find(
        (t) => t.object instanceof Literal && (t.object as Literal).value === "exo__Class"
      );
      expect(rdfsLabelValue).toBeDefined();
    });

    it("should not emit duplicate rdfs:label when exo__Asset_label present in frontmatter", async () => {
      const file: IFile = {
        path: "03 Knowledge/exo/exo__Class.md",
        basename: "exo__Class",
        name: "exo__Class.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "8619c4fc-64f1-4869-b17e-e34186cacca9",
        exo__Asset_isDefinedBy: "[[!exo]]",
        exo__Asset_label: "exo__Class",
        exo__Instance_class: ["[[exo__Class]]"],
      });
      mockVault.read.mockResolvedValue("");
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);

      const rdfsLabelIRI = Namespace.RDFS.term("label").value;
      const rdfsLabelTriples = triples.filter(
        (t) =>
          t.predicate.value === rdfsLabelIRI &&
          t.object instanceof Literal &&
          (t.object as Literal).value === "exo__Class"
      );

      // Exactly one rdfs:label triple — from frontmatter, not double-emitted
      expect(rdfsLabelTriples.length).toBe(1);
    });

    it("should index non-UIDified class file that was previously skipped", async () => {
      const classFile: IFile = {
        path: "exo__Class.md",
        basename: "exo__Class",
        name: "exo__Class.md",
        parent: null,
      };

      mockVault.getAllFiles.mockReturnValue([classFile]);
      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "8619c4fc-64f1-4869-b17e-e34186cacca9",
        exo__Asset_isDefinedBy: "[[!exo]]",
        // no exo__Asset_label — previously caused skipping
        exo__Instance_class: ["[[exo__Class]]"],
      });
      mockVault.read.mockResolvedValue("");
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const result = await converter.convertVaultWithValidation();

      expect(result.skippedFiles).toHaveLength(0);
      expect(result.summary.indexed).toBe(1);
      expect(result.summary.skipped).toBe(0);
    });
  });
});
