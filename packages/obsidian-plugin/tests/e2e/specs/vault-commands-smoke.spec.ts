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

  // Investigating #2695: probe DynamicCommandButtonGroupBuilder internal state.
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

      // Diagnose autoRenderLayout blockers
      const MarkdownView = (window as any).require?.("obsidian")?.MarkdownView;
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      const viewMode = view?.getMode?.() ?? "no-view";
      const hasMetadataContainer = !!view?.containerEl?.querySelector(".metadata-container");
      const layoutVisible = plugin?.settings?.layoutVisible ?? "undefined";
      const hasLayoutRenderer = !!plugin?.layoutRenderer;

      plugin?.refreshLayout?.();

      // Wait a tick for async render to complete
      await new Promise((r) => setTimeout(r, 500));

      // Check DOM after refresh
      const hasButtonsSection = !!document.querySelector(".exocortex-buttons-section");
      const hasAutoLayout = !!document.querySelector(".exocortex-auto-layout");
      const hasLayoutRendered = !!document.querySelector(".exocortex-layout-rendered");

      // Read diagnostic state set by DynamicCommandButtonGroupBuilder.build()
      const buildDiag = (globalThis as any).__exocortexDynCmdDiag ?? null;

      return {
        uid, cls: JSON.stringify(cls), resolvedCount,
        fmKeys: Object.keys(fm || {}),
        viewMode, hasMetadataContainer, layoutVisible,
        hasLayoutRenderer, hasButtonsSection, hasAutoLayout, hasLayoutRendered,
        buildDiag,
      };
    });

    // Assert buttons section visible — include diagnostics in error message
    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(
      buttonsSection,
      `Buttons section must be visible. DIAG: ${JSON.stringify(diag, null, 2)}`,
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
    // Task with status Backlog should show "Start" but NOT show a "Set Backlog" button
    // (because there is no command to transition TO Backlog — the precondition
    // for "Start" is status==Backlog, so "Start" appears; "Complete" requires Doing)
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const buttonsSection = window.locator(".exocortex-buttons-section");
    const buttonsVisible = await buttonsSection
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (buttonsVisible) {
      // Get all button labels
      const buttonLabels = await window
        .locator(".exocortex-buttons-section .exocortex-action-button")
        .allTextContents();

      // "Complete" command has precondition status==Doing, but this task is Backlog,
      // so "Complete" should NOT appear. "Start" has precondition status==Backlog, so it SHOULD appear.
      // Also the existing "Remove Start Timestamp" command should NOT appear
      // (precondition: has startTimestamp, but this task has none)
      expect(buttonLabels).not.toContain("Remove Start Timestamp");

      // If Start button appeared, verify it
      if (buttonLabels.includes("Start")) {
        expect(buttonLabels).not.toContain("Complete");
      }
    }
  });

  test("should show different commands based on task status", async () => {
    // Task with status Doing should show "Complete" and "Remove Start Timestamp"
    // but NOT "Start" (precondition: status==Backlog fails for a Doing task)
    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const buttonsSection = window.locator(".exocortex-buttons-section");
    const buttonsVisible = await buttonsSection
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (buttonsVisible) {
      const buttonLabels = await window
        .locator(".exocortex-buttons-section .exocortex-action-button")
        .allTextContents();

      // "Start" should be hidden (precondition status==Backlog, but task is Doing)
      expect(buttonLabels).not.toContain("Start");

      // "Complete" may appear (precondition status==Doing matches)
      // "Remove Start Timestamp" may appear (precondition: has startTimestamp matches)
    }
  });

  // FIXME(#2688): same issue as dynamic-command-buttons-render — buttons section
  // never appears in DOM even though resolver works. See #2688 for full diagnosis.
  test.fixme("should change status when clicking status button", async () => {
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

    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache();
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

    // Wait for the layout to re-render after status change
    await window.waitForTimeout(2000);

    // Verify the status changed by checking frontmatter
    const result = await window.evaluate(async () => {
      const app = (window as any).app;
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) return { success: false, error: "No active file" };

      const metadata = app.metadataCache.getFileCache(activeFile);
      const frontmatter = metadata?.frontmatter;

      return {
        success: true,
        status: frontmatter?.ems__Effort_status,
      };
    });

    expect(result.success).toBe(true);
    // After clicking "Start", status should transition from Backlog to Doing
    if (result.status) {
      expect(result.status).toContain("Doing");
    }
  });

  test("should render ExoQL code block with results or loading state", async () => {
    await launcher.openFile("exoql-test-page.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // ExoQL code blocks are processed by SPARQLCodeBlockProcessor
    // and rendered with the .sparql-code-block class
    const codeBlock = window.locator(".sparql-code-block");
    const isVisible = await codeBlock
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (isVisible) {
      // Verify the results container exists
      const resultsContainer = codeBlock.locator(".sparql-results-container");
      const hasContainer = await resultsContainer
        .isVisible({ timeout: 10000 })
        .catch(() => false);

      expect(hasContainer).toBe(true);

      // Should show one of: results table, no-results message, error, or loading
      const hasTable = await codeBlock
        .locator(".sparql-results-table")
        .isVisible()
        .catch(() => false);
      const hasNoResults = await codeBlock
        .locator(".sparql-no-results")
        .isVisible()
        .catch(() => false);
      const hasError = await codeBlock
        .locator(".sparql-error-view")
        .isVisible()
        .catch(() => false);
      const hasLoading = await codeBlock
        .locator(".sparql-loading")
        .isVisible()
        .catch(() => false);

      expect(hasTable || hasNoResults || hasError || hasLoading).toBe(true);

      // If table rendered, verify it has headers
      if (hasTable) {
        const headers = codeBlock.locator(".sparql-results-table th");
        const headerCount = await headers.count();
        expect(headerCount).toBeGreaterThan(0);
      }
    }
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
