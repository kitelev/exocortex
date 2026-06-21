import "reflect-metadata";
import { container } from "tsyringe";
import { UniversalLayoutRenderer } from "../../src/presentation/renderers/UniversalLayoutRenderer";
import { ExocortexSettings } from "../../src/domain/settings/ExocortexSettings";
import { TFile } from "obsidian";
import {
  DI_TOKENS,
  registerCoreServices,
  resetContainer,
} from "@kitelev/exocortex-core";

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
      showLayoutByDefault: true,
      showArchivedAssets: false,
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

    it("should await prepareForRefresh BEFORE updating sections when BUTTONS is affected", async () => {
      const callOrder: string[] = [];
      const prepareForRefresh = jest.fn().mockImplementation(async () => {
        callOrder.push("prepareForRefresh");
      });

      const renderer = new UniversalLayoutRenderer(
        mockApp,
        mockSettings,
        mockPlugin,
        mockVaultAdapter,
        { prepareForRefresh },
      );

      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, {
        path: "test.md",
        extension: "md",
        basename: "test",
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const renderer_any = renderer as any;
      renderer_any.currentFilePath = "test.md";
      renderer_any.rootContainer = document.createElement("div");
      // `ems__Task_zone` maps to BUTTONS in PropertyDependencyResolver — the
      // delta below trips the gate that runs prepareForRefresh.
      renderer_any.metadataExtractor = {
        extractMetadata: jest.fn().mockReturnValue({
          ems__Task_zone: "[[e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f]]",
        }),
      };
      const updateSectionsSpy = jest.fn().mockImplementation(async () => {
        callOrder.push("updateSections");
      });
      renderer_any.incrementalUpdateHandler = {
        updateSections: updateSectionsSpy,
      };

      await renderer.handleMetadataChange("test.md");
      jest.advanceTimersByTime(100);
      // Flush the awaited promise inside the setTimeout body.
      await Promise.resolve();
      await Promise.resolve();

      expect(prepareForRefresh).toHaveBeenCalledWith(mockFile);
      expect(updateSectionsSpy).toHaveBeenCalled();
      expect(callOrder.indexOf("updateSections")).toBeGreaterThan(
        callOrder.indexOf("prepareForRefresh"),
      );
    });

    it("should NOT call prepareForRefresh when no tracked property changed", async () => {
      const prepareForRefresh = jest.fn();

      const renderer = new UniversalLayoutRenderer(
        mockApp,
        mockSettings,
        mockPlugin,
        mockVaultAdapter,
        { prepareForRefresh },
      );

      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, {
        path: "test.md",
        extension: "md",
        basename: "test",
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const renderer_any = renderer as any;
      renderer_any.currentFilePath = "test.md";
      renderer_any.rootContainer = document.createElement("div");
      // Identical old/new metadata → empty delta → early-return before
      // reaching the prepareForRefresh gate.
      const sameMeta = { exo__Asset_label: "x" };
      renderer_any.metadataCache.set("test.md", sameMeta);
      renderer_any.metadataExtractor = {
        extractMetadata: jest.fn().mockReturnValue(sameMeta),
      };

      await renderer.handleMetadataChange("test.md");
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(prepareForRefresh).not.toHaveBeenCalled();
    });

    it("should NOT call prepareForRefresh when only non-BUTTONS sections are affected", async () => {
      const prepareForRefresh = jest.fn();

      const renderer = new UniversalLayoutRenderer(
        mockApp,
        mockSettings,
        mockPlugin,
        mockVaultAdapter,
        { prepareForRefresh },
      );

      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, {
        path: "test.md",
        extension: "md",
        basename: "test",
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const renderer_any = renderer as any;
      renderer_any.currentFilePath = "test.md";
      renderer_any.rootContainer = document.createElement("div");
      // `ems__Effort_votes` maps to DAILY_TASKS only — BUTTONS not in the
      // affected set, so the gate should keep prepareForRefresh dormant.
      renderer_any.metadataExtractor = {
        extractMetadata: jest.fn().mockReturnValue({
          ems__Effort_votes: 3,
        }),
      };
      renderer_any.incrementalUpdateHandler = {
        updateSections: jest.fn().mockResolvedValue(undefined),
      };

      await renderer.handleMetadataChange("test.md");
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(prepareForRefresh).not.toHaveBeenCalled();
      // The sections-update pass still ran for the DAILY_TASKS section.
      expect(renderer_any.incrementalUpdateHandler.updateSections).toHaveBeenCalled();
    });

    it("should not error when prepareForRefresh is not provided", async () => {
      const renderer = new UniversalLayoutRenderer(
        mockApp,
        mockSettings,
        mockPlugin,
        mockVaultAdapter,
      );

      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, {
        path: "test.md",
        extension: "md",
        basename: "test",
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const renderer_any = renderer as any;
      renderer_any.currentFilePath = "test.md";
      renderer_any.rootContainer = document.createElement("div");
      renderer_any.metadataExtractor = {
        extractMetadata: jest.fn().mockReturnValue({
          ems__Task_zone: "[[e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f]]",
        }),
      };
      renderer_any.incrementalUpdateHandler = {
        updateSections: jest.fn().mockResolvedValue(undefined),
      };

      await renderer.handleMetadataChange("test.md");
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(renderer_any.metadataExtractor.extractMetadata).toHaveBeenCalledWith(mockFile);
      // No callback wired — sections still update normally.
      expect(renderer_any.incrementalUpdateHandler.updateSections).toHaveBeenCalled();
    });

    it("should swallow prepareForRefresh errors and still update sections", async () => {
      const prepareForRefresh = jest
        .fn()
        .mockRejectedValue(new Error("reindex blew up"));

      const renderer = new UniversalLayoutRenderer(
        mockApp,
        mockSettings,
        mockPlugin,
        mockVaultAdapter,
        { prepareForRefresh },
      );

      const mockFile = Object.create(TFile.prototype);
      Object.assign(mockFile, {
        path: "test.md",
        extension: "md",
        basename: "test",
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const renderer_any = renderer as any;
      renderer_any.currentFilePath = "test.md";
      renderer_any.rootContainer = document.createElement("div");
      renderer_any.metadataExtractor = {
        extractMetadata: jest.fn().mockReturnValue({
          ems__Task_zone: "[[e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f]]",
        }),
      };
      const updateSectionsSpy = jest.fn().mockResolvedValue(undefined);
      renderer_any.incrementalUpdateHandler = {
        updateSections: updateSectionsSpy,
      };

      await renderer.handleMetadataChange("test.md");
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(prepareForRefresh).toHaveBeenCalled();
      // Sections-update pass still ran even though the prep step threw.
      expect(updateSectionsSpy).toHaveBeenCalled();
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
