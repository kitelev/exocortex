/**
 * NodeAnimator - Individual node animation management
 *
 * Provides fine-grained control over individual node animations,
 * including hover effects, selection animations, drag feedback,
 * and custom state transitions.
 *
 * Features:
 * - Per-node animation state management
 * - Animation queuing and chaining
 * - Hover and selection effects
 * - Drag and drop feedback animations
 * - Focus and highlight animations
 * - Pulse and attention effects
 * - Custom animation sequences
 *
 * @module presentation/renderers/graph/animation
 * @since 1.0.0
 */

import {
  Animation,
  AnimationLoop,
  createAnimation,
  createAnimationLoop,
  type EasingFunction,
  type EasingName,
} from "./AnimationSystem";
import {
  lerp,
  interpolateOpacity,
  interpolateHex,
} from "./Interpolation";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Node visual state
 */
export interface NodeVisualState {
  /** Node scale (1 = normal size) */
  scale: number;
  /** Node opacity (0-1) */
  opacity: number;
  /** Glow intensity (0 = none, 1 = maximum) */
  glow: number;
  /** Ring scale for selection/focus indicators (0 = hidden) */
  ringScale: number;
  /** Ring opacity */
  ringOpacity: number;
  /** Color tint (hex color or null for default) */
  colorTint: string | null;
  /** Offset from base position */
  offsetX: number;
  offsetY: number;
  /** Rotation in degrees */
  rotation: number;
}

/**
 * Animation type for nodes
 */
export type NodeAnimationType =
  | "hover"
  | "unhover"
  | "select"
  | "deselect"
  | "focus"
  | "unfocus"
  | "pulse"
  | "shake"
  | "bounce"
  | "fadeIn"
  | "fadeOut"
  | "scaleIn"
  | "scaleOut"
  | "highlight"
  | "dim"
  | "dragStart"
  | "dragEnd"
  | "custom";

/**
 * Node animation configuration
 */
export interface NodeAnimationConfig {
  /** Animation type */
  type: NodeAnimationType;
  /** Duration in milliseconds */
  duration: number;
  /** Easing function or name */
  easing: EasingFunction | EasingName;
  /** Target visual state (partial, merged with current) */
  target?: Partial<NodeVisualState>;
  /** Custom animation update function */
  customUpdate?: (progress: number, current: NodeVisualState) => Partial<NodeVisualState>;
  /** Delay before animation starts */
  delay?: number;
  /** Number of times to repeat (for looping animations) */
  repeat?: number;
  /** Whether to reverse on each repeat */
  yoyo?: boolean;
  /** Callback on animation complete */
  onComplete?: () => void;
}

/**
 * Node animator state
 */
export interface NodeAnimatorState {
  /** Node ID */
  id: string;
  /** Current visual state */
  current: NodeVisualState;
  /** Base (default) visual state */
  base: NodeVisualState;
  /** Active animations */
  activeAnimations: Map<string, Animation>;
  /** Animation queue */
  queue: NodeAnimationConfig[];
  /** Whether node is being animated */
  isAnimating: boolean;
}

/**
 * Node animator configuration
 */
export interface NodeAnimatorConfig {
  /** Default animation durations by type */
  durations: Record<NodeAnimationType, number>;
  /** Default easing by type */
  easings: Record<NodeAnimationType, EasingName>;
  /** Whether to queue animations or interrupt */
  queueAnimations: boolean;
}

/**
 * Node animator event types
 */
export type NodeAnimatorEventType =
  | "animationStart"
  | "animationComplete"
  | "animationCancel"
  | "stateChange";

/**
 * Node animator event
 */
export interface NodeAnimatorEvent {
  type: NodeAnimatorEventType;
  nodeId: string;
  animationType?: NodeAnimationType;
  state?: NodeVisualState;
}

/**
 * Node animator event listener
 */
export type NodeAnimatorEventListener = (event: NodeAnimatorEvent) => void;

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default node visual state
 */
export const DEFAULT_NODE_VISUAL_STATE: NodeVisualState = {
  scale: 1,
  opacity: 1,
  glow: 0,
  ringScale: 0,
  ringOpacity: 0,
  colorTint: null,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
};

