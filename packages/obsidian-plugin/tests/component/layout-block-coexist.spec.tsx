/**
 * Component test — RFC exo__Layout Phase 2 coexist mode.
 *
 * When Layout.coexistsWithDefault=true, the ExoLayout blocks render THEN
 * the default Asset Relations section renders below them.  This spec
 * simulates the DOM composition by mounting both components sequentially
 * within a parent container and asserting their relative order.
 */

import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import {
  BacklinksTableBlockView,
  PropertiesBlockView,
} from "../../src/presentation/components/LayoutBlocks";
import type { AssetRelation } from "../../src/presentation/renderers/layout/types";

const rows: AssetRelation[] = [
  {
    path: "Tasks/t-1.md",
    title: "Example task",
    propertyName: "ems__Effort_parent",
    isBodyLink: false,
    created: 0,
    modified: 0,
    metadata: {
      exo__Instance_class: ["[[ems__Task]]"],
      exo__Asset_label: "Example task",
    },
    file: { path: "Tasks/t-1.md", basename: "t-1" },
  } as AssetRelation,
];

test.describe("ExoLayout coexist mode", () => {
  test("renders Properties block followed by Backlinks block followed by Asset Relations", async ({
    mount,
  }) => {
    const component = await mount(
      <div>
        <PropertiesBlockView
          title="Asset Properties"
          properties={[
            { key: "exo__Asset_label", value: "Current asset" },
            { key: "ems__Effort_status", value: "[[ems__EffortStatusDoing]]" },
          ]}
        />
        <BacklinksTableBlockView
          title="Child Tasks"
          columns={["exo__Asset_label"]}
          rows={rows}
        />
        <div className="exocortex-assets-relations">
          <h3>Asset Relations</h3>
          <table role="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Instance Class</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Example task</td>
                <td>ems__Task</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>,
    );

    // Three section containers must all be present.
    await expect(
      component.locator(".exocortex-layout-block-properties"),
    ).toBeVisible();
    await expect(
      component.locator(".exocortex-layout-block-backlinks"),
    ).toBeVisible();
    await expect(
      component.locator(".exocortex-assets-relations"),
    ).toBeVisible();

    // Verify DOM order: props → backlinks → asset-relations.
    const allSections = component.locator(
      ".exocortex-layout-block-properties, .exocortex-layout-block-backlinks, .exocortex-assets-relations",
    );
    await expect(allSections).toHaveCount(3);

    const orderedClasses: string[] = await allSections.evaluateAll((els) =>
      els.map((el) => {
        const classList = (el as HTMLElement).className;
        if (classList.includes("properties")) return "properties";
        if (classList.includes("backlinks")) return "backlinks";
        return "asset-relations";
      }),
    );
    expect(orderedClasses).toEqual(["properties", "backlinks", "asset-relations"]);
  });
});
