/**
 * Tests for HierarchicalLayout
 *
 * @module tests/unit/presentation/renderers/graph
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  HierarchicalLayout,
  createHierarchicalLayout,
  DEFAULT_HIERARCHICAL_OPTIONS,
  HIERARCHICAL_PRESETS,
  type HierarchicalLayoutOptions,
  type HierarchicalLayoutResult,
  type LayoutDirection,
} from "../../../../../src/presentation/renderers/graph/HierarchicalLayout";
import type { GraphData, GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";

describe("HierarchicalLayout", () => {
  // ============================================================
  // Test Data Helpers
  // ============================================================

  function createNode(id: string): GraphNode {
    return {
      id,
      label: `Node ${id}`,
      path: `/path/to/${id}.md`,
    };
  }

  function createEdge(source: string, target: string): GraphEdge {
    return {
      id: `${source}-${target}`,
      source,
      target,
    };
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

  function createDAG(): GraphData {
    // A DAG with diamond pattern: a -> [b, c], b -> d, c -> d
    return {
      nodes: [
        createNode("a"),
        createNode("b"),
        createNode("c"),
        createNode("d"),
      ],
      edges: [
        createEdge("a", "b"),
        createEdge("a", "c"),
        createEdge("b", "d"),
        createEdge("c", "d"),
      ],
    };
  }

  function createGraphWithCycle(): GraphData {
    // A graph with cycle: a -> b -> c -> a
    return {
      nodes: [createNode("a"), createNode("b"), createNode("c")],
      edges: [
        createEdge("a", "b"),
        createEdge("b", "c"),
        createEdge("c", "a"),
      ],
    };
  }

  function createLongChain(length: number): GraphData {
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

  // ============================================================
  // Constructor Tests
  // ============================================================

  describe("constructor", () => {
    it("should create layout with default options", () => {
      const layout = new HierarchicalLayout();
      const options = layout.getOptions();

      expect(options.direction).toBe("TB");
      expect(options.levelSeparation).toBe(100);
      expect(options.nodeSeparation).toBe(50);
      expect(options.rankingAlgorithm).toBe("longest-path");
      expect(options.crossingMinimization).toBe("barycenter");
    });

    it("should merge custom options with defaults", () => {
      const layout = new HierarchicalLayout({
        direction: "LR",
        levelSeparation: 150,
      });
      const options = layout.getOptions();

      expect(options.direction).toBe("LR");
      expect(options.levelSeparation).toBe(150);
      expect(options.nodeSeparation).toBe(50); // default
    });

    it("should accept all options", () => {
      const customOptions: HierarchicalLayoutOptions = {
        direction: "BT",
        levelSeparation: 80,
        nodeSeparation: 40,
        subtreeSeparation: 60,
        rankingAlgorithm: "network-simplex",
        crossingMinimization: "median",
        coordinateAssignment: "simple",
        crossingIterations: 48,
        alignToGrid: true,
        gridSize: 20,
        compact: false,
        margin: 100,
      };

      const layout = new HierarchicalLayout(customOptions);
      const options = layout.getOptions();

      expect(options).toEqual(customOptions);
    });
  });

  // ============================================================
  // Empty Graph Tests
  // ============================================================

  describe("empty graph", () => {
    it("should handle empty graph", () => {
      const layout = new HierarchicalLayout();
      const result = layout.layout({ nodes: [], edges: [] });

      expect(result.positions.size).toBe(0);
      expect(result.edges).toHaveLength(0);
      expect(result.bounds.width).toBe(0);
      expect(result.bounds.height).toBe(0);
      expect(result.stats.crossings).toBe(0);
    });

    it("should handle single node", () => {
      const layout = new HierarchicalLayout();
      const result = layout.layout({
        nodes: [createNode("a")],
        edges: [],
      });

      expect(result.positions.size).toBe(1);
      expect(result.positions.has("a")).toBe(true);
    });
  });

  // ============================================================
  // Simple Tree Tests
  // ============================================================

  describe("simple tree", () => {
    let layout: HierarchicalLayout;
    let tree: GraphData;
    let result: HierarchicalLayoutResult;

    beforeEach(() => {
      layout = new HierarchicalLayout();
      tree = createSimpleTree();
      result = layout.layout(tree);
    });

    it("should assign positions to all nodes", () => {
      expect(result.positions.size).toBe(6);
      for (const node of tree.nodes) {
        expect(result.positions.has(node.id)).toBe(true);
      }
    });

    it("should place root at top (TB direction)", () => {
      const rootPos = result.positions.get("root")!;
      const aPos = result.positions.get("a")!;
      const bPos = result.positions.get("b")!;

      // Root should be above children
      expect(rootPos.y).toBeLessThan(aPos.y);
      expect(rootPos.y).toBeLessThan(bPos.y);
    });

    it("should maintain level ordering", () => {
      const rootY = result.positions.get("root")!.y;
      const aY = result.positions.get("a")!.y;
      const bY = result.positions.get("b")!.y;
      const cY = result.positions.get("c")!.y;
      const dY = result.positions.get("d")!.y;
      const eY = result.positions.get("e")!.y;

      // Level 0: root
      // Level 1: a, b
      // Level 2: c, d, e
      expect(aY).toBeGreaterThan(rootY);
      expect(bY).toBeGreaterThan(rootY);
      expect(cY).toBeGreaterThan(aY);
      expect(dY).toBeGreaterThan(aY);
      expect(eY).toBeGreaterThan(bY);
    });

    it("should have minimal crossings for tree", () => {
      expect(result.stats.crossings).toBe(0);
    });

    it("should route edges", () => {
      expect(result.edges.length).toBeGreaterThan(0);
      for (const edge of result.edges) {
        expect(edge.controlPoints).toBeDefined();
        expect(edge.controlPoints!.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ============================================================
  // DAG Tests
  // ============================================================

  describe("DAG layout", () => {
    it("should handle diamond pattern", () => {
      const layout = new HierarchicalLayout();
      const dag = createDAG();
      const result = layout.layout(dag);

      expect(result.positions.size).toBe(4);

      const aPos = result.positions.get("a")!;
      const bPos = result.positions.get("b")!;
      const cPos = result.positions.get("c")!;
      const dPos = result.positions.get("d")!;

      // a should be at top
      expect(aPos.y).toBeLessThan(bPos.y);
      expect(aPos.y).toBeLessThan(cPos.y);

      // b and c at same level
      expect(bPos.y).toBe(cPos.y);

      // d at bottom
      expect(dPos.y).toBeGreaterThan(bPos.y);
      expect(dPos.y).toBeGreaterThan(cPos.y);
    });

    it("should minimize crossings in DAG", () => {
      const layout = new HierarchicalLayout({
        crossingIterations: 48,
      });
      const dag = createDAG();
      const result = layout.layout(dag);

      // Diamond pattern should have 0 crossings with proper ordering
      expect(result.stats.crossings).toBe(0);
    });
  });

  // ============================================================
  // Cycle Handling Tests
  // ============================================================

  describe("cycle handling", () => {
    it("should handle graph with cycle", () => {
      const layout = new HierarchicalLayout();
      const graph = createGraphWithCycle();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(3);
      expect(result.stats.reversedEdges).toBeGreaterThan(0);
    });

    it("should make graph acyclic", () => {
      const layout = new HierarchicalLayout();
      const graph = createGraphWithCycle();
      const result = layout.layout(graph);

      // All nodes should have valid positions
      for (const pos of result.positions.values()) {
        expect(typeof pos.x).toBe("number");
        expect(typeof pos.y).toBe("number");
        expect(isFinite(pos.x)).toBe(true);
        expect(isFinite(pos.y)).toBe(true);
      }
    });
  });

  // ============================================================
  // Long Edge Tests
  // ============================================================

  describe("long edges", () => {
    it("should insert dummy nodes for long edges", () => {
      // Create a graph where one edge spans multiple levels
      const graph: GraphData = {
        nodes: [createNode("a"), createNode("b"), createNode("c")],
        edges: [
          createEdge("a", "b"),
          createEdge("b", "c"),
          createEdge("a", "c"), // This spans 2 levels
        ],
      };

      const layout = new HierarchicalLayout();
      const result = layout.layout(graph);

      // The edge a->c should have control points through dummy nodes
      const acEdge = result.edges.find(
        (e) => e.source === "a" && e.target === "c"
      );
      if (acEdge && acEdge.dummyNodes.length > 0) {
        expect(acEdge.controlPoints!.length).toBeGreaterThan(2);
      }
    });

    it("should handle very long chain", () => {
      const layout = new HierarchicalLayout();
      const chain = createLongChain(10);
      const result = layout.layout(chain);

      expect(result.positions.size).toBe(10);

      // Verify ordering
      for (let i = 1; i < 10; i++) {
        const prevY = result.positions.get(`n${i - 1}`)!.y;
        const currY = result.positions.get(`n${i}`)!.y;
        expect(currY).toBeGreaterThan(prevY);
      }
    });
  });

  // ============================================================
  // Direction Tests
  // ============================================================

  describe("layout direction", () => {
    const directions: LayoutDirection[] = ["TB", "BT", "LR", "RL"];
    const tree = createSimpleTree();

    it.each(directions)("should support %s direction", (direction) => {
      const layout = new HierarchicalLayout({ direction });
      const result = layout.layout(tree);

      expect(result.positions.size).toBe(6);

      const rootPos = result.positions.get("root")!;
      const aPos = result.positions.get("a")!;

      if (direction === "TB") {
        expect(rootPos.y).toBeLessThan(aPos.y);
      } else if (direction === "BT") {
        expect(rootPos.y).toBeGreaterThan(aPos.y);
      } else if (direction === "LR") {
        expect(rootPos.x).toBeLessThan(aPos.x);
      } else if (direction === "RL") {
        expect(rootPos.x).toBeGreaterThan(aPos.x);
      }
    });
  });

  // ============================================================
  // Ranking Algorithm Tests
  // ============================================================

  describe("ranking algorithms", () => {
    const tree = createSimpleTree();

    it("should use longest-path ranking", () => {
      const layout = new HierarchicalLayout({
        rankingAlgorithm: "longest-path",
      });
      const result = layout.layout(tree);

      expect(result.positions.size).toBe(6);
    });

    it("should use tight-tree ranking", () => {
      const layout = new HierarchicalLayout({
        rankingAlgorithm: "tight-tree",
      });
      const result = layout.layout(tree);

      expect(result.positions.size).toBe(6);
    });

    it("should use network-simplex ranking", () => {
      const layout = new HierarchicalLayout({
        rankingAlgorithm: "network-simplex",
      });
      const result = layout.layout(tree);

      expect(result.positions.size).toBe(6);
    });
  });

  // ============================================================
  // Crossing Minimization Tests
  // ============================================================

  describe("crossing minimization", () => {
    it("should use barycenter algorithm", () => {
      const layout = new HierarchicalLayout({
        crossingMinimization: "barycenter",
        crossingIterations: 24,
      });
      const result = layout.layout(createDAG());

      expect(result.stats.crossings).toBe(0);
    });

    it("should use median algorithm", () => {
      const layout = new HierarchicalLayout({
        crossingMinimization: "median",
        crossingIterations: 24,
      });
      const result = layout.layout(createDAG());

      expect(result.stats.crossings).toBe(0);
    });

    it("should skip crossing minimization with none", () => {
      const layout = new HierarchicalLayout({
        crossingMinimization: "none",
      });
      const result = layout.layout(createDAG());

      expect(result.positions.size).toBe(4);
    });
  });

  // ============================================================
  // Coordinate Assignment Tests
  // ============================================================

  describe("coordinate assignment", () => {
    const tree = createSimpleTree();

    it("should use simple assignment", () => {
      const layout = new HierarchicalLayout({
        coordinateAssignment: "simple",
      });
      const result = layout.layout(tree);

      expect(result.positions.size).toBe(6);
    });

    it("should use brandes-kopf assignment", () => {
      const layout = new HierarchicalLayout({
        coordinateAssignment: "brandes-kopf",
      });
      const result = layout.layout(tree);

      expect(result.positions.size).toBe(6);
    });

    it("should use tight assignment", () => {
      const layout = new HierarchicalLayout({
        coordinateAssignment: "tight",
      });
      const result = layout.layout(tree);

      expect(result.positions.size).toBe(6);
    });

    it("should respect level separation", () => {
      const levelSeparation = 150;
      const layout = new HierarchicalLayout({ levelSeparation });
      const result = layout.layout(tree);

      const rootY = result.positions.get("root")!.y;
      const aY = result.positions.get("a")!.y;

      expect(Math.abs(aY - rootY - levelSeparation)).toBeLessThan(1);
    });

    it("should respect node separation", () => {
      const nodeSeparation = 80;
      const layout = new HierarchicalLayout({ nodeSeparation });
      const result = layout.layout(tree);

      const aX = result.positions.get("a")!.x;
      const bX = result.positions.get("b")!.x;

      // Minimum separation should be nodeSeparation
      expect(Math.abs(bX - aX)).toBeGreaterThanOrEqual(nodeSeparation - 1);
    });
  });

  // ============================================================
  // Grid Alignment Tests
  // ============================================================

  describe("grid alignment", () => {
    it("should align to grid when enabled", () => {
      const gridSize = 20;
      const layout = new HierarchicalLayout({
        alignToGrid: true,
        gridSize,
      });
      const result = layout.layout(createSimpleTree());

      for (const pos of result.positions.values()) {
        expect(pos.x % gridSize).toBe(0);
        expect(pos.y % gridSize).toBe(0);
      }
    });

    it("should not align to grid when disabled", () => {
      const layout = new HierarchicalLayout({
        alignToGrid: false,
      });
      const result = layout.layout(createSimpleTree());

      // At least some positions might not be grid-aligned
      expect(result.positions.size).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Margin Tests
  // ============================================================

  describe("margin", () => {
    it("should apply margin", () => {
      const margin = 100;
      const layout = new HierarchicalLayout({ margin });
      const result = layout.layout(createSimpleTree());

      expect(result.bounds.minX).toBeGreaterThanOrEqual(margin);
      expect(result.bounds.minY).toBeGreaterThanOrEqual(margin);
    });
  });

  // ============================================================
  // Disconnected Graph Tests
  // ============================================================

  describe("disconnected graph", () => {
    it("should handle disconnected components", () => {
      const layout = new HierarchicalLayout();
      const graph = createDisconnectedGraph();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(5);

      // All nodes should have valid positions
      for (const pos of result.positions.values()) {
        expect(isFinite(pos.x)).toBe(true);
        expect(isFinite(pos.y)).toBe(true);
      }
    });
  });

  // ============================================================
  // Edge Routing Tests
  // ============================================================

  describe("edge routing", () => {
    it("should add control points to edges", () => {
      const layout = new HierarchicalLayout();
      const result = layout.layout(createSimpleTree());

      for (const edge of result.edges) {
        expect(edge.controlPoints).toBeDefined();
        expect(edge.controlPoints!.length).toBeGreaterThanOrEqual(2);

        // First point should match source
        // Last point should match target
        const sourcePos = result.positions.get(edge.source as string);
        const targetPos = result.positions.get(edge.target as string);

        if (sourcePos && !edge.dummyNodes.length) {
          const first = edge.controlPoints![0];
          expect(first.x).toBe(sourcePos.x);
          expect(first.y).toBe(sourcePos.y);
        }

        if (targetPos && !edge.dummyNodes.length) {
          const last = edge.controlPoints![edge.controlPoints!.length - 1];
          expect(last.x).toBe(targetPos.x);
          expect(last.y).toBe(targetPos.y);
        }
      }
    });
  });

  // ============================================================
  // Bounds Tests
  // ============================================================

  describe("bounds calculation", () => {
    it("should calculate correct bounds", () => {
      const layout = new HierarchicalLayout({ margin: 50 });
      const result = layout.layout(createSimpleTree());

      // Check bounds consistency
      expect(result.bounds.width).toBe(result.bounds.maxX - result.bounds.minX);
      expect(result.bounds.height).toBe(result.bounds.maxY - result.bounds.minY);

      // All positions should be within bounds
      for (const pos of result.positions.values()) {
        expect(pos.x).toBeGreaterThanOrEqual(result.bounds.minX);
        expect(pos.x).toBeLessThanOrEqual(result.bounds.maxX);
        expect(pos.y).toBeGreaterThanOrEqual(result.bounds.minY);
        expect(pos.y).toBeLessThanOrEqual(result.bounds.maxY);
      }
    });
  });

  // ============================================================
  // Configuration Methods Tests
  // ============================================================

  describe("configuration methods", () => {
    it("should get and set direction", () => {
      const layout = new HierarchicalLayout();

      expect(layout.direction()).toBe("TB");

      layout.direction("LR");
      expect(layout.direction()).toBe("LR");
    });

    it("should get and set levelSeparation", () => {
      const layout = new HierarchicalLayout();

      expect(layout.levelSeparation()).toBe(100);

      layout.levelSeparation(200);
      expect(layout.levelSeparation()).toBe(200);
    });

    it("should get and set nodeSeparation", () => {
      const layout = new HierarchicalLayout();

      expect(layout.nodeSeparation()).toBe(50);

      layout.nodeSeparation(100);
      expect(layout.nodeSeparation()).toBe(100);
    });

    it("should get and set rankingAlgorithm", () => {
      const layout = new HierarchicalLayout();

      expect(layout.rankingAlgorithm()).toBe("longest-path");

      layout.rankingAlgorithm("tight-tree");
      expect(layout.rankingAlgorithm()).toBe("tight-tree");
    });

    it("should get and set crossingMinimization", () => {
      const layout = new HierarchicalLayout();

      expect(layout.crossingMinimization()).toBe("barycenter");

      layout.crossingMinimization("median");
      expect(layout.crossingMinimization()).toBe("median");
    });

    it("should chain configuration methods", () => {
      const layout = new HierarchicalLayout()
        .direction("LR")
        .levelSeparation(150)
        .nodeSeparation(75);

      expect(layout.direction()).toBe("LR");
      expect(layout.levelSeparation()).toBe(150);
      expect(layout.nodeSeparation()).toBe(75);
    });

    it("should update options with setOptions", () => {
      const layout = new HierarchicalLayout();

      layout.setOptions({
        direction: "BT",
        compact: false,
      });

      const options = layout.getOptions();
      expect(options.direction).toBe("BT");
      expect(options.compact).toBe(false);
    });
  });

  // ============================================================
  // Factory Function Tests
  // ============================================================

  describe("createHierarchicalLayout", () => {
    it("should create layout with default preset", () => {
      const layout = createHierarchicalLayout();
      expect(layout.direction()).toBe("TB");
      expect(layout.rankingAlgorithm()).toBe("longest-path");
    });

    it("should create layout with tree preset", () => {
      const layout = createHierarchicalLayout("tree");
      expect(layout.levelSeparation()).toBe(80);
      expect(layout.nodeSeparation()).toBe(40);
    });

    it("should create layout with dag preset", () => {
      const layout = createHierarchicalLayout("dag");
      expect(layout.rankingAlgorithm()).toBe("network-simplex");
      expect(layout.crossingMinimization()).toBe("median");
    });

    it("should create layout with compact preset", () => {
      const layout = createHierarchicalLayout("compact");
      expect(layout.levelSeparation()).toBe(60);
      expect(layout.nodeSeparation()).toBe(30);
    });

    it("should create layout with wide preset", () => {
      const layout = createHierarchicalLayout("wide");
      expect(layout.direction()).toBe("LR");
      expect(layout.levelSeparation()).toBe(150);
    });

    it("should apply overrides to preset", () => {
      const layout = createHierarchicalLayout("tree", {
        levelSeparation: 200,
      });
      expect(layout.levelSeparation()).toBe(200);
      expect(layout.nodeSeparation()).toBe(40); // from preset
    });
  });

  // ============================================================
  // Preset Tests
  // ============================================================

  describe("presets", () => {
    it("should have all expected presets", () => {
      expect(HIERARCHICAL_PRESETS).toHaveProperty("default");
      expect(HIERARCHICAL_PRESETS).toHaveProperty("tree");
      expect(HIERARCHICAL_PRESETS).toHaveProperty("dag");
      expect(HIERARCHICAL_PRESETS).toHaveProperty("compact");
      expect(HIERARCHICAL_PRESETS).toHaveProperty("wide");
    });

    it("should have valid default preset", () => {
      const preset = HIERARCHICAL_PRESETS.default;
      expect(preset.direction).toBe("TB");
      expect(preset.levelSeparation).toBe(100);
    });
  });

  // ============================================================
  // Default Options Tests
  // ============================================================

  describe("DEFAULT_HIERARCHICAL_OPTIONS", () => {
    it("should have all required options", () => {
      expect(DEFAULT_HIERARCHICAL_OPTIONS.direction).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.levelSeparation).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.nodeSeparation).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.subtreeSeparation).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.rankingAlgorithm).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.crossingMinimization).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.coordinateAssignment).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.crossingIterations).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.alignToGrid).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.gridSize).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.compact).toBeDefined();
      expect(DEFAULT_HIERARCHICAL_OPTIONS.margin).toBeDefined();
    });
  });

  // ============================================================
  // Edge Case Tests
  // ============================================================

  describe("edge cases", () => {
    it("should handle self-loop edge", () => {
      const graph: GraphData = {
        nodes: [createNode("a")],
        edges: [{ id: "self", source: "a", target: "a" }],
      };

      const layout = new HierarchicalLayout();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(1);
    });

    it("should handle edge with missing source", () => {
      const graph: GraphData = {
        nodes: [createNode("a")],
        edges: [{ id: "e1", source: "missing", target: "a" }],
      };

      const layout = new HierarchicalLayout();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(1);
    });

    it("should handle edge with missing target", () => {
      const graph: GraphData = {
        nodes: [createNode("a")],
        edges: [{ id: "e1", source: "a", target: "missing" }],
      };

      const layout = new HierarchicalLayout();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(1);
    });

    it("should handle parallel edges", () => {
      const graph: GraphData = {
        nodes: [createNode("a"), createNode("b")],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "a", target: "b" },
        ],
      };

      const layout = new HierarchicalLayout();
      const result = layout.layout(graph);

      expect(result.positions.size).toBe(2);
      expect(result.edges.length).toBe(2);
    });

    it("should handle explicit root nodes", () => {
      const layout = new HierarchicalLayout({
        rootNodes: ["c"],
      });

      const graph: GraphData = {
        nodes: [createNode("a"), createNode("b"), createNode("c")],
        edges: [
          createEdge("a", "b"),
          createEdge("c", "a"),
        ],
      };

      const result = layout.layout(graph);

      // c should be at top level
      const cY = result.positions.get("c")!.y;
      const aY = result.positions.get("a")!.y;
      expect(cY).toBeLessThan(aY);
    });
  });

  // ============================================================
  // Performance Tests
  // ============================================================

  describe("performance", () => {
    it("should handle medium-sized graph efficiently", () => {
      const n = 50;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      for (let i = 0; i < n; i++) {
        nodes.push(createNode(`n${i}`));
        if (i > 0) {
          // Random edges to create a DAG
          const parent = Math.floor(Math.random() * i);
          edges.push(createEdge(`n${parent}`, `n${i}`));
        }
      }

      const layout = new HierarchicalLayout();
      const start = performance.now();
      const result = layout.layout({ nodes, edges });
      const elapsed = performance.now() - start;

      expect(result.positions.size).toBe(n);
      expect(elapsed).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  // ============================================================
  // Stats Tests
  // ============================================================

  describe("statistics", () => {
    it("should report total edge length", () => {
      const layout = new HierarchicalLayout();
      const result = layout.layout(createSimpleTree());

      expect(result.stats.totalEdgeLength).toBeGreaterThan(0);
    });

    it("should report dummy nodes count", () => {
      // Create a graph with long edges
      const graph: GraphData = {
        nodes: [
          createNode("a"),
          createNode("b"),
          createNode("c"),
          createNode("d"),
        ],
        edges: [
          createEdge("a", "b"),
          createEdge("b", "c"),
          createEdge("c", "d"),
          createEdge("a", "d"), // This spans 3 levels
        ],
      };

      const layout = new HierarchicalLayout();
      const result = layout.layout(graph);

      // The edge a->d might have dummy nodes
      expect(typeof result.stats.dummyNodes).toBe("number");
    });

    it("should report reversed edges count", () => {
      const layout = new HierarchicalLayout();
      const graph = createGraphWithCycle();
      const result = layout.layout(graph);

      expect(result.stats.reversedEdges).toBeGreaterThan(0);
    });

    it("should report crossings count", () => {
      const layout = new HierarchicalLayout();
      const result = layout.layout(createDAG());

      expect(typeof result.stats.crossings).toBe("number");
    });
  });
});
