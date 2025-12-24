/**
 * Type definitions for the WebAssembly Physics Engine
 *
 * @module physics-wasm
 */

/**
 * Physics simulation parameters
 */
export interface PhysicsParams {
  /** Simulation alpha (0-1, controls force strength) */
  alpha?: number;

  /** Alpha decay rate (default: 0.0228) */
  alphaDecay?: number;

  /** Velocity decay / friction (default: 0.4) */
  velocityDecay?: number;

  /** Center force strength (default: 0.1) */
  centerStrength?: number;

  /** Center X position */
  centerX?: number;

  /** Center Y position */
  centerY?: number;

  /** Charge/repulsion strength - negative for repulsion (default: -300) */
  chargeStrength?: number;

  /** Barnes-Hut theta approximation (default: 0.9) */
  chargeTheta?: number;

  /** Minimum charge distance (default: 1) */
  chargeDistanceMin?: number;

  /** Maximum charge distance (default: 10000) */
  chargeDistanceMax?: number;

  /** Link spring strength (default: 1) */
  linkStrength?: number;

  /** Target link distance (default: 100) */
  linkDistance?: number;

  /** Collision radius (default: 8) */
  collisionRadius?: number;

  /** Collision strength (default: 0.7) */
  collisionStrength?: number;
}

/**
 * Default physics parameters
 */
export const DEFAULT_PHYSICS_PARAMS: Required<PhysicsParams> = {
  alpha: 1.0,
  alphaDecay: 0.0228,
  velocityDecay: 0.4,
  centerStrength: 0.1,
  centerX: 0,
  centerY: 0,
  chargeStrength: -300,
  chargeTheta: 0.9,
  chargeDistanceMin: 1,
  chargeDistanceMax: 10000,
  linkStrength: 1,
  linkDistance: 100,
  collisionRadius: 8,
  collisionStrength: 0.7,
};

/**
 * Node data for physics simulation
 */
export interface PhysicsNode {
  /** Node index */
  index: number;

  /** X position */
  x: number;

  /** Y position */
  y: number;

  /** X velocity */
  vx?: number;

  /** Y velocity */
  vy?: number;

  /** Fixed X position (null if not fixed) */
  fx?: number | null;

  /** Fixed Y position (null if not fixed) */
  fy?: number | null;

  /** Node mass (default: 1) */
  mass?: number;

  /** Node radius for collision (default: collisionRadius param) */
  radius?: number;
}

/**
 * Edge data for physics simulation
 */
export interface PhysicsEdge {
  /** Source node index */
  source: number;

  /** Target node index */
  target: number;

  /** Link strength multiplier (default: 1) */
  strength?: number;
}

/**
 * Bounding box
 */
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * WASM module exports interface
 */
export interface PhysicsWasmExports {
  memory: WebAssembly.Memory;

  init(nodeCount: number, edgeCount: number): void;

  setParams(
    alpha: number,
    alphaDecay: number,
    velocityDecay: number,
    centerStrength: number,
    centerX: number,
    centerY: number,
    chargeStrength: number,
    chargeTheta: number,
    chargeDistanceMin: number,
    chargeDistanceMax: number,
    linkStrength: number,
    linkDistance: number,
    collisionRadius: number,
    collisionStrength: number
  ): void;

  setNodePosition(index: number, x: number, y: number): void;
  setNodeVelocity(index: number, vx: number, vy: number): void;
  setNodeMass(index: number, mass: number): void;
  setNodeRadius(index: number, radius: number): void;
  setNodeFixed(index: number, fx: number, fy: number): void;
  clearNodeFixed(index: number): void;

  getNodeX(index: number): number;
  getNodeY(index: number): number;
  getNodeVX(index: number): number;
  getNodeVY(index: number): number;

  setEdge(index: number, source: number, target: number, strength: number): void;

  tick(iterations: number): number;

  getNodeDataPtr(): number;
  getEdgeDataPtr(): number;
  getAlpha(): number;
  setAlpha(alpha: number): void;
  getNodeCount(): number;
  getEdgeCount(): number;

  findNodeAt(x: number, y: number, radius: number): number;
  getBoundingBox(): Float32Array;
}

/**
 * Physics engine interface
 */
export interface PhysicsEngine {
  /**
   * Initialize the simulation with nodes and edges.
   */
  initialize(nodes: PhysicsNode[], edges: PhysicsEdge[]): void;

  /**
   * Set simulation parameters.
   */
  setParams(params: Partial<PhysicsParams>): void;

  /**
   * Run simulation tick(s).
   * @param iterations - Number of iterations to run (default: 1)
   * @returns Current alpha value
   */
  tick(iterations?: number): number;

  /**
   * Get all node positions.
   */
  getPositions(): Array<{ x: number; y: number; vx: number; vy: number }>;

  /**
   * Get position of a specific node.
   */
  getNodePosition(index: number): { x: number; y: number; vx: number; vy: number };

  /**
   * Set position of a specific node.
   */
  setNodePosition(index: number, x: number, y: number): void;

  /**
   * Fix a node at a specific position.
   */
  fixNode(index: number, x: number, y: number): void;

  /**
   * Unfix a node.
   */
  unfixNode(index: number): void;

  /**
   * Get current alpha value.
   */
  getAlpha(): number;

  /**
   * Set alpha value.
   */
  setAlpha(alpha: number): void;

  /**
   * Reheat the simulation.
   */
  reheat(alpha?: number): void;

  /**
   * Find node at position.
   * @returns Node index or -1 if not found
   */
  findNodeAt(x: number, y: number, radius?: number): number;

  /**
   * Get bounding box of all nodes.
   */
  getBoundingBox(): BoundingBox;

  /**
   * Check if simulation is still active.
   */
  isActive(): boolean;

  /**
   * Stop the simulation.
   */
  stop(): void;

  /**
   * Get node count.
   */
  getNodeCount(): number;

  /**
   * Get edge count.
   */
  getEdgeCount(): number;

  /**
   * Check if WASM is supported and loaded.
   */
  isWasmReady(): boolean;
}
