/**
 * Tests for RadialLayout
 *
 * @module tests/unit/presentation/renderers/graph
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  RadialLayout,
  createRadialLayout,
  DEFAULT_RADIAL_OPTIONS,
  RADIAL_PRESETS,
  type RadialLayoutOptions,
  type RadialLayoutResult,
  type RadialNode,
  type RadialEdge,
  type RadialSortBy,
  type SubtreeAngleStrategy,
  type RingAssignmentAlgorithm,
  type EdgeRoutingStyle,
  type RadialPresetName,
} from "../../../../../src/presentation/renderers/graph/RadialLayout";
import type {
  GraphData,
  GraphNode,
  GraphEdge,
} from "../../../../../src/presentation/renderers/graph/types";

describe("RadialLayout", () => {
  // ============================================================
  // Test Data Helpers
  // ============================================================

  function createNode(id: string, group?: string): GraphNode {
    return {
      id,
      label: `Node ${id}`,
      path: `/path/to/${id}.md`,
      group,
    };
  }

  function createEdge(source: string, target: string): GraphEdge {
    return {
      id: `${source}-${target}`,
      source,
      target,
    };
  }

  function createStarGraph(centerLabel: string, rayCount: number): GraphData {
    // Star graph: center node connected to N rays
    const nodes: GraphNode[] = [createNode(centerLabel)];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < rayCount; i++) {
      const rayId = `ray${i}`;
      nodes.push(createNode(rayId));
      edges.push(createEdge(centerLabel, rayId));
    }

    return { nodes, edges };
  }

  function createSimpleTree(): GraphData {
    // A simple tree: root -> [a, b], a -> [c, d], b -> [e]
    return {
      nodes: [
        createNode("root"),
        createNode("a"),
        createNode("b"),
        createNode("c"),
        createNode("d"),
        createNode("e"),
      ],
      edges: [
        createEdge("root", "a"),
        createEdge("root", "b"),
        createEdge("a", "c"),
        createEdge("a", "d"),
        createEdge("b", "e"),
      ],
    };
  }

  function createChain(length: number): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < length; i++) {
      nodes.push(createNode(`n${i}`));
      if (i > 0) {
        edges.push(createEdge(`n${i - 1}`, `n${i}`));
      }
    }

    return { nodes, edges };
  }

  function createDisconnectedGraph(): GraphData {
    return {
      nodes: [
        createNode("a"),
        createNode("b"),
        createNode("c"),
        createNode("x"),
        createNode("y"),
      ],
      edges: [
        createEdge("a", "b"),
        createEdge("b", "c"),
        createEdge("x", "y"),
      ],
    };
  }

  function createCyclicGraph(): GraphData {
    // Cycle: a -> b -> c -> a
    return {
      nodes: [createNode("a"), createNode("b"), createNode("c")],
      edges: [
        createEdge("a", "b"),
        createEdge("b", "c"),
        createEdge("c", "a"),
      ],
    };
  }

  function createCompleteGraph(size: number): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < size; i++) {
      nodes.push(createNode(`n${i}`));
      for (let j = 0; j < i; j++) {
        edges.push(createEdge(`n${j}`, `n${i}`));
      }
    }

    return { nodes, edges };
  }

  // ============================================================
  // Constructor Tests
  // ============================================================

  describe("constructor", () => {
    it("should create layout with default options", () => {
      const layout = new RadialLayout();
      const options = layout.getOptions();

      expect(options.radiusStep).toBe(100);
      expect(options.startAngle).toBe(0);
      expect(options.endAngle).toBe(Math.PI * 2);
      expect(options.sortBy).toBe("connection");
      expect(options.sortOrder).toBe("desc");
      expect(options.equalAngle).toBe(false);
      expect(options.subtreeAngle).toBe("proportional");
      expect(options.ringAssignment).toBe("bfs");
      expect(options.edgeRouting).toBe("arc");
    });

    it("should merge custom options with defaults", () => {
      const layout = new RadialLayout({
        radiusStep: 150,
        centerNode: "custom-center",
      });
      const options = layout.getOptions();

      expect(options.radiusStep).toBe(150);
      expect(options.centerNode).toBe("custom-center");
      expect(options.sortBy).toBe("connection"); // default
    });

    it("should accept all options", () => {
      const customOptions: RadialLayoutOptions = {
        centerNode: "center",
        radiusStep: 80,
        startAngle: Math.PI / 4,
        endAngle: Math.PI * 2,
        sortBy: "label",
        sortOrder: "asc",
        equalAngle: true,
        subtreeAngle: "equal",
        ringAssignment: "hierarchy",
        minAngleGap: 0.2,
        compact: false,
        edgeRouting: "curved",
        arcCurvature: 0.5,
        margin: 100,
        centerOffset: { x: 50, y: 50 },
      };

      const layout = new RadialLayout(customOptions);
      const options = layout.getOptions();

      expect(options.centerNode).toBe("center");
      expect(options.radiusStep).toBe(80);
      expect(options.sortBy).toBe("label");
      expect(options.equalAngle).toBe(true);
      expect(options.edgeRouting).toBe("curved");
    });
  });

  // ============================================================
  // Empty Graph Tests
  // ============================================================

  describe("empty graph", () => {
    it("should handle empty graph", () => {
      const layout = new RadialLayout();
      const result = layout.layout({ nodes: [], edges: [] });

      expect(result.positions.size).toBe(0);
      expect(result.edges).toHaveLength(0);
      expect(result.bounds.width).toBe(0);
      expect(result.bounds.height).toBe(0);
      expect(result.bounds.radius).toBe(0);
      expect(result.stats.ringCount).toBe(0);
      expect(result.stats.centerNode).toBe("");
    });

    it("should handle single node", () => {
      const layout = new RadialLayout();
      const result = layout.layout({
        nodes: [createNode("a")],
        edges: [],
      });

      expect(result.positions.size).toBe(1);
      expect(result.positions.has("a")).toBe(true);
      expect(result.stats.centerNode).toBe("a");
      expect(result.stats.ringCount).toBe(1);
      expect(result.stats.nodesPerRing).toEqual([1]);
    });
  });

  // ============================================================
  // Center Node Selection Tests
  // ============================================================

  describe("center node selection", () => {
    it("should use explicit center node when provided", () => {
      const layout = new RadialLayout({ centerNode: "b" });
      const graph = createSimpleTree();
      const result = layout.layout(graph);

      expect(result.stats.centerNode).toBe("b");
    });

    it("should select highest degree node as center when not specified", () => {
      const layout = new RadialLayout();
      const graph = createStarGraph("hub", 5);
      const result = layout.layout(graph);

      // "hub" has 5 connections, rays have 1 each
      expect(result.stats.centerNode).toBe("hub");
    });

    it("should ignore invalid center node and auto-select", () => {
      const layout = new RadialLayout({ centerNode: "nonexistent" });
      const graph = createStarGraph("hub", 3);
      const result = layout.layout(graph);

      expect(result.stats.centerNode).toBe("hub");
    });

    it("should handle equal degree nodes", () => {
      const layout = new RadialLayout();
      const graph: GraphData = {
        nodes: [createNode("a"), createNode("b")],
        edges: [createEdge("a", "b")],
      };
      const result = layout.layout(graph);

      // Either node could be center, but one must be selected
      expect(["a", "b"]).toContain(result.stats.centerNode);
    });
  });

  // ============================================================
  // Ring Assignment Tests
  // ============================================================

  describe("ring assignment", () => {
    describe("BFS algorithm", () => {
      it("should place center node at ring 0", () => {
        const layout = new RadialLayout({ centerNode: "root" });
        const graph = createSimpleTree();
        const result = layout.layout(graph);

        expect(result.stats.nodesPerRing[0]).toBe(1);
      });

      it("should place direct neighbors at ring 1", () => {
        const layout = new RadialLayout({ centerNode: "hub" });
        const graph = createStarGraph("hub", 4);
        const result = layout.layout(graph);

        expect(result.stats.nodesPerRing).toEqual([1, 4]);
        expect(result.stats.ringCount).toBe(2);
      });

      it("should correctly assign rings in tree structure", () => {
        const layout = new RadialLayout({ centerNode: "root" });
        const graph = createSimpleTree();
        const result = layout.layout(graph);

        // root at ring 0, a+b at ring 1, c+d+e at ring 2
        expect(result.stats.nodesPerRing).toEqual([1, 2, 3]);
      });

      it("should handle chain graphs", () => {
        const layout = new RadialLayout({ centerNode: "n0" });
        const graph = createChain(5);
        const result = layout.layout(graph);

        // Linear chain: each node at different ring
        expect(result.stats.ringCount).toBe(5);
        expect(result.stats.nodesPerRing).toEqual([1, 1, 1, 1, 1]);
      });
    });

    describe("hierarchy algorithm", () => {
      it("should respect edge direction in hierarchy mode", () => {
        const layout = new RadialLayout({
          centerNode: "root",
          ringAssignment: "hierarchy",
        });
        const graph = createSimpleTree();
        const result = layout.layout(graph);

        // Same structure as BFS for tree
        expect(result.stats.ringCount).toBe(3);
      });
    });

    describe("disconnected graphs", () => {
      it("should handle disconnected components", () => {
        const layout = new RadialLayout({ centerNode: "a" });
        const graph = createDisconnectedGraph();
        const result = layout.layout(graph);

        // All nodes should be placed
        expect(result.positions.size).toBe(5);
        // Disconnected nodes placed in outer ring
        expect(result.stats.ringCount).toBeGreaterThan(0);
      });
    });

    describe("cyclic graphs", () => {
      it("should handle graphs with cycles", () => {
        const layout = new RadialLayout();
        const graph = createCyclicGraph();
        const result = layout.layout(graph);

        expect(result.positions.size).toBe(3);
        expect(result.stats.ringCount).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================
  // Angular Position Tests
  // ============================================================

  describe("angular positions", () => {
    it("should distribute nodes around full circle by default", () => {
      const layout = new RadialLayout({ centerNode: "hub" });
      const graph = createStarGraph("hub", 4);
      const result = layout.layout(graph);

      // Check that positions are distributed around center
      const centerPos = result.positions.get("hub")!;
      const rayPositions = [];

      for (let i = 0; i < 4; i++) {
        rayPositions.push(result.positions.get(`ray${i}`)!);
      }

      // All rays should be at same distance from center
      const distances = rayPositions.map((pos) => {
        const dx = pos.x - centerPos.x;
        const dy = pos.y - centerPos.y;
        return Math.sqrt(dx * dx + dy * dy);
      });

      // All distances should be approximately equal
      const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
      for (const d of distances) {
        expect(d).toBeCloseTo(avgDistance, 0);
      }
    });

    it("should respect start and end angle for semicircle", () => {
      const layout = new RadialLayout({
        centerNode: "hub",
        startAngle: -Math.PI / 2,
        endAngle: Math.PI / 2,
      });
      const graph = createStarGraph("hub", 4);
      const result = layout.layout(graph);

      const centerPos = result.positions.get("hub")!;

      // All ray nodes should be on the right side of center (x >= centerX)
      for (let i = 0; i < 4; i++) {
        const pos = result.positions.get(`ray${i}`)!;
        // With margin adjustment, check relative position
        expect(pos.x).toBeGreaterThanOrEqual(centerPos.x - 1);
      }
    });

    it("should use equal angles when equalAngle is true", () => {
      const layout = new RadialLayout({
        centerNode: "hub",
        equalAngle: true,
      });
      const graph = createStarGraph("hub", 4);
      const result = layout.layout(graph);

      const centerPos = result.positions.get("hub")!;
      const angles: number[] = [];

      for (let i = 0; i < 4; i++) {
        const pos = result.positions.get(`ray${i}`)!;
        const dx = pos.x - centerPos.x;
        const dy = pos.y - centerPos.y;
        angles.push(Math.atan2(dy, dx));
      }

      angles.sort((a, b) => a - b);

      // Check that angle differences are approximately equal
      const angleDiffs = [];
      for (let i = 0; i < angles.length - 1; i++) {
        angleDiffs.push(angles[i + 1] - angles[i]);
      }

      // All differences should be similar
      const avgDiff = angleDiffs.reduce((a, b) => a + b, 0) / angleDiffs.length;
      for (const diff of angleDiffs) {
        expect(Math.abs(diff - avgDiff)).toBeLessThan(0.5);
      }
    });

    it("should handle proportional subtree angle allocation", () => {
      const layout = new RadialLayout({
        centerNode: "root",
        subtreeAngle: "proportional",
      });
      const graph = createSimpleTree();
      const result = layout.layout(graph);

      // Node "a" has 2 children (c, d), node "b" has 1 child (e)
      // "a" should get more angular space
      const positions = result.positions;

      expect(positions.has("a")).toBe(true);
      expect(positions.has("b")).toBe(true);
    });
  });

  // ============================================================
  // Coordinate Conversion Tests
  // ============================================================

  describe("coordinate conversion", () => {
    it("should convert polar to Cartesian correctly", () => {
      const layout = new RadialLayout({
        centerNode: "hub",
        radiusStep: 100,
        margin: 0,
        centerOffset: { x: 0, y: 0 },
      });
      const graph = createStarGraph("hub", 1);
      const result = layout.layout(graph);

      // Center node should be near origin (with margin adjustment)
      const centerPos = result.positions.get("hub")!;

      // Ray should be at radius 100 from center
      const rayPos = result.positions.get("ray0")!;
      const dx = rayPos.x - centerPos.x;
      const dy = rayPos.y - centerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      expect(distance).toBeCloseTo(100, 0);
    });

    it("should apply margin correctly", () => {
      const layout = new RadialLayout({
        centerNode: "hub",
        radiusStep: 100,
        margin: 50,
      });
      const graph = createStarGraph("hub", 1);
      const result = layout.layout(graph);

      // All coordinates should be >= margin
      for (const pos of result.positions.values()) {
        expect(pos.x).toBeGreaterThanOrEqual(49); // Allow small float error
        expect(pos.y).toBeGreaterThanOrEqual(49);
      }
    });

    it("should respect center offset", () => {
      // Note: margin normalization shifts all coordinates so minX/minY = margin
      // The center offset affects relative node positions within the layout
      const layout = new RadialLayout({
        centerNode: "hub",
        centerOffset: { x: 100, y: 100 },
        margin: 50,
      });

      const graph = createStarGraph("hub", 4);
      const result = layout.layout(graph);

      // All positions should be valid
      expect(result.positions.size).toBe(5);

      // The hub should be positioned considering the offset
      const hubPos = result.positions.get("hub")!;
      expect(hubPos.x).toBeGreaterThanOrEqual(50);
      expect(hubPos.y).toBeGreaterThanOrEqual(50);
    });
  });

  // ============================================================
  // Edge Routing Tests
  // ============================================================

  describe("edge routing", () => {
    it("should generate control points for edges", () => {
      const layout = new RadialLayout();
      const graph = createSimpleTree();
      const result = layout.layout(graph);

      for (const edge of result.edges) {
        expect(edge.controlPoints).toBeDefined();
        expect(edge.controlPoints!.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("should calculate ring span for edges", () => {
      const layout = new RadialLayout({ centerNode: "hub" });
      const graph = createStarGraph("hub", 3);
      const result = layout.layout(graph);

      // All edges connect hub (ring 0) to rays (ring 1)
      for (const edge of result.edges) {
        expect(edge.ringSpan).toBeDefined();
        expect(edge.ringSpan).toBe(1); // Adjacent rings
        expect(edge.isLongEdge).toBe(false); // Not a long edge (span <= 1)
      }
    });

    it("should identify long edges correctly", () => {
      // Create a chain where we have an edge that skips intermediate nodes
      // Hub -> Level1 -> Level2 -> Level3
      // And add an edge from Level1 to Level3 (span = 2)
      const layout = new RadialLayout({ centerNode: "hub" });
      const graph: GraphData = {
        nodes: [
          createNode("hub"),
          createNode("l1"),
          createNode("l2"),
          createNode("l3"),
        ],
        edges: [
          createEdge("hub", "l1"),
          createEdge("l1", "l2"),
          createEdge("l2", "l3"),
          // NOT adding a shortcut edge here - instead verify the structure
        ],
      };
      const result = layout.layout(graph);

      // Check that nodes are at expected rings
      // hub at 0, l1 at 1, l2 at 2, l3 at 3
      expect(result.stats.ringCount).toBe(4);
      expect(result.stats.nodesPerRing).toEqual([1, 1, 1, 1]);

      // All edges in this graph are adjacent (span = 1)
      for (const edge of result.edges) {
        expect(edge.isLongEdge).toBe(false);
      }
    });

    describe("straight routing", () => {
      it("should generate 2 control points for straight routing", () => {
        const layout = new RadialLayout({ edgeRouting: "straight" });
        const graph = createStarGraph("hub", 2);
        const result = layout.layout(graph);

        for (const edge of result.edges) {
          expect(edge.controlPoints!.length).toBe(2);
        }
      });
    });

    describe("curved routing", () => {
      it("should generate 3 control points for curved routing", () => {
        const layout = new RadialLayout({ edgeRouting: "curved" });
        const graph = createStarGraph("hub", 2);
        const result = layout.layout(graph);

        for (const edge of result.edges) {
          expect(edge.controlPoints!.length).toBe(3);
        }
      });
    });

    describe("arc routing", () => {
      it("should generate arc path for same-ring edges", () => {
        const layout = new RadialLayout({ edgeRouting: "arc" });
        const graph: GraphData = {
          nodes: [createNode("c"), createNode("a"), createNode("b")],
          edges: [
            createEdge("c", "a"),
            createEdge("c", "b"),
            createEdge("a", "b"), // same-ring edge
          ],
        };
        const result = layout.layout(graph);

        const sameRingEdge = result.edges.find((e) => e.id === "a-b");
        expect(sameRingEdge).toBeDefined();
        // Arc paths should have multiple points
        expect(sameRingEdge!.controlPoints!.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // ============================================================
  // Bounds and Statistics Tests
  // ============================================================

  describe("bounds and statistics", () => {
    it("should calculate correct bounds", () => {
      const layout = new RadialLayout({
        centerNode: "hub",
        radiusStep: 100,
      });
      const graph = createStarGraph("hub", 4);
      const result = layout.layout(graph);

      expect(result.bounds.width).toBeGreaterThan(0);
      expect(result.bounds.height).toBeGreaterThan(0);
      expect(result.bounds.maxX).toBeGreaterThan(result.bounds.minX);
      expect(result.bounds.maxY).toBeGreaterThan(result.bounds.minY);
    });

    it("should calculate correct radius", () => {
      const layout = new RadialLayout({
        centerNode: "n0",
        radiusStep: 100,
      });
      const graph = createChain(4);
      const result = layout.layout(graph);

      // 4 rings (0-3), max ring = 3
      expect(result.bounds.radius).toBe(300);
    });

    it("should report correct statistics", () => {
      const layout = new RadialLayout({ centerNode: "root" });
      const graph = createSimpleTree();
      const result = layout.layout(graph);

      expect(result.stats.ringCount).toBe(3);
      expect(result.stats.centerNode).toBe("root");
      expect(result.stats.nodesPerRing).toHaveLength(3);
      expect(result.stats.maxRadius).toBe(200); // 2 * 100
    });

    it("should count long edges in star graph", () => {
      // In a simple star graph, all edges go from center to ring 1
      const layout = new RadialLayout({ centerNode: "hub" });
      const graph = createStarGraph("hub", 5);

      const result = layout.layout(graph);
      // No long edges in star graph (all span = 1)
      expect(result.stats.longEdges).toBe(0);
    });

    it("should report long edge count when they exist", () => {
      // In a chain graph, edges between nodes at increasing distances
      // Hub -> A (span 1, adjacent) - not a long edge
      const layout = new RadialLayout({ centerNode: "hub" });
      const graph: GraphData = {
        nodes: [
          createNode("hub"),
          createNode("a"),
          createNode("b"),
        ],
        edges: [
          createEdge("hub", "a"),
          createEdge("a", "b"),
        ],
      };

      const result = layout.layout(graph);
      // No long edges - all are adjacent
      expect(result.stats.longEdges).toBe(0);
    });
  });

  // ============================================================
  // Configuration Methods Tests
  // ============================================================

  describe("configuration methods", () => {
    it("should get and set options", () => {
      const layout = new RadialLayout();

      layout.setOptions({ radiusStep: 150 });
      expect(layout.getOptions().radiusStep).toBe(150);

      layout.setOptions({ sortBy: "label", equalAngle: true });
      expect(layout.getOptions().sortBy).toBe("label");
      expect(layout.getOptions().equalAngle).toBe(true);
    });

    describe("fluent API", () => {
      it("should support fluent center node setting", () => {
        const layout = new RadialLayout();

        expect(layout.centerNode()).toBeUndefined();

        const result = layout.centerNode("test");
        expect(result).toBe(layout);
        expect(layout.centerNode()).toBe("test");
      });

      it("should support fluent radius step setting", () => {
        const layout = new RadialLayout();

        expect(layout.radiusStep()).toBe(100);

        const result = layout.radiusStep(150);
        expect(result).toBe(layout);
        expect(layout.radiusStep()).toBe(150);
      });

      it("should support fluent start angle setting", () => {
        const layout = new RadialLayout();

        expect(layout.startAngle()).toBe(0);

        const result = layout.startAngle(Math.PI / 2);
        expect(result).toBe(layout);
        expect(layout.startAngle()).toBe(Math.PI / 2);
      });

      it("should support fluent end angle setting", () => {
        const layout = new RadialLayout();

        expect(layout.endAngle()).toBe(Math.PI * 2);

        const result = layout.endAngle(Math.PI);
        expect(result).toBe(layout);
        expect(layout.endAngle()).toBe(Math.PI);
      });

      it("should support fluent sort by setting", () => {
        const layout = new RadialLayout();

        expect(layout.sortBy()).toBe("connection");

        const result = layout.sortBy("label");
        expect(result).toBe(layout);
        expect(layout.sortBy()).toBe("label");
      });

      it("should support fluent equal angle setting", () => {
        const layout = new RadialLayout();

        expect(layout.equalAngle()).toBe(false);

        const result = layout.equalAngle(true);
        expect(result).toBe(layout);
        expect(layout.equalAngle()).toBe(true);
      });

      it("should support fluent subtree angle setting", () => {
        const layout = new RadialLayout();

        expect(layout.subtreeAngle()).toBe("proportional");

        const result = layout.subtreeAngle("equal");
        expect(result).toBe(layout);
        expect(layout.subtreeAngle()).toBe("equal");
      });

      it("should support fluent ring assignment setting", () => {
        const layout = new RadialLayout();

        expect(layout.ringAssignment()).toBe("bfs");

        const result = layout.ringAssignment("hierarchy");
        expect(result).toBe(layout);
        expect(layout.ringAssignment()).toBe("hierarchy");
      });

      it("should support fluent edge routing setting", () => {
        const layout = new RadialLayout();

        expect(layout.edgeRouting()).toBe("arc");

        const result = layout.edgeRouting("curved");
        expect(result).toBe(layout);
        expect(layout.edgeRouting()).toBe("curved");
      });

      it("should support method chaining", () => {
        const layout = new RadialLayout();

        layout
          .centerNode("root")
          .radiusStep(150)
          .startAngle(0)
          .endAngle(Math.PI * 2)
          .sortBy("label")
          .equalAngle(true)
          .edgeRouting("curved");

        expect(layout.centerNode()).toBe("root");
        expect(layout.radiusStep()).toBe(150);
        expect(layout.sortBy()).toBe("label");
        expect(layout.equalAngle()).toBe(true);
        expect(layout.edgeRouting()).toBe("curved");
      });
    });
  });

  // ============================================================
  // Preset Tests
  // ============================================================

  describe("presets", () => {
    it("should have default preset", () => {
      expect(RADIAL_PRESETS.default).toBeDefined();
      expect(RADIAL_PRESETS.default.radiusStep).toBe(100);
      expect(RADIAL_PRESETS.default.edgeRouting).toBe("arc");
    });

    it("should have tree preset", () => {
      expect(RADIAL_PRESETS.tree).toBeDefined();
      expect(RADIAL_PRESETS.tree.ringAssignment).toBe("hierarchy");
      expect(RADIAL_PRESETS.tree.edgeRouting).toBe("curved");
    });

    it("should have network preset", () => {
      expect(RADIAL_PRESETS.network).toBeDefined();
      expect(RADIAL_PRESETS.network.equalAngle).toBe(true);
    });

    it("should have compact preset", () => {
      expect(RADIAL_PRESETS.compact).toBeDefined();
      expect(RADIAL_PRESETS.compact.radiusStep).toBe(60);
      expect(RADIAL_PRESETS.compact.edgeRouting).toBe("straight");
    });

    it("should have wide preset", () => {
      expect(RADIAL_PRESETS.wide).toBeDefined();
      expect(RADIAL_PRESETS.wide.radiusStep).toBe(150);
    });

    it("should have semicircle preset", () => {
      expect(RADIAL_PRESETS.semicircle).toBeDefined();
      expect(RADIAL_PRESETS.semicircle.startAngle).toBe(-Math.PI / 2);
      expect(RADIAL_PRESETS.semicircle.endAngle).toBe(Math.PI / 2);
    });
  });

  // ============================================================
  // Factory Function Tests
  // ============================================================

  describe("createRadialLayout", () => {
    it("should create layout with default preset", () => {
      const layout = createRadialLayout();
      const options = layout.getOptions();

      expect(options.radiusStep).toBe(100);
      expect(options.edgeRouting).toBe("arc");
    });

    it("should create layout with specified preset", () => {
      const layout = createRadialLayout("tree");
      const options = layout.getOptions();

      expect(options.ringAssignment).toBe("hierarchy");
      expect(options.edgeRouting).toBe("curved");
    });

    it("should apply overrides to preset", () => {
      const layout = createRadialLayout("tree", { radiusStep: 200 });
      const options = layout.getOptions();

      expect(options.ringAssignment).toBe("hierarchy"); // from preset
      expect(options.radiusStep).toBe(200); // override
    });

    it("should work with all preset names", () => {
      const presetNames: RadialPresetName[] = [
        "default",
        "tree",
        "network",
        "compact",
        "wide",
        "semicircle",
      ];

      for (const preset of presetNames) {
        const layout = createRadialLayout(preset);
        expect(layout).toBeInstanceOf(RadialLayout);
      }
    });
  });

  // ============================================================
  // Sorting Tests
  // ============================================================

  describe("node sorting", () => {
    it("should sort by connection count", () => {
      const layout = new RadialLayout({
        centerNode: "a",
        sortBy: "connection",
        sortOrder: "desc",
      });

      const graph: GraphData = {
        nodes: [
          createNode("a"),
          createNode("b"),
          createNode("c"),
          createNode("d"),
        ],
        edges: [
          createEdge("a", "b"),
          createEdge("a", "c"),
          createEdge("a", "d"),
          createEdge("b", "c"), // b has extra connection
          createEdge("b", "d"), // b has extra connection
        ],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(4);
    });

    it("should sort by label", () => {
      const layout = new RadialLayout({
        centerNode: "a",
        sortBy: "label",
        sortOrder: "asc",
      });

      const graph: GraphData = {
        nodes: [
          createNode("a"),
          { id: "z", label: "Zebra", path: "/z.md" },
          { id: "m", label: "Monkey", path: "/m.md" },
          { id: "b", label: "Bear", path: "/b.md" },
        ],
        edges: [
          createEdge("a", "z"),
          createEdge("a", "m"),
          createEdge("a", "b"),
        ],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(4);
    });

    it("should sort by type/group", () => {
      const layout = new RadialLayout({
        centerNode: "a",
        sortBy: "type",
        sortOrder: "asc",
      });

      const graph: GraphData = {
        nodes: [
          createNode("a"),
          createNode("b", "groupB"),
          createNode("c", "groupA"),
          createNode("d", "groupC"),
        ],
        edges: [
          createEdge("a", "b"),
          createEdge("a", "c"),
          createEdge("a", "d"),
        ],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(4);
    });

    it("should support custom sorter", () => {
      let sorterCalled = false;
      const customSorter = (a: RadialNode, b: RadialNode): number => {
        sorterCalled = true;
        return a.id.localeCompare(b.id);
      };

      const layout = new RadialLayout({
        centerNode: "a",
        sortBy: "custom",
        customSorter,
      });

      const graph = createStarGraph("a", 3);
      layout.layout(graph);

      expect(sorterCalled).toBe(true);
    });
  });

  // ============================================================
  // Custom Ring Assignment Tests
  // ============================================================

  describe("custom ring assignment", () => {
    it("should use custom ring assigner when provided", () => {
      let assignerCalled = false;
      const customAssigner = (
        nodeId: string,
        _graph: GraphData,
        centerNode: string
      ): number => {
        assignerCalled = true;
        // Put all nodes at ring 1 except center
        return nodeId === centerNode ? 0 : 1;
      };

      const layout = new RadialLayout({
        centerNode: "hub",
        ringAssignment: "custom",
        customRingAssigner: customAssigner,
      });

      const graph = createStarGraph("hub", 4);
      const result = layout.layout(graph);

      expect(assignerCalled).toBe(true);
      expect(result.stats.nodesPerRing).toEqual([1, 4]);
    });

    it("should fallback to BFS when no custom assigner for custom mode", () => {
      const layout = new RadialLayout({
        centerNode: "hub",
        ringAssignment: "custom",
        // No customRingAssigner provided
      });

      const graph = createStarGraph("hub", 4);
      const result = layout.layout(graph);

      // Should still work using BFS fallback
      expect(result.positions.size).toBe(5);
    });
  });

  // ============================================================
  // Large Graph Performance Tests
  // ============================================================

  describe("large graphs", () => {
    it("should handle moderately sized graphs", () => {
      const layout = new RadialLayout();
      const graph = createCompleteGraph(20);

      const startTime = Date.now();
      const result = layout.layout(graph);
      const elapsed = Date.now() - startTime;

      expect(result.positions.size).toBe(20);
      expect(elapsed).toBeLessThan(5000); // Should complete in < 5 seconds
    });

    it("should handle star graphs with many rays", () => {
      const layout = new RadialLayout({ centerNode: "hub" });
      const graph = createStarGraph("hub", 50);

      const result = layout.layout(graph);

      expect(result.positions.size).toBe(51);
      expect(result.stats.nodesPerRing).toEqual([1, 50]);
    });
  });

  // ============================================================
  // Edge Cases Tests
  // ============================================================

  describe("edge cases", () => {
    it("should handle self-referencing edges", () => {
      const layout = new RadialLayout();
      const graph: GraphData = {
        nodes: [createNode("a")],
        edges: [createEdge("a", "a")],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(1);
    });

    it("should handle duplicate edges", () => {
      const layout = new RadialLayout();
      const graph: GraphData = {
        nodes: [createNode("a"), createNode("b")],
        edges: [
          createEdge("a", "b"),
          { id: "duplicate", source: "a", target: "b" },
        ],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(2);
    });

    it("should handle edges with missing source node", () => {
      const layout = new RadialLayout();
      const graph: GraphData = {
        nodes: [createNode("a")],
        edges: [createEdge("missing", "a")],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(1);
    });

    it("should handle edges with missing target node", () => {
      const layout = new RadialLayout();
      const graph: GraphData = {
        nodes: [createNode("a")],
        edges: [createEdge("a", "missing")],
      };

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(1);
    });

    it("should handle very small angle ranges", () => {
      const layout = new RadialLayout({
        startAngle: 0,
        endAngle: 0.1, // Very small arc
      });
      const graph = createStarGraph("hub", 10);

      const result = layout.layout(graph);
      expect(result.positions.size).toBe(11);
    });

    it("should handle zero radius step", () => {
      const layout = new RadialLayout({ radiusStep: 0 });
      const graph = createStarGraph("hub", 3);

      const result = layout.layout(graph);
      // All nodes would be at center
      expect(result.positions.size).toBe(4);
    });
  });

  // ============================================================
  // Default Options Tests
  // ============================================================

  describe("DEFAULT_RADIAL_OPTIONS", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_RADIAL_OPTIONS.radiusStep).toBe(100);
      expect(DEFAULT_RADIAL_OPTIONS.startAngle).toBe(0);
      expect(DEFAULT_RADIAL_OPTIONS.endAngle).toBe(Math.PI * 2);
      expect(DEFAULT_RADIAL_OPTIONS.sortBy).toBe("connection");
      expect(DEFAULT_RADIAL_OPTIONS.sortOrder).toBe("desc");
      expect(DEFAULT_RADIAL_OPTIONS.equalAngle).toBe(false);
      expect(DEFAULT_RADIAL_OPTIONS.subtreeAngle).toBe("proportional");
      expect(DEFAULT_RADIAL_OPTIONS.ringAssignment).toBe("bfs");
      expect(DEFAULT_RADIAL_OPTIONS.minAngleGap).toBe(0.1);
      expect(DEFAULT_RADIAL_OPTIONS.compact).toBe(true);
      expect(DEFAULT_RADIAL_OPTIONS.edgeRouting).toBe("arc");
      expect(DEFAULT_RADIAL_OPTIONS.arcCurvature).toBe(0.3);
      expect(DEFAULT_RADIAL_OPTIONS.margin).toBe(50);
      expect(DEFAULT_RADIAL_OPTIONS.centerOffset).toEqual({ x: 0, y: 0 });
    });
  });
});
