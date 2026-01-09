import { CommandManager } from "../../../src/application/services/CommandManager";
import { App } from "obsidian";
import { ExocortexPluginInterface } from "@plugin/types";
import { RdfCommandRegistry } from "@plugin/application/commands/RdfCommandRegistry";
import { SPARQLQueryService } from "@plugin/application/services/SPARQLQueryService";

// Mock the dependencies
jest.mock("@plugin/application/commands/RdfCommandRegistry");
jest.mock("@plugin/application/services/SPARQLQueryService");
jest.mock("@plugin/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("CommandManager", () => {
  let commandManager: CommandManager;
  let mockApp: jest.Mocked<App>;
  let mockPlugin: jest.Mocked<ExocortexPluginInterface>;
  let mockRdfCommandRegistry: jest.Mocked<RdfCommandRegistry>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {} as jest.Mocked<App>;

    mockPlugin = {
      addCommand: jest.fn(),
      app: mockApp,
    } as unknown as jest.Mocked<ExocortexPluginInterface>;

    mockRdfCommandRegistry = {
      loadFromTripleStore: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RdfCommandRegistry>;

    (RdfCommandRegistry as jest.Mock).mockImplementation(() => mockRdfCommandRegistry);

    commandManager = new CommandManager(mockApp);
  });

  describe("constructor", () => {
    it("should create CommandManager with app instance", () => {
      expect(commandManager).toBeInstanceOf(CommandManager);
    });

    it("should not immediately create RdfCommandRegistry", () => {
      new CommandManager(mockApp);
      expect(RdfCommandRegistry).not.toHaveBeenCalled();
    });
  });

  describe("registerAllCommands", () => {
    it("should create SPARQLQueryService with app and logger", async () => {
      await commandManager.registerAllCommands(mockPlugin);

      expect(SPARQLQueryService).toHaveBeenCalledWith(
        mockApp,
        expect.objectContaining({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
        })
      );
    });

    it("should create RdfCommandRegistry with plugin and sparql service", async () => {
      await commandManager.registerAllCommands(mockPlugin);

      expect(RdfCommandRegistry).toHaveBeenCalledWith(
        mockPlugin,
        expect.any(Object)
      );
    });

    it("should call loadFromTripleStore on the registry", async () => {
      await commandManager.registerAllCommands(mockPlugin);

      expect(mockRdfCommandRegistry.loadFromTripleStore).toHaveBeenCalled();
    });

    it("should accept optional reloadLayoutCallback (for API compatibility)", async () => {
      const reloadCallback = jest.fn();

      await commandManager.registerAllCommands(mockPlugin, reloadCallback);

      // Callback is stored for API compatibility but not used directly
      expect(mockRdfCommandRegistry.loadFromTripleStore).toHaveBeenCalled();
    });

    it("should work without optional reloadLayoutCallback", async () => {
      await expect(
        commandManager.registerAllCommands(mockPlugin)
      ).resolves.not.toThrow();
    });

    it("should propagate errors from loadFromTripleStore", async () => {
      const error = new Error("Failed to load commands");
      mockRdfCommandRegistry.loadFromTripleStore.mockRejectedValue(error);

      await expect(
        commandManager.registerAllCommands(mockPlugin)
      ).rejects.toThrow("Failed to load commands");
    });

    it("should allow multiple registrations (overwrites previous registry)", async () => {
      await commandManager.registerAllCommands(mockPlugin);
      await commandManager.registerAllCommands(mockPlugin);

      // Should create a new registry each time
      expect(RdfCommandRegistry).toHaveBeenCalledTimes(2);
      expect(mockRdfCommandRegistry.loadFromTripleStore).toHaveBeenCalledTimes(2);
    });
  });
});
