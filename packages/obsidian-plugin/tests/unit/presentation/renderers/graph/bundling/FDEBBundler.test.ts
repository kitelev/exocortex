/**
 * FDEBBundler Unit Tests
 *
 * Tests for:
 * - Force-directed edge bundling algorithm
 * - Edge compatibility computation
 * - Force simulation
 * - Configuration management
 */

import {
  FDEBBundler,
  createFDEBBundler,
} from "@plugin/presentation/renderers/graph/bundling/FDEBBundler";
import type { GraphEdge, GraphNode } from "@plugin/presentation/renderers/graph/types";

describe("FDEBBundler Module", () => {
  // Helper function to create test nodes in a grid pattern
  const createGridNodes = (size: number): Map<string, GraphNode> => {
    const nodes = new Map<string, GraphNode>();
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const id = `node_${i}_${j}`;
        nodes.set(id, {
          id,
          label: `Node ${i},${j}`,
          path: `/path/to/${id}`,
          x: i * 100,
          y: j * 100,
        });
      }
    }
    return nodes;
  };

  // Helper function to create parallel edges (good for bundling)
  const createParallelEdges = (): {
    nodes: Map<string, GraphNode>;
    edges: GraphEdge[];
  } => {
    const nodes = new Map<string, GraphNode>();
    // Two parallel pairs of nodes
    nodes.set("a1", { id: "a1", label: "A1", path: "/a1", x: 0, y: 0 });
    nodes.set("a2", { id: "a2", label: "A2", path: "/a2", x: 0, y: 50 });
    nodes.set("b1", { id: "b1", label: "B1", path: "/b1", x: 100, y: 0 });
    nodes.set("b2", { id: "b2", label: "B2", path: "/b2", x: 100, y: 50 });

    const edges: GraphEdge[] = [
      { id: "edge1", source: "a1", target: "b1" },
      { id: "edge2", source: "a2", target: "b2" },
    ];

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

  describe("FDEBBundler", () => {
    describe("constructor", () => {
      it("should create bundler with default config", () => {
        const bundler = new FDEBBundler();
        const config = bundler.getConfig();
        expect(config.algorithm).toBe("fdeb");
        expect(config.iterations).toBe(60);
        expect(config.compatibility).toBe(0.6);
      });

      it("should accept custom configuration", () => {
        const bundler = new FDEBBundler({
          iterations: 100,
          compatibility: 0.8,
          bundleStrength: 0.9,
        });
        const config = bundler.getConfig();
        expect(config.iterations).toBe(100);
        expect(config.compatibility).toBe(0.8);
        expect(config.bundleStrength).toBe(0.9);
      });

      it("should use default algorithm fdeb", () => {
        const bundler = new FDEBBundler();
        expect(bundler.getConfig().algorithm).toBe("fdeb");
      });
    });

    describe("bundle", () => {
      it("should return bundled edges for all input edges", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled).toHaveLength(3);
      });

      it("should preserve edge IDs", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled.map((e) => e.id)).toEqual(["edge1", "edge2", "edge3"]);
      });

      it("should preserve source and target IDs", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].sourceId).toBe("node1");
        expect(bundled[0].targetId).toBe("node2");
      });

      it("should have at least 2 control points per edge", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        for (const edge of bundled) {
          expect(edge.controlPoints.length).toBeGreaterThanOrEqual(2);
        }
      });

      it("should start and end at node positions", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        // edge1: node1 (50,0) -> node2 (0,100)
        expect(bundled[0].controlPoints[0].x).toBe(50);
        expect(bundled[0].controlPoints[0].y).toBe(0);
        expect(bundled[0].controlPoints[bundled[0].controlPoints.length - 1].x).toBe(0);
        expect(bundled[0].controlPoints[bundled[0].controlPoints.length - 1].y).toBe(100);
      });

      it("should preserve original edge reference", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].originalEdge).toBe(edges[0]);
      });

      it("should handle empty edge array", () => {
        const bundler = new FDEBBundler();
        const nodes = createGridNodes(2);

        const bundled = bundler.bundle([], nodes);

        expect(bundled).toHaveLength(0);
      });

      it("should filter out edges with missing nodes", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();
        // Add edge with missing nodes
        edges.push({ id: "missing", source: "notexist1", target: "notexist2" });

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled).toHaveLength(3); // Only valid edges
      });

      it("should handle edges with node object references", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
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

      it("should add subdivision points with more iterations", () => {
        const bundlerFew = new FDEBBundler({ iterations: 5 });
        const bundlerMany = new FDEBBundler({ iterations: 60 });
        const { nodes, edges } = createParallelEdges();

        const bundledFew = bundlerFew.bundle(edges, nodes);
        const bundledMany = bundlerMany.bundle(edges, nodes);

        // More iterations should result in more subdivisions
        expect(bundledMany[0].controlPoints.length).toBeGreaterThanOrEqual(
          bundledFew[0].controlPoints.length
        );
      });
    });

    describe("bundleWithStats", () => {
      it("should return bundling result with edges", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.edges).toHaveLength(3);
      });

      it("should return duration as positive number", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createTriangleGraph();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it("should count bundled edges with more than 2 control points", () => {
        const bundler = new FDEBBundler({ iterations: 30 });
        const { nodes, edges } = createParallelEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        // With enough iterations, edges should have subdivisions
        expect(result.bundledCount + result.unbundledCount).toBe(edges.length);
      });

      it("should report average compatibility", () => {
        const bundler = new FDEBBundler({ iterations: 10 });
        const { nodes, edges } = createParallelEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        // Parallel edges should have some compatibility
        expect(result.averageCompatibility).toBeGreaterThanOrEqual(0);
        expect(result.averageCompatibility).toBeLessThanOrEqual(1);
      });

      it("should handle empty edges", () => {
        const bundler = new FDEBBundler();
        const nodes = createGridNodes(2);

        const result = bundler.bundleWithStats([], nodes);

        expect(result.edges).toHaveLength(0);
        expect(result.bundledCount).toBe(0);
        expect(result.unbundledCount).toBe(0);
        expect(result.averageCompatibility).toBe(0);
      });
    });

    describe("setConfig", () => {
      it("should update configuration", () => {
        const bundler = new FDEBBundler();
        bundler.setConfig({ iterations: 200, compatibility: 0.7 });

        const config = bundler.getConfig();
        expect(config.iterations).toBe(200);
        expect(config.compatibility).toBe(0.7);
      });

      it("should maintain algorithm as fdeb", () => {
        const bundler = new FDEBBundler();
        bundler.setConfig({ algorithm: "stub" as "fdeb" });

        expect(bundler.getConfig().algorithm).toBe("fdeb");
      });

      it("should merge with existing config", () => {
        const bundler = new FDEBBundler({ bundleStrength: 0.5 });
        bundler.setConfig({ iterations: 100 });

        expect(bundler.getConfig().bundleStrength).toBe(0.5);
        expect(bundler.getConfig().iterations).toBe(100);
      });
    });

    describe("getConfig", () => {
      it("should return a copy of configuration", () => {
        const bundler = new FDEBBundler();
        const config1 = bundler.getConfig();
        const config2 = bundler.getConfig();

        expect(config1).not.toBe(config2);
        expect(config1).toEqual(config2);
      });
    });

    describe("getName", () => {
      it("should return fdeb", () => {
        const bundler = new FDEBBundler();
        expect(bundler.getName()).toBe("fdeb");
      });
    });

    describe("Edge Compatibility", () => {
      it("should not bundle connected edges (shared nodes)", () => {
        const bundler = new FDEBBundler({ iterations: 30, compatibility: 0.1 });
        const { nodes, edges } = createTriangleGraph();

        const result = bundler.bundleWithStats(edges, nodes);

        // Triangle edges share nodes, so they shouldn't be bundled together
        // Average compatibility should be 0 since connected edges are skipped
        expect(result.averageCompatibility).toBe(0);
      });

      it("should bundle parallel edges with high compatibility", () => {
        const bundler = new FDEBBundler({
          iterations: 30,
          compatibility: 0.3,
        });
        const { nodes, edges } = createParallelEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        // Parallel edges should have high compatibility
        expect(result.averageCompatibility).toBeGreaterThan(0.3);
      });
    });

    describe("Force Simulation", () => {
      it("should converge with adaptive step size", () => {
        const bundler = new FDEBBundler({
          iterations: 60,
          adaptiveStepSize: true,
        });
        const { nodes, edges } = createParallelEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        // Should complete without errors
        expect(result.edges).toHaveLength(2);
      });

      it("should work with disabled adaptive step size", () => {
        const bundler = new FDEBBundler({
          iterations: 20,
          adaptiveStepSize: false,
        });
        const { nodes, edges } = createParallelEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.edges).toHaveLength(2);
      });

      it("should increase control points with subdivisions", () => {
        const bundler = new FDEBBundler({
          iterations: 60,
          subdivisionRate: 2,
        });
        const { nodes, edges } = createParallelEdges();

        const bundled = bundler.bundle(edges, nodes);

        // After multiple subdivision cycles, should have more control points
        for (const edge of bundled) {
          expect(edge.controlPoints.length).toBeGreaterThan(2);
        }
      });
    });
  });

  describe("createFDEBBundler", () => {
    it("should create FDEBBundler instance", () => {
      const bundler = createFDEBBundler();
      expect(bundler).toBeInstanceOf(FDEBBundler);
    });

    it("should pass configuration to bundler", () => {
      const bundler = createFDEBBundler({ iterations: 150 });
      expect(bundler.getConfig().iterations).toBe(150);
    });
  });
});
