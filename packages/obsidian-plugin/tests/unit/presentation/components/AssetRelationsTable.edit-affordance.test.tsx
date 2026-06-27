/**
 * AssetRelationsTable — PDD puzzle `dccff87b` (RFC `93a0b2ee` §C3 read-view
 * follow-up).
 *
 * Locks in the read-view → editor entry point: when an `onEditRelations`
 * callback is wired (i.e. the renderer threaded the viewed asset's
 * `currentFile`), the read-view Relations block renders a SINGLE block-level
 * «Edit relations» affordance (`.exocortex-edit-relations`) that invokes the
 * callback on activation. With no callback the affordance is absent (additive —
 * zero read-view regression). The callback opens the asset's property-editor
 * (the Relations section, Tasks 3.1–3.3) so relation editing is discoverable
 * directly from the read view, not only via the command palette.
 *
 * @req:cbb982a3-17dc-42ec-8a01-9857d81a881f
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, fireEvent } from "@testing-library/react";
import {
  AssetRelationsTable,
  AssetRelation,
} from "../../../../src/presentation/components/AssetRelationsTable";

const baseRelation = (
  overrides: Partial<AssetRelation> = {},
): AssetRelation => ({
  path: "p.md",
  title: "P",
  propertyName: undefined,
  isBodyLink: true,
  created: 0,
  modified: 0,
  metadata: {},
  ...overrides,
});

describe("AssetRelationsTable — read-view «Edit relations» affordance (PDD dccff87b)", () => {
  it("renders a single `.exocortex-edit-relations` button and invokes onEditRelations on click", () => {
    const onEditRelations = jest.fn();
    const { container } = render(
      <AssetRelationsTable
        relations={[baseRelation()]}
        onEditRelations={onEditRelations}
      />,
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".exocortex-edit-relations",
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Edit relations");

    fireEvent.click(buttons[0]);
    expect(onEditRelations).toHaveBeenCalledTimes(1);
  });

  it("renders NO affordance when onEditRelations is absent (additive — back-compat)", () => {
    const { container } = render(
      <AssetRelationsTable relations={[baseRelation()]} />,
    );

    expect(
      container.querySelectorAll(".exocortex-edit-relations"),
    ).toHaveLength(0);
  });

  it("renders a single affordance in grouped mode too", () => {
    const onEditRelations = jest.fn();
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({ propertyName: "ems__Effort_parent", isBodyLink: false }),
          baseRelation({ propertyName: "ems__Effort_area", isBodyLink: false }),
        ]}
        groupByProperty
        onEditRelations={onEditRelations}
      />,
    );

    expect(
      container.querySelectorAll(".exocortex-edit-relations"),
    ).toHaveLength(1);
  });
});
