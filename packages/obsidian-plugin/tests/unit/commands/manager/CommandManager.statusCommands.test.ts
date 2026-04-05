import {
  setupCommandManagerTest,
  CommandManagerTestContext,
} from "./CommandManager.fixtures";

describe("CommandManager - status commands (vault-driven)", () => {
  let ctx: CommandManagerTestContext;

  beforeEach(() => {
    ctx = setupCommandManagerTest();
  });

  const vaultDrivenStatusCommands = [
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
    "mark-reviewed",
    "trash-effort",
    "archive-task",
  ];

  describe("Status commands are now vault-driven via CommandResolver", () => {
    beforeEach(() => {
      ctx.commandManager.registerAllCommands(ctx.mockPlugin);
    });

    vaultDrivenStatusCommands.forEach((commandId) => {
      it(`should NOT register ${commandId} statically (moved to vault)`, () => {
        expect(ctx.registeredCommands.has(commandId)).toBe(false);
      });
    });
  });
});
