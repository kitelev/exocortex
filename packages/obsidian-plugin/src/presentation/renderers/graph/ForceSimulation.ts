/**
 * ForceSimulation - Main-thread force-directed layout simulation
 *
 * Implements a d3-force compatible API for force-directed graph layouts.
 * Optimized for performance with WebAssembly support preparation and
 * Barnes-Hut integration for O(n log n) complexity on large graphs.
 *
 * Key features:
 * - d3-force compatible interface
 * - Composable force system
 * - RAF-based animation loop
 * - Performance metrics
 * - Fixed node support for drag interactions
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import { BarnesHutForce, type SimulationNode as BHSimulationNode } from "./BarnesHutForce";

/**
 * Simulation node with physics properties
 */
export interface SimulationNode {
  /** Unique identifier */
  id: string;
  /** Node index (assigned by simulation) */
  index: number;

  /** X position (mutable during simulation) */
  x: number;
  /** Y position (mutable during simulation) */
  y: number;

  /** X velocity (mutable during simulation) */
  vx: number;
  /** Y velocity (mutable during simulation) */
  vy: number;

  /** Fixed X position (if set, node won't move on x-axis) */
  fx?: number | null;
  /** Fixed Y position (if set, node won't move on y-axis) */
  fy?: number | null;

  /** Node mass for force calculations (default: 1) */
  mass: number;
  /** Node radius for collision detection (default: 8) */
  radius: number;
}

/**
 * Simulation link connecting two nodes
 */
export interface SimulationLink<N extends SimulationNode = SimulationNode> {
  /** Source node ID or node object */
  source: string | N;
  /** Target node ID or node object */
  target: string | N;
  /** Link index (assigned by simulation) */
  index?: number;
}

/**
 * Base force interface - all forces implement this
 */
export interface Force<N extends SimulationNode = SimulationNode> {
  /**
   * Apply force for one simulation tick
   * @param alpha Current simulation alpha (cooling factor)
   */
  (alpha: number): void;

  /**
   * Initialize the force with nodes
   * Called whenever nodes array changes
   */
  initialize?(nodes: N[], random: () => number): void;
}

/**
 * Force simulation events
 */
export type SimulationEvent = "tick" | "end";

/**
 * Event callback type
 */
export type SimulationEventCallback = () => void;

/**
 * Configuration for ForceSimulation
 */
export interface ForceSimulationConfig {
  /** Initial alpha value (default: 1) */
  alpha?: number;
  /** Minimum alpha before simulation stops (default: 0.001) */
  alphaMin?: number;
  /** Alpha decay rate per tick (default: 0.0228) */
  alphaDecay?: number;
  /** Target alpha for simulation (default: 0) */
  alphaTarget?: number;
  /** Velocity decay rate (default: 0.4) */
  velocityDecay?: number;
  /** Random source function (default: Math.random) */
  randomSource?: () => number;
}

/**
 * Performance metrics for the simulation
 */
export interface SimulationMetrics {
  /** Last tick computation time in ms */
  lastTickTime: number;
  /** Average tick time over recent ticks */
  avgTickTime: number;
  /** Total ticks since simulation started */
  totalTicks: number;
  /** Total computation time in ms */
  totalTime: number;
  /** Current frames per second */
  fps: number;
}

/**
 * ForceSimulation - Main-thread force-directed layout implementation
 *
 * @example
 * ```typescript
 * const simulation = new ForceSimulation<MyNode>()
 *   .nodes(nodes)
 *   .force("center", forceCenter(width / 2, height / 2))
 *   .force("charge", forceManyBody().strength(-300))
 *   .force("link", forceLink(links).distance(100))
 *   .on("tick", () => render(simulation.nodes()));
 *
 * simulation.start();
 * ```
 */
export class ForceSimulation<N extends SimulationNode = SimulationNode> {
  private _nodes: N[] = [];
  private _forces: Map<string, Force<N>> = new Map();
  private _alpha: number = 1;
  private _alphaMin: number = 0.001;
  private _alphaDecay: number = 0.0228;
  private _alphaTarget: number = 0;
  private _velocityDecay: number = 0.4;

  private _random: () => number = Math.random;
  private _animationId: number | null = null;
  private _running: boolean = false;

  private _tickCallbacks: SimulationEventCallback[] = [];
  private _endCallbacks: SimulationEventCallback[] = [];

