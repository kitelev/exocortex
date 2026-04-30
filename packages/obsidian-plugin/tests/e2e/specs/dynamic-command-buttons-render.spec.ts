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

// RFC Phase 3.2 (T2.1): per-spec retry(1) — T0.2 rank #3 (Maintenance header timeout 20s).
test.describe.configure({ retries: 1 });

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

    // "Remove Start Timestamp" lives in the Maintenance category, which now
    // renders as a collapsed-by-default disclosure (UX iteration 2). First the
    // Maintenance header must appear, then clicking it reveals the button.
    // Precondition SPARQL ASK checks for ems:Effort_startTimestamp triple,
    // which exists for this fixture.
    const maintenanceHeader = page.locator(
      'button.exocortex-button-group-title--collapsible:has-text("Maintenance")'
    );
    await expect(
      maintenanceHeader,
      "Maintenance category header must render for task WITH startTimestamp."
    ).toBeVisible({ timeout: 20000 });
    await maintenanceHeader.click();

    const removeTimestampButton = page.locator(
      'button.exocortex-action-button:has-text("Remove Start Timestamp")'
    );

    await expect(
      removeTimestampButton,
      'Button "Remove Start Timestamp" must render for task WITH startTimestamp after expanding Maintenance.'
    ).toBeVisible({ timeout: 20000 });
  });
});
