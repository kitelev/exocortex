import { WikilinkLabelSuggest } from "../../../../src/presentation/wikilink-suggest/WikilinkLabelSuggest";
import { TFile, Editor, EditorPosition } from "obsidian";

describe("WikilinkLabelSuggest", () => {
  let suggest: WikilinkLabelSuggest;
  let mockPlugin: ReturnType<typeof createMockPlugin>;
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

  function createMockEditor(line: string, cursorCh: number) {
    return {
      getLine: jest.fn().mockReturnValue(line),
      replaceRange: jest.fn(),
      setCursor: jest.fn(),
    } as unknown as Editor;
  }

  function createMockApp() {
    const files: Array<ReturnType<typeof createMockFile>> = [];

    return {
      vault: {
        getMarkdownFiles: jest.fn().mockImplementation(() => files.map((f) => f.file)),
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
      workspace: {},
      addFiles: (newFiles: Array<ReturnType<typeof createMockFile>>) => {
        files.push(...newFiles);
      },
    };
  }

  function createMockPlugin() {
    const app = createMockApp();
    return {
      app,
      settings: {
        showLabelsInWikilinkAutocomplete: true,
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
        },
      },
    };
  }

  const defaultDisplayNameSettings = {
    defaultTemplate: "{{exo__Asset_label}}",
    classTemplates: {},
  };

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    mockApp = mockPlugin.app;
    suggest = new WikilinkLabelSuggest(
      mockPlugin as never,
      defaultDisplayNameSettings
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("onTrigger", () => {
    it("should trigger on [[ pattern", () => {
      const editor = createMockEditor("Some text [[My", 14);
      const cursor: EditorPosition = { line: 0, ch: 14 };

      const result = suggest.onTrigger(cursor, editor, null);

      expect(result).not.toBeNull();
      expect(result?.query).toBe("My");
      expect(result?.start).toEqual({ line: 0, ch: 12 });
      expect(result?.end).toEqual(cursor);
    });

    it("should not trigger without [[", () => {
      const editor = createMockEditor("Some plain text", 15);
      const cursor: EditorPosition = { line: 0, ch: 15 };

      const result = suggest.onTrigger(cursor, editor, null);

      expect(result).toBeNull();
    });

    it("should not trigger when already closed ]]", () => {
      const editor = createMockEditor("Text [[link]] more", 13);
      const cursor: EditorPosition = { line: 0, ch: 13 };

      const result = suggest.onTrigger(cursor, editor, null);

      expect(result).toBeNull();
    });

    it("should not trigger when pipe | already exists", () => {
      const editor = createMockEditor("Text [[link|alias", 17);
      const cursor: EditorPosition = { line: 0, ch: 17 };

      const result = suggest.onTrigger(cursor, editor, null);

      expect(result).toBeNull();
    });

    it("should handle empty query after [[", () => {
      const editor = createMockEditor("Some text [[", 12);
      const cursor: EditorPosition = { line: 0, ch: 12 };

      const result = suggest.onTrigger(cursor, editor, null);

      expect(result).not.toBeNull();
      expect(result?.query).toBe("");
    });

    it("should not trigger when feature is disabled", () => {
      mockPlugin.settings.showLabelsInWikilinkAutocomplete = false;

      const editor = createMockEditor("Some text [[My", 14);
      const cursor: EditorPosition = { line: 0, ch: 14 };

      const result = suggest.onTrigger(cursor, editor, null);

      expect(result).toBeNull();
    });
  });

  describe("getSuggestions", () => {
    it("should return files matching label query", () => {
      const fileData = [
        createMockFile("abc123", "abc123.md", { exo__Asset_label: "My Task" }),
        createMockFile("def456", "def456.md", { exo__Asset_label: "My Project" }),
        createMockFile("ghi789", "ghi789.md", { exo__Asset_label: "Other Thing" }),
      ];
      mockApp.addFiles(fileData);

      const context = {
        query: "my",
        start: { line: 0, ch: 12 },
        end: { line: 0, ch: 14 },
      } as never;

      const suggestions = suggest.getSuggestions(context);

      expect(suggestions.length).toBe(2);
      expect(suggestions.some((s) => s.label === "My Task")).toBe(true);
      expect(suggestions.some((s) => s.label === "My Project")).toBe(true);
    });

    it("should match against filename when no label", () => {
      const fileData = [
        createMockFile("my-note", "my-note.md"),
        createMockFile("other-note", "other-note.md"),
      ];
      mockApp.addFiles(fileData);

      const context = {
        query: "my",
        start: { line: 0, ch: 12 },
        end: { line: 0, ch: 14 },
      } as never;

      const suggestions = suggest.getSuggestions(context);

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].label).toBe("my-note");
    });

    it("should match against path", () => {
      const fileData = [
        createMockFile("note", "projects/my-project/note.md"),
        createMockFile("other", "archive/other.md"),
      ];
      mockApp.addFiles(fileData);

      const context = {
        query: "project",
        start: { line: 0, ch: 12 },
        end: { line: 0, ch: 19 },
      } as never;

      const suggestions = suggest.getSuggestions(context);

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].file.path).toBe("projects/my-project/note.md");
    });

    it("should sort by relevance - exact match first", () => {
      const fileData = [
        createMockFile("task1", "task1.md", { exo__Asset_label: "My Task" }),
        createMockFile("task2", "task2.md", { exo__Asset_label: "Task" }),
        createMockFile("task3", "task3.md", { exo__Asset_label: "Another Task" }),
      ];
      mockApp.addFiles(fileData);

      const context = {
        query: "task",
        start: { line: 0, ch: 12 },
        end: { line: 0, ch: 16 },
      } as never;

      const suggestions = suggest.getSuggestions(context);

      // "Task" (exact match) should come first
      expect(suggestions[0].label).toBe("Task");
    });

    it("should limit results to 50", () => {
      const files = Array.from({ length: 100 }, (_, i) =>
        createMockFile(`file-${i}`, `file-${i}.md`, { exo__Asset_label: `Label ${i}` })
      );
      mockApp.addFiles(files);

      const context = {
        query: "label",
        start: { line: 0, ch: 12 },
        end: { line: 0, ch: 17 },
      } as never;

      const suggestions = suggest.getSuggestions(context);

      expect(suggestions.length).toBe(50);
    });
  });

  describe("renderSuggestion", () => {
    it("should render label and path", () => {
      const fileData = createMockFile("abc123", "folder/abc123.md", {
        exo__Asset_label: "My Asset",
      });

      const el = document.createElement("div");
      const suggestion = {
        file: fileData.file,
        label: "My Asset",
        hasLabel: true,
      };

      suggest.renderSuggestion(suggestion, el);

      expect(el.querySelector(".exocortex-wikilink-suggest-item")).toBeTruthy();
      expect(el.querySelector(".exocortex-wikilink-suggest-label")?.textContent).toBe(
        "My Asset"
      );
      expect(el.querySelector(".exocortex-wikilink-suggest-path")?.textContent).toBe(
        "folder/abc123.md"
      );
    });

    it("should not show path when hasLabel is false", () => {
      const fileData = createMockFile("abc123", "abc123.md");

      const el = document.createElement("div");
      const suggestion = {
        file: fileData.file,
        label: "abc123",
        hasLabel: false,
      };

      suggest.renderSuggestion(suggestion, el);

      expect(el.querySelector(".exocortex-wikilink-suggest-path")).toBeFalsy();
    });
  });

  describe("selectSuggestion", () => {
    it("should insert [[uuid|label]] when file has label", () => {
      const fileData = createMockFile("abc123", "abc123.md", {
        exo__Asset_label: "My Task",
      });
      const editor = createMockEditor("Text [[My", 9);

      // Set up context
      (suggest as unknown as { context: { editor: Editor; start: EditorPosition; end: EditorPosition } }).context = {
        editor,
        start: { line: 0, ch: 7 },
        end: { line: 0, ch: 9 },
      };

      const suggestion = {
        file: fileData.file,
        label: "My Task",
        hasLabel: true,
      };

      suggest.selectSuggestion(suggestion, new MouseEvent("click"));

      expect(editor.replaceRange).toHaveBeenCalledWith(
        "abc123|My Task]]",
        { line: 0, ch: 7 },
        { line: 0, ch: 9 }
      );
    });

    it("should insert [[uuid]] when file has no label", () => {
      const fileData = createMockFile("abc123", "abc123.md");
      const editor = createMockEditor("Text [[ab", 9);

      // Set up context
      (suggest as unknown as { context: { editor: Editor; start: EditorPosition; end: EditorPosition } }).context = {
        editor,
        start: { line: 0, ch: 7 },
        end: { line: 0, ch: 9 },
      };

      const suggestion = {
        file: fileData.file,
        label: "abc123",
        hasLabel: false,
      };

      suggest.selectSuggestion(suggestion, new MouseEvent("click"));

      expect(editor.replaceRange).toHaveBeenCalledWith(
        "abc123]]",
        { line: 0, ch: 7 },
        { line: 0, ch: 9 }
      );
    });
  });

  describe("updateSettings", () => {
    it("should update display name resolver settings", () => {
      const newSettings = {
        defaultTemplate: "{{exo__Asset_label}} ({{exo__Instance_class}})",
        classTemplates: {},
      };

      expect(() => suggest.updateSettings(newSettings)).not.toThrow();
    });
  });

  describe("Issue #2166: Wikilink autocomplete with asset labels", () => {
    it("should show asset labels in autocomplete suggestions", () => {
      // Given an asset with UUID "abc123.md" and label "My Task"
      const fileData = createMockFile("abc123", "abc123.md", {
        exo__Asset_label: "My Task",
      });
      mockApp.addFiles([fileData]);

      // When I type "[[My" in the editor
      const context = {
        query: "my",
        start: { line: 0, ch: 12 },
        end: { line: 0, ch: 14 },
      } as never;

      const suggestions = suggest.getSuggestions(context);

      // Then I should see "My Task" in the autocomplete suggestions
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].label).toBe("My Task");
      expect(suggestions[0].file.basename).toBe("abc123");
    });

    it("should insert [[uuid|label]] when selecting suggestion", () => {
      // Given an asset with UUID "abc123.md" and label "My Task"
      const fileData = createMockFile("abc123", "abc123.md", {
        exo__Asset_label: "My Task",
      });
      const editor = createMockEditor("Text [[My", 9);

      // Set up context
      (suggest as unknown as { context: { editor: Editor; start: EditorPosition; end: EditorPosition } }).context = {
        editor,
        start: { line: 0, ch: 7 },
        end: { line: 0, ch: 9 },
      };

      const suggestion = {
        file: fileData.file,
        label: "My Task",
        hasLabel: true,
      };

      // When selecting the suggestion
      suggest.selectSuggestion(suggestion, new MouseEvent("click"));

      // Then it should insert "[[abc123|My Task]]"
      expect(editor.replaceRange).toHaveBeenCalledWith(
        "abc123|My Task]]",
        { line: 0, ch: 7 },
        { line: 0, ch: 9 }
      );
    });
  });
});
