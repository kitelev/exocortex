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
    { timeout: 60_000 },
    async () => {
      await launcher.openFile(HOST_FILE);
      const window = await launcher.getWindow();

      await waitForExocortexPluginViaPlaywright(window, {
        specName: "wikilink-label-parity/live-preview",
      });

      // Switch the active leaf to Live Preview (source mode, source: false).
      // WikilinkLabelViewPlugin runs in CodeMirror and decorates bare [[target]]
      // wikilinks with span.exocortex-wikilink-label[data-target-path="target"].
      await window.evaluate(async () => {
        const app = (window as any).app;
        const leaf = app?.workspace?.activeLeaf;
        if (!leaf) return;
        const currentState = leaf.getViewState();
        await leaf.setViewState({
          ...currentState,
          state: {
            ...currentState.state,
            mode: "source",
            source: false,
          },
        });
      });

      // CI: mode switch to Live Preview (source:false) can take >15s on Docker/headless.
      // Wait for CodeMirror editor with generous budget.
      await window.waitForSelector(".cm-editor", { timeout: 30_000 });

      // WikilinkLabelViewPlugin initialises via MutationObserver (24ms in dev, up to
      // 30s in CI due to plugin load sequencing). Use waitForFunction polling so we
      // re-check every 100ms rather than waiting for a single DOM event.
      await window.waitForFunction(
        (firstTarget: string) =>
          document.querySelector(
            `span.exocortex-wikilink-label[data-target-path="${firstTarget}"]`,
          ) !== null,
        FIXTURES[0].target,
        { timeout: 30_000 },
      );

      // The WikilinkLabelViewPlugin requires settings.showLabelsInLivePreview=true (default).
      // It creates spans with class exocortex-wikilink-label for bare [[target]] links.
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

      // Switch to Live Preview
      await window.evaluate(async () => {
        const app = (window as any).app;
        const leaf = app?.workspace?.activeLeaf;
        if (!leaf) return;
        const currentState = leaf.getViewState();
        await leaf.setViewState({
          ...currentState,
          state: { ...currentState.state, mode: "source", source: false },
        });
      });

      // Same generous budget as Live Preview test for mode switch in CI.
      await window.waitForSelector(".cm-editor", { timeout: 30_000 });

      // Same polling guard as the Live Preview test (CI MutationObserver race).
      await window.waitForFunction(
        (firstTarget: string) =>
          document.querySelector(
            `span.exocortex-wikilink-label[data-target-path="${firstTarget}"]`,
          ) !== null,
        FIXTURES[0].target,
        { timeout: 30_000 },
      );

      // Live Preview snapshot and parity assertion
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
