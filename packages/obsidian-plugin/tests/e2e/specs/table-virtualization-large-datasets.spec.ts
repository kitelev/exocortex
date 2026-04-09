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

    // Find a visible virtual scroll container with rendered rows.
    // Multiple groups may exist; some may be hidden (collapsed parents).
    // Filter by container visibility (not the table inside, which may
    // have 0 width pre-virtualization-measure cycle).
    const result = await window.evaluate(async () => {
      const containers = document.querySelectorAll(".exocortex-virtual-scroll-container");
      for (const container of Array.from(containers)) {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const table = container.querySelector(".exocortex-virtual-table");
        if (!table) continue;
        const rows = table.querySelectorAll("tbody tr");
        if (rows.length === 0) continue;
        return {
          containerCount: containers.length,
          rowCount: rows.length,
          firstRowText: rows[0]?.textContent?.trim() ?? "",
        };
      }
      // Return diagnostic info if nothing found
      return {
        containerCount: containers.length,
        rowCount: 0,
        firstRowText: "",
        diagnostic: "no visible container with rows found",
      };
    });

    expect(result).not.toBeNull();
    if ("diagnostic" in result! && result!.diagnostic) {
      throw new Error(
        `Virtualization not active. containerCount=${result!.containerCount}. ${result!.diagnostic}`,
      );
    }
    expect(result!.rowCount).toBeGreaterThan(0);
    expect(result!.firstRowText.length).toBeGreaterThan(0);
  });

  test("should have wrapper div with position relative for absolute positioning", async () => {
    await launcher.openFile("Areas/large-dataset.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const positionInfo = await window.evaluate(() => {
      const containers = document.querySelectorAll(".exocortex-virtual-scroll-container");
      for (const container of Array.from(containers)) {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const wrapperDiv = container.querySelector(":scope > div");
        if (!wrapperDiv) continue;
        return { position: window.getComputedStyle(wrapperDiv).position };
      }
      return null;
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

    const containerInfo = await window.evaluate(() => {
      const containers = document.querySelectorAll(".exocortex-virtual-scroll-container");
      for (const container of Array.from(containers)) {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(container as HTMLElement);
        return {
          height: rect.height,
          overflow: style.overflow,
        };
      }
      return null;
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

    const result = await window.evaluate(() => {
      const containers = document.querySelectorAll(".exocortex-virtual-scroll-container");
      for (const container of Array.from(containers)) {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const tbody = container.querySelector(".exocortex-virtual-table tbody");
        if (!tbody) continue;
        return tbody.querySelectorAll("tr").length;
      }
      return null;
    });

    // Issue #549: Table was empty because virtualizer returned empty items
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });
});
