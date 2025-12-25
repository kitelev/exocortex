/**
 * AutoOptimizer - Automated performance optimization for graph visualization
 *
 * Monitors performance metrics and automatically applies or suggests
 * optimizations to maintain target frame rates for graphs with 100K+ nodes.
 *
 * Features:
 * - Automatic LOD adjustment based on performance
 * - Physics simulation tuning
 * - Rendering quality adaptation
 * - Node aggregation suggestions
 * - Visibility culling optimization
 * - Memory management recommendations
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

import type { PerformanceMetrics, FrameAnalysis } from "./PerformanceProfiler";
import type { BottleneckAnalysis } from "./BottleneckDetector";
import { LODLevel } from "../LODSystem";

/**
 * Optimization action that can be applied
 */
export interface OptimizationAction {
  /** Unique identifier for this action type */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category of optimization */
  category: OptimizationCategory;
  /** Detailed description */
  description: string;
  /** Whether this can be applied automatically */
  canAutoApply: boolean;
  /** Estimated performance improvement (0-100%) */
  estimatedImprovement: number;
  /** Priority (higher = more important) */
  priority: number;
  /** Whether this action is reversible */
  reversible: boolean;
  /** Current state before applying (for reversal) */
  previousState?: unknown;
  /** Function to apply the optimization */
  apply: () => void;
  /** Function to revert the optimization (if reversible) */
  revert?: () => void;
}

/**
 * Categories of optimizations
 */
export type OptimizationCategory =
  | "lod"
  | "physics"
  | "rendering"
  | "culling"
  | "memory"
  | "layout"
  | "aggregation";

/**
 * Optimization mode
 */
export type OptimizationMode = "manual" | "semi-auto" | "auto";

/**
 * Target performance profile
 */
export interface PerformanceTarget {
  /** Target FPS (default: 60) */
  targetFps: number;
  /** Minimum acceptable FPS (default: 30) */
  minimumFps: number;
  /** Target frame time in ms */
  targetFrameTime: number;
  /** Maximum acceptable frame time */
  maxFrameTime: number;
  /** Memory limit in MB (default: 1024) */
  memoryLimitMB: number;
}

/**
 * Current optimization state
 */
export interface OptimizationState {
  /** Current LOD level */
  lodLevel: LODLevel;
  /** Physics simulation enabled */
  physicsEnabled: boolean;
  /** Physics theta (Barnes-Hut approximation) */
  physicsTheta: number;
  /** Visibility culling enabled */
  cullingEnabled: boolean;
  /** Label rendering enabled */
  labelsEnabled: boolean;
  /** Edge anti-aliasing enabled */
  edgeAntialiasing: boolean;
  /** Node shadows enabled */
  nodeShadows: boolean;
  /** Maximum visible nodes */
  maxVisibleNodes: number;
  /** Aggregation enabled */
  aggregationEnabled: boolean;
  /** Aggregation threshold */
  aggregationThreshold: number;
}

/**
 * Configuration for AutoOptimizer
 */
export interface AutoOptimizerConfig {
  /** Optimization mode */
  mode: OptimizationMode;
  /** Performance targets */
  targets: PerformanceTarget;
  /** Minimum samples before applying optimizations */
  minSamplesForOptimization: number;
  /** Cooldown period after optimization in ms */
  optimizationCooldown: number;
  /** Whether to log optimization decisions */
  verbose: boolean;
  /** Maximum auto-optimizations per minute */
  maxAutoOptimizationsPerMinute: number;
}

/**
 * Event types emitted by AutoOptimizer
 */
export type OptimizerEventType =
  | "optimization-applied"
  | "optimization-suggested"
  | "optimization-reverted"
  | "state-changed";

/**
 * Event data for optimizer events
 */
export interface OptimizerEvent {
  type: OptimizerEventType;
  action?: OptimizationAction;
  state: OptimizationState;
  metrics?: PerformanceMetrics;
  message?: string;
}

/**
 * Event listener type
 */
export type OptimizerEventListener = (event: OptimizerEvent) => void;

/**
 * Default performance targets
 */
export const DEFAULT_PERFORMANCE_TARGETS: PerformanceTarget = {
  targetFps: 60,
  minimumFps: 30,
  targetFrameTime: 16.67,
  maxFrameTime: 33.33,
  memoryLimitMB: 1024,
};

/**
 * Default optimizer configuration
 */
