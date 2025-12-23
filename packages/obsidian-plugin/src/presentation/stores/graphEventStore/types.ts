/**
 * Type definitions for the Graph Event System.
 * Provides a robust event system for graph updates, enabling real-time
 * synchronization between the graph visualization and external data sources.
 */

import type { GraphNode, GraphEdge } from "exocortex";

/**
 * Position in 2D space
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Base event interface with common properties
 */
export interface GraphEventBase {
  /** Unique event ID for tracking */
  id: string;
  /** Timestamp when event was created */
  timestamp: number;
  /** Source of the event */
  source: EventSource;
}

/**
 * Source of the event for attribution
 */
export type EventSource =
  | "user" // Direct user interaction
  | "store" // State store update
  | "layout" // Layout algorithm
  | "external" // External data source (triple store, vault)
  | "sync"; // Synchronization from collaborative editing

// ============================================================
// Node Events
// ============================================================

/** Node added to the graph */
export interface NodeAddEvent extends GraphEventBase {
  type: "node:add";
  node: GraphNode;
}

/** Node properties updated */
export interface NodeUpdateEvent extends GraphEventBase {
  type: "node:update";
  nodeId: string;
  changes: Partial<GraphNode>;
  previousValues?: Partial<GraphNode>;
}

/** Node removed from the graph */
export interface NodeRemoveEvent extends GraphEventBase {
  type: "node:remove";
  nodeId: string;
  node?: GraphNode; // The removed node for undo support
}

/** Node position changed (drag or layout) */
export interface NodePositionEvent extends GraphEventBase {
  type: "node:position";
  nodeId: string;
  position: Position;
  previousPosition?: Position;
}

/** Node selection state changed */
export interface NodeSelectEvent extends GraphEventBase {
  type: "node:select";
  nodeId: string;
  selected: boolean;
}

/** Node hover state changed */
export interface NodeHoverEvent extends GraphEventBase {
  type: "node:hover";
  nodeId: string | null;
}

/** Node clicked */
export interface NodeClickEvent extends GraphEventBase {
  type: "node:click";
  nodeId: string;
  position: Position;
  modifiers: EventModifiers;
}

/** Node double-clicked */
export interface NodeDoubleClickEvent extends GraphEventBase {
  type: "node:dblclick";
  nodeId: string;
  position: Position;
  modifiers: EventModifiers;
}

/** Node right-clicked (context menu) */
export interface NodeContextMenuEvent extends GraphEventBase {
  type: "node:contextmenu";
  nodeId: string;
  position: Position;
}

/** Node drag started */
export interface NodeDragStartEvent extends GraphEventBase {
  type: "node:dragstart";
  nodeId: string;
  position: Position;
}

/** Node being dragged */
export interface NodeDragEvent extends GraphEventBase {
  type: "node:drag";
  nodeId: string;
  position: Position;
}

/** Node drag ended */
export interface NodeDragEndEvent extends GraphEventBase {
  type: "node:dragend";
  nodeId: string;
  position: Position;
  startPosition?: Position;
}

// ============================================================
// Edge Events
// ============================================================

/** Edge added to the graph */
export interface EdgeAddEvent extends GraphEventBase {
  type: "edge:add";
  edge: GraphEdge;
}

/** Edge properties updated */
export interface EdgeUpdateEvent extends GraphEventBase {
  type: "edge:update";
  edgeId: string;
  changes: Partial<GraphEdge>;
  previousValues?: Partial<GraphEdge>;
}

/** Edge removed from the graph */
export interface EdgeRemoveEvent extends GraphEventBase {
  type: "edge:remove";
  edgeId: string;
  edge?: GraphEdge; // The removed edge for undo support
}

/** Edge selection state changed */
export interface EdgeSelectEvent extends GraphEventBase {
  type: "edge:select";
  edgeId: string;
  selected: boolean;
}

/** Edge hover state changed */
export interface EdgeHoverEvent extends GraphEventBase {
  type: "edge:hover";
  edgeId: string | null;
}

/** Edge clicked */
export interface EdgeClickEvent extends GraphEventBase {
  type: "edge:click";
  edgeId: string;
  position: Position;
  modifiers: EventModifiers;
}

// ============================================================
// Viewport Events
// ============================================================

/** Viewport panned */
export interface ViewportPanEvent extends GraphEventBase {
  type: "viewport:pan";
  offset: Position;
  previousOffset?: Position;
}

/** Viewport zoomed */
export interface ViewportZoomEvent extends GraphEventBase {
  type: "viewport:zoom";
  zoom: number;
  center?: Position;
  previousZoom?: number;
}

/** Viewport container resized */
export interface ViewportResizeEvent extends GraphEventBase {
  type: "viewport:resize";
  width: number;
  height: number;
  previousWidth?: number;
  previousHeight?: number;
}

