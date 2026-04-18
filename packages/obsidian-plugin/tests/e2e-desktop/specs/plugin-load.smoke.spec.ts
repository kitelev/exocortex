import { test, expect, _electron as electron } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/**
 * Desktop smoke E2E — runs on real macOS / Windows GHA runners.
 *
 * Goal: verify the Exocortex plugin loads inside a real Obsidian Electron
 * binary on each supported desktop OS. Triggered by the `e2e-desktop` PR
 * label and the nightly cron in `.github/workflows/e2e-desktop.yml`.
 *
 * The workflow installs Obsidian (brew on macOS, winget/choco on Windows),
 * exports OBSIDIAN_PATH, copies the freshly built plugin into the test
 * vault, and pre-populates the per-OS Obsidian config so the vault opens
 * trusted on first launch (no GUI dialog clicks).
 */

function getObsidianConfigDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "obsidian");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error("APPDATA env var is not defined on Windows runner");
    }
    return path.join(appData, "obsidian");
  }
  // Linux — kept for parity though this suite is desktop-matrix only.
  return path.join(os.homedir(), ".config", "obsidian");
}

function preregisterVault(vaultPath: string): void {
  const configDir = getObsidianConfigDir();
  fs.mkdirSync(configDir, { recursive: true });

  const obsidianJsonPath = path.join(configDir, "obsidian.json");
  const vaultId = "exo-desktop-smoke";
  const config = {
    vaults: {
      [vaultId]: {
        path: vaultPath,
        ts: Date.now(),
        open: true,
        trusted: true,
      },
    },
  };
  fs.writeFileSync(obsidianJsonPath, JSON.stringify(config, null, 2));

  // Pre-create per-vault config to avoid first-run ENOENT.
  const vaultConfigPath = path.join(configDir, `${vaultId}.json`);
  if (!fs.existsSync(vaultConfigPath)) {
    fs.writeFileSync(vaultConfigPath, "{}\n");
  }
}

test.describe("Exocortex desktop smoke", () => {
  test("plugin loads in Obsidian on this OS", async () => {
    test.setTimeout(120_000);

    const obsidianPath = process.env.OBSIDIAN_PATH;
    if (!obsidianPath || !fs.existsSync(obsidianPath)) {
      throw new Error(
        `OBSIDIAN_PATH is not set or does not exist: ${obsidianPath}`,
      );
    }

    const vaultPath = path.resolve(__dirname, "..", "test-vault");
    preregisterVault(vaultPath);

    // Verify plugin payload was copied by the workflow.
    const pluginManifest = path.join(
      vaultPath,
      ".obsidian",
      "plugins",
      "exocortex",
      "manifest.json",
    );
    expect(
      fs.existsSync(pluginManifest),
      `plugin manifest missing at ${pluginManifest}`,
    ).toBe(true);

    const electronApp = await electron.launch({
      executablePath: obsidianPath,
      args: [vaultPath],
      timeout: 60_000,
      env: {
        ...process.env,
        OBSIDIAN_DISABLE_GPU: "1",
      },
    });

    try {
      const window = await electronApp.firstWindow({ timeout: 30_000 });
      await window.waitForLoadState("domcontentloaded", { timeout: 30_000 });

      // Wait for Obsidian's app object — same pattern as the Docker launcher.
      await expect
        .poll(
          async () =>
            window.evaluate(() => {
              const win = window as unknown as { app?: { workspace?: unknown; vault?: unknown } };
              return Boolean(win.app && win.app.workspace && win.app.vault);
            }),
          { timeout: 60_000, message: "window.app did not become available" },
        )
        .toBe(true);

      // Plugin should be enabled (community-plugins.json + trusted vault).
      await expect
        .poll(
          async () =>
            window.evaluate(() => {
              const win = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, unknown> } };
              };
              return Boolean(win.app?.plugins?.plugins?.exocortex);
            }),
          { timeout: 30_000, message: "exocortex plugin not registered" },
        )
        .toBe(true);

      const meta = await window.evaluate(() => {
        const win = window as unknown as {
          app?: { plugins?: { plugins?: Record<string, { manifest?: { id?: string; version?: string } }> } };
        };
        const plugin = win.app?.plugins?.plugins?.exocortex;
        return {
          id: plugin?.manifest?.id ?? null,
          version: plugin?.manifest?.version ?? null,
        };
      });

      expect(meta.id).toBe("exocortex");
      expect(meta.version).toBeTruthy();
      console.log(`[smoke] plugin loaded: id=${meta.id} version=${meta.version}`);
    } finally {
      await electronApp.close().catch(() => {});
    }
  });
});
