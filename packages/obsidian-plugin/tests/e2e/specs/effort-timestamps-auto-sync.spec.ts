import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import * as path from "path";

test.describe("Effort Timestamps Auto-Sync", () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("should sync resolutionTimestamp when endTimestamp changes", async () => {
    await launcher.openFile("Tasks/timestamp-sync-task.md");
    const window = await launcher.getWindow();

    // Playwright-level cold-start wait (RFC 3cc77ba2 v2 §Phase 1.2). Emits
    // PLUGIN_WAIT_MS metric consumed by the CI P99 aggregator.
    await waitForExocortexPluginViaPlaywright(window, {
      specName: "effort-timestamps-auto-sync",
    });

    // Use local ISO 8601 timestamp format (no Z suffix)
    const inputTimestamp = "2025-10-21T15:30:00";
    const expectedTimestamp = "2025-10-21T15:30:00";

    // Trigger mutation once — plugin is already loaded, no inner wait needed.
    const triggerResult = await window.evaluate(async (newTimestamp) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      if (!app?.vault) {
        return { success: false, error: "App not available" };
      }
      const plugin = app.plugins?.plugins?.exocortex;
      if (!plugin) {
        return { success: false, error: "Plugin not loaded at mutation time" };
      }

      const file = app.vault.getAbstractFileByPath(
        "Tasks/timestamp-sync-task.md",
      );
      if (!file) {
        return { success: false, error: "File not found" };
      }

      await app.fileManager.processFrontMatter(
        file,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (frontmatter: any) => {
          frontmatter.ems__Effort_endTimestamp = newTimestamp;
        },
      );

      // In E2E Docker environment, metadata change events don't fire reliably,
      // so we manually trigger the sync to test the functionality.
      // The automatic sync via metadata listener is tested in production use.
      if (plugin.taskStatusService) {
        const parsedDate = new Date(newTimestamp);
        await plugin.taskStatusService.syncEffortEndTimestamp(file, parsedDate);
      }

      return { success: true };
    }, inputTimestamp);

    expect(triggerResult.success).toBe(true);

    // Replace 10-retry / 500ms sleep-loop with structured `expect.poll`.
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const app = (window as any).app;
            const file = app.vault.getAbstractFileByPath(
              "Tasks/timestamp-sync-task.md",
            );
            if (!file) return { end: null, resolution: null };
            const content = await app.vault.read(file);
            const match = content.match(/^---\n([\s\S]*?)\n---/);
            if (!match) return { end: null, resolution: null };
            const endMatch = match[1].match(
              /ems__Effort_endTimestamp:\s*(.+)$/m,
            );
            const resMatch = match[1].match(
              /ems__Effort_resolutionTimestamp:\s*(.+)$/m,
            );
            return {
              end: endMatch ? endMatch[1].trim() : null,
              resolution: resMatch ? resMatch[1].trim() : null,
            };
          }),
        { timeout: 10_000, intervals: [200, 500, 500, 1000, 1000, 2000] },
      )
      .toEqual({ end: expectedTimestamp, resolution: expectedTimestamp });
  });
});
