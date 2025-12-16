/**
 * BooleanRenderer Unit Tests
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";


import { BooleanRenderer } from "@plugin/presentation/renderers/cell-renderers/BooleanRenderer";
import type { LayoutColumn } from "@plugin/domain/layout";

describe("BooleanRenderer", () => {
  const createColumn = (editable = false): LayoutColumn => ({
    uid: "col-1",
    label: "Completed",
    property: "completed",
    editable,
  });

  describe("Boolean Values", () => {
    it("renders true as checkmark", () => {
      render(
        <BooleanRenderer
          value={true}
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toBeInTheDocument();
      expect(screen.getByTitle("Yes")).toBeInTheDocument();
    });

    it("renders false as X mark", () => {
      render(
        <BooleanRenderer
          value={false}
          column={createColumn()}
        />
      );

      expect(screen.getByText("✗")).toBeInTheDocument();
      expect(screen.getByTitle("No")).toBeInTheDocument();
    });

    it("applies correct CSS class for true", () => {
      render(
        <BooleanRenderer
          value={true}
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toHaveClass("exo-cell-boolean-true");
    });

    it("applies correct CSS class for false", () => {
      render(
        <BooleanRenderer
          value={false}
          column={createColumn()}
        />
      );

      expect(screen.getByText("✗")).toHaveClass("exo-cell-boolean-false");
    });
  });

  describe("String Parsing", () => {
    it("parses 'true' string", () => {
      render(
        <BooleanRenderer
          value="true"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toBeInTheDocument();
    });

    it("parses 'false' string", () => {
      render(
        <BooleanRenderer
          value="false"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✗")).toBeInTheDocument();
    });

    it("parses 'yes' string", () => {
      render(
        <BooleanRenderer
          value="yes"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toBeInTheDocument();
    });

    it("parses 'no' string", () => {
      render(
        <BooleanRenderer
          value="no"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✗")).toBeInTheDocument();
    });

    it("parses '1' string as true", () => {
      render(
        <BooleanRenderer
          value="1"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toBeInTheDocument();
    });

    it("parses '0' string as false", () => {
      render(
        <BooleanRenderer
          value="0"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✗")).toBeInTheDocument();
    });

    it("parses 'on' as true", () => {
      render(
        <BooleanRenderer
          value="on"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toBeInTheDocument();
    });

    it("parses 'off' as false", () => {
      render(
        <BooleanRenderer
          value="off"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✗")).toBeInTheDocument();
    });

    it("handles case insensitivity", () => {
      render(
        <BooleanRenderer
          value="TRUE"
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toBeInTheDocument();
    });
  });

  describe("Number Parsing", () => {
    it("parses non-zero number as true", () => {
      render(
        <BooleanRenderer
          value={42}
          column={createColumn()}
        />
      );

      expect(screen.getByText("✓")).toBeInTheDocument();
    });

    it("parses zero as false", () => {
      render(
        <BooleanRenderer
          value={0}
          column={createColumn()}
        />
      );

      expect(screen.getByText("✗")).toBeInTheDocument();
    });
  });

  describe("Empty/Unknown State", () => {
    it("renders dash for null value", () => {
      render(
        <BooleanRenderer
          value={null}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.getByText("-")).toHaveClass("exo-cell-boolean-unknown");
    });

    it("renders dash for undefined value", () => {
      render(
        <BooleanRenderer
          value={undefined}
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("renders dash for unparseable string", () => {
      render(
        <BooleanRenderer
          value="maybe"
          column={createColumn()}
        />
      );

      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  describe("Editable Mode", () => {
    it("renders checkbox when column is editable and onChange provided", () => {
      const onChange = jest.fn();
      render(
        <BooleanRenderer
          value={true}
          column={createColumn(true)}
          onChange={onChange}
        />
      );

      expect(screen.getByRole("checkbox")).toBeInTheDocument();
      expect(screen.getByRole("checkbox")).toBeChecked();
    });

    it("renders checkbox when column is editable and isEditing is true", () => {
      render(
        <BooleanRenderer
          value={false}
          column={createColumn(true)}
          isEditing={true}
        />
      );

      expect(screen.getByRole("checkbox")).toBeInTheDocument();
      expect(screen.getByRole("checkbox")).not.toBeChecked();
    });

    it("calls onChange when checkbox is clicked", () => {
      const onChange = jest.fn();
      render(
        <BooleanRenderer
          value={false}
          column={createColumn(true)}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole("checkbox"));
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it("shows Yes/No label in editable mode", () => {
      render(
        <BooleanRenderer
          value={true}
          column={createColumn(true)}
          isEditing={true}
        />
      );

      expect(screen.getByText("Yes")).toBeInTheDocument();
    });

    it("renders read-only when column is not editable", () => {
      render(
        <BooleanRenderer
          value={true}
          column={createColumn(false)}
          onChange={jest.fn()}
        />
      );

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.getByText("✓")).toBeInTheDocument();
    });
  });
});
