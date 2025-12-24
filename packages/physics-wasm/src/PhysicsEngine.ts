/**
 * PhysicsEngine - High-performance WebAssembly physics simulation
 *
 * This class provides a TypeScript wrapper around the WebAssembly physics module,
 * with automatic fallback to a JavaScript implementation if WASM is not available.
 *
 * @module physics-wasm
 */

import type {
  PhysicsEngine as IPhysicsEngine,
  PhysicsNode,
  PhysicsEdge,
  PhysicsParams,
  BoundingBox,
  PhysicsWasmExports,
} from "./types";
import { DEFAULT_PHYSICS_PARAMS } from "./types";

/** Node data stride in Float32 values */
const NODE_STRIDE = 8;

/**
 * WebAssembly-accelerated physics engine for force-directed graph simulation.
 *
 * Features:
 * - Barnes-Hut algorithm for O(N log N) charge forces
 * - Linear memory layout for cache efficiency
 * - Automatic JS fallback if WASM unavailable
 *
 * @example
 * ```typescript
 * const engine = new PhysicsEngine();
 * await engine.loadWasm();
 *
 * engine.initialize(nodes, edges);
 * engine.setParams({ chargeStrength: -500 });
 *
 * while (engine.isActive()) {
 *   engine.tick();
 *   render(engine.getPositions());
 * }
 * ```
 */
export class PhysicsEngine implements IPhysicsEngine {
  private wasm: PhysicsWasmExports | null = null;
  private wasmMemory: WebAssembly.Memory | null = null;
  private nodeCount = 0;
  private edgeCount = 0;
  private params: Required<PhysicsParams> = { ...DEFAULT_PHYSICS_PARAMS };

