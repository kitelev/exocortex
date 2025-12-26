/**
 * LayoutManager - Layout algorithm orchestration with smooth transitions
 *
 * Provides smooth animated transitions between different layout algorithms
 * with state preservation, interpolation strategies, and user-controlled
 * transition parameters.
 *
 * Features:
 * - Multiple layout algorithm support (force, hierarchical, radial, circular, grid, temporal)
 * - Smooth animated transitions between layouts
 * - Configurable easing functions
 * - State preservation during transitions
 * - RAF-based animation loop
 * - Progress callbacks for UI updates
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphData } from "./types";
import { HierarchicalLayout } from "./HierarchicalLayout";
import { RadialLayout } from "./RadialLayout";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * 2D point coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Easing function type - takes progress (0-1) and returns eased value (0-1)
 */
export type EasingFunctionImpl = (t: number) => number;

/**
 * Available easing function names
 */
export type EasingFunction =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeOutElastic"
  | "easeOutBounce"
  | "spring";

/**
 * Options for layout transitions
 */
export interface LayoutTransitionOptions {
  /** Animation duration in milliseconds (default: 500) */
  duration: number;

  /** Easing function name (default: 'easeInOutCubic') */
  easing: EasingFunction;

  /** Delay between node animations for stagger effect in ms (default: 0) */
  staggerDelay: number;

  /** Maximum total stagger time in ms (default: 200) */
  maxStaggerTime: number;

  /** Keep current pan/zoom during transition (default: true) */
  preserveViewport: boolean;

  /** Callback when transition starts */
  onStart?: () => void;

  /** Callback during transition with progress 0-1 */
  onProgress?: (progress: number) => void;

  /** Callback when transition completes */
  onComplete?: () => void;

  /** Callback if transition is interrupted */
  onInterrupt?: () => void;
}

/**
 * Available layout algorithm names
 */
export type LayoutAlgorithmName =
  | "force"
  | "hierarchical"
  | "radial"
  | "circular"
  | "grid"
  | "temporal";

/**
 * Layout algorithm interface - all layout algorithms implement this
 */
export interface LayoutAlgorithm<TOptions = Record<string, unknown>, TResult = LayoutResult> {
  /** Algorithm name for identification */
  readonly name: LayoutAlgorithmName;

  /** Compute layout positions for the given graph */
  layout(graph: GraphData, options?: Partial<TOptions>): TResult;
}

/**
 * Generic layout result with positions
 */
export interface LayoutResult {
  /** Node positions indexed by node ID */
  positions: Map<string, Point>;

  /** Layout bounds */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

/**
 * Internal state of the layout manager
 */
export interface LayoutManagerState {
  /** Currently active layout algorithm name */
  currentLayout: LayoutAlgorithmName;

  /** Target layout during transition (null if not transitioning) */
  targetLayout: LayoutAlgorithmName | null;

  /** Whether a transition is in progress */
  isTransitioning: boolean;

  /** Current transition progress (0-1) */
  transitionProgress: number;

  /** Current node positions */
  currentPositions: Map<string, Point>;

  /** Target node positions (during transition) */
  targetPositions: Map<string, Point>;

  /** Start positions for transition interpolation */
  startPositions: Map<string, Point>;
}

/**
 * Configuration for LayoutManager
 */
export interface LayoutManagerConfig {
  /** Default transition options */
  defaultTransitionOptions: LayoutTransitionOptions;

  /** Whether to auto-start layout on data change */
  autoLayout: boolean;

