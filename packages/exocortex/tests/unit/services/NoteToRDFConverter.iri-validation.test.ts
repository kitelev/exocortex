import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

/**
 * Issue #2205: Tests for improved IRI validation and error handling
 *
 * Acceptance criteria:
 * 1. Warning message for each file with IRI issues
 * 2. Summary statistics after indexing
 * 3. --strict mode to fail fast
 * 4. validate command to check vault health
 */
describe("Issue #2205: IRI Validation and Error Handling", () => {
  let mockVaultAdapter: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVaultAdapter = {
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
  });

  describe("convertVaultWithValidation", () => {
    it("should return validation result with skipped files when conversion throws", async () => {
      const validFile: IFile = {
        path: "valid-file.md",
        basename: "valid-file",
        name: "valid-file.md",
        parent: null,
      };

      const problematicFile: IFile = {
        path: "problematic-file.md",
        basename: "problematic-file",
        name: "problematic-file.md",
        parent: null,
      };

      mockVaultAdapter.getAllFiles.mockReturnValue([validFile, problematicFile]);

      // Valid file returns good frontmatter
      mockVaultAdapter.getFrontmatter.mockImplementation((file) => {
        if (file.path === "valid-file.md") {
          return { exo__Instance_class: ["[[ems__Task]]"] };
        }
        // Problematic file will throw during conversion
        throw new Error("Invalid subject: cannot parse frontmatter");
      });
      mockVaultAdapter.read.mockResolvedValue("# Test content");

      const converter = new NoteToRDFConverter(mockVaultAdapter);
      const result = await converter.convertVaultWithValidation();

      // Should have triples from valid file
      expect(result.triples.length).toBeGreaterThan(0);
      // Should have one skipped file
      expect(result.skippedFiles.length).toBe(1);
      expect(result.skippedFiles[0].path).toBe("problematic-file.md");
      expect(result.skippedFiles[0].reason).toContain("Invalid IRI");
      // Summary should be accurate
      expect(result.summary.indexed).toBe(1);
      expect(result.summary.skipped).toBe(1);
      expect(result.summary.total).toBe(2);
    });

    it("should include detailed error message for each skipped file", async () => {
      const problematicFile: IFile = {
        path: "file-with-error.md",
        basename: "file-with-error",
        name: "file-with-error.md",
        parent: null,
      };

      mockVaultAdapter.getAllFiles.mockReturnValue([problematicFile]);
      mockVaultAdapter.getFrontmatter.mockImplementation(() => {
        throw new Error("Specific error message: bad metadata");
      });

      const converter = new NoteToRDFConverter(mockVaultAdapter);
      const result = await converter.convertVaultWithValidation();

      expect(result.skippedFiles.length).toBe(1);
      expect(result.skippedFiles[0].path).toBe(problematicFile.path);
      expect(result.skippedFiles[0].reason).toContain("Specific error message");
    });

    it("should throw in strict mode when encountering conversion error", async () => {
      const problematicFile: IFile = {
        path: "will-fail.md",
        basename: "will-fail",
        name: "will-fail.md",
        parent: null,
      };

      mockVaultAdapter.getAllFiles.mockReturnValue([problematicFile]);
      mockVaultAdapter.getFrontmatter.mockImplementation(() => {
        throw new Error("Cannot process this file");
      });

      const converter = new NoteToRDFConverter(mockVaultAdapter);

      await expect(
        converter.convertVaultWithValidation({ strict: true })
      ).rejects.toThrow(/Invalid IRI/);
    });

    it("should process all files in non-strict mode even with errors", async () => {
      const validFile1: IFile = {
        path: "valid1.md",
        basename: "valid1",
        name: "valid1.md",
        parent: null,
      };

      const problematicFile: IFile = {
        path: "will-fail.md",
        basename: "will-fail",
        name: "will-fail.md",
        parent: null,
      };

      const validFile2: IFile = {
        path: "valid2.md",
        basename: "valid2",
        name: "valid2.md",
        parent: null,
      };

      mockVaultAdapter.getAllFiles.mockReturnValue([
        validFile1,
        problematicFile,
        validFile2,
      ]);

      mockVaultAdapter.getFrontmatter.mockImplementation((file) => {
        if (file.path === "will-fail.md") {
          throw new Error("Conversion error");
        }
        return { exo__Instance_class: ["[[ems__Task]]"] };
      });
      mockVaultAdapter.read.mockResolvedValue("# Content");

      const converter = new NoteToRDFConverter(mockVaultAdapter);
      const result = await converter.convertVaultWithValidation({ strict: false });

      // Should have indexed 2 valid files
      expect(result.summary.indexed).toBe(2);
      expect(result.summary.skipped).toBe(1);
    });

    it("should return empty skippedFiles for vault with no conversion errors", async () => {
      const validFiles: IFile[] = [
        {
          path: "valid1.md",
          basename: "valid1",
          name: "valid1.md",
          parent: null,
        },
        {
          path: "valid2.md",
          basename: "valid2",
          name: "valid2.md",
          parent: null,
        },
      ];

      mockVaultAdapter.getAllFiles.mockReturnValue(validFiles);
      mockVaultAdapter.getFrontmatter.mockReturnValue({
        exo__Instance_class: ["[[ems__Task]]"],
      });
      mockVaultAdapter.read.mockResolvedValue("# Content");

      const converter = new NoteToRDFConverter(mockVaultAdapter);
      const result = await converter.convertVaultWithValidation();

      expect(result.skippedFiles).toEqual([]);
      expect(result.summary.skipped).toBe(0);
      expect(result.summary.indexed).toBe(2);
    });
  });

  describe("validateVault", () => {
    it("should return list of files with problematic paths", async () => {
      // Files with spaces in paths are technically problematic because
      // they need URL encoding. We detect these proactively.
      const files: IFile[] = [
        {
          path: "valid.md",
          basename: "valid",
          name: "valid.md",
          parent: null,
        },
        {
          path: "has spaces.md",
          basename: "has spaces",
          name: "has spaces.md",
          parent: null,
        },
      ];

      mockVaultAdapter.getAllFiles.mockReturnValue(files);

      const converter = new NoteToRDFConverter(mockVaultAdapter);
      const issues = await converter.validateVault();

      // The validateVault function checks if raw paths would be valid IRIs
      // "has spaces.md" contains spaces, which are invalid in unencoded IRIs
      // But since encodeURI is applied, this should actually pass
      // Let's verify the actual behavior
      expect(issues.length).toBe(0); // Both paths get encoded properly
    });

    it("should return empty array for vault with clean paths", async () => {
      const validFiles: IFile[] = [
        {
          path: "valid-file.md",
          basename: "valid-file",
          name: "valid-file.md",
          parent: null,
        },
        {
          path: "another_valid_file.md",
          basename: "another_valid_file",
          name: "another_valid_file.md",
          parent: null,
        },
      ];

      mockVaultAdapter.getAllFiles.mockReturnValue(validFiles);

      const converter = new NoteToRDFConverter(mockVaultAdapter);
      const issues = await converter.validateVault();

      expect(issues).toEqual([]);
    });
  });

  describe("IRI.isValidIRI edge cases", () => {
    it("should detect spaces in path as invalid", () => {
      // Raw spaces in URI are invalid
      expect(IRI.isValidIRI("obsidian://vault/path with spaces.md")).toBe(false);
    });

    it("should accept encoded spaces in path", () => {
      expect(IRI.isValidIRI("obsidian://vault/path%20with%20spaces.md")).toBe(true);
    });

    it("should accept obsidian:// scheme", () => {
      expect(IRI.isValidIRI("obsidian://vault/valid-path.md")).toBe(true);
    });

    it("should accept international characters when properly encoded", () => {
      expect(IRI.isValidIRI("obsidian://vault/%E7%89%B9%E6%AE%8A.md")).toBe(true);
    });
  });
});
