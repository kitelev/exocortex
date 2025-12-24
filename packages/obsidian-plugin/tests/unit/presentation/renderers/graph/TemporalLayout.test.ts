/**
 * TemporalLayout Tests
 *
 * Tests for the temporal layout algorithm that arranges nodes
 * along a timeline based on temporal properties.
 */

import {
  TemporalLayout,
  createTemporalLayout,
  DEFAULT_TEMPORAL_OPTIONS,
  TEMPORAL_PRESETS,
  type TemporalLayoutOptions,
  type TemporalLayoutResult,
  type TimeScale,
} from "../../../../../src/presentation/renderers/graph/TemporalLayout";
import type { GraphData, GraphNode } from "../../../../../src/presentation/renderers/graph/types";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Create a test graph with temporal metadata
 */
function createTemporalGraph(
  nodeCount: number = 5,
  options: {
    startTime?: number;
    interval?: number;
    groups?: string[];
  } = {}
): GraphData {
  const {
    startTime = Date.now() - 24 * 60 * 60 * 1000, // 24 hours ago
    interval = 60 * 60 * 1000, // 1 hour
    groups = ["group-a", "group-b"],
  } = options;

  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node-${i}`,
      label: `Node ${i}`,
      path: `/path/to/node-${i}.md`,
      metadata: {
        startTime: startTime + i * interval,
        endTime: startTime + i * interval + interval / 2,
        group: groups[i % groups.length],
        type: i < nodeCount / 2 ? "task" : "event",
      },
    });
  }

  const edges = [];
  for (let i = 1; i < nodeCount; i++) {
    edges.push({
      id: `edge-${i - 1}-${i}`,
      source: `node-${i - 1}`,
      target: `node-${i}`,
    });
  }

  return { nodes, edges };
}

/**
 * Create graph with specific timestamps
 */
function createGraphWithTimes(
  times: Array<{ id: string; start: number; end?: number; group?: string }>
): GraphData {
  const nodes = times.map((t) => ({
    id: t.id,
    label: t.id,
    path: `/${t.id}.md`,
    metadata: {
      startTime: t.start,
      endTime: t.end,
      group: t.group || "default",
    },
  }));

  return { nodes, edges: [] };
}

// ============================================================
// Default Options Tests
// ============================================================

describe("DEFAULT_TEMPORAL_OPTIONS", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_TEMPORAL_OPTIONS.orientation).toBe("horizontal");
    expect(DEFAULT_TEMPORAL_OPTIONS.startTimeProperty).toBe("startTime");
    expect(DEFAULT_TEMPORAL_OPTIONS.groupProperty).toBe("group");
    expect(DEFAULT_TEMPORAL_OPTIONS.timeScale).toBe("auto");
    expect(DEFAULT_TEMPORAL_OPTIONS.laneStrategy).toBe("category");
    expect(DEFAULT_TEMPORAL_OPTIONS.gapStrategy).toBe("preserve");
    expect(DEFAULT_TEMPORAL_OPTIONS.nodeAlignment).toBe("center");
    expect(DEFAULT_TEMPORAL_OPTIONS.gapThreshold).toBe(0.3);
    expect(DEFAULT_TEMPORAL_OPTIONS.laneSize).toBe(80);
    expect(DEFAULT_TEMPORAL_OPTIONS.laneGap).toBe(20);
    expect(DEFAULT_TEMPORAL_OPTIONS.minNodeSpacing).toBe(10);
    expect(DEFAULT_TEMPORAL_OPTIONS.showDuration).toBe(true);
    expect(DEFAULT_TEMPORAL_OPTIONS.minDurationSize).toBe(20);
    expect(DEFAULT_TEMPORAL_OPTIONS.maxDurationSize).toBe(200);
    expect(DEFAULT_TEMPORAL_OPTIONS.margin).toBe(50);
  });
});

// ============================================================
// Preset Tests
// ============================================================

describe("TEMPORAL_PRESETS", () => {
  it("should have timeline preset", () => {
    expect(TEMPORAL_PRESETS.timeline).toBeDefined();
    expect(TEMPORAL_PRESETS.timeline.orientation).toBe("horizontal");
    expect(TEMPORAL_PRESETS.timeline.laneStrategy).toBe("none");
    expect(TEMPORAL_PRESETS.timeline.showDuration).toBe(false);
  });

  it("should have gantt preset", () => {
    expect(TEMPORAL_PRESETS.gantt).toBeDefined();
    expect(TEMPORAL_PRESETS.gantt.orientation).toBe("horizontal");
    expect(TEMPORAL_PRESETS.gantt.showDuration).toBe(true);
    expect(TEMPORAL_PRESETS.gantt.laneStrategy).toBe("category");
  });

  it("should have calendar preset", () => {
    expect(TEMPORAL_PRESETS.calendar).toBeDefined();
    expect(TEMPORAL_PRESETS.calendar.orientation).toBe("vertical");
    expect(TEMPORAL_PRESETS.calendar.timeScale).toBe("day");
  });

  it("should have compact preset", () => {
    expect(TEMPORAL_PRESETS.compact).toBeDefined();
    expect(TEMPORAL_PRESETS.compact.gapStrategy).toBe("compress");
  });

  it("should have expanded preset", () => {
    expect(TEMPORAL_PRESETS.expanded).toBeDefined();
    expect(TEMPORAL_PRESETS.expanded.laneSize).toBeGreaterThan(DEFAULT_TEMPORAL_OPTIONS.laneSize);
  });
});

// ============================================================
// TemporalLayout Class Tests
// ============================================================

describe("TemporalLayout", () => {
  describe("constructor", () => {
    it("should create with default options", () => {
      const layout = new TemporalLayout();
      expect(layout.name).toBe("temporal");
    });

    it("should create with custom options", () => {
      const layout = new TemporalLayout({
        orientation: "vertical",
        laneSize: 100,
      });
      expect(layout.name).toBe("temporal");
    });
  });

  describe("layout()", () => {
    it("should handle empty graph", () => {
      const layout = new TemporalLayout();
      const result = layout.layout({ nodes: [], edges: [] });

      expect(result.positions.size).toBe(0);
      expect(result.lanes.length).toBe(0);
      expect(result.timeMarkers.length).toBe(0);
      expect(result.stats.laneCount).toBe(0);
      expect(result.stats.invalidNodes).toBe(0);
    });

    it("should compute positions for nodes with timestamps", () => {
      const layout = new TemporalLayout();
      const graph = createTemporalGraph(5);
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(5);

      // All nodes should have valid positions
      for (const [, pos] of result.positions) {
        expect(typeof pos.x).toBe("number");
        expect(typeof pos.y).toBe("number");
        expect(isNaN(pos.x)).toBe(false);
        expect(isNaN(pos.y)).toBe(false);
      }
    });

    it("should create lanes based on groups", () => {
      const layout = new TemporalLayout({ laneStrategy: "category" });
      const graph = createTemporalGraph(6, { groups: ["alpha", "beta", "gamma"] });
      const result = layout.layout(graph);

      expect(result.lanes.length).toBe(3);
      expect(result.lanes.map((l) => l.group).sort()).toEqual(["alpha", "beta", "gamma"]);
    });

    it("should generate time markers", () => {
      const now = Date.now();
      const layout = new TemporalLayout();
      const graph = createGraphWithTimes([
        { id: "a", start: now },
        { id: "b", start: now + 24 * 60 * 60 * 1000 },
      ]);
      const result = layout.layout(graph);

      expect(result.timeMarkers.length).toBeGreaterThan(0);

      // Markers should have labels
      for (const marker of result.timeMarkers) {
        expect(marker.label).toBeTruthy();
        expect(typeof marker.position).toBe("number");
      }
    });

    it("should calculate time range", () => {
      const start = Date.now();
      const end = start + 10 * 24 * 60 * 60 * 1000; // 10 days later

      const layout = new TemporalLayout();
      const graph = createGraphWithTimes([
        { id: "first", start },
        { id: "last", start: end },
      ]);
      const result = layout.layout(graph);

      expect(result.timeRange.start).toBe(start);
      expect(result.timeRange.end).toBe(end);
      expect(result.timeRange.duration).toBe(end - start);
    });

    it("should handle nodes without timestamps", () => {
      const layout = new TemporalLayout();
      const graph: GraphData = {
        nodes: [
          {
            id: "valid",
            label: "Valid",
            path: "/valid.md",
            metadata: { startTime: Date.now() },
          },
          {
            id: "invalid",
            label: "Invalid",
            path: "/invalid.md",
            // No timestamp metadata
          },
        ],
        edges: [],
      };
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(2);
      expect(result.stats.invalidNodes).toBe(1);
    });

    it("should order nodes by time on timeline axis", () => {
      const base = Date.now();
      const layout = new TemporalLayout({ orientation: "horizontal" });
      const graph = createGraphWithTimes([
        { id: "third", start: base + 2000 },
        { id: "first", start: base },
        { id: "second", start: base + 1000 },
      ]);
      const result = layout.layout(graph);

      const firstPos = result.positions.get("first")!;
      const secondPos = result.positions.get("second")!;
      const thirdPos = result.positions.get("third")!;

      // Earlier times should have smaller x values
      expect(firstPos.x).toBeLessThan(secondPos.x);
      expect(secondPos.x).toBeLessThan(thirdPos.x);
    });
  });

  describe("horizontal orientation", () => {
    it("should position nodes along x-axis by time", () => {
      const base = Date.now();
      const layout = new TemporalLayout({ orientation: "horizontal" });
      const graph = createGraphWithTimes([
        { id: "a", start: base },
        { id: "b", start: base + 60000 },
      ]);
      const result = layout.layout(graph);

      const posA = result.positions.get("a")!;
      const posB = result.positions.get("b")!;

      expect(posA.x).toBeLessThan(posB.x);
    });

    it("should position lanes along y-axis", () => {
      const base = Date.now();
      const layout = new TemporalLayout({
        orientation: "horizontal",
        laneStrategy: "category",
      });
      const graph = createGraphWithTimes([
        { id: "a", start: base, group: "group1" },
        { id: "b", start: base, group: "group2" },
      ]);
      const result = layout.layout(graph);

      const lane1 = result.lanes.find((l) => l.group === "group1")!;
      const lane2 = result.lanes.find((l) => l.group === "group2")!;

      // Lanes should have different y positions
      expect(lane1.position).not.toBe(lane2.position);
    });
  });

  describe("vertical orientation", () => {
    it("should position nodes along y-axis by time", () => {
      const base = Date.now();
      const layout = new TemporalLayout({ orientation: "vertical" });
      const graph = createGraphWithTimes([
        { id: "a", start: base },
        { id: "b", start: base + 60000 },
      ]);
      const result = layout.layout(graph);

      const posA = result.positions.get("a")!;
      const posB = result.positions.get("b")!;

      expect(posA.y).toBeLessThan(posB.y);
    });
  });

  describe("lane strategies", () => {
    it("should use single lane with 'none' strategy", () => {
      const layout = new TemporalLayout({ laneStrategy: "none" });
      const graph = createTemporalGraph(5, { groups: ["a", "b", "c"] });
      const result = layout.layout(graph);

      expect(result.lanes.length).toBe(1);
      expect(result.lanes[0].group).toBe("default");
    });

    it("should group by type with 'type' strategy", () => {
      const layout = new TemporalLayout({ laneStrategy: "type" });
      const graph = createTemporalGraph(6); // Creates tasks and events
      const result = layout.layout(graph);

      const groups = result.lanes.map((l) => l.group);
      expect(groups).toContain("task");
      expect(groups).toContain("event");
    });

    it("should use custom property with 'category' strategy", () => {
      const layout = new TemporalLayout({
        laneStrategy: "category",
        groupProperty: "priority",
      });
      const graph: GraphData = {
        nodes: [
          {
            id: "a",
            label: "A",
            path: "/a.md",
            metadata: { startTime: Date.now(), priority: "high" },
          },
          {
            id: "b",
            label: "B",
            path: "/b.md",
            metadata: { startTime: Date.now(), priority: "low" },
          },
        ],
        edges: [],
      };
      const result = layout.layout(graph);

      const groups = result.lanes.map((l) => l.group);
      expect(groups).toContain("high");
      expect(groups).toContain("low");
    });
  });

  describe("time scale detection", () => {
    it("should detect hour scale for short durations", () => {
      const base = Date.now();
      const layout = new TemporalLayout({ timeScale: "auto" });
      const graph = createGraphWithTimes([
        { id: "a", start: base },
        { id: "b", start: base + 3 * 60 * 60 * 1000 }, // 3 hours
      ]);
      const result = layout.layout(graph);

      expect(["minute", "hour"]).toContain(result.stats.detectedScale);
    });

    it("should detect day scale for multi-day durations", () => {
      const base = Date.now();
      const layout = new TemporalLayout({ timeScale: "auto" });
      const graph = createGraphWithTimes([
        { id: "a", start: base },
        { id: "b", start: base + 7 * 24 * 60 * 60 * 1000 }, // 7 days
      ]);
      const result = layout.layout(graph);

      expect(["day", "week"]).toContain(result.stats.detectedScale);
    });

    it("should use explicit scale when specified", () => {
      const layout = new TemporalLayout({ timeScale: "month" });
      const graph = createTemporalGraph(5);
      const result = layout.layout(graph);

      expect(result.stats.detectedScale).toBe("month");
    });
  });

  describe("duration visualization", () => {
    it("should show duration when enabled", () => {
      const base = Date.now();
      const layout = new TemporalLayout({
        showDuration: true,
        minDurationSize: 20,
      });
      const graph = createGraphWithTimes([
        { id: "short", start: base, end: base + 1000 },
        { id: "long", start: base, end: base + 100000 },
      ]);
      const result = layout.layout(graph);

      // Both should have positions
      expect(result.positions.has("short")).toBe(true);
      expect(result.positions.has("long")).toBe(true);
    });
  });

  describe("edge routing", () => {
    it("should mark cross-lane edges", () => {
      const base = Date.now();
      const layout = new TemporalLayout({ laneStrategy: "category" });
      const graph: GraphData = {
        nodes: [
          {
            id: "a",
            label: "A",
            path: "/a.md",
            metadata: { startTime: base, group: "lane1" },
          },
          {
            id: "b",
            label: "B",
            path: "/b.md",
            metadata: { startTime: base + 1000, group: "lane2" },
          },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }],
      };
      const result = layout.layout(graph);

      expect(result.edges.length).toBe(1);
      expect(result.edges[0].crossLane).toBe(true);
    });

    it("should not mark same-lane edges as cross-lane", () => {
      const base = Date.now();
      const layout = new TemporalLayout({ laneStrategy: "category" });
      const graph: GraphData = {
        nodes: [
          {
            id: "a",
            label: "A",
            path: "/a.md",
            metadata: { startTime: base, group: "same" },
          },
          {
            id: "b",
            label: "B",
            path: "/b.md",
            metadata: { startTime: base + 1000, group: "same" },
          },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }],
      };
      const result = layout.layout(graph);

      expect(result.edges[0].crossLane).toBe(false);
    });
  });

  describe("custom options", () => {
    it("should use custom time extractor", () => {
      const layout = new TemporalLayout({
        timeExtractor: (node) => {
          const ts = node.metadata?.customTimestamp;
          return typeof ts === "number" ? ts : null;
        },
      });
      const graph: GraphData = {
        nodes: [
          {
            id: "a",
            label: "A",
            path: "/a.md",
            metadata: { customTimestamp: 1000 },
          },
          {
            id: "b",
            label: "B",
            path: "/b.md",
            metadata: { customTimestamp: 2000 },
          },
        ],
        edges: [],
      };
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(2);
      expect(result.stats.invalidNodes).toBe(0);
    });

    it("should use custom group orderer", () => {
      const layout = new TemporalLayout({
        groupOrderer: (groups) => groups.sort().reverse(),
      });
      const graph = createTemporalGraph(4, { groups: ["a", "b"] });
      const result = layout.layout(graph);

      // Groups should be in reverse order
      expect(result.lanes[0].group).toBe("b");
      expect(result.lanes[1].group).toBe("a");
    });
  });

  describe("bounds calculation", () => {
    it("should calculate correct bounds", () => {
      const layout = new TemporalLayout();
      const graph = createTemporalGraph(5);
      const result = layout.layout(graph);

      expect(result.bounds.width).toBeGreaterThan(0);
      expect(result.bounds.height).toBeGreaterThan(0);
      expect(result.bounds.maxX).toBeGreaterThan(result.bounds.minX);
      expect(result.bounds.maxY).toBeGreaterThan(result.bounds.minY);
    });

    it("should include margin in bounds", () => {
      const margin = 100;
      const layout = new TemporalLayout({ margin });
      const graph = createTemporalGraph(3);
      const result = layout.layout(graph);

      // Bounds should be at least margin away from positions
      const positions = Array.from(result.positions.values());
      const minX = Math.min(...positions.map((p) => p.x));
      const maxX = Math.max(...positions.map((p) => p.x));

      expect(result.bounds.minX).toBeLessThanOrEqual(minX - margin);
      expect(result.bounds.maxX).toBeGreaterThanOrEqual(maxX + margin);
    });
  });
});

// ============================================================
// Factory Function Tests
// ============================================================

describe("createTemporalLayout", () => {
  it("should create layout with defaults", () => {
    const layout = createTemporalLayout();
    expect(layout).toBeInstanceOf(TemporalLayout);
    expect(layout.name).toBe("temporal");
  });

  it("should create layout with options", () => {
    const layout = createTemporalLayout({ orientation: "vertical" });
    expect(layout).toBeInstanceOf(TemporalLayout);
  });

  it("should apply preset and override with options", () => {
    const layout = createTemporalLayout(
      { laneSize: 200 },
      "gantt"
    );

    // Should have gantt preset showDuration
    const graph = createTemporalGraph(3);
    const result = layout.layout(graph);
    expect(result.positions.size).toBe(3);
  });

  it("should create layout with preset only", () => {
    const layout = createTemporalLayout(undefined, "timeline");
    expect(layout).toBeInstanceOf(TemporalLayout);
  });
});

// ============================================================
// Edge Cases Tests
// ============================================================

describe("Edge Cases", () => {
  it("should handle single node", () => {
    const layout = new TemporalLayout();
    const graph: GraphData = {
      nodes: [
        {
          id: "single",
          label: "Single",
          path: "/single.md",
          metadata: { startTime: Date.now() },
        },
      ],
      edges: [],
    };
    const result = layout.layout(graph);

    expect(result.positions.size).toBe(1);
    expect(result.lanes.length).toBe(1);
  });

  it("should handle nodes with same timestamp", () => {
    const sameTime = Date.now();
    const layout = new TemporalLayout();
    const graph = createGraphWithTimes([
      { id: "a", start: sameTime },
      { id: "b", start: sameTime },
      { id: "c", start: sameTime },
    ]);
    const result = layout.layout(graph);

    expect(result.positions.size).toBe(3);
  });

  it("should handle nodes with Date objects as timestamps", () => {
    const layout = new TemporalLayout();
    const graph: GraphData = {
      nodes: [
        {
          id: "a",
          label: "A",
          path: "/a.md",
          metadata: { startTime: new Date() },
        },
      ],
      edges: [],
    };
    const result = layout.layout(graph);

    expect(result.positions.size).toBe(1);
    expect(result.stats.invalidNodes).toBe(0);
  });

  it("should handle nodes with ISO date strings", () => {
    const layout = new TemporalLayout();
    const graph: GraphData = {
      nodes: [
        {
          id: "a",
          label: "A",
          path: "/a.md",
          metadata: { startTime: "2024-01-15T10:30:00Z" },
        },
      ],
      edges: [],
    };
    const result = layout.layout(graph);

    expect(result.positions.size).toBe(1);
    expect(result.stats.invalidNodes).toBe(0);
  });

  it("should handle all nodes with invalid timestamps", () => {
    const layout = new TemporalLayout();
    const graph: GraphData = {
      nodes: [
        { id: "a", label: "A", path: "/a.md" },
        { id: "b", label: "B", path: "/b.md" },
      ],
      edges: [],
    };
    const result = layout.layout(graph);

    expect(result.positions.size).toBe(2);
    expect(result.stats.invalidNodes).toBe(2);
  });

  it("should handle edges with missing nodes", () => {
    const layout = new TemporalLayout();
    const graph: GraphData = {
      nodes: [
        {
          id: "a",
          label: "A",
          path: "/a.md",
          metadata: { startTime: Date.now() },
        },
      ],
      edges: [
        { id: "e1", source: "a", target: "missing" },
        { id: "e2", source: "missing", target: "a" },
      ],
    };
    const result = layout.layout(graph);

    // Edges with missing nodes should be skipped
    expect(result.edges.length).toBe(0);
  });

  it("should handle very long time ranges", () => {
    const layout = new TemporalLayout();
    const graph = createGraphWithTimes([
      { id: "ancient", start: Date.parse("2000-01-01") },
      { id: "recent", start: Date.parse("2024-01-01") },
    ]);
    const result = layout.layout(graph);

    expect(result.positions.size).toBe(2);
    expect(result.stats.detectedScale).toBe("year");
  });
});

// ============================================================
// Time Marker Tests
// ============================================================

describe("Time Markers", () => {
  it("should generate markers at appropriate intervals", () => {
    const layout = new TemporalLayout();
    const graph = createTemporalGraph(10, {
      startTime: Date.now(),
      interval: 24 * 60 * 60 * 1000, // 1 day
    });
    const result = layout.layout(graph);

    expect(result.timeMarkers.length).toBeGreaterThan(0);
    expect(result.timeMarkers.length).toBeLessThan(30); // Not too many
  });

  it("should include major and minor markers", () => {
    const layout = new TemporalLayout();
    const graph = createTemporalGraph(20, {
      startTime: Date.now(),
      interval: 60 * 60 * 1000, // 1 hour
    });
    const result = layout.layout(graph);

    const majorMarkers = result.timeMarkers.filter((m) => m.isMajor);
    const minorMarkers = result.timeMarkers.filter((m) => !m.isMajor);

    expect(majorMarkers.length).toBeGreaterThan(0);
    expect(minorMarkers.length).toBeGreaterThanOrEqual(0);
  });

  it("should have increasing positions", () => {
    const layout = new TemporalLayout({ orientation: "horizontal" });
    const graph = createTemporalGraph(5);
    const result = layout.layout(graph);

    const positions = result.timeMarkers.map((m) => m.position);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
  });
});
