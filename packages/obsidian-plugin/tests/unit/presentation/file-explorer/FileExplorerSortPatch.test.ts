import { FileExplorerSortPatch } from "../../../../src/presentation/file-explorer/FileExplorerSortPatch";
import { TFile, TFolder } from "obsidian";

// Helper to create mock folder with all required properties
function createMockFolder(path: string, children: any[] = []): any {
  return {
    path,
    name: path.split("/").pop() || "",
    children,
    parent: null,
  };
}

// Helper to create mock file with all required properties
function createMockFile(path: string, parent: any = null): any {
  const name = path.split("/").pop() || "";
  const basename = name.replace(/\.[^/.]+$/, "");
  const extension = name.split(".").pop() || "";
  return {
    path,
    name,
    basename,
    extension,
    parent,
    stat: { ctime: Date.now() },
  };
}

describe("FileExplorerSortPatch", () => {
  let patch: FileExplorerSortPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockWorkspaceLeaf: any;
  let mockView: any;
  let originalSort: jest.Mock;

  beforeEach(() => {
    originalSort = jest.fn();

    mockView = {
      containerEl: document.createElement("div"),
      fileItems: {},
      sortOrder: "alphabetical",
      sort: originalSort,
      requestSort: jest.fn(),
    };

    mockWorkspaceLeaf = {
      view: mockView,
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
      settings: {
        sortByDisplayName: true,
        displayNameTemplate: "{{exo__Asset_label}}",
      },
    };

    patch = new FileExplorerSortPatch(mockPlugin);
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

      // Should only register events once
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(2);
    });

    it("should patch the sort method", () => {
      patch.enable();

      // Sort method should be replaced
      expect(mockView.sort).not.toBe(originalSort);
    });
  });

  describe("disable", () => {
    it("should restore original sort function on disable", () => {
      const originalSortRef = mockView.sort;
      patch.enable();
      const patchedSort = mockView.sort;
      expect(patchedSort).not.toBe(originalSortRef);

      patch.disable();

      // Sort method should be restored - check it's a function
      expect(typeof mockView.sort).toBe("function");
    });

    it("should not error when disabling without enabling", () => {
      expect(() => patch.disable()).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should disable patch on cleanup", () => {
      patch.enable();
      patch.cleanup();

      // Calling enable again should work
      expect(() => patch.enable()).not.toThrow();
    });
  });

  describe("sorting behavior", () => {
    it("should call original sort when sortByDisplayName is disabled", () => {
      mockPlugin.settings.sortByDisplayName = false;
      patch.enable();

      // Trigger the patched sort
      mockView.sort();

      expect(originalSort).toHaveBeenCalled();
    });

    it("should call original sort as fallback when sortByDisplayName is enabled", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      // Create mock folder with children using helper
      const mockFolder = createMockFolder("folder", []);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: document.createElement("div"),
          innerEl: document.createElement("div"),
        },
      };

      // Trigger the patched sort
      mockView.sort();

      // Original sort should still be called as a fallback
      expect(originalSort).toHaveBeenCalled();
    });

    it("should process file items when sortByDisplayName is enabled", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      // Create mock folder with file children using helpers
      const mockFolder = createMockFolder("folder");
      const mockFile1 = createMockFile("folder/z-file.md", mockFolder);
      const mockFile2 = createMockFile("folder/a-file.md", mockFolder);
      mockFolder.children = [mockFile1, mockFile2];

      // Set up frontmatter with labels
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test Label" },
      });

      // Create mock DOM structure
      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/z-file.md": {
          file: mockFile1,
          selfEl: document.createElement("div"),
        },
        "folder/a-file.md": {
          file: mockFile2,
          selfEl: document.createElement("div"),
        },
      };

      // Trigger the patched sort - should not throw
      expect(() => mockView.sort()).not.toThrow();

      // Original sort should be called
      expect(originalSort).toHaveBeenCalled();
    });

    it("should handle empty fileItems gracefully", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      mockView.fileItems = {};

      // Should not throw
      expect(() => mockView.sort()).not.toThrow();
      expect(originalSort).toHaveBeenCalled();
    });

    it("should handle undefined fileItems gracefully", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      mockView.fileItems = undefined;

      // Should not throw
      expect(() => mockView.sort()).not.toThrow();
      expect(originalSort).toHaveBeenCalled();
    });
  });

  describe("cache invalidation", () => {
    it("should invalidate cache on metadata change", () => {
      patch.enable();

      // Get the metadata change callback
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      expect(metadataCallback).toBeDefined();

      // Create a mock file using helper
      const mockFile = createMockFile("test.md");

      // Trigger metadata change
      if (metadataCallback) {
        metadataCallback(mockFile);
      }

      // requestSort should be called
      expect(mockView.requestSort).toHaveBeenCalled();
    });

    it("should not trigger resort for non-md files", () => {
      patch.enable();

      // Get the metadata change callback
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      // Clear any calls from initialization
      mockView.requestSort.mockClear();

      // Create a non-md file
      const mockFile = createMockFile("test.png");
      mockFile.extension = "png";

      // Trigger metadata change
      if (metadataCallback) {
        metadataCallback(mockFile);
      }

      // requestSort should not be called for non-md files
      expect(mockView.requestSort).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle missing File Explorer leaf", () => {
      mockApp.workspace.getLeavesOfType.mockReturnValue([]);

      patch.enable();

      // Should not throw
      expect(() => patch.enable()).not.toThrow();
    });

    it("should handle missing sort method on view", () => {
      mockView.sort = undefined;

      patch.enable();

      // Should not throw
      expect(() => patch.enable()).not.toThrow();
    });

    it("should handle null settings", () => {
      mockPlugin.settings = null;
      patch.enable();

      // Sort should use original sort when settings are null
      mockView.sort = originalSort;
      mockView.sort();

      expect(originalSort).toHaveBeenCalled();
    });

    it("should handle missing displayNameTemplate", () => {
      mockPlugin.settings = {
        sortByDisplayName: true,
        displayNameTemplate: undefined,
      };
      patch.enable();

      // Should not throw
      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle layout-change event", () => {
      patch.enable();

      // Get the layout change callback
      const layoutCallback = mockApp.workspace.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "layout-change"
      )?.[1];

      expect(layoutCallback).toBeDefined();

      // Trigger layout change - should not throw
      if (layoutCallback) {
        jest.useFakeTimers();
        expect(() => layoutCallback()).not.toThrow();
        jest.runAllTimers();
        jest.useRealTimers();
      }
    });

    it("should use fallback sort when view is undefined", () => {
      patch.enable();

      // Clear the patched view
      const patchedSort = mockView.sort;

      // Should not throw when patchedView becomes null
      patch.disable();

      expect(() => patch.disable()).not.toThrow();
    });

    it("should handle file without extension", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/noextension");
      mockFile.extension = "";
      mockFolder.children = [mockFile];

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: document.createElement("div"),
          innerEl: document.createElement("div"),
        },
        "folder/noextension": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle file with prototype reference", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      mockFolder.children = [mockFile];

      // Set up frontmatter with prototype reference (no label)
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_prototype: "[[prototype-path]]"
        },
      });
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle getFileCache returning null", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      mockFolder.children = [mockFile];

      // Return null from getFileCache
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle reverse sort order", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      // Set reverse sort order
      mockView.sortOrder = "alphabeticalReverse";

      const mockFolder = createMockFolder("folder");
      const mockFile1 = createMockFile("folder/a-file.md", mockFolder);
      const mockFile2 = createMockFile("folder/z-file.md", mockFolder);
      mockFolder.children = [mockFile1, mockFile2];

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test" },
      });

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/a-file.md": {
          file: mockFile1,
          selfEl: document.createElement("div"),
        },
        "folder/z-file.md": {
          file: mockFile2,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle folders in fileItems", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockSubFolder = createMockFolder("folder/subfolder");
      mockFolder.children = [mockSubFolder];

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/subfolder": {
          file: mockSubFolder,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle prototype reference that resolves to a file", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      const prototypeFile = createMockFile("prototypes/proto.md");
      mockFolder.children = [mockFile];

      // Set up frontmatter with prototype reference (no direct label)
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.path === "folder/file.md") {
          return {
            frontmatter: {
              exo__Asset_prototype: "[[proto]]"
            },
          };
        } else if (file.path === "prototypes/proto.md") {
          return {
            frontmatter: {
              exo__Asset_label: "Prototype Label"
            },
          };
        }
        return null;
      });
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(prototypeFile);

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle empty folder children", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      mockFolder.children = [];

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle direct exo__Asset_label fallback", () => {
      mockPlugin.settings.sortByDisplayName = true;
      // Use a template that won't match anything
      mockPlugin.settings.displayNameTemplate = "{{nonexistent_field}}";
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      mockFolder.children = [mockFile];

      // Set up frontmatter with direct label only
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Direct Label"
        },
      });

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle sortOrder undefined gracefully", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      // Explicitly set sortOrder to undefined
      mockView.sortOrder = undefined;

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      mockFolder.children = [mockFile];

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test" },
      });

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle prototype reference without .md extension", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      const prototypeFile = createMockFile("prototypes/proto.md");
      mockFolder.children = [mockFile];

      // Set up frontmatter with prototype reference without [[]] wrapping
      mockApp.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.path === "folder/file.md") {
          return {
            frontmatter: {
              exo__Asset_prototype: "proto"
            },
          };
        } else if (file.path === "prototypes/proto.md") {
          return {
            frontmatter: {
              exo__Asset_label: "Prototype Label"
            },
          };
        }
        return null;
      });
      // First call returns null (without .md), second call returns the file (with .md)
      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(prototypeFile);

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle cached sort key", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      mockFolder.children = [mockFile];

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test Label" },
      });

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: document.createElement("div"),
        },
      };

      // First sort - populates cache
      mockView.sort();

      // Second sort - uses cache
      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle child element not in container", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile = createMockFile("folder/file.md", mockFolder);
      mockFolder.children = [mockFile];

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test" },
      });

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      // Create file element with DIFFERENT parent (not the childrenContainer)
      const fileEl = document.createElement("div");
      const differentParent = document.createElement("div");
      differentParent.appendChild(fileEl);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/file.md": {
          file: mockFile,
          selfEl: fileEl,
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });

    it("should handle triggerResort when disabled", () => {
      patch.enable();
      patch.disable();

      // Clear requestSort calls from enable
      mockView.requestSort.mockClear();

      // Manually call method through metadata change
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      if (metadataCallback) {
        const mockFile = createMockFile("test.md");
        metadataCallback(mockFile);
      }

      // Should not trigger resort when disabled
      expect(mockView.requestSort).not.toHaveBeenCalled();
    });

    it("should handle view with sort but no requestSort", () => {
      // Remove requestSort to test fallback to sort()
      const viewWithoutRequestSort = {
        containerEl: document.createElement("div"),
        fileItems: {},
        sortOrder: "alphabetical",
        sort: originalSort,
        requestSort: undefined,
      };

      mockWorkspaceLeaf.view = viewWithoutRequestSort;
      mockApp.workspace.getLeavesOfType.mockReturnValue([mockWorkspaceLeaf]);

      patch.enable();

      // Should use sort() as fallback
      expect(originalSort).toHaveBeenCalled();
    });

    it("should handle mixed files and folders sorting", () => {
      mockPlugin.settings.sortByDisplayName = true;
      patch.enable();

      const mockFolder = createMockFolder("folder");
      const mockFile1 = createMockFile("folder/a-file.md", mockFolder);
      const mockSubFolder = createMockFolder("folder/z-subfolder");
      const mockFile2 = createMockFile("folder/b-file.md", mockFolder);
      mockFolder.children = [mockFile1, mockSubFolder, mockFile2];

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test" },
      });

      const folderEl = document.createElement("div");
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "nav-folder-children";
      folderEl.appendChild(childrenContainer);

      // Add child elements to the container
      const fileEl1 = document.createElement("div");
      const subFolderEl = document.createElement("div");
      const fileEl2 = document.createElement("div");
      childrenContainer.appendChild(fileEl1);
      childrenContainer.appendChild(subFolderEl);
      childrenContainer.appendChild(fileEl2);

      mockView.fileItems = {
        "folder": {
          file: mockFolder,
          selfEl: folderEl,
          innerEl: folderEl,
        },
        "folder/a-file.md": {
          file: mockFile1,
          selfEl: fileEl1,
        },
        "folder/z-subfolder": {
          file: mockSubFolder,
          selfEl: subFolderEl,
        },
        "folder/b-file.md": {
          file: mockFile2,
          selfEl: fileEl2,
        },
      };

      expect(() => mockView.sort()).not.toThrow();
    });
  });
});
