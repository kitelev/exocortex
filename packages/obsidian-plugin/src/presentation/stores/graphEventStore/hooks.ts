/**
 * React hooks for the graph event store.
 * Provides convenient access to event subscription and emission.
 */

import { useEffect, useCallback, useRef, useMemo } from "react";
import { useGraphEventStore } from "./store";
import type {
  GraphEvent,
  GraphEventType,
  GraphEventHandler,
  GraphEventWildcardHandler,
  SubscriptionOptions,
  EventSource,
  Position,
  EventModifiers,
  EmitEventInput,
} from "./types";
import type { GraphNode, GraphEdge } from "exocortex";

// ============================================================
// Core Event Hooks
// ============================================================

/**
 * Subscribe to a specific event type.
 * Automatically unsubscribes on unmount.
 */
export function useGraphEvent<T extends GraphEventType>(
  type: T,
  handler: GraphEventHandler<Extract<GraphEvent, { type: T }>>,
  options?: SubscriptionOptions,
  deps: React.DependencyList = []
): void {
  const on = useGraphEventStore((s) => s.on);

  // Use ref to avoid handler recreation issues
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const subscription = on(
      type,
      (event) => handlerRef.current(event),
      options
    );
    return () => subscription.unsubscribe();
  }, [type, on, ...deps]);
}

/**
 * Subscribe to multiple event types with a single handler.
 */
export function useGraphEvents<T extends GraphEventType>(
  types: T[],
  handler: GraphEventHandler<Extract<GraphEvent, { type: T }>>,
  options?: SubscriptionOptions,
  deps: React.DependencyList = []
): void {
  const on = useGraphEventStore((s) => s.on);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const subscriptions = types.map((type) =>
      on(type, (event) => handlerRef.current(event), options)
    );
    return () => subscriptions.forEach((s) => s.unsubscribe());
  }, [types.join(","), on, ...deps]);
}

/**
 * Subscribe to all events.
 * Automatically unsubscribes on unmount.
 */
export function useAllGraphEvents(
  handler: GraphEventWildcardHandler,
  options?: SubscriptionOptions,
  deps: React.DependencyList = []
): void {
  const onAny = useGraphEventStore((s) => s.onAny);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const subscription = onAny((event) => handlerRef.current(event), options);
    return () => subscription.unsubscribe();
  }, [onAny, ...deps]);
}

/**
 * Get the emit function for emitting events.
 */
export function useEmitGraphEvent(): (event: EmitEventInput) => void {
  return useGraphEventStore((s) => s.emit);
}

/**
 * Get the async emit function.
 */
export function useEmitGraphEventAsync(): (event: EmitEventInput) => Promise<void> {
  return useGraphEventStore((s) => s.emitAsync);
}

// ============================================================
// Specialized Event Hooks
// ============================================================

/**
 * Hook for node click events with memoized handler.
 */
export function useNodeClick(
  handler: (nodeId: string, position: Position, modifiers: EventModifiers) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "node:click",
    useCallback((event) => handler(event.nodeId, event.position, event.modifiers), deps),
    undefined,
    deps
  );
}

/**
 * Hook for node double-click events.
 */
export function useNodeDoubleClick(
  handler: (nodeId: string, position: Position, modifiers: EventModifiers) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "node:dblclick",
    useCallback((event) => handler(event.nodeId, event.position, event.modifiers), deps),
    undefined,
    deps
  );
}

/**
 * Hook for node hover events.
 */
export function useNodeHover(
  handler: (nodeId: string | null) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "node:hover",
    useCallback((event) => handler(event.nodeId), deps),
    undefined,
    deps
  );
}

/**
 * Hook for node selection events.
 */
export function useNodeSelect(
  handler: (nodeId: string, selected: boolean) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "node:select",
    useCallback((event) => handler(event.nodeId, event.selected), deps),
    undefined,
    deps
  );
}

/**
 * Hook for node drag events.
 */
