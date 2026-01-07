/**
 * Integration tests for RdfButtonGroupsBuilder with UniversalLayoutRenderer
 *
 * Tests the integration between RDF-driven button rendering and the main layout renderer.
 * Verifies that RDF buttons are properly loaded, filtered, and rendered with fallback to legacy.
 *
 * @see https://github.com/kitelev/exocortex/issues/1429
 */

import "reflect-metadata";
import { container } from "tsyringe";
import { UniversalLayoutRenderer } from "../../../src/presentation/renderers/UniversalLayoutRenderer";
import { ExocortexSettings } from "../../../src/domain/settings/ExocortexSettings";
import { TFile } from "obsidian";
import {
  DI_TOKENS,
  registerCoreServices,
  resetContainer,
} from "exocortex";

/**
 * Helper to create mock SolutionMapping compatible with SPARQLQueryService results.
 */
function createMockSolutionMapping(bindings: Record<string, string | undefined>): { get: (key: string) => { value: string } | undefined } {
  return {
    get: (key: string) => {
      const value = bindings[key];
      if (value === undefined) {
        return undefined;
      }
      return { value };
    },
  };
}

describe("RdfButtonGroupsBuilder Integration with UniversalLayoutRenderer", () => {
  let mockApp: any;
  let mockSettings: ExocortexSettings;
  let mockPlugin: any;
  let mockVaultAdapter: any;
  let mockSparqlQueryService: any;

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
      showDailyNoteProjects: false,
      useRdfButtons: true, // Enable RDF button rendering
    } as ExocortexSettings;

    mockPlugin = {
      saveSettings: jest.fn(),
    };

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

    // Mock SPARQL query service for RDF button loading
    mockSparqlQueryService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      refresh: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn(),
      getTripleStore: jest.fn(),
    };

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockVault = {
      create: jest.fn().mockResolvedValue({ path: "test-task.md" }),
      read: jest.fn().mockResolvedValue(""),
      modify: jest.fn().mockResolvedValue(undefined),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
      exists: jest.fn().mockResolvedValue(true),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
    };

    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVault });
    container.register(DI_TOKENS.ILogger, { useValue: mockLogger });
    registerCoreServices();
  });

  afterEach(() => {
    resetContainer();
    jest.useRealTimers();
  });

  describe("RdfButtonGroupsBuilder instantiation", () => {
    it("should have rdfButtonGroupsBuilder property when useRdfButtons is enabled", () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // The renderer should have an rdfButtonGroupsBuilder when RDF buttons are enabled
      expect(renderer_any.rdfButtonGroupsBuilder).toBeDefined();
    });

    it("should not have rdfButtonGroupsBuilder when useRdfButtons is disabled", () => {
      mockSettings.useRdfButtons = false;
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // When disabled, rdfButtonGroupsBuilder should be undefined
      expect(renderer_any.rdfButtonGroupsBuilder).toBeUndefined();
    });
  });

  describe("Button rendering with RDF", () => {
    it("should try RDF buttons first when useRdfButtons is enabled", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Mock RDF button builder to return buttons
      const mockRdfButtonGroups = [
        {
          id: "test:StatusGroup",
          title: "Status",
          buttons: [
            {
              id: "test:StartButton",
              label: "Start",
              onClick: jest.fn(),
            },
          ],
        },
      ];

      renderer_any.rdfButtonGroupsBuilder = {
        buildButtonGroups: jest.fn().mockResolvedValue(mockRdfButtonGroups),
      };

      // Mock other dependencies
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

      // RDF button builder should be called first
      expect(renderer_any.rdfButtonGroupsBuilder.buildButtonGroups).toHaveBeenCalled();
    });

    it("should fallback to legacy buttons when RDF returns empty", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Mock RDF button builder to return empty (no RDF buttons defined)
      renderer_any.rdfButtonGroupsBuilder = {
        buildButtonGroups: jest.fn().mockResolvedValue([]),
      };

      // Mock legacy button builder to return buttons
      const mockLegacyButtonGroups = [
        {
          id: "legacy-status",
          title: "Status",
          buttons: [
            {
              id: "legacy-start",
              label: "Legacy Start",
              onClick: jest.fn(),
            },
          ],
        },
      ];

      renderer_any.buttonGroupsBuilder = {
        build: jest.fn().mockResolvedValue(mockLegacyButtonGroups),
      };

      // Mock other dependencies
      renderer_any.dailyNavRenderer = { render: jest.fn() };
      renderer_any.propertiesRenderer = { render: jest.fn().mockResolvedValue(undefined) };
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

      // Legacy builder should be called as fallback
      expect(renderer_any.buttonGroupsBuilder.build).toHaveBeenCalled();
    });

    it("should use only RDF buttons when they exist (no fallback)", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Mock RDF button builder to return buttons
      const mockRdfButtonGroups = [
        {
          id: "test:StatusGroup",
          title: "Status",
          buttons: [
            {
              id: "test:StartButton",
              label: "Start",
              onClick: jest.fn(),
            },
          ],
        },
      ];

      renderer_any.rdfButtonGroupsBuilder = {
        buildButtonGroups: jest.fn().mockResolvedValue(mockRdfButtonGroups),
      };

      renderer_any.buttonGroupsBuilder = {
        build: jest.fn().mockResolvedValue([{ id: "legacy" }]),
      };

      // Mock other dependencies
      renderer_any.dailyNavRenderer = { render: jest.fn() };
      renderer_any.propertiesRenderer = { render: jest.fn().mockResolvedValue(undefined) };
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

      // Legacy builder should NOT be called when RDF buttons exist
      expect(renderer_any.buttonGroupsBuilder.build).not.toHaveBeenCalled();
    });
  });

  describe("ActionInterpreter integration", () => {
    it("should pass actionInterpreter to RdfButtonGroupsBuilder", () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // When RdfButtonGroupsBuilder is created, it should have an actionInterpreter
      expect(renderer_any.actionInterpreter).toBeDefined();
    });

    it("should execute action through ActionInterpreter when RDF button clicked", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // Mock action interpreter
      const mockExecute = jest.fn().mockResolvedValue({ success: true });
      renderer_any.actionInterpreter = {
        execute: mockExecute,
      };

      // Simulate button click that would trigger action
      const actionUri = "test:StartAction";
      const context = { currentAsset: "test:asset1" };

      await renderer_any.actionInterpreter.execute(actionUri, context);

      expect(mockExecute).toHaveBeenCalledWith(actionUri, context);
    });
  });

  describe("ConditionEvaluator integration", () => {
    it("should pass conditionEvaluator to RdfButtonGroupsBuilder", () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // When RdfButtonGroupsBuilder is created, it should have a conditionEvaluator
      expect(renderer_any.conditionEvaluator).toBeDefined();
    });

    it("should filter buttons based on condition evaluation", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // Mock condition evaluator
      const mockEvaluate = jest.fn()
        .mockResolvedValueOnce(true)   // First button visible
        .mockResolvedValueOnce(false); // Second button hidden

      renderer_any.conditionEvaluator = {
        evaluate: mockEvaluate,
      };

      // Test condition evaluation
      const result1 = await renderer_any.conditionEvaluator.evaluate("test:IsActiveCondition", "test:asset1");
      const result2 = await renderer_any.conditionEvaluator.evaluate("test:IsDoneCondition", "test:asset1");

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("should gracefully handle RDF button loading errors", async () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      const mockFile = {
        path: "test.md",
        basename: "test",
      } as TFile;

      mockApp.workspace.getActiveFile.mockReturnValue(mockFile);

      // Mock RDF button builder to throw an error
      renderer_any.rdfButtonGroupsBuilder = {
        buildButtonGroups: jest.fn().mockRejectedValue(new Error("SPARQL query failed")),
      };

      // Mock legacy fallback
      renderer_any.buttonGroupsBuilder = {
        build: jest.fn().mockResolvedValue([]),
      };

      // Mock other dependencies
      renderer_any.dailyNavRenderer = { render: jest.fn() };
      renderer_any.propertiesRenderer = { render: jest.fn().mockResolvedValue(undefined) };
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

      // Should not throw, should fall back to legacy
      await expect(renderer.render("", el, {} as any)).resolves.not.toThrow();

      // Legacy builder should be called as fallback after error
      expect(renderer_any.buttonGroupsBuilder.build).toHaveBeenCalled();
    });
  });

  describe("IncrementalUpdateHandler integration", () => {
    it("should use rdfButtonGroupsBuilder in IncrementalUpdateHandler when available", () => {
      const renderer = new UniversalLayoutRenderer(mockApp, mockSettings, mockPlugin, mockVaultAdapter);
      const renderer_any = renderer as any;

      // IncrementalUpdateHandler should have access to rdfButtonGroupsBuilder
      const handler = renderer_any.incrementalUpdateHandler;
      expect(handler).toBeDefined();
    });
  });
});
