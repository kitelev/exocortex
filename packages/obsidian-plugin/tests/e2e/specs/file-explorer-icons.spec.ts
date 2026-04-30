import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";

/**
 * RFC-024 §4 Phase 4 (T7.3) — L3 E2E smoke for FileExplorerIconPatch.
 *
 * Verifies the DOM-overlay icon is rendered next to a `nav-file-title`
 * whose underlying note declares `exo__Instance_class: [[ems__Task]]`,
 * given the vault's `exo__Layout` for `ems__Task` declares
 * `exo__Layout_icon: check-square`. The fixture
 * `exolayout/layout-task-featured-binding.md` provides the layout, and
 * `e2e-icon-target-task.md` provides a class-bearing target.
 *
 * Acceptance (RFC-024 §8 Phase 4 success metric):
 *   `npm run test:e2e file-explorer-icons` — class-bearing notes show
 *   the resolved Lucide icon when one is declared in the layout.
 */
test.describe("FileExplorerIconPatch — Phase 4 smoke", () => {
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

  test(
    "ems__Task nav-file-title carries .exo-file-explorer-icon overlay before .nav-file-title-content",
    { timeout: 25_000 },
    async () => {
      // Open any file to ensure the workspace is initialised; the patch
      // attaches to nav-file-title elements globally and re-applies on
      // metadataCache "resolved".
      await launcher.openFile("e2e-icon-target-task.md");
      await launcher.waitForModalsToClose(10_000);

      const targetTitle = launcher.page!.locator(
        '.nav-file-title[data-path="e2e-icon-target-task.md"]',
      );

      // Wait for the file explorer to render the row.
      await expect(targetTitle).toHaveCount(1, { timeout: 15_000 });

      // Wait for the patch to inject the overlay (MutationObserver +
      // metadataCache "resolved" together cover both startup paths).
      const overlay = targetTitle.locator(".exo-file-explorer-icon");
      await expect(overlay).toHaveCount(1, { timeout: 15_000 });

      // Overlay must precede `.nav-file-title-content` (RFC-024 §4).
      const order = await targetTitle.evaluate((title) => {
        const overlayEl = title.querySelector(".exo-file-explorer-icon");
        const contentEl = title.querySelector(".nav-file-title-content");
        if (!overlayEl || !contentEl) return null;
        const children = Array.from(title.children);
        return {
          overlayIdx: children.indexOf(overlayEl),
          contentIdx: children.indexOf(contentEl),
        };
      });
      expect(order).not.toBeNull();
      expect(order!.overlayIdx).toBeGreaterThanOrEqual(0);
      expect(order!.overlayIdx).toBeLessThan(order!.contentIdx);

      // Lucide icon name plumbed through `setIcon(overlay, "check-square")`.
      // Obsidian's setIcon mounts an <svg> child; we assert structural
      // presence rather than rasterised visuals so this stays robust to
      // Lucide version bumps.
      const svg = overlay.locator("svg");
      await expect(svg).toHaveCount(1);
    },
  );
});
