import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

// RFC Phase 3.2 (T2.1): per-spec retry(1) — Cat G environmental noise on Xvfb runner.
test.describe.configure({ mode: "parallel", retries: 1 });

test.describe("Daily Note Navigation", () => {
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

  test("should display navigation links at the top of DailyNote layout", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    const navContainer = window.locator(".exocortex-daily-navigation");
    await expect(navContainer.locator(".exocortex-nav-prev a")).toContainText(
      "2025-10-15",
      { timeout: 30000 },
    );

    const prevLink = navContainer.locator(".exocortex-nav-prev a");
    await expect(prevLink).toBeVisible();
    const prevText = await prevLink.textContent();
    expect(prevText).toBe("← 2025-10-15");

    const nextLink = navContainer.locator(".exocortex-nav-next a");
    await expect(nextLink).toBeVisible();
    const nextText = await nextLink.textContent();
    expect(nextText).toBe("2025-10-17 →");
  });

  test("should render navigation above Properties section", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    const navContainer = window.locator(".exocortex-daily-navigation");
    await expect(navContainer.locator(".exocortex-nav-prev a")).toContainText(
      "2025-10-15",
      { timeout: 30000 },
    );

    const propertiesSection = window.locator(".exocortex-properties-section");

    const navVisible = await navContainer.isVisible();
    const propsVisible = await propertiesSection.isVisible();

    if (navVisible && propsVisible) {
      const navBox = await navContainer.boundingBox();
      const propsBox = await propertiesSection.boundingBox();

      expect(navBox).toBeTruthy();
      expect(propsBox).toBeTruthy();

      expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(propsBox!.y);
    }
  });

  test("should not display navigation for non-DailyNote files", async () => {
    await launcher.openFile("Tasks/morning-standup.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-layout-rendered", 60000);
    // Layout signals render complete; if nav would appear, it would be here by now.
    await expect(window.locator(".exocortex-layout-rendered")).toBeVisible({
      timeout: 5000,
    });

    const navContainer = window.locator(".exocortex-daily-navigation");
    const isVisible = await navContainer.isVisible().catch(() => false);

    expect(isVisible).toBe(false);
  });

  test("should have proper styling for navigation links", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    const navContainer = window.locator(".exocortex-daily-navigation");
    await expect(navContainer.locator(".exocortex-nav-prev a")).toContainText(
      "2025-10-15",
      { timeout: 30000 },
    );

    const prevLink = navContainer.locator(".exocortex-nav-prev a");
    const nextLink = navContainer.locator(".exocortex-nav-next a");

    await expect(prevLink).toBeVisible();
    await expect(nextLink).toBeVisible();

    const prevText = await prevLink.textContent();
    const nextText = await nextLink.textContent();

    expect(prevText).toContain("2025-10-15");
    expect(prevText).toContain("←");
    expect(nextText).toContain("2025-10-17");
    expect(nextText).toContain("→");
  });

  test("should use correct file paths for navigation links", async () => {
    await launcher.openFile("Daily Notes/2025-10-16.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    const navContainer = window.locator(".exocortex-daily-navigation");
    await expect(navContainer.locator(".exocortex-nav-prev a")).toContainText(
      "2025-10-15",
      { timeout: 30000 },
    );

    const prevLink = navContainer.locator(".exocortex-nav-prev a");
    const nextLink = navContainer.locator(".exocortex-nav-next a");

    await expect(prevLink).toBeVisible();
    await expect(nextLink).toBeVisible();

    const prevHref = await prevLink.getAttribute("data-href");
    const nextHref = await nextLink.getAttribute("data-href");

    expect(prevHref).toContain("Daily Notes/2025-10-15.md");
    expect(nextHref).toContain("Daily Notes/2025-10-17.md");
  });

  test("should show disabled text when adjacent DailyNote does not exist", async () => {
    await launcher.openFile("Daily Notes/2025-10-15.md");

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    const navContainer = window.locator(".exocortex-daily-navigation");
    await expect(
      navContainer.locator(".exocortex-nav-prev .exocortex-nav-disabled"),
    ).toContainText("2025-10-14", { timeout: 30000 });

    const prevDisabled = navContainer.locator(
      ".exocortex-nav-prev .exocortex-nav-disabled",
    );
    const nextLink = navContainer.locator(".exocortex-nav-next a");

    await expect(prevDisabled).toBeVisible();
    await expect(nextLink).toBeVisible();

    const prevText = await prevDisabled.textContent();
    const nextText = await nextLink.textContent();

    expect(prevText).toBe("← 2025-10-14");
    expect(nextText).toBe("2025-10-16 →");
  });
});
