/**
 * Barnes-Hut Force Calculation
 *
 * Implements the Barnes-Hut algorithm for O(n log n) many-body force calculation,
 * replacing the naive O(n²) approach. Critical for handling graphs with 10K+ nodes
 * at interactive frame rates.
 *
 * The algorithm works by:
 * 1. Building a quadtree spatial index of all nodes
 * 2. For distant node groups, treating them as a single body at their center of mass
 * 3. Using a threshold parameter θ (theta) to control accuracy vs speed
 *
 * Complexity: O(n log n) vs O(n²) for direct calculation
 *
 * θ values:
 * - 0.0 → Exact calculation (O(n²))
 * - 0.5 → Good accuracy
 * - 0.9 → Default (good performance)
 * - 1.5 → Fast but less accurate
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { Quadtree, type QuadtreeNode, type QuadtreePoint } from "./Quadtree";

/**
 * Simulation node interface compatible with D3 force simulation
 */
export interface SimulationNode extends QuadtreePoint {
  /** Unique identifier */
  index?: number;
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** X velocity */
  vx?: number;
  /** Y velocity */
  vy?: number;
  /** Fixed X position (if pinned) */
  fx?: number | null;
  /** Fixed Y position (if pinned) */
  fy?: number | null;
}

/**
 * Configuration for Barnes-Hut force
 */
export interface BarnesHutForceConfig {
  /**
   * Barnes-Hut approximation threshold (theta)
   * - Lower values: more accurate, slower
   * - Higher values: less accurate, faster
   * @default 0.9
   */
  theta?: number;

  /**
   * Charge strength for repulsion force
   * Negative values cause repulsion (typical for force-directed graphs)
   * @default -30
   */
  strength?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);

  /**
   * Minimum distance between nodes (prevents infinite forces)
   * @default 1
   */
  distanceMin?: number;

  /**
   * Maximum distance for force calculation (beyond this, force is 0)
   * @default Infinity
   */
  distanceMax?: number;
}

/**
 * Creates a Barnes-Hut many-body force function compatible with D3 force simulation
 *
 * @example
 * ```typescript
 * const force = createBarnesHutForce({
 *   theta: 0.9,
 *   strength: -300,
 *   distanceMin: 1,
 *   distanceMax: Infinity,
 * });
 *
 * const simulation = d3.forceSimulation(nodes)
 *   .force('charge', force);
 * ```
 *
 * @param config - Force configuration
 * @returns Force function compatible with D3 force simulation
 */
export function createBarnesHutForce(
  config: BarnesHutForceConfig = {}
): BarnesHutForce {
  return new BarnesHutForce(config);
}

/**
 * Barnes-Hut force implementation
 *
 * This class implements the D3 force interface and uses the Barnes-Hut algorithm
 * for efficient many-body force calculation.
 */
export class BarnesHutForce {
  private nodes: SimulationNode[] = [];
  private strengths: number[] = [];
  private _theta: number;
  private _strength: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  private _distanceMin2: number;
  private _distanceMax2: number;
  private alpha: number = 1;

  constructor(config: BarnesHutForceConfig = {}) {
    this._theta = config.theta ?? 0.9;
    this._strength = config.strength ?? -30;
    this._distanceMin2 = (config.distanceMin ?? 1) ** 2;
    this._distanceMax2 = (config.distanceMax ?? Infinity) ** 2;
  }

  /**
   * Initialize the force with nodes
   */
  initialize(nodes: SimulationNode[]): void {
    this.nodes = nodes;
    this.initializeStrengths();
  }

  /**
   * Initialize strength values for each node
   */
  private initializeStrengths(): void {
    this.strengths = this.nodes.map((node, i) => {
      if (typeof this._strength === "function") {
        return this._strength(node, i, this.nodes);
      }
      return this._strength;
    });
  }

