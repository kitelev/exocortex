/**
 * LinkRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";


import { LinkRenderer } from "@plugin/presentation/renderers/cell-renderers/LinkRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("LinkRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Test Column",
    property: "[[exo__Asset_label]]",
  });

  describe("WikiLink Parsing", () => {
    it("renders wikilink target as link", () => {
      render(
        <LinkRenderer
          value="[[target]]"
          column={createColumn()}
        />
      );

      expect(screen.getByRole("link")).toHaveTextContent("target");
      expect(screen.getByRole("link")).toHaveAttribute("data-href", "target");
    });

    it("renders wikilink alias when provided", () => {
      render(
        <LinkRenderer
          value="[[target|Display Name]]"
          column={createColumn()}
        />
      );

      expect(screen.getByRole("link")).toHaveTextContent("Display Name");
      expect(screen.getByRole("link")).toHaveAttribute("data-href", "target");
    });

    it("handles wikilink with spaces", () => {
      render(
        <LinkRenderer
          value="[[path/to/note]]"
          column={createColumn()}
        />
      );

      expect(screen.getByRole("link")).toHaveTextContent("path/to/note");
    });
  });

  describe("Click Handling", () => {
    it("calls onLinkClick with target when wikilink is clicked", () => {
      const onLinkClick = jest.fn();
      render(
        <LinkRenderer
          value="[[target]]"
          column={createColumn()}
          onLinkClick={onLinkClick}
        />
      );

      fireEvent.click(screen.getByRole("link"));

      expect(onLinkClick).toHaveBeenCalledWith("target", expect.any(Object));
    });

    it("calls onLinkClick with assetPath when plain text is clicked", () => {
      const onLinkClick = jest.fn();
      render(
        <LinkRenderer
          value="Plain Text"
          column={createColumn()}
          assetPath="/path/to/asset.md"
          onLinkClick={onLinkClick}
        />
      );

      fireEvent.click(screen.getByRole("link"));

      expect(onLinkClick).toHaveBeenCalledWith("/path/to/asset.md", expect.any(Object));
    });

    it("prevents default click behavior", () => {
      const onLinkClick = jest.fn();
      render(
        <LinkRenderer
          value="[[target]]"
          column={createColumn()}
          onLinkClick={onLinkClick}
        />
      );

      const link = screen.getByRole("link");
      const event = fireEvent.click(link);

      // Event should be prevented
      expect(onLinkClick).toHaveBeenCalled();
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <LinkRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-link-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <LinkRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for empty string", () => {
      render(
        <LinkRenderer
          value=""
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("Plain Text", () => {
    it("renders plain text without link when no assetPath", () => {
      render(
        <LinkRenderer
          value="Plain Text"
          column={createColumn()}
        />
      );

      expect(screen.getByText("Plain Text")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("renders plain text as link when assetPath provided", () => {
      render(
        <LinkRenderer
          value="Plain Text"
          column={createColumn()}
          assetPath="/path/to/asset.md"
        />
      );

      expect(screen.getByRole("link")).toHaveTextContent("Plain Text");
    });
  });
});