/**
 * Default animation durations by type
 */
export const DEFAULT_ANIMATION_DURATIONS: Record<NodeAnimationType, number> = {
  hover: 150,
  unhover: 150,
  select: 200,
  deselect: 200,
  focus: 200,
  unfocus: 150,
  pulse: 600,
  shake: 400,
  bounce: 500,
  fadeIn: 300,
  fadeOut: 200,
  scaleIn: 300,
  scaleOut: 200,
  highlight: 300,
  dim: 200,
  dragStart: 100,
  dragEnd: 200,
  custom: 300,
};

/**
 * Default easings by animation type
 */
export const DEFAULT_ANIMATION_EASINGS: Record<NodeAnimationType, EasingName> = {
  hover: "easeOutCubic",
  unhover: "easeOutCubic",
  select: "easeOutBack",
  deselect: "easeOutCubic",
  focus: "easeOutCubic",
  unfocus: "easeOutCubic",
  pulse: "easeInOutQuad",
  shake: "easeOutQuad",
  bounce: "easeOutBounce",
  fadeIn: "easeOutCubic",
  fadeOut: "easeInCubic",
  scaleIn: "easeOutBack",
  scaleOut: "easeInCubic",
  highlight: "easeOutCubic",
  dim: "easeOutCubic",
  dragStart: "easeOutQuad",
  dragEnd: "easeOutBack",
  custom: "easeInOutCubic",
};

/**
 * Default node animator configuration
 */
export const DEFAULT_NODE_ANIMATOR_CONFIG: NodeAnimatorConfig = {
  durations: DEFAULT_ANIMATION_DURATIONS,
  easings: DEFAULT_ANIMATION_EASINGS,
  queueAnimations: false, // Interrupt by default
};

/**
 * Predefined visual states for common interactions
 */
export const NODE_VISUAL_PRESETS = {
  hover: {
    scale: 1.15,
    glow: 0.3,
  },
  selected: {
    scale: 1.1,
    ringScale: 1.3,
    ringOpacity: 1,
  },
  focused: {
    scale: 1.05,
    glow: 0.5,
    ringScale: 1.2,
    ringOpacity: 0.8,
  },
  highlighted: {
    glow: 0.8,
    colorTint: "#ffff00",
  },
  dimmed: {
    opacity: 0.4,
    scale: 0.95,
  },
  dragging: {
    scale: 1.2,
    opacity: 0.9,
    glow: 0.2,
  },
} as const;

// ============================================================
// NodeAnimator Class
// ============================================================

/**
 * Manages animations for individual graph nodes.
 *
 * @example
 * ```typescript
 * const animator = new NodeAnimator();
 *
 * // Register nodes
 * animator.addNode('node1');
 * animator.addNode('node2');
 *
 * // Animate hover effect
 * animator.animate('node1', { type: 'hover' });
 *
 * // Animate selection
 * animator.animate('node2', {
 *   type: 'select',
 *   duration: 300,
 *   onComplete: () => console.log('Selected!'),
 * });
 *
 * // Get current visual state
 * const state = animator.getState('node1');
 * ```
 */
export class NodeAnimator {
  private config: NodeAnimatorConfig;
  private animationLoop: AnimationLoop;
  private nodes: Map<string, NodeAnimatorState> = new Map();
  private eventListeners: Map<NodeAnimatorEventType, Set<NodeAnimatorEventListener>> = new Map();
  private animationIdCounter: number = 0;

  constructor(config: Partial<NodeAnimatorConfig> = {}) {
    this.config = {
      ...DEFAULT_NODE_ANIMATOR_CONFIG,
      ...config,
      durations: { ...DEFAULT_ANIMATION_DURATIONS, ...config.durations },
      easings: { ...DEFAULT_ANIMATION_EASINGS, ...config.easings },
    };

    this.animationLoop = createAnimationLoop();
    this.animationLoop.start();

    // Initialize event listeners
    const eventTypes: NodeAnimatorEventType[] = [
      "animationStart",
      "animationComplete",
      "animationCancel",
      "stateChange",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }
  }

  // ============================================================
  // Node Management
  // ============================================================

