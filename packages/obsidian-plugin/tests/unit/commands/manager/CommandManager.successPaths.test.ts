import {
  setupCommandManagerTest,
  CommandManagerTestContext,
  Notice,
} from "./CommandManager.fixtures";

describe("CommandManager - success paths (global commands)", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  describe("Global command execution", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should execute reload-layout successfully", () => {
      const mockCallback = jest.fn();
      ctx.commandManager.registerAllCommands(ctx.mockPlugin, mockCallback);

      const command = ctx.registeredCommands.get("reload-layout");
      command.callback();

      expect(mockCallback).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Layout reloaded");
    });

    it("should execute toggle-layout-visibility successfully", async () => {
      const command = ctx.registeredCommands.get("toggle-layout-visibility");
      await command.callback();

      expect(ctx.mockPlugin.saveSettings).toHaveBeenCalled();
      expect(ctx.mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should execute toggle-archived-assets-visibility successfully", async () => {
      const command = ctx.registeredCommands.get("toggle-archived-assets-visibility");
      await command.callback();

      expect(ctx.mockPlugin.saveSettings).toHaveBeenCalled();
      expect(ctx.mockPlugin.refreshLayout).toHaveBeenCalled();
    });
  });

  describe("Per-asset success paths are now vault-driven", () => {
    it("should have no per-asset commands registered statically", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);

      const perAssetIds = [
        "create-task", "create-project", "create-area",
        "set-draft-status", "move-to-backlog", "start-effort",
        "mark-done", "trash-effort",
      ];

      perAssetIds.forEach((id) => {
        expect(ctx.registeredCommands.has(id)).toBe(false);
      });
    });
  });
});
