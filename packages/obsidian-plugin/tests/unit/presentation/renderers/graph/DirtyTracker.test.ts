/**
 * Tests for DirtyTracker - Dirty-checking for incremental graph rendering
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  DirtyTracker,
  NodeEdgeIndex,
  DEFAULT_DIRTY_TRACKER_CONFIG,
  type DirtyFlag,
} from "../../../../../src/presentation/renderers/graph/DirtyTracker";

describe("DirtyTracker", () => {
  let tracker: DirtyTracker;

  beforeEach(() => {
    tracker = new DirtyTracker();
  });

  describe("flag management", () => {
    it("should start with no dirty flags", () => {
      expect(tracker.hasAnyDirty()).toBe(false);
      expect(tracker.isDirty("positions")).toBe(false);
      expect(tracker.isDirty("viewport")).toBe(false);
    });

    it("should mark a single flag as dirty", () => {
      tracker.markDirty("positions");

      expect(tracker.hasAnyDirty()).toBe(true);
      expect(tracker.isDirty("positions")).toBe(true);
      expect(tracker.isDirty("viewport")).toBe(false);
    });

    it("should mark multiple flags as dirty", () => {
      tracker.markDirty("positions");
      tracker.markDirty("viewport");

      expect(tracker.isDirty("positions")).toBe(true);
      expect(tracker.isDirty("viewport")).toBe(true);
      expect(tracker.isDirty("selection")).toBe(false);
    });

    it("should mark batch of flags as dirty", () => {
      tracker.markDirtyBatch(["positions", "viewport", "selection"]);

      expect(tracker.isDirty("positions")).toBe(true);
      expect(tracker.isDirty("viewport")).toBe(true);
      expect(tracker.isDirty("selection")).toBe(true);
    });

    it("should return all dirty flags", () => {
      tracker.markDirty("positions");
      tracker.markDirty("viewport");

      const flags = tracker.getDirtyFlags();
      expect(flags.size).toBe(2);
      expect(flags.has("positions")).toBe(true);
      expect(flags.has("viewport")).toBe(true);
    });

    it("should handle 'all' flag making all checks return true", () => {
      tracker.markDirty("all");

      expect(tracker.isDirty("positions")).toBe(true);
      expect(tracker.isDirty("viewport")).toBe(true);
      expect(tracker.isDirty("selection")).toBe(true);
      expect(tracker.isDirty("filters")).toBe(true);
      expect(tracker.needsFullRedraw()).toBe(true);
    });
  });

  describe("node tracking", () => {
    it("should mark a single node as dirty", () => {
      tracker.markNodeDirty("node-1");

      expect(tracker.isNodeDirty("node-1")).toBe(true);
      expect(tracker.isNodeDirty("node-2")).toBe(false);
      expect(tracker.isDirty("positions")).toBe(true);
    });

    it("should mark multiple nodes as dirty", () => {
      tracker.markNodesDirty(["node-1", "node-2", "node-3"]);

      expect(tracker.isNodeDirty("node-1")).toBe(true);
      expect(tracker.isNodeDirty("node-2")).toBe(true);
      expect(tracker.isNodeDirty("node-3")).toBe(true);
      expect(tracker.isNodeDirty("node-4")).toBe(false);
    });

    it("should return dirty nodes set", () => {
      tracker.markNodesDirty(["node-1", "node-2"]);

      const dirtyNodes = tracker.getDirtyNodes();
      expect(dirtyNodes.size).toBe(2);
      expect(dirtyNodes.has("node-1")).toBe(true);
      expect(dirtyNodes.has("node-2")).toBe(true);
    });

    it("should return empty set when 'all' is marked (full redraw)", () => {
      tracker.markNodeDirty("node-1");
      tracker.markDirty("all");

      const dirtyNodes = tracker.getDirtyNodes();
      expect(dirtyNodes.size).toBe(0);
    });

    it("should return dirty node count", () => {
      tracker.markNodesDirty(["node-1", "node-2", "node-3"]);
      expect(tracker.getDirtyNodeCount()).toBe(3);
    });

    it("should consider all nodes dirty when 'all' flag is set", () => {
      tracker.markDirty("all");

      expect(tracker.isNodeDirty("any-node")).toBe(true);
      expect(tracker.isNodeDirty("another-node")).toBe(true);
    });
  });

  describe("edge tracking", () => {
    it("should mark a single edge as dirty", () => {
      tracker.markEdgeDirty("edge-1");

      expect(tracker.isEdgeDirty("edge-1")).toBe(true);
      expect(tracker.isEdgeDirty("edge-2")).toBe(false);
    });

    it("should mark multiple edges as dirty", () => {
      tracker.markEdgesDirty(["edge-1", "edge-2", "edge-3"]);

      expect(tracker.isEdgeDirty("edge-1")).toBe(true);
      expect(tracker.isEdgeDirty("edge-2")).toBe(true);
      expect(tracker.isEdgeDirty("edge-3")).toBe(true);
    });

    it("should return dirty edges set", () => {
      tracker.markEdgesDirty(["edge-1", "edge-2"]);

      const dirtyEdges = tracker.getDirtyEdges();
      expect(dirtyEdges.size).toBe(2);
      expect(dirtyEdges.has("edge-1")).toBe(true);
      expect(dirtyEdges.has("edge-2")).toBe(true);
    });

    it("should return empty set when 'all' is marked (full redraw)", () => {
      tracker.markEdgeDirty("edge-1");
      tracker.markDirty("all");

      const dirtyEdges = tracker.getDirtyEdges();
      expect(dirtyEdges.size).toBe(0);
    });

    it("should return dirty edge count", () => {
      tracker.markEdgesDirty(["edge-1", "edge-2"]);
      expect(tracker.getDirtyEdgeCount()).toBe(2);
    });

    it("should mark edges connected to a node as dirty", () => {
      const edgeIndex = new Map<string, Set<string>>();
      edgeIndex.set("node-1", new Set(["edge-1", "edge-2"]));
      edgeIndex.set("node-2", new Set(["edge-2", "edge-3"]));

      tracker.markNodeEdgesDirty("node-1", edgeIndex);

      expect(tracker.isEdgeDirty("edge-1")).toBe(true);
      expect(tracker.isEdgeDirty("edge-2")).toBe(true);
      expect(tracker.isEdgeDirty("edge-3")).toBe(false);
    });
  });

  describe("clearing", () => {
    it("should clear all dirty state", () => {
      tracker.markDirty("positions");
      tracker.markDirty("viewport");
      tracker.markNodesDirty(["node-1", "node-2"]);
      tracker.markEdgesDirty(["edge-1"]);

      expect(tracker.hasAnyDirty()).toBe(true);

      tracker.clear();

      expect(tracker.hasAnyDirty()).toBe(false);
      expect(tracker.isDirty("positions")).toBe(false);
      expect(tracker.isNodeDirty("node-1")).toBe(false);
      expect(tracker.isEdgeDirty("edge-1")).toBe(false);
    });
  });

  describe("statistics", () => {
    it("should track total marks", () => {
      tracker.markDirty("positions");
      tracker.markDirty("viewport");
      tracker.markNodeDirty("node-1");

      const stats = tracker.getStats();
      expect(stats.totalMarks).toBe(3);
    });

    it("should track full redraws", () => {
      tracker.markDirty("all");
      tracker.clear();
      tracker.markDirty("all");

      const stats = tracker.getStats();
      expect(stats.fullRedraws).toBe(2);
    });

    it("should track incremental updates", () => {
      tracker.markDirty("positions");
      tracker.clear();
      tracker.markDirty("viewport");
      tracker.clear();

      const stats = tracker.getStats();
      expect(stats.incrementalUpdates).toBe(2);
    });

    it("should calculate efficiency ratio", () => {
      // 2 incremental, 1 full redraw
      tracker.markDirty("positions");
      tracker.clear();
      tracker.markDirty("viewport");
      tracker.clear();
      tracker.markDirty("all");
      tracker.clear();

      const ratio = tracker.getEfficiencyRatio();
      expect(ratio).toBeCloseTo(2 / 3);
    });

    it("should return 1 for efficiency when no updates", () => {
      expect(tracker.getEfficiencyRatio()).toBe(1);
    });

    it("should reset statistics", () => {
      tracker.markDirty("positions");
      tracker.clear();
      tracker.markDirty("all");
      tracker.clear();

      tracker.resetStats();

      const stats = tracker.getStats();
      expect(stats.totalMarks).toBe(0);
      expect(stats.fullRedraws).toBe(0);
      expect(stats.incrementalUpdates).toBe(0);
    });

    it("should track last dirty counts after clear", () => {
      tracker.markNodesDirty(["node-1", "node-2", "node-3"]);
      tracker.markEdgesDirty(["edge-1", "edge-2"]);
      tracker.clear();

      const stats = tracker.getStats();
      expect(stats.lastDirtyNodeCount).toBe(3);
      expect(stats.lastDirtyEdgeCount).toBe(2);
    });
  });
});

describe("NodeEdgeIndex", () => {
  let index: NodeEdgeIndex;

  beforeEach(() => {
    index = new NodeEdgeIndex();
  });

  describe("edge management", () => {
    it("should add an edge", () => {
      index.addEdge("edge-1", "node-a", "node-b");

      expect(index.getEdgesForNode("node-a").has("edge-1")).toBe(true);
      expect(index.getEdgesForNode("node-b").has("edge-1")).toBe(true);
    });

    it("should track multiple edges for a node", () => {
      index.addEdge("edge-1", "node-a", "node-b");
      index.addEdge("edge-2", "node-a", "node-c");

      const edges = index.getEdgesForNode("node-a");
      expect(edges.size).toBe(2);
      expect(edges.has("edge-1")).toBe(true);
      expect(edges.has("edge-2")).toBe(true);
    });

    it("should remove an edge", () => {
      index.addEdge("edge-1", "node-a", "node-b");
      index.addEdge("edge-2", "node-a", "node-c");

      index.removeEdge("edge-1");

      expect(index.getEdgesForNode("node-a").has("edge-1")).toBe(false);
      expect(index.getEdgesForNode("node-b").has("edge-1")).toBe(false);
      expect(index.getEdgesForNode("node-a").has("edge-2")).toBe(true);
    });

    it("should clean up empty node entries after edge removal", () => {
      index.addEdge("edge-1", "node-a", "node-b");
      index.removeEdge("edge-1");

      expect(index.hasEdges("node-a")).toBe(false);
      expect(index.hasEdges("node-b")).toBe(false);
    });

    it("should handle removing non-existent edge gracefully", () => {
      expect(() => index.removeEdge("non-existent")).not.toThrow();
    });
  });

  describe("node queries", () => {
    it("should return empty set for node with no edges", () => {
      const edges = index.getEdgesForNode("unknown");
      expect(edges.size).toBe(0);
    });

    it("should check if node has edges", () => {
      index.addEdge("edge-1", "node-a", "node-b");

      expect(index.hasEdges("node-a")).toBe(true);
      expect(index.hasEdges("node-c")).toBe(false);
    });

    it("should return node degree", () => {
      index.addEdge("edge-1", "node-a", "node-b");
      index.addEdge("edge-2", "node-a", "node-c");
      index.addEdge("edge-3", "node-b", "node-c");

      expect(index.getDegree("node-a")).toBe(2);
      expect(index.getDegree("node-b")).toBe(2);
      expect(index.getDegree("node-c")).toBe(2);
      expect(index.getDegree("node-d")).toBe(0);
    });
  });

  describe("edge queries", () => {
    it("should return nodes for an edge", () => {
      index.addEdge("edge-1", "node-a", "node-b");

      const nodes = index.getNodesForEdge("edge-1");
      expect(nodes).toEqual(["node-a", "node-b"]);
    });

    it("should return undefined for non-existent edge", () => {
      const nodes = index.getNodesForEdge("unknown");
      expect(nodes).toBeUndefined();
    });
  });

  describe("utilities", () => {
    it("should clear all data", () => {
      index.addEdge("edge-1", "node-a", "node-b");
      index.addEdge("edge-2", "node-a", "node-c");

      index.clear();

      expect(index.hasEdges("node-a")).toBe(false);
      expect(index.getNodesForEdge("edge-1")).toBeUndefined();
    });

    it("should return statistics", () => {
      index.addEdge("edge-1", "node-a", "node-b");
      index.addEdge("edge-2", "node-b", "node-c");

      const stats = index.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
    });

    it("should return node edges map", () => {
      index.addEdge("edge-1", "node-a", "node-b");

      const map = index.getNodeEdgesMap();
      expect(map.get("node-a")).toBeDefined();
      expect(map.get("node-a")!.has("edge-1")).toBe(true);
    });
  });
});

describe("DEFAULT_DIRTY_TRACKER_CONFIG", () => {
  it("should have expected default values", () => {
    expect(DEFAULT_DIRTY_TRACKER_CONFIG.fullRedrawThreshold).toBe(0.5);
    expect(DEFAULT_DIRTY_TRACKER_CONFIG.enableBatching).toBe(true);
    expect(DEFAULT_DIRTY_TRACKER_CONFIG.batchWindowMs).toBe(16);
  });
});