  /**
   * Add a node to the animator
   */
  addNode(nodeId: string, initialState?: Partial<NodeVisualState>): void {
    if (this.nodes.has(nodeId)) {
      return;
    }

    const baseState: NodeVisualState = {
      ...DEFAULT_NODE_VISUAL_STATE,
      ...initialState,
    };

    this.nodes.set(nodeId, {
      id: nodeId,
      current: { ...baseState },
      base: { ...baseState },
      activeAnimations: new Map(),
      queue: [],
      isAnimating: false,
    });
  }

  /**
   * Remove a node from the animator
   */
  removeNode(nodeId: string): void {
    const state = this.nodes.get(nodeId);
    if (state) {
      // Cancel all active animations
      for (const animation of state.activeAnimations.values()) {
        animation.cancel();
        this.animationLoop.remove(animation.id);
      }
      this.nodes.delete(nodeId);
    }
  }

  /**
   * Check if node exists
   */
  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Get all node IDs
   */
  getNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  // ============================================================
  // State Access
  // ============================================================

  /**
   * Get current visual state for a node
   */
  getState(nodeId: string): NodeVisualState | undefined {
    return this.nodes.get(nodeId)?.current;
  }

  /**
   * Get all node states
   */
  getAllStates(): Map<string, NodeVisualState> {
    const result = new Map<string, NodeVisualState>();
    for (const [id, state] of this.nodes) {
      result.set(id, { ...state.current });
    }
    return result;
  }

  /**
   * Set state directly without animation
   */
  setState(nodeId: string, state: Partial<NodeVisualState>): void {
    const nodeState = this.nodes.get(nodeId);
    if (nodeState) {
      Object.assign(nodeState.current, state);
      this.emit("stateChange", {
        type: "stateChange",
        nodeId,
        state: nodeState.current,
      });
    }
  }

  /**
   * Reset node to base state without animation
   */
  reset(nodeId: string): void {
    const nodeState = this.nodes.get(nodeId);
    if (nodeState) {
      // Cancel all animations
      for (const animation of nodeState.activeAnimations.values()) {
        animation.cancel();
        this.animationLoop.remove(animation.id);
      }
      nodeState.activeAnimations.clear();
      nodeState.queue = [];
      nodeState.isAnimating = false;

      // Reset to base state
      nodeState.current = { ...nodeState.base };
      this.emit("stateChange", {
        type: "stateChange",
        nodeId,
        state: nodeState.current,
      });
    }
  }

  /**
   * Reset all nodes to base state
   */
  resetAll(): void {
    for (const nodeId of this.nodes.keys()) {
      this.reset(nodeId);
    }
  }

  // ============================================================
  // Animation API
  // ============================================================

  /**
   * Animate a node with the given configuration
   */
  animate(nodeId: string, config: Partial<NodeAnimationConfig>): string | null {
    const nodeState = this.nodes.get(nodeId);
    if (!nodeState) {
      return null;
    }

    const animationType = config.type ?? "custom";
    const fullConfig: NodeAnimationConfig = {
      type: animationType,
      duration: config.duration ?? this.config.durations[animationType],
      easing: config.easing ?? this.config.easings[animationType],
      target: config.target,
      customUpdate: config.customUpdate,
      delay: config.delay ?? 0,
      repeat: config.repeat ?? 0,
      yoyo: config.yoyo ?? false,
      onComplete: config.onComplete,
    };

    // Queue or interrupt based on config
    if (this.config.queueAnimations && nodeState.isAnimating) {
      nodeState.queue.push(fullConfig);
      return null;
    }

    return this.startAnimation(nodeId, fullConfig);
  }

  /**
   * Quick hover animation
   */
  hover(nodeId: string): void {
    this.animate(nodeId, {
      type: "hover",
      target: NODE_VISUAL_PRESETS.hover,
    });
  }

  /**
   * Quick unhover animation
   */
  unhover(nodeId: string): void {
    this.animate(nodeId, {
      type: "unhover",
      target: DEFAULT_NODE_VISUAL_STATE,
    });
  }

  /**
   * Quick select animation
   */
  select(nodeId: string): void {
    this.animate(nodeId, {
      type: "select",
      target: NODE_VISUAL_PRESETS.selected,
    });
  }

