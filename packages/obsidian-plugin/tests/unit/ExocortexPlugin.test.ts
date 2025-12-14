import { flushPromises, waitForCondition } from "./helpers/testHelpers";
import "reflect-metadata";
import { container } from "tsyringe";
import ExocortexPlugin from "../../src/ExocortexPlugin";
import { Plugin, MarkdownView, TFile } from "obsidian";
import { LoggerFactory } from "../../src/adapters/logging/LoggerFactory";
import { ObsidianVaultAdapter } from "../../src/adapters/ObsidianVaultAdapter";
import { UniversalLayoutRenderer } from "../../src/presentation/renderers/UniversalLayoutRenderer";
import { CommandManager } from "../../src/application/services/CommandManager";
import { TaskStatusService, DI_TOKENS, registerCoreServices, resetContainer } from "exocortex";
import { TaskTrackingService } from "../../src/application/services/TaskTrackingService";
import { AliasSyncService } from "../../src/application/services/AliasSyncService";
import { SPARQLCodeBlockProcessor } from "../../src/application/processors/SPARQLCodeBlockProcessor";
import { ExocortexSettingTab } from "../../src/presentation/settings/ExocortexSettingTab";
import { DEFAULT_SETTINGS } from "../../src/domain/settings/ExocortexSettings";

// Mock all dependencies
jest.mock("../../src/adapters/logging/LoggerFactory");
jest.mock("../../src/adapters/ObsidianVaultAdapter");
jest.mock("../../src/presentation/renderers/UniversalLayoutRenderer");
jest.mock("../../src/application/services/CommandManager");
jest.mock("../../src/application/services/TaskTrackingService");
jest.mock("../../src/application/services/AliasSyncService");
jest.mock("../../src/application/processors/SPARQLCodeBlockProcessor");
jest.mock("../../src/presentation/settings/ExocortexSettingTab");
jest.mock("../../src/infrastructure/di/PluginContainer", () => ({
  PluginContainer: {
    setup: jest.fn(),
    reset: jest.fn(),
  },
}));

