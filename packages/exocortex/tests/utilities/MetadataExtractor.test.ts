import { MetadataExtractor } from "../../src/utilities/MetadataExtractor";
import { IVaultAdapter, IFile, IFolder } from "../../src/interfaces/IVaultAdapter";

describe("MetadataExtractor", () => {
  let extractor: MetadataExtractor;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;
  let mockFolder: IFolder;

  beforeEach(() => {
    mockFolder = {
      path: "folder",
      name: "folder",
    };

    mockFile = {
      path: "folder/test.md",
      basename: "test",
      name: "test.md",
      parent: mockFolder,
    };

    mockVault = {
      getFrontmatter: jest.fn(),
      read: jest.fn(),
      exists: jest.fn(),
      getAllFiles: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      process: jest.fn(),
      rename: jest.fn(),
      updateLinks: jest.fn(),
      createFolder: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
      updateFrontmatter: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    extractor = new MetadataExtractor(mockVault);
  });

  describe("extractMetadata", () => {
    it("should return frontmatter from file", () => {
      const expectedMetadata = {
        title: "Test Document",
        status: "draft",
        exo__Instance_class: "ems__Task",
      };
      mockVault.getFrontmatter.mockReturnValue(expectedMetadata);

      const result = extractor.extractMetadata(mockFile);

      expect(mockVault.getFrontmatter).toHaveBeenCalledWith(mockFile);
      expect(result).toEqual(expectedMetadata);
    });

    it("should return empty object for null file", () => {
      const result = extractor.extractMetadata(null);

      expect(result).toEqual({});
      expect(mockVault.getFrontmatter).not.toHaveBeenCalled();
    });

    it("should return empty object when frontmatter is null", () => {
      mockVault.getFrontmatter.mockReturnValue(null);

      const result = extractor.extractMetadata(mockFile);

      expect(result).toEqual({});
    });
  });

  describe("extractInstanceClass", () => {
    it("should extract single instance class", () => {
      const metadata = { exo__Instance_class: "ems__Task" };

      const result = extractor.extractInstanceClass(metadata);

      expect(result).toBe("ems__Task");
    });

    it("should extract array of instance classes", () => {
      const metadata = { exo__Instance_class: ["ems__Task", "ems__Project"] };

      const result = extractor.extractInstanceClass(metadata);

      expect(result).toEqual(["ems__Task", "ems__Project"]);
    });

    it("should return null when instance class is missing", () => {
      const metadata = { title: "Test" };

      const result = extractor.extractInstanceClass(metadata);

      expect(result).toBe(null);
    });

    it("should return null for empty metadata", () => {
      const result = extractor.extractInstanceClass({});

      expect(result).toBe(null);
    });
  });

  describe("extractStatus", () => {
    it("should extract status value", () => {
      const metadata = { ems__Effort_status: "[[StatusInProgress]]" };

      const result = extractor.extractStatus(metadata);

      expect(result).toBe("[[StatusInProgress]]");
    });

    it("should extract array of statuses", () => {
      const metadata = { ems__Effort_status: ["[[StatusA]]", "[[StatusB]]"] };

      const result = extractor.extractStatus(metadata);

      expect(result).toEqual(["[[StatusA]]", "[[StatusB]]"]);
    });

    it("should return null when status is missing", () => {
      const metadata = { title: "Test" };

      const result = extractor.extractStatus(metadata);

      expect(result).toBe(null);
    });

    it("should return null for empty metadata", () => {
      const result = extractor.extractStatus({});

      expect(result).toBe(null);
    });
  });

  describe("extractIsArchived", () => {
    it("should return true for archived asset via exo__Asset_isArchived", () => {
      const metadata = { exo__Asset_isArchived: true };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return true for archived asset via legacy field", () => {
      const metadata = { archived: true };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(true);
    });

    it("should return false for non-archived asset", () => {
      const metadata = { exo__Asset_isArchived: false };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false when archive fields are missing", () => {
      const metadata = { title: "Test" };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for empty metadata", () => {
      const result = extractor.extractIsArchived({});

      expect(result).toBe(false);
    });
  });

  describe("extractIsDefinedBy (static)", () => {
    it("should extract single isDefinedBy value", () => {
      const metadata = { exo__Asset_isDefinedBy: "[[Parent]]" };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe("[[Parent]]");
    });

    it("should extract first value from array", () => {
      const metadata = { exo__Asset_isDefinedBy: ["[[Parent1]]", "[[Parent2]]"] };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe("[[Parent1]]");
    });

    it("should return empty quotes when missing", () => {
      const metadata = { title: "Test" };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe('""');
    });

    it("should return empty quotes for empty array", () => {
      const metadata = { exo__Asset_isDefinedBy: [] };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe('""');
    });
  });

  describe("extractExpectedFolder", () => {
    it("should extract folder from isDefinedBy path", () => {
      const metadata = { exo__Asset_isDefinedBy: "[[folder/subfolder/Parent]]" };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("folder/subfolder");
    });

    it("should extract folder from quoted wikilink path", () => {
      const metadata = { exo__Asset_isDefinedBy: '"[[folder/Parent]]"' };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("folder");
    });

    it("should return null when isDefinedBy is missing", () => {
      const metadata = { title: "Test" };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe(null);
    });

    it("should return null for empty isDefinedBy", () => {
      const metadata = { exo__Asset_isDefinedBy: "" };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe(null);
    });

    it("should return empty string for root-level isDefinedBy", () => {
      const metadata = { exo__Asset_isDefinedBy: "[[Parent]]" };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("");
    });

    it("should handle array isDefinedBy by taking first element", () => {
      const metadata = { exo__Asset_isDefinedBy: ["[[folder/Parent]]", "[[other/File]]"] };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("folder");
    });
  });

  describe("extractCommandVisibilityContext", () => {
    it("should extract full context for command visibility", () => {
      const metadata = {
        exo__Instance_class: "ems__Task",
        ems__Effort_status: "[[StatusInProgress]]",
        exo__Asset_isArchived: false,
        exo__Asset_isDefinedBy: "[[folder/Parent]]",
      };
      mockVault.getFrontmatter.mockReturnValue(metadata);

      const result = extractor.extractCommandVisibilityContext(mockFile);

      expect(result).toEqual({
        instanceClass: "ems__Task",
        currentStatus: "[[StatusInProgress]]",
        metadata,
        isArchived: false,
        currentFolder: "folder",
        expectedFolder: "folder",
      });
    });

    it("should handle file at root level", () => {
      const rootFile: IFile = {
        path: "test.md",
        basename: "test",
        name: "test.md",
        parent: null,
      };
      const metadata = { exo__Instance_class: "ems__Task" };
      mockVault.getFrontmatter.mockReturnValue(metadata);

      const result = extractor.extractCommandVisibilityContext(rootFile);

      expect(result.currentFolder).toBe("");
    });

    it("should handle missing metadata fields", () => {
      mockVault.getFrontmatter.mockReturnValue({});

      const result = extractor.extractCommandVisibilityContext(mockFile);

      expect(result).toEqual({
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "folder",
        expectedFolder: null,
      });
    });
  });

  describe("extractCache", () => {
    it("should return frontmatter from file", () => {
      const expectedCache = { cached: true, data: "test" };
      mockVault.getFrontmatter.mockReturnValue(expectedCache);

      const result = extractor.extractCache(mockFile);

      expect(mockVault.getFrontmatter).toHaveBeenCalledWith(mockFile);
      expect(result).toEqual(expectedCache);
    });

    it("should return null for null file", () => {
      const result = extractor.extractCache(null);

      expect(result).toBe(null);
      expect(mockVault.getFrontmatter).not.toHaveBeenCalled();
    });

    it("should return null when frontmatter is null", () => {
      mockVault.getFrontmatter.mockReturnValue(null);

      const result = extractor.extractCache(mockFile);

      expect(result).toBe(null);
    });
  });
});
