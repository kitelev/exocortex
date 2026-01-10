/**
 * ViewModeSelector Unit Tests
 *
 * Tests for the ViewModeSelector component for table and list view modes.
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ViewModeSelector,
  type ViewMode,
} from "../../../../../src/presentation/components/sparql/ViewModeSelector";

describe("ViewModeSelector", () => {
  const defaultProps = {
    currentMode: "table" as ViewMode,
    onModeChange: jest.fn(),
    availableModes: ["table", "list"] as ViewMode[],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render all available mode buttons", () => {
      render(<ViewModeSelector {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2);
    });

    it("should render only specified available modes", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["list"]}
        />
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);
      expect(screen.getByText("list")).toBeInTheDocument();
      expect(screen.queryByText("table")).not.toBeInTheDocument();
    });

    it("should highlight active mode button", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          currentMode="list"
          availableModes={["table", "list"]}
        />
      );

      const activeButton = screen.getByRole("button", { pressed: true });
      expect(activeButton).toHaveTextContent("list");
    });
  });

  describe("mode labels and icons", () => {
    it("should display correct label for table", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["table"]}
          currentMode="table"
        />
      );

      expect(screen.getByText("table")).toBeInTheDocument();
    });

    it("should display correct label for list", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["list"]}
          currentMode="list"
        />
      );

      expect(screen.getByText("list")).toBeInTheDocument();
    });

    it("should display all mode icons correctly", () => {
      render(<ViewModeSelector {...defaultProps} />);

      expect(screen.getByText("▤")).toBeInTheDocument(); // table
      expect(screen.getByText("☰")).toBeInTheDocument(); // list
    });

    it("should display all mode labels correctly", () => {
      render(<ViewModeSelector {...defaultProps} />);

      expect(screen.getByText("table")).toBeInTheDocument();
      expect(screen.getByText("list")).toBeInTheDocument();
    });
  });

  describe("interaction", () => {
    it("should call onModeChange when mode button clicked", () => {
      const onModeChange = jest.fn();
      render(
        <ViewModeSelector
          {...defaultProps}
          onModeChange={onModeChange}
          availableModes={["table", "list"]}
        />
      );

      const listButton = screen.getByRole("button", {
        name: /switch to list view/i,
      });
      fireEvent.click(listButton);

      expect(onModeChange).toHaveBeenCalledWith("list");
    });

    it("should call onModeChange with correct mode for each button", () => {
      const onModeChange = jest.fn();
      render(
        <ViewModeSelector {...defaultProps} onModeChange={onModeChange} />
      );

      const tableButton = screen.getByRole("button", {
        name: /switch to table view/i,
      });
      fireEvent.click(tableButton);
      expect(onModeChange).toHaveBeenCalledWith("table");

      const listButton = screen.getByRole("button", {
        name: /switch to list view/i,
      });
      fireEvent.click(listButton);
      expect(onModeChange).toHaveBeenCalledWith("list");
    });
  });

  describe("accessibility", () => {
    it("should have accessible aria-label for table button", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["table"]}
          currentMode="table"
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label", "switch to table view");
    });

    it("should have accessible aria-label for list button", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["list"]}
          currentMode="list"
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label", "switch to list view");
    });

    it("should set aria-pressed based on active state", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          currentMode="list"
          availableModes={["table", "list"]}
        />
      );

      const tableButton = screen.getByRole("button", {
        name: /switch to table view/i,
      });
      expect(tableButton).toHaveAttribute("aria-pressed", "false");

      const listButton = screen.getByRole("button", {
        name: /switch to list view/i,
      });
      expect(listButton).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("ViewMode type", () => {
    it("should support table and list view modes in the type", () => {
      // Type test - if this compiles, the type is correct
      const modes: ViewMode[] = ["table", "list"];
      expect(modes).toHaveLength(2);
    });
  });
});
