/**
 * ColorLegend Component Unit Tests
 *
 * Tests for the visual legend of node type colors.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import {
  ColorLegend,
  BUILT_IN_PALETTES,
} from "../../../../../../src/presentation/renderers/graph/search";
import type { LegendState } from "../../../../../../src/presentation/renderers/graph/search";

describe("ColorLegend", () => {
  const defaultLegendState: LegendState = {
    items: [
      {
        typeUri: "ems__Task",
        displayName: "Task",
        color: "#22c55e",
        icon: "✓",
        shape: "roundedRect",
        count: 10,
        visible: true,
      },
      {
        typeUri: "ems__Project",
        displayName: "Project",
        color: "#3b82f6",
        icon: "📁",
        shape: "hexagon",
        count: 5,
        visible: true,
      },
    ],
    isExpanded: true,
    paletteId: "default",
    customColors: new Map(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render legend title", () => {
      render(<ColorLegend legendState={defaultLegendState} />);
      expect(screen.getByText("Node Types")).toBeInTheDocument();
    });

    it("should render all legend items", () => {
      render(<ColorLegend legendState={defaultLegendState} />);
      expect(screen.getByText("Task")).toBeInTheDocument();
      expect(screen.getByText("Project")).toBeInTheDocument();
    });

    it("should show node counts", () => {
      render(<ColorLegend legendState={defaultLegendState} />);
      expect(screen.getByText("10")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("should show total stats", () => {
      render(<ColorLegend legendState={defaultLegendState} />);
      expect(screen.getByText("15 nodes")).toBeInTheDocument();
      expect(screen.getByText("2 types")).toBeInTheDocument();
    });

    it("should show icons when present", () => {
      render(<ColorLegend legendState={defaultLegendState} />);
      expect(screen.getByText("✓")).toBeInTheDocument();
      expect(screen.getByText("📁")).toBeInTheDocument();
    });

    it("should render with custom class", () => {
      const { container } = render(
        <ColorLegend
          legendState={defaultLegendState}
          className="custom-class"
        />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("collapsed state", () => {
    it("should render collapsed view", () => {
      render(
        <ColorLegend
          legendState={defaultLegendState}
          isCollapsed={true}
          onToggleCollapse={jest.fn()}
        />
      );
      expect(screen.getByText("2 types")).toBeInTheDocument();
      expect(screen.queryByText("Task")).not.toBeInTheDocument();
    });

    it("should call onToggleCollapse when collapsed view clicked", async () => {
      const user = userEvent.setup();
      const mockToggle = jest.fn();

      render(
        <ColorLegend
          legendState={defaultLegendState}
          isCollapsed={true}
          onToggleCollapse={mockToggle}
        />
      );

      await user.click(screen.getByText("2 types"));
      expect(mockToggle).toHaveBeenCalled();
    });
  });

  describe("visibility toggle", () => {
    it("should render visibility buttons", () => {
      render(
        <ColorLegend
          legendState={defaultLegendState}
          onVisibilityToggle={jest.fn()}
        />
      );

      const buttons = screen.getAllByTitle(/Hide this type|Show this type/);
      expect(buttons.length).toBe(2);
    });

    it("should call onVisibilityToggle when clicked", async () => {
      const user = userEvent.setup();
      const mockToggle = jest.fn();

      render(
        <ColorLegend
          legendState={defaultLegendState}
          onVisibilityToggle={mockToggle}
        />
      );

      const hideButton = screen.getByLabelText("Hide Task");
      await user.click(hideButton);
      expect(mockToggle).toHaveBeenCalledWith("ems__Task");
    });

    it("should show hidden state for invisible items", () => {
      const stateWithHidden: LegendState = {
        ...defaultLegendState,
        items: [
          { ...defaultLegendState.items[0], visible: false },
          defaultLegendState.items[1],
        ],
      };

      render(
        <ColorLegend
          legendState={stateWithHidden}
          onVisibilityToggle={jest.fn()}
        />
      );

      expect(screen.getByLabelText("Show Task")).toBeInTheDocument();
    });
  });

  describe("color click", () => {
    it("should call onColorClick when color indicator clicked", async () => {
      const user = userEvent.setup();
      const mockColorClick = jest.fn();

      render(
        <ColorLegend
          legendState={defaultLegendState}
          onColorClick={mockColorClick}
        />
      );

      const colorButton = screen.getByLabelText("Change color for Task");
      await user.click(colorButton);

      expect(mockColorClick).toHaveBeenCalledWith(
        "ems__Task",
        "#22c55e",
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
      );
    });
  });

  describe("palette selector", () => {
    it("should show palette selector button", () => {
      render(
        <ColorLegend
          legendState={defaultLegendState}
          onPaletteChange={jest.fn()}
        />
      );

      expect(screen.getByTitle("Change color palette")).toBeInTheDocument();
    });

    it("should open palette selector on click", async () => {
      const user = userEvent.setup();

      render(
        <ColorLegend
          legendState={defaultLegendState}
          onPaletteChange={jest.fn()}
          palettes={BUILT_IN_PALETTES}
        />
      );

      await user.click(screen.getByTitle("Change color palette"));
      expect(screen.getByText("Default")).toBeInTheDocument();
      expect(screen.getByText("Pastel")).toBeInTheDocument();
    });

    it("should call onPaletteChange when palette selected", async () => {
      const user = userEvent.setup();
      const mockPaletteChange = jest.fn();

      render(
        <ColorLegend
          legendState={defaultLegendState}
          onPaletteChange={mockPaletteChange}
          palettes={BUILT_IN_PALETTES}
        />
      );

      await user.click(screen.getByTitle("Change color palette"));
      await user.click(screen.getByText("Pastel"));

      expect(mockPaletteChange).toHaveBeenCalledWith("pastel");
    });
  });

  describe("color reset", () => {
    it("should show reset button for custom colors", async () => {
      const stateWithCustom: LegendState = {
        ...defaultLegendState,
        customColors: new Map([["ems__Task", "#ff0000"]]),
      };

      render(
        <ColorLegend
          legendState={stateWithCustom}
          onColorReset={jest.fn()}
        />
      );

      expect(screen.getByLabelText("Reset color for Task")).toBeInTheDocument();
    });

    it("should call onColorReset when clicked", async () => {
      const user = userEvent.setup();
      const mockReset = jest.fn();
      const stateWithCustom: LegendState = {
        ...defaultLegendState,
        customColors: new Map([["ems__Task", "#ff0000"]]),
      };

      render(
        <ColorLegend
          legendState={stateWithCustom}
          onColorReset={mockReset}
        />
      );

      await user.click(screen.getByLabelText("Reset color for Task"));
      expect(mockReset).toHaveBeenCalledWith("ems__Task");
    });
  });

  describe("export/import", () => {
    it("should show export button when onExport provided", () => {
      render(
        <ColorLegend
          legendState={defaultLegendState}
          onExport={jest.fn()}
        />
      );

      expect(screen.getByTitle("Export colors")).toBeInTheDocument();
    });

    it("should call onExport when clicked", async () => {
      const user = userEvent.setup();
      const mockExport = jest.fn();

      render(
        <ColorLegend
          legendState={defaultLegendState}
          onExport={mockExport}
        />
      );

      await user.click(screen.getByTitle("Export colors"));
      expect(mockExport).toHaveBeenCalled();
    });

    it("should show import button when onImport provided", () => {
      render(
        <ColorLegend
          legendState={defaultLegendState}
          onImport={jest.fn()}
        />
      );

      expect(screen.getByTitle("Import colors")).toBeInTheDocument();
    });

    it("should show import dialog when import clicked", async () => {
      const user = userEvent.setup();

      render(
        <ColorLegend
          legendState={defaultLegendState}
          onImport={jest.fn()}
        />
      );

      await user.click(screen.getByTitle("Import colors"));
      expect(screen.getByPlaceholderText(/Paste color configuration/)).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show message when no items", () => {
      const emptyState: LegendState = {
        items: [],
        isExpanded: true,
        paletteId: "default",
        customColors: new Map(),
      };

      render(<ColorLegend legendState={emptyState} />);
      expect(screen.getByText("No node types found")).toBeInTheDocument();
    });
  });

  describe("max height", () => {
    it("should apply max height style", () => {
      const { container } = render(
        <ColorLegend
          legendState={defaultLegendState}
          maxHeight={200}
        />
      );

      const itemsContainer = container.querySelector(".exo-color-legend__items");
      expect(itemsContainer).toHaveStyle({ maxHeight: "200px" });
    });
  });
});
