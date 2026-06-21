// Jest-compatible test file
import {
  GraphEdge,
  GraphEdgeType,
  GraphEdgeResolved,
  createEdgeId,
  edgesEqual,
} from "../../../../src/domain/models/GraphEdge";
import { GraphNode } from "../../../../src/domain/models/GraphNode";

describe("GraphEdge", () => {
  describe("GraphEdgeType", () => {
    it("should support all edge types", () => {
      const types: GraphEdgeType[] = [
        "backlink",
        "forward-link",
        "hierarchy",
        "prototype",
        "semantic",
        "reference",
      ];

      expect(types).toHaveLength(6);
      types.forEach(type => {
        expect(typeof type).toBe("string");
      });
    });
  });

  describe("GraphEdge interface", () => {
    it("should support required fields", () => {
      const edge: GraphEdge = {
        source: "node-a",
        target: "node-b",
        type: "forward-link",
      };

      expect(edge.source).toBe("node-a");
      expect(edge.target).toBe("node-b");
      expect(edge.type).toBe("forward-link");
    });

    it("should support optional fields", () => {
      const edge: GraphEdge = {
        id: "edge-001",
        source: "node-a",
        target: "node-b",
        type: "hierarchy",
        predicate: "http://example.org/parent",
        label: "parent",
        weight: 1.5,
        bidirectional: false,
        properties: { custom: "value" },
      };

      expect(edge.id).toBe("edge-001");
      expect(edge.predicate).toBe("http://example.org/parent");
      expect(edge.label).toBe("parent");
      expect(edge.weight).toBe(1.5);
      expect(edge.bidirectional).toBe(false);
      expect(edge.properties).toEqual({ custom: "value" });
    });
  });

  describe("GraphEdgeResolved interface", () => {
    it("should work with node objects as source and target", () => {
      const nodeA: GraphNode = {
        id: "node-a",
        path: "a.md",
        title: "Node A",
        label: "A",
        isArchived: false,
      };

      const nodeB: GraphNode = {
        id: "node-b",
        path: "b.md",
        title: "Node B",
        label: "B",
        isArchived: false,
      };

      const edge: GraphEdgeResolved<GraphNode> = {
        source: nodeA,
        target: nodeB,
        type: "forward-link",
      };

      expect(edge.source.id).toBe("node-a");
      expect(edge.target.id).toBe("node-b");
    });
  });

  describe("createEdgeId", () => {
    it("should create unique ID from source, target, and type", () => {
      const id = createEdgeId("node-a", "node-b", "forward-link");

      expect(id).toBe("node-a->node-b:forward-link");
    });

    it("should include predicate in ID when provided", () => {
      const id = createEdgeId("node-a", "node-b", "hierarchy", "http://example.org/parent");

      expect(id).toBe("node-a->node-b:hierarchy|http://example.org/parent");
    });

    it("should create different IDs for different types", () => {
      const id1 = createEdgeId("a", "b", "forward-link");
      const id2 = createEdgeId("a", "b", "hierarchy");

      expect(id1).not.toBe(id2);
    });

    it("should create different IDs for different directions", () => {
      const id1 = createEdgeId("a", "b", "forward-link");
      const id2 = createEdgeId("b", "a", "forward-link");

      expect(id1).not.toBe(id2);
    });
  });

  describe("edgesEqual", () => {
    it("should return true for identical edges", () => {
      const edge1: GraphEdge = {
        source: "a",
        target: "b",
        type: "forward-link",
      };

      const edge2: GraphEdge = {
        source: "a",
        target: "b",
        type: "forward-link",
      };

      expect(edgesEqual(edge1, edge2)).toBe(true);
    });

    it("should return false for different sources", () => {
      const edge1: GraphEdge = {
        source: "a",
        target: "b",
        type: "forward-link",
      };

      const edge2: GraphEdge = {
        source: "c",
        target: "b",
        type: "forward-link",
      };

      expect(edgesEqual(edge1, edge2)).toBe(false);
    });

    it("should return false for different targets", () => {
      const edge1: GraphEdge = {
        source: "a",
        target: "b",
        type: "forward-link",
      };

      const edge2: GraphEdge = {
        source: "a",
        target: "c",
        type: "forward-link",
      };

      expect(edgesEqual(edge1, edge2)).toBe(false);
    });

    it("should return false for different types", () => {
      const edge1: GraphEdge = {
        source: "a",
        target: "b",
        type: "forward-link",
      };

      const edge2: GraphEdge = {
        source: "a",
        target: "b",
        type: "hierarchy",
      };

      expect(edgesEqual(edge1, edge2)).toBe(false);
    });

    it("should consider predicate when comparing", () => {
      const edge1: GraphEdge = {
        source: "a",
        target: "b",
        type: "semantic",
        predicate: "http://example.org/pred1",
      };

      const edge2: GraphEdge = {
        source: "a",
        target: "b",
        type: "semantic",
        predicate: "http://example.org/pred2",
      };

      expect(edgesEqual(edge1, edge2)).toBe(false);
    });

    it("should return true when both predicates are undefined", () => {
      const edge1: GraphEdge = {
        source: "a",
        target: "b",
        type: "forward-link",
      };

      const edge2: GraphEdge = {
        source: "a",
        target: "b",
        type: "forward-link",
      };

      expect(edgesEqual(edge1, edge2)).toBe(true);
    });
  });
});
