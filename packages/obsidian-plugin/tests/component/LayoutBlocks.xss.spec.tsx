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
  QueryTableBlockView,
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

  // RFC 9821a379 (ticket 058bad52) — the query-table block draws a named
  // query's rows: column names, cell texts, link labels (display names of
  // vault assets) and the problem message all come from vault data.
  test("QueryTableBlockView title, columns, cells and link labels escape XSS vectors", async ({
    mount,
    page,
  }) => {
    const rows = await mount(
      <QueryTableBlockView
        title={scriptVector}
        state={{
          kind: "rows",
          columns: [scriptVector, "label"],
          rows: [
            [
              { kind: "text", text: eventVector },
              { kind: "link", path: jsUriVector, text: scriptVector },
            ],
          ],
          total: 1,
          elapsedMs: 3,
          emptyText: "Нет строк",
        }}
      />,
    );
    await expect(rows.locator("script")).toHaveCount(0);
    await expect(rows.locator("img")).toHaveCount(0);
    await expect(rows.locator("td").first()).toHaveText(eventVector);
    await expect(rows.locator("a.internal-link")).toHaveText(scriptVector);
    // The link carries href like the daily-efforts block does; a click is
    // prevented and routed to onLinkClick, so even a javascript: path never runs.
    await rows.locator("a.internal-link").click();

    const fired = await page.evaluate(
      () => (window as unknown as { __xss_fired__?: boolean }).__xss_fired__ === true,
    );
    expect(fired).toBe(false);
  });

  test("QueryTableBlockView problem message escapes XSS vectors", async ({
    mount,
    page,
  }) => {
    const message = await mount(
      <QueryTableBlockView title="" state={{ kind: "message", text: eventVector }} />,
    );
    await expect(message.locator("img")).toHaveCount(0);
    await expect(message.locator("[role=alert]")).toHaveText(eventVector);

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
