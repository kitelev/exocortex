/**
 * Type definitions for Web Worker physics simulation.
 * Provides complete type system for off-thread physics computation
 * with SharedArrayBuffer for zero-copy data transfer.
 */

/**
 * SharedArrayBuffer memory layout for node positions and velocities.
 *
 * Layout per node (32 bytes):
 * - x: Float32 (4 bytes) - position X
 * - y: Float32 (4 bytes) - position Y
 * - vx: Float32 (4 bytes) - velocity X
 * - vy: Float32 (4 bytes) - velocity Y
 * - fx: Float32 (4 bytes) - fixed X (NaN if not fixed)
 * - fy: Float32 (4 bytes) - fixed Y (NaN if not fixed)
 * - radius: Float32 (4 bytes) - node radius for collision
 * - mass: Float32 (4 bytes) - node mass for force calculation
 */
export const BYTES_PER_NODE = 32;
export const FLOATS_PER_NODE = 8;

/**
 * Offsets within node data (in Float32 indices)
 */
export const NODE_OFFSET = {
  X: 0,
  Y: 1,
  VX: 2,
  VY: 3,
  FX: 4,
  FY: 5,
  RADIUS: 6,
  MASS: 7,
} as const;

/**
 * Simulation state communicated via SharedArrayBuffer
 *
 * Layout (16 bytes):
 * - alpha: Float32 - current simulation energy
 * - alphaTarget: Float32 - target alpha
 * - alphaMin: Float32 - minimum alpha before stopping
 * - running: Float32 - 1.0 if running, 0.0 if stopped
 */
export const STATE_BUFFER_SIZE = 16;
export const STATE_OFFSET = {
  ALPHA: 0,
  ALPHA_TARGET: 1,
  ALPHA_MIN: 2,
  RUNNING: 3,
} as const;

/**
 * Edge data structure for link forces
 */
export interface PhysicsEdge {
  /** Source node index */
  source: number;
  /** Target node index */
  target: number;
  /** Target distance */
  distance: number;
  /** Spring strength */
  strength: number;
}

/**
 * Physics configuration for the simulation
 */
export interface PhysicsWorkerConfig {
  /** Simulation parameters */
  simulation: {
    alphaMin: number;
    alphaDecay: number;
    alphaTarget: number;
    velocityDecay: number;
  };
  /** Center force */
  center: {
    enabled: boolean;
    strength: number;
    x: number;
    y: number;
  };
  /** Link force */
  link: {
    enabled: boolean;
    iterations: number;
  };
  /** Many-body/charge force */
  charge: {
    enabled: boolean;
    strength: number;
    distanceMin: number;
    distanceMax: number;
    theta: number;
  };
  /** Collision force */
  collision: {
    enabled: boolean;
    strength: number;
    iterations: number;
  };
  /** Radial force */
  radial: {
    enabled: boolean;
    strength: number;
    radius: number;
    x: number;
    y: number;
  };
}

// ============================================================
// Worker Messages
// ============================================================

/**
 * Message from main thread to worker: Initialize simulation
 */
export interface WorkerInitMessage {
  type: "init";
  /** SharedArrayBuffer for node positions/velocities */
  nodeBuffer: SharedArrayBuffer;
  /** SharedArrayBuffer for simulation state */
  stateBuffer: SharedArrayBuffer;
  /** Number of nodes */
  nodeCount: number;
  /** Edge data for link forces */
  edges: PhysicsEdge[];
  /** Physics configuration */
  config: PhysicsWorkerConfig;
}

/**
 * Message from main thread to worker: Start simulation
 */
export interface WorkerStartMessage {
  type: "start";
  /** Initial alpha (default 1.0) */
  alpha?: number;
}

/**
 * Message from main thread to worker: Stop simulation
 */
export interface WorkerStopMessage {
  type: "stop";
}

/**
 * Message from main thread to worker: Update configuration
 */
export interface WorkerConfigMessage {
  type: "config";
  config: Partial<PhysicsWorkerConfig>;
}

/**
 * Message from main thread to worker: Update edges
 */
export interface WorkerEdgesMessage {
  type: "edges";
  edges: PhysicsEdge[];
}

/**
 * Message from main thread to worker: Resize node buffer
 */
export interface WorkerResizeMessage {
  type: "resize";
  nodeBuffer: SharedArrayBuffer;
  nodeCount: number;
}

/**
 * Message from main thread to worker: Fix node position
 */
export interface WorkerFixNodeMessage {
  type: "fixNode";
  nodeIndex: number;
  x: number;
  y: number;
}

/**
 * Message from main thread to worker: Unfix node position
 */
export interface WorkerUnfixNodeMessage {
  type: "unfixNode";
  nodeIndex: number;
}

/**
 * Message from main thread to worker: Reheat simulation
 */
export interface WorkerReheatMessage {
  type: "reheat";
  alpha: number;
}

/**
 * Message from main thread to worker: Terminate
 */
export interface WorkerTerminateMessage {
  type: "terminate";
}

/**
 * Union of all messages to worker
 */