  // Performance metrics
  private _metrics: SimulationMetrics = {
    lastTickTime: 0,
    avgTickTime: 0,
    totalTicks: 0,
    totalTime: 0,
    fps: 0,
  };
  private _tickTimes: number[] = [];
  private _lastFrameTime: number = 0;

  constructor(config: ForceSimulationConfig = {}) {
    if (config.alpha !== undefined) this._alpha = config.alpha;
    if (config.alphaMin !== undefined) this._alphaMin = config.alphaMin;
    if (config.alphaDecay !== undefined) this._alphaDecay = config.alphaDecay;
    if (config.alphaTarget !== undefined) this._alphaTarget = config.alphaTarget;
    if (config.velocityDecay !== undefined) this._velocityDecay = config.velocityDecay;
    if (config.randomSource !== undefined) this._random = config.randomSource;
  }

  // ============================================================
  // Lifecycle Methods
  // ============================================================

  /**
   * Start the simulation animation loop
   */
  start(): this {
    if (this._running) return this;

    this._running = true;
    this._lastFrameTime = performance.now();
    this.scheduleFrame();
    return this;
  }

  /**
   * Stop the simulation animation loop
   */
  stop(): this {
    if (this._animationId !== null) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
    this._running = false;
    return this;
  }

  /**
   * Restart the simulation (reheat and start)
   */
  restart(): this {
    this._alpha = 1;
    return this.start();
  }

  /**
   * Execute one or more simulation ticks synchronously
   * @param iterations Number of ticks to execute (default: 1)
   */
  tick(iterations: number = 1): this {
    for (let i = 0; i < iterations; i++) {
      this.executeTick();
    }
    return this;
  }

  // ============================================================
  // State Accessors
  // ============================================================

  /**
   * Get or set the current alpha value
   */
  alpha(): number;
  alpha(value: number): this;
  alpha(value?: number): number | this {
    if (value === undefined) return this._alpha;
    this._alpha = Math.max(0, Math.min(1, value));
    return this;
  }

  /**
   * Get or set the minimum alpha value
   */
  alphaMin(): number;
  alphaMin(value: number): this;
  alphaMin(value?: number): number | this {
    if (value === undefined) return this._alphaMin;
    this._alphaMin = Math.max(0, value);
    return this;
  }

  /**
   * Get or set the alpha decay rate
   */
  alphaDecay(): number;
  alphaDecay(value: number): this;
  alphaDecay(value?: number): number | this {
    if (value === undefined) return this._alphaDecay;
    this._alphaDecay = Math.max(0, Math.min(1, value));
    return this;
  }

  /**
   * Get or set the target alpha value
   */
  alphaTarget(): number;
  alphaTarget(value: number): this;
  alphaTarget(value?: number): number | this {
    if (value === undefined) return this._alphaTarget;
    this._alphaTarget = Math.max(0, Math.min(1, value));
    return this;
  }

  /**
   * Get or set the velocity decay factor
   */
  velocityDecay(): number;
  velocityDecay(value: number): this;
  velocityDecay(value?: number): number | this {
    if (value === undefined) return this._velocityDecay;
    this._velocityDecay = Math.max(0, Math.min(1, value));
    return this;
  }

  /**
   * Check if simulation is currently running
   */
  isRunning(): boolean {
    return this._running;
  }

  /**
   * Get current performance metrics
   */
  metrics(): SimulationMetrics {
    return { ...this._metrics };
  }

  // ============================================================
  // Data Methods
  // ============================================================

  /**
   * Get or set the simulation nodes
   */
  nodes(): N[];
  nodes(nodes: N[]): this;
  nodes(nodes?: N[]): N[] | this {
    if (nodes === undefined) return this._nodes;

    // Initialize nodes with simulation properties
    this._nodes = nodes.map((node, index) => ({
      ...node,
      index,
      x: node.x ?? this._random() * 100 - 50,
      y: node.y ?? this._random() * 100 - 50,
      vx: node.vx ?? 0,
      vy: node.vy ?? 0,
      mass: node.mass ?? 1,
      radius: node.radius ?? 8,
    } as N));

    // Re-initialize all forces with new nodes
    this.initializeForces();

    return this;
  }

  // ============================================================
  // Force Methods
  // ============================================================

