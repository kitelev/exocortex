/**
 * AnimationSystem - Core animation infrastructure for smooth transitions
 *
 * Provides a comprehensive animation system with:
 * - Configurable easing functions (linear, quad, cubic, elastic, spring, bounce)
 * - Animation lifecycle management (start, pause, resume, cancel)
 * - RAF-based animation loop with frame timing
 * - Progress callbacks and completion handlers
 * - Animation chaining and sequencing support
 *
 * @module presentation/renderers/graph/animation
 * @since 1.0.0
 */

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Easing function - takes normalized time (0-1) and returns eased value (0-1)
 */
export type EasingFunction = (t: number) => number;

/**
 * Available easing function names
 */
export type EasingName =
  | "linear"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInQuart"
  | "easeOutQuart"
  | "easeInOutQuart"
  | "easeInQuint"
  | "easeOutQuint"
  | "easeInOutQuint"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeInCirc"
  | "easeOutCirc"
  | "easeInOutCirc"
  | "easeInElastic"
  | "easeOutElastic"
  | "easeInOutElastic"
  | "easeInBack"
  | "easeOutBack"
  | "easeInOutBack"
  | "easeInBounce"
  | "easeOutBounce"
  | "easeInOutBounce"
  | "spring";

/**
 * Animation configuration
 */
export interface AnimationConfig {
  /** Animation duration in milliseconds */
  duration: number;
  /** Easing function or name */
  easing: EasingFunction | EasingName;
  /** Delay before animation starts in milliseconds */
  delay?: number;
  /** Callback on each frame with progress (0-1) */
  onUpdate?: (progress: number, easedProgress: number) => void;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Callback when animation is cancelled */
  onCancel?: () => void;
  /** Callback when animation starts (after delay) */
  onStart?: () => void;
}

/**
 * Animation state
 */
export type AnimationState = "idle" | "delayed" | "running" | "paused" | "completed" | "cancelled";

/**
 * Animation instance interface
 */
export interface IAnimation {
  /** Unique animation ID */
  readonly id: string;
  /** Current state */
  readonly state: AnimationState;
  /** Current progress (0-1) */
  readonly progress: number;
  /** Current eased progress (0-1) */
  readonly easedProgress: number;
  /** Whether animation is active (delayed or running) */
  readonly isActive: boolean;

  /** Start the animation */
  start(): void;
  /** Pause the animation */
  pause(): void;
  /** Resume a paused animation */
  resume(): void;
  /** Cancel the animation */
  cancel(): void;
  /** Update animation state for current frame */
  update(timestamp: number): boolean;
}

/**
 * Animation loop interface
 */
export interface IAnimationLoop {
  /** Whether loop is running */
  readonly isRunning: boolean;
  /** Number of active animations */
  readonly animationCount: number;

  /** Add an animation to the loop */
  add(animation: IAnimation): void;
  /** Remove an animation from the loop */
  remove(animationId: string): void;
  /** Start the animation loop */
  start(): void;
  /** Stop the animation loop */
  stop(): void;
  /** Clean up resources */
  destroy(): void;
}

// ============================================================
// Easing Functions Collection
// ============================================================

/**
 * Comprehensive collection of easing functions for smooth animations.
 *
 * Each function takes a normalized time value (0-1) and returns
 * an eased value (0-1). The output may overshoot [0,1] for
 * elastic and back easing functions.
 */
