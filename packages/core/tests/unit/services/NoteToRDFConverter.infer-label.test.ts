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

  describe("validateExocortexAsset — exo__Asset_label is optional", () => {
    it("should not require exo__Asset_label when basename is class-like", () => {
      const frontmatter = {
        exo__Asset_uid: "8619c4fc-64f1-4869-b17e-e34186cacca9",
        exo__Asset_isDefinedBy: "[[!exo]]",
        exo__Instance_class: ["[[exo__Class]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "exo__Class");
      expect(result).toBeNull();
    });

    it("should not require exo__Asset_label for plain (non-class-like) basenames", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_isDefinedBy: "[[!exo]]",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "plain-file-name");
      expect(result).toBeNull();
    });

    it("should not require exo__Asset_label when no basename provided", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_isDefinedBy: "[[!exo]]",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter);
      expect(result).toBeNull();
    });

    it("should not flag empty-string exo__Asset_label", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_isDefinedBy: "[[!exo]]",
        exo__Asset_label: "",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "my-note");
      expect(result).toBeNull();
    });
  });

  describe("validateExocortexAsset — exo__Asset_isDefinedBy is optional", () => {
    it("should not require exo__Asset_isDefinedBy when missing", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "my-note");
      expect(result).toBeNull();
    });

    it("should not flag empty-string exo__Asset_isDefinedBy", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_isDefinedBy: "",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "my-note");
      expect(result).toBeNull();
    });

    it("should not flag empty-array exo__Asset_isDefinedBy", () => {
      const frontmatter = {
        exo__Asset_uid: "11111111-1111-1111-1111-111111111111",
        exo__Asset_isDefinedBy: [],
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = converter.validateExocortexAsset(frontmatter, "my-note");
      expect(result).toBeNull();
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

    it("should fall back to basename for plain (non-class-like) files when label missing", async () => {
      const file: IFile = {
        path: "03 Knowledge/kitelev/Wim Hof (Person).md",
        basename: "Wim Hof (Person)",
        name: "Wim Hof (Person).md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "b2acc0e7-cd0f-4629-b3bd-5447fc03bf9b",
        exo__Asset_isDefinedBy: "[[!kitelev]]",
        // no exo__Asset_label — should fall back to basename
        exo__Instance_class: ["[[1bd359f1-1fd8-447a-a82b-584cd7d7d515|ims__Person]]"],
      });
      mockVault.read.mockResolvedValue("");
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);

      const rdfsLabelIRI = Namespace.RDFS.term("label").value;
      const exoAssetLabelIRI = Namespace.EXO.term("Asset_label").value;

      const basenameLabel = triples.find(
        (t) =>
          (t.predicate.value === rdfsLabelIRI || t.predicate.value === exoAssetLabelIRI) &&
          t.object instanceof Literal &&
          (t.object as Literal).value === "Wim Hof (Person)",
      );
      expect(basenameLabel).toBeDefined();
    });

    it("should fall back to basename when exo__Asset_label is empty string", async () => {
      const file: IFile = {
        path: "03 Knowledge/some-note.md",
        basename: "some-note",
        name: "some-note.md",
        parent: null,
      };

      mockVault.getFrontmatter.mockReturnValue({
        exo__Asset_uid: "33333333-3333-3333-3333-333333333333",
        exo__Asset_isDefinedBy: "[[!exo]]",
        exo__Asset_label: "",
        exo__Instance_class: ["[[ems__Task]]"],
      });
      mockVault.read.mockResolvedValue("");
      mockVault.getFirstLinkpathDest.mockReturnValue(null);

      const triples = await converter.convertNote(file);

      const rdfsLabelIRI = Namespace.RDFS.term("label").value;
      const basenameLabel = triples.find(
        (t) =>
          t.predicate.value === rdfsLabelIRI &&
          t.object instanceof Literal &&
          (t.object as Literal).value === "some-note",
      );
      expect(basenameLabel).toBeDefined();
    });
  });
});