  /**
   * Get a force by name
   */
  force(name: string): Force<N> | undefined;
  /**
   * Set or remove a force
   */
  force(name: string, force: Force<N> | null): this;
  force(name: string, force?: Force<N> | null): Force<N> | undefined | this {
    if (force === undefined) {
      return this._forces.get(name);
    }

    if (force === null) {
      this._forces.delete(name);
    } else {
      this._forces.set(name, force);
      // Initialize the force with current nodes
      if (force.initialize && this._nodes.length > 0) {
        force.initialize(this._nodes, this._random);
      }
    }

    return this;
  }

  /**
   * Get all force names
   */
  forceNames(): string[] {
    return Array.from(this._forces.keys());
  }

  // ============================================================
  // Event Methods
  // ============================================================

  /**
   * Register an event callback
   */
  on(event: "tick", callback: SimulationEventCallback): this;
  on(event: "end", callback: SimulationEventCallback): this;
  on(event: SimulationEvent, callback: SimulationEventCallback): this {
    if (event === "tick") {
      this._tickCallbacks.push(callback);
    } else if (event === "end") {
      this._endCallbacks.push(callback);
    }
    return this;
  }

  /**
   * Remove an event callback
   */
  off(event: "tick", callback: SimulationEventCallback): this;
  off(event: "end", callback: SimulationEventCallback): this;
  off(event: SimulationEvent, callback: SimulationEventCallback): this {
    if (event === "tick") {
      const index = this._tickCallbacks.indexOf(callback);
      if (index >= 0) this._tickCallbacks.splice(index, 1);
    } else if (event === "end") {
      const index = this._endCallbacks.indexOf(callback);
      if (index >= 0) this._endCallbacks.splice(index, 1);
    }
    return this;
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Find the node closest to a point
   * @param x X coordinate
   * @param y Y coordinate
   * @param radius Maximum search radius (default: Infinity)
   * @returns The closest node within the radius, or undefined
   */
  find(x: number, y: number, radius: number = Infinity): N | undefined {
    let closestNode: N | undefined;
    let closestDistance = radius * radius;

    for (const node of this._nodes) {
      const dx = node.x - x;
      const dy = node.y - y;
      const d2 = dx * dx + dy * dy;

      if (d2 < closestDistance) {
        closestDistance = d2;
        closestNode = node;
      }
    }

    return closestNode;
  }

  /**
   * Set the random source function
   */
  randomSource(): () => number;
  randomSource(source: () => number): this;
  randomSource(source?: () => number): (() => number) | this {
    if (source === undefined) return this._random;
    this._random = source;
    return this;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private scheduleFrame(): void {
    if (!this._running) return;

    this._animationId = requestAnimationFrame(() => {
      this.animationLoop();
    });
  }

  private animationLoop(): void {
    if (!this._running) return;

    this.executeTick();

    // Check if simulation should stop
    if (this._alpha < this._alphaMin) {
      this.stop();
      this.emitEnd();
      return;
    }

    this.scheduleFrame();
  }

  private executeTick(): void {
    const tickStart = performance.now();

    // Decay alpha
    this._alpha += (this._alphaTarget - this._alpha) * this._alphaDecay;

    // Apply all forces
    for (const force of this._forces.values()) {
      force(this._alpha);
    }

    // Update positions based on velocities
    this.updatePositions();

    // Update metrics
    const tickTime = performance.now() - tickStart;
    this.updateMetrics(tickTime);

    // Emit tick event
    this.emitTick();
  }

  private updatePositions(): void {
    for (const node of this._nodes) {
      // Handle fixed positions
      if (node.fx != null) {
        node.x = node.fx;
        node.vx = 0;
      } else {
        node.vx *= this._velocityDecay;
        node.x += node.vx;
      }

      if (node.fy != null) {
        node.y = node.fy;
        node.vy = 0;
      } else {
        node.vy *= this._velocityDecay;
        node.y += node.vy;
      }
    }
  }

  private initializeForces(): void {
    for (const force of this._forces.values()) {
      if (force.initialize) {
        force.initialize(this._nodes, this._random);
      }
    }
  }

  private updateMetrics(tickTime: number): void {
    this._metrics.lastTickTime = tickTime;
    this._metrics.totalTicks++;
    this._metrics.totalTime += tickTime;

    // Track recent tick times for averaging
    this._tickTimes.push(tickTime);
    if (this._tickTimes.length > 60) {
      this._tickTimes.shift();
    }

    // Calculate average
    this._metrics.avgTickTime =
      this._tickTimes.reduce((a, b) => a + b, 0) / this._tickTimes.length;

    // Calculate FPS
    const now = performance.now();
    if (this._lastFrameTime > 0) {
      const frameTime = now - this._lastFrameTime;
      this._metrics.fps = frameTime > 0 ? 1000 / frameTime : 0;
    }
    this._lastFrameTime = now;
  }

  private emitTick(): void {
    for (const callback of this._tickCallbacks) {
      callback();
    }
  }

  private emitEnd(): void {
    for (const callback of this._endCallbacks) {
      callback();
    }
  }
}

// ============================================================
// Force Implementations
// ============================================================

/**
 * Center force - pulls nodes toward a center point
 */
export interface ForceCenterConfig {
  /** Center X coordinate */
  x?: number;
  /** Center Y coordinate */
  y?: number;
  /** Force strength (0-1) */
  strength?: number;
}

/**
 * Creates a centering force that keeps nodes around a center point
 */
export function forceCenter<N extends SimulationNode = SimulationNode>(
  x: number = 0,
  y: number = 0,
  config: Omit<ForceCenterConfig, "x" | "y"> = {}
): Force<N> & {
  x(): number;
  x(value: number): Force<N>;
  y(): number;
  y(value: number): Force<N>;
  strength(): number;
  strength(value: number): Force<N>;
} {
  let centerX = x;
  let centerY = y;
  let strength = config.strength ?? 1;
  let nodes: N[] = [];

  const force = function (alpha: number) {
    const n = nodes.length;
    if (n === 0) return;

    // Calculate current center of mass
    let sx = 0;
    let sy = 0;
    for (const node of nodes) {
      sx += node.x;
      sy += node.y;
    }
    sx /= n;
    sy /= n;

    // Apply centering force
    const k = alpha * strength;
    const dx = (centerX - sx) * k;
    const dy = (centerY - sy) * k;

    for (const node of nodes) {
      if (node.fx == null) node.x += dx;
      if (node.fy == null) node.y += dy;
    }
  } as Force<N> & {
    x(): number;
    x(value: number): Force<N>;
    y(): number;
    y(value: number): Force<N>;
    strength(): number;
    strength(value: number): Force<N>;
  };

  force.initialize = (n: N[]) => {
    nodes = n;
  };

  force.x = function (value?: number): number | typeof force {
    if (value === undefined) return centerX;
    centerX = value;
    return force;
  } as { (): number; (value: number): typeof force };

  force.y = function (value?: number): number | typeof force {
    if (value === undefined) return centerY;
    centerY = value;
    return force;
  } as { (): number; (value: number): typeof force };

  force.strength = function (value?: number): number | typeof force {
    if (value === undefined) return strength;
    strength = value;
    return force;
  } as { (): number; (value: number): typeof force };

  return force;
}

/**
 * Link force configuration
 */
export interface ForceLinkConfig<N extends SimulationNode = SimulationNode> {
  /** Target link distance */
  distance?: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
  /** Link strength */
  strength?: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
  /** Number of iterations per tick */
  iterations?: number;
}

/**
 * Link with resolved node references
 */
interface ResolvedLink<N extends SimulationNode> {
  source: N;
  target: N;
  index: number;
  distance: number;
  strength: number;
  bias: number;
}

/**
 * Creates a link force that maintains distance between connected nodes
 */
export function forceLink<N extends SimulationNode = SimulationNode>(
  links: SimulationLink<N>[] = [],
  config: ForceLinkConfig<N> = {}
): Force<N> & {
  links(): SimulationLink<N>[];
  links(value: SimulationLink<N>[]): Force<N>;
  distance(): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
  distance(value: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)): Force<N>;
  strength(): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
  strength(value: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)): Force<N>;
  iterations(): number;
  iterations(value: number): Force<N>;
} {
  let _links = links;
  let _distance = config.distance ?? 30;
  let _strength = config.strength ?? 1;
  let _iterations = config.iterations ?? 1;

  let nodeById: Map<string, N> = new Map();
  let resolvedLinks: ResolvedLink<N>[] = [];
  let count: Map<N, number> = new Map();

  function initializeLinks() {
    resolvedLinks = [];
    count = new Map();

    for (let i = 0; i < _links.length; i++) {
      const link = _links[i];
      const source = typeof link.source === "string"
        ? nodeById.get(link.source)
        : link.source;
      const target = typeof link.target === "string"
        ? nodeById.get(link.target)
        : link.target;

      if (!source || !target) continue;

      // Count links per node for bias calculation
      count.set(source, (count.get(source) ?? 0) + 1);
      count.set(target, (count.get(target) ?? 0) + 1);

      const distance = typeof _distance === "function"
        ? _distance(link, i, _links)
        : _distance;

      const strength = typeof _strength === "function"
        ? _strength(link, i, _links)
        : _strength;

      resolvedLinks.push({
        source,
        target,
        index: i,
        distance,
        strength,
        bias: 0, // Will be calculated after all links processed
      });
    }

    // Calculate bias based on degree (nodes with more connections move less)
    for (const link of resolvedLinks) {
      const sourceCount = count.get(link.source) ?? 1;
      const targetCount = count.get(link.target) ?? 1;
      link.bias = sourceCount / (sourceCount + targetCount);
    }
  }

  const force = function (alpha: number) {
    for (let iteration = 0; iteration < _iterations; iteration++) {
      for (const link of resolvedLinks) {
        const source = link.source;
        const target = link.target;

        let dx = target.x - source.x;
        let dy = target.y - source.y;

        // Handle coincident nodes
        let l = Math.sqrt(dx * dx + dy * dy);
        if (l === 0) {
          dx = (Math.random() - 0.5) * 1e-6;
          dy = (Math.random() - 0.5) * 1e-6;
          l = Math.sqrt(dx * dx + dy * dy);
        }

        // Calculate spring force
        const k = (l - link.distance) / l * alpha * link.strength;
        dx *= k;
        dy *= k;

        // Apply force based on bias (heavier nodes move less)
        const tb = link.bias;
        const sb = 1 - tb;

        if (target.fx == null) target.x -= dx * tb;
        if (target.fy == null) target.y -= dy * tb;
        if (source.fx == null) source.x += dx * sb;
        if (source.fy == null) source.y += dy * sb;
      }
    }
  } as Force<N> & {
    links(): SimulationLink<N>[];
    links(value: SimulationLink<N>[]): Force<N>;
    distance(): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
    distance(value: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)): Force<N>;
    strength(): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
    strength(value: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)): Force<N>;
    iterations(): number;
    iterations(value: number): Force<N>;
  };

  force.initialize = (n: N[]) => {
    nodeById = new Map(n.map((node) => [node.id, node]));
    initializeLinks();
  };

  force.links = function (value?: SimulationLink<N>[]): SimulationLink<N>[] | typeof force {
    if (value === undefined) return _links;
    _links = value;
    initializeLinks();
    return force;
  } as { (): SimulationLink<N>[]; (value: SimulationLink<N>[]): typeof force };

  force.distance = function (
    value?: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)
  ): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number) | typeof force {
    if (value === undefined) return _distance;
    _distance = value;
    initializeLinks();
    return force;
  } as {
    (): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
    (value: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)): typeof force;
  };

  force.strength = function (
    value?: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)
  ): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number) | typeof force {
    if (value === undefined) return _strength;
    _strength = value;
    initializeLinks();
    return force;
  } as {
    (): number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number);
    (value: number | ((link: SimulationLink<N>, index: number, links: SimulationLink<N>[]) => number)): typeof force;
  };

  force.iterations = function (value?: number): number | typeof force {
    if (value === undefined) return _iterations;
    _iterations = value;
    return force;
  } as { (): number; (value: number): typeof force };

  return force;
}

