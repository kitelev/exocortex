/**
 * TextRenderer Unit Tests
 */

import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";


import { TextRenderer } from "@plugin/presentation/renderers/cell-renderers/TextRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("TextRenderer", () => {
  const createColumn = (overrides: Partial<LayoutColumn> = {}): LayoutColumn => ({
    uid: "col-1",
    label: "Test Column",
    property: "[[exo__Asset_label]]",
    editable: false,
    ...overrides,
  });

  describe("Display Mode", () => {
    it("renders string value", () => {
      render(
        <TextRenderer
          value="Hello World"
          column={createColumn()}
        />
      );

      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    it("renders number value as string", () => {
      render(
        <TextRenderer
          value={42}
          column={createColumn()}
        />
      );

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("renders dash for null value", () => {
      render(
        <TextRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for undefined value", () => {
      render(
        <TextRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders empty string as dash", () => {
      render(
        <TextRenderer
          value=""
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("Edit Mode", () => {
    it("shows input when editing", () => {
      const { container } = render(
        <TextRenderer
          value="Test"
          column={createColumn({ editable: true })}
          isEditing={true}
        />
      );

      const input = container.querySelector("input.exo-cell-input-text");
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("Test");
    });

    it("does not show input when not editing", () => {
      const { container } = render(
        <TextRenderer
          value="Test"
          column={createColumn({ editable: true })}
          isEditing={false}
        />
      );

      expect(container.querySelector("input.exo-cell-input-text")).not.toBeInTheDocument();
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    it("does not show input when column is not editable", () => {
      const { container } = render(
        <TextRenderer
          value="Test"
          column={createColumn({ editable: false })}
          isEditing={true}
        />
      );

      expect(container.querySelector("input.exo-cell-input-text")).not.toBeInTheDocument();
    });

    it("calls onChange when value is modified and blur", () => {
      const onChange = jest.fn();
      const { container } = render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
        />
      );

      const input = container.querySelector("input.exo-cell-input-text");
      expect(input).not.toBeNull();
      fireEvent.change(input!, { target: { value: "Modified" } });
      fireEvent.blur(input!);

      expect(onChange).toHaveBeenCalledWith("Modified");
    });

    it("calls onChange when Enter is pressed", () => {
      const onChange = jest.fn();
      const onBlur = jest.fn();
      const { container } = render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const input = container.querySelector("input.exo-cell-input-text");
      expect(input).not.toBeNull();
      fireEvent.change(input!, { target: { value: "Modified" } });
      fireEvent.keyDown(input!, { key: "Enter" });

      expect(onChange).toHaveBeenCalledWith("Modified");
      expect(onBlur).toHaveBeenCalled();
    });

    it("reverts value when Escape is pressed", () => {
      const onChange = jest.fn();
      const onBlur = jest.fn();
      const { container } = render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const input = container.querySelector("input.exo-cell-input-text");
      expect(input).not.toBeNull();
      fireEvent.change(input!, { target: { value: "Modified" } });
      fireEvent.keyDown(input!, { key: "Escape" });

      expect(onChange).not.toHaveBeenCalled();
      expect(onBlur).toHaveBeenCalled();
    });

    it("does not call onChange when value is unchanged", () => {
      const onChange = jest.fn();
      const { container } = render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
        />
      );

      const input = container.querySelector("input.exo-cell-input-text");
      expect(input).not.toBeNull();
      fireEvent.blur(input!);

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("Wikilink Resolution", () => {
    it("renders embedded wikilink without alias using target path", () => {
      const { container } = render(
        <TextRenderer
          value="• [[some-asset-uuid]]"
          column={createColumn()}
        />
      );

      const link = container.querySelector("a.internal-link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent("some-asset-uuid");
      expect(link).toHaveAttribute("data-href", "some-asset-uuid");
    });

    it("renders embedded wikilink with resolved label when getAssetLabel is provided", () => {
      const getAssetLabel = jest.fn().mockReturnValue("Resolved Label");

      const { container } = render(
        <TextRenderer
          value="Owner: [[some-asset-uuid]]"
          column={createColumn()}
          getAssetLabel={getAssetLabel}
        />
      );

      const link = container.querySelector("a.internal-link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent("Resolved Label");
      expect(getAssetLabel).toHaveBeenCalledWith("some-asset-uuid");
    });

    it("renders wikilink with alias using alias text (ignoring getAssetLabel)", () => {
      const getAssetLabel = jest.fn().mockReturnValue("Should Not Appear");

      const { container } = render(
        <TextRenderer
          value="• [[asset-uuid|Custom Alias]]"
          column={createColumn()}
          getAssetLabel={getAssetLabel}
        />
      );

      const link = container.querySelector("a.internal-link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent("Custom Alias");
      // getAssetLabel should not be called when alias is present
      expect(getAssetLabel).not.toHaveBeenCalled();
    });

    it("renders multiple embedded wikilinks with resolved labels", () => {
      const getAssetLabel = jest.fn()
        .mockReturnValueOnce("Person A")
        .mockReturnValueOnce("Person B");

      const { container } = render(
        <TextRenderer
          value="Assigned to [[uuid-1]] and [[uuid-2]]"
          column={createColumn()}
          getAssetLabel={getAssetLabel}
        />
      );

      const links = container.querySelectorAll("a.internal-link");
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveTextContent("Person A");
      expect(links[1]).toHaveTextContent("Person B");
    });

    it("falls back to target path when getAssetLabel returns null", () => {
      const getAssetLabel = jest.fn().mockReturnValue(null);

      const { container } = render(
        <TextRenderer
          value="• [[fallback-uuid]]"
          column={createColumn()}
          getAssetLabel={getAssetLabel}
        />
      );

      const link = container.querySelector("a.internal-link");
      expect(link).toHaveTextContent("fallback-uuid");
    });

    it("calls onLinkClick when wikilink is clicked", () => {
      const onLinkClick = jest.fn();

      const { container } = render(
        <TextRenderer
          value="Click [[target-asset]]"
          column={createColumn()}
          onLinkClick={onLinkClick}
        />
      );

      const link = container.querySelector("a.internal-link");
      expect(link).not.toBeNull();
      fireEvent.click(link!);

      expect(onLinkClick).toHaveBeenCalledWith("target-asset", expect.any(Object));
    });

    it("renders plain text without wikilinks normally", () => {
      const { container } = render(
        <TextRenderer
          value="Just plain text without any links"
          column={createColumn()}
        />
      );

      expect(screen.getByText("Just plain text without any links")).toBeInTheDocument();
      expect(container.querySelector("a.internal-link")).not.toBeInTheDocument();
    });

    it("preserves surrounding text when rendering embedded wikilinks", () => {
      const getAssetLabel = jest.fn().mockReturnValue("Resolved");

      const { container } = render(
        <TextRenderer
          value="Before [[link]] After"
          column={createColumn()}
          getAssetLabel={getAssetLabel}
        />
      );

      // Check that the span contains "Before", the link, and "After"
      const span = container.querySelector(".exo-cell-text");
      expect(span?.textContent).toBe("Before Resolved After");
    });
  });
});
