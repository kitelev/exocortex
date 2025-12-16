/**
 * Kanban Components
 *
 * This module exports all Kanban board components and types
 * for use with KanbanLayout.
 *
 * @packageDocumentation
 */

// Main renderer
export { KanbanLayoutRenderer } from "./KanbanLayoutRenderer";
export { default as KanbanLayoutRendererDefault } from "./KanbanLayoutRenderer";

// Sub-components
export { KanbanLane } from "./KanbanLane";
export { default as KanbanLaneDefault } from "./KanbanLane";
export { KanbanCard } from "./KanbanCard";
export { default as KanbanCardDefault } from "./KanbanCard";

// Types
export type {
  KanbanLayoutRendererProps,
  KanbanLayoutOptions,
  KanbanLaneProps,
  KanbanCardProps,
  KanbanLane as KanbanLaneType,
  KanbanCard as KanbanCardType,
  KanbanDragResult,
} from "./types";

// Utilities
export {
  extractLabelFromWikilink,
  extractPathFromWikilink,
} from "./types";
