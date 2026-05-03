import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import * as path from "path";

/**
 * Wikilink label parity — Reading View and Live Preview.
 *
 * Regression guard for the "Wikilink Read View Label Restoration" fix.
 * Verifies that bare [[uuid]] wikilinks are rendered using exo__Asset_label
 * in BOTH Reading View (Obsidian native aliases) and Live Preview
 * (WikilinkLabelViewPlugin CodeMirror extension) — not the raw filename/UUID.
 *
 * Covers 3 asset types: ems__Task, ems__Project, ims__Concept.
 *
 * Fixtures: tests/e2e/test-vault/label-parity/lp-host.md
 *   references [[label-parity-task]], [[label-parity-project]], [[lp-concept]]
 *   each with exo__Asset_label and aliases set to the human-readable label.
 *
 * Assigned to shard 6 (task bde3a1d3).
 */
test.describe.configure({ mode: "parallel", retries: 1 });

const HOST_FILE = "label-parity/lp-host.md";

const FIXTURES = [
  {
    type: "Task (ems__Task)",
    target: "label-parity-task",
    label: "LP Task Label",
  },
  {
    type: "Project (ems__Project)",
    target: "label-parity-project",
    label: "LP Project Label",
  },
  {
    type: "Concept (ims__Concept)",
    target: "lp-concept",
    label: "LP Concept Label",
  },
] as const;

/**
 * Opens HOST_FILE directly in Live Preview (source:false) mode.
 * More reliable than openFile→setViewState in Docker/headless CI because:
 * - setViewState on an existing preview leaf leaves cm-editor hidden (Playwright sees
 *   the element in the DOM but its visibility never changes during the 30s poll).
 * - A fresh leaf opened directly in source mode gets a visible cm-editor immediately.
 */
async function openInLivePreview(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (filePath: string) => {
    const app = (window as any).app;
    const file = app?.vault?.getAbstractFileByPath(filePath);
    if (!file) return;
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file, { state: { mode: "source", source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, HOST_FILE);
}

/**
 * Waits until the first WikilinkLabelViewPlugin span is visible on screen.
 * Uses getBoundingClientRect so the poll returns true only when the span has
 * non-zero dimensions (i.e., actually rendered, not just attached to the DOM).
 */
async function waitForFirstLabelSpan(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    (firstTarget: string) => {
      const el = document.querySelector(
        `span.exocortex-wikilink-label[data-target-path="${firstTarget}"]`,
      );
      if (!el) return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    FIXTURES[0].target,
    { timeout: 45_000 },
  );
}

test.describe("Wikilink label parity — Reading View and Live Preview", () => {
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

  test(
    "Reading View: all 3 asset types show exo__Asset_label (not filename)",
    { timeout: 45_000 },
    async () => {
      await launcher.openFile(HOST_FILE);
      const window = await launcher.getWindow();

      await waitForExocortexPluginViaPlaywright(window, {
        specName: "wikilink-label-parity/reading-view",
      });

      // Reading View is the default mode from ObsidianLauncher.openFile.
      // Obsidian renders bare [[target]] as <a class="internal-link" data-href="target">alias</a>
      // where alias comes from the target file's `aliases` frontmatter.
      for (const { type, target, label } of FIXTURES) {
        const link = window.locator(`a.internal-link[data-href="${target}"]`);
        await expect(link, `Reading View: ${type} link should be visible`).toBeVisible({
          timeout: 15_000,
        });
        const displayedText = await link.innerText();
        expect(
          displayedText,
          `Reading View: ${type} should display "${label}", got "${displayedText}"`,
        ).toBe(label);
      }
    },
  );

  test(
    "Live Preview: all 3 asset types show exo__Asset_label via WikilinkLabelViewPlugin",
    { timeout: 75_000 },
    async () => {
      // Open directly in Live Preview — avoids the preview→setViewState race where
      // cm-editor ends up in the DOM but remains hidden to Playwright for >30s in CI.
      const window = await launcher.getWindow();
      await waitForExocortexPluginViaPlaywright(window, {
        specName: "wikilink-label-parity/live-preview",
      });
      await openInLivePreview(window);

      // WikilinkLabelViewPlugin decorates bare [[target]] wikilinks with
      // span.exocortex-wikilink-label. Poll until the first span is visible.
      await waitForFirstLabelSpan(window);

      // Assert all 3 asset types.
      for (const { type, target, label } of FIXTURES) {
        const span = window.locator(
          `span.exocortex-wikilink-label[data-target-path="${target}"]`,
        );
        await expect(
          span,
          `Live Preview: ${type} label span should be visible`,
        ).toBeVisible({ timeout: 10_000 });
        const displayedText = await span.innerText();
        expect(
          displayedText,
          `Live Preview: ${type} should display "${label}", got "${displayedText}"`,
        ).toBe(label);
      }
    },
  );

  test(
    "Parity: Reading View and Live Preview show identical labels for all 3 types",
    { timeout: 90_000 },
    async () => {
      // Reading View snapshot
      await launcher.openFile(HOST_FILE);
      const window = await launcher.getWindow();
      await waitForExocortexPluginViaPlaywright(window, {
        specName: "wikilink-label-parity/parity",
      });

      const readingViewLabels: Record<string, string> = {};
      for (const { target } of FIXTURES) {
        const link = window.locator(`a.internal-link[data-href="${target}"]`);
        await expect(link).toBeVisible({ timeout: 15_000 });
        readingViewLabels[target] = await link.innerText();
      }

      // Switch to Live Preview by opening a fresh leaf directly in source mode.
      await openInLivePreview(window);
      await waitForFirstLabelSpan(window);

      // Live Preview snapshot and parity assertion.
      for (const { type, target, label } of FIXTURES) {
        const span = window.locator(
          `span.exocortex-wikilink-label[data-target-path="${target}"]`,
        );
        await expect(span).toBeVisible({ timeout: 10_000 });
        const livePreviewLabel = await span.innerText();

        expect(
          livePreviewLabel,
          `Parity: ${type} Live Preview should equal Reading View label`,
        ).toBe(readingViewLabels[target]);

        expect(
          livePreviewLabel,
          `Parity: ${type} should show human-readable label, not filename`,
        ).toBe(label);

        // Guard: neither mode should show the raw filename (simulates UUID)
        expect(
          readingViewLabels[target],
          `Parity: ${type} Reading View must not show raw filename`,
        ).not.toBe(target);
        expect(
          livePreviewLabel,
          `Parity: ${type} Live Preview must not show raw filename`,
        ).not.toBe(target);
      }
    },
  );
});
