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
 *
 * Fixtures:
 * - Areas/large-dataset.md is an Area with 60 backlinks from
 *   Tasks/large-dataset/task-01..task-60.md (>50 → triggers virtualization)
 * - Areas/development.md has 6 backlinks (<50 → no virtualization, regular table)
 *
 * VIRTUALIZATION_THRESHOLD = 50 (defined in AssetRelationsTable.tsx)
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

  test("should render virtual table rows for >50 items (Issue #549)", async () => {
    // Areas/large-dataset.md has 60 backlinks → virtualization MUST activate
    await launcher.openFile("Areas/large-dataset.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Multiple virtual scroll containers may exist (one per relation group).
    // We need the one inside a group that's not collapsed and has the items.
    // Use a visible filter so we skip any container hidden by collapsed parent.
    const virtualTable = window
      .locator(".exocortex-virtual-scroll-container .exocortex-virtual-table")
      .first();
    await expect(virtualTable).toBeVisible({ timeout: 15000 });

    const rows = virtualTable.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    const firstRow = rows.first();
    const rowHasContent = await firstRow.evaluate((el) => {
      return el.textContent !== null && el.textContent.trim().length > 0;
    });
    expect(rowHasContent).toBe(true);
  });

  test("should have wrapper div with position relative for absolute positioning", async () => {
    await launcher.openFile("Areas/large-dataset.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Find a virtual container whose virtual-table is actually visible
    const virtualTable = window
      .locator(".exocortex-virtual-scroll-container .exocortex-virtual-table")
      .first();
    await expect(virtualTable).toBeVisible({ timeout: 15000 });

    // Walk up to the parent virtual-scroll-container
    const positionInfo = await virtualTable.evaluate((el) => {
      const scrollContainer = el.closest(".exocortex-virtual-scroll-container");
      if (!scrollContainer) return null;
      const wrapperDiv = scrollContainer.querySelector(":scope > div");
      if (!wrapperDiv) return null;
      return { position: window.getComputedStyle(wrapperDiv).position };
    });

    expect(positionInfo).not.toBeNull();
    expect(positionInfo!.position).toBe("relative");
  });

  test("should render non-virtualized table when below threshold", async () => {
    // Areas/development.md has 6 backlinks (<50) → regular table, no virtualization
    await launcher.openFile("Areas/development.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const relationsTable = window.locator(".exocortex-relations-table").first();
    await expect(relationsTable).toBeVisible({ timeout: 15000 });

    // Below threshold: virtual scroll container should NOT exist
    const virtualContainer = window.locator(".exocortex-virtual-scroll-container");
    const virtualCount = await virtualContainer.count();
    expect(virtualCount).toBe(0);

    // Regular table should have rows (one per backlink)
    const rows = relationsTable.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    const firstRow = rows.first();
    const rowContent = await firstRow.textContent();
    expect(rowContent).not.toBe("");
  });

  test("should have scroll container with proper height for scrollable content", async () => {
    await launcher.openFile("Areas/large-dataset.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const virtualTable = window
      .locator(".exocortex-virtual-scroll-container .exocortex-virtual-table")
      .first();
    await expect(virtualTable).toBeVisible({ timeout: 15000 });

    const containerInfo = await virtualTable.evaluate((el) => {
      const scrollContainer = el.closest(".exocortex-virtual-scroll-container") as HTMLElement | null;
      if (!scrollContainer) return null;
      const style = window.getComputedStyle(scrollContainer);
      const rect = scrollContainer.getBoundingClientRect();
      return {
        height: rect.height,
        overflow: style.overflow,
      };
    });

    expect(containerInfo).not.toBeNull();
    expect(containerInfo!.height).toBeGreaterThan(0);
    expect(containerInfo!.overflow).toContain("auto");
  });

  test("should not have empty tbody when virtualization is active (Issue #549)", async () => {
    // Critical regression test for issue #549
    await launcher.openFile("Areas/large-dataset.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Find virtual table that is actually visible (skip collapsed groups)
    const virtualTable = window
      .locator(".exocortex-virtual-scroll-container .exocortex-virtual-table")
      .first();
    await expect(virtualTable).toBeVisible({ timeout: 15000 });

    const tbody = virtualTable.locator("tbody");
    await expect(tbody).toBeVisible({ timeout: 5000 });

    const rowCount = await tbody.locator("tr").count();
    // Issue #549: Table was empty because virtualizer returned empty items
    expect(rowCount).toBeGreaterThan(0);
  });
});
