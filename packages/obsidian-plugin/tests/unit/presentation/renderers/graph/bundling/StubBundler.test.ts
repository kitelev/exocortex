/**
 * StubBundler Unit Tests
 *
 * Tests for:
 * - Passthrough bundling behavior
 * - Configuration management
 * - Statistics reporting
 */

import {
  StubBundler,
  createStubBundler,
} from "@plugin/presentation/renderers/graph/bundling/StubBundler";
import type { GraphEdge, GraphNode } from "@plugin/presentation/renderers/graph/types";

describe("StubBundler Module", () => {
  // Helper function to create test nodes
  const createTestNodes = (): Map<string, GraphNode> => {
    const nodes = new Map<string, GraphNode>();
    nodes.set("node1", {
      id: "node1",
      label: "Node 1",
      path: "/path/to/node1",
      x: 0,
      y: 0,
    });
    nodes.set("node2", {
      id: "node2",
      label: "Node 2",
      path: "/path/to/node2",
      x: 100,
      y: 0,
    });
    nodes.set("node3", {
      id: "node3",
      label: "Node 3",
      path: "/path/to/node3",
      x: 50,
      y: 100,
    });
    nodes.set("node4", {
      id: "node4",
      label: "Node 4",
      path: "/path/to/node4",
      x: 200,
      y: 200,
    });
    return nodes;
  };

  // Helper function to create test edges
  const createTestEdges = (): GraphEdge[] => [
    { id: "edge1", source: "node1", target: "node2" },
    { id: "edge2", source: "node2", target: "node3" },
    { id: "edge3", source: "node1", target: "node3" },
    { id: "edge4", source: "node3", target: "node4" },
  ];

  describe("StubBundler", () => {
    describe("constructor", () => {
      it("should create bundler with default config", () => {
        const bundler = new StubBundler();
        const config = bundler.getConfig();
        expect(config.algorithm).toBe("stub");
      });

      it("should use default algorithm stub", () => {
        const bundler = new StubBundler();
        expect(bundler.getConfig().algorithm).toBe("stub");
      });

      it("should accept custom configuration", () => {
        const bundler = new StubBundler({ iterations: 100 });
        expect(bundler.getConfig().iterations).toBe(100);
      });
    });

    describe("bundle", () => {
      it("should return bundled edges for all input edges", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled).toHaveLength(4);
      });

      it("should preserve edge IDs", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled.map((e) => e.id)).toEqual([
          "edge1",
          "edge2",
          "edge3",
          "edge4",
        ]);
      });

      it("should preserve source and target IDs", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].sourceId).toBe("node1");
        expect(bundled[0].targetId).toBe("node2");
      });

      it("should have only 2 control points (source and target)", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const bundled = bundler.bundle(edges, nodes);

        for (const edge of bundled) {
          expect(edge.controlPoints).toHaveLength(2);
        }
      });

      it("should set control points to node positions", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const bundled = bundler.bundle(edges, nodes);

        // edge1: node1 (0,0) -> node2 (100,0)
        expect(bundled[0].controlPoints[0]).toEqual({ x: 0, y: 0 });
        expect(bundled[0].controlPoints[1]).toEqual({ x: 100, y: 0 });

        // edge2: node2 (100,0) -> node3 (50,100)
        expect(bundled[1].controlPoints[0]).toEqual({ x: 100, y: 0 });
        expect(bundled[1].controlPoints[1]).toEqual({ x: 50, y: 100 });
      });

      it("should preserve original edge reference", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].originalEdge).toBe(edges[0]);
      });

      it("should set compatibility score to 0", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const bundled = bundler.bundle(edges, nodes);

        for (const edge of bundled) {
          expect(edge.compatibilityScore).toBe(0);
        }
      });

      it("should handle empty edge array", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();

        const bundled = bundler.bundle([], nodes);

        expect(bundled).toHaveLength(0);
      });

      it("should handle edges with node object references", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const nodeObj1 = nodes.get("node1")!;
        const nodeObj2 = nodes.get("node2")!;
        const edges: GraphEdge[] = [
          { id: "edge1", source: nodeObj1, target: nodeObj2 },
        ];

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].sourceId).toBe("node1");
        expect(bundled[0].targetId).toBe("node2");
      });

      it("should handle missing nodes with default positions", () => {
        const bundler = new StubBundler();
        const nodes = new Map<string, GraphNode>();
        const edges: GraphEdge[] = [
          { id: "edge1", source: "missing1", target: "missing2" },
        ];

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].controlPoints[0]).toEqual({ x: 0, y: 0 });
        expect(bundled[0].controlPoints[1]).toEqual({ x: 0, y: 0 });
      });

      it("should handle nodes without x/y coordinates", () => {
        const bundler = new StubBundler();
        const nodes = new Map<string, GraphNode>();
        nodes.set("node1", {
          id: "node1",
          label: "Node 1",
          path: "/path/to/node1",
          // x and y are undefined
        });
        nodes.set("node2", {
          id: "node2",
          label: "Node 2",
          path: "/path/to/node2",
        });

        const edges: GraphEdge[] = [
          { id: "edge1", source: "node1", target: "node2" },
        ];

        const bundled = bundler.bundle(edges, nodes);

        expect(bundled[0].controlPoints[0]).toEqual({ x: 0, y: 0 });
        expect(bundled[0].controlPoints[1]).toEqual({ x: 0, y: 0 });
      });
    });

    describe("bundleWithStats", () => {
      it("should return bundling result with edges", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.edges).toHaveLength(4);
      });

      it("should return duration as positive number", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it("should report 0 bundled edges", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.bundledCount).toBe(0);
      });

      it("should report all edges as unbundled", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.unbundledCount).toBe(4);
      });

      it("should report 0 average compatibility", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();
        const edges = createTestEdges();

        const result = bundler.bundleWithStats(edges, nodes);

        expect(result.averageCompatibility).toBe(0);
      });

      it("should handle empty edges", () => {
        const bundler = new StubBundler();
        const nodes = createTestNodes();

        const result = bundler.bundleWithStats([], nodes);

        expect(result.edges).toHaveLength(0);
        expect(result.bundledCount).toBe(0);
        expect(result.unbundledCount).toBe(0);
      });
    });

    describe("setConfig", () => {
      it("should update configuration", () => {
        const bundler = new StubBundler();
        bundler.setConfig({ iterations: 200 });

        expect(bundler.getConfig().iterations).toBe(200);
      });

      it("should maintain algorithm as stub", () => {
        const bundler = new StubBundler();
        bundler.setConfig({ algorithm: "fdeb" as "stub" });

        expect(bundler.getConfig().algorithm).toBe("stub");
      });

      it("should merge with existing config", () => {
        const bundler = new StubBundler({ bundleStrength: 0.5 });
        bundler.setConfig({ iterations: 100 });

        expect(bundler.getConfig().bundleStrength).toBe(0.5);
        expect(bundler.getConfig().iterations).toBe(100);
      });
    });

    describe("getConfig", () => {
      it("should return a copy of configuration", () => {
        const bundler = new StubBundler();
        const config1 = bundler.getConfig();
        const config2 = bundler.getConfig();

        expect(config1).not.toBe(config2);
        expect(config1).toEqual(config2);
      });
    });

    describe("getName", () => {
      it("should return stub", () => {
        const bundler = new StubBundler();
        expect(bundler.getName()).toBe("stub");
      });
    });
  });

  describe("createStubBundler", () => {
    it("should create StubBundler instance", () => {
      const bundler = createStubBundler();
      expect(bundler).toBeInstanceOf(StubBundler);
    });

    it("should pass configuration to bundler", () => {
      const bundler = createStubBundler({ iterations: 150 });
      expect(bundler.getConfig().iterations).toBe(150);
    });
  });
});
