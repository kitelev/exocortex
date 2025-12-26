/**
 * LayoutTransitionManager - Smooth transitions between graph layouts
 *
 * Orchestrates smooth animated transitions when switching between
 * layout algorithms, with configurable timing, easing, and staggering.
 *
 * Features:
 * - Smooth position interpolation between layouts
 * - Node enter/exit animations (fade in/out)
 * - Staggered animations for visual appeal
 * - Transition interruption and chaining
 * - Progress and completion callbacks
 * - Configurable per-node delay (stagger)
 *
 * @module presentation/renderers/graph/animation
 * @since 1.0.0
 */

import {
  Animation,
  AnimationLoop,
  createAnimation,
  createAnimationLoop,
  getEasing,
  type EasingFunction,
  type EasingName,
} from "./AnimationSystem";
import {
  interpolatePoint2D,
  interpolateOpacity,
  interpolateScale,
  calculateStaggeredProgress,
  clamp,
  type Point2D,
} from "./Interpolation";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Node state for transition animation
 */
export interface TransitionNodeState {
  id: string;
  x: number;
  y: number;
  opacity: number;
  scale: number;
}

/**
 * Transition configuration options
 */
export interface TransitionConfig {
  /** Animation duration in milliseconds (default: 500) */
  duration: number;
  /** Easing function or name (default: 'easeInOutCubic') */
  easing: EasingFunction | EasingName;
  /** Delay before animation starts in milliseconds (default: 0) */
  delay?: number;
  /** Enable staggered node animations (default: true) */
  stagger?: boolean;
  /** Stagger amount per node (0-1) (default: 0.02) */
  staggerAmount?: number;
  /** Maximum total stagger time ratio (default: 0.3) */
  maxStaggerRatio?: number;
  /** Duration for enter animations (default: duration * 0.5) */
  enterDuration?: number;
  /** Duration for exit animations (default: duration * 0.3) */
  exitDuration?: number;
  /** Easing for enter animations (default: 'easeOutCubic') */
  enterEasing?: EasingFunction | EasingName;
  /** Easing for exit animations (default: 'easeInQuad') */
  exitEasing?: EasingFunction | EasingName;
}

/**
 * Transition state
 */
export type TransitionState = "idle" | "running" | "paused" | "completed" | "cancelled";

/**
 * Transition event types
 */
export type TransitionEventType =
  | "start"
  | "progress"
  | "complete"
  | "cancel"
  | "pause"
  | "resume"
  | "nodeEnter"
  | "nodeExit";

/**
 * Transition event data
 */
export interface TransitionEvent {
  type: TransitionEventType;
  progress: number;
  nodeId?: string;
}

/**
 * Transition event listener
 */
export type TransitionEventListener = (event: TransitionEvent) => void;

/**
 * Transition callbacks
 */
export interface TransitionCallbacks {
  /** Called when transition starts */
  onStart?: () => void;
  /** Called on each frame with progress (0-1) */
  onProgress?: (progress: number) => void;
  /** Called when transition completes */
  onComplete?: () => void;
  /** Called when transition is cancelled */
  onCancel?: () => void;
  /** Called when a node enters (new nodes) */
  onNodeEnter?: (nodeId: string) => void;
  /** Called when a node exits (removed nodes) */
  onNodeExit?: (nodeId: string) => void;
}

/**
 * Layout transition manager configuration
 */
export interface LayoutTransitionManagerConfig {
  /** Default transition options */
  defaultTransition: Partial<TransitionConfig>;
  /** Whether to auto-start animation loop */
  autoStart: boolean;
}

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default transition configuration
 */
export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  duration: 500,
  easing: "easeInOutCubic",
  delay: 0,
  stagger: true,
  staggerAmount: 0.02,
  maxStaggerRatio: 0.3,
  enterDuration: 250,
  exitDuration: 150,
  enterEasing: "easeOutCubic",
  exitEasing: "easeInQuad",
};

/**
 * Default manager configuration
 */
export const DEFAULT_TRANSITION_MANAGER_CONFIG: LayoutTransitionManagerConfig = {
  defaultTransition: DEFAULT_TRANSITION_CONFIG,
  autoStart: true,
};

/**
 * Transition presets
 */