export type WorkerInMessage =
  | WorkerInitMessage
  | WorkerStartMessage
  | WorkerStopMessage
  | WorkerConfigMessage
  | WorkerEdgesMessage
  | WorkerResizeMessage
  | WorkerFixNodeMessage
  | WorkerUnfixNodeMessage
  | WorkerReheatMessage
  | WorkerTerminateMessage;

// ============================================================
// Worker Responses
// ============================================================

/**
 * Message from worker: Initialization complete
 */
export interface WorkerReadyResponse {
  type: "ready";
}

/**
 * Message from worker: Simulation tick completed
 */
export interface WorkerTickResponse {
  type: "tick";
  /** Current alpha value */
  alpha: number;
  /** Tick computation time in ms */
  computeTime: number;
}

/**
 * Message from worker: Simulation ended (alpha below minimum)
 */
export interface WorkerEndResponse {
  type: "end";
  /** Total ticks computed */
  totalTicks: number;
  /** Total computation time in ms */
  totalTime: number;
}

/**
 * Message from worker: Error occurred
 */
export interface WorkerErrorResponse {
  type: "error";
  message: string;
  stack?: string;
}

/**
 * Union of all messages from worker
 */
export type WorkerOutMessage =
  | WorkerReadyResponse
  | WorkerTickResponse
  | WorkerEndResponse
  | WorkerErrorResponse;

// ============================================================
// Physics Controller Types
// ============================================================

/**
 * Status of the physics simulation
 */
export type PhysicsStatus = "idle" | "initializing" | "running" | "stopped" | "error";

/**
 * Node data for initialization
 */
export interface PhysicsNode {
  /** Node ID for mapping */
  id: string;
  /** Initial X position */
  x: number;
  /** Initial Y position */
  y: number;
  /** Initial X velocity */
  vx?: number;
  /** Initial Y velocity */
  vy?: number;
  /** Fixed X position (undefined if not fixed) */
  fx?: number;
  /** Fixed Y position (undefined if not fixed) */
  fy?: number;
  /** Node radius */
  radius?: number;
  /** Node mass */
  mass?: number;
}

/**
 * Edge data for initialization
 */
export interface PhysicsEdgeInput {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Target distance */
  distance?: number;
  /** Spring strength */
  strength?: number;
}

/**
 * Physics Controller configuration
 */
export interface PhysicsControllerConfig {
  /** Physics simulation configuration */
  physics: PhysicsWorkerConfig;
  /** Worker URL or Blob URL */
  workerUrl?: string;
  /** Use inline worker (default true) */
  useInlineWorker?: boolean;
  /** Callback when tick completes */
  onTick?: (alpha: number, computeTime: number) => void;
  /** Callback when simulation ends */
  onEnd?: (totalTicks: number, totalTime: number) => void;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
  /** Callback when status changes */
  onStatusChange?: (status: PhysicsStatus) => void;
}

// ============================================================
// Store Types
// ============================================================

/**
 * Physics worker store state
 */
export interface PhysicsWorkerState {
  /** Current simulation status */
  status: PhysicsStatus;
  /** Current alpha value */
  alpha: number;
  /** Whether SharedArrayBuffer is supported */
  isSupported: boolean;
  /** Current node count */
  nodeCount: number;
  /** Current edge count */
  edgeCount: number;
  /** Performance metrics */
  metrics: {
    /** Last tick computation time in ms */
    lastTickTime: number;
    /** Average tick time in ms */
    avgTickTime: number;
    /** Total ticks since last start */
    totalTicks: number;
    /** Total computation time in ms */
    totalTime: number;
  };
  /** Error message if status is "error" */
  error: string | null;
}

/**
 * Physics worker store actions
 */
export interface PhysicsWorkerActions {
  /** Initialize physics simulation with nodes and edges */
  initialize: (
    nodes: PhysicsNode[],
    edges: PhysicsEdgeInput[],
    config?: Partial<PhysicsWorkerConfig>
  ) => void;
  /** Start the simulation */
  start: (alpha?: number) => void;
  /** Stop the simulation */
  stop: () => void;
  /** Reheat the simulation */
  reheat: (alpha?: number) => void;
  /** Update physics configuration */
  updateConfig: (config: Partial<PhysicsWorkerConfig>) => void;
  /** Update edges */
  updateEdges: (edges: PhysicsEdgeInput[]) => void;
  /** Fix a node at a position */
  fixNode: (nodeId: string, x: number, y: number) => void;
  /** Unfix a node */
  unfixNode: (nodeId: string) => void;
  /** Get current node positions */
  getNodePositions: () => Map<string, { x: number; y: number }>;
  /** Get current node velocities */
  getNodeVelocities: () => Map<string, { vx: number; vy: number }>;
  /** Update node position (for drag) */
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  /** Cleanup and terminate worker */
  cleanup: () => void;
  /** Reset store state */
  reset: () => void;
}

/**
 * Complete physics worker store type
 */
export type PhysicsWorkerStore = PhysicsWorkerState & PhysicsWorkerActions;
