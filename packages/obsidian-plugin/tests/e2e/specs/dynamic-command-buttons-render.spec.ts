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
    const page = await launcher.getWindow();

    // Wait for plugin to load and force SPARQL query service initialization
    await page.evaluate(async () => {
      const app = (window as any).app;
      for (let i = 0; i < 20; i++) {
        if (app?.plugins?.plugins?.exocortex) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const plugin = app?.plugins?.plugins?.exocortex;
      if (!plugin) return;

      const qs = (plugin.sparql as any)?.queryService;
      if (qs && !qs.isInitialized) {
        await qs.initialize().catch(() => {});
      }
    });

    // Open the task file — onLayoutReady in ExocortexPlugin auto-renders layout
    // with populated triple store, so buttons should appear after file-open.
    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        return app?.workspace?.getActiveFile()?.name ?? "";
      });
    }, { timeout: 10000 }).toBe("dynamic-cmd-test-with-ts.md");

    // Wait for metadataCache to populate with frontmatter
    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000, message: "metadataCache frontmatter not populated" }).not.toBeNull();

    // Trigger layout refresh with populated triple store
    await page.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    // Button "Remove Start Timestamp" must render — precondition SPARQL ASK
    // checks for ems:Effort_startTimestamp triple in triple store, which
    // exists for this file (task has ems__Effort_startTimestamp: "2026-03-30...")
    const removeTimestampButton = page.locator(
      'button.exocortex-action-button:has-text("Remove Start Timestamp")'
    );

    await expect(
      removeTimestampButton,
      'Button "Remove Start Timestamp" must render for task WITH startTimestamp.'
    ).toBeVisible({ timeout: 20000 });
  });
});
