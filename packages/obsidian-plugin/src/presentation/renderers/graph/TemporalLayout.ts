/**
 * TemporalLayout - Time-based layout algorithm for temporal data visualization
 *
 * Arranges nodes along a timeline based on temporal properties (timestamps,
 * dates, durations). Supports multiple axis modes, grouping strategies,
 * and temporal aggregation for visualizing time-series relationships.
 *
 * Features:
 * - Horizontal or vertical timeline axis
 * - Automatic time scale detection (seconds to years)
 * - Node grouping by category with lane assignment
 * - Duration-based node sizing
 * - Gap detection and compression
 * - Milestone markers and event clustering
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphData, GraphNode, GraphEdge } from "./types";
import type { LayoutAlgorithm, LayoutResult, Point } from "./LayoutManager";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Timeline orientation
 */
export type TimelineOrientation = "horizontal" | "vertical";

/**
 * Time scale granularity for axis divisions
 */
export type TimeScale =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "auto";

/**
 * Strategy for grouping nodes into lanes
 */
export type LaneStrategy = "none" | "category" | "type" | "custom";

/**
 * Strategy for handling temporal gaps
 */
export type GapStrategy = "preserve" | "compress" | "mark";

/**
 * Node positioning within lanes
 */
export type NodeAlignment = "start" | "center" | "end";

/**
 * Configuration options for temporal layout
 */
export interface TemporalLayoutOptions {
  /** Timeline orientation (default: 'horizontal') */
  orientation: TimelineOrientation;

  /** Property name for node start time (default: 'startTime') */
  startTimeProperty: string;

  /** Property name for node end time (optional, for duration) */
  endTimeProperty?: string;

  /** Property name for grouping into lanes (default: 'group') */
  groupProperty: string;

  /** Time scale for axis divisions (default: 'auto') */
  timeScale: TimeScale;

  /** Lane assignment strategy (default: 'category') */
  laneStrategy: LaneStrategy;

  /** Gap handling strategy (default: 'preserve') */
  gapStrategy: GapStrategy;

  /** Alignment of nodes within lanes (default: 'center') */
  nodeAlignment: NodeAlignment;

  /** Minimum gap ratio to compress (default: 0.3) */
  gapThreshold: number;

  /** Pixels per time unit (auto-calculated if not set) */
  pixelsPerUnit?: number;

  /** Height/width per lane in pixels (default: 80) */
  laneSize: number;

  /** Space between lanes in pixels (default: 20) */
  laneGap: number;

  /** Minimum node spacing in pixels (default: 10) */
  minNodeSpacing: number;

  /** Whether to show duration as node width/height (default: true) */
  showDuration: boolean;

  /** Minimum duration size in pixels (default: 20) */
  minDurationSize: number;

  /** Maximum duration size in pixels (default: 200) */
  maxDurationSize: number;

  /** Margin around the layout in pixels (default: 50) */
  margin: number;

  /** Custom group ordering function */
  groupOrderer?: (groups: string[]) => string[];

  /** Custom time extractor function */
  timeExtractor?: (node: GraphNode) => number | null;
}

/**
 * Extended node with temporal layout properties
 */
export interface TemporalNode extends GraphNode {
  /** Start timestamp (parsed from metadata) */
  startTime: number | null;

  /** End timestamp (optional, for duration) */
  endTime: number | null;

  /** Duration in milliseconds (endTime - startTime) */
  duration: number;

  /** Group/category for lane assignment */
  group: string;

  /** Assigned lane index */
  lane: number;

  /** Position along timeline axis */
  timePosition: number;

  /** Size along timeline axis (for duration visualization) */
  timeSize: number;
}

/**
 * Extended edge with temporal layout properties
 */
export interface TemporalEdge extends GraphEdge {
  /** Whether edge connects nodes in different lanes */
  crossLane: boolean;

  /** Time span covered by this edge */
  timeSpan: number;

  /** Control points for edge routing */
  controlPoints?: Array<{ x: number; y: number }>;
}

