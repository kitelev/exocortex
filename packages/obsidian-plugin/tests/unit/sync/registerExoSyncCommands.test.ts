/**
 * Palette registration for the ExoSync command set (#3473): the split
 * Pull / Push commands sit NEXT TO the default Sync command — Sync stays
 * the primary cycle (its id/name MUST stay byte-exact: Obsidian persists
 * hotkeys by command id), the split commands are advanced ergonomics, not
 * a replacement. Obsidian renders palette labels as
 * "<plugin name>: <command name>", so name "Pull" surfaces as
 * «Exocortex: Pull».
 */

jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  requestUrl: jest.fn(),
}));

import {
  registerExoSyncCommands,
  type ExoSyncCommandRegistrar,
} from "../../../src/infrastructure/adapters/registerExoSyncCommands";
import { SyncCommands } from "../../../src/infrastructure/adapters/SyncCommands";

interface RegisteredCommand {
  id: string;
  name: string;
  callback: () => void;
}

function makeCommands(): SyncCommands {
  return new SyncCommands({
    collectSpecs: async () => ({
      specs: [],
      asUidByRepoKey: new Map(),
      warnings: [],
    }),
    buildEngine: async () => {
      throw new Error("unreachable in registration tests");
    },
    isSwitchInProgress: () => false,
    notify: () => undefined,
  });
}

function makeRegistrar(): {
  plugin: ExoSyncCommandRegistrar;
  added: RegisteredCommand[];
} {
  const added: RegisteredCommand[] = [];
  const plugin: ExoSyncCommandRegistrar = {
    addCommand: (command) => {
      added.push(command);
      return command;
    },
  };
  return { plugin, added };
}

describe("registerExoSyncCommands (#3473)", () => {
  it("registers Sync (default, first), Pull, Push and the parity report with stable ids", () => {
    const { plugin, added } = makeRegistrar();

    registerExoSyncCommands(plugin, makeCommands());

    expect(added.map((c) => [c.id, c.name])).toEqual([
      ["exosync-sync", "Sync"],
      ["exosync-pull", "Pull"],
      ["exosync-push", "Push"],
      ["exosync-parity-report", "Sync parity report"],
    ]);
  });

  it("wires each palette callback to its SyncCommands entry point", () => {
    const commands = makeCommands();
    const spies = {
      "exosync-sync": jest
        .spyOn(commands, "invokeSync")
        .mockResolvedValue(undefined),
      "exosync-pull": jest
        .spyOn(commands, "invokePull")
        .mockResolvedValue(undefined),
      "exosync-push": jest
        .spyOn(commands, "invokePush")
        .mockResolvedValue(undefined),
      "exosync-parity-report": jest
        .spyOn(commands, "invokeParityReport")
        .mockResolvedValue(undefined),
    } as const;
    const { plugin, added } = makeRegistrar();
    registerExoSyncCommands(plugin, commands);

    for (const command of added) {
      command.callback();
    }

    for (const spy of Object.values(spies)) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
});
