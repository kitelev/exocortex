import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";

/**
 * RFC be70f741 Phase 3 — L3 E2E smoke.
 *
 * MVG (RFC §"Мотивирующий кейс пользователя"): open a `period__Week` asset,
 * observe the backlinks table rendered with the columns declared by the
 * matching `ui__RelationColumnSet` asset — here
 * `[exo__Asset_createdAt, exo__Asset_label]` for the three
 * `ems__WeeklyObjective` fixture rows.
 *
 * Budget ≤25s (RFC v2 §Phase 3 exit-criteria).  Shard 3 hosts this spec
 * because it carries the lowest last-10 median (~92s).
 */
test.describe("RelationColumnSet — Phase 3 smoke", () => {
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
    "period__Week → ems__WeeklyObjective backlinks show resolver-driven columns",
    { timeout: 25_000 },
    async () => {
      await launcher.openFile("relcolset/week-2026-w17.md");
      await launcher.waitForModalsToClose(10_000);

      // UniversalLayout renders `.exocortex-assets-relations` when at least
      // one backlink is found.  The relations React tree below it carries
      // the grouped table.
      await launcher.waitForElement(".exocortex-assets-relations", 15_000);

      const relationsRoot = launcher.page.locator(
        ".exocortex-assets-relations",
      );
      await expect(relationsRoot).toBeVisible();

      // 3 ems__WeeklyObjective fixture rows in the group.
      const groupRows = relationsRoot.locator(
        ".exocortex-relations-grouped tbody tr",
      );
      await expect(groupRows).toHaveCount(3);

      // Resolver-driven columns humanised from the raw IRIs.
      await expect(
        relationsRoot.getByRole("columnheader", { name: /Createdat/i }),
      ).toBeVisible();
      await expect(
        relationsRoot.getByRole("columnheader", { name: /Label/i }),
      ).toBeVisible();
    },
  );
});
