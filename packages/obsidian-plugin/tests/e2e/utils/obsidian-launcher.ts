import {
  ElectronApplication,
  Page,
  chromium,
} from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawn, ChildProcess } from "child_process";

export class ObsidianLauncher {
  private app: ElectronApplication | null = null;
  private window: Page | null = null;
  private vaultPath: string;
  private electronProcess: ChildProcess | null = null;
  private cdpPort: number;

  constructor(vaultPath?: string) {
    this.vaultPath = vaultPath || path.join(__dirname, "../test-vault");
    this.cdpPort = 9222;
  }

  async launch(): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.launchAttempt(attempt);
        return;
      } catch (error) {
        console.log(
          `[ObsidianLauncher] Launch attempt ${attempt}/${maxRetries} failed:`,
          error,
        );

        // Clean up the failed attempt before retrying
        await this.close().catch((closeErr) => {
          console.log(
            "[ObsidianLauncher] Cleanup after failed attempt error:",
            closeErr,
          );
        });

        if (attempt === maxRetries) {
          throw new Error(
            `Obsidian failed to launch after ${maxRetries} attempts: ${error}`,
          );
        }

        // Exponential backoff: 2s, 4s
        const backoffMs = 2000 * attempt;
        console.log(
          `[ObsidianLauncher] Retrying in ${backoffMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  private async launchAttempt(attempt: number): Promise<void> {
    const obsidianPath =
      process.env.OBSIDIAN_PATH ||
      "/Applications/Obsidian.app/Contents/MacOS/Obsidian";

    console.log(
      `[ObsidianLauncher] Launch attempt ${attempt}: Obsidian from:`,
      obsidianPath,
    );
    console.log("[ObsidianLauncher] Vault path:", this.vaultPath);
    console.log("[ObsidianLauncher] DOCKER env:", process.env.DOCKER);
    console.log("[ObsidianLauncher] DISPLAY env:", process.env.DISPLAY);

    if (!fs.existsSync(obsidianPath)) {
      throw new Error(
        `Obsidian not found at ${obsidianPath}. Set OBSIDIAN_PATH environment variable.`,
      );
    }

    this.createObsidianConfig();

    const args = [this.vaultPath, `--remote-debugging-port=${this.cdpPort}`];

    // In Docker/CI, we need additional flags to run in headless environment
    if (process.env.CI || process.env.DOCKER) {
      console.log("[ObsidianLauncher] Adding Docker/CI flags...");
      args.push(
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--disable-setuid-sandbox",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=VizDisplayCompositor",
        "--use-gl=swiftshader",
        "--disable-blink-features=AutomationControlled",
      );
    }

    console.log(
      `[ObsidianLauncher] Spawning Electron process with CDP port ${this.cdpPort}...`,
    );
    console.log("[ObsidianLauncher] Args:", args);

    this.electronProcess = spawn(obsidianPath, args, {
      env: {
        ...process.env,
        OBSIDIAN_DISABLE_GPU: "1",
      },
      stdio: "inherit",
    });

    console.log(
      "[ObsidianLauncher] Electron process spawned, PID:",
      this.electronProcess.pid,
    );

    await this.waitForPort(this.cdpPort, 45000);
    console.log(`[ObsidianLauncher] CDP port ${this.cdpPort} is ready`);

    console.log("[ObsidianLauncher] Connecting to Electron via CDP...");
    const browser = await chromium.connectOverCDP(
      `http://localhost:${this.cdpPort}`,
      { timeout: 30000 },
    );
    console.log("[ObsidianLauncher] Connected to browser via CDP");

    const contexts = browser.contexts();
    console.log(
      `[ObsidianLauncher] Found ${contexts.length} browser context(s)`,
    );

    if (contexts.length === 0) {
      throw new Error("No browser contexts found after CDP connection");
    }

    const context = contexts[0];
    const pages = context.pages();
    console.log(
      `[ObsidianLauncher] Found ${pages.length} page(s) in first context`,
    );

    if (pages.length > 1) {
      this.window = pages[1];
      console.log("[ObsidianLauncher] Using second page (trashhalo pattern)");
    } else if (pages.length === 1) {
      this.window = pages[0];
      console.log("[ObsidianLauncher] Using first page (only one available)");
    } else {
      console.log("[ObsidianLauncher] No pages yet, waiting for page event...");
      this.window = await context.waitForEvent("page", { timeout: 30000 });
      console.log("[ObsidianLauncher] Got page from event");
    }

    await this.window.waitForLoadState("domcontentloaded", { timeout: 30000 });
    console.log(
      "[ObsidianLauncher] DOM loaded, waiting for window.app to become available...",
    );

    const maxPolls = 60;
    let appFound = false;

    for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
      const pollResult = await this.window.evaluate(() => {
        const win = window as any;
        return {
          hasApp: !!win.app,
          hasWorkspace: !!win.app?.workspace,
          hasVault: !!win.app?.vault,
        };
      });

      if (pollResult.hasApp && pollResult.hasWorkspace && pollResult.hasVault) {
        appFound = true;
        console.log(
          "[ObsidianLauncher] App object found after",
          pollCount,
          "polls",
        );
        break;
      }

      if (pollCount % 5 === 0) {
        console.log(
          `[ObsidianLauncher] Poll ${pollCount}/${maxPolls}: app=${pollResult.hasApp}, workspace=${pollResult.hasWorkspace}, vault=${pollResult.hasVault}`,
        );
      }

      await this.window.waitForTimeout(1000);
    }

    if (!appFound) {
      throw new Error("window.app not available after 60 seconds");
    }

    console.log("[ObsidianLauncher] Obsidian app object available!");

    console.log("[ObsidianLauncher] Checking for trust dialog...");
    await this.handleTrustDialog();

    console.log("[ObsidianLauncher] Waiting for vault to finish indexing...");
    await this.waitForVaultReady();

    console.log("[ObsidianLauncher] Waiting for the exocortex plugin to load...");
    await this.waitForPluginReady();

    console.log("[ObsidianLauncher] Obsidian ready!");
  }

  private createObsidianConfig(): void {
    const homeDir = process.env.HOME || os.homedir();
    const configDir =
      process.env.DOCKER
        ? "/root/.config/obsidian"
        : path.join(homeDir, ".config", "obsidian");
    const configPath = path.join(configDir, "obsidian.json");

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      console.log("[ObsidianLauncher] Created config directory:", configDir);
    }

    const vaultId = "test-vault-e2e";
    const config = {
      vaults: {
        [vaultId]: {
          path: this.vaultPath,
          ts: Date.now(),
          open: true,
          trusted: true,
        },
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("[ObsidianLauncher] Created Obsidian config at:", configPath);
    console.log("[ObsidianLauncher] Registered vault:", this.vaultPath);

    // Pre-create per-vault config file to prevent ENOENT on first launch.
    // Obsidian reads <vaultId>.json for vault-specific settings at startup.
    const vaultConfigPath = path.join(configDir, `${vaultId}.json`);
    if (!fs.existsSync(vaultConfigPath)) {
      fs.writeFileSync(vaultConfigPath, JSON.stringify({}, null, 2));
      console.log(
        "[ObsidianLauncher] Pre-created vault config:",
        vaultConfigPath,
      );
    }
  }

  private static readonly TRUST_BUTTON_SELECTOR =
    'button:has-text("Trust author and enable plugins")';

  /**
   * One instantaneous look at the "Trust author and enable plugins" button;
   * click it if it is on screen. Returns whether a click happened.
   *
   * ⛤ WHY "instantaneous" is load-bearing. `Locator.isVisible()` in
   * `playwright-core@1.62.1` takes a single snapshot and returns at once — its
   * `timeout` option is documented `@deprecated This option is ignored …
   * returns immediately` (`types/types.d.ts`), and at runtime the client sends
   * `channel.isVisible(…, kNoTimeout)` to a server-side `isVisibleInternal`
   * that does one `callOnSelector` and no retry loop. So a `{ timeout }` here
   * would be a fake wait: the probe fires at whatever moment it is called and
   * sees only what is rendered at that moment. This helper is therefore
   * deliberately option-less, and the CALLER is responsible for repeating it
   * (see `waitForPluginReady`) whenever the dialog may render later than the
   * first look.
   */
  private async clickTrustDialogIfVisible(): Promise<boolean> {
    if (!this.window) {
      return false;
    }

    const trustButton = this.window
      .locator(ObsidianLauncher.TRUST_BUTTON_SELECTOR)
      .first();

    const isVisible = await trustButton.isVisible().catch(() => false);
    if (!isVisible) {
      return false;
    }

    await trustButton.click();
    console.log(
      "[ObsidianLauncher] Trust button clicked, waiting for dialog to disappear...",
    );

    await this.window
      .waitForSelector(ObsidianLauncher.TRUST_BUTTON_SELECTOR, {
        state: "hidden",
        timeout: 5000,
      })
      .catch(() => {
        console.log(
          "[ObsidianLauncher] Trust dialog did not disappear, but continuing...",
        );
      });

    return true;
  }

  /**
   * Fast path: the dialog is usually either already on screen when
   * `window.app` appears, or not needed at all (trust persisted from the
   * previous launch of the same vault). One look is enough for BOTH of those
   * cases — but "not visible" here also covers "not rendered YET", which is why
   * `waitForPluginReady` keeps probing.
   */
  private async handleTrustDialog(): Promise<void> {
    if (!this.window) {
      throw new Error("Window not available");
    }

    try {
      console.log("[ObsidianLauncher] Looking for trust dialog...");

      const clicked = await this.clickTrustDialogIfVisible();

      if (clicked) {
        console.log("[ObsidianLauncher] Trust dialog handled successfully");
      } else {
        console.log(
          "[ObsidianLauncher] Trust dialog not present (vault already trusted or not required)",
        );
      }
    } catch (error) {
      console.log(
        "[ObsidianLauncher] No trust dialog found or error handling it:",
        error,
      );
    }
  }

  /**
   * Wait until the exocortex plugin object is actually reachable.
   *
   * ⛤ WHY THIS LIVES HERE, not in the specs. `waitForVaultReady` waits for the
   * VAULT (markdown files indexed) — it says nothing about the PLUGIN. Specs then
   * used to spin their own `for (let i = 0; i < 20; i++) { …500ms }` loop, i.e. a
   * hard 10s ceiling — while the launcher grants 45s for the CDP port, 30s for the
   * window and 30s for the vault. Under a loaded CI runner (the e2e image runs
   * amd64) 10s is simply not enough, and the spec then fails as
   * `expect(result.pluginLoaded).toBe(true)` — a message that names the SYMPTOM and
   * hides the cause. Measured on `origin/main`: e2e-shard (1)/(3)/(5) each flaked
   * ~5% of attempts, the aggregate `e2e-tests` 15%, and EVERY sampled failure log
   * carried `pluginLoaded`.
   *
   * Two fixes in one place: (a) the ceiling becomes consistent with its
   * neighbours, (b) a timeout now reports what WAS loaded, so a red run carries
   * evidence instead of a bare boolean.
   *
   * ⛤ THE LATE TRUST DIALOG (e2e-shard 6, ticket be9e9b46). Twice in one day the
   * SECOND launch of a shard (right after the SIGKILL of the first) logged
   * `Trust dialog not present` at `App object found after 0 polls`, then zero
   * renderer console lines and `Loaded plugins: [none]` for the full 30 s — the
   * community-plugin layer never started, i.e. the vault sat in Restricted Mode
   * behind a trust dialog that rendered AFTER `handleTrustDialog`'s single look
   * (see `clickTrustDialogIfVisible` for why that look cannot wait). In 40 green
   * launches the plugin was ready 9–33 ms into this wait, so "not loaded yet"
   * here is not slowness — it is the dialog. Hence every poll below, while the
   * plugin is still absent, takes one more instantaneous look and clicks the
   * dialog if it has appeared in the meantime. No dialog → pure no-op.
   *
   * ⛤ `this.window` is re-read on every poll on purpose: when the 30 s ceiling
   * plus cleanup plus a relaunch overflow a spec's 60 s `beforeAll`, Playwright
   * runs `afterAll` → `close()` → `this.window = null` while this loop is still
   * running. Naming that case beats the `TypeError … (reading 'evaluate')` it
   * used to produce.
   */
  private async waitForPluginReady(): Promise<void> {
    if (!this.window) {
      throw new Error("Window not available");
    }

    const maxWaitTime = 30000;
    const checkInterval = 500;
    const startTime = Date.now();
    let trustClicked = false;

    for (let poll = 0; ; poll++) {
      if (!this.window) {
        throw new Error(
          "[ObsidianLauncher] window closed during plugin wait (close() ran concurrently — the launch was abandoned by its caller)",
        );
      }

      const status = await this.window.evaluate(() => {
        const app = (window as any).app;
        return {
          loaded: !!app?.plugins?.plugins?.exocortex,
          enabled: Object.keys(app?.plugins?.plugins ?? {}),
        };
      });

      if (status.loaded) {
        console.log(
          `[ObsidianLauncher] Plugin ready after ${Date.now() - startTime}ms`,
        );
        return;
      }

      if (!trustClicked && (await this.clickTrustDialogIfVisible())) {
        trustClicked = true;
        console.log(
          `[ObsidianLauncher] Trust dialog appeared late (poll ${poll}) — clicked; plugins should load now`,
        );
      }

      if (Date.now() - startTime >= maxWaitTime) {
        // ⛤ fail LOUD and with evidence: the plugin list is the one datum that
        // distinguishes "still loading" from "failed to load / not installed".
        throw new Error(
          `[ObsidianLauncher] exocortex plugin did not load within ${maxWaitTime}ms. ` +
            `Loaded plugins: [${status.enabled.join(", ") || "none"}]`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  private async waitForVaultReady(): Promise<void> {
    if (!this.window) {
      throw new Error("Window not available");
    }

    const maxWaitTime = 30000;
    const checkInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const vaultStatus = await this.window.evaluate(() => {
        const app = (window as any).app;
        if (!app || !app.vault) {
          return { ready: false, fileCount: 0 };
        }

        const allFiles = app.vault.getAllLoadedFiles();
        const markdownFiles = allFiles.filter((f: any) => f.extension === "md");

        return {
          ready: markdownFiles.length > 0,
          fileCount: markdownFiles.length,
        };
      });

      if (vaultStatus.ready && vaultStatus.fileCount > 0) {
        // Give Obsidian extra time to fully index all files before considering vault ready
        console.log(
          `[ObsidianLauncher] Vault has ${vaultStatus.fileCount} files, waiting for stabilization...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log(
          `[ObsidianLauncher] Vault ready with ${vaultStatus.fileCount} markdown files indexed`,
        );
        return;
      }

      console.log(
        `[ObsidianLauncher] Vault indexing... (${vaultStatus.fileCount} files found)`,
      );
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    console.log(
      "[ObsidianLauncher] WARNING: Vault indexing timeout, continuing anyway...",
    );
  }

  private async waitForPort(port: number, timeout: number): Promise<void> {
    const startTime = Date.now();
    const http = await import("http");

    return new Promise((resolve, reject) => {
      const checkPort = () => {
        const req = http.request(
          {
            host: "localhost",
            port,
            path: "/json/version",
            method: "GET",
          },
          (res) => {
            if (res.statusCode === 200) {
              console.log(
                `[ObsidianLauncher] Port ${port} is accepting connections`,
              );
              resolve();
            } else {
              retryCheck();
            }
          },
        );

        req.on("error", () => {
          retryCheck();
        });

        req.end();
      };

      const retryCheck = () => {
        if (Date.now() - startTime > timeout) {
          reject(
            new Error(`Timeout waiting for port ${port} after ${timeout}ms`),
          );
        } else {
          setTimeout(checkPort, 500);
        }
      };

      checkPort();
    });
  }

  async openFile(filePath: string): Promise<void> {
    if (!this.window) {
      throw new Error("Obsidian not launched. Call launch() first.");
    }

    const normalizedPath = filePath.replace(/\\/g, "/");
    console.log(`[ObsidianLauncher] Opening file: ${normalizedPath}`);

    const maxRetries = 10;
    const retryDelay = 1000;
    let fileOpenResult: any;

    for (let i = 0; i < maxRetries; i++) {
      fileOpenResult = await this.window.evaluate(async (path) => {
        const app = (window as any).app;
        if (!app || !app.workspace || !app.vault) {
          return {
            success: false,
            error: "App not available",
            retryable: true,
          };
        }

        const file = app.vault.getAbstractFileByPath(path);
        if (!file) {
          return {
            success: false,
            error: `File not found: ${path}`,
            retryable: true,
          };
        }

        // Force new leaf creation to avoid workspace state issues in shared fixtures
        const leaf = app.workspace.getLeaf(true);
        if (!leaf) {
          return {
            success: false,
            error: "Workspace leaf not available",
            retryable: true,
          };
        }

        await leaf.openFile(file, { state: { mode: "preview" } });

        return { success: true };
      }, normalizedPath);

      if (fileOpenResult.success) {
        break;
      }

      if (i < maxRetries - 1 && fileOpenResult.retryable) {
        console.log(
          `[ObsidianLauncher] File not ready, retrying (${i + 1}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    console.log("[ObsidianLauncher] File open result:", fileOpenResult);

    if (!fileOpenResult.success) {
      throw new Error(`Failed to open file: ${fileOpenResult.error}`);
    }

    console.log(
      "[ObsidianLauncher] Waiting for file load and plugin render...",
    );
    await this.window
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => {});

    const finalViewInfo = await this.window.evaluate(() => {
      const app = (window as any).app;
      const activeLeaf = app?.workspace?.activeLeaf;
      const viewState = activeLeaf?.getViewState();
      return {
        hasLeaf: !!activeLeaf,
        currentMode: viewState?.state?.mode,
        viewType: viewState?.type,
        hasExocortexContainer: !!(
          document.querySelector(".exocortex-properties-section") ||
          document.querySelector(".exocortex-daily-tasks-section")
        ),
      };
    });

    console.log("[ObsidianLauncher] Final view info:", finalViewInfo);

    if (!finalViewInfo.hasLeaf) {
      throw new Error("No active leaf after opening file");
    }
  }

  async getWindow(): Promise<Page> {
    if (!this.window) {
      throw new Error("Obsidian not launched. Call launch() first.");
    }
    return this.window;
  }

  async waitForElement(selector: string, timeout = 10000): Promise<void> {
    if (!this.window) {
      throw new Error("Obsidian not launched. Call launch() first.");
    }
    await this.window.waitForSelector(selector, { timeout });
  }

  async waitForModalsToClose(timeout = 10000): Promise<void> {
    if (!this.window) {
      throw new Error("Obsidian not launched. Call launch() first.");
    }

    console.log(
      "[ObsidianLauncher] Checking for modal dialogs and dismissing them...",
    );

    const maxAttempts = 5;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        // Check if any modal is visible
        const modalVisible = await this.window
          .locator(".modal-container")
          .isVisible({ timeout: 1000 })
          .catch(() => false);

        if (!modalVisible) {
          console.log("[ObsidianLauncher] No modals present");
          break;
        }

        console.log(
          `[ObsidianLauncher] Modal detected (attempt ${attempt + 1}/${maxAttempts}), dismissing...`,
        );

        // Try to find and click close button
        const closeButton = this.window.locator(".modal-close-button").first();
        const closeButtonVisible = await closeButton
          .isVisible({ timeout: 500 })
          .catch(() => false);

        if (closeButtonVisible) {
          console.log("[ObsidianLauncher] Clicking modal close button");
          await closeButton.click();
        } else {
          // No close button, try pressing Escape
          console.log("[ObsidianLauncher] No close button, pressing Escape");
          await this.window.keyboard.press("Escape");
        }

        await this.window
          .waitForSelector(".modal-container", {
            state: "hidden",
            timeout: 1000,
          })
          .catch(() => {});
        attempt++;
      } catch (error) {
        console.log("[ObsidianLauncher] Error while dismissing modals:", error);
        break;
      }
    }

    console.log("[ObsidianLauncher] Finished modal dismissal process");
  }

  async close(): Promise<void> {
    console.log("[ObsidianLauncher] Starting cleanup...");

    if (this.window) {
      try {
        await this.window.close();
      } catch (error) {
        console.log("[ObsidianLauncher] Window close error (expected):", error);
      }
      this.window = null;
    }

    if (this.electronProcess) {
      const pid = this.electronProcess.pid;
      console.log(
        `[ObsidianLauncher] Killing Electron process PID ${pid} with SIGKILL...`,
      );

      try {
        // Use SIGKILL for immediate termination
        this.electronProcess.kill("SIGKILL");

        // Wait for process to exit
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            try {
              // Check if process still exists
              process.kill(pid!, 0);
            } catch (e) {
              // Process doesn't exist anymore
              clearInterval(checkInterval);
              clearTimeout(terminationTimeout);
              console.log(`[ObsidianLauncher] Process ${pid} terminated`);
              resolve();
            }
          }, 100);

          // Timeout after 10 seconds (Docker Obsidian may take longer to terminate).
          // ⛤ Disarmed by the success path above: an armed timer used to print
          // "termination timeout" 10 s AFTER "terminated", which reads as a race
          // in every red log it lands in.
          const terminationTimeout = setTimeout(() => {
            clearInterval(checkInterval);
            console.log(
              `[ObsidianLauncher] Process ${pid} termination timeout (continuing anyway)`,
            );
            resolve();
          }, 10000);
        });
      } catch (error) {
        console.log(
          "[ObsidianLauncher] Process kill error (may already be dead):",
          error,
        );
      }

      this.electronProcess = null;
    }

    console.log(
      `[ObsidianLauncher] Waiting for CDP port ${this.cdpPort} to be released...`,
    );
    await this.waitForPortClosed(this.cdpPort, 5000);
    console.log(`[ObsidianLauncher] CDP port ${this.cdpPort} released`);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.app = null;
    console.log("[ObsidianLauncher] Cleanup complete");
  }

  private async waitForPortClosed(
    port: number,
    timeout: number,
  ): Promise<void> {
    const startTime = Date.now();
    const http = await import("http");

    return new Promise((resolve, reject) => {
      const checkPort = () => {
        const req = http.request(
          {
            host: "localhost",
            port,
            path: "/json/version",
            method: "GET",
            timeout: 500,
          },
          (res) => {
            // Port still responding, retry
            retryCheck();
          },
        );

        req.on("error", () => {
          // Port not responding = port is closed
          console.log(`[ObsidianLauncher] Port ${port} is closed`);
          resolve();
        });

        req.on("timeout", () => {
          req.destroy();
          retryCheck();
        });

        req.end();
      };

      const retryCheck = () => {
        if (Date.now() - startTime > timeout) {
          console.log(
            `[ObsidianLauncher] Timeout waiting for port ${port} to close (continuing anyway)`,
          );
          resolve(); // Don't reject, just warn
        } else {
          setTimeout(checkPort, 200);
        }
      };

      checkPort();
    });
  }

  get page(): Page | null {
    return this.window;
  }
}
