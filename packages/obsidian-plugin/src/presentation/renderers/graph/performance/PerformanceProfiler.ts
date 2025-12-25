/**
 * PerformanceProfiler - Comprehensive performance profiling for graph visualization
 *
 * Provides detailed frame time analysis, section timing, and performance metrics
 * for monitoring and optimizing graph rendering performance at scale (100K+ nodes).
 *
 * Features:
 * - Frame-level timing with high-precision performance.now()
 * - Section-based profiling (render, physics, layout, data updates)
 * - Rolling average calculation for trend analysis
 * - FPS monitoring with warning/critical thresholds
 * - Memory usage tracking
 * - Automatic performance reporting
 * - Draw call and triangle count tracking
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

/**
 * Performance metrics snapshot for a single frame
 */
export interface PerformanceMetrics {
  /** Total frame time in milliseconds */
  frameTime: number;
  /** Current frames per second */
  fps: number;
  /** Time spent on rendering in ms */
  renderTime: number;
  /** Time spent on physics simulation in ms */
  physicsTime: number;
  /** Time spent on layout calculation in ms */
  layoutTime: number;
  /** Time spent on data updates in ms */
  dataUpdateTime: number;
  /** Number of WebGL draw calls */
  drawCalls: number;
  /** Number of triangles rendered */
  triangleCount: number;
  /** Number of currently visible nodes */
  visibleNodes: number;
  /** Number of currently visible edges */
  visibleEdges: number;
  /** Estimated memory usage in bytes */
  memoryUsage: number;
  /** Timestamp when metrics were captured */
  timestamp: number;
}

/**
 * Configuration options for the profiler
 */
export interface ProfilerOptions {
  /** Number of frames to average for metrics (default: 60) */
  sampleSize: number;
  /** Frame time in ms that triggers a warning (default: 16.67 for 60fps) */
  warningThreshold: number;
  /** Frame time in ms that indicates critical performance (default: 33.33 for 30fps) */
  criticalThreshold: number;
  /** Whether to automatically profile each frame (default: true) */
  autoProfile: boolean;
  /** Interval in ms between automatic reports (default: 1000) */
  reportInterval: number;
  /** Whether to track memory usage (default: true) */
  trackMemory: boolean;
  /** Maximum samples to retain in history (default: 300 = 5 seconds at 60fps) */
  maxHistorySize: number;
}

/**
 * Section timing for a specific part of frame processing
 */
export interface SectionTiming {
  /** Section name */
  name: ProfileSection;
  /** Start time (performance.now()) */
  startTime: number;
  /** End time (performance.now()) */
  endTime: number;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Named sections for profiling
 */
export type ProfileSection =
  | "render"
  | "physics"
  | "layout"
  | "dataUpdate"
  | "culling"
  | "nodeRender"
  | "edgeRender"
  | "labelRender"
  | "custom";

/**
 * Performance level based on current metrics
 */
export type PerformanceLevel = "excellent" | "good" | "warning" | "critical";

/**
 * Frame analysis result
 */
export interface FrameAnalysis {
  /** Current performance level */
  level: PerformanceLevel;
  /** Current FPS */
  fps: number;
  /** Average frame time in ms */
  avgFrameTime: number;
  /** Frame time variance (jitter) */
  variance: number;
  /** Percentage of frames meeting 60fps target */
  hitRate60: number;
  /** Percentage of frames meeting 30fps target */
  hitRate30: number;
  /** Section with highest time consumption */
  bottleneck: ProfileSection | null;
  /** Bottleneck percentage of total frame time */
  bottleneckPercentage: number;
}

/**
 * Event types emitted by the profiler
 */
export type ProfilerEventType = "frame" | "warning" | "critical" | "report";

/**
 * Event data for profiler events
 */
export interface ProfilerEvent {
  type: ProfilerEventType;
  metrics: PerformanceMetrics;
  analysis?: FrameAnalysis;
  message?: string;
}

/**
 * Event listener type
 */
export type ProfilerEventListener = (event: ProfilerEvent) => void;

/**
 * Default profiler options
 */
export const DEFAULT_PROFILER_OPTIONS: ProfilerOptions = {
  sampleSize: 60,
  warningThreshold: 16.67, // 60 FPS
  criticalThreshold: 33.33, // 30 FPS
  autoProfile: true,
  reportInterval: 1000,
  trackMemory: true,
  maxHistorySize: 300,
};

/**
 * PerformanceProfiler - Main profiling class for graph visualization
 *
 * @example
 * ```typescript
 * const profiler = new PerformanceProfiler({
 *   warningThreshold: 16.67,
 *   autoProfile: true,
 * });
 *
 * // In render loop
 * profiler.beginFrame();
 *
 * profiler.beginSection("physics");
 * // ... physics calculations ...
 * profiler.endSection("physics");
 *
 * profiler.beginSection("render");
 * // ... rendering ...
 * profiler.endSection("render");
 *
 * profiler.setDrawCallCount(150);
 * profiler.setTriangleCount(50000);
 * profiler.setVisibleCounts(5000, 8000);
 *
 * profiler.endFrame();
 *
 * // Get current analysis
 * const analysis = profiler.getAnalysis();
 * console.log(`Performance: ${analysis.level}, FPS: ${analysis.fps}`);
 * ```
 */
export class PerformanceProfiler {
  /** Configuration options */
  private readonly options: ProfilerOptions;