  /**
   * Quick deselect animation
   */
  deselect(nodeId: string): void {
    this.animate(nodeId, {
      type: "deselect",
      target: DEFAULT_NODE_VISUAL_STATE,
    });
  }

  /**
   * Pulse animation (repeating)
   */
  pulse(nodeId: string, count: number = 2): void {
    const nodeState = this.nodes.get(nodeId);
    if (!nodeState) return;

    const startState = { ...nodeState.current };

    this.animate(nodeId, {
      type: "pulse",
      repeat: count,
      yoyo: true,
      customUpdate: (progress) => {
        // Pulse scale up and down
        const pulseProgress = Math.sin(progress * Math.PI);
        return {
          scale: startState.scale + 0.1 * pulseProgress,
          glow: startState.glow + 0.3 * pulseProgress,
        };
      },
    });
  }

  /**
   * Shake animation for error/attention
   */
  shake(nodeId: string): void {
    const nodeState = this.nodes.get(nodeId);
    if (!nodeState) return;

    this.animate(nodeId, {
      type: "shake",
      customUpdate: (progress) => {
        // Damped oscillation
        const amplitude = 8 * (1 - progress);
        const frequency = 4 * Math.PI;
        return {
          offsetX: Math.sin(progress * frequency) * amplitude,
        };
      },
    });
  }

  /**
   * Bounce animation for feedback
   */
  bounce(nodeId: string): void {
    this.animate(nodeId, {
      type: "bounce",
      easing: "easeOutBounce",
      customUpdate: (progress) => {
        // Use eased progress directly for scale
        return {
          scale: 0.8 + 0.2 * progress,
        };
      },
    });
  }

  /**
   * Cancel all animations for a node
   */
  cancelAnimations(nodeId: string): void {
    const nodeState = this.nodes.get(nodeId);
    if (nodeState) {
      for (const animation of nodeState.activeAnimations.values()) {
        animation.cancel();
        this.animationLoop.remove(animation.id);
        this.emit("animationCancel", {
          type: "animationCancel",
          nodeId,
        });
      }
      nodeState.activeAnimations.clear();
      nodeState.queue = [];
      nodeState.isAnimating = false;
    }
  }

  // ============================================================
  // Event Listeners
  // ============================================================