/**
 * Many-body force configuration
 */
export interface ForceManyBodyConfig {
  /** Charge strength (negative for repulsion, positive for attraction) */
  strength?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  /** Minimum distance between nodes */
  distanceMin?: number;
  /** Maximum distance for force calculation */
  distanceMax?: number;
  /** Barnes-Hut approximation threshold */
  theta?: number;
}

/**
 * Creates a many-body force (charge/repulsion)
 *
 * Uses Barnes-Hut algorithm for O(n log n) complexity
 */
export function forceManyBody<N extends SimulationNode = SimulationNode>(
  config: ForceManyBodyConfig = {}
): Force<N> & {
  strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  strength(value: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number)): Force<N>;
  distanceMin(): number;
  distanceMin(value: number): Force<N>;
  distanceMax(): number;
  distanceMax(value: number): Force<N>;
  theta(): number;
  theta(value: number): Force<N>;
} {
  let _strength = config.strength ?? -30;
  let _distanceMin = config.distanceMin ?? 1;
  let _distanceMax = config.distanceMax ?? Infinity;
  let _theta = config.theta ?? 0.9;

  let nodes: N[] = [];
  let barnesHut: BarnesHutForce | null = null;

  function initialize() {
    if (nodes.length === 0) return;

    // Create Barnes-Hut force with current configuration
    // Need to adapt the strength function to BarnesHutForce's SimulationNode type
    let strengthForBH: number | ((node: BHSimulationNode, index: number, nodes: BHSimulationNode[]) => number);
    if (typeof _strength === "function") {
      const strengthFn = _strength as (node: N, index: number, nodes: N[]) => number;
      strengthForBH = (node: BHSimulationNode, index: number, allNodes: BHSimulationNode[]) =>
        strengthFn(node as unknown as N, index, allNodes as unknown as N[]);
    } else {
      strengthForBH = _strength;
    }

    barnesHut = new BarnesHutForce({
      theta: _theta,
      strength: strengthForBH,
      distanceMin: _distanceMin,
      distanceMax: _distanceMax,
    });

    // Initialize with nodes (need to cast to BHSimulationNode compatible type)
    const bhNodes: BHSimulationNode[] = nodes.map((node, index) => ({
      ...node,
      index,
    }));
    barnesHut.initialize(bhNodes);
  }

  const force = function (alpha: number) {
    if (!barnesHut || nodes.length === 0) return;

    // Create compatible node array for Barnes-Hut
    const bhNodes: BHSimulationNode[] = nodes.map((node, index) => ({
      x: node.x,
      y: node.y,
      vx: node.vx,
      vy: node.vy,
      index,
    }));

    // Apply Barnes-Hut force
    barnesHut.initialize(bhNodes);
    barnesHut.force(alpha);

    // Copy velocities back
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].fx == null) nodes[i].vx = bhNodes[i].vx ?? 0;
      if (nodes[i].fy == null) nodes[i].vy = bhNodes[i].vy ?? 0;
    }
  } as Force<N> & {
    strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    strength(value: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number)): Force<N>;
    distanceMin(): number;
    distanceMin(value: number): Force<N>;
    distanceMax(): number;
    distanceMax(value: number): Force<N>;
    theta(): number;
    theta(value: number): Force<N>;
  };

  force.initialize = (n: N[]) => {
    nodes = n;
    initialize();
  };

  force.strength = function (
    value?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _strength;
    _strength = value;
    initialize();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number)): typeof force;
  };

  force.distanceMin = function (value?: number): number | typeof force {
    if (value === undefined) return _distanceMin;
    _distanceMin = value;
    initialize();
    return force;
  } as { (): number; (value: number): typeof force };

  force.distanceMax = function (value?: number): number | typeof force {
    if (value === undefined) return _distanceMax;
    _distanceMax = value;
    initialize();
    return force;
  } as { (): number; (value: number): typeof force };

  force.theta = function (value?: number): number | typeof force {
    if (value === undefined) return _theta;
    _theta = value;
    initialize();
    return force;
  } as { (): number; (value: number): typeof force };

  return force;
}

