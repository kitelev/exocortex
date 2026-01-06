/**
 * Navigation Commands Unit Tests
 *
 * Tests for RDF-defined navigation commands:
 * - GoToParentCommand
 * - GoToProjectCommand
 * - GoToAreaCommand
 *
 * @see https://github.com/kitelev/exocortex/issues/1441
 */

import "reflect-metadata";
import { RdfCommandRegistry, RdfCommand } from "../../../src/application/commands/RdfCommandRegistry";
import { Plugin, App } from "obsidian";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";

/**
 * Helper to create a mock SolutionMapping that behaves like the real class.
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

// Mock SPARQLQueryService
jest.mock("../../../src/application/services/SPARQLQueryService", () => ({
  SPARQLQueryService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    refresh: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
    getTripleStore: jest.fn(),
  })),
}));

// Mock LoggerFactory
jest.mock("../../../src/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("Navigation Commands (Issue #1441)", () => {
  let mockPlugin: jest.Mocked<Plugin>;
  let mockApp: App;
  let mockSparqlService: jest.Mocked<SPARQLQueryService>;
  let registry: RdfCommandRegistry;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getName: jest.fn().mockReturnValue("Test Vault"),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
      workspace: {
        getActiveFile: jest.fn(),
      },
    } as unknown as App;

    mockPlugin = {
      app: mockApp,
      addCommand: jest.fn(),
      registerEvent: jest.fn(),
    } as unknown as jest.Mocked<Plugin>;

    mockSparqlService = new SPARQLQueryService(mockApp) as jest.Mocked<SPARQLQueryService>;
    mockSparqlService.query = jest.fn().mockResolvedValue([]);
    mockSparqlService.initialize = jest.fn().mockResolvedValue(undefined);

    registry = new RdfCommandRegistry(mockPlugin, mockSparqlService);
  });

  describe("GoToParentCommand", () => {
    const goToParentCommand = createMockSolutionMapping({
      cmd: "https://exocortex.my/ontology/ems-ui#GoToParentCommand",
      id: "go-to-parent",
      name: "Go to Parent",
      icon: "arrow-up",
      hotkey: "Mod+Up",
      action: "https://exocortex.my/ontology/ems-ui#NavigateToParentAction",
      condition: "https://exocortex.my/ontology/ems-ui#HasParent",
    });

    it("should load GoToParentCommand from RDF", async () => {
      mockSparqlService.query.mockResolvedValue([goToParentCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe("go-to-parent");
      expect(commands[0].name).toBe("Go to Parent");
    });

    it("should have condition for GoToParent", async () => {
      mockSparqlService.query.mockResolvedValue([goToParentCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].condition).toBe("https://exocortex.my/ontology/ems-ui#HasParent");
    });

    it("should have arrow-up icon", async () => {
      mockSparqlService.query.mockResolvedValue([goToParentCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].icon).toBe("arrow-up");
    });

    it("should have Mod+Up hotkey", () => {
      const result = registry.parseHotkey("Mod+Up");

      expect(result).toEqual({
        modifiers: ["Mod"],
        key: "ArrowUp",
      });
    });

    it("should register with checkCallback due to condition", async () => {
      mockSparqlService.query.mockResolvedValue([goToParentCommand]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "go-to-parent",
          name: "Go to Parent",
          checkCallback: expect.any(Function),
        }),
      );
    });

    it("should link to NavigateToParentAction", async () => {
      mockSparqlService.query.mockResolvedValue([goToParentCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].action).toBe("https://exocortex.my/ontology/ems-ui#NavigateToParentAction");
    });
  });

  describe("GoToProjectCommand", () => {
    const goToProjectCommand = createMockSolutionMapping({
      cmd: "https://exocortex.my/ontology/ems-ui#GoToProjectCommand",
      id: "go-to-project",
      name: "Go to Project",
      icon: "folder",
      hotkey: "Mod+P",
      action: "https://exocortex.my/ontology/ems-ui#NavigateToProjectAction",
      condition: "https://exocortex.my/ontology/ems-ui#HasProject",
    });

    it("should load GoToProjectCommand from RDF", async () => {
      mockSparqlService.query.mockResolvedValue([goToProjectCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe("go-to-project");
      expect(commands[0].name).toBe("Go to Project");
    });

    it("should have HasProject condition", async () => {
      mockSparqlService.query.mockResolvedValue([goToProjectCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].condition).toBe("https://exocortex.my/ontology/ems-ui#HasProject");
    });

    it("should have folder icon", async () => {
      mockSparqlService.query.mockResolvedValue([goToProjectCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].icon).toBe("folder");
    });

    it("should have Mod+P hotkey", () => {
      const result = registry.parseHotkey("Mod+P");

      expect(result).toEqual({
        modifiers: ["Mod"],
        key: "P",
      });
    });

    it("should link to NavigateToProjectAction", async () => {
      mockSparqlService.query.mockResolvedValue([goToProjectCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].action).toBe("https://exocortex.my/ontology/ems-ui#NavigateToProjectAction");
    });
  });

  describe("GoToAreaCommand", () => {
    const goToAreaCommand = createMockSolutionMapping({
      cmd: "https://exocortex.my/ontology/ems-ui#GoToAreaCommand",
      id: "go-to-area",
      name: "Go to Area",
      icon: "map-pin",
      hotkey: "Mod+A",
      action: "https://exocortex.my/ontology/ems-ui#NavigateToAreaAction",
      condition: "https://exocortex.my/ontology/ems-ui#HasArea",
    });

    it("should load GoToAreaCommand from RDF", async () => {
      mockSparqlService.query.mockResolvedValue([goToAreaCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe("go-to-area");
      expect(commands[0].name).toBe("Go to Area");
    });

    it("should have HasArea condition", async () => {
      mockSparqlService.query.mockResolvedValue([goToAreaCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].condition).toBe("https://exocortex.my/ontology/ems-ui#HasArea");
    });

    it("should have map-pin icon", async () => {
      mockSparqlService.query.mockResolvedValue([goToAreaCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].icon).toBe("map-pin");
    });

    it("should have Mod+A hotkey", () => {
      const result = registry.parseHotkey("Mod+A");

      expect(result).toEqual({
        modifiers: ["Mod"],
        key: "A",
      });
    });

    it("should link to NavigateToAreaAction", async () => {
      mockSparqlService.query.mockResolvedValue([goToAreaCommand]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands[0].action).toBe("https://exocortex.my/ontology/ems-ui#NavigateToAreaAction");
    });
  });

  describe("All Navigation Commands Together", () => {
    const allNavigationCommands = [
      createMockSolutionMapping({
        cmd: "https://exocortex.my/ontology/ems-ui#GoToParentCommand",
        id: "go-to-parent",
        name: "Go to Parent",
        icon: "arrow-up",
        hotkey: "Mod+Up",
        action: "https://exocortex.my/ontology/ems-ui#NavigateToParentAction",
        condition: "https://exocortex.my/ontology/ems-ui#HasParent",
      }),
      createMockSolutionMapping({
        cmd: "https://exocortex.my/ontology/ems-ui#GoToProjectCommand",
        id: "go-to-project",
        name: "Go to Project",
        icon: "folder",
        hotkey: "Mod+P",
        action: "https://exocortex.my/ontology/ems-ui#NavigateToProjectAction",
        condition: "https://exocortex.my/ontology/ems-ui#HasProject",
      }),
      createMockSolutionMapping({
        cmd: "https://exocortex.my/ontology/ems-ui#GoToAreaCommand",
        id: "go-to-area",
        name: "Go to Area",
        icon: "map-pin",
        hotkey: "Mod+A",
        action: "https://exocortex.my/ontology/ems-ui#NavigateToAreaAction",
        condition: "https://exocortex.my/ontology/ems-ui#HasArea",
      }),
    ];

    it("should load all 3 navigation commands", async () => {
      mockSparqlService.query.mockResolvedValue(allNavigationCommands);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      expect(commands).toHaveLength(3);
    });

    it("should register all 3 commands with Obsidian", async () => {
      mockSparqlService.query.mockResolvedValue(allNavigationCommands);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledTimes(3);
    });

    it("should have all commands with conditions (checkCallback)", async () => {
      mockSparqlService.query.mockResolvedValue(allNavigationCommands);

      await registry.loadFromTripleStore();

      const calls = mockPlugin.addCommand.mock.calls;
      for (const [cmd] of calls) {
        expect(cmd.checkCallback).toBeDefined();
        expect(cmd.callback).toBeUndefined();
      }
    });

    it("should have unique command IDs", async () => {
      mockSparqlService.query.mockResolvedValue(allNavigationCommands);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      const ids = commands.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it("should have unique hotkeys", async () => {
      mockSparqlService.query.mockResolvedValue(allNavigationCommands);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();
      const hotkeys = commands.map((c) => c.hotkey);
      const uniqueHotkeys = new Set(hotkeys);
      expect(uniqueHotkeys.size).toBe(3);
    });
  });

  describe("Condition Evaluation for Navigation", () => {
    it("should return true when no condition is specified", async () => {
      const commandNoCondition: RdfCommand = {
        uri: "uri:cmd",
        id: "test",
        name: "Test",
      };

      const result = await registry.checkCondition(commandNoCondition, null);

      expect(result).toBe(true);
    });

    it("should evaluate HasParent condition via SPARQL", async () => {
      const command: RdfCommand = {
        uri: "https://exocortex.my/ontology/ems-ui#GoToParentCommand",
        id: "go-to-parent",
        name: "Go to Parent",
        condition: "ASK { ?asset ems:Asset_parent ?parent }",
      };

      // Mock SPARQL ASK query returning true (parent exists)
      mockSparqlService.query.mockResolvedValue([{ result: true }]);

      const result = await registry.checkCondition(command, null);

      expect(mockSparqlService.query).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when condition is not met", async () => {
      const command: RdfCommand = {
        uri: "https://exocortex.my/ontology/ems-ui#GoToParentCommand",
        id: "go-to-parent",
        name: "Go to Parent",
        condition: "ASK { ?asset ems:Asset_parent ?parent }",
      };

      // Mock SPARQL ASK query returning false (no parent)
      mockSparqlService.query.mockResolvedValue([]);

      const result = await registry.checkCondition(command, null);

      expect(result).toBe(false);
    });

    it("should cache condition results", async () => {
      const command: RdfCommand = {
        uri: "https://exocortex.my/ontology/ems-ui#GoToParentCommand",
        id: "go-to-parent",
        name: "Go to Parent",
        condition: "ASK { ?asset ems:Asset_parent ?parent }",
      };

      mockSparqlService.query.mockResolvedValue([{ result: true }]);

      // Call twice
      await registry.checkCondition(command, null);
      await registry.checkCondition(command, null);

      // Should only query once due to caching
      expect(mockSparqlService.query).toHaveBeenCalledTimes(1);
    });
  });
});
