import { FileExplorerPatch } from "../../../../src/presentation/file-explorer/FileExplorerPatch";
import { TFile, WorkspaceLeaf, Plugin, CachedMetadata } from "obsidian";

describe("FileExplorerPatch", () => {
  let patch: FileExplorerPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockWorkspaceLeaf: any;
  let mockContainerEl: HTMLElement;

  beforeEach(() => {
    // Create mock DOM elements
    mockContainerEl = document.createElement("div");

    mockWorkspaceLeaf = {
      view: {
        containerEl: mockContainerEl,
      },
    };

    mockApp = {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([mockWorkspaceLeaf]),
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

    patch = new FileExplorerPatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
  });

  describe("enable", () => {
    it("should register metadata change event on enable", () => {
      patch.enable();

      expect(mockPlugin.registerEvent).toHaveBeenCalled();
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "changed",
        expect.any(Function)
      );
    });

    it("should register layout change event on enable", () => {
      patch.enable();

      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function)
      );
    });

    it("should not double-enable", () => {
      patch.enable();
      patch.enable();

      // Should only register events once (2 calls: metadata + layout)
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe("disable", () => {
    it("should restore original filenames on disable", () => {
      // Set up a patched file item
      const fileItem = document.createElement("div");
      fileItem.className = "tree-item nav-file";

      const titleWrapper = document.createElement("div");
      titleWrapper.className = "nav-file-title";
      titleWrapper.setAttribute("data-path", "test-file.md");

      const titleContent = document.createElement("div");
      titleContent.className = "nav-file-title-content";
      titleContent.textContent = "Asset Label";
      titleContent.setAttribute("data-original-name", "test-file");

      titleWrapper.appendChild(titleContent);
      fileItem.appendChild(titleWrapper);
      mockContainerEl.appendChild(fileItem);

      patch.enable();
      patch.disable();

      expect(titleContent.textContent).toBe("test-file");
      expect(titleContent.hasAttribute("data-original-name")).toBe(false);
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

  describe("getAssetLabel (via patching)", () => {
    it("should get label from frontmatter", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });

      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
        },
      });

      // Create file item in DOM
      const fileItem = document.createElement("div");
      fileItem.className = "tree-item nav-file";

      const titleWrapper = document.createElement("div");
      titleWrapper.className = "nav-file-title";
      titleWrapper.setAttribute("data-path", "test-file.md");

      const titleContent = document.createElement("div");
      titleContent.className = "nav-file-title-content";
      titleContent.textContent = "test-file";

      titleWrapper.appendChild(titleContent);
      fileItem.appendChild(titleWrapper);
      mockContainerEl.appendChild(fileItem);

      patch.enable();

      expect(titleContent.textContent).toBe("Test Label");
      expect(titleWrapper.getAttribute("aria-label")).toContain("Test Label");
      expect(titleWrapper.getAttribute("aria-label")).toContain("test-file.md");
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

      // Create file item in DOM
      const fileItem = document.createElement("div");
      fileItem.className = "tree-item nav-file";

      const titleWrapper = document.createElement("div");
      titleWrapper.className = "nav-file-title";
      titleWrapper.setAttribute("data-path", "test-file.md");

      const titleContent = document.createElement("div");
      titleContent.className = "nav-file-title-content";
      titleContent.textContent = "test-file";

      titleWrapper.appendChild(titleContent);
      fileItem.appendChild(titleWrapper);
      mockContainerEl.appendChild(fileItem);

      patch.enable();

      expect(titleContent.textContent).toBe("Prototype Label");
    });

    it("should not change non-markdown files", () => {
      const mockFile = {
        extension: "png",
        basename: "image",
      };

      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      // Create file item in DOM
      const fileItem = document.createElement("div");
      fileItem.className = "tree-item nav-file";

      const titleWrapper = document.createElement("div");
      titleWrapper.className = "nav-file-title";
      titleWrapper.setAttribute("data-path", "image.png");

      const titleContent = document.createElement("div");
      titleContent.className = "nav-file-title-content";
      titleContent.textContent = "image";

      titleWrapper.appendChild(titleContent);
      fileItem.appendChild(titleWrapper);
      mockContainerEl.appendChild(fileItem);

      patch.enable();

      expect(titleContent.textContent).toBe("image");
    });

    it("should not change files without label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "no-label" });

      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {},
      });

      // Create file item in DOM
      const fileItem = document.createElement("div");
      fileItem.className = "tree-item nav-file";

      const titleWrapper = document.createElement("div");
      titleWrapper.className = "nav-file-title";
      titleWrapper.setAttribute("data-path", "no-label.md");

      const titleContent = document.createElement("div");
      titleContent.className = "nav-file-title-content";
      titleContent.textContent = "no-label";

      titleWrapper.appendChild(titleContent);
      fileItem.appendChild(titleWrapper);
      mockContainerEl.appendChild(fileItem);

      patch.enable();

      expect(titleContent.textContent).toBe("no-label");
    });
  });

  describe("metadata change handling", () => {
    it("should update label when metadata changes", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "path", { value: "test-file.md" });

      // Create file item in DOM
      const fileItem = document.createElement("div");
      fileItem.className = "tree-item nav-file";

      const titleWrapper = document.createElement("div");
      titleWrapper.className = "nav-file-title";
      titleWrapper.setAttribute("data-path", "test-file.md");

      const titleContent = document.createElement("div");
      titleContent.className = "nav-file-title-content";
      titleContent.textContent = "Old Label";
      titleContent.setAttribute("data-original-name", "test-file");

      titleWrapper.appendChild(titleContent);
      fileItem.appendChild(titleWrapper);
      mockContainerEl.appendChild(fileItem);

      // Set up mock to return new label
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "New Label",
        },
      });

      patch.enable();

      // Simulate metadata change by getting the callback and calling it
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      if (metadataCallback) {
        metadataCallback(mockFile);
      }

      expect(titleContent.textContent).toBe("New Label");
    });
  });
});