  // JavaScript fallback data
  private jsNodes: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    fx: number | null;
    fy: number | null;
    mass: number;
    radius: number;
  }> = [];
  private jsEdges: Array<{
    source: number;
    target: number;
    strength: number;
  }> = [];
  private jsAlpha = 1.0;

  /**
   * Create a new PhysicsEngine instance.
   */
  constructor() {
    // Engine is created without WASM - call loadWasm() to enable
  }

  /**
   * Load the WebAssembly module.
   *
   * @param wasmUrl - URL or path to the WASM file
   * @returns Promise that resolves when WASM is loaded
   */
  async loadWasm(wasmUrl: string): Promise<boolean> {
    try {
      if (!wasmUrl) {
        console.warn("WASM URL is required");
        return false;
      }
      const response = await fetch(wasmUrl);
      const buffer = await response.arrayBuffer();

      const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024 });

      const result = await WebAssembly.instantiate(buffer, {
        env: {
          memory,
          abort: (msg: number, file: number, line: number, col: number) => {
            console.error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
          },
        },
      });

      this.wasm = result.instance.exports as unknown as PhysicsWasmExports;
      this.wasmMemory = memory;

      return true;
    } catch (error) {
      console.warn("Failed to load WASM physics module, using JS fallback:", error);
      this.wasm = null;
      this.wasmMemory = null;
      return false;
    }
  }

  /**
   * Check if WASM is loaded and ready.
   */
  isWasmReady(): boolean {
    return this.wasm !== null;
  }

  /**
   * Initialize the simulation with nodes and edges.
   */
  initialize(nodes: PhysicsNode[], edges: PhysicsEdge[]): void {
    this.nodeCount = nodes.length;
    this.edgeCount = edges.length;

    if (this.wasm) {
      this.initializeWasm(nodes, edges);
    } else {
      this.initializeJS(nodes, edges);
    }

    // Apply current params
    this.setParams(this.params);
  }

  private initializeWasm(nodes: PhysicsNode[], edges: PhysicsEdge[]): void {
    if (!this.wasm) return;

    this.wasm.init(nodes.length, edges.length);

    // Set node data
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      this.wasm.setNodePosition(i, node.x, node.y);
      this.wasm.setNodeVelocity(i, node.vx ?? 0, node.vy ?? 0);
      this.wasm.setNodeMass(i, node.mass ?? 1);
      this.wasm.setNodeRadius(i, node.radius ?? this.params.collisionRadius);

      if (node.fx != null && node.fy != null) {
        this.wasm.setNodeFixed(i, node.fx, node.fy);
      } else {
        this.wasm.clearNodeFixed(i);
      }
    }

    // Set edge data
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      this.wasm.setEdge(i, edge.source, edge.target, edge.strength ?? 1);
    }
  }

  private initializeJS(nodes: PhysicsNode[], edges: PhysicsEdge[]): void {
    this.jsNodes = nodes.map((node) => ({
      x: node.x,
      y: node.y,
      vx: node.vx ?? 0,
      vy: node.vy ?? 0,
      fx: node.fx ?? null,
      fy: node.fy ?? null,
      mass: node.mass ?? 1,
      radius: node.radius ?? this.params.collisionRadius,
    }));

    this.jsEdges = edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      strength: edge.strength ?? 1,
    }));

    this.jsAlpha = 1.0;
  }

  /**
   * Set simulation parameters.
   */
  setParams(params: Partial<PhysicsParams>): void {
    this.params = { ...this.params, ...params };

    // Update JS fallback alpha if changed
    if (params.alpha !== undefined) {
      this.jsAlpha = params.alpha;
    }

    if (this.wasm) {
      this.wasm.setParams(
        this.params.alpha,
        this.params.alphaDecay,
        this.params.velocityDecay,
        this.params.centerStrength,
        this.params.centerX,
        this.params.centerY,
        this.params.chargeStrength,
        this.params.chargeTheta,
        this.params.chargeDistanceMin,
        this.params.chargeDistanceMax,
        this.params.linkStrength,
        this.params.linkDistance,
        this.params.collisionRadius,
        this.params.collisionStrength
      );
    }
  }

  /**
   * Run simulation tick(s).
   */
  tick(iterations = 1): number {
    if (this.wasm) {
      return this.wasm.tick(iterations);
    } else {
      return this.tickJS(iterations);
    }
  }

  private tickJS(iterations: number): number {
    for (let iter = 0; iter < iterations; iter++) {
      // Decay alpha
      this.jsAlpha += (0 - this.jsAlpha) * this.params.alphaDecay;

      if (this.jsAlpha < 0.001) {
        this.jsAlpha = 0;
        break;
      }

      // Apply forces (simplified JS version)
      this.applyJSCenterForce();
      this.applyJSChargeForce();
      this.applyJSLinkForce();
      this.applyJSCollisionForce();
      this.applyJSVelocity();
    }

    return this.jsAlpha;
  }

  private applyJSCenterForce(): void {
    if (this.params.centerStrength <= 0) return;

    let sx = 0, sy = 0;
    for (const node of this.jsNodes) {
      sx += node.x;
      sy += node.y;
    }

    sx = (sx / this.jsNodes.length - this.params.centerX) * this.params.centerStrength * this.jsAlpha;
    sy = (sy / this.jsNodes.length - this.params.centerY) * this.params.centerStrength * this.jsAlpha;

    for (const node of this.jsNodes) {
      node.x -= sx;
      node.y -= sy;
    }
  }

  private applyJSChargeForce(): void {
    if (this.params.chargeStrength === 0) return;

    // Simple O(N^2) implementation for JS fallback
    for (let i = 0; i < this.jsNodes.length; i++) {
      for (let j = i + 1; j < this.jsNodes.length; j++) {
        const ni = this.jsNodes[i];
        const nj = this.jsNodes[j];

        let dx = nj.x - ni.x;
        let dy = nj.y - ni.y;
        let d = Math.sqrt(dx * dx + dy * dy);

        if (d < this.params.chargeDistanceMin) d = this.params.chargeDistanceMin;
        if (d > this.params.chargeDistanceMax) continue;

        const strength = this.params.chargeStrength * this.jsAlpha / (d * d);
        const fx = (dx / d) * strength;
        const fy = (dy / d) * strength;

        ni.vx += fx;
        ni.vy += fy;
        nj.vx -= fx;
        nj.vy -= fy;
      }
    }
  }

  private applyJSLinkForce(): void {
    if (this.params.linkStrength <= 0) return;

    for (const edge of this.jsEdges) {
      const source = this.jsNodes[edge.source];
      const target = this.jsNodes[edge.target];
      if (!source || !target) continue;

      let dx = target.x - source.x;
      let dy = target.y - source.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001) d = 0.001;

      const l = (d - this.params.linkDistance) / d * this.jsAlpha * this.params.linkStrength * edge.strength;

      dx *= l;
      dy *= l;

      target.vx -= dx * 0.5;
      target.vy -= dy * 0.5;
      source.vx += dx * 0.5;
      source.vy += dy * 0.5;
    }
  }

  private applyJSCollisionForce(): void {
    if (this.params.collisionStrength <= 0) return;

    for (let i = 0; i < this.jsNodes.length; i++) {
      for (let j = i + 1; j < this.jsNodes.length; j++) {
        const ni = this.jsNodes[i];
        const nj = this.jsNodes[j];

        const dx = nj.x - ni.x;
        const dy = nj.y - ni.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        const minDist = ni.radius + nj.radius;

        if (d < minDist && d > 0) {
          const overlap = (minDist - d) / d * this.params.collisionStrength * this.jsAlpha * 0.5;
          const ox = dx * overlap;
          const oy = dy * overlap;

          ni.x -= ox;
          ni.y -= oy;
          nj.x += ox;
          nj.y += oy;
        }
      }
    }
  }

  private applyJSVelocity(): void {
    for (const node of this.jsNodes) {
      node.vx *= 1 - this.params.velocityDecay;
      node.vy *= 1 - this.params.velocityDecay;

      if (node.fx === null) {
        node.x += node.vx;
      } else {
        node.x = node.fx;
        node.vx = 0;
      }

      if (node.fy === null) {
        node.y += node.vy;
      } else {
        node.y = node.fy;
        node.vy = 0;
      }
    }
  }

  /**
   * Get all node positions.
   */
  getPositions(): Array<{ x: number; y: number; vx: number; vy: number }> {
    const positions: Array<{ x: number; y: number; vx: number; vy: number }> = [];

    if (this.wasm) {
      for (let i = 0; i < this.nodeCount; i++) {
        positions.push({
          x: this.wasm.getNodeX(i),
          y: this.wasm.getNodeY(i),
          vx: this.wasm.getNodeVX(i),
          vy: this.wasm.getNodeVY(i),
        });
      }
    } else {
      for (const node of this.jsNodes) {
        positions.push({
          x: node.x,
          y: node.y,
          vx: node.vx,
          vy: node.vy,
        });
      }
    }

    return positions;
  }

  /**
   * Get bulk positions via direct memory access (WASM only).
   * Returns a Float32Array view into WASM memory for zero-copy reads.
   */
  getPositionsBulk(): Float32Array | null {
    if (!this.wasm || !this.wasmMemory) return null;

    const ptr = this.wasm.getNodeDataPtr();
    return new Float32Array(
      this.wasmMemory.buffer,
      ptr,
      this.nodeCount * NODE_STRIDE
    );
  }

  /**
   * Get position of a specific node.
   */
  getNodePosition(index: number): { x: number; y: number; vx: number; vy: number } {
    if (this.wasm) {
      return {
        x: this.wasm.getNodeX(index),
        y: this.wasm.getNodeY(index),
        vx: this.wasm.getNodeVX(index),
        vy: this.wasm.getNodeVY(index),
      };
    } else {
      const node = this.jsNodes[index];
      return node
        ? { x: node.x, y: node.y, vx: node.vx, vy: node.vy }
        : { x: 0, y: 0, vx: 0, vy: 0 };
    }
  }

  /**
   * Set position of a specific node.
   */
  setNodePosition(index: number, x: number, y: number): void {
    if (this.wasm) {
      this.wasm.setNodePosition(index, x, y);
    } else if (this.jsNodes[index]) {
      this.jsNodes[index].x = x;
      this.jsNodes[index].y = y;
    }
  }

  /**
   * Fix a node at a specific position.
   */
  fixNode(index: number, x: number, y: number): void {
    if (this.wasm) {
      this.wasm.setNodeFixed(index, x, y);
    } else if (this.jsNodes[index]) {
      this.jsNodes[index].fx = x;
      this.jsNodes[index].fy = y;
    }
  }

  /**
   * Unfix a node.
   */
  unfixNode(index: number): void {
    if (this.wasm) {
      this.wasm.clearNodeFixed(index);
    } else if (this.jsNodes[index]) {
      this.jsNodes[index].fx = null;
      this.jsNodes[index].fy = null;
    }
  }

  /**
   * Get current alpha value.
   */
  getAlpha(): number {
    if (this.wasm) {
      return this.wasm.getAlpha();
    }
    return this.jsAlpha;
  }

  /**
   * Set alpha value.
   */
  setAlpha(alpha: number): void {
    if (this.wasm) {
      this.wasm.setAlpha(alpha);
    } else {
      this.jsAlpha = alpha;
    }
  }

  /**
   * Reheat the simulation.
   */
  reheat(alpha = 1): void {
    this.setAlpha(alpha);
  }

  /**
   * Find node at position.
   */
  findNodeAt(x: number, y: number, radius = 20): number {
    if (this.wasm) {
      return this.wasm.findNodeAt(x, y, radius);
    }

    // JS fallback
    let closestIdx = -1;
    let closestDist = radius * radius;

    for (let i = 0; i < this.jsNodes.length; i++) {
      const node = this.jsNodes[i];
      const dx = node.x - x;
      const dy = node.y - y;
      const d2 = dx * dx + dy * dy;

      if (d2 < closestDist) {
        closestDist = d2;
        closestIdx = i;
      }
    }

    return closestIdx;
  }

  /**
   * Get bounding box of all nodes.
   */
  getBoundingBox(): BoundingBox {
    if (this.wasm) {
      const bb = this.wasm.getBoundingBox();
      return {
        minX: bb[0],
        minY: bb[1],
        maxX: bb[2],
        maxY: bb[3],
      };
    }

    // JS fallback
    if (this.jsNodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const node of this.jsNodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Check if simulation is still active.
   */
  isActive(): boolean {
    return this.getAlpha() > 0.001;
  }

  /**
   * Stop the simulation.
   */
  stop(): void {
    this.setAlpha(0);
  }

  /**
   * Get node count.
   */
  getNodeCount(): number {
    return this.nodeCount;
  }

  /**
   * Get edge count.
   */
  getEdgeCount(): number {
    return this.edgeCount;
  }
}

/**
 * Create a new physics engine with optional WASM loading.
 *
 * @param wasmUrl - URL to WASM file. If not provided, uses JS fallback.
 * @returns Promise resolving to initialized PhysicsEngine
 */
export async function createPhysicsEngine(wasmUrl?: string): Promise<PhysicsEngine> {
  const engine = new PhysicsEngine();
  if (wasmUrl) {
    await engine.loadWasm(wasmUrl);
  }
  return engine;
}
