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
    it("should include asset label in searchable text when available", () => {
      const fileData = createMockFile("abc123-def456", "abc123-def456.md", {
        exo__Asset_label: "My Project",
      });
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const text = quickSwitcher.getItemText(fileData.file);

      // getItemText now returns searchable text: label + UID
      expect(text).toContain("My Project");
      expect(text).toContain("abc123-def456");
    });

    it("should include basename in searchable text when no label", () => {
      const fileData = createMockFile("abc123-def456", "abc123-def456.md");
      mockApp.addFiles([fileData]);

      quickSwitcher = new ExocortexQuickSwitcher(
        mockApp as never,
        defaultDisplayNameSettings
      );

      const text = quickSwitcher.getItemText(fileData.file);

      // When no label, searchable text still contains basename
      expect(text).toContain("abc123-def456");
    });

    it("should include prototype label in searchable text when no direct label", () => {
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

      // Searchable text includes prototype label and UID
      expect(text).toContain("Prototype Label");
      expect(text).toContain("instance-456");
    });

    it("should include class-specific template in searchable text when configured", () => {
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

      // Searchable text includes formatted label and UID
      expect(text).toContain("Task: Fix Bug");
      expect(text).toContain("task-123");
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
      // No classes defined, so no secondary info shown
      expect(el.querySelector(".exocortex-quick-switcher-classes")).toBeFalsy();
    });

    it("should not show secondary info when label matches basename and no classes", () => {
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
      // No classes defined, no path shown
      expect(el.querySelector(".exocortex-quick-switcher-classes")).toBeFalsy();
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

      // Second call should still work
      const text2 = quickSwitcher.getItemText(fileData.file);

      // Both should contain the label (searchable text now includes label + UID)
      expect(text1).toContain("Cached Label");
      expect(text2).toContain("Cached Label");
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

      // Then the searchable text should include "My Project" (the label)
      expect(text).toContain("My Project");
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

  describe("Issue #2198: Enhanced Quick Switcher search and display", () => {
    describe("multi-field search (label + aliases + UID)", () => {
      it("should include aliases in searchable text", () => {
        // Given an asset with label and aliases
        const fileData = createMockFile("abc123-def456", "abc123-def456.md", {
          exo__Asset_label: "My Project",
          aliases: ["ProjectX", "Alpha Project"],
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When I get the item text for this file
        const text = quickSwitcher.getItemText(fileData.file);

        // Then it should contain label, aliases, and UID for search
        expect(text).toContain("My Project");
        expect(text).toContain("ProjectX");
        expect(text).toContain("Alpha Project");
        expect(text).toContain("abc123-def456");
      });

      it("should include UID in searchable text even when label exists", () => {
        // Given an asset with label
        const fileData = createMockFile("unique-uuid-12345", "unique-uuid-12345.md", {
          exo__Asset_label: "My Task",
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When I get the item text
        const text = quickSwitcher.getItemText(fileData.file);

        // Then it should contain both label and UID
        expect(text).toContain("My Task");
        expect(text).toContain("unique-uuid-12345");
      });

      it("should handle empty aliases array", () => {
        // Given an asset with empty aliases
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Project",
          aliases: [],
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When I get the item text
        const text = quickSwitcher.getItemText(fileData.file);

        // Then it should still work without errors
        expect(text).toContain("My Project");
        expect(text).toContain("abc123");
      });

      it("should handle missing aliases property", () => {
        // Given an asset without aliases
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Project",
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When I get the item text
        const text = quickSwitcher.getItemText(fileData.file);

        // Then it should contain label and UID
        expect(text).toContain("My Project");
        expect(text).toContain("abc123");
      });

      it("should handle single alias as string", () => {
        // Given an asset with a single alias (YAML may parse as string)
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Project",
          aliases: "SingleAlias",
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When I get the item text
        const text = quickSwitcher.getItemText(fileData.file);

        // Then it should handle string alias correctly
        expect(text).toContain("My Project");
        expect(text).toContain("SingleAlias");
      });
    });

    describe("class display instead of path", () => {
      it("should display class name instead of file path", () => {
        // Given an asset with a class IRI
        const fileData = createMockFile("abc123", "folder/abc123.md", {
          exo__Asset_label: "My Project",
          exo__Instance_class: ["https://example.org/ontology#ems__Project"],
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then it should show class name, not path
        const classEl = el.querySelector(".exocortex-quick-switcher-classes");
        expect(classEl?.textContent).toBe("ems__Project");
        // Path should not be shown
        expect(el.querySelector(".exocortex-quick-switcher-path")).toBeFalsy();
      });

      it("should display multiple classes", () => {
        // Given an asset with multiple classes
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Item",
          exo__Instance_class: [
            "https://example.org/ontology#ems__Task",
            "https://example.org/ontology#ims__Concept",
          ],
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then it should show all class names
        const classEl = el.querySelector(".exocortex-quick-switcher-classes");
        expect(classEl?.textContent).toContain("ems__Task");
        expect(classEl?.textContent).toContain("ims__Concept");
      });

      it("should handle class IRI without hash (slash separator)", () => {
        // Given an asset with a class IRI using slash separator
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Project",
          exo__Instance_class: ["https://example.org/ontology/ems__Project"],
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then it should extract class name correctly
        const classEl = el.querySelector(".exocortex-quick-switcher-classes");
        expect(classEl?.textContent).toBe("ems__Project");
      });

      it("should handle short class name without IRI prefix", () => {
        // Given an asset with short class name (no IRI)
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Task",
          exo__Instance_class: "ems__Task",
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then it should display the class name as-is
        const classEl = el.querySelector(".exocortex-quick-switcher-classes");
        expect(classEl?.textContent).toBe("ems__Task");
      });

      it("should handle empty class array", () => {
        // Given an asset with empty classes
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Item",
          exo__Instance_class: [],
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then no class element should be rendered
        const classEl = el.querySelector(".exocortex-quick-switcher-classes");
        expect(classEl).toBeFalsy();
      });

      it("should handle missing class property gracefully", () => {
        // Given an asset without classes
        const fileData = createMockFile("abc123", "abc123.md", {
          exo__Asset_label: "My Item",
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then no class element should be rendered
        const classEl = el.querySelector(".exocortex-quick-switcher-classes");
        expect(classEl).toBeFalsy();
      });

      it("should not display path when classes are available", () => {
        // Given an asset with label different from basename AND classes
        const fileData = createMockFile("abc123", "folder/subfolder/abc123.md", {
          exo__Asset_label: "My Project",
          exo__Instance_class: ["ems__Project"],
        });
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then classes should be shown, not path
        expect(el.querySelector(".exocortex-quick-switcher-classes")?.textContent).toBe("ems__Project");
        expect(el.querySelector(".exocortex-quick-switcher-path")).toBeFalsy();
      });

      it("should fallback to showing no secondary info when no classes and label equals basename", () => {
        // Given a file with no frontmatter
        const fileData = createMockFile("readme", "readme.md");
        mockApp.addFiles([fileData]);

        quickSwitcher = new ExocortexQuickSwitcher(
          mockApp as never,
          defaultDisplayNameSettings
        );

        // When rendering the suggestion
        const el = document.createElement("div");
        const match = { item: fileData.file, match: { score: 1, matches: [] as [number, number][] } };
        quickSwitcher.renderSuggestion(match, el);

        // Then label should be shown, but no secondary info
        expect(el.querySelector(".exocortex-quick-switcher-label")?.textContent).toBe("readme");
        expect(el.querySelector(".exocortex-quick-switcher-classes")).toBeFalsy();
        expect(el.querySelector(".exocortex-quick-switcher-path")).toBeFalsy();
      });
    });
  });
});