  /** Sample history for averaging */
  private samples: PerformanceMetrics[] = [];

  /** Current frame being profiled */
  private currentFrame: Partial<PerformanceMetrics> = {};

  /** Frame start timestamp */
  private frameStart = 0;

  /** Section start timestamp */
  private sectionStart = 0;

  /** Currently active section */
  private activeSection: ProfileSection | null = null;

  /** Section timings for current frame */
  private sectionTimings: Map<ProfileSection, number> = new Map();

  /** Event listeners */
  private listeners: Map<ProfilerEventType, Set<ProfilerEventListener>> =
    new Map();

  /** Auto-report timer */
  private reportTimer: ReturnType<typeof setInterval> | null = null;

  /** Last reported timestamp */
  private lastReportTime = 0;

  /** Frame counter since last report */
  private framesSinceReport = 0;

  /** Whether profiling is currently active */
  private isActive = false;

  /** Whether currently in a frame */
  private inFrame = false;

  constructor(options: Partial<ProfilerOptions> = {}) {
    this.options = { ...DEFAULT_PROFILER_OPTIONS, ...options };

    if (this.options.autoProfile) {
      this.startAutoReport();
    }
  }

  /**
   * Start automatic performance reporting
   */
  startAutoReport(): void {
    if (this.reportTimer) return;

    this.lastReportTime = performance.now();
    this.isActive = true;

    this.reportTimer = setInterval(() => {
      this.generateReport();
    }, this.options.reportInterval);
  }

  /**
   * Stop automatic performance reporting
   */
  stopAutoReport(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    this.isActive = false;
  }

  /**
   * Begin profiling a new frame
   */
  beginFrame(): void {
    if (this.inFrame) {
      // Auto-end previous frame if not properly closed
      this.endFrame();
    }

    this.frameStart = performance.now();
    this.inFrame = true;
    this.sectionTimings.clear();

    this.currentFrame = {
      visibleNodes: 0,
      visibleEdges: 0,
      drawCalls: 0,
      triangleCount: 0,
      renderTime: 0,
      physicsTime: 0,
      layoutTime: 0,
      dataUpdateTime: 0,
    };
  }

  /**
   * Begin timing a specific section
   * @param section Section name to start timing
   */
  beginSection(section: ProfileSection): void {
    if (!this.inFrame) {
      this.beginFrame();
    }

    if (this.activeSection) {
      // Auto-end previous section
      this.endSection(this.activeSection);
    }

    this.activeSection = section;
    this.sectionStart = performance.now();
  }

  /**
   * End timing a specific section
   * @param section Section name to end timing
   */
  endSection(section: ProfileSection): void {
    if (this.activeSection !== section) return;

    const duration = performance.now() - this.sectionStart;
    this.sectionTimings.set(section, duration);

    // Update current frame metrics
    switch (section) {
      case "render":
      case "nodeRender":
      case "edgeRender":
      case "labelRender":
        this.currentFrame.renderTime =
          (this.currentFrame.renderTime || 0) + duration;
        break;
      case "physics":
        this.currentFrame.physicsTime = duration;
        break;
      case "layout":
        this.currentFrame.layoutTime = duration;
        break;
      case "dataUpdate":
        this.currentFrame.dataUpdateTime = duration;
        break;
    }

    this.activeSection = null;
  }

  /**
   * Set the number of draw calls for current frame
   */
  setDrawCallCount(count: number): void {
    this.currentFrame.drawCalls = count;
  }

  /**
   * Set the triangle count for current frame
   */
  setTriangleCount(count: number): void {
    this.currentFrame.triangleCount = count;
  }

  /**
   * Set visible node and edge counts
   */
  setVisibleCounts(nodes: number, edges: number): void {
    this.currentFrame.visibleNodes = nodes;
    this.currentFrame.visibleEdges = edges;
  }

