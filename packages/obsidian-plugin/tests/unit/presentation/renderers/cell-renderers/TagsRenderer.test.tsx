/**
 * TagsRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";


import { TagsRenderer } from "@plugin/presentation/renderers/cell-renderers/TagsRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("TagsRenderer", () => {
  const createColumn = (): LayoutColumn => ({
    uid: "col-1",
    label: "Tags",
    property: "tags",
  });

  describe("Array Input", () => {
    it("renders array of tags", () => {
      render(
        <TagsRenderer
          value={["tag1", "tag2", "tag3"]}
          column={createColumn()}
        />
      );

      expect(screen.getByText("tag1")).toBeInTheDocument();
      expect(screen.getByText("tag2")).toBeInTheDocument();
      expect(screen.getByText("tag3")).toBeInTheDocument();
    });

    it("filters empty strings from array", () => {
      render(
        <TagsRenderer
          value={["tag1", "", "tag2", "  "]}
          column={createColumn()}
        />
      );

      const tags = screen.getAllByText(/tag/);
      expect(tags).toHaveLength(2);
    });

    it("converts non-string array items to strings", () => {
      render(
        <TagsRenderer
          value={[1, 2, 3] as unknown as string[]}
          column={createColumn()}
        />
      );

      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  describe("String Input", () => {
    it("splits comma-separated string", () => {
      render(
        <TagsRenderer
          value="tag1, tag2, tag3"
          column={createColumn()}
        />
      );

      expect(screen.getByText("tag1")).toBeInTheDocument();
      expect(screen.getByText("tag2")).toBeInTheDocument();
      expect(screen.getByText("tag3")).toBeInTheDocument();
    });

    it("splits newline-separated string", () => {
      const valueWithNewlines = `tag1
tag2
tag3`;
      render(
        <TagsRenderer
          value={valueWithNewlines}
          column={createColumn()}
        />
      );

      expect(screen.getByText("tag1")).toBeInTheDocument();
      expect(screen.getByText("tag2")).toBeInTheDocument();
      expect(screen.getByText("tag3")).toBeInTheDocument();
    });

    it("trims whitespace from tags", () => {
      render(
        <TagsRenderer
          value="  tag1  ,  tag2  "
          column={createColumn()}
        />
      );

      expect(screen.getByText("tag1")).toBeInTheDocument();
      expect(screen.getByText("tag2")).toBeInTheDocument();
    });
  });

  describe("WikiLink Tags", () => {
    it("extracts label from wikilink without alias", () => {
      render(
        <TagsRenderer
          value={["[[Category/Tag1]]", "[[Tag2]]"]}
          column={createColumn()}
        />
      );

      expect(screen.getByText("Category/Tag1")).toBeInTheDocument();
      expect(screen.getByText("Tag2")).toBeInTheDocument();
    });

    it("extracts alias from wikilink with alias", () => {
      render(
        <TagsRenderer
          value={["[[Category/Tag1|Tag 1]]", "[[Tag2|Second Tag]]"]}
          column={createColumn()}
        />
      );

      expect(screen.getByText("Tag 1")).toBeInTheDocument();
      expect(screen.getByText("Second Tag")).toBeInTheDocument();
    });

    it("renders clickable wikilink tags when onLinkClick provided", () => {
      const onLinkClick = jest.fn();
      render(
        <TagsRenderer
          value={["[[Tag1]]"]}
          column={createColumn()}
          onLinkClick={onLinkClick}
        />
      );

      const tag = screen.getByText("Tag1");
      expect(tag.tagName).toBe("A");
      expect(tag).toHaveClass("exo-cell-tag-clickable");
      expect(tag).toHaveAttribute("data-href", "Tag1");
    });

    it("calls onLinkClick when wikilink tag is clicked", () => {
      const onLinkClick = jest.fn();
      render(
        <TagsRenderer
          value={["[[Category/Tag1]]"]}
          column={createColumn()}
          onLinkClick={onLinkClick}
        />
      );

      fireEvent.click(screen.getByText("Category/Tag1"));
      expect(onLinkClick).toHaveBeenCalledWith("Category/Tag1", expect.any(Object));
    });

    it("renders non-wikilink tags as spans", () => {
      render(
        <TagsRenderer
          value={["plain-tag"]}
          column={createColumn()}
          onLinkClick={jest.fn()}
        />
      );

      const tag = screen.getByText("plain-tag");
      expect(tag.tagName).toBe("SPAN");
    });
  });

  describe("Color Assignment", () => {
    it("assigns consistent color to same tag", () => {
      const { rerender } = render(
        <TagsRenderer
          value={["important"]}
          column={createColumn()}
        />
      );

      const firstTag = screen.getByText("important");
      const firstColorClass = Array.from(firstTag.classList).find(c => c.startsWith("exo-tag-"));

      rerender(
        <TagsRenderer
          value={["important"]}
          column={createColumn()}
        />
      );

      const secondTag = screen.getByText("important");
      const secondColorClass = Array.from(secondTag.classList).find(c => c.startsWith("exo-tag-"));

      expect(firstColorClass).toBe(secondColorClass);
    });

    it("uses valid color classes", () => {
      render(
        <TagsRenderer
          value={["tag1", "tag2", "tag3"]}
          column={createColumn()}
        />
      );

      const tags = screen.getAllByText(/tag/);
      tags.forEach(tag => {
        const colorClass = Array.from(tag.classList).find(c => c.startsWith("exo-tag-"));
        expect(colorClass).toMatch(/^exo-tag-(blue|green|yellow|orange|red|purple|pink|gray)$/);
      });
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <TagsRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-tags-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <TagsRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for empty array", () => {
      render(
        <TagsRenderer
          value={[]}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for empty string", () => {
      render(
        <TagsRenderer
          value=""
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("CSS Classes", () => {
    it("has container class", () => {
      const { container } = render(
        <TagsRenderer
          value={["tag1"]}
          column={createColumn()}
        />
      );

      expect(container.querySelector(".exo-cell-tags")).toBeInTheDocument();
    });

    it("each tag has correct class", () => {
      render(
        <TagsRenderer
          value={["tag1"]}
          column={createColumn()}
        />
      );

      expect(screen.getByText("tag1")).toHaveClass("exo-cell-tag");
    });
  });
});
