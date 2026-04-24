/**
 * Component test — RFC be70f741 Phase 3 ISO 25010 Security gap.
 *
 * `ui__RelationColumnSet_columns` names are user-controlled (vault owner
 * edits the asset frontmatter).  React auto-escapes text nodes; this spec
 * proves that three canonical XSS shapes round-trip as inert text:
 *   - `<script>alert(1)</script>`
 *   - `javascript:alert(1)` href
 *   - HTML entities + hex escapes (`&amp; &#x3c;img src=x onerror=y>`)
 */

import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import {
  AssetRelationsTable,
  AssetRelation,
} from "../../src/presentation/components/AssetRelationsTable";

const XSS_RELATIONS: AssetRelation[] = [
  {
    path: "Tasks/xss-1.md",
    title: "<script>alert(1)</script>",
    propertyName: "ems__Effort_parent",
    isBodyLink: false,
    created: 0,
    modified: 0,
    metadata: {
      exo__Instance_class: ["[[ems__Task]]"],
      exo__Asset_label: "<script>alert('xss-1')</script>",
      payload__Script: "<script>alert('xss-script-col')</script>",
      payload__Href: "javascript:alert('xss-href')",
      payload__Entities: "&amp; &#x3c;img src=x onerror=alert(1)>",
    },
  },
];

const XSS_COLUMNS: Record<string, string[]> = {
  ems__Effort_parent: ["payload__Script", "payload__Href", "payload__Entities"],
};

test.describe("RelationColumnSet — XSS sanitization (Phase 3 AC7)", () => {
  test("<script> markers render as inert text, never execute", async ({
    mount,
    page,
  }) => {
    const alerts: string[] = [];
    page.on("dialog", async (dialog) => {
      alerts.push(dialog.message());
      await dialog.dismiss();
    });

    const component = await mount(
      <AssetRelationsTable
        relations={XSS_RELATIONS}
        groupByProperty={true}
        groupSpecificProperties={XSS_COLUMNS}
      />,
    );

    // React renders the literal string in the DOM as TEXT_NODE, not an element.
    const cells = component.locator("tbody td");
    await expect(cells.first()).toBeVisible();

    // No <script> element was injected via the cell contents.
    const scriptCount = await component.evaluate((node) => {
      return node.querySelectorAll(".exocortex-relations-table tbody script")
        .length;
    });
    expect(scriptCount).toBe(0);

    // window.alert was never triggered.
    expect(alerts).toHaveLength(0);
  });

  test("javascript: URIs never become live <a href=...>", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTable
        relations={XSS_RELATIONS}
        groupByProperty={true}
        groupSpecificProperties={XSS_COLUMNS}
      />,
    );

    // Scan every anchor inside the table body — no `javascript:` href should
    // exist (React would not interpret the string as a URL by default; we
    // assert the stronger invariant anyway).
    const hrefs = await component.evaluate((node) =>
      Array.from(
        node.querySelectorAll<HTMLAnchorElement>(
          ".exocortex-relations-table tbody a",
        ),
      ).map((a) => a.getAttribute("href") ?? ""),
    );
    for (const href of hrefs) {
      expect(href.startsWith("javascript:")).toBe(false);
    }
  });

  test("HTML entities render as literal characters (text-node content)", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTable
        relations={XSS_RELATIONS}
        groupByProperty={true}
        groupSpecificProperties={XSS_COLUMNS}
      />,
    );

    // The literal string `&amp; &#x3c;img src=x onerror=alert(1)>` must appear
    // verbatim in the DOM — not interpreted as HTML.
    await expect(
      component.locator("tbody").getByText(
        "&amp; &#x3c;img src=x onerror=alert(1)>",
        { exact: false },
      ),
    ).toBeVisible();

    // And no <img> element was produced.
    const imgCount = await component.evaluate(
      (node) =>
        node.querySelectorAll(".exocortex-relations-table tbody img").length,
    );
    expect(imgCount).toBe(0);
  });
});
