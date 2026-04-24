/**
 * Component test — RFC exo__Layout Phase 2 MVG (Metric M1).
 *
 * Renders `BacklinksTableBlockView` (the user-facing block that replaces the
 * default Asset Relations table) with columns `[exo__Asset_createdAt,
 * exo__Asset_label]` — the MVG case in RFC §"Метрики успеха / M1".
 *
 * Asserts:
 *   - Exactly TWO columnheaders render (no default Name / Instance Class).
 *   - Each fixture row is rendered with the configured columns.
 */

import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import { BacklinksTableBlockView } from "../../src/presentation/components/LayoutBlocks";
import type { AssetRelation } from "../../src/presentation/renderers/layout/types";

const WEEK_CREATED = new Date("2026-03-01T00:00:00Z").getTime();

const rows: AssetRelation[] = [
  {
    path: "Objectives/wo-1.md",
    title: "Ship RFC exo__Layout Phase 2",
    propertyName: "ems__WeeklyObjective__week",
    isBodyLink: false,
    created: WEEK_CREATED + 10 * 60_000,
    modified: WEEK_CREATED + 60 * 60_000,
    metadata: {
      exo__Instance_class: ["[[ems__WeeklyObjective]]"],
      exo__Asset_label: "Ship RFC exo__Layout Phase 2",
      exo__Asset_createdAt: "2026-03-01T00:10:00+0500",
    },
    file: { path: "Objectives/wo-1.md", basename: "wo-1" },
  } as AssetRelation,
  {
    path: "Objectives/wo-2.md",
    title: "Close defect remediation follow-up",
    propertyName: "ems__WeeklyObjective__week",
    isBodyLink: false,
    created: WEEK_CREATED + 20 * 60_000,
    modified: WEEK_CREATED + 30 * 60_000,
    metadata: {
      exo__Instance_class: ["[[ems__WeeklyObjective]]"],
      exo__Asset_label: "Close defect remediation follow-up",
      exo__Asset_createdAt: "2026-03-01T00:20:00+0500",
    },
    file: { path: "Objectives/wo-2.md", basename: "wo-2" },
  } as AssetRelation,
];

test.describe("ExoLayout MVG — BacklinksTableBlockView (Phase 2 AC)", () => {
  test("renders exactly 2 columns from configured `columns` (NOT Name + Instance Class)", async ({
    mount,
  }) => {
    const component = await mount(
      <BacklinksTableBlockView
        title="Weekly Objectives"
        columns={["exo__Asset_createdAt", "exo__Asset_label"]}
        rows={rows}
      />,
    );

    const headers = component.getByRole("columnheader");
    await expect(headers).toHaveCount(2);

    await expect(
      component.getByRole("columnheader", { name: "exo__Asset_createdAt" }),
    ).toBeVisible();
    await expect(
      component.getByRole("columnheader", { name: "exo__Asset_label" }),
    ).toBeVisible();

    // MUST NOT contain default Asset Relations columns.
    await expect(
      component.getByRole("columnheader", { name: /^Name$/i }),
    ).toHaveCount(0);
    await expect(
      component.getByRole("columnheader", { name: /Instance Class/i }),
    ).toHaveCount(0);
  });

  test("renders one tbody row per fixture row", async ({ mount }) => {
    const component = await mount(
      <BacklinksTableBlockView
        title="Weekly Objectives"
        columns={["exo__Asset_createdAt", "exo__Asset_label"]}
        rows={rows}
      />,
    );
    await expect(component.locator("tbody tr")).toHaveCount(rows.length);
  });

  test("renders block title (user-controlled text) via JSX text node", async ({
    mount,
  }) => {
    const component = await mount(
      <BacklinksTableBlockView
        title="Weekly Objectives"
        columns={["exo__Asset_label"]}
        rows={rows}
      />,
    );
    await expect(
      component.locator(".exocortex-layout-block-title"),
    ).toHaveText("Weekly Objectives");
  });
});
