import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E test for RFC-024 Phase 3 `featuredBinding` visual invariant
 * (Phase 3 success metric: "1 primary per panel verified в e2e").
 *
 * Pipeline exercised:
 *   exo__Layout asset (with `commandPanel.featuredBinding`)
 *     → triple store → LayoutParser → PanelResolver.isFeatured()
 *     → DynamicCommandButtonGroupBuilder.createButton (variant=primary)
 *     → ActionButtonsGroup (`exocortex-action-button--primary` class)
 *     → DOM
 *
 * Fixtures (kept self-contained to avoid coupling with shared Task notes):
 * - exolayout/layout-task-featured-binding.md
 *     `exo__Layout` for `ems__Task` with
 *     `commandPanel.featuredBinding = [[e2e-bind-status-done-for-tasks]]`.
 * - Tasks/featured-binding-test.md
 *     `ems__Task` with `status=Doing` (so the "Complete" precondition
 *     passes) and `startTimestamp` set (so "Remove Start Timestamp"
 *     also renders — gives the panel ≥2 buttons to verify the
 *     singleton invariant against).
 *
 * The status group's default variant is `secondary` and Maintenance is
 * `muted` (categoryDefaultVariants.ts); only the featured `Complete`
 * button must carry `--primary`.
 */
// RFC Phase 3.2 (T2.1): per-spec retry(1) — top T0.2 offender (rank #1, Cat H net-new spec).
test.describe.configure({ mode: "parallel", retries: 1 });

test.describe("RFC-024 Phase 3 — featuredBinding promotion", () => {
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

  test("promotes the layout's featuredBinding to `primary`, keeping exactly one primary button per panel", async () => {
    await launcher.openFile("Tasks/featured-binding-test.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter to populate (#2693).
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter
          ? JSON.stringify(Object.keys(cache.frontmatter))
          : null;
      });
    }, { timeout: 15000 }).not.toBeNull();

    // Force re-render with populated triple store + metadataCache.
    // `refreshLayout()` removes the old auto-layout container and fires a
    // fire-and-forget async render — `evaluate` resolves before the new
    // render commits. Without an explicit re-render signal here, downstream
    // assertions race against `featuredBinding` promotion (#2985).
    //
    // Capture the current `.exocortex-layout-rendered` element; the refresh
    // will detach it and a NEW container will get the class once render() in
    // UniversalLayoutRenderer reaches its terminal `el.addClass(...)` line.
    // Awaiting both transitions makes the rest of the spec deterministic.
    const oldLayoutRendered = window
      .locator(".exocortex-auto-layout.exocortex-layout-rendered")
      .first();

    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    // Old container is removed by `removeAutoRenderedLayouts()` at the very
    // start of `autoRenderLayout()`. Ignore detach failures (a previous test
    // run could have left no rendered marker — e.g. settings.layoutVisible
    // off — and then there's nothing to wait for).
    await oldLayoutRendered
      .waitFor({ state: "detached", timeout: 5000 })
      .catch(() => {});

    // Wait for the freshly mounted auto-layout to reach its rendered marker
    // before any visual assertion. This is the explicit render signal that
    // RFC-024 Phase 3 visual invariants depend on.
    await window
      .locator(".exocortex-auto-layout.exocortex-layout-rendered")
      .first()
      .waitFor({ state: "attached", timeout: 20000 });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });

    // The "Complete" button (e2e-bind-status-done-for-tasks) is the
    // panel's `featuredBinding` and MUST carry the `--primary` class.
    const completeButton = buttonsSection.locator(
      'button.exocortex-action-button:has-text("Complete")',
    );
    await expect(
      completeButton,
      'featuredBinding "Complete" button must render',
    ).toBeVisible({ timeout: 20000 });
    await expect(
      completeButton,
      'featuredBinding "Complete" must be promoted to --primary variant',
    ).toHaveClass(/exocortex-action-button--primary/);

    // RFC-024 Phase 3 metric: exactly ONE primary button per panel.
    // Maintenance category may be collapsed-by-default, so any featured
    // binding that lives in a non-status group still must not yield a
    // second `--primary`. Counting at the panel level rather than after
    // disclosure-expansion keeps the assertion deterministic.
    const primaryButtons = buttonsSection.locator(
      "button.exocortex-action-button.exocortex-action-button--primary",
    );
    await expect(
      primaryButtons,
      "exactly one button per panel may be promoted by featuredBinding",
    ).toHaveCount(1);
  });
});
