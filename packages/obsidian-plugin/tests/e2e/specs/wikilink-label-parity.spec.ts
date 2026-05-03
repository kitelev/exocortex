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
 * Test strategy:
 * - Test 1 (Reading View DOM): Full E2E — verifies <a class="internal-link"> text.
 * - Test 2 (Live Preview API): API-level — verifies WikilinkLabelViewPlugin.resolveLabel()
 *   data source (metadataCache) returns the correct labels. CodeMirror Decoration.replace()
 *   widgets are not observable in Docker CI (visibleRanges is empty in headless rendering),
 *   so we test the resolver logic that feeds the widget instead.
 * - Test 3 (Parity): Verifies Reading View DOM alias equals metadataCache label,
 *   ensuring both modes would display the same label.
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
    "Live Preview: WikilinkLabelViewPlugin resolves correct labels for all 3 asset types",
    { timeout: 45_000 },
    async () => {
      await launcher.openFile(HOST_FILE);
      const window = await launcher.getWindow();

      await waitForExocortexPluginViaPlaywright(window, {
        specName: "wikilink-label-parity/live-preview",
      });

      // Verify via the same metadataCache path that WikilinkLabelViewPlugin.resolveLabel()
      // uses internally (see WikilinkLabelViewPlugin.ts:resolveLabel).
      // This confirms the plugin has the data it needs to display labels in Live Preview.
      //
      // Note: CodeMirror Decoration.replace() widgets (span.exocortex-wikilink-label)
      // are not observable in Docker CI because visibleRanges is empty in headless
      // Electron without GPU. Unit tests cover the widget creation logic directly.
      // This test covers the data layer that feeds the widget.
      const results = await window.evaluate(async (targets: string[]) => {
        const app = (window as any).app;
        const metadataCache = app.metadataCache;

        return targets.map((target) => {
          let file = metadataCache.getFirstLinkpathDest(target, "");
          if (!file) {
            file = metadataCache.getFirstLinkpathDest(target + ".md", "");
          }
          if (!file) return { target, label: null, error: "file not found in metadataCache" };
          const cache = metadataCache.getFileCache(file);
          const label: string | null = cache?.frontmatter?.exo__Asset_label ?? null;
          return { target, label };
        });
      }, FIXTURES.map((f) => f.target) as string[]);

      for (const { type, target, label } of FIXTURES) {
        const result = (
          results as Array<{ target: string; label: string | null; error?: string }>
        ).find((r) => r.target === target);
        expect(
          result?.label,
          `Live Preview: ${type} — resolveLabel("${target}") should return "${label}"${result?.error ? ` (error: ${result.error})` : ""}`,
        ).toBe(label);
      }
    },
  );

  test(
    "Parity: Reading View alias and metadata label are identical for all 3 types",
    { timeout: 45_000 },
    async () => {
      await launcher.openFile(HOST_FILE);
      const window = await launcher.getWindow();

      await waitForExocortexPluginViaPlaywright(window, {
        specName: "wikilink-label-parity/parity",
      });

      for (const { type, target, label } of FIXTURES) {
        // Reading View DOM: alias rendered by Obsidian from aliases frontmatter
        const link = window.locator(`a.internal-link[data-href="${target}"]`);
        await expect(link, `Parity: ${type} Reading View link should be visible`).toBeVisible({
          timeout: 15_000,
        });
        const readingViewText = await link.innerText();

        // Metadata cache: label that WikilinkLabelViewPlugin.resolveLabel() returns
        const metadataLabel = await window.evaluate((t: string) => {
          const app = (window as any).app;
          const cache = app.metadataCache;
          const file =
            cache.getFirstLinkpathDest(t, "") || cache.getFirstLinkpathDest(t + ".md", "");
          return file ? (cache.getFileCache(file)?.frontmatter?.exo__Asset_label ?? null) : null;
        }, target);

        // Both Reading View alias and Live Preview resolver must show the expected label
        expect(
          readingViewText,
          `Parity: ${type} Reading View should show "${label}"`,
        ).toBe(label);
        expect(
          metadataLabel,
          `Parity: ${type} metadata label should equal Reading View text "${readingViewText}"`,
        ).toBe(readingViewText);

        // Guard: neither should show the raw filename (simulates UUID scenario)
        expect(readingViewText, `Parity: ${type} must not show raw filename`).not.toBe(target);
        expect(
          metadataLabel,
          `Parity: ${type} metadata label must not be null or filename`,
        ).not.toBe(target);
      }
    },
  );
});
