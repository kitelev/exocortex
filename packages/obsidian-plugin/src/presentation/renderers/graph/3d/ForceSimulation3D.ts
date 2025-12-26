/**
 * ForceSimulation3D - 3D Force-directed graph layout simulation
 *
 * Provides GPU-friendly force-directed layout in 3D space with:
 * - Center force to keep nodes grouped
 * - Many-body (charge) force for node repulsion
 * - Link force for connected node attraction
 * - Collision detection
 * - Barnes-Hut optimization for O(n log n) complexity
 * - Configurable alpha (energy) decay
 *
 * @module presentation/renderers/graph/3d
 * @since 1.0.0
 */

import type {
  GraphNode3D,
  GraphEdge3D,
  ForceSimulation3DConfig,
  Point3D,
} from "./types3d";
import { DEFAULT_FORCE_SIMULATION_3D_CONFIG } from "./types3d";

/**
 * Simulation node with velocity and force accumulator
 */
interface SimulationNode extends GraphNode3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fx: number | null;
  fy: number | null;
  fz: number | null;
}

/**
 * Simulation link with resolved node references
 */
interface SimulationLink {
  source: SimulationNode;
  target: SimulationNode;
  distance: number;
  strength: number;
}

/**
 * Octree node for Barnes-Hut optimization
 */
interface OctreeNode {
  x: number;
  y: number;
  z: number;
  mass: number;
  body: SimulationNode | null;
  children: (OctreeNode | null)[];
  bounds: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  };
}

/**
 * Event types for simulation
 */
export type SimulationEventType = "tick" | "end";

/**
 * Simulation event data
 */
export interface Simulation3DEvent {
  type: SimulationEventType;
  alpha: number;
  nodes: GraphNode3D[];
}

/**
 * Event listener callback
 */
export type Simulation3DEventListener = (event: Simulation3DEvent) => void;

/**
 * ForceSimulation3D - Force-directed layout in 3D space
 *
 * @example
 * ```typescript
 * const simulation = new ForceSimulation3D(nodes, edges);
 *
 * simulation.on('tick', (event) => {
 *   renderer.updatePositions(event.nodes);
 * });
 *
 * simulation.start();
 *
 * // Later...
 * simulation.stop();
 * ```
 */
export class ForceSimulation3D {
  private config: ForceSimulation3DConfig;
  private nodes: SimulationNode[] = [];
  private links: SimulationLink[] = [];
  private nodeMap: Map<string, SimulationNode> = new Map();

  private alpha: number;
  private running = false;
  private animationFrameId: number | null = null;

  private eventListeners: Map<SimulationEventType, Set<Simulation3DEventListener>> = new Map();

  constructor(
    nodes: GraphNode3D[] = [],
    edges: GraphEdge3D[] = [],
    config: Partial<ForceSimulation3DConfig> = {}
  ) {
    this.config = { ...DEFAULT_FORCE_SIMULATION_3D_CONFIG, ...config };
    this.alpha = this.config.alpha;

    // Initialize event listener maps
    this.eventListeners.set("tick", new Set());
    this.eventListeners.set("end", new Set());

    this.setData(nodes, edges);
  }

