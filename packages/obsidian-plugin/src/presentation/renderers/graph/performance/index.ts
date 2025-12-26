/**
 * Performance Module
 *
 * Comprehensive performance profiling, monitoring, and optimization system
 * for graph visualization with 100K+ nodes.
 *
 * Components:
 * - PerformanceProfiler: Frame-level timing and metrics collection
 * - BottleneckDetector: Automatic bottleneck identification
 * - PerformanceMetricsDashboard: React UI for metrics visualization
 * - AutoOptimizer: Automated optimization suggestions and application
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

// Performance Profiler
export {
  PerformanceProfiler,
  createPerformanceProfiler,
  getGlobalProfiler,
  resetGlobalProfiler,
  DEFAULT_PROFILER_OPTIONS,
} from "./PerformanceProfiler";
export type {
  PerformanceMetrics,
  ProfilerOptions,
  SectionTiming,
  ProfileSection,
  PerformanceLevel,
  FrameAnalysis,
  ProfilerEventType,
  ProfilerEvent,
  ProfilerEventListener,
} from "./PerformanceProfiler";

// Bottleneck Detector
export {
  BottleneckDetector,
  createBottleneckDetector,
  DEFAULT_DETECTOR_CONFIG,
} from "./BottleneckDetector";
export type {
  BottleneckSeverity,
  BottleneckCategory,
  Bottleneck,
  TrendDirection,
  TrendAnalysis,
  ResourceUtilization,
  BottleneckAnalysis,
  BottleneckDetectorConfig,
} from "./BottleneckDetector";

// Performance Metrics Dashboard
export {
  PerformanceMetricsDashboard,
  PerformanceDashboardButton,
  DEFAULT_DASHBOARD_CONFIG,
} from "./PerformanceMetricsDashboard";
export type {
  PerformanceMetricsDashboardProps,
  DashboardConfig,
  PerformanceDashboardButtonProps,
} from "./PerformanceMetricsDashboard";

// Auto Optimizer
export {
  AutoOptimizer,
  createAutoOptimizer,
  getOptimizationPresets,
  DEFAULT_PERFORMANCE_TARGETS,
  DEFAULT_OPTIMIZER_CONFIG,
  DEFAULT_OPTIMIZATION_STATE,
} from "./AutoOptimizer";
export type {
  OptimizationAction,
  OptimizationCategory,
  OptimizationMode,
  PerformanceTarget,
  OptimizationState,
  AutoOptimizerConfig,
  OptimizerEventType,
  OptimizerEvent,
  OptimizerEventListener,
} from "./AutoOptimizer";
