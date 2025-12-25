/**
 * Unit tests for CompactGraphStore
 */

import { CompactGraphStore } from "../../../../src/infrastructure/memory/CompactGraphStore";
import { NODE_FLAGS, DEFAULT_COLORS } from "../../../../src/infrastructure/memory/types";

describe("CompactGraphStore", () => {
  let store: CompactGraphStore;

  beforeEach(() => {
    store = new CompactGraphStore({
      initialNodeCapacity: 100,
      initialEdgeCapacity: 200,
    });
  });

  describe("constructor", () => {
    it("should create store with default capacity", () => {
      const defaultStore = new CompactGraphStore();
      expect(defaultStore.getNodeCount()).toBe(0);
      expect(defaultStore.getEdgeCount()).toBe(0);
    });

    it("should create store with custom capacity", () => {
      const stats = store.getMemoryStats();
      expect(stats.nodeCapacity).toBe(100);
      expect(stats.edgeCapacity).toBe(200);
    });
  });

  describe("addNode", () => {
    it("should add a node and return its index", () => {
      const index = store.addNode({
        id: "node1",
        label: "Test Node",
      });

      expect(index).toBe(0);
      expect(store.getNodeCount()).toBe(1);
    });

    it("should store node position", () => {
      store.addNode({
        id: "node1",
        label: "Test",
        x: 100,
        y: 200,
      });

      const pos = store.getNodePosition("node1");
      expect(pos).toEqual({ x: 100, y: 200 });
    });

    it("should generate random position if not provided", () => {
      store.addNode({
        id: "node1",
        label: "Test",
      });

      const pos = store.getNodePosition("node1");
      expect(pos).not.toBeNull();
      expect(typeof pos!.x).toBe("number");
      expect(typeof pos!.y).toBe("number");
    });

    it("should store node flags", () => {
      store.addNode({
        id: "node1",
        label: "Test",
        isPinned: true,
        isArchived: true,
      });

      const flags = store.getNodeFlags("node1");
      expect(flags & NODE_FLAGS.PINNED).toBeTruthy();
      expect(flags & NODE_FLAGS.ARCHIVED).toBeTruthy();
      expect(flags & NODE_FLAGS.VISIBLE).toBeTruthy();
    });

    it("should update existing node if ID already exists", () => {
      store.addNode({ id: "node1", label: "First", x: 10, y: 20 });
      store.addNode({ id: "node1", label: "Updated", x: 30, y: 40 });

      expect(store.getNodeCount()).toBe(1);
      const pos = store.getNodePosition("node1");
      expect(pos).toEqual({ x: 30, y: 40 });
    });

    it("should handle asset class interning", () => {
      store.addNode({ id: "node1", label: "Task", assetClass: "ems__Task" });
      store.addNode({ id: "node2", label: "Task 2", assetClass: "ems__Task" });

      // Both should reference the same interned type
      const typeTable = store.getTypeTable();
      expect(typeTable.size).toBe(1);
    });
  });

  describe("addEdge", () => {
    beforeEach(() => {
      store.addNode({ id: "node1", label: "Node 1" });
      store.addNode({ id: "node2", label: "Node 2" });
    });

    it("should add an edge between existing nodes", () => {
      const index = store.addEdge({
        sourceId: "node1",
        targetId: "node2",
        predicate: "links_to",
      });

      expect(index).toBe(0);
      expect(store.getEdgeCount()).toBe(1);
    });

    it("should return -1 for edge with non-existent source", () => {
      const index = store.addEdge({
        sourceId: "nonexistent",
        targetId: "node2",
      });

      expect(index).toBe(-1);
      expect(store.getEdgeCount()).toBe(0);
    });

    it("should return -1 for edge with non-existent target", () => {
      const index = store.addEdge({
        sourceId: "node1",
        targetId: "nonexistent",
      });

      expect(index).toBe(-1);
    });

    it("should not add duplicate edges", () => {
      store.addEdge({ sourceId: "node1", targetId: "node2", predicate: "rel" });
      store.addEdge({ sourceId: "node1", targetId: "node2", predicate: "rel" });

      expect(store.getEdgeCount()).toBe(1);
    });
  });

  describe("addNodes / addEdges", () => {
    it("should add multiple nodes at once", () => {
      const indices = store.addNodes([
        { id: "n1", label: "Node 1" },
        { id: "n2", label: "Node 2" },
        { id: "n3", label: "Node 3" },
      ]);

      expect(indices).toEqual([0, 1, 2]);
      expect(store.getNodeCount()).toBe(3);
    });

    it("should add multiple edges at once", () => {
      store.addNodes([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ]);

      const indices = store.addEdges([
        { sourceId: "a", targetId: "b" },
        { sourceId: "b", targetId: "c" },
        { sourceId: "nonexistent", targetId: "a" },
      ]);

      expect(indices[0]).toBe(0);
      expect(indices[1]).toBe(1);
      expect(indices[2]).toBe(-1);
      expect(store.getEdgeCount()).toBe(2);
    });
  });

  describe("loadChunk", () => {
    it("should load a chunk of nodes and edges", () => {
      const result = store.loadChunk({
        chunkIndex: 0,
        totalChunks: 1,
        nodes: [
          { id: "n1", label: "Node 1" },
          { id: "n2", label: "Node 2" },
        ],
        edges: [{ sourceId: "n1", targetId: "n2" }],
        isLast: true,
      });

      expect(result.nodesAdded).toBe(2);
      expect(result.edgesAdded).toBe(1);
    });
  });

  describe("position operations", () => {
    beforeEach(() => {
      store.addNode({ id: "node1", label: "Test", x: 0, y: 0 });
    });

    it("should get position by ID", () => {
      const pos = store.getNodePosition("node1");
      expect(pos).toEqual({ x: 0, y: 0 });
    });

    it("should return null for non-existent node", () => {
      const pos = store.getNodePosition("nonexistent");
      expect(pos).toBeNull();
    });

    it("should set position by ID", () => {
      const result = store.setNodePosition("node1", 50, 100);
      expect(result).toBe(true);
      expect(store.getNodePosition("node1")).toEqual({ x: 50, y: 100 });
    });

    it("should return false when setting position for non-existent node", () => {
      const result = store.setNodePosition("nonexistent", 50, 100);
      expect(result).toBe(false);
    });

    it("should get position by index", () => {
      const pos = store.getNodePositionByIndex(0);
      expect(pos).toEqual({ x: 0, y: 0 });
    });

    it("should set position by index", () => {
      store.setNodePositionByIndex(0, 25, 75);
      expect(store.getNodePosition("node1")).toEqual({ x: 25, y: 75 });
    });

    it("should batch update positions", () => {
      store.addNode({ id: "node2", label: "Test 2", x: 0, y: 0 });

      const updated = store.updateNodePositions(
        new Map([
          ["node1", { x: 10, y: 20 }],
          ["node2", { x: 30, y: 40 }],
        ])
      );

      expect(updated).toBe(2);
      expect(store.getNodePosition("node1")).toEqual({ x: 10, y: 20 });
      expect(store.getNodePosition("node2")).toEqual({ x: 30, y: 40 });
    });
  });

  describe("flag operations", () => {
    beforeEach(() => {
      store.addNode({ id: "node1", label: "Test" });
    });

    it("should get node flags", () => {
      const flags = store.getNodeFlags("node1");
      expect(flags & NODE_FLAGS.VISIBLE).toBeTruthy();
    });

    it("should return 0 for non-existent node", () => {
      const flags = store.getNodeFlags("nonexistent");
      expect(flags).toBe(0);
    });

    it("should set a flag", () => {
      store.setNodeFlag("node1", NODE_FLAGS.SELECTED);
      expect(store.hasNodeFlag("node1", NODE_FLAGS.SELECTED)).toBe(true);
    });

    it("should clear a flag", () => {
      store.setNodeFlag("node1", NODE_FLAGS.SELECTED);
      store.clearNodeFlag("node1", NODE_FLAGS.SELECTED);
      expect(store.hasNodeFlag("node1", NODE_FLAGS.SELECTED)).toBe(false);
    });

    it("should check if node has a flag", () => {
      expect(store.hasNodeFlag("node1", NODE_FLAGS.VISIBLE)).toBe(true);
      expect(store.hasNodeFlag("node1", NODE_FLAGS.SELECTED)).toBe(false);
    });
  });

  describe("selection", () => {
    beforeEach(() => {
      store.addNodes([
        { id: "n1", label: "1" },
        { id: "n2", label: "2" },
        { id: "n3", label: "3" },
      ]);
    });

    it("should select a node", () => {
      store.selectNode("n1");
      expect(store.hasNodeFlag("n1", NODE_FLAGS.SELECTED)).toBe(true);
    });

    it("should deselect a node", () => {
      store.selectNode("n1");
      store.deselectNode("n1");
      expect(store.hasNodeFlag("n1", NODE_FLAGS.SELECTED)).toBe(false);
    });

    it("should get selected node IDs", () => {
      store.selectNode("n1");
      store.selectNode("n3");

      const selected = store.getSelectedNodeIds();
      expect(selected).toContain("n1");
      expect(selected).toContain("n3");
      expect(selected).not.toContain("n2");
    });

    it("should clear all selections", () => {
      store.selectNode("n1");
      store.selectNode("n2");
      store.clearSelection();

      const selected = store.getSelectedNodeIds();
      expect(selected.length).toBe(0);
    });
  });

  describe("node/edge lookups", () => {
    beforeEach(() => {
      store.addNodes([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ]);
      store.addEdges([
        { sourceId: "a", targetId: "b" },
        { sourceId: "b", targetId: "c" },
        { sourceId: "a", targetId: "c" },
      ]);
    });

    it("should get node ID by index", () => {
      expect(store.getNodeId(0)).toBe("a");
      expect(store.getNodeId(1)).toBe("b");
    });

    it("should get node index by ID", () => {
      expect(store.getNodeIndex("a")).toBe(0);
      expect(store.getNodeIndex("c")).toBe(2);
    });

    it("should check if node exists", () => {
      expect(store.hasNode("a")).toBe(true);
      expect(store.hasNode("nonexistent")).toBe(false);
    });

    it("should get edges for a node", () => {
      const edges = store.getNodeEdges("a");
      expect(edges.length).toBe(2);
      expect(edges.every((e) => e.isSource)).toBe(true);
    });

    it("should get neighbors of a node", () => {
      const neighbors = store.getNeighbors("a");
      expect(neighbors).toContain("b");
      expect(neighbors).toContain("c");
      expect(neighbors).not.toContain("a");
    });
  });

  describe("applyNodeUpdates", () => {
    beforeEach(() => {
      store.addNodes([
        { id: "n1", label: "1", x: 0, y: 0 },
        { id: "n2", label: "2", x: 0, y: 0 },
      ]);
    });

    it("should apply sparse updates", () => {
      const result = store.applyNodeUpdates([
        { index: 0, x: 100, y: 200 },
        { index: 1, radius: 12, color: 0xff0000ff },
      ]);

      expect(result.nodesUpdated).toBe(2);
      expect(store.getNodePosition("n1")).toEqual({ x: 100, y: 200 });
    });

    it("should set and clear flags", () => {
      store.applyNodeUpdates([
        { index: 0, setFlags: NODE_FLAGS.HIGHLIGHTED },
      ]);

      expect(store.hasNodeFlag("n1", NODE_FLAGS.HIGHLIGHTED)).toBe(true);

      store.applyNodeUpdates([
        { index: 0, clearFlags: NODE_FLAGS.HIGHLIGHTED },
      ]);

      expect(store.hasNodeFlag("n1", NODE_FLAGS.HIGHLIGHTED)).toBe(false);
    });
  });

  describe("getRawArrays", () => {
    it("should return typed arrays and counts", () => {
      store.addNode({ id: "n1", label: "1" });

      const raw = store.getRawArrays();
      expect(raw.nodeCount).toBe(1);
      expect(raw.edgeCount).toBe(0);
      expect(raw.nodes.positions).toBeInstanceOf(Float32Array);
      expect(raw.edges.sourceIndices).toBeInstanceOf(Uint32Array);
    });
  });

  describe("getPositionsArray", () => {
    it("should return positions subarray", () => {
      store.addNodes([
        { id: "n1", label: "1", x: 10, y: 20 },
        { id: "n2", label: "2", x: 30, y: 40 },
      ]);

      const positions = store.getPositionsArray();
      expect(positions.length).toBe(4);
      expect(positions[0]).toBe(10);
      expect(positions[1]).toBe(20);
      expect(positions[2]).toBe(30);
      expect(positions[3]).toBe(40);
    });
  });

  describe("getMemoryStats", () => {
    it("should return memory statistics", () => {
      store.addNodes([
        { id: "n1", label: "Node 1", assetClass: "Task" },
        { id: "n2", label: "Node 2", assetClass: "Project" },
      ]);
      store.addEdge({ sourceId: "n1", targetId: "n2", predicate: "rel" });

      const stats = store.getMemoryStats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.edgeCount).toBe(1);
      expect(stats.nodeCapacity).toBe(100);
      expect(stats.edgeCapacity).toBe(200);
      expect(stats.nodeMemoryBytes).toBeGreaterThan(0);
      expect(stats.edgeMemoryBytes).toBeGreaterThan(0);
      expect(stats.totalBytes).toBeGreaterThan(0);
      expect(stats.internedStringCount).toBeGreaterThan(0);
    });
  });

  describe("clear", () => {
    it("should remove all data", () => {
      store.addNodes([
        { id: "n1", label: "1" },
        { id: "n2", label: "2" },
      ]);
      store.addEdge({ sourceId: "n1", targetId: "n2" });

      store.clear();

      expect(store.getNodeCount()).toBe(0);
      expect(store.getEdgeCount()).toBe(0);
      expect(store.hasNode("n1")).toBe(false);
    });
  });

  describe("dynamic resizing", () => {
    it("should resize node arrays when capacity is exceeded", () => {
      const smallStore = new CompactGraphStore({
        initialNodeCapacity: 2,
        initialEdgeCapacity: 2,
        growthFactor: 2,
      });

      // Add more nodes than initial capacity
      smallStore.addNodes([
        { id: "n1", label: "1" },
        { id: "n2", label: "2" },
        { id: "n3", label: "3" },
        { id: "n4", label: "4" },
      ]);

      expect(smallStore.getNodeCount()).toBe(4);
      const stats = smallStore.getMemoryStats();
      expect(stats.nodeCapacity).toBeGreaterThanOrEqual(4);
    });

    it("should resize edge arrays when capacity is exceeded", () => {
      const smallStore = new CompactGraphStore({
        initialNodeCapacity: 10,
        initialEdgeCapacity: 2,
        growthFactor: 2,
      });

      smallStore.addNodes([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ]);

      smallStore.addEdges([
        { sourceId: "a", targetId: "b" },
        { sourceId: "b", targetId: "c" },
        { sourceId: "c", targetId: "d" },
        { sourceId: "d", targetId: "a" },
      ]);

      expect(smallStore.getEdgeCount()).toBe(4);
    });
  });

  describe("color parsing", () => {
    it("should parse hex color strings", () => {
      store.addNode({ id: "n1", label: "1", color: "#ff0000" });
      const raw = store.getRawArrays();
      // #ff0000 -> 0xff0000ff (with alpha)
      expect(raw.nodes.colors[0]).toBe(0xff0000ff);
    });

    it("should parse hex color with alpha", () => {
      store.addNode({ id: "n1", label: "1", color: "#ff000080" });
      const raw = store.getRawArrays();
      expect(raw.nodes.colors[0]).toBe(0xff000080);
    });

    it("should use default color for invalid strings", () => {
      store.addNode({ id: "n1", label: "1", color: "invalid" });
      const raw = store.getRawArrays();
      expect(raw.nodes.colors[0]).toBe(DEFAULT_COLORS.NODE);
    });
  });
});