export const DEFAULT_OPTIMIZER_CONFIG: AutoOptimizerConfig = {
  mode: "semi-auto",
  targets: DEFAULT_PERFORMANCE_TARGETS,
  minSamplesForOptimization: 30,
  optimizationCooldown: 2000,
  verbose: false,
  maxAutoOptimizationsPerMinute: 10,
};

/**
 * Default optimization state
 */
export const DEFAULT_OPTIMIZATION_STATE: OptimizationState = {
  lodLevel: LODLevel.HIGH,
  physicsEnabled: true,
  physicsTheta: 0.9,
  cullingEnabled: true,
  labelsEnabled: true,
  edgeAntialiasing: true,
  nodeShadows: true,
  maxVisibleNodes: 100000,
  aggregationEnabled: false,
  aggregationThreshold: 1000,
};

/**
 * AutoOptimizer - Automatic performance optimization engine
 *
 * @example
 * ```typescript
 * const optimizer = new AutoOptimizer({
 *   mode: "semi-auto",
 *   targets: { targetFps: 60, minimumFps: 30 },
 * });
 *
 * // Register callback for when state changes
 * optimizer.on("state-changed", (event) => {
 *   applyStateToRenderer(event.state);
 * });
 *
 * // In render loop, update with current metrics
 * optimizer.update(profiler.getCurrentMetrics(), profiler.getAnalysis());
 *
 * // Get suggested optimizations
 * const suggestions = optimizer.getSuggestions();
 * ```
 */
export class AutoOptimizer {
  /** Configuration */
  private readonly config: AutoOptimizerConfig;

  /** Current optimization state */
  private state: OptimizationState;

  /** Event listeners */
  private listeners: Map<OptimizerEventType, Set<OptimizerEventListener>> =
    new Map();

  /** Last optimization timestamp */
  private lastOptimizationTime = 0;

  /** Optimization count in current minute */
  private optimizationsThisMinute = 0;

  /** Minute timer reset */
  private minuteTimer: ReturnType<typeof setInterval> | null = null;

  /** Applied optimizations stack for reversal */
  private appliedOptimizations: OptimizationAction[] = [];

  /** Suggested optimizations queue */
  private suggestions: OptimizationAction[] = [];

  /** Recent performance history for trend detection */
  private performanceHistory: { fps: number; timestamp: number }[] = [];

  constructor(config: Partial<AutoOptimizerConfig> = {}) {
    this.config = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
    this.state = { ...DEFAULT_OPTIMIZATION_STATE };

    // Reset optimization counter every minute
    this.minuteTimer = setInterval(() => {
      this.optimizationsThisMinute = 0;
    }, 60000);
  }

  /**
   * Update optimizer with current performance metrics
   */
  update(
    metrics: PerformanceMetrics | null,
    analysis: FrameAnalysis | null,
    bottleneckAnalysis?: BottleneckAnalysis | null
  ): void {
    if (!metrics || !analysis) return;

    // Track performance history
    this.performanceHistory.push({
      fps: metrics.fps,
      timestamp: Date.now(),
    });

    // Keep only last 2 seconds of history
    const cutoff = Date.now() - 2000;
    this.performanceHistory = this.performanceHistory.filter(
      (h) => h.timestamp >= cutoff
    );

    // Generate suggestions based on current state
    this.suggestions = this.generateSuggestions(metrics, analysis, bottleneckAnalysis);

    // In auto mode, apply optimizations automatically
    if (this.config.mode === "auto" && this.shouldOptimize(analysis)) {
      this.applyNextOptimization();
    } else if (this.config.mode === "semi-auto" && analysis.level === "critical") {
      // In semi-auto, only auto-apply when critical
      this.applyNextOptimization();
    }
  }

  /**
   * Get current optimization state
   */
  getState(): Readonly<OptimizationState> {
    return { ...this.state };
  }

  /**
   * Set optimization state directly
   */
  setState(state: Partial<OptimizationState>): void {
    this.state = { ...this.state, ...state };
    this.emit("state-changed", undefined, this.state);
  }

  /**
   * Get current optimization suggestions
   */
  getSuggestions(): OptimizationAction[] {
    return [...this.suggestions];
  }

  /**
   * Apply a specific optimization
   */
  applyOptimization(actionId: string): boolean {
    const action = this.suggestions.find((a) => a.id === actionId);
    if (!action) return false;

    return this.applyAction(action);
  }