  /**
   * End the current frame and record metrics
   */
  endFrame(): void {
    if (!this.inFrame) return;

    // Auto-end any active section
    if (this.activeSection) {
      this.endSection(this.activeSection);
    }

    const frameTime = performance.now() - this.frameStart;
    const now = Date.now();

    // Get memory usage if available
    let memoryUsage = 0;
    if (this.options.trackMemory && typeof performance !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perf = performance as any;
      if (perf.memory) {
        memoryUsage = perf.memory.usedJSHeapSize || 0;
      }
    }

    const metrics: PerformanceMetrics = {
      frameTime,
      fps: frameTime > 0 ? 1000 / frameTime : 0,
      renderTime: this.currentFrame.renderTime || 0,
      physicsTime: this.currentFrame.physicsTime || 0,
      layoutTime: this.currentFrame.layoutTime || 0,
      dataUpdateTime: this.currentFrame.dataUpdateTime || 0,
      drawCalls: this.currentFrame.drawCalls || 0,
      triangleCount: this.currentFrame.triangleCount || 0,
      visibleNodes: this.currentFrame.visibleNodes || 0,
      visibleEdges: this.currentFrame.visibleEdges || 0,
      memoryUsage,
      timestamp: now,
    };

    // Add to samples
    this.samples.push(metrics);

    // Trim history if needed
    while (this.samples.length > this.options.maxHistorySize) {
      this.samples.shift();
    }

    this.framesSinceReport++;
    this.inFrame = false;

    // Emit frame event
    this.emit("frame", metrics);

    // Check thresholds
    if (frameTime >= this.options.criticalThreshold) {
      this.emit("critical", metrics, undefined, `Critical frame time: ${frameTime.toFixed(2)}ms`);
    } else if (frameTime >= this.options.warningThreshold) {
      this.emit("warning", metrics, undefined, `High frame time: ${frameTime.toFixed(2)}ms`);
    }
  }

  /**
   * Get current performance metrics (latest sample)
   */
  getCurrentMetrics(): PerformanceMetrics | null {
    return this.samples.length > 0
      ? this.samples[this.samples.length - 1]
      : null;
  }

  /**
   * Get averaged performance metrics over the sample window
   */
  getAverageMetrics(): PerformanceMetrics {
    const count = this.samples.length;
    if (count === 0) {
      return this.createEmptyMetrics();
    }

    const sum = this.samples.reduce(
      (acc, sample) => ({
        frameTime: acc.frameTime + sample.frameTime,
        fps: acc.fps + sample.fps,
        renderTime: acc.renderTime + sample.renderTime,
        physicsTime: acc.physicsTime + sample.physicsTime,
        layoutTime: acc.layoutTime + sample.layoutTime,
        dataUpdateTime: acc.dataUpdateTime + sample.dataUpdateTime,
        drawCalls: acc.drawCalls + sample.drawCalls,
        triangleCount: acc.triangleCount + sample.triangleCount,
        visibleNodes: acc.visibleNodes + sample.visibleNodes,
        visibleEdges: acc.visibleEdges + sample.visibleEdges,
        memoryUsage: acc.memoryUsage + sample.memoryUsage,
        timestamp: sample.timestamp,
      }),
      this.createEmptyMetrics()
    );

    return {
      frameTime: sum.frameTime / count,
      fps: sum.fps / count,
      renderTime: sum.renderTime / count,
      physicsTime: sum.physicsTime / count,
      layoutTime: sum.layoutTime / count,
      dataUpdateTime: sum.dataUpdateTime / count,
      drawCalls: Math.round(sum.drawCalls / count),
      triangleCount: Math.round(sum.triangleCount / count),
      visibleNodes: Math.round(sum.visibleNodes / count),
      visibleEdges: Math.round(sum.visibleEdges / count),
      memoryUsage: Math.round(sum.memoryUsage / count),
      timestamp: sum.timestamp,
    };
  }

