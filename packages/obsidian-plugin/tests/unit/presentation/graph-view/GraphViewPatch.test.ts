import { GraphViewPatch } from "../../../../src/presentation/graph-view/GraphViewPatch";
import { TFile, WorkspaceLeaf } from "obsidian";

describe("GraphViewPatch", () => {
  let patch: GraphViewPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockGraphLeaf: any;
  let mockGraphView: any;
  let mockNode: any;
  let originalGetDisplayText: jest.Mock;

  beforeEach(() => {
    originalGetDisplayText = jest.fn().mockReturnValue("original-filename.md");

    // Create a mock node with a prototype chain
    const nodePrototype = {
      getDisplayText: originalGetDisplayText,
    };
    mockNode = Object.create(nodePrototype);
    mockNode.id = "test-file.md";

    mockGraphView = {
      renderer: {
        nodes: [mockNode],
      },
    };

    mockGraphLeaf = {
      view: mockGraphView,
    };

    mockApp = {
      workspace: {
        getLeavesOfType: jest.fn().mockImplementation((type: string) => {
          if (type === "graph" || type === "localgraph") {
            return [mockGraphLeaf];
          }
          return [];
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
      settings: {
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
          statusEmojis: {},
        },
      },
    };

    patch = new GraphViewPatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
  });

  describe("enable", () => {
    it("should register layout-change event on enable", () => {
      patch.enable();

      expect(mockPlugin.registerEvent).toHaveBeenCalled();
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

      // Should only register events once (2 calls: layout-change + metadata)
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(2);
    });

    it("should patch both graph and localgraph views", () => {
      patch.enable();

      // Both graph and localgraph should be queried
      expect(mockApp.workspace.getLeavesOfType).toHaveBeenCalledWith("graph");
      expect(mockApp.workspace.getLeavesOfType).toHaveBeenCalledWith("localgraph");
    });
  });

  describe("disable", () => {
    it("should restore original getDisplayText on disable", () => {
      // Setup file and metadata
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
        },
      });

      patch.enable();

      // Verify patch is working
      expect(mockNode.getDisplayText()).toBe("Test Label");

      patch.disable();

      // After disable, should use original method
      expect(mockNode.getDisplayText()).toBe("original-filename.md");
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
        },
      });

      patch.enable();

      expect(mockNode.getDisplayText()).toBe("Test Label");
    });

    it("should fallback to prototype label", () => {
      const mockFile = new TFile();
      const mockPrototypeFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockPrototypeFile, "extension", { value: "md" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

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

      expect(mockNode.getDisplayText()).toBe("Prototype Label");
    });

    it("should fallback to original filename when no label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {},
      });

      patch.enable();

      expect(mockNode.getDisplayText()).toBe("original-filename.md");
    });

    it("should not change non-markdown files", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "png" });
      Object.defineProperty(mockFile, "basename", { value: "image" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      patch.enable();

      expect(mockNode.getDisplayText()).toBe("original-filename.md");
    });

    it("should fallback to original when file is not found", () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      patch.enable();

      expect(mockNode.getDisplayText()).toBe("original-filename.md");
    });

    it("should trim whitespace from label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "  Trimmed Label  ",
        },
      });

      patch.enable();

      expect(mockNode.getDisplayText()).toBe("Trimmed Label");
    });

    it("should fallback to original for empty label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "   ",
        },
      });

      patch.enable();

      expect(mockNode.getDisplayText()).toBe("original-filename.md");
    });

    it("should fallback when node has no id", () => {
      const nodeWithoutId = Object.create({
        getDisplayText: originalGetDisplayText,
      });

      mockGraphView.renderer.nodes = [nodeWithoutId];

      patch.enable();

      expect(nodeWithoutId.getDisplayText()).toBe("original-filename.md");
    });
  });

  describe("metadata change handling", () => {
    it("should trigger re-patch when metadata changes", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "path", { value: "test-file.md" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Initial Label",
        },
      });

      patch.enable();

      // Simulate metadata change
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

  describe("missing graph renderer", () => {
    it("should handle missing renderer gracefully", () => {
      mockGraphLeaf.view = {};

      expect(() => patch.enable()).not.toThrow();
    });

    it("should handle missing nodes array gracefully", () => {
      mockGraphLeaf.view = { renderer: {} };

      expect(() => patch.enable()).not.toThrow();
    });

    it("should handle empty nodes array", () => {
      mockGraphLeaf.view = { renderer: { nodes: [] } };

      expect(() => patch.enable()).not.toThrow();
    });
  });

  describe("prototype patching", () => {
    it("should only patch prototype once for multiple nodes", () => {
      // Create multiple nodes with same prototype
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const node1 = Object.create(nodePrototype);
      node1.id = "file1.md";
      const node2 = Object.create(nodePrototype);
      node2.id = "file2.md";

      mockGraphView.renderer.nodes = [node1, node2];

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Label" },
      });

      patch.enable();

      // Both nodes should use the same patched prototype
      expect(node1.getDisplayText()).toBe("Label");
      expect(node2.getDisplayText()).toBe("Label");

      // The original method should still be stored
      expect(nodePrototype.nm_originalGetDisplayText).toBe(originalGetDisplayText);
    });
  });
});