describe("ExocortexPlugin", () => {
  let plugin: ExocortexPlugin;
  let mockApp: any;
  let mockLogger: any;
  let mockLayoutRenderer: any;
  let mockCommandManager: any;
  let mockTaskStatusService: any;
  let mockTaskTrackingService: any;
  let mockAliasSyncService: any;
  let mockSparqlProcessor: any;
  let mockWorkspace: any;
  let mockMetadataCache: any;
  let mockVault: any;
  let mockView: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetContainer();

    // Setup DI container with mock dependencies
    const mockVaultAdapterForDI = {
      create: jest.fn().mockResolvedValue({ path: "test.md", basename: "test", name: "test.md", parent: null }),
      read: jest.fn().mockResolvedValue(""),
      modify: jest.fn().mockResolvedValue(undefined),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
      exists: jest.fn().mockResolvedValue(true),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
    };
    const mockLoggerForDI = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };
    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVaultAdapterForDI });
    container.register(DI_TOKENS.ILogger, { useValue: mockLoggerForDI });
    registerCoreServices();

    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };
    (LoggerFactory.create as jest.Mock).mockReturnValue(mockLogger);

    // Setup mock view
    mockView = {
      containerEl: document.createElement("div"),
      getMode: jest.fn().mockReturnValue("preview"), // Default to Reading Mode (preview)
    };

    // Create metadata container in view
    const metadataContainer = document.createElement("div");
    metadataContainer.className = "metadata-container";
    mockView.containerEl.appendChild(metadataContainer);

    // Setup mock workspace
    mockWorkspace = {
      getActiveViewOfType: jest.fn().mockReturnValue(mockView),
      getActiveFile: jest.fn(),
      on: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    };

    // Setup mock metadata cache
    mockMetadataCache = {
      on: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      getFileCache: jest.fn(),
    };

    // Setup mock vault
    mockVault = {
      on: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      getName: jest.fn().mockReturnValue("Test Vault"),
    };

    // Setup mock app
    mockApp = {
      workspace: mockWorkspace,
      metadataCache: mockMetadataCache,
      vault: mockVault,
    };

    // Setup mock layout renderer
    mockLayoutRenderer = {
      render: jest.fn().mockResolvedValue(undefined),
      invalidateBacklinksCache: jest.fn(),
      cleanup: jest.fn(),
    };
    (UniversalLayoutRenderer as jest.Mock).mockImplementation(() => mockLayoutRenderer);

    // Setup mock command manager
    mockCommandManager = {
      registerAllCommands: jest.fn(),
    };
    (CommandManager as jest.Mock).mockImplementation(() => mockCommandManager);

    // TaskStatusService is now resolved from DI container, spy on its methods
    mockTaskStatusService = container.resolve(TaskStatusService);
    jest.spyOn(mockTaskStatusService, 'syncEffortEndTimestamp').mockResolvedValue(undefined);
    jest.spyOn(mockTaskStatusService, 'shiftPlannedEndTimestamp').mockResolvedValue(undefined);

    // Setup mock task tracking service
    mockTaskTrackingService = {
      handleFileChange: jest.fn().mockResolvedValue(undefined),
    };
    (TaskTrackingService as jest.Mock).mockImplementation(() => mockTaskTrackingService);

    // Setup mock alias sync service
    mockAliasSyncService = {
      syncAliases: jest.fn().mockResolvedValue(undefined),
    };
    (AliasSyncService as jest.Mock).mockImplementation(() => mockAliasSyncService);

    // Setup mock SPARQL processor
    mockSparqlProcessor = {
      process: jest.fn(),
      cleanup: jest.fn(),
    };
    (SPARQLCodeBlockProcessor as jest.Mock).mockImplementation(() => mockSparqlProcessor);

    // Setup mock settings tab
    (ExocortexSettingTab as jest.Mock).mockImplementation(() => ({}));

    // Create plugin instance with mocked app
    plugin = new ExocortexPlugin(mockApp, {} as any);

    // Mock plugin methods that interact with Obsidian API
    plugin.loadData = jest.fn().mockResolvedValue({});
    plugin.saveData = jest.fn().mockResolvedValue(undefined);
    plugin.registerEvent = jest.fn();
    plugin.addSettingTab = jest.fn();
    plugin.registerMarkdownCodeBlockProcessor = jest.fn();
    plugin.registerEditorExtension = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    resetContainer();
    // Clean up any DOM elements created during tests
    document.querySelectorAll(".exocortex-auto-layout").forEach(el => el.remove());
  });

  describe("onload", () => {
    it("should initialize all components successfully", async () => {
      // Arrange
      mockWorkspace.getActiveFile.mockReturnValue({ path: "test.md" });

      // Act
      await plugin.onload();

      // Assert
      expect(LoggerFactory.create).toHaveBeenCalledWith("ExocortexPlugin");
      expect(mockLogger.info).toHaveBeenCalledWith("Loading Exocortex Plugin");
      expect(plugin.loadData).toHaveBeenCalled();
      expect(ObsidianVaultAdapter).toHaveBeenCalledWith(mockVault, mockMetadataCache, mockApp);
      expect(UniversalLayoutRenderer).toHaveBeenCalledWith(mockApp, plugin.settings, plugin, plugin.vaultAdapter);
      // TaskStatusService is now resolved from DI container, not instantiated directly
      expect(TaskTrackingService).toHaveBeenCalledWith(mockApp, mockVault, mockMetadataCache);
      expect(SPARQLCodeBlockProcessor).toHaveBeenCalledWith(plugin);
      expect(CommandManager).toHaveBeenCalledWith(mockApp);
      expect(mockCommandManager.registerAllCommands).toHaveBeenCalled();
      expect(plugin.addSettingTab).toHaveBeenCalled();
      expect(plugin.registerMarkdownCodeBlockProcessor).toHaveBeenCalledWith(
        "sparql",
        expect.any(Function)
      );
      expect(plugin.registerEvent).toHaveBeenCalledTimes(6);
      expect(mockLogger.info).toHaveBeenCalledWith("Exocortex Plugin loaded successfully");
    });

    it("should register all event listeners", async () => {
      // Act
      await plugin.onload();

      // Assert
      expect(mockMetadataCache.on).toHaveBeenCalledWith("resolved", expect.any(Function));
      expect(mockMetadataCache.on).toHaveBeenCalledWith("changed", expect.any(Function));
      expect(mockWorkspace.on).toHaveBeenCalledWith("file-open", expect.any(Function));
      expect(mockWorkspace.on).toHaveBeenCalledWith("active-leaf-change", expect.any(Function));
      expect(mockWorkspace.on).toHaveBeenCalledWith("layout-change", expect.any(Function));
    });

    it("should handle initial render when active file exists", async () => {
      // Arrange
      mockWorkspace.getActiveFile.mockReturnValue({ path: "test.md" });

      // Act
      await plugin.onload();

      // Wait for setTimeout
      await flushPromises();

      // Assert
      expect(mockWorkspace.getActiveFile).toHaveBeenCalled();
    });

    it("should handle errors during initialization", async () => {
      // Arrange
      const error = new Error("Initialization failed");
      plugin.loadData = jest.fn().mockRejectedValue(error);

      // Act & Assert
      await expect(plugin.onload()).rejects.toThrow("Initialization failed");
      expect(mockLogger.error).toHaveBeenCalledWith("Failed to load Exocortex Plugin", error);
    });

    it("should not render initially when no active file", async () => {
      // Arrange
      mockWorkspace.getActiveFile.mockReturnValue(null);

      // Act
      await plugin.onload();

      // Wait for potential setTimeout
      await flushPromises();

      // Assert
      expect(mockWorkspace.getActiveFile).toHaveBeenCalled();
      // Layout should not be rendered
      expect(mockLayoutRenderer.render).not.toHaveBeenCalled();
    });
  });

  describe("onunload", () => {
    it("should clean up and log unload", async () => {
      // Arrange
      await plugin.onload();

      // Add some auto-rendered layouts to DOM
      const layout1 = document.createElement("div");
      layout1.className = "exocortex-auto-layout";
      document.body.appendChild(layout1);

      const layout2 = document.createElement("div");
      layout2.className = "exocortex-auto-layout";
      document.body.appendChild(layout2);

      // Act
      await plugin.onunload();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith("Exocortex Plugin unloaded");
      expect(document.querySelectorAll(".exocortex-auto-layout").length).toBe(0);
    });
  });

  describe("loadSettings", () => {
    it("should load and merge settings with defaults", async () => {
      // Arrange
      const savedSettings = {
        layoutVisible: false,
        showEffortArea: false,
      };
      plugin.loadData = jest.fn().mockResolvedValue(savedSettings);

      // Act
      await plugin.loadSettings();

      // Assert
      expect(plugin.loadData).toHaveBeenCalled();
      expect(plugin.settings).toEqual({
        ...DEFAULT_SETTINGS,
        ...savedSettings,
      });
    });

    it("should use default settings when no saved data", async () => {
      // Arrange
      plugin.loadData = jest.fn().mockResolvedValue(null);

      // Act
      await plugin.loadSettings();

      // Assert
      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it("should have useDynamicPropertyFields disabled by default", async () => {
      // Arrange
      plugin.loadData = jest.fn().mockResolvedValue(null);

      // Act
      await plugin.loadSettings();

      // Assert
      expect(plugin.settings.useDynamicPropertyFields).toBe(false);
    });

    it("should persist useDynamicPropertyFields setting when enabled", async () => {
      // Arrange
      const savedSettings = {
        useDynamicPropertyFields: true,
      };
      plugin.loadData = jest.fn().mockResolvedValue(savedSettings);

      // Act
      await plugin.loadSettings();

      // Assert
      expect(plugin.settings.useDynamicPropertyFields).toBe(true);
    });
  });

  describe("saveSettings", () => {
    it("should save current settings", async () => {
      // Arrange
      await plugin.loadSettings();
      plugin.settings.layoutVisible = false;

      // Act
      await plugin.saveSettings();

      // Assert
      expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
    });
  });

  describe("refreshLayout", () => {
    it("should trigger auto render layout", async () => {
      // Arrange
      await plugin.onload();
      plugin.settings.layoutVisible = true;

      // Act
      plugin.refreshLayout();

      // Assert
      // Should trigger autoRenderLayout which will check for active view
      expect(mockWorkspace.getActiveViewOfType).toHaveBeenCalledWith(MarkdownView);
    });
  });

  describe("autoRenderLayout", () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it("should render layout when conditions are met", () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      expect(mockWorkspace.getActiveViewOfType).toHaveBeenCalledWith(MarkdownView);
      expect(mockLayoutRenderer.render).toHaveBeenCalled();

      // Check that layout container was created in the view container
      const layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(1);
    });

    it("should not render when layout is hidden in settings", () => {
      // Arrange
      plugin.settings.layoutVisible = false;

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      expect(mockWorkspace.getActiveViewOfType).not.toHaveBeenCalled();
      expect(mockLayoutRenderer.render).not.toHaveBeenCalled();
    });

    it("should not render when no active markdown view", () => {
      // Arrange
      plugin.settings.layoutVisible = true;
      mockWorkspace.getActiveViewOfType.mockReturnValue(null);

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      expect(mockWorkspace.getActiveViewOfType).toHaveBeenCalledWith(MarkdownView);
      expect(mockLayoutRenderer.render).not.toHaveBeenCalled();
    });

    it("should not render when no metadata container", () => {
      // Arrange
      plugin.settings.layoutVisible = true;
      // Remove metadata container from mock view
      mockView.containerEl.innerHTML = "";

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      expect(mockLayoutRenderer.render).not.toHaveBeenCalled();
    });

    it("should handle render errors gracefully", async () => {
      // Arrange
      plugin.settings.layoutVisible = true;
      const error = new Error("Render failed");
      mockLayoutRenderer.render.mockRejectedValue(error);

      // Act
      (plugin as any).autoRenderLayout();

      // Wait for promise to reject
      await flushPromises();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith("Failed to auto-render layout", error);
    });

    it("should remove existing layouts before rendering new one", () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Add existing layout to document body (where removeAutoRenderedLayouts searches)
      const existingLayout = document.createElement("div");
      existingLayout.className = "exocortex-auto-layout";
      document.body.appendChild(existingLayout);

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      // Old layout should be removed from document
      const removedFromDocument = document.querySelectorAll(".exocortex-auto-layout");
      expect(removedFromDocument.length).toBe(0);

      // New one created in view container
      const layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(1);

      // Cleanup
      existingLayout.remove();
    });

    it("should render layout in Reading Mode (preview)", () => {
      // Arrange
      plugin.settings.layoutVisible = true;
      mockView.getMode.mockReturnValue("preview");

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      expect(mockView.getMode).toHaveBeenCalled();
      expect(mockLayoutRenderer.render).toHaveBeenCalled();

      // Check that layout container was created in the view container
      const layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(1);
    });

    it("should NOT render layout in Edit Mode (source)", () => {
      // Arrange
      plugin.settings.layoutVisible = true;
      mockView.getMode.mockReturnValue("source");

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      expect(mockView.getMode).toHaveBeenCalled();
      expect(mockLayoutRenderer.render).not.toHaveBeenCalled();

      // Check that no layout container was created
      const layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(0);
    });

    it("should correctly switch between modes when mode changes", () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Start in Reading Mode (preview) - should render
      mockView.getMode.mockReturnValue("preview");
      (plugin as any).autoRenderLayout();
      expect(mockLayoutRenderer.render).toHaveBeenCalledTimes(1);

      // Verify render was called (layout created in preview mode)
      const firstLayoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(firstLayoutContainers.length).toBe(1);

      // Clean up the layout container manually (simulating what removeAutoRenderedLayouts does)
      // Note: removeAutoRenderedLayouts uses document.querySelectorAll which doesn't reach
      // elements inside mockView.containerEl since it's not attached to the document
      mockView.containerEl.querySelector(".exocortex-auto-layout")?.remove();

      // Switch to Edit Mode (source) - should not render new layout
      mockView.getMode.mockReturnValue("source");

      (plugin as any).autoRenderLayout();
      // render should still only be called once (from preview mode)
      expect(mockLayoutRenderer.render).toHaveBeenCalledTimes(1);

      // Verify no layout container exists after switching to source mode
      const layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(0);
    });
  });

  describe("handleMetadataChange", () => {
    let mockFile: TFile;

    beforeEach(async () => {
      await plugin.onload();
      mockFile = { path: "test.md" } as TFile;
      // Spy on the plugin's actual taskStatusService after it's resolved during onload
      mockTaskStatusService = (plugin as any).taskStatusService;
      jest.spyOn(mockTaskStatusService, 'syncEffortEndTimestamp').mockResolvedValue(undefined);
      jest.spyOn(mockTaskStatusService, 'shiftPlannedEndTimestamp').mockResolvedValue(undefined);
    });

    it("should handle effort end timestamp change", async () => {
      // Arrange
      const metadata = {
        ems__Effort_endTimestamp: "2023-11-01T10:00:00Z",
      };
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: metadata,
      });

      // Act
      await (plugin as any).handleMetadataChange(mockFile);

      // Change timestamp
      metadata.ems__Effort_endTimestamp = "2023-11-01T11:00:00Z";
      await (plugin as any).handleMetadataChange(mockFile);

      // Assert
      expect(mockTaskTrackingService.handleFileChange).toHaveBeenCalledWith(mockFile);
      expect(mockTaskStatusService.syncEffortEndTimestamp).toHaveBeenCalledWith(
        mockFile,
        new Date("2023-11-01T11:00:00Z")
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Auto-synced ems__Effort_resolutionTimestamp")
      );
    });

    it("should handle planned start timestamp change", async () => {
      // Arrange
      const metadata = {
        ems__Effort_plannedStartTimestamp: "2023-11-01T08:00:00Z",
      };
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: metadata,
      });

      // Act
      await (plugin as any).handleMetadataChange(mockFile);

      // Change timestamp
      metadata.ems__Effort_plannedStartTimestamp = "2023-11-01T09:00:00Z";
      await (plugin as any).handleMetadataChange(mockFile);

      // Assert
      const expectedDelta = 60 * 60 * 1000; // 1 hour in ms
      expect(mockTaskStatusService.shiftPlannedEndTimestamp).toHaveBeenCalledWith(
        mockFile,
        expectedDelta
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Shifted ems__Effort_plannedEndTimestamp")
      );
    });

    it("should skip when no metadata", async () => {
      // Arrange
      mockMetadataCache.getFileCache.mockReturnValue(null);

      // Act
      await (plugin as any).handleMetadataChange(mockFile);

      // Assert
      expect(mockTaskTrackingService.handleFileChange).not.toHaveBeenCalled();
    });

    it("should skip when no frontmatter", async () => {
      // Arrange
      mockMetadataCache.getFileCache.mockReturnValue({});

      // Act
      await (plugin as any).handleMetadataChange(mockFile);

      // Assert
      expect(mockTaskTrackingService.handleFileChange).not.toHaveBeenCalled();
    });

    it("should not double-shift plannedEndTimestamp on recursive metadata change event", async () => {
      const metadata = {
        ems__Effort_plannedStartTimestamp: "2023-11-01T08:00:00Z",
      };
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: metadata,
      });

      await (plugin as any).handleMetadataChange(mockFile);

      metadata.ems__Effort_plannedStartTimestamp = "2023-11-01T08:05:00Z";
      await (plugin as any).handleMetadataChange(mockFile);

      await (plugin as any).handleMetadataChange(mockFile);
      await (plugin as any).handleMetadataChange(mockFile);

      expect(mockTaskStatusService.shiftPlannedEndTimestamp).toHaveBeenCalledTimes(1);
      expect(mockTaskStatusService.shiftPlannedEndTimestamp).toHaveBeenCalledWith(
        mockFile,
        5 * 60 * 1000
      );
    });

    it("should not double-sync endTimestamp on recursive metadata change event", async () => {
      const metadata = {
        ems__Effort_endTimestamp: "2023-11-01T10:00:00Z",
      };
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: metadata,
      });

      await (plugin as any).handleMetadataChange(mockFile);

      metadata.ems__Effort_endTimestamp = "2023-11-01T11:00:00Z";
      await (plugin as any).handleMetadataChange(mockFile);

      await (plugin as any).handleMetadataChange(mockFile);
      await (plugin as any).handleMetadataChange(mockFile);

      expect(mockTaskStatusService.syncEffortEndTimestamp).toHaveBeenCalledTimes(1);
      expect(mockTaskStatusService.syncEffortEndTimestamp).toHaveBeenCalledWith(
        mockFile,
        new Date("2023-11-01T11:00:00Z")
      );
    });

    it("should cache metadata on first call", async () => {
      // Arrange
      const metadata = {
        ems__Effort_status: "doing",
      };
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: metadata,
      });

      // Act
      await (plugin as any).handleMetadataChange(mockFile);

      // Assert
      expect(mockTaskTrackingService.handleFileChange).toHaveBeenCalledWith(mockFile);
      // Metadata should be cached
    });

    it("should handle invalid dates gracefully", async () => {
      // Arrange
      const metadata = {
        ems__Effort_endTimestamp: "invalid-date",
      };
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: metadata,
      });

      // Act
      await (plugin as any).handleMetadataChange(mockFile);

      // Change to another invalid date
      metadata.ems__Effort_endTimestamp = "also-invalid";
      await (plugin as any).handleMetadataChange(mockFile);

      // Assert
      expect(mockTaskStatusService.syncEffortEndTimestamp).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      // Arrange
      const error = new Error("Metadata processing failed");
      mockTaskTrackingService.handleFileChange.mockRejectedValue(error);
      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: { test: "data" },
      });

      // Act
      await (plugin as any).handleMetadataChange(mockFile);

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to handle metadata change for ${mockFile.path}`,
        error
      );
    });

    describe("alias sync integration", () => {
      it("should sync aliases when exo__Asset_label changes", async () => {
        // Arrange
        const oldLabel = "Old Label";
        const newLabel = "New Label";
        const metadata = {
          exo__Asset_label: oldLabel,
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: metadata,
        });

        // Act - First call caches metadata
        await (plugin as any).handleMetadataChange(mockFile);

        // Change label
        metadata.exo__Asset_label = newLabel;

        // Act - Second call detects change
        await (plugin as any).handleMetadataChange(mockFile);

        // Assert
        expect(mockAliasSyncService.syncAliases).toHaveBeenCalledWith(
          mockFile,
          oldLabel,
          newLabel
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("Detected exo__Asset_label change")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("Auto-synced aliases")
        );
      });

      it("should not sync aliases when label doesn't change", async () => {
        // Arrange
        const label = "Same Label";
        const metadata = {
          exo__Asset_label: label,
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: metadata,
        });

        // Act
        await (plugin as any).handleMetadataChange(mockFile);
        await (plugin as any).handleMetadataChange(mockFile);

        // Assert
        expect(mockAliasSyncService.syncAliases).not.toHaveBeenCalled();
      });

      it("should not sync aliases when label is not a string", async () => {
        // Arrange
        const metadata = {
          exo__Asset_label: 123,
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: metadata,
        });

        // Act
        await (plugin as any).handleMetadataChange(mockFile);

        const newMetadata = {
          exo__Asset_label: 456,
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: newMetadata,
        });

        await (plugin as any).handleMetadataChange(mockFile);

        // Assert
        expect(mockAliasSyncService.syncAliases).not.toHaveBeenCalled();
      });

      it("should not sync aliases when label is added (no previous value)", async () => {
        // Arrange
        const metadata = {};
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: metadata,
        });

        // Act
        await (plugin as any).handleMetadataChange(mockFile);

        // Add label
        const newMetadata = {
          exo__Asset_label: "New Label",
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: newMetadata,
        });

        await (plugin as any).handleMetadataChange(mockFile);

        // Assert - syncAliases should be called with null as oldLabel
        expect(mockAliasSyncService.syncAliases).toHaveBeenCalledWith(
          mockFile,
          null,
          "New Label"
        );
      });

      it("should handle label change from string to non-string", async () => {
        // Arrange
        const metadata = {
          exo__Asset_label: "Original Label",
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: metadata,
        });

        // Act
        await (plugin as any).handleMetadataChange(mockFile);

        // Change to non-string
        const newMetadata = {
          exo__Asset_label: null,
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: newMetadata,
        });

        await (plugin as any).handleMetadataChange(mockFile);

        // Assert
        expect(mockAliasSyncService.syncAliases).not.toHaveBeenCalled();
      });

      it("should cache label value correctly", async () => {
        // Arrange
        const label1 = "Label 1";
        const label2 = "Label 2";
        const label3 = "Label 3";

        const metadata = {
          exo__Asset_label: label1,
        };
        mockMetadataCache.getFileCache.mockReturnValue({
          frontmatter: metadata,
        });

        // Act
        await (plugin as any).handleMetadataChange(mockFile);
        metadata.exo__Asset_label = label2;
        await (plugin as any).handleMetadataChange(mockFile);
        metadata.exo__Asset_label = label3;
        await (plugin as any).handleMetadataChange(mockFile);

        // Assert
        expect(mockAliasSyncService.syncAliases).toHaveBeenCalledTimes(2);
        expect(mockAliasSyncService.syncAliases).toHaveBeenNthCalledWith(
          1,
          mockFile,
          label1,
          label2
        );
        expect(mockAliasSyncService.syncAliases).toHaveBeenNthCalledWith(
          2,
          mockFile,
          label2,
          label3
        );
      });
    });
  });

  describe("removeAutoRenderedLayouts", () => {
    it("should remove all auto-rendered layout elements", () => {
      // Arrange
      const layout1 = document.createElement("div");
      layout1.className = "exocortex-auto-layout";
      document.body.appendChild(layout1);

      const layout2 = document.createElement("div");
      layout2.className = "exocortex-auto-layout";
      document.body.appendChild(layout2);

      const otherElement = document.createElement("div");
      otherElement.className = "other-class";
      document.body.appendChild(otherElement);

      // Act
      (plugin as any).removeAutoRenderedLayouts();

      // Assert
      expect(document.querySelectorAll(".exocortex-auto-layout").length).toBe(0);
      expect(document.querySelectorAll(".other-class").length).toBe(1);

      // Cleanup
      otherElement.remove();
    });
  });

  describe("Event handlers", () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it("should handle metadata resolved event", async () => {
      // Get the resolved event handler
      const resolvedCall = mockMetadataCache.on.mock.calls.find(
        call => call[0] === "resolved"
      );
      const resolvedHandler = resolvedCall?.[1];

      // Act
      resolvedHandler();

      // Assert
      expect(mockLayoutRenderer.invalidateBacklinksCache).toHaveBeenCalled();
    });

    it("should handle metadata changed event", async () => {
      // Arrange
      const mockFile = { path: "test.md" } as TFile;
      const changedCall = mockMetadataCache.on.mock.calls.find(
        call => call[0] === "changed"
      );
      const changedHandler = changedCall?.[1];

      mockMetadataCache.getFileCache.mockReturnValue({
        frontmatter: { test: "data" },
      });

      // Act
      await changedHandler(mockFile);

      // Assert
      expect(mockTaskTrackingService.handleFileChange).toHaveBeenCalledWith(mockFile);
    });

    it("should handle file-open event", async () => {
      // Arrange
      const mockFile = { path: "test.md" } as TFile;
      const fileOpenCall = mockWorkspace.on.mock.calls.find(
        call => call[0] === "file-open"
      );
      const fileOpenHandler = fileOpenCall?.[1];

      // Act
      fileOpenHandler(mockFile);

      // Wait for 150ms setTimeout in handler
      await waitForCondition(
        () => mockWorkspace.getActiveViewOfType.mock.calls.length > 0,
        { timeout: 500, message: "getActiveViewOfType not called" }
      );

      // Assert
      expect(mockWorkspace.getActiveViewOfType).toHaveBeenCalled();
    });

    it("should handle active-leaf-change event", async () => {
      // Arrange
      const leafChangeCall = mockWorkspace.on.mock.calls.find(
        call => call[0] === "active-leaf-change"
      );
      const leafChangeHandler = leafChangeCall?.[1];

      // Clear previous calls from file-open test
      mockWorkspace.getActiveViewOfType.mockClear();

      // Act
      leafChangeHandler();

      // Wait for 150ms setTimeout in handler
      await waitForCondition(
        () => mockWorkspace.getActiveViewOfType.mock.calls.length > 0,
        { timeout: 500, message: "getActiveViewOfType not called" }
      );

      // Assert
      expect(mockWorkspace.getActiveViewOfType).toHaveBeenCalled();
    });

    it("should handle layout-change event", async () => {
      // Arrange
      const layoutChangeCall = mockWorkspace.on.mock.calls.find(
        call => call[0] === "layout-change"
      );
      const layoutChangeHandler = layoutChangeCall?.[1];

      // Clear previous calls from other event tests
      mockWorkspace.getActiveViewOfType.mockClear();

      // Act
      layoutChangeHandler();

      // Wait for 150ms setTimeout in handler
      await waitForCondition(
        () => mockWorkspace.getActiveViewOfType.mock.calls.length > 0,
        { timeout: 500, message: "getActiveViewOfType not called" }
      );

      // Assert
      expect(mockWorkspace.getActiveViewOfType).toHaveBeenCalled();
    });
  });

  describe("SPARQL processor integration", () => {
    it("should register SPARQL code block processor", async () => {
      // Arrange
      await plugin.onload();

      // Assert
      expect(plugin.registerMarkdownCodeBlockProcessor).toHaveBeenCalledWith(
        "sparql",
        expect.any(Function)
      );

      // Get the registered processor function
      const processorCall = (plugin.registerMarkdownCodeBlockProcessor as jest.Mock).mock.calls[0];
      const processorFn = processorCall[1];

      // Test that it calls the SPARQL processor
      const source = "SELECT * WHERE { ?s ?p ?o }";
      const el = document.createElement("div");
      const ctx = {} as any;

      // Act
      processorFn(source, el, ctx);

      // Assert
      expect(mockSparqlProcessor.process).toHaveBeenCalledWith(source, el, ctx);
    });
  });

  describe("Layout persistence for embedded assets", () => {
    beforeEach(async () => {
      await plugin.onload();
    });

    it("should set up MutationObserver when rendering layout", () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Act
      (plugin as any).autoRenderLayout();

      // Assert
      expect((plugin as any).layoutPersistenceObserver).not.toBeNull();
      expect((plugin as any).layoutPersistenceObserver).toBeInstanceOf(MutationObserver);
    });

    it("should disconnect previous MutationObserver when rendering new layout", () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // First render
      (plugin as any).autoRenderLayout();
      const firstObserver = (plugin as any).layoutPersistenceObserver;
      const disconnectSpy = jest.spyOn(firstObserver, 'disconnect');

      // Act - render again
      (plugin as any).autoRenderLayout();

      // Assert
      expect(disconnectSpy).toHaveBeenCalled();
      expect((plugin as any).layoutPersistenceObserver).not.toBe(firstObserver);
    });

    it("should disconnect MutationObserver on plugin unload", async () => {
      // Arrange
      plugin.settings.layoutVisible = true;
      (plugin as any).autoRenderLayout();
      const observer = (plugin as any).layoutPersistenceObserver;
      const disconnectSpy = jest.spyOn(observer, 'disconnect');

      // Act
      await plugin.onunload();

      // Assert
      expect(disconnectSpy).toHaveBeenCalled();
      expect((plugin as any).layoutPersistenceObserver).toBeNull();
    });

    it("should re-render layout when it is removed from DOM (simulating embed re-render)", async () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Initial render
      (plugin as any).autoRenderLayout();
      await flushPromises();

      // Verify initial layout exists
      let layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(1);

      // Reset mock to track re-render
      mockLayoutRenderer.render.mockClear();

      // Act - Simulate Obsidian re-rendering due to embed processing
      // This removes our layout container
      const layoutContainer = mockView.containerEl.querySelector(".exocortex-auto-layout");
      layoutContainer?.remove();

      // Wait for MutationObserver callback and debounce
      await new Promise(resolve => setTimeout(resolve, 100));
      await flushPromises();

      // Assert - Layout should be re-inserted
      layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(1);
      expect(mockLayoutRenderer.render).toHaveBeenCalled();
    });

    it("should not re-render when layout is removed but settings hide layout", async () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Initial render
      (plugin as any).autoRenderLayout();
      await flushPromises();

      // Reset mock
      mockLayoutRenderer.render.mockClear();

      // Hide layout in settings
      plugin.settings.layoutVisible = false;

      // Act - Remove layout
      const layoutContainer = mockView.containerEl.querySelector(".exocortex-auto-layout");
      layoutContainer?.remove();

      // Wait for MutationObserver callback
      await new Promise(resolve => setTimeout(resolve, 100));
      await flushPromises();

      // Assert - Layout should NOT be re-rendered
      const layoutContainers = mockView.containerEl.querySelectorAll(".exocortex-auto-layout");
      expect(layoutContainers.length).toBe(0);
      expect(mockLayoutRenderer.render).not.toHaveBeenCalled();
    });

    it("should not re-render when metadata container is also removed (view switching)", async () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Initial render
      (plugin as any).autoRenderLayout();
      await flushPromises();

      // Reset mock
      mockLayoutRenderer.render.mockClear();

      // Act - Remove both metadata container and layout (simulating view switch)
      mockView.containerEl.innerHTML = "";

      // Wait for MutationObserver callback
      await new Promise(resolve => setTimeout(resolve, 100));
      await flushPromises();

      // Assert - Layout should NOT be re-rendered (metadata container gone)
      expect(mockLayoutRenderer.render).not.toHaveBeenCalled();
    });

    it("should debounce multiple rapid re-renders", async () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Initial render
      (plugin as any).autoRenderLayout();
      await flushPromises();

      // Verify initial layout
      expect(mockView.containerEl.querySelectorAll(".exocortex-auto-layout").length).toBe(1);

      // Reset mock
      mockLayoutRenderer.render.mockClear();

      // Act - Rapidly remove and trigger multiple mutations
      for (let i = 0; i < 5; i++) {
        const layout = mockView.containerEl.querySelector(".exocortex-auto-layout");
        layout?.remove();
        // Small delay between removals
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Wait for debounce to settle
      await new Promise(resolve => setTimeout(resolve, 150));
      await flushPromises();

      // Assert - Should only render once due to debouncing
      // Note: The exact count may vary due to timing, but should be minimal
      expect(mockLayoutRenderer.render.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it("should handle errors during re-render gracefully", async () => {
      // Arrange
      plugin.settings.layoutVisible = true;

      // Initial render
      (plugin as any).autoRenderLayout();
      await flushPromises();

      // Reset mock and setup to fail
      mockLayoutRenderer.render.mockClear();
      const error = new Error("Re-render failed");
      mockLayoutRenderer.render.mockRejectedValue(error);

      // Act - Remove layout to trigger re-render
      const layoutContainer = mockView.containerEl.querySelector(".exocortex-auto-layout");
      layoutContainer?.remove();

      // Wait for MutationObserver callback
      await new Promise(resolve => setTimeout(resolve, 100));
      await flushPromises();

      // Assert - Error should be logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to re-render layout after embed processing",
        error
      );
    });
  });
});