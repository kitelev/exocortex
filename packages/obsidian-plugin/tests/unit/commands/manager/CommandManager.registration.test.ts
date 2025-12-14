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

      expect(ctx.mockPlugin.addCommand).toHaveBeenCalledTimes(34);
    });

    it("should register commands with correct IDs", () => {
      const registeredCommandIds: string[] = [];
      ctx.mockPlugin.addCommand = jest.fn((command: any) => {
        registeredCommandIds.push(command.id);
      });

      ctx.commandManager.registerAllCommands(ctx.mockPlugin);

      expect(registeredCommandIds).toContain("create-task");
      expect(registeredCommandIds).toContain("create-project");
      expect(registeredCommandIds).toContain("create-area");
      expect(registeredCommandIds).toContain("create-instance");
      expect(registeredCommandIds).toContain("create-fleeting-note");
      expect(registeredCommandIds).toContain("create-related-task");
      expect(registeredCommandIds).toContain("set-draft-status");
      expect(registeredCommandIds).toContain("move-to-backlog");
      expect(registeredCommandIds).toContain("move-to-analysis");
      expect(registeredCommandIds).toContain("move-to-todo");
      expect(registeredCommandIds).toContain("start-effort");
      expect(registeredCommandIds).toContain("plan-on-today");
      expect(registeredCommandIds).toContain("plan-for-evening");
      expect(registeredCommandIds).toContain("shift-day-backward");
      expect(registeredCommandIds).toContain("shift-day-forward");
      expect(registeredCommandIds).toContain("mark-done");
      expect(registeredCommandIds).toContain("trash-effort");
      expect(registeredCommandIds).toContain("archive-task");
      expect(registeredCommandIds).toContain("clean-properties");
      expect(registeredCommandIds).toContain("repair-folder");
      expect(registeredCommandIds).toContain("rename-to-uid");
      expect(registeredCommandIds).toContain("vote-on-effort");
      expect(registeredCommandIds).toContain("copy-label-to-aliases");
      expect(registeredCommandIds).toContain("reload-layout");
      expect(registeredCommandIds).toContain("add-supervision");
      expect(registeredCommandIds).toContain("toggle-properties-visibility");
      expect(registeredCommandIds).toContain("toggle-layout-visibility");
      expect(registeredCommandIds).toContain(
        "toggle-archived-assets-visibility",
      );
      expect(registeredCommandIds).toContain("set-focus-area");
      expect(registeredCommandIds).toContain("open-sparql-query-builder");
    });

    it("should register commands with correct names", () => {
      const registeredNames: string[] = [];
      ctx.mockPlugin.addCommand = jest.fn((command: any) => {
        registeredNames.push(command.name);
      });

      ctx.commandManager.registerAllCommands(ctx.mockPlugin);

      expect(registeredNames).toContain("Create task");
      expect(registeredNames).toContain("Create project");
      expect(registeredNames).toContain("Create area");
      expect(registeredNames).toContain("Create instance");
      expect(registeredNames).toContain("Create fleeting note");
      expect(registeredNames).toContain("Create related task");
      expect(registeredNames).toContain("Set draft status");
      expect(registeredNames).toContain("Move to backlog");
      expect(registeredNames).toContain("Move to analysis");
      expect(registeredNames).toContain("Move to to-do");
      expect(registeredNames).toContain("Start effort");
      expect(registeredNames).toContain("Plan on today");
      expect(registeredNames).toContain("Plan for evening (19:00)");
      expect(registeredNames).toContain("Shift day backward");
      expect(registeredNames).toContain("Shift day forward");
      expect(registeredNames).toContain("Mark as done");
      expect(registeredNames).toContain("Trash");
      expect(registeredNames).toContain("Archive task");
      expect(registeredNames).toContain("Clean empty properties");
      expect(registeredNames).toContain("Repair folder");
      expect(registeredNames).toContain("Rename to uid");
      expect(registeredNames).toContain("Vote on effort");
      expect(registeredNames).toContain("Copy label to aliases");
      expect(registeredNames).toContain("Reload layout");
      expect(registeredNames).toContain("Add supervision");
      expect(registeredNames).toContain("Toggle properties visibility");
      expect(registeredNames).toContain("Toggle layout visibility");
      expect(registeredNames).toContain("Toggle archived assets visibility");
      expect(registeredNames).toContain("open sparql query builder");
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

  describe("Command Visibility - No Active File", () => {
    beforeEach(() => {
      ctx.mockApp.workspace.getActiveFile.mockReturnValue(null);
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    const checkCallbackCommands = [
      "create-task",
      "create-project",
      "create-area",
      "create-instance",
      "create-related-task",
      "set-draft-status",
      "move-to-backlog",
      "move-to-analysis",
      "move-to-todo",
      "start-effort",
      "plan-on-today",
      "plan-for-evening",
      "shift-day-backward",
      "shift-day-forward",
      "mark-done",
      "trash-effort",
      "archive-task",
      "clean-properties",
      "repair-folder",
      "rename-to-uid",
      "vote-on-effort",
      "copy-label-to-aliases",
    ];

    checkCallbackCommands.forEach((commandId) => {
      it(`should return false for ${commandId} when no active file`, () => {
        const command = ctx.registeredCommands.get(commandId);
        expect(command).toBeDefined();
        const result = command.checkCallback(true);
        expect(result).toBe(false);
      });
    });
  });
});