  /** Default layout algorithm */
  defaultLayout: LayoutAlgorithmName;
}

/**
 * Layout manager events
 */
export type LayoutManagerEventType =
  | "layoutChange"
  | "transitionStart"
  | "transitionProgress"
  | "transitionComplete"
  | "transitionInterrupt";

/**
 * Layout manager event data
 */
export interface LayoutManagerEvent {
  type: LayoutManagerEventType;
  previousLayout?: LayoutAlgorithmName;
  currentLayout: LayoutAlgorithmName;
  progress?: number;
}

/**
 * Event listener callback
 */
export type LayoutManagerEventListener = (event: LayoutManagerEvent) => void;

// ============================================================
// Easing Functions
// ============================================================

/**
 * Collection of easing functions for smooth animations
 */
export const EASING_FUNCTIONS: Record<EasingFunction, EasingFunctionImpl> = {
  /** Linear interpolation - no easing */
  linear: (t: number): number => t,

  /** Ease in - accelerate from zero */
  easeIn: (t: number): number => t * t,

  /** Ease out - decelerate to zero */
  easeOut: (t: number): number => t * (2 - t),

  /** Ease in-out - accelerate then decelerate (quadratic) */
  easeInOut: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  /** Ease in cubic - stronger acceleration */
  easeInCubic: (t: number): number => t * t * t,

  /** Ease out cubic - stronger deceleration */
  easeOutCubic: (t: number): number => {
    const t1 = t - 1;
    return t1 * t1 * t1 + 1;
  },

  /** Ease in-out cubic - smooth S-curve (recommended default) */
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  /** Elastic ease out - overshoots then settles */
  easeOutElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const p = 0.3;
    const s = p / 4;
    return Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
  },

  /** Bounce ease out - bounces at the end */
  easeOutBounce: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;

    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      const t1 = t - 1.5 / d1;
      return n1 * t1 * t1 + 0.75;
    } else if (t < 2.5 / d1) {
      const t1 = t - 2.25 / d1;
      return n1 * t1 * t1 + 0.9375;
    } else {
      const t1 = t - 2.625 / d1;
      return n1 * t1 * t1 + 0.984375;
    }
  },

  /** Spring easing - physics-based spring motion */
  spring: (t: number): number => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default transition options
 */
export const DEFAULT_TRANSITION_OPTIONS: LayoutTransitionOptions = {
  duration: 500,
  easing: "easeInOutCubic",
  staggerDelay: 0,
  maxStaggerTime: 200,
  preserveViewport: true,
};

/**
 * Default layout manager configuration
 */
export const DEFAULT_LAYOUT_MANAGER_CONFIG: LayoutManagerConfig = {
  defaultTransitionOptions: DEFAULT_TRANSITION_OPTIONS,
  autoLayout: true,
  defaultLayout: "force",
};

// ============================================================
// LayoutManager Class
// ============================================================

/**
 * Layout Manager for orchestrating graph layouts with smooth transitions
 *
 * Manages multiple layout algorithms and provides smooth animated
 * transitions between them with configurable easing and timing.
 *
 * @example
 * ```typescript
 * const manager = new LayoutManager(graphData, {
 *   defaultLayout: 'force',
 * });
 *
 * // Register custom layouts
 * manager.registerLayout(new TemporalLayout());
 *
 * // Switch layouts with animation
 * await manager.switchLayout('hierarchical', {
 *   duration: 750,
 *   easing: 'easeOutElastic',
 *   onProgress: (p) => console.log(`${p * 100}%`),
 * });
 *
 * // Get current positions
 * const positions = manager.getPositions();
 * ```
 */
export class LayoutManager {
  private config: LayoutManagerConfig;
  private state: LayoutManagerState;
  private graphData: GraphData;
  private layoutRegistry: Map<LayoutAlgorithmName, LayoutAlgorithm> = new Map();
  private animationFrame: number | null = null;
  private transitionStartTime: number = 0;
  private currentTransitionOptions: LayoutTransitionOptions | null = null;
  private eventListeners: Map<LayoutManagerEventType, Set<LayoutManagerEventListener>> = new Map();

