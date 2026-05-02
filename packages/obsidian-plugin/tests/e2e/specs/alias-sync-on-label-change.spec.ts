import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import * as path from "path";

test.describe.configure({ mode: "parallel" });

// flaky-track #2987 — RFC 32a64ed9-9a74-4e0c-bb26-e455605aa384 §3.3.
// Single-incident at N=41 (T3.1 row #6); insufficient evidence to discriminate
// flake vs regression. Keep enabled, no retry (Charter Risk 1). Watch criteria:
// incident #2 by 2026-05-31 → escalate to fix; zero further at N≥100 → close.
// Tag enables Phase 3.4 dashboard filtering (`--grep @flaky-track`).
test.describe(
  "Alias Sync on Label Change",
  { tag: ["@flaky-track", "@issue-2987"] },
  () => {
  let launcher: ObsidianLauncher;

  test.beforeAll(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterAll(async () => {
    if (launcher) {
      await launcher.close();
    }
  });

  test("should sync alias when exo__Asset_label changes", async () => {
    await launcher.openFile("Tasks/alias-sync-task.md");
    const window = await launcher.getWindow();

    // Playwright-level cold-start wait (RFC 3cc77ba2 v2 §Phase 1.2).
    await waitForExocortexPluginViaPlaywright(window, {
      specName: "alias-sync-on-label-change/single",
    });

    const newLabel = "Updated Label";

    const triggerResult = await window.evaluate(async (newAssetLabel) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      if (!app?.vault) {
        return { success: false, error: "App not available" };
      }
      const plugin = app.plugins?.plugins?.exocortex;
      if (!plugin) {
        return { success: false, error: "Plugin not loaded at mutation time" };
      }

      const file = app.vault.getAbstractFileByPath("Tasks/alias-sync-task.md");
      if (!file) {
        return { success: false, error: "File not found" };
      }

      const fileCache = app.metadataCache.getFileCache(file);
      const oldLabel = fileCache?.frontmatter?.exo__Asset_label || null;

      await app.fileManager.processFrontMatter(
        file,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (frontmatter: any) => {
          frontmatter.exo__Asset_label = newAssetLabel;
        },
      );

      // In E2E Docker environment, metadata change events don't fire reliably,
      // so we manually trigger the sync to test the functionality.
      if (plugin.aliasSyncService) {
        await plugin.aliasSyncService.syncAliases(
          file,
          oldLabel,
          newAssetLabel,
        );
      }

      return { success: true };
    }, newLabel);

    expect(triggerResult.success).toBe(true);

    // Replace the 10-retry / 500ms sleep-loop with structured `expect.poll`.
    await expect
      .poll(
        async () =>
          window.evaluate(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const app = (window as any).app;
            const file = app.vault.getAbstractFileByPath(
              "Tasks/alias-sync-task.md",
            );
            if (!file) return { label: null, alias: null };
            const content = await app.vault.read(file);
            const match = content.match(/^---\n([\s\S]*?)\n---/);
            if (!match) return { label: null, alias: null };
            const labelMatch = match[1].match(
              /exo__Asset_label:\s*(.+)$/m,
            );
            const aliasMatch = match[1].match(/aliases:\s*(.+)$/m);
            return {
              label: labelMatch ? labelMatch[1].trim() : null,
              alias: aliasMatch ? aliasMatch[1].trim() : null,
            };
          }),
        { timeout: 10_000, intervals: [200, 500, 500, 1000, 1000, 2000] },
      )
      .toEqual({ label: newLabel, alias: newLabel });
  });

  test("should handle multiple aliases and replace only matching one", async () => {
    await launcher.openFile("Tasks/alias-sync-multi-task.md");
    const window = await launcher.getWindow();

    // Playwright-level cold-start wait (RFC 3cc77ba2 v2 §Phase 1.2).
    await waitForExocortexPluginViaPlaywright(window, {
      specName: "alias-sync-on-label-change/multi",
    });

    const newLabel = "New Project Name";

    const triggerResult = await window.evaluate(async (newAssetLabel) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      if (!app?.vault) {
        return { success: false, error: "App not available", oldLabel: null };
      }
      const plugin = app.plugins?.plugins?.exocortex;
      if (!plugin) {
        return {
          success: false,
          error: "Plugin not loaded at mutation time",
          oldLabel: null,
        };
      }

      const file = app.vault.getAbstractFileByPath(
        "Tasks/alias-sync-multi-task.md",
      );
      if (!file) {
        return { success: false, error: "File not found", oldLabel: null };
      }

      const fileCache = app.metadataCache.getFileCache(file);
      const oldLabel = fileCache?.frontmatter?.exo__Asset_label || null;

      await app.fileManager.processFrontMatter(
        file,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (frontmatter: any) => {
          frontmatter.exo__Asset_label = newAssetLabel;
        },
      );

      if (plugin.aliasSyncService) {
        await plugin.aliasSyncService.syncAliases(
          file,
          oldLabel,
          newAssetLabel,
        );
      }

      return { success: true, oldLabel };
    }, newLabel);

    expect(triggerResult.success).toBe(true);
    const oldLabel = triggerResult.oldLabel;

    // Poll for aliases array state — replaces the 10-retry sleep-loop.
    await expect
      .poll(
        async () =>
          window.evaluate(
            async ({ knownOld, knownNew }) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const app = (window as any).app;
              const file = app.vault.getAbstractFileByPath(
                "Tasks/alias-sync-multi-task.md",
              );
              if (!file) return { containsNew: false, containsOld: true };
              const content = await app.vault.read(file);
              const match = content.match(/^---\n([\s\S]*?)\n---/);
              if (!match) return { containsNew: false, containsOld: true };
              const aliasesMatch = match[1].match(
                /aliases:\s*\n((?:  - .+\n?)+)/m,
              );
              if (!aliasesMatch) {
                return { containsNew: false, containsOld: true };
              }
              const aliasesList = aliasesMatch[1]
                .split("\n")
                .filter((line: string) => line.trim().startsWith("- "))
                .map((line: string) => line.trim().substring(2).trim());
              return {
                containsNew: aliasesList.includes(knownNew),
                containsOld:
                  knownOld !== null && knownOld !== undefined
                    ? aliasesList.includes(knownOld)
                    : false,
                aliases: aliasesList,
              };
            },
            { knownOld: oldLabel, knownNew: newLabel },
          ),
        { timeout: 10_000, intervals: [200, 500, 500, 1000, 1000, 2000] },
      )
      .toMatchObject({ containsNew: true, containsOld: false });

    // Final assertion: also confirm "Old Project Name" not in aliases
    // (preserves original test invariant).
    const finalAliases = await window.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      const file = app.vault.getAbstractFileByPath(
        "Tasks/alias-sync-multi-task.md",
      );
      const content = await app.vault.read(file);
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return [];
      const aliasesMatch = match[1].match(/aliases:\s*\n((?:  - .+\n?)+)/m);
      if (!aliasesMatch) return [];
      return aliasesMatch[1]
        .split("\n")
        .filter((line: string) => line.trim().startsWith("- "))
        .map((line: string) => line.trim().substring(2).trim());
    });

    expect(finalAliases).toContain(newLabel);
    expect(finalAliases).not.toContain("Old Project Name");
  });
});