/** Viewport fit-to-content requested */
export interface ViewportFitEvent extends GraphEventBase {
  type: "viewport:fit";
  bounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

// ============================================================
// Layout Events
// ============================================================

/** Layout algorithm started */
export interface LayoutStartEvent extends GraphEventBase {
  type: "layout:start";
  algorithm: string;
}

/** Layout simulation tick */
export interface LayoutTickEvent extends GraphEventBase {
  type: "layout:tick";
  alpha: number;
  progress: number;
}

/** Layout algorithm completed */
export interface LayoutEndEvent extends GraphEventBase {
  type: "layout:end";
  algorithm: string;
  duration?: number;
}

/** Layout algorithm changed */
export interface LayoutChangeEvent extends GraphEventBase {
  type: "layout:change";
  algorithm: string;
  previousAlgorithm?: string;
}

// ============================================================
// Selection Events
// ============================================================

/** Selection changed */
export interface SelectionChangeEvent extends GraphEventBase {
  type: "selection:change";
  nodeIds: string[];
  edgeIds: string[];
  previousNodeIds?: string[];
  previousEdgeIds?: string[];
}

/** Selection cleared */
export interface SelectionClearEvent extends GraphEventBase {
  type: "selection:clear";
  previousNodeIds?: string[];
  previousEdgeIds?: string[];
}

/** Box/lasso selection started */
export interface SelectionBoxStartEvent extends GraphEventBase {
  type: "selection:boxstart";
  startPosition: Position;
}

/** Box/lasso selection updated */
export interface SelectionBoxUpdateEvent extends GraphEventBase {
  type: "selection:boxupdate";
  startPosition: Position;
  currentPosition: Position;
  enclosedNodeIds: string[];
}

/** Box/lasso selection ended */
export interface SelectionBoxEndEvent extends GraphEventBase {
  type: "selection:boxend";
  selectedNodeIds: string[];
  additive: boolean;
}

// ============================================================
// Data Events
// ============================================================

/** Graph data loading started */
export interface DataLoadStartEvent extends GraphEventBase {
  type: "data:loadstart";
  dataSource?: string;
}

/** Graph data loading completed */
export interface DataLoadEndEvent extends GraphEventBase {
  type: "data:loadend";
  nodeCount: number;
  edgeCount: number;
  duration?: number;
}

/** Graph data loading failed */
export interface DataLoadErrorEvent extends GraphEventBase {
  type: "data:loaderror";
  error: Error | string;
}

/** Graph data changed externally (sync) */
export interface DataSyncEvent extends GraphEventBase {
  type: "data:sync";
  addedNodes: GraphNode[];
  removedNodeIds: string[];
  updatedNodes: Array<{ id: string; changes: Partial<GraphNode> }>;
  addedEdges: GraphEdge[];
  removedEdgeIds: string[];
  updatedEdges: Array<{ id: string; changes: Partial<GraphEdge> }>;
}

/** Batch update applied */
export interface DataBatchEvent extends GraphEventBase {
  type: "data:batch";
  operations: Array<
    | { type: "add"; entity: "node"; data: GraphNode }
    | { type: "add"; entity: "edge"; data: GraphEdge }
    | { type: "update"; entity: "node"; id: string; changes: Partial<GraphNode> }
    | { type: "update"; entity: "edge"; id: string; changes: Partial<GraphEdge> }
    | { type: "remove"; entity: "node"; id: string }
    | { type: "remove"; entity: "edge"; id: string }
  >;
}

// ============================================================
// Filter Events
// ============================================================

/** Filter configuration changed */
export interface FilterChangeEvent extends GraphEventBase {
  type: "filter:change";
  filterType: "nodeType" | "edgeType" | "search" | "minDegree" | "showOrphans" | "showLabels";
  value: unknown;
  previousValue?: unknown;
}

/** Filters reset to default */
export interface FilterResetEvent extends GraphEventBase {
  type: "filter:reset";
}

// ============================================================
// Error Events
// ============================================================

/** Error occurred in graph operations */
export interface GraphErrorEvent extends GraphEventBase {
  type: "error";
  error: Error | string;
  context?: string;
  recoverable: boolean;
}

// ============================================================
// Union Type for All Events
// ============================================================

/**
 * Union type of all graph events
 */
export type GraphEvent =
  // Node events
  | NodeAddEvent
  | NodeUpdateEvent
  | NodeRemoveEvent
  | NodePositionEvent
  | NodeSelectEvent
  | NodeHoverEvent
  | NodeClickEvent
  | NodeDoubleClickEvent
  | NodeContextMenuEvent
  | NodeDragStartEvent
  | NodeDragEvent
  | NodeDragEndEvent
  // Edge events
  | EdgeAddEvent
  | EdgeUpdateEvent
  | EdgeRemoveEvent
  | EdgeSelectEvent
  | EdgeHoverEvent
  | EdgeClickEvent
  // Viewport events
  | ViewportPanEvent
  | ViewportZoomEvent
  | ViewportResizeEvent
  | ViewportFitEvent
  // Layout events
  | LayoutStartEvent
  | LayoutTickEvent
  | LayoutEndEvent
  | LayoutChangeEvent
  // Selection events
  | SelectionChangeEvent
  | SelectionClearEvent
  | SelectionBoxStartEvent
  | SelectionBoxUpdateEvent
  | SelectionBoxEndEvent
  // Data events
  | DataLoadStartEvent
  | DataLoadEndEvent
  | DataLoadErrorEvent
  | DataSyncEvent
  | DataBatchEvent
  // Filter events
  | FilterChangeEvent
  | FilterResetEvent
  // Error events
  | GraphErrorEvent;

/**
 * Event type names for subscription
 */
export type GraphEventType = GraphEvent["type"];

/**
 * Event handler function type
 */
export type GraphEventHandler<T extends GraphEvent = GraphEvent> = (event: T) => void;

/**
 * Wildcard handler that receives all events
 */
export type GraphEventWildcardHandler = (event: GraphEvent) => void;

/**
 * Keyboard/mouse modifiers for interaction events
 */
export interface EventModifiers {
  /** Shift key pressed */
  shift: boolean;
  /** Ctrl/Cmd key pressed */
  ctrl: boolean;
  /** Alt/Option key pressed */
  alt: boolean;
  /** Meta key pressed (Cmd on Mac, Win on Windows) */
  meta: boolean;
}

/**
 * Event subscription options
 */
export interface SubscriptionOptions {
  /** Only receive events from specific sources */
  sources?: EventSource[];
  /** Filter events by custom predicate */
  filter?: (event: GraphEvent) => boolean;
  /** Debounce handler (ms) */
  debounce?: number;
  /** Throttle handler (ms) */
  throttle?: number;
  /** Priority for handler ordering (higher = called first) */
  priority?: number;
}

/**
 * Event subscription handle for unsubscribing
 */
export interface EventSubscription {
  /** Unsubscribe from the event */
  unsubscribe: () => void;
  /** Check if subscription is active */
  isActive: () => boolean;
}

/**
 * Event emitter state for the store
 */
export interface GraphEventState {
  /** History of recent events (for debugging/replay) */
  eventHistory: GraphEvent[];
  /** Maximum events to keep in history */
  maxHistorySize: number;
  /** Whether event history is enabled */
  historyEnabled: boolean;
  /** Whether to log events to console (debug mode) */
  debugMode: boolean;
  /** Batch events being collected */
  pendingBatch: GraphEvent[];
  /** Whether batching is active */
  isBatching: boolean;
}

/**
 * Input type for emitting events - allows any event without id/timestamp (auto-generated)
 * and with optional source (defaults to "user")
 */
export type EmitEventInput =
  | (Omit<NodeAddEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeUpdateEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeRemoveEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodePositionEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeSelectEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeHoverEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeClickEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeDoubleClickEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeContextMenuEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeDragStartEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeDragEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<NodeDragEndEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<EdgeAddEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<EdgeUpdateEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<EdgeRemoveEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<EdgeSelectEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<EdgeHoverEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<EdgeClickEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<ViewportPanEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<ViewportZoomEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<ViewportResizeEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<ViewportFitEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<LayoutStartEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<LayoutTickEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<LayoutEndEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<LayoutChangeEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<SelectionChangeEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<SelectionClearEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<SelectionBoxStartEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<SelectionBoxUpdateEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<SelectionBoxEndEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<DataLoadStartEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<DataLoadEndEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<DataLoadErrorEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<DataSyncEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<DataBatchEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<FilterChangeEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<FilterResetEvent, "id" | "timestamp" | "source"> & { source?: EventSource })
  | (Omit<GraphErrorEvent, "id" | "timestamp" | "source"> & { source?: EventSource });

/**
 * Event emitter actions
 */
export interface GraphEventActions {
  /** Emit an event to all subscribers */
  emit: (event: EmitEventInput) => void;

