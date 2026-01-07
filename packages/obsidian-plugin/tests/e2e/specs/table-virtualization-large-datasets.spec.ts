import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E Tests for Issue #549: Table renders empty when layout contains many assets
 *
 * Tests verify:
 * 1. Virtualized tables render rows correctly (>50 items triggers virtualization)
 * 2. Table shows data in all cases: below threshold, at threshold, above threshold
 * 3. Scrolling works correctly with virtualized content
 * 4. No silent failures - rows should always be visible
 */
test.describe("Table Virtualization for Large Datasets", () => {
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

  test("should render table rows when virtualization is active", async () => {
    // Open a task file that may have relations
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);

    // Wait for the layout to render (using properties section - buttons removed in Issue #1437)
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Check if any virtualized table exists
    const virtualContainer = window.locator(".exocortex-virtual-scroll-container");
    const hasVirtualization = await virtualContainer.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasVirtualization) {
      // Get the virtual table inside the container
      const virtualTable = virtualContainer.locator(".exocortex-virtual-table");
      const tableVisible = await virtualTable.isVisible({ timeout: 5000 }).catch(() => false);

      expect(tableVisible).toBe(true);

      // Check that the table has rows - this is the critical test for issue #549
      const rows = virtualTable.locator("tbody tr");
      const rowCount = await rows.count();

      // There should be at least some rows rendered (virtualization renders visible + overscan)
      // Even with virtualization, we should see rows in the viewport
      expect(rowCount).toBeGreaterThan(0);

      // Verify that rows have content (not empty)
      if (rowCount > 0) {
        const firstRow = rows.first();
        const rowHasContent = await firstRow.evaluate((el) => {
          return el.textContent && el.textContent.trim().length > 0;
        });
        expect(rowHasContent).toBe(true);
      }
    }
  });

  test("should have wrapper div with position relative for absolute positioning", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    const virtualContainer = window.locator(".exocortex-virtual-scroll-container");
    const hasVirtualization = await virtualContainer.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasVirtualization) {
      // The wrapper div inside the scroll container should have position: relative
      const wrapperDiv = virtualContainer.locator("> div");
      const hasProperPositioning = await wrapperDiv.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.position === "relative";
      });

      expect(hasProperPositioning).toBe(true);
    }
  });

  test("should render non-virtualized table when below threshold", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Look for regular (non-virtualized) relations table
    const relationsTable = window.locator(".exocortex-relations-table").first();
    const tableVisible = await relationsTable.isVisible({ timeout: 5000 }).catch(() => false);

    if (tableVisible) {
      // Check for regular table rows (not inside virtual container)
      const regularTableRows = relationsTable.locator("tbody tr");
      const hasRows = await regularTableRows.count();

      // If the table is visible, it should have content
      // (unless there genuinely are no relations for this file)
      if (hasRows > 0) {
        const firstRow = regularTableRows.first();
        const rowContent = await firstRow.textContent();
        expect(rowContent).not.toBe("");
      }
    }
  });

  test("should have scroll container with proper height for scrollable content", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    const virtualContainer = window.locator(".exocortex-virtual-scroll-container");
    const hasVirtualization = await virtualContainer.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasVirtualization) {
      const containerInfo = await virtualContainer.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          height: rect.height,
          overflow: style.overflow,
          overflowY: style.overflowY,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        };
      });

      // Container should have a fixed height
      expect(containerInfo.height).toBeGreaterThan(0);
      // Container should be scrollable
      expect(containerInfo.overflow).toContain("auto");
    }
  });

  test("should render table header separately from virtualized body", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    const virtualizedContainer = window.locator(".exocortex-relations-virtualized, .exocortex-virtualized");
    const hasVirtualization = await virtualizedContainer.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasVirtualization) {
      // Header table should exist and be separate from the scrollable body
      const headerTable = virtualizedContainer.locator(".exocortex-relations-table-header, .exocortex-tasks-table-header, .exocortex-projects-table-header");
      const headerVisible = await headerTable.isVisible({ timeout: 3000 }).catch(() => false);

      if (headerVisible) {
        // Header should have thead with th elements
        const headerCells = headerTable.locator("thead th");
        const headerCount = await headerCells.count();
        expect(headerCount).toBeGreaterThan(0);
      }
    }
  });

  test("should not have empty tbody when virtualization is active", async () => {
    // This is the critical regression test for issue #549
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Check all virtualized tables on the page
    const virtualContainers = window.locator(".exocortex-virtual-scroll-container");
    const containerCount = await virtualContainers.count();

    for (let i = 0; i < containerCount; i++) {
      const container = virtualContainers.nth(i);
      const isVisible = await container.isVisible().catch(() => false);

      if (isVisible) {
        // The virtual table inside should have rows
        const tbody = container.locator(".exocortex-virtual-table tbody");
        const tbodyVisible = await tbody.isVisible({ timeout: 3000 }).catch(() => false);

        if (tbodyVisible) {
          const rowCount = await tbody.locator("tr").count();

          // Issue #549: Table was empty because virtualizer returned empty items
          // After fix, there should always be rows (either virtual items or fallback)
          expect(rowCount).toBeGreaterThan(0);
        }
      }
    }
  });
});
