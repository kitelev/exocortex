/**
 * Tests for IncrementalRenderer - High-performance incremental graph rendering
 *
 * These tests focus on the dirty-tracking and incremental update logic.
 * Since full PixiJS rendering requires WebGL which is unavailable in JSDOM,
 * we test the state management and dirty tracking without calling render().
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";
import { DirtyTracker, NodeEdgeIndex } from "../../../../../src/presentation/renderers/graph/DirtyTracker";

// Test DirtyTracker - the core dirty tracking logic
describe("DirtyTracker", () => {
  let tracker: DirtyTracker;

  beforeEach(() => {
    tracker = new DirtyTracker();
  });

  describe("initialization", () => {
    it("should start clean", () => {
      expect(tracker.hasAnyDirty()).toBe(false);
    });

    it("should not need full redraw initially", () => {
      expect(tracker.needsFullRedraw()).toBe(false);
    });

    it("should have empty dirty sets", () => {
      expect(tracker.getDirtyNodes().size).toBe(0);
      expect(tracker.getDirtyEdges().size).toBe(0);
    });
  });

  describe("flag management", () => {
    it("should track dirty flags", () => {
      tracker.markDirty("positions");
      expect(tracker.isDirty("positions")).toBe(true);
      expect(tracker.isDirty("viewport")).toBe(false);
    });

    it("should track all flag as full redraw", () => {
      tracker.markDirty("all");
      expect(tracker.needsFullRedraw()).toBe(true);
      expect(tracker.isDirty("positions")).toBe(true);
      expect(tracker.isDirty("viewport")).toBe(true);
    });

    it("should mark multiple flags with batch method", () => {
      tracker.markDirtyBatch(["positions", "viewport", "labels"]);
      expect(tracker.isDirty("positions")).toBe(true);
      expect(tracker.isDirty("viewport")).toBe(true);
      expect(tracker.isDirty("labels")).toBe(true);
      expect(tracker.isDirty("selection")).toBe(false);
    });

    it("should return all active flags", () => {
      tracker.markDirty("positions");
      tracker.markDirty("viewport");
      const flags = tracker.getDirtyFlags();
      expect(flags.has("positions")).toBe(true);
      expect(flags.has("viewport")).toBe(true);
      expect(flags.size).toBe(2);
    });
  });

  describe("node tracking", () => {
    it("should track dirty nodes", () => {
      tracker.markNodeDirty("n1");
      expect(tracker.isNodeDirty("n1")).toBe(true);
      expect(tracker.isNodeDirty("n2")).toBe(false);
    });

    it("should mark nodes in batch", () => {
      tracker.markNodesDirty(["n1", "n2", "n3"]);
      expect(tracker.isNodeDirty("n1")).toBe(true);
      expect(tracker.isNodeDirty("n2")).toBe(true);
      expect(tracker.isNodeDirty("n3")).toBe(true);
      expect(tracker.isNodeDirty("n4")).toBe(false);
    });

    it("should mark all nodes dirty", () => {
      tracker.markAllNodesDirty(["n1", "n2"]);
      expect(tracker.getDirtyNodeCount()).toBe(2);
    });

    it("should count dirty nodes", () => {
      tracker.markNodeDirty("n1");
      tracker.markNodeDirty("n2");
      expect(tracker.getDirtyNodeCount()).toBe(2);
    });

    it("should mark positions dirty when node is marked dirty", () => {
      tracker.markNodeDirty("n1");
      expect(tracker.isDirty("positions")).toBe(true);
    });

    it("should return all dirty nodes unless full redraw needed", () => {
      tracker.markNodeDirty("n1");
      tracker.markNodeDirty("n2");

      const dirtyNodes = tracker.getDirtyNodes();
      expect(dirtyNodes.has("n1")).toBe(true);
      expect(dirtyNodes.has("n2")).toBe(true);
    });

    it("should return empty set when full redraw is needed", () => {
      tracker.markNodeDirty("n1");
      tracker.markDirty("all");

      // Empty set indicates all nodes need update
      expect(tracker.getDirtyNodes().size).toBe(0);
    });
  });

  describe("edge tracking", () => {
    it("should track dirty edges", () => {
      tracker.markEdgeDirty("e1");
      expect(tracker.isEdgeDirty("e1")).toBe(true);
      expect(tracker.isEdgeDirty("e2")).toBe(false);
    });

    it("should mark edges in batch", () => {
      tracker.markEdgesDirty(["e1", "e2"]);
      expect(tracker.isEdgeDirty("e1")).toBe(true);
      expect(tracker.isEdgeDirty("e2")).toBe(true);
    });

    it("should count dirty edges", () => {
      tracker.markEdgeDirty("e1");
      tracker.markEdgeDirty("e2");
      expect(tracker.getDirtyEdgeCount()).toBe(2);
    });

    it("should return empty set when full redraw is needed", () => {
      tracker.markEdgeDirty("e1");
      tracker.markDirty("all");

      expect(tracker.getDirtyEdges().size).toBe(0);
    });

    it("should mark node edges dirty using edge index", () => {
      const edgeIndex = new Map<string, Set<string>>();
      edgeIndex.set("n1", new Set(["e1", "e2"]));

      tracker.markNodeEdgesDirty("n1", edgeIndex);

      expect(tracker.isEdgeDirty("e1")).toBe(true);
      expect(tracker.isEdgeDirty("e2")).toBe(true);
    });
  });

  describe("clearing state", () => {
    it("should clear all dirty state", () => {
      tracker.markDirty("positions");
      tracker.markNodeDirty("n1");
      tracker.markEdgeDirty("e1");
      tracker.clear();

      expect(tracker.hasAnyDirty()).toBe(false);
      expect(tracker.getDirtyNodeCount()).toBe(0);
      expect(tracker.getDirtyEdgeCount()).toBe(0);
    });

    it("should track last render stats before clearing", () => {
      tracker.markNodeDirty("n1");
      tracker.markEdgeDirty("e1");
      tracker.clear();

      const stats = tracker.getStats();
      expect(stats.lastDirtyNodeCount).toBe(1);
      expect(stats.lastDirtyEdgeCount).toBe(1);
    });
  });

  describe("statistics", () => {
    it("should track total marks", () => {
      tracker.markDirty("positions");
      tracker.markNodeDirty("n1");
      tracker.markEdgeDirty("e1");

      const stats = tracker.getStats();
      // position flag (1) + node mark (1) + edge mark (1) = 3
      // Note: markNodeDirty adds "positions" flag but only counts 1 mark, not 2
      expect(stats.totalMarks).toBe(3);
    });

    it("should track full redraws", () => {
      tracker.markDirty("all");

      const stats = tracker.getStats();
      expect(stats.fullRedraws).toBe(1);
    });

    it("should track incremental updates", () => {
      tracker.markNodeDirty("n1");
      tracker.clear();

      const stats = tracker.getStats();
      expect(stats.incrementalUpdates).toBe(1);
    });

    it("should calculate efficiency ratio", () => {
      // 2 incremental updates
      tracker.markNodeDirty("n1");
      tracker.clear();
      tracker.markNodeDirty("n2");
      tracker.clear();

      // 1 full redraw
      tracker.markDirty("all");
      tracker.clear();

      const efficiency = tracker.getEfficiencyRatio();
      expect(efficiency).toBe(2 / 3); // 2 incremental out of 3 total
    });

    it("should reset statistics", () => {
      tracker.markDirty("all");
      tracker.resetStats();

      const stats = tracker.getStats();
      expect(stats.fullRedraws).toBe(0);
      expect(stats.totalMarks).toBe(0);
    });
  });
});

// Test NodeEdgeIndex - the node-to-edge relationship index
describe("NodeEdgeIndex", () => {
  let index: NodeEdgeIndex;

  beforeEach(() => {
    index = new NodeEdgeIndex();
  });

  describe("edge management", () => {
    it("should add edge and track both nodes", () => {
      index.addEdge("e1", "n1", "n2");

      expect(index.getEdgesForNode("n1").has("e1")).toBe(true);
      expect(index.getEdgesForNode("n2").has("e1")).toBe(true);
    });

    it("should track edge to node mapping", () => {
      index.addEdge("e1", "n1", "n2");

      const nodes = index.getNodesForEdge("e1");
      expect(nodes).toEqual(["n1", "n2"]);
    });

    it("should remove edge correctly", () => {
      index.addEdge("e1", "n1", "n2");
      index.removeEdge("e1");

      expect(index.getEdgesForNode("n1").has("e1")).toBe(false);
      expect(index.getEdgesForNode("n2").has("e1")).toBe(false);
      expect(index.getNodesForEdge("e1")).toBeUndefined();
    });

    it("should handle multiple edges per node", () => {
      index.addEdge("e1", "n1", "n2");
      index.addEdge("e2", "n1", "n3");
      index.addEdge("e3", "n2", "n3");

      expect(index.getEdgesForNode("n1").size).toBe(2);
      expect(index.getEdgesForNode("n2").size).toBe(2);
      expect(index.getEdgesForNode("n3").size).toBe(2);
    });

    it("should clean up empty node entries on edge removal", () => {
      index.addEdge("e1", "n1", "n2");
      index.removeEdge("e1");

      // Internal map should not have empty entries
      const stats = index.getStats();
      expect(stats.nodeCount).toBe(0);
    });
  });

  describe("node queries", () => {
    it("should return empty set for unknown node", () => {
      const edges = index.getEdgesForNode("unknown");
      expect(edges.size).toBe(0);
    });

    it("should check if node has edges", () => {
      index.addEdge("e1", "n1", "n2");

      expect(index.hasEdges("n1")).toBe(true);
      expect(index.hasEdges("n3")).toBe(false);
    });

    it("should calculate node degree", () => {
      index.addEdge("e1", "n1", "n2");
      index.addEdge("e2", "n1", "n3");

      expect(index.getDegree("n1")).toBe(2);
      expect(index.getDegree("n2")).toBe(1);
      expect(index.getDegree("unknown")).toBe(0);
    });
  });

  describe("batch operations", () => {
    it("should return node edges map", () => {
      index.addEdge("e1", "n1", "n2");
      index.addEdge("e2", "n1", "n3");

      const map = index.getNodeEdgesMap();
      expect(map.get("n1")?.size).toBe(2);
    });

    it("should clear all data", () => {
      index.addEdge("e1", "n1", "n2");
      index.addEdge("e2", "n2", "n3");
      index.clear();

      const stats = index.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });
  });

  describe("statistics", () => {
    it("should track node and edge counts", () => {
      index.addEdge("e1", "n1", "n2");
      index.addEdge("e2", "n2", "n3");

      const stats = index.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
    });
  });
});

// Test IncrementalRenderer exported types (compile-time checks)
describe("IncrementalRenderer types", () => {
  it("should export IncrementalRendererOptions type", () => {
    // TypeScript compile-time check
    const options: import("../../../../../src/presentation/renderers/graph/IncrementalRenderer").IncrementalRendererOptions = {
      enableLabels: true,
      labelMinZoom: 0.5,
      labelMaxZoom: 2,
    };
    expect(options.enableLabels).toBe(true);
  });

  it("should export RenderStats type", () => {
    // TypeScript compile-time check
    const stats: import("../../../../../src/presentation/renderers/graph/IncrementalRenderer").RenderStats = {
      totalNodes: 10,
      totalEdges: 5,
      nodesUpdated: 2,
      edgesUpdated: 1,
      labelsUpdated: 2,
      wasIncremental: true,
      efficiencyRatio: 0.8,
      renderDurationMs: 16,
    };
    expect(stats.wasIncremental).toBe(true);
  });
});
