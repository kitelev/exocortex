/**
 * Component test — RFC be70f741 Phase 3 MVG.
 *
 * Renders `AssetRelationsTable` with a `groupSpecificProperties` map derived
 * from the MVG fixture (period__Week → 3 ems__WeeklyObjective →
 * [createdAt, label]) and asserts the two resolver-driven columnheaders.
 *
 * The resolver + repository are unit-tested upstream; this spec validates
 * that the downstream React contract (columns propagate as `getByRole`
 * columnheader) is honored when the resolver-fed map reaches the component.
 */

import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import { AssetRelationsTable } from "../../src/presentation/components/AssetRelationsTable";
import {
  happyPathGroupSpecificProperties,
  happyPathRelations,
} from "./fixtures/relation-column-set";

test.describe("RelationColumnSetResolver — MVG (Phase 3 AC1)", () => {
  test("renders createdAt and label columnheaders for ems__WeeklyObjective__week group", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTable
        relations={happyPathRelations}
        groupByProperty={true}
        groupSpecificProperties={happyPathGroupSpecificProperties}
      />,
    );

    // Group header humanized from raw property IRI.  `humanizePropertyName`
    // strips the `ems__` prefix, converts `_` → ` `, and capitalises word
    // starts; `WeeklyObjective` is a single identifier with no underscore
    // separator, so it stays concatenated.
    await expect(
      component.locator(".group-header").first(),
    ).toBeVisible();

    // Column headers humanized from raw IRI; happy-path fixture drives
    // `["exo__Asset_createdAt", "exo__Asset_label"]`.
    await expect(
      component.getByRole("columnheader", { name: /Createdat/i }),
    ).toBeVisible();
    await expect(
      component.getByRole("columnheader", { name: /Label/i }),
    ).toBeVisible();

    // Every fixture row is rendered.
    await expect(component.locator("tbody tr")).toHaveCount(
      happyPathRelations.length,
    );
  });

  test("preserves snapshot shape when resolver returns no entries (legacy fallback)", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTable
        relations={happyPathRelations}
        groupByProperty={true}
        // No groupSpecificProperties → AssetRelationsTable uses default {} — mimics
        // the disabled feature-flag code-path in RelationsRenderer.
      />,
    );

    // No extra columnheaders beyond Name / Instance Class.
    await expect(
      component.getByRole("columnheader", { name: /Createdat/i }),
    ).toHaveCount(0);
    await expect(
      component.getByRole("columnheader", { name: /Label/i }),
    ).toHaveCount(0);
  });
});