  /**
   * Apply the force for one simulation tick
   *
   * @param alpha - Current simulation alpha (cooling factor)
   */
  force(alpha: number): void {
    this.alpha = alpha;

    const n = this.nodes.length;
    if (n === 0) return;

    // Build quadtree
    const tree = new Quadtree<SimulationNode>(this.nodes);

    // Accumulate Barnes-Hut values (center of mass, total charge)
    this.accumulate(tree);

    // Apply forces
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      this.applyForce(tree, node, i);
    }
  }

  /**
   * Accumulate center of mass and charge for each quadtree node
   */
  private accumulate(tree: Quadtree<SimulationNode>): void {
    tree.visitAfter((quad) => {
      let weight = 0;
      let x = 0;
      let y = 0;
      let value = 0;

      // Leaf node with data
      if (quad.data) {
        const node = quad.data;
        const index = this.nodes.indexOf(node);
        const strength = index >= 0 ? this.strengths[index] : 0;

        x = node.x * Math.abs(strength);
        y = node.y * Math.abs(strength);
        weight = Math.abs(strength);
        value = strength;

        // Handle coincident points
        let next: QuadtreeNode<SimulationNode> | undefined = quad.next;
        while (next) {
          if (next.data) {
            const nextNode = next.data;
            const nextIndex = this.nodes.indexOf(nextNode);
            const nextStrength = nextIndex >= 0 ? this.strengths[nextIndex] : 0;
            x += nextNode.x * Math.abs(nextStrength);
            y += nextNode.y * Math.abs(nextStrength);
            weight += Math.abs(nextStrength);
            value += nextStrength;
          }
          next = next.next;
        }
      }
      // Internal node - accumulate from children
      else if (quad.children) {
        for (const child of quad.children) {
          if (child) {
            const c = child.weight || 0;
            weight += c;
            x += c * child.x;
            y += c * child.y;
            value += child.value || 0;
          }
        }
      }

      // Store accumulated values
      quad.weight = weight;
      quad.x = weight > 0 ? x / weight : 0;
      quad.y = weight > 0 ? y / weight : 0;
      quad.value = value;
    });
  }

  /**
   * Apply force from quadtree to a single node
   */
  private applyForce(
    tree: Quadtree<SimulationNode>,
    node: SimulationNode,
    _nodeIndex: number
  ): void {
    const theta2 = this._theta * this._theta;

    tree.visit((quad, x0, _y0, x1, _y1) => {
      if (quad.value === 0) return true; // Skip empty quadrants

      // Distance from node to quadrant center of mass
      let dx = quad.x - node.x;
      let dy = quad.y - node.y;
      const w = x1 - x0; // Quadrant width

      // Distance squared
      let d2 = dx * dx + dy * dy;

      // Check Barnes-Hut criterion: s/d < θ
      // where s is quadrant width and d is distance
      // Rearranged: s² < θ²d² → w² < θ²d²
      if (w * w < theta2 * d2) {
        // Quadrant is far enough - use approximation
        if (d2 < this._distanceMax2) {
          // Apply minimum distance
          if (d2 < this._distanceMin2) {
            d2 = Math.sqrt(this._distanceMin2 * d2);
            dx = dx / Math.sqrt(d2 / this._distanceMin2);
            dy = dy / Math.sqrt(d2 / this._distanceMin2);
          }

          // Apply force: F = k * q1 * q2 / d²
          // For repulsion, we use the charge (value) from the quadrant
          // dx points from node to other, with negative strength we push AWAY
          const k = (this.alpha * quad.value) / d2;
          node.vx = (node.vx ?? 0) + dx * k;
          node.vy = (node.vy ?? 0) + dy * k;
        }
        return true; // Don't visit children
      }

      // Quadrant is too close - need to check individual nodes or children
      // If this is a leaf with data, apply direct force
      if (quad.data && quad.data !== node) {
        dx = quad.data.x - node.x;
        dy = quad.data.y - node.y;
        d2 = dx * dx + dy * dy;

        if (d2 > 0 && d2 < this._distanceMax2) {
          if (d2 < this._distanceMin2) {
            d2 = Math.sqrt(this._distanceMin2 * d2);
          }

          const dataIndex = this.nodes.indexOf(quad.data);
          const strength = dataIndex >= 0 ? this.strengths[dataIndex] : 0;
          const k = (this.alpha * strength) / d2;
          node.vx = (node.vx ?? 0) + dx * k;
          node.vy = (node.vy ?? 0) + dy * k;
        }

        // Handle coincident points
        let next: QuadtreeNode<SimulationNode> | undefined = quad.next;
        while (next) {
          if (next.data && next.data !== node) {
            dx = next.data.x - node.x;
            dy = next.data.y - node.y;
            d2 = dx * dx + dy * dy;

            if (d2 > 0 && d2 < this._distanceMax2) {
              if (d2 < this._distanceMin2) {
                d2 = Math.sqrt(this._distanceMin2 * d2);
              }

              const nextIndex = this.nodes.indexOf(next.data);
              const nextStrength = nextIndex >= 0 ? this.strengths[nextIndex] : 0;
              const k = (this.alpha * nextStrength) / d2;
              node.vx = (node.vx ?? 0) + dx * k;
              node.vy = (node.vy ?? 0) + dy * k;
            }
          }
          next = next.next;
        }
      }

      return false; // Continue visiting children
    });
  }

  /**
   * Get/set theta parameter
   */
  theta(): number;
  theta(value: number): this;
  theta(value?: number): number | this {
    if (value === undefined) return this._theta;
    this._theta = value;
    return this;
  }

  /**
   * Get/set strength
   */
  strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  strength(value: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number)): this;
  strength(
    value?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | this {
    if (value === undefined) return this._strength;
    this._strength = value;
    this.initializeStrengths();
    return this;
  }

  /**
   * Get/set minimum distance
   */
  distanceMin(): number;
  distanceMin(value: number): this;
  distanceMin(value?: number): number | this {
    if (value === undefined) return Math.sqrt(this._distanceMin2);
    this._distanceMin2 = value * value;
    return this;
  }

  /**
   * Get/set maximum distance
   */
  distanceMax(): number;
  distanceMax(value: number): this;
  distanceMax(value?: number): number | this {
    if (value === undefined) return Math.sqrt(this._distanceMax2);
    this._distanceMax2 = value * value;
    return this;
  }
}

