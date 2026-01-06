/**
 * RdfCommandRegistry Unit Tests
 *
 * Tests for RDF-driven command loading and registration.
 *
 * @see https://github.com/kitelev/exocortex/issues/1433
 */

import "reflect-metadata";
import { RdfCommandRegistry, RdfCommand } from "../../../src/application/commands/RdfCommandRegistry";
import { Plugin, App } from "obsidian";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";

/**
 * Helper to create a mock SolutionMapping that behaves like the real class.
 * The real SolutionMapping uses .get(variableName) to retrieve values.
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

// Mock LoggerFactory - use arrow function without jest.fn() to survive clearAllMocks
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

describe("RdfCommandRegistry", () => {
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

  describe("constructor", () => {
    it("should create instance with plugin and sparql service", () => {
      expect(registry).toBeInstanceOf(RdfCommandRegistry);
    });
  });

  describe("loadFromTripleStore", () => {
    it("should query commands from RDF", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await registry.loadFromTripleStore();

      expect(mockSparqlService.query).toHaveBeenCalled();
    });

    it("should register commands with Obsidian plugin", async () => {
      // Mock SPARQL results with command data
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: "https://exocortex.my/instance/TestCommand",
          id: "test-command",
          name: "Test Command",
          icon: "star",
        }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalled();
    });

    it("should register correct number of commands", async () => {
      // Mock multiple commands
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({ cmd: "uri:cmd1", id: "cmd1", name: "Command 1" }),
        createMockSolutionMapping({ cmd: "uri:cmd2", id: "cmd2", name: "Command 2" }),
        createMockSolutionMapping({ cmd: "uri:cmd3", id: "cmd3", name: "Command 3" }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledTimes(3);
    });

    it("should skip commands without id", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({ cmd: "uri:cmd1", name: "Command 1" }), // Missing id
        createMockSolutionMapping({ cmd: "uri:cmd2", id: "cmd2", name: "Command 2" }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledTimes(1);
    });

    it("should skip commands without name", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({ cmd: "uri:cmd1", id: "cmd1" }), // Missing name
        createMockSolutionMapping({ cmd: "uri:cmd2", id: "cmd2", name: "Command 2" }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe("queryCommands", () => {
    it("should execute SPARQL query for commands", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const commands = await registry.queryCommands();

      expect(mockSparqlService.query).toHaveBeenCalled();
      expect(commands).toEqual([]);
    });

    it("should parse command data from SPARQL results", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: "https://exocortex.my/instance/CreateTaskCommand",
          id: "exocortex:create-task",
          name: "Create Task",
          icon: "plus-circle",
          hotkey: "Mod+Shift+T",
          action: "https://exocortex.my/action/CreateTaskAction",
          condition: "https://exocortex.my/condition/AlwaysTrue",
        }),
      ]);

      const commands = await registry.queryCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        uri: "https://exocortex.my/instance/CreateTaskCommand",
        id: "exocortex:create-task",
        name: "Create Task",
        icon: "plus-circle",
        hotkey: "Mod+Shift+T",
      });
    });

    it("should handle optional fields", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: "uri:cmd",
          id: "test",
          name: "Test",
          // No icon, hotkey, action, or condition
        }),
      ]);

      const commands = await registry.queryCommands();

      expect(commands).toHaveLength(1);
      expect(commands[0].icon).toBeUndefined();
      expect(commands[0].hotkey).toBeUndefined();
    });
  });

  describe("parseHotkey", () => {
    it("should parse Mod+Shift+T format", () => {
      const result = registry.parseHotkey("Mod+Shift+T");

      expect(result).toEqual({
        modifiers: ["Mod", "Shift"],
        key: "T",
      });
    });

    it("should parse single modifier hotkey", () => {
      const result = registry.parseHotkey("Mod+D");

      expect(result).toEqual({
        modifiers: ["Mod"],
        key: "D",
      });
    });

    it("should parse Alt modifier", () => {
      const result = registry.parseHotkey("Alt+Enter");

      expect(result).toEqual({
        modifiers: ["Alt"],
        key: "Enter",
      });
    });

    it("should parse complex modifier combinations", () => {
      const result = registry.parseHotkey("Mod+Shift+Alt+K");

      expect(result).toEqual({
        modifiers: ["Mod", "Shift", "Alt"],
        key: "K",
      });
    });

    it("should handle arrow keys", () => {
      const result = registry.parseHotkey("Mod+Up");

      expect(result).toEqual({
        modifiers: ["Mod"],
        key: "ArrowUp",
      });
    });

    it("should handle Down arrow", () => {
      const result = registry.parseHotkey("Mod+Down");

      expect(result).toEqual({
        modifiers: ["Mod"],
        key: "ArrowDown",
      });
    });

    it("should return undefined for empty string", () => {
      const result = registry.parseHotkey("");

      expect(result).toBeUndefined();
    });

    it("should return undefined for null/undefined", () => {
      expect(registry.parseHotkey(null as unknown as string)).toBeUndefined();
      expect(registry.parseHotkey(undefined as unknown as string)).toBeUndefined();
    });

    it("should parse Ctrl modifier", () => {
      const result = registry.parseHotkey("Ctrl+S");

      expect(result).toEqual({
        modifiers: ["Ctrl"],
        key: "S",
      });
    });
  });

  describe("checkCondition", () => {
    it("should return true when no condition is specified", async () => {
      const command: RdfCommand = {
        uri: "uri:cmd",
        id: "test",
        name: "Test",
      };

      const result = await registry.checkCondition(command, null);

      expect(result).toBe(true);
    });

    it("should evaluate SPARQL ASK condition", async () => {
      const command: RdfCommand = {
        uri: "uri:cmd",
        id: "test",
        name: "Test",
        condition: "ASK { ?s ?p ?o }",
      };

      mockSparqlService.query.mockResolvedValue([{ result: true }]);

      const result = await registry.checkCondition(command, null);

      expect(mockSparqlService.query).toHaveBeenCalled();
    });

    it("should cache condition results for performance", async () => {
      const command: RdfCommand = {
        uri: "uri:cmd",
        id: "test",
        name: "Test",
        condition: "ASK { ?s ?p ?o }",
      };

      mockSparqlService.query.mockResolvedValue([{ result: true }]);

      // Call twice
      await registry.checkCondition(command, null);
      await registry.checkCondition(command, null);

      // Should only query once due to caching
      expect(mockSparqlService.query).toHaveBeenCalledTimes(1);
    });

    it("should invalidate cache after timeout", async () => {
      // Use fake timers for this test
      jest.useFakeTimers();

      const command: RdfCommand = {
        uri: "uri:cmd",
        id: "test",
        name: "Test",
        condition: "ASK { ?s ?p ?o }",
      };

      mockSparqlService.query.mockResolvedValue([{ result: true }]);

      await registry.checkCondition(command, null);

      // Advance time past cache timeout (default 1000ms)
      jest.advanceTimersByTime(1500);

      await registry.checkCondition(command, null);

      expect(mockSparqlService.query).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe("getLoadedCommands", () => {
    it("should return empty array before loading", () => {
      const commands = registry.getLoadedCommands();

      expect(commands).toEqual([]);
    });

    it("should return loaded commands after loadFromTripleStore", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({ cmd: "uri:cmd1", id: "cmd1", name: "Command 1" }),
        createMockSolutionMapping({ cmd: "uri:cmd2", id: "cmd2", name: "Command 2" }),
      ]);

      await registry.loadFromTripleStore();

      const commands = registry.getLoadedCommands();

      expect(commands).toHaveLength(2);
    });
  });

  describe("clearConditionCache", () => {
    it("should clear all cached conditions", async () => {
      const command: RdfCommand = {
        uri: "uri:cmd",
        id: "test",
        name: "Test",
        condition: "ASK { ?s ?p ?o }",
      };

      mockSparqlService.query.mockResolvedValue([{ result: true }]);

      await registry.checkCondition(command, null);
      registry.clearConditionCache();
      await registry.checkCondition(command, null);

      // Should query twice since cache was cleared
      expect(mockSparqlService.query).toHaveBeenCalledTimes(2);
    });
  });

  describe("integration with Obsidian commands", () => {
    it("should register command with icon", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: "uri:cmd",
          id: "test-cmd",
          name: "Test Command",
          icon: "star",
        }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-cmd",
          name: "Test Command",
          icon: "star",
        }),
      );
    });

    it("should register command with hotkey", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: "uri:cmd",
          id: "test-cmd",
          name: "Test Command",
          hotkey: "Mod+Shift+T",
        }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-cmd",
          name: "Test Command",
          hotkeys: [{ modifiers: ["Mod", "Shift"], key: "T" }],
        }),
      );
    });

    it("should register command with checkCallback when condition exists", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: "uri:cmd",
          id: "test-cmd",
          name: "Test Command",
          condition: "ASK { ?s ?p ?o }",
        }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-cmd",
          name: "Test Command",
          checkCallback: expect.any(Function),
        }),
      );
    });

    it("should register command with callback when no condition exists", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({
          cmd: "uri:cmd",
          id: "test-cmd",
          name: "Test Command",
          action: "uri:action",
        }),
      ]);

      await registry.loadFromTripleStore();

      expect(mockPlugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-cmd",
          name: "Test Command",
          callback: expect.any(Function),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("should handle SPARQL query errors gracefully", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("SPARQL error"));

      await expect(registry.loadFromTripleStore()).resolves.not.toThrow();
    });

    it("should log errors when command registration fails", async () => {
      mockSparqlService.query.mockResolvedValue([
        createMockSolutionMapping({ cmd: "uri:cmd", id: "test", name: "Test" }),
      ]);
      mockPlugin.addCommand.mockImplementation(() => {
        throw new Error("Registration failed");
      });

      await expect(registry.loadFromTripleStore()).resolves.not.toThrow();
    });
  });
});
