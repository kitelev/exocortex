import { URIConstructionService } from "../../../src/services/URIConstructionService";
import { IFileSystemAdapter } from "../../../src/interfaces/IFileSystemAdapter";

describe("URIConstructionService", () => {
  let service: URIConstructionService;
  let mockFileSystem: jest.Mocked<IFileSystemAdapter>;

  beforeEach(() => {
    mockFileSystem = {
      readFile: jest.fn(),
      fileExists: jest.fn(),
      getFileMetadata: jest.fn(),
      createFile: jest.fn(),
      updateFile: jest.fn(),
      writeFile: jest.fn(),
      deleteFile: jest.fn(),
      renameFile: jest.fn(),
      createDirectory: jest.fn(),
      directoryExists: jest.fn(),
      getMarkdownFiles: jest.fn(),
      findFilesByMetadata: jest.fn(),
      findFileByUID: jest.fn(),
    } as jest.Mocked<IFileSystemAdapter>;

    service = new URIConstructionService(mockFileSystem);
  });

  describe("constructAssetURI", () => {
    it("should construct URI using UID and ontology URL", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      };

      mockFileSystem.fileExists.mockResolvedValue(true);
      mockFileSystem.getFileMetadata.mockResolvedValue({
        exo__Ontology_url: "https://exocortex.my/ontology/ems/",
      });

      const uri = await service.constructAssetURI(asset);

      expect(uri).toBe(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );
      expect(mockFileSystem.getFileMetadata).toHaveBeenCalledWith(
        "Ontology/EMS.md",
      );
    });

    it("should throw error for missing UID in strict mode", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      };

      await expect(service.constructAssetURI(asset)).rejects.toThrow(
        "Asset missing exo__Asset_uid: Tasks/review-pr.md",
      );
    });

    it("should use fallback for missing UID in non-strict mode", async () => {
      const serviceNonStrict = new URIConstructionService(mockFileSystem, {
        strictValidation: false,
      });

      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {},
      };

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const uri = await serviceNonStrict.constructAssetURI(asset);

      expect(uri).toContain("review-pr");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing UID"),
      );

      consoleSpy.mockRestore();
    });

    it("should use default ontology URL when isDefinedBy missing", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
        },
      };

      const uri = await service.constructAssetURI(asset);

      expect(uri).toBe(
        "https://exocortex.my/default/550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("should handle trailing slashes in ontology URL", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      };

      mockFileSystem.fileExists.mockResolvedValue(true);
      mockFileSystem.getFileMetadata.mockResolvedValue({
        exo__Ontology_url: "https://exocortex.my/ontology/ems",
      });

      const uri = await service.constructAssetURI(asset);

      expect(uri).toBe(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("should handle ontology URL with trailing slash", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      };

      mockFileSystem.fileExists.mockResolvedValue(true);
      mockFileSystem.getFileMetadata.mockResolvedValue({
        exo__Ontology_url: "https://exocortex.my/ontology/ems/",
      });

      const uri = await service.constructAssetURI(asset);

      expect(uri).toBe(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("should use .md extension fallback for ontology file", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      };

      mockFileSystem.fileExists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockFileSystem.getFileMetadata.mockResolvedValue({
        exo__Ontology_url: "https://exocortex.my/ontology/ems/",
      });

      const uri = await service.constructAssetURI(asset);

      expect(uri).toBe(
        "https://exocortex.my/ontology/ems/550e8400-e29b-41d4-a716-446655440000",
      );
      expect(mockFileSystem.fileExists).toHaveBeenCalledWith("Ontology/EMS");
      expect(mockFileSystem.fileExists).toHaveBeenCalledWith("Ontology/EMS.md");
      expect(mockFileSystem.getFileMetadata).toHaveBeenCalledWith(
        "Ontology/EMS.md",
      );
    });

    it("should use default URL when ontology file not found", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
          exo__Asset_isDefinedBy: "[[Ontology/NonExistent]]",
        },
      };

      mockFileSystem.fileExists.mockResolvedValue(false);

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const uri = await service.constructAssetURI(asset);

      expect(uri).toBe(
        "https://exocortex.my/default/550e8400-e29b-41d4-a716-446655440000",
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Ontology file not found"),
      );

      consoleSpy.mockRestore();
    });

    it("should use default URL when ontology URL missing", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      };

      mockFileSystem.fileExists.mockResolvedValue(true);
      mockFileSystem.getFileMetadata.mockResolvedValue({});

      const uri = await service.constructAssetURI(asset);

      expect(uri).toBe(
        "https://exocortex.my/default/550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("should throw error for invalid ontology URL", async () => {
      const asset = {
        path: "Tasks/review-pr.md",
        frontmatter: {
          exo__Asset_uid: "550e8400-e29b-41d4-a716-446655440000",
          exo__Asset_isDefinedBy: "[[Ontology/EMS]]",
        },
      };

      mockFileSystem.fileExists.mockResolvedValue(true);
      mockFileSystem.getFileMetadata.mockResolvedValue({
        exo__Ontology_url: "not-a-url",
      });

      await expect(service.constructAssetURI(asset)).rejects.toThrow(
        "Invalid ontology URL: not-a-url",
      );
    });
  });

  describe("validateOntologyURL", () => {
    it("should accept valid HTTP URL", () => {
      expect(service.validateOntologyURL("http://exocortex.org/")).toBe(true);
    });

    it("should accept valid HTTPS URL", () => {
      expect(service.validateOntologyURL("https://exocortex.org/")).toBe(true);
    });

    it("should reject non-HTTP(S) URL", () => {
      expect(service.validateOntologyURL("ftp://exocortex.org/")).toBe(false);
    });

    it("should reject invalid URL format", () => {
      expect(service.validateOntologyURL("not-a-url")).toBe(false);
    });

    it("should reject empty URL", () => {
      expect(service.validateOntologyURL("")).toBe(false);
    });

    it("should reject null URL", () => {
      expect(service.validateOntologyURL(null as any)).toBe(false);
    });

    it("should reject undefined URL", () => {
      expect(service.validateOntologyURL(undefined as any)).toBe(false);
    });
  });
});
