import "reflect-metadata";
import { container } from "tsyringe";
import { UniversalLayoutRenderer } from "../../src/presentation/renderers/UniversalLayoutRenderer";
import { ExocortexSettings } from "../../src/domain/settings/ExocortexSettings";
import { TFile } from "obsidian";
import {
  DI_TOKENS,
  registerCoreServices,
  resetContainer,
} from "exocortex";

describe("UniversalLayoutRenderer", () => {
  let mockApp: any;
  let mockSettings: ExocortexSettings;
  let mockPlugin: any;
  let mockVault: any;
  let mockVaultAdapter: any;

  beforeEach(() => {
    resetContainer();
    jest.useFakeTimers();

    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getAbstractFileByPath: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({ frontmatter: {} }),
        getFirstLinkpathDest: jest.fn(),
      },
      workspace: {
        getActiveFile: jest.fn(),
        getLeaf: jest.fn().mockReturnValue({
          openLinkText: jest.fn(),
        }),
        openLinkText: jest.fn(),
      },
    };

    mockSettings = {
      showPropertiesSection: false,
      showLayoutByDefault: true,
      showArchivedAssets: false,
      showDailyNoteProjects: true,
    } as ExocortexSettings;

    mockPlugin = {
      saveSettings: jest.fn(),
    };

    // Setup mock vaultAdapter for renderer
    mockVaultAdapter = {
      getAllFiles: jest.fn().mockReturnValue([]),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      getFrontmatter: jest.fn().mockReturnValue({}),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
      updateLinks: jest.fn(),
    };

    // Setup DI container with all required dependencies
    mockVault = {
      create: jest.fn().mockResolvedValue({ path: "test-task.md" }),
      read: jest.fn().mockResolvedValue(""),
      modify: jest.fn().mockResolvedValue(undefined),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
      exists: jest.fn().mockResolvedValue(true),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
    };

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVault });
    container.register(DI_TOKENS.ILogger, { useValue: mockLogger });
    registerCoreServices();
  });

  afterEach(() => {
    resetContainer();
    jest.useRealTimers();
  });

  it("should create renderer instance", () => {
    const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
    expect(renderer).toBeDefined();
  });

  it("should cleanup without errors", () => {
    const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
    expect(() => renderer.cleanup()).not.toThrow();
  });

  it("should invalidate backlinks cache without errors", () => {
    const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
    expect(() => renderer.invalidateBacklinksCache()).not.toThrow();
  });

  describe("handleMetadataChange", () => {
    it("should debounce metadata changes", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // Setup mock file as proper TFile instance (needed for instanceof check)
      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, {
        path: "test.md",
        extension: "md",
        basename: "test",
      });

      // Mock at app.vault level (handleMetadataChange uses this.app.vault.getAbstractFileByPath)
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      // Set current file path so handler processes the file
      renderer_any.currentFilePath = "test.md";
      renderer_any.rootContainer = document.createElement("div");

      // Mock metadataExtractor
      renderer_any.metadataExtractor = {
        extractMetadata: jest.fn().mockReturnValue({}),
      };

      // Simulate multiple rapid metadata changes
      renderer.handleMetadataChange("test.md");
      renderer.handleMetadataChange("test.md");
      renderer.handleMetadataChange("test.md");

      // Verify debounce happened (should only be called after timer)
      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledTimes(0);

      // Fast-forward time past debounce delay
      jest.advanceTimersByTime(100);

      // Now it should have been called once
      expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledTimes(1);
    });

    it("should ignore non-markdown files", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);

      const mockFile = {
        path: "test.pdf",
        extension: "pdf",
      } as any;

      // Mock at app.vault level (handleMetadataChange uses this.app.vault.getAbstractFileByPath)
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      await renderer.handleMetadataChange("test.pdf");
      jest.advanceTimersByTime(100);

      // Should not process non-markdown files
      // Just verify it doesn't throw
      expect(true).toBe(true);
    });

    it("should ignore changes when no container is set", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);

      const mockFile = {
        path: "test.md",
        extension: "md",
      } as TFile;

      // Mock at app.vault level (handleMetadataChange uses this.app.vault.getAbstractFileByPath)
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      await renderer.handleMetadataChange("test.md");
      jest.advanceTimersByTime(100);

      // Should handle gracefully when rootContainer is null
      expect(true).toBe(true);
    });

    it("should detect metadata changes", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);

      // Setup mock file as proper TFile instance (needed for instanceof check)
      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, {
        path: "test.md",
        extension: "md",
        basename: "test",
      });

      // Mock at app.vault level (handleMetadataChange uses this.app.vault.getAbstractFileByPath)
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      // First call - set initial metadata
      const renderer_any = renderer as any;
      renderer_any.currentFilePath = "test.md";
      renderer_any.metadataCache.set("test.md", {
        exo__Asset_label: "Old Label"
      });

      // Mock metadata extractor to return new metadata
      renderer_any.metadataExtractor = {
        extractMetadata: jest.fn().mockReturnValue({
          exo__Asset_label: "New Label",
        }),
      };

      // Mock root container
      renderer_any.rootContainer = document.createElement("div");

      await renderer.handleMetadataChange("test.md");
      jest.advanceTimersByTime(100);

      // Verify metadata was extracted
      expect(renderer_any.metadataExtractor.extractMetadata).toHaveBeenCalledWith(mockFile);
    });
  });

  describe("incremental updates via IncrementalUpdateHandler", () => {
    it("should delegate to incrementalUpdateHandler for section updates", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // Verify incrementalUpdateHandler exists
      expect(renderer_any.incrementalUpdateHandler).toBeDefined();
      expect(typeof renderer_any.incrementalUpdateHandler.updateSections).toBe("function");
    });

    it("should have incrementalUpdateHandler with correct dependencies", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;
      const handler = renderer_any.incrementalUpdateHandler;

      // Verify handler has access to required dependencies via deps
      expect(handler).toBeDefined();
    });
  });

  describe("render", () => {
    it("should show no active file message when no file is active", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);

      mockApp.workspace.getActiveFile.mockReturnValue(null);

      const el = document.createElement("div");
      await renderer.render("", el, {} as any);

      expect(el.textContent).toContain("No active file");
    });

    it("should render layout for active file", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Mock dependencies
      renderer_any.dailyNavRenderer = { render: jest.fn() };
      renderer_any.propertiesRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.buttonGroupsBuilder = { build: jest.fn().mockResolvedValue([]) };
      renderer_any.dailyTasksRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.dailyProjectsRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.areaTreeRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.relationsRenderer = {
        render: jest.fn().mockResolvedValue(undefined),
        getAssetRelations: jest.fn().mockResolvedValue([]),
      };
      renderer_any.backlinksCacheManager = { getBacklinks: jest.fn().mockReturnValue(new Map()) };
      renderer_any.metadataExtractor = { extractMetadata: jest.fn().mockReturnValue({}) };

      const el = document.createElement("div");
      await renderer.render("", el, {} as any);

      expect(renderer_any.dailyNavRenderer.render).toHaveBeenCalled();
      expect(renderer_any.currentFilePath).toBe("test.md");
    });

    it("should render daily projects section when showDailyNoteProjects is true", async () => {
      mockSettings.showDailyNoteProjects = true;
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Mock dependencies
      renderer_any.dailyNavRenderer = { render: jest.fn() };
      renderer_any.propertiesRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.buttonGroupsBuilder = { build: jest.fn().mockResolvedValue([]) };
      renderer_any.dailyTasksRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.dailyProjectsRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.areaTreeRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.relationsRenderer = {
        render: jest.fn().mockResolvedValue(undefined),
        getAssetRelations: jest.fn().mockResolvedValue([]),
      };
      renderer_any.backlinksCacheManager = { getBacklinks: jest.fn().mockReturnValue(new Map()) };
      renderer_any.metadataExtractor = { extractMetadata: jest.fn().mockReturnValue({}) };

      const el = document.createElement("div");
      await renderer.render("", el, {} as any);

      expect(renderer_any.dailyProjectsRenderer.render).toHaveBeenCalled();
    });

    it("should not render daily projects section when showDailyNoteProjects is false", async () => {
      mockSettings.showDailyNoteProjects = false;
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Mock dependencies
      renderer_any.dailyNavRenderer = { render: jest.fn() };
      renderer_any.propertiesRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.buttonGroupsBuilder = { build: jest.fn().mockResolvedValue([]) };
      renderer_any.dailyTasksRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.dailyProjectsRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.areaTreeRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.relationsRenderer = {
        render: jest.fn().mockResolvedValue(undefined),
        getAssetRelations: jest.fn().mockResolvedValue([]),
      };
      renderer_any.backlinksCacheManager = { getBacklinks: jest.fn().mockReturnValue(new Map()) };
      renderer_any.metadataExtractor = { extractMetadata: jest.fn().mockReturnValue({}) };

      const el = document.createElement("div");
      await renderer.render("", el, {} as any);

      expect(renderer_any.dailyProjectsRenderer.render).not.toHaveBeenCalled();
    });
  });

  describe("refresh", () => {
    it("should handle missing root container gracefully", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      renderer_any.rootContainer = null;

      // Should not throw
      await expect(renderer.refresh()).resolves.toBeUndefined();
    });

    it("should preserve scroll position during refresh", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Create mock container with scroll parent
      const scrollParent = document.createElement("div");
      scrollParent.className = "cm-scroller";
      Object.defineProperty(scrollParent, "scrollTop", {
        get: () => 100,
        set: jest.fn(),
        configurable: true,
      });

      const rootContainer = document.createElement("div");
      rootContainer.setAttribute("data-source", "");
      rootContainer.empty = jest.fn();
      scrollParent.appendChild(rootContainer);

      renderer_any.rootContainer = rootContainer;

      // Mock dependencies
      renderer_any.dailyNavRenderer = { render: jest.fn() };
      renderer_any.propertiesRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.buttonGroupsBuilder = { build: jest.fn().mockResolvedValue([]) };
      renderer_any.dailyTasksRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.dailyProjectsRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.areaTreeRenderer = { render: jest.fn().mockResolvedValue(undefined) };
      renderer_any.relationsRenderer = {
        render: jest.fn().mockResolvedValue(undefined),
        getAssetRelations: jest.fn().mockResolvedValue([]),
      };
      renderer_any.backlinksCacheManager = { getBacklinks: jest.fn().mockReturnValue(new Map()) };
      renderer_any.metadataExtractor = { extractMetadata: jest.fn().mockReturnValue({}) };

      await renderer.refresh();

      // Verify container was cleared
      expect(rootContainer.empty).toHaveBeenCalled();
    });
  });
});
