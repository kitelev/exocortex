/**
 * PathFinder Tests
 *
 * Tests for the PathFinder class that implements graph path finding algorithms.
 *
 * @module tests/presentation/renderers/graph/pathfinding
 */

import { PathFinder, createPathFinder } from "../../../../../../src/presentation/renderers/graph/pathfinding/PathFinder";
import type { GraphNode, GraphEdge } from "../../../../../../src/presentation/renderers/graph/types";

describe("PathFinder", () => {
  // Test graph setup
  //
  // Graph structure:
  //   A --1--> B --1--> C
  //   |        |        |
  //   2        1        1
  //   |        |        |
  //   v        v        v
  //   D --1--> E --1--> F
  //
  const createTestGraph = (): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    const nodes: GraphNode[] = [
      { id: "A", label: "Node A", path: "/A.md" },
      { id: "B", label: "Node B", path: "/B.md" },
      { id: "C", label: "Node C", path: "/C.md" },
      { id: "D", label: "Node D", path: "/D.md" },
      { id: "E", label: "Node E", path: "/E.md" },
      { id: "F", label: "Node F", path: "/F.md" },
    ];

    const edges: GraphEdge[] = [
      { id: "e1", source: "A", target: "B", weight: 1 },
      { id: "e2", source: "B", target: "C", weight: 1 },
      { id: "e3", source: "A", target: "D", weight: 2 },
      { id: "e4", source: "B", target: "E", weight: 1 },
      { id: "e5", source: "C", target: "F", weight: 1 },
      { id: "e6", source: "D", target: "E", weight: 1 },
      { id: "e7", source: "E", target: "F", weight: 1 },
    ];

    return { nodes, edges };
  };

  // Simple linear graph: A -> B -> C -> D
  const createLinearGraph = (): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", path: "/A.md" },
      { id: "B", label: "B", path: "/B.md" },
      { id: "C", label: "C", path: "/C.md" },
      { id: "D", label: "D", path: "/D.md" },
    ];

    const edges: GraphEdge[] = [
      { id: "e1", source: "A", target: "B" },
      { id: "e2", source: "B", target: "C" },
      { id: "e3", source: "C", target: "D" },
    ];

    return { nodes, edges };
  };

  // Disconnected graph: A -> B, C -> D (no path between A and D)
  const createDisconnectedGraph = (): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", path: "/A.md" },
      { id: "B", label: "B", path: "/B.md" },
      { id: "C", label: "C", path: "/C.md" },
      { id: "D", label: "D", path: "/D.md" },
    ];

    const edges: GraphEdge[] = [
      { id: "e1", source: "A", target: "B" },
      { id: "e2", source: "C", target: "D" },
    ];

    return { nodes, edges };
  };

  describe("createPathFinder", () => {
    it("should create a PathFinder instance", () => {
      const pathFinder = createPathFinder();
      expect(pathFinder).toBeInstanceOf(PathFinder);
    });

    it("should accept custom options", () => {
      const pathFinder = createPathFinder({
        algorithm: "dijkstra",
        maxLength: 5,
      });
      const options = pathFinder.getOptions();
      expect(options.algorithm).toBe("dijkstra");
      expect(options.maxLength).toBe(5);
    });
  });

  describe("BFS algorithm", () => {
    it("should find shortest path in linear graph", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder({ algorithm: "bfs" });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");

      expect(result.found).toBe(true);
      expect(result.paths).toHaveLength(1);
      expect(result.paths[0].length).toBe(3); // A->B->C->D = 3 edges
      expect(result.paths[0].nodeIds).toEqual(["A", "B", "C", "D"]);
      expect(result.algorithm).toBe("bfs");
    });

    it("should find path in complex graph", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder({ algorithm: "bfs", direction: "both" });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      expect(result.found).toBe(true);
      expect(result.paths).toHaveLength(1);
      // Multiple paths possible, BFS finds shortest (3 edges)
      expect(result.paths[0].length).toBe(3);
    });

    it("should return same node path for source = target", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder({ algorithm: "bfs" });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "A");

      expect(result.found).toBe(true);
      expect(result.paths).toHaveLength(1);
      expect(result.paths[0].length).toBe(0);
      expect(result.paths[0].nodeIds).toEqual(["A"]);
    });

    it("should return not found for disconnected nodes", () => {
      const { nodes, edges } = createDisconnectedGraph();
      const pathFinder = new PathFinder({ algorithm: "bfs", direction: "both" });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");

      expect(result.found).toBe(false);
      expect(result.paths).toHaveLength(0);
    });

    it("should respect maxLength constraint", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder({ algorithm: "bfs", maxLength: 2 });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");

      expect(result.found).toBe(false);
      expect(result.paths).toHaveLength(0);
    });

    it("should respect direction constraint - outgoing only", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder({
        algorithm: "bfs",
        direction: "outgoing",
      });
      pathFinder.setGraph(nodes, edges);

      // Forward direction works
      const forwardResult = pathFinder.findPath("A", "D");
      expect(forwardResult.found).toBe(true);

      // Reverse direction doesn't work with outgoing only
      const reverseResult = pathFinder.findPath("D", "A");
      expect(reverseResult.found).toBe(false);
    });

    it("should find path with both directions", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder({
        algorithm: "bfs",
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      // Both directions work
      const forwardResult = pathFinder.findPath("A", "D");
      expect(forwardResult.found).toBe(true);

      const reverseResult = pathFinder.findPath("D", "A");
      expect(reverseResult.found).toBe(true);
    });
  });

  describe("Dijkstra algorithm", () => {
    it("should find weighted shortest path", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder({
        algorithm: "dijkstra",
        weightStrategy: "property",
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      expect(result.found).toBe(true);
      expect(result.algorithm).toBe("dijkstra");
      // Should find path with lowest total weight
      expect(result.paths).toHaveLength(1);
    });

    it("should use uniform weights when weightStrategy is uniform", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder({
        algorithm: "dijkstra",
        weightStrategy: "uniform",
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      expect(result.found).toBe(true);
      // With uniform weights, should find same as BFS
      expect(result.paths[0].length).toBe(3);
    });

    it("should find same path as BFS for unweighted graphs", () => {
      const { nodes, edges } = createLinearGraph();
      const bfsPathFinder = new PathFinder({ algorithm: "bfs" });
      const dijkstraPathFinder = new PathFinder({
        algorithm: "dijkstra",
        weightStrategy: "uniform",
      });

      bfsPathFinder.setGraph(nodes, edges);
      dijkstraPathFinder.setGraph(nodes, edges);

      const bfsResult = bfsPathFinder.findPath("A", "D");
      const dijkstraResult = dijkstraPathFinder.findPath("A", "D");

      expect(bfsResult.paths[0].nodeIds).toEqual(dijkstraResult.paths[0].nodeIds);
    });
  });

  describe("Bidirectional BFS algorithm", () => {
    it("should find path using bidirectional search", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder({
        algorithm: "bidirectional",
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      expect(result.found).toBe(true);
      expect(result.algorithm).toBe("bidirectional");
      expect(result.paths).toHaveLength(1);
    });

    it("should find same length path as BFS", () => {
      const { nodes, edges } = createTestGraph();
      const bfsPathFinder = new PathFinder({ algorithm: "bfs", direction: "both" });
      const biPathFinder = new PathFinder({ algorithm: "bidirectional", direction: "both" });

      bfsPathFinder.setGraph(nodes, edges);
      biPathFinder.setGraph(nodes, edges);

      const bfsResult = bfsPathFinder.findPath("A", "F");
      const biResult = biPathFinder.findPath("A", "F");

      expect(bfsResult.paths[0].length).toBe(biResult.paths[0].length);
    });

    it("should handle disconnected nodes", () => {
      const { nodes, edges } = createDisconnectedGraph();
      const pathFinder = new PathFinder({
        algorithm: "bidirectional",
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");

      expect(result.found).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle non-existent source node", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("X", "D");

      expect(result.found).toBe(false);
      expect(result.error).toBe("Source node not found");
    });

    it("should handle non-existent target node", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "X");

      expect(result.found).toBe(false);
      expect(result.error).toBe("Target node not found");
    });

    it("should handle empty graph", () => {
      const pathFinder = new PathFinder();
      pathFinder.setGraph([], []);

      const result = pathFinder.findPath("A", "B");

      expect(result.found).toBe(false);
      expect(result.error).toBe("Source node not found");
    });

    it("should handle single node graph", () => {
      const nodes: GraphNode[] = [{ id: "A", label: "A", path: "/A.md" }];
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, []);

      const result = pathFinder.findPath("A", "A");

      expect(result.found).toBe(true);
      expect(result.paths[0].length).toBe(0);
    });

    it("should handle edges with object source/target", () => {
      const nodes: GraphNode[] = [
        { id: "A", label: "A", path: "/A.md" },
        { id: "B", label: "B", path: "/B.md" },
      ];
      const edges: GraphEdge[] = [
        {
          id: "e1",
          source: nodes[0], // Object reference
          target: nodes[1],
        },
      ];

      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "B");

      expect(result.found).toBe(true);
    });

    it("should skip edges with unknown nodes", () => {
      const nodes: GraphNode[] = [
        { id: "A", label: "A", path: "/A.md" },
        { id: "B", label: "B", path: "/B.md" },
      ];
      const edges: GraphEdge[] = [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "A", target: "X" }, // Unknown target
        { id: "e3", source: "Y", target: "B" }, // Unknown source
      ];

      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "B");

      expect(result.found).toBe(true);
      expect(result.paths[0].length).toBe(1);
    });
  });

  describe("Path reconstruction", () => {
    it("should include all nodes in path", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");
      const path = result.paths[0];

      expect(path.nodeIds).toEqual(["A", "B", "C", "D"]);
      expect(path.steps).toHaveLength(4);
      expect(path.steps[0].node.id).toBe("A");
      expect(path.steps[3].node.id).toBe("D");
    });

    it("should include all edges in path", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");
      const path = result.paths[0];

      expect(path.edgeIds).toHaveLength(3);
      expect(path.steps[0].edge).toBeNull(); // First step has no incoming edge
      expect(path.steps[1].edge).not.toBeNull();
    });

    it("should set source and target correctly", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");
      const path = result.paths[0];

      expect(path.source.id).toBe("A");
      expect(path.target.id).toBe("D");
    });

    it("should calculate total weight correctly", () => {
      const { nodes, edges } = createLinearGraph();
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "D");
      const path = result.paths[0];

      expect(path.totalWeight).toBe(3);
      expect(path.length).toBe(3);
    });
  });

  describe("Options", () => {
    it("should allow updating options after creation", () => {
      const pathFinder = new PathFinder({ algorithm: "bfs" });

      pathFinder.setOptions({ algorithm: "dijkstra" });

      expect(pathFinder.getOptions().algorithm).toBe("dijkstra");
    });

    it("should use custom weight function when provided", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder({
        algorithm: "dijkstra",
        weightStrategy: "uniform",
        customWeightFn: (edge) => {
          // Make edges from A very expensive
          if (typeof edge.source === "string" && edge.source === "A") {
            return 100;
          }
          return 1;
        },
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      // Path should still be found but may be different due to weights
      expect(result.found).toBe(true);
    });

    it("should handle predicate-based weights", () => {
      const nodes: GraphNode[] = [
        { id: "A", label: "A", path: "/A.md" },
        { id: "B", label: "B", path: "/B.md" },
        { id: "C", label: "C", path: "/C.md" },
      ];
      const edges: GraphEdge[] = [
        { id: "e1", source: "A", target: "B", property: "preferred" },
        { id: "e2", source: "A", target: "C", property: "normal" },
        { id: "e3", source: "C", target: "B", property: "normal" },
      ];

      const pathFinder = new PathFinder({
        algorithm: "dijkstra",
        weightStrategy: "predicate",
        preferredPredicates: ["preferred"],
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "B");

      expect(result.found).toBe(true);
      // Should prefer the direct A->B edge with preferred predicate
      expect(result.paths[0].length).toBe(1);
    });
  });

  describe("Performance", () => {
    it("should report search time", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder();
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should report nodes visited", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder({ direction: "both" });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      expect(result.nodesVisited).toBeGreaterThan(0);
      expect(result.nodesVisited).toBeLessThanOrEqual(nodes.length);
    });

    it("should track search time correctly", () => {
      const { nodes, edges } = createTestGraph();
      const pathFinder = new PathFinder({
        algorithm: "bfs",
        direction: "both",
      });
      pathFinder.setGraph(nodes, edges);

      const result = pathFinder.findPath("A", "F");

      // Search time should be non-negative
      expect(result.searchTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.timedOut).toBe(false);
    });
  });
});
