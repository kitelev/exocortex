import {
  setupCommandManagerTest,
  CommandManagerTestContext,
  CommandManager,
} from "./CommandManager.fixtures";

describe("CommandManager - executeCommand", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
    ctx.commandManager.registerAllCommands(ctx.mockPlugin);
  });

  it("returns true for a registered global command id", () => {
    expect(ctx.registeredCommands.get("reload-layout")).toBeDefined();
    const result = ctx.commandManager.executeCommand("reload-layout");
    expect(result).toBe(true);
  });

  it("returns false for an unknown command id", () => {
    const result = ctx.commandManager.executeCommand("does-not-exist");
    expect(result).toBe(false);
  });

  it("returns false when commands have not been registered yet", () => {
    const fresh = new CommandManager({} as never);
    const result = fresh.executeCommand("reload-layout");
    expect(result).toBe(false);
  });
});
