// Jest-compatible test file
import {
  createEmptyGraphData,
  mergeGraphData,
  GraphData,
  GraphChangeEvent,
} from "../../../../src/domain/models/GraphData";
import { GraphNode } from "../../../../src/domain/models/GraphNode";
import { GraphEdge } from "../../../../src/domain/models/GraphEdge";

describe("GraphData utilities", () => {
  describe("createEmptyGraphData", () => {
    it("should create empty graph data with correct structure", () => {
      const data = createEmptyGraphData();

      expect(data.nodes).toEqual([]);
      expect(data.edges).toEqual([]);
      expect(data.lastUpdated).toBeGreaterThan(0);
      expect(data.version).toBe(0);
    });

    it("should create independent instances", () => {
      const data1 = createEmptyGraphData();
      const data2 = createEmptyGraphData();

      data1.nodes.push({
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
      });

      expect(data1.nodes).toHaveLength(1);
      expect(data2.nodes).toHaveLength(0);
    });
  });

  describe("mergeGraphData", () => {
    let baseData: GraphData;
    let updateData: GraphData;

    beforeEach(() => {
      baseData = {
        nodes: [
          { id: "node1", path: "node1.md", title: "Node 1", label: "Node 1", isArchived: false },
          { id: "node2", path: "node2.md", title: "Node 2", label: "Node 2", isArchived: false },
        ],
        edges: [{ source: "node1", target: "node2", type: "forward-link" }],
        version: 1,
      };

      updateData = {
        nodes: [
          { id: "node2", path: "node2.md", title: "Node 2 Updated", label: "Node 2 Updated", isArchived: false },
          { id: "node3", path: "node3.md", title: "Node 3", label: "Node 3", isArchived: false },
        ],
        edges: [{ source: "node2", target: "node3", type: "forward-link" }],
        version: 2,
      };
    });

    it("should merge nodes without duplicates", () => {
      const merged = mergeGraphData(baseData, updateData);

      expect(merged.nodes).toHaveLength(3);
      expect(merged.nodes.map(n => n.id).sort()).toEqual(["node1", "node2", "node3"]);
    });

    it("should update existing nodes with new data", () => {
      const merged = mergeGraphData(baseData, updateData);

      const node2 = merged.nodes.find(n => n.id === "node2");
      expect(node2?.title).toBe("Node 2 Updated");
    });

    it("should merge edges without duplicates", () => {
      const merged = mergeGraphData(baseData, updateData);

      expect(merged.edges).toHaveLength(2);
    });

    it("should increment version", () => {
      const merged = mergeGraphData(baseData, updateData);

      expect(merged.version).toBe(3); // max(1, 2) + 1
    });

    it("should update lastUpdated timestamp", () => {
      const before = Date.now();
      const merged = mergeGraphData(baseData, updateData);
      const after = Date.now();

      expect(merged.lastUpdated).toBeGreaterThanOrEqual(before);
      expect(merged.lastUpdated).toBeLessThanOrEqual(after);
    });

    it("should handle empty base", () => {
      const emptyBase = createEmptyGraphData();
      const merged = mergeGraphData(emptyBase, updateData);

      expect(merged.nodes).toHaveLength(2);
      expect(merged.edges).toHaveLength(1);
    });

    it("should handle empty update", () => {
      const emptyUpdate = createEmptyGraphData();
      const merged = mergeGraphData(baseData, emptyUpdate);

      expect(merged.nodes).toHaveLength(2);
      expect(merged.edges).toHaveLength(1);
    });
  });
});

describe("GraphChangeEvent types", () => {
  it("should support all change types", () => {
    const nodeAddEvent: GraphChangeEvent = {
      type: "node-added",
      node: { id: "new", path: "new.md", title: "New", label: "New", isArchived: false },
      timestamp: Date.now(),
    };

    const nodeUpdateEvent: GraphChangeEvent = {
      type: "node-updated",
      node: { id: "existing", path: "existing.md", title: "Updated", label: "Updated", isArchived: false },
      timestamp: Date.now(),
    };

    const nodeRemoveEvent: GraphChangeEvent = {
      type: "node-removed",
      node: { id: "removed", path: "removed.md", title: "Removed", label: "Removed", isArchived: false },
      timestamp: Date.now(),
    };

    const edgeAddEvent: GraphChangeEvent = {
      type: "edge-added",
      edge: { source: "a", target: "b", type: "forward-link" },
      timestamp: Date.now(),
    };

    const edgeRemoveEvent: GraphChangeEvent = {
      type: "edge-removed",
      edge: { source: "a", target: "b", type: "forward-link" },
      timestamp: Date.now(),
    };

    const bulkUpdateEvent: GraphChangeEvent = {
      type: "bulk-update",
      nodes: [{ id: "n1", path: "n1.md", title: "N1", label: "N1", isArchived: false }],
      edges: [{ source: "n1", target: "n2", type: "forward-link" }],
      timestamp: Date.now(),
    };

    expect(nodeAddEvent.type).toBe("node-added");
    expect(nodeUpdateEvent.type).toBe("node-updated");
    expect(nodeRemoveEvent.type).toBe("node-removed");
    expect(edgeAddEvent.type).toBe("edge-added");
    expect(edgeRemoveEvent.type).toBe("edge-removed");
    expect(bulkUpdateEvent.type).toBe("bulk-update");
  });

  it("should support optional source field", () => {
    const event: GraphChangeEvent = {
      type: "node-added",
      node: { id: "new", path: "new.md", title: "New", label: "New", isArchived: false },
      timestamp: Date.now(),
      source: "triple-store",
    };

    expect(event.source).toBe("triple-store");
  });
});
