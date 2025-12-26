/**
 * BottleneckDetector - Automatic performance bottleneck detection and analysis
 *
 * Analyzes performance metrics to identify bottlenecks and provide actionable
 * insights for optimizing graph visualization performance.
 *
 * Features:
 * - Automatic bottleneck identification
 * - Trend analysis for performance degradation
 * - Resource utilization analysis
 * - Recommendations for optimization
 * - Severity classification
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

import type {
  PerformanceMetrics,
  ProfileSection,
} from "./PerformanceProfiler";

/**
 * Bottleneck severity levels
 */
export type BottleneckSeverity = "info" | "low" | "medium" | "high" | "critical";

/**
 * Bottleneck categories
 */
export type BottleneckCategory =
  | "cpu"
  | "gpu"
  | "memory"
  | "physics"
  | "rendering"
  | "layout"
  | "data"
  | "general";

/**
 * Detected bottleneck information
 */
export interface Bottleneck {
  /** Unique identifier for this bottleneck type */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category of the bottleneck */
  category: BottleneckCategory;
  /** Severity level */
  severity: BottleneckSeverity;
  /** Affected profile section(s) */
  sections: ProfileSection[];
  /** Detailed description of the issue */
  description: string;
  /** Specific metric values that triggered detection */
  metrics: Record<string, number>;
  /** Recommended actions to address the bottleneck */
  recommendations: string[];
  /** Estimated performance impact (percentage of frame time) */
  impact: number;
  /** Confidence score 0-1 */
  confidence: number;
  /** When the bottleneck was first detected */
  firstDetected: number;
  /** Whether this is a persistent or transient issue */
  persistent: boolean;
}

/**
 * Trend direction for metrics
 */
export type TrendDirection = "improving" | "stable" | "degrading";

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  /** Metric name */
  metric: string;
  /** Current value */
  currentValue: number;
  /** Value at start of analysis window */
  startValue: number;
  /** Trend direction */
  direction: TrendDirection;
  /** Percentage change */
  percentChange: number;
  /** Whether the change is significant */
  significant: boolean;
}

/**
 * Resource utilization snapshot
 */
export interface ResourceUtilization {
  /** CPU utilization estimate 0-100% */
  cpuEstimate: number;
  /** GPU utilization estimate 0-100% */
  gpuEstimate: number;
  /** Memory utilization in MB */
  memoryMB: number;
  /** Draw call efficiency (triangles per draw call) */
  drawCallEfficiency: number;
  /** Visible element ratio (visible / total) */
  visibilityRatio: number;
}

/**
 * Complete bottleneck analysis result
 */
export interface BottleneckAnalysis {
  /** Detected bottlenecks ordered by severity */
  bottlenecks: Bottleneck[];
  /** Trend analysis for key metrics */
  trends: TrendAnalysis[];
  /** Current resource utilization */
  resources: ResourceUtilization;
  /** Overall health score 0-100 */
  healthScore: number;
  /** Summary of recommendations */
  topRecommendations: string[];
  /** Timestamp of analysis */
  timestamp: number;
}

/**
 * Configuration for bottleneck detection
 */
export interface BottleneckDetectorConfig {
  /** Minimum samples required for analysis (default: 30) */
  minSamples: number;
  /** Trend analysis window size in samples (default: 60) */
  trendWindowSize: number;
  /** Threshold for significant trend change % (default: 10) */
  significantChangeThreshold: number;
  /** Frame time threshold for CPU bottleneck (default: 8ms) */
  cpuBottleneckThreshold: number;
  /** Draw calls threshold for GPU bottleneck (default: 200) */
  gpuDrawCallThreshold: number;
  /** Memory threshold in MB for memory bottleneck (default: 500) */
  memoryThresholdMB: number;
  /** Visible nodes threshold for rendering bottleneck (default: 50000) */
  visibleNodesThreshold: number;
  /** Physics time threshold in ms (default: 5) */
  physicsThresholdMs: number;
  /** Layout time threshold in ms (default: 10) */
  layoutThresholdMs: number;
}

/**
 * Default detector configuration
 */
