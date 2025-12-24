/**
 * FilterPanel Component Tests
 *
 * Tests for the graph filter panel UI component.
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FilterPanel,
  createTypeFilter,
  createPredicateFilter,
  generateFilterId,
  type TypeCounts,
  type GraphFilter,
} from "../../../../../../src/presentation/renderers/graph/filter";

describe("FilterPanel", () => {
  const defaultNodeTypes = ["ems__Task", "ems__Project", "ems__Area"];
  const defaultEdgeTypes = ["hierarchy", "reference"];
  const defaultTypeCounts: TypeCounts = {
    nodeTypes: new Map([
      ["ems__Task", 10],
      ["ems__Project", 5],
      ["ems__Area", 2],
    ]),
    edgeTypes: new Map([
      ["hierarchy", 15],
      ["reference", 3],
    ]),
  };

  const defaultProps = {
    nodeTypes: defaultNodeTypes,
    edgeTypes: defaultEdgeTypes,
    typeCounts: defaultTypeCounts,
    activeFilters: [] as GraphFilter[],
    visibleNodeTypes: new Set<string>(),
    visibleEdgeTypes: new Set<string>(),
  };

  describe("Basic Rendering", () => {
    it("should render without crashing", () => {
      render(<FilterPanel {...defaultProps} />);
      expect(screen.getByText("Filters")).toBeInTheDocument();
    });

    it("should display stats bar with total counts", () => {
      render(<FilterPanel {...defaultProps} />);
      expect(screen.getByText("17 nodes")).toBeInTheDocument();
      expect(screen.getByText("18 edges")).toBeInTheDocument();
    });

    it("should render node types section", () => {
      render(<FilterPanel {...defaultProps} />);
      expect(screen.getByText("Node Types")).toBeInTheDocument();
    });

    it("should render edge types section", () => {
      render(<FilterPanel {...defaultProps} />);
      expect(screen.getByText("Edge Types")).toBeInTheDocument();
    });
  });

  describe("Collapsed State", () => {
    it("should render collapsed view when isCollapsed is true", () => {
      render(<FilterPanel {...defaultProps} isCollapsed={true} />);

      // Should not show full content
      expect(screen.queryByText("Filters")).not.toBeInTheDocument();
    });

    it("should show badge in collapsed state when filters active", () => {
      render(
        <FilterPanel
          {...defaultProps}
          isCollapsed={true}
          visibleNodeTypes={new Set(["ems__Task"])}
        />
      );

      // Badge should be visible
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("should call onToggleCollapse when clicking collapsed panel", () => {
      const onToggleCollapse = jest.fn();
      render(
        <FilterPanel
          {...defaultProps}
          isCollapsed={true}
          onToggleCollapse={onToggleCollapse}
        />
      );

      const collapsedPanel = document.querySelector(".exo-filter-panel--collapsed");
      fireEvent.click(collapsedPanel!);

      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    });
  });

  describe("Node Type Filters", () => {
    it("should display all node types with counts", () => {
      render(<FilterPanel {...defaultProps} />);

      // Check formatted type names and counts
      expect(screen.getByText("Task")).toBeInTheDocument();
      expect(screen.getByText("10")).toBeInTheDocument();
      expect(screen.getByText("Project")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("should call onToggleNodeType when checkbox is clicked", () => {
      const onToggleNodeType = jest.fn();
      render(
        <FilterPanel {...defaultProps} onToggleNodeType={onToggleNodeType} />
      );

      // Find the Task checkbox
      const taskCheckbox = screen.getAllByRole("checkbox")[0];
      fireEvent.click(taskCheckbox);

      expect(onToggleNodeType).toHaveBeenCalledWith("ems__Task");
    });

    it("should show checkboxes as checked when type is visible", () => {
      render(
        <FilterPanel
          {...defaultProps}
          visibleNodeTypes={new Set(["ems__Task"])}
        />
      );

      const checkboxes = screen.getAllByRole("checkbox");
      // First checkbox (Task) should be checked
      expect(checkboxes[0]).toBeChecked();
    });
  });

  describe("Edge Type Filters", () => {
    it("should display all edge types with counts", () => {
      render(<FilterPanel {...defaultProps} />);

      expect(screen.getByText("hierarchy")).toBeInTheDocument();
      expect(screen.getByText("15")).toBeInTheDocument();
    });

    it("should call onToggleEdgeType when checkbox is clicked", () => {
      const onToggleEdgeType = jest.fn();
      render(
        <FilterPanel {...defaultProps} onToggleEdgeType={onToggleEdgeType} />
      );

      // Expand edge types section and click
      const edgeCheckboxes = screen.getAllByRole("checkbox");
      // First 3 are node types, then edge types
      fireEvent.click(edgeCheckboxes[3]);

      expect(onToggleEdgeType).toHaveBeenCalledWith("hierarchy");
    });
  });

  describe("Active Filters Section", () => {
    it("should display active filters when present", () => {
      const filters: GraphFilter[] = [
        createTypeFilter("test1", ["ems__Task"], true, false),
      ];

      render(<FilterPanel {...defaultProps} activeFilters={filters} />);

      expect(screen.getByText("Active Filters")).toBeInTheDocument();
    });

    it("should call onRemoveFilter when remove button is clicked", () => {
      const onRemoveFilter = jest.fn();
      const filters: GraphFilter[] = [
        createTypeFilter("test1", ["ems__Task"], true, false),
      ];

      render(
        <FilterPanel
          {...defaultProps}
          activeFilters={filters}
          onRemoveFilter={onRemoveFilter}
        />
      );

      // Click the Active Filters section to expand it
      const activeFiltersHeader = screen.getByText("Active Filters");
      fireEvent.click(activeFiltersHeader);

      // Find and click remove button
      const removeButtons = document.querySelectorAll(
        ".exo-filter-panel__filter-remove"
      );
      fireEvent.click(removeButtons[0]);

      expect(onRemoveFilter).toHaveBeenCalledWith("test1");
    });

    it("should call onToggleFilter when toggle button is clicked", () => {
      const onToggleFilter = jest.fn();
      const filters: GraphFilter[] = [
        createTypeFilter("test1", ["ems__Task"], true, false),
      ];

      render(
        <FilterPanel
          {...defaultProps}
          activeFilters={filters}
          onToggleFilter={onToggleFilter}
        />
      );

      // Click the Active Filters section to expand it
      const activeFiltersHeader = screen.getByText("Active Filters");
      fireEvent.click(activeFiltersHeader);

      // Find and click toggle button
      const toggleButtons = document.querySelectorAll(
        ".exo-filter-panel__filter-toggle"
      );
      fireEvent.click(toggleButtons[0]);

      expect(onToggleFilter).toHaveBeenCalledWith("test1");
    });

    it("should call onClearFilters when clear button is clicked", () => {
      const onClearFilters = jest.fn();
      const filters: GraphFilter[] = [
        createTypeFilter("test1", ["ems__Task"], true, false),
      ];

      render(
        <FilterPanel
          {...defaultProps}
          activeFilters={filters}
          onClearFilters={onClearFilters}
        />
      );

      // Click the Active Filters section to expand it
      const activeFiltersHeader = screen.getByText("Active Filters");
      fireEvent.click(activeFiltersHeader);

      // Find and click clear all button
      const clearButton = screen.getByText("Clear All Filters");
      fireEvent.click(clearButton);

      expect(onClearFilters).toHaveBeenCalledTimes(1);
    });
  });

  describe("Quick Filters / Presets Section", () => {
    it("should show preset buttons when enabled", () => {
      render(<FilterPanel {...defaultProps} />);

      // Click Quick Filters to expand
      const presetsHeader = screen.getByText("Quick Filters");
      fireEvent.click(presetsHeader);

      expect(screen.getByText("Show Tasks Only")).toBeInTheDocument();
      expect(screen.getByText("Show Projects Only")).toBeInTheDocument();
    });

    it("should call onAddFilter when preset button is clicked", () => {
      const onAddFilter = jest.fn();
      render(
        <FilterPanel {...defaultProps} onAddFilter={onAddFilter} />
      );

      // Click Quick Filters to expand
      const presetsHeader = screen.getByText("Quick Filters");
      fireEvent.click(presetsHeader);

      // Click preset button
      const tasksOnlyButton = screen.getByText("Show Tasks Only");
      fireEvent.click(tasksOnlyButton);

      expect(onAddFilter).toHaveBeenCalledTimes(1);
      expect(onAddFilter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "type",
          typeUris: ["ems__Task"],
        })
      );
    });
  });

  describe("Reset Functionality", () => {
    it("should show reset button when filters are active", () => {
      render(
        <FilterPanel
          {...defaultProps}
          visibleNodeTypes={new Set(["ems__Task"])}
        />
      );

      expect(screen.getByText("Reset")).toBeInTheDocument();
    });

    it("should not show reset button when no filters are active", () => {
      render(<FilterPanel {...defaultProps} />);

      expect(screen.queryByText("Reset")).not.toBeInTheDocument();
    });

    it("should call onResetFilters when reset button is clicked", () => {
      const onResetFilters = jest.fn();
      render(
        <FilterPanel
          {...defaultProps}
          visibleNodeTypes={new Set(["ems__Task"])}
          onResetFilters={onResetFilters}
        />
      );

      const resetButton = screen.getByText("Reset");
      fireEvent.click(resetButton);

      expect(onResetFilters).toHaveBeenCalledTimes(1);
    });
  });

  describe("Section Collapse", () => {
    it("should toggle node types section when header is clicked", () => {
      render(<FilterPanel {...defaultProps} />);

      const nodeTypesHeader = screen.getByText("Node Types");
      const initialCheckboxCount = screen.getAllByRole("checkbox").length;

      // Click to collapse
      fireEvent.click(nodeTypesHeader);

      // Checkboxes should be hidden now
      const afterCollapseCount = screen.queryAllByRole("checkbox").length;
      expect(afterCollapseCount).toBeLessThan(initialCheckboxCount);
    });
  });

  describe("Configuration Options", () => {
    it("should hide sections based on config", () => {
      render(
        <FilterPanel
          {...defaultProps}
          config={{
            showTypeFilters: false,
            showPredicateFilters: true,
            showLiteralFilters: true,
            showPathFilters: true,
            showCustomSPARQL: false,
            showPresets: false,
          }}
        />
      );

      // Node Types section should be hidden
      expect(screen.queryByText("Node Types")).not.toBeInTheDocument();
      // Edge Types should still be visible
      expect(screen.getByText("Edge Types")).toBeInTheDocument();
    });
  });

  describe("Empty States", () => {
    it("should not show node types section when no types available", () => {
      render(
        <FilterPanel
          {...defaultProps}
          nodeTypes={[]}
        />
      );

      expect(screen.queryByText("Node Types")).not.toBeInTheDocument();
    });

    it("should not show edge types section when no types available", () => {
      render(
        <FilterPanel
          {...defaultProps}
          edgeTypes={[]}
        />
      );

      expect(screen.queryByText("Edge Types")).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should have proper aria attributes on section headers", () => {
      render(<FilterPanel {...defaultProps} />);

      const nodeTypesButton = screen
        .getByText("Node Types")
        .closest("button");
      expect(nodeTypesButton).toHaveAttribute("aria-expanded", "true");
    });

    it("should handle keyboard navigation for collapsed panel", () => {
      const onToggleCollapse = jest.fn();
      render(
        <FilterPanel
          {...defaultProps}
          isCollapsed={true}
          onToggleCollapse={onToggleCollapse}
        />
      );

      const collapsedPanel = document.querySelector(".exo-filter-panel--collapsed");
      fireEvent.keyDown(collapsedPanel!, { key: "Enter" });

      expect(onToggleCollapse).toHaveBeenCalled();
    });
  });
});
