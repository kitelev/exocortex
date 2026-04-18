import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import {
  AssetRelationsTable,
  AssetRelation,
} from "../../src/presentation/components/AssetRelationsTable";

/**
 * RFC-024 Phase 1 AC5 — AssetRelationsTable badge accent wiring.
 *
 * Locks in the rendered DOM so that the `resolveAccent` prop's output is
 * applied via an inline `border-left` on `.exocortex-class-badge` wrappers.
 */

const mockRelation = (overrides: Partial<AssetRelation> = {}): AssetRelation => ({
  path: "tasks/a.md",
  title: "Task A",
  propertyName: undefined,
  isBodyLink: true,
  created: 0,
  modified: 0,
  metadata: {},
  ...overrides,
});

test.describe("AssetRelationsTable — class badge accent (AC5)", () => {
  test("badge surfaces resolveAccent colour via inline border-left", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTable
        relations={[
          mockRelation({
            metadata: { exo__Instance_class: "[[ems__Task]]" },
          }),
        ]}
        resolveAccent={(classRef) =>
          classRef === "ems__Task" ? "rgb(34, 139, 34)" : null
        }
      />,
    );

    const badge = component.locator(".exocortex-class-badge").first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveCSS("border-left-style", "solid");
    await expect(badge).toHaveCSS("border-left-color", "rgb(34, 139, 34)");
  });

  test("badge renders without accent styling when resolveAccent returns null", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTable
        relations={[
          mockRelation({
            metadata: { exo__Instance_class: "[[foo__Unknown]]" },
          }),
        ]}
        resolveAccent={() => null}
      />,
    );

    const badge = component.locator(".exocortex-class-badge").first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveCSS("border-left-style", "none");
  });
});
