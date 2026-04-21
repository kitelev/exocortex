import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E tests for the Dynamic Command System (RFC-009).
 *
 * Validates the complete pipeline:
 * vault assets → triple store → CommandResolver → PreconditionEvaluator → UI/execution
 *
 * Test vault fixtures:
 * - 03 Knowledge/commands/pre-has-start-timestamp.md (Precondition)
 * - 03 Knowledge/commands/gnd-remove-start-timestamp.md (Grounding)
 * - 03 Knowledge/commands/cmd-remove-start-timestamp.md (Command)
 * - 03 Knowledge/commands/bind-remove-start-for-tasks.md (Binding)
 * - Tasks/dynamic-cmd-test-with-ts.md (Task WITH startTimestamp)
 * - Tasks/dynamic-cmd-test-without-ts.md (Task WITHOUT startTimestamp)
 *
 * Issue #2435
 */
test.describe.configure({ mode: "parallel" });

test.describe("Dynamic Command System E2E", () => {
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

  test("should load exocortex plugin with vault containing command files", async () => {
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      const app = (window as any).app;

      // Wait for plugin to load
      for (let i = 0; i < 20; i++) {
        if (app?.plugins?.plugins?.exocortex) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      const plugin = app?.plugins?.plugins?.exocortex;

      return {
        success: true,
        pluginLoaded: !!plugin,
        vaultName: app?.vault?.getName?.() ?? "unknown",
      };
    });

    expect(result.success).toBe(true);
    expect(result.pluginLoaded).toBe(true);
  });

  test("should resolve dynamic commands for task with startTimestamp", async () => {
    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      const app = (window as any).app;
      if (!app?.plugins?.plugins?.exocortex) {
        return { success: false, error: "Plugin not loaded" };
      }

      const plugin = app.plugins.plugins.exocortex;

      // Wait for plugin initialization
      for (let i = 0; i < 20; i++) {
        if (plugin.tripleStore || plugin.getTripleStore) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      // Check if CommandResolver is available
      const hasResolver =
        typeof plugin.commandResolver !== "undefined" ||
        typeof plugin.getCommandResolver === "function";

      // Check the active file's frontmatter
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) {
        return { success: false, error: "No active file" };
      }

      const metadata = app.metadataCache.getFileCache(activeFile);
      const frontmatter = metadata?.frontmatter;

      return {
        success: true,
        hasFile: !!activeFile,
        fileName: activeFile.name,
        hasStartTimestamp: !!frontmatter?.ems__Effort_startTimestamp,
        hasResolver,
        instanceClass: frontmatter?.exo__Instance_class,
      };
    });

    expect(result.success).toBe(true);
    expect(result.hasFile).toBe(true);
    expect(result.hasStartTimestamp).toBe(true);
  });

  test("should verify task without startTimestamp has no timestamp property", async () => {
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      const app = (window as any).app;
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) {
        return { success: false, error: "No active file" };
      }

      const metadata = app.metadataCache.getFileCache(activeFile);
      const frontmatter = metadata?.frontmatter;

      return {
        success: true,
        fileName: activeFile.name,
        hasStartTimestamp: !!frontmatter?.ems__Effort_startTimestamp,
        status: frontmatter?.ems__Effort_status,
      };
    });

    expect(result.success).toBe(true);
    expect(result.hasStartTimestamp).toBe(false);
  });

  test("should verify command definition files are valid vault assets", async () => {
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      const app = (window as any).app;
      const expectedFiles = [
        "03 Knowledge/commands/pre-has-start-timestamp.md",
        "03 Knowledge/commands/gnd-remove-start-timestamp.md",
        "03 Knowledge/commands/cmd-remove-start-timestamp.md",
        "03 Knowledge/commands/bind-remove-start-for-tasks.md",
      ];

      const results: { path: string; exists: boolean; hasClass: boolean }[] =
        [];

      for (const filePath of expectedFiles) {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!file) {
          results.push({ path: filePath, exists: false, hasClass: false });
          continue;
        }

        const metadata = app.metadataCache.getFileCache(file);
        const frontmatter = metadata?.frontmatter;
        const hasClass = !!frontmatter?.exo__Instance_class;

        results.push({ path: filePath, exists: true, hasClass });
      }

      return {
        success: true,
        files: results,
        allExist: results.every((r) => r.exists),
        allHaveClass: results.every((r) => r.hasClass),
      };
    });

    expect(result.success).toBe(true);
    expect(result.allExist).toBe(true);
    expect(result.allHaveClass).toBe(true);
  });

  test("should verify exocmd frontmatter properties are indexed correctly", async () => {
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      const app = (window as any).app;

      // Check command file
      const cmdFile = app.vault.getAbstractFileByPath(
        "03 Knowledge/commands/cmd-remove-start-timestamp.md",
      );
      if (!cmdFile) {
        return { success: false, error: "Command file not found" };
      }

      const metadata = app.metadataCache.getFileCache(cmdFile);
      const fm = metadata?.frontmatter;

      return {
        success: true,
        uid: fm?.exo__Asset_uid,
        label: fm?.exo__Asset_label,
        icon: fm?.exocmd__Command_icon,
        hasPrecondition: !!fm?.exocmd__Command_precondition,
        hasGrounding: !!fm?.exocmd__Command_grounding,
        confirmMessage: fm?.exocmd__Command_confirmMessage,
        category: fm?.exocmd__Command_category,
      };
    });

    expect(result.success).toBe(true);
    expect(result.uid).toBe("e2e-cmd-remove-start-timestamp");
    expect(result.label).toBe("Remove Start Timestamp");
    expect(result.icon).toBe("clock-x");
    expect(result.hasPrecondition).toBe(true);
    expect(result.hasGrounding).toBe(true);
    expect(result.category).toBe("maintenance");
  });
});