  /**
   * Add event listener
   */
  on(eventType: NodeAnimatorEventType, listener: NodeAnimatorEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: NodeAnimatorEventType, listener: NodeAnimatorEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Cancel all animations
    for (const nodeId of this.nodes.keys()) {
      this.cancelAnimations(nodeId);
    }

    this.animationLoop.destroy();
    this.nodes.clear();
    this.eventListeners.clear();
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Start an animation for a node
   */
  private startAnimation(nodeId: string, config: NodeAnimationConfig): string {
    const nodeState = this.nodes.get(nodeId)!;

    // Capture start state
    const startState = { ...nodeState.current };

    // Determine target state
    const targetState = this.resolveTargetState(nodeState, config);

    // Create animation ID
    const animId = `node-${nodeId}-${++this.animationIdCounter}`;

    // Track repeat count
    let repeatCount = 0;
    let direction = 1; // 1 = forward, -1 = backward

    const animation = createAnimation({
      duration: config.duration,
      easing: config.easing,
      delay: config.delay,
      onStart: () => {
        nodeState.isAnimating = true;
        this.emit("animationStart", {
          type: "animationStart",
          nodeId,
          animationType: config.type,
        });
      },
      onUpdate: (_progress, easedProgress) => {
        let effectiveProgress = easedProgress;

        // Handle yoyo direction
        if (direction === -1) {
          effectiveProgress = 1 - easedProgress;
        }

        // Apply custom update or standard interpolation
        if (config.customUpdate) {
          const update = config.customUpdate(effectiveProgress, nodeState.current);
          Object.assign(nodeState.current, update);
        } else {
          this.interpolateState(nodeState, startState, targetState, effectiveProgress);
        }

        this.emit("stateChange", {
          type: "stateChange",
          nodeId,
          state: nodeState.current,
        });
      },
      onComplete: () => {
        // Handle repeat
        if (config.repeat && repeatCount < config.repeat) {
          repeatCount++;
          if (config.yoyo) {
            direction *= -1;
          }
          // Restart animation
          animation.start();
          return;
        }

        // Animation complete
        nodeState.activeAnimations.delete(animId);
        nodeState.isAnimating = nodeState.activeAnimations.size > 0;

        this.emit("animationComplete", {
          type: "animationComplete",
          nodeId,
          animationType: config.type,
        });

        config.onComplete?.();

        // Process queue
        if (nodeState.queue.length > 0) {
          const next = nodeState.queue.shift()!;
          this.startAnimation(nodeId, next);
        }
      },
      onCancel: () => {
        nodeState.activeAnimations.delete(animId);
        nodeState.isAnimating = nodeState.activeAnimations.size > 0;
      },
    });

    // Store and start animation
    // Start animation BEFORE adding to loop so isActive is true when add() checks
    animation.start();
    nodeState.activeAnimations.set(animId, animation);
    this.animationLoop.add(animation);

    return animId;
  }

  /**
   * Resolve target state from config
   */
  private resolveTargetState(
    nodeState: NodeAnimatorState,
    config: NodeAnimationConfig
  ): NodeVisualState {
    // Start with current state
    const target = { ...nodeState.current };

    // Apply type-based presets
    switch (config.type) {
      case "hover":
        Object.assign(target, NODE_VISUAL_PRESETS.hover);
        break;
      case "unhover":
      case "deselect":
      case "unfocus":
        Object.assign(target, nodeState.base);
        break;
      case "select":
        Object.assign(target, NODE_VISUAL_PRESETS.selected);
        break;
      case "focus":
        Object.assign(target, NODE_VISUAL_PRESETS.focused);
        break;
      case "highlight":
        Object.assign(target, NODE_VISUAL_PRESETS.highlighted);
        break;
      case "dim":
        Object.assign(target, NODE_VISUAL_PRESETS.dimmed);
        break;
      case "dragStart":
        Object.assign(target, NODE_VISUAL_PRESETS.dragging);
        break;
      case "dragEnd":
        Object.assign(target, nodeState.base);
        break;
      case "fadeIn":
        target.opacity = 1;
        break;
      case "fadeOut":
        target.opacity = 0;
        break;
      case "scaleIn":
        target.scale = 1;
        target.opacity = 1;
        break;
      case "scaleOut":
        target.scale = 0;
        target.opacity = 0;
        break;
    }

    // Override with explicit target
    if (config.target) {
      Object.assign(target, config.target);
    }

    return target;
  }

  /**
   * Interpolate between two visual states
   */
  private interpolateState(
    nodeState: NodeAnimatorState,
    start: NodeVisualState,
    end: NodeVisualState,
    t: number
  ): void {
    nodeState.current.scale = lerp(start.scale, end.scale, t);
    nodeState.current.opacity = interpolateOpacity(start.opacity, end.opacity, t);
    nodeState.current.glow = lerp(start.glow, end.glow, t);
    nodeState.current.ringScale = lerp(start.ringScale, end.ringScale, t);
    nodeState.current.ringOpacity = interpolateOpacity(start.ringOpacity, end.ringOpacity, t);
    nodeState.current.offsetX = lerp(start.offsetX, end.offsetX, t);
    nodeState.current.offsetY = lerp(start.offsetY, end.offsetY, t);
    nodeState.current.rotation = lerp(start.rotation, end.rotation, t);

    // Handle color tint
    if (start.colorTint && end.colorTint) {
      nodeState.current.colorTint = interpolateHex(start.colorTint, end.colorTint, t);
    } else if (end.colorTint) {
      nodeState.current.colorTint = end.colorTint;
    } else {
      nodeState.current.colorTint = t > 0.5 ? null : start.colorTint;
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(eventType: NodeAnimatorEventType, event: NodeAnimatorEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in node animator event listener:", error);
        }
      }
    }
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a NodeAnimator instance
 */
export function createNodeAnimator(
  config?: Partial<NodeAnimatorConfig>
): NodeAnimator {
  return new NodeAnimator(config);
}
