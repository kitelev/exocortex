import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E gate for C3 capability-inheritance + override (RFC `78c2b7d0`, the
 * ХРЕБЕТ child RFC; deferred from #3504 / issue #3505).
 *
 * Validates the FULL plugin pipeline for class-capability inheritance —
 * the same `CommandResolver.resolveForAssetMulti` consolidation that
 * `CommandResolver.capabilityInheritance.test.ts` proves at the unit layer,
 * but observed end-to-end in a real Obsidian UI:
 *
 *   class TBox (`exo__Class_superClass`) + ancestor-targeted CommandBinding
 *     → NoteToRDFConverter → TripleStore
 *     → DynamicCommandButtonGroupBuilder.extractAssetClasses (leaf class only)
 *     → CommandResolver.resolveForAssetMulti (superClass-BFS, nearest-wins,
 *        absolute `overrides`)
 *     → PreconditionEvaluator → ActionButtonsGroup → DOM
 *
 * TBox fixture (`03 Knowledge/commands/c3/`): `e2ecap__Dog ⊑ e2ecap__Animal`
 * and `e2ecap__Cat ⊑ e2ecap__Animal`. Bindings:
 *   - `Feed Animal`  → targetClass `e2ecap__Animal` (inherited by Dog & Cat)
 *   - `Walk Dog`     → targetClass `e2ecap__Dog`    (leaf, depth 0)
 *   - `Custom Feed`  → targetClass `e2ecap__Cat`, `overrides [[…feed-animal]]`
 *
 * Instances:
 *   - `03 Knowledge/c3-dog-instance.md` (class `e2ecap__Dog`)
 *   - `03 Knowledge/c3-cat-instance.md` (class `e2ecap__Cat`)
 *
 * Assertions (the three C3 DoD UI gates):
 *   1. Inheritance  — `Feed Animal` (Animal-bound) is present on a Dog instance.
 *   2. Nearest-wins — `Walk Dog` (depth 0) renders ABOVE `Feed Animal` (depth 1).
 *   3. Override     — a Cat-level binding's `overrides` edge HIDES the inherited
 *                     `Feed Animal`; only `Custom Feed` renders.
 */
// RFC Phase 3.2 (T2.1): per-spec retry(1) — net-new Cat H spec, mirrors the
// sibling dynamic-command / featured-binding specs.
test.describe.configure({ retries: 1 });

test.describe("C3 capability-inheritance + override (RFC 78c2b7d0)", () => {
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

  /**
   * Open an asset, wait for its auto-layout to fully (re-)render with a
   * populated triple store + metadataCache, and return the buttons section
   * locator. Mirrors the deterministic render-signal dance proven in
   * `featured-binding-promotion.spec.ts` (#2985): invalidate → refresh →
   * wait for old container detach → wait for the freshly-mounted container.
   */
  async function openAndRenderButtons(filePath: string) {
    await launcher.openFile(filePath);
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter to populate (#2693).
    await expect
      .poll(
        async () => {
          return window.evaluate(() => {
            const app = (window as any).app;
            const file = app?.workspace?.getActiveFile();
            if (!file) return null;
            const cache = app.metadataCache.getFileCache(file);
            return cache?.frontmatter
              ? JSON.stringify(Object.keys(cache.frontmatter))
              : null;
          });
        },
        { timeout: 15000 },
      )
      .not.toBeNull();

    const oldLayoutRendered = window
      .locator(".exocortex-auto-layout.exocortex-layout-rendered")
      .first();

    // Force re-render with populated triple store + metadataCache so the
    // superClass-BFS sees the full class chain before any assertion.
    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    await oldLayoutRendered
      .waitFor({ state: "detached", timeout: 5000 })
      .catch(() => {});

    await window
      .locator(".exocortex-auto-layout.exocortex-layout-rendered")
      .first()
      .waitFor({ state: "attached", timeout: 20000 });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });
    return buttonsSection;
  }

  test("inherits an ancestor-class binding — Feed Animal (Animal-bound) renders on a Dog instance", async () => {
    const section = await openAndRenderButtons(
      "03 Knowledge/c3-dog-instance.md",
    );

    // `Feed Animal` is bound on `e2ecap__Animal`; the Dog instance declares
    // only `e2ecap__Dog`. The resolver-side superClass-BFS must surface it.
    await expect(
      section.locator('button.exocortex-action-button:has-text("Feed Animal")'),
      "inherited Animal-bound `Feed Animal` button must render on a Dog instance",
    ).toBeVisible({ timeout: 20000 });

    // The own leaf-class binding `Walk Dog` must also render.
    await expect(
      section.locator('button.exocortex-action-button:has-text("Walk Dog")'),
      "own `Walk Dog` button must render on a Dog instance",
    ).toBeVisible({ timeout: 20000 });
  });

  test("nearest-wins ordering — Walk Dog (depth 0) renders above the inherited Feed Animal (depth 1)", async () => {
    const section = await openAndRenderButtons(
      "03 Knowledge/c3-dog-instance.md",
    );

    const walkDog = section.locator(
      'button.exocortex-action-button:has-text("Walk Dog")',
    );
    const feedAnimal = section.locator(
      'button.exocortex-action-button:has-text("Feed Animal")',
    );
    await expect(walkDog).toBeVisible({ timeout: 20000 });
    await expect(feedAnimal).toBeVisible({ timeout: 20000 });

    // Both bindings share order=100 and the `c3demo` category, so the only
    // ordering signal is class depth. `(priority, depth, order)` nearest-wins
    // must place the subclass-targeted `Walk Dog` (depth 0) above the
    // ancestor-targeted `Feed Animal` (depth 1).
    const walkBox = await walkDog.boundingBox();
    const feedBox = await feedAnimal.boundingBox();
    expect(walkBox, "Walk Dog must have a layout box").not.toBeNull();
    expect(feedBox, "Feed Animal must have a layout box").not.toBeNull();
    expect(
      walkBox!.y,
      "nearest-wins: `Walk Dog` (subclass depth 0) must render above `Feed Animal` (ancestor depth 1)",
    ).toBeLessThan(feedBox!.y);
  });

  test("override hides the inherited binding — Cat shows Custom Feed but not the inherited Feed Animal", async () => {
    const section = await openAndRenderButtons(
      "03 Knowledge/c3-cat-instance.md",
    );

    // The Cat-level `Custom Feed` binding carries
    // `exocmd__CommandBinding_overrides: [[e2e-bind-feed-animal]]`, removing
    // the inherited Animal binding absolutely from the merged set.
    await expect(
      section.locator('button.exocortex-action-button:has-text("Custom Feed")'),
      "Cat-level `Custom Feed` (the overriding binding) must render",
    ).toBeVisible({ timeout: 20000 });

    // The inherited `Feed Animal` must be absent. Poll a beat so a late
    // re-render cannot transiently surface it before the override applies.
    await expect
      .poll(
        async () => {
          return section
            .locator('button.exocortex-action-button:has-text("Feed Animal")')
            .count();
        },
        {
          timeout: 8000,
          message:
            "overridden `Feed Animal` button must NOT render on the Cat instance",
        },
      )
      .toBe(0);
  });
});
