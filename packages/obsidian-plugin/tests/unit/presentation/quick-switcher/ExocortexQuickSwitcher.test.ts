import { ExocortexQuickSwitcher } from "../../../../src/presentation/quick-switcher/ExocortexQuickSwitcher";
import { TFile } from "obsidian";

describe("ExocortexQuickSwitcher", () => {
  let quickSwitcher: ExocortexQuickSwitcher;
  let mockApp: ReturnType<typeof createMockApp>;

  function createMockFile(basename: string, path: string, frontmatter?: Record<string, unknown>) {
    const file = new TFile();
    Object.defineProperty(file, "basename", { value: basename });
    Object.defineProperty(file, "path", { value: path });
    Object.defineProperty(file, "stat", {
      value: { ctime: Date.now() },
    });
    return { file, frontmatter };
  }

  function createMockApp() {
    const files: Array<ReturnType<typeof createMockFile>> = [];

    return {
      vault: {
        getMarkdownFiles: jest.fn().mockImplementation(() => files.map((f) => f.file)),
        getAbstractFileByPath: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn().mockImplementation((file: TFile) => {
          const found = files.find((f) => f.file === file);
          if (found?.frontmatter) {
            return { frontmatter: found.frontmatter };
          }
          return null;
        }),
        getFirstLinkpathDest: jest.fn(),
      },
      workspace: {
        openLinkText: jest.fn(),
      },
      addFiles: (newFiles: Array<ReturnType<typeof createMockFile>>) => {
        files.push(...newFiles);
      },
    };
  }

  const defaultDisplayNameSettings = {
    defaultTemplate: "{{exo__Asset_label}}",
    classTemplates: {},
  };

  beforeEach(() => {
    mockApp = createMockApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with displayNameSettings", () => {
      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      expect(quickSwitcher).toBeInstanceOf(ExocortexQuickSwitcher);
    });
  });

  describe("getItems", () => {
    it("should return all markdown files", () => {
      const fileData = [
        createMockFile("file1", "file1.md"),
        createMockFile("file2", "folder/file2.md"),
      ];
      mockApp.addFiles(fileData);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const items = quickSwitcher.getItems();

      expect(items).toHaveLength(2);
      expect(mockApp.vault.getMarkdownFiles).toHaveBeenCalled();
    });
  });

  describe("getItemText", () => {
    it("should return asset label when available", () => {
      const fileData = createMockFile("abc123-def456", "abc123-def456.md", {
        exo__Asset_label: "My Project",
      });
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const text = quickSwitcher.getItemText(fileData.file);

      expect(text).toBe("My Project");
    });

    it("should return basename when no label", () => {
      const fileData = createMockFile("abc123-def456", "abc123-def456.md");
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const text = quickSwitcher.getItemText(fileData.file);

      expect(text).toBe("abc123-def456");
    });

    it("should use prototype label when no direct label", () => {
      const prototypeFile = createMockFile(
        "prototype-123",
        "prototype-123.md",
        { exo__Asset_label: "Prototype Label" }
      );
      const fileData = createMockFile("instance-456", "instance-456.md", {
        exo__Asset_prototype: "[[prototype-123]]",
      });
      mockApp.addFiles([prototypeFile, fileData]);
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(
        prototypeFile.file
      );

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const text = quickSwitcher.getItemText(fileData.file);

      expect(text).toBe("Prototype Label");
    });

    it("should use class-specific template when configured", () => {
      const fileData = createMockFile("task-123", "task-123.md", {
        exo__Asset_label: "Fix Bug",
        exo__Instance_class: "ems__Task",
      });
      mockApp.addFiles([fileData]);

      const settingsWithClassTemplate = {
        defaultTemplate: "{{exo__Asset_label}} ({{exo__Instance_class}})",
        classTemplates: {
          ems__Task: "Task: {{exo__Asset_label}}",
        },
      };

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        settingsWithClassTemplate
      );

      const text = quickSwitcher.getItemText(fileData.file);

      expect(text).toBe("Task: Fix Bug");
    });
  });

  describe("renderSuggestion", () => {
    it("should create suggestion item with label", () => {
      const fileData = createMockFile("abc123", "abc123.md", {
        exo__Asset_label: "My Asset",
      });
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const el = document.createElement("div");
      const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
      quickSwitcher.renderSuggestion(match, el);

      expect(el.querySelector(".exocortex-quick-switcher-item")).toBeTruthy();
      expect(el.querySelector(".exocortex-quick-switcher-label")?.textContent).toBe(
        "My Asset"
      );
      // Should show path since label differs from basename
      expect(el.querySelector(".exocortex-quick-switcher-path")?.textContent).toBe(
        "abc123.md"
      );
    });

    it("should not show path when label matches basename", () => {
      const fileData = createMockFile("abc123", "abc123.md");
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const el = document.createElement("div");
      const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
      quickSwitcher.renderSuggestion(match, el);

      expect(el.querySelector(".exocortex-quick-switcher-label")?.textContent).toBe(
        "abc123"
      );
      // Should NOT show path since it matches the label
      expect(el.querySelector(".exocortex-quick-switcher-path")).toBeFalsy();
    });
  });

  describe("onChooseItem", () => {
    it("should open the selected file", () => {
      const fileData = createMockFile("abc123", "folder/abc123.md");
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      quickSwitcher.onChooseItem(fileData.file);

      expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
        "folder/abc123.md",
        ""
      );
    });
  });

  describe("label caching", () => {
    it("should cache labels for performance", () => {
      const fileData = createMockFile("abc123", "abc123.md", {
        exo__Asset_label: "Cached Label",
      });
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      // First call builds cache
      const text1 = quickSwitcher.getItemText(fileData.file);

      // Reset the mock to verify cache is used
      mockApp.metadataCache.getFileCache.mockClear();

      // Second call should use cache
      const text2 = quickSwitcher.getItemText(fileData.file);

      expect(text1).toBe("Cached Label");
      expect(text2).toBe("Cached Label");
      // getFileCache should not be called again for cached file
      expect(mockApp.metadataCache.getFileCache).not.toHaveBeenCalled();
    });
  });

  describe("Issue #2166: Search by label in Quick Switcher", () => {
    it("should allow searching by label instead of filename", () => {
      // Given an asset with UUID "abc123.md" and label "My Project"
      const fileData = createMockFile("abc123", "abc123.md", {
        exo__Asset_label: "My Project",
      });
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      // When I get the item text for this file
      const text = quickSwitcher.getItemText(fileData.file);

      // Then I should see "My Project" (the label)
      expect(text).toBe("My Project");
    });

    it("should allow selecting file by label to open original file", () => {
      // Given an asset with UUID "abc123.md" and label "My Project"
      const fileData = createMockFile("abc123", "abc123.md", {
        exo__Asset_label: "My Project",
      });
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      // When selecting the file
      quickSwitcher.onChooseItem(fileData.file);

      // Then it should open the original file "abc123.md"
      expect(mockApp.workspace.openLinkText).toHaveBeenCalledWith(
        "abc123.md",
        ""
      );
    });
  });
});