export function useNodeDrag(
  handlers: {
    onDragStart?: (nodeId: string, position: Position) => void;
    onDrag?: (nodeId: string, position: Position) => void;
    onDragEnd?: (nodeId: string, position: Position, startPosition?: Position) => void;
  },
  deps: React.DependencyList = []
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useGraphEvent(
    "node:dragstart",
    useCallback((event) => handlersRef.current.onDragStart?.(event.nodeId, event.position), []),
    undefined,
    deps
  );

  useGraphEvent(
    "node:drag",
    useCallback((event) => handlersRef.current.onDrag?.(event.nodeId, event.position), []),
    undefined,
    deps
  );

  useGraphEvent(
    "node:dragend",
    useCallback(
      (event) => handlersRef.current.onDragEnd?.(event.nodeId, event.position, event.startPosition),
      []
    ),
    undefined,
    deps
  );
}

/**
 * Hook for edge click events.
 */
export function useEdgeClick(
  handler: (edgeId: string, position: Position, modifiers: EventModifiers) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "edge:click",
    useCallback((event) => handler(event.edgeId, event.position, event.modifiers), deps),
    undefined,
    deps
  );
}

/**
 * Hook for edge hover events.
 */
export function useEdgeHover(
  handler: (edgeId: string | null) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "edge:hover",
    useCallback((event) => handler(event.edgeId), deps),
    undefined,
    deps
  );
}

/**
 * Hook for selection change events.
 */
export function useSelectionChange(
  handler: (nodeIds: string[], edgeIds: string[]) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "selection:change",
    useCallback((event) => handler(event.nodeIds, event.edgeIds), deps),
    undefined,
    deps
  );
}

/**
 * Hook for viewport events.
 */
export function useViewportEvents(
  handlers: {
    onPan?: (offset: Position) => void;
    onZoom?: (zoom: number, center?: Position) => void;
    onResize?: (width: number, height: number) => void;
    onFit?: () => void;
  },
  deps: React.DependencyList = []
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useGraphEvent(
    "viewport:pan",
    useCallback((event) => handlersRef.current.onPan?.(event.offset), []),
    undefined,
    deps
  );

  useGraphEvent(
    "viewport:zoom",
    useCallback((event) => handlersRef.current.onZoom?.(event.zoom, event.center), []),
    undefined,
    deps
  );

  useGraphEvent(
    "viewport:resize",
    useCallback((event) => handlersRef.current.onResize?.(event.width, event.height), []),
    undefined,
    deps
  );

  useGraphEvent(
    "viewport:fit",
    useCallback(() => handlersRef.current.onFit?.(), []),
    undefined,
    deps
  );
}

/**
 * Hook for layout events.
 */
export function useLayoutEvents(
  handlers: {
    onStart?: (algorithm: string) => void;
    onTick?: (alpha: number, progress: number) => void;
    onEnd?: (algorithm: string, duration?: number) => void;
    onChange?: (algorithm: string, previousAlgorithm?: string) => void;
  },
  deps: React.DependencyList = []
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useGraphEvent(
    "layout:start",
    useCallback((event) => handlersRef.current.onStart?.(event.algorithm), []),
    undefined,
    deps
  );

  useGraphEvent(
    "layout:tick",
    useCallback((event) => handlersRef.current.onTick?.(event.alpha, event.progress), []),
    undefined,
    deps
  );

  useGraphEvent(
    "layout:end",
    useCallback((event) => handlersRef.current.onEnd?.(event.algorithm, event.duration), []),
    undefined,
    deps
  );

  useGraphEvent(
    "layout:change",
    useCallback(
      (event) => handlersRef.current.onChange?.(event.algorithm, event.previousAlgorithm),
      []
    ),
    undefined,
    deps
  );
}

/**
 * Hook for data loading events.
 */
export function useDataLoadingEvents(
  handlers: {
    onLoadStart?: (dataSource?: string) => void;
    onLoadEnd?: (nodeCount: number, edgeCount: number, duration?: number) => void;
    onLoadError?: (error: Error | string) => void;
  },
  deps: React.DependencyList = []
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useGraphEvent(
    "data:loadstart",
    useCallback((event) => handlersRef.current.onLoadStart?.(event.dataSource), []),
    undefined,
    deps
  );

  useGraphEvent(
    "data:loadend",
    useCallback(
      (event) => handlersRef.current.onLoadEnd?.(event.nodeCount, event.edgeCount, event.duration),
      []
    ),
    undefined,
    deps
  );

  useGraphEvent(
    "data:loaderror",
    useCallback((event) => handlersRef.current.onLoadError?.(event.error), []),
    undefined,
    deps
  );
}

