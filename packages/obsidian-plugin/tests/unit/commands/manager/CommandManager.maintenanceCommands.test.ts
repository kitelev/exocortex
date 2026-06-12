import {
  setupCommandManagerTest,
  CommandManagerTestContext,
} from "./CommandManager.fixtures";

describe("CommandManager - maintenance commands (vault-driven)", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  const vaultDrivenMaintenanceCommands = [
    "clean-properties",
    "repair-folder",
    "rename-to-uid",
    "vote-on-effort",
    "copy-label-to-aliases",
    "add-supervision",
  ];

  describe("Maintenance commands are now vault-driven via CommandResolver", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    vaultDrivenMaintenanceCommands.forEach((commandId) => {
      it(`should NOT register ${commandId} statically (moved to vault)`, () => {
        expect(ctx.registeredCommands.has(commandId)).toBe(false);
      });
    });
  });

  describe("Global maintenance commands still registered", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    it("should register edit-properties as global command", () => {
      const command = ctx.registeredCommands.get("edit-properties");
      expect(command).toBeDefined();
    });

    it("should NOT register open-sparql-query-builder (removed in EKA Phase A C1)", () => {
      // RFC 78c2b7d0 §5: OpenQueryBuilderCommand TS class deleted (verified dead).
      expect(ctx.registeredCommands.has("open-sparql-query-builder")).toBe(false);
    });
  });
});
