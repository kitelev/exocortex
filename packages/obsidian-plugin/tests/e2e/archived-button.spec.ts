import { test, expect } from "@playwright/test";

test.describe("Show Archived Button in pn__DailyNote", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:8080");

    await page.waitForSelector(".exocortex-action-buttons-container", {
      timeout: 10000,
    });

    const dailyNoteLink = page.locator('a[href*="2025-10-18"]').first();
    if (await dailyNoteLink.isVisible()) {
      await dailyNoteLink.click();
      await expect(page.locator(".exocortex-assets-relations")).toBeVisible({
        timeout: 10000,
      });
    }
  });

  test("should display Show Archived toggle button in relations section", async ({ page }) => {
    const relationsSection = page.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 10000 });

    const showArchivedButton = page.locator("button.exocortex-toggle-archived");
    await expect(showArchivedButton).toBeVisible();
    await expect(showArchivedButton).toContainText("Show Archived");
  });

  test("should hide archived assets by default", async ({ page }) => {
    const relationsSection = page.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator(".exocortex-relation-table tbody tr").first(),
    ).toBeVisible({ timeout: 5000 });

    const archivedTaskRow = page.locator('text="Archived Task"');
    await expect(archivedTaskRow).toBeHidden();
  });

  test("should show archived assets when Show Archived button is clicked", async ({ page }) => {
    const relationsSection = page.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 10000 });

    const showArchivedButton = page.locator("button.exocortex-toggle-archived");
    await expect(showArchivedButton).toBeVisible();

    const rowsBeforeClick = await page.locator(".exocortex-relation-table tbody tr").count();

    await showArchivedButton.click();
    await expect(showArchivedButton).toContainText("Hide Archived", { timeout: 5000 });

    const archivedTaskRow = page.locator('text="Archived Task"');
    await expect(archivedTaskRow).toBeVisible({ timeout: 5000 });

    const rowsAfterClick = await page.locator(".exocortex-relation-table tbody tr").count();
    expect(rowsAfterClick).toBeGreaterThan(rowsBeforeClick);
  });

  test("should hide archived assets again when Hide Archived button is clicked", async ({ page }) => {
    const relationsSection = page.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 10000 });

    const showArchivedButton = page.locator("button.exocortex-toggle-archived");
    await expect(showArchivedButton).toBeVisible();

    await showArchivedButton.click();

    const archivedTaskRow = page.locator('text="Archived Task"');
    await expect(archivedTaskRow).toBeVisible({ timeout: 5000 });

    const rowsWithArchived = await page.locator(".exocortex-relation-table tbody tr").count();

    await showArchivedButton.click();
    await expect(showArchivedButton).toContainText("Show Archived", { timeout: 5000 });
    await expect(archivedTaskRow).toBeHidden();

    const rowsWithoutArchived = await page.locator(".exocortex-relation-table tbody tr").count();
    expect(rowsWithoutArchived).toBeLessThan(rowsWithArchived);
  });

  test("should persist archived visibility state across page reloads", async ({ page }) => {
    const relationsSection = page.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 10000 });

    const showArchivedButton = page.locator("button.exocortex-toggle-archived");
    await expect(showArchivedButton).toBeVisible();

    await showArchivedButton.click();

    const archivedTaskRow = page.locator('text="Archived Task"');
    await expect(archivedTaskRow).toBeVisible({ timeout: 5000 });

    await page.reload();
    await page.waitForSelector(".exocortex-assets-relations", { timeout: 10000 });

    const archivedTaskAfterReload = page.locator('text="Archived Task"');
    await expect(archivedTaskAfterReload).toBeVisible({ timeout: 5000 });

    await expect(page.locator("button.exocortex-toggle-archived")).toContainText(
      "Hide Archived",
      { timeout: 5000 },
    );
  });

  test("should only filter archived assets, not other assets", async ({ page }) => {
    const relationsSection = page.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 10000 });

    const showArchivedButton = page.locator("button.exocortex-toggle-archived");
    await expect(showArchivedButton).toBeVisible();

    const nonArchivedRowsInitial = await page.locator(".exocortex-relation-table tbody tr").count();

    await showArchivedButton.click();
    await expect
      .poll(
        async () => page.locator(".exocortex-relation-table tbody tr").count(),
        { timeout: 5000 },
      )
      .toBeGreaterThan(nonArchivedRowsInitial);

    const allRowsAfterShow = await page.locator(".exocortex-relation-table tbody tr").count();
    const archivedCount = allRowsAfterShow - nonArchivedRowsInitial;
    expect(archivedCount).toBeGreaterThan(0);

    const regularTaskRows = page.locator('tbody tr').filter({ hasNotText: "Archived Task" });
    const regularCount = await regularTaskRows.count();
    expect(regularCount).toBe(nonArchivedRowsInitial);
  });

  test("should support both archived field formats (archived and exo__Asset_isArchived)", async ({ page }) => {
    const relationsSection = page.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 10000 });

    const showArchivedButton = page.locator("button.exocortex-toggle-archived");
    await expect(showArchivedButton).toBeVisible();

    const rowsBeforeClick = await page.locator(".exocortex-relation-table tbody tr").count();

    await showArchivedButton.click();

    const newFormatTask = page.locator('text="Archived Task"').first();
    await expect(newFormatTask).toBeVisible({ timeout: 5000 });

    const legacyFormatTask = page.locator('text="Archived Task (Legacy Format)"');
    await expect(legacyFormatTask).toBeVisible({ timeout: 5000 });

    const rowsAfterClick = await page.locator(".exocortex-relation-table tbody tr").count();
    expect(rowsAfterClick).toBeGreaterThanOrEqual(rowsBeforeClick + 2);
  });
});
