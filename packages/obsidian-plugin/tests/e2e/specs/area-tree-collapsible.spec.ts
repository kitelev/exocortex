import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";

test.describe("Area Tree Collapsible Functionality", () => {
  let launcher: ObsidianLauncher;

  test.beforeAll(async () => {
    launcher = new ObsidianLauncher();
    await launcher.launch();
  });

  test.afterAll(async () => {
    if (launcher) {
      await launcher.close();
    }
  });

  test("should display only child areas, not the root area", async () => {
    await launcher.openFile("Areas/development.md");
    await launcher.waitForModalsToClose(10000);

    // Additional wait for plugin to fully render after modals close
    const window = await launcher.getWindow();
    await window.waitForTimeout(5000);

    await launcher.waitForElement(".exocortex-area-tree", 60000);

    const areaTree = launcher.page.locator(".exocortex-area-tree");
    await expect(areaTree).toBeVisible();

    await expect(areaTree.locator("text=Frontend")).toBeVisible();
    await expect(areaTree.locator("text=Backend")).toBeVisible();
    await expect(
      areaTree.locator('[data-area-path*="development.md"]'),
    ).not.toBeVisible();
  });

  test("should display toggle button for areas with children", async () => {
    await launcher.openFile("Areas/development.md");
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-area-tree", 60000);

    const frontendRow = launcher.page.locator(
      '[data-area-path*="frontend.md"]',
    );
    const frontendToggle = frontendRow.locator(".area-tree-toggle");

    await expect(frontendToggle).toBeVisible();
    await expect(frontendToggle).toHaveText("▶"); // Collapsed by default

    const backendRow = launcher.page.locator('[data-area-path*="backend.md"]');
    const backendToggle = backendRow.locator(".area-tree-toggle");

    await expect(backendToggle).not.toBeVisible();
  });

  test("should expand children when toggle is clicked", async () => {
    await launcher.openFile("Areas/development.md");
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-area-tree", 60000);

    const areaTree = launcher.page.locator(".exocortex-area-tree");
    const reactComponentsLink = areaTree.locator("text=React Components");
    await expect(reactComponentsLink).not.toBeVisible(); // Collapsed initially

    const frontendRow = areaTree.locator('[data-area-path*="frontend.md"]');
    const frontendToggle = frontendRow.locator(".area-tree-toggle");

    await frontendToggle.click();

    await expect(frontendToggle).toHaveText("▼");
    await expect(reactComponentsLink).toBeVisible();
  });

  test("should collapse children when toggle is clicked again", async () => {
    await launcher.openFile("Areas/development.md");
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-area-tree", 60000);

    const areaTree = launcher.page.locator(".exocortex-area-tree");
    const frontendRow = areaTree.locator('[data-area-path*="frontend.md"]');
    const frontendToggle = frontendRow.locator(".area-tree-toggle");

    // First click: expand
    await frontendToggle.click();
    await expect(frontendToggle).toHaveText("▼");

    const reactComponentsLink = areaTree.locator("text=React Components");
    await expect(reactComponentsLink).toBeVisible();

    // Second click: collapse
    await frontendToggle.click();
    await expect(frontendToggle).toHaveText("▶");
    await expect(reactComponentsLink).not.toBeVisible();
  });

  test("should display correct hierarchy depth with collapsible nodes", async () => {
    await launcher.openFile("Areas/development.md");
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-area-tree", 60000);

    const areaTree = launcher.page.locator(".exocortex-area-tree");
    const tableRows = areaTree.locator("tbody tr");
    await expect(tableRows).toHaveCount(2); // Only 2 top-level children, collapsed

    await expect(areaTree.locator("text=Frontend")).toBeVisible();
    await expect(areaTree.locator("text=Backend")).toBeVisible();
    await expect(areaTree.locator("text=React Components")).not.toBeVisible(); // Hidden initially
    
    // Expand frontend to see React Components
    const frontendRow = areaTree.locator('[data-area-path*="frontend.md"]');
    const frontendToggle = frontendRow.locator(".area-tree-toggle");
    await frontendToggle.click();
    
    await expect(areaTree.locator("text=React Components")).toBeVisible();
  });

  test("should allow clicking on area links to navigate", async () => {
    await launcher.openFile("Areas/development.md");
    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-area-tree", 60000);

    const areaTree = launcher.page.locator(".exocortex-area-tree");
    const frontendLink = areaTree.locator('[data-href*="frontend.md"]').first();
    await frontendLink.click();

    await launcher.waitForElement(".exocortex-area-tree", 60000);

    const newAreaTree = launcher.page.locator(".exocortex-area-tree");

    // First verify React Components node exists but is initially collapsed
    await expect(newAreaTree.locator("text=React Components")).toBeVisible();
    await expect(newAreaTree.locator("text=Backend")).not.toBeVisible();
  });
});
