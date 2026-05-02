import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

// RFC Phase 3.3 (T3.1 #2986): root-cause fix via deterministic clock pins virtual time
// to the daily-note fixture date, so the spec sees a fixed wall-clock regardless of when
// CI runs. retry(1) (T2.1) removed per Charter Risk 1 — retries papered over time
// dependence; pinned clock removes the dependence entirely.
test.describe.configure({ mode: "parallel" });

// Pinned virtual time aligned to the fixture daily note (`Daily Notes/2025-10-16.md`)
// so any "today" check sees the same date as the on-disk fixture.
const PINNED_VIRTUAL_TIME = new Date("2025-10-16T12:00:00");

test.describe("DailyNote Tasks Table", () => {
  let launcher: ObsidianLauncher;

  test.beforeAll(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();

    // Pin Date.now() / new Date() in the renderer page to the fixture date.
    // Resolves Issue #2986: "current day" predicate was time-dependent and crossed
    // UTC midnight intermittently, causing 2 / 41 post-cutover incidents.
    const window = await launcher.getWindow();
    await window.clock.install({ time: PINNED_VIRTUAL_TIME });
  });

  test.afterAll(async () => {
    if (launcher) {
      await launcher.close();
    }
  });

  test("should display only tasks for the current day", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    const rows = tasksTable.locator("tbody tr");
    const rowCount = await rows.count();

    expect(rowCount).toBe(2);

    const tableContent = await tasksTable.textContent();

    expect(tableContent).toContain("Morning standup");
    expect(tableContent).toContain("Code review");

    expect(tableContent).not.toContain("Different day task");
  });

  test("should display task status and timestamps correctly", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    const tableContent = await tasksTable.textContent();

    expect(tableContent).toContain("Doing");
    expect(tableContent).toContain("Done");

    expect(tableContent).toMatch(/09:00|9:00/);
    expect(tableContent).toMatch(/15:00|3:00/);
  });

  test("should filter out archived tasks", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

    const tasksTable = window
      .locator(".exocortex-daily-tasks-section table")
      .first();
    await expect(tasksTable).toBeVisible({ timeout: 10000 });

    const rows = tasksTable.locator("tbody tr");

    // Wait for rows to be populated by Dataview query
    await expect(rows.first()).toBeVisible({ timeout: 5000 });

    const rowCount = await rows.count();

    expect(rowCount).toBeGreaterThan(0);

    const tableContent = await tasksTable.textContent();
    expect(tableContent).not.toContain("ARCHIVED");
    expect(tableContent).not.toContain("archived");
  });

  test("should toggle Effort Area column visibility", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-daily-tasks-section", 60000);

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
      expect(initialHeaderCount).toBe(5);

      await toggleButton.click();

      headers = tasksTable.locator("thead th");
      await expect(headers).toHaveCount(4, { timeout: 5000 });
      let headerCount = await headers.count();
      expect(headerCount).toBe(4);

      let headerTexts = await headers.allTextContents();
      expect(headerTexts).not.toContain("Effort Area");
    }

    headers = tasksTable.locator("thead th");
    let headerCount = await headers.count();
    expect(headerCount).toBe(4);

    let headerTexts = await headers.allTextContents();
    expect(headerTexts).not.toContain("Effort Area");

    await toggleButton.click();

    headers = tasksTable.locator("thead th");
    await expect(headers).toHaveCount(5, { timeout: 5000 });
    headerCount = await headers.count();
    expect(headerCount).toBe(5);

    headerTexts = await headers.allTextContents();
    expect(headerTexts.some((text) => text.includes("Effort Area"))).toBe(true);

    const firstRow = tasksTable.locator("tbody tr").first();
    const cells = firstRow.locator("td");
    const cellCount = await cells.count();
    expect(cellCount).toBe(5);

    const effortAreaCell = cells.nth(4);
    await expect(effortAreaCell).toBeVisible();
    const effortAreaContent = await effortAreaCell.textContent();
    expect(effortAreaContent).toContain("Development");

    await toggleButton.click();
    await expect(toggleButton).toContainText("Show Effort Area");

    headers = tasksTable.locator("thead th");
    headerCount = await headers.count();
    expect(headerCount).toBe(4);

    headerTexts = await headers.allTextContents();
    expect(headerTexts).not.toContain("Effort Area");
  });
});