  /**
   * Get comprehensive frame analysis
   */
  getAnalysis(): FrameAnalysis {
    const count = this.samples.length;
    if (count === 0) {
      return {
        level: "excellent",
        fps: 0,
        avgFrameTime: 0,
        variance: 0,
        hitRate60: 100,
        hitRate30: 100,
        bottleneck: null,
        bottleneckPercentage: 0,
      };
    }

    const avg = this.getAverageMetrics();

    // Calculate variance
    const sumSquaredDiff = this.samples.reduce(
      (acc, sample) => acc + Math.pow(sample.frameTime - avg.frameTime, 2),
      0
    );
    const variance = Math.sqrt(sumSquaredDiff / count);

    // Calculate hit rates
    const frames60 = this.samples.filter(
      (s) => s.frameTime <= this.options.warningThreshold
    ).length;
    const frames30 = this.samples.filter(
      (s) => s.frameTime <= this.options.criticalThreshold
    ).length;

    const hitRate60 = (frames60 / count) * 100;
    const hitRate30 = (frames30 / count) * 100;

    // Determine performance level
    let level: PerformanceLevel;
    if (avg.frameTime <= 10) {
      level = "excellent";
    } else if (avg.frameTime <= this.options.warningThreshold) {
      level = "good";
    } else if (avg.frameTime <= this.options.criticalThreshold) {
      level = "warning";
    } else {
      level = "critical";
    }

    // Find bottleneck
    const sections: [ProfileSection, number][] = [
      ["render", avg.renderTime],
      ["physics", avg.physicsTime],
      ["layout", avg.layoutTime],
      ["dataUpdate", avg.dataUpdateTime],
    ];

    const maxSection = sections.reduce(
      (max, section) => (section[1] > max[1] ? section : max),
      sections[0]
    );

    const bottleneck =
      maxSection[1] > 0 ? maxSection[0] : null;
    const bottleneckPercentage =
      avg.frameTime > 0 ? (maxSection[1] / avg.frameTime) * 100 : 0;

    return {
      level,
      fps: avg.fps,
      avgFrameTime: avg.frameTime,
      variance,
      hitRate60,
      hitRate30,
      bottleneck,
      bottleneckPercentage,
    };
  }

  /**
   * Get samples within a time range
   */
  getSamples(startTime?: number, endTime?: number): PerformanceMetrics[] {
    if (startTime === undefined && endTime === undefined) {
      return [...this.samples];
    }

    return this.samples.filter((sample) => {
      if (startTime !== undefined && sample.timestamp < startTime) return false;
      if (endTime !== undefined && sample.timestamp > endTime) return false;
      return true;
    });
  }

  /**
   * Get the number of samples in history
   */
  getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Clear all samples and reset profiler
   */
  reset(): void {
    this.samples = [];
    this.currentFrame = {};
    this.sectionTimings.clear();
    this.framesSinceReport = 0;
    this.inFrame = false;
    this.activeSection = null;
  }

  /**
   * Add event listener
   */
  on(event: ProfilerEventType, listener: ProfilerEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(event: ProfilerEventType, listener: ProfilerEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Dispose of the profiler and clean up resources
   */
  dispose(): void {
    this.stopAutoReport();
    this.listeners.clear();
    this.samples = [];
  }

  /**
   * Check if profiler is currently active
   */
  isProfilerActive(): boolean {
    return this.isActive;
  }

  /**
   * Get the profiler configuration
   */
  getOptions(): Readonly<ProfilerOptions> {
    return { ...this.options };
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private createEmptyMetrics(): PerformanceMetrics {
    return {
      frameTime: 0,
      fps: 0,
      renderTime: 0,
      physicsTime: 0,
      layoutTime: 0,
      dataUpdateTime: 0,
      drawCalls: 0,
      triangleCount: 0,
      visibleNodes: 0,
      visibleEdges: 0,
      memoryUsage: 0,
      timestamp: Date.now(),
    };
  }

  private emit(
    type: ProfilerEventType,
    metrics: PerformanceMetrics,
    analysis?: FrameAnalysis,
    message?: string
  ): void {
    const event: ProfilerEvent = { type, metrics, analysis, message };
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  private generateReport(): void {
    const now = performance.now();
    const elapsed = now - this.lastReportTime;

    if (elapsed < this.options.reportInterval * 0.9) {
      return; // Not enough time has passed
    }

    const metrics = this.getAverageMetrics();
    const analysis = this.getAnalysis();

    this.emit("report", metrics, analysis);

    this.lastReportTime = now;
    this.framesSinceReport = 0;
  }
}

/**
 * Create a new PerformanceProfiler instance
 */
export function createPerformanceProfiler(
  options?: Partial<ProfilerOptions>
): PerformanceProfiler {
  return new PerformanceProfiler(options);
}

/**
 * Singleton instance for global profiling
 */
let globalProfiler: PerformanceProfiler | null = null;

/**
 * Get the global profiler instance
 */
export function getGlobalProfiler(): PerformanceProfiler {
  if (!globalProfiler) {
    globalProfiler = new PerformanceProfiler();
  }
  return globalProfiler;
}

/**
 * Reset the global profiler instance
 */
export function resetGlobalProfiler(): void {
  if (globalProfiler) {
    globalProfiler.dispose();
    globalProfiler = null;
  }
}
