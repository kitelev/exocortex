/**
 * AssetRelationsTable — RFC `93a0b2ee` Phase 2 / Task 2 (C2)
 *
 * Locks in the FACTUAL reified-relation marker: a relation carrying
 * `provenance: "reified"` renders an inline `.exocortex-reified-marker` reading
 * `reified · <AS>` (the AssetSpace the backing `exo__Statement` lives in); an
 * `inline` (or legacy, no-provenance) relation renders none. A persistent
 * `.exocortex-reified-legend` (mobile-safe, not hover-only) explains the marker
 * whenever a reified relation is present. The marker is purely factual — it
 * carries NO privacy claim ("🔒" / "не уедет"); privacy depends on whether the
 * AssetSpace is shared, which is not a queryable RDF fact (RFC §C2 decision H).
 *
 * @req:a4c8a9a0-27aa-48ff-8365-eba1b40c6433
 */

import React from "react";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import {
  AssetRelationsTable,
  AssetRelation,
  reifiedMarkerText,
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

/** Privacy-claim tokens the honest marker must never contain (RFC §C2 decision H). */
const PRIVACY_CLAIM_TOKENS = [
  "🔒",
  "не уедет",
  "не уйдёт",
  "private",
  "приватно и",
];

describe("AssetRelationsTable — reified-relation marker (RFC 93a0b2ee C2)", () => {
  it("renders a `reified · <AS>` marker for a reified relation (the AssetSpace from the backing statement path)", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/c.md",
            title: "Концепт C",
            provenance: "reified",
            assetSpace: "exoas-class-relations",
            statementPath:
              "assetspaces/kitelev/exoas-class-relations/class-relations/stmt.md",
          }),
        ]}
      />,
    );

    const markers = container.querySelectorAll<HTMLElement>(
      ".exocortex-reified-marker",
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].textContent).toBe("reified · exoas-class-relations");
  });

  it("renders NO marker for an inline relation", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/b.md",
            title: "Концепт B",
            provenance: "inline",
          }),
        ]}
      />,
    );

    expect(container.querySelector(".exocortex-reified-marker")).toBeNull();
    expect(container.querySelector(".exocortex-reified-legend")).toBeNull();
  });

  it("renders NO marker for a legacy relation with no provenance field", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[baseRelation({ path: "legacy/a.md", title: "A" })]}
      />,
    );

    expect(container.querySelector(".exocortex-reified-marker")).toBeNull();
  });

  it("keys strictly off provenance — an inline relation gets NO marker even if it carries an assetSpace", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/dup.md",
            title: "Концепт Dup",
            provenance: "inline",
            assetSpace: "exoas-class-relations",
          }),
        ]}
      />,
    );

    expect(container.querySelector(".exocortex-reified-marker")).toBeNull();
  });

  it("renders a bare `reified` marker when the AssetSpace is not derivable", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/e.md",
            title: "Концепт E",
            provenance: "reified",
          }),
        ]}
      />,
    );

    const marker = container.querySelector<HTMLElement>(
      ".exocortex-reified-marker",
    );
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toBe("reified");
  });

  it("renders a persistent (not hover-only) explanation legend when a reified relation is present", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/c.md",
            title: "Концепт C",
            provenance: "reified",
            assetSpace: "exoas-class-relations",
          }),
        ]}
      />,
    );

    const legend = container.querySelector<HTMLElement>(
      ".exocortex-reified-legend",
    );
    // Persistent: a plain on-screen element (role=note), NOT a hover-only title.
    expect(legend).not.toBeNull();
    expect(legend!.getAttribute("role")).toBe("note");
    expect(legend!.textContent ?? "").toContain("reified");
  });

  it("the marker and its persistent legend contain NO privacy claim (honest-marker)", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/c.md",
            title: "Концепт C",
            provenance: "reified",
            assetSpace: "exoas-class-relations",
          }),
        ]}
      />,
    );

    const marker = container.querySelector<HTMLElement>(
      ".exocortex-reified-marker",
    );
    const legend = container.querySelector<HTMLElement>(
      ".exocortex-reified-legend",
    );
    // The marker must actually be present (so this is a real honest-marker check,
    // not a vacuous pass on an absent element).
    expect(marker).not.toBeNull();
    expect(legend).not.toBeNull();

    // Factual surfaces: visible text + the accessible title/aria explanation.
    const surfaces = [
      marker!.textContent ?? "",
      marker!.getAttribute("title") ?? "",
      marker!.getAttribute("aria-label") ?? "",
      legend!.textContent ?? "",
    ]
      .join(" ")
      .toLowerCase();

    for (const token of PRIVACY_CLAIM_TOKENS) {
      expect(surfaces).not.toContain(token.toLowerCase());
    }
  });

  it("reifiedMarkerText is a pure factual helper", () => {
    expect(
      reifiedMarkerText(
        baseRelation({ provenance: "reified", assetSpace: "exoas-foo" }),
      ),
    ).toBe("reified · exoas-foo");
    expect(reifiedMarkerText(baseRelation({ provenance: "reified" }))).toBe(
      "reified",
    );
    expect(
      reifiedMarkerText(baseRelation({ provenance: "inline" })),
    ).toBeNull();
    expect(reifiedMarkerText(baseRelation())).toBeNull();
  });
});