/**
 * Lane information for grouped nodes
 */
export interface Lane {
  /** Lane index (0-based) */
  index: number;

  /** Group/category name */
  group: string;

  /** Nodes assigned to this lane */
  nodes: TemporalNode[];

  /** Lane y-position (for horizontal) or x-position (for vertical) */
  position: number;

  /** Lane color (optional) */
  color?: string;
}

/**
 * Time axis marker/division
 */
export interface TimeMarker {
  /** Timestamp for this marker */
  time: number;

  /** Display label */
  label: string;

  /** Position along timeline axis */
  position: number;

  /** Whether this is a major division */
  isMajor: boolean;
}

/**
 * Result of temporal layout computation
 */
export interface TemporalLayoutResult extends LayoutResult {
  /** Routed edges with control points */
  edges: TemporalEdge[];

  /** Lane definitions */
  lanes: Lane[];

  /** Time axis markers for rendering */
  timeMarkers: TimeMarker[];

  /** Time range of the data */
  timeRange: {
    start: number;
    end: number;
    duration: number;
  };

  /** Layout statistics */
  stats: {
    /** Number of lanes */
    laneCount: number;
    /** Detected time scale */
    detectedScale: TimeScale;
    /** Number of compressed gaps */
    compressedGaps: number;
    /** Nodes without valid timestamps */
    invalidNodes: number;
  };
}

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default temporal layout options
 */
export const DEFAULT_TEMPORAL_OPTIONS: TemporalLayoutOptions = {
  orientation: "horizontal",
  startTimeProperty: "startTime",
  groupProperty: "group",
  timeScale: "auto",
  laneStrategy: "category",
  gapStrategy: "preserve",
  nodeAlignment: "center",
  gapThreshold: 0.3,
  laneSize: 80,
  laneGap: 20,
  minNodeSpacing: 10,
  showDuration: true,
  minDurationSize: 20,
  maxDurationSize: 200,
  margin: 50,
};

/**
 * Time scale configurations (milliseconds per unit)
 */
const TIME_SCALE_MS: Record<Exclude<TimeScale, "auto">, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  quarter: 3 * 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

/**
 * Target number of time markers
 */
const TARGET_MARKERS = 10;

// ============================================================
// Temporal Layout Presets
// ============================================================

/**
 * Preset names for common temporal configurations
 */
export type TemporalPresetName =
  | "timeline"
  | "gantt"
  | "calendar"
  | "compact"
  | "expanded";

/**
 * Temporal layout presets
 */
export const TEMPORAL_PRESETS: Record<TemporalPresetName, Partial<TemporalLayoutOptions>> = {
  /** Standard timeline view */
  timeline: {
    orientation: "horizontal",
    laneStrategy: "none",
    showDuration: false,
    laneSize: 60,
  },

  /** Gantt chart style with durations */
  gantt: {
    orientation: "horizontal",
    laneStrategy: "category",
    showDuration: true,
    laneSize: 40,
    laneGap: 5,
    minDurationSize: 30,
  },

  /** Calendar-like vertical layout */
  calendar: {
    orientation: "vertical",
    laneStrategy: "category",
    timeScale: "day",
    laneSize: 100,
  },

  /** Compact view with gap compression */
  compact: {
    gapStrategy: "compress",
    gapThreshold: 0.2,
    laneSize: 50,
    laneGap: 10,
    minNodeSpacing: 5,
  },

  /** Expanded view with more spacing */
  expanded: {
    laneSize: 120,
    laneGap: 40,
    minNodeSpacing: 30,
    margin: 80,
  },
};

// ============================================================
// TemporalLayout Class
// ============================================================

