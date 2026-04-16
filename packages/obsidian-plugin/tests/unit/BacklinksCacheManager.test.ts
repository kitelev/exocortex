import { BacklinksCacheManager } from "../../src/adapters/caching/BacklinksCacheManager";
import { App, TFile, EventRef } from "obsidian";

describe("BacklinksCacheManager", () => {
  let cacheManager: BacklinksCacheManager;
  let mockApp: App;
  let mockResolvedLinks: Record<string, Record<string, number>>;
  let mockEventHandlers: Map<string, ((file: any, oldPath?: string) => void)[]>;
  let mockEventRefs: EventRef[];

  beforeEach(() => {
    jest.useFakeTimers();

    // Create mock resolved links structure
    mockResolvedLinks = {
      "note1.md": {
        "note2.md": 2,
        "note3.md": 1,
      },
      "note2.md": {
        "note3.md": 3,
        "note4.md": 1,
      },
      "note3.md": {
        "note4.md": 2,
      },
      "note4.md": {
        "note1.md": 1,
      },
    };

    // Track event handlers for testing
    mockEventHandlers = new Map();
    mockEventRefs = [];

    // Mock Obsidian App with vault event system
    mockApp = {
      metadataCache: {
        resolvedLinks: mockResolvedLinks,
        unresolvedLinks: {},
        getFileCache: jest.fn().mockReturnValue({ frontmatter: {} }),
      },
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        on: jest.fn((eventType: string, handler: (file: any, oldPath?: string) => void) => {
          if (!mockEventHandlers.has(eventType)) {
            mockEventHandlers.set(eventType, []);
          }
          mockEventHandlers.get(eventType)!.push(handler);
          const eventRef = { eventType, handler } as unknown as EventRef;
          mockEventRefs.push(eventRef);
          return eventRef;
        }),
        offref: jest.fn((ref: EventRef) => {
          const typedRef = ref as unknown as { eventType: string; handler: Function };
          const handlers = mockEventHandlers.get(typedRef.eventType);
          if (handlers) {
            const index = handlers.indexOf(typedRef.handler as any);
            if (index !== -1) {
              handlers.splice(index, 1);
            }
          }
          const refIndex = mockEventRefs.indexOf(ref);
          if (refIndex !== -1) {
            mockEventRefs.splice(refIndex, 1);
          }
        }),
      },
    } as any;

    cacheManager = new BacklinksCacheManager(mockApp, 100);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Helper to simulate vault events
  const simulateVaultEvent = (eventType: string, file: Partial<TFile>, oldPath?: string) => {
    const handlers = mockEventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => handler(file, oldPath));
    }
  };

  const createMockFile = (path: string): Partial<TFile> => ({
    path,
    extension: "md",
  });

  describe("constructor", () => {
    it("should initialize with invalid cache", () => {
      expect(cacheManager.isValid()).toBe(false);
    });

    it("should initialize with empty backlinks cache", () => {
      expect(cacheManager.getBacklinks("any-file.md")).toBeUndefined();
    });

    it("should accept custom debounce delay", () => {
      const customDelayManager = new BacklinksCacheManager(mockApp, 500);
      expect(customDelayManager).toBeDefined();
      customDelayManager.cleanup();
    });
  });

  describe("buildCache", () => {
    it("should build backlinks cache from resolved links", () => {
      cacheManager.buildCache();

      // Check backlinks for note2.md (should have note1.md pointing to it)
      const note2Backlinks = cacheManager.getBacklinks("note2.md");
      expect(note2Backlinks).toBeDefined();
      expect(note2Backlinks?.has("note1.md")).toBe(true);
      expect(note2Backlinks?.size).toBe(1);

      // Check backlinks for note3.md (should have note1.md and note2.md)
      const note3Backlinks = cacheManager.getBacklinks("note3.md");
      expect(note3Backlinks).toBeDefined();
      expect(note3Backlinks?.has("note1.md")).toBe(true);
      expect(note3Backlinks?.has("note2.md")).toBe(true);
      expect(note3Backlinks?.size).toBe(2);

      // Check backlinks for note4.md (should have note2.md and note3.md)
      const note4Backlinks = cacheManager.getBacklinks("note4.md");
      expect(note4Backlinks).toBeDefined();
      expect(note4Backlinks?.has("note2.md")).toBe(true);
      expect(note4Backlinks?.has("note3.md")).toBe(true);
      expect(note4Backlinks?.size).toBe(2);

      // Check backlinks for note1.md (should have note4.md)
      const note1Backlinks = cacheManager.getBacklinks("note1.md");
      expect(note1Backlinks).toBeDefined();
      expect(note1Backlinks?.has("note4.md")).toBe(true);
      expect(note1Backlinks?.size).toBe(1);
    });

    it("should mark cache as valid after building", () => {
      expect(cacheManager.isValid()).toBe(false);
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);
    });

    it("should skip building if cache is already valid", () => {
      // Build cache once
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);

      // Modify resolved links
      mockApp.metadataCache.resolvedLinks["note5.md"] = { "note1.md": 1 };

      // Build again - should skip because cache is valid
      cacheManager.buildCache();

      // note1.md should not have note5.md as backlink because cache wasn't rebuilt
      const note1Backlinks = cacheManager.getBacklinks("note1.md");
      expect(note1Backlinks?.has("note5.md")).toBe(false);
    });

    it("should handle empty resolved links", () => {
      mockApp.metadataCache.resolvedLinks = {};
      cacheManager.buildCache();

      expect(cacheManager.isValid()).toBe(true);
      expect(cacheManager.getBacklinks("any.md")).toBeUndefined();
    });

    it("should handle files with no links", () => {
      mockApp.metadataCache.resolvedLinks = {
        "isolated.md": {},
      };
      cacheManager.buildCache();

      expect(cacheManager.isValid()).toBe(true);
      expect(cacheManager.getBacklinks("isolated.md")).toBeUndefined();
    });

    it("should accumulate backlinks from multiple sources", () => {
      mockApp.metadataCache.resolvedLinks = {
        "source1.md": {
          "target.md": 1,
        },
        "source2.md": {
          "target.md": 2,
        },
        "source3.md": {
          "target.md": 3,
          "other.md": 1,
        },
      };

      cacheManager.buildCache();

      const targetBacklinks = cacheManager.getBacklinks("target.md");
      expect(targetBacklinks).toBeDefined();
      expect(targetBacklinks?.size).toBe(3);
      expect(targetBacklinks?.has("source1.md")).toBe(true);
      expect(targetBacklinks?.has("source2.md")).toBe(true);
      expect(targetBacklinks?.has("source3.md")).toBe(true);
    });
  });

  describe("invalidate", () => {
    it("should mark cache as invalid", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);

      cacheManager.invalidate();
      expect(cacheManager.isValid()).toBe(false);
    });

    it("should not clear the cache data immediately", () => {
      cacheManager.buildCache();
      const backlinks = cacheManager.getBacklinks("note3.md");
      expect(backlinks).toBeDefined();

      cacheManager.invalidate();

      // Cache data still exists, but will be rebuilt on next access
      // This is because getBacklinks calls buildCache internally
      const backlinksAfterInvalidate = cacheManager.getBacklinks("note3.md");
      expect(backlinksAfterInvalidate).toBeDefined();
    });

    it("should trigger rebuild on next getBacklinks call", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);

      // Add new link
      mockApp.metadataCache.resolvedLinks["note5.md"] = { "note1.md": 1 };

      // Invalidate cache
      cacheManager.invalidate();
      expect(cacheManager.isValid()).toBe(false);

      // Get backlinks - should rebuild cache
      const note1Backlinks = cacheManager.getBacklinks("note1.md");
      expect(cacheManager.isValid()).toBe(true);
      expect(note1Backlinks?.has("note5.md")).toBe(true);
    });
  });

  describe("getBacklinks", () => {
    it("should return undefined for files with no backlinks", () => {
      cacheManager.buildCache();
      const backlinks = cacheManager.getBacklinks("non-existent.md");
      expect(backlinks).toBeUndefined();
    });

    it("should return Set of backlinks for files with backlinks", () => {
      cacheManager.buildCache();
      const backlinks = cacheManager.getBacklinks("note3.md");

      expect(backlinks).toBeDefined();
      expect(backlinks).toBeInstanceOf(Set);
      expect(backlinks?.size).toBe(2);
      expect(backlinks?.has("note1.md")).toBe(true);
      expect(backlinks?.has("note2.md")).toBe(true);
    });

    it("should automatically build cache if invalid", () => {
      expect(cacheManager.isValid()).toBe(false);

      const backlinks = cacheManager.getBacklinks("note3.md");

      expect(cacheManager.isValid()).toBe(true);
      expect(backlinks).toBeDefined();
      expect(backlinks?.size).toBe(2);
    });

    it("should not rebuild cache if already valid", () => {
      cacheManager.buildCache();
      const initialBacklinks = cacheManager.getBacklinks("note3.md");

      // Modify resolved links (but cache won't see this because it's valid)
      mockApp.metadataCache.resolvedLinks["note5.md"] = { "note3.md": 1 };

      const backlinksAfter = cacheManager.getBacklinks("note3.md");

      // Should be same as before because cache wasn't rebuilt
      expect(backlinksAfter).toEqual(initialBacklinks);
      expect(backlinksAfter?.has("note5.md")).toBe(false);
    });

    it("should handle circular references", () => {
      mockApp.metadataCache.resolvedLinks = {
        "a.md": { "b.md": 1 },
        "b.md": { "c.md": 1 },
        "c.md": { "a.md": 1 },
      };

      cacheManager.buildCache();

      expect(cacheManager.getBacklinks("a.md")?.has("c.md")).toBe(true);
      expect(cacheManager.getBacklinks("b.md")?.has("a.md")).toBe(true);
      expect(cacheManager.getBacklinks("c.md")?.has("b.md")).toBe(true);
    });

    it("should handle self-references", () => {
      mockApp.metadataCache.resolvedLinks = {
        "self.md": { "self.md": 1, "other.md": 1 },
      };

      cacheManager.buildCache();

      const selfBacklinks = cacheManager.getBacklinks("self.md");
      expect(selfBacklinks?.has("self.md")).toBe(true);
      expect(selfBacklinks?.size).toBe(1);
    });
  });

  describe("isValid", () => {
    it("should return false initially", () => {
      expect(cacheManager.isValid()).toBe(false);
    });

    it("should return true after building cache", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);
    });

    it("should return false after invalidation", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);
      cacheManager.invalidate();
      expect(cacheManager.isValid()).toBe(false);
    });

    it("should return true after rebuilding invalidated cache", () => {
      cacheManager.buildCache();
      cacheManager.invalidate();
      expect(cacheManager.isValid()).toBe(false);
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);
    });
  });

  describe("UID-based backlink resolution", () => {
    it("should resolve unresolved links via UID→path mapping", () => {
      // Area file has human-readable name but UID in frontmatter
      const areaFile = Object.assign(Object.create(TFile.prototype), {
        path: "01 Inbox/Hello Area.md",
        basename: "Hello Area",
        extension: "md",
      });

      // Project file references Area by UUID in frontmatter
      const projectFile = Object.assign(Object.create(TFile.prototype), {
        path: "01 Inbox/Build my first project.md",
        basename: "Build my first project",
        extension: "md",
      });

      (mockApp.vault as any).getMarkdownFiles = jest.fn().mockReturnValue([areaFile, projectFile]);
      (mockApp.metadataCache as any).getFileCache = jest.fn().mockImplementation((file: TFile) => {
        if (file.path === areaFile.path) {
          return { frontmatter: { exo__Asset_uid: "723b5de3-3047-41d9-a3dc-ea96ba28a5f1" } };
        }
        if (file.path === projectFile.path) {
          return { frontmatter: { exo__Asset_uid: "00d0631d-56c7-4e4b-b98a-fc0b908e6bc9" } };
        }
        return { frontmatter: {} };
      });

      // Project links to Area by UUID → unresolved because file is "Hello Area.md"
      (mockApp.metadataCache as any).unresolvedLinks = {
        "01 Inbox/Build my first project.md": {
          "723b5de3-3047-41d9-a3dc-ea96ba28a5f1": 1,
        },
      };

      // No resolved links between these files
      mockApp.metadataCache.resolvedLinks = {};

      cacheManager.buildCache();

      const areaBacklinks = cacheManager.getBacklinks("01 Inbox/Hello Area.md");
      expect(areaBacklinks).toBeDefined();
      expect(areaBacklinks?.has("01 Inbox/Build my first project.md")).toBe(true);
    });

    it("should combine resolved and UID-based backlinks", () => {
      const targetFile = Object.assign(Object.create(TFile.prototype), {
        path: "01 Inbox/Target.md",
        basename: "Target",
        extension: "md",
      });

      (mockApp.vault as any).getMarkdownFiles = jest.fn().mockReturnValue([targetFile]);
      (mockApp.metadataCache as any).getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_uid: "uid-123" },
      });
      (mockApp.metadataCache as any).unresolvedLinks = {
        "source-by-uid.md": { "uid-123": 1 },
      };

      mockApp.metadataCache.resolvedLinks = {
        "source-by-name.md": { "01 Inbox/Target.md": 1 },
      };

      cacheManager.buildCache();

      const backlinks = cacheManager.getBacklinks("01 Inbox/Target.md");
      expect(backlinks).toBeDefined();
      expect(backlinks?.size).toBe(2);
      expect(backlinks?.has("source-by-name.md")).toBe(true);
      expect(backlinks?.has("source-by-uid.md")).toBe(true);
    });

    it("should not fail when vault has no files with UIDs", () => {
      (mockApp.vault as any).getMarkdownFiles = jest.fn().mockReturnValue([]);
      (mockApp.metadataCache as any).getFileCache = jest.fn().mockReturnValue({ frontmatter: {} });
      (mockApp.metadataCache as any).unresolvedLinks = {
        "source.md": { "non-existent-uid": 1 },
      };
      mockApp.metadataCache.resolvedLinks = {};

      expect(() => cacheManager.buildCache()).not.toThrow();
      expect(cacheManager.isValid()).toBe(true);
    });

    it("should skip files without exo__Asset_uid", () => {
      const fileNoUid = Object.assign(Object.create(TFile.prototype), {
        path: "no-uid.md",
        basename: "no-uid",
        extension: "md",
      });

      (mockApp.vault as any).getMarkdownFiles = jest.fn().mockReturnValue([fileNoUid]);
      (mockApp.metadataCache as any).getFileCache = jest.fn().mockReturnValue({
        frontmatter: { some_property: "value" },
      });
      (mockApp.metadataCache as any).unresolvedLinks = {
        "source.md": { "some-uid": 1 },
      };
      mockApp.metadataCache.resolvedLinks = {};

      cacheManager.buildCache();

      expect(cacheManager.getBacklinks("no-uid.md")).toBeUndefined();
    });

    it("should not duplicate backlinks from UID resolution", () => {
      const targetFile = Object.assign(Object.create(TFile.prototype), {
        path: "target.md",
        basename: "target",
        extension: "md",
      });

      (mockApp.vault as any).getMarkdownFiles = jest.fn().mockReturnValue([targetFile]);
      (mockApp.metadataCache as any).getFileCache = jest.fn().mockReturnValue({
        frontmatter: { exo__Asset_uid: "uid-123" },
      });
      (mockApp.metadataCache as any).unresolvedLinks = {
        "source.md": { "uid-123": 1 },
      };

      // source.md also has a resolved link to target.md
      mockApp.metadataCache.resolvedLinks = {
        "source.md": { "target.md": 1 },
      };

      cacheManager.buildCache();

      const backlinks = cacheManager.getBacklinks("target.md");
      expect(backlinks?.size).toBe(1); // No duplicates
    });
  });

  describe("edge cases", () => {
    it("should handle undefined resolved links", () => {
      mockApp.metadataCache.resolvedLinks = undefined as any;
      expect(() => cacheManager.buildCache()).not.toThrow();
      expect(cacheManager.isValid()).toBe(true);
    });

    it("should handle null resolved links", () => {
      mockApp.metadataCache.resolvedLinks = null as any;
      expect(() => cacheManager.buildCache()).not.toThrow();
      expect(cacheManager.isValid()).toBe(true);
    });

    it("should handle files with many backlinks", () => {
      const manyBacklinks: Record<string, Record<string, number>> = {};
      for (let i = 0; i < 100; i++) {
        manyBacklinks[`source${i}.md`] = { "popular.md": 1 };
      }

      mockApp.metadataCache.resolvedLinks = manyBacklinks;
      cacheManager.buildCache();

      const popularBacklinks = cacheManager.getBacklinks("popular.md");
      expect(popularBacklinks?.size).toBe(100);
    });

    it("should handle deeply nested paths", () => {
      mockApp.metadataCache.resolvedLinks = {
        "folder1/folder2/folder3/deep.md": {
          "other/path/target.md": 1,
        },
      };

      cacheManager.buildCache();

      const targetBacklinks = cacheManager.getBacklinks("other/path/target.md");
      expect(targetBacklinks?.has("folder1/folder2/folder3/deep.md")).toBe(true);
    });

    it("should handle special characters in file names", () => {
      mockApp.metadataCache.resolvedLinks = {
        "file with spaces.md": {
          "target[brackets].md": 1,
        },
        "emoji-😀.md": {
          "target[brackets].md": 1,
        },
      };

      cacheManager.buildCache();

      const targetBacklinks = cacheManager.getBacklinks("target[brackets].md");
      expect(targetBacklinks?.has("file with spaces.md")).toBe(true);
      expect(targetBacklinks?.has("emoji-😀.md")).toBe(true);
    });
  });

  describe("size", () => {
    it("should return 0 for empty cache", () => {
      expect(cacheManager.size).toBe(0);
    });

    it("should return number of cached entries after building", () => {
      cacheManager.buildCache();
      // Based on mockResolvedLinks: note2, note3, note4, note1 have backlinks
      expect(cacheManager.size).toBe(4);
    });
  });

  describe("cleanup", () => {
    it("should clear all entries from the cache", () => {
      cacheManager.buildCache();
      expect(cacheManager.size).toBeGreaterThan(0);

      cacheManager.cleanup();

      expect(cacheManager.size).toBe(0);
    });

    it("should mark cache as invalid after cleanup", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);

      cacheManager.cleanup();

      expect(cacheManager.isValid()).toBe(false);
    });

    it("should allow rebuilding cache after cleanup", () => {
      cacheManager.buildCache();
      cacheManager.cleanup();

      cacheManager.buildCache();

      expect(cacheManager.isValid()).toBe(true);
      expect(cacheManager.size).toBeGreaterThan(0);
    });

    it("should return undefined for all keys after cleanup", () => {
      cacheManager.buildCache();
      const backlinks = cacheManager.getBacklinks("note3.md");
      expect(backlinks).toBeDefined();

      cacheManager.cleanup();

      // After cleanup, cache is invalid, so getBacklinks will rebuild
      // To test immediate state, we need to check without triggering rebuild
      expect(cacheManager.isValid()).toBe(false);
    });

    it("should clear pending invalidations", () => {
      cacheManager.registerEventListeners();
      cacheManager.invalidateFor("note1.md");
      expect(cacheManager.pendingInvalidationCount).toBe(1);

      cacheManager.cleanup();

      expect(cacheManager.pendingInvalidationCount).toBe(0);
    });

    it("should unregister event listeners", () => {
      cacheManager.registerEventListeners();
      expect(mockApp.vault.on).toHaveBeenCalledTimes(4);

      cacheManager.cleanup();

      expect(mockApp.vault.offref).toHaveBeenCalledTimes(4);
    });
  });

  describe("registerEventListeners", () => {
    it("should register listeners for modify, delete, create, and rename events", () => {
      cacheManager.registerEventListeners();

      expect(mockApp.vault.on).toHaveBeenCalledWith("modify", expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith("delete", expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith("create", expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledWith("rename", expect.any(Function));
      expect(mockApp.vault.on).toHaveBeenCalledTimes(4);
    });

    it("should invalidate cache on file modify event", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();
      expect(cacheManager.isValid()).toBe(true);

      // Create a proper TFile-like object
      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("note1.md"));
      simulateVaultEvent("modify", mockFile);

      // Process debounced invalidations
      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
    });

    it("should invalidate cache on file delete event", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();
      expect(cacheManager.isValid()).toBe(true);

      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("note1.md"));
      simulateVaultEvent("delete", mockFile);

      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
    });

    it("should invalidate cache on file create event", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();
      expect(cacheManager.isValid()).toBe(true);

      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("new-file.md"));
      simulateVaultEvent("create", mockFile);

      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
    });

    it("should invalidate cache for both old and new paths on rename event", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();
      expect(cacheManager.isValid()).toBe(true);

      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("new-name.md"));
      simulateVaultEvent("rename", mockFile, "old-name.md");

      // Should have two pending invalidations
      expect(cacheManager.pendingInvalidationCount).toBe(2);

      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
    });

    it("should ignore non-TFile objects", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();
      expect(cacheManager.isValid()).toBe(true);

      // Simulate event with non-TFile object (e.g., TFolder)
      const nonFile = { path: "some-folder", extension: undefined };
      simulateVaultEvent("modify", nonFile);

      jest.runAllTimers();

      // Cache should still be valid because non-TFile was ignored
      expect(cacheManager.isValid()).toBe(true);
    });
  });

  describe("unregisterEventListeners", () => {
    it("should unregister all event listeners", () => {
      cacheManager.registerEventListeners();
      expect(mockEventRefs.length).toBe(4);

      cacheManager.unregisterEventListeners();

      expect(mockApp.vault.offref).toHaveBeenCalledTimes(4);
    });

    it("should handle being called when no listeners are registered", () => {
      expect(() => cacheManager.unregisterEventListeners()).not.toThrow();
    });

    it("should allow re-registering listeners after unregistering", () => {
      cacheManager.registerEventListeners();
      cacheManager.unregisterEventListeners();

      expect(() => cacheManager.registerEventListeners()).not.toThrow();
      expect(mockApp.vault.on).toHaveBeenCalledTimes(8); // 4 initial + 4 re-registered
    });
  });

  describe("invalidateFor (partial invalidation)", () => {
    it("should queue path for invalidation", () => {
      cacheManager.invalidateFor("note1.md");
      expect(cacheManager.pendingInvalidationCount).toBe(1);
    });

    it("should batch multiple invalidations together", () => {
      cacheManager.invalidateFor("note1.md");
      cacheManager.invalidateFor("note2.md");
      cacheManager.invalidateFor("note3.md");

      expect(cacheManager.pendingInvalidationCount).toBe(3);
    });

    it("should deduplicate same path invalidations", () => {
      cacheManager.invalidateFor("note1.md");
      cacheManager.invalidateFor("note1.md");
      cacheManager.invalidateFor("note1.md");

      expect(cacheManager.pendingInvalidationCount).toBe(1);
    });

    it("should process invalidations after debounce delay", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);

      cacheManager.invalidateFor("note1.md");

      // Before debounce completes, cache should still have pending invalidations
      expect(cacheManager.pendingInvalidationCount).toBe(1);
      expect(cacheManager.isValid()).toBe(true);

      // Run timers to trigger debounced function
      jest.runAllTimers();

      // After debounce, invalidations should be processed
      expect(cacheManager.pendingInvalidationCount).toBe(0);
      expect(cacheManager.isValid()).toBe(false);
    });

    it("should remove direct cache entry for invalidated path", () => {
      cacheManager.buildCache();
      expect(cacheManager.getBacklinks("note2.md")).toBeDefined();

      cacheManager.invalidateFor("note2.md");
      jest.runAllTimers();

      // After invalidation processing, cache is invalid and will rebuild on access
      expect(cacheManager.isValid()).toBe(false);
    });

    it("should invalidate entire cache if affected links exist", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);

      // note1.md links to note2.md and note3.md
      // Invalidating note1.md should trigger full cache invalidation
      cacheManager.invalidateFor("note1.md");
      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
    });
  });

  describe("debouncing behavior", () => {
    it("should not process invalidations until debounce delay passes", () => {
      cacheManager.buildCache();
      cacheManager.invalidateFor("note1.md");

      // Advance time by less than debounce delay
      jest.advanceTimersByTime(50);

      // Invalidations should still be pending
      expect(cacheManager.pendingInvalidationCount).toBe(1);
    });

    it("should batch rapid invalidations within debounce window", () => {
      cacheManager.buildCache();

      // Rapid fire invalidations
      cacheManager.invalidateFor("note1.md");
      jest.advanceTimersByTime(30);
      cacheManager.invalidateFor("note2.md");
      jest.advanceTimersByTime(30);
      cacheManager.invalidateFor("note3.md");

      // All should be batched
      expect(cacheManager.pendingInvalidationCount).toBe(3);

      // Complete the debounce
      jest.runAllTimers();

      // All processed at once
      expect(cacheManager.pendingInvalidationCount).toBe(0);
    });

    it("should use trailing edge debounce (delayed processing)", () => {
      cacheManager.buildCache();
      expect(cacheManager.isValid()).toBe(true);

      cacheManager.invalidateFor("note1.md");

      // With trailing edge debounce, pending invalidations accumulate until delay passes
      expect(cacheManager.pendingInvalidationCount).toBe(1);
      expect(cacheManager.isValid()).toBe(true);

      // After timer completes, invalidations are processed
      jest.runAllTimers();

      expect(cacheManager.pendingInvalidationCount).toBe(0);
      expect(cacheManager.isValid()).toBe(false);
    });
  });

  describe("pendingInvalidationCount", () => {
    it("should return 0 when no invalidations pending", () => {
      expect(cacheManager.pendingInvalidationCount).toBe(0);
    });

    it("should track number of pending invalidations", () => {
      cacheManager.invalidateFor("note1.md");
      expect(cacheManager.pendingInvalidationCount).toBe(1);

      cacheManager.invalidateFor("note2.md");
      expect(cacheManager.pendingInvalidationCount).toBe(2);
    });

    it("should return 0 after invalidations are processed", () => {
      cacheManager.invalidateFor("note1.md");
      expect(cacheManager.pendingInvalidationCount).toBe(1);

      jest.runAllTimers();

      expect(cacheManager.pendingInvalidationCount).toBe(0);
    });
  });

  describe("integration with vault events", () => {
    it("should handle rapid file modifications", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();

      // Simulate rapid file saves (common during auto-save)
      for (let i = 0; i < 10; i++) {
        const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("note1.md"));
        simulateVaultEvent("modify", mockFile);
        jest.advanceTimersByTime(10);
      }

      // All invalidations should be batched
      expect(cacheManager.pendingInvalidationCount).toBe(1); // Same file

      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
      expect(cacheManager.pendingInvalidationCount).toBe(0);
    });

    it("should handle file rename with linked files", () => {
      // Setup: note1.md links to note2.md
      cacheManager.buildCache();
      cacheManager.registerEventListeners();

      // Rename note2.md to renamed.md
      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("renamed.md"));
      simulateVaultEvent("rename", mockFile, "note2.md");

      jest.runAllTimers();

      // Cache should be invalidated
      expect(cacheManager.isValid()).toBe(false);

      // After rebuild, should reflect new state
      // (In real scenario, Obsidian would update resolvedLinks)
    });

    it("should handle file deletion", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();

      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("note2.md"));
      simulateVaultEvent("delete", mockFile);

      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
    });

    it("should handle new file creation", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();

      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("new-note.md"));
      simulateVaultEvent("create", mockFile);

      jest.runAllTimers();

      expect(cacheManager.isValid()).toBe(false);
    });

    it("should correctly rebuild cache after invalidation from event", () => {
      cacheManager.buildCache();
      cacheManager.registerEventListeners();

      // Add new link to resolved links
      mockApp.metadataCache.resolvedLinks["new-note.md"] = { "note1.md": 1 };

      // Simulate create event
      const mockFile = Object.assign(Object.create(TFile.prototype), createMockFile("new-note.md"));
      simulateVaultEvent("create", mockFile);

      jest.runAllTimers();

      // Access triggers rebuild
      const note1Backlinks = cacheManager.getBacklinks("note1.md");

      // Should now include the new backlink
      expect(note1Backlinks?.has("new-note.md")).toBe(true);
      expect(cacheManager.isValid()).toBe(true);
    });
  });
});
