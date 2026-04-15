import { InlineTitlePatch } from "../../../../src/presentation/tab-titles/InlineTitlePatch";
import { TFile, WorkspaceLeaf, Plugin, MarkdownView } from "obsidian";

describe("InlineTitlePatch (Issue #2806)", () => {
  let patch: InlineTitlePatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockWorkspaceLeaf: any;
  let mockMarkdownView: any;
  let inlineTitleEl: HTMLElement;
  let containerEl: HTMLElement;

  beforeEach(() => {
    containerEl = document.createElement("div");
    inlineTitleEl = document.createElement("div");
    inlineTitleEl.className = "inline-title";
    inlineTitleEl.textContent = "1b20a8f0-d745-4e93-91db-4531b3df120e";
    containerEl.appendChild(inlineTitleEl);

    mockMarkdownView = {
      file: null,
      containerEl,
    };
    Object.setPrototypeOf(mockMarkdownView, MarkdownView.prototype);

    mockWorkspaceLeaf = {
      view: mockMarkdownView,
    };

    mockApp = {
      workspace: {
        iterateAllLeaves: jest.fn((callback: (leaf: WorkspaceLeaf) => void) => {
          callback(mockWorkspaceLeaf);
        }),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
      metadataCache: {
        getFileCache: jest.fn(),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
      settings: {},
    };

    patch = new InlineTitlePatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
  });

  describe("enable", () => {
    it("should register workspace and metadata events", () => {
      patch.enable();

      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "active-leaf-change",
        expect.any(Function)
      );
      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function)
      );
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "changed",
        expect.any(Function)
      );
    });

    it("should replace inline title with exo__Asset_label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", {
        value: "1b20a8f0-d745-4e93-91db-4531b3df120e",
      });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "ems__Task",
        },
      });

      patch.enable();

      expect(inlineTitleEl.textContent).toBe("ems__Task");
    });

    it("should not touch inline title when frontmatter has no label", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "Untitled" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      patch.enable();

      expect(inlineTitleEl.textContent).toBe(
        "1b20a8f0-d745-4e93-91db-4531b3df120e"
      );
    });

    it("should not double-enable", () => {
      patch.enable();
      patch.enable();

      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe("disable", () => {
    it("should restore original inline title text", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "1b20a8f0" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Test" },
      });

      patch.enable();
      expect(inlineTitleEl.textContent).toBe("Test");

      patch.disable();
      expect(inlineTitleEl.textContent).toBe(
        "1b20a8f0-d745-4e93-91db-4531b3df120e"
      );
    });

    it("should not throw when disabling without enabling", () => {
      expect(() => patch.disable()).not.toThrow();
    });
  });

  describe("non-markdown views", () => {
    it("should ignore non-MarkdownView leaves", () => {
      const nonMdLeaf = { view: {} } as WorkspaceLeaf;
      mockApp.workspace.iterateAllLeaves = jest.fn(
        (cb: (leaf: WorkspaceLeaf) => void) => cb(nonMdLeaf)
      );

      expect(() => patch.enable()).not.toThrow();
    });
  });

  describe("files without extension md", () => {
    it("should skip non-md files", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "canvas" });
      Object.defineProperty(mockFile, "basename", { value: "my-canvas" });
      mockMarkdownView.file = mockFile;

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { exo__Asset_label: "Should Not Apply" },
      });

      patch.enable();
      expect(inlineTitleEl.textContent).toBe(
        "1b20a8f0-d745-4e93-91db-4531b3df120e"
      );
    });
  });
});
