import { TabTitlePatch } from "../../../../src/presentation/tab-titles/TabTitlePatch";
import { TFile, WorkspaceLeaf, Plugin, MarkdownView } from "obsidian";

describe("TabTitlePatch", () => {
  let patch: TabTitlePatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockWorkspaceLeaf: any;
  let mockMarkdownView: any;
  let originalGetDisplayText: jest.Mock;

  beforeEach(() => {
    originalGetDisplayText = jest.fn().mockReturnValue("original-filename");

    mockMarkdownView = {
      file: null,
    };
    Object.setPrototypeOf(mockMarkdownView, MarkdownView.prototype);

    mockWorkspaceLeaf = {
      view: mockMarkdownView,
      getDisplayText: originalGetDisplayText,
    };

    mockApp = {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([mockWorkspaceLeaf]),
        iterateAllLeaves: jest.fn((callback: (leaf: WorkspaceLeaf) => void) => {
          callback(mockWorkspaceLeaf);
        }),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
      vault: {
        getAbstractFileByPath: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
        getFirstLinkpathDest: jest.fn(),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
    };

    patch = new TabTitlePatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
  });

  describe("enable", () => {
    it("should register active-leaf-change event on enable", () => {
      patch.enable();

      expect(mockPlugin.registerEvent).toHaveBeenCalled();
      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "active-leaf-change",
        expect.any(Function)
      );
    });

    it("should register layout-change event on enable", () => {
      patch.enable();

      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function)
      );
    });

    it("should register metadata change event on enable", () => {
      patch.enable();

      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "changed",
        expect.any(Function)
      );
    });

    it("should not double-enable", () => {
      patch.enable();
      patch.enable();

      // Should only register events once (3 calls: active-leaf-change + layout-change + metadata)
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe("disable", () => {
    it("should restore original getDisplayText on disable", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
        },
      });

      patch.enable();

      // Verify patch is working
      expect(mockWorkspaceLeaf.getDisplayText()).toBe("Test Label");

      patch.disable();

      // After disable, should use original method
      expect(mockWorkspaceLeaf.getDisplayText()).toBe("original-filename");
    });

    it("should not error when disabling without enabling", () => {
      expect(() => patch.disable()).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should disable patch on cleanup", () => {
      patch.enable();
      patch.cleanup();

      // Calling enable again should work (indicates cleanup was successful)
      expect(() => patch.enable()).not.toThrow();
    });
  });

  describe("getDisplayText patching", () => {
    it("should return asset label when available", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
        },
      });

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("Test Label");
    });

    it("should fallback to prototype label", () => {
      const mockFile = new TFile();
      const mockPrototypeFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockPrototypeFile, "extension", { value: "md" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache
        .mockReturnValueOnce({
          frontmatter: {
            exo__Asset_prototype: "[[prototype-path]]",
          },
        })
        .mockReturnValueOnce({
          frontmatter: {
            exo__Asset_label: "Prototype Label",
          },
        });
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockPrototypeFile);

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("Prototype Label");
    });

    it("should fallback to original filename when no label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {},
      });

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("original-filename");
    });

    it("should not change non-markdown files", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "png" });
      Object.defineProperty(mockFile, "basename", { value: "image" });
      mockMarkdownView.file = mockFile;

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("original-filename");
    });

    it("should fallback to original when file is null", () => {
      mockMarkdownView.file = null;

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("original-filename");
    });

    it("should trim whitespace from label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "  Trimmed Label  ",
        },
      });

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("Trimmed Label");
    });

    it("should fallback to original for empty label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "   ",
        },
      });

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("original-filename");
    });
  });

  describe("metadata change handling", () => {
    it("should update tab title when metadata changes", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "path", { value: "test-file.md" });
      mockMarkdownView.file = mockFile;

      // Initial label
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Initial Label",
        },
      });

      patch.enable();

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("Initial Label");

      // Update to new label
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Updated Label",
        },
      });

      // Simulate metadata change by getting the callback and calling it
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      if (metadataCallback) {
        metadataCallback(mockFile);
      }

      expect(mockWorkspaceLeaf.getDisplayText()).toBe("Updated Label");
    });

    it("should ignore metadata changes for non-markdown files", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "png" });
      Object.defineProperty(mockFile, "path", { value: "image.png" });

      patch.enable();

      // Simulate metadata change for non-markdown file
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      // Should not throw
      expect(() => {
        if (metadataCallback) {
          metadataCallback(mockFile);
        }
      }).not.toThrow();
    });
  });
});
