import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E regression test for Issue #3295 — command-binding discovery must walk the
 * `exo__Class_superClass` chain so that a subclass instance inherits buttons
 * bound to its superclass.
 *
 * Scenario:
 *   - `ems__Meeting` is declared `exo__Class_superClass: ems__Task` (TBox fixtures
 *     under `03 Knowledge/classes/`).
 *   - The "Remove Start Timestamp" command binding targets `ems__Task`
 *     (`03 Knowledge/commands/bind-remove-start-for-tasks.md`).
 *   - An `ems__Meeting` instance WITH `ems__Effort_startTimestamp`
 *     (`Tasks/dynamic-cmd-meeting-with-ts.md`).
 *
 * Expected: the Task-targeted button renders on the Meeting asset, inherited
 * transitively (`ems__Meeting ⊑ ems__Task`) via
 * `CommandResolver.getClassAncestors` (PR #3342).
 *
 * Before the fix (or if the superclass walk silently returns [] at render time —
 * e.g. TBox class files not yet in the triple store), the Maintenance category
 * header and the button never appear. This spec exercises the REAL plugin
 * runtime in Docker Obsidian, which unit-test mocks (full triple store) cannot
 * reproduce.
 */

// Per-spec retry(1) — mirror dynamic-command-buttons-render.spec.ts (Maintenance
// header timeout under cold-start load).
test.describe.configure({ retries: 1 });

test.describe("Subclass command-button inheritance (Issue #3295)", () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
    await launcher.waitForModalsToClose(10000);
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("ems__Meeting inherits the ems__Task-bound button via superClass walk", async () => {
    const page = await launcher.getWindow();

    // Wait for plugin to load and force SPARQL query service initialization so
    // the TBox class files (ems__Task, ems__Meeting) are in the triple store
    // before the superclass walk runs.
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

    // Open the Meeting instance — onLayoutReady auto-renders the layout.
    await launcher.openFile("Tasks/dynamic-cmd-meeting-with-ts.md");

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = (window as any).app;
            return app?.workspace?.getActiveFile()?.name ?? "";
          }),
        { timeout: 10000 },
      )
      .toBe("dynamic-cmd-meeting-with-ts.md");

    // Wait for metadataCache to populate frontmatter for the Meeting instance.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = (window as any).app;
            const file = app?.workspace?.getActiveFile();
            if (!file) return null;
            const cache = app.metadataCache.getFileCache(file);
            return cache?.frontmatter
              ? JSON.stringify(Object.keys(cache.frontmatter))
              : null;
          }),
        {
          timeout: 15000,
          message: "metadataCache frontmatter not populated for Meeting instance",
        },
      )
      .not.toBeNull();

    // Trigger layout refresh with populated triple store.
    await page.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    // The "Remove Start Timestamp" button lives in the Maintenance category
    // (collapsed-by-default). It is bound to `ems__Task`, so its appearance on
    // this `ems__Meeting` instance proves the superClass walk works. Its ABSENCE
    // is the Issue #3295 regression.
    const maintenanceHeader = page.locator(
      'button.exocortex-button-group-title--collapsible:has-text("Maintenance")',
    );
    await expect(
      maintenanceHeader,
      "Maintenance header must render on ems__Meeting — the ems__Task-bound " +
        "button is inherited via exo__Class_superClass (Issue #3295). Absence = regression.",
    ).toBeVisible({ timeout: 20000 });
    await maintenanceHeader.click();

    const removeTimestampButton = page.locator(
      'button.exocortex-action-button:has-text("Remove Start Timestamp")',
    );
    await expect(
      removeTimestampButton,
      'Button "Remove Start Timestamp" (bound to ems__Task) must render on the ' +
        "ems__Meeting subclass instance after expanding Maintenance.",
    ).toBeVisible({ timeout: 20000 });
  });
});
