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
import React, { useState, useMemo, useCallback, useRef, useLayoutEffect, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { TableLayout, LayoutColumn } from "../../domain/layout";
import { getDefaultColumnHeader } from "../../domain/layout";
import type {
  TableRow,
  TableSortState,
  TableLayoutOptions,
  CellValue,
} from "./cell-renderers";
import { getCellRenderer, ActionsRenderer } from "./cell-renderers";

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

  /**
   * Callback to check if a command precondition is satisfied.
   * Used for action buttons visibility.
   * @param sparql - The SPARQL ASK query with $target placeholder
   * @param assetUri - The URI to substitute for $target
   * @returns true if the command should be visible/enabled
   */
  onCheckPrecondition?: (sparql: string, assetUri: string) => Promise<boolean>;

  /**
   * Callback to execute a command grounding.
   * Used when action buttons are clicked.
   * @param sparql - The SPARQL UPDATE query with $target and $now placeholders
   * @param assetUri - The URI to substitute for $target
   */
  onExecuteCommand?: (sparql: string, assetUri: string) => Promise<void>;

  /**
   * Optional function to resolve asset labels for wikilinks without aliases.
   * When provided, wikilinks like [[uuid]] in text cells will display the
   * resolved label instead of the raw target path.
   */
  getAssetLabel?: (path: string) => string | null;
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
  onCheckPrecondition,
  onExecuteCommand,
  getAssetLabel,
}) => {
  const options = { ...defaultOptions, ...propOptions };
  const columns = layout.columns || [];
  const actions = layout.actions;
  const hasActions = actions && actions.commands.length > 0 && actions.position === "column";

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
      const sortColumnUid = sortState.columnUid;
      const sortColumn = columns.find((c) => c.uid === sortColumnUid);
      if (sortColumn && sortColumn.sortable !== false) {
        result.sort((a, b) => {
          const aValue = a.values[sortColumnUid];
          const bValue = b.values[sortColumnUid];
          return compareCellValues(aValue, bValue, sortState.direction);
        });
      }
    }

    return result;
  }, [rows, sortState, columns, options.maxRows]);

  // Virtualization
  const shouldVirtualize =
    options.virtualize && sortedRows.length > VIRTUALIZATION_THRESHOLD;

  // Synchronize column widths between header and body tables in virtualized mode
  // This fixes misalignment caused by scrollbar width difference (Issue #941, #2116)
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  // Track computed pixel widths for virtualized cells (Issue #2152)
  // When rows have position: absolute, table-layout: fixed doesn't work
  // We measure header cell widths and apply them explicitly to body cells
  const headerTableRef = useRef<HTMLTableElement>(null);
  const [computedColumnWidths, setComputedColumnWidths] = useState<number[]>([]);

  // Measure scrollbar width and column widths when scroll container is mounted
  const measureWidths = useCallback(() => {
    if (!parentRef.current) return;

    const scrollContainer = parentRef.current;
    // Scrollbar width = total width - client width (visible content area)
    const sbWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
    setScrollbarWidth(sbWidth);

    // Measure header cell widths for virtualized row alignment (Issue #2152)
    if (headerTableRef.current) {
      const headerCells = headerTableRef.current.querySelectorAll("thead th");
      const widths: number[] = [];
      headerCells.forEach((cell) => {
        // Use offsetWidth to get the actual rendered pixel width
        widths.push((cell as HTMLElement).offsetWidth);
      });
      setComputedColumnWidths(widths);
    }
  }, []);

  // Measure widths when virtualized mode is active and parent is mounted
  useLayoutEffect(() => {
    if (shouldVirtualize && isParentMounted) {
      measureWidths();
    }
  }, [shouldVirtualize, isParentMounted, measureWidths]);

  // Re-measure on window resize (scrollbar might appear/disappear, column widths change)
  useEffect(() => {
    if (!shouldVirtualize) return;

    const handleResize = () => measureWidths();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [shouldVirtualize, measureWidths]);

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
  // computedWidth is used in virtualized mode to apply measured pixel widths (Issue #2152)
  const renderCell = (row: TableRow, column: LayoutColumn, columnIndex: number, useComputedWidth: boolean) => {
    const value = row.values[column.uid];
    const CellRenderer = getCellRenderer(column.renderer);
    const isEditing =
      editingCell?.rowId === row.id && editingCell?.columnUid === column.uid;
    const isClickable =
      options.editable && column.editable && !isEditing;

    // In virtualized mode, use computed pixel widths to ensure alignment
    // when rows have position: absolute (Issue #2152)
    const cellWidth = useComputedWidth && computedColumnWidths[columnIndex]
      ? `${computedColumnWidths[columnIndex]}px`
      : parseColumnWidth(column.width);

    return (
      <td
        key={column.uid}
        className={`exo-layout-cell exo-layout-cell-${column.renderer || "text"} ${isEditing ? "exo-layout-cell-editing" : ""} ${isClickable ? "exo-layout-cell-editable" : ""}`}
        style={{ width: cellWidth }}
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
          getAssetLabel={getAssetLabel}
        />
      </td>
    );
  };

  // Render actions cell
  const renderActionsCell = (row: TableRow) => {
    if (!hasActions || !actions) return null;

    // Get asset URI from row metadata or construct from path
    const assetUri = (row.metadata?.uri as string) || `obsidian://vault/${encodeURIComponent(row.path)}`;

    return (
      <td key="__actions__" className="exo-layout-cell exo-layout-cell-actions">
        <ActionsRenderer
          actions={actions}
          assetUri={assetUri}
          assetPath={row.path}
          onCheckPrecondition={onCheckPrecondition}
          onExecuteCommand={onExecuteCommand}
        />
      </td>
    );
  };

  // Render row
  // useComputedWidth is true for virtualized rows to apply measured pixel widths (Issue #2152)
  const renderRow = (row: TableRow, _index: number, style?: React.CSSProperties, useComputedWidth = false) => {
    return (
      <tr
        key={row.id}
        className="exo-layout-row"
        data-row-id={row.id}
        data-path={row.path}
        style={style}
      >
        {columns.map((column, columnIndex) => renderCell(row, column, columnIndex, useComputedWidth))}
        {renderActionsCell(row)}
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
      {hasActions && (
        <col key="__actions__" style={{ width: "auto" }} />
      )}
    </colgroup>
  );

  // Render table header
  const renderTableHeader = () => (
    <thead className="exo-layout-header">
      <tr>
        {columns.map(renderHeader)}
        {hasActions && (
          <th key="__actions__" className="exo-layout-column exo-layout-column-actions">
            {actions?.showLabels ? "Actions" : ""}
          </th>
        )}
      </tr>
    </thead>
  );

  // Empty state
  const totalColumns = columns.length + (hasActions ? 1 : 0);
  if (sortedRows.length === 0) {
    return (
      <div className={`exo-layout-table-container exo-layout-table-empty ${className || ""}`}>
        <table className="exo-layout-table">
          {renderColGroup()}
          {renderTableHeader()}
          <tbody>
            <tr>
              <td colSpan={totalColumns} className="exo-layout-empty-message">
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
      {/* Header wrapper with padding-right to account for scrollbar width (Issue #941, #2116) */}
      <div
        className="exo-layout-table-header-wrapper"
        style={{
          paddingRight: scrollbarWidth > 0 ? `${scrollbarWidth}px` : undefined,
        }}
      >
        {/* Header table with ref for measuring column widths (Issue #2152) */}
        <table ref={headerTableRef} className="exo-layout-table exo-layout-table-header-fixed">
          {renderColGroup()}
          {renderTableHeader()}
        </table>
      </div>

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
                  // Pass useComputedWidth=true for virtualized rows (Issue #2152)
                  // This ensures cells use measured pixel widths instead of
                  // percentage/auto widths that don't work with position: absolute
                  return renderRow(row, virtualRow.index, {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }, true);
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
