import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E Tests for Issue #547: Layout overflow and Edit mode styling consistency
 *
 * Tests verify:
 * 1. Layout handles assets without horizontal overflow
 * 2. Tables respect container width constraints
 * 3. Cells have ellipsis overflow handling
 *
 * Fixture: Areas/development.md is an Area asset with 6 backlinks from
 * Tasks/* (vote-scroll-test-task, regular-task-oct18, code-review,
 * archived-task, archived-task-legacy, morning-standup) that reference
 * `ems__Effort_area: "[[development]]"`. This guarantees that
 * .exocortex-assets-relations and .exocortex-relations-table render.
 */
test.describe("Layout Overflow and Styling Consistency", () => {
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

  test("should not have horizontal overflow in asset relations section", async () => {
    // Areas/development.md has 6 backlinks → relations section guaranteed
    await launcher.openFile("Areas/development.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const relationsSection = window.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 15000 });

    // Check that the section doesn't cause horizontal scrolling
    const overflowInfo = await relationsSection.evaluate((el) => {
      return {
        sectionWidth: el.scrollWidth,
        sectionClientWidth: el.clientWidth,
        hasHorizontalScroll: el.scrollWidth > el.clientWidth,
      };
    });

    expect(overflowInfo.hasHorizontalScroll).toBe(false);
  });

  test("should have consistent font sizes in Exocortex containers", async () => {
    await launcher.openFile("Areas/development.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // .exocortex-assets-relations is guaranteed (6 backlinks)
    const relationsSection = window.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 15000 });

    const relationsFontSize = await relationsSection.evaluate((el) => {
      return parseFloat(window.getComputedStyle(el).fontSize);
    });

    // Font size must be reasonable (between 8px and 24px)
    expect(relationsFontSize).toBeGreaterThanOrEqual(8);
    expect(relationsFontSize).toBeLessThanOrEqual(24);
  });

  test("should have tables that fit within container width", async () => {
    await launcher.openFile("Areas/development.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Relations section guarantees relations-table renders
    const relationsTable = window.locator(".exocortex-relations-table").first();
    await expect(relationsTable).toBeVisible({ timeout: 15000 });

    const tableInfo = await relationsTable.evaluate((el) => {
      const tableRect = el.getBoundingClientRect();
      const parent = el.closest(".exocortex-section-content") ||
                    el.closest(".relation-group-content") ||
                    el.parentElement;
      const parentRect = parent?.getBoundingClientRect();
      return {
        tableWidth: tableRect.width,
        parentWidth: parentRect?.width || 0,
      };
    });

    // Table should not overflow its parent container significantly
    expect(tableInfo.parentWidth).toBeGreaterThan(0);
    expect(tableInfo.tableWidth).toBeLessThanOrEqual(tableInfo.parentWidth + 50);
  });

  test("should render controls row without causing horizontal scroll", async () => {
    await launcher.openFile("Areas/development.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const controls = window.locator(".exocortex-relations-controls");
    await expect(controls).toBeVisible({ timeout: 15000 });

    const controlsInfo = await controls.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        display: style.display,
        flexWrap: style.flexWrap,
        hasOverflow: el.scrollWidth > el.clientWidth,
      };
    });

    expect(controlsInfo.display).toBe("flex");
    expect(controlsInfo.flexWrap).toBe("wrap");
    expect(controlsInfo.hasOverflow).toBe(false);
  });

  test("should apply text ellipsis to long cell content", async () => {
    await launcher.openFile("Areas/development.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for relations table to render with cells
    const cells = window.locator(".exocortex-relations-table td");
    await expect(cells.first()).toBeVisible({ timeout: 15000 });

    const cellStyle = await cells.first().evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });

    expect(cellStyle.overflow).toBe("hidden");
    expect(cellStyle.textOverflow).toBe("ellipsis");
    expect(cellStyle.whiteSpace).toBe("nowrap");
  });

  test("should respect width constraints for layout sections", async () => {
    await launcher.openFile("Areas/development.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    const viewportWidth = await window.evaluate(() => window.innerWidth);

    // .exocortex-assets-relations is guaranteed for Areas/development.md (6 backlinks)
    const relationsSection = window.locator(".exocortex-assets-relations");
    await expect(relationsSection).toBeVisible({ timeout: 15000 });

    const sectionBox = await relationsSection.boundingBox();
    expect(sectionBox).not.toBeNull();
    expect(sectionBox!.width).toBeLessThanOrEqual(viewportWidth);
    expect(sectionBox!.width).toBeGreaterThan(100);
  });
});