export const TRANSITION_PRESETS = {
  /** Fast snap transition */
  snap: {
    duration: 150,
    easing: "easeOutQuad" as EasingName,
    stagger: false,
  },
  /** Standard smooth transition */
  smooth: {
    duration: 500,
    easing: "easeInOutCubic" as EasingName,
    stagger: true,
    staggerAmount: 0.02,
  },
  /** Slow elegant transition */
  elegant: {
    duration: 800,
    easing: "easeInOutQuart" as EasingName,
    stagger: true,
    staggerAmount: 0.03,
  },
  /** Elastic bounce transition */
  elastic: {
    duration: 700,
    easing: "easeOutElastic" as EasingName,
    stagger: true,
    staggerAmount: 0.02,
  },
  /** Spring physics transition */
  spring: {
    duration: 600,
    easing: "spring" as EasingName,
    stagger: true,
    staggerAmount: 0.015,
  },
} as const;

// ============================================================
// LayoutTransitionManager Class
// ============================================================

/**
 * Manages smooth animated transitions between graph layout states.
 *
 * @example
 * ```typescript
 * const manager = new LayoutTransitionManager();
 *
 * // Define start and end positions
 * const startPositions = new Map([
 *   ['node1', { x: 0, y: 0 }],
 *   ['node2', { x: 100, y: 0 }],
 * ]);
 *
 * const endPositions = new Map([
 *   ['node1', { x: 50, y: 100 }],
 *   ['node2', { x: 150, y: 100 }],
 * ]);
 *
 * // Start transition with callbacks
 * manager.transition(startPositions, endPositions, {
 *   duration: 500,
 *   onProgress: (progress) => {
 *     const positions = manager.getCurrentPositions();
 *     renderer.updatePositions(positions);
 *   },
 *   onComplete: () => console.log('Transition complete'),
 * });
 * ```
 */
export class LayoutTransitionManager {
  private config: LayoutTransitionManagerConfig;
  private animationLoop: AnimationLoop;
  private currentAnimation: Animation | null = null;
  private eventListeners: Map<TransitionEventType, Set<TransitionEventListener>> = new Map();

  // Position state
  private startPositions: Map<string, Point2D> = new Map();
  private endPositions: Map<string, Point2D> = new Map();
  private currentPositions: Map<string, TransitionNodeState> = new Map();

  // Node tracking
  private enteringNodes: Set<string> = new Set();
  private exitingNodes: Set<string> = new Set();
  private stableNodes: Set<string> = new Set();

  // State
  private _state: TransitionState = "idle";
  private _progress: number = 0;

