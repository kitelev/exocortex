/**
 * Cell Renderer Types
 *
 * Defines the types and interfaces for table cell renderers
 * used by TableLayoutRenderer.
 */

import type { LayoutColumn, ColumnRenderer } from "../../../domain/layout";

/**
 * Value that can be rendered in a cell
 */
export type CellValue = string | number | boolean | Date | null | undefined;

/**
 * Props passed to cell renderer components
 */
export interface CellRendererProps {
  /** The value to render */
  value: CellValue;

  /** The column definition */
  column: LayoutColumn;

  /** Asset path for link navigation */
  assetPath?: string;

  /** Handler for link clicks */
  onLinkClick?: (path: string, event: React.MouseEvent) => void;

  /** Handler for value changes (inline editing) */
  onChange?: (newValue: CellValue) => void;

  /** Whether editing mode is active */
  isEditing?: boolean;

  /** Handler to exit editing mode */
  onBlur?: () => void;
}

/**
 * Cell renderer component type
 */
export type CellRendererComponent = React.FC<CellRendererProps>;

/**
 * Registry of cell renderers by type
 */
export type CellRendererRegistry = Record<ColumnRenderer, CellRendererComponent>;

/**
 * Row data for TableLayoutRenderer
 */
export interface TableRow {
  /** Unique identifier (usually asset UID or path) */
  id: string;

  /** Path to the asset file */
  path: string;

  /** Metadata record for the asset */
  metadata: Record<string, unknown>;

  /** Column values indexed by column UID */
  values: Record<string, CellValue>;
}

/**
 * Sort state for the table
 */
export interface TableSortState {
  /** Column UID currently being sorted */
  columnUid: string | null;

  /** Sort direction */
  direction: "asc" | "desc";
}

/**
 * Table layout rendering options
 */
export interface TableLayoutOptions {
  /** Whether to enable sorting */
  sortable?: boolean;

  /** Whether to enable inline editing */
  editable?: boolean;

  /** Maximum number of rows to display */
  maxRows?: number;

  /** Whether to use virtualization for large datasets */
  virtualize?: boolean;

  /** Row height for virtualization */
  rowHeight?: number;
}
