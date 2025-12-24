/**
 * Tests for VisibilityCuller - Visibility culling for off-screen elements
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  VisibilityCuller,
  DEFAULT_VISIBILITY_CULLER_CONFIG,
  type ViewportBounds,
  type VisibilityCullerConfig,
} from "../../../../../src/presentation/renderers/graph/VisibilityCuller";
import type { GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";

describe("VisibilityCuller", () => {
  let culler: VisibilityCuller;

  beforeEach(() => {
    culler = new VisibilityCuller();
  });

  describe("initialization", () => {
    it("should create with default config", () => {
      expect(culler.size()).toBe(0);
      expect(culler.hasNodes()).toBe(false);
    });

    it("should accept custom config", () => {
      const config: VisibilityCullerConfig = {
        margin: 200,
        defaultNodeRadius: 30,
        includePartialEdges: false,
        minZoomForCulling: 0.2,
      };
      const customCuller = new VisibilityCuller(config);
      expect(customCuller.size()).toBe(0);
    });
  });

  describe("buildIndex", () => {
    it("should build index from nodes", () => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 },
        { id: "node-2", label: "Node 2", path: "/node-2", x: 100, y: 100 },
        { id: "node-3", label: "Node 3", path: "/node-3", x: -100, y: -100 },
      ];

      culler.buildIndex(nodes);

      expect(culler.size()).toBe(3);
      expect(culler.hasNodes()).toBe(true);
    });

    it("should build index with positions map", () => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1" },
        { id: "node-2", label: "Node 2", path: "/node-2" },
      ];

      const positions = new Map([
        ["node-1", { x: 50, y: 50 }],
        ["node-2", { x: 150, y: 150 }],
      ]);

      culler.buildIndex(nodes, positions);

      expect(culler.size()).toBe(2);
    });

    it("should handle empty nodes array", () => {
      culler.buildIndex([]);

      expect(culler.size()).toBe(0);
      expect(culler.hasNodes()).toBe(false);
    });

    it("should clear previous index when rebuilding", () => {
      const nodes1: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 },
      ];
      const nodes2: GraphNode[] = [
        { id: "node-a", label: "Node A", path: "/node-a", x: 0, y: 0 },
        { id: "node-b", label: "Node B", path: "/node-b", x: 100, y: 100 },
      ];

      culler.buildIndex(nodes1);
      expect(culler.size()).toBe(1);

      culler.buildIndex(nodes2);
      expect(culler.size()).toBe(2);
    });
  });

  describe("getVisibleNodes", () => {
    beforeEach(() => {
      // Create a grid of nodes from -500 to 500
      const nodes: GraphNode[] = [];
      for (let x = -500; x <= 500; x += 100) {
        for (let y = -500; y <= 500; y += 100) {
          nodes.push({
            id: `node-${x}-${y}`,
            label: `Node ${x},${y}`,
            path: `/node-${x}-${y}`,
            x,
            y,
            size: 10,
          });
        }
      }
      culler.buildIndex(nodes);
    });

    it("should return all nodes when viewport covers entire graph", () => {
      const viewport: ViewportBounds = {
        left: -600,
        top: -600,
        right: 600,
        bottom: 600,
        zoom: 1,
      };

      const visible = culler.getVisibleNodes(viewport);

      expect(visible.size).toBe(121); // 11 x 11 grid
    });

    it("should return only visible nodes in smaller viewport", () => {
      const viewport: ViewportBounds = {
        left: -50,
        top: -50,
        right: 50,
        bottom: 50,
        zoom: 1,
      };

      const visible = culler.getVisibleNodes(viewport);

      // Should include nodes at (0,0) plus margin
      // With default margin of 100px at zoom 1, expands to -150 to 150
      expect(visible.size).toBeGreaterThan(0);
      expect(visible.size).toBeLessThan(121);
      expect(visible.has("node-0-0")).toBe(true);
    });

    it("should handle viewport with zoom", () => {
      // At zoom 2, margin of 100 screen pixels = 50 world pixels
      const viewport: ViewportBounds = {
        left: -50,
        top: -50,
        right: 50,
        bottom: 50,
        zoom: 2,
      };

      const visible = culler.getVisibleNodes(viewport);

      expect(visible.has("node-0-0")).toBe(true);
    });

    it("should return all nodes at very low zoom", () => {
      const viewport: ViewportBounds = {
        left: -50,
        top: -50,
        right: 50,
        bottom: 50,
        zoom: 0.05, // Below minZoomForCulling
      };

      const visible = culler.getVisibleNodes(viewport);

      // At very low zoom, culling is disabled - returns all nodes
      expect(visible.size).toBe(121);
    });

    it("should exclude nodes outside viewport", () => {
      const viewport: ViewportBounds = {
        left: 200,
        top: 200,
        right: 400,
        bottom: 400,
        zoom: 1,
      };

      const visible = culler.getVisibleNodes(viewport);

      expect(visible.has("node-0-0")).toBe(false);
      expect(visible.has("node--100--100")).toBe(false);
      expect(visible.has("node-300-300")).toBe(true);
    });
  });

  describe("getVisibleEdges", () => {
    let nodes: GraphNode[];
    let edges: GraphEdge[];

    beforeEach(() => {
      nodes = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 },
        { id: "node-2", label: "Node 2", path: "/node-2", x: 100, y: 0 },
        { id: "node-3", label: "Node 3", path: "/node-3", x: 500, y: 500 },
      ];
      edges = [
        { id: "edge-1-2", source: "node-1", target: "node-2" },
        { id: "edge-2-3", source: "node-2", target: "node-3" },
        { id: "edge-1-3", source: "node-1", target: "node-3" },
      ];
      culler.buildIndex(nodes);
    });

    it("should include edges with both endpoints visible", () => {
      const viewport: ViewportBounds = {
        left: -50,
        top: -50,
        right: 150,
        bottom: 50,
        zoom: 1,
      };

      culler.getVisibleNodes(viewport);
      const visibleEdges = culler.getVisibleEdges(viewport, edges);

      expect(visibleEdges.has("edge-1-2")).toBe(true);
    });

    it("should include partial edges by default", () => {
      const viewport: ViewportBounds = {
        left: -50,
        top: -50,
        right: 150,
        bottom: 50,
        zoom: 1,
      };

      culler.getVisibleNodes(viewport);
      const visibleEdges = culler.getVisibleEdges(viewport, edges);

      // edge-2-3 has one endpoint visible (node-2)
      expect(visibleEdges.has("edge-2-3")).toBe(true);
    });

    it("should exclude partial edges when configured", () => {
      culler = new VisibilityCuller({ includePartialEdges: false });
      culler.buildIndex(nodes);

      const viewport: ViewportBounds = {
        left: -50,
        top: -50,
        right: 150,
        bottom: 50,
        zoom: 1,
      };

      culler.getVisibleNodes(viewport);
      const visibleEdges = culler.getVisibleEdges(viewport, edges);

      // edge-2-3 and edge-1-3 have only one endpoint visible
      expect(visibleEdges.has("edge-1-2")).toBe(true);
      expect(visibleEdges.has("edge-2-3")).toBe(false);
      expect(visibleEdges.has("edge-1-3")).toBe(false);
    });
  });

  describe("position updates", () => {
    beforeEach(() => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 },
        { id: "node-2", label: "Node 2", path: "/node-2", x: 100, y: 100 },
      ];
      culler.buildIndex(nodes);
    });

    it("should update single node position", () => {
      culler.updatePosition("node-1", { x: 500, y: 500 });

      const viewport: ViewportBounds = {
        left: 400,
        top: 400,
        right: 600,
        bottom: 600,
        zoom: 1,
      };

      const visible = culler.getVisibleNodes(viewport);
      expect(visible.has("node-1")).toBe(true);
    });

    it("should batch update positions", () => {
      culler.updatePositions([
        { nodeId: "node-1", x: 500, y: 500 },
        { nodeId: "node-2", x: 600, y: 600 },
      ]);

      const viewport: ViewportBounds = {
        left: 400,
        top: 400,
        right: 700,
        bottom: 700,
        zoom: 1,
      };

      const visible = culler.getVisibleNodes(viewport);
      expect(visible.has("node-1")).toBe(true);
      expect(visible.has("node-2")).toBe(true);
    });
  });

  describe("node management", () => {
    it("should add a node", () => {
      culler.addNode({ id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 });

      expect(culler.size()).toBe(1);
      expect(culler.hasNodes()).toBe(true);
    });

    it("should remove a node", () => {
      culler.addNode({ id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 });
      culler.addNode({ id: "node-2", label: "Node 2", path: "/node-2", x: 100, y: 100 });

      culler.removeNode("node-1");

      expect(culler.size()).toBe(1);
    });

    it("should handle removing non-existent node", () => {
      culler.addNode({ id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 });

      culler.removeNode("non-existent");

      expect(culler.size()).toBe(1);
    });
  });

  describe("visibility queries", () => {
    beforeEach(() => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 },
        { id: "node-2", label: "Node 2", path: "/node-2", x: 500, y: 500 },
      ];
      const edges: GraphEdge[] = [
        { id: "edge-1", source: "node-1", target: "node-2" },
      ];
      culler.buildIndex(nodes);

      const viewport: ViewportBounds = {
        left: -100,
        top: -100,
        right: 100,
        bottom: 100,
        zoom: 1,
      };
      culler.getVisibleNodes(viewport);
      culler.getVisibleEdges(viewport, edges);
    });

    it("should check if node is visible", () => {
      expect(culler.isNodeVisible("node-1")).toBe(true);
      expect(culler.isNodeVisible("node-2")).toBe(false);
    });

    it("should check if edge is visible", () => {
      expect(culler.isEdgeVisible("edge-1")).toBe(true); // Partial edge
    });

    it("should get visible node IDs", () => {
      const ids = culler.getVisibleNodeIds();
      expect(ids.has("node-1")).toBe(true);
      expect(ids.has("node-2")).toBe(false);
    });

    it("should get visible edge IDs", () => {
      const ids = culler.getVisibleEdgeIds();
      expect(ids.has("edge-1")).toBe(true);
    });
  });

  describe("statistics", () => {
    it("should track stats", () => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 },
        { id: "node-2", label: "Node 2", path: "/node-2", x: 500, y: 500 },
      ];
      culler.buildIndex(nodes);

      const viewport: ViewportBounds = {
        left: -100,
        top: -100,
        right: 100,
        bottom: 100,
        zoom: 1,
      };
      culler.getVisibleNodes(viewport);

      const stats = culler.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.visibleNodes).toBe(1);
      expect(stats.efficiency).toBeCloseTo(0.5, 1);
      expect(stats.lastQueryDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("graph bounds", () => {
    it("should return null for empty graph", () => {
      expect(culler.getGraphBounds()).toBeNull();
    });

    it("should return bounds for populated graph", () => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: -100, y: -50 },
        { id: "node-2", label: "Node 2", path: "/node-2", x: 200, y: 150 },
      ];
      culler.buildIndex(nodes);

      const bounds = culler.getGraphBounds();
      expect(bounds).not.toBeNull();
      expect(bounds!.minX).toBeLessThan(-100);
      expect(bounds!.maxX).toBeGreaterThan(200);
      expect(bounds!.minY).toBeLessThan(-50);
      expect(bounds!.maxY).toBeGreaterThan(150);
    });
  });

  describe("clear", () => {
    it("should clear all data", () => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1", x: 0, y: 0 },
      ];
      culler.buildIndex(nodes);

      culler.clear();

      expect(culler.size()).toBe(0);
      expect(culler.hasNodes()).toBe(false);
      expect(culler.getGraphBounds()).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle nodes with undefined positions", () => {
      const nodes: GraphNode[] = [
        { id: "node-1", label: "Node 1", path: "/node-1" },
      ];
      culler.buildIndex(nodes);

      expect(culler.size()).toBe(1);

      const viewport: ViewportBounds = {
        left: -100,
        top: -100,
        right: 100,
        bottom: 100,
        zoom: 1,
      };
      const visible = culler.getVisibleNodes(viewport);
      expect(visible.has("node-1")).toBe(true); // At origin (0,0)
    });

    it("should handle large number of nodes", () => {
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 1000; i++) {
        nodes.push({
          id: `node-${i}`,
          label: `Node ${i}`,
          path: `/node-${i}`,
          x: Math.random() * 10000 - 5000,
          y: Math.random() * 10000 - 5000,
        });
      }
      culler.buildIndex(nodes);

      expect(culler.size()).toBe(1000);

      const viewport: ViewportBounds = {
        left: -500,
        top: -500,
        right: 500,
        bottom: 500,
        zoom: 1,
      };
      const visible = culler.getVisibleNodes(viewport);

      expect(visible.size).toBeLessThan(1000);
    });
  });
});

describe("DEFAULT_VISIBILITY_CULLER_CONFIG", () => {
  it("should have expected default values", () => {
    expect(DEFAULT_VISIBILITY_CULLER_CONFIG.margin).toBe(100);
    expect(DEFAULT_VISIBILITY_CULLER_CONFIG.defaultNodeRadius).toBe(20);
    expect(DEFAULT_VISIBILITY_CULLER_CONFIG.includePartialEdges).toBe(true);
    expect(DEFAULT_VISIBILITY_CULLER_CONFIG.minZoomForCulling).toBe(0.1);
  });
});