/**
 * Hook for graph error events.
 */
export function useGraphError(
  handler: (error: Error | string, context?: string, recoverable?: boolean) => void,
  deps: React.DependencyList = []
): void {
  useGraphEvent(
    "error",
    useCallback((event) => handler(event.error, event.context, event.recoverable), deps),
    undefined,
    deps
  );
}

// ============================================================
// Event Emitter Convenience Hooks
// ============================================================

/**
 * Hook that returns memoized event emitter functions.
 */
export function useGraphEventEmitters() {
  const emit = useGraphEventStore((s) => s.emit);

  return useMemo(
    () => ({
      // Node events
      emitNodeAdd: (node: GraphNode, source: EventSource = "user") =>
        emit({ type: "node:add", node, source }),

      emitNodeUpdate: (
        nodeId: string,
        changes: Partial<GraphNode>,
        previousValues?: Partial<GraphNode>,
        source: EventSource = "user"
      ) => emit({ type: "node:update", nodeId, changes, previousValues, source }),

      emitNodeRemove: (nodeId: string, node?: GraphNode, source: EventSource = "user") =>
        emit({ type: "node:remove", nodeId, node, source }),

      emitNodePosition: (
        nodeId: string,
        position: Position,
        previousPosition?: Position,
        source: EventSource = "layout"
      ) => emit({ type: "node:position", nodeId, position, previousPosition, source }),

      emitNodeSelect: (nodeId: string, selected: boolean, source: EventSource = "user") =>
        emit({ type: "node:select", nodeId, selected, source }),

      emitNodeHover: (nodeId: string | null, source: EventSource = "user") =>
        emit({ type: "node:hover", nodeId, source }),

      emitNodeClick: (
        nodeId: string,
        position: Position,
        modifiers: EventModifiers,
        source: EventSource = "user"
      ) => emit({ type: "node:click", nodeId, position, modifiers, source }),

      emitNodeDoubleClick: (
        nodeId: string,
        position: Position,
        modifiers: EventModifiers,
        source: EventSource = "user"
      ) => emit({ type: "node:dblclick", nodeId, position, modifiers, source }),

      emitNodeContextMenu: (nodeId: string, position: Position, source: EventSource = "user") =>
        emit({ type: "node:contextmenu", nodeId, position, source }),

      emitNodeDragStart: (nodeId: string, position: Position, source: EventSource = "user") =>
        emit({ type: "node:dragstart", nodeId, position, source }),

      emitNodeDrag: (nodeId: string, position: Position, source: EventSource = "user") =>
        emit({ type: "node:drag", nodeId, position, source }),

      emitNodeDragEnd: (
        nodeId: string,
        position: Position,
        startPosition?: Position,
        source: EventSource = "user"
      ) => emit({ type: "node:dragend", nodeId, position, startPosition, source }),

      // Edge events
      emitEdgeAdd: (edge: GraphEdge, source: EventSource = "user") =>
        emit({ type: "edge:add", edge, source }),

      emitEdgeUpdate: (
        edgeId: string,
        changes: Partial<GraphEdge>,
        previousValues?: Partial<GraphEdge>,
        source: EventSource = "user"
      ) => emit({ type: "edge:update", edgeId, changes, previousValues, source }),

      emitEdgeRemove: (edgeId: string, edge?: GraphEdge, source: EventSource = "user") =>
        emit({ type: "edge:remove", edgeId, edge, source }),

      emitEdgeSelect: (edgeId: string, selected: boolean, source: EventSource = "user") =>
        emit({ type: "edge:select", edgeId, selected, source }),

      emitEdgeHover: (edgeId: string | null, source: EventSource = "user") =>
        emit({ type: "edge:hover", edgeId, source }),

      emitEdgeClick: (
        edgeId: string,
        position: Position,
        modifiers: EventModifiers,
        source: EventSource = "user"
      ) => emit({ type: "edge:click", edgeId, position, modifiers, source }),

      // Viewport events
      emitViewportPan: (
        offset: Position,
        previousOffset?: Position,
        source: EventSource = "user"
      ) => emit({ type: "viewport:pan", offset, previousOffset, source }),

      emitViewportZoom: (
        zoom: number,
        center?: Position,
        previousZoom?: number,
        source: EventSource = "user"
      ) => emit({ type: "viewport:zoom", zoom, center, previousZoom, source }),

      emitViewportResize: (
        width: number,
        height: number,
        previousWidth?: number,
        previousHeight?: number,
        source: EventSource = "user"
      ) => emit({ type: "viewport:resize", width, height, previousWidth, previousHeight, source }),

      emitViewportFit: (
        bounds?: { minX: number; minY: number; maxX: number; maxY: number },
        source: EventSource = "user"
      ) => emit({ type: "viewport:fit", bounds, source }),

      // Layout events
      emitLayoutStart: (algorithm: string, source: EventSource = "layout") =>
        emit({ type: "layout:start", algorithm, source }),

      emitLayoutTick: (alpha: number, progress: number, source: EventSource = "layout") =>
        emit({ type: "layout:tick", alpha, progress, source }),

      emitLayoutEnd: (algorithm: string, duration?: number, source: EventSource = "layout") =>
        emit({ type: "layout:end", algorithm, duration, source }),

      emitLayoutChange: (
        algorithm: string,
        previousAlgorithm?: string,
        source: EventSource = "user"
      ) => emit({ type: "layout:change", algorithm, previousAlgorithm, source }),

      // Selection events
      emitSelectionChange: (
        nodeIds: string[],
        edgeIds: string[],
        previousNodeIds?: string[],
        previousEdgeIds?: string[],
        source: EventSource = "user"
      ) =>
        emit({
          type: "selection:change",
          nodeIds,
          edgeIds,
          previousNodeIds,
          previousEdgeIds,
          source,
        }),

      emitSelectionClear: (
        previousNodeIds?: string[],
        previousEdgeIds?: string[],
        source: EventSource = "user"
      ) => emit({ type: "selection:clear", previousNodeIds, previousEdgeIds, source }),

      // Data events
      emitDataLoadStart: (dataSource?: string, source: EventSource = "external") =>
        emit({ type: "data:loadstart", dataSource, source }),

      emitDataLoadEnd: (
        nodeCount: number,
        edgeCount: number,
        duration?: number,
        source: EventSource = "external"
      ) => emit({ type: "data:loadend", nodeCount, edgeCount, duration, source }),

      emitDataLoadError: (error: Error | string, source: EventSource = "external") =>
        emit({ type: "data:loaderror", error, source }),

      // Error events
      emitError: (
        error: Error | string,
        context?: string,
        recoverable = true,
        source: EventSource = "store"
      ) => emit({ type: "error", error, context, recoverable, source }),
    }),
    [emit]
  );
}

