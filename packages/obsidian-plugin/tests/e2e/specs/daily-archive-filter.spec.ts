import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

test.describe.configure({ mode: "parallel" });

test.describe("DailyNote Archive Filter", () => {
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

  test("should toggle archived tasks visibility with button click", async () => {
    await launcher.openFile("Daily Notes/2025-10-18.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    const toggleButton = window.locator(
      ".exocortex-daily-tasks-section .exocortex-toggle-archived",
    );
    await expect(toggleButton).toContainText("Show Archived", {
      timeout: 30000,
    });

    const initialButtonText = await toggleButton.textContent();
    expect(initialButtonText).toContain("Show Archived");

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    const rows = tasksTable.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 5000 });

    const initialRowCount = await rows.count();

    const tableContent = await tasksTable.textContent();
    expect(tableContent).not.toContain("Archived Task");

    await toggleButton.click();
    await expect(toggleButton).toContainText("Hide Archived", { timeout: 5000 });

    const updatedButtonText = await toggleButton.textContent();
    expect(updatedButtonText).toContain("Hide Archived");

    const updatedRows = tasksTable.locator("tbody tr");
    const updatedRowCount = await updatedRows.count();

    expect(updatedRowCount).toBeGreaterThan(initialRowCount);

    const updatedTableContent = await tasksTable.textContent();
    expect(updatedTableContent).toContain("Archived Task");

    await toggleButton.click();
    await expect(toggleButton).toContainText("Show Archived", { timeout: 5000 });

    const finalButtonText = await toggleButton.textContent();
    expect(finalButtonText).toContain("Show Archived");

    const finalRows = tasksTable.locator("tbody tr");
    const finalRowCount = await finalRows.count();
    expect(finalRowCount).toBe(initialRowCount);

    const finalTableContent = await tasksTable.textContent();
    expect(finalTableContent).not.toContain("Archived Task");
  });

  test("should persist archived filter state across page refreshes", async () => {
    await launcher.openFile("Daily Notes/2025-10-18.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    const toggleButton = window.locator(
      ".exocortex-daily-tasks-section .exocortex-toggle-archived",
    );
    await expect(toggleButton).toContainText("Show Archived", {
      timeout: 30000,
    });

    await toggleButton.click();
    await expect(toggleButton).toContainText("Hide Archived", { timeout: 5000 });

    let buttonText = await toggleButton.textContent();
    expect(buttonText).toContain("Hide Archived");

    await launcher.openFile("Daily Notes/2025-10-17.md");
    await launcher.waitForModalsToClose(10000);

    await launcher.openFile("Daily Notes/2025-10-18.md");
    await launcher.waitForModalsToClose(10000);

    const toggleButtonAfterRefresh = window.locator(
      ".exocortex-daily-tasks-section .exocortex-toggle-archived",
    );
    await expect(toggleButtonAfterRefresh).toContainText("Hide Archived", {
      timeout: 30000,
    });

    buttonText = await toggleButtonAfterRefresh.textContent();
    expect(buttonText).toContain("Hide Archived");
  });
});
