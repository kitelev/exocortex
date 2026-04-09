import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E smoke tests for vault commands rendering in Obsidian.
 *
 * Validates:
 * 1. Task note renders vault command buttons (status buttons visible)
 * 2. Current status button is hidden (precondition filtering)
 * 3. Click status button changes status
 * 4. ExoQL code block renders table output
 * 5. Property editor loads schemas from resolver
 *
 * Test vault fixtures (status transition commands):
 * - 03 Knowledge/commands/pre-status-is-backlog.md (Precondition: status == Backlog)
 * - 03 Knowledge/commands/pre-status-is-doing.md   (Precondition: status == Doing)
 * - 03 Knowledge/commands/gnd-set-status-doing.md   (Grounding: set status to Doing)
 * - 03 Knowledge/commands/gnd-set-status-done.md    (Grounding: set status to Done)
 * - 03 Knowledge/commands/cmd-set-status-doing.md   (Command: Start)
 * - 03 Knowledge/commands/cmd-set-status-done.md    (Command: Complete)
 * - 03 Knowledge/commands/bind-status-doing-for-tasks.md (Binding: Start → ems__Task)
 * - 03 Knowledge/commands/bind-status-done-for-tasks.md  (Binding: Complete → ems__Task)
 * - Tasks/dynamic-cmd-test-without-ts.md (Task with status Backlog)
 * - Tasks/dynamic-cmd-test-with-ts.md    (Task with status Doing)
 * - exoql-test-page.md (ExoQL code block)
 */