// ============================================================
// Debug/History Hooks
// ============================================================

/**
 * Hook to access event history state.
 */
export function useEventHistory() {
  return useGraphEventStore((s) => s.eventHistory);
}

/**
 * Hook to get recent events of a specific type.
 */
export function useRecentEvents<T extends GraphEventType>(
  type: T,
  count = 10
): Array<Extract<GraphEvent, { type: T }>> {
  const getRecentEvents = useGraphEventStore((s) => s.getRecentEvents);
  return getRecentEvents(type, count);
}

/**
 * Hook to control debug mode.
 */
export function useEventDebugMode(): [boolean, (enabled: boolean) => void] {
  const debugMode = useGraphEventStore((s) => s.debugMode);
  const setDebugMode = useGraphEventStore((s) => s.setDebugMode);
  return [debugMode, setDebugMode];
}

/**
 * Hook to control event history.
 */
export function useEventHistoryEnabled(): [boolean, (enabled: boolean) => void] {
  const historyEnabled = useGraphEventStore((s) => s.historyEnabled);
  const setHistoryEnabled = useGraphEventStore((s) => s.setHistoryEnabled);
  return [historyEnabled, setHistoryEnabled];
}

/**
 * Hook to access batching functions.
 */
export function useEventBatch() {
  const startBatch = useGraphEventStore((s) => s.startBatch);
  const endBatch = useGraphEventStore((s) => s.endBatch);
  const isBatching = useGraphEventStore((s) => s.isBatching);

  return {
    startBatch,
    endBatch,
    isBatching,
    batch: useCallback(
      (fn: () => void) => {
        startBatch();
        try {
          fn();
        } finally {
          endBatch();
        }
      },
      [startBatch, endBatch]
    ),
  };
}