/**
 * Apply Barnes-Hut force to a set of nodes
 *
 * This is a convenience function for applying the force without creating
 * a simulation. Useful for testing or single-pass calculations.
 *
 * @param nodes - Nodes to apply force to
 * @param config - Force configuration
 * @param alpha - Simulation alpha (cooling factor)
 */
export function applyBarnesHutForce(
  nodes: SimulationNode[],
  config: BarnesHutForceConfig = {},
  alpha: number = 1
): void {
  const force = new BarnesHutForce(config);
  force.initialize(nodes);
  force.force(alpha);
}

/**
 * Performance benchmarking utility
 *
 * Compares naive O(n²) calculation with Barnes-Hut O(n log n) calculation.
 *
 * @param nodeCount - Number of nodes to test
 * @param iterations - Number of iterations to average
 * @returns Benchmark results
 */
export function benchmarkBarnesHut(
  nodeCount: number,
  iterations: number = 10
): { naive: number; barnesHut: number; speedup: number } {
  // Generate random nodes
  const nodes: SimulationNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      index: i,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      vx: 0,
      vy: 0,
    });
  }

  // Benchmark naive O(n²)
  const naiveStart = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    // Reset velocities
    for (const node of nodes) {
      node.vx = 0;
      node.vy = 0;
    }

    // Naive all-pairs calculation
    const strength = -30;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d2 = Math.max(1, dx * dx + dy * dy);
        const k = strength / d2;
        nodes[i].vx! -= dx * k;
        nodes[i].vy! -= dy * k;
        nodes[j].vx! += dx * k;
        nodes[j].vy! += dy * k;
      }
    }
  }
  const naiveTime = (performance.now() - naiveStart) / iterations;

  // Benchmark Barnes-Hut
  const bhStart = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    // Reset velocities
    for (const node of nodes) {
      node.vx = 0;
      node.vy = 0;
    }

    applyBarnesHutForce(nodes, { theta: 0.9, strength: -30 });
  }
  const bhTime = (performance.now() - bhStart) / iterations;

  return {
    naive: naiveTime,
    barnesHut: bhTime,
    speedup: naiveTime / bhTime,
  };
}
