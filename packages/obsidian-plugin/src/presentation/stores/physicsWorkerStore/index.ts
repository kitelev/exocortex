/**
 * Physics Worker Store - Web Worker integration for off-thread physics simulation.
 *
 * Architecture:
 * - PhysicsController manages Web Worker lifecycle and SharedArrayBuffer
 * - Store provides reactive state via Zustand
 * - Hooks provide convenient React integration
 *
 * Key Features:
 * - Zero-copy data transfer via SharedArrayBuffer
 * - Force calculations run entirely off main thread
 * - Real-time position updates without message passing overhead
 * - Barnes-Hut algorithm for O(n log n) many-body force
 */

// Store exports
export {
  usePhysicsWorkerStore,
  getDefaultState,
  resetController,
  getPhysicsController,
} from "./store";

// Controller exports
export {
  PhysicsController,
  isSharedArrayBufferSupported,
  DEFAULT_PHYSICS_CONFIG,
} from "./PhysicsController";

// Hook exports
export {
  // Core hooks
  usePhysicsWorkerSupported,
  usePhysicsStatus,
  usePhysicsRunning,
  usePhysicsAlpha,
  usePhysicsError,
  // Metrics hooks
  usePhysicsMetrics,
  // Action hooks
  usePhysicsActions,
  usePhysicsNodeActions,
  usePhysicsConfigUpdate,
  // Position hooks
  useGetNodePositions,
  useGetNodeVelocities,
  // Effect hooks
  usePhysicsSimulation,
  usePhysicsNodeDrag,
  usePhysicsTick,
  // State hooks
  usePhysicsWorkerState,
  usePhysicsController,
} from "./hooks";

// Type exports
export type {
  // SharedArrayBuffer layout
  PhysicsEdge,
  PhysicsWorkerConfig,
  // Controller types
  PhysicsNode,
  PhysicsEdgeInput,
  PhysicsControllerConfig,
  PhysicsStatus,
  // Store types
  PhysicsWorkerState,
  PhysicsWorkerActions,
  PhysicsWorkerStore,
  // Worker message types
  WorkerInMessage,
  WorkerOutMessage,
  WorkerInitMessage,
  WorkerStartMessage,
  WorkerStopMessage,
  WorkerConfigMessage,
  WorkerEdgesMessage,
  WorkerResizeMessage,
  WorkerFixNodeMessage,
  WorkerUnfixNodeMessage,
  WorkerReheatMessage,
  WorkerTerminateMessage,
  WorkerReadyResponse,
  WorkerTickResponse,
  WorkerEndResponse,
  WorkerErrorResponse,
} from "./types";

// Constants
export {
  BYTES_PER_NODE,
  FLOATS_PER_NODE,
  NODE_OFFSET,
  STATE_BUFFER_SIZE,
  STATE_OFFSET,
} from "./types";
