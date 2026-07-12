/**
 * AssetRelationsTable — reified-relation clickable statement-link
 * (req `838c65d4`, RFC 93a0b2ee §C3; supersedes a4c8a9a0's §C2 text marker).
 *
 * Locks in the CLICKABLE reified statement-link: a relation carrying
 * `provenance: "reified"` AND a resolvable `statementPath` renders a clickable
 * `.exocortex-reified-statement-link` `<a>` whose icon host carries the native
 * lucide `link` glyph (`data-icon-name="link"`), whose hover/aria tooltip names
 * the AssetSpace (`reified · <AS>`) and hints at opening the statement, and
 * whose click opens the backing `exo__Statement` via `onAssetClick(statementPath)`.
 * The former grey `reified · <AS>` TEXT marker is GONE — the AssetSpace moved to
 * the tooltip. An `inline` (or legacy) relation, and a reified relation WITHOUT a
 * statementPath, render no icon. A persistent (mobile-safe, not hover-only)
 * `.exocortex-reified-legend` describes the icon and renders iff ≥1 icon is
 * shown. The tooltip/legend carry NO privacy claim (honest-marker, decision H).
 *
 * @req:838c65d4-bfb3-4460-9835-01e7480c8560
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, fireEvent } from "@testing-library/react";
import {
  AssetRelationsTable,
  AssetRelation,
  reifiedMarkerText,
  reifiedStatementTooltip,
} from "../../../../src/presentation/components/AssetRelationsTable";

const STMT_PATH =
  "assetspaces/kitelev/exoas-class-relations/class-relations/stmt.md";

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

const reifiedRelation = (
  overrides: Partial<AssetRelation> = {},
): AssetRelation =>
  baseRelation({
    path: "concepts/c.md",
    title: "Концепт C",
    provenance: "reified",
    assetSpace: "exoas-class-relations",
    statementPath: STMT_PATH,
    ...overrides,
  });

/** Privacy-claim tokens the honest tooltip/legend must never contain (RFC §C2 decision H). */
const PRIVACY_CLAIM_TOKENS = [
  "🔒",
  "не уедет",
  "не уйдёт",
  "private",
  "приватно и",
];