  /**
   * Apply the highest priority optimization
   */
  applyNextOptimization(): boolean {
    if (this.suggestions.length === 0) return false;

    // Filter to auto-applicable actions
    const autoApplicable = this.suggestions.filter(
      (a) => a.canAutoApply && a.estimatedImprovement > 5
    );

    if (autoApplicable.length === 0) return false;

    // Sort by priority
    autoApplicable.sort((a, b) => b.priority - a.priority);

    return this.applyAction(autoApplicable[0]);
  }

  /**
   * Revert the last applied optimization
   */
  revertLastOptimization(): boolean {
    const last = this.appliedOptimizations.pop();
    if (!last || !last.revert) return false;

    try {
      last.revert();
      this.emit("optimization-reverted", last, this.state);

      if (this.config.verbose) {
        console.log(`[AutoOptimizer] Reverted: ${last.name}`);
      }

      return true;
    } catch (error) {
      console.error(`[AutoOptimizer] Failed to revert: ${last.name}`, error);
      return false;
    }
  }

  /**
   * Revert all applied optimizations
   */
  revertAll(): void {
    while (this.appliedOptimizations.length > 0) {
      this.revertLastOptimization();
    }
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.state = { ...DEFAULT_OPTIMIZATION_STATE };
    this.appliedOptimizations = [];
    this.suggestions = [];
    this.performanceHistory = [];
    this.emit("state-changed", undefined, this.state);
  }