  /** Subscribe to a specific event type */
  on: <T extends GraphEventType>(
    type: T,
    handler: GraphEventHandler<Extract<GraphEvent, { type: T }>>,
    options?: SubscriptionOptions
  ) => EventSubscription;

  /** Subscribe to all events */
  onAny: (handler: GraphEventWildcardHandler, options?: SubscriptionOptions) => EventSubscription;

  /** Unsubscribe a handler from an event type */
  off: <T extends GraphEventType>(
    type: T,
    handler: GraphEventHandler<Extract<GraphEvent, { type: T }>>
  ) => void;

  /** Emit event and wait for async handlers */
  emitAsync: (event: EmitEventInput) => Promise<void>;

  /** Start batching events (emit as single batch event) */
  startBatch: () => void;

  /** End batching and emit collected events */
  endBatch: () => void;

  /** Clear event history */
  clearHistory: () => void;

  /** Toggle debug mode */
  setDebugMode: (enabled: boolean) => void;

  /** Toggle event history */
  setHistoryEnabled: (enabled: boolean) => void;

  /** Get recent events of a specific type */
  getRecentEvents: <T extends GraphEventType>(type: T, count?: number) => Array<Extract<GraphEvent, { type: T }>>;

  /** Reset event emitter state */
  reset: () => void;
}

/**
 * Complete event emitter store type
 */
export type GraphEventStore = GraphEventState & GraphEventActions;

/**
 * Type helper to extract event by type
 */
export type EventOfType<T extends GraphEventType> = Extract<GraphEvent, { type: T }>;

/**
 * Type helper for event handler by type
 */
export type HandlerOfType<T extends GraphEventType> = GraphEventHandler<EventOfType<T>>;
