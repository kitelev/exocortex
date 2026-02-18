import { GraphViewPatch } from "../../../../src/presentation/graph-view/GraphViewPatch";
import { TFile } from "obsidian";

describe("GraphViewPatch", () => {
  let patch: GraphViewPatch;
  let mockPlugin: ReturnType<typeof createMockPlugin>;
  let mockApp: ReturnType<typeof createMockApp>;
  let mockGraphLeaf: ReturnType<typeof createMockGraphLeaf>;
  let mockGraphView: ReturnType<typeof createMockGraphView>;
  let mockNode: ReturnType<typeof createMockNode>["node"];
  let originalGetDisplayText: jest.Mock;

  function createMockNode() {
    const getDisplayText = jest.fn().mockReturnValue("original-filename.md");
    const nodePrototype = {
      getDisplayText,
    };
    const node = Object.create(nodePrototype);
    node.id = "test-file.md";
    node.text = { text: "original-filename.md" };
    return { node, prototype: nodePrototype, getDisplayText };
  }

  function createMockGraphView() {
    return {
      renderer: {
        nodes: [] as ReturnType<typeof createMockNode>["node"][],
        changed: jest.fn(),
        onIframeLoad: jest.fn(),
      },
    };
  }

  function createMockGraphLeaf() {
    return {
      view: createMockGraphView(),
    };
  }

  function createMockApp() {
    return {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([]),
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
  }

  function createMockPlugin() {
    const app = createMockApp();
    return {
      app,
      registerEvent: jest.fn(),
      settings: {
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
        },
      },
    };
  }

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    mockApp = mockPlugin.app;

    const nodeData = createMockNode();
    mockNode = nodeData.node;
    originalGetDisplayText = nodeData.getDisplayText;

    mockGraphView = createMockGraphView();
    mockGraphView.renderer.nodes = [mockNode];

    mockGraphLeaf = {
      view: mockGraphView,
    };

    mockApp.workspace.getLeavesOfType = jest.fn().mockImplementation((type: string) => {
      if (type === "graph" || type === "localgraph") {
        return [mockGraphLeaf];
      }
      return [];
    });

    patch = new GraphViewPatch(mockPlugin as never);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("enable", () => {
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

      // Should only register metadata event once
      expect(mockApp.metadataCache.on).toHaveBeenCalledTimes(1);
    });

    it("should patch graph views when nodes are available", () => {
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

    it("should bind to layout-change when no graph views available", () => {
      // No graph views available yet
      mockApp.workspace.getLeavesOfType = jest.fn().mockReturnValue([]);

      patch.enable();

      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function)
      );
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

  describe("getDisplayText patching via FunctionReplacer", () => {
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

      // Use mockImplementation to handle multiple calls with different returns
      mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => {
        if (file === mockFile) {
          return {
            frontmatter: {
              exo__Asset_prototype: "[[prototype-path]]",
            },
          };
        }
        if (file === mockPrototypeFile) {
          return {
            frontmatter: {
              exo__Asset_label: "Prototype Label",
            },
          };
        }
        return null;
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
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const nodeWithoutId = Object.create(nodePrototype);

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

  describe("FunctionReplacer prototype patching", () => {
    it("should patch prototype once for multiple nodes", () => {
      // Create multiple nodes with same prototype
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const node1 = Object.create(nodePrototype);
      node1.id = "file1.md";
      node1.text = { text: "file1.md" };
      const node2 = Object.create(nodePrototype);
      node2.id = "file2.md";
      node2.text = { text: "file2.md" };

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
    });

    it("should preserve this context in replacement", () => {
      const nodePrototype = {
        getDisplayText: function (this: { id: string }) {
          return this.id;
        },
      };
      const node = Object.create(nodePrototype);
      node.id = "context-test.md";
      node.text = { text: "context-test.md" };

      mockGraphView.renderer.nodes = [node];

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "context-test" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Context Label" },
      });

      patch.enable();

      // Patched method should access correct node's id via this context
      expect(node.getDisplayText()).toBe("Context Label");
    });
  });

  describe("Issue #2151: node.text.text update and renderer refresh", () => {
    it("should update node.text.text after patching prototype", () => {
      // Create a mock node with text property (like Obsidian's Graph View nodes)
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const mockNodeWithText = Object.create(nodePrototype);
      mockNodeWithText.id = "test-file.md";
      mockNodeWithText.text = { text: "original-filename.md" };

      mockGraphView.renderer = {
        nodes: [mockNodeWithText],
        changed: jest.fn(),
        onIframeLoad: jest.fn(),
      };

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "My Custom Label" },
      });

      patch.enable();

      // The node.text.text should be updated with the label
      expect(mockNodeWithText.text.text).toBe("My Custom Label");
    });

    it("should call renderer.onIframeLoad() for more reliable refresh", () => {
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const mockNodeWithText = Object.create(nodePrototype);
      mockNodeWithText.id = "test-file.md";
      mockNodeWithText.text = { text: "original-filename.md" };

      const mockOnIframeLoad = jest.fn();
      mockGraphView.renderer = {
        nodes: [mockNodeWithText],
        changed: jest.fn(),
        onIframeLoad: mockOnIframeLoad,
      };

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "My Custom Label" },
      });

      patch.enable();

      // renderer.onIframeLoad() should be called for more reliable refresh
      expect(mockOnIframeLoad).toHaveBeenCalled();
    });

    it("should fallback to renderer.changed() when onIframeLoad not available", () => {
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const mockNodeWithText = Object.create(nodePrototype);
      mockNodeWithText.id = "test-file.md";
      mockNodeWithText.text = { text: "original-filename.md" };

      const mockChanged = jest.fn();
      mockGraphView.renderer = {
        nodes: [mockNodeWithText],
        changed: mockChanged,
        // onIframeLoad not available
      };

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "My Custom Label" },
      });

      patch.enable();

      // renderer.changed() should be called as fallback
      expect(mockChanged).toHaveBeenCalled();
    });

    it("should update multiple nodes' text.text values", () => {
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const node1 = Object.create(nodePrototype);
      node1.id = "file1.md";
      node1.text = { text: "file1.md" };

      const node2 = Object.create(nodePrototype);
      node2.id = "file2.md";
      node2.text = { text: "file2.md" };

      mockGraphView.renderer = {
        nodes: [node1, node2],
        changed: jest.fn(),
        onIframeLoad: jest.fn(),
      };

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Updated Label" },
      });

      patch.enable();

      // Both nodes' text should be updated
      expect(node1.text.text).toBe("Updated Label");
      expect(node2.text.text).toBe("Updated Label");
    });

    it("should restore node.text.text to original on disable", () => {
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const mockNodeWithText = Object.create(nodePrototype);
      mockNodeWithText.id = "test-file.md";
      mockNodeWithText.text = { text: "original-filename.md" };

      const mockChanged = jest.fn();
      mockGraphView.renderer = {
        nodes: [mockNodeWithText],
        changed: mockChanged,
        onIframeLoad: jest.fn(),
      };

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "My Custom Label" },
      });

      patch.enable();
      expect(mockNodeWithText.text.text).toBe("My Custom Label");

      patch.disable();
      // After disable, text should be restored to original
      expect(mockNodeWithText.text.text).toBe("original-filename.md");
    });

    it("should handle nodes without text property gracefully", () => {
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const nodeWithoutText = Object.create(nodePrototype);
      nodeWithoutText.id = "test-file.md";
      // No text property

      mockGraphView.renderer = {
        nodes: [nodeWithoutText],
        changed: jest.fn(),
        onIframeLoad: jest.fn(),
      };

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "My Custom Label" },
      });

      // Should not throw when node doesn't have text property
      expect(() => patch.enable()).not.toThrow();
    });

    it("should refresh node.text.text when metadata changes", () => {
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const mockNodeWithText = Object.create(nodePrototype);
      mockNodeWithText.id = "test-file.md";
      mockNodeWithText.text = { text: "original-filename.md" };

      mockGraphView.renderer = {
        nodes: [mockNodeWithText],
        changed: jest.fn(),
        onIframeLoad: jest.fn(),
      };

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "path", { value: "test-file.md" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      // Initial label
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Initial Label" },
      });

      patch.enable();
      expect(mockNodeWithText.text.text).toBe("Initial Label");

      // Update the label
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Updated Label" },
      });

      // Simulate metadata change
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      if (metadataCallback) {
        metadataCallback(mockFile);
      }

      // The node.text.text should be updated with new label
      expect(mockNodeWithText.text.text).toBe("Updated Label");
    });
  });

  describe("Issue #2157: FunctionReplacer lifecycle and background init", () => {
    it("should use FunctionReplacer pattern for type-safe method wrapping", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test Label" },
      });

      patch.enable();

      // FunctionReplacer should patch the prototype's getDisplayText
      expect(mockNode.getDisplayText()).toBe("Test Label");

      patch.disable();

      // FunctionReplacer should restore original method
      expect(mockNode.getDisplayText()).toBe("original-filename.md");
    });

    it("should run background init when views exist but no nodes yet", () => {
      jest.useFakeTimers();

      // Graph view exists but has no nodes initially
      mockGraphView.renderer.nodes = [];

      // Enable the patch - should trigger background init (not layout-change bind)
      patch.enable();

      // Now add nodes before timeout fires
      const nodePrototype = {
        getDisplayText: originalGetDisplayText,
      };
      const node = Object.create(nodePrototype);
      node.id = "test-file.md";
      node.text = { text: "test-file.md" };
      mockGraphView.renderer.nodes = [node];

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Delayed Label" },
      });

      // Advance timers to trigger background init
      jest.advanceTimersByTime(200);

      // Node should now be patched via background init
      expect(node.getDisplayText()).toBe("Delayed Label");
    });

    it("should clear pending timeout on disable", () => {
      jest.useFakeTimers();

      // Graph view exists but has no nodes - will trigger background init
      mockGraphView.renderer.nodes = [];

      patch.enable();

      // Disable before timeout fires
      patch.disable();

      // Advance timers - should not throw or cause issues
      jest.advanceTimersByTime(300);

      expect(() => jest.advanceTimersByTime(100)).not.toThrow();
    });

    it("should handle both graph and localgraph views", () => {
      const globalGraphLeaf = {
        view: {
          renderer: {
            nodes: [mockNode],
            changed: jest.fn(),
            onIframeLoad: jest.fn(),
          },
        },
      };

      const localNodePrototype = {
        getDisplayText: jest.fn().mockReturnValue("local-original.md"),
      };
      const localNode = Object.create(localNodePrototype);
      localNode.id = "local-file.md";
      localNode.text = { text: "local-original.md" };

      const localGraphLeaf = {
        view: {
          renderer: {
            nodes: [localNode],
            changed: jest.fn(),
            onIframeLoad: jest.fn(),
          },
        },
      };

      mockApp.workspace.getLeavesOfType = jest.fn().mockImplementation((type: string) => {
        if (type === "graph") return [globalGraphLeaf];
        if (type === "localgraph") return [localGraphLeaf];
        return [];
      });

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test" });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Unified Label" },
      });

      patch.enable();

      // Both views should have onIframeLoad called for refresh
      expect(globalGraphLeaf.view.renderer.onIframeLoad).toHaveBeenCalled();
      expect(localGraphLeaf.view.renderer.onIframeLoad).toHaveBeenCalled();
    });
  });
});