  /**
   * Add event listener
   */
  on(event: OptimizerEventType, listener: OptimizerEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(event: OptimizerEventType, listener: OptimizerEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Get optimization mode
   */
  getMode(): OptimizationMode {
    return this.config.mode;
  }

  /**
   * Set optimization mode
   */
  setMode(mode: OptimizationMode): void {
    (this.config as AutoOptimizerConfig).mode = mode;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.minuteTimer) {
      clearInterval(this.minuteTimer);
      this.minuteTimer = null;
    }
    this.listeners.clear();
    this.appliedOptimizations = [];
    this.suggestions = [];
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private shouldOptimize(analysis: FrameAnalysis): boolean {
    // Check cooldown
    const now = Date.now();
    if (now - this.lastOptimizationTime < this.config.optimizationCooldown) {
      return false;
    }

    // Check rate limit
    if (
      this.optimizationsThisMinute >= this.config.maxAutoOptimizationsPerMinute
    ) {
      return false;
    }

    // Check if performance is poor enough to warrant optimization
    return analysis.level === "warning" || analysis.level === "critical";
  }

  private applyAction(action: OptimizationAction): boolean {
    // Check cooldown
    const now = Date.now();
    if (now - this.lastOptimizationTime < this.config.optimizationCooldown) {
      return false;
    }

    // Check rate limit
    if (
      this.optimizationsThisMinute >= this.config.maxAutoOptimizationsPerMinute
    ) {
      return false;
    }

    try {
      action.apply();

      this.lastOptimizationTime = now;
      this.optimizationsThisMinute++;

      if (action.reversible) {
        this.appliedOptimizations.push(action);
      }

      this.emit("optimization-applied", action, this.state);

      if (this.config.verbose) {
        console.log(
          `[AutoOptimizer] Applied: ${action.name} (estimated +${action.estimatedImprovement}%)`
        );
      }

      return true;
    } catch (error) {
      console.error(`[AutoOptimizer] Failed to apply: ${action.name}`, error);
      return false;
    }
  }

  private generateSuggestions(
    metrics: PerformanceMetrics,
    analysis: FrameAnalysis,
    bottleneckAnalysis?: BottleneckAnalysis | null
  ): OptimizationAction[] {
    const suggestions: OptimizationAction[] = [];

    // Check if we're meeting targets
    const isBelowTarget = analysis.fps < this.config.targets.targetFps;
    const isCritical = analysis.fps < this.config.targets.minimumFps;

    if (!isBelowTarget) {
      // Performance is good, check if we can increase quality
      if (this.state.lodLevel < LODLevel.HIGH) {
        suggestions.push(this.createIncreaseLODAction());
      }
      return suggestions;
    }

    // Generate suggestions based on bottlenecks
    const mainBottleneck = bottleneckAnalysis?.bottlenecks[0]?.category;

    // LOD reduction is usually the most effective
    if (this.state.lodLevel > LODLevel.MINIMAL) {
      suggestions.push(this.createReduceLODAction(isCritical));
    }

    // Physics optimization
    if (
      mainBottleneck === "physics" ||
      analysis.bottleneck === "physics" ||
      metrics.physicsTime > 5
    ) {
      if (this.state.physicsTheta < 1.5) {
        suggestions.push(this.createIncreasePhysicsThetaAction());
      }
      if (this.state.physicsEnabled && isCritical) {
        suggestions.push(this.createDisablePhysicsAction());
      }
    }

    // Rendering optimizations
    if (
      mainBottleneck === "rendering" ||
      mainBottleneck === "gpu" ||
      metrics.renderTime > 8
    ) {
      if (this.state.nodeShadows) {
        suggestions.push(this.createDisableShadowsAction());
      }
      if (this.state.edgeAntialiasing) {
        suggestions.push(this.createDisableAntialiasAction());
      }
      if (this.state.labelsEnabled && metrics.visibleNodes > 5000) {
        suggestions.push(this.createDisableLabelsAction());
      }
    }

    // Too many visible elements
    if (metrics.visibleNodes > 50000) {
      if (!this.state.aggregationEnabled) {
        suggestions.push(this.createEnableAggregationAction(metrics.visibleNodes));
      }
      if (this.state.maxVisibleNodes > 50000) {
        suggestions.push(this.createReduceMaxVisibleAction());
      }
    }

    // Culling optimization
    if (!this.state.cullingEnabled) {
      suggestions.push(this.createEnableCullingAction());
    }

    // Sort by priority
    suggestions.sort((a, b) => b.priority - a.priority);

    return suggestions;
  }

  // ============================================================
  // Optimization Action Factories
  // ============================================================

  private createReduceLODAction(critical: boolean): OptimizationAction {
    const currentLevel = this.state.lodLevel;
    const newLevel = Math.max(LODLevel.MINIMAL, currentLevel - (critical ? 2 : 1));

    return {
      id: "reduce-lod",
      name: "Reduce Level of Detail",
      category: "lod",
      description: `Reduce LOD from ${LODLevel[currentLevel]} to ${LODLevel[newLevel]} for better performance`,
      canAutoApply: true,
      estimatedImprovement: 15 + (currentLevel - newLevel) * 10,
      priority: 100,
      reversible: true,
      previousState: currentLevel,
      apply: () => {
        this.state.lodLevel = newLevel;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.lodLevel = currentLevel;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createIncreaseLODAction(): OptimizationAction {
    const currentLevel = this.state.lodLevel;
    const newLevel = Math.min(LODLevel.ULTRA, currentLevel + 1);

    return {
      id: "increase-lod",
      name: "Increase Level of Detail",
      category: "lod",
      description: `Increase LOD from ${LODLevel[currentLevel]} to ${LODLevel[newLevel]} for better quality`,
      canAutoApply: true,
      estimatedImprovement: -5, // Negative - decreases performance
      priority: 10,
      reversible: true,
      previousState: currentLevel,
      apply: () => {
        this.state.lodLevel = newLevel;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.lodLevel = currentLevel;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createIncreasePhysicsThetaAction(): OptimizationAction {
    const currentTheta = this.state.physicsTheta;
    const newTheta = Math.min(1.5, currentTheta + 0.2);

    return {
      id: "increase-physics-theta",
      name: "Reduce Physics Accuracy",
      category: "physics",
      description: `Increase Barnes-Hut theta from ${currentTheta.toFixed(1)} to ${newTheta.toFixed(1)} for faster physics`,
      canAutoApply: true,
      estimatedImprovement: 10,
      priority: 80,
      reversible: true,
      previousState: currentTheta,
      apply: () => {
        this.state.physicsTheta = newTheta;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.physicsTheta = currentTheta;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createDisablePhysicsAction(): OptimizationAction {
    return {
      id: "disable-physics",
      name: "Pause Physics Simulation",
      category: "physics",
      description: "Pause physics simulation to improve performance",
      canAutoApply: false, // Requires user confirmation
      estimatedImprovement: 25,
      priority: 70,
      reversible: true,
      previousState: this.state.physicsEnabled,
      apply: () => {
        this.state.physicsEnabled = false;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.physicsEnabled = true;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createDisableShadowsAction(): OptimizationAction {
    return {
      id: "disable-shadows",
      name: "Disable Node Shadows",
      category: "rendering",
      description: "Disable node shadows to reduce rendering overhead",
      canAutoApply: true,
      estimatedImprovement: 8,
      priority: 60,
      reversible: true,
      previousState: this.state.nodeShadows,
      apply: () => {
        this.state.nodeShadows = false;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.nodeShadows = true;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createDisableAntialiasAction(): OptimizationAction {
    return {
      id: "disable-antialias",
      name: "Disable Edge Antialiasing",
      category: "rendering",
      description: "Disable edge antialiasing for faster edge rendering",
      canAutoApply: true,
      estimatedImprovement: 5,
      priority: 50,
      reversible: true,
      previousState: this.state.edgeAntialiasing,
      apply: () => {
        this.state.edgeAntialiasing = false;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.edgeAntialiasing = true;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createDisableLabelsAction(): OptimizationAction {
    return {
      id: "disable-labels",
      name: "Hide Node Labels",
      category: "rendering",
      description: "Hide labels to reduce text rendering overhead",
      canAutoApply: true,
      estimatedImprovement: 12,
      priority: 55,
      reversible: true,
      previousState: this.state.labelsEnabled,
      apply: () => {
        this.state.labelsEnabled = false;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.labelsEnabled = true;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createEnableAggregationAction(nodeCount: number): OptimizationAction {
    const threshold = Math.max(1000, Math.floor(nodeCount / 100));

    return {
      id: "enable-aggregation",
      name: "Enable Node Aggregation",
      category: "aggregation",
      description: `Aggregate clusters of nodes (threshold: ${threshold} nodes) to reduce visible element count`,
      canAutoApply: false, // Significant visual change
      estimatedImprovement: 30,
      priority: 90,
      reversible: true,
      previousState: {
        enabled: this.state.aggregationEnabled,
        threshold: this.state.aggregationThreshold,
      },
      apply: () => {
        this.state.aggregationEnabled = true;
        this.state.aggregationThreshold = threshold;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.aggregationEnabled = false;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createReduceMaxVisibleAction(): OptimizationAction {
    const current = this.state.maxVisibleNodes;
    const newMax = Math.max(10000, Math.floor(current * 0.5));

    return {
      id: "reduce-max-visible",
      name: "Reduce Maximum Visible Nodes",
      category: "culling",
      description: `Reduce max visible nodes from ${current.toLocaleString()} to ${newMax.toLocaleString()}`,
      canAutoApply: false,
      estimatedImprovement: 20,
      priority: 75,
      reversible: true,
      previousState: current,
      apply: () => {
        this.state.maxVisibleNodes = newMax;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.maxVisibleNodes = current;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private createEnableCullingAction(): OptimizationAction {
    return {
      id: "enable-culling",
      name: "Enable Visibility Culling",
      category: "culling",
      description: "Enable viewport-based visibility culling to skip off-screen elements",
      canAutoApply: true,
      estimatedImprovement: 15,
      priority: 85,
      reversible: true,
      previousState: false,
      apply: () => {
        this.state.cullingEnabled = true;
        this.emit("state-changed", undefined, this.state);
      },
      revert: () => {
        this.state.cullingEnabled = false;
        this.emit("state-changed", undefined, this.state);
      },
    };
  }

  private emit(
    type: OptimizerEventType,
    action?: OptimizationAction,
    state?: OptimizationState,
    message?: string
  ): void {
    const event: OptimizerEvent = {
      type,
      action,
      state: state ?? this.state,
      message,
    };
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

/**
 * Create a new AutoOptimizer instance
 */
export function createAutoOptimizer(
  config?: Partial<AutoOptimizerConfig>
): AutoOptimizer {
  return new AutoOptimizer(config);
}

/**
 * Get default optimization presets
 */
export function getOptimizationPresets(): Record<string, Partial<OptimizationState>> {
  return {
    quality: {
      lodLevel: LODLevel.ULTRA,
      physicsTheta: 0.5,
      labelsEnabled: true,
      edgeAntialiasing: true,
      nodeShadows: true,
      aggregationEnabled: false,
    },
    balanced: {
      lodLevel: LODLevel.HIGH,
      physicsTheta: 0.9,
      labelsEnabled: true,
      edgeAntialiasing: true,
      nodeShadows: false,
      aggregationEnabled: false,
    },
    performance: {
      lodLevel: LODLevel.MEDIUM,
      physicsTheta: 1.2,
      labelsEnabled: false,
      edgeAntialiasing: false,
      nodeShadows: false,
      aggregationEnabled: true,
      aggregationThreshold: 500,
    },
    extreme: {
      lodLevel: LODLevel.MINIMAL,
      physicsTheta: 1.5,
      labelsEnabled: false,
      edgeAntialiasing: false,
      nodeShadows: false,
      aggregationEnabled: true,
      aggregationThreshold: 100,
      maxVisibleNodes: 10000,
    },
  };
}
