import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

test.describe("DailyNote Tasks Table", () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("should display only tasks for the current day", async () => {
    await test.step("Open daily note", async () => {
      await launcher.openFile("Daily Notes/2025-10-16.md");
    });

    const window = await launcher.getWindow();

    await test.step("Dismiss any modal dialogs", async () => {
      await launcher.waitForModalsToClose(10000);
    });

    // Additional wait for plugin to fully render after modals close
    await window.waitForTimeout(5000);

    await test.step("Wait for tasks section to appear", async () => {
      await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);
    });

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();

    await test.step("Verify tasks table is visible", async () => {
      await expect(tasksTable).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify correct number of tasks", async () => {
      const rows = tasksTable.locator("tbody tr");
      const rowCount = await rows.count();
      expect(rowCount).toBe(2);
    });

    await test.step("Verify expected tasks are present", async () => {
      const tableContent = await tasksTable.textContent();
      expect(tableContent).toContain("Morning standup");
      expect(tableContent).toContain("Code review");
      expect(tableContent).not.toContain("Different day task");
    });
  });

  test("should display task status and timestamps correctly", async () => {
    await test.step("Open daily note", async () => {
      await launcher.openFile("Daily Notes/2025-10-16.md");
    });

    const window = await launcher.getWindow();

    await test.step("Dismiss any modal dialogs", async () => {
      await launcher.waitForModalsToClose(10000);
    });

    await test.step("Wait for tasks section to appear", async () => {
      await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);
    });

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();

    await test.step("Verify tasks table is visible", async () => {
      await expect(tasksTable).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify status and timestamps", async () => {
      const tableContent = await tasksTable.textContent();
      expect(tableContent).toContain("Doing");
      expect(tableContent).toContain("Done");
      expect(tableContent).toMatch(/09:00|9:00/);
      expect(tableContent).toMatch(/15:00|3:00/);
    });
  });

  test("should filter out archived tasks", async () => {
    await test.step("Open daily note", async () => {
      await launcher.openFile("Daily Notes/2025-10-16.md");
    });

    const window = await launcher.getWindow();

    await test.step("Dismiss any modal dialogs", async () => {
      await launcher.waitForModalsToClose(10000);
    });

    await test.step("Wait for tasks section to appear", async () => {
      await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);
    });

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();

    await test.step("Verify tasks table is visible", async () => {
      await expect(tasksTable).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify rows are populated", async () => {
      const rows = tasksTable.locator("tbody tr");
      await expect(rows.first()).toBeVisible({ timeout: 5000 });
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
    });

    await test.step("Verify archived tasks are filtered", async () => {
      const tableContent = await tasksTable.textContent();
      expect(tableContent).not.toContain("ARCHIVED");
      expect(tableContent).not.toContain("archived");
    });
  });

  test("should toggle Effort Area column visibility", async () => {
    await test.step("Open daily note", async () => {
      await launcher.openFile("Daily Notes/2025-10-16.md");
    });

    const window = await launcher.getWindow();

    await test.step("Dismiss any modal dialogs", async () => {
      await launcher.waitForModalsToClose(10000);
    });

    await test.step("Wait for tasks section to appear", async () => {
      await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);
    });

    const toggleButton = window.locator(".exocortex-toggle-effort-area");
    await expect(toggleButton).toBeVisible({ timeout: 10000 });

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    let headers = tasksTable.locator("thead th");
    let initialHeaderCount = await headers.count();
    const initiallyVisible = initialHeaderCount === 5;

    if (initiallyVisible) {
      await test.step("Hide Effort Area column (was visible)", async () => {
        expect(initialHeaderCount).toBe(5);
        await toggleButton.click();
        await window.waitForTimeout(1000);

        headers = tasksTable.locator("thead th");
        let headerCount = await headers.count();
        expect(headerCount).toBe(4);

        let headerTexts = await headers.allTextContents();
        expect(headerTexts).not.toContain("Effort Area");
      });
    }

    await test.step("Verify Effort Area is hidden", async () => {
      headers = tasksTable.locator("thead th");
      let headerCount = await headers.count();
      expect(headerCount).toBe(4);

      let headerTexts = await headers.allTextContents();
      expect(headerTexts).not.toContain("Effort Area");
    });

    await test.step("Show Effort Area column", async () => {
      await toggleButton.click();
      await window.waitForTimeout(1000);

      headers = tasksTable.locator("thead th");
      const headerCount = await headers.count();
      expect(headerCount).toBe(5);

      const headerTexts = await headers.allTextContents();
      expect(headerTexts.some((text) => text.includes("Effort Area"))).toBe(true);
    });

    await test.step("Verify Effort Area data is visible", async () => {
      const firstRow = tasksTable.locator("tbody tr").first();
      const cells = firstRow.locator("td");
      const cellCount = await cells.count();
      expect(cellCount).toBe(5);

      const effortAreaCell = cells.nth(4);
      await expect(effortAreaCell).toBeVisible();
      const effortAreaContent = await effortAreaCell.textContent();
      expect(effortAreaContent).toContain("Development");
    });

    await test.step("Hide Effort Area again", async () => {
      await toggleButton.click();
      await expect(toggleButton).toContainText("Show Effort Area");

      headers = tasksTable.locator("thead th");
      const headerCount = await headers.count();
      expect(headerCount).toBe(4);

      const headerTexts = await headers.allTextContents();
      expect(headerTexts).not.toContain("Effort Area");
    });
  });
});
