import { ExocmdCommandPaletteRegistrar } from "../../../../src/application/services/ExocmdCommandPaletteRegistrar";
import type {
  CommandResolver,
  CommandExecutionFlow,
  IVaultSettings,
  CommandDefinition,
} from "exocortex";
import type { ExocortexPluginInterface } from "../../../../src/types";
import type { ILogger } from "../../../../src/adapters/logging/ILogger";

function makeCommand(
  overrides?: Partial<CommandDefinition>,
): CommandDefinition {
  return {
    id: "cmd-uid",
    name: "Test command",
    grounding: {
      id: "g1",
      label: "g1",
      type: "property_set" as never,
      targetProperty: "ems__Effort_status",
      targetValue: "x",
    } as never,
    ...overrides,
  };
}

interface Harness {
  plugin: {
    addCommand: jest.Mock;
  };
  commandResolver: {
    findPaletteEnabledCommands: jest.Mock;
  };
  commandExecutionFlow: {
    run: jest.Mock;
  };
  vaultSettings: { getOwnerIdentity: jest.Mock } & Partial<IVaultSettings>;
  logger: jest.Mocked<ILogger>;
  registrar: ExocmdCommandPaletteRegistrar;
}

function makeHarness(
  entries: Array<{ command: CommandDefinition; paletteId: string }>,
  ownerIdentity = '"[[!kitelev]]"',
): Harness {
  const plugin = { addCommand: jest.fn() };
  const commandResolver = {
    findPaletteEnabledCommands: jest.fn().mockResolvedValue(entries),
  };
  const commandExecutionFlow = { run: jest.fn().mockResolvedValue(undefined) };
  const vaultSettings = {
    getOwnerIdentity: jest.fn().mockReturnValue(ownerIdentity),
  };
  const logger: jest.Mocked<ILogger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const registrar = new ExocmdCommandPaletteRegistrar(
    plugin as unknown as ExocortexPluginInterface,
    commandResolver as unknown as CommandResolver,
    commandExecutionFlow as unknown as CommandExecutionFlow,
    vaultSettings as unknown as IVaultSettings,
    logger,
  );

  return {
    plugin,
    commandResolver,
    commandExecutionFlow,
    vaultSettings,
    logger,
    registrar,
  };
}

describe("ExocmdCommandPaletteRegistrar", () => {
  describe("init()", () => {
    it("registers nothing when no palette-enabled commands found", async () => {
      const h = makeHarness([]);
      await h.registrar.init();
      expect(h.plugin.addCommand).not.toHaveBeenCalled();
    });

    it("registers one Obsidian command per resolved entry", async () => {
      const h = makeHarness([
        {
          command: makeCommand({ name: "Create fleeting note" }),
          paletteId: "create-fleeting-note",
        },
        {
          command: makeCommand({ id: "cmd-2", name: "Other" }),
          paletteId: "other-id",
        },
      ]);
      await h.registrar.init();
      expect(h.plugin.addCommand).toHaveBeenCalledTimes(2);
    });

    it("uses paletteId from resolver as Obsidian command id", async () => {
      const h = makeHarness([
        {
          command: makeCommand({ name: "Foo" }),
          paletteId: "stable-hotkey-id",
        },
      ]);
      await h.registrar.init();
      const arg = h.plugin.addCommand.mock.calls[0][0];
      expect(arg.id).toBe("stable-hotkey-id");
      expect(arg.name).toBe("Foo");
      expect(typeof arg.callback).toBe("function");
    });

    it("callback invokes commandExecutionFlow.run with null targetIRI/filePath + injected ownerIdentity", async () => {
      const cmd = makeCommand({ name: "Create" });
      const h = makeHarness(
        [{ command: cmd, paletteId: "create" }],
        '"[[!alice]]"',
      );
      await h.registrar.init();

      const arg = h.plugin.addCommand.mock.calls[0][0];
      await arg.callback();

      expect(h.commandExecutionFlow.run).toHaveBeenCalledTimes(1);
      const [rc, ctx] = h.commandExecutionFlow.run.mock.calls[0];
      expect(rc.command).toBe(cmd);
      expect(ctx.targetIRI).toBeNull();
      expect(ctx.filePath).toBeNull();
      expect(ctx.injectedUserInput).toEqual({ ownerIdentity: '"[[!alice]]"' });
    });

    it("captures owner identity at registration time (snapshot, not lazy)", async () => {
      const h = makeHarness(
        [{ command: makeCommand(), paletteId: "id" }],
        "initial",
      );
      await h.registrar.init();

      // Later setting change must NOT leak into the existing callback.
      h.vaultSettings.getOwnerIdentity.mockReturnValue("changed");
      const arg = h.plugin.addCommand.mock.calls[0][0];
      await arg.callback();

      const [, ctx] = h.commandExecutionFlow.run.mock.calls[0];
      expect(ctx.injectedUserInput).toEqual({ ownerIdentity: "initial" });
    });

    it("does not throw or register anything when commandResolver fails — logs error", async () => {
      const h = makeHarness([]);
      h.commandResolver.findPaletteEnabledCommands.mockRejectedValue(
        new Error("triple-store offline"),
      );

      await expect(h.registrar.init()).resolves.toBeUndefined();
      expect(h.plugin.addCommand).not.toHaveBeenCalled();
      expect(h.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to resolve palette-enabled commands"),
        expect.any(Error),
      );
    });

    it("logs info per registered command", async () => {
      const h = makeHarness([
        { command: makeCommand({ name: "X" }), paletteId: "x" },
      ]);
      await h.registrar.init();
      expect(h.logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Registered "X" as palette command "x"/),
      );
    });
  });
});
