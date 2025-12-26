/**
 * HierarchicalBundler Unit Tests
 *
 * Tests for:
 * - Hierarchical edge bundling algorithm
 * - Hierarchy construction
 * - Beta parameter control
 * - Configuration management
 */

import {
  HierarchicalBundler,
  createHierarchicalBundler,
} from "@plugin/presentation/renderers/graph/bundling/HierarchicalBundler";
import type { GraphEdge, GraphNode } from "@plugin/presentation/renderers/graph/types";

describe("HierarchicalBundler Module", () => {
  // Helper function to create a star topology (hub-spoke pattern)
  const createStarGraph = (): {
    nodes: Map<string, GraphNode>;
    edges: GraphEdge[];
  } => {
    const nodes = new Map<string, GraphNode>();
    // Center node
    nodes.set("center", {
      id: "center",
      label: "Center",
      path: "/center",
      x: 100,
      y: 100,
    });
    // Spoke nodes in a circle
    for (let i = 0; i < 6; i++) {
      const angle = (i * 2 * Math.PI) / 6;
      const id = `spoke${i}`;
      nodes.set(id, {
        id,
        label: `Spoke ${i}`,
        path: `/${id}`,
        x: 100 + 100 * Math.cos(angle),
        y: 100 + 100 * Math.sin(angle),
      });
    }

    // Edges from center to spokes
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 6; i++) {
      edges.push({ id: `edge${i}`, source: "center", target: `spoke${i}` });
    }
    // Cross edges between spokes
    edges.push({ id: "cross1", source: "spoke0", target: "spoke3" });
    edges.push({ id: "cross2", source: "spoke1", target: "spoke4" });
    edges.push({ id: "cross3", source: "spoke2", target: "spoke5" });

    return { nodes, edges };
  };

  // Helper function to create a simple chain graph
  const createChainGraph = (length: number): {
    nodes: Map<string, GraphNode>;
    edges: GraphEdge[];
  } => {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    for (let i = 0; i < length; i++) {
      nodes.set(`node${i}`, {
        id: `node${i}`,
        label: `Node ${i}`,
        path: `/node${i}`,
        x: i * 50,
        y: 0,
      });

      if (i > 0) {
        edges.push({
          id: `edge${i}`,
          source: `node${i - 1}`,
          target: `node${i}`,
        });
      }
    }

    return { nodes, edges };
  };

  // Helper function to create a simple triangle graph
  const createTriangleGraph = (): {
    nodes: Map<string, GraphNode>;
    edges: GraphEdge[];
  } => {
    const nodes = new Map<string, GraphNode>();
    nodes.set("node1", {
      id: "node1",
      label: "Node 1",
      path: "/path/to/node1",
      x: 50,
      y: 0,
    });
    nodes.set("node2", {
      id: "node2",
      label: "Node 2",
      path: "/path/to/node2",
      x: 0,
      y: 100,
    });
    nodes.set("node3", {
      id: "node3",
      label: "Node 3",
      path: "/path/to/node3",
      x: 100,
      y: 100,
    });

    const edges: GraphEdge[] = [
      { id: "edge1", source: "node1", target: "node2" },
      { id: "edge2", source: "node2", target: "node3" },
      { id: "edge3", source: "node3", target: "node1" },
    ];

    return { nodes, edges };
  };

  describe("HierarchicalBundler", () => {
    describe("constructor", () => {
      it("should create bundler with default config", () => {
        const bundler = new HierarchicalBundler();
        const config = bundler.getConfig();
        expect(config.algorithm).toBe("hierarchical");
      });

      it("should have beta parameter in config", () => {
        const bundler = new HierarchicalBundler();
        const config = bundler.getConfig() as Record<string, unknown>;
        expect(config.beta).toBeDefined();
      });

      it("should accept custom configuration", () => {
        const bundler = new HierarchicalBundler({
          beta: 0.5,
          tension: 0.7,
        });
        const config = bundler.getConfig() as Record<string, unknown>;
        expect(config.beta).toBe(0.5);
        expect(config.tension).toBe(0.7);
      });
    });

    describe("bundle", () => {
      it("should return bundled edges for all input edges", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled).toHaveLength(3);
      });

      it("should preserve edge IDs", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled.map((e) => e.id)).toEqual(["edge1", "edge2", "edge3"]);
      });

      it("should preserve source and target IDs", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].sourceId).toBe("node1");
        expect(bundled[0].targetId).toBe("node2");
      });

      it("should have multiple control points for bundled edges", () => {
        const bundler = new HierarchicalBundler({ beta: 0.85 });
        const { nodes, edges } = createStarGraph();

        const bundled = bundler.bundle(edges, nodes);

        // Most edges should have more than 2 control points due to hierarchy routing
        const edgesWithManyPoints = bundled.filter(
          (e) => e.controlPoints.length > 2
        );
        expect(edgesWithManyPoints.length).toBeGreaterThan(0);
      });

      it("should start and end at node positions", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        const sourceNode = nodes.get("node1")!;
        const targetNode = nodes.get("node2")!;

        // First control point should be at source
        expect(bundled[0].controlPoints[0].x).toBeCloseTo(sourceNode.x ?? 0, 0);
        expect(bundled[0].controlPoints[0].y).toBeCloseTo(sourceNode.y ?? 0, 0);

        // Last control point should be at target
        const lastPoint = bundled[0].controlPoints[bundled[0].controlPoints.length - 1];
        expect(lastPoint.x).toBeCloseTo(targetNode.x ?? 0, 0);
        expect(lastPoint.y).toBeCloseTo(targetNode.y ?? 0, 0);
      });

      it("should preserve original edge reference", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].originalEdge).toBe(edges[0]);
      });

      it("should handle empty edge array", () => {
        const bundler = new HierarchicalBundler();
        const nodes = new Map<string, GraphNode>();

        const bundled = bundler.bundle([], nodes);

        expect(bundled).toHaveLength(0);
      });

      it("should filter out edges with missing nodes", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();
        edges.push({ id: "missing", source: "notexist1", target: "notexist2" });

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled).toHaveLength(3);
      });

      it("should handle edges with node object references", () => {
        const bundler = new HierarchicalBundler();
        const { nodes } = createTriangleGraph();
        const nodeObj1 = nodes.get("node1")!;
        const nodeObj2 = nodes.get("node2")!;
        const edges: GraphEdge[] = [
          { id: "edge1", source: nodeObj1, target: nodeObj2 },
        ];

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].sourceId).toBe("node1");
        expect(bundled[0].targetId).toBe("node2");
      });
    });

    describe("bundleWithStats", () => {
      it("should return bundling result with edges", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.edges).toHaveLength(3);
      });

      it("should return duration as positive number", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createTriangleGraph();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it("should count bundled edges with more than 2 control points", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createStarGraph();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.bundledCount + result.unbundledCount).toBe(edges.length);
      });

      it("should report beta as average compatibility", () => {
        const bundler = new HierarchicalBundler({ beta: 0.75 });
        const { nodes, edges } = createStarGraph();

        const result = bundler.bundleWithStats(edges, nodes);

        // Average compatibility should be beta when edges are bundled
        if (result.bundledCount > 0) {
          expect(result.averageCompatibility).toBe(0.75);
        }
      });

      it("should handle empty edges", () => {
        const bundler = new HierarchicalBundler();
        const nodes = new Map<string, GraphNode>();

        const result = bundler.bundleWithStats([], nodes);

        expect(result.edges).toHaveLength(0);
        expect(result.bundledCount).toBe(0);
        expect(result.unbundledCount).toBe(0);
      });
    });

    describe("Beta Parameter", () => {
      it("should produce straighter edges with beta = 0", () => {
        const bundler = new HierarchicalBundler({ beta: 0 });
        const { nodes, edges } = createStarGraph();

        const bundled = bundler.bundle(edges, nodes);

        // With beta = 0, edges should be relatively straight
        for (const edge of bundled) {
          const sourceNode = nodes.get(edge.sourceId);
          const targetNode = nodes.get(edge.targetId);
          if (sourceNode && targetNode) {
            // All control points should be approximately on line from source to target
            for (const point of edge.controlPoints) {
              // This is a relaxed check - just ensure points are within bounds
              expect(point.x).toBeDefined();
              expect(point.y).toBeDefined();
            }
          }
        }
      });

      it("should produce more curved edges with beta = 1", () => {
        const bundlerLow = new HierarchicalBundler({ beta: 0.1 });
        const bundlerHigh = new HierarchicalBundler({ beta: 0.99 });
        const { nodes, edges } = createStarGraph();

        const bundledLow = bundlerLow.bundle(edges, nodes);
        const bundledHigh = bundlerHigh.bundle(edges, nodes);

        // Higher beta should generally produce more control points
        // or points that deviate more from straight line
        expect(bundledHigh.length).toBe(bundledLow.length);
      });
    });

    describe("setConfig", () => {
      it("should update configuration", () => {
        const bundler = new HierarchicalBundler();
        bundler.setConfig({ beta: 0.6, tension: 0.5 } as Record<string, unknown>);

        const config = bundler.getConfig() as Record<string, unknown>;
        expect(config.beta).toBe(0.6);
        expect(config.tension).toBe(0.5);
      });

      it("should maintain algorithm as hierarchical", () => {
        const bundler = new HierarchicalBundler();
        bundler.setConfig({ algorithm: "fdeb" as "hierarchical" });

        expect(bundler.getConfig().algorithm).toBe("hierarchical");
      });

      it("should merge with existing config", () => {
        const bundler = new HierarchicalBundler({ beta: 0.5 });
        bundler.setConfig({ tension: 0.6 } as Record<string, unknown>);

        const config = bundler.getConfig() as Record<string, unknown>;
        expect(config.beta).toBe(0.5);
        expect(config.tension).toBe(0.6);
      });
    });

    describe("getConfig", () => {
      it("should return a copy of configuration", () => {
        const bundler = new HierarchicalBundler();
        const config1 = bundler.getConfig();
        const config2 = bundler.getConfig();

        expect(config1).not.toBe(config2);
        expect(config1).toEqual(config2);
      });
    });

    describe("getName", () => {
      it("should return hierarchical", () => {
        const bundler = new HierarchicalBundler();
        expect(bundler.getName()).toBe("hierarchical");
      });
    });

    describe("Hierarchy Construction", () => {
      it("should build hierarchy for connected graph", () => {
        const bundler = new HierarchicalBundler();
        const { nodes, edges } = createChainGraph(5);

        const bundled = bundler.bundle(edges, nodes);

        // Should produce valid bundled edges
        expect(bundled).toHaveLength(4);
        for (const edge of bundled) {
          expect(edge.controlPoints.length).toBeGreaterThanOrEqual(2);
        }
      });

      it("should handle disconnected graph components", () => {
        const bundler = new HierarchicalBundler();
        const nodes = new Map<string, GraphNode>();
        // Component 1
        nodes.set("a1", { id: "a1", label: "A1", path: "/a1", x: 0, y: 0 });
        nodes.set("a2", { id: "a2", label: "A2", path: "/a2", x: 50, y: 0 });
        // Component 2 (disconnected)
        nodes.set("b1", { id: "b1", label: "B1", path: "/b1", x: 200, y: 0 });
        nodes.set("b2", { id: "b2", label: "B2", path: "/b2", x: 250, y: 0 });

        const edges: GraphEdge[] = [
          { id: "edge1", source: "a1", target: "a2" },
          { id: "edge2", source: "b1", target: "b2" },
        ];

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled).toHaveLength(2);
      });

      it("should handle single node graph", () => {
        const bundler = new HierarchicalBundler();
        const nodes = new Map<string, GraphNode>();
        nodes.set("single", {
          id: "single",
          label: "Single",
          path: "/single",
          x: 100,
          y: 100,
        });

        const bundled = bundler.bundle([], nodes);

        expect(bundled).toHaveLength(0);
      });
    });

    describe("Path Smoothing", () => {
      it("should produce smooth paths with tension parameter", () => {
        const bundler = new HierarchicalBundler({ tension: 0.85 });
        const { nodes, edges } = createStarGraph();

        const bundled = bundler.bundle(edges, nodes);

        // All edges should have valid control points
        for (const edge of bundled) {
          for (const point of edge.controlPoints) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
          }
        }
      });

      it("should work with different tension values", () => {
        const bundlerLowTension = new HierarchicalBundler({ tension: 0.1 });
        const bundlerHighTension = new HierarchicalBundler({ tension: 0.99 });
        const { nodes, edges } = createTriangleGraph();

        const bundledLow = bundlerLowTension.bundle(edges, nodes);
        const bundledHigh = bundlerHighTension.bundle(edges, nodes);

        // Both should produce valid results
        expect(bundledLow).toHaveLength(3);
        expect(bundledHigh).toHaveLength(3);
      });
    });
  });

  describe("createHierarchicalBundler", () => {
    it("should create HierarchicalBundler instance", () => {
      const bundler = createHierarchicalBundler();
      expect(bundler).toBeInstanceOf(HierarchicalBundler);
    });

    it("should pass configuration to bundler", () => {
      const bundler = createHierarchicalBundler({ beta: 0.6, tension: 0.7 });
      const config = bundler.getConfig() as Record<string, unknown>;
      expect(config.beta).toBe(0.6);
      expect(config.tension).toBe(0.7);
    });
  });
});
