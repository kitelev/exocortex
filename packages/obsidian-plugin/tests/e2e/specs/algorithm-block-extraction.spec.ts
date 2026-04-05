import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";
import * as fs from "fs/promises";

// Skip: Create Instance button now requires dynamic command definitions (exocmd__Command + binding).
// After RFC-009 Phase 3-5, hardcoded ButtonGroupBuilders were removed in favor of vault-driven commands.
// TODO: Re-enable after adding Create Instance command definitions to test vault (#2516 aftermath).
test.describe.skip("Algorithm Block Extraction from TaskPrototype", () => {
  let launcher: ObsidianLauncher;
  let vaultPath: string;

  test.beforeEach(async () => {
    vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("should copy Algorithm section when creating instance from TaskPrototype", async () => {
    // Open the TaskPrototype file
    await launcher.openFile("Tasks/bug-fix-prototype.md");

    const window = await launcher.getWindow();

    // Wait for any modal dialogs (e.g., version display) to close BEFORE waiting for plugin render
    await launcher.waitForModalsToClose(10000);

    // Additional wait for plugin to fully render after modals close
    await window.waitForTimeout(5000);

    // Wait for the universal layout to render (increased to 120s for Docker cold start reliability)
    await launcher.waitForElement(".exocortex-layout-rendered", 120000);

    // Find and click the "Create Instance" button
    const createInstanceButton = window.getByRole("button", {
      name: "Create Instance",
    });
    await expect(createInstanceButton).toBeVisible({ timeout: 15000 });
    await createInstanceButton.click();

    // Wait for label input modal
    await launcher.waitForElement(".modal", 5000);

    // Enter label for the new task
    const labelInput = window.locator('.modal input[type="text"]');
    await expect(labelInput).toBeVisible({ timeout: 5000 });
    await labelInput.fill("Fix memory leak in cache");

    // Submit the modal
    const submitButton = window.locator(".modal button.mod-cta");
    await submitButton.click();

    await window
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => {});

    // Get the path of the newly created file
    const newFilePath = await window.evaluate(() => {
      const app = (window as any).app;
      const activeFile = app.workspace.getActiveFile();
      return activeFile ? activeFile.path : null;
    });

    if (!newFilePath) {
      throw new Error("No active file after Create Instance");
    }

    // Read the file content from disk
    const fullPath = path.join(vaultPath, newFilePath);
    const editorContent = await fs.readFile(fullPath, "utf-8");

    // Verify the Algorithm section was copied
    expect(editorContent).toContain("## Algorithm");
    expect(editorContent).toContain("1. Reproduce the bug locally");
    expect(editorContent).toContain(
      "2. Write a failing test that demonstrates the bug",
    );
    expect(editorContent).toContain("3. Implement the fix");
    expect(editorContent).toContain("4. Verify the test passes");
    expect(editorContent).toContain("5. Run full test suite");
    expect(editorContent).toContain("6. Create PR with fix");

    // Verify other sections were NOT copied
    expect(editorContent).not.toContain("## Description");
    expect(editorContent).not.toContain("## Notes");

    // Verify frontmatter properties
    expect(editorContent).toContain("exo__Instance_class");
    expect(editorContent).toContain("ems__Task");
    expect(editorContent).toContain("exo__Asset_prototype");
    expect(editorContent).toContain("bug-fix-prototype");
    expect(editorContent).toContain(
      "exo__Asset_label: Fix memory leak in cache",
    );
  });

  test("should create empty body when TaskPrototype has no Algorithm section", async () => {
    // Open the pre-existing TaskPrototype file without Algorithm section
    await launcher.openFile("Tasks/simple-prototype.md");

    const window = await launcher.getWindow();

    // Wait for any modal dialogs to close BEFORE waiting for plugin render
    await launcher.waitForModalsToClose(10000);

    // Additional wait for plugin to fully render after modals close
    await window.waitForTimeout(5000);

    // Wait for the universal layout (increased to 120s for Docker cold start reliability)
    await launcher.waitForElement(".exocortex-layout-rendered", 120000);

    // Click "Create Instance" button
    const createInstanceButton = window.getByRole("button", {
      name: "Create Instance",
    });
    await expect(createInstanceButton).toBeVisible({ timeout: 15000 });
    await createInstanceButton.click();

    // Fill in label
    await launcher.waitForElement(".modal", 5000);
    const labelInput = window.locator('.modal input[type="text"]');
    await labelInput.fill("Simple Task");

    const submitButton = window.locator(".modal button.mod-cta");
    await submitButton.click();

    // Wait for file creation
    await window.waitForTimeout(2000);

    // Get the path of the newly created file
    const newFilePath = await window.evaluate(() => {
      const app = (window as any).app;
      const activeFile = app.workspace.getActiveFile();
      return activeFile ? activeFile.path : null;
    });

    if (!newFilePath) {
      throw new Error("No active file after Create Instance");
    }

    // Read the file content from disk
    const fullPath = path.join(vaultPath, newFilePath);
    const editorContent = await fs.readFile(fullPath, "utf-8");

    // Verify NO Algorithm section was created
    expect(editorContent).not.toContain("## Algorithm");

    // Verify frontmatter exists
    expect(editorContent).toContain("exo__Instance_class");
    expect(editorContent).toContain("ems__Task");
  });
});
