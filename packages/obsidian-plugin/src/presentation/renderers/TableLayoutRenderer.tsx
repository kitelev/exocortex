/**
 * TableLayoutRenderer Component
 *
 * Renders a Layout definition as an interactive table with:
 * - Sortable columns (click header to sort)
 * - Typed cell renderers (text, link, badge, datetime, duration, boolean, progress)
 * - Inline editing for editable columns
 * - Configurable column widths (px, %, fr, auto)
 * - CSS styles following Obsidian theme
 *
 * @module presentation/renderers
 * @since 1.0.0
 */
import React, { useState, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { TableLayout, LayoutColumn } from "../../domain/layout";
import { getDefaultColumnHeader } from "../../domain/layout";
import type {
  TableRow,
  TableSortState,
  TableLayoutOptions,
  CellValue,
} from "./cell-renderers";
import { getCellRenderer } from "./cell-renderers";

/**
 * Props for TableLayoutRenderer
 */
export interface TableLayoutRendererProps {
  /**
   * The TableLayout definition to render
   */
  layout: TableLayout;

  /**
   * Row data to display
   */
  rows: TableRow[];

  /**
   * Handler for link clicks (navigation)
   */
  onLinkClick?: (path: string, event: React.MouseEvent) => void;

  /**
   * Handler for cell value changes (inline editing)
   * @param rowId - The row ID
   * @param columnUid - The column UID
   * @param newValue - The new cell value
   */
  onCellChange?: (rowId: string, columnUid: string, newValue: CellValue) => void;

  /**
   * Layout options
   */
  options?: TableLayoutOptions;

  /**
   * Initial sort state
   */
  initialSort?: TableSortState;

  /**
   * Custom CSS class name
   */
  className?: string;
}

/**
 * Default table layout options
 */
const defaultOptions: TableLayoutOptions = {
  sortable: true,
  editable: true,
  maxRows: undefined,
  virtualize: true,
  rowHeight: 35,
};

/**
 * Virtualization threshold - use virtualization for tables with more rows
 */
const VIRTUALIZATION_THRESHOLD = 50;

/**
 * Compare two cell values for sorting
 */
function compareCellValues(a: CellValue, b: CellValue, direction: "asc" | "desc"): number {
  // Handle null/undefined
  if (a == null && b == null) return 0;
  if (a == null) return direction === "asc" ? 1 : -1;
  if (b == null) return direction === "asc" ? -1 : 1;

  // Handle numbers
  if (typeof a === "number" && typeof b === "number") {
    return direction === "asc" ? a - b : b - a;
  }

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    const diff = a.getTime() - b.getTime();
    return direction === "asc" ? diff : -diff;
  }

  // Handle booleans
  if (typeof a === "boolean" && typeof b === "boolean") {
    const aNum = a ? 1 : 0;
    const bNum = b ? 1 : 0;
    return direction === "asc" ? aNum - bNum : bNum - aNum;
  }

  // Default to string comparison
  const aStr = String(a).toLowerCase();
  const bStr = String(b).toLowerCase();
  const comparison = aStr.localeCompare(bStr);
  return direction === "asc" ? comparison : -comparison;
}

/**
 * Parse column width specification into CSS value
 */
function parseColumnWidth(width: string | undefined): string {
  if (!width) return "auto";

  // Already has unit - use as-is
  if (
    width.endsWith("px") ||
    width.endsWith("%") ||
    width.endsWith("fr") ||
    width === "auto"
  ) {
    return width;
  }

  // Number - assume pixels
  const num = parseFloat(width);
  if (!isNaN(num)) {
    return `${num}px`;
  }

  return "auto";
}

/**
 * TableLayoutRenderer - Renders a TableLayout as an interactive table
 */