  constructor(
    graphData: GraphData,
    config: Partial<LayoutManagerConfig> = {}
  ) {
    this.config = { ...DEFAULT_LAYOUT_MANAGER_CONFIG, ...config };
    this.graphData = graphData;

    // Initialize state
    this.state = {
      currentLayout: this.config.defaultLayout,
      targetLayout: null,
      isTransitioning: false,
      transitionProgress: 0,
      currentPositions: new Map(),
      targetPositions: new Map(),
      startPositions: new Map(),
    };

    // Initialize event listener maps
    const eventTypes: LayoutManagerEventType[] = [
      "layoutChange",
      "transitionStart",
      "transitionProgress",
      "transitionComplete",
      "transitionInterrupt",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }

    // Register built-in layouts
    this.registerBuiltInLayouts();

    // Initial layout if auto-layout enabled
    if (this.config.autoLayout && graphData.nodes.length > 0) {
      this.applyLayout(this.config.defaultLayout);
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Register a layout algorithm
   */
  registerLayout(layout: LayoutAlgorithm): void {
    this.layoutRegistry.set(layout.name, layout);
  }

  /**
   * Get registered layout names
   */
  getRegisteredLayouts(): LayoutAlgorithmName[] {
    return Array.from(this.layoutRegistry.keys());
  }

  /**
   * Get current layout algorithm name
   */
  getCurrentLayout(): LayoutAlgorithmName {
    return this.state.currentLayout;
  }

  /**
   * Check if a transition is in progress
   */
  isTransitioning(): boolean {
    return this.state.isTransitioning;
  }

  /**
   * Get current transition progress (0-1)
   */
  getTransitionProgress(): number {
    return this.state.transitionProgress;
  }

  /**
   * Get current node positions
   */
  getPositions(): Map<string, Point> {
    return new Map(this.state.currentPositions);
  }

  /**
   * Get position for a specific node
   */
  getNodePosition(nodeId: string): Point | undefined {
    return this.state.currentPositions.get(nodeId);
  }

  /**
   * Get current state (read-only copy)
   */
  getState(): Readonly<LayoutManagerState> {
    return {
      ...this.state,
      currentPositions: new Map(this.state.currentPositions),
      targetPositions: new Map(this.state.targetPositions),
      startPositions: new Map(this.state.startPositions),
    };
  }

  /**
   * Switch to a new layout with animated transition
   *
   * @param layoutName Target layout algorithm name
   * @param options Transition options
   * @returns Promise that resolves when transition completes
   */
  async switchLayout(
    layoutName: LayoutAlgorithmName,
    options: Partial<LayoutTransitionOptions> = {}
  ): Promise<void> {
    // Validate layout exists
    if (!this.layoutRegistry.has(layoutName)) {
      throw new Error(`Layout "${layoutName}" is not registered`);
    }

    // If same layout, do nothing
    if (layoutName === this.state.currentLayout && !this.state.isTransitioning) {
      return;
    }

    // Interrupt any existing transition
    if (this.state.isTransitioning) {
      this.interruptTransition();
    }

    // Merge options with defaults
    const transitionOptions: LayoutTransitionOptions = {
      ...this.config.defaultTransitionOptions,
      ...options,
    };

    // Compute target positions
    const layout = this.layoutRegistry.get(layoutName)!;
    const result = layout.layout(this.graphData);

    // Store start positions (current positions or center if empty)
    this.state.startPositions = new Map(this.state.currentPositions);
    if (this.state.startPositions.size === 0) {
      // Initialize positions at center
      for (const node of this.graphData.nodes) {
        this.state.startPositions.set(node.id, { x: 0, y: 0 });
      }
    }

    // Store target positions
    this.state.targetPositions = result.positions;

    // Add any new nodes that don't have start positions
    for (const [nodeId, targetPos] of result.positions) {
      if (!this.state.startPositions.has(nodeId)) {
        // New node - start from target position (fade in effect)
        this.state.startPositions.set(nodeId, { ...targetPos });
      }
    }

    // Update state
    const previousLayout = this.state.currentLayout;
    this.state.targetLayout = layoutName;
    this.state.isTransitioning = true;
    this.state.transitionProgress = 0;
    this.currentTransitionOptions = transitionOptions;
    this.transitionStartTime = performance.now();

    // Emit start event
    this.emit("transitionStart", {
      type: "transitionStart",
      previousLayout,
      currentLayout: layoutName,
      progress: 0,
    });

    // Call onStart callback
    transitionOptions.onStart?.();

    // Run animation
    return new Promise<void>((resolve) => {
      const animate = (timestamp: number) => {
        const elapsed = timestamp - this.transitionStartTime;
        const progress = Math.min(elapsed / transitionOptions.duration, 1);

        // Apply easing
        const easingFn = EASING_FUNCTIONS[transitionOptions.easing];
        const easedProgress = easingFn(progress);

        // Update positions with interpolation
        this.interpolatePositions(easedProgress, transitionOptions);

        // Update progress
        this.state.transitionProgress = progress;

        // Emit progress event
        this.emit("transitionProgress", {
          type: "transitionProgress",
          previousLayout,
          currentLayout: layoutName,
          progress,
        });

        // Call onProgress callback
        transitionOptions.onProgress?.(progress);

        if (progress < 1) {
          // Continue animation
          this.animationFrame = requestAnimationFrame(animate);
        } else {
          // Transition complete
          this.completeTransition(previousLayout, layoutName, transitionOptions);
          resolve();
        }
      };

      this.animationFrame = requestAnimationFrame(animate);
    });
  }

  /**
   * Apply a layout immediately without animation
   */
  applyLayout(layoutName: LayoutAlgorithmName): LayoutResult {
    if (!this.layoutRegistry.has(layoutName)) {
      throw new Error(`Layout "${layoutName}" is not registered`);
    }

    // Interrupt any existing transition
    if (this.state.isTransitioning) {
      this.interruptTransition();
    }

    const layout = this.layoutRegistry.get(layoutName)!;
    const result = layout.layout(this.graphData);

    const previousLayout = this.state.currentLayout;
    this.state.currentLayout = layoutName;
    this.state.currentPositions = result.positions;
    this.state.targetLayout = null;
    this.state.targetPositions.clear();
    this.state.startPositions.clear();

    // Emit event
    this.emit("layoutChange", {
      type: "layoutChange",
      previousLayout,
      currentLayout: layoutName,
    });

    return result;
  }

  /**
   * Update graph data and optionally re-apply current layout
   */
  updateGraphData(graphData: GraphData, reapplyLayout: boolean = true): void {
    this.graphData = graphData;

    if (reapplyLayout && this.config.autoLayout) {
      this.applyLayout(this.state.currentLayout);
    }
  }

  /**
   * Interrupt current transition
   */
  interruptTransition(): void {
    if (!this.state.isTransitioning) {
      return;
    }

    // Cancel animation frame
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    // Emit interrupt event
    this.emit("transitionInterrupt", {
      type: "transitionInterrupt",
      previousLayout: this.state.currentLayout,
      currentLayout: this.state.targetLayout || this.state.currentLayout,
      progress: this.state.transitionProgress,
    });

    // Call onInterrupt callback
    this.currentTransitionOptions?.onInterrupt?.();

    // Reset transition state (keep current positions as-is)
    this.state.isTransitioning = false;
    this.state.targetLayout = null;
    this.state.transitionProgress = 0;
    this.state.targetPositions.clear();
    this.state.startPositions.clear();
    this.currentTransitionOptions = null;
  }

  /**
   * Add event listener
   */
  on(eventType: LayoutManagerEventType, listener: LayoutManagerEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: LayoutManagerEventType, listener: LayoutManagerEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.interruptTransition();
    this.eventListeners.clear();
    this.layoutRegistry.clear();
    this.state.currentPositions.clear();
    this.state.targetPositions.clear();
    this.state.startPositions.clear();
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Register built-in layout algorithms
   */
  private registerBuiltInLayouts(): void {
    // Force layout adapter
    this.registerLayout({
      name: "force",
      layout: (graph: GraphData): LayoutResult => {
        // Simple initial positions for force layout
        // Actual force simulation would be handled by ForceSimulation
        const positions = new Map<string, Point>();
        const nodeCount = graph.nodes.length;

        graph.nodes.forEach((node, index) => {
          // Arrange in a circle initially
          const angle = (2 * Math.PI * index) / nodeCount;
          const radius = Math.sqrt(nodeCount) * 50;
          positions.set(node.id, {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
          });
        });

        return {
          positions,
          bounds: this.calculateBounds(positions),
        };
      },
    });

    // Hierarchical layout adapter
    this.registerLayout({
      name: "hierarchical",
      layout: (graph: GraphData): LayoutResult => {
        const hierarchicalLayout = new HierarchicalLayout();
        const result = hierarchicalLayout.layout(graph);
        return {
          positions: result.positions,
          bounds: result.bounds,
        };
      },
    });

    // Radial layout adapter
    this.registerLayout({
      name: "radial",
      layout: (graph: GraphData): LayoutResult => {
        const radialLayout = new RadialLayout();
        const result = radialLayout.layout(graph);
        return {
          positions: result.positions,
          bounds: {
            minX: result.bounds.minX,
            minY: result.bounds.minY,
            maxX: result.bounds.maxX,
            maxY: result.bounds.maxY,
            width: result.bounds.width,
            height: result.bounds.height,
          },
        };
      },
    });

    // Circular layout (nodes in a circle)
    this.registerLayout({
      name: "circular",
      layout: (graph: GraphData): LayoutResult => {
        const positions = new Map<string, Point>();
        const nodeCount = graph.nodes.length;
        const radius = Math.max(50, nodeCount * 20);

        graph.nodes.forEach((node, index) => {
          const angle = (2 * Math.PI * index) / nodeCount - Math.PI / 2;
          positions.set(node.id, {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
          });
        });

        return {
          positions,
          bounds: this.calculateBounds(positions),
        };
      },
    });

    // Grid layout
    this.registerLayout({
      name: "grid",
      layout: (graph: GraphData): LayoutResult => {
        const positions = new Map<string, Point>();
        const nodeCount = graph.nodes.length;
        const cols = Math.ceil(Math.sqrt(nodeCount));
        const spacing = 100;

        graph.nodes.forEach((node, index) => {
          const row = Math.floor(index / cols);
          const col = index % cols;
          positions.set(node.id, {
            x: col * spacing - ((cols - 1) * spacing) / 2,
            y: row * spacing - ((Math.ceil(nodeCount / cols) - 1) * spacing) / 2,
          });
        });

        return {
          positions,
          bounds: this.calculateBounds(positions),
        };
      },
    });

    // Temporal layout will be registered separately
  }

  /**
   * Interpolate between start and target positions
   */
  private interpolatePositions(
    progress: number,
    options: LayoutTransitionOptions
  ): void {
    const nodeCount = this.graphData.nodes.length;
    const staggerStep = nodeCount > 0
      ? Math.min(options.staggerDelay, options.maxStaggerTime / nodeCount)
      : 0;

    for (let i = 0; i < this.graphData.nodes.length; i++) {
      const node = this.graphData.nodes[i];
      const nodeId = node.id;

      const startPos = this.state.startPositions.get(nodeId);
      const targetPos = this.state.targetPositions.get(nodeId);

      if (!startPos || !targetPos) {
        continue;
      }

      // Calculate node-specific progress with stagger
      let nodeProgress = progress;
      if (staggerStep > 0 && options.duration > 0) {
        const staggerOffset = (i * staggerStep) / options.duration;
        nodeProgress = Math.max(0, Math.min(1, (progress - staggerOffset) / (1 - staggerOffset)));
        nodeProgress = EASING_FUNCTIONS[options.easing](nodeProgress);
      }

      // Linear interpolation
      const x = startPos.x + (targetPos.x - startPos.x) * nodeProgress;
      const y = startPos.y + (targetPos.y - startPos.y) * nodeProgress;

      this.state.currentPositions.set(nodeId, { x, y });
    }
  }

  /**
   * Complete the transition
   */
  private completeTransition(
    previousLayout: LayoutAlgorithmName,
    newLayout: LayoutAlgorithmName,
    options: LayoutTransitionOptions
  ): void {
    // Set final positions exactly to target
    this.state.currentPositions = new Map(this.state.targetPositions);

    // Update state
    this.state.currentLayout = newLayout;
    this.state.targetLayout = null;
    this.state.isTransitioning = false;
    this.state.transitionProgress = 1;
    this.state.targetPositions.clear();
    this.state.startPositions.clear();
    this.currentTransitionOptions = null;
    this.animationFrame = null;

    // Emit complete event
    this.emit("transitionComplete", {
      type: "transitionComplete",
      previousLayout,
      currentLayout: newLayout,
      progress: 1,
    });

    // Call onComplete callback
    options.onComplete?.();
  }

  /**
   * Calculate bounds from positions
   */
  private calculateBounds(positions: Map<string, Point>): LayoutResult["bounds"] {
    if (positions.size === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const { x, y } of positions.values()) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: LayoutManagerEventType, event: LayoutManagerEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in LayoutManager event listener:`, error);
        }
      }
    }
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a LayoutManager instance
 */
export function createLayoutManager(
  graphData: GraphData,
  config?: Partial<LayoutManagerConfig>
): LayoutManager {
  return new LayoutManager(graphData, config);
}

/**
 * Get easing function by name
 */
export function getEasingFunction(name: EasingFunction): EasingFunctionImpl {
  return EASING_FUNCTIONS[name];
}

/**
 * Interpolate between two points
 */
export function interpolatePoint(start: Point, end: Point, t: number): Point {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}
