/**
 * ViewModeSelector Unit Tests
 *
 * Tests for the ViewModeSelector component including the new graph3d view mode.
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
    availableModes: ["table", "list", "graph", "graph3d"] as ViewMode[],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render all available mode buttons", () => {
      render(<ViewModeSelector {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(4);
    });

    it("should render only specified available modes", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["list", "graph"]}
        />
      );

      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2);
      expect(screen.getByText("list")).toBeInTheDocument();
      expect(screen.getByText("graph")).toBeInTheDocument();
      expect(screen.queryByText("table")).not.toBeInTheDocument();
      expect(screen.queryByText("3D graph")).not.toBeInTheDocument();
    });

    it("should render graph3d mode when available", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["list", "graph", "graph3d"]}
        />
      );

      expect(screen.getByText("3D graph")).toBeInTheDocument();
    });

    it("should highlight active mode button", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          currentMode="graph3d"
          availableModes={["list", "graph", "graph3d"]}
        />
      );

      const activeButton = screen.getByRole("button", { pressed: true });
      expect(activeButton).toHaveTextContent("3D graph");
    });
  });

  describe("mode labels and icons", () => {
    it("should display correct label for graph3d", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["graph3d"]}
          currentMode="graph3d"
        />
      );

      expect(screen.getByText("3D graph")).toBeInTheDocument();
    });

    it("should display correct icon for graph3d", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["graph3d"]}
          currentMode="graph3d"
        />
      );

      // The cube icon for 3D graph
      expect(screen.getByText("◇")).toBeInTheDocument();
    });

    it("should display all mode icons correctly", () => {
      render(<ViewModeSelector {...defaultProps} />);

      expect(screen.getByText("▤")).toBeInTheDocument(); // table
      expect(screen.getByText("☰")).toBeInTheDocument(); // list
      expect(screen.getByText("●—●")).toBeInTheDocument(); // graph
      expect(screen.getByText("◇")).toBeInTheDocument(); // graph3d
    });

    it("should display all mode labels correctly", () => {
      render(<ViewModeSelector {...defaultProps} />);

      expect(screen.getByText("table")).toBeInTheDocument();
      expect(screen.getByText("list")).toBeInTheDocument();
      expect(screen.getByText("graph")).toBeInTheDocument();
      expect(screen.getByText("3D graph")).toBeInTheDocument();
    });
  });

  describe("interaction", () => {
    it("should call onModeChange when mode button clicked", () => {
      const onModeChange = jest.fn();
      render(
        <ViewModeSelector
          {...defaultProps}
          onModeChange={onModeChange}
          availableModes={["list", "graph", "graph3d"]}
        />
      );

      const graph3dButton = screen.getByRole("button", {
        name: /switch to graph3d view/i,
      });
      fireEvent.click(graph3dButton);

      expect(onModeChange).toHaveBeenCalledWith("graph3d");
    });

    it("should call onModeChange with correct mode for each button", () => {
      const onModeChange = jest.fn();
      render(
        <ViewModeSelector {...defaultProps} onModeChange={onModeChange} />
      );

      const listButton = screen.getByRole("button", {
        name: /switch to list view/i,
      });
      fireEvent.click(listButton);
      expect(onModeChange).toHaveBeenCalledWith("list");

      const graphButton = screen.getByRole("button", {
        name: /switch to graph view/i,
      });
      fireEvent.click(graphButton);
      expect(onModeChange).toHaveBeenCalledWith("graph");

      const graph3dButton = screen.getByRole("button", {
        name: /switch to graph3d view/i,
      });
      fireEvent.click(graph3dButton);
      expect(onModeChange).toHaveBeenCalledWith("graph3d");
    });
  });

  describe("accessibility", () => {
    it("should have accessible aria-label for graph3d button", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          availableModes={["graph3d"]}
          currentMode="graph3d"
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label", "switch to graph3d view");
    });

    it("should set aria-pressed based on active state for graph3d", () => {
      render(
        <ViewModeSelector
          {...defaultProps}
          currentMode="graph3d"
          availableModes={["list", "graph", "graph3d"]}
        />
      );

      const listButton = screen.getByRole("button", {
        name: /switch to list view/i,
      });
      expect(listButton).toHaveAttribute("aria-pressed", "false");

      const graph3dButton = screen.getByRole("button", {
        name: /switch to graph3d view/i,
      });
      expect(graph3dButton).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("ViewMode type", () => {
    it("should support all four view modes in the type", () => {
      // Type test - if this compiles, the type is correct
      const modes: ViewMode[] = ["table", "list", "graph", "graph3d"];
      expect(modes).toHaveLength(4);
    });
  });
});
