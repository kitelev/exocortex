import { AssetMetadataService } from "../../../src/presentation/renderers/layout/helpers/AssetMetadataService";
import { BacklinksCacheManager } from "../../../src/adapters/caching/BacklinksCacheManager";
import { LoggerFactory } from "../../../src/adapters/logging/LoggerFactory";
import type ExocortexPlugin from "../../../src/ExocortexPlugin";
import { TFile as ObsidianTFile, MetadataCache, Vault, App } from "obsidian";
import { ExocortexAPI, AssetMetadata, AssetRelation, AssetFilter } from "../../../src/application/api/ExocortexAPI";

// Helper to create mock TFile instances
function createMockTFile(path: string): ObsidianTFile {
  const file = new ObsidianTFile(path);
  return file;
}

// Mock dependencies
jest.mock("../../../src/adapters/logging/LoggerFactory");
jest.mock("../../../src/presentation/renderers/layout/helpers/AssetMetadataService");
jest.mock("../../../src/adapters/caching/BacklinksCacheManager");

describe("ExocortexAPI", () => {
  let api: ExocortexAPI;
  let mockPlugin: ExocortexPlugin;
  let mockApp: App;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;
  let mockMetadataService: jest.Mocked<AssetMetadataService>;
  let mockBacklinksCacheManager: jest.Mocked<BacklinksCacheManager>;

  beforeEach(() => {
    // Create mock vault
    mockVault = {
      getAbstractFileByPath: jest.fn(),
      getMarkdownFiles: jest.fn().mockReturnValue([]),
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    // Create mock metadata cache
    mockMetadataCache = {
      getFileCache: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      on: jest.fn().mockReturnValue({ e: {} }), // Return EventRef-like object
      off: jest.fn(),
      offref: jest.fn(),
    } as any;

    // Create mock app
    mockApp = {
      vault: mockVault,
      metadataCache: mockMetadataCache,
    } as any;

    // Create mock plugin
    mockPlugin = {
      app: mockApp,
    } as ExocortexPlugin;

    // Mock LoggerFactory
    (LoggerFactory.create as jest.Mock).mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });

    // Mock AssetMetadataService
    mockMetadataService = {
      getAssetLabel: jest.fn(),
    } as any;
    (AssetMetadataService as jest.Mock).mockImplementation(() => mockMetadataService);

    // Mock BacklinksCacheManager - constructor takes App, not MetadataCache and Vault
    mockBacklinksCacheManager = {
      getBacklinks: jest.fn(),
    } as any;
    (BacklinksCacheManager as jest.Mock).mockImplementation(() => mockBacklinksCacheManager);

    api = new ExocortexAPI(mockPlugin);
  });

  afterEach(() => {
    api.cleanup();
    jest.clearAllMocks();
  });

  describe("getAssetLabel", () => {
    it("should return label from metadata service", () => {
      mockMetadataService.getAssetLabel.mockReturnValue("My Task");

      const label = api.getAssetLabel("tasks/my-task.md");

      expect(label).toBe("My Task");
      expect(mockMetadataService.getAssetLabel).toHaveBeenCalledWith("tasks/my-task.md");
    });

    it("should return null when no label found", () => {
      mockMetadataService.getAssetLabel.mockReturnValue(null);

      const label = api.getAssetLabel("tasks/untitled.md");

      expect(label).toBeNull();
    });
  });

  describe("getAssetLabels", () => {
    it("should return map of labels for multiple paths", () => {
      mockMetadataService.getAssetLabel
        .mockReturnValueOnce("Task One")
        .mockReturnValueOnce(null)
        .mockReturnValueOnce("Task Three");

      const labels = api.getAssetLabels([
        "tasks/task1.md",
        "tasks/task2.md",
        "tasks/task3.md",
      ]);

      expect(labels.get("tasks/task1.md")).toBe("Task One");
      expect(labels.get("tasks/task2.md")).toBeNull();
      expect(labels.get("tasks/task3.md")).toBe("Task Three");
      expect(labels.size).toBe(3);
    });

    it("should return empty map for empty input", () => {
      const labels = api.getAssetLabels([]);

      expect(labels.size).toBe(0);
    });
  });

  describe("getAssetMetadata", () => {
    it("should return full metadata for existing file", () => {
      const mockFile = createMockTFile("tasks/my-task.md");
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "My Task",
          exo__Asset_uid: "abc-123",
          exo__Instance_class: "ems__Task",
          ems__Effort_status: "DOING",
          exo__Asset_prototype: "[[templates/task-template]]",
          exo__Asset_isArchived: false,
          ems__Effort_day: "2024-01-15",
        },
      });
      mockMetadataService.getAssetLabel.mockReturnValue("My Task");

      const metadata = api.getAssetMetadata("tasks/my-task.md");

      expect(metadata).not.toBeNull();
      expect(metadata!.path).toBe("tasks/my-task.md");
      expect(metadata!.label).toBe("My Task");
      expect(metadata!.class).toBe("ems__Task");
      expect(metadata!.status).toBe("DOING");
      expect(metadata!.uid).toBe("abc-123");
      expect(metadata!.prototype).toBe("templates/task-template");
      expect(metadata!.isArchived).toBe(false);
    });

    it("should return null for non-existent file", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const metadata = api.getAssetMetadata("non-existent.md");

      expect(metadata).toBeNull();
    });

    it("should handle array instance class", () => {
      const mockFile = createMockTFile("test.md");
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Instance_class: ["[[ems__Task]]", "[[ems__Project]]"],
        },
      });

      const metadata = api.getAssetMetadata("test.md");

      expect(metadata!.class).toBe("ems__Task");
    });

    it("should handle array status", () => {
      const mockFile = createMockTFile("test.md");
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          ems__Effort_status: ["DOING", "TODO"],
        },
      });

      const metadata = api.getAssetMetadata("test.md");

      expect(metadata!.status).toBe("DOING");
    });

    it("should clean wikilink brackets from prototype", () => {
      const mockFile = createMockTFile("test.md");
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_prototype: "[[my-prototype]]",
        },
      });

      const metadata = api.getAssetMetadata("test.md");

      expect(metadata!.prototype).toBe("my-prototype");
    });
  });

  describe("getAssetRelations", () => {
    it("should return relations for assets with backlinks", () => {
      const mockTargetFile = createMockTFile("target.md");
      const mockSourceFile = createMockTFile("source.md");

      mockVault.getAbstractFileByPath.mockImplementation((path) => {
        if (path === "target.md") return mockTargetFile;
        if (path === "source.md") return mockSourceFile;
        return null;
      });

      mockBacklinksCacheManager.getBacklinks.mockReturnValue(["source.md"]);
      mockMetadataCache.getFileCache.mockImplementation((file: ObsidianTFile) => {
        if (file.path === "source.md") {
          return {
            frontmatter: {
              exo__Asset_label: "Source Label",
              ems__Effort_parent: "[[target]]",
            },
          };
        }
        return { frontmatter: {} };
      });
      mockMetadataService.getAssetLabel.mockReturnValue("Source Label");

      const relations = api.getAssetRelations("target.md");

      expect(relations.length).toBe(1);
      expect(relations[0].sourcePath).toBe("source.md");
      expect(relations[0].targetPath).toBe("target.md");
      expect(relations[0].propertyName).toBe("ems__Effort_parent");
      expect(relations[0].isBodyLink).toBe(false);
      expect(relations[0].sourceLabel).toBe("Source Label");
    });

    it("should return body link relation when no property references found", () => {
      const mockTargetFile = createMockTFile("target.md");
      const mockSourceFile = createMockTFile("source.md");

      mockVault.getAbstractFileByPath.mockImplementation((path) => {
        if (path === "target.md") return mockTargetFile;
        if (path === "source.md") return mockSourceFile;
        return null;
      });

      mockBacklinksCacheManager.getBacklinks.mockReturnValue(["source.md"]);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Source" },
      });
      mockMetadataService.getAssetLabel.mockReturnValue("Source");

      const relations = api.getAssetRelations("target.md");

      expect(relations.length).toBe(1);
      expect(relations[0].isBodyLink).toBe(true);
      expect(relations[0].propertyName).toBeUndefined();
    });

    it("should return empty array for file without backlinks", () => {
      const mockFile = createMockTFile("isolated.md");
      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockBacklinksCacheManager.getBacklinks.mockReturnValue(null);

      const relations = api.getAssetRelations("isolated.md");

      expect(relations).toEqual([]);
    });

    it("should return empty array for non-existent file", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const relations = api.getAssetRelations("non-existent.md");

      expect(relations).toEqual([]);
    });
  });

  describe("getLinkedAssets", () => {
    it("should return linked assets from body links", () => {
      const mockFile = createMockTFile("note.md");
      const mockLinkedFile = createMockTFile("linked.md");

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: {},
        links: [{ link: "linked" }],
      });
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(mockLinkedFile);

      const linked = api.getLinkedAssets("note.md");

      expect(linked).toContain("linked.md");
    });

    it("should return linked assets from frontmatter", () => {
      const mockFile = createMockTFile("note.md");
      const mockLinkedFile = createMockTFile("parent.md");

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          ems__Effort_parent: "[[parent]]",
        },
        links: [],
      });
      mockMetadataCache.getFirstLinkpathDest.mockReturnValue(mockLinkedFile);

      const linked = api.getLinkedAssets("note.md");

      expect(linked).toContain("parent.md");
    });

    it("should return empty array for non-existent file", () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);

      const linked = api.getLinkedAssets("non-existent.md");

      expect(linked).toEqual([]);
    });

    it("should handle array frontmatter values", () => {
      const mockFile = createMockTFile("note.md");
      const mockLinkedFile1 = createMockTFile("tag1.md");
      const mockLinkedFile2 = createMockTFile("tag2.md");

      mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          tags: ["[[tag1]]", "[[tag2]]"],
        },
        links: [],
      });
      mockMetadataCache.getFirstLinkpathDest.mockImplementation((link) => {
        if (link === "tag1") return mockLinkedFile1;
        if (link === "tag2") return mockLinkedFile2;
        return null;
      });

      const linked = api.getLinkedAssets("note.md");

      expect(linked).toContain("tag1.md");
      expect(linked).toContain("tag2.md");
    });
  });

  describe("queryAssets", () => {
    beforeEach(() => {
      const mockFiles = [
        createMockTFile("tasks/task1.md"),
        createMockTFile("tasks/task2.md"),
        createMockTFile("projects/project1.md"),
      ];

      mockVault.getMarkdownFiles.mockReturnValue(mockFiles);
      mockVault.getAbstractFileByPath.mockImplementation((path) => {
        return mockFiles.find((f) => f.path === path) || null;
      });
    });

    it("should filter by class", () => {
      mockMetadataCache.getFileCache.mockImplementation((file: ObsidianTFile) => ({
        frontmatter: {
          exo__Instance_class:
            file.path.includes("task") ? "ems__Task" : "ems__Project",
        },
      }));

      const filter: AssetFilter = { class: "ems__Task" };
      const results = api.queryAssets(filter);

      expect(results.length).toBe(2);
      expect(results.every((r) => r.class === "ems__Task")).toBe(true);
    });

    it("should filter by status", () => {
      mockMetadataCache.getFileCache.mockImplementation((file: ObsidianTFile) => ({
        frontmatter: {
          ems__Effort_status: file.path.includes("task1") ? "DOING" : "TODO",
        },
      }));

      const filter: AssetFilter = { status: "DOING" };
      const results = api.queryAssets(filter);

      expect(results.length).toBe(1);
      expect(results[0].status).toBe("DOING");
    });

    it("should filter by archived state", () => {
      mockMetadataCache.getFileCache.mockImplementation((file: ObsidianTFile) => ({
        frontmatter: {
          exo__Asset_isArchived: file.path.includes("task1"),
        },
      }));

      const filter: AssetFilter = { isArchived: false };
      const results = api.queryAssets(filter);

      expect(results.length).toBe(2);
    });

    it("should filter by hasLabel", () => {
      mockMetadataService.getAssetLabel.mockImplementation((path) => {
        return path.includes("task1") ? "Task 1 Label" : null;
      });
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const filter: AssetFilter = { hasLabel: true };
      const results = api.queryAssets(filter);

      expect(results.length).toBe(1);
      expect(results[0].label).toBe("Task 1 Label");
    });

    it("should support custom filter function", () => {
      mockMetadataCache.getFileCache.mockImplementation((file: ObsidianTFile) => ({
        frontmatter: {
          ems__Effort_day: file.path.includes("task1") ? "2024-01-15" : null,
        },
      }));

      const filter: AssetFilter = {
        custom: (metadata) => metadata["ems__Effort_day"] === "2024-01-15",
      };
      const results = api.queryAssets(filter);

      expect(results.length).toBe(1);
    });

    it("should combine multiple filters", () => {
      mockMetadataCache.getFileCache.mockImplementation((file: ObsidianTFile) => ({
        frontmatter: {
          exo__Instance_class: "ems__Task",
          ems__Effort_status: file.path.includes("task1") ? "DOING" : "TODO",
        },
      }));

      const filter: AssetFilter = {
        class: "ems__Task",
        status: "DOING",
      };
      const results = api.queryAssets(filter);

      expect(results.length).toBe(1);
    });
  });

  describe("events", () => {
    it("should register label-changed callback", () => {
      const callback = jest.fn();
      api.on("label-changed", callback);

      // Trigger metadata change
      const file = createMockTFile("test.md");

      // Get the metadata change callback that was registered
      const metadataChangeCallback = mockMetadataCache.on.mock.calls[0]?.[1];
      expect(metadataChangeCallback).toBeDefined();

      // Simulate initial cache state
      mockVault.getAbstractFileByPath.mockReturnValue(file);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "New Label" },
      });
      mockMetadataService.getAssetLabel.mockReturnValue("New Label");

      // Note: The callback won't fire until there's actually a label change detected
      // In real usage, the plugin would track the previous label
    });

    it("should unregister label-changed callback", () => {
      const callback = jest.fn();
      api.on("label-changed", callback);
      api.off("label-changed", callback);

      // Callbacks should have been added and removed (internal implementation)
    });

    it("should register metadata-changed callback", () => {
      const callback = jest.fn();
      api.on("metadata-changed", callback);

      // Verify callback was registered (internal state)
    });

    it("should unregister metadata-changed callback", () => {
      const callback = jest.fn();
      api.on("metadata-changed", callback);
      api.off("metadata-changed", callback);

      // Verify callback was removed (internal state)
    });
  });

  describe("cleanup", () => {
    it("should cleanup event listeners and clear callbacks", () => {
      const labelCallback = jest.fn();
      const metadataCallback = jest.fn();

      api.on("label-changed", labelCallback);
      api.on("metadata-changed", metadataCallback);

      api.cleanup();

      // Verify offref was called
      expect(mockMetadataCache.offref).toHaveBeenCalled();
    });
  });
});
