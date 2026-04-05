import {
  setupCommandManagerTest,
  CommandManagerTestContext,
  CommandManager,
} from "./CommandManager.fixtures";

describe("CommandManager - registration", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  describe("Constructor", () => {
    it("should be instantiable with App", () => {
      const mockApp = {} as any;
      const commandManager = new CommandManager(mockApp);

      expect(commandManager).toBeDefined();
      expect(commandManager).toBeInstanceOf(CommandManager);
    });
  });

  describe("Service Dependencies", () => {
    it("should initialize with required services", () => {
      const mockApp = {
        vault: {},
        metadataCache: {},
        workspace: {},
      } as any;

      const commandManager = new CommandManager(mockApp);

      expect(commandManager).toBeDefined();
    });
  });

  describe("registerAllCommands", () => {
    it("should not throw when registering commands", () => {
      expect(() => {
        ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      }).not.toThrow();

      expect(ctx.mockPlugin.addCommand).toHaveBeenCalledTimes(7);
    });

    it("should register global commands with correct IDs", () => {
      const registeredCommandIds: string[] = [];
      ctx.mockPlugin.addCommand = jest.fn((command: any) => {
        registeredCommandIds.push(command.id);
      });

      ctx.commandManager.registerAllCommands(ctx.mockPlugin);

      expect(registeredCommandIds).toContain("reload-layout");
      expect(registeredCommandIds).toContain("toggle-layout-visibility");
      expect(registeredCommandIds).toContain("toggle-archived-assets-visibility");
      expect(registeredCommandIds).toContain("open-sparql-query-builder");
      expect(registeredCommandIds).toContain("edit-properties");
      expect(registeredCommandIds).toContain("create-asset");
      expect(registeredCommandIds).toContain("create-fleeting-note");
    });

    it("should register commands with checkCallback or callback function", () => {
      const registeredCommands: any[] = [];
      ctx.mockPlugin.addCommand = jest.fn((command: any) => {
        registeredCommands.push(command);
      });

      ctx.commandManager.registerAllCommands(ctx.mockPlugin);

      registeredCommands.forEach((command) => {
        const hasCheckCallback = typeof command.checkCallback === "function";
        const hasCallback = typeof command.callback === "function";
        expect(hasCheckCallback || hasCallback).toBe(true);
      });
    });

    it("should store reload layout callback", () => {
      const mockCallback = jest.fn();
      ctx.commandManager.registerAllCommands(ctx.mockPlugin, mockCallback);

      const reloadCommand = ctx.registeredCommands.get("reload-layout");
      expect(reloadCommand).toBeDefined();
      expect(typeof reloadCommand.callback).toBe("function");

      reloadCommand.callback();
      expect(mockCallback).toHaveBeenCalled();
    });
  });
});
