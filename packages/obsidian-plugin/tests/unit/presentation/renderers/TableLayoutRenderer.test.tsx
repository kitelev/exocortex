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
const mockUseVirtualizer = jest.fn(() => ({
  getVirtualItems: () => [],
  getTotalSize: () => 0,
}));

jest.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (...args: unknown[]) => mockUseVirtualizer(...args),
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

      expect(screen.getByText("No items to display yet")).toBeInTheDocument();
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

  describe("Issue #2152: Virtualized Table Column Alignment", () => {
    // These tests verify that virtualized rows maintain proper column widths
    // even when position: absolute is applied.
    //
    // The fix measures header cell widths and applies them as explicit pixel
    // widths to virtualized body cells. This ensures cells stay aligned even
    // when rows have position: absolute (which breaks table-layout: fixed).
    //
    // Note: In jsdom, offsetWidth returns 0, so we test the rendering structure
    // rather than actual computed widths. The important behavior is that:
    // 1. Virtualized mode renders the header table with a ref for measurement
    // 2. Virtualized rows get useComputedWidth=true passed to renderRow
    // 3. The fallback to column.width works when computed widths aren't available

    afterEach(() => {
      // Reset the mock after each test
      mockUseVirtualizer.mockReset();
      mockUseVirtualizer.mockImplementation(() => ({
        getVirtualItems: () => [],
        getTotalSize: () => 0,
      }));
    });

    it("renders virtualized mode with single table and sticky header", () => {
      // Mock virtualizer to return virtual items (simulating >50 rows)
      mockUseVirtualizer.mockImplementation(() => ({
        getVirtualItems: () => [
          { index: 0, start: 0, size: 35, key: "0" },
          { index: 1, start: 35, size: 35, key: "1" },
          { index: 2, start: 70, size: 35, key: "2" },
        ],
        getTotalSize: () => 1750, // 50 rows * 35px
      }));

      const columns = [
        createColumn({ uid: "col-1", header: "Name", width: "200px" }),
        createColumn({ uid: "col-2", header: "Status", width: "100px" }),
        createColumn({ uid: "col-3", header: "Date", width: "150px" }),
      ];
      const layout = createLayout(columns);

      // Create >50 rows to trigger virtualization
      const rows = Array.from({ length: 51 }, (_, i) =>
        createRow({
          id: `row-${i}`,
          values: {
            "col-1": `Name ${i}`,
            "col-2": `Status ${i}`,
            "col-3": `2024-01-${String(i + 1).padStart(2, "0")}`,
          },
        })
      );

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          options={{ virtualize: true }}
        />
      );

      // Check that virtualized mode is active
      expect(container.querySelector(".exo-layout-virtualized")).toBeInTheDocument();

      // Single table with colgroup, thead, and tbody
      const tables = container.querySelectorAll("table");
      expect(tables.length).toBe(1);

      const table = tables[0];
      expect(table.querySelector("colgroup")).toBeInTheDocument();
      expect(table.querySelector("thead")).toBeInTheDocument();
      expect(table.querySelector("tbody")).toBeInTheDocument();

      // Colgroup has correct column count
      const cols = table.querySelectorAll("colgroup col");
      expect(cols.length).toBe(3);

      // Body cells have width styles from column definitions
      const cells = table.querySelectorAll("tbody tr:first-child td");
      expect(cells?.length).toBe(3);
      expect(cells?.[0]).toHaveStyle({ width: "200px" });
      expect(cells?.[1]).toHaveStyle({ width: "100px" });
      expect(cells?.[2]).toHaveStyle({ width: "150px" });
    });

    it("uses single table with shared colgroup in virtualized mode", () => {
      mockUseVirtualizer.mockImplementation(() => ({
        getVirtualItems: () => [
          { index: 0, start: 0, size: 35, key: "0" },
        ],
        getTotalSize: () => 1750,
      }));

      const columns = [
        createColumn({ uid: "col-1", header: "Name", width: "40%" }),
        createColumn({ uid: "col-2", header: "Status", width: "30%" }),
        createColumn({ uid: "col-3", header: "Actions", width: "30%" }),
      ];
      const layout = createLayout(columns);

      const rows = Array.from({ length: 51 }, (_, i) =>
        createRow({
          id: `row-${i}`,
          values: {
            "col-1": `Name ${i}`,
            "col-2": `Status ${i}`,
            "col-3": `Action ${i}`,
          },
        })
      );

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          options={{ virtualize: true }}
        />
      );

      // Single table means one colgroup shared by header and body
      const colgroups = container.querySelectorAll("colgroup");
      expect(colgroups.length).toBe(1);

      const cols = colgroups[0]?.querySelectorAll("col");
      expect(cols?.length).toBe(3);
      expect(cols?.[0]).toHaveStyle({ width: "40%" });
      expect(cols?.[1]).toHaveStyle({ width: "30%" });
      expect(cols?.[2]).toHaveStyle({ width: "30%" });
    });

    it("virtualized rows have position: absolute style applied", () => {
      mockUseVirtualizer.mockImplementation(() => ({
        getVirtualItems: () => [
          { index: 0, start: 0, size: 35, key: "0" },
          { index: 1, start: 35, size: 35, key: "1" },
        ],
        getTotalSize: () => 1750,
      }));

      const columns = [
        createColumn({ uid: "col-1", header: "Name", width: "200px" }),
        createColumn({ uid: "col-2", header: "Status", width: "100px" }),
      ];
      const layout = createLayout(columns);

      const rows = Array.from({ length: 51 }, (_, i) =>
        createRow({
          id: `row-${i}`,
          values: {
            "col-1": `Name ${i}`,
            "col-2": `Status ${i}`,
          },
        })
      );

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          options={{ virtualize: true }}
        />
      );

      // Virtualized rows should have position: absolute
      const virtualTableRows = container.querySelectorAll(".exo-layout-virtualized tbody tr");
      expect(virtualTableRows.length).toBe(2);

      virtualTableRows.forEach((row) => {
        expect(row).toHaveStyle({ position: "absolute" });
      });
    });

    it("handles window resize events in virtualized mode", () => {
      mockUseVirtualizer.mockImplementation(() => ({
        getVirtualItems: () => [
          { index: 0, start: 0, size: 35, key: "0" },
        ],
        getTotalSize: () => 1750,
      }));

      const columns = [
        createColumn({ uid: "col-1", header: "Name", width: "200px" }),
        createColumn({ uid: "col-2", header: "Status", width: "100px" }),
      ];
      const layout = createLayout(columns);

      const rows = Array.from({ length: 51 }, (_, i) =>
        createRow({
          id: `row-${i}`,
          values: {
            "col-1": `Name ${i}`,
            "col-2": `Status ${i}`,
          },
        })
      );

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          options={{ virtualize: true }}
        />
      );

      // Verify virtualized container is rendered
      expect(container.querySelector(".exo-layout-virtualized")).toBeInTheDocument();

      // Trigger resize event - should not throw
      fireEvent(window, new Event("resize"));

      // Cells should still have width styles after resize
      const cells = container.querySelectorAll(".exo-layout-virtualized tbody td");
      expect(cells.length).toBeGreaterThanOrEqual(2);
      expect(cells[0]).toHaveStyle({ width: "200px" });
      expect(cells[1]).toHaveStyle({ width: "100px" });
    });

    it("non-virtualized tables render normally", () => {
      // Reset mock to default (no virtual items)
      mockUseVirtualizer.mockImplementation(() => ({
        getVirtualItems: () => [],
        getTotalSize: () => 0,
      }));

      const columns = [
        createColumn({ uid: "col-1", header: "Name", width: "200px" }),
        createColumn({ uid: "col-2", header: "Status", width: "100px" }),
      ];
      const layout = createLayout(columns);

      // Less than 50 rows - should not trigger virtualization
      const rows = Array.from({ length: 10 }, (_, i) =>
        createRow({
          id: `row-${i}`,
          values: {
            "col-1": `Name ${i}`,
            "col-2": `Status ${i}`,
          },
        })
      );

      const { container } = render(
        <TableLayoutRenderer
          layout={layout}
          rows={rows}
          options={{ virtualize: true }}
        />
      );

      // Should NOT be in virtualized mode
      expect(container.querySelector(".exo-layout-virtualized")).not.toBeInTheDocument();

      // Regular table cells should still have width from column definition
      const cells = container.querySelectorAll("tbody td");
      expect(cells.length).toBeGreaterThanOrEqual(2);
      expect(cells[0]).toHaveStyle({ width: "200px" });
      expect(cells[1]).toHaveStyle({ width: "100px" });
    });
  });
});
