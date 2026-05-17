import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E smoke for RFC 1429fcd0 PR-3: verify the vault `exocmd__Command`
 * asset `692aa011-...` ("Create fleeting note") becomes a real Obsidian
 * Command Palette entry on plugin load, via
 * `ExocmdCommandPaletteRegistrar`.
 *
 * Fixture: `exocmd/creation/692aa011-...md` +
 * `exocmd/creation/c84e2e08-...md` (added in this PR).
 *
 * Scope: registration-side smoke. Full file-creation path (modal →
 * createAsset → file with `[[!kitelev]]`) is covered by L1 unit tests
 * in `CommandResolver.test.ts`, `ExocmdCommandPaletteRegistrar.test.ts`,
 * and `ServiceRegistryPopulator.test.ts`. End-to-end click + write would
 * additionally require a `ztlk__FleetingNotePrototype` fixture + the
 * `03 Knowledge/inbox` folder in the test vault; left for a follow-up
 * if the smoke surface proves insufficient.
 */
test.describe("Create fleeting note — Palette registration smoke", () => {
  let launcher: ObsidianLauncher;

  test.beforeAll(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterAll(async () => {
    if (launcher) {
      await launcher.close();
    }
  });

  test("registers create-fleeting-note as a global Obsidian command", async () => {
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;

      // Wait for plugin load (registrar runs synchronously in onload).
      for (let i = 0; i < 30; i++) {
        if (app?.plugins?.plugins?.exocortex) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      const plugin = app?.plugins?.plugins?.exocortex;
      if (!plugin) {
        return { success: false, reason: "plugin not loaded" };
      }

      // Obsidian prefixes the plugin manifest id onto every addCommand id:
      // `{manifest.id}:{passed-id}` = `exocortex:create-fleeting-note`.
      const commandId = "exocortex:create-fleeting-note";
      const commands = app.commands?.commands ?? {};
      const command = commands[commandId];

      return {
        success: true,
        registered: typeof command === "object" && command !== null,
        commandName: command?.name,
      };
    });

    expect(result.success).toBe(true);
    expect(result.registered).toBe(true);
    // The label propagates from the vault asset's `exo__Asset_label`.
    // Obsidian prepends the plugin name (`Exocortex`) to displayed names
    // in the Command Palette, but `commands.commands[id].name` stores the
    // raw value as passed to `addCommand`.
    expect(result.commandName).toContain("Create fleeting note");
  });
});
