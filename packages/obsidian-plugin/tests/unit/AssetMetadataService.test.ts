import { AssetMetadataService } from "../../src/presentation/renderers/layout/helpers/AssetMetadataService";
import { TFile } from "obsidian";

describe("AssetMetadataService", () => {
  let service: AssetMetadataService;
  let mockApp: any;

  beforeEach(() => {
    mockApp = {
      metadataCache: {
        getFirstLinkpathDest: jest.fn(),
        getFileCache: jest.fn(),
      },
    };
    service = new AssetMetadataService(mockApp);
  });

  describe("getAssetLabel", () => {
    it("should return label from asset frontmatter", () => {
      const mockFile = new TFile();
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
        },
      });

      const result = service.getAssetLabel("test-path");

      expect(result).toBe("Test Label");
    });

    it("should return null when file not found", () => {
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

      const result = service.getAssetLabel("test-path");

      expect(result).toBeNull();
    });

    it("should return materialized label from prototype (via PrototypeChainMaterializer)", () => {
      const mockFile = new TFile();
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_prototype: "[[prototype-path]]",
          exo__Asset_label: "Prototype Label",
        },
      });

      const result = service.getAssetLabel("test-path");

      expect(result).toBe("Prototype Label");
    });

    it("should return null when instance has no label and no materialized label", () => {
      const mockFile = new TFile();
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_prototype: "[[prototype-path]]",
        },
      });

      const result = service.getAssetLabel("test-path");

      expect(result).toBeNull();
    });
  });

  describe("extractFirstValue", () => {
    it("should extract string value", () => {
      const result = service.extractFirstValue("test-value");
      expect(result).toBe("test-value");
    });

    it("should extract first array element", () => {
      const result = service.extractFirstValue(["first", "second"]);
      expect(result).toBe("first");
    });

    it("should return null for empty values", () => {
      expect(service.extractFirstValue(null)).toBeNull();
      expect(service.extractFirstValue(undefined)).toBeNull();
      expect(service.extractFirstValue("")).toBeNull();
      expect(service.extractFirstValue([])).toBeNull();
    });

    it("should strip wiki link brackets", () => {
      const result = service.extractFirstValue("[[test-link]]");
      expect(result).toBe("test-link");
    });
  });

  describe("getEffortArea", () => {
    it("should return direct area", () => {
      const metadata = {
        ems__Effort_area: "direct-area",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBe("direct-area");
    });

    it("should return null for missing metadata", () => {
      const result = service.getEffortArea({});
      expect(result).toBeNull();
    });

    it("should return materialized area from prototype via triple store", () => {
      const metadata = {
        exo__Asset_prototype: "[[prototype-path]]",
        ems__Effort_area: "materialized-prototype-area",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBe("materialized-prototype-area");
    });

    it("should not traverse prototype for area (materializer handles inheritance)", () => {
      const mockPrototypeFile = new TFile();
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(
        mockPrototypeFile,
      );
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          ems__Effort_area: "prototype-area",
        },
      });

      const metadata = {
        exo__Asset_prototype: "[[prototype-path]]",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBeNull();
      expect(mockApp.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("should return null when neither instance nor prototype has area", () => {
      const metadata = {
        exo__Asset_prototype: "[[prototype-path]]",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBeNull();
    });

    it("should resolve area from parent effort", () => {
      const mockParentFile = new TFile();
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(
        mockParentFile,
      );
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          ems__Effort_area: "parent-area",
        },
      });

      const metadata = {
        ems__Effort_parent: "[[parent-effort]]",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBe("parent-area");
    });

    it("should resolve area from parent when prototype present but no materialized area", () => {
      const mockParentFile = new TFile();

      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
        (linkpath: string) => {
          if (linkpath === "parent-effort") {
            return mockParentFile;
          }
          return null;
        },
      );

      mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => {
        if (file === mockParentFile) {
          return {
            frontmatter: {
              ems__Effort_area: "parent-area",
            },
          };
        }
        return null;
      });

      const metadata = {
        exo__Asset_prototype: "[[prototype-path]]",
        ems__Effort_parent: "[[parent-effort]]",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBe("parent-area");
    });

    it("should resolve parent area with .md extension fallback", () => {
      const mockParentFile = new TFile();

      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
        (linkpath: string) => {
          if (linkpath === "parent-effort") {
            return null;
          }
          if (linkpath === "parent-effort.md") {
            return mockParentFile;
          }
          return null;
        },
      );

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          ems__Effort_area: "parent-area",
        },
      });

      const metadata = {
        ems__Effort_parent: "[[parent-effort]]",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBe("parent-area");
    });

    it("should not add .md extension if path already ends with .md", () => {
      const mockParentFile = new TFile();

      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
        (linkpath: string) => {
          if (linkpath === "parent-effort.md") {
            return mockParentFile;
          }
          return null;
        },
      );

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          ems__Effort_area: "parent-area",
        },
      });

      const metadata = {
        ems__Effort_parent: "[[parent-effort.md]]",
      };

      const result = service.getEffortArea(metadata);

      expect(result).toBe("parent-area");
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(
        1,
      );
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "parent-effort.md",
        "",
      );
    });
  });

  describe("extractInstanceClass", () => {
    it("should extract string class", () => {
      const metadata = {
        exo__Instance_class: "Task",
      };

      const result = service.extractInstanceClass(metadata);

      expect(result).toBe("Task");
    });

    it("should extract first class from array", () => {
      const metadata = {
        exo__Instance_class: ["Task", "Project"],
      };

      const result = service.extractInstanceClass(metadata);

      expect(result).toBe("Task");
    });

    it("should strip wiki link brackets", () => {
      const metadata = {
        exo__Instance_class: "[[Task]]",
      };

      const result = service.extractInstanceClass(metadata);

      expect(result).toBe("Task");
    });

    it("should return empty string for missing class", () => {
      const metadata = {};

      const result = service.extractInstanceClass(metadata);

      expect(result).toBe("");
    });
  });
});
