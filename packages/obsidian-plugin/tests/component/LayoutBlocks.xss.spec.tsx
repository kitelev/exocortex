/**
 * Component test — RFC exo__Layout Phase 2 Security.
 *
 * Asserts that user-controlled text flowing into `LayoutBlock_title`,
 * cell values, and column headers is JSX-escaped (never routed through
 * `dangerouslySetInnerHTML`).  Covers classic XSS vectors:
 *   - `<script>` tags
 *   - `javascript:` URIs
 *   - HTML entities (`<img onerror=...>`)
 *   - Unicode / IDN-like mixed scripts
 */

import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import {
  BacklinksTableBlockView,
  PropertiesBlockView,
} from "../../src/presentation/components/LayoutBlocks";
import type { AssetRelation } from "../../src/presentation/renderers/layout/types";

const scriptVector = '<script>window.__xss_fired__=true;</script>';
const eventVector = '"><img src=x onerror="window.__xss_fired__=true">';
const jsUriVector = 'javascript:window.__xss_fired__=true';

const maliciousRow: AssetRelation = {
  path: "evil.md",
  title: scriptVector,
  propertyName: undefined,
  isBodyLink: false,
  created: 0,
  modified: 0,
  metadata: {
    exo__Instance_class: ["[[ems__Task]]"],
    exo__Asset_label: scriptVector,
    custom_field: eventVector,
  },
  file: { path: "evil.md", basename: "evil" },
} as AssetRelation;

test.describe("LayoutBlocks XSS — JSX auto-escaping prevents script execution", () => {
  test("BacklinksTableBlockView title + cells escape <script>/event/javascript: vectors", async ({
    mount,
    page,
  }) => {
    const component = await mount(
      <BacklinksTableBlockView
        title={scriptVector}
        columns={["exo__Asset_label", "custom_field"]}
        rows={[maliciousRow]}
      />,
    );

    // Sentinel never set — no script or event handler executed.
    const fired = await page.evaluate(
      () => (window as unknown as { __xss_fired__?: boolean }).__xss_fired__ === true,
    );
    expect(fired).toBe(false);

    // Title rendered as text (not HTML) — the `<script>` tag is visible
    // verbatim and NOT present as a DOM element.
    await expect(
      component.locator(".exocortex-layout-block-title"),
    ).toHaveText(scriptVector);
    await expect(component.locator("script")).toHaveCount(0);
  });

  test("PropertiesBlockView property values escape XSS vectors", async ({
    mount,
    page,
  }) => {
    await mount(
      <PropertiesBlockView
        title="Metadata"
        properties={[
          { key: "exo__Asset_label", value: scriptVector },
          { key: "evil_url", value: jsUriVector },
          { key: "evil_event", value: eventVector },
        ]}
      />,
    );

    const fired = await page.evaluate(
      () => (window as unknown as { __xss_fired__?: boolean }).__xss_fired__ === true,
    );
    expect(fired).toBe(false);
  });

  test("column header text is escaped (user-controlled column names)", async ({
    mount,
    page,
  }) => {
    await mount(
      <BacklinksTableBlockView
        title="Safe title"
        columns={[scriptVector, "normal_col"]}
        rows={[maliciousRow]}
      />,
    );

    const fired = await page.evaluate(
      () => (window as unknown as { __xss_fired__?: boolean }).__xss_fired__ === true,
    );
    expect(fired).toBe(false);
  });

  test("HTML entities do not break rendering (U+FFFD, combining diacritics)", async ({
    mount,
  }) => {
    const unicodeTitle = "Tést🧨 日本 — ‮evil";
    const component = await mount(
      <BacklinksTableBlockView
        title={unicodeTitle}
        columns={["exo__Asset_label"]}
        rows={[maliciousRow]}
      />,
    );
    await expect(
      component.locator(".exocortex-layout-block-title"),
    ).toHaveText(unicodeTitle);
  });
});