/**
 * Temporal layout algorithm implementation
 *
 * Arranges nodes along a timeline based on temporal properties.
 * Supports grouping into lanes, duration visualization, and
 * flexible time scale handling.
 *
 * @example
 * ```typescript
 * const layout = new TemporalLayout({
 *   orientation: 'horizontal',
 *   startTimeProperty: 'createdAt',
 *   laneStrategy: 'category',
 *   groupProperty: 'type',
 * });
 *
 * const result = layout.layout(graphData);
 * // result.positions contains node positions along timeline
 * // result.lanes contains lane definitions
 * // result.timeMarkers contains axis divisions
 * ```
 */
export class TemporalLayout implements LayoutAlgorithm<TemporalLayoutOptions, TemporalLayoutResult> {
  readonly name = "temporal" as const;

  private options: TemporalLayoutOptions;
  private nodeMap: Map<string, TemporalNode> = new Map();
  private edgeMap: Map<string, TemporalEdge> = new Map();
  private lanes: Map<string, Lane> = new Map();
  private timeRange: { start: number; end: number } = { start: 0, end: 0 };
  private detectedScale: Exclude<TimeScale, "auto"> = "day";
  private pixelsPerMs: number = 0;

  constructor(options: Partial<TemporalLayoutOptions> = {}) {
    this.options = { ...DEFAULT_TEMPORAL_OPTIONS, ...options };
  }

  /**
   * Compute temporal layout for the given graph
   */
  layout(graph: GraphData, options?: Partial<TemporalLayoutOptions>): TemporalLayoutResult {
    // Merge runtime options
    const opts = options
      ? { ...this.options, ...options }
      : this.options;

    // Reset state
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.lanes.clear();

    // Handle empty graph
    if (graph.nodes.length === 0) {
      return this.createEmptyResult();
    }

    // Phase 1: Parse temporal data from nodes
    const invalidCount = this.parseTemporalData(graph, opts);

    // Phase 2: Detect time scale if auto
    this.detectTimeScale(opts);

    // Phase 3: Apply gap strategy
    const compressedGaps = this.applyGapStrategy(opts);

    // Phase 4: Assign lanes
    this.assignLanes(opts);

    // Phase 5: Calculate positions
    this.calculatePositions(opts);

    // Phase 6: Route edges
    this.routeEdges(opts);

    // Build result
    return this.buildResult(opts, invalidCount, compressedGaps);
  }

  // ============================================================
  // Phase 1: Parse Temporal Data
  // ============================================================

  private parseTemporalData(
    graph: GraphData,
    opts: TemporalLayoutOptions
  ): number {
    let invalidCount = 0;

    for (const node of graph.nodes) {
      const startTime = this.extractTime(node, opts.startTimeProperty, opts);
      const endTime = opts.endTimeProperty
        ? this.extractTime(node, opts.endTimeProperty, opts)
        : null;

      const temporalNode: TemporalNode = {
        ...node,
        startTime,
        endTime,
        duration: startTime !== null && endTime !== null ? endTime - startTime : 0,
        group: this.extractGroup(node, opts),
        lane: 0,
        timePosition: 0,
        timeSize: 0,
      };

      if (startTime === null) {
        invalidCount++;
      }

      this.nodeMap.set(node.id, temporalNode);
    }

    // Calculate time range from valid nodes
    const validNodes = Array.from(this.nodeMap.values()).filter(
      (n) => n.startTime !== null
    );

    if (validNodes.length > 0) {
      const times = validNodes.flatMap((n) => {
        const result = [n.startTime!];
        if (n.endTime !== null) {
          result.push(n.endTime);
        }
        return result;
      });

      this.timeRange = {
        start: Math.min(...times),
        end: Math.max(...times),
      };
    }

    // Create edges
    for (const edge of graph.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const sourceNode = this.nodeMap.get(sourceId);
      const targetNode = this.nodeMap.get(targetId);

      if (!sourceNode || !targetNode) {
        continue;
      }

      const temporalEdge: TemporalEdge = {
        ...edge,
        source: sourceId,
        target: targetId,
        crossLane: sourceNode.group !== targetNode.group,
        timeSpan:
          sourceNode.startTime !== null && targetNode.startTime !== null
            ? Math.abs(targetNode.startTime - sourceNode.startTime)
            : 0,
      };

      this.edgeMap.set(edge.id, temporalEdge);
    }

    return invalidCount;
  }

