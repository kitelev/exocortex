// Jest-compatible test file
import {
  GraphNode,
  GraphNodeData,
  hasPosition,
  isFixed,
} from "../../../../src/domain/models/GraphNode";

describe("GraphNode", () => {
  describe("GraphNodeData interface", () => {
    it("should support all required fields", () => {
      const nodeData: GraphNodeData = {
        id: "test-id",
        path: "test.md",
        title: "Test Node",
        label: "Test",
        isArchived: false,
      };

      expect(nodeData.id).toBe("test-id");
      expect(nodeData.path).toBe("test.md");
      expect(nodeData.title).toBe("Test Node");
      expect(nodeData.label).toBe("Test");
      expect(nodeData.isArchived).toBe(false);
    });

    it("should support all optional fields", () => {
      const nodeData: GraphNodeData = {
        id: "test-id",
        path: "test.md",
        title: "Test Node",
        label: "Test",
        isArchived: false,
        assetClass: "ems__Task",
        uri: "obsidian://vault/test.md",
        prototype: "template-uri",
        parent: "parent-uri",
        lastModified: Date.now(),
        properties: { customProp: "value" },
        inDegree: 5,
        outDegree: 3,
      };

      expect(nodeData.assetClass).toBe("ems__Task");
      expect(nodeData.uri).toBe("obsidian://vault/test.md");
      expect(nodeData.prototype).toBe("template-uri");
      expect(nodeData.parent).toBe("parent-uri");
      expect(nodeData.lastModified).toBeGreaterThan(0);
      expect(nodeData.properties).toEqual({ customProp: "value" });
      expect(nodeData.inDegree).toBe(5);
      expect(nodeData.outDegree).toBe(3);
    });
  });

  describe("GraphNode interface", () => {
    it("should extend GraphNodeData with position fields", () => {
      const node: GraphNode = {
        id: "test-id",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        x: 100,
        y: 200,
        vx: 0.5,
        vy: -0.3,
        fx: null,
        fy: null,
        weight: 8,
        group: 1,
      };

      expect(node.x).toBe(100);
      expect(node.y).toBe(200);
      expect(node.vx).toBe(0.5);
      expect(node.vy).toBe(-0.3);
      expect(node.fx).toBeNull();
      expect(node.fy).toBeNull();
      expect(node.weight).toBe(8);
      expect(node.group).toBe(1);
    });
  });

  describe("hasPosition type guard", () => {
    it("should return true for nodes with x and y", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        x: 100,
        y: 200,
      };

      expect(hasPosition(node)).toBe(true);
    });

    it("should return false for nodes without x", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        y: 200,
      };

      expect(hasPosition(node)).toBe(false);
    });

    it("should return false for nodes without y", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        x: 100,
      };

      expect(hasPosition(node)).toBe(false);
    });

    it("should return false for nodes without position", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
      };

      expect(hasPosition(node)).toBe(false);
    });
  });

  describe("isFixed type guard", () => {
    it("should return true for nodes with fx and fy set", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        fx: 100,
        fy: 200,
      };

      expect(isFixed(node)).toBe(true);
    });

    it("should return false for nodes with null fx", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        fx: null,
        fy: 200,
      };

      expect(isFixed(node)).toBe(false);
    });

    it("should return false for nodes with null fy", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
        fx: 100,
        fy: null,
      };

      expect(isFixed(node)).toBe(false);
    });

    it("should return false for nodes without fx and fy", () => {
      const node: GraphNode = {
        id: "test",
        path: "test.md",
        title: "Test",
        label: "Test",
        isArchived: false,
      };

      expect(isFixed(node)).toBe(false);
    });
  });
});
