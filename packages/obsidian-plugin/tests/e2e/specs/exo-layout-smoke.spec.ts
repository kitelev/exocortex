// flaky-track: Issue #3308 — observed 2026-05-31 on PR #3307 (B.1 GitHubRestClient).
// Symptom: `e2e-shard(4)` ExoLayout BacklinksTableBlock smoke — Obsidian Electron
// process termination timeout. Sibling shard(2) flake (daily-archive-filter @flaky-track)
// observed same calendar day on PR #3305 — shared root-cause hypothesis: Playwright
// Electron driver process management in headless macOS CI runner. Both retried green.
// Per RFC 32a64ed9 §3.3 escalation: tag surfaces frequency in telemetry; promote to
// `@flaky-fix` on incident #2 with root-cause PR, close on N≥100 zero-further runs.
import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";

/**
 * RFC exo__Layout Phase 3 — L3 E2E smoke.
 *
 * MVG (RFC v1 §"Мотивирующий кейс пользователя"): open an `exo__DemoClass`
 * asset, observe the declared `exo__Layout` render a single
 * `exo__BacklinksTableBlock` with exactly the two configured columns
 * (`exo__Asset_createdAt`, `exo__Asset_label`) — NOT the default Name +
 * Instance Class Asset Relations table, and NOT wrapped in the legacy
 * "Asset Relations" heading (because `coexistsWithDefault: false`).
 *
 * Budget ≤25s (RFC v1 §Phase 3 exit-criteria). Shard 3 hosts this spec
 * alongside the RelationColumnSet smoke because both drive the same
 * UniversalLayout pipeline with minimal interaction (no modals, no input).
 */
test.describe(
  "ExoLayout — Phase 3 smoke",
  {
    tag: ["@flaky-track"],
    annotation: {
      type: "flaky-track",
      description:
        "Issue #3308 — Electron termination timeout observed PR #3307 2026-05-31; RFC 32a64ed9 §3.3 track bucket; watch criteria: incident #2 → fix, N≥100 zero-further → close",
    },
  },
  () => {
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
    "exo__DemoClass note renders declared BacklinksTableBlock with 2 columns and NO default Asset Relations wrapper",
    { timeout: 25_000 },
    async () => {
      await launcher.openFile("exolayout/demo-target.md");
      await launcher.waitForModalsToClose(10_000);

      // The ExoLayoutRenderer emits `.exocortex-exo-layout` as the block
      // container; one child `.exocortex-exo-layout-block` per resolved block.
      await launcher.waitForElement(".exocortex-exo-layout", 15_000);

      const layoutRoot = launcher.page.locator(".exocortex-exo-layout");
      await expect(layoutRoot).toBeVisible();

      const blocks = layoutRoot.locator(".exocortex-exo-layout-block");
      await expect(blocks).toHaveCount(1);

      // The block title comes from `exo__LayoutBlock_title` in the fixture.
      await expect(
        layoutRoot.locator(
          ".exocortex-layout-block-title:has-text(\"Demo Rows\")",
        ),
      ).toBeVisible();

      // Exactly TWO columnheaders rendered by BacklinksTableBlockView —
      // NOT the legacy Name + Instance Class pair.
      const headers = layoutRoot.getByRole("columnheader");
      await expect(headers).toHaveCount(2);
      await expect(
        layoutRoot.getByRole("columnheader", { name: "exo__Asset_createdAt" }),
      ).toBeVisible();
      await expect(
        layoutRoot.getByRole("columnheader", { name: "exo__Asset_label" }),
      ).toBeVisible();

      // 3 exo__DemoRow fixture rows referencing demo-target.
      const rows = layoutRoot.locator(
        ".exocortex-layout-block-backlinks-table tbody tr",
      );
      await expect(rows).toHaveCount(3);

      // coexistsWithDefault=false ⇒ UniversalLayout returns early and the
      // legacy grouped Asset Relations table is NOT mounted.
      await expect(
        launcher.page.locator(".exocortex-assets-relations"),
      ).toHaveCount(0);
      await expect(
        launcher.page.locator(".exocortex-relations-grouped"),
      ).toHaveCount(0);
    },
  );
});