export const Easing: Record<EasingName, EasingFunction> = {
  // Linear - no easing
  linear: (t: number): number => t,

  // Quadratic
  easeInQuad: (t: number): number => t * t,
  easeOutQuad: (t: number): number => t * (2 - t),
  easeInOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  // Cubic
  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => {
    const t1 = t - 1;
    return t1 * t1 * t1 + 1;
  },
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  // Quartic
  easeInQuart: (t: number): number => t * t * t * t,
  easeOutQuart: (t: number): number => {
    const t1 = t - 1;
    return 1 - t1 * t1 * t1 * t1;
  },
  easeInOutQuart: (t: number): number =>
    t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,

  // Quintic
  easeInQuint: (t: number): number => t * t * t * t * t,
  easeOutQuint: (t: number): number => {
    const t1 = t - 1;
    return 1 + t1 * t1 * t1 * t1 * t1;
  },
  easeInOutQuint: (t: number): number =>
    t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2,

  // Exponential
  easeInExpo: (t: number): number =>
    t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  easeOutExpo: (t: number): number =>
    t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeInOutExpo: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
    return (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  // Circular
  easeInCirc: (t: number): number => 1 - Math.sqrt(1 - t * t),
  easeOutCirc: (t: number): number => Math.sqrt(1 - Math.pow(t - 1, 2)),
  easeInOutCirc: (t: number): number =>
    t < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,

  // Elastic
  easeInElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  },
  easeOutElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeInOutElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c5 = (2 * Math.PI) / 4.5;
    if (t < 0.5) {
      return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2;
    }
    return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  },

  // Back (overshoot)
  easeInBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    if (t < 0.5) {
      return (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2;
    }
    return (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },

  // Bounce
  easeInBounce: (t: number): number => 1 - Easing.easeOutBounce(1 - t),
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
  easeInOutBounce: (t: number): number =>
    t < 0.5
      ? (1 - Easing.easeOutBounce(1 - 2 * t)) / 2
      : (1 + Easing.easeOutBounce(2 * t - 1)) / 2,

  // Spring (physics-based)
  spring: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/**
 * Get easing function by name or return function directly
 */
export function getEasing(easing: EasingFunction | EasingName): EasingFunction {
  if (typeof easing === "function") {
    return easing;
  }
  return Easing[easing] ?? Easing.linear;
}

// ============================================================
// Animation Class
// ============================================================

let animationIdCounter = 0;

/**
 * Generate unique animation ID
 */
function generateAnimationId(): string {
  return `anim-${++animationIdCounter}-${Date.now()}`;
}

/**
 * Animation class for managing individual animations.
 *
 * @example
 * ```typescript
 * const anim = new Animation({
 *   duration: 500,
 *   easing: 'easeOutCubic',
 *   onUpdate: (progress, eased) => {
 *     node.x = startX + (endX - startX) * eased;
 *   },
 *   onComplete: () => console.log('Done!'),
 * });
 *
 * anim.start();
 * ```
 */
export class Animation implements IAnimation {
  readonly id: string;

  private _state: AnimationState = "idle";
  private _progress: number = 0;
  private _easedProgress: number = 0;

  private config: Required<Omit<AnimationConfig, "onUpdate" | "onComplete" | "onCancel" | "onStart">> & {
    onUpdate?: (progress: number, easedProgress: number) => void;
    onComplete?: () => void;
    onCancel?: () => void;
    onStart?: () => void;
  };

  private easingFn: EasingFunction;
  private startTime: number = 0;
  private pausedTime: number = 0;

  constructor(config: AnimationConfig) {
    this.id = generateAnimationId();
    this.config = {
      duration: config.duration,
      delay: config.delay ?? 0,
      easing: config.easing,
      onUpdate: config.onUpdate,
      onComplete: config.onComplete,
      onCancel: config.onCancel,
      onStart: config.onStart,
    };
    this.easingFn = getEasing(config.easing);
  }

  get state(): AnimationState {
    return this._state;
  }

  get progress(): number {
    return this._progress;
  }

  get easedProgress(): number {
    return this._easedProgress;
  }

  get isActive(): boolean {
    return this._state === "delayed" || this._state === "running";
  }

  /**
   * Start the animation
   */
  start(): void {
    if (this._state !== "idle" && this._state !== "cancelled") {
      return;
    }

    this._state = this.config.delay > 0 ? "delayed" : "running";
    this.startTime = performance.now();
    this._progress = 0;
    this._easedProgress = 0;

    if (this._state === "running") {
      this.config.onStart?.();
    }
  }

  /**
   * Pause the animation
   */
  pause(): void {
    if (this._state !== "running" && this._state !== "delayed") {
      return;
    }

    this.pausedTime = performance.now();
    this._state = "paused";
  }

  /**
   * Resume a paused animation
   */
  resume(): void {
    if (this._state !== "paused") {
      return;
    }

    // Adjust start time to account for pause duration
    const pauseDuration = performance.now() - this.pausedTime;
    this.startTime += pauseDuration;
    this._state = "running";
  }

  /**
   * Cancel the animation
   */
  cancel(): void {
    if (this._state === "completed" || this._state === "cancelled") {
      return;
    }

    this._state = "cancelled";
    this.config.onCancel?.();
  }

  /**
   * Update animation for current frame.
   * Returns true if animation is still active, false if complete or inactive.
   */
  update(timestamp: number): boolean {
    if (this._state === "idle" || this._state === "paused" ||
        this._state === "completed" || this._state === "cancelled") {
      return false;
    }

    const elapsed = timestamp - this.startTime;

    // Handle delay phase
    if (this._state === "delayed") {
      if (elapsed < this.config.delay) {
        return true; // Still waiting
      }
      // Delay complete, start running
      this._state = "running";
      this.startTime = timestamp; // Reset start time for animation
      this.config.onStart?.();
      return true;
    }

    // Calculate progress
    const duration = this.config.duration;
    if (duration <= 0) {
      this._progress = 1;
      this._easedProgress = 1;
      this.complete();
      return false;
    }

    this._progress = Math.min(elapsed / duration, 1);
    this._easedProgress = this.easingFn(this._progress);

    // Call update callback
    this.config.onUpdate?.(this._progress, this._easedProgress);

    // Check completion
    if (this._progress >= 1) {
      this.complete();
      return false;
    }

    return true;
  }

  /**
   * Complete the animation
   */
  private complete(): void {
    this._state = "completed";
    this._progress = 1;
    this._easedProgress = this.easingFn(1);
    this.config.onUpdate?.(1, this._easedProgress);
    this.config.onComplete?.();
  }
}

// ============================================================
// AnimationLoop Class
// ============================================================

/**
 * Animation loop for managing multiple concurrent animations.
 *
 * Uses requestAnimationFrame for smooth 60fps updates and
 * automatically cleans up completed animations.
 *
 * @example
 * ```typescript
 * const loop = new AnimationLoop();
 *
 * const anim1 = new Animation({ duration: 500, ... });
 * const anim2 = new Animation({ duration: 300, ... });
 *
 * loop.add(anim1);
 * loop.add(anim2);
 *
 * anim1.start();
 * anim2.start();
 *
 * loop.start();
 * ```
 */
export class AnimationLoop implements IAnimationLoop {
  private animations: Map<string, IAnimation> = new Map();
  private frameId: number | null = null;
  private _isRunning: boolean = false;

  get isRunning(): boolean {
    return this._isRunning;
  }

  get animationCount(): number {
    return this.animations.size;
  }

  /**
   * Add an animation to the loop
   */
  add(animation: IAnimation): void {
    this.animations.set(animation.id, animation);

    // Auto-start loop if not running and animation is active
    if (!this._isRunning && animation.isActive) {
      this.start();
    }
  }

  /**
   * Remove an animation from the loop
   */
  remove(animationId: string): void {
    this.animations.delete(animationId);

    // Auto-stop loop if no animations
    if (this.animations.size === 0 && this._isRunning) {
      this.stop();
    }
  }

  /**
   * Start the animation loop
   */
  start(): void {
    if (this._isRunning) {
      return;
    }

    this._isRunning = true;
    this.tick();
  }

  /**
   * Stop the animation loop
   */
  stop(): void {
    if (!this._isRunning) {
      return;
    }

    this._isRunning = false;
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    // Cancel all animations
    for (const animation of this.animations.values()) {
      animation.cancel();
    }
    this.animations.clear();
  }

  /**
   * Main animation loop tick
   */
  private tick = (): void => {
    if (!this._isRunning) {
      return;
    }

    const timestamp = performance.now();
    const completedIds: string[] = [];

    // Update all animations
    for (const [id, animation] of this.animations) {
      const stillActive = animation.update(timestamp);
      if (!stillActive) {
        completedIds.push(id);
      }
    }

    // Remove completed animations
    for (const id of completedIds) {
      this.animations.delete(id);
    }

    // Continue loop or stop if no animations
    if (this.animations.size > 0) {
      this.frameId = requestAnimationFrame(this.tick);
    } else {
      this._isRunning = false;
      this.frameId = null;
    }
  };
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create an animation with the given configuration
 */
export function createAnimation(config: AnimationConfig): Animation {
  return new Animation(config);
}

/**
 * Create an animation loop
 */
export function createAnimationLoop(): AnimationLoop {
  return new AnimationLoop();
}

/**
 * Animate a value from start to end over duration
 */
export function animate(
  from: number,
  to: number,
  config: Omit<AnimationConfig, "onUpdate"> & {
    onUpdate: (value: number, progress: number) => void;
  }
): Animation {
  return new Animation({
    ...config,
    onUpdate: (progress, eased) => {
      const value = from + (to - from) * eased;
      config.onUpdate(value, progress);
    },
  });
}

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default animation configuration
 */
export const DEFAULT_ANIMATION_CONFIG: Omit<AnimationConfig, "onUpdate" | "onComplete" | "onCancel" | "onStart"> = {
  duration: 300,
  easing: "easeOutCubic",
  delay: 0,
};

/**
 * Common animation presets
 */
export const ANIMATION_PRESETS = {
  /** Fast snap animation */
  snap: { duration: 150, easing: "easeOutQuad" as EasingName },
  /** Standard smooth animation */
  smooth: { duration: 300, easing: "easeOutCubic" as EasingName },
  /** Layout transition animation */
  layoutTransition: { duration: 500, easing: "easeInOutCubic" as EasingName },
  /** Elastic snap animation */
  elastic: { duration: 600, easing: "easeOutElastic" as EasingName },
  /** Spring physics animation */
  spring: { duration: 500, easing: "spring" as EasingName },
  /** Bounce effect animation */
  bounce: { duration: 700, easing: "easeOutBounce" as EasingName },
  /** Slow reveal animation */
  reveal: { duration: 800, easing: "easeInOutQuart" as EasingName },
} as const;
