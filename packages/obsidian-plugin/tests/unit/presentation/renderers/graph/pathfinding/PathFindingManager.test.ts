/**
 * PathFindingManager Tests
 *
 * Tests for the PathFindingManager class that manages path finding state and UI.
 *
 * @module tests/presentation/renderers/graph/pathfinding
 */

import {
  PathFindingManager,
  createPathFindingManager,
} from "../../../../../../src/presentation/renderers/graph/pathfinding/PathFindingManager";
import type { GraphNode, GraphEdge } from "../../../../../../src/presentation/renderers/graph/types";
import type { PathFindingEvent } from "../../../../../../src/presentation/renderers/graph/pathfinding/PathFindingTypes";

describe("PathFindingManager", () => {
  // Test graph
  const createTestGraph = (): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    const nodes: GraphNode[] = [
      { id: "A", label: "Node A", path: "/A.md" },
      { id: "B", label: "Node B", path: "/B.md" },
      { id: "C", label: "Node C", path: "/C.md" },
      { id: "D", label: "Node D", path: "/D.md" },
    ];

    const edges: GraphEdge[] = [
      { id: "e1", source: "A", target: "B" },
      { id: "e2", source: "B", target: "C" },
      { id: "e3", source: "C", target: "D" },
    ];

    return { nodes, edges };
  };

  describe("createPathFindingManager", () => {
    it("should create a PathFindingManager instance", () => {
      const manager = createPathFindingManager();
      expect(manager).toBeInstanceOf(PathFindingManager);
    });

    it("should accept custom config", () => {
      const manager = createPathFindingManager({
        pathFindingOptions: {
          algorithm: "dijkstra",
          maxLength: 5,
          direction: "both",
          findAllPaths: false,
          maxPaths: 5,
          weightStrategy: "uniform",
          timeoutMs: 5000,
        },
      });

      const state = manager.getState();
      expect(state.options.algorithm).toBe("dijkstra");
      expect(state.options.maxLength).toBe(5);
    });
  });

  describe("Lifecycle", () => {
    it("should start in inactive state", () => {
      const manager = new PathFindingManager();

      const state = manager.getState();

      expect(state.isActive).toBe(false);
      expect(state.sourceNode).toBeNull();
      expect(state.targetNode).toBeNull();
    });

    it("should activate when start() is called", () => {
      const manager = new PathFindingManager();

      manager.start();
      const state = manager.getState();

      expect(state.isActive).toBe(true);
      expect(state.selectionStep).toBe("source");
    });

    it("should deactivate when cancel() is called", () => {
      const manager = new PathFindingManager();

      manager.start();
      manager.cancel();
      const state = manager.getState();

      expect(state.isActive).toBe(false);
    });

    it("should reset state when clear() is called", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      manager.clear();
      const state = manager.getState();

      expect(state.isActive).toBe(true); // Stays active
      expect(state.sourceNode).toBeNull();
      expect(state.targetNode).toBeNull();
      expect(state.result).toBeNull();
    });

    it("should destroy cleanly", () => {
      const manager = new PathFindingManager();
      const listener = jest.fn();
      manager.addEventListener(listener);

      manager.destroy();
      manager.start();

      // Listener should not be called after destroy
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("Node selection", () => {
    it("should select source node on first click", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();

      const handled = manager.handleNodeClick("A");
      const state = manager.getState();

      expect(handled).toBe(true);
      expect(state.sourceNode?.id).toBe("A");
      expect(state.selectionStep).toBe("target");
    });

    it("should select target node on second click", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();

      manager.handleNodeClick("A");
      const handled = manager.handleNodeClick("D");
      const state = manager.getState();

      expect(handled).toBe(true);
      expect(state.targetNode?.id).toBe("D");
      expect(state.selectionStep).toBe("complete");
    });

    it("should not handle click when inactive", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);

      const handled = manager.handleNodeClick("A");

      expect(handled).toBe(false);
    });

    it("should not handle click for unknown node", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();

      const handled = manager.handleNodeClick("X");

      expect(handled).toBe(false);
    });

    it("should allow direct source/target setting", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();

      manager.setSource("A");
      manager.setTarget("D");
      const state = manager.getState();

      expect(state.sourceNode?.id).toBe("A");
      expect(state.targetNode?.id).toBe("D");
    });

    it("should swap source and target", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      manager.swapSourceTarget();
      const state = manager.getState();

      expect(state.sourceNode?.id).toBe("D");
      expect(state.targetNode?.id).toBe("A");
    });
  });

  describe("Path search", () => {
    it("should auto-search when both nodes selected via clicks", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();

      manager.handleNodeClick("A");
      manager.handleNodeClick("D");
      const state = manager.getState();

      expect(state.result).not.toBeNull();
      expect(state.result?.found).toBe(true);
    });

    it("should auto-search when both nodes set directly", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();

      manager.setSource("A");
      manager.setTarget("D");
      const state = manager.getState();

      expect(state.result).not.toBeNull();
      expect(state.result?.found).toBe(true);
    });

    it("should find path and store result", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      const state = manager.getState();
      const path = manager.getCurrentPath();

      expect(state.result?.found).toBe(true);
      expect(path).not.toBeNull();
      expect(path?.nodeIds).toEqual(["A", "B", "C", "D"]);
    });

    it("should handle no path found", () => {
      const nodes: GraphNode[] = [
        { id: "A", label: "A", path: "/A.md" },
        { id: "B", label: "B", path: "/B.md" },
      ];
      const edges: GraphEdge[] = []; // No edges

      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("B");

      const state = manager.getState();

      expect(state.result?.found).toBe(false);
    });

    it("should re-search when swapping nodes", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      const pathBefore = manager.getCurrentPath();
      manager.swapSourceTarget();
      const state = manager.getState();
      const pathAfter = manager.getCurrentPath();

      expect(state.result?.found).toBe(true);
      expect(pathAfter?.source.id).toBe("D");
      expect(pathAfter?.target.id).toBe("A");
    });
  });

  describe("Path navigation", () => {
    it("should return current path", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      const path = manager.getCurrentPath();

      expect(path).not.toBeNull();
      expect(path?.source.id).toBe("A");
      expect(path?.target.id).toBe("D");
    });

    it("should return null when no path found", () => {
      const manager = new PathFindingManager();
      manager.start();

      const path = manager.getCurrentPath();

      expect(path).toBeNull();
    });
  });

  describe("Highlight helpers", () => {
    it("should identify nodes on path", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      expect(manager.isNodeOnPath("A")).toBe(true);
      expect(manager.isNodeOnPath("B")).toBe(true);
      expect(manager.isNodeOnPath("C")).toBe(true);
      expect(manager.isNodeOnPath("D")).toBe(true);
    });

    it("should identify edges on path", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      expect(manager.isEdgeOnPath("e1")).toBe(true);
      expect(manager.isEdgeOnPath("e2")).toBe(true);
      expect(manager.isEdgeOnPath("e3")).toBe(true);
    });

    it("should identify source and target nodes", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      expect(manager.isSourceNode("A")).toBe(true);
      expect(manager.isSourceNode("B")).toBe(false);
      expect(manager.isTargetNode("D")).toBe(true);
      expect(manager.isTargetNode("C")).toBe(false);
    });

    it("should return highlighted node IDs set", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      const nodeIds = manager.getHighlightedNodeIds();

      expect(nodeIds.has("A")).toBe(true);
      expect(nodeIds.has("D")).toBe(true);
      expect(nodeIds.size).toBe(4);
    });

    it("should return highlighted edge IDs set", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      const edgeIds = manager.getHighlightedEdgeIds();

      expect(edgeIds.has("e1")).toBe(true);
      expect(edgeIds.has("e2")).toBe(true);
      expect(edgeIds.has("e3")).toBe(true);
      expect(edgeIds.size).toBe(3);
    });

    it("should return empty sets when no path", () => {
      const manager = new PathFindingManager();

      const nodeIds = manager.getHighlightedNodeIds();
      const edgeIds = manager.getHighlightedEdgeIds();

      expect(nodeIds.size).toBe(0);
      expect(edgeIds.size).toBe(0);
    });
  });

  describe("Events", () => {
    it("should emit start event", () => {
      const manager = new PathFindingManager();
      const events: PathFindingEvent[] = [];
      manager.addEventListener((e) => events.push(e));

      manager.start();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("pathfinding:start");
    });

    it("should emit source-selected event", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      const events: PathFindingEvent[] = [];
      manager.addEventListener((e) => events.push(e));

      manager.start();
      manager.handleNodeClick("A");

      expect(events.some(e => e.type === "pathfinding:source-selected")).toBe(true);
    });

    it("should emit target-selected event", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      const events: PathFindingEvent[] = [];
      manager.addEventListener((e) => events.push(e));

      manager.start();
      manager.handleNodeClick("A");
      manager.handleNodeClick("D");

      expect(events.some(e => e.type === "pathfinding:target-selected")).toBe(true);
    });

    it("should emit found event when path found", () => {
      const { nodes, edges } = createTestGraph();
      const manager = new PathFindingManager();
      manager.setGraph(nodes, edges);
      const events: PathFindingEvent[] = [];
      manager.addEventListener((e) => events.push(e));

      manager.start();
      manager.setSource("A");
      manager.setTarget("D");

      expect(events.some(e => e.type === "pathfinding:found")).toBe(true);
    });

    it("should emit not-found event when no path", () => {
      const nodes: GraphNode[] = [
        { id: "A", label: "A", path: "/A.md" },
        { id: "B", label: "B", path: "/B.md" },
      ];

      const manager = new PathFindingManager();
      manager.setGraph(nodes, []);
      const events: PathFindingEvent[] = [];
      manager.addEventListener((e) => events.push(e));

      manager.start();
      manager.setSource("A");
      manager.setTarget("B");

      expect(events.some(e => e.type === "pathfinding:not-found")).toBe(true);
    });

    it("should emit cancel event", () => {
      const manager = new PathFindingManager();
      const events: PathFindingEvent[] = [];
      manager.addEventListener((e) => events.push(e));

      manager.start();
      manager.cancel();

      expect(events.some(e => e.type === "pathfinding:cancel")).toBe(true);
    });

    it("should emit clear event", () => {
      const manager = new PathFindingManager();
      const events: PathFindingEvent[] = [];
      manager.addEventListener((e) => events.push(e));

      manager.start();
      manager.clear();

      expect(events.some(e => e.type === "pathfinding:clear")).toBe(true);
    });

    it("should allow removing event listeners", () => {
      const manager = new PathFindingManager();
      const events: PathFindingEvent[] = [];
      const listener = (e: PathFindingEvent) => events.push(e);

      manager.addEventListener(listener);
      manager.start();
      manager.removeEventListener(listener);
      manager.cancel();

      expect(events).toHaveLength(1); // Only start event
    });
  });

  describe("Options management", () => {
    it("should allow updating options", () => {
      const manager = new PathFindingManager();

      manager.setOptions({ algorithm: "dijkstra" });
      const state = manager.getState();

      expect(state.options.algorithm).toBe("dijkstra");
    });

    it("should allow updating visualization style", () => {
      const manager = new PathFindingManager();

      manager.setVisualizationStyle({ edgeColor: "#ff0000" });
      const style = manager.getVisualizationStyle();

      expect(style.edgeColor).toBe("#ff0000");
    });
  });
});
