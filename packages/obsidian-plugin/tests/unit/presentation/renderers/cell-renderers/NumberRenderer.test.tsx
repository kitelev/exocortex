/**
 * NumberRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";


import { NumberRenderer } from "@plugin/presentation/renderers/cell-renderers/NumberRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("NumberRenderer", () => {
  const createColumn = (editable = false): LayoutColumn => ({
    uid: "col-1",
    label: "Count",
    property: "count",
    editable,
  });

  describe("Number Display", () => {
    it("renders integer value", () => {
      render(
        <NumberRenderer
          value={42}
          column={createColumn()}
        />
      );

      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByTitle("42")).toBeInTheDocument();
    });

    it("renders decimal value with formatting", () => {
      render(
        <NumberRenderer
          value={1234.567}
          column={createColumn()}
        />
      );

      // Intl.NumberFormat formats with max 2 decimal places
      const element = screen.getByTitle("1234.567");
      expect(element).toBeInTheDocument();
      expect(element).toHaveClass("exo-cell-number");
    });

    it("renders negative number", () => {
      render(
        <NumberRenderer
          value={-100}
          column={createColumn()}
        />
      );

      const element = screen.getByTitle("-100");
      expect(element).toBeInTheDocument();
    });

    it("renders zero", () => {
      render(
        <NumberRenderer
          value={0}
          column={createColumn()}
        />
      );

      expect(screen.getByText("0")).toBeInTheDocument();
    });
  });

  describe("String Parsing", () => {
    it("parses integer string", () => {
      render(
        <NumberRenderer
          value="42"
          column={createColumn()}
        />
      );

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("parses decimal string", () => {
      render(
        <NumberRenderer
          value="3.14"
          column={createColumn()}
        />
      );

      expect(screen.getByTitle("3.14")).toBeInTheDocument();
    });

    it("parses string with thousand separator", () => {
      render(
        <NumberRenderer
          value="1,234,567"
          column={createColumn()}
        />
      );

      expect(screen.getByTitle("1234567")).toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("renders dash for null value", () => {
      render(
        <NumberRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-number-empty");
    });

    it("renders dash for undefined value", () => {
      render(
        <NumberRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for empty string", () => {
      render(
        <NumberRenderer
          value=""
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for unparseable string", () => {
      render(
        <NumberRenderer
          value="not a number"
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for NaN", () => {
      render(
        <NumberRenderer
          value={NaN}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("Editable Mode", () => {
    it("renders input when editing", () => {
      render(
        <NumberRenderer
          value={42}
          column={createColumn(true)}
          isEditing={true}
        />
      );

      expect(screen.getByRole("spinbutton")).toBeInTheDocument();
      expect(screen.getByRole("spinbutton")).toHaveValue(42);
    });

    it("calls onChange on blur with new value", () => {
      const onChange = jest.fn();
      const onBlur = jest.fn();
      render(
        <NumberRenderer
          value={42}
          column={createColumn(true)}
          isEditing={true}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "100" } });
      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledWith(100);
      expect(onBlur).toHaveBeenCalled();
    });

    it("calls onChange on Enter key", () => {
      const onChange = jest.fn();
      const onBlur = jest.fn();
      render(
        <NumberRenderer
          value={42}
          column={createColumn(true)}
          isEditing={true}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "50" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onChange).toHaveBeenCalledWith(50);
      expect(onBlur).toHaveBeenCalled();
    });

    it("cancels edit on Escape key", () => {
      const onChange = jest.fn();
      const onBlur = jest.fn();
      render(
        <NumberRenderer
          value={42}
          column={createColumn(true)}
          isEditing={true}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "100" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onChange).not.toHaveBeenCalled();
      expect(onBlur).toHaveBeenCalled();
    });

    it("does not call onChange if value unchanged", () => {
      const onChange = jest.fn();
      render(
        <NumberRenderer
          value={42}
          column={createColumn(true)}
          isEditing={true}
          onChange={onChange}
        />
      );

      const input = screen.getByRole("spinbutton");
      fireEvent.blur(input);

      expect(onChange).not.toHaveBeenCalled();
    });

    it("renders read-only when not editing", () => {
      render(
        <NumberRenderer
          value={42}
          column={createColumn(true)}
          isEditing={false}
        />
      );

      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });
});
