/**
 * React hooks for physics worker integration.
 * Provides convenient access to physics worker store state and actions.
 */

import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { usePhysicsWorkerStore, getPhysicsController } from "./store";
import type {
  PhysicsNode,
  PhysicsEdgeInput,
  PhysicsWorkerConfig,
  PhysicsStatus,
} from "./types";

// ============================================================
// Core Hooks
// ============================================================

/**
 * Hook to check if Web Worker physics is supported
 */
export function usePhysicsWorkerSupported(): boolean {
  return usePhysicsWorkerStore((state) => state.isSupported);
}

/**
 * Hook to get current physics simulation status
 */
export function usePhysicsStatus(): PhysicsStatus {
  return usePhysicsWorkerStore((state) => state.status);
}

/**
 * Hook to check if simulation is running
 */
export function usePhysicsRunning(): boolean {
  return usePhysicsWorkerStore((state) => state.status === "running");
}

/**
 * Hook to get current alpha value
 */
export function usePhysicsAlpha(): number {
  return usePhysicsWorkerStore((state) => state.alpha);
}

/**
 * Hook to get error message if any
 */
export function usePhysicsError(): string | null {
  return usePhysicsWorkerStore((state) => state.error);
}

// ============================================================
// Metrics Hooks
// ============================================================

/**
 * Hook to get physics metrics
 */
export function usePhysicsMetrics() {
  return usePhysicsWorkerStore(
    useShallow((state) => ({
      lastTickTime: state.metrics.lastTickTime,
      avgTickTime: state.metrics.avgTickTime,
      totalTicks: state.metrics.totalTicks,
      totalTime: state.metrics.totalTime,
      nodeCount: state.nodeCount,
      edgeCount: state.edgeCount,
    }))
  );
}

// ============================================================
// Action Hooks
// ============================================================

/**
 * Hook to get physics control actions
 */
export function usePhysicsActions() {
  const initialize = usePhysicsWorkerStore((state) => state.initialize);
  const start = usePhysicsWorkerStore((state) => state.start);
  const stop = usePhysicsWorkerStore((state) => state.stop);
  const reheat = usePhysicsWorkerStore((state) => state.reheat);
  const cleanup = usePhysicsWorkerStore((state) => state.cleanup);
  const reset = usePhysicsWorkerStore((state) => state.reset);

  return {
    initialize,
    start,
    stop,
    reheat,
    cleanup,
    reset,
  };
}

/**
 * Hook to get node interaction actions
 */
export function usePhysicsNodeActions() {
  const fixNode = usePhysicsWorkerStore((state) => state.fixNode);
  const unfixNode = usePhysicsWorkerStore((state) => state.unfixNode);
  const updateNodePosition = usePhysicsWorkerStore((state) => state.updateNodePosition);

  return {
    fixNode,
    unfixNode,
    updateNodePosition,
  };
}

/**
 * Hook to get configuration update action
 */
export function usePhysicsConfigUpdate() {
  return usePhysicsWorkerStore((state) => state.updateConfig);
}

// ============================================================
// Position Hooks
// ============================================================

/**
 * Hook to get node positions from SharedArrayBuffer
 * Returns a function that can be called to get current positions
 */
export function useGetNodePositions() {
  return usePhysicsWorkerStore((state) => state.getNodePositions);
}

/**
 * Hook to get node velocities from SharedArrayBuffer
 * Returns a function that can be called to get current velocities
 */
export function useGetNodeVelocities() {
  return usePhysicsWorkerStore((state) => state.getNodeVelocities);
}

// ============================================================
// Effect Hooks
// ============================================================

/**
 * Hook to initialize physics simulation with graph data
 *
 * @param nodes - Array of physics nodes
 * @param edges - Array of physics edges
 * @param config - Optional physics configuration
 * @param autoStart - Whether to start simulation after initialization
 */