  /**
   * Set simulation data
   */
  setData(nodes: GraphNode3D[], edges: GraphEdge3D[]): void {
    // Initialize nodes with positions and velocities
    this.nodes = nodes.map((node) => this.initializeNode(node));
    this.nodeMap.clear();
    for (const node of this.nodes) {
      this.nodeMap.set(node.id, node);
    }

    // Initialize links
    this.links = [];
    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const source = this.nodeMap.get(sourceId);
      const target = this.nodeMap.get(targetId);

      if (source && target) {
        this.links.push({
          source,
          target,
          distance: this.config.linkDistance,
          strength: 1 / Math.min(this.countLinks(source), this.countLinks(target)),
        });
      }
    }
  }

  /**
   * Initialize a simulation node with random position if needed
   */
  private initializeNode(node: GraphNode3D): SimulationNode {
    const radius = Math.sqrt(this.nodes.length + 1) * 50;

    return {
      ...node,
      x: node.x ?? (Math.random() - 0.5) * radius,
      y: node.y ?? (Math.random() - 0.5) * radius,
      z: node.z ?? (Math.random() - 0.5) * radius,
      vx: node.vx ?? 0,
      vy: node.vy ?? 0,
      vz: node.vz ?? 0,
      fx: node.fx ?? null,
      fy: node.fy ?? null,
      fz: node.fz ?? null,
    };
  }

  /**
   * Count links connected to a node
   */
  private countLinks(node: SimulationNode): number {
    let count = 0;
    for (const link of this.links) {
      if (link.source === node || link.target === node) {
        count++;
      }
    }
    return Math.max(1, count);
  }

  /**
   * Start the simulation
   * @param alpha Optional initial alpha value (defaults to config.alpha)
   */
  start(alpha?: number): void {
    if (this.running) return;

    this.running = true;
    this.alpha = alpha ?? this.config.alpha;

    const tick = (): void => {
      if (!this.running) return;

      this.tick();

      if (this.alpha < this.config.alphaMin) {
        this.running = false;
        this.emit("end", {
          type: "end",
          alpha: this.alpha,
          nodes: this.nodes,
        });
        return;
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  /**
   * Stop the simulation
   */
  stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Resume simulation with specified alpha
   */
  restart(alpha?: number): void {
    const targetAlpha = alpha ?? this.config.alpha;
    this.alpha = targetAlpha;
    if (!this.running) {
      this.start(targetAlpha);
    }
  }

  /**
   * Perform a single simulation tick
   */
  tick(): void {
    // Apply forces
    this.applyForces();

    // Update positions based on velocities
    for (const node of this.nodes) {
      // Apply fixed positions
      if (node.fx !== null) {
        node.x = node.fx;
        node.vx = 0;
      } else {
        node.vx *= this.config.velocityDecay;
        node.x += node.vx;
      }

      if (node.fy !== null) {
        node.y = node.fy;
        node.vy = 0;
      } else {
        node.vy *= this.config.velocityDecay;
        node.y += node.vy;
      }

      if (node.fz !== null) {
        node.z = node.fz;
        node.vz = 0;
      } else {
        node.vz *= this.config.velocityDecay;
        node.z += node.vz;
      }
    }

    // Decay alpha
    this.alpha += (this.config.alphaTarget - this.alpha) * this.config.alphaDecay;

    // Emit tick event
    this.emit("tick", {
      type: "tick",
      alpha: this.alpha,
      nodes: this.nodes,
    });
  }

  /**
   * Apply all forces to nodes
   */
  private applyForces(): void {
    // Center force
    this.applyCenterForce();

    // Many-body (charge) force
    if (this.config.useBarnesHut && this.nodes.length > 100) {
      this.applyBarnesHutForce();
    } else {
      this.applyManyBodyForce();
    }

    // Link force
    this.applyLinkForce();

    // Collision force
    this.applyCollisionForce();
  }

  /**
   * Apply center attraction force
   */
  private applyCenterForce(): void {
    const strength = this.config.centerStrength * this.alpha;

    for (const node of this.nodes) {
      node.vx -= node.x * strength;
      node.vy -= node.y * strength;
      node.vz -= node.z * strength;
    }
  }

  /**
   * Apply many-body (charge) force using direct O(n²) calculation
   */
  private applyManyBodyForce(): void {
    const strength = this.config.chargeStrength * this.alpha;
    const distanceMin2 = 1;
    const distanceMax2 = Infinity;

    for (let i = 0; i < this.nodes.length; i++) {
      const nodeA = this.nodes[i];

      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeB = this.nodes[j];

        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const dz = nodeB.z - nodeA.z;

        let d2 = dx * dx + dy * dy + dz * dz;

        if (d2 < distanceMin2) d2 = distanceMin2;
        if (d2 > distanceMax2) continue;

        const d = Math.sqrt(d2);
        const force = strength / d2;

        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        const fz = (dz / d) * force;

        nodeA.vx -= fx;
        nodeA.vy -= fy;
        nodeA.vz -= fz;
        nodeB.vx += fx;
        nodeB.vy += fy;
        nodeB.vz += fz;
      }
    }
  }

  /**
   * Apply many-body force using Barnes-Hut octree approximation
   */
  private applyBarnesHutForce(): void {
    const octree = this.buildOctree();
    if (!octree) return;

    const strength = this.config.chargeStrength * this.alpha;
    const theta2 = this.config.theta * this.config.theta;

    for (const node of this.nodes) {
      this.applyOctreeForce(node, octree, strength, theta2);
    }
  }

  /**
   * Build octree for Barnes-Hut algorithm
   */
  private buildOctree(): OctreeNode | null {
    if (this.nodes.length === 0) return null;

    // Calculate bounds
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (const node of this.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      minZ = Math.min(minZ, node.z);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
      maxZ = Math.max(maxZ, node.z);
    }

    // Add padding
    const padding = 1;
    minX -= padding;
    minY -= padding;
    minZ -= padding;
    maxX += padding;
    maxY += padding;
    maxZ += padding;

    // Make cube (equal sides)
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    maxX = minX + size;
    maxY = minY + size;
    maxZ = minZ + size;

    const root: OctreeNode = {
      x: 0,
      y: 0,
      z: 0,
      mass: 0,
      body: null,
      children: [null, null, null, null, null, null, null, null],
      bounds: { minX, minY, minZ, maxX, maxY, maxZ },
    };

    for (const node of this.nodes) {
      this.insertIntoOctree(root, node);
    }

    return root;
  }

  /**
   * Insert a node into the octree
   */
  private insertIntoOctree(tree: OctreeNode, node: SimulationNode): void {
    const { minX, minY, minZ, maxX, maxY, maxZ } = tree.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const midZ = (minZ + maxZ) / 2;

    // Update center of mass
    const totalMass = tree.mass + 1;
    tree.x = (tree.x * tree.mass + node.x) / totalMass;
    tree.y = (tree.y * tree.mass + node.y) / totalMass;
    tree.z = (tree.z * tree.mass + node.z) / totalMass;
    tree.mass = totalMass;

    // If leaf with no body, place body here
    if (tree.body === null && tree.children.every((c) => c === null)) {
      tree.body = node;
      return;
    }

    // If leaf with body, push existing body down
    if (tree.body !== null) {
      const existingBody = tree.body;
      tree.body = null;
      this.insertIntoOctree(tree, existingBody);
    }

    // Determine octant for new node
    const octant = this.getOctant(node, midX, midY, midZ);

    if (tree.children[octant] === null) {
      tree.children[octant] = {
        x: 0,
        y: 0,
        z: 0,
        mass: 0,
        body: null,
        children: [null, null, null, null, null, null, null, null],
        bounds: this.getOctantBounds(octant, minX, minY, minZ, maxX, maxY, maxZ),
      };
    }

    this.insertIntoOctree(tree.children[octant]!, node);
  }

  /**
   * Get octant index (0-7) for a position
   */
  private getOctant(
    node: SimulationNode,
    midX: number,
    midY: number,
    midZ: number
  ): number {
    let octant = 0;
    if (node.x >= midX) octant |= 1;
    if (node.y >= midY) octant |= 2;
    if (node.z >= midZ) octant |= 4;
    return octant;
  }

  /**
   * Get bounds for an octant
   */
  private getOctantBounds(
    octant: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number
  ): OctreeNode["bounds"] {
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const midZ = (minZ + maxZ) / 2;

    return {
      minX: octant & 1 ? midX : minX,
      maxX: octant & 1 ? maxX : midX,
      minY: octant & 2 ? midY : minY,
      maxY: octant & 2 ? maxY : midY,
      minZ: octant & 4 ? midZ : minZ,
      maxZ: octant & 4 ? maxZ : midZ,
    };
  }

  /**
   * Apply force from octree node to simulation node
   */
  private applyOctreeForce(
    node: SimulationNode,
    tree: OctreeNode,
    strength: number,
    theta2: number
  ): void {
    if (tree.mass === 0) return;

    const dx = tree.x - node.x;
    const dy = tree.y - node.y;
    const dz = tree.z - node.z;
    const d2 = dx * dx + dy * dy + dz * dz;

    // Skip if same node
    if (d2 < 0.0001) return;

    const { minX, maxX } = tree.bounds;
    const size = maxX - minX;
    const size2 = size * size;

    // Barnes-Hut criterion: if size²/d² < θ², treat as single body
    if (size2 / d2 < theta2 || tree.body !== null) {
      const d = Math.sqrt(Math.max(1, d2));
      const force = (strength * tree.mass) / d2;

      node.vx += (dx / d) * force;
      node.vy += (dy / d) * force;
      node.vz += (dz / d) * force;
    } else {
      // Recurse into children
      for (const child of tree.children) {
        if (child !== null) {
          this.applyOctreeForce(node, child, strength, theta2);
        }
      }
    }
  }

  /**
   * Apply link (spring) force between connected nodes
   */
  private applyLinkForce(): void {
    for (const link of this.links) {
      const { source, target, distance, strength } = link;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;

      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const l = (d - distance) / d * this.alpha * strength;

      const fx = dx * l;
      const fy = dy * l;
      const fz = dz * l;

      target.vx -= fx;
      target.vy -= fy;
      target.vz -= fz;
      source.vx += fx;
      source.vy += fy;
      source.vz += fz;
    }
  }

  /**
   * Apply collision detection force
   */
  private applyCollisionForce(): void {
    const radius = this.config.collisionRadius * 8; // Base node radius

    for (let i = 0; i < this.nodes.length; i++) {
      const nodeA = this.nodes[i];
      const radiusA = (nodeA.size ?? 1) * radius;

      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeB = this.nodes[j];
        const radiusB = (nodeB.size ?? 1) * radius;

        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const dz = nodeB.z - nodeA.z;

        const d2 = dx * dx + dy * dy + dz * dz;
        const minDist = radiusA + radiusB;
        const minDist2 = minDist * minDist;

        if (d2 < minDist2) {
          const d = Math.sqrt(d2) || 0.01;
          const overlap = minDist - d;
          const force = (overlap * 0.5 * this.alpha) / d;

          const fx = dx * force;
          const fy = dy * force;
          const fz = dz * force;

          nodeA.vx -= fx;
          nodeA.vy -= fy;
          nodeA.vz -= fz;
          nodeB.vx += fx;
          nodeB.vy += fy;
          nodeB.vz += fz;
        }
      }
    }
  }

  /**
   * Get current alpha (energy) level
   */
  getAlpha(): number {
    return this.alpha;
  }

  /**
   * Set alpha level
   */
  setAlpha(alpha: number): void {
    this.alpha = alpha;
  }

  /**
   * Get current nodes with positions
   */
  getNodes(): GraphNode3D[] {
    return this.nodes;
  }

  /**
   * Get a specific node by ID
   */
  getNode(id: string): GraphNode3D | undefined {
    return this.nodeMap.get(id);
  }

  /**
   * Pin a node at a fixed position
   */
  pinNode(nodeId: string, position: Point3D): void {
    const node = this.nodeMap.get(nodeId);
    if (node) {
      node.fx = position.x;
      node.fy = position.y;
      node.fz = position.z;
      node.x = position.x;
      node.y = position.y;
      node.z = position.z;
    }
  }

  /**
   * Unpin a node
   */
  unpinNode(nodeId: string): void {
    const node = this.nodeMap.get(nodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
      node.fz = null;
    }
  }

  /**
   * Check if simulation is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Add event listener
   */
  on(eventType: SimulationEventType, listener: Simulation3DEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: SimulationEventType, listener: Simulation3DEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: SimulationEventType, event: Simulation3DEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in ForceSimulation3D event listener:`, error);
        }
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ForceSimulation3DConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Destroy simulation and release resources
   */
  destroy(): void {
    this.stop();
    this.nodes = [];
    this.links = [];
    this.nodeMap.clear();
    this.eventListeners.clear();
  }
}

/**
 * Factory function to create ForceSimulation3D
 */
export function createForceSimulation3D(
  nodes?: GraphNode3D[],
  edges?: GraphEdge3D[],
  config?: Partial<ForceSimulation3DConfig>
): ForceSimulation3D {
  return new ForceSimulation3D(nodes, edges, config);
}
