import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import * as path from "path";

/**
 * E2E (req 4425f655) — the bidirectional plugin-settings live-mirror:
 * a UI setting change is auto-written (live) into its `exo__Setting` vault
 * asset. Drives the REAL production path in real Obsidian:
 *   settingsHomoiconizationEnabled → initVaultSettings (constructs the store
 *   with outboundWriteEnabled: true — the feature under test) → migrateMissing
 *   → saveSettings → pushChangedFields → the vault asset is updated.
 *
 * Revert (production-tied): removing `outboundWriteEnabled: true` from
 * `ExocortexPlugin.initVaultSettings` makes the store read-only → the outbound
 * assertion + the asset-value poll fail.
 *
 * @flaky-track — Docker metadataCache + a trailing write-debounce; the sibling
 * `alias-sync-on-label-change` write test carries the same tag. Serial + a
 * best-effort afterAll that leaves the shared test-vault as found.
 */
test.describe.configure({ mode: "serial" });

test.describe(
  "Settings live-mirror — bidirectional UI→asset auto-write (req 4425f655)",
  { tag: ["@flaky-track"] },
  () => {
    let launcher: ObsidianLauncher;

    test.beforeAll(async () => {
      const vaultPath = path.join(__dirname, "../test-vault");
      launcher = new ObsidianLauncher(vaultPath);
      await launcher.launch();
    });

    test.afterAll(async () => {
      // Leave the shared test-vault as found: disable homoiconization and
      // delete any exocortex-settings/ assets this spec migrated.
      try {
        const window = await launcher.getWindow();
        await window.evaluate(async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const app = (window as any).app;
          const plugin = app?.plugins?.plugins?.exocortex;
          if (plugin) {
            plugin.settings.settingsHomoiconizationEnabled = false;
            plugin.vaultSettingsStore = null;
            await plugin.saveData(plugin.settings);
          }
          if (app?.vault) {
            const created = app.vault
              .getMarkdownFiles()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .filter((f: any) => f.path.startsWith("exocortex-settings/"));
            for (const f of created) {
              try {
                await app.vault.delete(f);
              } catch {
                /* best-effort */
              }
            }
          }
        });
      } catch {
        /* best-effort cleanup */
      }
      if (launcher) {
        await launcher.close();
      }
    });

    test("@req:4425f655-e034-44b8-9258-db1650dd8b12 a UI setting change is auto-written into its exo__Setting vault asset (bidirectional live-mirror)", async () => {
      await launcher.openFile("e2e-icon-target-task.md");
      const window = await launcher.getWindow();
      await waitForExocortexPluginViaPlaywright(window, {
        specName: "settings-live-mirror",
      });

      // 1. Enable homoiconization and run the REAL production initVaultSettings
      //    — it constructs the store with outboundWriteEnabled:true (the
      //    feature under test) and migrates an exo__Setting asset per field.
      const setup = await window.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (window as any).app;
        const plugin = app?.plugins?.plugins?.exocortex;
        if (!plugin) return { ok: false as const, error: "plugin not loaded" };
        plugin.settings.settingsHomoiconizationEnabled = true;
        plugin.settingsBaseline = { ...plugin.settings };
        await plugin.saveData(plugin.settings);
        plugin.vaultSettingsStore = null;
        await plugin.initVaultSettings();
        const store = plugin.vaultSettingsStore;
        const field = "showArchivedAssets";
        const assetPath =
          store && typeof store.knownFiles?.get === "function"
            ? (store.knownFiles.get(field) ?? null)
            : null;
        return {
          ok: !!store,
          outboundWriteEnabled: store ? store.outboundWriteEnabled : null,
          field,
          assetPath,
          before: plugin.settings[field] as boolean,
        };
      });

      expect(setup.ok).toBe(true);
      // The production wiring MUST construct the store outbound-ENABLED.
      expect(setup.outboundWriteEnabled).toBe(true);
      expect(setup.assetPath).toBeTruthy();

      // 2. Change the setting in the UI (saveSettings → pushChangedFields →
      //    trailing-debounced outbound write) to the OPPOSITE value.
      const next = !setup.before;
      await window.evaluate(
        async ({ field, next }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const app = (window as any).app;
          const plugin = app.plugins.plugins.exocortex;
          plugin.settings[field] = next;
          await plugin.saveSettings();
          // Flush the trailing debounce so the write lands deterministically.
          await plugin.vaultSettingsStore.flushWrites();
        },
        { field: setup.field, next },
      );

      // 3. The exo__Setting asset now carries the NEW value (UI→asset mirror).
      await expect
        .poll(
          async () =>
            window.evaluate(async (assetPath: string) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const app = (window as any).app;
              const file = app.vault.getAbstractFileByPath(assetPath);
              if (!file) return null;
              const content: string = await app.vault.read(file);
              const m = content.match(/^exo__Setting_value:\s*(.+)$/m);
              return m ? m[1].trim() : null;
            }, setup.assetPath as string),
          { timeout: 10_000, intervals: [200, 500, 500, 1000, 1000, 2000] },
        )
        .toBe(String(next));
    });
  },
);
