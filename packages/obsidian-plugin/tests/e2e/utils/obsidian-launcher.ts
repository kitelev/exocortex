import {
  ElectronApplication,
  Page,
  chromium,
} from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawn, ChildProcess } from "child_process";
import { TestLogger, LogLevel } from "./logger";

export class ObsidianLauncher {
  private app: ElectronApplication | null = null;
  private window: Page | null = null;
  private vaultPath: string;
  private electronProcess: ChildProcess | null = null;
  private cdpPort: number;
  private logger: TestLogger;

  constructor(vaultPath?: string) {
    this.vaultPath = vaultPath || path.join(__dirname, "../test-vault");
    this.cdpPort = 9222;
    this.logger = new TestLogger("ObsidianLauncher");
  }

  async launch(): Promise<void> {
    const obsidianPath =
      process.env.OBSIDIAN_PATH ||
      "/Applications/Obsidian.app/Contents/MacOS/Obsidian";

    this.logger.phase("Launch");
    this.logger.info("Starting Obsidian", { path: obsidianPath, vault: this.vaultPath });
    this.logger.debug("Environment", { DOCKER: process.env.DOCKER, DISPLAY: process.env.DISPLAY });

    if (!fs.existsSync(obsidianPath)) {
      this.logger.error(`Obsidian not found at ${obsidianPath}. Set OBSIDIAN_PATH environment variable.`);
      throw new Error(
        `Obsidian not found at ${obsidianPath}. Set OBSIDIAN_PATH environment variable.`,
      );
    }

    this.createObsidianConfig();

    const args = [this.vaultPath, `--remote-debugging-port=${this.cdpPort}`];

    // In Docker/CI, we need additional flags to run in headless environment
    if (process.env.CI || process.env.DOCKER) {
      this.logger.debug("Adding Docker/CI flags for headless environment");
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

    this.logger.step(`Spawning Electron process (CDP port ${this.cdpPort})`);
    this.logger.debug("Launch args", args);

    this.electronProcess = spawn(obsidianPath, args, {
      env: {
        ...process.env,
        OBSIDIAN_DISABLE_GPU: "1",
      },
      stdio: "inherit",
    });

    this.logger.debug("Electron process spawned", { pid: this.electronProcess.pid });

    await this.waitForPort(this.cdpPort, 45000);
    this.logger.step("CDP port ready");

    this.logger.step("Connecting to Electron via CDP");
    const browser = await chromium.connectOverCDP(
      `http://localhost:${this.cdpPort}`,
      { timeout: 30000 },
    );
    this.logger.debug("Connected to browser via CDP");

    const contexts = browser.contexts();
    this.logger.debug("Browser contexts found", { count: contexts.length });

    if (contexts.length === 0) {
      this.logger.error("No browser contexts found after CDP connection");
      throw new Error("No browser contexts found after CDP connection");
    }

    const context = contexts[0];
    const pages = context.pages();
    this.logger.debug("Pages in first context", { count: pages.length });

    if (pages.length > 1) {
      this.window = pages[1];
      this.logger.debug("Using second page (trashhalo pattern)");
    } else if (pages.length === 1) {
      this.window = pages[0];
      this.logger.debug("Using first page (only one available)");
    } else {
      this.logger.debug("No pages yet, waiting for page event...");
      this.window = await context.waitForEvent("page", { timeout: 30000 });
      this.logger.debug("Got page from event");
    }

    await this.window.waitForLoadState("domcontentloaded", { timeout: 30000 });
    this.logger.step("DOM loaded, waiting for window.app");

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
        this.logger.debug("App object found", { polls: pollCount });
        break;
      }

      if (pollCount % 10 === 0) {
        this.logger.debug(`Polling for app`, { poll: pollCount, max: maxPolls, ...pollResult });
      }

      await this.window.waitForTimeout(1000);
    }

    if (!appFound) {
      this.logger.error("window.app not available after 60 seconds");
      throw new Error("window.app not available after 60 seconds");
    }

    this.logger.step("Obsidian app object available");

    this.logger.step("Checking for trust dialog");
    await this.handleTrustDialog();

    this.logger.step("Waiting for vault indexing");
    await this.waitForVaultReady();

