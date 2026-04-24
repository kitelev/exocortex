/**
 * Component test — RFC be70f741 Phase 3 coexistence with RFC-024
 * `exo__TableLayout`.
 *
 * RFC-024 codeblock layouts and `ui__RelationColumnSet` solve different
 * problems: RFC-024 = explicit per-note table, Phase 3 = per-class auto-
 * backlinks.  This spec mounts a single `CoexistenceHarness` wrapper (the
 * Playwright CT contract requires a statically-importable mount target)
 * that composes a mock table-layout codeblock with the real relations
 * table, and asserts:
 *   - both tables render
 *   - neither table's headers leak into the other
 *   - the RelationColumnSet grouping is isolated from the codeblock DOM
 */

import { test, expect } from "@playwright/experimental-ct-react";
import type { AssetRelation } from "../../src/presentation/components/AssetRelationsTable";
// Playwright CT tsx-transform only removes an import declaration when ALL of
// its specifiers are JSX components; mixing constants and JSX components in
// one import leaves the original binding in place and conflicts with the
// injected `importRef` stub (ReferenceError at module eval).  Split them.
import { CoexistenceHarness } from "./RelationColumnSetCoexistence.testHelpers";
import { STATIC_TABLE_COLUMNS } from "./RelationColumnSetCoexistence.testHelpers";

const RELATIONS: AssetRelation[] = [
  {
    path: "Tasks/t1.md",
    title: "Task A",
    propertyName: "ems__Effort_parent",
    isBodyLink: false,
    created: 0,
    modified: 0,
    metadata: {
      exo__Instance_class: ["[[ems__Task]]"],
      exo__Asset_label: "Task A",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
    },
  },
];

const GROUP_SPECIFIC_PROPERTIES = {
  ems__Effort_parent: ["ems__Effort_status"],
};

test.describe("RelationColumnSet — coexistence with exo__TableLayout (Phase 3 AC9)", () => {
  test("both tables render independently on the same page", async ({
    mount,
  }) => {
    const component = await mount(
      <CoexistenceHarness
        relations={RELATIONS}
        groupSpecificProperties={GROUP_SPECIFIC_PROPERTIES}
      />,
    );

    await expect(
      component.locator(".exocortex-table-layout-codeblock"),
    ).toBeVisible();
    await expect(
      component.locator(".exocortex-relations-grouped"),
    ).toBeVisible();
  });

  test("RFC-024 columns never appear in the relations table header row", async ({
    mount,
  }) => {
    const component = await mount(
      <CoexistenceHarness
        relations={RELATIONS}
        groupSpecificProperties={GROUP_SPECIFIC_PROPERTIES}
      />,
    );

    const relationsHeaders = component.locator(
      ".exocortex-relations-grouped thead th",
    );
    const headerText = await relationsHeaders.allInnerTexts();
    for (const col of STATIC_TABLE_COLUMNS) {
      expect(headerText.join(" ")).not.toContain(col);
    }
  });

  test("relations group header is isolated from codeblock tbody", async ({
    mount,
  }) => {
    const component = await mount(
      <CoexistenceHarness
        relations={RELATIONS}
        groupSpecificProperties={GROUP_SPECIFIC_PROPERTIES}
      />,
    );

    await expect(
      component
        .locator('[data-testid="rfc024"]')
        .locator(".relation-group-header"),
    ).toHaveCount(0);
  });
});
