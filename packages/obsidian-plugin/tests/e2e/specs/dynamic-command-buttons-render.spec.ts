import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";
import * as fs from "fs";

/**
 * E2E test for dynamic command button rendering AND functionality (RFC-009 §5.5).
 *
 * Validates the FULL pipeline:
 *   Vault command files → TripleStore → CommandResolver → PreconditionEvaluator
 *   → DynamicCommandButtonGroupBuilder → ActionButtonsGroup → DOM → click
 *   → window.confirm → GroundingExecutor → frontmatter update → Notice → re-render
 *
 * Issue #2666
 *
 * Vault fixtures (Issue #2435):
 * - 03 Knowledge/commands/cmd-remove-start-timestamp.md  (Command)
 * - 03 Knowledge/commands/pre-has-start-timestamp.md     (Precondition: SPARQL ASK)
 * - 03 Knowledge/commands/gnd-remove-start-timestamp.md  (Grounding: property_delete)
 * - 03 Knowledge/commands/bind-remove-start-for-tasks.md (Binding: ems__Task)
 * - Tasks/dynamic-cmd-test-with-ts.md    (WITH startTimestamp)
 * - Tasks/dynamic-cmd-test-without-ts.md (WITHOUT startTimestamp)
 */
const FIXTURE_PATH = path.join(
  __dirname, "../test-vault/Tasks/dynamic-cmd-test-with-ts.md"
);

test.describe("Dynamic Command Button Rendering & Functionality", () => {
  let launcher: ObsidianLauncher;
  let fixtureOriginal: string;

  test.beforeEach(async () => {
    fixtureOriginal = fs.readFileSync(FIXTURE_PATH, "utf-8");
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
    await launcher.waitForModalsToClose(10000);
  });

  test.afterEach(async () => {
    await launcher.close();
    fs.writeFileSync(FIXTURE_PATH, fixtureOriginal, "utf-8");
  });

  test("renders button from RDF config and executes grounding on click", async () => {
    test.setTimeout(180000);
    const page = await launcher.getWindow();

    // ── Step 1: Verify plugin + dynamic command system ──

    const systemStatus = await page.evaluate(async () => {
      const app = (window as any).app;

      for (let i = 0; i < 30; i++) {
        if (app?.plugins?.plugins?.exocortex) break;
        await new Promise((r) => setTimeout(r, 300));
      }

      const plugin = app?.plugins?.plugins?.exocortex;
      if (!plugin) {
        return { pluginLoaded: false, hasResolver: false, tripleStoreSize: -1 };
      }

      const hasResolver =
        typeof plugin.commandResolver !== "undefined" ||
        typeof plugin.getCommandResolver === "function";

      let tripleStoreSize = -1;
      for (let i = 0; i < 15; i++) {
        const ts = plugin.tripleStore || plugin.getTripleStore?.();
        if (ts) {
          tripleStoreSize = ts.size ?? ts.getSize?.() ?? -1;
          if (tripleStoreSize > 0) break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }

      return { pluginLoaded: true, hasResolver, tripleStoreSize };
    });

    expect(systemStatus.pluginLoaded, "Exocortex plugin must be loaded").toBe(true);
    expect(
      systemStatus.hasResolver,
      "CommandResolver must be wired up. " +
        "Check ExocortexPlugin.ts resolveRfc009Services() and DI container registration."
    ).toBe(true);

    // ── Step 2: Open task WITH startTimestamp → button MUST appear ──

    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        return app?.workspace?.getActiveFile()?.name ?? "";
      });
    }, { timeout: 10000 }).toBe("dynamic-cmd-test-with-ts.md");

    await page
      .locator(".exocortex-buttons-section, .exocortex-action-buttons-container")
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {
        // Timeout is expected if no buttons section renders for this file type
      });

    const removeTimestampButton = page.locator(
      'button.exocortex-action-button:has-text("Remove Start Timestamp")'
    );

    await expect(
      removeTimestampButton,
      'Button "Remove Start Timestamp" must render for task WITH startTimestamp.'
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.locator('.exocortex-button-group-title:has-text("Commands")'),
      'Button must be in "Commands" group (from DynamicCommandButtonGroupBuilder)'
    ).toBeVisible({ timeout: 5000 });

    // ── Step 3: Open task WITHOUT startTimestamp → button must NOT appear ──

    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        return app?.workspace?.getActiveFile()?.name ?? "";
      });
    }, { timeout: 10000 }).toBe("dynamic-cmd-test-without-ts.md");

    await page
      .locator(".exocortex-buttons-section, .exocortex-action-buttons-container")
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {
        // Timeout is expected if no buttons section renders for this file type
      });

    await expect(
      page.locator('button:has-text("Remove Start Timestamp")'),
      'Button must NOT render when precondition (SPARQL ASK for startTimestamp) returns false.'
    ).not.toBeVisible({ timeout: 10000 });

    // ── Step 4: Functionality — click button, confirm, verify action ──

    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        return app?.workspace?.getActiveFile()?.name ?? "";
      });
    }, { timeout: 10000 }).toBe("dynamic-cmd-test-with-ts.md");

    const buttonForClick = page.locator(
      'button.exocortex-action-button:has-text("Remove Start Timestamp")'
    );
    await expect(buttonForClick).toBeVisible({ timeout: 15000 });

    // Verify startTimestamp exists BEFORE click
    const hasTsBefore = await page.evaluate(() => {
      const app = (window as any).app;
      const file = app?.workspace?.getActiveFile();
      if (!file) return false;
      const cache = app.metadataCache.getFileCache(file);
      return !!cache?.frontmatter?.ems__Effort_startTimestamp;
    });
    expect(hasTsBefore, "Task must have startTimestamp before click").toBe(true);

    // Set up dialog handler BEFORE clicking — window.confirm() is used
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("Remove start timestamp");
      await dialog.accept();
    });

    // Click the dynamic command button
    await buttonForClick.click();

    // Wait for grounding execution + refresh cycle
    // GroundingExecutor removes ems__Effort_startTimestamp, then refresh() re-renders layout
    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return true; // conservative — don't fail on missing file
        const cache = app.metadataCache.getFileCache(file);
        return !!cache?.frontmatter?.ems__Effort_startTimestamp;
      });
    }, {
      timeout: 15000,
      message: "ems__Effort_startTimestamp should be removed from frontmatter after grounding",
    }).toBe(false);

    // Button must disappear after action — precondition no longer met
    await expect(
      page.locator('button:has-text("Remove Start Timestamp")'),
      "Button must disappear after startTimestamp removed (precondition fails on re-render)"
    ).not.toBeVisible({ timeout: 10000 });
  });
});
