import { GraphNode, GraphNodeData } from "../../../src/domain/models/GraphNode";

describe("GraphNode", () => {
  describe("GraphNodeData", () => {
    it("should accept valid GraphNodeData", () => {
      const data: GraphNodeData = {
        path: "/path/to/note.md",
        title: "My Note",
        label: "Note Label",
        assetClass: "ems__Task",
        isArchived: false
      };

      expect(data.path).toBe("/path/to/note.md");
      expect(data.title).toBe("My Note");
      expect(data.label).toBe("Note Label");
      expect(data.assetClass).toBe("ems__Task");
      expect(data.isArchived).toBe(false);
    });

    it("should allow optional assetClass", () => {
      const data: GraphNodeData = {
        path: "/path/to/note.md",
        title: "My Note",
        label: "Note Label",
        isArchived: false
      };

      expect(data.assetClass).toBeUndefined();
    });

    it("should handle archived node", () => {
      const data: GraphNodeData = {
        path: "/archived/note.md",
        title: "Archived Note",
        label: "Old Label",
        isArchived: true
      };

      expect(data.isArchived).toBe(true);
    });
  });

  describe("GraphNode", () => {
    it("should extend GraphNodeData with position properties", () => {
      const node: GraphNode = {
        path: "/path/to/note.md",
        title: "My Note",
        label: "Note Label",
        isArchived: false,
        x: 100,
        y: 200
      };

      expect(node.x).toBe(100);
      expect(node.y).toBe(200);
    });

    it("should allow velocity properties", () => {
      const node: GraphNode = {
        path: "/path/to/note.md",
        title: "My Note",
        label: "Note Label",
        isArchived: false,
        vx: 10,
        vy: 20
      };

      expect(node.vx).toBe(10);
      expect(node.vy).toBe(20);
    });

    it("should allow fixed position properties", () => {
      const node: GraphNode = {
        path: "/path/to/note.md",
        title: "My Note",
        label: "Note Label",
        isArchived: false,
        fx: 150,
        fy: 250
      };

      expect(node.fx).toBe(150);
      expect(node.fy).toBe(250);
    });

    it("should allow null for fixed position", () => {
      const node: GraphNode = {
        path: "/path/to/note.md",
        title: "My Note",
        label: "Note Label",
        isArchived: false,
        fx: null,
        fy: null
      };

      expect(node.fx).toBeNull();
      expect(node.fy).toBeNull();
    });

    it("should work without optional position properties", () => {
      const node: GraphNode = {
        path: "/path/to/note.md",
        title: "My Note",
        label: "Note Label",
        isArchived: false
      };

      expect(node.x).toBeUndefined();
      expect(node.y).toBeUndefined();
      expect(node.vx).toBeUndefined();
      expect(node.vy).toBeUndefined();
      expect(node.fx).toBeUndefined();
      expect(node.fy).toBeUndefined();
    });
  });
});
