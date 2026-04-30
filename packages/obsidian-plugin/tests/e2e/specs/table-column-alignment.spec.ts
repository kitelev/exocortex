import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E tests for verifying table column alignment in DailyTasksTable.
 *
 * Issue #594: Headers are misaligned with data columns when virtualization
 * creates separate header and body tables.
 *
 * This test suite verifies that:
 * 1. Header column X positions match data column X positions
 * 2. Column widths are consistent between header and body
 * 3. The Name column has non-zero width (doesn't collapse)
 */
// RFC Phase 3.2 (T2.1): per-spec retry(1) — T0.2 rank #5 known plaintive offender.
test.describe.configure({ mode: "parallel", retries: 1 });

test.describe("Table Column Alignment (#594)", () => {
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

  test("should align header columns with data columns", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    // Get header cells
    const headerCells = tasksTable.locator("thead th");
    const headerCount = await headerCells.count();

    // Get first data row cells
    const dataCells = tasksTable.locator("tbody tr:first-child td");
    const dataCount = await dataCells.count();

    // Header and data should have same number of columns
    expect(headerCount).toBe(dataCount);

    // Compare X positions and widths of each column
    for (let i = 0; i < headerCount; i++) {
      const headerCell = headerCells.nth(i);
      const dataCell = dataCells.nth(i);

      const headerBox = await headerCell.boundingBox();
      const dataBox = await dataCell.boundingBox();

      expect(headerBox).toBeTruthy();
      expect(dataBox).toBeTruthy();

      if (headerBox && dataBox) {
        // X positions should match (within 2px tolerance for rounding)
        expect(Math.abs(headerBox.x - dataBox.x)).toBeLessThanOrEqual(2);

        // Widths should match (within 2px tolerance)
        expect(Math.abs(headerBox.width - dataBox.width)).toBeLessThanOrEqual(
          2,
        );

        // Log for debugging
        console.log(
          `Column ${i}: Header X=${headerBox.x.toFixed(1)}, Data X=${dataBox.x.toFixed(1)}, ` +
            `Header W=${headerBox.width.toFixed(1)}, Data W=${dataBox.width.toFixed(1)}`,
        );
      }
    }
  });

  test("should have non-zero width for Name column", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    // Name column should be the first column
    const nameHeader = tasksTable.locator("thead th").first();
    const nameData = tasksTable.locator("tbody tr:first-child td").first();

    const nameHeaderBox = await nameHeader.boundingBox();
    const nameDataBox = await nameData.boundingBox();

    // Name column should have substantial width (at least 50px)
    expect(nameHeaderBox).toBeTruthy();
    if (nameHeaderBox) {
      expect(nameHeaderBox.width).toBeGreaterThan(50);
      console.log(`Name header width: ${nameHeaderBox.width}px`);
    }

    expect(nameDataBox).toBeTruthy();
    if (nameDataBox) {
      expect(nameDataBox.width).toBeGreaterThan(50);
      console.log(`Name data width: ${nameDataBox.width}px`);
    }
  });

  test("should NOT have data shifted left relative to headers", async () => {
    // This is the exact issue from #594 - data appears to the LEFT of headers
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    // Get Name column header and data
    const nameHeader = tasksTable.locator("thead th").first();
    const nameData = tasksTable.locator("tbody tr:first-child td").first();

    const headerBox = await nameHeader.boundingBox();
    const dataBox = await nameData.boundingBox();

    expect(headerBox).toBeTruthy();
    expect(dataBox).toBeTruthy();

    if (headerBox && dataBox) {
      // Data column X should NOT be significantly less than header X
      // (if data is shifted left, dataBox.x would be much smaller than headerBox.x)
      const shift = headerBox.x - dataBox.x;
      console.log(
        `Name column shift: ${shift}px (positive = data shifted left)`,
      );

      // Allow max 5px shift (for normal rendering variations)
      expect(shift).toBeLessThanOrEqual(5);

      // Also check that data is not shifted right too much
      expect(shift).toBeGreaterThanOrEqual(-5);
    }
  });

  test("should have task names visible in Name column (not collapsed)", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    // Get first task name cell
    const nameCell = tasksTable.locator("tbody tr:first-child td").first();

    // Get the link inside the name cell (task names are links)
    const nameLink = nameCell.locator("a.internal-link");
    const linkExists = (await nameLink.count()) > 0;

    if (linkExists) {
      const linkText = await nameLink.textContent();
      console.log(`Task name: "${linkText}"`);

      // Task name should not be empty
      expect(linkText?.trim().length).toBeGreaterThan(0);

      // Link should be visible (not hidden due to column collapse)
      const linkBox = await nameLink.boundingBox();
      expect(linkBox).toBeTruthy();
      if (linkBox) {
        expect(linkBox.width).toBeGreaterThan(10);
      }
    } else {
      // If no link, check the text content directly
      const cellText = await nameCell.textContent();
      console.log(`Task name (text): "${cellText}"`);
      expect(cellText?.trim().length).toBeGreaterThan(0);
    }
  });

  test("should have consistent column order: Name, Start, End, Status", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    // Get header text content
    const headerCells = tasksTable.locator("thead th");
    const headerCount = await headerCells.count();

    const headerTexts: string[] = [];
    for (let i = 0; i < headerCount; i++) {
      const text = await headerCells.nth(i).textContent();
      headerTexts.push(text?.trim() || "");
    }

    console.log("Header columns:", headerTexts);

    // First 4 columns should be: Name, Start, End, Status
    // (may have sort indicators like ▲/▼)
    expect(headerTexts[0]).toContain("Name");
    expect(headerTexts[1]).toContain("Start");
    expect(headerTexts[2]).toContain("End");
    expect(headerTexts[3]).toContain("Status");
  });
});
