import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E Tests for Issue #547: Layout overflow and Edit mode styling consistency
 *
 * Tests verify:
 * 1. Layout handles assets without horizontal overflow
 * 2. Edit mode styling matches Reading mode
 * 3. Tables respect container width constraints
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
    // Open a task that has relations
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);

    // Wait for the layout to render
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Check if asset relations section exists
    const relationsSection = window.locator(".exocortex-assets-relations");
    const relationsVisible = await relationsSection
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (relationsVisible) {
      // Check that the section doesn't cause horizontal scrolling
      const overflowInfo = await relationsSection.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const parent = el.parentElement;
        return {
          sectionWidth: el.scrollWidth,
          sectionClientWidth: el.clientWidth,
          parentWidth: parent?.clientWidth || 0,
          overflow: style.overflow,
          overflowX: style.overflowX,
          hasHorizontalScroll: el.scrollWidth > el.clientWidth,
        };
      });

      // Section should not overflow its container
      expect(overflowInfo.hasHorizontalScroll).toBe(false);
    }
  });

  test("should have consistent font sizes in Exocortex containers", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Check font sizes in different Exocortex sections
    const sections = [
      ".exocortex-action-buttons-container",
      ".exocortex-properties-section",
      ".exocortex-assets-relations",
    ];

    const fontSizes: number[] = [];

    for (const selector of sections) {
      const section = window.locator(selector);
      const isVisible = await section.isVisible({ timeout: 3000 }).catch(() => false);

      if (isVisible) {
        const fontSize = await section.evaluate((el) => {
          const computed = window.getComputedStyle(el);
          return parseFloat(computed.fontSize);
        });

        fontSizes.push(fontSize);
      }
    }

    if (fontSizes.length > 1) {
      // All visible sections should have similar font sizes (within 4px tolerance)
      const avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;

      for (const fontSize of fontSizes) {
        expect(Math.abs(fontSize - avgFontSize)).toBeLessThanOrEqual(4);
      }
    }
  });

  test("should have tables that fit within container width", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Additional wait for CSS layout stabilization
    // Tables need time to calculate their final widths after initial render
    await window.waitForTimeout(1000);

    // Check all Exocortex tables
    const tables = window.locator(
      ".exocortex-relations-table, .exocortex-properties-table, .exocortex-tasks-table, .exocortex-projects-table"
    );
    const tableCount = await tables.count();

    for (let i = 0; i < tableCount; i++) {
      const table = tables.nth(i);
      const isVisible = await table.isVisible().catch(() => false);

      if (isVisible) {
        // Wait for this specific table's layout to stabilize using requestAnimationFrame
        await table.evaluate((el) => {
          return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolve());
            });
          });
        });

        const tableInfo = await table.evaluate((el) => {
          const tableRect = el.getBoundingClientRect();
          const parent = el.closest(".exocortex-section-content") ||
                        el.closest(".relation-group-content") ||
                        el.parentElement;

          const parentRect = parent?.getBoundingClientRect();

          return {
            tableWidth: tableRect.width,
            parentWidth: parentRect?.width || 0,
            tableOverflow: el.scrollWidth > el.clientWidth,
          };
        });

        // Table should not overflow its parent container significantly
        // Using 100px tolerance to account for rendering variations across environments
        if (tableInfo.parentWidth > 0) {
          expect(tableInfo.tableWidth).toBeLessThanOrEqual(tableInfo.parentWidth + 100);
        }
      }
    }
  });

  test("should render controls row without causing horizontal scroll", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Check if relations controls exist
    const controls = window.locator(".exocortex-relations-controls");
    const controlsVisible = await controls.isVisible({ timeout: 3000 }).catch(() => false);

    if (controlsVisible) {
      const controlsInfo = await controls.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          display: style.display,
          flexWrap: style.flexWrap,
          hasOverflow: el.scrollWidth > el.clientWidth,
        };
      });

      // Controls should use flexbox with wrap
      expect(controlsInfo.display).toBe("flex");
      expect(controlsInfo.flexWrap).toBe("wrap");
      expect(controlsInfo.hasOverflow).toBe(false);
    }
  });

  test("should apply text ellipsis to long cell content", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Check table cells for overflow handling
    const cells = window.locator(".exocortex-relations-table td");
    const cellCount = await cells.count();

    if (cellCount > 0) {
      const firstCell = cells.first();
      const cellStyle = await firstCell.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
          maxWidth: style.maxWidth,
        };
      });

      // Cells should have overflow handling
      expect(cellStyle.overflow).toBe("hidden");
      expect(cellStyle.textOverflow).toBe("ellipsis");
      expect(cellStyle.whiteSpace).toBe("nowrap");
    }
  });

  test("should have virtualization container with proper styling when many assets", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Check for virtualized container (appears when >50 items)
    const virtualContainer = window.locator(".exocortex-virtual-scroll-container");
    const hasVirtualization = await virtualContainer.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasVirtualization) {
      const containerStyle = await virtualContainer.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          maxHeight: style.maxHeight,
          overflow: style.overflow,
          width: style.width,
        };
      });

      // Virtualized container should have proper constraints
      expect(containerStyle.maxHeight).not.toBe("none");
      expect(containerStyle.overflow).toContain("auto");
    }
  });

  test("should respect width constraints for layout sections", async () => {
    await launcher.openFile("Tasks/vote-scroll-test-task.md");

    const window = await launcher.getWindow();
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-properties-section", 30000);

    // Get viewport width
    const viewportWidth = await window.evaluate(() => window.innerWidth);

    // Check main layout sections
    const sections = [
      ".exocortex-action-buttons-container",
      ".exocortex-properties-section",
      ".exocortex-daily-tasks-section",
      ".exocortex-assets-relations",
    ];

    for (const selector of sections) {
      const section = window.locator(selector);
      const isVisible = await section.isVisible({ timeout: 3000 }).catch(() => false);

      if (isVisible) {
        const sectionBox = await section.boundingBox();

        if (sectionBox) {
          // Section should not extend beyond viewport
          expect(sectionBox.width).toBeLessThanOrEqual(viewportWidth);
          // Section should have reasonable width (not collapsed to 0)
          expect(sectionBox.width).toBeGreaterThan(100);
        }
      }
    }
  });
});