export function usePhysicsSimulation(
  nodes: PhysicsNode[],
  edges: PhysicsEdgeInput[],
  config?: Partial<PhysicsWorkerConfig>,
  autoStart = true
) {
  const initialize = usePhysicsWorkerStore((state) => state.initialize);
  const start = usePhysicsWorkerStore((state) => state.start);
  const cleanup = usePhysicsWorkerStore((state) => state.cleanup);
  const status = usePhysicsWorkerStore((state) => state.status);
  const isSupported = usePhysicsWorkerStore((state) => state.isSupported);

  const initializedRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  // Update refs when data changes
  nodesRef.current = nodes;
  edgesRef.current = edges;

  // Initialize on mount or when data changes significantly
  useEffect(() => {
    if (!isSupported || nodes.length === 0) return;

    // Check if we need to reinitialize
    const nodesChanged = nodes.length !== nodesRef.current.length ||
      nodes.some((n, i) => nodesRef.current[i]?.id !== n.id);
    const edgesChanged = edges.length !== edgesRef.current.length ||
      edges.some((e, i) =>
        edgesRef.current[i]?.source !== e.source ||
        edgesRef.current[i]?.target !== e.target
      );

    if (!initializedRef.current || nodesChanged || edgesChanged) {
      initialize(nodes, edges, config);
      initializedRef.current = true;

      if (autoStart) {
        // Small delay to ensure initialization completes
        const timer = setTimeout(() => {
          start();
        }, 50);
        return () => clearTimeout(timer);
      }
    }

    return undefined;
  }, [nodes, edges, config, autoStart, initialize, start, isSupported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      initializedRef.current = false;
    };
  }, [cleanup]);

  return {
    status,
    isSupported,
    isRunning: status === "running",
  };
}

/**
 * Hook for node dragging with physics integration
 *
 * @param nodeId - ID of the node being dragged
 * @returns Drag handlers
 */
export function usePhysicsNodeDrag(nodeId: string) {
  const fixNode = usePhysicsWorkerStore((state) => state.fixNode);
  const unfixNode = usePhysicsWorkerStore((state) => state.unfixNode);
  const updateNodePosition = usePhysicsWorkerStore((state) => state.updateNodePosition);
  const reheat = usePhysicsWorkerStore((state) => state.reheat);

  const isDraggingRef = useRef(false);

  const onDragStart = useCallback(
    (x: number, y: number) => {
      isDraggingRef.current = true;
      fixNode(nodeId, x, y);
    },
    [nodeId, fixNode]
  );

  const onDrag = useCallback(
    (x: number, y: number) => {
      if (!isDraggingRef.current) return;
      updateNodePosition(nodeId, x, y);
      fixNode(nodeId, x, y);
    },
    [nodeId, updateNodePosition, fixNode]
  );

  const onDragEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    unfixNode(nodeId);
    // Reheat slightly to let the node settle
    reheat(0.1);
  }, [nodeId, unfixNode, reheat]);

  return {
    onDragStart,
    onDrag,
    onDragEnd,
  };
}

/**
 * Hook to subscribe to physics ticks for rendering
 *
 * @param callback - Function called on each tick with node positions
 * @param throttleMs - Optional throttle interval in ms (default 16 = ~60fps)
 */
export function usePhysicsTick(
  callback: (positions: Map<string, { x: number; y: number }>) => void,
  throttleMs = 16
) {
  const getNodePositions = usePhysicsWorkerStore((state) => state.getNodePositions);
  const status = usePhysicsWorkerStore((state) => state.status);

  const lastCallRef = useRef(0);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (status !== "running") return;

    let animationFrameId: number;

    const tick = () => {
      const now = performance.now();
      if (now - lastCallRef.current >= throttleMs) {
        const positions = getNodePositions();
        callbackRef.current(positions);
        lastCallRef.current = now;
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [status, getNodePositions, throttleMs]);
}

/**
 * Hook to get all physics worker state
 */
export function usePhysicsWorkerState() {
  return usePhysicsWorkerStore(
    useShallow((state) => ({
      status: state.status,
      alpha: state.alpha,
      isSupported: state.isSupported,
      nodeCount: state.nodeCount,
      edgeCount: state.edgeCount,
      metrics: state.metrics,
      error: state.error,
    }))
  );
}

/**
 * Hook to get direct access to the physics controller (for advanced usage)
 */
export function usePhysicsController() {
  return getPhysicsController();
}
