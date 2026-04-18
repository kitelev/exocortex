import { test, expect, chromium, type Browser } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as http from "http";
import { spawn, type ChildProcess } from "child_process";

/**
 * Desktop smoke E2E — runs on real macOS / Windows GHA runners.
 *
 * Goal: verify the Exocortex plugin loads inside a real Obsidian Electron
 * binary on each supported desktop OS. Triggered by the `e2e-desktop` PR
 * label and the nightly cron in `.github/workflows/e2e-desktop.yml`.
 *
 * Implementation note: Obsidian strips `--inspect` from argv for security,
 * so `_electron.launch()` cannot attach. We spawn the binary directly with
 * `--remote-debugging-port=<port>` (Obsidian honours this flag — the
 * Docker e2e launcher relies on the same trick) and connect via
 * `chromium.connectOverCDP`. Trust dialog is suppressed by pre-creating
 * Obsidian's per-OS config with the smoke vault marked trusted.
 */

const CDP_PORT = 9222;

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

  const vaultConfigPath = path.join(configDir, `${vaultId}.json`);
  if (!fs.existsSync(vaultConfigPath)) {
    fs.writeFileSync(vaultConfigPath, "{}\n");
  }
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/json/version",
          method: "GET",
          timeout: 1000,
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
      req.end();
    };
    const retry = (): void => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`CDP port ${port} not ready after ${timeoutMs}ms`));
      } else {
        setTimeout(tick, 500);
      }
    };
    tick();
  });
}

test.describe("Exocortex desktop smoke", () => {
  test("plugin loads in Obsidian on this OS", async () => {
    test.setTimeout(180_000);

    const obsidianPath = process.env.OBSIDIAN_PATH;
    if (!obsidianPath || !fs.existsSync(obsidianPath)) {
      throw new Error(
        `OBSIDIAN_PATH is not set or does not exist: ${obsidianPath}`,
      );
    }

    const vaultPath = path.resolve(__dirname, "..", "test-vault");
    preregisterVault(vaultPath);

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

    let proc: ChildProcess | null = null;
    let browser: Browser | null = null;
    try {
      proc = spawn(
        obsidianPath,
        [vaultPath, `--remote-debugging-port=${CDP_PORT}`],
        {
          stdio: "inherit",
          env: { ...process.env, OBSIDIAN_DISABLE_GPU: "1" },
        },
      );

      console.log(`[smoke] Spawned Obsidian PID=${proc.pid}`);
      await waitForPort(CDP_PORT, 60_000);

      browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${CDP_PORT}`,
        { timeout: 30_000 },
      );

      const contexts = browser.contexts();
      if (contexts.length === 0) {
        throw new Error("No browser contexts after CDP connect");
      }
      const context = contexts[0];
      const pages = context.pages();
      const window =
        pages.length > 0
          ? pages[pages.length - 1]
          : await context.waitForEvent("page", { timeout: 30_000 });

      await window.waitForLoadState("domcontentloaded", { timeout: 30_000 });

      // Wait for Obsidian's app object.
      await expect
        .poll(
          async () =>
            window.evaluate(() => {
              const w = window as unknown as {
                app?: { workspace?: unknown; vault?: unknown };
              };
              return Boolean(w.app && w.app.workspace && w.app.vault);
            }),
          { timeout: 60_000, message: "window.app did not become available" },
        )
        .toBe(true);

      // Plugin should be registered.
      await expect
        .poll(
          async () =>
            window.evaluate(() => {
              const w = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, unknown> } };
              };
              return Boolean(w.app?.plugins?.plugins?.exocortex);
            }),
          { timeout: 30_000, message: "exocortex plugin not registered" },
        )
        .toBe(true);

      const meta = await window.evaluate(() => {
        const w = window as unknown as {
          app?: {
            plugins?: {
              plugins?: Record<
                string,
                { manifest?: { id?: string; version?: string } }
              >;
            };
          };
        };
        const plugin = w.app?.plugins?.plugins?.exocortex;
        return {
          id: plugin?.manifest?.id ?? null,
          version: plugin?.manifest?.version ?? null,
        };
      });

      expect(meta.id).toBe("exocortex");
      expect(meta.version).toBeTruthy();
      console.log(
        `[smoke] plugin loaded: id=${meta.id} version=${meta.version}`,
      );
    } finally {
      try {
        await browser?.close();
      } catch {
        /* ignore */
      }
      if (proc && !proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  });
});
