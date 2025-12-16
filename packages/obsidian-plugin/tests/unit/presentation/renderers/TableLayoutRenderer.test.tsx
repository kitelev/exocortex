/**
 * TableLayoutRenderer Unit Tests
 *
 * Tests for the TableLayoutRenderer component including:
 * - Basic rendering
 * - Column headers from layout
 * - Column width handling
 * - Sorting functionality
 * - Empty state
 * - Row rendering
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

import { TableLayoutRenderer } from "@plugin/presentation/renderers/TableLayoutRenderer";
import type { TableLayout, LayoutColumn } from "@plugin/domain/layout";
import { LayoutType } from "@plugin/domain/layout";
import type { TableRow } from "@plugin/presentation/renderers/cell-renderers";

// Mock @tanstack/react-virtual
jest.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: jest.fn(() => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
  })),
}));

describe("TableLayoutRenderer", () => {
  // Test fixtures
  const createColumn = (overrides: Partial<LayoutColumn> = {}): LayoutColumn => ({
    uid: "col-1",
    label: "Test Column",
    property: "[[exo__Asset_label]]",
    header: "Name",
    width: "auto",
    renderer: "text",
    editable: false,
    sortable: true,
    ...overrides,
  });

  const createLayout = (columns: LayoutColumn[]): TableLayout => ({
    uid: "layout-1",
    label: "Test Layout",
    type: LayoutType.Table,
    targetClass: "[[ems__Task]]",
    columns,
  });

  const createRow = (overrides: Partial<TableRow> = {}): TableRow => ({
    id: "row-1",
    path: "/path/to/asset.md",
    metadata: {},
    values: { "col-1": "Test Value" },
    ...overrides,
  });

  describe("Basic Rendering", () => {
    it("renders a table with columns and rows", () => {
      const columns = [createColumn()];
      const layout = createLayout(columns);
      const rows = [createRow()];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
        />
      );

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Test Value")).toBeInTheDocument();
    });

    it("renders multiple columns", () => {
      const columns = [
        createColumn({ uid: "col-1", header: "Column 1" }),
        createColumn({ uid: "col-2", header: "Column 2" }),
        createColumn({ uid: "col-3", header: "Column 3" }),
      ];
      const layout = createLayout(columns);
      const rows = [
        createRow({
          values: {
            "col-1": "Value 1",
            "col-2": "Value 2",
            "col-3": "Value 3",
          },
        }),
      ];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
        />
      );

      expect(screen.getByText("Column 1")).toBeInTheDocument();
      expect(screen.getByText("Column 2")).toBeInTheDocument();
      expect(screen.getByText("Column 3")).toBeInTheDocument();
      expect(screen.getByText("Value 1")).toBeInTheDocument();
      expect(screen.getByText("Value 2")).toBeInTheDocument();
      expect(screen.getByText("Value 3")).toBeInTheDocument();
    });

    it("renders multiple rows", () => {
      const columns = [createColumn()];
      const layout = createLayout(columns);
      const rows = [
        createRow({ id: "row-1", values: { "col-1": "Row 1" } }),
        createRow({ id: "row-2", values: { "col-1": "Row 2" } }),
        createRow({ id: "row-3", values: { "col-1": "Row 3" } }),
      ];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
        />
      );

      expect(screen.getByText("Row 1")).toBeInTheDocument();
      expect(screen.getByText("Row 2")).toBeInTheDocument();
      expect(screen.getByText("Row 3")).toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("renders empty message when no rows provided", () => {
      const columns = [createColumn()];
      const layout = createLayout(columns);

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={[]}
        />
      );

      expect(screen.getByText("No data available")).toBeInTheDocument();
    });

    it("still renders column headers in empty state", () => {
      const columns = [
        createColumn({ header: "Empty Column" }),
      ];
      const layout = createLayout(columns);

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={[]}
        />
      );

      expect(screen.getByText("Empty Column")).toBeInTheDocument();
    });
  });

  describe("Column Headers", () => {
    it("uses header from column definition", () => {
      const columns = [createColumn({ header: "Custom Header" })];
      const layout = createLayout(columns);

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={[createRow()]}
        />
      );

      expect(screen.getByText("Custom Header")).toBeInTheDocument();
    });

    it("derives header from property when header not specified", () => {
      const columns = [
        createColumn({
          header: undefined,
          property: "[[exo__Asset_label]]",
        }),
      ];
      const layout = createLayout(columns);

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={[createRow()]}
        />
      );

      // getDefaultColumnHeader("[[exo__Asset_label]]") => "Label"
      expect(screen.getByText("Label")).toBeInTheDocument();
    });
  });

  describe("Sorting", () => {
    it("shows sort indicator when column is sorted", () => {
      const columns = [createColumn({ uid: "col-1", header: "Name", sortable: true })];
      const layout = createLayout(columns);
      const rows = [createRow()];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          initialSort={{ columnUid: "col-1", direction: "asc" }}
        />
      );

      expect(screen.getByText(/Name.*↑/)).toBeInTheDocument();
    });

    it("toggles sort direction on click", () => {
      const columns = [createColumn({ uid: "col-1", header: "Name", sortable: true })];
      const layout = createLayout(columns);
      const rows = [createRow()];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
        />
      );

      // Click to sort ascending
      fireEvent.click(screen.getByText("Name"));
      expect(screen.getByText(/Name.*↑/)).toBeInTheDocument();

      // Click again to sort descending
      fireEvent.click(screen.getByText(/Name/));
      expect(screen.getByText(/Name.*↓/)).toBeInTheDocument();
    });

    it("does not sort non-sortable columns", () => {
      const columns = [
        createColumn({ uid: "col-1", header: "Name", sortable: false }),
      ];
      const layout = createLayout(columns);
      const rows = [createRow()];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
        />
      );

      // Click should not add sort indicator
      fireEvent.click(screen.getByText("Name"));
      expect(screen.queryByText(/Name.*↑/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Name.*↓/)).not.toBeInTheDocument();
    });

    it("sorts rows by column value", () => {
      const columns = [createColumn({ uid: "col-1", header: "Name", sortable: true })];
      const layout = createLayout(columns);
      const rows = [
        createRow({ id: "row-1", values: { "col-1": "Charlie" } }),
        createRow({ id: "row-2", values: { "col-1": "Alpha" } }),
        createRow({ id: "row-3", values: { "col-1": "Bravo" } }),
      ];

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
        />
      );

      // Click to sort ascending
      fireEvent.click(screen.getByText("Name"));

      // Get all cells
      const cells = container.querySelectorAll("tbody td");
      const values = Array.from(cells).map((cell) => cell.textContent);

      expect(values).toEqual(["Alpha", "Bravo", "Charlie"]);
    });
  });

  describe("Column Widths", () => {
    it("applies px width", () => {
      const columns = [createColumn({ width: "100px" })];
      const layout = createLayout(columns);

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={[createRow()]}
        />
      );

      const col = container.querySelector("colgroup col");
      expect(col).toHaveStyle({ width: "100px" });
    });

    it("applies percentage width", () => {
      const columns = [createColumn({ width: "50%" })];
      const layout = createLayout(columns);

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={[createRow()]}
        />
      );

      const col = container.querySelector("colgroup col");
      expect(col).toHaveStyle({ width: "50%" });
    });

    it("applies auto width", () => {
      const columns = [createColumn({ width: "auto" })];
      const layout = createLayout(columns);

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={[createRow()]}
        />
      );

      const col = container.querySelector("colgroup col");
      expect(col).toHaveStyle({ width: "auto" });
    });

    it("defaults to auto when width not specified", () => {
      const columns = [createColumn({ width: undefined })];
      const layout = createLayout(columns);

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={[createRow()]}
        />
      );

      const col = container.querySelector("colgroup col");
      expect(col).toHaveStyle({ width: "auto" });
    });
  });

  describe("Options", () => {
    it("respects maxRows option", () => {
      const columns = [createColumn()];
      const layout = createLayout(columns);
      const rows = Array.from({ length: 10 }, (_, i) =>
        createRow({ id: `row-${i}`, values: { "col-1": `Row ${i}` } })
      );

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          options={{ maxRows: 5 }}
        />
      );

      // Should only show first 5 rows
      expect(screen.getByText("Row 0")).toBeInTheDocument();
      expect(screen.getByText("Row 4")).toBeInTheDocument();
      expect(screen.queryByText("Row 5")).not.toBeInTheDocument();
    });

    it("disables sorting when sortable option is false", () => {
      const columns = [createColumn({ sortable: true })];
      const layout = createLayout(columns);
      const rows = [createRow()];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          options={{ sortable: false }}
        />
      );

      // Click should not add sort indicator
      fireEvent.click(screen.getByText("Name"));
      expect(screen.queryByText(/Name.*↑/)).not.toBeInTheDocument();
    });
  });

  describe("Custom className", () => {
    it("applies custom className to container", () => {
      const columns = [createColumn()];
      const layout = createLayout(columns);

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={[createRow()]}
          className="custom-class"
        />
      );

      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("Link Click Handler", () => {
    it("calls onLinkClick when link is clicked", () => {
      const onLinkClick = jest.fn();
      const columns = [createColumn({ renderer: "link" })];
      const layout = createLayout(columns);
      const rows = [createRow({ values: { "col-1": "[[target|Display]]" } })];

      render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          onLinkClick={onLinkClick}
        />
      );

      const link = screen.getByText("Display");
      fireEvent.click(link);

      expect(onLinkClick).toHaveBeenCalledWith("target", expect.any(Object));
    });
  });
});