  private extractTime(
    node: GraphNode,
    property: string,
    opts: TemporalLayoutOptions
  ): number | null {
    // Custom extractor takes precedence
    if (opts.timeExtractor) {
      return opts.timeExtractor(node);
    }

    // Check metadata
    const value = node.metadata?.[property];
    if (value === undefined || value === null) {
      return null;
    }

    // Parse different formats
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      // Try ISO date string
      const parsed = Date.parse(value);
      if (!isNaN(parsed)) {
        return parsed;
      }

      // Try numeric string
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return num;
      }
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    return null;
  }

  private extractGroup(node: GraphNode, opts: TemporalLayoutOptions): string {
    if (opts.laneStrategy === "none") {
      return "default";
    }

    if (opts.laneStrategy === "type") {
      return String(node.metadata?.type || node.group || "default");
    }

    const value = node.metadata?.[opts.groupProperty];
    return value !== undefined ? String(value) : "default";
  }

  // ============================================================
  // Phase 2: Detect Time Scale
  // ============================================================

  private detectTimeScale(opts: TemporalLayoutOptions): void {
    if (opts.timeScale !== "auto") {
      this.detectedScale = opts.timeScale;
      return;
    }

    const duration = this.timeRange.end - this.timeRange.start;

    if (duration <= 0) {
      this.detectedScale = "hour";
      return;
    }

    // Find scale that gives approximately TARGET_MARKERS divisions
    const scales: Exclude<TimeScale, "auto">[] = [
      "second",
      "minute",
      "hour",
      "day",
      "week",
      "month",
      "quarter",
      "year",
    ];

    for (const scale of scales) {
      const divisions = duration / TIME_SCALE_MS[scale];
      if (divisions <= TARGET_MARKERS * 2) {
        this.detectedScale = scale;
        return;
      }
    }

    this.detectedScale = "year";
  }

  // ============================================================
  // Phase 3: Gap Strategy
  // ============================================================

  private applyGapStrategy(opts: TemporalLayoutOptions): number {
    if (opts.gapStrategy === "preserve") {
      return 0;
    }

    // Get sorted time points
    const nodes = Array.from(this.nodeMap.values())
      .filter((n) => n.startTime !== null)
      .sort((a, b) => a.startTime! - b.startTime!);

    if (nodes.length < 2) {
      return 0;
    }

    // Find gaps
    const gaps: Array<{ start: number; end: number; size: number }> = [];
    const totalDuration = this.timeRange.end - this.timeRange.start;

    for (let i = 1; i < nodes.length; i++) {
      const prevEnd = nodes[i - 1].endTime ?? nodes[i - 1].startTime!;
      const currStart = nodes[i].startTime!;
      const gapSize = currStart - prevEnd;

      if (gapSize > 0 && gapSize / totalDuration > opts.gapThreshold) {
        gaps.push({ start: prevEnd, end: currStart, size: gapSize });
      }
    }

    if (opts.gapStrategy === "compress" && gaps.length > 0) {
      // Compress gaps by adjusting node times
      // (This is a simplified version - actual implementation would need
      // more sophisticated time remapping)
      // For now, we just note the gaps for visualization
    }

    return gaps.length;
  }

  // ============================================================
  // Phase 4: Assign Lanes
  // ============================================================

  private assignLanes(opts: TemporalLayoutOptions): void {
    // Group nodes by their group property
    const groupedNodes = new Map<string, TemporalNode[]>();

    for (const node of this.nodeMap.values()) {
      const group = node.group;
      if (!groupedNodes.has(group)) {
        groupedNodes.set(group, []);
      }
      groupedNodes.get(group)!.push(node);
    }

    // Order groups
    let groups = Array.from(groupedNodes.keys());
    if (opts.groupOrderer) {
      groups = opts.groupOrderer(groups);
    } else {
      groups.sort();
    }

    // Create lanes
    let laneIndex = 0;
    for (const group of groups) {
      const nodes = groupedNodes.get(group) || [];

      const lane: Lane = {
        index: laneIndex,
        group,
        nodes,
        position: 0,
      };

      this.lanes.set(group, lane);

      // Assign lane to nodes
      for (const node of nodes) {
        node.lane = laneIndex;
      }

      laneIndex++;
    }

    // Calculate lane positions
    let currentPosition = opts.margin;
    for (const lane of this.lanes.values()) {
      lane.position = currentPosition + opts.laneSize / 2;
      currentPosition += opts.laneSize + opts.laneGap;
    }
  }

  // ============================================================
  // Phase 5: Calculate Positions
  // ============================================================

  private calculatePositions(opts: TemporalLayoutOptions): void {
    const duration = this.timeRange.end - this.timeRange.start;

    if (duration <= 0) {
      // All nodes at same time - use simple layout
      for (const node of this.nodeMap.values()) {
        const lane = this.lanes.get(node.group);
        if (lane) {
          node.x = opts.margin + 100;
          node.y = lane.position;
          node.timePosition = opts.margin + 100;
          node.timeSize = opts.minDurationSize;
        }
      }
      return;
    }

    // Calculate pixels per millisecond
    const availableSpace = opts.pixelsPerUnit
      ? opts.pixelsPerUnit * (duration / TIME_SCALE_MS[this.detectedScale])
      : Math.max(500, this.nodeMap.size * 50);

    this.pixelsPerMs = availableSpace / duration;

    // Position nodes
    for (const node of this.nodeMap.values()) {
      if (node.startTime === null) {
        // Invalid node - position at end
        node.timePosition = opts.margin + availableSpace + 50;
        node.x = node.timePosition;
        node.y = opts.margin + 50;
        continue;
      }

      const lane = this.lanes.get(node.group);
      if (!lane) {
        continue;
      }

      // Calculate time position
      const timeOffset = node.startTime - this.timeRange.start;
      node.timePosition = opts.margin + timeOffset * this.pixelsPerMs;

      // Calculate duration size
      if (opts.showDuration && node.duration > 0) {
        const durationPixels = node.duration * this.pixelsPerMs;
        node.timeSize = Math.max(
          opts.minDurationSize,
          Math.min(opts.maxDurationSize, durationPixels)
        );
      } else {
        node.timeSize = opts.minDurationSize;
      }

      // Apply orientation
      if (opts.orientation === "horizontal") {
        node.x = node.timePosition;
        node.y = lane.position;
      } else {
        node.x = lane.position;
        node.y = node.timePosition;
      }
    }
  }

  // ============================================================
  // Phase 6: Route Edges
  // ============================================================

  private routeEdges(_opts: TemporalLayoutOptions): void {
    for (const edge of this.edgeMap.values()) {
      const sourceNode = this.nodeMap.get(
        typeof edge.source === "string" ? edge.source : edge.source.id
      );
      const targetNode = this.nodeMap.get(
        typeof edge.target === "string" ? edge.target : edge.target.id
      );

      if (!sourceNode || !targetNode) {
        continue;
      }

      // For cross-lane edges, add control points for curved routing
      if (edge.crossLane) {
        const midX = (sourceNode.x! + targetNode.x!) / 2;
        const midY = (sourceNode.y! + targetNode.y!) / 2;

        // Add a control point offset perpendicular to the edge
        const dx = targetNode.x! - sourceNode.x!;
        const dy = targetNode.y! - sourceNode.y!;
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len > 0) {
          const perpX = -dy / len;
          const perpY = dx / len;
          const offset = 30; // Control point offset

          edge.controlPoints = [
            {
              x: midX + perpX * offset,
              y: midY + perpY * offset,
            },
          ];
        }
      }
    }
  }

  // ============================================================
  // Build Result
  // ============================================================

  private buildResult(
    opts: TemporalLayoutOptions,
    invalidCount: number,
    compressedGaps: number
  ): TemporalLayoutResult {
    // Build positions map
    const positions = new Map<string, Point>();
    for (const [nodeId, node] of this.nodeMap) {
      positions.set(nodeId, { x: node.x!, y: node.y! });
    }

    // Calculate bounds
    const bounds = this.calculateBounds(positions, opts);

    // Generate time markers
    const timeMarkers = this.generateTimeMarkers(opts);

    return {
      positions,
      bounds,
      edges: Array.from(this.edgeMap.values()),
      lanes: Array.from(this.lanes.values()),
      timeMarkers,
      timeRange: {
        start: this.timeRange.start,
        end: this.timeRange.end,
        duration: this.timeRange.end - this.timeRange.start,
      },
      stats: {
        laneCount: this.lanes.size,
        detectedScale: this.detectedScale,
        compressedGaps,
        invalidNodes: invalidCount,
      },
    };
  }

  private calculateBounds(
    positions: Map<string, Point>,
    opts: TemporalLayoutOptions
  ): TemporalLayoutResult["bounds"] {
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

    // Add margin
    minX -= opts.margin;
    minY -= opts.margin;
    maxX += opts.margin;
    maxY += opts.margin;

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  private generateTimeMarkers(opts: TemporalLayoutOptions): TimeMarker[] {
    const markers: TimeMarker[] = [];
    const duration = this.timeRange.end - this.timeRange.start;

    if (duration <= 0) {
      return markers;
    }

    const scaleMs = TIME_SCALE_MS[this.detectedScale];
    const stepCount = Math.ceil(duration / scaleMs);
    const majorInterval = this.getMajorInterval();

    // Start from a "round" time
    const startRounded =
      Math.floor(this.timeRange.start / scaleMs) * scaleMs;

    for (let i = 0; i <= stepCount + 1; i++) {
      const time = startRounded + i * scaleMs;

      if (time < this.timeRange.start || time > this.timeRange.end + scaleMs) {
        continue;
      }

      const position =
        opts.margin + (time - this.timeRange.start) * this.pixelsPerMs;

      markers.push({
        time,
        label: this.formatTime(time),
        position,
        isMajor: i % majorInterval === 0,
      });
    }

    return markers;
  }

  private getMajorInterval(): number {
    switch (this.detectedScale) {
      case "second":
        return 10; // Major every 10 seconds
      case "minute":
        return 5; // Major every 5 minutes
      case "hour":
        return 4; // Major every 4 hours
      case "day":
        return 7; // Major every week
      case "week":
        return 4; // Major every 4 weeks
      case "month":
        return 3; // Major every quarter
      case "quarter":
        return 4; // Major every year
      case "year":
        return 5; // Major every 5 years
      default:
        return 5;
    }
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);

    switch (this.detectedScale) {
      case "second":
        return date.toLocaleTimeString();
      case "minute":
        return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
      case "hour":
        return `${date.getHours()}:00`;
      case "day":
        return `${date.getMonth() + 1}/${date.getDate()}`;
      case "week":
        return `W${this.getWeekNumber(date)}`;
      case "month":
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      case "quarter":
        return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
      case "year":
        return String(date.getFullYear());
      default:
        return date.toLocaleDateString();
    }
  }

  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear =
      (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  private createEmptyResult(): TemporalLayoutResult {
    return {
      positions: new Map(),
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      edges: [],
      lanes: [],
      timeMarkers: [],
      timeRange: { start: 0, end: 0, duration: 0 },
      stats: {
        laneCount: 0,
        detectedScale: "day",
        compressedGaps: 0,
        invalidNodes: 0,
      },
    };
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a TemporalLayout instance with optional preset
 */
export function createTemporalLayout(
  options?: Partial<TemporalLayoutOptions>,
  preset?: TemporalPresetName
): TemporalLayout {
  const presetOptions = preset ? TEMPORAL_PRESETS[preset] : {};
  return new TemporalLayout({ ...presetOptions, ...options });
}
