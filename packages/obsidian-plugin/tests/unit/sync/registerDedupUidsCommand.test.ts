/**
 * registerDedupUidsCommand contract test (#3676) — the command id MUST stay
 * byte-exact (Obsidian persists hotkeys by id), it is registered on both
 * platforms (no Platform gate), and the callback MUST drive `invokeDedup`.
 */

import { registerDedupUidsCommand } from "../../../src/infrastructure/adapters/registerDedupUidsCommand";
import type { DedupUidsCommands } from "../../../src/infrastructure/adapters/DedupUidsCommands";

describe("registerDedupUidsCommand", () => {
  it("registers «Deduplicate uids» with the stable id and wires invokeDedup", () => {
    const registered: Array<{ id: string; name: string; callback: () => void }> =
      [];
    const plugin = {
      addCommand: (cmd: { id: string; name: string; callback: () => void }) => {
        registered.push(cmd);
        return cmd;
      },
    };
    let invoked = 0;
    const commands = {
      invokeDedup: async () => {
        invoked++;
      },
    } as unknown as DedupUidsCommands;

    registerDedupUidsCommand(plugin, commands);

    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe("exosync-dedup-uids");
    expect(registered[0].name).toBe("Deduplicate uids");
    registered[0].callback();
    expect(invoked).toBe(1);
  });
});
