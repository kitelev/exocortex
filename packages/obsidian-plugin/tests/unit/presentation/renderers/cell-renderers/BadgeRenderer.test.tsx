/**
 * BadgeRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";


import { BadgeRenderer } from "@plugin/presentation/renderers/cell-renderers/BadgeRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("BadgeRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Status",
    property: "status",
  });

  describe("Basic Rendering", () => {
    it("renders string value as badge", () => {
      render(
        <BadgeRenderer
          value="Active"
          column={createColumn()}
        />
      );

      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getByText("Active")).toHaveClass("exo-cell-badge");
    });

    it("assigns consistent color class based on value", () => {
      const { rerender } = render(
        <BadgeRenderer
          value="Active"
          column={createColumn()}
        />
      );

      const firstBadge = screen.getByText("Active");
      const firstColorClass = Array.from(firstBadge.classList).find(c => c.startsWith("exo-badge-"));

      // Re-render with same value should get same color
      rerender(
        <BadgeRenderer
          value="Active"
          column={createColumn()}
        />
      );

      const secondBadge = screen.getByText("Active");
      const secondColorClass = Array.from(secondBadge.classList).find(c => c.startsWith("exo-badge-"));

      expect(firstColorClass).toBe(secondColorClass);
    });

    it("different values get potentially different colors", () => {
      const { rerender } = render(
        <BadgeRenderer
          value="Active"
          column={createColumn()}
        />
      );

      const activeBadge = screen.getByText("Active");
      const activeColor = Array.from(activeBadge.classList).find(c => c.startsWith("exo-badge-"));

      rerender(
        <BadgeRenderer
          value="Inactive"
          column={createColumn()}
        />
      );

      const inactiveBadge = screen.getByText("Inactive");
      const inactiveColor = Array.from(inactiveBadge.classList).find(c => c.startsWith("exo-badge-"));

      // Colors should be from the valid set
      expect(activeColor).toMatch(/^exo-badge-(blue|green|yellow|orange|red|purple|pink|gray)$/);
      expect(inactiveColor).toMatch(/^exo-badge-(blue|green|yellow|orange|red|purple|pink|gray)$/);
    });
  });

  describe("WikiLink Handling", () => {
    it("extracts label from wikilink without alias", () => {
      render(
        <BadgeRenderer
          value="[[Status/Active]]"
          column={createColumn()}
        />
      );

      expect(screen.getByText("Status/Active")).toBeInTheDocument();
    });

    it("extracts alias from wikilink with alias", () => {
      render(
        <BadgeRenderer
          value="[[Status/Active|Active]]"
          column={createColumn()}
        />
      );

      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("renders clickable badge for wikilink when onLinkClick provided", () => {
      const onLinkClick = jest.fn();
      render(
        <BadgeRenderer
          value="[[Status/Active]]"
          column={createColumn()}
          onLinkClick={onLinkClick}
        />
      );

      const badge = screen.getByText("Status/Active");
      expect(badge.tagName).toBe("A");
      expect(badge).toHaveClass("exo-cell-badge-clickable");
      expect(badge).toHaveAttribute("data-href", "Status/Active");
    });

    it("calls onLinkClick when wikilink badge is clicked", () => {
      const onLinkClick = jest.fn();
      render(
        <BadgeRenderer
          value="[[Status/Active]]"
          column={createColumn()}
          onLinkClick={onLinkClick}
        />
      );

      fireEvent.click(screen.getByText("Status/Active"));
      expect(onLinkClick).toHaveBeenCalledWith("Status/Active", expect.any(Object));
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <BadgeRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-badge-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <BadgeRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for empty string", () => {
      render(
        <BadgeRenderer
          value=""
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("Type Coercion", () => {
    it("converts number to string badge", () => {
      render(
        <BadgeRenderer
          value={42}
          column={createColumn()}
        />
      );

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("converts boolean to string badge", () => {
      render(
        <BadgeRenderer
          value={true}
          column={createColumn()}
        />
      );

      expect(screen.getByText("true")).toBeInTheDocument();
    });
  });
});