export const TableLayoutRenderer: React.FC<TableLayoutRendererProps> = ({
  layout,
  rows,
  onLinkClick,
  onCellChange,
  options: propOptions,
  initialSort,
  className,
}) => {
  const options = { ...defaultOptions, ...propOptions };
  const columns = layout.columns || [];

  // Sort state
  const [sortState, setSortState] = useState<TableSortState>(
    initialSort || {
      columnUid: layout.defaultSort?.property
        ? extractPropertyUid(layout.defaultSort.property)
        : null,
      direction:
        layout.defaultSort?.direction === "desc" ? "desc" : "asc",
    }
  );

  // Editing state
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    columnUid: string;
  } | null>(null);

  // Virtualization refs
  const parentRef = useRef<HTMLDivElement>(null);
  const [isParentMounted, setIsParentMounted] = useState(false);

  useLayoutEffect(() => {
    if (parentRef.current && !isParentMounted) {
      setIsParentMounted(true);
    }
  }, [isParentMounted]);

  // Handle sort toggle
  const handleSortToggle = useCallback(
    (columnUid: string) => {
      if (!options.sortable) return;

      setSortState((prev) => {
        if (prev.columnUid === columnUid) {
          // Toggle direction
          return {
            columnUid,
            direction: prev.direction === "asc" ? "desc" : "asc",
          };
        }
        // New column - start with ascending
        return { columnUid, direction: "asc" };
      });
    },
    [options.sortable]
  );

  // Handle cell edit
  const handleCellClick = useCallback(
    (rowId: string, column: LayoutColumn) => {
      if (options.editable && column.editable) {
        setEditingCell({ rowId, columnUid: column.uid });
      }
    },
    [options.editable]
  );

  // Handle cell value change
  const handleCellChange = useCallback(
    (rowId: string, columnUid: string, newValue: CellValue) => {
      onCellChange?.(rowId, columnUid, newValue);
      setEditingCell(null);
    },
    [onCellChange]
  );

  // Sort rows
  const sortedRows = useMemo(() => {
    let result = [...rows];

    // Apply max rows limit
    if (options.maxRows !== undefined && options.maxRows > 0) {
      result = result.slice(0, options.maxRows);
    }

    // Apply sorting
    if (sortState.columnUid) {
      const sortColumn = columns.find((c) => c.uid === sortState.columnUid);
      if (sortColumn && sortColumn.sortable !== false) {
        result.sort((a, b) => {
          const aValue = a.values[sortState.columnUid!];
          const bValue = b.values[sortState.columnUid!];
          return compareCellValues(aValue, bValue, sortState.direction);
        });
      }
    }

    return result;
  }, [rows, sortState, columns, options.maxRows]);

  // Virtualization
  const shouldVirtualize =
    options.virtualize && sortedRows.length > VIRTUALIZATION_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? sortedRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => options.rowHeight || 35,
    overscan: 5,
    enabled: shouldVirtualize && isParentMounted,
  });

  // Render column header
  const renderHeader = (column: LayoutColumn) => {
    const header = column.header || getDefaultColumnHeader(column.property);
    const isSorted = sortState.columnUid === column.uid;
    const sortIcon = isSorted
      ? sortState.direction === "asc"
        ? " ↑"
        : " ↓"
      : "";
    const isSortable = options.sortable && column.sortable !== false;

    return (
      <th
        key={column.uid}
        className={`exo-layout-column ${isSortable ? "exo-layout-column-sortable" : ""} ${isSorted ? "exo-layout-column-sorted" : ""}`}
        style={{
          width: parseColumnWidth(column.width),
          cursor: isSortable ? "pointer" : "default",
        }}
        onClick={() => isSortable && handleSortToggle(column.uid)}
      >
        {header}
        {sortIcon}
      </th>
    );
  };

  // Render cell
  const renderCell = (row: TableRow, column: LayoutColumn) => {
    const value = row.values[column.uid];
    const CellRenderer = getCellRenderer(column.renderer);
    const isEditing =
      editingCell?.rowId === row.id && editingCell?.columnUid === column.uid;
    const isClickable =
      options.editable && column.editable && !isEditing;

    return (
      <td
        key={column.uid}
        className={`exo-layout-cell exo-layout-cell-${column.renderer || "text"} ${isEditing ? "exo-layout-cell-editing" : ""} ${isClickable ? "exo-layout-cell-editable" : ""}`}
        style={{ width: parseColumnWidth(column.width) }}
        onClick={() => !isEditing && handleCellClick(row.id, column)}
      >
        <CellRenderer
          value={value}
          column={column}
          assetPath={row.path}
          onLinkClick={onLinkClick}
          onChange={(newValue) => handleCellChange(row.id, column.uid, newValue)}
          isEditing={isEditing}
          onBlur={() => setEditingCell(null)}
        />
      </td>
    );
  };

  // Render row
  const renderRow = (row: TableRow, _index: number, style?: React.CSSProperties) => {
    return (
      <tr
        key={row.id}
        className="exo-layout-row"
        data-row-id={row.id}
        data-path={row.path}
        style={style}
      >
        {columns.map((column) => renderCell(row, column))}
      </tr>
    );
  };

  // Render colgroup for column widths
  const renderColGroup = () => (
    <colgroup>
      {columns.map((column) => (
        <col
          key={column.uid}
          style={{ width: parseColumnWidth(column.width) }}
        />
      ))}
    </colgroup>
  );

  // Render table header
  const renderTableHeader = () => (
    <thead className="exo-layout-header">
      <tr>{columns.map(renderHeader)}</tr>
    </thead>
  );

  // Empty state
  if (sortedRows.length === 0) {
    return (
      <div className={`exo-layout-table-container exo-layout-table-empty ${className || ""}`}>
        <table className="exo-layout-table">
          {renderColGroup()}
          {renderTableHeader()}
          <tbody>
            <tr>
              <td colSpan={columns.length} className="exo-layout-empty-message">
                No data available
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // Non-virtualized rendering
  if (!shouldVirtualize) {
    return (
      <div className={`exo-layout-table-container ${className || ""}`}>
        <table className="exo-layout-table">
          {renderColGroup()}
          {renderTableHeader()}
          <tbody className="exo-layout-body">
            {sortedRows.map((row, index) => renderRow(row, index))}
          </tbody>
        </table>
      </div>
    );
  }

  // Virtualized rendering
  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualizerTotalSize = rowVirtualizer.getTotalSize();
  const totalSize =
    virtualizerTotalSize > 0
      ? virtualizerTotalSize
      : sortedRows.length * (options.rowHeight || 35);

  return (
    <div className={`exo-layout-table-container exo-layout-virtualized ${className || ""}`}>
      {/* Fixed header table */}
      <table className="exo-layout-table exo-layout-table-header-fixed">
        {renderColGroup()}
        {renderTableHeader()}
      </table>

      {/* Scrollable body */}
      <div
        ref={parentRef}
        className="exo-layout-virtual-scroll"
        style={{ height: "400px", overflow: "auto" }}
      >
        <div
          style={{
            height: `${totalSize}px`,
            width: "100%",
            position: "relative",
          }}
        >
          <table
            className="exo-layout-table exo-layout-virtual-table"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
            }}
          >
            {renderColGroup()}
            <tbody className="exo-layout-body">
              {virtualItems.length > 0 ? (
                virtualItems.map((virtualRow) => {
                  const row = sortedRows[virtualRow.index];
                  return renderRow(row, virtualRow.index, {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  });
                })
              ) : (
                // Fallback: render all rows if virtualizer hasn't initialized
                sortedRows.map((row, index) => renderRow(row, index))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/**
 * Extract property UID from wikilink format.
 * "[[exo__Asset_label]]" -> "exo__Asset_label"
 */
function extractPropertyUid(property: string): string {
  const match = property.match(/\[\[([^\]]+)\]\]/);
  return match ? match[1] : property;
}

export default TableLayoutRenderer;
