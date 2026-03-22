import {
  setupCommandManagerTest,
  CommandManagerTestContext,
  Notice,
} from "./CommandManager.fixtures";

describe("CommandManager - toggle commands", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  describe("Reload Layout Command", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should be always available", () => {
      const command = ctx.registeredCommands.get("reload-layout");
      expect(command).toBeDefined();
      expect(typeof command.callback).toBe("function");
    });

    it("should call reload callback when executed", () => {
      const mockCallback = jest.fn();
      ctx.commandManager.registerAllCommands(ctx.mockPlugin, mockCallback);

      const command = ctx.registeredCommands.get("reload-layout");
      command.callback();

      expect(mockCallback).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Layout reloaded");
    });

    it("should show failure notice when callback not set", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);

      const command = ctx.registeredCommands.get("reload-layout");
      command.callback();

      expect(Notice).toHaveBeenCalledWith("Failed to reload layout");
    });
  });

  describe("Add Supervision Command", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should be always available", () => {
      const command = ctx.registeredCommands.get("add-supervision");
      expect(command).toBeDefined();
      expect(typeof command.callback).toBe("function");
    });
  });

  describe("Toggle Layout Visibility Command", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should be always available", () => {
      const command = ctx.registeredCommands.get("toggle-layout-visibility");
      expect(command).toBeDefined();
      expect(typeof command.callback).toBe("function");
    });

    it("should toggle layout visibility when executed", async () => {
      const command = ctx.registeredCommands.get("toggle-layout-visibility");

      expect(ctx.mockPlugin.settings.layoutVisible).toBe(true);
      await command.callback();
      expect(ctx.mockPlugin.settings.layoutVisible).toBe(false);

      await command.callback();
      expect(ctx.mockPlugin.settings.layoutVisible).toBe(true);
    });

    it("should save settings when toggled", async () => {
      const command = ctx.registeredCommands.get("toggle-layout-visibility");
      await command.callback();

      expect(ctx.mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("should refresh layout when toggled", async () => {
      const command = ctx.registeredCommands.get("toggle-layout-visibility");
      await command.callback();

      expect(ctx.mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should show notice when toggled to shown", async () => {
      ctx.mockPlugin.settings.layoutVisible = false;
      const command = ctx.registeredCommands.get("toggle-layout-visibility");
      await command.callback();

      expect(Notice).toHaveBeenCalledWith("Layout shown");
    });

    it("should show notice when toggled to hidden", async () => {
      ctx.mockPlugin.settings.layoutVisible = true;
      const command = ctx.registeredCommands.get("toggle-layout-visibility");
      await command.callback();

      expect(Notice).toHaveBeenCalledWith("Layout hidden");
    });
  });

  describe("Toggle Archived Assets Visibility Command", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should be always available", () => {
      const command = ctx.registeredCommands.get(
        "toggle-archived-assets-visibility",
      );
      expect(command).toBeDefined();
      expect(typeof command.callback).toBe("function");
    });

    it("should toggle archived assets visibility when executed", async () => {
      const command = ctx.registeredCommands.get(
        "toggle-archived-assets-visibility",
      );

      expect(ctx.mockPlugin.settings.showArchivedAssets).toBe(false);
      await command.callback();
      expect(ctx.mockPlugin.settings.showArchivedAssets).toBe(true);

      await command.callback();
      expect(ctx.mockPlugin.settings.showArchivedAssets).toBe(false);
    });

    it("should save settings when toggled", async () => {
      const command = ctx.registeredCommands.get(
        "toggle-archived-assets-visibility",
      );
      await command.callback();

      expect(ctx.mockPlugin.saveSettings).toHaveBeenCalled();
    });

    it("should refresh layout when toggled", async () => {
      const command = ctx.registeredCommands.get(
        "toggle-archived-assets-visibility",
      );
      await command.callback();

      expect(ctx.mockPlugin.refreshLayout).toHaveBeenCalled();
    });

    it("should show notice when toggled to shown", async () => {
      ctx.mockPlugin.settings.showArchivedAssets = false;
      const command = ctx.registeredCommands.get(
        "toggle-archived-assets-visibility",
      );
      await command.callback();

      expect(Notice).toHaveBeenCalledWith("Archived assets shown");
    });

    it("should show notice when toggled to hidden", async () => {
      ctx.mockPlugin.settings.showArchivedAssets = true;
      const command = ctx.registeredCommands.get(
        "toggle-archived-assets-visibility",
      );
      await command.callback();

      expect(Notice).toHaveBeenCalledWith("Archived assets hidden");
    });
  });
});