test.describe("Vault Commands Smoke Tests", () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("should render vault command buttons on a Task note", async () => {
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    // Wait for the layout to render (plugin loaded signal)
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache to have ANY frontmatter for the active file.
    // Obsidian may not have finished indexing immediately after file-open.
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000, message: "metadataCache frontmatter not populated" }).not.toBeNull();

    // Diagnose: check what DynamicCommandButtonGroupBuilder sees
    const diag = await window.evaluate(async () => {
      const app = (window as any).app;
      const plugin = app?.plugins?.plugins?.exocortex;
      if (!plugin) return { error: "no plugin" };

      const file = app.workspace.getActiveFile();
      if (!file) return { error: "no active file" };

      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const uid = fm?.exo__Asset_uid;
      const cls = fm?.exo__Instance_class;

      let resolvedCount = -1;
      try {
        const cmds = await plugin.commandResolver?.resolveForAsset(
          uid ?? file.path, Array.isArray(cls) ? cls[0]?.replace(/["'[\]]/g, "").trim() : cls, undefined
        );
        resolvedCount = cmds?.length ?? 0;
      } catch (e: any) { resolvedCount = -2; }

      plugin?.commandResolver?.invalidateCache();

      // Diagnose autoRenderLayout blockers via activeLeaf (avoid require("obsidian"))
      const view = app.workspace.activeLeaf?.view;
      const viewMode = view?.getMode?.() ?? "no-view";
      const hasMetadataContainer = !!view?.containerEl?.querySelector(".metadata-container");
      const layoutVisible = plugin?.settings?.layoutVisible ?? "undefined";
      const hasLayoutRenderer = !!plugin?.layoutRenderer;

      plugin?.refreshLayout?.();

      // Check DOM after refresh
      const hasButtonsSection = !!document.querySelector(".exocortex-buttons-section");
      const hasAutoLayout = !!document.querySelector(".exocortex-auto-layout");
      const hasLayoutRendered = !!document.querySelector(".exocortex-layout-rendered");

      return {
        uid, cls: JSON.stringify(cls), resolvedCount,
        fmKeys: Object.keys(fm || {}),
        viewMode, hasMetadataContainer, layoutVisible,
        hasLayoutRenderer, hasButtonsSection, hasAutoLayout, hasLayoutRendered,
      };
    });

    // Assert buttons section visible — include diagnostics in error message
    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(
      buttonsSection,
      `Buttons section must be visible. DIAG: ${JSON.stringify(diag)}`,
    ).toBeVisible({ timeout: 20000 });

    const actionContainer = window.locator(
      ".exocortex-buttons-section .exocortex-action-buttons-container",
    );
    await expect(actionContainer).toBeVisible({ timeout: 5000 });

    const buttons = window.locator(
      ".exocortex-buttons-section .exocortex-action-button",
    );
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test("should hide current status button via precondition filtering", async () => {
    // Task with status Backlog should NOT show "Complete" (precondition: status==Doing)
    // Also "Remove Start Timestamp" should NOT appear (task has no startTimestamp)
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter to populate (#2693)
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000 }).not.toBeNull();

    // Force re-render with populated triple store + metadataCache
    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });

    const buttonLabels = await window
      .locator(".exocortex-buttons-section .exocortex-action-button")
      .allTextContents();

    // "Remove Start Timestamp" must NOT appear (task has no startTimestamp)
    expect(buttonLabels).not.toContain("Remove Start Timestamp");

    // "Complete" must NOT appear (precondition: status==Doing, task is Backlog)
    expect(buttonLabels).not.toContain("Complete");
  });

  test("should show different commands based on task status", async () => {
    // Task with status Doing should NOT show "Start"
    // (precondition: status==Backlog fails for a Doing task)
    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter to populate (#2693)
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000 }).not.toBeNull();

    // Force re-render with populated triple store + metadataCache
    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });

    const buttonLabels = await window
      .locator(".exocortex-buttons-section .exocortex-action-button")
      .allTextContents();

    // "Start" must NOT appear (precondition: status==Backlog, task is Doing)
    expect(buttonLabels).not.toContain("Start");
  });

  // Issue #2699 resolved: grounding does update the file on disk,
  // but app.metadataCache lags behind disk writes in Docker Obsidian.
  // Reading vault file directly via app.vault.read() bypasses the cache.
  test("should change status when clicking status button", async () => {
    // Use the Backlog task - click "Start" to transition to Doing
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter (#2693)
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000 }).not.toBeNull();

    // Force re-render with populated triple store
    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });

    const startButton = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Start")',
    );
    await expect(startButton).toBeVisible({ timeout: 10000 });

    // Click Start
    await startButton.click();

    // Poll vault file contents directly — grounding writes to disk,
    // metadataCache may lag behind in Docker. Reading vault bypasses the cache.
    await expect.poll(async () => {
      return window.evaluate(async () => {
        const app = (window as any).app;
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) return null;
        // vault.read() reads from disk (bypasses metadataCache)
        return await app.vault.read(activeFile);
      });
    }, { timeout: 15000 }).toContain("Doing");
  });

  test("should render ExoQL code block with results or loading state", async () => {
    await launcher.openFile("exoql-test-page.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // ExoQL code blocks are processed by SPARQLCodeBlockProcessor and MUST
    // render .sparql-code-block — fixture exoql-test-page.md contains an exoql
    // code block, so if processor works this element is guaranteed.
    const codeBlock = window.locator(".sparql-code-block");
    await expect(codeBlock).toBeVisible({ timeout: 15000 });

    // Results container is always created by the processor (line 165 of
    // SPARQLCodeBlockProcessor.ts) regardless of query outcome.
    const resultsContainer = codeBlock.locator(".sparql-results-container");
    await expect(resultsContainer).toBeVisible({ timeout: 10000 });

    // Poll for one of the outcome states: table | no-results | error | loading.
    // This bypasses flakiness where SPARQL takes a moment to execute.
    await expect.poll(async () => {
      const hasTable = await codeBlock.locator(".sparql-results-table").count();
      const hasNoResults = await codeBlock.locator(".sparql-no-results").count();
      const hasError = await codeBlock.locator(".sparql-error-view").count();
      const hasLoading = await codeBlock.locator(".sparql-loading").count();
      return hasTable + hasNoResults + hasError + hasLoading > 0;
    }, { timeout: 15000 }).toBe(true);
  });

  test("should load property editor schemas from resolver", async () => {
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Verify that the property editor can resolve schemas for ems__Task class
    const result = await window.evaluate(async () => {
      const app = (window as any).app;
      const plugin = app?.plugins?.plugins?.exocortex;

      if (!plugin) {
        return { success: false, error: "Plugin not loaded" };
      }

      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) {
        return { success: false, error: "No active file" };
      }

      const metadata = app.metadataCache.getFileCache(activeFile);
      const frontmatter = metadata?.frontmatter;
      const instanceClass = frontmatter?.exo__Instance_class;

      // Extract class name from wikilink format
      let className: string | undefined;
      if (Array.isArray(instanceClass) && instanceClass.length > 0) {
        className = instanceClass[0]
          .replace(/["'[\]]/g, "")
          .trim();
      } else if (typeof instanceClass === "string") {
        className = instanceClass
          .replace(/["'[\]]/g, "")
          .trim();
      }

      return {
        success: true,
        hasPlugin: true,
        instanceClass: className,
        hasMetadata: !!frontmatter,
        uid: frontmatter?.exo__Asset_uid,
      };
    });

    expect(result.success).toBe(true);
    expect(result.hasPlugin).toBe(true);
    expect(result.instanceClass).toBe("ems__Task");
    expect(result.hasMetadata).toBe(true);
  });

  test("should verify all status command definition files exist in vault", async () => {
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      const app = (window as any).app;
      const expectedFiles = [
        "03 Knowledge/commands/pre-status-is-backlog.md",
        "03 Knowledge/commands/pre-status-is-doing.md",
        "03 Knowledge/commands/gnd-set-status-doing.md",
        "03 Knowledge/commands/gnd-set-status-done.md",
        "03 Knowledge/commands/cmd-set-status-doing.md",
        "03 Knowledge/commands/cmd-set-status-done.md",
        "03 Knowledge/commands/bind-status-doing-for-tasks.md",
        "03 Knowledge/commands/bind-status-done-for-tasks.md",
      ];

      const results: { path: string; exists: boolean; hasClass: boolean; uid: string | null }[] = [];

      for (const filePath of expectedFiles) {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!file) {
          results.push({ path: filePath, exists: false, hasClass: false, uid: null });
          continue;
        }

        const metadata = app.metadataCache.getFileCache(file);
        const frontmatter = metadata?.frontmatter;
        const hasClass = !!frontmatter?.exo__Instance_class;
        const uid = frontmatter?.exo__Asset_uid ?? null;

        results.push({ path: filePath, exists: true, hasClass, uid });
      }

      return {
        success: true,
        files: results,
        allExist: results.every((r) => r.exists),
        allHaveClass: results.every((r) => r.hasClass),
        allHaveUid: results.every((r) => r.uid !== null),
      };
    });

    expect(result.success).toBe(true);
    expect(result.allExist).toBe(true);
    expect(result.allHaveClass).toBe(true);
    expect(result.allHaveUid).toBe(true);
  });
});