export const DEFAULT_DETECTOR_CONFIG: BottleneckDetectorConfig = {
  minSamples: 30,
  trendWindowSize: 60,
  significantChangeThreshold: 10,
  cpuBottleneckThreshold: 8,
  gpuDrawCallThreshold: 200,
  memoryThresholdMB: 500,
  visibleNodesThreshold: 50000,
  physicsThresholdMs: 5,
  layoutThresholdMs: 10,
};

/**
 * BottleneckDetector - Analyzes performance metrics to identify bottlenecks
 *
 * @example
 * ```typescript
 * const detector = new BottleneckDetector();
 *
 * // Analyze metrics from profiler
 * const samples = profiler.getSamples();
 * const analysis = detector.analyze(samples);
 *
 * // Log detected bottlenecks
 * for (const bottleneck of analysis.bottlenecks) {
 *   console.log(`${bottleneck.severity}: ${bottleneck.name}`);
 *   console.log(`  Impact: ${bottleneck.impact}%`);
 *   console.log(`  Recommendations:`);
 *   bottleneck.recommendations.forEach(r => console.log(`    - ${r}`));
 * }
 *
 * // Check overall health
 * console.log(`Health Score: ${analysis.healthScore}/100`);
 * ```
 */
export class BottleneckDetector {
  /** Configuration */
  private readonly config: BottleneckDetectorConfig;

  /** History of detected bottlenecks for persistence tracking */
  private bottleneckHistory: Map<string, { firstSeen: number; count: number }> =
    new Map();

  constructor(config: Partial<BottleneckDetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  }