describe("AssetRelationsTable — reified statement-link (req 838c65d4, RFC 93a0b2ee C3)", () => {
  it("renders a clickable lucide `link` icon-link for a reified relation with a statementPath (NOT a text marker)", () => {
    const { container } = render(
      <AssetRelationsTable relations={[reifiedRelation()]} />,
    );

    const links = container.querySelectorAll<HTMLAnchorElement>(
      ".exocortex-reified-statement-link",
    );
    expect(links).toHaveLength(1);
    // Native lucide `link` glyph via Obsidian setIcon (mock stamps data-icon-name).
    const iconHost = links[0].querySelector<HTMLElement>(
      ".exocortex-reified-statement-link-icon",
    );
    expect(iconHost).not.toBeNull();
    expect(iconHost!.getAttribute("data-icon-name")).toBe("link");
    // The former grey text marker is gone (replaced by the icon-link).
    expect(container.querySelector(".exocortex-reified-marker")).toBeNull();
    // No visible text marker string in the icon-link.
    expect(links[0].textContent).toBe("");
  });

  it("the icon-link tooltip names the AssetSpace and hints at opening the statement", () => {
    const { container } = render(
      <AssetRelationsTable relations={[reifiedRelation()]} />,
    );
    const link = container.querySelector<HTMLElement>(
      ".exocortex-reified-statement-link",
    );
    expect(link).not.toBeNull();
    const tooltip = link!.getAttribute("title") ?? "";
    expect(tooltip).toContain("reified · exoas-class-relations");
    expect(tooltip).toContain("Открыть связь");
    // aria-label mirrors the tooltip (accessible name).
    expect(link!.getAttribute("aria-label")).toBe(tooltip);
  });

  it("clicking the icon opens the backing exo__Statement via onAssetClick(statementPath)", () => {
    const onAssetClick = jest.fn();
    const { container } = render(
      <AssetRelationsTable
        relations={[reifiedRelation()]}
        onAssetClick={onAssetClick}
      />,
    );
    const link = container.querySelector<HTMLElement>(
      ".exocortex-reified-statement-link",
    );
    expect(link).not.toBeNull();
    fireEvent.click(link!);
    expect(onAssetClick).toHaveBeenCalledTimes(1);
    expect(onAssetClick.mock.calls[0][0]).toBe(STMT_PATH);
  });

  it("renders a bare `reified` tooltip (no AS) but still a clickable icon when the AssetSpace is not derivable", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[reifiedRelation({ assetSpace: undefined })]}
      />,
    );
    const link = container.querySelector<HTMLElement>(
      ".exocortex-reified-statement-link",
    );
    expect(link).not.toBeNull();
    expect(link!.getAttribute("title")).toBe("Открыть связь · reified");
  });

  it("renders NO icon for a reified relation WITHOUT a statementPath (nothing to open)", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[reifiedRelation({ statementPath: undefined })]}
      />,
    );
    expect(
      container.querySelector(".exocortex-reified-statement-link"),
    ).toBeNull();
    // ...and no legend (no icon is shown).
    expect(container.querySelector(".exocortex-reified-legend")).toBeNull();
  });

  it("renders NO icon for an inline relation", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/b.md",
            title: "Концепт B",
            provenance: "inline",
            statementPath: STMT_PATH,
          }),
        ]}
      />,
    );
    expect(
      container.querySelector(".exocortex-reified-statement-link"),
    ).toBeNull();
    expect(container.querySelector(".exocortex-reified-legend")).toBeNull();
  });

  it("renders NO icon for a legacy relation with no provenance field", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[baseRelation({ path: "legacy/a.md", title: "A" })]}
      />,
    );
    expect(
      container.querySelector(".exocortex-reified-statement-link"),
    ).toBeNull();
  });

  it("keys strictly off provenance+statementPath — an inline relation gets NO icon even with assetSpace + statementPath", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "concepts/dup.md",
            title: "Концепт Dup",
            provenance: "inline",
            assetSpace: "exoas-class-relations",
            statementPath: STMT_PATH,
          }),
        ]}
      />,
    );
    expect(
      container.querySelector(".exocortex-reified-statement-link"),
    ).toBeNull();
  });

  it("ordinary (non-reified) rows are unchanged — the asset-name link still renders normally", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[baseRelation({ path: "plain/x.md", title: "X" })]}
      />,
    );
    const nameCellLink = container.querySelector<HTMLElement>(
      "td.asset-name a.internal-link",
    );
    expect(nameCellLink).not.toBeNull();
    expect(nameCellLink!.textContent).toBe("X");
    expect(
      container.querySelector(".exocortex-reified-statement-link"),
    ).toBeNull();
  });

  it("renders a persistent (not hover-only) legend describing the icon when a reified relation with a statementPath is present", () => {
    const { container } = render(
      <AssetRelationsTable relations={[reifiedRelation()]} />,
    );
    const legend = container.querySelector<HTMLElement>(
      ".exocortex-reified-legend",
    );
    expect(legend).not.toBeNull();
    expect(legend!.getAttribute("role")).toBe("note");
    // Describes the icon-link (open the statement), not a bygone text marker.
    expect(legend!.textContent ?? "").toContain("Иконка-ссылка");
    expect(legend!.textContent ?? "").toContain("открывает");
  });

  it("the icon-link tooltip and its persistent legend contain NO privacy claim (honest-marker)", () => {
    const { container } = render(
      <AssetRelationsTable relations={[reifiedRelation()]} />,
    );
    const link = container.querySelector<HTMLElement>(
      ".exocortex-reified-statement-link",
    );
    const legend = container.querySelector<HTMLElement>(
      ".exocortex-reified-legend",
    );
    expect(link).not.toBeNull();
    expect(legend).not.toBeNull();

    const surfaces = [
      link!.getAttribute("title") ?? "",
      link!.getAttribute("aria-label") ?? "",
      legend!.textContent ?? "",
    ]
      .join(" ")
      .toLowerCase();

    for (const token of PRIVACY_CLAIM_TOKENS) {
      expect(surfaces).not.toContain(token.toLowerCase());
    }
  });

  it("reifiedMarkerText + reifiedStatementTooltip are pure factual helpers", () => {
    expect(
      reifiedMarkerText(
        baseRelation({ provenance: "reified", assetSpace: "exoas-foo" }),
      ),
    ).toBe("reified · exoas-foo");
    expect(reifiedMarkerText(baseRelation({ provenance: "reified" }))).toBe(
      "reified",
    );
    expect(reifiedMarkerText(baseRelation({ provenance: "inline" }))).toBeNull();
    expect(reifiedMarkerText(baseRelation())).toBeNull();

    expect(
      reifiedStatementTooltip(
        baseRelation({ provenance: "reified", assetSpace: "exoas-foo" }),
      ),
    ).toBe("Открыть связь · reified · exoas-foo");
    expect(
      reifiedStatementTooltip(baseRelation({ provenance: "reified" })),
    ).toBe("Открыть связь · reified");
    expect(
      reifiedStatementTooltip(baseRelation({ provenance: "inline" })),
    ).toBeNull();
  });
});