    this.logger.phaseEnd("Launch", true);
  }

  private createObsidianConfig(): void {
    const homeDir = process.env.HOME || os.homedir();
    const configDir =
      process.env.DOCKER === "true"
        ? "/root/.config/obsidian"
        : path.join(homeDir, ".config", "obsidian");
    const configPath = path.join(configDir, "obsidian.json");

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      this.logger.debug("Created config directory", { path: configDir });
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
    this.logger.debug("Created Obsidian config", { configPath, vaultPath: this.vaultPath });
  }

  private async handleTrustDialog(): Promise<void> {
    if (!this.window) {
      throw new Error("Window not available");
    }

    try {
      const trustButton = await this.window
        .locator('button:has-text("Trust author and enable plugins")')
        .first();

      const isVisible = await trustButton
        .isVisible({ timeout: 10000 })
        .catch(() => false);

      if (isVisible) {
        this.logger.info("Trust dialog found, clicking button");
        await trustButton.click();

        await this.window
          .waitForSelector(
            'button:has-text("Trust author and enable plugins")',
            {
              state: "hidden",
              timeout: 5000,
            },
          )
          .catch(() => {
            this.logger.warn("Trust dialog did not disappear, continuing anyway");
          });

        this.logger.debug("Trust dialog handled successfully");
      } else {
        this.logger.debug("Trust dialog not present (vault already trusted)");
      }
    } catch (error) {
      this.logger.debug("No trust dialog found or error handling it", { error: String(error) });
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
        this.logger.debug("Vault has files, waiting for stabilization", { fileCount: vaultStatus.fileCount });
        await new Promise((resolve) => setTimeout(resolve, 2000));

        this.logger.info("Vault ready", { markdownFiles: vaultStatus.fileCount });
        return;
      }

      this.logger.debug("Vault indexing", { filesFound: vaultStatus.fileCount });
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    this.logger.warn("Vault indexing timeout, continuing anyway");
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
              this.logger.debug("Port is accepting connections", { port });
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
          this.logger.error(`Timeout waiting for port ${port} after ${timeout}ms`);
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
    this.logger.phase("Open File");
    this.logger.info("Opening file", { path: normalizedPath });

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
        this.logger.debug("File not ready, retrying", { attempt: i + 1, maxRetries, error: fileOpenResult.error });
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    if (!fileOpenResult.success) {
      this.logger.error("Failed to open file", { error: fileOpenResult.error });
      throw new Error(`Failed to open file: ${fileOpenResult.error}`);
    }

    this.logger.step("Waiting for file load and plugin render");
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

    this.logger.debug("Final view info", finalViewInfo);

    if (!finalViewInfo.hasLeaf) {
      this.logger.error("No active leaf after opening file");
      throw new Error("No active leaf after opening file");
    }

    this.logger.phaseEnd("Open File", true);
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
    this.logger.debug("Waiting for element", { selector, timeout });
    await this.window.waitForSelector(selector, { timeout });
  }

  async waitForModalsToClose(timeout = 10000): Promise<void> {
    if (!this.window) {
      throw new Error("Obsidian not launched. Call launch() first.");
    }

    this.logger.debug("Checking for modal dialogs");

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
          this.logger.debug("No modals present");
          break;
        }

        this.logger.debug("Modal detected, dismissing", { attempt: attempt + 1, maxAttempts });

        // Try to find and click close button
        const closeButton = this.window.locator(".modal-close-button").first();
        const closeButtonVisible = await closeButton
          .isVisible({ timeout: 500 })
          .catch(() => false);

        if (closeButtonVisible) {
          this.logger.debug("Clicking modal close button");
          await closeButton.click();
        } else {
          // No close button, try pressing Escape
          this.logger.debug("No close button, pressing Escape");
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
        this.logger.debug("Error while dismissing modals", { error: String(error) });
        break;
      }
    }
  }

  async close(): Promise<void> {
    this.logger.phase("Teardown");

    if (this.window) {
      try {
        this.logger.step("Closing window");
        await this.window.close();
      } catch (error) {
        this.logger.debug("Window close error (expected)", { error: String(error) });
      }
      this.window = null;
    }

    if (this.electronProcess) {
      const pid = this.electronProcess.pid;
      this.logger.step(`Killing Electron process (PID ${pid})`);

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
              this.logger.debug("Process terminated", { pid });
              resolve();
            }
          }, 100);

          // Timeout after 5 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            this.logger.warn("Process termination timeout, continuing anyway", { pid });
            resolve();
          }, 5000);
        });
      } catch (error) {
        this.logger.debug("Process kill error (may already be dead)", { error: String(error) });
      }

      this.electronProcess = null;
    }

    this.logger.step("Waiting for CDP port release");
    await this.waitForPortClosed(this.cdpPort, 5000);
    this.logger.debug("CDP port released", { port: this.cdpPort });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.app = null;
    this.logger.phaseEnd("Teardown", true);
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
          this.logger.debug("Port is closed", { port });
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
          this.logger.warn("Timeout waiting for port to close, continuing anyway", { port });
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