/**
 * Collision force configuration
 */
export interface ForceCollideConfig {
  /** Node radius (or function returning radius) */
  radius?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  /** Force strength (0-1) */
  strength?: number;
  /** Number of iterations per tick */
  iterations?: number;
}

/**
 * Creates a collision detection force that prevents node overlap
 */
export function forceCollide<N extends SimulationNode = SimulationNode>(
  radius?: number | ((node: N, index: number, nodes: N[]) => number),
  config: Omit<ForceCollideConfig, "radius"> = {}
): Force<N> & {
  radius(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  radius(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
  strength(): number;
  strength(value: number): Force<N>;
  iterations(): number;
  iterations(value: number): Force<N>;
} {
  let _radius = radius ?? ((node: N) => node.radius ?? 8);
  let _strength = config.strength ?? 0.7;
  let _iterations = config.iterations ?? 1;

  let nodes: N[] = [];
  let radii: number[] = [];

  function initializeRadii() {
    if (typeof _radius === "function") {
      const radiusFn = _radius as (node: N, index: number, nodes: N[]) => number;
      radii = nodes.map((node, i) => radiusFn(node, i, nodes));
    } else {
      radii = nodes.map(() => _radius as number);
    }
  }

  const force = function (_alpha: number) {
    for (let iteration = 0; iteration < _iterations; iteration++) {
      // Simple O(n²) collision detection
      // For large graphs, could be optimized with quadtree
      for (let i = 0; i < nodes.length; i++) {
        const ni = nodes[i];
        const ri = radii[i];

        for (let j = i + 1; j < nodes.length; j++) {
          const nj = nodes[j];
          const rj = radii[j];

          let dx = ni.x - nj.x;
          let dy = ni.y - nj.y;
          const l = Math.sqrt(dx * dx + dy * dy);
          const r = ri + rj;

          if (l < r && l > 0) {
            // Nodes are overlapping
            const k = ((r - l) / l) * _strength * 0.5;
            dx *= k;
            dy *= k;

            if (ni.fx == null) ni.x += dx;
            if (ni.fy == null) ni.y += dy;
            if (nj.fx == null) nj.x -= dx;
            if (nj.fy == null) nj.y -= dy;
          }
        }
      }
    }
  } as Force<N> & {
    radius(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    radius(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
    strength(): number;
    strength(value: number): Force<N>;
    iterations(): number;
    iterations(value: number): Force<N>;
  };

  force.initialize = (n: N[]) => {
    nodes = n;
    initializeRadii();
  };

  force.radius = function (
    value?: number | ((node: N, index: number, nodes: N[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _radius as number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    _radius = value;
    initializeRadii();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: N, index: number, nodes: N[]) => number)): typeof force;
  };

  force.strength = function (value?: number): number | typeof force {
    if (value === undefined) return _strength;
    _strength = value;
    return force;
  } as { (): number; (value: number): typeof force };

  force.iterations = function (value?: number): number | typeof force {
    if (value === undefined) return _iterations;
    _iterations = value;
    return force;
  } as { (): number; (value: number): typeof force };

  return force;
}

/**
 * Radial force configuration
 */
export interface ForceRadialConfig {
  /** Target radius from center */
  radius?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  /** Center X coordinate */
  x?: number;
  /** Center Y coordinate */
  y?: number;
  /** Force strength */
  strength?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
}

/**
 * Creates a radial positioning force that moves nodes toward a circle
 */
export function forceRadial<N extends SimulationNode = SimulationNode>(
  radius: number,
  x: number = 0,
  y: number = 0,
  config: Omit<ForceRadialConfig, "radius" | "x" | "y"> = {}
): Force<N> & {
  radius(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  radius(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
  x(): number;
  x(value: number): Force<N>;
  y(): number;
  y(value: number): Force<N>;
  strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  strength(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
} {
  let _radius: number | ((node: N, index: number, nodes: N[]) => number) = radius;
  let _x = x;
  let _y = y;
  let _strength = config.strength ?? 0.1;

  let nodes: N[] = [];
  let radii: number[] = [];
  let strengths: number[] = [];

  function initialize() {
    if (typeof _radius === "function") {
      const radiusFn = _radius as (node: N, index: number, nodes: N[]) => number;
      radii = nodes.map((node, i) => radiusFn(node, i, nodes));
    } else {
      radii = nodes.map(() => _radius as number);
    }

    if (typeof _strength === "function") {
      const strengthFn = _strength as (node: N, index: number, nodes: N[]) => number;
      strengths = nodes.map((node, i) => strengthFn(node, i, nodes));
    } else {
      strengths = nodes.map(() => _strength as number);
    }
  }

  const force = function (alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const dx = node.x - _x;
      const dy = node.y - _y;
      const r = Math.sqrt(dx * dx + dy * dy);

      if (r > 0) {
        const k = ((radii[i] - r) * strengths[i] * alpha) / r;
        if (node.fx == null) node.vx += dx * k;
        if (node.fy == null) node.vy += dy * k;
      }
    }
  } as Force<N> & {
    radius(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    radius(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
    x(): number;
    x(value: number): Force<N>;
    y(): number;
    y(value: number): Force<N>;
    strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    strength(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
  };

  force.initialize = (n: N[]) => {
    nodes = n;
    initialize();
  };

  force.radius = function (
    value?: number | ((node: N, index: number, nodes: N[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _radius as number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    _radius = value;
    initialize();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: N, index: number, nodes: N[]) => number)): typeof force;
  };

  force.x = function (value?: number): number | typeof force {
    if (value === undefined) return _x;
    _x = value;
    return force;
  } as { (): number; (value: number): typeof force };

  force.y = function (value?: number): number | typeof force {
    if (value === undefined) return _y;
    _y = value;
    return force;
  } as { (): number; (value: number): typeof force };

  force.strength = function (
    value?: number | ((node: N, index: number, nodes: N[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _strength as number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    _strength = value as typeof _strength;
    initialize();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: N, index: number, nodes: N[]) => number)): typeof force;
  };

  return force;
}

/**
 * X-positioning force configuration
 */
export interface ForceXConfig {
  /** Target X coordinate */
  x?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  /** Force strength */
  strength?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
}

/**
 * Creates an X-positioning force that moves nodes toward a target X
 */
export function forceX<N extends SimulationNode = SimulationNode>(
  x: number = 0,
  config: Omit<ForceXConfig, "x"> = {}
): Force<N> & {
  x(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  x(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
  strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  strength(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
} {
  let _x: number | ((node: N, index: number, nodes: N[]) => number) = x;
  let _strength = config.strength ?? 0.1;

  let nodes: N[] = [];
  let xz: number[] = [];
  let strengths: number[] = [];

  function initialize() {
    if (typeof _x === "function") {
      const xFn = _x as (node: N, index: number, nodes: N[]) => number;
      xz = nodes.map((node, i) => xFn(node, i, nodes));
    } else {
      xz = nodes.map(() => _x as number);
    }

    if (typeof _strength === "function") {
      const strengthFn = _strength as (node: N, index: number, nodes: N[]) => number;
      strengths = nodes.map((node, i) => strengthFn(node, i, nodes));
    } else {
      strengths = nodes.map(() => _strength as number);
    }
  }

  const force = function (alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.fx == null) {
        node.vx += (xz[i] - node.x) * strengths[i] * alpha;
      }
    }
  } as Force<N> & {
    x(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    x(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
    strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    strength(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
  };

  force.initialize = (n: N[]) => {
    nodes = n;
    initialize();
  };

  force.x = function (
    value?: number | ((node: N, index: number, nodes: N[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _x as number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    _x = value;
    initialize();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: N, index: number, nodes: N[]) => number)): typeof force;
  };

  force.strength = function (
    value?: number | ((node: N, index: number, nodes: N[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _strength as number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    _strength = value as typeof _strength;
    initialize();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: N, index: number, nodes: N[]) => number)): typeof force;
  };

  return force;
}

/**
 * Y-positioning force configuration
 */
export interface ForceYConfig {
  /** Target Y coordinate */
  y?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  /** Force strength */
  strength?: number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
}

/**
 * Creates a Y-positioning force that moves nodes toward a target Y
 */
export function forceY<N extends SimulationNode = SimulationNode>(
  y: number = 0,
  config: Omit<ForceYConfig, "y"> = {}
): Force<N> & {
  y(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  y(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
  strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
  strength(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
} {
  let _y: number | ((node: N, index: number, nodes: N[]) => number) = y;
  let _strength = config.strength ?? 0.1;

  let nodes: N[] = [];
  let yz: number[] = [];
  let strengths: number[] = [];

  function initialize() {
    if (typeof _y === "function") {
      const yFn = _y as (node: N, index: number, nodes: N[]) => number;
      yz = nodes.map((node, i) => yFn(node, i, nodes));
    } else {
      yz = nodes.map(() => _y as number);
    }

    if (typeof _strength === "function") {
      const strengthFn = _strength as (node: N, index: number, nodes: N[]) => number;
      strengths = nodes.map((node, i) => strengthFn(node, i, nodes));
    } else {
      strengths = nodes.map(() => _strength as number);
    }
  }

  const force = function (alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.fy == null) {
        node.vy += (yz[i] - node.y) * strengths[i] * alpha;
      }
    }
  } as Force<N> & {
    y(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    y(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
    strength(): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    strength(value: number | ((node: N, index: number, nodes: N[]) => number)): Force<N>;
  };

  force.initialize = (n: N[]) => {
    nodes = n;
    initialize();
  };

  force.y = function (
    value?: number | ((node: N, index: number, nodes: N[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _y as number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    _y = value;
    initialize();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: N, index: number, nodes: N[]) => number)): typeof force;
  };

  force.strength = function (
    value?: number | ((node: N, index: number, nodes: N[]) => number)
  ): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number) | typeof force {
    if (value === undefined) return _strength as number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    _strength = value as typeof _strength;
    initialize();
    return force;
  } as {
    (): number | ((node: SimulationNode, index: number, nodes: SimulationNode[]) => number);
    (value: number | ((node: N, index: number, nodes: N[]) => number)): typeof force;
  };

  return force;
}
