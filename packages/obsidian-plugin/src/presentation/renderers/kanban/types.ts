/**
 * Kanban Types
 *
 * Defines the types and interfaces for Kanban board components.
 *
 * @module presentation/renderers/kanban
 * @since 1.0.0
 */

import type { LayoutColumn } from "../../../domain/layout";
import type { CellValue, TableRow } from "../cell-renderers";

/**
 * Lane configuration for Kanban board
 */
export interface KanbanLane {
  /** Lane ID (from laneProperty value or explicit lane reference) */
  id: string;

  /** Display label for the lane */
  label: string;

  /** Whether the lane is collapsed */
  collapsed?: boolean;

  /** Lane order index */
  order?: number;

  /** Optional color for the lane */
  color?: string;
}

/**
 * Card data for Kanban board (extends TableRow)
 */
export interface KanbanCard extends TableRow {
  /** The lane this card belongs to */
  laneId: string;

  /** Card order within the lane */
  order?: number;
}

/**
 * Drag result from drag-and-drop operation
 */
export interface KanbanDragResult {
  /** Card ID being dragged */
  cardId: string;

  /** Source lane ID */
  sourceLaneId: string;

  /** Destination lane ID */
  destinationLaneId: string;

  /** Index within source lane (before removal) */
  sourceIndex: number;

  /** Index within destination lane (after drop) */
  destinationIndex: number;
}

/**
 * Props for KanbanLayoutRenderer
 */
export interface KanbanLayoutRendererProps {
  /**
   * The KanbanLayout definition
   */
  layout: {
    uid: string;
    label: string;
    laneProperty: string;
    lanes?: string[];
    columns?: LayoutColumn[];
  };

  /**
   * Card data to display
   */
  cards: KanbanCard[];

  /**
   * Lane definitions (if not derived from data)
   */
  lanes?: KanbanLane[];

  /**
   * Handler for card move operations (drag-and-drop)
   * @param cardId - The card being moved
   * @param property - The property to update (laneProperty)
   * @param newValue - The new lane value
   */
  onCardMove?: (cardId: string, property: string, newValue: string) => void;

  /**
   * Handler for link clicks (navigation)
   */
  onLinkClick?: (path: string, event: React.MouseEvent) => void;

  /**
   * Handler for card cell value changes
   */
  onCellChange?: (cardId: string, columnUid: string, newValue: CellValue) => void;

  /**
   * Handler for lane collapse toggle
   */
  onLaneToggle?: (laneId: string, collapsed: boolean) => void;

  /**
   * Layout options
   */
  options?: KanbanLayoutOptions;

  /**
   * Custom CSS class name
   */
  className?: string;
}

/**
 * Options for Kanban board rendering
 */
export interface KanbanLayoutOptions {
  /** Whether drag-and-drop is enabled */
  draggable?: boolean;

  /** Whether lanes can be collapsed */
  collapsible?: boolean;

  /** Maximum cards per lane to show (rest are hidden) */
  maxCardsPerLane?: number;

  /** Show card count in lane header */
  showCount?: boolean;

  /** Column width (CSS value) */
  laneWidth?: string;

  /** Card height (CSS value or 'auto') */
  cardHeight?: string;
}

/**
 * Props for KanbanLane component
 */
export interface KanbanLaneProps {
  /** Lane configuration */
  lane: KanbanLane;

  /** Cards in this lane */
  cards: KanbanCard[];

  /** Columns to display on cards */
  columns?: LayoutColumn[];

  /** Whether lane is droppable (drag target) */
  isDropTarget?: boolean;

  /** Whether lane is currently receiving drag */
  isDragOver?: boolean;

  /** Handler for lane header click (collapse toggle) */
  onToggle?: (collapsed: boolean) => void;

  /** Handler for card link click */
  onCardLinkClick?: (path: string, event: React.MouseEvent) => void;

  /** Options */
  options?: KanbanLayoutOptions;

  /** Drag event handlers */
  onDragOver?: (event: React.DragEvent) => void;
  onDragLeave?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;

  /** Card drag start handler */
  onCardDragStart?: (cardId: string, event: React.DragEvent) => void;
}

/**
 * Props for KanbanCard component
 */
export interface KanbanCardProps {
  /** Card data */
  card: KanbanCard;

  /** Columns to display */
  columns?: LayoutColumn[];

  /** Whether card is draggable */
  isDraggable?: boolean;

  /** Whether card is currently being dragged */
  isDragging?: boolean;

  /** Handler for card link click */
  onLinkClick?: (path: string, event: React.MouseEvent) => void;

  /** Drag event handlers */
  onDragStart?: (event: React.DragEvent) => void;
  onDragEnd?: (event: React.DragEvent) => void;
}

/**
 * Extract label from wikilink reference.
 * "[[path/to/file|Label]]" -> "Label"
 * "[[path/to/file]]" -> "file"
 *
 * @param wikilink - The wikilink reference
 * @returns The extracted label
 */
export function extractLabelFromWikilink(wikilink: string): string {
  // Handle [[target|Label]] format
  const pipedMatch = wikilink.match(/\[\[([^|\]]+)\|([^\]]+)\]\]/);
  if (pipedMatch) {
    return pipedMatch[2];
  }

  // Handle [[target]] format - extract filename
  const match = wikilink.match(/\[\[([^\]]+)\]\]/);
  if (match) {
    const path = match[1];
    // Get last segment (filename without path)
    const segments = path.split("/");
    const filename = segments[segments.length - 1];
    // Remove .md extension if present
    return filename.replace(/\.md$/, "");
  }

  return wikilink;
}

/**
 * Extract target path from wikilink reference.
 * "[[path/to/file|Label]]" -> "path/to/file"
 *
 * @param wikilink - The wikilink reference
 * @returns The target path
 */
export function extractPathFromWikilink(wikilink: string): string {
  // Handle [[target|Label]] format
  const pipedMatch = wikilink.match(/\[\[([^|\]]+)\|([^\]]+)\]\]/);
  if (pipedMatch) {
    return pipedMatch[1];
  }

  // Handle [[target]] format
  const match = wikilink.match(/\[\[([^\]]+)\]\]/);
  if (match) {
    return match[1];
  }

  return wikilink;
}
