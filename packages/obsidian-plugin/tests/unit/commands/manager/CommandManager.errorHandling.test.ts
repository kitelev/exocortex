import {
  setupCommandManagerTest,
  CommandManagerTestContext,
  Notice,
} from "./CommandManager.fixtures";

describe("CommandManager - error handling (global commands)", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  describe("Reload Layout without callback", () => {
    it("should show failure notice when callback is not set", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);

      const command = ctx.registeredCommands.get("reload-layout");
      command.callback();

      expect(Notice).toHaveBeenCalledWith("✗ Failed to reload layout", expect.any(Number));
    });
  });

  describe("Global commands handle errors gracefully", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should handle toggle-layout-visibility when saveSettings rejects", async () => {
      ctx.mockPlugin.saveSettings.mockRejectedValueOnce(new Error("Save failed"));
      const command = ctx.registeredCommands.get("toggle-layout-visibility");

      await expect(command.callback()).rejects.toThrow("Save failed");
    });

    it("should handle toggle-archived-assets when saveSettings rejects", async () => {
      ctx.mockPlugin.saveSettings.mockRejectedValueOnce(new Error("Save failed"));
      const command = ctx.registeredCommands.get("toggle-archived-assets-visibility");

      await expect(command.callback()).rejects.toThrow("Save failed");
    });
  });

  describe("Per-asset error handling is now vault-driven", () => {
    it("should not have per-asset commands to test error handling on", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      expect(ctx.registeredCommands.has("start-effort")).toBe(false);
      expect(ctx.registeredCommands.has("mark-done")).toBe(false);
      expect(ctx.registeredCommands.has("trash-effort")).toBe(false);
    });
  });
});
