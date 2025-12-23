/**
 * Graph Event Store Module
 *
 * Provides a robust event system for graph updates, enabling real-time
 * synchronization between the graph visualization and external data sources.
 *
 * @module presentation/stores/graphEventStore
 */

// Store exports
export {
  useGraphEventStore,
  getDefaultState,
  clearAllHandlers,
  getHandlerCount,
} from "./store";

// Hook exports
export {
  // Core event hooks
  useGraphEvent,
  useGraphEvents,
  useAllGraphEvents,
  useEmitGraphEvent,
  useEmitGraphEventAsync,
  // Specialized event hooks
  useNodeClick,
  useNodeDoubleClick,
  useNodeHover,
  useNodeSelect,
  useNodeDrag,
  useEdgeClick,
  useEdgeHover,
  useSelectionChange,
  useViewportEvents,
  useLayoutEvents,
  useDataLoadingEvents,
  useGraphError,
  // Event emitter hooks
  useGraphEventEmitters,
  // Debug/history hooks
  useEventHistory,
  useRecentEvents,
  useEventDebugMode,
  useEventHistoryEnabled,
  useEventBatch,
} from "./hooks";

// Type exports
export type {
  // Base types
  Position,
  GraphEventBase,
  EventSource,
  EventModifiers,
  // Node events
  NodeAddEvent,
  NodeUpdateEvent,
  NodeRemoveEvent,
  NodePositionEvent,
  NodeSelectEvent,
  NodeHoverEvent,
  NodeClickEvent,
  NodeDoubleClickEvent,
  NodeContextMenuEvent,
  NodeDragStartEvent,
  NodeDragEvent,
  NodeDragEndEvent,
  // Edge events
  EdgeAddEvent,
  EdgeUpdateEvent,
  EdgeRemoveEvent,
  EdgeSelectEvent,
  EdgeHoverEvent,
  EdgeClickEvent,
  // Viewport events
  ViewportPanEvent,
  ViewportZoomEvent,
  ViewportResizeEvent,
  ViewportFitEvent,
  // Layout events
  LayoutStartEvent,
  LayoutTickEvent,
  LayoutEndEvent,
  LayoutChangeEvent,
  // Selection events
  SelectionChangeEvent,
  SelectionClearEvent,
  SelectionBoxStartEvent,
  SelectionBoxUpdateEvent,
  SelectionBoxEndEvent,
  // Data events
  DataLoadStartEvent,
  DataLoadEndEvent,
  DataLoadErrorEvent,
  DataSyncEvent,
  DataBatchEvent,
  // Filter events
  FilterChangeEvent,
  FilterResetEvent,
  // Error events
  GraphErrorEvent,
  // Union and utility types
  GraphEvent,
  GraphEventType,
  GraphEventHandler,
  GraphEventWildcardHandler,
  SubscriptionOptions,
  EventSubscription,
  GraphEventState,
  GraphEventActions,
  GraphEventStore,
  EventOfType,
  HandlerOfType,
} from "./types";
