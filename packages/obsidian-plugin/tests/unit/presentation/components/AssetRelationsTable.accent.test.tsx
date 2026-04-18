/**
 * AssetRelationsTable — RFC-024 Phase 1 AC5
 *
 * Locks in the visual-accent wiring: when a `resolveAccent` callback is
 * supplied, the Instance-class cell wraps each class reference with a
 * `.exocortex-class-badge` span whose inline-style carries the resolved
 * accent colour via `border-left`. When the callback returns `null`, no
 * accent styling leaks onto the badge.
 */

import React from "react";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import {
  AssetRelationsTable,
  AssetRelation,
} from "../../../../src/presentation/components/AssetRelationsTable";

const baseRelation = (overrides: Partial<AssetRelation> = {}): AssetRelation => ({
  path: "p.md",
  title: "P",
  propertyName: undefined,
  isBodyLink: true,
  created: 0,
  modified: 0,
  metadata: {},
  ...overrides,
});

describe("AssetRelationsTable — class badge accent (RFC-024 AC5)", () => {
  it("applies resolveAccent result as border-left on the class badge", () => {
    const resolveAccent = (classRef: string) =>
      classRef === "ems__Task" ? "var(--color-green)" : null;

    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "tasks/a.md",
            title: "A",
            metadata: { exo__Instance_class: "[[ems__Task]]" },
          }),
        ]}
        resolveAccent={resolveAccent}
      />,
    );

    const badges = container.querySelectorAll<HTMLElement>(
      ".exocortex-class-badge",
    );
    expect(badges).toHaveLength(1);
    const badge = badges[0];
    expect(badge.style.borderLeftStyle).toBe("solid");
    expect(badge.style.borderLeftColor).toBe("var(--color-green)");
    // The actual <a class="internal-link"> must remain inside the badge.
    expect(badge.querySelector("a.internal-link")).not.toBeNull();
  });

  it("omits accent styling when resolveAccent returns null", () => {
    const resolveAccent = () => null;

    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            path: "misc/b.md",
            title: "B",
            metadata: { exo__Instance_class: "[[foo__Unknown]]" },
          }),
        ]}
        resolveAccent={resolveAccent}
      />,
    );

    const badge = container.querySelector<HTMLElement>(
      ".exocortex-class-badge",
    );
    expect(badge).not.toBeNull();
    expect(badge!.style.borderLeftStyle).toBe("");
    expect(badge!.style.borderLeftColor).toBe("");
  });

  it("resolves accent per class when the row has multiple instance classes", () => {
    const resolveAccent = (classRef: string) => {
      if (classRef === "ems__Task") return "var(--color-green)";
      if (classRef === "ems__Project") return "var(--color-purple)";
      return null;
    };

    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            metadata: {
              exo__Instance_class: ["[[ems__Task]]", "[[ems__Project]]"],
            },
          }),
        ]}
        resolveAccent={resolveAccent}
      />,
    );

    const badges = container.querySelectorAll<HTMLElement>(
      ".exocortex-class-badge",
    );
    expect(badges).toHaveLength(2);
    expect(badges[0].style.borderLeftColor).toBe("var(--color-green)");
    expect(badges[1].style.borderLeftColor).toBe("var(--color-purple)");
  });

  it("still renders the badge without accent when resolveAccent prop is absent", () => {
    const { container } = render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            metadata: { exo__Instance_class: "[[ems__Task]]" },
          }),
        ]}
      />,
    );

    const badge = container.querySelector<HTMLElement>(
      ".exocortex-class-badge",
    );
    expect(badge).not.toBeNull();
    expect(badge!.style.borderLeftStyle).toBe("");
  });

  it("normalises wikilinked alias form when calling resolveAccent", () => {
    const seen: string[] = [];
    const resolveAccent = (classRef: string) => {
      seen.push(classRef);
      return classRef === "ems__Task" ? "var(--color-green)" : null;
    };

    render(
      <AssetRelationsTable
        relations={[
          baseRelation({
            metadata: { exo__Instance_class: "[[ems__Task|Task]]" },
          }),
        ]}
        resolveAccent={resolveAccent}
      />,
    );

    expect(seen).toContain("ems__Task");
  });
});
