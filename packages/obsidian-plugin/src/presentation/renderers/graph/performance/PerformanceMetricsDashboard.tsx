/**
 * PerformanceMetricsDashboard Component
 *
 * Provides a visual dashboard for monitoring graph rendering performance
 * with real-time metrics, historical trends, and bottleneck indicators.
 *
 * Features:
 * - Real-time FPS and frame time display
 * - Section timing breakdown (render, physics, layout)
 * - Memory usage visualization
 * - Bottleneck indicators with recommendations
 * - Historical trend charts (mini-graphs)
 * - Health score indicator
 * - Collapsible panel design
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

import React, { useState, useCallback, useMemo } from "react";
import type { PerformanceMetrics, FrameAnalysis, PerformanceLevel } from "./PerformanceProfiler";
import type { BottleneckAnalysis, Bottleneck, BottleneckSeverity } from "./BottleneckDetector";

/**
 * Props for PerformanceMetricsDashboard
 */
export interface PerformanceMetricsDashboardProps {
  /** Current performance metrics */
  metrics: PerformanceMetrics | null;
  /** Frame analysis results */
  analysis: FrameAnalysis | null;
  /** Bottleneck analysis results */
  bottleneckAnalysis: BottleneckAnalysis | null;
  /** Historical metric samples for trend visualization */
  historicalSamples?: PerformanceMetrics[];
  /** Whether the dashboard is collapsed */
  isCollapsed?: boolean;
  /** Callback when collapse state changes */
  onToggleCollapse?: () => void;
  /** Whether to show detailed view */
  showDetails?: boolean;
  /** Callback to toggle details view */
  onToggleDetails?: () => void;
  /** Custom CSS class */
  className?: string;
  /** Dashboard configuration */
  config?: DashboardConfig;
}

/**
 * Dashboard configuration options
 */
export interface DashboardConfig {
  /** Whether to show FPS gauge (default: true) */
  showFpsGauge: boolean;
  /** Whether to show timing breakdown (default: true) */
  showTimingBreakdown: boolean;
  /** Whether to show memory usage (default: true) */
  showMemory: boolean;
  /** Whether to show bottleneck alerts (default: true) */
  showBottlenecks: boolean;
  /** Whether to show mini trend charts (default: true) */
  showTrends: boolean;
  /** Whether to show health score (default: true) */
  showHealthScore: boolean;
  /** Number of samples for trend chart (default: 60) */
  trendSampleCount: number;
  /** Update frequency in ms (default: 100) */
  updateFrequency: number;
}

/**
 * Default dashboard configuration
 */
export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  showFpsGauge: true,
  showTimingBreakdown: true,
  showMemory: true,
  showBottlenecks: true,
  showTrends: true,
  showHealthScore: true,
  trendSampleCount: 60,
  updateFrequency: 100,
};

/**
 * Get color for performance level
 */
function getPerformanceLevelColor(level: PerformanceLevel): string {
  switch (level) {
    case "excellent":
      return "var(--color-green, #22c55e)";
    case "good":
      return "var(--color-blue, #3b82f6)";
    case "warning":
      return "var(--color-yellow, #eab308)";
    case "critical":
      return "var(--color-red, #ef4444)";
    default:
      return "var(--text-muted, #888)";
  }
}

/**
 * Get color for bottleneck severity
 */
function getSeverityColor(severity: BottleneckSeverity): string {
  switch (severity) {
    case "critical":
      return "var(--color-red, #ef4444)";
    case "high":
      return "var(--color-orange, #f97316)";
    case "medium":
      return "var(--color-yellow, #eab308)";
    case "low":
      return "var(--color-blue, #3b82f6)";
    case "info":
      return "var(--text-muted, #888)";
    default:
      return "var(--text-muted, #888)";
  }
}

/**
 * Get severity icon
 */
function getSeverityIcon(severity: BottleneckSeverity): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🔵";
    case "info":
      return "ℹ️";
    default:
      return "⚪";
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format milliseconds with appropriate precision
 */
