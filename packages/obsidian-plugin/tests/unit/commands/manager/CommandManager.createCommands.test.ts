import {
  setupCommandManagerTest,
  CommandManagerTestContext,
} from "./CommandManager.fixtures";

describe("CommandManager - create commands (vault-driven)", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  describe("Global create commands", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should NOT register create-fleeting-note (migrated to vault exocmd asset)", () => {
      // RFC 1429fcd0 PR-3: registered by ExocmdCommandPaletteRegistrar
      // from the vault asset 692aa011-..., not by CommandManager.
      expect(ctx.registeredCommands.has("create-fleeting-note")).toBe(false);
    });

    it("should register create-asset as global command", () => {
      const command = ctx.registeredCommands.get("create-asset");
      expect(command).toBeDefined();
      expect(typeof command.callback).toBe("function");
    });
  });

  describe("Per-asset create commands are now vault-driven", () => {
    it("should NOT register create-task statically (moved to vault)", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      expect(ctx.registeredCommands.has("create-task")).toBe(false);
    });

    it("should NOT register create-project statically (moved to vault)", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      expect(ctx.registeredCommands.has("create-project")).toBe(false);
    });

    it("should NOT register create-area statically (moved to vault)", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      expect(ctx.registeredCommands.has("create-area")).toBe(false);
    });

    it("should NOT register create-instance statically (moved to vault)", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      expect(ctx.registeredCommands.has("create-instance")).toBe(false);
    });

    it("should NOT register create-related-task statically (moved to vault)", () => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
      expect(ctx.registeredCommands.has("create-related-task")).toBe(false);
    });
  });
});