  constructor(config: Partial<LayoutTransitionManagerConfig> = {}) {
    this.config = {
      ...DEFAULT_TRANSITION_MANAGER_CONFIG,
      ...config,
      defaultTransition: {
        ...DEFAULT_TRANSITION_CONFIG,
        ...config.defaultTransition,
      },
    };

    this.animationLoop = createAnimationLoop();

    // Initialize event listener maps
    const eventTypes: TransitionEventType[] = [
      "start", "progress", "complete", "cancel",
      "pause", "resume", "nodeEnter", "nodeExit",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }

    if (this.config.autoStart) {
      this.animationLoop.start();
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get current transition state
   */
  get state(): TransitionState {
    return this._state;
  }

  /**
   * Get current progress (0-1)
   */
  get progress(): number {
    return this._progress;
  }

  /**
   * Check if transition is active
   */
  get isActive(): boolean {
    return this._state === "running" || this._state === "paused";
  }

  /**
   * Get current interpolated positions
   */
  getCurrentPositions(): Map<string, TransitionNodeState> {
    return new Map(this.currentPositions);
  }

  /**
   * Get position for a specific node
   */
  getNodePosition(nodeId: string): TransitionNodeState | undefined {
    return this.currentPositions.get(nodeId);
  }

  /**
   * Start a transition between two layout states
   */
  transition(
    from: Map<string, Point2D>,
    to: Map<string, Point2D>,
    options: Partial<TransitionConfig> & TransitionCallbacks = {}
  ): Promise<void> {
    // Cancel any existing transition
    if (this.currentAnimation) {
      this.cancel();
    }

    // Merge options with defaults
    const config: TransitionConfig = {
      ...this.config.defaultTransition as TransitionConfig,
      ...options,
    };

    // Store positions
    this.startPositions = new Map(from);
    this.endPositions = new Map(to);

    // Categorize nodes
    this.categorizeNodes();

    // Initialize current positions
    this.initializePositions();

    // Create main animation
    const easingFn = getEasing(config.easing);
    const staggerEnabled = config.stagger ?? true;
    const staggerAmount = config.staggerAmount ?? 0.02;
    const maxStaggerRatio = config.maxStaggerRatio ?? 0.3;

    return new Promise<void>((resolve, _reject) => {
      this.currentAnimation = createAnimation({
        duration: config.duration,
        easing: config.easing,
        delay: config.delay,
        onStart: () => {
          this._state = "running";
          this.emit("start", { type: "start", progress: 0 });
          options.onStart?.();
        },
        onUpdate: (progress, easedProgress) => {
          this._progress = progress;

          // Update positions with optional stagger
          this.updatePositions(
            easedProgress,
            staggerEnabled,
            staggerAmount,
            maxStaggerRatio,
            easingFn
          );

          this.emit("progress", { type: "progress", progress });
          options.onProgress?.(progress);
        },
        onComplete: () => {
          this._state = "completed";
          this._progress = 1;

          // Finalize positions
          this.finalizePositions();

          this.emit("complete", { type: "complete", progress: 1 });
          options.onComplete?.();
          this.currentAnimation = null;
          resolve();
        },
        onCancel: () => {
          this._state = "cancelled";
          this.emit("cancel", { type: "cancel", progress: this._progress });
          options.onCancel?.();
          this.currentAnimation = null;
          resolve();
        },
      });

      // Add to animation loop and start
      this.animationLoop.add(this.currentAnimation);
      this.currentAnimation.start();
    });
  }

  /**
   * Pause the current transition
   */
  pause(): void {
    if (this.currentAnimation && this._state === "running") {
      this.currentAnimation.pause();
      this._state = "paused";
      this.emit("pause", { type: "pause", progress: this._progress });
    }
  }

  /**
   * Resume a paused transition
   */
  resume(): void {
    if (this.currentAnimation && this._state === "paused") {
      this.currentAnimation.resume();
      this._state = "running";
      this.emit("resume", { type: "resume", progress: this._progress });
    }
  }

  /**
   * Cancel the current transition
   */
  cancel(): void {
    if (this.currentAnimation) {
      this.currentAnimation.cancel();
      this.animationLoop.remove(this.currentAnimation.id);
      this.currentAnimation = null;
    }
    this._state = "idle";
    this._progress = 0;
  }

  /**
   * Add event listener
   */
  on(eventType: TransitionEventType, listener: TransitionEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: TransitionEventType, listener: TransitionEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cancel();
    this.animationLoop.destroy();
    this.eventListeners.clear();
    this.startPositions.clear();
    this.endPositions.clear();
    this.currentPositions.clear();
    this.enteringNodes.clear();
    this.exitingNodes.clear();
    this.stableNodes.clear();
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Categorize nodes into entering, exiting, and stable
   */
  private categorizeNodes(): void {
    this.enteringNodes.clear();
    this.exitingNodes.clear();
    this.stableNodes.clear();

    // Nodes in end but not in start = entering
    for (const id of this.endPositions.keys()) {
      if (!this.startPositions.has(id)) {
        this.enteringNodes.add(id);
      } else {
        this.stableNodes.add(id);
      }
    }

    // Nodes in start but not in end = exiting
    for (const id of this.startPositions.keys()) {
      if (!this.endPositions.has(id)) {
        this.exitingNodes.add(id);
      }
    }
  }

  /**
   * Initialize current positions at start state
   */
  private initializePositions(): void {
    this.currentPositions.clear();

    // Initialize stable and exiting nodes at their start positions
    for (const [id, pos] of this.startPositions) {
      this.currentPositions.set(id, {
        id,
        x: pos.x,
        y: pos.y,
        opacity: 1,
        scale: 1,
      });
    }

    // Initialize entering nodes at their end positions but invisible
    for (const id of this.enteringNodes) {
      const pos = this.endPositions.get(id)!;
      this.currentPositions.set(id, {
        id,
        x: pos.x,
        y: pos.y,
        opacity: 0,
        scale: 0.5,
      });
    }
  }

  /**
   * Update positions for current progress
   */
  private updatePositions(
    globalProgress: number,
    stagger: boolean,
    staggerAmount: number,
    maxStaggerRatio: number,
    easingFn: EasingFunction
  ): void {
    const allIds = Array.from(this.currentPositions.keys());
    const totalNodes = allIds.length;

    for (let i = 0; i < allIds.length; i++) {
      const id = allIds[i];

      // Calculate node-specific progress with stagger
      let nodeProgress = globalProgress;
      if (stagger && totalNodes > 1) {
        const effectiveStagger = Math.min(staggerAmount, maxStaggerRatio / (totalNodes - 1));
        nodeProgress = calculateStaggeredProgress(globalProgress, i, totalNodes, effectiveStagger);
        nodeProgress = easingFn(clamp(nodeProgress, 0, 1));
      }

      // Update based on node type
      if (this.stableNodes.has(id)) {
        this.updateStableNode(id, nodeProgress);
      } else if (this.enteringNodes.has(id)) {
        this.updateEnteringNode(id, nodeProgress);
      } else if (this.exitingNodes.has(id)) {
        this.updateExitingNode(id, nodeProgress);
      }
    }
  }

  /**
   * Update a stable node (exists in both start and end)
   */
  private updateStableNode(id: string, progress: number): void {
    const startPos = this.startPositions.get(id)!;
    const endPos = this.endPositions.get(id)!;

    const interpolated = interpolatePoint2D(startPos, endPos, progress);

    this.currentPositions.set(id, {
      id,
      x: interpolated.x,
      y: interpolated.y,
      opacity: 1,
      scale: 1,
    });
  }

  /**
   * Update an entering node (new in end layout)
   */
  private updateEnteringNode(id: string, progress: number): void {
    const endPos = this.endPositions.get(id)!;

    // Scale up and fade in
    const opacity = interpolateOpacity(0, 1, progress);
    const scale = interpolateScale(0.5, 1, progress);

    this.currentPositions.set(id, {
      id,
      x: endPos.x,
      y: endPos.y,
      opacity,
      scale,
    });

    // Emit enter event at start
    if (progress > 0 && progress < 0.1) {
      this.emit("nodeEnter", { type: "nodeEnter", progress, nodeId: id });
    }
  }

  /**
   * Update an exiting node (removed in end layout)
   */
  private updateExitingNode(id: string, progress: number): void {
    const startPos = this.startPositions.get(id)!;

    // Fade out and scale down
    const opacity = interpolateOpacity(1, 0, progress);
    const scale = interpolateScale(1, 0.5, progress);

    this.currentPositions.set(id, {
      id,
      x: startPos.x,
      y: startPos.y,
      opacity,
      scale,
    });

    // Emit exit event near end
    if (progress > 0.9 && progress < 1) {
      this.emit("nodeExit", { type: "nodeExit", progress, nodeId: id });
    }
  }

  /**
   * Finalize positions at end of transition
   */
  private finalizePositions(): void {
    // Set all positions to exact end values
    for (const [id, pos] of this.endPositions) {
      this.currentPositions.set(id, {
        id,
        x: pos.x,
        y: pos.y,
        opacity: 1,
        scale: 1,
      });
    }

    // Remove exiting nodes
    for (const id of this.exitingNodes) {
      this.currentPositions.delete(id);
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: TransitionEventType, event: TransitionEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in transition event listener:", error);
        }
      }
    }
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a LayoutTransitionManager instance
 */
export function createLayoutTransitionManager(
  config?: Partial<LayoutTransitionManagerConfig>
): LayoutTransitionManager {
  return new LayoutTransitionManager(config);
}

/**
 * Create a one-shot transition between two position sets
 */
export function transitionPositions(
  from: Map<string, Point2D>,
  to: Map<string, Point2D>,
  options: Partial<TransitionConfig> & TransitionCallbacks = {}
): Promise<Map<string, TransitionNodeState>> {
  const manager = new LayoutTransitionManager({ autoStart: true });
  let finalPositions: Map<string, TransitionNodeState>;

  return manager
    .transition(from, to, {
      ...options,
      onProgress: (progress) => {
        finalPositions = manager.getCurrentPositions();
        options.onProgress?.(progress);
      },
    })
    .then(() => {
      const result = finalPositions ?? manager.getCurrentPositions();
      manager.destroy();
      return result;
    });
}