function formatMs(ms: number): string {
  if (ms < 0.1) return "<0.1ms";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

/**
 * Mini trend chart component (sparkline-style)
 */
interface MiniChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  threshold?: number;
}

function MiniChart({
  data,
  width = 80,
  height = 20,
  color = "var(--color-blue, #3b82f6)",
  threshold,
}: MiniChartProps): React.ReactElement | null {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      {/* Background */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="var(--background-secondary, #1a1a1a)"
        rx={2}
      />
      {/* Threshold line */}
      {threshold !== undefined && threshold >= min && threshold <= max && (
        <line
          x1={0}
          y1={height - ((threshold - min) / range) * height}
          x2={width}
          y2={height - ((threshold - min) / range) * height}
          stroke="var(--color-red, #ef4444)"
          strokeWidth={1}
          strokeDasharray="2,2"
          opacity={0.5}
        />
      )}
      {/* Data line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
    </svg>
  );
}

/**
 * FPS Gauge component
 */
interface FpsGaugeProps {
  fps: number;
  level: PerformanceLevel;
}

function FpsGauge({ fps, level }: FpsGaugeProps): React.ReactElement {
  const color = getPerformanceLevelColor(level);
  const percentage = Math.min(100, (fps / 60) * 100);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "40px",
          height: "40px",
        }}
      >
        {/* Background circle */}
        <svg width="40" height="40" style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="var(--background-secondary, #2a2a2a)"
            strokeWidth="4"
          />
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={`${(percentage / 100) * 100.53} 100.53`}
          />
        </svg>
        {/* FPS text */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "10px",
            fontWeight: "bold",
            color,
          }}
        >
          {Math.round(fps)}
        </div>
      </div>
      <div style={{ fontSize: "12px", color: "var(--text-muted, #888)" }}>
        FPS
      </div>
    </div>
  );
}

/**
 * Timing breakdown bar component
 */
interface TimingBarProps {
  label: string;
  value: number;
  total: number;
  color: string;
}