  /**
   * Analyze performance metrics and detect bottlenecks
   */
  analyze(samples: PerformanceMetrics[]): BottleneckAnalysis {
    if (samples.length < this.config.minSamples) {
      return this.createEmptyAnalysis();
    }

    const bottlenecks: Bottleneck[] = [];
    const recentSamples = samples.slice(-this.config.trendWindowSize);
    const avg = this.calculateAverage(recentSamples);

    // Detect various bottleneck types
    this.detectCPUBottleneck(avg, recentSamples, bottlenecks);
    this.detectGPUBottleneck(avg, recentSamples, bottlenecks);
    this.detectPhysicsBottleneck(avg, recentSamples, bottlenecks);
    this.detectLayoutBottleneck(avg, recentSamples, bottlenecks);
    this.detectRenderingBottleneck(avg, recentSamples, bottlenecks);
    this.detectMemoryBottleneck(avg, recentSamples, bottlenecks);
    this.detectFrameDrops(recentSamples, bottlenecks);

    // Update persistence tracking
    this.updateBottleneckHistory(bottlenecks);

    // Sort by severity and impact
    bottlenecks.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      return severityDiff !== 0 ? severityDiff : b.impact - a.impact;
    });

    // Calculate trends
    const trends = this.analyzeTrends(samples);

    // Calculate resource utilization
    const resources = this.calculateResourceUtilization(avg);

    // Calculate health score
    const healthScore = this.calculateHealthScore(bottlenecks, avg);

    // Extract top recommendations
    const topRecommendations = this.extractTopRecommendations(bottlenecks);

    return {
      bottlenecks,
      trends,
      resources,
      healthScore,
      topRecommendations,
      timestamp: Date.now(),
    };
  }

  /**
   * Get quick bottleneck summary without full analysis
   */
  quickCheck(metrics: PerformanceMetrics): {
    hasIssues: boolean;
    mainBottleneck: BottleneckCategory | null;
    severity: BottleneckSeverity;
  } {
    if (metrics.frameTime > 33) {
      if (metrics.physicsTime > metrics.renderTime) {
        return { hasIssues: true, mainBottleneck: "physics", severity: "high" };
      }
      if (metrics.layoutTime > 10) {
        return { hasIssues: true, mainBottleneck: "layout", severity: "high" };
      }
      return { hasIssues: true, mainBottleneck: "rendering", severity: "high" };
    }

    if (metrics.frameTime > 16) {
      return { hasIssues: true, mainBottleneck: "cpu", severity: "medium" };
    }

    if (metrics.drawCalls > this.config.gpuDrawCallThreshold) {
      return { hasIssues: true, mainBottleneck: "gpu", severity: "low" };
    }

    return { hasIssues: false, mainBottleneck: null, severity: "info" };
  }

  /**
   * Reset history and internal state
   */
  reset(): void {
    this.bottleneckHistory.clear();
  }

  // ============================================================
  // Private Detection Methods
  // ============================================================

  private detectCPUBottleneck(
    avg: PerformanceMetrics,
    _samples: PerformanceMetrics[],
    bottlenecks: Bottleneck[]
  ): void {
    const cpuTime =
      avg.physicsTime + avg.layoutTime + avg.dataUpdateTime;

    if (cpuTime > this.config.cpuBottleneckThreshold) {
      const impact = (cpuTime / avg.frameTime) * 100;
      const severity = this.getSeverityFromImpact(impact);

      bottlenecks.push({
        id: "cpu-overload",
        name: "CPU Overload",
        category: "cpu",
        severity,
        sections: ["physics", "layout", "dataUpdate"],
        description: `CPU-bound operations are consuming ${cpuTime.toFixed(1)}ms per frame, exceeding the ${this.config.cpuBottleneckThreshold}ms threshold.`,
        metrics: {
          cpuTime,
          physicsTime: avg.physicsTime,
          layoutTime: avg.layoutTime,
          dataUpdateTime: avg.dataUpdateTime,
        },
        recommendations: [
          "Consider reducing physics simulation frequency",
          "Enable incremental layout updates",
          "Use spatial indexing (quadtree) for optimizations",
          "Consider web workers for physics calculations",
        ],
        impact,
        confidence: 0.9,
        firstDetected: this.getFirstDetected("cpu-overload"),
        persistent: this.isPersistent("cpu-overload"),
      });
    }
  }

  private detectGPUBottleneck(
    avg: PerformanceMetrics,
    _samples: PerformanceMetrics[],
    bottlenecks: Bottleneck[]
  ): void {
    if (avg.drawCalls > this.config.gpuDrawCallThreshold) {
      const efficiency = avg.triangleCount / Math.max(1, avg.drawCalls);
      const severity = efficiency < 100 ? "high" : efficiency < 500 ? "medium" : "low";

      bottlenecks.push({
        id: "gpu-draw-calls",
        name: "Excessive Draw Calls",
        category: "gpu",
        severity,
        sections: ["render"],
        description: `${avg.drawCalls} draw calls per frame. Each draw call has GPU overhead. Consider batching similar elements.`,
        metrics: {
          drawCalls: avg.drawCalls,
          triangleCount: avg.triangleCount,
          efficiency,
        },
        recommendations: [
          "Enable instanced rendering for nodes",
          "Batch edges by style into single draw calls",
          "Use sprite atlases for icons",
          "Consider LOD system to reduce element count",
        ],
        impact: Math.min(30, (avg.drawCalls / this.config.gpuDrawCallThreshold) * 15),
        confidence: 0.85,
        firstDetected: this.getFirstDetected("gpu-draw-calls"),
        persistent: this.isPersistent("gpu-draw-calls"),
      });
    }
  }

  private detectPhysicsBottleneck(
    avg: PerformanceMetrics,
    samples: PerformanceMetrics[],
    bottlenecks: Bottleneck[]
  ): void {
    if (avg.physicsTime > this.config.physicsThresholdMs) {
      const impact = (avg.physicsTime / avg.frameTime) * 100;
      const variance = this.calculateVariance(samples, (s) => s.physicsTime);
      const severity = impact > 50 ? "critical" : impact > 30 ? "high" : "medium";

      bottlenecks.push({
        id: "physics-overhead",
        name: "Physics Simulation Overhead",
        category: "physics",
        severity,
        sections: ["physics"],
        description: `Physics simulation taking ${avg.physicsTime.toFixed(1)}ms per frame (${impact.toFixed(0)}% of frame time). Variance: ${variance.toFixed(1)}ms.`,
        metrics: {
          physicsTime: avg.physicsTime,
          variance,
          impact,
        },
        recommendations: [
          "Enable Barnes-Hut algorithm for O(n log n) force calculation",
          "Increase simulation theta for less accuracy but better performance",
          "Reduce simulation iterations per frame",
          "Consider WebGPU physics for GPU acceleration",
          "Freeze physics when graph is stable",
        ],
        impact,
        confidence: 0.95,
        firstDetected: this.getFirstDetected("physics-overhead"),
        persistent: this.isPersistent("physics-overhead"),
      });
    }
  }

  private detectLayoutBottleneck(
    avg: PerformanceMetrics,
    _samples: PerformanceMetrics[],
    bottlenecks: Bottleneck[]
  ): void {
    if (avg.layoutTime > this.config.layoutThresholdMs) {
      const impact = (avg.layoutTime / avg.frameTime) * 100;
      const severity = impact > 40 ? "high" : "medium";

      bottlenecks.push({
        id: "layout-overhead",
        name: "Layout Calculation Overhead",
        category: "layout",
        severity,
        sections: ["layout"],
        description: `Layout algorithms taking ${avg.layoutTime.toFixed(1)}ms per frame.`,
        metrics: {
          layoutTime: avg.layoutTime,
          impact,
        },
        recommendations: [
          "Enable incremental layout mode",
          "Cache layout results between frames",
          "Use hierarchical layout for tree structures",
          "Consider pre-computing initial layout",
        ],
        impact,
        confidence: 0.9,
        firstDetected: this.getFirstDetected("layout-overhead"),
        persistent: this.isPersistent("layout-overhead"),
      });
    }
  }

  private detectRenderingBottleneck(
    avg: PerformanceMetrics,
    _samples: PerformanceMetrics[],
    bottlenecks: Bottleneck[]
  ): void {
    if (avg.visibleNodes > this.config.visibleNodesThreshold) {
      const severity = avg.visibleNodes > 100000 ? "critical" : "high";

      bottlenecks.push({
        id: "too-many-visible",
        name: "Too Many Visible Elements",
        category: "rendering",
        severity,
        sections: ["render", "nodeRender", "edgeRender"],
        description: `${avg.visibleNodes.toLocaleString()} nodes and ${avg.visibleEdges.toLocaleString()} edges visible. Consider aggregation or LOD.`,
        metrics: {
          visibleNodes: avg.visibleNodes,
          visibleEdges: avg.visibleEdges,
          totalElements: avg.visibleNodes + avg.visibleEdges,
        },
        recommendations: [
          "Enable Level of Detail (LOD) system",
          "Implement node aggregation for clusters",
          "Enable viewport culling",
          "Use simplified rendering at low zoom",
          "Consider semantic zoom for detail reduction",
        ],
        impact: Math.min(50, (avg.visibleNodes / this.config.visibleNodesThreshold) * 25),
        confidence: 0.85,
        firstDetected: this.getFirstDetected("too-many-visible"),
        persistent: this.isPersistent("too-many-visible"),
      });
    }
  }

  private detectMemoryBottleneck(
    avg: PerformanceMetrics,
    samples: PerformanceMetrics[],
    bottlenecks: Bottleneck[]
  ): void {
    const memoryMB = avg.memoryUsage / (1024 * 1024);
    if (memoryMB > this.config.memoryThresholdMB) {
      // Check for memory growth trend
      const memoryTrend = this.checkMemoryTrend(samples);
      const severity = memoryTrend === "degrading" ? "high" : "medium";

      bottlenecks.push({
        id: "high-memory",
        name: "High Memory Usage",
        category: "memory",
        severity,
        sections: ["dataUpdate"],
        description: `Memory usage at ${memoryMB.toFixed(0)}MB (${memoryTrend} trend).`,
        metrics: {
          memoryMB,
          memoryBytes: avg.memoryUsage,
        },
        recommendations: [
          "Enable object pooling for graph elements",
          "Dispose unused textures and sprites",
          "Use compact data structures",
          "Implement streaming data loading",
          "Clear caches periodically",
        ],
        impact: 15,
        confidence: memoryTrend === "degrading" ? 0.9 : 0.7,
        firstDetected: this.getFirstDetected("high-memory"),
        persistent: this.isPersistent("high-memory"),
      });
    }
  }

  private detectFrameDrops(
    samples: PerformanceMetrics[],
    bottlenecks: Bottleneck[]
  ): void {
    const slowFrames = samples.filter((s) => s.frameTime > 33).length;
    const slowPercentage = (slowFrames / samples.length) * 100;

    if (slowPercentage > 5) {
      const severity =
        slowPercentage > 30 ? "critical" : slowPercentage > 15 ? "high" : "medium";

      bottlenecks.push({
        id: "frame-drops",
        name: "Frequent Frame Drops",
        category: "general",
        severity,
        sections: ["render", "physics", "layout"],
        description: `${slowPercentage.toFixed(0)}% of frames exceed 30 FPS target (${slowFrames}/${samples.length} frames).`,
        metrics: {
          slowFrames,
          slowPercentage,
          totalFrames: samples.length,
        },
        recommendations: [
          "Profile individual slow frames to identify spikes",
          "Enable frame rate limiting",
          "Defer non-critical updates",
          "Use requestIdleCallback for background tasks",
        ],
        impact: slowPercentage * 0.8,
        confidence: 0.95,
        firstDetected: this.getFirstDetected("frame-drops"),
        persistent: this.isPersistent("frame-drops"),
      });
    }
  }

  // ============================================================
  // Analysis Helpers
  // ============================================================

  private analyzeTrends(samples: PerformanceMetrics[]): TrendAnalysis[] {
    if (samples.length < this.config.trendWindowSize) {
      return [];
    }

    const windowSize = this.config.trendWindowSize;
    const startSamples = samples.slice(0, Math.floor(windowSize / 2));
    const endSamples = samples.slice(-Math.floor(windowSize / 2));

    const metrics: Array<{
      name: string;
      getter: (s: PerformanceMetrics) => number;
    }> = [
      { name: "frameTime", getter: (s) => s.frameTime },
      { name: "renderTime", getter: (s) => s.renderTime },
      { name: "physicsTime", getter: (s) => s.physicsTime },
      { name: "visibleNodes", getter: (s) => s.visibleNodes },
      { name: "memoryUsage", getter: (s) => s.memoryUsage },
    ];

    return metrics.map(({ name, getter }) => {
      const startValue = this.calculateAvgValue(startSamples, getter);
      const currentValue = this.calculateAvgValue(endSamples, getter);

      const percentChange =
        startValue > 0 ? ((currentValue - startValue) / startValue) * 100 : 0;

      let direction: TrendDirection = "stable";
      if (Math.abs(percentChange) > this.config.significantChangeThreshold) {
        direction = percentChange > 0 ? "degrading" : "improving";
      }

      return {
        metric: name,
        currentValue,
        startValue,
        direction,
        percentChange,
        significant: Math.abs(percentChange) > this.config.significantChangeThreshold,
      };
    });
  }

  private calculateResourceUtilization(
    avg: PerformanceMetrics
  ): ResourceUtilization {
    // Estimate CPU utilization based on processing time vs frame time
    const cpuTime = avg.physicsTime + avg.layoutTime + avg.dataUpdateTime;
    const cpuEstimate = Math.min(100, (cpuTime / 16.67) * 100);

    // Estimate GPU utilization based on draw calls and triangles
    const gpuWorkFactor =
      (avg.drawCalls / 100) * 0.3 + (avg.triangleCount / 100000) * 0.7;
    const gpuEstimate = Math.min(100, gpuWorkFactor * 50);

    const memoryMB = avg.memoryUsage / (1024 * 1024);

    const drawCallEfficiency =
      avg.drawCalls > 0 ? avg.triangleCount / avg.drawCalls : 0;

    // Note: visibilityRatio would need total counts, using 1 as placeholder
    const visibilityRatio = 1;

    return {
      cpuEstimate,
      gpuEstimate,
      memoryMB,
      drawCallEfficiency,
      visibilityRatio,
    };
  }

  private calculateHealthScore(
    bottlenecks: Bottleneck[],
    avg: PerformanceMetrics
  ): number {
    let score = 100;

    // Deduct points for each bottleneck
    for (const b of bottlenecks) {
      const severityPenalty = {
        info: 1,
        low: 3,
        medium: 8,
        high: 15,
        critical: 25,
      };
      score -= severityPenalty[b.severity] * (b.confidence);
    }

    // Bonus/penalty based on frame rate
    if (avg.fps >= 60) {
      score = Math.min(100, score + 5);
    } else if (avg.fps < 30) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private extractTopRecommendations(bottlenecks: Bottleneck[]): string[] {
    const recommendations = new Set<string>();

    for (const b of bottlenecks.slice(0, 3)) {
      for (const rec of b.recommendations.slice(0, 2)) {
        recommendations.add(rec);
      }
    }

    return Array.from(recommendations).slice(0, 5);
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  private calculateAverage(samples: PerformanceMetrics[]): PerformanceMetrics {
    if (samples.length === 0) {
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

    const count = samples.length;
    const sum = samples.reduce((acc, s) => ({
      frameTime: acc.frameTime + s.frameTime,
      fps: acc.fps + s.fps,
      renderTime: acc.renderTime + s.renderTime,
      physicsTime: acc.physicsTime + s.physicsTime,
      layoutTime: acc.layoutTime + s.layoutTime,
      dataUpdateTime: acc.dataUpdateTime + s.dataUpdateTime,
      drawCalls: acc.drawCalls + s.drawCalls,
      triangleCount: acc.triangleCount + s.triangleCount,
      visibleNodes: acc.visibleNodes + s.visibleNodes,
      visibleEdges: acc.visibleEdges + s.visibleEdges,
      memoryUsage: acc.memoryUsage + s.memoryUsage,
      timestamp: s.timestamp,
    }));

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

  private calculateVariance(
    samples: PerformanceMetrics[],
    getter: (s: PerformanceMetrics) => number
  ): number {
    if (samples.length < 2) return 0;

    const values = samples.map(getter);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));

    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  private calculateAvgValue(
    samples: PerformanceMetrics[],
    getter: (s: PerformanceMetrics) => number
  ): number {
    if (samples.length === 0) return 0;
    return samples.reduce((sum, s) => sum + getter(s), 0) / samples.length;
  }

  private checkMemoryTrend(samples: PerformanceMetrics[]): TrendDirection {
    if (samples.length < 10) return "stable";

    const firstHalf = samples.slice(0, Math.floor(samples.length / 2));
    const secondHalf = samples.slice(-Math.floor(samples.length / 2));

    const firstAvg = this.calculateAvgValue(firstHalf, (s) => s.memoryUsage);
    const secondAvg = this.calculateAvgValue(secondHalf, (s) => s.memoryUsage);

    const change = ((secondAvg - firstAvg) / Math.max(1, firstAvg)) * 100;

    if (change > 10) return "degrading";
    if (change < -10) return "improving";
    return "stable";
  }

  private getSeverityFromImpact(impact: number): BottleneckSeverity {
    if (impact > 60) return "critical";
    if (impact > 40) return "high";
    if (impact > 20) return "medium";
    if (impact > 10) return "low";
    return "info";
  }

  private updateBottleneckHistory(bottlenecks: Bottleneck[]): void {
    const now = Date.now();

    for (const b of bottlenecks) {
      const existing = this.bottleneckHistory.get(b.id);
      if (existing) {
        existing.count++;
      } else {
        this.bottleneckHistory.set(b.id, { firstSeen: now, count: 1 });
      }
    }
  }

  private getFirstDetected(id: string): number {
    return this.bottleneckHistory.get(id)?.firstSeen ?? Date.now();
  }

  private isPersistent(id: string): boolean {
    const history = this.bottleneckHistory.get(id);
    return history ? history.count > 5 : false;
  }

  private createEmptyAnalysis(): BottleneckAnalysis {
    return {
      bottlenecks: [],
      trends: [],
      resources: {
        cpuEstimate: 0,
        gpuEstimate: 0,
        memoryMB: 0,
        drawCallEfficiency: 0,
        visibilityRatio: 1,
      },
      healthScore: 100,
      topRecommendations: [],
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a new BottleneckDetector instance
 */
export function createBottleneckDetector(
  config?: Partial<BottleneckDetectorConfig>
): BottleneckDetector {
  return new BottleneckDetector(config);
}
