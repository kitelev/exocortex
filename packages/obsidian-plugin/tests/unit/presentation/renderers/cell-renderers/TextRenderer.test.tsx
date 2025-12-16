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
      render(
        <TextRenderer
          value="Test"
          column={createColumn({ editable: true })}
          isEditing={true}
        />
      );

      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toHaveValue("Test");
    });

    it("does not show input when not editing", () => {
      render(
        <TextRenderer
          value="Test"
          column={createColumn({ editable: true })}
          isEditing={false}
        />
      );

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByText("Test")).toBeInTheDocument();
    });

    it("does not show input when column is not editable", () => {
      render(
        <TextRenderer
          value="Test"
          column={createColumn({ editable: false })}
          isEditing={true}
        />
      );

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("calls onChange when value is modified and blur", () => {
      const onChange = jest.fn();
      render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Modified" } });
      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledWith("Modified");
    });

    it("calls onChange when Enter is pressed", () => {
      const onChange = jest.fn();
      const onBlur = jest.fn();
      render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Modified" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onChange).toHaveBeenCalledWith("Modified");
      expect(onBlur).toHaveBeenCalled();
    });

    it("reverts value when Escape is pressed", () => {
      const onChange = jest.fn();
      const onBlur = jest.fn();
      render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Modified" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onChange).not.toHaveBeenCalled();
      expect(onBlur).toHaveBeenCalled();
    });

    it("does not call onChange when value is unchanged", () => {
      const onChange = jest.fn();
      render(
        <TextRenderer
          value="Original"
          column={createColumn({ editable: true })}
          isEditing={true}
          onChange={onChange}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.blur(input);

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