function TimingBar({ label, value, total, color }: TimingBarProps): React.ReactElement {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div style={{ marginBottom: "4px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "11px",
          marginBottom: "2px",
        }}
      >
        <span style={{ color: "var(--text-muted, #888)" }}>{label}</span>
        <span style={{ color }}>{formatMs(value)}</span>
      </div>
      <div
        style={{
          height: "4px",
          backgroundColor: "var(--background-secondary, #2a2a2a)",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, percentage)}%`,
            height: "100%",
            backgroundColor: color,
            transition: "width 0.1s ease",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Health score badge component
 */
interface HealthScoreBadgeProps {
  score: number;
}

function HealthScoreBadge({ score }: HealthScoreBadgeProps): React.ReactElement {
  let color: string;
  let label: string;

  if (score >= 90) {
    color = "var(--color-green, #22c55e)";
    label = "Excellent";
  } else if (score >= 70) {
    color = "var(--color-blue, #3b82f6)";
    label = "Good";
  } else if (score >= 50) {
    color = "var(--color-yellow, #eab308)";
    label = "Fair";
  } else if (score >= 30) {
    color = "var(--color-orange, #f97316)";
    label = "Poor";
  } else {
    color = "var(--color-red, #ef4444)";
    label = "Critical";
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px",
        backgroundColor: "var(--background-secondary, #2a2a2a)",
        borderRadius: "8px",
        border: `2px solid ${color}`,
      }}
    >
      <div
        style={{
          fontSize: "24px",
          fontWeight: "bold",
          color,
        }}
      >
        {score}
      </div>
      <div
        style={{
          fontSize: "10px",
          color: "var(--text-muted, #888)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Bottleneck alert component
 */
interface BottleneckAlertProps {
  bottleneck: Bottleneck;
  expanded?: boolean;
  onToggle?: () => void;
}

function BottleneckAlert({
  bottleneck,
  expanded = false,
  onToggle,
}: BottleneckAlertProps): React.ReactElement {
  const color = getSeverityColor(bottleneck.severity);
  const icon = getSeverityIcon(bottleneck.severity);

  return (
    <div
      style={{
        backgroundColor: "var(--background-secondary, #2a2a2a)",
        borderRadius: "6px",
        border: `1px solid ${color}`,
        marginBottom: "4px",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        type="button"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>{icon}</span>
        <span
          style={{
            flex: 1,
            fontSize: "12px",
            color: "var(--text-normal, #fff)",
          }}
        >
          {bottleneck.name}
        </span>
        <span
          style={{
            fontSize: "10px",
            color,
            fontWeight: "bold",
          }}
        >
          {bottleneck.impact.toFixed(0)}% impact
        </span>
        <span style={{ fontSize: "10px", color: "var(--text-muted, #888)" }}>
          {expanded ? "▼" : "▶"}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            padding: "8px",
            paddingTop: "0",
            fontSize: "11px",
            color: "var(--text-muted, #888)",
          }}
        >
          <p style={{ margin: "0 0 8px 0" }}>{bottleneck.description}</p>
          {bottleneck.recommendations.length > 0 && (
            <div>
              <strong style={{ color: "var(--text-normal, #fff)" }}>
                Recommendations:
              </strong>
              <ul
                style={{
                  margin: "4px 0 0 0",
                  paddingLeft: "16px",
                }}
              >
                {bottleneck.recommendations.slice(0, 3).map((rec, index) => (
                  <li key={index}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * PerformanceMetricsDashboard - Main dashboard component
 */
export function PerformanceMetricsDashboard({
  metrics,
  analysis,
  bottleneckAnalysis,
  historicalSamples = [],
  isCollapsed = false,
  onToggleCollapse,
  showDetails = false,
  onToggleDetails,
  className,
  config = DEFAULT_DASHBOARD_CONFIG,
}: PerformanceMetricsDashboardProps): React.ReactElement {
  const [expandedBottleneck, setExpandedBottleneck] = useState<string | null>(null);

  // Extract trend data from historical samples
  const trendData = useMemo(() => {
    const samples = historicalSamples.slice(-config.trendSampleCount);
    return {
      frameTime: samples.map((s) => s.frameTime),
      fps: samples.map((s) => s.fps),
      memory: samples.map((s) => s.memoryUsage),
    };
  }, [historicalSamples, config.trendSampleCount]);

  // Toggle bottleneck expansion
  const handleToggleBottleneck = useCallback((id: string) => {
    setExpandedBottleneck((prev) => (prev === id ? null : id));
  }, []);

  // If collapsed, show minimal view
  if (isCollapsed) {
    return (
      <div
        className={className}
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          backgroundColor: "var(--background-primary, #1e1e1e)",
          borderRadius: "8px",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: "pointer",
          border: "1px solid var(--background-modifier-border, #333)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
        }}
        onClick={onToggleCollapse}
      >
        <span
          style={{
            fontSize: "14px",
            fontWeight: "bold",
            color: analysis
              ? getPerformanceLevelColor(analysis.level)
              : "var(--text-normal, #fff)",
          }}
        >
          {metrics ? `${Math.round(metrics.fps)} FPS` : "--"}
        </span>
        {bottleneckAnalysis && bottleneckAnalysis.bottlenecks.length > 0 && (
          <span style={{ fontSize: "12px" }}>
            {getSeverityIcon(bottleneckAnalysis.bottlenecks[0].severity)}
          </span>
        )}
        <span style={{ fontSize: "10px", color: "var(--text-muted, #888)" }}>
          ◀
        </span>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        position: "absolute",
        top: "8px",
        right: "8px",
        width: "280px",
        backgroundColor: "var(--background-primary, #1e1e1e)",
        borderRadius: "8px",
        border: "1px solid var(--background-modifier-border, #333)",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
        overflow: "hidden",
        fontSize: "12px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--background-modifier-border, #333)",
          backgroundColor: "var(--background-secondary, #2a2a2a)",
        }}
      >
        <span
          style={{
            fontWeight: "bold",
            color: "var(--text-normal, #fff)",
          }}
        >
          Performance
        </span>
        <div style={{ display: "flex", gap: "4px" }}>
          {onToggleDetails && (
            <button
              onClick={onToggleDetails}
              type="button"
              style={{
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "10px",
                color: "var(--text-muted, #888)",
                padding: "2px 4px",
              }}
              title={showDetails ? "Hide details" : "Show details"}
            >
              {showDetails ? "−" : "+"}
            </button>
          )}
          <button
            onClick={onToggleCollapse}
            type="button"
            style={{
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: "10px",
              color: "var(--text-muted, #888)",
              padding: "2px 4px",
            }}
            title="Collapse"
          >
            ▶
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ padding: "12px" }}>
        {!metrics ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted, #888)",
              padding: "16px",
            }}
          >
            No metrics available
          </div>
        ) : (
          <>
            {/* Top row: FPS gauge and health score */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              {config.showFpsGauge && analysis && (
                <FpsGauge fps={metrics.fps} level={analysis.level} />
              )}
              {config.showHealthScore && bottleneckAnalysis && (
                <HealthScoreBadge score={bottleneckAnalysis.healthScore} />
              )}
            </div>

            {/* Frame time with trend */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                padding: "6px 8px",
                backgroundColor: "var(--background-secondary, #2a2a2a)",
                borderRadius: "4px",
              }}
            >
              <span style={{ color: "var(--text-muted, #888)" }}>Frame Time</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {config.showTrends && trendData.frameTime.length > 1 && (
                  <MiniChart
                    data={trendData.frameTime}
                    color={
                      analysis
                        ? getPerformanceLevelColor(analysis.level)
                        : undefined
                    }
                    threshold={16.67}
                  />
                )}
                <span
                  style={{
                    fontWeight: "bold",
                    color: analysis
                      ? getPerformanceLevelColor(analysis.level)
                      : "var(--text-normal, #fff)",
                  }}
                >
                  {formatMs(metrics.frameTime)}
                </span>
              </div>
            </div>

            {/* Timing breakdown */}
            {config.showTimingBreakdown && (
              <div style={{ marginBottom: "12px" }}>
                <TimingBar
                  label="Render"
                  value={metrics.renderTime}
                  total={metrics.frameTime}
                  color="var(--color-blue, #3b82f6)"
                />
                <TimingBar
                  label="Physics"
                  value={metrics.physicsTime}
                  total={metrics.frameTime}
                  color="var(--color-purple, #a855f7)"
                />
                <TimingBar
                  label="Layout"
                  value={metrics.layoutTime}
                  total={metrics.frameTime}
                  color="var(--color-green, #22c55e)"
                />
                <TimingBar
                  label="Data"
                  value={metrics.dataUpdateTime}
                  total={metrics.frameTime}
                  color="var(--color-orange, #f97316)"
                />
              </div>
            )}

            {/* Stats row */}
            {showDetails && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  marginBottom: "12px",
                  padding: "8px",
                  backgroundColor: "var(--background-secondary, #2a2a2a)",
                  borderRadius: "4px",
                }}
              >
                <div>
                  <div style={{ color: "var(--text-muted, #888)", fontSize: "10px" }}>
                    Visible Nodes
                  </div>
                  <div style={{ fontWeight: "bold" }}>
                    {metrics.visibleNodes.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted, #888)", fontSize: "10px" }}>
                    Visible Edges
                  </div>
                  <div style={{ fontWeight: "bold" }}>
                    {metrics.visibleEdges.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted, #888)", fontSize: "10px" }}>
                    Draw Calls
                  </div>
                  <div style={{ fontWeight: "bold" }}>
                    {metrics.drawCalls.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-muted, #888)", fontSize: "10px" }}>
                    Triangles
                  </div>
                  <div style={{ fontWeight: "bold" }}>
                    {metrics.triangleCount.toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* Memory usage */}
            {config.showMemory && metrics.memoryUsage > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                  padding: "6px 8px",
                  backgroundColor: "var(--background-secondary, #2a2a2a)",
                  borderRadius: "4px",
                }}
              >
                <span style={{ color: "var(--text-muted, #888)" }}>Memory</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {config.showTrends && trendData.memory.length > 1 && (
                    <MiniChart data={trendData.memory} color="var(--color-cyan, #06b6d4)" />
                  )}
                  <span style={{ fontWeight: "bold" }}>
                    {formatBytes(metrics.memoryUsage)}
                  </span>
                </div>
              </div>
            )}

            {/* Bottleneck alerts */}
            {config.showBottlenecks &&
              bottleneckAnalysis &&
              bottleneckAnalysis.bottlenecks.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "var(--text-muted, #888)",
                      textTransform: "uppercase",
                      marginBottom: "4px",
                    }}
                  >
                    Bottlenecks ({bottleneckAnalysis.bottlenecks.length})
                  </div>
                  {bottleneckAnalysis.bottlenecks.slice(0, 3).map((bottleneck) => (
                    <BottleneckAlert
                      key={bottleneck.id}
                      bottleneck={bottleneck}
                      expanded={expandedBottleneck === bottleneck.id}
                      onToggle={() => handleToggleBottleneck(bottleneck.id)}
                    />
                  ))}
                </div>
              )}

            {/* Hit rates (detailed view) */}
            {showDetails && analysis && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "8px",
                  padding: "6px 8px",
                  backgroundColor: "var(--background-secondary, #2a2a2a)",
                  borderRadius: "4px",
                  fontSize: "10px",
                }}
              >
                <div>
                  <span style={{ color: "var(--text-muted, #888)" }}>60 FPS Hit Rate: </span>
                  <span
                    style={{
                      fontWeight: "bold",
                      color:
                        analysis.hitRate60 > 90
                          ? "var(--color-green, #22c55e)"
                          : analysis.hitRate60 > 70
                            ? "var(--color-yellow, #eab308)"
                            : "var(--color-red, #ef4444)",
                    }}
                  >
                    {analysis.hitRate60.toFixed(0)}%
                  </span>
                </div>
                <div>
                  <span style={{ color: "var(--text-muted, #888)" }}>30 FPS Hit Rate: </span>
                  <span
                    style={{
                      fontWeight: "bold",
                      color:
                        analysis.hitRate30 > 95
                          ? "var(--color-green, #22c55e)"
                          : "var(--color-red, #ef4444)",
                    }}
                  >
                    {analysis.hitRate30.toFixed(0)}%
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Performance Dashboard Button component for toggling the dashboard
 */
export interface PerformanceDashboardButtonProps {
  /** Whether the dashboard is currently visible */
  isVisible: boolean;
  /** Callback to toggle visibility */
  onToggle: () => void;
  /** Current FPS (for badge display) */
  fps?: number;
  /** Performance level */
  level?: PerformanceLevel;
  /** Custom CSS class */
  className?: string;
}

/**
 * Button to toggle performance dashboard visibility
 */
export function PerformanceDashboardButton({
  isVisible,
  onToggle,
  fps,
  level,
  className,
}: PerformanceDashboardButtonProps): React.ReactElement {
  const color = level ? getPerformanceLevelColor(level) : "var(--text-muted, #888)";

  return (
    <button
      className={className}
      onClick={onToggle}
      type="button"
      title={isVisible ? "Hide performance dashboard" : "Show performance dashboard"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "6px 10px",
        backgroundColor: isVisible
          ? "var(--interactive-accent, #7c3aed)"
          : "var(--background-secondary, #2a2a2a)",
        border: "1px solid var(--background-modifier-border, #333)",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "12px",
        color: isVisible ? "white" : "var(--text-normal, #fff)",
        transition: "background-color 0.15s ease",
      }}
    >
      <span style={{ fontSize: "14px" }}>📊</span>
      {fps !== undefined && (
        <span
          style={{
            fontWeight: "bold",
            color: isVisible ? "white" : color,
          }}
        >
          {Math.round(fps)}
        </span>
      )}
    </button>
  );
}
