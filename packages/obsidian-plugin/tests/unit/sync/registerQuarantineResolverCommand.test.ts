/**
 * registerQuarantineResolverCommand contract test (finding a0a3d1d6) — the
 * command id MUST stay byte-exact (Obsidian persists hotkeys by id) and the
 * callback MUST drive `invokeResolve`.
 */

import { registerQuarantineResolverCommand } from "../../../src/infrastructure/adapters/registerQuarantineResolverCommand";
import type { QuarantineResolverCommands } from "../../../src/infrastructure/adapters/QuarantineResolverCommands";

describe("registerQuarantineResolverCommand", () => {
  it("registers «Resolve sync conflicts» with the stable id and wires invokeResolve", () => {
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
      invokeResolve: async () => {
        invoked++;
      },
    } as unknown as QuarantineResolverCommands;

    registerQuarantineResolverCommand(plugin, commands);

    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe("exosync-resolve-conflicts");
    expect(registered[0].name).toBe("Resolve sync conflicts");
    registered[0].callback();
    expect(invoked).toBe(1);
  });
});
