import { MetadataExtractor } from "../../../src/infrastructure/utilities/MetadataExtractor";
import { TFile, MetadataCache, CachedMetadata } from "obsidian";

describe("MetadataExtractor", () => {
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let extractor: MetadataExtractor;

  beforeEach(() => {
    mockMetadataCache = {
      getFileCache: jest.fn(),
    } as any;

    extractor = new MetadataExtractor(mockMetadataCache);
  });

  describe("extractMetadata", () => {
    it("should extract frontmatter from file", () => {
      const mockFile = { path: "test.md" } as TFile;
      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Asset_label: "Test",
          ems__Effort_status: "ems__EffortStatusDoing",
        },
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractMetadata(mockFile);

      expect(result).toEqual({
        exo__Asset_label: "Test",
        ems__Effort_status: "ems__EffortStatusDoing",
      });
    });

    it("should return empty object for null file", () => {
      const result = extractor.extractMetadata(null);

      expect(result).toEqual({});
      expect(mockMetadataCache.getFileCache).not.toHaveBeenCalled();
    });

    it("should return empty object when no cache found", () => {
      const mockFile = { path: "test.md" } as TFile;
      mockMetadataCache.getFileCache.mockReturnValue(null);

      const result = extractor.extractMetadata(mockFile);

      expect(result).toEqual({});
    });

    it("should return empty object when no frontmatter in cache", () => {
      const mockFile = { path: "test.md" } as TFile;
      const mockCache: CachedMetadata = {};
      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractMetadata(mockFile);

      expect(result).toEqual({});
    });

    it("should handle empty frontmatter", () => {
      const mockFile = { path: "test.md" } as TFile;
      const mockCache: CachedMetadata = {
        frontmatter: {},
      };
      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractMetadata(mockFile);

      expect(result).toEqual({});
    });
  });

  describe("extractInstanceClass", () => {
    it("should extract single instance class", () => {
      const metadata = {
        exo__Instance_class: ["[[ems__Effort]]"],
      };

      const result = extractor.extractInstanceClass(metadata);

      expect(result).toBe("ems__Effort");
    });

    it("should extract multiple instance classes as array", () => {
      const metadata = {
        exo__Instance_class: ["ems__Effort", "ems__Task"],
      };

      const result = extractor.extractInstanceClass(metadata);

      expect(result).toEqual(["ems__Effort", "ems__Task"]);
    });

    it("should return null when instance class not present", () => {
      const metadata = {
        exo__Asset_label: "Test",
      };

      const result = extractor.extractInstanceClass(metadata);

      expect(result).toBeNull();
    });

    it("should handle empty metadata", () => {
      const result = extractor.extractInstanceClass({});

      expect(result).toBeNull();
    });
  });

  describe("extractStatus", () => {
    it("should extract single status", () => {
      const metadata = {
        ems__Effort_status: "ems__EffortStatusDoing",
      };

      const result = extractor.extractStatus(metadata);

      expect(result).toBe("ems__EffortStatusDoing");
    });

    it("should extract multiple statuses as array", () => {
      const metadata = {
        ems__Effort_status: [
          "ems__EffortStatusDoing",
          "ems__EffortStatusWaiting",
        ],
      };

      const result = extractor.extractStatus(metadata);

      expect(result).toEqual([
        "ems__EffortStatusDoing",
        "ems__EffortStatusWaiting",
      ]);
    });

    it("should return null when status not present", () => {
      const metadata = {
        exo__Asset_label: "Test",
      };

      const result = extractor.extractStatus(metadata);

      expect(result).toBeNull();
    });

    it("should handle empty metadata", () => {
      const result = extractor.extractStatus({});

      expect(result).toBeNull();
    });
  });

  describe("extractIsArchived", () => {
    it("should detect archived=true", () => {
      const metadata = {
        exo__Asset_isArchived: true,
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(true);
    });

    it("should detect archived=1", () => {
      const metadata = {
        exo__Asset_isArchived: 1,
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(true);
    });

    it("should detect archived='true'", () => {
      const metadata = {
        exo__Asset_isArchived: "true",
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(true);
    });

    it("should detect archived='yes'", () => {
      const metadata = {
        exo__Asset_isArchived: "yes",
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(true);
    });

    it("should handle case-insensitive strings", () => {
      expect(
        extractor.extractIsArchived({ exo__Asset_isArchived: "TRUE" }),
      ).toBe(true);
      expect(
        extractor.extractIsArchived({ exo__Asset_isArchived: "Yes" }),
      ).toBe(true);
      expect(
        extractor.extractIsArchived({ exo__Asset_isArchived: "YeS" }),
      ).toBe(true);
    });

    it("should return false for archived=false", () => {
      const metadata = {
        exo__Asset_isArchived: false,
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for archived=0", () => {
      const metadata = {
        exo__Asset_isArchived: 0,
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for archived='false'", () => {
      const metadata = {
        exo__Asset_isArchived: "false",
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for archived='no'", () => {
      const metadata = {
        exo__Asset_isArchived: "no",
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false when not present", () => {
      const metadata = {
        exo__Asset_label: "Test",
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should return false for invalid string values", () => {
      const metadata = {
        exo__Asset_isArchived: "invalid",
      };

      const result = extractor.extractIsArchived(metadata);

      expect(result).toBe(false);
    });

    it("should handle empty metadata", () => {
      const result = extractor.extractIsArchived({});

      expect(result).toBe(false);
    });
  });

  describe("extractIsDefinedBy (static)", () => {
    it("should extract isDefinedBy from metadata", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "[[SomeArea]]",
      };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe("[[SomeArea]]");
    });

    it("should extract first element from array", () => {
      const metadata = {
        exo__Asset_isDefinedBy: ["[[Area1]]", "[[Area2]]"],
      };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe("[[Area1]]");
    });

    it("should return empty quoted string when not present", () => {
      const metadata = {
        exo__Asset_label: "Test",
      };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe('""');
    });

    it("should return empty quoted string for empty array", () => {
      const metadata = {
        exo__Asset_isDefinedBy: [],
      };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe('""');
    });

    it("should handle null value in metadata", () => {
      const metadata = {
        exo__Asset_isDefinedBy: null,
      };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe('""');
    });

    it("should handle undefined value in metadata", () => {
      const metadata = {
        exo__Asset_isDefinedBy: undefined,
      };

      const result = MetadataExtractor.extractIsDefinedBy(metadata);

      expect(result).toBe('""');
    });

    it("should handle empty metadata", () => {
      const result = MetadataExtractor.extractIsDefinedBy({});

      expect(result).toBe('""');
    });
  });

  describe("extractExpectedFolder", () => {
    it("should extract folder from isDefinedBy path", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "[[Areas/Work/ProjectX]]",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("Areas/Work");
    });

    it("should extract folder from array isDefinedBy", () => {
      const metadata = {
        exo__Asset_isDefinedBy: ["[[Areas/Personal/Health]]"],
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("Areas/Personal");
    });

    it("should handle quoted wikilinks", () => {
      const metadata = {
        exo__Asset_isDefinedBy: '"[[Areas/Work/ProjectX]]"',
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("Areas/Work");
    });

    it("should handle single-level path", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "[[Areas/WorkArea]]",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("Areas");
    });

    it("should return null for root-level path", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "[[RootArea]]",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("");
    });

    it("should return null when isDefinedBy not present", () => {
      const metadata = {
        exo__Asset_label: "Test",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBeNull();
    });

    it("should return null for empty isDefinedBy", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBeNull();
    });

    it("should return null for whitespace-only isDefinedBy", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "   ",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBeNull();
    });

    it("should handle brackets-only value", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "[[]]",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBeNull();
    });

    it("should return null for non-string isDefinedBy", () => {
      const metadata = {
        exo__Asset_isDefinedBy: 123,
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBeNull();
    });

    it("should handle array with non-string first element", () => {
      const metadata = {
        exo__Asset_isDefinedBy: [null, "[[Areas/Work]]"],
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBeNull();
    });

    it("should handle empty metadata", () => {
      const result = extractor.extractExpectedFolder({});

      expect(result).toBeNull();
    });

    it("should handle deep folder paths", () => {
      const metadata = {
        exo__Asset_isDefinedBy: "[[Areas/Work/Projects/2025/Q1/Sprint1/Task]]",
      };

      const result = extractor.extractExpectedFolder(metadata);

      expect(result).toBe("Areas/Work/Projects/2025/Q1/Sprint1");
    });
  });

  describe("extractCommandVisibilityContext", () => {
    it("should extract complete visibility context", () => {
      const mockFile = {
        path: "Areas/Work/Task.md",
        parent: { path: "Areas/Work" },
      } as TFile;

      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Instance_class: ["[[ems__Effort]]"],
          ems__Effort_status: "ems__EffortStatusDoing",
          exo__Asset_isArchived: false,
          exo__Asset_isDefinedBy: "[[Areas/Work]]",
        },
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractCommandVisibilityContext(mockFile);

      expect(result.instanceClass).toBe("ems__Effort");
      expect(result.currentStatus).toBe("ems__EffortStatusDoing");
      expect(result.isArchived).toBe(false);
      expect(result.currentFolder).toBe("Areas/Work");
      expect(result.expectedFolder).toBe("Areas");
      expect(result.metadata).toEqual(mockCache.frontmatter);
    });

    it("should handle file without parent folder", () => {
      const mockFile = {
        path: "Task.md",
        parent: null,
      } as TFile;

      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Instance_class: ["[[ems__Effort]]"],
        },
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractCommandVisibilityContext(mockFile);

      expect(result.currentFolder).toBe("");
    });

    it("should handle archived file", () => {
      const mockFile = {
        path: "Task.md",
        parent: { path: "" },
      } as TFile;

      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Asset_isArchived: true,
        },
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractCommandVisibilityContext(mockFile);

      expect(result.isArchived).toBe(true);
    });

    it("should handle file without expected folder", () => {
      const mockFile = {
        path: "Task.md",
        parent: { path: "" },
      } as TFile;

      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Instance_class: ["[[ems__Effort]]"],
        },
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractCommandVisibilityContext(mockFile);

      expect(result.expectedFolder).toBeNull();
    });

    it("should handle empty frontmatter", () => {
      const mockFile = {
        path: "Task.md",
        parent: { path: "Folder" },
      } as TFile;

      const mockCache: CachedMetadata = {
        frontmatter: {},
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractCommandVisibilityContext(mockFile);

      expect(result.instanceClass).toBeNull();
      expect(result.currentStatus).toBeNull();
      expect(result.isArchived).toBe(false);
      expect(result.expectedFolder).toBeNull();
    });
  });

  describe("extractCache", () => {
    it("should extract cache from file", () => {
      const mockFile = { path: "test.md" } as TFile;
      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Asset_label: "Test",
        },
        links: [],
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const result = extractor.extractCache(mockFile);

      expect(result).toBe(mockCache);
    });

    it("should return null for null file", () => {
      const result = extractor.extractCache(null);

      expect(result).toBeNull();
      expect(mockMetadataCache.getFileCache).not.toHaveBeenCalled();
    });

    it("should return null when no cache found", () => {
      const mockFile = { path: "test.md" } as TFile;
      mockMetadataCache.getFileCache.mockReturnValue(null);

      const result = extractor.extractCache(mockFile);

      expect(result).toBeNull();
    });
  });

  describe("integration scenarios", () => {
    it("should work with real-world effort file", () => {
      const mockFile = {
        path: "Areas/Work/Projects/TaskManager/Sprint1.md",
        parent: { path: "Areas/Work/Projects/TaskManager" },
      } as TFile;

      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Instance_class: ["ems__Effort", "ems__Task"],
          ems__Effort_status: "ems__EffortStatusDoing",
          exo__Asset_isArchived: false,
          exo__Asset_isDefinedBy: "[[Areas/Work/Projects/TaskManager]]",
          exo__Asset_label: "Sprint 1 Planning",
          ems__Effort_votes: 5,
        },
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const context = extractor.extractCommandVisibilityContext(mockFile);
      const metadata = extractor.extractMetadata(mockFile);
      const instanceClass = extractor.extractInstanceClass(metadata);
      const status = extractor.extractStatus(metadata);
      const isArchived = extractor.extractIsArchived(metadata);

      expect(instanceClass).toEqual(["ems__Effort", "ems__Task"]);
      expect(status).toBe("ems__EffortStatusDoing");
      expect(isArchived).toBe(false);
      expect(context.currentFolder).toBe("Areas/Work/Projects/TaskManager");
      expect(context.expectedFolder).toBe("Areas/Work/Projects");
    });

    it("should handle archived effort without metadata", () => {
      const mockFile = {
        path: "Archive/OldTask.md",
        parent: { path: "Archive" },
      } as TFile;

      const mockCache: CachedMetadata = {
        frontmatter: {
          exo__Asset_isArchived: true,
        },
      };

      mockMetadataCache.getFileCache.mockReturnValue(mockCache);

      const context = extractor.extractCommandVisibilityContext(mockFile);

      expect(context.isArchived).toBe(true);
      expect(context.instanceClass).toBeNull();
      expect(context.currentStatus).toBeNull();
    });
  });
});
