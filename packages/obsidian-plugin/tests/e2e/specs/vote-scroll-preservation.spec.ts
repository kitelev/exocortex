import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

// NOTE: Vote button tests are skipped because legacy ButtonGroupsBuilder was removed (Issue #1437).
// Vote buttons now come from RdfButtonGroupsBuilder which loads from RDF triple store.
// These tests will be re-enabled when RDF button definitions are in place (Issues #1440, #1441, #1442).
test.describe.skip("Vote Button Scroll Preservation", () => {
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

  test("should preserve scroll position when clicking Vote button", async () => {
    const testTaskPath = "Tasks/vote-scroll-test-task.md";

    await launcher.openFile(testTaskPath);

    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    await launcher.waitForElement(".exocortex-buttons-section", 60000);

    const scrollContainer = await window.evaluateHandle(() => {
      const element = document.querySelector(".exocortex-buttons-section");
      if (!element) throw new Error("Exocortex buttons section not found");

      const scrollParent =
        element.closest(".markdown-preview-view") ||
        element.closest(".workspace-leaf-content");

      if (!scrollParent) throw new Error("Scroll container not found");

      return scrollParent;
    });

    await window.evaluate((container) => {
      container.scrollTop = 500;
    }, scrollContainer);

    await window.waitForTimeout(500);

    const scrollBeforeClick = await window.evaluate((container) => {
      return container.scrollTop;
    }, scrollContainer);

    expect(scrollBeforeClick).toBeGreaterThan(400);

    const voteButton = await window.waitForSelector(
      ".exocortex-buttons-section button:has-text('Vote')",
      { timeout: 10000 },
    );

    await voteButton.click();

    await window.waitForTimeout(1000);

    // Re-query scroll container after click in case DOM re-rendered
    const scrollContainerAfter = await window.evaluateHandle(() => {
      const element = document.querySelector(".exocortex-buttons-section");
      if (!element) throw new Error("Exocortex buttons section not found");

      const scrollParent =
        element.closest(".markdown-preview-view") ||
        element.closest(".workspace-leaf-content");

      if (!scrollParent) throw new Error("Scroll container not found");

      return scrollParent;
    });

    const scrollAfterClick = await window.evaluate((container) => {
      return container.scrollTop;
    }, scrollContainerAfter);

    const scrollDifference = Math.abs(scrollAfterClick - scrollBeforeClick);

    expect(scrollDifference).toBeLessThanOrEqual(5);
  });
});
