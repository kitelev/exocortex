/**
 * Zustand store for physics worker state management.
 * Provides reactive state for Web Worker physics simulation.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import type {
  PhysicsWorkerStore,
  PhysicsWorkerState,
  PhysicsNode,
  PhysicsEdgeInput,
  PhysicsWorkerConfig,
  PhysicsStatus,
} from "./types";

import { PhysicsController, isSharedArrayBufferSupported, DEFAULT_PHYSICS_CONFIG } from "./PhysicsController";

/**
 * Singleton controller instance
 */
let controller: PhysicsController | null = null;

/**
 * Get or create the physics controller
 */
function getController(): PhysicsController {
  if (!controller) {
    controller = new PhysicsController({
      physics: DEFAULT_PHYSICS_CONFIG,
      onTick: (alpha, computeTime) => {
        usePhysicsWorkerStore.getState().handleTick(alpha, computeTime);
      },
      onEnd: (totalTicks, totalTime) => {
        usePhysicsWorkerStore.getState().handleEnd(totalTicks, totalTime);
      },
      onError: (error) => {
        usePhysicsWorkerStore.getState().handleError(error);
      },
      onStatusChange: (status) => {
        usePhysicsWorkerStore.getState().handleStatusChange(status);
      },
    });
  }
  return controller;
}

/**
 * Default initial state
 */
const DEFAULT_STATE: PhysicsWorkerState = {
  status: "idle",
  alpha: 0,
  isSupported: isSharedArrayBufferSupported(),
  nodeCount: 0,
  edgeCount: 0,
  metrics: {
    lastTickTime: 0,
    avgTickTime: 0,
    totalTicks: 0,
    totalTime: 0,
  },
  error: null,
};

/**
 * Internal actions for controller callbacks
 */
interface InternalActions {
  handleTick: (alpha: number, computeTime: number) => void;
  handleEnd: (totalTicks: number, totalTime: number) => void;
  handleError: (error: Error) => void;
  handleStatusChange: (status: PhysicsStatus) => void;
}

/**
 * Physics worker store
 */
export const usePhysicsWorkerStore = create<PhysicsWorkerStore & InternalActions>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    ...DEFAULT_STATE,

    // ============================================================
    // Public Actions
    // ============================================================

    initialize: (
      nodes: PhysicsNode[],
      edges: PhysicsEdgeInput[],
      config?: Partial<PhysicsWorkerConfig>
    ) => {
      const ctrl = getController();

      // Calculate center from viewport (if available from graph store)
      const centerX = 400; // Default center X
      const centerY = 300; // Default center Y

      ctrl.initialize(nodes, edges, centerX, centerY).then(() => {
        set({
          nodeCount: nodes.length,
          edgeCount: edges.length,
          error: null,
        });

        if (config) {
          ctrl.updateConfig(config);
        }
      });
    },

    start: (alpha?: number) => {
      const ctrl = getController();
      ctrl.start(alpha);
    },

    stop: () => {
      const ctrl = getController();
      ctrl.stop();
    },

    reheat: (alpha = 0.3) => {
      const ctrl = getController();
      ctrl.reheat(alpha);
    },

    updateConfig: (config: Partial<PhysicsWorkerConfig>) => {
      const ctrl = getController();
      ctrl.updateConfig(config);
    },

    updateEdges: (edges: PhysicsEdgeInput[]) => {
      const ctrl = getController();
      ctrl.updateEdges(edges);
      set({ edgeCount: edges.length });
    },

    fixNode: (nodeId: string, x: number, y: number) => {
      const ctrl = getController();
      ctrl.fixNode(nodeId, x, y);
    },

    unfixNode: (nodeId: string) => {
      const ctrl = getController();
      ctrl.unfixNode(nodeId);
    },

    getNodePositions: () => {
      const ctrl = getController();
      return ctrl.getNodePositions();
    },

    getNodeVelocities: () => {
      const ctrl = getController();
      return ctrl.getNodeVelocities();
    },

    updateNodePosition: (nodeId: string, x: number, y: number) => {
      const ctrl = getController();
      ctrl.updateNodePosition(nodeId, x, y);
    },

    cleanup: () => {
      const ctrl = getController();
      ctrl.cleanup();
      set({
        status: "idle",
        alpha: 0,
        nodeCount: 0,
        edgeCount: 0,
        metrics: {
          lastTickTime: 0,
          avgTickTime: 0,
          totalTicks: 0,
          totalTime: 0,
        },
        error: null,
      });
    },

    reset: () => {
      get().cleanup();
      set(DEFAULT_STATE);
    },

    // ============================================================
    // Internal Actions (for controller callbacks)
    // ============================================================

    handleTick: (alpha: number, computeTime: number) => {
      set((state) => {
        const newTotalTicks = state.metrics.totalTicks + 1;
        const newAvgTickTime =
          (state.metrics.avgTickTime * state.metrics.totalTicks + computeTime) / newTotalTicks;

        return {
          alpha,
          metrics: {
            ...state.metrics,
            lastTickTime: computeTime,
            avgTickTime: newAvgTickTime,
            totalTicks: newTotalTicks,
          },
        };
      });
    },

    handleEnd: (totalTicks: number, totalTime: number) => {
      set((state) => ({
        status: "stopped",
        alpha: 0,
        metrics: {
          ...state.metrics,
          totalTicks,
          totalTime,
        },
      }));
    },

    handleError: (error: Error) => {
      set({
        status: "error",
        error: error.message,
      });
    },

    handleStatusChange: (status: PhysicsStatus) => {
      set({ status });
    },
  }))
);

/**
 * Get default state for testing
 */
export const getDefaultState = (): PhysicsWorkerState => ({
  ...DEFAULT_STATE,
});

/**
 * Reset controller (for testing)
 */
export const resetController = (): void => {
  if (controller) {
    controller.cleanup();
    controller = null;
  }
};

/**
 * Get controller instance (for advanced usage)
 */
export const getPhysicsController = (): PhysicsController => {
  return getController();
};
